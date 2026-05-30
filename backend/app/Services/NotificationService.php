<?php

namespace App\Services;

use App\Models\Notification;
use App\Models\Order;
use App\Models\User;

/**
 * Centralized notification dispatch for all workflow events.
 */
class NotificationService
{
    /**
     * Order assigned to a worker via startNext.
     */
    public static function orderAssigned(Order $order, User $worker): void
    {
        Notification::send(
            $worker->id,
            'order_assigned',
            'New Order Assigned',
            "Order #{$order->order_number} has been assigned to you.",
            ['order_id' => $order->id, 'order_number' => $order->order_number, 'project_id' => $order->project_id],
            "/work"
        );
    }

    /**
     * Work submitted — notify managers and next-layer workers.
     */
    public static function workSubmitted(Order $order, User $submitter): void
    {
        // Notify project managers
        Notification::sendToProjectManagers(
            $order->project_id,
            'work_submitted',
            'Work Submitted',
            "{$submitter->name} submitted work on order #{$order->order_number}. New state: {$order->workflow_state}.",
            ['order_id' => $order->id, 'state' => $order->workflow_state, 'submitted_by' => $submitter->id],
            "/work"
        );

        // If order is DELIVERED, extra notification
        if ($order->workflow_state === 'DELIVERED') {
            Notification::sendToProjectManagers(
                $order->project_id,
                'order_delivered',
                'Order Delivered',
                "Order #{$order->order_number} has been delivered successfully!",
                ['order_id' => $order->id],
                "/work"
            );
        }
    }

    /**
     * Order rejected — notify the original worker and managers.
     */
    public static function orderRejected(Order $order, User $rejector, string $reason): void
    {
        // Notify managers
        Notification::sendToProjectManagers(
            $order->project_id,
            'order_rejected',
            'Order Rejected',
            "{$rejector->name} rejected order #{$order->order_number}: {$reason}",
            ['order_id' => $order->id, 'rejected_by' => $rejector->id, 'reason' => $reason],
            "/work"
        );

        // Notify workers in the queue the order is returning to
        $queueRole = match ($order->workflow_state) {
            'QUEUED_DRAW' => 'drawer',
            'QUEUED_CHECK' => 'checker',
            'QUEUED_DESIGN' => 'designer',
            'QUEUED_QA' => 'qa',
            default => null,
        };

        if ($queueRole) {
            $workers = User::where('project_id', $order->project_id)
                ->where('role', $queueRole)
                ->where('is_active', true)
                ->pluck('id')
                ->toArray();

            Notification::sendToMany(
                $workers,
                'order_returned',
                'Rejected Order in Queue',
                "Order #{$order->order_number} was rejected and returned to your queue for rework.",
                ['order_id' => $order->id, 'reason' => $reason],
                "/work"
            );
        }
    }
    
    
        /**
     * Order cancelled.
     */
    public static function orderCancelled(Order $order, User $actor, string $reason): void
    {
        Notification::sendToProjectManagers(
            $order->project_id,
            'order_cancelled',
            'Order Cancelled',
            "{$actor->name} cancelled order #{$order->order_number}: {$reason}",
            ['order_id' => $order->id, 'cancelled_by' => $actor->id, 'reason' => $reason],
            "/work"
        );
    }

    

    /**
     * New order received into the system.
     */
    public static function orderReceived(Order $order, User $receiver): void
    {
        Notification::sendToProjectManagers(
            $order->project_id,
            'order_received',
            'New Order Received',
            "New order #{$order->order_number} received for project (#{$order->project_id}).",
            ['order_id' => $order->id, 'client_reference' => $order->client_reference],
            "/work"
        );
    }

    /**
     * Order placed on hold.
     */
    public static function orderOnHold(Order $order, User $actor, string $reason): void
    {
        Notification::sendToProjectManagers(
            $order->project_id,
            'order_on_hold',
            'Order On Hold',
            "Order #{$order->order_number} placed on hold by {$actor->name}: {$reason}",
            ['order_id' => $order->id, 'reason' => $reason],
            "/work"
        );
    }

    /**
     * Order resumed from hold.
     */
    public static function orderResumed(Order $order, User $actor): void
    {
        Notification::sendToProjectManagers(
            $order->project_id,
            'order_resumed',
            'Order Resumed',
            "Order #{$order->order_number} has been resumed by {$actor->name}.",
            ['order_id' => $order->id],
            "/work"
        );
    }

    /**
     * User deactivated.
     */
    public static function userDeactivated(User $target, User $actor): void
    {
        Notification::sendToRole(
            'ceo',
            'user_deactivated',
            'User Deactivated',
            "{$target->name} has been deactivated by {$actor->name}.",
            ['user_id' => $target->id, 'deactivated_by' => $actor->id],
            "/users"
        );
        Notification::sendToRole(
            'director',
            'user_deactivated',
            'User Deactivated',
            "{$target->name} has been deactivated by {$actor->name}.",
            ['user_id' => $target->id, 'deactivated_by' => $actor->id],
            "/users"
        );
    }

    /**
     * Force logout of a user.
     */
    public static function forceLogout(User $target, User $actor): void
    {
        // Notify the target user (they'll see it next time they log in)
        Notification::send(
            $target->id,
            'force_logout',
            'Session Terminated',
            "Your session was terminated by {$actor->name}.",
            ['terminated_by' => $actor->id],
            null
        );
    }

    /**
     * Invoice status changed.
     */
    public static function invoiceTransition(int $invoiceId, string $fromStatus, string $toStatus, User $actor): void
    {
        $userIds = User::whereIn('role', ['ceo', 'director'])
            ->where('is_active', true)
            ->where('id', '!=', $actor->id) // Don't notify the actor
            ->pluck('id')
            ->toArray();

        Notification::sendToMany(
            $userIds,
            'invoice_transition',
            'Invoice Status Updated',
            "Invoice #{$invoiceId} moved from {$fromStatus} to {$toStatus} by {$actor->name}.",
            ['invoice_id' => $invoiceId, 'from' => $fromStatus, 'to' => $toStatus],
            "/invoices"
        );
    }

    /**
     * Month locked for a project.
     */
    public static function monthLocked(int $projectId, int $month, int $year, User $actor): void
    {
        $monthName = date('F', mktime(0, 0, 0, $month, 1));
        Notification::sendToProjectManagers(
            $projectId,
            'month_locked',
            'Month Locked',
            "{$monthName} {$year} has been locked for project #{$projectId} by {$actor->name}.",
            ['project_id' => $projectId, 'month' => $month, 'year' => $year],
            "/invoices"
        );
    }

    /**
     * Worker went inactive - order auto-reassigned.
     */
    public static function workerInactive(int $orderId, ?int $previousUserId, ?int $projectId = null): void
    {
        $previousUser = $previousUserId ? User::find($previousUserId) : null;
        $userName = $previousUser?->name ?? 'Unknown user';

        if (!$projectId) {
            // Fallback: scan project tables
            $projectId = \App\Services\ProjectOrderService::findProjectForOrder($orderId);
        }
        if (!$projectId) return;

        Notification::sendToProjectManagers(
            $projectId,
            'worker_inactive',
            'Worker Inactive',
            "Order #{$orderId} was auto-reassigned because {$userName} became inactive.",
            ['order_id' => $orderId, 'previous_user_id' => $previousUserId],
            "/workflow/orders/{$orderId}"
        );
    }
}
