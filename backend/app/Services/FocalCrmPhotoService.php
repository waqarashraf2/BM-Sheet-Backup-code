<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use DateTime;
use DateTimeZone;
use Exception;

/**
 * FocalCRM Photo Service - Fetch and import Photography jobs from FocalCRM API
 *
 * Project: 22 (PB Photo Jobs)
 * API Endpoint: https://api.focalagent.com/supplier-enhancement/v3/jobs
 * Product Filter: Photography, Streetscape, Additional Photo, Photo Enhancement, Elevated Photography
 * Workflow Type: PH_2_LAYER
 */
class FocalCrmPhotoService
{
    protected string $apiUrl;
    protected string $supplierSecret;
    protected string $subscriptionKey;
    protected int $projectId = 22;
    protected string $tableName = 'project_22_orders';
    protected string $imagesTable = 'job_detail_22_images';
    protected string $timezone = 'Europe/London';

    protected array $photoProducts = [
        'photography',
        'streetscape',
        'additional photo',
        'photo enhancement',
        'elevated photography',
    ];

    public function __construct()
    {
        $this->apiUrl = $this->readEnv(
            'FOCAL_CRM_PHOTO_API_URL',
            $this->readEnv('FOCAL_CRM_API_URL', 'https://api.focalagent.com/supplier-enhancement/v3/jobs')
        );

        $this->supplierSecret = $this->readEnv(
            'FOCAL_CRM_PHOTO_SUPPLIER_SECRET',
            $this->readEnv('FOCAL_CRM_SUPPLIER_SECRET', 'N4ctEg%$SXGg6SF4wu')
        );

        $this->subscriptionKey = $this->readEnv(
            'FOCAL_CRM_PHOTO_SUBSCRIPTION_KEY',
            $this->readEnv('FOCAL_CRM_SUBSCRIPTION_KEY', 'daee797833ca4dbd87fc98b1421c57b1')
        );
    }

    protected function readEnv(string $key, string $default = ''): string
    {
        $value = getenv($key);

        if ($value === false || $value === null || $value === '') {
            $value = $_ENV[$key] ?? $_SERVER[$key] ?? null;
        }

        if ($value === null || $value === '') {
            return $default;
        }

        return (string) $value;
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

    /**
     * Fetch jobs from FocalCRM API and import Photo jobs
     */
    public function import(): array
    {
        try {
            Log::info('FocalCRM Photo import started for Project 22');

            $jobs = $this->fetchJobsFromApi();

            if (empty($jobs)) {
                Log::warning('No jobs returned from FocalCRM API');

                return [
                    'success' => false,
                    'message' => 'No jobs returned from API',
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                ];
            }

            $filteredJobs = $this->filterPhotoJobs($jobs);

            if (empty($filteredJobs)) {
                $diagnostic = $this->buildProductDiagnostic($jobs);
                Log::info('No Photo jobs found in API response', ['diagnostic' => $diagnostic]);
                $imageBackfillChecked = $this->backfillMissingImagesForRecentOrders(20);

                return [
                    'success' => false,
                    'message' => 'No Photo jobs found. Feed diagnostic: ' . $diagnostic,
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                    'image_backfill_checked' => $imageBackfillChecked,
                ];
            }

            $result = $this->importJobs($filteredJobs);
            $result['image_backfill_checked'] = $this->backfillMissingImagesForRecentOrders(20);

            Log::info('FocalCRM Photo import completed', $result);

            return $result;
        } catch (Exception $e) {
            Log::error('FocalCRM Photo import error: ' . $e->getMessage(), [
                'exception' => $e,
            ]);

            return [
                'success' => false,
                'message' => 'Import error: ' . $e->getMessage(),
                'inserted' => 0,
                'updated' => 0,
                'skipped' => 0,
            ];
        }
    }

    /**
     * Fetch raw API response for debugging
     */
    public function fetchRaw(): array
    {
        try {
            $response = $this->fetchFromFocalApi($this->apiUrl);

            return $response->json() ?? [
                'error' => 'Empty response',
                'status' => $response->status(),
            ];
        } catch (Exception $e) {
            return ['error' => $e->getMessage()];
        }
    }

    /**
     * Fetch jobs from FocalCRM API
     */
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
                Log::warning('Invalid API response: no jobs array', [
                    'response' => $data,
                ]);

                return [];
            }

            return $data['jobs'];
        } catch (Exception $e) {
            Log::error('FocalCRM API fetch error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Filter jobs for photo products
     */
    protected function filterPhotoJobs(array $jobs): array
    {
        return array_filter($jobs, function ($job) {
            $product = $this->normalizeJobField($job['Product'] ?? '');
            $productOption = $this->normalizeJobField($job['ProductOption'] ?? '');

            return in_array($product, $this->photoProducts, true)
                || in_array($productOption, $this->photoProducts, true);
        });
    }

    protected function normalizeJobField($value): string
    {
        return strtolower(trim((string) $value));
    }

    protected function buildProductDiagnostic(array $jobs): string
    {
        $productCounts = [];
        $optionCounts = [];

        foreach ($jobs as $job) {
            $product = trim((string) ($job['Product'] ?? 'NULL'));
            $option = trim((string) ($job['ProductOption'] ?? 'NULL'));

            $productCounts[$product] = ($productCounts[$product] ?? 0) + 1;
            $optionCounts[$option] = ($optionCounts[$option] ?? 0) + 1;
        }

        $productSummary = $this->formatTopCounts($productCounts);
        $optionSummary = $this->formatTopCounts($optionCounts);

        return "Product={$productSummary}; ProductOption={$optionSummary}";
    }

    protected function formatTopCounts(array $counts, int $limit = 5): string
    {
        if (empty($counts)) {
            return 'none';
        }

        arsort($counts);
        $slice = array_slice($counts, 0, $limit, true);
        $parts = [];

        foreach ($slice as $name => $count) {
            $parts[] = "{$name}:{$count}";
        }

        return implode(', ', $parts);
    }

    /**
     * Import filtered jobs into database
     */
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

                $orderData = $this->mapJobToOrder($job, $now);
                $records[] = $orderData;
            } catch (Exception $e) {
                Log::error('Error processing photo job', [
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
                Log::error('Error storing job assets', [
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

    /**
     * Map FocalCRM job data to order columns
     */
    protected function mapJobToOrder(array $job, DateTime $now): array
    {
        $clientPortalId = (string) $job['Id'];
        $orderNumber = $this->generateOrderNumber($clientPortalId);

        $receivedAt = $this->parseDateAssigned($job['DateAssigned'] ?? null, $now);
        $dueDate = (clone $receivedAt)->modify('+1 days');

        return [
            'order_number' => $orderNumber,
            'project_id' => $this->projectId,
            'client_portal_id' => $clientPortalId,
            'clint_order_number' => $clientPortalId,
            'client_reference' => $job['OrderReference'] ?? null,
            'client_name' => $job['CustomerName'] ?? null,
            'address' => $job['Property']['Address'] ?? null,
            'code' => $job['Property']['Reference'] ?? null,
            'plan_type' => $job['Product'] ?? 'Photography',
            'order_type' => 'photo',
            'project_type' => $job['Product'] ?? 'photography',
            'current_layer' => 'designer',
            'status' => 'pending',
            'workflow_state' => 'RECEIVED',
            'workflow_type' => 'PH_2_LAYER',
            'received_at' => $receivedAt->format('Y-m-d H:i:s'),
            'due_date' => $dueDate->format('Y-m-d'),
            'priority' => 'normal',
            'import_source' => 'api',
            'quantity' => $job['Quantity'] ?? null,
            'images' => (int) ($job['Quantity'] ?? 0),
            'parent_company' => $job['CustomerParentCompany'] ?? null,
            'metadata' => json_encode([
                'focalcrm_id' => $job['Id'],
                'customer_parent_company' => $job['CustomerParentCompany'] ?? null,
                'product' => $job['Product'] ?? null,
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

    /**
     * Parse DateAssigned field from API
     */
    protected function parseDateAssigned(?string $dateString, DateTime $fallback): DateTime
    {
        if (empty($dateString)) {
            return $fallback;
        }

        try {
            $formats = ['d/m/Y H:i:s', 'd/m/Y', 'Y-m-d H:i:s', 'Y-m-d'];

            foreach ($formats as $format) {
                $parsed = DateTime::createFromFormat($format, $dateString, new DateTimeZone($this->timezone));
                if ($parsed instanceof DateTime) {
                    return $parsed;
                }
            }

            $timestamp = strtotime(str_replace('/', '-', $dateString));
            if ($timestamp !== false) {
                $dt = new DateTime('@' . $timestamp);
                $dt->setTimezone(new DateTimeZone($this->timezone));
                return $dt;
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

    /**
     * Generate unique order number from FocalCRM ID
     */
    protected function generateOrderNumber(string $clientPortalId): string
    {
        return 'PHOTO-' . $clientPortalId;
    }

    /**
     * Batch insert or update orders
     */
    protected function batchInsertOrUpdate(array $records): array
    {
        $inserted = 0;
        $updated = 0;
        $skipped = 0;

        $existingColumns = Schema::getColumnListing($this->tableName);
        $columnMeta = $this->getTableColumnMeta();

        foreach ($records as $record) {
            $record = array_filter($record, fn ($key) => in_array($key, $existingColumns, true), ARRAY_FILTER_USE_KEY);
            $record = $this->applyStrictSafeDefaults($record, $columnMeta);

            if (empty($record['client_portal_id'])) {
                $skipped++;
                Log::warning('Skipping row: missing client_portal_id after normalization');
                continue;
            }

            try {
                $existing = DB::table($this->tableName)
                    ->where('client_portal_id', $record['client_portal_id'])
                    ->first();

                if ($existing) {
                    $updateData = [];
                    foreach (['client_reference', 'quantity', 'parent_company', 'metadata', 'updated_at'] as $field) {
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
                Log::error('Error inserting/updating photo order', [
                    'client_portal_id' => $record['client_portal_id'] ?? 'unknown',
                    'error' => $e->getMessage(),
                    'sql' => method_exists($e, 'getSql') ? $e->getSql() : null,
                ]);
                $skipped++;
            }
        }

        return [$inserted, $updated, $skipped];
    }

    /**
     * Get table metadata from SHOW COLUMNS
     */
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

    /**
     * Fill null/invalid values safely for strict SQL modes
     */
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

            if (
                str_contains($type, 'int') ||
                str_contains($type, 'decimal') ||
                str_contains($type, 'float') ||
                str_contains($type, 'double')
            ) {
                $record[$column] = 0;
            } elseif (str_contains($type, 'date') && !str_contains($type, 'time')) {
                $record[$column] = $now->format('Y-m-d');
            } elseif (
                str_contains($type, 'datetime') ||
                str_contains($type, 'timestamp') ||
                str_contains($type, 'time')
            ) {
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
     * Store job images and preferences from either the job payload or asset detail.
     *
     * This importer runs in fetch-only mode and uses GET-only calls.
     */
    protected function storeJobAssets(array $job): void
    {
        $jobOrderId = (string) ($job['Id'] ?? '');

        if ($jobOrderId === '') {
            return;
        }

        $this->ensureImagesTableExists();
        $images = $this->extractImagesFromJob($job);

        if (empty($images)) {
            $assetDetail = $this->fetchAssetDetail($jobOrderId);
            $images = $this->extractImagesFromAssetDetail($assetDetail);
        }

        if (empty($images)) {
            Log::info('No photo image URLs found for job', [
                'job_order_id' => $jobOrderId,
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
                Log::error('Failed to save job image', [
                    'job_order_id' => $jobOrderId,
                    'url' => $url,
                    'error' => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * Fetch asset detail with GET only. This does not accept or update portal jobs.
     */
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

                Log::debug('FocalCRM Photo asset detail endpoint unavailable', [
                    'job_order_id' => $jobOrderId,
                    'status' => $response->status(),
                    'url' => $url,
                ]);
            } catch (Exception $e) {
                Log::warning('FocalCRM Photo asset detail fetch failed', [
                    'job_order_id' => $jobOrderId,
                    'url' => $url,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return [];
    }

    protected function extractImagesFromAssetDetail(array $assetDetail): array
    {
        $images = [];

        foreach (['Images', 'Photos', 'RawPhotoAssets', 'Assets'] as $key) {
            if (empty($assetDetail[$key]) || !is_array($assetDetail[$key])) {
                continue;
            }

            foreach ($assetDetail[$key] as $asset) {
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

        if (!empty($assetDetail['AdditionalLinks']) && is_array($assetDetail['AdditionalLinks'])) {
            foreach ($assetDetail['AdditionalLinks'] as $asset) {
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

        if (empty($images)) {
            return $this->extractImagesRecursively($assetDetail);
        }

        return $images;
    }

    /**
     * Extract image records from main job payload
     */
    protected function extractImagesFromJob(array $job): array
    {
        if (!empty($job['Images']) && is_array($job['Images'])) {
            $result = [];
            foreach ($job['Images'] as $img) {
                $url = $img['Url'] ?? $img['url'] ?? $img['URL'] ?? null;
                $name = $img['FileName'] ?? $img['file_name'] ?? ($url ? basename($url) : null);

                if ($url) {
                    $result[] = [
                        'url' => $url,
                        'file_name' => $name,
                    ];
                }
            }
            return $result;
        }

        if (!empty($job['Photos']) && is_array($job['Photos'])) {
            $result = [];
            foreach ($job['Photos'] as $img) {
                $url = $img['Url'] ?? $img['url'] ?? $img['URL'] ?? null;
                $name = $img['FileName'] ?? $img['file_name'] ?? ($url ? basename($url) : null);

                if ($url) {
                    $result[] = [
                        'url' => $url,
                        'file_name' => $name,
                    ];
                }
            }
            return $result;
        }

        if (!empty($job['DownloadUrls']) && is_array($job['DownloadUrls'])) {
            $result = [];
            foreach ($job['DownloadUrls'] as $url) {
                if (is_string($url) && $url !== '') {
                    $result[] = [
                        'url' => $url,
                        'file_name' => basename($url),
                    ];
                }
            }
            return $result;
        }

        if (!empty($job['DownloadUrl']) && is_string($job['DownloadUrl'])) {
            return [[
                'url' => $job['DownloadUrl'],
                'file_name' => basename($job['DownloadUrl']),
            ]];
        }

        return [];
    }

    /**
     * Remove duplicate image URLs from the current payload without touching DB rows.
     */
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
     * Check latest existing orders and fetch images only when no image rows exist.
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

        Log::info('FocalCRM Photo image backfill completed', [
            'checked' => $orders->count(),
            'limit' => $limit,
        ]);

        return $orders->count();
    }

    /**
     * Get job by FocalCRM ID
     */
    public function getJobByFocalCrmId(string $focalcrmId)
    {
        return DB::table($this->tableName)
            ->where('client_portal_id', $focalcrmId)
            ->first();
    }

    /**
     * Get all pending Photo jobs
     */
    public function getPendingJobs()
    {
        return DB::table($this->tableName)
            ->where('workflow_state', 'RECEIVED')
            ->get();
    }
}
