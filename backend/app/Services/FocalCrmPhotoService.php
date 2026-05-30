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
 * Product Filter: Photography, Streetscape, Additional Photo, Photo Enhancement, Elevated Photography, Drone Photography
 * Workflow Type: PH_2_LAYER
 */
class FocalCrmPhotoService
{
    protected string $apiUrl = 'https://api.focalagent.com/supplier-enhancement/v3/jobs';
    protected string $supplierSecret = 'N4ctEg%$SXGg6SF4wu';
    protected string $subscriptionKey = 'daee797833ca4dbd87fc98b1421c57b1';
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
        'drone photography',
    ];


    /**
     * Fetch jobs from FocalCRM API and import Photo jobs
     */
    public function import(): array
    {
        try {
            Log::info('FocalCRM Photo import started for Project 22');

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

            // Filter Photo products
            $filteredJobs = $this->filterPhotoJobs($jobs);
            
            if (empty($filteredJobs)) {
                Log::info('No Photo jobs found in API response');
                return [
                    'success' => false,
                    'message' => 'No Photo jobs found',
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                ];
            }

            // Import filtered jobs
            $result = $this->importJobs($filteredJobs);
            
            Log::info('FocalCRM Photo import completed', $result);
            return $result;

        } catch (Exception $e) {
            Log::error('FocalCRM Photo import error: ' . $e->getMessage(), [
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
     * Filter jobs for photo products (exact word matching only)
     */
    protected function filterPhotoJobs(array $jobs): array
    {
        return array_filter($jobs, function ($job) {
            $product = isset($job['Product']) ? strtolower(trim($job['Product'])) : '';
            
            // Only allow exact matches of the entire product name
            return in_array($product, $this->photoProducts, true);
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

                // Save images for this job into job_detail_22_images
                $this->saveJobImages($job);

            } catch (Exception $e) {
                Log::error('Error processing photo job', [
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
     * Map FocalCRM job data to order columns (Photo layer: PH_2_LAYER)
     */
    protected function mapJobToOrder(array $job, DateTime $now): array
    {
        $clientPortalId = (string) $job['Id'];
        $orderNumber = $this->generateOrderNumber($clientPortalId);
        
        // Parse DateAssigned
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
            
            // Photo job fields
            'quantity' => $job['Quantity'] ?? null,
            'images' => (int) ($job['Quantity'] ?? 0),
            'parent_company' => $job['CustomerParentCompany'] ?? null,
            
            // Metadata - store full job data + nested property
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
                    // Insert new order
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
     * Extract and save job images into job_detail_22_images.
     * Replaces existing image rows for the job on each run (re-import safe).
     */
    protected function saveJobImages(array $job): void
    {
        $jobOrderId = (string) ($job['Id'] ?? '');

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
                Log::error('Failed to save job image', [
                    'job_order_id' => $jobOrderId,
                    'url'          => $image['url'] ?? '',
                    'error'        => $e->getMessage(),
                ]);
            }
        }
    }

    /**
     * Extract image records from an API job payload.
     * Handles the four field patterns FocalCRM uses:
     *   Images[]  /  Photos[]  /  DownloadUrls[]  /  DownloadUrl (string)
     */
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

    /**
     * Accept a jobs payload from another project / service and import into this project's DB.
     * Runs the same filter + import pipeline as a normal API pull, but skips the HTTP fetch.
     *
     * Expected $jobs format: same structure as $data['jobs'] from the FocalCRM API.
     */
    public function importFromPayload(array $jobs): array
    {
        try {
            Log::info('FocalCRM Photo importFromPayload started for Project 22', [
                'job_count' => count($jobs),
            ]);

            if (empty($jobs)) {
                return [
                    'success' => false,
                    'message' => 'No jobs provided in payload',
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                ];
            }

            $filteredJobs = $this->filterPhotoJobs($jobs);

            if (empty($filteredJobs)) {
                return [
                    'success' => false,
                    'message' => 'No Photo jobs found in payload',
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                ];
            }

            $result = $this->importJobs($filteredJobs);

            Log::info('FocalCRM Photo importFromPayload completed', $result);
            return $result;

        } catch (Exception $e) {
            Log::error('FocalCRM Photo importFromPayload error: ' . $e->getMessage(), [
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
