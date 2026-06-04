<?php

namespace App\Jobs;

use App\Models\Order;
use App\Models\Project;
use App\Models\User;
use App\Services\AuditService;
use App\Services\NotificationService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Auto-reassign orders from inactive/absent workers.
 * Scheduled to run every 5 minutes via Laravel scheduler.
 */
class AutoReassignOrders implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;
    public int $backoff = 30;

    private int $inactivityMinutes;

    public function __construct(int $inactivityMinutes = 30)
    {
        $this->inactivityMinutes = $inactivityMinutes;
    }

    public function handle(): void
    {
        Log::info('AutoReassignOrders: Starting auto-reassignment check');

        // Find orders assigned to workers who are inactive or absent
        $inactiveThreshold = now()->subMinutes($this->inactivityMinutes);

        // Get inactive/absent user IDs
        $inactiveUserIds = User::where('is_active', true)
            ->where(function ($q) use ($inactiveThreshold) {
                $q->where('is_absent', true)
                  ->orWhere('last_activity', '<', $inactiveThreshold)
                  ->orWhereNull('last_activity');
            })
            ->pluck('id');

        if ($inactiveUserIds->isEmpty()) {
            Log::info('AutoReassignOrders: No inactive users found.');
            return;
        }

        // Query across all active project tables for orders assigned to inactive users
        $activeProjects = Project::where('status', 'active')->get();
        $ordersToReassign = collect();
        foreach ($activeProjects as $project) {
            $projectOrders = Order::forProject($project->id)
                ->whereNotNull('assigned_to')
                ->whereIn('assigned_to', $inactiveUserIds)
                ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED', 'ON_HOLD'])
                ->get();
            $ordersToReassign = $ordersToReassign->merge($projectOrders);
        }

        // Load the assigned user relationships
        $userCache = User::whereIn('id', $ordersToReassign->pluck('assigned_to')->unique())->get()->keyBy('id');

        $reassigned = 0;

        foreach ($ordersToReassign as $order) {
            try {
                DB::transaction(function () use ($order, &$reassigned, $userCache) {
                    $previousUser = $order->assigned_to;
                    $previousUserName = $userCache->get($previousUser)?->name ?? 'Unknown';

                    // Revert IN_* state to QUEUED_* and unassign
                    $currentState = $order->workflow_state;
                    $newState = $currentState;
                    if (str_starts_with($currentState, 'IN_')) {
                        $newState = str_replace('IN_', 'QUEUED_', $currentState);
                    }

                    // Mark any in-progress work items as abandoned
                    $stage = \App\Services\StateMachine::STATE_TO_STAGE[$currentState] ?? null;
                    if ($stage && $previousUser) {
                        \App\Models\WorkItem::where('order_id', $order->id)
                            ->where('stage', $stage)
                            ->where('assigned_user_id', $previousUser)
                            ->where('status', 'in_progress')
                            ->update(['status' => 'abandoned', 'completed_at' => now()]);
                    }

                    // Update order: revert state + clear assignment
                    $order->update([
                        'assigned_to' => null,
                        'workflow_state' => $newState,
                        'status' => 'pending',
                    ]);

                    // Safely decrement WIP count for previous user
                    if ($previousUser) {
                        User::where('id', $previousUser)->where('wip_count', '>', 0)->decrement('wip_count');
                    }

                    // Sync unassignment to CRM
                    $existingCrm = DB::table('crm_order_assignments')
                        ->where('project_id', $order->project_id)
                        ->where('order_number', $order->order_number)
                        ->first();
                    if ($existingCrm) {
                        DB::table('crm_order_assignments')->where('id', $existingCrm->id)->update([
                            'assigned_to'    => null,
                            'workflow_state'  => $newState,
                            'updated_at'     => now(),
                        ]);
                    }

                    // Log the auto-reassignment
                    AuditService::log(
                        null, // System action
                        'AUTO_REASSIGN',
                        'Order',
                        $order->id,
                        $order->project_id,
                        ['assigned_to' => $previousUser, 'user_name' => $previousUserName],
                        ['assigned_to' => null, 'reason' => 'Worker inactive/absent']
                    );

                    // Notify operations manager
                    NotificationService::workerInactive($order->id, $previousUser, $order->project_id);

                    $reassigned++;
                });
            } catch (\Throwable $e) {
                Log::error("AutoReassignOrders: Failed to reassign order {$order->id}", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        Log::info("AutoReassignOrders: Completed. Reassigned {$reassigned} orders.");
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('AutoReassignOrders job failed', [
            'error' => $exception->getMessage(),
            'trace' => $exception->getTraceAsString(),
        ]);
    }
}
