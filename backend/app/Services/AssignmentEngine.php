<?php

namespace App\Services;

use App\Models\Order;
use App\Models\User;
use App\Models\WorkItem;
use App\Models\Project;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
class AssignmentEngine
{

    /**
     * Start next: find the next order in the user's queue and assign it.
     * Returns the assigned order or null if queue is empty.
     * Uses per-user wip_limit and complexity-weighted load check.
     */
    
    public static function startNext(User $user): ?Order
    {
        $project = $user->project;
        if (!$project) return null;

        $role = $user->role;
        $workflowType = self::resolveWorkflowTypeForUser($user, $project);
        $queueState = self::getQueueStateForRole($role, $workflowType);
        if (!$queueState) return null;

        // Check per-user WIP limit (using weighted complexity load)
        $wipLimit = $user->wip_limit ?: 5;
        $currentWip = Order::forProject($project->id)
            ->where('assigned_to', $user->id)
            ->whereIn('workflow_state', self::getInProgressStatesForRole($role, $workflowType))
            ->count();

        if ($currentWip >= $wipLimit) {
            return null; // Already at max WIP
        }

        // Find next order: priority first, then oldest received
        // Team constraint: checker and QA must only pick orders from their own team
        $query = Order::forProject($project->id)
            ->where('workflow_state', $queueState)
            ->whereNull('assigned_to');

        if ($user->team_id && in_array($role, ['checker', 'filler', 'qa'])) {
            $query->where('team_id', $user->team_id);
        }

        $skills = $user->skills ?? [];
        if (!empty($skills)) {
            // Boost orders matching worker's skills to top, then normal priority ordering
            $placeholders = implode(',', array_fill(0, count($skills), '?'));
            $query->orderByRaw("CASE WHEN order_type IN ({$placeholders}) THEN 0 ELSE 1 END ASC", $skills);
        }

        $order = $query
            ->orderByRaw("CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END")
            ->orderBy('received_at', 'asc')
            ->lockForUpdate()
            ->first();

        if (!$order) return null;

        $inState = StateMachine::getInProgressState($queueState);
        if (!$inState) return null;

        return DB::transaction(function () use ($order, $user, $inState, $queueState, $role) {
            // Assign + transition — also set role-specific columns on the Order model
            $assignData = ['assigned_to' => $user->id, 'team_id' => $user->team_id];
            $assignmentColumns = self::getRoleAssignmentColumns($role);

            if ($assignmentColumns['id_col']) {
                $assignData[$assignmentColumns['id_col']] = $user->id;
            }
            if ($assignmentColumns['name_col']) {
                $assignData[$assignmentColumns['name_col']] = $user->name;
            }
            if ($assignmentColumns['time_col']) {
                $assignData[$assignmentColumns['time_col']] = now();
            }

            if ($role === 'designer') {
                $assignData['current_layer'] = 'designer';
                $assignData['workflow_type'] = 'PH_2_LAYER';
            } elseif ($role === 'filler') {
                $assignData['current_layer'] = 'filler';
            }
            $order->update($assignData);

            StateMachine::transition($order, $inState, $user->id);

            // Create work item
            $stage = StateMachine::STATE_TO_STAGE[$inState] ?? null;
            WorkItem::create([
                'order_id'         => $order->id,
                'project_id'       => $order->project_id,
                'stage'            => $stage,
                'assigned_user_id' => $user->id,
                'team_id'          => $user->team_id,
                'status'           => 'in_progress',
                'assigned_at'      => now(),
                'started_at'       => now(),
                'attempt_number'   => self::getAttemptNumber($order, $stage),
            ]);

            // Update user WIP
            $user->increment('wip_count');

            // Sync to project table for Live QA visibility
            self::syncToProjectTable($order->fresh(), $user, 'start');

            return $order->fresh();
        });
    }

    /**
     * Submit work: transition order to next stage.
     */
    public static function submitWork(Order $order, User $user, ?string $comments = null): Order
    {
        $submittedState = StateMachine::getSubmittedState($order->workflow_state);
        if (!$submittedState) {
            throw new \InvalidArgumentException("Cannot submit from state: {$order->workflow_state}");
        }

        return DB::transaction(function () use ($order, $user, $submittedState, $comments) {
            // Complete the work item (try with stage first, fallback to any matching in-progress)
            $stage = StateMachine::STATE_TO_STAGE[$order->workflow_state] ?? null;
            $workItem = WorkItem::where('project_id', $order->project_id)
                ->where('order_id', $order->id)
                ->where('stage', $stage)
                ->where('assigned_user_id', $user->id)
                ->where('status', 'in_progress')
                ->latest()
                ->first();

            // Fallback: find by order + user without stage filter (auto-created items)
            if (!$workItem) {
                $workItem = WorkItem::where('project_id', $order->project_id)
                    ->where('order_id', $order->id)
                    ->where('assigned_user_id', $user->id)
                    ->where('status', 'in_progress')
                    ->latest()
                    ->first();
            }

            if ($workItem) {
                $workItem->update([
                    'status'       => 'completed',
                    'completed_at' => now(),
                    'comments'     => $comments,
                ]);
            } else {
                WorkItem::create([
                    'order_id'         => $order->id,
                    'project_id'       => $order->project_id,
                    'stage'            => $stage,
                    'assigned_user_id' => $user->id,
                    'team_id'          => $user->team_id,
                    'status'           => 'completed',
                    'assigned_at'      => now(),
                    'started_at'       => now(),
                    'completed_at'     => now(),
                    'comments'         => $comments,
                    'attempt_number'   => self::getAttemptNumber($order, $stage),
                ]);
            }

            // Project 17 only: parse photo-selection values from submit comments
            // and persist them to project_17_orders without affecting other projects.
            // Guarded to designer and qa roles only — other roles are silently skipped.
            // Pass $order directly (not fresh) so the dynamic table binding is preserved.
            self::syncProject17PhotoMetrics($order, $user, $comments);

            // Transition to submitted state
            StateMachine::transition($order, $submittedState, $user->id);

            // Auto-advance to next queue
            $nextQueue = StateMachine::getNextQueueState($submittedState, $order->workflow_type, (int) $order->project_id);
            if ($nextQueue) {
                StateMachine::transition($order, $nextQueue, $user->id);
            }

            // Update user stats (safely prevent negative values)
            if ($user->wip_count > 0) {
                $user->decrement('wip_count');
            }
            $user->increment('today_completed');

            // Sync to project table for Live QA visibility
            self::syncToProjectTable($order->fresh(), $user, 'submit');

            return $order->fresh();
        });
    }

    private static function syncProject17PhotoMetrics(Order $order, User $user, ?string $comments): void
    {
        if ((int) $order->project_id !== 17) {
            return;
        }

        // Only run when the submitting role is designer or qa.
        if (!in_array($user->role, ['designer', 'qa'], true)) {
            \Log::debug('syncProject17PhotoMetrics: skipped — role not designer/qa', [
                'role'     => $user->role,
                'order_id' => $order->id,
            ]);
            return;
        }

        // Log that we're attempting the sync so failures can be traced.
        \Log::info('syncProject17PhotoMetrics: attempting sync', [
            'order_id'        => $order->id,
            'order_number'    => $order->order_number,
            'role'            => $user->role,
            'comments_sample' => $comments ? mb_substr($comments, 0, 300) : null,
        ]);

        $metrics = self::extractPhotoSelectionMetrics($comments);
        if ($metrics === null) {
            \Log::info('syncProject17PhotoMetrics: no photo-selection pattern matched in comment — nothing to write', [
                'order_id'        => $order->id,
                'comments_sample' => $comments ? mb_substr($comments, 0, 300) : null,
            ]);
            return;
        }

        $table = ProjectOrderService::getTableName(17);
        if (!Schema::hasTable($table)) {
            \Log::warning('syncProject17PhotoMetrics: project table does not exist', ['table' => $table]);
            return;
        }

        // Fetch the real column list once — more reliable than per-column hasColumn calls.
        $existingCols = array_flip(Schema::getColumnListing($table));
        $safeMetrics  = array_filter(
            $metrics,
            fn($col) => isset($existingCols[$col]),
            ARRAY_FILTER_USE_KEY
        );

        if (empty($safeMetrics)) {
            \Log::warning('syncProject17PhotoMetrics: metric columns missing from table — add migration', [
                'table'          => $table,
                'wanted_columns' => array_keys($metrics),
                'table_columns'  => array_keys($existingCols),
            ]);
            return;
        }

        $payload = array_merge($safeMetrics, ['updated_at' => now()]);

        // Try update by id first, then by order_number as a fallback.
        $updated = DB::table($table)->where('id', $order->id)->update($payload);

        if ($updated === 0) {
            $updated = DB::table($table)
                ->where('order_number', $order->order_number)
                ->update($payload);
        }

        if ($updated > 0) {
            \Log::info('syncProject17PhotoMetrics: columns written', [
                'order_id' => $order->id,
                'columns'  => array_keys($safeMetrics),
                'values'   => $safeMetrics,
            ]);
        } else {
            \Log::warning('syncProject17PhotoMetrics: update matched 0 rows', [
                'order_id'     => $order->id,
                'order_number' => $order->order_number,
                'table'        => $table,
            ]);
        }
    }

    private static function extractPhotoSelectionMetrics(?string $comments): ?array
    {
        if (!is_string($comments) || trim($comments) === '') {
            return null;
        }

        // Flexible pattern — handles em-dash, en-dash, hyphen, or colon as separator;
        // allows optional whitespace around colons and between fields; case-insensitive.
        $matched = preg_match(
            '/Photo\s+Selections?\s*[\x{2014}\x{2013}\-:]\s*Total\s*:\s*(\d+)\s*,\s*Normal\s*:\s*(\d+)\s*,\s*HDR\s*:\s*(\d+)\s*,\s*Edited\s*:\s*(\d+)\s*,\s*Final\s*:\s*(\d+)/iu',
            $comments,
            $matches
        );

        if ($matched !== 1) {
            return null;
        }

        return [
            'total_raw_files'     => (string) ((int) $matches[1]),
            'single_images_count' => (int) $matches[2],
            'hdr_images_count'    => (int) $matches[3],
            'edited_images_count' => (int) $matches[4],
            'final_images_count'  => (int) $matches[5],
        ];
    }

    /**
     * Reject an order (by checker or QA).
     */
    public static function rejectOrder(
        Order $order,
        User $actor,
        string $reason,
        string $rejectionCode,
        ?string $routeTo = null
    ): Order {
        $currentState = $order->workflow_state;

        // Determine rejection target state
        if ($currentState === 'IN_CHECK') {
            $targetState = 'REJECTED_BY_CHECK';
        } elseif ($currentState === 'IN_QA') {
            $targetState = 'REJECTED_BY_QA';
        } else {
            throw new \InvalidArgumentException("Cannot reject from state: {$currentState}");
        }

        return DB::transaction(function () use ($order, $actor, $reason, $rejectionCode, $targetState, $routeTo) {
            // Complete current work item as rejected
            $stage = StateMachine::STATE_TO_STAGE[$order->workflow_state] ?? null;
            $workItem = WorkItem::where('project_id', $order->project_id)
                ->where('order_id', $order->id)
                ->where('stage', $stage)
                ->where('assigned_user_id', $actor->id)
                ->where('status', 'in_progress')
                ->latest()
                ->first();

            if ($workItem) {
                $workItem->update([
                    'status'         => 'completed',
                    'completed_at'   => now(),
                    'rework_reason'  => $reason,
                    'rejection_code' => $rejectionCode,
                ]);
            }

            // Update order rejection fields
            $order->update([
                'rejected_by'      => $actor->id,
                'rejected_at'      => now(),
                'rejection_reason' => $reason,
                'rejection_type'   => $rejectionCode,
                'recheck_count'    => $order->recheck_count + 1,
            ]);

            // Transition to rejected state
            StateMachine::transition($order, $targetState, $actor->id, [
                'rejection_reason' => $reason,
                'rejection_code'   => $rejectionCode,
            ]);

            // Route to the appropriate queue
            if ($targetState === 'REJECTED_BY_CHECK') {
                StateMachine::transition($order, 'QUEUED_DRAW', $actor->id);
            } elseif ($targetState === 'REJECTED_BY_QA') {
                $target = ($routeTo === 'draw') ? 'QUEUED_DRAW' : 'QUEUED_CHECK';
                if ($order->workflow_type === 'PH_2_LAYER') {
                    $target = 'QUEUED_DESIGN';
                }
                StateMachine::transition($order, $target, $actor->id);
            }

            // Update actor stats (safely prevent negative values)
            if ($actor->wip_count > 0) {
                $actor->decrement('wip_count');
            }
            $actor->increment('today_completed');

            return $order->fresh();
        });
    }




    /**
     * Cancel an order from any valid cancellable state.
     */
    public static function cancelOrder(
        Order $order,
        User $actor,
        string $reason
    ): Order {
        $currentState = $order->workflow_state;

        if (!StateMachine::canTransition($order, 'CANCELLED')) {
            throw new \InvalidArgumentException("Cannot cancel from state: {$currentState}");
        }

        return DB::transaction(function () use ($order, $actor, $reason) {
            $stage = StateMachine::STATE_TO_STAGE[$order->workflow_state] ?? null;
            $assignedUserId = $order->assigned_to;

            if (!$assignedUserId && $stage) {
                $roleIdMap = [
                    'DRAW' => 'drawer_id',
                    'CHECK' => 'checker_id',
                    'DESIGN' => 'drawer_id',
                    'QA' => 'qa_id',
                ];

                $roleIdColumn = $roleIdMap[$stage] ?? null;
                if ($roleIdColumn && !empty($order->{$roleIdColumn})) {
                    $assignedUserId = (int) $order->{$roleIdColumn};
                }
            }

            $workItemQuery = WorkItem::where('project_id', $order->project_id)
                ->where('order_id', $order->id)
                ->where('status', 'in_progress');

            if ($stage) {
                $workItemQuery->where('stage', $stage);
            }

            if ($assignedUserId) {
                $workItemQuery->where('assigned_user_id', $assignedUserId);
            }

            $workItem = $workItemQuery->latest()->first();

            if ($workItem) {
                $workItem->update([
                    'status' => 'completed',
                    'completed_at' => now(),
                    'rework_reason' => $reason,
                ]);

                $assignedUserId = $assignedUserId ?: $workItem->assigned_user_id;
            }

            $order->update([
                'rejected_by' => $actor->id,
                'rejected_at' => now(),
                'rejection_reason' => $reason,
                'rejection_type' => 'cancelled',
            ]);

            StateMachine::transition($order, 'CANCELLED', $actor->id, [
                'cancel_reason' => $reason,
            ]);

            $order->update([
                'assigned_to' => null,
            ]);

            $existingCrm = DB::table('crm_order_assignments')
                ->where('project_id', $order->project_id)
                ->where('order_number', $order->order_number)
                ->first();

            $crmData = [
                'workflow_state' => 'CANCELLED',
                'assigned_to' => null,
                'updated_at' => now(),
            ];

            if ($existingCrm) {
                DB::table('crm_order_assignments')
                    ->where('id', $existingCrm->id)
                    ->update($crmData);
            } else {
                DB::table('crm_order_assignments')->insert(array_merge($crmData, [
                    'project_id' => $order->project_id,
                    'order_number' => $order->order_number,
                    'created_at' => now(),
                ]));
            }

            if ($assignedUserId) {
                User::where('id', $assignedUserId)
                    ->where('wip_count', '>', 0)
                    ->decrement('wip_count');
            }

            return $order->fresh();
        });
    }




    /**
     * Reassign work from an inactive/terminated user.
     */
    public static function reassignFromUser(User $user, ?int $actorId = null): int
    {
        $orders = collect();
        if ($user->project_id) {
            $orders = Order::forProject($user->project_id)
                ->where('assigned_to', $user->id)
                ->whereIn('workflow_state', [
                    'IN_DRAW', 'IN_CHECK', 'IN_QA', 'IN_DESIGN',
                ])
                ->get();
        }

        $count = 0;
        foreach ($orders as $order) {
            DB::transaction(function () use ($order, $user, $actorId) {
                $currentState = $order->workflow_state;
                $queueState = str_replace('IN_', 'QUEUED_', $currentState);

                // Revert work item
                $stage = StateMachine::STATE_TO_STAGE[$currentState] ?? null;
                WorkItem::where('project_id', $order->project_id)
                    ->where('order_id', $order->id)
                    ->where('stage', $stage)
                    ->where('assigned_user_id', $user->id)
                    ->where('status', 'in_progress')
                    ->update(['status' => 'abandoned', 'completed_at' => now()]);

                // Directly update state (admin override — bypasses state machine validation)
                $oldState = $order->workflow_state;
                $order->update([
                    'workflow_state' => $queueState,
                    'assigned_to' => null,
                ]);

                
                // Sync unassignment to CRM
                $existingCrm = DB::table('crm_order_assignments')
                    ->where('project_id', $order->project_id)
                    ->where('order_number', $order->order_number)
                    ->first();
                if ($existingCrm) {
                    DB::table('crm_order_assignments')->where('id', $existingCrm->id)->update([
                        'assigned_to'    => null,
                        'workflow_state'  => $queueState,
                        'updated_at'     => now(),
                    ]);
                }

                // Create audit log
                \App\Services\AuditService::log(
                    null,
                    'admin_reassign',
                    'Order',
                    $order->id,
                    $order->project_id,
                    ['workflow_state' => $oldState, 'assigned_to' => $user->id],
                    ['workflow_state' => $queueState, 'assigned_to' => null]
                );
            });
            $count++;
        }

        $user->update(['wip_count' => 0]);
        return $count;
    }

    /**
     * Find the best user for auto-assignment in a project queue.
     * Uses pre-computed assignment_score for intelligent selection.
     * Team constraint: for checker/QA roles, filters by team_id to ensure
     * all 3 layers (drawer → checker → QA) stay within the same team.
     * Minimum-2: prioritises workers who have fewer than 2 orders.
     */
    public static function findBestUser(int $projectId, string $role, ?string $orderType = null, ?int $teamId = null): ?User
    {
        $query = User::where('project_id', $projectId)
            ->where('role', $role)
            ->where('is_active', true)
            ->where('is_absent', false)
            ->where('last_activity', '>', now()->subMinutes(15))
            ->whereRaw('wip_count < wip_limit');

        // Team constraint: checker and QA must be from the same team as the order
        if ($teamId && in_array($role, ['checker', 'qa'])) {
            $query->where('team_id', $teamId);
        }

        // Minimum-2 prioritisation: workers with <2 orders get priority
        $query->orderByRaw('CASE WHEN wip_count < 2 THEN 0 ELSE 1 END ASC');

        // Phase 3: Skill matching
        if ($orderType && $orderType !== 'standard') {
            $query->orderByRaw("
                CASE WHEN skills IS NOT NULL AND JSON_CONTAINS(skills, ?, '$')
                THEN 0 ELSE 1 END ASC
            ", [json_encode($orderType)]);
        }

        return $query
            ->orderBy('assignment_score', 'desc')  // Weighted composite score
            ->orderBy('wip_count', 'asc')           // Tiebreak: least loaded
            ->orderBy('today_completed', 'asc')     // Tiebreak: fairness
            ->orderBy('last_activity', 'desc')      // Tiebreak: most recently active
            ->first();
    }

    // ── Private helpers ──

    private static function getQueueStateForRole(string $role, string $workflowType): ?string
    {
        if ($workflowType === 'PH_2_LAYER') {
            return match ($role) {
                'designer' => 'QUEUED_DESIGN',
                'qa'       => 'QUEUED_QA',
                default    => null,
            };
        }
        return match ($role) {
            'drawer'  => 'QUEUED_DRAW',
            'checker' => 'QUEUED_CHECK',
            'filler'  => 'QUEUED_FILLER',
            'qa'      => 'QUEUED_QA',
            default   => null,
        };
    }

    private static function resolveWorkflowTypeForUser(User $user, ?Project $project): string
    {
        if ($user->role === 'designer') {
            return 'PH_2_LAYER';
        }

        return $project->workflow_type ?? 'FP_3_LAYER';
    }

    private static function getInProgressStatesForRole(string $role, string $workflowType): array
    {
        if ($workflowType === 'PH_2_LAYER') {
            return match ($role) {
                'designer' => ['IN_DESIGN'],
                'qa'       => ['IN_QA'],
                default    => [],
            };
        }
        return match ($role) {
            'drawer'  => ['IN_DRAW'],
            'checker' => ['IN_CHECK'],
            'filler'  => ['IN_FILLER'],
            'qa'      => ['IN_QA'],
            default   => [],
        };
    }

    private static function getAttemptNumber(Order $order, ?string $stage): int
    {
        return match ($stage) {
            'DRAW'   => $order->attempt_draw + 1,
            'CHECK'  => $order->attempt_check + 1,
            'DESIGN' => $order->attempt_draw + 1,
            'QA'     => $order->attempt_qa + 1,
            default  => 1,
        };
    }

    /**
     * Sync order state to the per-project dynamic table (project_{id}_orders).
     * This keeps the Live QA dashboard in sync when orders are processed
     * through the new system's workflow.
     *
     * @param Order  $order  The freshly-updated order
     * @param User   $user   The worker performing the action
     * @param string $action 'start' or 'submit'
     */
    public static function syncToProjectTable(Order $order, User $user, string $action): void
    {
        try {
            // ── Build role-specific update fields first (used by both project table AND CRM) ──
            $updates = [
                'workflow_state' => $order->workflow_state,
                'status'         => $order->status,
                'current_layer'  => $order->current_layer,
                'assigned_to'    => $order->assigned_to,
                'updated_at'     => now(),
            ];

            $state = $order->workflow_state;
            $role = $user->role;
            $assignmentColumns = self::getRoleAssignmentColumns($role);
            $completionColumns = self::getRoleCompletionColumns($role);

            if ($action === 'start') {
                // Worker picked up the order
                if ($assignmentColumns['name_col']) {
                    $updates[$assignmentColumns['name_col']] = $user->name;
                }
                if ($assignmentColumns['id_col']) {
                    $updates[$assignmentColumns['id_col']] = $user->id;
                }
                if ($assignmentColumns['time_col']) {
                    $updates[$assignmentColumns['time_col']] = now()->toDateTimeString();
                }

                if ($role === 'designer') {
                    $updates['current_layer'] = 'designer';
                } elseif ($role === 'filler') {
                    $updates['current_layer'] = 'filler';
                }
            } elseif ($action === 'submit') {
                // Worker completed their stage
                if ($role === 'drawer' && in_array($state, ['SUBMITTED_DRAW', 'QUEUED_CHECK'], true)) {
                    if ($completionColumns['done_col']) {
                        $updates[$completionColumns['done_col']] = 'yes';
                    }
                    if ($completionColumns['date_col']) {
                        $updates[$completionColumns['date_col']] = now()->toDateTimeString();
                    }
                } elseif (
                    $role === 'checker'
                    && Project::checkerCompletesOrder((int) $order->project_id)
                    && in_array($state, ['DELIVERED', 'SUBMITTED_CHECK'], true)
                ) {
                    $timestamp = now()->toDateTimeString();
                    if ($completionColumns['done_col']) {
                        $updates[$completionColumns['done_col']] = 'yes';
                    }
                    if ($completionColumns['date_col']) {
                        $updates[$completionColumns['date_col']] = $timestamp;
                    }
                    $updates['final_upload'] = 'yes';
                    $updates['ausFinaldate'] = $timestamp;
                } elseif (
                    $role === 'checker'
                    && in_array($state, ['SUBMITTED_CHECK', 'QUEUED_QA', 'QUEUED_FILLER'], true)
                ) {
                    if ($completionColumns['done_col']) {
                        $updates[$completionColumns['done_col']] = 'yes';
                    }
                    if ($completionColumns['date_col']) {
                        $updates[$completionColumns['date_col']] = now()->toDateTimeString();
                    }
                    if ((int) $order->project_id === 12) {
                        $updates['current_layer'] = 'filler';
                    }
                } elseif ($role === 'designer' && in_array($state, ['SUBMITTED_DESIGN', 'QUEUED_QA'], true)) {
                    // Photos 2-layer: designer done
                    if ($completionColumns['done_col']) {
                        $updates[$completionColumns['done_col']] = 'yes';
                    }
                    if ($completionColumns['date_col']) {
                        $updates[$completionColumns['date_col']] = now()->toDateTimeString();
                    }
                    $updates['current_layer'] = 'qa';
                } elseif ($role === 'filler' && in_array($state, ['SUBMITTED_FILLER', 'QUEUED_QA'], true)) {
                    if ($completionColumns['done_col']) {
                        $updates[$completionColumns['done_col']] = 'yes';
                    }
                    if ($completionColumns['date_col']) {
                        $updates[$completionColumns['date_col']] = now()->toDateTimeString();
                    }
                    $updates['current_layer'] = 'qa';
                } elseif ($role === 'qa' && in_array($state, ['APPROVED_QA', 'DELIVERED'], true)) {
                    if ($completionColumns['done_col']) {
                        $updates[$completionColumns['done_col']] = 'yes';
                    }
                    if ($completionColumns['date_col']) {
                        $updates[$completionColumns['date_col']] = now()->toDateTimeString();
                    }
                }
            }

            // ── 1. Update project table (if row exists) ──
            $projectTable = ProjectOrderService::getTableName($order->project_id);
            if (Schema::hasTable($projectTable)) {
                $projectOrder = DB::table($projectTable)
                    ->where('order_number', $order->order_number)
                    ->first();

                if ($projectOrder) {
                    DB::table($projectTable)
                        ->where('order_number', $order->order_number)
                        ->update($updates);
                } else {
                    \Log::info('syncToProjectTable: order not found in project table (CRM still updated)', [
                        'order_number' => $order->order_number,
                        'project_id'   => $order->project_id,
                        'table'        => $projectTable,
                        'action'       => $action,
                    ]);
                }
            }

            // ── 2. ALWAYS persist to crm_order_assignments (survives cron sync) ──
            // IMPORTANT: Only write fields actively changed by this action.
            // Do NOT read other roles' columns from the project table ($order)
            // because an external sync may have wiped them — overwriting the
            // CRM's correct values with stale NULLs from the project table.
            $existingCrm = DB::table('crm_order_assignments')
                ->where('project_id', $order->project_id)
                ->where('order_number', $order->order_number)
                ->first();

            // Base CRM fields always updated
            $crmData = [
                'workflow_state' => $order->workflow_state,
                'assigned_to'    => $updates['assigned_to'] ?? $order->assigned_to,
                'updated_at'     => now(),
            ];

            // Only include role columns that were explicitly set by
            // the current action ($updates), NOT from $order (which may
            // contain stale data if external sync overwrote the project table).
            $roleFields = [
                'drawer_id', 'drawer_name', 'dassign_time',
                'checker_id', 'checker_name', 'cassign_time',
                'file_uploader_id', 'file_uploader_name', 'fassign_time',
                'qa_id', 'qa_name',
                'drawer_done', 'drawer_date',
                'checker_done', 'checker_date',
                'file_uploaded', 'file_upload_date',
                'final_upload', 'ausFinaldate',
                'current_layer',
            ];
            foreach ($roleFields as $field) {
                if (isset($updates[$field]) && Schema::hasColumn('crm_order_assignments', $field)) {
                    $crmData[$field] = $updates[$field];
                }
            }

            if ($existingCrm) {
                DB::table('crm_order_assignments')
                    ->where('id', $existingCrm->id)
                    ->update($crmData);
            } else {
                // New CRM row: safe to include all known values from the order
                // since there's no prior CRM data to preserve.
                $crmData['project_id']   = $order->project_id;
                $crmData['order_number'] = $order->order_number;
                $crmData['created_at']   = now();
                $crmData['drawer_id']    = $updates['drawer_id'] ?? $order->drawer_id;
                $crmData['drawer_name']  = $updates['drawer_name'] ?? $order->drawer_name;
                $crmData['checker_id']   = $updates['checker_id'] ?? $order->checker_id;
                $crmData['checker_name'] = $updates['checker_name'] ?? $order->checker_name;
                if (Schema::hasColumn('crm_order_assignments', 'file_uploader_id')) {
                    $crmData['file_uploader_id'] = $updates['file_uploader_id'] ?? $order->file_uploader_id ?? null;
                }
                if (Schema::hasColumn('crm_order_assignments', 'file_uploader_name')) {
                    $crmData['file_uploader_name'] = $updates['file_uploader_name'] ?? $order->file_uploader_name ?? null;
                }
                $crmData['qa_id']        = $updates['qa_id'] ?? $order->qa_id;
                $crmData['qa_name']      = $updates['qa_name'] ?? $order->qa_name;
                $crmData['dassign_time'] = $updates['dassign_time'] ?? $order->dassign_time;
                $crmData['cassign_time'] = $updates['cassign_time'] ?? $order->cassign_time;
                if (Schema::hasColumn('crm_order_assignments', 'fassign_time')) {
                    $crmData['fassign_time'] = $updates['fassign_time'] ?? $order->fassign_time ?? null;
                }
                DB::table('crm_order_assignments')->insert($crmData);
            }

        } catch (\Throwable $e) {
            // Log but don't break the workflow
            \Log::warning('syncToProjectTable failed', [
                'order_id'   => $order->id,
                'project_id' => $order->project_id,
                'action'     => $action,
                'error'      => $e->getMessage(),
            ]);
        }
    }

    private static function getRoleAssignmentColumns(string $role): array
    {
        $config = self::getRoleStageConfig($role);

        return [
            'id_col' => $config['id_column'] ?? null,
            'name_col' => $config['name_column'] ?? null,
            'time_col' => $config['assign_time_column'] ?? null,
        ];
    }

    private static function getRoleCompletionColumns(string $role): array
    {
        $config = self::getRoleStageConfig($role);

        return [
            'done_col' => $config['done_column'] ?? null,
            'date_col' => $config['done_date_column'] ?? null,
        ];
    }

    private static function getRoleStageConfig(string $role): array
    {
        $defaults = self::getDefaultRoleStageConfig();
        $configured = config("role_stage_columns.{$role}");

        if (!is_array($configured)) {
            return $defaults[$role] ?? [];
        }

        return array_replace($defaults[$role] ?? [], $configured);
    }

    private static function getDefaultRoleStageConfig(): array
    {
        return [
            'drawer' => [
                'id_column' => 'drawer_id',
                'name_column' => 'drawer_name',
                'assign_time_column' => 'dassign_time',
                'done_column' => 'drawer_done',
                'done_date_column' => 'drawer_date',
            ],
            'designer' => [
                'id_column' => 'drawer_id',
                'name_column' => 'drawer_name',
                'assign_time_column' => 'dassign_time',
                'done_column' => 'drawer_done',
                'done_date_column' => 'drawer_date',
            ],
            'checker' => [
                'id_column' => 'checker_id',
                'name_column' => 'checker_name',
                'assign_time_column' => 'cassign_time',
                'done_column' => 'checker_done',
                'done_date_column' => 'checker_date',
            ],
            'filler' => [
                'id_column' => 'file_uploader_id',
                'name_column' => 'file_uploader_name',
                'assign_time_column' => 'fassign_time',
                'done_column' => 'file_uploaded',
                'done_date_column' => 'file_upload_date',
            ],
            'qa' => [
                'id_column' => 'qa_id',
                'name_column' => 'qa_name',
                'assign_time_column' => null,
                'done_column' => 'final_upload',
                'done_date_column' => 'ausFinaldate',
            ],
        ];
    }
}