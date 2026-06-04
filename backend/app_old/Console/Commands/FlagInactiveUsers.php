<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Models\Order;
use App\Services\AuditService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Flag users inactive for 15+ days per CEO requirements.
 * 
 * Per CEO Document:
 * - If login inactive 15 days → auto-flagged
 * - If user leaves → login immediately deactivated
 * - Orders auto-reassigned when user is absent
 */
class FlagInactiveUsers extends Command
{
    protected $signature = 'users:flag-inactive {--days=15 : Days of inactivity before flagging}';
    protected $description = 'Flag users who have been inactive for 15+ days and reassign their orders';

    public function handle()
    {
        $inactiveDays = (int) $this->option('days');
        $cutoffDate = now()->subDays($inactiveDays);
        
        $this->info("Checking for users inactive since {$cutoffDate->toDateString()}...");

        // Find users who:
        // 1. Are active but haven't logged in for 15+ days
        // 2. Have orders assigned to them
        $inactiveUsers = User::where('is_active', true)
            ->where(function ($query) use ($cutoffDate) {
                $query->whereNull('last_activity')
                    ->orWhere('last_activity', '<', $cutoffDate);
            })
            ->get();

        $flaggedCount = 0;
        $reassignedOrdersCount = 0;

        foreach ($inactiveUsers as $user) {
            // Calculate inactive days
            $inactiveDaysCount = $user->last_activity 
                ? $user->last_activity->diffInDays(now()) 
                : $inactiveDays;

            // Update inactive_days field
            $user->update([
                'inactive_days' => $inactiveDaysCount,
                'is_absent' => true, // Mark as absent for reassignment
            ]);

            // Log the flagging
            AuditService::log(
                null, // System action
                'USER_FLAGGED_INACTIVE',
                'User',
                $user->id,
                $user->project_id,
                ['inactive_days' => $user->getOriginal('inactive_days'), 'is_absent' => $user->getOriginal('is_absent')],
                ['inactive_days' => $inactiveDaysCount, 'is_absent' => true, 'reason' => "Auto-flagged after {$inactiveDaysCount} days of inactivity"]
            );

            $flaggedCount++;

            // Reassign any orders currently assigned to this user
            $assignedOrders = $user->project_id
                ? Order::forProject($user->project_id)
                    ->where('assigned_to', $user->id)
                    ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED', 'ON_HOLD'])
                    ->get()
                : collect();

            foreach ($assignedOrders as $order) {
                // Unassign the order so it goes back to queue
                $previousAssignment = $order->assigned_to;
                $currentState = $order->workflow_state;
                $newState = str_starts_with($currentState, 'IN_')
                    ? str_replace('IN_', 'QUEUED_', $currentState)
                    : $currentState;
                $order->update([
                    'assigned_to' => null,
                    'workflow_state' => $newState,
                    'status' => 'pending',
                ]);

                // Sync unassignment to CRM
                $existingCrm = \Illuminate\Support\Facades\DB::table('crm_order_assignments')
                    ->where('project_id', $order->project_id)
                    ->where('order_number', $order->order_number)
                    ->first();
                if ($existingCrm) {
                    \Illuminate\Support\Facades\DB::table('crm_order_assignments')
                        ->where('id', $existingCrm->id)
                        ->update([
                            'assigned_to'    => null,
                            'workflow_state'  => $newState,
                            'updated_at'     => now(),
                        ]);
                }

                AuditService::log(
                    null,
                    'ORDER_AUTO_REASSIGNED',
                    'Order',
                    $order->id,
                    $order->project_id,
                    ['assigned_to' => $previousAssignment],
                    ['assigned_to' => null, 'reason' => "User {$user->name} flagged inactive after {$inactiveDaysCount} days"]
                );

                $reassignedOrdersCount++;
            }

            // Update WIP count
            $user->update(['wip_count' => 0]);

            $this->line("  - Flagged: {$user->name} ({$user->email}) - {$inactiveDaysCount} days inactive, {$assignedOrders->count()} orders reassigned");
        }

        $this->info("Done! Flagged {$flaggedCount} users, reassigned {$reassignedOrdersCount} orders.");

        return Command::SUCCESS;
    }
}
