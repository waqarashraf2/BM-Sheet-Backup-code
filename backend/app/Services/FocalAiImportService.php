<?php

namespace App\Services;

use DateTime;
use DateTimeZone;
use Exception;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class FocalAiImportService
{
    protected string $ordersUrl = 'https://ai-services.focalagent.com/backend/job_ids';
    protected string $token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoienVsZnFhci5hbGlAYmVuY2htYXJrc3R1ZGlvLmJpeiIsImV4cCI6MTc4NDk4OTc3OH0.fpQqActHOGeqeeq4O3S4l5pXXAobPF01RyQSvBNmdPQ';
    protected int $timeout = 60;
    protected bool $verifySsl = false;
    protected string $origin = 'https://qaapp.focalagent.com';
    protected string $referer = 'https://qaapp.focalagent.com/';
    protected string $userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

    protected int $projectId;
    protected string $tableName;
    protected string $timezone;

    public function __construct()
    {
        $this->projectId = 52;
        $this->tableName = ProjectOrderService::getTableName($this->projectId);
        $this->timezone = (string) config('app.timezone', 'Asia/Karachi');
    }

    public function import(): array
    {
        if (!Schema::hasTable($this->tableName)) {
            return $this->failure("Orders table {$this->tableName} does not exist.");
        }

        $token = trim($this->token);
        if ($token === '') {
            return $this->failure('Missing FocalAI token in FocalAiImportService.');
        }

        try {
            $jobs = $this->fetchJobs($token);

            if ($jobs === null) {
                return $this->failure('FocalAI API response did not contain a job_ids array.');
            }

            $result = $this->storeJobs($jobs);

            Log::info('FocalAI import completed', [
                'project_id' => $this->projectId,
                'table' => $this->tableName,
                'fetched' => count($jobs),
                'inserted' => $result['inserted'],
                'updated' => $result['updated'],
                'skipped' => $result['skipped'],
            ]);

            return [
                'success' => true,
                'message' => 'Orders fetched and stored successfully.',
                'fetched' => count($jobs),
                'inserted' => $result['inserted'],
                'updated' => $result['updated'],
                'skipped' => $result['skipped'],
                'errors' => $result['errors'],
            ];
        } catch (Exception $e) {
            Log::error('FocalAI import failed', [
                'project_id' => $this->projectId,
                'error' => $e->getMessage(),
            ]);

            return $this->failure($e->getMessage());
        }
    }

    protected function fetchJobs(string $token): ?array
    {
        $request = Http::timeout($this->timeout)
            ->acceptJson()
            ->withHeaders([
                'Content-Type' => 'application/json',
                'Origin' => $this->origin,
                'Referer' => $this->referer,
                'User-Agent' => $this->userAgent,
            ])
            ->withToken($token);

        if (!$this->verifySsl) {
            $request = $request->withoutVerifying();
        }

        $response = $request->post($this->ordersUrl, []);

        if (!$response->successful()) {
            Log::error('FocalAI API request failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            throw new Exception('FocalAI API request failed with status ' . $response->status());
        }

        $payload = $response->json();

        return is_array($payload) && isset($payload['job_ids']) && is_array($payload['job_ids'])
            ? $payload['job_ids']
            : null;
    }

    protected function storeJobs(array $jobs): array
    {
        $inserted = 0;
        $updated = 0;
        $skipped = 0;
        $errors = [];
        $seen = [];
        $columns = Schema::getColumnListing($this->tableName);
        $columnMeta = $this->getTableColumnMeta();

        DB::beginTransaction();

        try {
            foreach ($jobs as $job) {
                if (!is_array($job)) {
                    $skipped++;
                    continue;
                }

                $propId = trim((string) ($job['prop_id'] ?? ''));
                $jobId = trim((string) ($job['job_id'] ?? ''));

                if ($propId === '' || $jobId === '') {
                    $skipped++;
                    $errors[] = [
                        'reason' => 'Missing prop_id or job_id',
                        'job' => $job,
                    ];
                    continue;
                }

                if (isset($seen[$jobId])) {
                    $skipped++;
                    continue;
                }
                $seen[$jobId] = true;

                $record = $this->filterColumns($this->mapJobToRecord($job, $propId, $jobId), $columns);
                $record = $this->applyStrictSafeDefaults($record, $columnMeta);

                $existing = DB::table($this->tableName)
                    ->where('client_portal_id', $jobId)
                    ->orWhere('order_number', $propId)
                    ->first();

                if ($existing) {
                    DB::table($this->tableName)
                        ->where('id', $existing->id)
                        ->update($this->filterColumns($this->updatePayload($record), $columns));
                    $updated++;
                    continue;
                }

                DB::table($this->tableName)->insert($record);
                $inserted++;
            }

            DB::commit();
        } catch (Exception $e) {
            DB::rollBack();
            throw $e;
        }

        return compact('inserted', 'updated', 'skipped', 'errors');
    }

    protected function mapJobToRecord(array $job, string $propId, string $jobId): array
    {
        $receivedAt = $this->parseTimestamp($job['timestamp'] ?? null);
        $now = new DateTime('now', new DateTimeZone($this->timezone));
        $rawFilesCount = (int) ($job['number_of_images'] ?? 0);

        return [
            'order_number' => $propId,
            'project_id' => $this->projectId,
            'client_reference' => $propId,
            'client_portal_id' => $jobId,
            'current_layer' => 'drawer',
            'status' => 'pending',
            'workflow_state' => 'RECEIVED',
            'workflow_type' => 'FP_3_LAYER',
            'priority' => 'normal',
            'complexity_weight' => 1,
            'order_type' => 'standard',
            'received_at' => $receivedAt?->format('Y-m-d H:i:s'),
            'total_raw_files' => (string) $rawFilesCount,
            'year' => $receivedAt ? (int) $receivedAt->format('Y') : null,
            'month' => $receivedAt ? (int) $receivedAt->format('m') : null,
            'date' => $receivedAt ? $receivedAt->format('Y-m-d') : null,
            'metadata' => $this->safeJsonEncode($job),
            'import_source' => 'api',
            'client_portal_synced_at' => $now->format('Y-m-d H:i:s'),
            'created_at' => $now->format('Y-m-d H:i:s'),
            'updated_at' => $now->format('Y-m-d H:i:s'),
        ];
    }

    protected function updatePayload(array $record): array
    {
        return [
            'client_reference' => $record['client_reference'] ?? null,
            'client_portal_id' => $record['client_portal_id'] ?? null,
            'received_at' => $record['received_at'] ?? null,
            'total_raw_files' => $record['total_raw_files'] ?? null,
            'year' => $record['year'] ?? null,
            'month' => $record['month'] ?? null,
            'date' => $record['date'] ?? null,
            'metadata' => $record['metadata'] ?? null,
            'import_source' => 'api',
            'client_portal_synced_at' => $record['client_portal_synced_at'] ?? null,
            'updated_at' => $record['updated_at'] ?? null,
        ];
    }

    protected function parseTimestamp(mixed $value): ?DateTime
    {
        if (!is_string($value) || trim($value) === '') {
            return null;
        }

        try {
            return new DateTime($value);
        } catch (Exception $e) {
            return null;
        }
    }

    protected function safeJsonEncode(array $value): string
    {
        try {
            return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        } catch (Exception $e) {
            return '{}';
        }
    }

    protected function filterColumns(array $record, array $columns): array
    {
        return array_filter($record, fn ($key) => in_array($key, $columns, true), ARRAY_FILTER_USE_KEY);
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
            } elseif (str_starts_with($type, 'enum(')) {
                $record[$column] = $this->firstEnumValue($type);
            } else {
                $record[$column] = '';
            }
        }

        return $record;
    }

    protected function firstEnumValue(string $type): string
    {
        if (!preg_match("/enum\\((.+)\\)/", $type, $matches)) {
            return '';
        }

        return trim(explode(',', $matches[1])[0] ?? "''", "'\"");
    }

    protected function failure(string $message): array
    {
        Log::warning('FocalAI import stopped', [
            'project_id' => $this->projectId,
            'message' => $message,
        ]);

        return [
            'success' => false,
            'message' => $message,
            'fetched' => 0,
            'inserted' => 0,
            'updated' => 0,
            'skipped' => 0,
            'errors' => [],
        ];
    }
}
