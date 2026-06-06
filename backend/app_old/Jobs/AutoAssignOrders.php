<?php

namespace App\Jobs;

use App\Models\Order;
use App\Models\Project;
use App\Models\User;
use App\Services\AssignmentEngine;
use App\Services\StateMachine;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Push-based auto-assignment: automatically assign queued orders to idle workers.
 * Runs every minute. For each project, finds unassigned queued orders and matches
 * them to the best available worker using AssignmentEngine::findBestUser().
 */
class AutoAssignOrders implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 120;
    public int $backoff = 30;

    public function handle(): void
    {
        Log::info('AutoAssignOrders: Starting push-based auto-assignment');

        $projects = Project::where('status', 'active')->get();
        $totalAssigned = 0;
        $totalMinAssigned = 0;

        foreach ($projects as $project) {
            $assigned = $this->processProject($project);
            $totalAssigned += $assigned;

            // Second pass: ensure every active worker has at least 2 orders
            $minAssigned = $this->ensureMinimumOrders($project);
            $totalMinAssigned += $minAssigned;
        }

        Log::info("AutoAssignOrders: Completed. Auto-assigned {$totalAssigned} orders, min-2 top-up: {$totalMinAssigned}.");
    }

    private function processProject(Project $project): int
    {
        $queuedStates = StateMachine::getQueuedStates($project->workflow_type);
        $assigned = 0;

        foreach ($queuedStates as $queueState) {
            // Get the role needed for this queue
            $stage = StateMachine::STATE_TO_STAGE[$queueState] ?? null;
            $role = $stage ? (StateMachine::STAGE_TO_ROLE[$stage] ?? null) : null;
            if (!$role) continue;

            // Find all unassigned orders in this queue, priority + FIFO
            $orders = Order::forProject($project->id)
                ->where('workflow_state', $queueState)
                ->whereNull('assigned_to')
                ->orderByRaw("CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END")
                ->orderBy('received_at', 'asc')
                ->get();

            if ($orders->isEmpty()) continue;

            foreach ($orders as $order) {
                $worker = $this->findAvailableWorker($project, $role, $order);
                if (!$worker) break; // No more available workers for this role

                try {
                    $this->assignOrderToWorker($order, $worker, $queueState);
                    $assigned++;
                } catch (\Throwable $e) {
                    Log::warning("AutoAssignOrders: Failed to assign order {$order->id} to user {$worker->id}", [
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        }

        return $assigned;
    }

    /**
     * Minimum-2 guarantee: after normal assignment pass, check if any
     * eligible worker has fewer than 2 orders. If queued orders remain,
     * assign to under-staffed workers first.
     */
    private function ensureMinimumOrders(Project $project): int
    {
        $minOrders = 2;
        $queuedStates = StateMachine::getQueuedStates($project->workflow_type);
        $assigned = 0;

        foreach ($queuedStates as $queueState) {
            $stage = StateMachine::STATE_TO_STAGE[$queueState] ?? null;
            $role = $stage ? (StateMachine::STAGE_TO_ROLE[$stage] ?? null) : null;
            if (!$role) continue;

            // Workers who are active but have fewer than minimum orders
            $underloadedWorkers = User::where('project_id', $project->id)
                ->where('role', $role)
                ->where('is_active', true)
                ->where('is_absent', false)
                ->where('last_activity', '>', now()->subMinutes(15))
                ->whereRaw('wip_count < wip_limit')
                ->where('wip_count', '<', $minOrders)
                ->orderBy('wip_count', 'asc')
                ->orderBy('assignment_score', 'desc')
                ->get();

            if ($underloadedWorkers->isEmpty()) continue;

            foreach ($underloadedWorkers as $worker) {
                // Re-check: how many does this worker currently have
                $currentWip = $worker->wip_count;
                $needed = $minOrders - $currentWip;
                if ($needed <= 0) continue;

                for ($i = 0; $i < $needed; $i++) {
                    // Find next unassigned order in this queue
                    $order = Order::forProject($project->id)
                        ->where('workflow_state', $queueState)
                        ->whereNull('assigned_to')
                        ->orderByRaw("CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END")
                        ->orderBy('received_at', 'asc')
                        ->first();

                    if (!$order) break; // No more queued orders

                    try {
                        $this->assignOrderToWorker($order, $worker, $queueState);
                        $assigned++;
                    } catch (\Throwable $e) {
                        Log::warning("AutoAssignOrders: Min-2 assign failed order {$order->id} to user {$worker->id}", [
                            'error' => $e->getMessage(),
                        ]);
                        break;
                    }

                    // Refresh worker to pick up incremented wip_count
                    $worker->refresh();
                }
            }
        }

        return $assigned;
    }

    /**
     * Find the best available worker for a role in a project.
     * Uses the pre-computed assignment_score (weighted composite) for smart selection.
     *
     * Worker must be: active, not absent, recently active (15m), under per-user WIP limit.
     * Team constraint: for checker/QA, worker must be from the same team_id as the order
     * to ensure all 3 layers (drawer → checker → QA) stay within the same team.
     * Skill matching: if order has a non-standard order_type and worker has skills,
     * prefer workers whose skills include that order_type.
     */
    private function findAvailableWorker(Project $project, string $role, ?Order $order = null): ?User
    {
        $query = User::where('project_id', $project->id)
            ->where('role', $role)
            ->where('is_active', true)
            ->where('is_absent', false)
            ->where('last_activity', '>', now()->subMinutes(15))
            ->whereRaw('wip_count < wip_limit');

        // Team constraint: checker and QA must be from the same team as the order
        if ($order && $order->team_id && in_array($role, ['checker', 'qa'])) {
            $query->where('team_id', $order->team_id);
        }

        // Minimum-2 prioritization: prefer workers with fewer than 2 orders first
        $query->orderByRaw('CASE WHEN wip_count < 2 THEN 0 ELSE 1 END ASC');

        // Phase 3: Skill matching — boost workers with matching skills
        $orderType = $order?->order_type ?? 'standard';
        if ($orderType !== 'standard') {
            // Prefer workers with matching skill, but don't exclude others
            $query->orderByRaw("
                CASE WHEN skills IS NOT NULL AND JSON_CONTAINS(skills, ?, '$')
                THEN 0 ELSE 1 END ASC
            ", [json_encode($orderType)]);
        }

        // Primary sort: pre-computed assignment_score (higher = more capacity/quality)
        $query->orderBy('assignment_score', 'desc')
              ->orderBy('wip_count', 'asc')            // Tiebreak: least loaded
              ->orderBy('today_completed', 'asc')      // Tiebreak: fairness
              ->orderBy('last_activity', 'desc');       // Tiebreak: most recent

        return $query->first();
    }

    /**
     * Assign a single order to a worker via DB transaction.
     */
    private function assignOrderToWorker(Order $order, User $worker, string $queueState): void
    {
        $inState = StateMachine::getInProgressState($queueState);
        if (!$inState) return;

        DB::transaction(function () use ($order, $worker, $inState, $queueState) {
            // Lock the order row to prevent race conditions
            $order = Order::forProject($order->project_id)
                ->where('id', $order->id)
                ->where('workflow_state', $queueState)
                ->whereNull('assigned_to')
                ->lockForUpdate()
                ->first();

            if (!$order) return; // Already assigned by another process

            // Assign the worker — set role-specific columns (same as AssignmentEngine::startNext)
            $assignData = ['assigned_to' => $worker->id, 'team_id' => $worker->team_id];
            $role = $worker->role;
            if ($role === 'drawer' || $role === 'designer') {
                $assignData['drawer_id']    = $worker->id;
                $assignData['drawer_name']  = $worker->name;
                $assignData['dassign_time'] = now();
            } elseif ($role === 'checker') {
                $assignData['checker_id']    = $worker->id;
                $assignData['checker_name']  = $worker->name;
                $assignData['cassign_time']  = now();
            } elseif ($role === 'qa') {
                $assignData['qa_id']   = $worker->id;
                $assignData['qa_name'] = $worker->name;
            }
            $order->update($assignData);

            // Transition QUEUED → IN_PROGRESS
            StateMachine::transition($order, $inState, $worker->id);

            // Re-set assigned_to since StateMachine clears it for QUEUED states
            // but we're going straight to IN_ state
            if (!$order->assigned_to) {
                $order->update(['assigned_to' => $worker->id]);
            }

            // Create work item
            $stage = StateMachine::STATE_TO_STAGE[$inState] ?? null;
            \App\Models\WorkItem::create([
                'order_id'         => $order->id,
                'project_id'       => $order->project_id,
                'stage'            => $stage,
                'assigned_user_id' => $worker->id,
                'team_id'          => $worker->team_id,
                'status'           => 'in_progress',
                'assigned_at'      => now(),
                'started_at'       => now(),
                'attempt_number'   => $this->getAttemptNumber($order, $stage),
            ]);

            // Update worker WIP
            $worker->increment('wip_count');

            // Sync to project table + CRM for Live QA dashboard visibility
            AssignmentEngine::syncToProjectTable($order->fresh(), $worker, 'start');

            Log::info("AutoAssignOrders: Assigned order {$order->id} to {$worker->name} (role: {$role})");
        });
    }

    private function getAttemptNumber(Order $order, ?string $stage): int
    {
        return match ($stage) {
            'DRAW'   => $order->attempt_draw + 1,
            'CHECK'  => $order->attempt_check + 1,
            'DESIGN' => $order->attempt_draw + 1,
            'QA'     => $order->attempt_qa + 1,
            default  => 1,
        };
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('AutoAssignOrders job failed', [
            'error' => $exception->getMessage(),
        ]);
    }
}
