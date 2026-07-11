<?php

namespace App\Services;

use DateTime;
use DateTimeZone;
use Exception;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class FocalRtvService
{
    protected string $apiUrl;
    protected string $clientSecret;
    protected string $subscriptionKey;
    protected int $projectId = 26;
    protected string $tableName = 'project_26_orders';
    protected string $imagesTable = 'job_detail_26_images';
    protected bool $imagesTableStorageChecked = false;
    protected string $timezone = 'Europe/London';

    public function __construct()
    {
        $this->apiUrl = (string) env('FOCAL_RTV_API_URL', 'https://api.focalagent.com/fesp-int/v3/jobs');
        $this->clientSecret = (string) env('FOCAL_RTV_CLIENT_SECRET', 'Str0ngP@ss!987');
        $this->subscriptionKey = (string) env('FOCAL_RTV_SUBSCRIPTION_KEY', 'c7e961fc3a1c4b5d84bb26195f768780');
    }

    public function import(): array
    {
        try {
            Log::info('Focal RTV import started for Project 26');

            $jobs = $this->fetchJobsFromApi();
            if (empty($jobs)) {
                $result = $this->emptyResult('No jobs returned from API');
                $result['image_backfill_checked'] = $this->backfillMissingImagesForExistingOrders(50);
                $result['success'] = true;
                return $result;
            }

            $filteredJobs = $this->filterPhotographyJobs($jobs);
            if (empty($filteredJobs)) {
                $result = $this->emptyResult('No Photography jobs found');
                $result['image_backfill_checked'] = $this->backfillMissingImagesForExistingOrders(50);
                $result['success'] = true;
                return $result;
            }

            $result = $this->importJobs($filteredJobs);
            $result['image_backfill_checked'] = $this->backfillMissingImagesForExistingOrders(50);
            Log::info('Focal RTV import completed', $result);

            return $result;
        } catch (Exception $e) {
            Log::error('Focal RTV import error: ' . $e->getMessage(), ['exception' => $e]);

            return [
                'success' => false,
                'message' => 'Import error: ' . $e->getMessage(),
                'inserted' => 0,
                'updated' => 0,
                'skipped' => 0,
            ];
        }
    }

    public function fetchRaw(): array
    {
        try {
            return $this->requestJobsResponse();
        } catch (Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }

    protected function fetchJobsFromApi(): array
    {
        try {
            $data = $this->requestJobsResponse();

            if (!isset($data['Jobs']) || !is_array($data['Jobs'])) {
                Log::warning('Invalid Focal RTV API response: no Jobs array', ['response' => $data]);
                return [];
            }

            return $data['Jobs'];
        } catch (Exception $e) {
            Log::error('Focal RTV API fetch error: ' . $e->getMessage());
            return [];
        }
    }

    protected function requestJobsResponse(): array
    {
        if ($this->clientSecret === '' || $this->subscriptionKey === '') {
            throw new Exception('Missing FOCAL_RTV_CLIENT_SECRET or FOCAL_RTV_SUBSCRIPTION_KEY');
        }

        $response = Http::timeout(60)
            ->withOptions([
                'verify' => false,
            ])
            ->withHeaders([
                'Accept' => '*/*',
                'client-secret' => $this->clientSecret,
                'Ocp-Apim-Subscription-Key' => $this->subscriptionKey,
            ])
            ->get($this->apiUrl);

        if (!$response->successful()) {
            Log::error('Focal RTV API request failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            return [];
        }

        return $response->json() ?? [];
    }

    protected function requestFocalGet(string $url)
    {
        return Http::timeout(60)
            ->withOptions([
                'verify' => false,
            ])
            ->withHeaders([
                'Accept' => '*/*',
                'client-secret' => $this->clientSecret,
                'Ocp-Apim-Subscription-Key' => $this->subscriptionKey,
            ])
            ->get($url);
    }

    protected function ensureImagesTableExists(): void
    {
        if (Schema::hasTable($this->imagesTable)) {
            $this->ensureImagesTableCanStoreLongLinks();
            return;
        }

        Schema::create($this->imagesTable, function ($table) {
            $table->increments('id');
            $table->longText('images_url')->nullable();
            $table->longText('file_name')->nullable();
            $table->string('job_order_id', 500)->nullable()->index();
        });

        $this->imagesTableStorageChecked = true;
    }

    protected function ensureImagesTableCanStoreLongLinks(): void
    {
        if ($this->imagesTableStorageChecked) {
            return;
        }

        try {
            DB::statement("ALTER TABLE {$this->imagesTable} MODIFY images_url LONGTEXT NULL");
            DB::statement("ALTER TABLE {$this->imagesTable} MODIFY file_name LONGTEXT NULL");
            $this->imagesTableStorageChecked = true;
        } catch (Exception $e) {
            $this->imagesTableStorageChecked = true;

            Log::warning('Unable to widen Focal RTV image link columns', [
                'table' => $this->imagesTable,
                'error' => $e->getMessage(),
            ]);
        }
    }

    protected function filterPhotographyJobs(array $jobs): array
    {
        return array_filter($jobs, function ($job) {
            $product = isset($job['Product']) ? strtolower(trim((string) $job['Product'])) : '';
            return $product === 'photography';
        });
    }

    protected function importJobs(array $jobs): array
    {
        $inserted = 0;
        $updated = 0;
        $skipped = 0;
        $now = new DateTime('now', new DateTimeZone($this->timezone));
        $records = [];
        $seenPortalIds = [];

        foreach ($jobs as $job) {
            try {
                if (empty($job['FocalJobId'])) {
                    $skipped++;
                    continue;
                }

                $clientPortalId = (string) $job['FocalJobId'];
                if (isset($seenPortalIds[$clientPortalId])) {
                    $skipped++;
                    continue;
                }

                $seenPortalIds[$clientPortalId] = true;
                $records[] = $this->mapJobToOrder($job, $now);
            } catch (Exception $e) {
                Log::error('Error processing Focal RTV job', [
                    'focal_job_id' => $job['FocalJobId'] ?? 'unknown',
                    'error' => $e->getMessage(),
                ]);
                $skipped++;
            }
        }

        if (!empty($records)) {
            [$inserted, $updated, $rowSkipped] = $this->batchInsertOrUpdate($records);
            $skipped += $rowSkipped;
        }

        foreach ($jobs as $job) {
            try {
                if (empty($job['FocalJobId'])) {
                    continue;
                }

                $this->storeJobAssets($job);
            } catch (Exception $e) {
                Log::error('Error storing Focal RTV job assets', [
                    'focal_job_id' => $job['FocalJobId'] ?? 'unknown',
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return [
            'success' => true,
            'message' => 'Import completed',
            'inserted' => $inserted,
            'updated' => $updated,
            'skipped' => $skipped,
            'total_processed' => $inserted + $updated + $skipped,
        ];
    }

    protected function storeJobAssets(array $job): void
    {
        $focalJobId = (string) ($job['FocalJobId'] ?? $job['client_portal_id'] ?? '');

        if ($focalJobId === '') {
            return;
        }

        $this->ensureImagesTableExists();

        if (!$this->orderExists($focalJobId)) {
            Log::warning('Skipping Focal RTV image fetch because order is not stored locally yet', [
                'focal_job_id' => $focalJobId,
            ]);
            return;
        }

        $details = $this->fetchJobDetails($focalJobId);
        $images = $this->dedupeImages(array_merge(
            $this->extractImagesFromPayload($job),
            $this->extractImagesFromPayload($details)
        ));

        $this->updateOrderMetadataFromDetails($focalJobId, $details);

        if (empty($images)) {
            Log::info('No Focal RTV image URLs found for job', [
                'focal_job_id' => $focalJobId,
            ]);
            return;
        }

        $existingUrls = DB::table($this->imagesTable)
            ->where('job_order_id', $focalJobId)
            ->whereNotNull('images_url')
            ->pluck('images_url')
            ->map(fn ($url) => trim((string) $url))
            ->filter()
            ->flip()
            ->all();

        foreach ($images as $image) {
            $url = trim((string) ($image['url'] ?? ''));

            if ($url === '' || isset($existingUrls[$url])) {
                continue;
            }

            try {
                DB::table($this->imagesTable)->insert([
                    'images_url' => $url,
                    'file_name' => $image['file_name'] ?? null,
                    'job_order_id' => $focalJobId,
                ]);
                $existingUrls[$url] = true;
            } catch (Exception $e) {
                Log::error('Failed to save Focal RTV job image', [
                    'focal_job_id' => $focalJobId,
                    'url' => $url,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    protected function orderExists(string $focalJobId): bool
    {
        return DB::table($this->tableName)
            ->where('client_portal_id', $focalJobId)
            ->exists();
    }

    protected function fetchJobDetails(string $focalJobId): array
    {
        $endpoints = [
            rtrim($this->apiUrl, '/') . '/' . $focalJobId . '/details',
            str_replace('/v3/', '/v2/', rtrim($this->apiUrl, '/')) . '/' . $focalJobId . '/details',
        ];

        foreach ($endpoints as $url) {
            try {
                $response = $this->requestFocalGet($url);

                if ($response->successful()) {
                    return $response->json() ?? [];
                }

                Log::debug('Focal RTV details endpoint unavailable', [
                    'focal_job_id' => $focalJobId,
                    'status' => $response->status(),
                    'url' => $url,
                ]);
            } catch (Exception $e) {
                Log::warning('Focal RTV details fetch failed', [
                    'focal_job_id' => $focalJobId,
                    'url' => $url,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return [];
    }

    protected function updateOrderMetadataFromDetails(string $focalJobId, array $details): void
    {
        if (empty($details)) {
            return;
        }

        $existing = DB::table($this->tableName)
            ->where('client_portal_id', $focalJobId)
            ->first(['id', 'metadata', 'supervisor_notes']);

        if (!$existing) {
            return;
        }

        $metadata = [];
        if (!empty($existing->metadata)) {
            $decoded = json_decode((string) $existing->metadata, true);
            if (is_array($decoded)) {
                $metadata = $decoded;
            }
        }

        $jobDetails = is_array($details['Job'] ?? null) ? $details['Job'] : [];
        $metadata['details_api_response'] = $details;
        $metadata['processing_code'] = $jobDetails['ProcessingCode'] ?? ($metadata['processing_code'] ?? null);
        $metadata['processing_code_description'] = $jobDetails['ProcessingCodeDescription'] ?? ($metadata['processing_code_description'] ?? null);
        $metadata['preferences'] = $jobDetails['Preferences'] ?? ($metadata['preferences'] ?? null);
        $metadata['external_account_name'] = $jobDetails['ExternalAccountName'] ?? ($metadata['external_account_name'] ?? null);
        $metadata['additional_notes'] = $this->extractNotesFromDetails($details) ?: ($metadata['additional_notes'] ?? null);

        $update = [
            'metadata' => json_encode($metadata),
            'updated_at' => (new DateTime('now', new DateTimeZone($this->timezone)))->format('Y-m-d H:i:s'),
        ];

        if (Schema::hasColumn($this->tableName, 'supervisor_notes') && empty($existing->supervisor_notes) && !empty($metadata['additional_notes'])) {
            $update['supervisor_notes'] = $metadata['additional_notes'];
        }

        DB::table($this->tableName)
            ->where('id', $existing->id)
            ->update($update);
    }

    protected function extractNotesFromDetails(array $details): string
    {
        $jobDetails = is_array($details['Job'] ?? null) ? $details['Job'] : [];
        $notes = [];

        foreach ($jobDetails as $key => $value) {
            if (!str_ends_with((string) $key, 'Notes') || empty($value)) {
                continue;
            }

            $notes[] = is_array($value) ? implode(', ', $value) : (string) $value;
        }

        return implode(' | ', array_filter($notes));
    }

    protected function extractImagesFromPayload(array $payload): array
    {
        $images = [];

        foreach (['Images', 'Photos', 'RawPhotoAssets', 'Assets'] as $key) {
            if (empty($payload[$key]) || !is_array($payload[$key])) {
                continue;
            }

            foreach ($payload[$key] as $asset) {
                if (!is_array($asset)) {
                    continue;
                }

                $url = $asset['Url'] ?? $asset['url'] ?? $asset['URL'] ?? null;
                $name = $asset['FileName'] ?? $asset['file_name'] ?? ($url ? basename(parse_url($url, PHP_URL_PATH) ?: $url) : null);

                if ($url) {
                    $images[] = [
                        'url' => $url,
                        'file_name' => $name,
                    ];
                }
            }
        }

        if (!empty($images)) {
            return $images;
        }

        return $this->extractImagesRecursively($payload);
    }

    protected function extractImagesRecursively($data): array
    {
        $images = [];

        if (!is_array($data)) {
            return $images;
        }

        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $images = array_merge($images, $this->extractImagesRecursively($value));
                continue;
            }

            if (!is_string($value)) {
                continue;
            }

            $keyLower = strtolower((string) $key);
            $isUrlKey = in_array($keyLower, ['url', 'href', 'downloadurl', 'download_url', 'imageurl', 'image_url'], true);
            $isHttpValue = str_starts_with(strtolower($value), 'http://') || str_starts_with(strtolower($value), 'https://');

            if ($isUrlKey && $isHttpValue) {
                $images[] = [
                    'url' => $value,
                    'file_name' => basename(parse_url($value, PHP_URL_PATH) ?: $value),
                ];
            }
        }

        return $images;
    }

    protected function dedupeImages(array $images): array
    {
        $unique = [];
        $seen = [];

        foreach ($images as $image) {
            $url = trim((string) ($image['url'] ?? ''));

            if ($url === '' || isset($seen[$url])) {
                continue;
            }

            $seen[$url] = true;
            $unique[] = [
                'url' => $url,
                'file_name' => $image['file_name'] ?? basename(parse_url($url, PHP_URL_PATH) ?: $url),
            ];
        }

        return $unique;
    }

    protected function backfillMissingImagesForExistingOrders(int $limit = 50): int
    {
        if (!Schema::hasTable($this->tableName)) {
            return 0;
        }

        $this->ensureImagesTableExists();

        $orders = DB::table($this->tableName . ' as o')
            ->leftJoin($this->imagesTable . ' as i', 'i.job_order_id', '=', 'o.client_portal_id')
            ->whereNotNull('o.client_portal_id')
            ->whereNull('i.id')
            ->orderByDesc('o.id')
            ->limit($limit)
            ->get(['o.client_portal_id']);

        foreach ($orders as $order) {
            $focalJobId = trim((string) ($order->client_portal_id ?? ''));

            if ($focalJobId === '') {
                continue;
            }

            $this->storeJobAssets([
                'FocalJobId' => $focalJobId,
            ]);
        }

        Log::info('Focal RTV image backfill completed', [
            'checked' => $orders->count(),
            'limit' => $limit,
        ]);

        return $orders->count();
    }

    protected function mapJobToOrder(array $job, DateTime $now): array
    {
        $focalJobId = (string) $job['FocalJobId'];
        $receivedAt = $this->parseActionedDate($job['ActionedOnUtc'] ?? null, $now);
        $dueDate = (clone $receivedAt)->modify('+1 days');
        $property = is_array($job['Property'] ?? null) ? $job['Property'] : [];

        return [
            'order_number' => $focalJobId,
            'VARIANT_no' => isset($job['ExternalJobId']) ? (string) $job['ExternalJobId'] : null,
            'project_id' => $this->projectId,
            
            'client_portal_id' => $focalJobId,
            'clint_order_number' => $focalJobId,
            'client_reference' => $focalJobId,,
            'address' => $property['Address'] ?? null,
            'plan_type' => $job['Product'] ?? 'Photography',
            'order_type' => 'photo',
            'project_type' => $job['Product'] ?? 'Photography',
            'current_layer' => 'designer',
            'status' => 'pending',
            'workflow_state' => 'RECEIVED',
            'workflow_type' => 'PH_2_LAYER',
            'received_at' => $receivedAt->format('Y-m-d H:i:s'),
            'due_date' => $dueDate->format('Y-m-d'),
            'priority' => 'normal',
            'import_source' => 'api',
            'images' => isset($job['Quantity']) ? (string) $job['Quantity'] : null,
            'metadata' => json_encode([
                'focal_job_id' => $job['FocalJobId'] ?? null,
                'external_job_id' => $job['ExternalJobId'] ?? null,
                'product' => $job['Product'] ?? null,
                'quantity' => $job['Quantity'] ?? null,
                'actioned_on_utc' => $job['ActionedOnUtc'] ?? null,
                'additional_notes' => $job['AdditionalNotes'] ?? null,
                'raw_api_response' => $job,
            ]),
            'year' => (int) $now->format('Y'),
            'month' => (int) $now->format('m'),
            'date' => $now->format('d-m-Y'),
            'created_at' => $now->format('Y-m-d H:i:s'),
            'updated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    protected function parseActionedDate(?string $dateString, DateTime $fallback): DateTime
    {
        if (empty($dateString)) {
            return $fallback;
        }

        try {
            $formats = ['Y-m-d\TH:i:s\Z', 'Y-m-d\TH:i:s.u\Z', 'd/m/Y H:i:s', 'd/m/Y', 'Y-m-d H:i:s', 'Y-m-d'];

            foreach ($formats as $format) {
                $parsed = DateTime::createFromFormat($format, $dateString, new DateTimeZone('UTC'));
                if ($parsed) {
                    $parsed->setTimezone(new DateTimeZone($this->timezone));
                    return $parsed;
                }
            }

            $timestamp = strtotime(str_replace('/', '-', $dateString));
            if ($timestamp) {
                return (new DateTime('@' . $timestamp))->setTimezone(new DateTimeZone($this->timezone));
            }
        } catch (Exception $e) {
            Log::warning('Failed to parse Focal RTV ActionedOnUtc', [
                'date_string' => $dateString,
                'error' => $e->getMessage(),
            ]);
        }

        return $fallback;
    }

    protected function batchInsertOrUpdate(array $records): array
    {
        $inserted = 0;
        $updated = 0;
        $skipped = 0;

        if (!Schema::hasTable($this->tableName)) {
            throw new Exception("Missing table {$this->tableName}");
        }

        $existingColumns = Schema::getColumnListing($this->tableName);
        $columnMeta = $this->getTableColumnMeta();

        foreach ($records as $record) {
            $record = array_filter($record, fn($key) => in_array($key, $existingColumns, true), ARRAY_FILTER_USE_KEY);
            $record = $this->applyStrictSafeDefaults($record, $columnMeta);

            if (empty($record['client_portal_id'])) {
                $skipped++;
                continue;
            }

            try {
                $existing = DB::table($this->tableName)
                    ->where('client_portal_id', $record['client_portal_id'])
                    ->first();

                if ($existing) {
                    $updateData = [];
                    foreach (['clint_order_number', 'client_reference', 'address', 'images', 'metadata', 'updated_at'] as $field) {
                        if (array_key_exists($field, $record)) {
                            $updateData[$field] = $record[$field];
                        }
                    }

                    if (empty($updateData)) {
                        $skipped++;
                        continue;
                    }

                    DB::table($this->tableName)
                        ->where('id', $existing->id)
                        ->update($updateData);
                    $updated++;
                    continue;
                }

                DB::table($this->tableName)->insert($record);
                $inserted++;
            } catch (Exception $e) {
                Log::error('Error inserting/updating Focal RTV order', [
                    'client_portal_id' => $record['client_portal_id'] ?? 'unknown',
                    'error' => $e->getMessage(),
                ]);
                $skipped++;
            }
        }

        return [$inserted, $updated, $skipped];
    }

    protected function getTableColumnMeta(): array
    {
        $rows = DB::select("SHOW COLUMNS FROM {$this->tableName}");
        $meta = [];

        foreach ($rows as $row) {
            $meta[$row->Field] = [
                'type' => strtolower((string) ($row->Type ?? '')),
                'nullable' => strtoupper((string) ($row->Null ?? 'YES')) === 'YES',
                'default' => $row->Default,
            ];
        }

        return $meta;
    }

    protected function applyStrictSafeDefaults(array $record, array $columnMeta): array
    {
        $now = new DateTime('now', new DateTimeZone($this->timezone));

        foreach ($record as $column => $value) {
            if (!isset($columnMeta[$column]) || ($value !== null && $value !== '')) {
                continue;
            }

            $meta = $columnMeta[$column];
            if ($meta['nullable']) {
                continue;
            }

            if ($meta['default'] !== null) {
                $record[$column] = $meta['default'];
                continue;
            }

            $type = $meta['type'];
            if (str_contains($type, 'int') || str_contains($type, 'decimal') || str_contains($type, 'float') || str_contains($type, 'double')) {
                $record[$column] = 0;
            } elseif (str_contains($type, 'date') && !str_contains($type, 'time')) {
                $record[$column] = $now->format('Y-m-d');
            } elseif (str_contains($type, 'datetime') || str_contains($type, 'timestamp') || str_contains($type, 'time')) {
                $record[$column] = $now->format('Y-m-d H:i:s');
            } elseif (str_starts_with($type, 'enum(') && preg_match("/enum\\((.+)\\)/", $type, $m)) {
                $record[$column] = trim(explode(',', $m[1])[0] ?? '', "'\"");
            } else {
                $record[$column] = '';
            }
        }

        return $record;
    }

    protected function emptyResult(string $message): array
    {
        return [
            'success' => false,
            'message' => $message,
            'inserted' => 0,
            'updated' => 0,
            'skipped' => 0,
        ];
    }
}
