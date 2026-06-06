<?php

namespace App\Services;

use App\Models\Order;
use App\Models\Project;
use App\Models\WorkItem;
use InvalidArgumentException;

class StateMachine
{
    // ── Floor Plan (3-layer) states ──
    // New flow: RECEIVED → PENDING_QA_REVIEW (PM assigns to QA) → QUEUED_DRAW (QA assigns to drawer)
    const FP_STATES = [
        'RECEIVED', 'PENDING_QA_REVIEW', 'QUEUED_DRAW', 'IN_DRAW', 'SUBMITTED_DRAW',
        'QUEUED_CHECK', 'IN_CHECK', 'REJECTED_BY_CHECK', 'SUBMITTED_CHECK',
        'QUEUED_FILLER', 'IN_FILLER', 'SUBMITTED_FILLER',
        'QUEUED_QA', 'IN_QA', 'REJECTED_BY_QA', 'APPROVED_QA',
        'DELIVERED', 'ON_HOLD', 'CANCELLED',
    ];

    // ── Photos (2-layer) states ──
    const PH_STATES = [
        'RECEIVED', 'QUEUED_DESIGN', 'IN_DESIGN', 'SUBMITTED_DESIGN',
        'QUEUED_QA', 'IN_QA', 'REJECTED_BY_QA', 'APPROVED_QA',
        'DELIVERED', 'ON_HOLD', 'CANCELLED',
    ];

    // ── Allowed transitions: [from => [to1, to2, ...]] ──
    // PM assigns to QA supervisor → QA assigns to drawer → normal flow
    const FP_TRANSITIONS = [
        'RECEIVED'           => ['PENDING_QA_REVIEW', 'QUEUED_DRAW', 'ON_HOLD', 'CANCELLED'],
        'PENDING_QA_REVIEW'  => ['QUEUED_DRAW', 'ON_HOLD', 'CANCELLED'],
        'QUEUED_DRAW'        => ['IN_DRAW', 'ON_HOLD', 'CANCELLED'],
        'IN_DRAW'            => ['SUBMITTED_DRAW', 'ON_HOLD', 'CANCELLED'],
        'SUBMITTED_DRAW'     => ['QUEUED_CHECK'],
        'QUEUED_CHECK'       => ['IN_CHECK', 'ON_HOLD', 'CANCELLED'],
        'IN_CHECK'           => ['SUBMITTED_CHECK', 'REJECTED_BY_CHECK', 'ON_HOLD', 'CANCELLED'],
        'REJECTED_BY_CHECK'  => ['QUEUED_DRAW'],
        'SUBMITTED_CHECK'    => ['QUEUED_QA', 'QUEUED_FILLER'],
        'QUEUED_FILLER'      => ['IN_FILLER', 'ON_HOLD', 'CANCELLED'],
        'IN_FILLER'          => ['SUBMITTED_FILLER', 'ON_HOLD', 'CANCELLED'],
        'SUBMITTED_FILLER'   => ['QUEUED_QA'],
        'QUEUED_QA'          => ['IN_QA', 'ON_HOLD', 'CANCELLED'],
        'IN_QA'              => ['APPROVED_QA', 'REJECTED_BY_QA', 'ON_HOLD', 'CANCELLED'],
        'REJECTED_BY_QA'     => ['QUEUED_CHECK', 'QUEUED_DRAW'],
        'APPROVED_QA'        => ['DELIVERED'],
        'ON_HOLD'            => ['QUEUED_DRAW', 'QUEUED_CHECK', 'QUEUED_FILLER', 'QUEUED_QA'],
        'DELIVERED'          => [],
        'CANCELLED'          => [],
    ];

    const PH_TRANSITIONS = [
        'RECEIVED'           => ['QUEUED_DESIGN', 'ON_HOLD', 'CANCELLED'],
        'QUEUED_DESIGN'      => ['IN_DESIGN', 'ON_HOLD', 'CANCELLED'],
        'IN_DESIGN'          => ['SUBMITTED_DESIGN', 'ON_HOLD', 'CANCELLED'],
        'SUBMITTED_DESIGN'   => ['QUEUED_QA'],
        'QUEUED_QA'          => ['IN_QA', 'ON_HOLD', 'CANCELLED'],
        'IN_QA'              => ['APPROVED_QA', 'REJECTED_BY_QA', 'ON_HOLD', 'CANCELLED'],
        'REJECTED_BY_QA'     => ['QUEUED_DESIGN'],
        'APPROVED_QA'        => ['DELIVERED'],
        'ON_HOLD'            => ['QUEUED_DESIGN', 'QUEUED_QA'],
        'DELIVERED'          => [],
        'CANCELLED'          => [],
    ];

    // Map states to the role/stage that works on them
    const STATE_TO_STAGE = [
        'QUEUED_DRAW'   => 'DRAW',   'IN_DRAW'    => 'DRAW',   'SUBMITTED_DRAW'   => 'DRAW',
        'QUEUED_CHECK'  => 'CHECK',  'IN_CHECK'   => 'CHECK',  'SUBMITTED_CHECK'  => 'CHECK',
        'QUEUED_FILLER' => 'FILL',   'IN_FILLER'  => 'FILL',   'SUBMITTED_FILLER' => 'FILL',
        'QUEUED_DESIGN' => 'DESIGN', 'IN_DESIGN'  => 'DESIGN', 'SUBMITTED_DESIGN' => 'DESIGN',
        'QUEUED_QA'     => 'QA',     'IN_QA'      => 'QA',
    ];

    // Map stages to user roles
    const STAGE_TO_ROLE = [
        'DRAW'   => 'drawer',
        'CHECK'  => 'checker',
        'FILL'   => 'filler',
        'DESIGN' => 'designer',
        'QA'     => 'qa',
    ];

    // Roles that can set ON_HOLD
    const HOLD_ALLOWED_ROLES = ['checker', 'qa', 'operations_manager', 'director', 'ceo'];

    /**
     * Check if a transition is valid.
     */
    public static function canTransition(Order $order, string $toState): bool
    {
        if (
            $order->workflow_type !== 'PH_2_LAYER'
            && $order->workflow_state === 'SUBMITTED_CHECK'
            && $toState === 'DELIVERED'
            && Project::checkerCompletesOrder((int) $order->project_id)
        ) {
            return true;
        }

        $transitions = $order->workflow_type === 'PH_2_LAYER'
            ? self::PH_TRANSITIONS
            : self::FP_TRANSITIONS;

        $from = $order->workflow_state;
        return isset($transitions[$from]) && in_array($toState, $transitions[$from]);
    }

    /**
     * Execute a state transition on an order.
     * Returns true on success, throws on invalid.
     */
    public static function transition(Order $order, string $toState, ?int $actorUserId = null, ?array $meta = []): Order
    {
        if (!self::canTransition($order, $toState)) {
            throw new InvalidArgumentException(
                "Invalid transition: {$order->workflow_state} → {$toState} for order #{$order->id}"
            );
        }

        $fromState = $order->workflow_state;
        $updates = ['workflow_state' => $toState];

        // Handle stage-specific timestamps
        if (str_starts_with($toState, 'IN_')) {
            $updates['started_at'] = now();
        }
        if ($toState === 'DELIVERED') {
            $updates['delivered_at'] = now();
            $updates['completed_at'] = now();
            $updates['status'] = 'completed';
        }
        if ($toState === 'CANCELLED') {
            $updates['status'] = 'cancelled';
        }
        if ($toState === 'ON_HOLD') {
            $updates['is_on_hold'] = true;
            $updates['hold_reason'] = $meta['hold_reason'] ?? null;
            $updates['hold_set_by'] = $actorUserId;
        }
        if ($fromState === 'ON_HOLD') {
            $updates['is_on_hold'] = false;
            $updates['hold_reason'] = null;
            $updates['hold_set_by'] = null;
        }

        // Handle rejection counters
        if ($toState === 'REJECTED_BY_CHECK') {
            $updates['attempt_check'] = $order->attempt_check + 1;
        }
        if ($toState === 'REJECTED_BY_QA') {
            $updates['attempt_qa'] = $order->attempt_qa + 1;
        }
        if (in_array($toState, ['QUEUED_DRAW', 'QUEUED_DESIGN']) && str_contains($fromState, 'REJECTED')) {
            $updates['attempt_draw'] = $order->attempt_draw + 1;
        }

        // Clear assignment when entering QUEUED states
        if (str_starts_with($toState, 'QUEUED_')) {
            $updates['assigned_to'] = null;
        }

        // Set status for active states
        if (str_starts_with($toState, 'IN_')) {
            $updates['status'] = 'in-progress';
        } elseif (str_starts_with($toState, 'QUEUED_') || $toState === 'RECEIVED') {
            $updates['status'] = 'pending';
        } elseif (str_starts_with($toState, 'SUBMITTED_') || $toState === 'APPROVED_QA') {
            $updates['status'] = 'pending';
        }

        $order->update($updates);

        // Audit log
        AuditService::log(
            $actorUserId,
            'STATE_CHANGE',
            'Order',
            $order->id,
            $order->project_id,
            ['state' => $fromState, 'assigned_to' => $order->getOriginal('assigned_to')],
            ['state' => $toState, 'assigned_to' => $order->assigned_to] + ($meta ?? [])
        );

        return $order->fresh();
    }

    /**
     * Get stages for a workflow type.
     */
    public static function getStages(string $workflowType): array
    {
        return $workflowType === 'PH_2_LAYER'
            ? ['DESIGN', 'QA']
            : ['DRAW', 'CHECK', 'QA'];
    }

    /**
     * Get the next queue state after submission.
     */
    public static function getNextQueueState(string $currentState, string $workflowType, ?int $projectId = null): ?string
    {
        $map = $workflowType === 'PH_2_LAYER'
            ? ['SUBMITTED_DESIGN' => 'QUEUED_QA', 'APPROVED_QA' => 'DELIVERED']
            : [
                'SUBMITTED_DRAW' => 'QUEUED_CHECK',
                'SUBMITTED_CHECK' => $projectId === 12
                    ? 'QUEUED_FILLER'
                    : (Project::checkerCompletesOrder($projectId) ? 'DELIVERED' : 'QUEUED_QA'),
                'SUBMITTED_FILLER' => 'QUEUED_QA',
                'APPROVED_QA' => 'DELIVERED',
            ];

        return $map[$currentState] ?? null;
    }

    /**
     * Get the role required for a given state.
     */
    public static function getRoleForState(string $state): ?string
    {
        $stage = self::STATE_TO_STAGE[$state] ?? null;
        return $stage ? (self::STAGE_TO_ROLE[$stage] ?? null) : null;
    }

    /**
     * Get all queued states for a workflow type.
     */
    public static function getQueuedStates(string $workflowType): array
    {
        return $workflowType === 'PH_2_LAYER'
            ? ['QUEUED_DESIGN', 'QUEUED_QA']
            : ['QUEUED_DRAW', 'QUEUED_CHECK', 'QUEUED_FILLER', 'QUEUED_QA'];
    }

    /**
     * Get the IN_ state for a given QUEUED_ state.
     */
    public static function getInProgressState(string $queuedState): ?string
    {
        $map = [
            'QUEUED_DRAW'   => 'IN_DRAW',
            'QUEUED_CHECK'  => 'IN_CHECK',
            'QUEUED_FILLER' => 'IN_FILLER',
            'QUEUED_DESIGN' => 'IN_DESIGN',
            'QUEUED_QA'     => 'IN_QA',
        ];
        return $map[$queuedState] ?? null;
    }

    /**
     * Get the SUBMITTED_ state for a given IN_ state.
     */
    public static function getSubmittedState(string $inState): ?string
    {
        $map = [
            'IN_DRAW'   => 'SUBMITTED_DRAW',
            'IN_CHECK'  => 'SUBMITTED_CHECK',
            'IN_FILLER' => 'SUBMITTED_FILLER',
            'IN_DESIGN' => 'SUBMITTED_DESIGN',
            'IN_QA'     => 'APPROVED_QA',
        ];
        return $map[$inState] ?? null;
    }
}
