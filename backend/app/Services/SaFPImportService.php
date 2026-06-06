<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use DateTime;
use DateTimeZone;
use Exception;

class SaFPImportService
{
    protected string $apiUrl = 'https://diary-booking-assistant-4f2ee1a4.base44.app/api/functions/processorTasksJson?api_key=PzpZrmL5vmAnEpNpWx5LBQJMRHqodPyR&processor_id=11441';
    protected string $apiKey = 'YOUR_API_KEY';
    protected int $processorId = 11441;
    protected int $projectId = 12;
    protected string $table = 'project_12_orders';

    protected function mapStatus(string $status): string
    {
        return match($status) {
            'processing' => 'in-progress',
            'completed' => 'completed',
            default => 'pending',
        };
    }

    public function run()
    {
        try {

            $response = Http::timeout(60)->get($this->apiUrl);

            if (!$response->successful()) {
                Log::error('Project12 API failed');
                return;
            }

            $data = $response->json();

            if (!isset($data['tasks'])) {
                Log::warning('No tasks found in API');
                return;
            }

            $records = [];
            $inserted = 0;
            $updated = 0;
            $skipped = 0;
            $instructionMaxLength = $this->getInstructionMaxLength();

            $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));
            $queuedClientPortalIds = [];

            foreach ($data['tasks'] as $task) {

                // ONLY FLOORPLAN - only process tasks with product_category_id = 2 and product_id = 3
                if (!isset($task['product_category_id']) || $task['product_category_id'] != 2 || !isset($task['product_id']) || $task['product_id'] != 3) {
                    continue;
                }

                if (empty($task['order_id']) || empty($task['id'])) {
                    continue;
                }

                $clientPortalId = (string) $task['id'];
                $sourceOrderNumber = (string) $task['order_id'];

                // client_portal_id is the real unique task identity for this import.
                // Skip duplicate task IDs inside the same API payload.
                if (isset($queuedClientPortalIds[$clientPortalId])) {
                    $skipped++;
                    Log::info('Project12 Import Duplicate client_portal_id in API payload skipped', [
                        'order_number' => $sourceOrderNumber,
                        'client_portal_id' => $clientPortalId,
                    ]);
                    continue;
                }

                $queuedClientPortalIds[$clientPortalId] = true;

                // TIME RULES
                // processing_date / processing_at -> received_at
                // conduct_date -> created_at
                $receivedAt = $this->resolveReceivedAt($task, $nowPK);
                $dueIn = (clone $receivedAt)->modify('+6 hours');
                $createdAt = $this->resolveCreatedAt($task, $nowPK);
                $storedOrderNumber = $this->resolveStoredOrderNumber($sourceOrderNumber, $clientPortalId);

                $clerkArea = $task['clerk_area'] ?? null;
                $processorNotes = isset($task['processor_notes']) ? trim((string) $task['processor_notes']) : null;
                $processorNotes = $processorNotes === '' ? null : $processorNotes;
                $safeInstruction = $this->normalizeInstructionForInsert($processorNotes, $instructionMaxLength);

                $records[] = [

                    // IDs
                    'order_number' => $storedOrderNumber,
                    'client_portal_id' => $clientPortalId,
                    'project_id' => $this->projectId,
                    'client_reference' => $sourceOrderNumber,

                    // CLIENT
                    'client_name' => $task['client'] ?? null,
                    'branch' => $task['branch'] ?? null,

                    // AREA (same stored in both fields)
                    'clerk_area' => $clerkArea,
                    'address' => $clerkArea,

                    // PROCESSOR
                    'processor_id' => $task['processor_id'] ?? null,
                    'processor_name' => $task['processor_name'] ?? null,

                    // TASK
                    'plan_type' => $task['name'] ?? null,
                    'instruction' => $safeInstruction,
                    'current_layer' => 'drawer',

                    // ❌ IMPORTANT FIX
                    // DO NOT USE amend from API
                    // Keep NULL always OR remove field if nullable
                    'amend' => null,

                    // TIME
                    'received_at' => $receivedAt->format('Y-m-d H:i:s'),
                    'due_in' => $dueIn->format('Y-m-d H:i:s'),

                    'started_at' => null,

                    // ATTACHMENTS
                    'attachments' => json_encode([
                        'wms_url' => $task['wms_url'] ?? null
                    ]),

                    // STORE FULL RAW API SAFE
                    'metadata' => json_encode($task),

                    // SYSTEM
                    'import_source' => 'cron',

                    'year' => $nowPK->format('Y'),
                    'month' => $nowPK->format('m'),
                    'date' => $nowPK->format('d-m-Y'),

                    'created_at' => $createdAt->format('Y-m-d H:i:s'),
                    'updated_at' => $nowPK->format('Y-m-d H:i:s'),
                ];
            }

            if (!empty($records)) {
                foreach ($records as $record) {
                    try {
                        $result = DB::table($this->table)->insertOrIgnore([$record]);
                        if ($result === 1) {
                            $inserted++;
                        } else {
                            $updatedRows = $this->updateExistingImportTimestamps($record);
                            if ($updatedRows > 0) {
                                $updated++;
                            } else {
                                $skipped++;
                            }
                        }
                    } catch (Exception $rowException) {
                        $skipped++;
                        Log::warning('Project12 Import Row Skipped', [
                            'order_number' => $record['order_number'] ?? null,
                            'client_portal_id' => $record['client_portal_id'] ?? null,
                            'message' => $rowException->getMessage(),
                        ]);
                    }
                }

                Log::info('Project12 Import Completed', [
                    'fetched' => count($records),
                    'inserted' => $inserted,
                    'updated' => $updated,
                    'skipped' => $skipped,
                    'instruction_max_length' => $instructionMaxLength,
                ]);

            } else {
                Log::warning('Project12 Import: No valid records found');
            }

        } catch (Exception $e) {
            Log::error('Project12 Import Error: '.$e->getMessage());
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

    private function resolveReceivedAt(array $task, DateTime $fallback): DateTime
    {
        $processingValue = $task['processing_date'] ?? $task['processing_at'] ?? null;

        if (empty($processingValue)) {
            if (!empty($task['conduct_date'])) {
                try {
                    return new DateTime($task['conduct_date']);
                } catch (Exception $exception) {
                    Log::warning('Project12 Import Invalid conduct_date fallback for received_at', [
                        'client_portal_id' => $task['id'] ?? null,
                        'conduct_date' => $task['conduct_date'],
                        'message' => $exception->getMessage(),
                    ]);
                }
            }

            return clone $fallback;
        }

        try {
            return new DateTime($processingValue);
        } catch (Exception $exception) {
            Log::warning('Project12 Import Invalid processing date', [
                'client_portal_id' => $task['id'] ?? null,
                'processing_date' => $task['processing_date'] ?? null,
                'processing_at' => $task['processing_at'] ?? null,
                'message' => $exception->getMessage(),
            ]);

            if (!empty($task['conduct_date'])) {
                try {
                    return new DateTime($task['conduct_date']);
                } catch (Exception $fallbackException) {
                    Log::warning('Project12 Import Invalid conduct_date fallback for received_at', [
                        'client_portal_id' => $task['id'] ?? null,
                        'conduct_date' => $task['conduct_date'],
                        'message' => $fallbackException->getMessage(),
                    ]);
                }
            }

            return clone $fallback;
        }
    }

    private function resolveCreatedAt(array $task, DateTime $fallback): DateTime
    {
        if (empty($task['conduct_date'])) {
            return clone $fallback;
        }

        try {
            return new DateTime($task['conduct_date']);
        } catch (Exception $exception) {
            Log::warning('Project12 Import Invalid conduct_date', [
                'client_portal_id' => $task['id'] ?? null,
                'conduct_date' => $task['conduct_date'],
                'message' => $exception->getMessage(),
            ]);

            return clone $fallback;
        }
    }

    private function updateExistingImportTimestamps(array $record): int
    {
        $clientPortalId = $record['client_portal_id'] ?? null;
        $orderNumber = $record['order_number'] ?? null;
        $clientReference = $record['client_reference'] ?? null;

        $query = DB::table($this->table);

        if (($orderNumber !== null && $orderNumber !== '') || ($clientReference !== null && $clientReference !== '')) {
            $query->where(function ($matchQuery) use ($orderNumber, $clientReference, $clientPortalId) {
                if ($orderNumber !== null && $orderNumber !== '') {
                    $matchQuery->where('order_number', $orderNumber);
                }

                if ($clientReference !== null && $clientReference !== '') {
                    $method = ($orderNumber !== null && $orderNumber !== '') ? 'orWhere' : 'where';
                    $matchQuery->{$method}('client_reference', $clientReference);
                }

                if ($clientPortalId !== null && $clientPortalId !== '') {
                    $matchQuery->orWhere('client_portal_id', $clientPortalId);
                }
            });
        } elseif ($clientPortalId !== null && $clientPortalId !== '') {
            $query->where('client_portal_id', $clientPortalId);
        } else {
            return 0;
        }

        return $query
            ->update([
                'order_number' => $record['order_number'] ?? null,
                'client_reference' => $record['client_reference'] ?? null,
                'client_portal_id' => $record['client_portal_id'] ?? null,
                'received_at' => $record['received_at'] ?? null,
                'due_in' => $record['due_in'] ?? null,
                'created_at' => $record['created_at'] ?? null,
                'updated_at' => $record['updated_at'] ?? now(),
            ]);
    }

    private function resolveStoredOrderNumber(string $sourceOrderNumber, string $clientPortalId): string
    {
        return $sourceOrderNumber;
    }

    private function findExistingOrderByClientPortalId(?string $clientPortalId): ?object
    {
        if ($clientPortalId === null || $clientPortalId === '') {
            return null;
        }

        return DB::table($this->table)
            ->where('client_portal_id', $clientPortalId)
            ->first(['order_number', 'client_portal_id']);
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
}
