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
    protected string $token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoienVsZnFhci5hbGlAYmVuY2htYXJrc3R1ZGlvLmJpeiIsImV4cCI6MTc4NTE0Njg4MH0.e_Qe2P741Nakkvhj8en-xXooE1G5vPrJrtU0FaiuUCc";
    protected int $timeout = 60;
    protected bool $verifySsl = false;
    protected string $origin = 'https://qaapp.focalagent.com';
    protected string $referer = 'https://qaapp.focalagent.com/';
    protected string $userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
    protected string $appId = 'ka';

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

            $fetchedStats = $this->summarizeFetchedJobs($jobs);
            $result = $this->storeJobs($jobs);

            Log::info('FocalAI import completed', [
                'project_id' => $this->projectId,
                'table' => $this->tableName,
                'fetched' => count($jobs),
                'approved_false_fetched' => $fetchedStats['approved_false'],
                'complete_false_fetched' => $fetchedStats['complete_false'],
                'complete_true_fetched' => $fetchedStats['complete_true'],
                'inserted' => $result['inserted'],
                'updated' => $result['updated'],
                'skipped' => $result['skipped'],
            ]);

            return [
                'success' => true,
                'message' => 'Orders fetched and stored successfully.',
                'fetched' => count($jobs),
                'approved_false_fetched' => $fetchedStats['approved_false'],
                'complete_false_fetched' => $fetchedStats['complete_false'],
                'complete_true_fetched' => $fetchedStats['complete_true'],
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
        $jobs = [];
        $seen = [];

        foreach ([false, true] as $complete) {
            $payload = $this->fetchJobsForCompletionState($token, $complete);

            if ($payload === null) {
                return null;
            }

            foreach ($payload as $job) {
                if (!is_array($job)) {
                    $jobs[] = $job;
                    continue;
                }

                $jobId = trim((string) ($job['job_id'] ?? ''));
                if ($jobId !== '' && isset($seen[$jobId])) {
                    continue;
                }

                if ($jobId !== '') {
                    $seen[$jobId] = true;
                }

                $job['_focal_ai_complete_bucket'] = $complete;
                $jobs[] = $job;
            }
        }

        return $jobs;
    }

    protected function summarizeFetchedJobs(array $jobs): array
    {
        $stats = [
            'approved_false' => 0,
            'complete_false' => 0,
            'complete_true' => 0,
        ];

        foreach ($jobs as $job) {
            if (!is_array($job)) {
                continue;
            }

            if (($job['approved'] ?? null) === false) {
                $stats['approved_false']++;
            }

            if (($job['_focal_ai_complete_bucket'] ?? null) === false) {
                $stats['complete_false']++;
            } elseif (($job['_focal_ai_complete_bucket'] ?? null) === true) {
                $stats['complete_true']++;
            }
        }

        return $stats;
    }

    protected function fetchJobsForCompletionState(string $token, bool $complete): ?array
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

        $response = $request->post($this->ordersUrl, [
            'app_id' => $this->appId,
            'complete' => $complete,
            'fesp_orders' => false,
        ]);

        if (!$response->successful()) {
            Log::error('FocalAI API request failed', [
                'status' => $response->status(),
                'complete' => $complete,
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

                $existing = $this->findExistingOrder($jobId, $propId);

                if ($existing) {
                    DB::table($this->tableName)
                        ->where('id', $existing->id)
                        ->update($this->filterColumns($this->updatePayload($record), $columns));
                    $updated++;
                    continue;
                }

                $record['order_number'] = $this->resolveUniqueOrderNumber($record['order_number'], $jobId);
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
        $dueInHours = $rawFilesCount > 20 ? 6 : 3;
        $dueIn = $receivedAt ? (clone $receivedAt)->modify("+{$dueInHours} hours") : null;

        return [
            'order_number' => $propId,
            'project_id' => $this->projectId,
            'client_reference' => $propId,
            'client_portal_id' => $jobId,
            'current_layer' => 'drawer',
            'status' => 'pending',
            'workflow_state' => 'RECEIVED',
            'workflow_type' => 'PH_2_LAYER',
            'priority' => 'normal',
            'complexity_weight' => 1,
            'order_type' => 'standard',
            'received_at' => $receivedAt?->format('Y-m-d H:i:s'),
            'due_in' => $dueIn?->format('Y-m-d H:i:s'),
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
            'due_in' => $record['due_in'] ?? null,
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

    protected function findExistingOrder(string $jobId, string $propId): ?object
    {
        $existingByJobId = DB::table($this->tableName)
            ->where('client_portal_id', $jobId)
            ->first();

        if ($existingByJobId) {
            return $existingByJobId;
        }

        $existingByOrderNumber = DB::table($this->tableName)
            ->where('order_number', $propId)
            ->first();

        if (!$existingByOrderNumber) {
            return null;
        }

        $existingPortalId = trim((string) ($existingByOrderNumber->client_portal_id ?? ''));

        return $existingPortalId === '' || $existingPortalId === $jobId
            ? $existingByOrderNumber
            : null;
    }

    protected function resolveUniqueOrderNumber(string $propId, string $jobId): string
    {
        if (!DB::table($this->tableName)->where('order_number', $propId)->exists()) {
            return $propId;
        }

        $maxLength = 191;
        $suffix = '-' . substr(preg_replace('/[^A-Za-z0-9]/', '', $jobId), 0, 8);
        $base = substr($propId, 0, $maxLength - strlen($suffix));
        $candidate = $base . $suffix;
        $counter = 1;

        while (DB::table($this->tableName)->where('order_number', $candidate)->exists()) {
            $counter++;
            $counterSuffix = $suffix . '-' . $counter;
            $candidate = substr($propId, 0, $maxLength - strlen($counterSuffix)) . $counterSuffix;
        }

        return $candidate;
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
