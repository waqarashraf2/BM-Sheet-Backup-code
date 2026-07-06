<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use DateTime;
use DateTimeZone;
use Exception;

/**
 * FocalCRM Prestige Service - Fetch and import Prestige jobs
 *
 * Project: 25
 * Product filter: exact "Prestige Photography"
 */
class FocalCrmPrestigeService
{
    protected string $apiUrl = 'https://api.focalagent.com/supplier-enhancement/v3/jobs';
    protected string $supplierSecret = 'N4ctEg%$SXGg6SF4wu';
    protected string $subscriptionKey = 'daee797833ca4dbd87fc98b1421c57b1';
    protected int $projectId = 25;
    protected string $tableName = 'project_25_orders';
    protected string $imagesTable = 'job_detail_25_images';
    protected string $timezone = 'Europe/London';
    protected string $productName = 'prestige photography';

    public function import(): array
    {
        try {
            Log::info('FocalCRM Prestige import started for Project 25');

            $jobs = $this->fetchJobsFromApi();
            if (empty($jobs)) {
                return [
                    'success' => false,
                    'message' => 'No jobs returned from API',
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                ];
            }

            $filteredJobs = $this->filterPrestigeJobs($jobs);
            if (empty($filteredJobs)) {
                $imageBackfillChecked = $this->backfillMissingImagesForRecentOrders(20);

                return [
                    'success' => false,
                    'message' => 'No Prestige Photography jobs found',
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                    'image_backfill_checked' => $imageBackfillChecked,
                ];
            }

            $result = $this->importJobs($filteredJobs);
            $result['image_backfill_checked'] = $this->backfillMissingImagesForRecentOrders(20);
            Log::info('FocalCRM Prestige import completed', $result);
            return $result;
        } catch (Exception $e) {
            Log::error('FocalCRM Prestige import error: ' . $e->getMessage(), ['exception' => $e]);
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
            $response = $this->fetchFromFocalApi($this->apiUrl);

            return $response->json() ?? ['error' => 'Empty response', 'status' => $response->status()];
        } catch (Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }

    protected function fetchFromFocalApi(string $url)
    {
        return Http::timeout(60)
            ->withHeaders([
                'Accept' => '*/*',
                'Supplier-Secret' => $this->supplierSecret,
                'Ocp-Apim-Subscription-Key' => $this->subscriptionKey,
            ])
            ->get($url);
    }

    protected function ensureImagesTableExists(): void
    {
        if (Schema::hasTable($this->imagesTable)) {
            return;
        }

        Schema::create($this->imagesTable, function ($table) {
            $table->increments('id');
            $table->string('images_url', 500)->nullable();
            $table->string('file_name', 500)->nullable();
            $table->string('job_order_id', 500)->nullable()->index();
        });
    }

    protected function fetchJobsFromApi(): array
    {
        try {
            $response = $this->fetchFromFocalApi($this->apiUrl);

            if (!$response->successful()) {
                Log::error('FocalCRM API request failed', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);
                return [];
            }

            $data = $response->json();

            if (!isset($data['jobs']) || !is_array($data['jobs'])) {
                Log::warning('Invalid API response: no jobs array', ['response' => $data]);
                return [];
            }

            return $data['jobs'];
        } catch (Exception $e) {
            Log::error('FocalCRM API fetch error: ' . $e->getMessage());
            return [];
        }
    }

    protected function filterPrestigeJobs(array $jobs): array
    {
        return array_filter($jobs, function ($job) {
            $product = isset($job['Product']) ? strtolower(trim((string) $job['Product'])) : '';
            return $product === $this->productName;
        });
    }

    protected function importJobs(array $jobs): array
    {
        $inserted = 0;
        $updated = 0;
        $skipped = 0;
        $now = new DateTime('now', new DateTimeZone($this->timezone));

        $clientPortalIds = [];
        $records = [];

        foreach ($jobs as $job) {
            try {
                if (!isset($job['Id']) || empty($job['Id'])) {
                    $skipped++;
                    continue;
                }

                $clientPortalId = (string) $job['Id'];
                if (isset($clientPortalIds[$clientPortalId])) {
                    $skipped++;
                    continue;
                }

                $clientPortalIds[$clientPortalId] = true;
                $records[] = $this->mapJobToOrder($job, $now);
            } catch (Exception $e) {
                Log::error('Error processing prestige job', [
                    'job_id' => $job['Id'] ?? 'unknown',
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
                if (empty($job['Id'])) {
                    continue;
                }

                $this->storeJobAssets($job);
            } catch (Exception $e) {
                Log::error('Error storing prestige job assets', [
                    'job_id' => $job['Id'] ?? 'unknown',
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

    protected function mapJobToOrder(array $job, DateTime $now): array
    {
        $clientPortalId = (string) $job['Id'];
        $receivedAt = $this->parseDateAssigned($job['DateAssigned'] ?? null, $now);
        $dueDate = (clone $receivedAt)->modify('+1 days');
        $imageCount = max(0, (int) ($job['Quantity'] ?? 0));
        $dueInHours = $imageCount > 20 ? 6 : 3;
        $dueIn = (clone $receivedAt)->modify("+{$dueInHours} hours");

        return [
            'order_number' => $clientPortalId,
            'project_id' => $this->projectId,
            'client_portal_id' => $clientPortalId,
            'clint_order_number' => $clientPortalId,
            'client_reference' => $job['OrderReference'] ?? null,
            'client_name' => $job['CustomerName'] ?? null,
            'address' => $job['Property']['Address'] ?? null,
            'code' => $job['Property']['Reference'] ?? null,
            'plan_type' => $job['Product'] ?? 'Prestige Photography',
            'order_type' => 'photo',
            'project_type' => $job['Product'] ?? 'Prestige Photography',
            'current_layer' => 'designer',
            'status' => 'pending',
            'workflow_state' => 'RECEIVED',
            'workflow_type' => 'PH_2_LAYER',
            'received_at' => $receivedAt->format('Y-m-d H:i:s'),
            'due_in' => $dueIn->format('Y-m-d H:i:s'),
            'due_date' => $dueDate->format('Y-m-d'),
            'priority' => 'normal',
            'import_source' => 'api',
            'images' => $imageCount,
            'metadata' => json_encode([
                'focalcrm_id' => $job['Id'] ?? null,
                'product' => $job['Product'] ?? null,
                'quantity' => $job['Quantity'] ?? null,
                'due_in_hours' => $dueInHours,
                'property_reference' => $job['Property']['Reference'] ?? null,
                'property_address' => $job['Property']['Address'] ?? null,
                'raw_api_response' => $job,
            ]),
            'year' => (int) $now->format('Y'),
            'month' => (int) $now->format('m'),
            'date' => $now->format('d-m-Y'),
            'created_at' => $now->format('Y-m-d H:i:s'),
            'updated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    protected function parseDateAssigned(?string $dateString, DateTime $fallback): DateTime
    {
        if (empty($dateString)) {
            return $fallback;
        }

        try {
            $formats = ['Y-m-d\TH:i:s\Z', 'd/m/Y H:i:s', 'd/m/Y', 'Y-m-d H:i:s', 'Y-m-d'];

            foreach ($formats as $format) {
                $parsed = DateTime::createFromFormat($format, $dateString, new DateTimeZone($this->timezone));
                if ($parsed) {
                    return $parsed;
                }
            }

            $timestamp = strtotime(str_replace('/', '-', $dateString));
            if ($timestamp) {
                return new DateTime('@' . $timestamp, new DateTimeZone($this->timezone));
            }

            return $fallback;
        } catch (Exception $e) {
            Log::warning('Failed to parse DateAssigned', [
                'date_string' => $dateString,
                'error' => $e->getMessage(),
            ]);
            return $fallback;
        }
    }

    protected function batchInsertOrUpdate(array $records): array
    {
        $inserted = 0;
        $updated = 0;
        $skipped = 0;

        $existingColumns = Schema::getColumnListing($this->tableName);
        $columnMeta = $this->getTableColumnMeta();

        foreach ($records as $record) {
            $record = array_filter($record, fn($key) => in_array($key, $existingColumns), ARRAY_FILTER_USE_KEY);
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
                    foreach (['clint_order_number', 'client_reference', 'images', 'due_in', 'metadata', 'updated_at'] as $field) {
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
                } else {
                    DB::table($this->tableName)->insert($record);
                    $inserted++;
                }
            } catch (Exception $e) {
                Log::error('Error inserting/updating prestige order', [
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
            if (!isset($columnMeta[$column])) {
                continue;
            }

            $meta = $columnMeta[$column];

            if ($value !== null && $value !== '') {
                continue;
            }

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
            } elseif (str_starts_with($type, 'enum(')) {
                if (preg_match("/enum\\((.+)\\)/", $type, $m)) {
                    $first = explode(',', $m[1])[0] ?? "''";
                    $record[$column] = trim($first, "'\"");
                } else {
                    $record[$column] = '';
                }
            } else {
                $record[$column] = '';
            }
        }

        return $record;
    }

    /**
     * Store Prestige image links without deleting existing rows.
     *
     * Accept is triggered only after the order exists locally in DB. This avoids
     * accepting jobs before they are safely stored in the local order table.
     */
    protected function storeJobAssets(array $job): void
    {
        $jobOrderId = (string) ($job['Id'] ?? '');

        if ($jobOrderId === '') {
            return;
        }

        $this->ensureImagesTableExists();

        if (!$this->orderExists($jobOrderId)) {
            Log::warning('Skipping prestige accept/image fetch because order is not stored locally yet', [
                'job_order_id' => $jobOrderId,
            ]);
            return;
        }

        $images = $this->extractImagesFromJob($job);

        $accepted = $this->acceptJob($jobOrderId);
        $assetDetail = $this->fetchAssetDetail($jobOrderId);
        $assetImages = $this->extractImagesFromAssetDetail($assetDetail);

        if (!empty($assetImages)) {
            $images = array_merge($images, $assetImages);
        }

        if (empty($images)) {
            Log::info('No prestige image URLs found for job', [
                'job_order_id' => $jobOrderId,
                'accepted' => $accepted,
            ]);
            return;
        }

        $images = $this->dedupeImages($images);
        $existingUrls = DB::table($this->imagesTable)
            ->where('job_order_id', $jobOrderId)
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
                    'job_order_id' => $jobOrderId,
                ]);
                $existingUrls[$url] = true;
            } catch (Exception $e) {
                Log::error('Failed to save prestige job image', [
                    'job_order_id' => $jobOrderId,
                    'url' => $url,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * Confirm the order was inserted/updated locally before any portal accept.
     */
    protected function orderExists(string $jobOrderId): bool
    {
        return DB::table($this->tableName)
            ->where('client_portal_id', $jobOrderId)
            ->exists();
    }

    /**
     * Send the client portal accept request only after local DB receipt.
     */
    protected function acceptJob(string $jobOrderId): bool
    {
        if (!$this->orderExists($jobOrderId)) {
            Log::warning('Skipping prestige accept because order does not exist locally', [
                'job_order_id' => $jobOrderId,
            ]);
            return false;
        }

        $endpoints = [
            str_replace('/v3/', '/v2/', rtrim($this->apiUrl, '/')) . '/' . $jobOrderId . '/accept',
            rtrim($this->apiUrl, '/') . '/' . $jobOrderId . '/accept',
        ];

        foreach ($endpoints as $acceptUrl) {
            try {
                $response = Http::timeout(60)
                    ->withHeaders([
                        'Content-Type' => 'application/json',
                        'Accept' => '*/*',
                        'Supplier-Secret' => $this->supplierSecret,
                        'Ocp-Apim-Subscription-Key' => $this->subscriptionKey,
                    ])
                    ->post($acceptUrl, [
                        'supplierReference' => 'BM-' . mt_rand(),
                    ]);

                if ($response->successful()) {
                    Log::info('FocalCRM Prestige job accepted successfully', [
                        'job_order_id' => $jobOrderId,
                        'url' => $acceptUrl,
                        'status' => $response->status(),
                        'response' => $response->json(),
                    ]);
                    return true;
                }

                if (in_array($response->status(), [400, 409, 422], true)) {
                    Log::warning('FocalCRM Prestige accept did not succeed but may already be accepted or invalid', [
                        'job_order_id' => $jobOrderId,
                        'url' => $acceptUrl,
                        'status' => $response->status(),
                        'body' => $response->body(),
                    ]);
                    return false;
                }

                Log::debug('FocalCRM Prestige accept endpoint response', [
                    'job_order_id' => $jobOrderId,
                    'url' => $acceptUrl,
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);
            } catch (Exception $e) {
                Log::warning('FocalCRM Prestige accept request failed', [
                    'job_order_id' => $jobOrderId,
                    'url' => $acceptUrl,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        Log::warning('FocalCRM Prestige accept endpoint not available for job', [
            'job_order_id' => $jobOrderId,
        ]);
        return false;
    }

    protected function fetchAssetDetail(string $jobOrderId): array
    {
        $endpoints = [
            rtrim($this->apiUrl, '/') . '/' . $jobOrderId . '/assetdetail',
            str_replace('/v3/', '/v2/', rtrim($this->apiUrl, '/')) . '/' . $jobOrderId . '/assetdetail',
        ];

        foreach ($endpoints as $url) {
            try {
                $response = $this->fetchFromFocalApi($url);

                if ($response->successful()) {
                    return $response->json() ?? [];
                }

                Log::debug('FocalCRM Prestige asset detail endpoint unavailable', [
                    'job_order_id' => $jobOrderId,
                    'status' => $response->status(),
                    'url' => $url,
                ]);
            } catch (Exception $e) {
                Log::warning('FocalCRM Prestige asset detail fetch failed', [
                    'job_order_id' => $jobOrderId,
                    'url' => $url,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return [];
    }

    protected function extractImagesFromJob(array $job): array
    {
        $images = [];

        foreach (['Images', 'Photos', 'RawPhotoAssets', 'Assets'] as $key) {
            if (empty($job[$key]) || !is_array($job[$key])) {
                continue;
            }

            foreach ($job[$key] as $asset) {
                if (!is_array($asset)) {
                    continue;
                }

                $url = $asset['Url'] ?? $asset['url'] ?? $asset['URL'] ?? null;
                $name = $asset['FileName'] ?? $asset['file_name'] ?? ($url ? basename($url) : null);

                if ($url) {
                    $images[] = [
                        'url' => $url,
                        'file_name' => $name,
                    ];
                }
            }
        }

        if (!empty($job['AdditionalLinks']) && is_array($job['AdditionalLinks'])) {
            foreach ($job['AdditionalLinks'] as $asset) {
                if (!is_array($asset)) {
                    continue;
                }

                $url = $asset['Href'] ?? $asset['href'] ?? $asset['Url'] ?? $asset['url'] ?? null;
                $name = $asset['Description'] ?? $asset['description'] ?? ($url ? basename($url) : null);

                if ($url) {
                    $images[] = [
                        'url' => $url,
                        'file_name' => $name,
                    ];
                }
            }
        }

        if (!empty($job['DownloadUrls']) && is_array($job['DownloadUrls'])) {
            foreach ($job['DownloadUrls'] as $url) {
                if (is_string($url) && $url !== '') {
                    $images[] = [
                        'url' => $url,
                        'file_name' => basename($url),
                    ];
                }
            }
        }

        if (!empty($job['DownloadUrl']) && is_string($job['DownloadUrl'])) {
            $images[] = [
                'url' => $job['DownloadUrl'],
                'file_name' => basename($job['DownloadUrl']),
            ];
        }

        if (empty($images)) {
            return $this->extractImagesRecursively($job);
        }

        return $images;
    }

    protected function extractImagesFromAssetDetail(array $assetDetail): array
    {
        if (empty($assetDetail)) {
            return [];
        }

        return $this->extractImagesFromJob($assetDetail);
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

    /**
     * Check latest existing Prestige orders and fetch images only when no image rows exist.
     */
    protected function backfillMissingImagesForRecentOrders(int $limit = 20): int
    {
        $this->ensureImagesTableExists();

        $orders = DB::table($this->tableName . ' as o')
            ->leftJoin($this->imagesTable . ' as i', 'i.job_order_id', '=', 'o.client_portal_id')
            ->whereNotNull('o.client_portal_id')
            ->whereNull('i.id')
            ->orderByDesc('o.id')
            ->limit($limit)
            ->get(['o.client_portal_id']);

        foreach ($orders as $order) {
            $jobOrderId = (string) ($order->client_portal_id ?? '');

            if ($jobOrderId === '') {
                continue;
            }

            $this->storeJobAssets([
                'Id' => $jobOrderId,
            ]);
        }

        Log::info('FocalCRM Prestige image backfill completed', [
            'checked' => $orders->count(),
            'limit' => $limit,
        ]);

        return $orders->count();
    }
}

