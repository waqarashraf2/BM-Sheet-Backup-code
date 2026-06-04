<?php

namespace App\Jobs;

use App\Models\Order;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Pre-compute and cache dashboard statistics for fast retrieval.
 * Scheduled to run every minute for real-time stats.
 */
class RefreshDashboardCache implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;
    public int $timeout = 60;

    public function handle(): void
    {
        Log::debug('RefreshDashboardCache: Refreshing dashboard statistics');

        // Org-wide stats (for CEO/Director dashboard)
        $this->cacheOrgStats();

        // Per-project stats (for project drilldown)
        $this->cacheProjectStats();

        Log::debug('RefreshDashboardCache: Completed');
    }

    private function cacheOrgStats(): void
    {
        // Aggregate order stats across all active projects
        $activeProjects = Project::where('status', 'active')->get(['id']);
        $totalOrders = 0;
        $pendingOrders = 0;
        $deliveredToday = 0;
        $deliveredWeek = 0;
        $deliveredMonth = 0;
        $receivedToday = 0;
        $slaBreaches = 0;

        foreach ($activeProjects as $proj) {
            $totalOrders += Order::forProject($proj->id)->count();
            $pendingOrders += Order::forProject($proj->id)
                ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])->count();
            $deliveredToday += Order::forProject($proj->id)
                ->where('workflow_state', 'DELIVERED')
                ->whereDate('delivered_at', today())->count();
            $deliveredWeek += Order::forProject($proj->id)
                ->where('workflow_state', 'DELIVERED')
                ->where('delivered_at', '>=', now()->startOfWeek())->count();
            $deliveredMonth += Order::forProject($proj->id)
                ->where('workflow_state', 'DELIVERED')
                ->where('delivered_at', '>=', now()->startOfMonth())->count();
            $receivedToday += Order::forProject($proj->id)
                ->whereDate('received_at', today())->count();
            $slaBreaches += Order::forProject($proj->id)
                ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                ->whereNotNull('due_date')
                ->where('due_date', '<', now())->count();
        }

        $stats = [
            'total_projects' => $activeProjects->count(),
            'total_orders' => $totalOrders,
            'pending_orders' => $pendingOrders,
            'delivered_today' => $deliveredToday,
            'delivered_week' => $deliveredWeek,
            'delivered_month' => $deliveredMonth,
            'received_today' => $receivedToday,
            'sla_breaches' => $slaBreaches,
            'total_staff' => User::where('is_active', true)
                ->whereIn('role', ['drawer', 'checker', 'designer', 'qa'])->count(),
            'active_staff' => User::where('is_active', true)
                ->where('is_absent', false)
                ->where('last_activity', '>', now()->subMinutes(15))->count(),
            'absent_staff' => User::where('is_active', true)->where('is_absent', true)->count(),
            'inactive_flagged' => User::where('is_active', true)->where('inactive_days', '>=', 15)->count(),
            'computed_at' => now()->toIso8601String(),
        ];

        Cache::put('dashboard:org_stats', $stats, 120); // 2 minutes
    }

    private function cacheProjectStats(): void
    {
        $projects = Project::where('status', 'active')->get(['id', 'code']);

        foreach ($projects as $project) {
            $stats = [
                'total_orders' => Order::forProject($project->id)->count(),
                'pending' => Order::forProject($project->id)
                    ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])->count(),
                'delivered_today' => Order::forProject($project->id)
                    ->where('workflow_state', 'DELIVERED')
                    ->whereDate('delivered_at', today())->count(),
                'received_today' => Order::forProject($project->id)
                    ->whereDate('received_at', today())->count(),
                'on_hold' => Order::forProject($project->id)
                    ->where('workflow_state', 'ON_HOLD')->count(),
                'sla_breaches' => Order::forProject($project->id)
                    ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                    ->whereNotNull('due_date')
                    ->where('due_date', '<', now())->count(),
                'state_counts' => Order::forProject($project->id)
                    ->selectRaw('workflow_state, COUNT(*) as count')
                    ->groupBy('workflow_state')
                    ->pluck('count', 'workflow_state')
                    ->toArray(),
                'today_completions' => WorkItem::where('project_id', $project->id)
                    ->where('status', 'completed')
                    ->whereDate('completed_at', today())
                    ->count(),
                'computed_at' => now()->toIso8601String(),
            ];

            Cache::put("dashboard:project:{$project->id}", $stats, 120);
        }
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('RefreshDashboardCache job failed', [
            'error' => $exception->getMessage(),
        ]);
    }
}
