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
 * FocalCRM Service - Fetch and import PropertyVision jobs from FocalCRM API
 * 
 * Project: 1 (PropertyVision FloorPlan)
 * API Endpoint: https://api.focalagent.com/supplier-enhancement/v3/jobs
 * Product Filter: ProductOption = "Propertyvision"
 */
class FocalCrmService
{
    protected string $apiUrl = 'https://api.focalagent.com/supplier-enhancement/v3/jobs';
    protected string $supplierSecret = 'N4ctEg%$SXGg6SF4wu';
    protected string $subscriptionKey = 'daee797833ca4dbd87fc98b1421c57b1';
    protected int $projectId = 1;
    protected string $tableName = 'project_1_orders';
    protected string $productFilter = 'Propertyvision';
    protected string $timezone = 'Europe/London';
    protected string $imagesTable = 'job_detail_1_images';

    /**
     * Fetch jobs from FocalCRM API and import PropertyVision jobs
     */
    public function import(?array $jobs = null): array
    {
        try {
            Log::info('FocalCRM import started for Project 1');

            // Ensure image table exists before any image operations.
            $this->ensureImagesTableExists();

            // Fetch from API
            $jobs = $jobs ?? $this->fetchJobsFromApi();
            
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

            // Filter PropertyVision products
            $filteredJobs = $this->filterPropertyVisionJobs($jobs);
            
            if (empty($filteredJobs)) {
                Log::info('No PropertyVision jobs found in API response');

                // Still run DB image checks on every import run.
                $todayChecked = $this->backfillTodayRecentOrdersImages(20);
                $recentChecked = $this->backfillMissingImagesForRecentOrders();

                return [
                    'success' => false,
                    'message' => 'No PropertyVision jobs found',
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                    'today_image_backfill_checked' => $todayChecked,
                    'image_backfill_checked' => $recentChecked,
                ];
            }

            // Import filtered jobs
            $result = $this->importJobs($filteredJobs);

            // Backfill image links for recent orders already in DB.
            // This stays fetch-only (no accept callback) and helps when assets
            // are published after initial order import.
            $result['today_image_backfill_checked'] = $this->backfillTodayRecentOrdersImages(20);
            $result['image_backfill_checked'] = $this->backfillMissingImagesForRecentOrders();
            
            Log::info('FocalCRM import completed', $result);
            return $result;

        } catch (Exception $e) {
            Log::error('FocalCRM import error: ' . $e->getMessage(), [
                'exception' => $e
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
     * Create the images table if missing.
     * Safe to call repeatedly.
     */
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

        Log::info('Auto-created images table for FocalCRM', [
            'table' => $this->imagesTable,
        ]);
    }

    /**
     * Fetch raw API response for debugging
     */
    public function fetchRaw(): array
    {
        try {
            $response = Http::timeout(60)
                ->withHeaders([
                    'Accept' => '*/*',
                    'Supplier-Secret' => $this->supplierSecret,
                    'Ocp-Apim-Subscription-Key' => $this->subscriptionKey,
                ])
                ->get($this->apiUrl);

            return $response->json() ?? ['error' => 'Empty response', 'status' => $response->status()];
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
            $response = Http::timeout(60)
                ->withHeaders([
                    'Accept' => '*/*',
                    'Supplier-Secret' => $this->supplierSecret,
                    'Ocp-Apim-Subscription-Key' => $this->subscriptionKey,
                ])
                ->get($this->apiUrl);

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
                    'response' => $data
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
     * Filter jobs for PropertyVision product
     */
    protected function filterPropertyVisionJobs(array $jobs): array
    {
        return array_filter($jobs, function ($job) {
            $productOption = strtolower(trim((string) ($job['ProductOption'] ?? '')));

            return $productOption === strtolower($this->productFilter);
        });
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
                // Validate required fields
                if (!isset($job['Id']) || empty($job['Id'])) {
                    $skipped++;
                    continue;
                }

                $clientPortalId = (string) $job['Id'];

                // Check for duplicates in batch
                if (isset($clientPortalIds[$clientPortalId])) {
                    $skipped++;
                    continue;
                }
                $clientPortalIds[$clientPortalId] = true;

                // Parse and map data
                $orderData = $this->mapJobToOrder($job, $now);
                $records[] = $orderData;

            } catch (Exception $e) {
                Log::error('Error processing job', [
                    'job_id' => $job['Id'] ?? 'unknown',
                    'error' => $e->getMessage()
                ]);
                $skipped++;
            }
        }

        // Batch insert/update
        if (!empty($records)) {
            [$inserted, $updated, $rowSkipped] = $this->batchInsertOrUpdate($records);
            $skipped += $rowSkipped;
        }

        foreach ($jobs as $job) {
            try {
                if (!empty($job['Id'])) {
                    $this->storeJobAssets($job);
                }
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
        
        // Parse DateAssigned
        $receivedAt = $this->parseDateAssigned($job['DateAssigned'] ?? null, $now);
        $dueDate = (clone $receivedAt)->modify('+3 days');
        $dueIn = (clone $receivedAt)->modify('+6 hours');

        return [
            'order_number' => $orderNumber,
            'project_id' => $this->projectId,
            'client_portal_id' => $clientPortalId,
            'client_reference' => $job['OrderReference'] ?? null,
            'client_name' => $job['CustomerName'] ?? null,
            'address' => $job['Property']['Address'] ?? null,
            'code' => $job['Property']['Reference'] ?? null,
            'plan_type' => $job['Product'] ?? 'PropertyVision',
            'order_type' => 'propertyvision',
            'project_type' => 'floorplan',
            'current_layer' => 'drawer',
            'status' => 'pending',
            'workflow_state' => 'RECEIVED',
            'workflow_type' => 'FP_3_LAYER',
            'received_at' => $receivedAt->format('Y-m-d H:i:s'),
            'due_in' => $dueIn->format('Y-m-d H:i:s'),
            'due_date' => $dueDate->format('Y-m-d'),
            'priority' => 'normal',
            'import_source' => 'api',
            
            // NEW COLUMNS for FocalCRM
            'quantity' => $job['Quantity'] ?? null,
            'check_assets' => $this->normalizeCheckAssets($job['CheckAssets'] ?? null),
            'parent_company' => $job['CustomerParentCompany'] ?? null,
            
            // Metadata - store full job data + nested property
            'metadata' => json_encode([
                'focalcrm_id' => $job['Id'],
                'customer_parent_company' => $job['CustomerParentCompany'] ?? null,
                'check_assets' => $job['CheckAssets'] ?? null,
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
     * Parse DateAssigned field from API (format: d/m/Y or similar)
     */
    protected function parseDateAssigned(?string $dateString, DateTime $fallback): DateTime
    {
        if (empty($dateString)) {
            return $fallback;
        }

        try {
            // Parse the portal timestamp without converting it to the server timezone.
            // This ensures the wall-clock hour/minute values are stored unchanged.
            $formats = ['d/m/Y H:i:s', 'd/m/Y', 'Y-m-d H:i:s', 'Y-m-d'];
            $portalTz = new DateTimeZone('UTC');

            foreach ($formats as $format) {
                $parsed = DateTime::createFromFormat($format, $dateString, $portalTz);
                if ($parsed instanceof DateTime) {
                    return $parsed;
                }
            }

            $normalized = str_replace('/', '-', $dateString);
            try {
                return new DateTime($normalized, $portalTz);
            } catch (Exception $e) {
                return $fallback;
            }

        } catch (Exception $e) {
            Log::warning('Failed to parse DateAssigned', [
                'date_string' => $dateString,
                'error' => $e->getMessage()
            ]);
            return $fallback;
        }
    }

    /**
     * Generate unique order number from FocalCRM ID
     */
    protected function generateOrderNumber(string $clientPortalId): string
    {
        return  $clientPortalId;
    }

    /**
     * Normalize API check-assets values for DB compatibility.
     * Supports: Yes/No, true/false, 1/0, and null.
     */
    protected function normalizeCheckAssets($value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        
        if (is_bool($value)) {
            return $value ? 1 : 0;
        }

        if (is_numeric($value)) {
            return (int) $value;
        }

        $normalized = strtolower(trim((string) $value));

        if (in_array($normalized, ['yes', 'true', 'y'], true)) {
            return 1;
        }

        if (in_array($normalized, ['no', 'false', 'n'], true)) {
            return 0;
        }

        return null;
    }

    /**
     * Batch insert or update orders
     */
    protected function batchInsertOrUpdate(array $records): array
    {
        $inserted = 0;
        $updated = 0;
        $skipped = 0;

        // Only keep columns that actually exist in the table
        $existingColumns = Schema::getColumnListing($this->tableName);
        $columnMeta = $this->getTableColumnMeta();

        foreach ($records as $record) {
            // Strip any keys not present in the table to avoid column-not-found errors
            $record = array_filter($record, fn($key) => in_array($key, $existingColumns), ARRAY_FILTER_USE_KEY);
            $record = $this->applyStrictSafeDefaults($record, $columnMeta);

            if (empty($record['client_portal_id'])) {
                $skipped++;
                Log::warning('Skipping row: missing client_portal_id after normalization');
                continue;
            }

            try {
                // Check if order already exists by client_portal_id
                $existing = DB::table($this->tableName)
                    ->where('client_portal_id', $record['client_portal_id'])
                    ->first();

                if ($existing) {
                    // Update existing order (but preserve workflow state if already in progress)
                    $updateData = [];
                    foreach (['client_reference', 'quantity', 'check_assets', 'parent_company', 'metadata', 'updated_at'] as $field) {
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
                    // Insert new order
                    DB::table($this->tableName)->insert($record);
                    $inserted++;
                }

            } catch (Exception $e) {
                Log::error('Error inserting/updating order', [
                    'client_portal_id' => $record['client_portal_id'] ?? 'unknown',
                    'error' => $e->getMessage(),
                    'sql' => method_exists($e, 'getSql') ? $e->getSql() : null,
                ]);
                $skipped++;
                continue;
            }
        }

        return [$inserted, $updated, $skipped];
    }

    /**
     * Get table metadata from SHOW COLUMNS for strict-mode compatibility.
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
     * Fill null/invalid values safely for strict SQL modes.
     */
    protected function applyStrictSafeDefaults(array $record, array $columnMeta): array
    {
        $now = new DateTime('now', new DateTimeZone($this->timezone));

        // Ensure check_assets is always int/null after normalization.
        if (array_key_exists('check_assets', $record)) {
            $record['check_assets'] = $this->normalizeCheckAssets($record['check_assets']);
        }

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
     * Store job image metadata from the job payload or assetdetail endpoint.
     * Accept is triggered only after the order exists locally in DB.
     * This avoids pre-accepting jobs before they are persisted, which can
     * prevent later import of the same order if the portal removes accepted jobs.
     */
    protected function storeJobAssets(array $job): void
    {
        $jobOrderId = (string) ($job['Id'] ?? '');
        if ($jobOrderId === '') {
            return;
        }

        $this->ensureImagesTableExists();

        if (!$this->orderExists($jobOrderId)) {
            Log::warning('Skipping image fetch because order is not stored locally yet', [
                'job_order_id' => $jobOrderId,
            ]);
            return;
        }

        // First try to extract from payload
        $images = $this->extractImagesFromJob($job);
        Log::info('FocalCRM payload image extraction', [
            'job_order_id' => $jobOrderId,
            'images_found' => count($images),
            'check_assets' => $job['CheckAssets'] ?? null,
        ]);

        // Accept only after the order is stored locally, then fetch asset detail
        $this->acceptJob($jobOrderId);
        $assetDetail = $this->fetchAssetDetail($jobOrderId);
        $assetImages = $this->extractImagesFromAssetDetail($assetDetail);
        if (!empty($assetImages)) {
            $images = array_merge($images, $assetImages);
        }

        Log::info('FocalCRM assetdetail image extraction', [
            'job_order_id' => $jobOrderId,
            'images_found' => count($assetImages),
        ]);

        if (empty($images)) {
            Log::debug('No image URLs found for order', [
                'job_order_id' => $jobOrderId,
                'check_assets' => $job['CheckAssets'] ?? null,
                'product_option' => $job['ProductOption'] ?? null,
                'product' => $job['Product'] ?? null,
            ]);
            return;
        }

        $images = $this->dedupeImages($images);

        $deleted = DB::table($this->imagesTable)->where('job_order_id', $jobOrderId)->delete();

        $inserted = 0;
        foreach ($images as $image) {
            try {
                DB::table($this->imagesTable)->insert([
                    'images_url' => $image['url'] ?? null,
                    'file_name' => $image['file_name'] ?? null,
                    'job_order_id' => $jobOrderId,
                ]);
                $inserted++;
            } catch (Exception $e) {
                Log::error('Failed to insert image row', [
                    'job_order_id' => $jobOrderId,
                    'url' => $image['url'] ?? null,
                    'file_name' => $image['file_name'] ?? null,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        Log::info('FocalCRM image store completed', [
            'job_order_id' => $jobOrderId,
            'deleted_old_rows' => $deleted,
            'attempted_inserts' => count($images),
            'inserted_rows' => $inserted,
        ]);
    }

    protected function orderExists(string $jobOrderId): bool
    {
        return DB::table($this->tableName)
            ->where('client_portal_id', $jobOrderId)
            ->exists();
    }

    protected function acceptJob(string $jobOrderId): bool
    {
        if (!$this->orderExists($jobOrderId)) {
            Log::warning('Skipping accept because order does not exist locally', [
                'job_order_id' => $jobOrderId,
            ]);
            return false;
        }

        try {
            $endpoints = [
                str_replace('/v3/', '/v2/', rtrim($this->apiUrl, '/')) . '/' . $jobOrderId . '/accept',
                rtrim($this->apiUrl, '/') . '/' . $jobOrderId . '/accept',
            ];

            foreach ($endpoints as $acceptUrl) {
                $response = Http::timeout(60)
                    ->withHeaders([
                        'Accept' => '*/*',
                        'Supplier-Secret' => $this->supplierSecret,
                        'Ocp-Apim-Subscription-Key' => $this->subscriptionKey,
                    ])
                    ->post($acceptUrl, [
                        'supplierReference' => 'BM-' . uniqid('', true),
                    ]);

                if ($response->successful()) {
                    Log::info('FocalCRM job accepted successfully', [
                        'job_order_id' => $jobOrderId,
                        'url' => $acceptUrl,
                        'status' => $response->status(),
                        'response' => $response->json(),
                    ]);
                    return true;
                }

                if (in_array($response->status(), [409, 422, 400], true)) {
                    Log::debug('FocalCRM accept request did not succeed but may already be accepted or invalid', [
                        'job_order_id' => $jobOrderId,
                        'url' => $acceptUrl,
                        'status' => $response->status(),
                        'body' => $response->body(),
                    ]);
                    return false;
                }

                Log::debug('FocalCRM accept endpoint response', [
                    'job_order_id' => $jobOrderId,
                    'url' => $acceptUrl,
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);
            }

            Log::warning('FocalCRM accept endpoint not available for job', [
                'job_order_id' => $jobOrderId,
            ]);
            return false;
        } catch (Exception $e) {
            Log::warning('FocalCRM accept request failed', [
                'job_order_id' => $jobOrderId,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Fetch asset detail from FocalCRM for a specific job.
     * This is a read-only operation, does not alter client portal state.
     */
    protected function fetchAssetDetail(string $jobOrderId): array
    {
        try {
            // Try multiple endpoint versions (v3 → v2 fallback)
            $endpoints = [
                rtrim($this->apiUrl, '/') . '/' . $jobOrderId . '/assetdetail',
                str_replace('/v3/', '/v2/', rtrim($this->apiUrl, '/')) . '/' . $jobOrderId . '/assetdetail',
            ];

            foreach ($endpoints as $assetDetailUrl) {
                $response = Http::timeout(60)
                    ->withHeaders([
                        'Accept' => '*/*',
                        'Supplier-Secret' => $this->supplierSecret,
                        'Ocp-Apim-Subscription-Key' => $this->subscriptionKey,
                    ])
                    ->get($assetDetailUrl);
                
                if ($response->successful()) {
                    return $response->json() ?? [];
                }

                Log::debug('Asset detail endpoint not found, trying fallback', [
                    'job_order_id' => $jobOrderId,
                    'status' => $response->status(),
                    'url' => $assetDetailUrl,
                ]);
            }

            // All endpoints failed
            Log::debug('Asset detail unavailable on all endpoints', [
                'job_order_id' => $jobOrderId,
            ]);
            return [];

        } catch (Exception $e) {
            Log::warning('Failed to fetch asset detail', [
                'job_order_id' => $jobOrderId,
                'error' => $e->getMessage(),
            ]);
            return [];
        }
    }

    /**
     * Extract images from assetdetail response.
     */
    protected function extractImagesFromAssetDetail(array $assetDetail): array
    {
        $images = [];

        // RawPhotoAssets
        if (!empty($assetDetail['RawPhotoAssets']) && is_array($assetDetail['RawPhotoAssets'])) {
            foreach ($assetDetail['RawPhotoAssets'] as $asset) {
                $url = $asset['Url'] ?? $asset['url'] ?? null;
                $name = $asset['FileName'] ?? $asset['file_name'] ?? basename($url ?? '');
                if ($url) {
                    $images[] = ['url' => $url, 'file_name' => $name];
                }
            }
        }

        // Assets
        if (!empty($assetDetail['Assets']) && is_array($assetDetail['Assets'])) {
            foreach ($assetDetail['Assets'] as $asset) {
                $url = $asset['Url'] ?? $asset['url'] ?? null;
                $name = $asset['FileName'] ?? $asset['file_name'] ?? basename($url ?? '');
                if ($url) {
                    $images[] = ['url' => $url, 'file_name' => $name];
                }
            }
        }

        // AdditionalLinks
        if (!empty($assetDetail['AdditionalLinks']) && is_array($assetDetail['AdditionalLinks'])) {
            foreach ($assetDetail['AdditionalLinks'] as $asset) {
                $url = $asset['Href'] ?? $asset['href'] ?? null;
                $name = $asset['Description'] ?? $asset['description'] ?? basename($url ?? '');
                if ($url) {
                    $images[] = ['url' => $url, 'file_name' => $name];
                }
            }
        }

        // Fallback: recursively scan any nested structure for URL-like fields.
        if (empty($images)) {
            $images = $this->extractImagesRecursively($assetDetail, 'asset');
        }

        return $images;
    }


    protected function extractImagesFromJob(array $job): array
    {
        $images = [];

        if (!empty($job['Assets']) && is_array($job['Assets'])) {
            foreach ($job['Assets'] as $asset) {
                $url = $asset['Url'] ?? $asset['url'] ?? null;
                $name = $asset['FileName'] ?? $asset['file_name'] ?? basename($url ?? '');
                if ($url) {
                    $images[] = ['url' => $url, 'file_name' => $name];
                }
            }
        }

        if (!empty($job['AdditionalLinks']) && is_array($job['AdditionalLinks'])) {
            foreach ($job['AdditionalLinks'] as $asset) {
                $url = $asset['Href'] ?? $asset['href'] ?? null;
                $name = $asset['Description'] ?? $asset['description'] ?? basename($url ?? '');
                if ($url) {
                    $images[] = ['url' => $url, 'file_name' => $name];
                }
            }
        }

        if (!empty($job['RawPhotoAssets']) && is_array($job['RawPhotoAssets'])) {
            foreach ($job['RawPhotoAssets'] as $asset) {
                $url = $asset['Url'] ?? $asset['url'] ?? null;
                $name = $asset['FileName'] ?? $asset['file_name'] ?? basename($url ?? '');
                if ($url) {
                    $images[] = ['url' => $url, 'file_name' => $name];
                }
            }
        }

        if (!empty($job['Images']) && is_array($job['Images'])) {
            foreach ($job['Images'] as $asset) {
                $url = $asset['Url'] ?? $asset['url'] ?? $asset['URL'] ?? null;
                $name = $asset['FileName'] ?? $asset['file_name'] ?? basename($url ?? '');
                if ($url) {
                    $images[] = ['url' => $url, 'file_name' => $name];
                }
            }
        }

        if (!empty($job['Photos']) && is_array($job['Photos'])) {
            foreach ($job['Photos'] as $asset) {
                $url = $asset['Url'] ?? $asset['url'] ?? $asset['URL'] ?? null;
                $name = $asset['FileName'] ?? $asset['file_name'] ?? basename($url ?? '');
                if ($url) {
                    $images[] = ['url' => $url, 'file_name' => $name];
                }
            }
        }

        if (!empty($job['DownloadUrls']) && is_array($job['DownloadUrls'])) {
            foreach ($job['DownloadUrls'] as $url) {
                if (is_string($url) && $url !== '') {
                    $images[] = ['url' => $url, 'file_name' => basename($url)];
                }
            }
        }

        if (!empty($job['DownloadUrl']) && is_string($job['DownloadUrl'])) {
            $images[] = ['url' => $job['DownloadUrl'], 'file_name' => basename($job['DownloadUrl'])];
        }

        // Fallback: recursively scan entire payload for URL-like fields.
        if (empty($images)) {
            $images = $this->extractImagesRecursively($job, 'payload');
        }

        return $images;
    }

    /**
     * Recursively extract URLs from any nested payload/asset structure.
     */
    protected function extractImagesRecursively($data, string $defaultNamePrefix = 'asset'): array
    {
        $images = [];

        if (!is_array($data)) {
            return $images;
        }

        foreach ($data as $key => $value) {
            if (is_array($value)) {
                $images = array_merge($images, $this->extractImagesRecursively($value, $defaultNamePrefix));
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
                    'file_name' => basename(parse_url($value, PHP_URL_PATH) ?: $value) ?: ($defaultNamePrefix . '-link'),
                ];
            }
        }

        return $images;
    }

    /**
     * Remove duplicate image URLs while preserving first-seen order.
     */
    protected function dedupeImages(array $images): array
    {
        $unique = [];
        $seen = [];

        foreach ($images as $image) {
            $url = trim((string) ($image['url'] ?? ''));
            if ($url === '') {
                continue;
            }

            if (isset($seen[$url])) {
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

    /**
     * Attempt image fetch for recent orders that still have no image rows.
     * Returns how many orders were checked.
     */
    protected function backfillMissingImagesForRecentOrders(int $limit = 200): int
    {
        $this->ensureImagesTableExists();

        $orders = $this->getRecentOrdersWithoutImages($limit, ['client_portal_id', 'check_assets']);

        foreach ($orders as $order) {
            $jobOrderId = (string) ($order->client_portal_id ?? '');
            if ($jobOrderId === '') {
                continue;
            }

            // Reuse the same fetch/store pipeline with minimal job shape.
            $this->storeJobAssets([
                'Id' => $jobOrderId,
                'CheckAssets' => $order->check_assets,
            ]);
        }

        return $orders->count();
    }

    /**
     * Find recent orders missing image rows without comparing differently
     * collated string columns in SQL.
     */
    protected function getRecentOrdersWithoutImages(int $limit, array $columns)
    {
        $limit = max(1, $limit);
        $pageSize = min(max($limit * 2, 50), 500);
        $offset = 0;
        $missing = collect();

        do {
            $orders = DB::table($this->tableName)
                ->whereNotNull('client_portal_id')
                ->orderByDesc('id')
                ->offset($offset)
                ->limit($pageSize)
                ->get($columns);

            if ($orders->isEmpty()) {
                break;
            }

            $portalIds = $orders
                ->pluck('client_portal_id')
                ->map(fn($id) => trim((string) $id))
                ->filter()
                ->unique()
                ->values();

            $existingImageIds = $portalIds->isEmpty()
                ? collect()
                : DB::table($this->imagesTable)
                    ->whereIn('job_order_id', $portalIds->all())
                    ->pluck('job_order_id')
                    ->map(fn($id) => trim((string) $id))
                    ->filter()
                    ->flip();

            foreach ($orders as $order) {
                $jobOrderId = trim((string) ($order->client_portal_id ?? ''));

                if ($jobOrderId === '' || $existingImageIds->has($jobOrderId)) {
                    continue;
                }

                $missing->push($order);

                if ($missing->count() >= $limit) {
                    break 2;
                }
            }

            $offset += $orders->count();
        } while ($orders->count() === $pageSize);

        return $missing;
    }

    /**
     * On every run, check latest DB jobs for today and refresh images if available.
     * Returns how many orders were checked.
     */
    protected function backfillTodayRecentOrdersImages(int $limit = 20): int
    {
        $this->ensureImagesTableExists();

        $today = (new DateTime('now', new DateTimeZone($this->timezone)))->format('Y-m-d');

        $query = DB::table($this->tableName . ' as o')
            ->whereNotNull('o.client_portal_id');

        if (Schema::hasColumn($this->tableName, 'created_at')) {
            $query->whereRaw('DATE(o.created_at) = ?', [$today]);
        }

        $orders = $query
            ->orderByDesc('o.id')
            ->limit($limit)
            ->get(['o.client_portal_id', 'o.check_assets']);

        foreach ($orders as $order) {
            $jobOrderId = (string) ($order->client_portal_id ?? '');
            if ($jobOrderId === '') {
                continue;
            }

            $this->storeJobAssets([
                'Id' => $jobOrderId,
                'CheckAssets' => $order->check_assets,
            ]);
        }

        Log::info('FocalCRM today image backfill completed', [
            'checked' => $orders->count(),
            'date' => $today,
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
     * Get all pending PropertyVision jobs
     */

    public function getPendingJobs()
    {
        return DB::table($this->tableName)
            ->where('status', 'pending')
            ->where('workflow_state', 'RECEIVED')
            ->orderBy('received_at', 'asc')
            ->get();
    }

    /**
     * Update job status
     */
    public function updateJobStatus(int $orderId, string $status, string $workflowState = null): bool
    {
        $data = ['status' => $status];
        
        if ($workflowState) {
            $data['workflow_state'] = $workflowState;
        }

        return DB::table($this->tableName)
            ->where('id', $orderId)
            ->update($data) > 0;
    }
}
