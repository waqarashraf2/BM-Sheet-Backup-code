<?php

namespace App\Services;

use DateTime;
use DateTimeZone;
use Exception;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

class SaVideoService
{
    protected string $apiUrl = 'https://diary-booking-assistant-4f2ee1a4.base44.app/api/functions/processorTasksJson?api_key=PzpZrmL5vmAnEpNpWx5LBQJMRHqodPyR&processor_id=11420';
    protected int $processorId = 11420;
    protected int $projectId = 57;
    protected string $table = 'project_57_orders';
    protected array $videoProductIds = [66, 67, 69];
    protected int $videoProductCategoryId = 11;

    protected function mapStatus(string $status): string
    {
        return match ($status) {
            'processing' => 'in-progress',
            'completed' => 'completed',
            default => 'pending',
        };
    }

    public function run(): void
    {
        try {
            if (!Schema::hasTable($this->table)) {
                Log::error('Project57 Video Import table missing', [
                    'table' => $this->table,
                    'project_id' => $this->projectId,
                ]);
                return;
            }

            $response = Http::timeout(60)->get($this->apiUrl);

            if (!$response->successful()) {
                Log::error('Project57 Video API failed', [
                    'status' => $response->status(),
                ]);
                return;
            }

            $data = $response->json();

            if (!isset($data['tasks']) || !is_array($data['tasks'])) {
                Log::warning('Project57 Video Import: No tasks found in API');
                return;
            }

            $records = [];
            $inserted = 0;
            $skipped = 0;
            $instructionMaxLength = $this->getInstructionMaxLength();

            $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));
            $queuedOrderNumbers = [];

            foreach ($data['tasks'] as $task) {
                if (!is_array($task) || !$this->isVideoProcessorTask($task)) {
                    continue;
                }

                if (empty($task['order_id']) || empty($task['id'])) {
                    continue;
                }

                $clientPortalId = (string) $task['id'];
                $orderNumber = (string) $task['id'];
                $clintOrderNumber = (string) $task['order_id'];

                // order_number (task id) is the unique key for this import.
                // client_portal_id/order_id may be duplicated across categories.
                if (isset($queuedOrderNumbers[$orderNumber])) {
                    $skipped++;
                    Log::info('Project57 Video Import Duplicate order_number in API payload skipped', [
                        'order_number' => $orderNumber,
                        'client_portal_id' => $clientPortalId,
                    ]);
                    continue;
                }

                $queuedOrderNumbers[$orderNumber] = true;

                $receivedAt = $this->resolveReceivedAt($task, $nowPK);
                $dueIn = (clone $receivedAt)->modify('+12 hours');
                $createdAt = $this->resolveCreatedAt($task, $nowPK);

                $clerkArea = $task['clerk_area'] ?? null;
                $instruction = $this->resolveInstruction($task);
                $safeInstruction = $this->normalizeInstructionForInsert($instruction, $instructionMaxLength);

                $records[] = [
                    'order_number' => $orderNumber,
                    'client_portal_id' => $clientPortalId,
                    'clint_order_number' => $clintOrderNumber,
                    'project_id' => $this->projectId,

                    'client_name' => $task['client'] ?? null,
                    'branch' => $task['branch'] ?? null,

                    'clerk_area' => $clerkArea,
                    'address' => $clerkArea,

                    'processor_id' => $task['processor_id'] ?? null,
                    'processor_name' => $task['processor_name'] ?? null,

                    'plan_type' => $task['name'] ?? null,
                    'instruction' => $safeInstruction,
                    'current_layer' => 'designer',
                    'workflow_type' => 'PH_2_LAYER',
                    'amend' => null,

                    'received_at' => $receivedAt->format('Y-m-d H:i:s'),
                    'due_in' => $dueIn->format('Y-m-d H:i:s'),
                    'started_at' => null,

                    'attachments' => json_encode([
                        'wms_url' => $task['wms_url'] ?? null,
                    ]),
                    'metadata' => json_encode($task),
                    'import_source' => 'cron',

                    'year' => $nowPK->format('Y'),
                    'month' => $nowPK->format('m'),
                    'date' => $nowPK->format('d-m-Y'),

                    'created_at' => $createdAt->format('Y-m-d H:i:s'),
                    'updated_at' => $nowPK->format('Y-m-d H:i:s'),
                ];
            }

            if (empty($records)) {
                Log::warning('Project57 Video Import: No valid records found');
                return;
            }

            foreach ($records as $record) {
                try {
                    if ($this->orderNumberExists($record['order_number'] ?? null)) {
                        $skipped++;
                        Log::info('Project57 Video Import Existing order_number skipped', [
                            'order_number' => $record['order_number'] ?? null,
                            'client_portal_id' => $record['client_portal_id'] ?? null,
                        ]);
                        continue;
                    }

                    DB::table($this->table)->insert([$this->filterRecordForTable($record)]);
                    $inserted++;
                } catch (Exception $rowException) {
                    if ($this->orderNumberExists($record['order_number'] ?? null)) {
                        $skipped++;
                        Log::info('Project57 Video Import Duplicate order_number skipped during insert', [
                            'order_number' => $record['order_number'] ?? null,
                            'client_portal_id' => $record['client_portal_id'] ?? null,
                        ]);
                        continue;
                    }

                    $skipped++;
                    Log::warning('Project57 Video Import Row Skipped', [
                        'order_number' => $record['order_number'] ?? null,
                        'client_portal_id' => $record['client_portal_id'] ?? null,
                        'message' => $rowException->getMessage(),
                    ]);
                }
            }

            Log::info('Project57 Video Import Completed', [
                'fetched' => count($records),
                'inserted' => $inserted,
                'skipped' => $skipped,
                'processor_id' => $this->processorId,
                'product_ids' => $this->videoProductIds,
                'instruction_max_length' => $instructionMaxLength,
            ]);
        } catch (Exception $e) {
            Log::error('Project57 Video Import Error: ' . $e->getMessage());
        }
    }

    private function getInstructionMaxLength(): ?int
    {
        $column = collect(DB::select("SHOW COLUMNS FROM {$this->table} LIKE 'instruction'"))->first();
        $type = strtolower((string) ($column->Type ?? ''));

        if (preg_match('/varchar\((\d+)\)/', $type, $matches)) {
            return (int) $matches[1];
        }

        return null;
    }

    private function orderNumberExists(?string $orderNumber): bool
    {
        if ($orderNumber === null || $orderNumber === '') {
            return false;
        }

        return DB::table($this->table)
            ->where('order_number', $orderNumber)
            ->exists();
    }

    private function isVideoProcessorTask(array $task): bool
    {
        $processorMatches = isset($task['processor_id'])
            && (int) $task['processor_id'] === $this->processorId;

        if (!$processorMatches) {
            $processorName = trim((string) ($task['processor_name'] ?? ''));
            $processorMatches = strcasecmp($processorName, 'VIDEOS - Miyan Omer (Vids)') === 0;
        }

        if (!$processorMatches) {
            return false;
        }

        $categoryMatches = isset($task['product_category_id'])
            && (int) $task['product_category_id'] === $this->videoProductCategoryId;

        $productMatches = isset($task['product_id'])
            && in_array((int) $task['product_id'], $this->videoProductIds, true);

        return $categoryMatches && $productMatches;
    }

    private function resolveInstruction(array $task): ?string
    {
        foreach (['processor_notes', 'processing_notes', 'photo_processing_notes'] as $field) {
            if (!isset($task[$field])) {
                continue;
            }

            $value = trim((string) $task[$field]);
            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    private function resolveReceivedAt(array $task, DateTime $fallback): DateTime
    {
        foreach (['processing_at', 'conduct_date'] as $field) {
            if (empty($task[$field])) {
                continue;
            }

            try {
                return $this->parsePortalWallClock((string) $task[$field]);
            } catch (Exception $exception) {
                Log::warning("Project57 Video Import Invalid {$field} for received_at", [
                    'client_portal_id' => $task['id'] ?? null,
                    $field => $task[$field],
                    'message' => $exception->getMessage(),
                ]);
            }
        }

        return clone $fallback;
    }

    private function resolveCreatedAt(array $task, DateTime $fallback): DateTime
    {
        if (empty($task['processing_at'])) {
            return clone $fallback;
        }

        try {
            return $this->parsePortalWallClock((string) $task['processing_at']);
        } catch (Exception $exception) {
            Log::warning('Project57 Video Import Invalid processing_at', [
                'client_portal_id' => $task['id'] ?? null,
                'processing_at' => $task['processing_at'],
                'message' => $exception->getMessage(),
            ]);

            return clone $fallback;
        }
    }

    private function parsePortalWallClock(string $value): DateTime
    {
        $value = trim($value);

        if (preg_match('/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/', $value, $matches)) {
            $dateTime = DateTime::createFromFormat(
                '!Y-m-d H:i:s',
                "{$matches[1]} {$matches[2]}",
                new DateTimeZone('UTC')
            );

            if ($dateTime !== false) {
                return $dateTime;
            }
        }

        $parsed = new DateTime($value);
        $dateTime = DateTime::createFromFormat(
            '!Y-m-d H:i:s',
            $parsed->format('Y-m-d H:i:s'),
            new DateTimeZone('UTC')
        );

        if ($dateTime === false) {
            throw new Exception("Invalid client portal timestamp: {$value}");
        }

        return $dateTime;
    }

    private function normalizeInstructionForInsert(?string $instruction, ?int $maxLength): ?string
    {
        if ($instruction === null || $instruction === '') {
            return null;
        }

        if ($maxLength === null) {
            return $instruction;
        }

        return Str::limit($instruction, $maxLength, '');
    }

    private function filterRecordForTable(array $record): array
    {
        $columns = array_flip(Schema::getColumnListing($this->table));

        return array_intersect_key($record, $columns);
    }
}
