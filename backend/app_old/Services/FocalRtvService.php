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
                return $this->emptyResult('No jobs returned from API');
            }

            $filteredJobs = $this->filterPhotographyJobs($jobs);
            if (empty($filteredJobs)) {
                return $this->emptyResult('No Photography jobs found');
            }

            $result = $this->importJobs($filteredJobs);
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
                $this->saveJobImages($job);
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

        return [
            'success' => true,
            'message' => 'Import completed',
            'inserted' => $inserted,
            'updated' => $updated,
            'skipped' => $skipped,
            'total_processed' => $inserted + $updated + $skipped,
        ];
    }

    protected function saveJobImages(array $job): void
    {
        // Use ExternalJobId as key because the frontend sends clint_order_number (= ExternalJobId) as the lookup value
        $jobOrderId = (string) ($job['ExternalJobId'] ?? '');

        if (empty($jobOrderId)) {
            return;
        }

        $images = $this->extractImagesFromJob($job);

        if (empty($images)) {
            return;
        }

        // Remove stale image rows before re-inserting
        DB::table($this->imagesTable)->where('job_order_id', $jobOrderId)->delete();

        foreach ($images as $image) {
            try {
                DB::table($this->imagesTable)->insert([
                    'images_url'   => $image['url']       ?? null,
                    'file_name'    => $image['file_name'] ?? null,
                    'job_order_id' => $jobOrderId,
                ]);
            } catch (Exception $e) {
                Log::error('Failed to save RTV job image', [
                    'job_order_id' => $jobOrderId,
                    'url'          => $image['url'] ?? '',
                    'error'        => $e->getMessage(),
                ]);
            }
        }
    }

    protected function extractImagesFromJob(array $job): array
    {
        // Pattern 1: Images => [ {Url, FileName}, ... ]
        if (!empty($job['Images']) && is_array($job['Images'])) {
            $result = [];
            foreach ($job['Images'] as $img) {
                $url  = $img['Url'] ?? $img['url'] ?? $img['URL'] ?? null;
                $name = $img['FileName'] ?? $img['file_name'] ?? ($url ? basename($url) : null);
                if ($url) {
                    $result[] = ['url' => $url, 'file_name' => $name];
                }
            }
            return $result;
        }

        // Pattern 2: Photos => [ {Url, FileName}, ... ]
        if (!empty($job['Photos']) && is_array($job['Photos'])) {
            $result = [];
            foreach ($job['Photos'] as $img) {
                $url  = $img['Url'] ?? $img['url'] ?? $img['URL'] ?? null;
                $name = $img['FileName'] ?? $img['file_name'] ?? ($url ? basename($url) : null);
                if ($url) {
                    $result[] = ['url' => $url, 'file_name' => $name];
                }
            }
            return $result;
        }

        // Pattern 3: DownloadUrls => ['https://...', ...]
        if (!empty($job['DownloadUrls']) && is_array($job['DownloadUrls'])) {
            $result = [];
            foreach ($job['DownloadUrls'] as $url) {
                if (is_string($url) && $url !== '') {
                    $result[] = ['url' => $url, 'file_name' => basename($url)];
                }
            }
            return $result;
        }

        // Pattern 4: DownloadUrl => 'https://...' (single string)
        if (!empty($job['DownloadUrl']) && is_string($job['DownloadUrl'])) {
            return [[
                'url'       => $job['DownloadUrl'],
                'file_name' => basename($job['DownloadUrl']),
            ]];
        }

        return [];
    }

    protected function mapJobToOrder(array $job, DateTime $now): array
    {
        $focalJobId = (string) $job['FocalJobId'];
        $receivedAt = $this->parseActionedDate($job['ActionedOnUtc'] ?? null, $now);
        $dueDate = (clone $receivedAt)->modify('+1 days');
        $property = is_array($job['Property'] ?? null) ? $job['Property'] : [];

        return [
            'order_number' => $focalJobId,
            'project_id' => $this->projectId,
            'client_portal_id' => $focalJobId,
            'clint_order_number' => isset($job['ExternalJobId']) ? (string) $job['ExternalJobId'] : null,
            'client_reference' => isset($job['ExternalJobId']) ? (string) $job['ExternalJobId'] : null,
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
