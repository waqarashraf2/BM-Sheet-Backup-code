<?php

namespace App\Jobs;

use App\Models\Order;
use App\Models\OrderImportLog;
use App\Models\Project;
use App\Services\AuditService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Process bulk order imports asynchronously.
 * Handles large CSV files without blocking the HTTP request.
 */
class ProcessOrderImport implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 600; // 10 minutes for large imports
    public int $backoff = 60;

    private int $importLogId;
    private int $projectId;
    private array $orders;
    private int $userId;

    public function __construct(int $importLogId, int $projectId, array $orders, int $userId)
    {
        $this->importLogId = $importLogId;
        $this->projectId = $projectId;
        $this->orders = $orders;
        $this->userId = $userId;
    }

    public function handle(): void
    {
        Log::info("ProcessOrderImport: Starting import of {$this->count()} orders for project {$this->projectId}");

        $importLog = OrderImportLog::find($this->importLogId);
        if (!$importLog) {
            Log::error("ProcessOrderImport: Import log {$this->importLogId} not found");
            return;
        }

        $importLog->update(['status' => 'processing']);

        $project = Project::find($this->projectId);
        if (!$project) {
            $importLog->update([
                'status' => 'failed',
                'error_details' => ['message' => 'Project not found'],
            ]);
            return;
        }

        $created = 0;
        $failed = 0;
        $errors = [];
        $chunkSize = 100;

        // Process in chunks for memory efficiency
        $chunks = array_chunk($this->orders, $chunkSize);

        foreach ($chunks as $chunkIndex => $chunk) {
            DB::beginTransaction();
            try {
                foreach ($chunk as $index => $orderData) {
                    $globalIndex = ($chunkIndex * $chunkSize) + $index;

                    try {
                        $this->createOrder($orderData, $project);
                        $created++;
                    } catch (\Throwable $e) {
                        $failed++;
                        $errors[] = [
                            'row' => $globalIndex + 1,
                            'data' => $orderData,
                            'error' => $e->getMessage(),
                        ];
                    }
                }
                DB::commit();
            } catch (\Throwable $e) {
                DB::rollBack();
                Log::error("ProcessOrderImport: Chunk {$chunkIndex} failed", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        $importLog->update([
            'status' => $failed > 0 ? 'completed_with_errors' : 'completed',
            'success_count' => $created,
            'failed_count' => $failed,
            'error_details' => $errors,
            'completed_at' => now(),
        ]);

        AuditService::log(
            $this->userId,
            'BULK_IMPORT_COMPLETED',
            'OrderImportLog',
            $this->importLogId,
            $this->projectId,
            null,
            ['created' => $created, 'failed' => $failed]
        );

        Log::info("ProcessOrderImport: Completed. Created: {$created}, Failed: {$failed}");
    }

    private function createOrder(array $data, Project $project): Order
    {
        $orderNumber = $data['order_number']
            ?? 'ORD-' . strtoupper($project->code) . '-' . now()->format('YmdHis') . '-' . mt_rand(1000, 9999);

        // Determine the first queue state based on workflow type
        $firstQueueState = $project->workflow_type === 'PH_2_LAYER'
            ? 'QUEUED_DESIGN'
            : 'QUEUED_DRAW';

        $order = Order::createForProject($project->id, [
            'order_number' => $orderNumber,
            'project_id' => $project->id,
            'client_reference' => $data['client_reference'] ?? null,
            'workflow_type' => $project->workflow_type,
            'workflow_state' => 'RECEIVED',
            'current_layer' => $project->workflow_type === 'FP_3_LAYER' ? 'drawer' : 'designer',
            'status' => 'pending',
            'priority' => $data['priority'] ?? 'normal',
            'complexity_weight' => $data['complexity_weight'] ?? 1,
            'estimated_minutes' => $data['estimated_minutes'] ?? null,
            'order_type' => $data['order_type'] ?? 'standard',
            'received_at' => $data['received_at'] ?? now(),
            'due_date' => $data['due_date'] ?? null,
            'metadata' => $data['metadata'] ?? [],
            'import_log_id' => $this->importLogId,
        ]);

        // Auto-advance to first queue so workers can pick it up
        try {
            \App\Services\StateMachine::transition($order, $firstQueueState, $this->userId);
        } catch (\Throwable $e) {
            Log::warning("ProcessOrderImport: Could not auto-advance order {$order->id}: {$e->getMessage()}");
        }

        return $order;
    }

    private function count(): int
    {
        return count($this->orders);
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('ProcessOrderImport job failed', [
            'import_log_id' => $this->importLogId,
            'error' => $exception->getMessage(),
        ]);

        OrderImportLog::where('id', $this->importLogId)->update([
            'status' => 'failed',
            'error_details' => ['message' => $exception->getMessage()],
        ]);
    }
}
