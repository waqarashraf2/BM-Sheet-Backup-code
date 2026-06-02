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
    public function import(): array
    {
        try {
            Log::info('FocalCRM import started for Project 1');

            // Fetch from API
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

            // Filter PropertyVision products
            $filteredJobs = $this->filterPropertyVisionJobs($jobs);
            
            if (empty($filteredJobs)) {
                Log::info('No PropertyVision jobs found in API response');
                return [
                    'success' => false,
                    'message' => 'No PropertyVision jobs found',
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                ];
            }

            // Import filtered jobs
            $result = $this->importJobs($filteredJobs);
            
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
            return isset($job['ProductOption']) && 
                   strtolower($job['ProductOption']) === strtolower($this->productFilter);
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
            // Try multiple formats
            $formats = ['d/m/Y H:i:s', 'd/m/Y', 'Y-m-d H:i:s', 'Y-m-d'];
            
            foreach ($formats as $format) {
                $parsed = DateTime::createFromFormat($format, $dateString, new DateTimeZone($this->timezone));
                if ($parsed) {
                    return $parsed;
                }
            }

            // Fallback to strtotime
            $timestamp = strtotime(str_replace('/', '-', $dateString));
            if ($timestamp) {
                $dt = new DateTime('@' . $timestamp, new DateTimeZone($this->timezone));
                return $dt;
            }

            return $fallback;

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
        return 'FCP-' . $clientPortalId;
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
     * Store job image metadata from the job payload only.
     * This importer does not make any follow-up requests to FocalCRM
     * that could alter upstream client portal state.
     */
    protected function storeJobAssets(array $job): void
    {
        $jobOrderId = (string) ($job['Id'] ?? '');
        if ($jobOrderId === '' || !Schema::hasTable($this->imagesTable)) {
            return;
        }

        $images = $this->extractImagesFromJob($job);

        DB::table($this->imagesTable)->where('job_order_id', $jobOrderId)->delete();

        foreach ($images as $image) {
            try {
                DB::table($this->imagesTable)->insert([
                    'images_url' => $image['url'] ?? null,
                    'file_name' => $image['file_name'] ?? null,
                    'job_order_id' => $jobOrderId,
                ]);
            } catch (Exception $e) {
                Log::error('Failed to save job image', [
                    'job_order_id' => $jobOrderId,
                    'url' => $image['url'] ?? null,
                    'error' => $e->getMessage(),
                ]);
            }
        }
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

        return $images;
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
