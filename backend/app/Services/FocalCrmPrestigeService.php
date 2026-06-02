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
 * FocalCRM Prestige Service - Fetch and import Prestige Photography jobs
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
                return [
                    'success' => false,
                    'message' => 'No Prestige Photography jobs found',
                    'inserted' => 0,
                    'updated' => 0,
                    'skipped' => 0,
                ];
            }

            $result = $this->importJobs($filteredJobs);
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
                $this->saveJobImages($job);
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

        return [
            'order_number' => 'PRESTIGE-' . $clientPortalId,
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
            'due_date' => $dueDate->format('Y-m-d'),
            'priority' => 'normal',
            'import_source' => 'api',
            'images' => (int) ($job['Quantity'] ?? 0),
            'metadata' => json_encode([
                'focalcrm_id' => $job['Id'] ?? null,
                'product' => $job['Product'] ?? null,
                'quantity' => $job['Quantity'] ?? null,
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
                    foreach (['clint_order_number', 'client_reference', 'images', 'metadata', 'updated_at'] as $field) {
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
                Log::error('Failed to save prestige job image', [
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
}
