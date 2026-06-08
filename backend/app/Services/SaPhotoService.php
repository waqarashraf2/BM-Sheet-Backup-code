<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use DateTime;
use DateTimeZone;
use Exception;

class SaPhotoService
{
    protected string $apiUrl = 'https://diary-booking-assistant-4f2ee1a4.base44.app/api/functions/processorTasksJson?api_key=PzpZrmL5vmAnEpNpWx5LBQJMRHqodPyR&processor_id=6284';
    protected string $apiKey = 'YOUR_API_KEY';
    protected int $processorId = 6284;
    protected int $projectId = 19;
    protected string $table = 'project_19_orders';

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
                Log::error('Project19 Photo API failed');
                return;
            }

            $data = $response->json();

            if (!isset($data['tasks'])) {
                Log::warning('No tasks found in API');
                return;
            }

            $records = [];
            $inserted = 0;
            $skipped = 0;
            $instructionMaxLength = $this->getInstructionMaxLength();

            $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));
            $queuedOrderNumbers = [];

            foreach ($data['tasks'] as $task) {

                if (!$this->isPhotoProcessorTask($task)) {
                    continue;
                }

                if (empty($task['order_id']) || empty($task['id'])) {
                    continue;
                }

                $clientPortalId = (string) $task['id'];
                $orderNumber = (string) $task['id'];
                $clintOrderNumber = isset($task['order_id']) ? (string) $task['order_id'] : null;

                // order_number (task id) is the unique key for this import.
                // client_portal_id (order_id) may be duplicated across categories.
                if (isset($queuedOrderNumbers[$orderNumber])) {
                    $skipped++;
                    Log::info('Project19 Photo Import Duplicate order_number in API payload skipped', [
                        'order_number' => $orderNumber,
                        'client_portal_id' => $clientPortalId,
                    ]);
                    continue;
                }

                $queuedOrderNumbers[$orderNumber] = true;

                // TIME RULES
                // processing_at -> received_at
                // conduct_date -> fallback for older payloads
                // processing_at -> created_at
                // These can be different or the same depending on the API data.
                $receivedAt = $this->resolveReceivedAt($task, $nowPK);
                $dueIn = (clone $receivedAt)->modify('+6 hours');
                $createdAt = $this->resolveCreatedAt($task, $nowPK);

                $clerkArea = $task['clerk_area'] ?? null;
                $processorNotes = isset($task['processor_notes']) ? trim((string) $task['processor_notes']) : null;
                $processorNotes = $processorNotes === '' ? null : $processorNotes;
                $safeInstruction = $this->normalizeInstructionForInsert($processorNotes, $instructionMaxLength);

                $records[] = [

                    // IDs
                        'order_number' => $orderNumber,
                        'client_portal_id' => $clientPortalId,
                        'clint_order_number' => $clintOrderNumber,
                    'project_id' => $this->projectId,

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
                    'current_layer' => 'designer',
                    'workflow_type' => 'PH_2_LAYER',

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
                        if ($this->orderNumberExists($record['order_number'] ?? null)) {
                            $skipped++;
                            Log::info('Project19 Photo Import Existing order_number skipped', [
                                'order_number' => $record['order_number'] ?? null,
                                'client_portal_id' => $record['client_portal_id'] ?? null,
                            ]);
                            continue;
                        }

                        DB::table($this->table)->insert([$record]);
                        $inserted++;
                    } catch (Exception $rowException) {
                        if ($this->orderNumberExists($record['order_number'] ?? null)) {
                            $skipped++;
                            Log::info('Project19 Photo Import Duplicate order_number skipped during insert', [
                                'order_number' => $record['order_number'] ?? null,
                                'client_portal_id' => $record['client_portal_id'] ?? null,
                            ]);
                            continue;
                        }

                        $skipped++;
                        Log::warning('Project19 Photo Import Row Skipped', [
                            'order_number' => $record['order_number'] ?? null,
                            'client_portal_id' => $record['client_portal_id'] ?? null,
                            'message' => $rowException->getMessage(),
                        ]);
                    }
                }

                Log::info('Project19 Photo Import Completed', [
                    'fetched' => count($records),
                    'inserted' => $inserted,
                    'skipped' => $skipped,
                    'instruction_max_length' => $instructionMaxLength,
                ]);

            } else {
                Log::warning('Project19 Photo Import: No valid records found');
            }

        } catch (Exception $e) {
            Log::error('Project19 Photo Import Error: '.$e->getMessage());
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

    private function isPhotoProcessorTask(array $task): bool
    {
        if (isset($task['processor_id']) && (int) $task['processor_id'] === $this->processorId) {
            return true;
        }

        $processorName = trim((string) ($task['processor_name'] ?? ''));
        return strcasecmp($processorName, 'Asbah Iqbal (Photos)') === 0;
    }

    private function resolveReceivedAt(array $task, DateTime $fallback): DateTime
    {
        if (empty($task['processing_at']) && empty($task['conduct_date'])) {
            return clone $fallback;
        }

        $pkt = new DateTimeZone('Asia/Karachi');

        try {
            if (!empty($task['processing_at'])) {
                // API returns UTC timestamps (Z-suffix). Convert to PKT so date filters work correctly.
                $dt = new DateTime($task['processing_at']);
                $dt->setTimezone($pkt);
                return $dt;
            }

            $dt = new DateTime($task['conduct_date']);
            $dt->setTimezone($pkt);
            return $dt;
        } catch (Exception $exception) {
            Log::warning('Project19 Photo Import Invalid received_at date', [
                'client_portal_id' => $task['id'] ?? null,
                'processing_at' => $task['processing_at'] ?? null,
                'conduct_date' => $task['conduct_date'] ?? null,
                'message' => $exception->getMessage(),
            ]);

            return clone $fallback;
        }
    }

    private function resolveCreatedAt(array $task, DateTime $fallback): DateTime
    {
        if (empty($task['processing_at'])) {
            return clone $fallback;
        }

        try {
            $dt = new DateTime($task['processing_at']);
            $dt->setTimezone(new DateTimeZone('Asia/Karachi'));
            return $dt;
        } catch (Exception $exception) {
            Log::warning('Project19 Photo Import Invalid processing_at', [
                'client_portal_id' => $task['id'] ?? null,
                'processing_at' => $task['processing_at'],
                'message' => $exception->getMessage(),
            ]);

            return clone $fallback;
        }
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
