<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\Invoice;
use App\Models\Project;
use App\Models\User;
use App\Models\WorkItem;
use App\Services\StateMachine;
use App\Services\ProjectOrderService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class DashboardController extends Controller
{
    private const DEFAULT_PROJECT_TIMEZONE = 'Asia/Karachi';
    private const ASSIGNMENT_DASHBOARD_STORAGE_TIMEZONE = 'Asia/Karachi';
    private const ASSIGNMENT_DASHBOARD_VIETNAM_PROJECT_ID = 16;
    private const ASSIGNMENT_DASHBOARD_VIETNAM_TIMEZONE = 'Asia/Ho_Chi_Minh';
    private const ASSIGNMENT_DASHBOARD_DUE_IN_OFFSETS = [
        16 => 2,
        2  => 0,  // Project 2 (Focal PB) stores due_in as naive UTC; +5h converts to PKT for frontend
    ];
    // Projects whose due_in column stores naive UTC timestamps (not PKT)
    private const BATCH_STATUS_UTC_DUE_IN_PROJECT_IDS = [2, 5];
    private const ASSIGNMENT_DASHBOARD_SPECIAL_PRIORITY_PROJECT_IDS = [1, 3,];
    private const ASSIGNMENT_DASHBOARD_SPECIAL_PROJECTS_PER_PAGE = 100;

    /**
     * Business day bounds — the "today" window starts at 05:00 PKT.
     * Before 05:00 PKT we are still in the previous business day.
     * Result is cached per request instance.
     * Returns [Carbon $start, Carbon $end] both in Asia/Karachi.
     */
    private function businessDayBounds(): array
    {
        static $cache = null;
        if ($cache === null) {
            // Business day: 05:00 PKT → 05:00 PKT next day = 00:00 UTC → 00:00 UTC next day
            // (5 AM PKT aligns exactly with midnight UTC, so UTC DATE() comparisons work correctly)
            $now = now('Asia/Karachi');
            $start = $now->copy()->startOfDay()->addHours(5); // 05:00 PKT today
            if ($now->lt($start)) {
                $start->subDay(); // before 05:00 → still in previous business day
            }
            // Convert to UTC so comparisons work against UTC-stored TIMESTAMP columns
            $startUtc = $start->copy()->utc();
            $endUtc   = $start->copy()->addDay()->utc();
            $cache = [$startUtc, $endUtc];
        }
        return $cache;
    }

    
    
public function batchStatusReport(Request $request)
{
    try {

        $projectId = $request->query('project_id');

/*
|--------------------------------------------------------------------------
| Default Pakistan Date
|--------------------------------------------------------------------------
*/
$pkNow = now('Asia/Karachi');

if ($request->query('date')) {
    $date = $request->query('date');
} else {

    if ($pkNow->hour >= 22) {
        $date = $pkNow->copy()->addDay()->toDateString();
    } else {
        $date = $pkNow->toDateString();
    }
}

        /*
        |--------------------------------------------------------------------------
        | Pakistan Shift Based on Selected Date
        |--------------------------------------------------------------------------
        */
        $selectedDatePkt = \Carbon\Carbon::parse($date, 'Asia/Karachi');
        $batchNowPkt = now('Asia/Karachi')->format('Y-m-d H:i:s');

        // 29 10 PM
        $shiftStartPkt = $selectedDatePkt->copy()->subDay()->setTime(22, 0, 0);

        // 30 10 PM
        $shiftEndPkt = $selectedDatePkt->copy()->setTime(22, 0, 0);

        /*
        |--------------------------------------------------------------------------
        | Convert PKT → UTC
        |--------------------------------------------------------------------------
        */
        $shiftStartUtc = $shiftStartPkt->copy()->setTimezone('UTC');
        $shiftEndUtc = $shiftEndPkt->copy()->setTimezone('UTC');
        $shiftStartLocal = $shiftStartPkt->format('Y-m-d H:i:s');
        $shiftEndLocal = $shiftEndPkt->format('Y-m-d H:i:s');

        /*
        |--------------------------------------------------------------------------
        | Get Active Projects
        |--------------------------------------------------------------------------
        */
        $projects = Project::where('status', 'active');

        if ($projectId) {
            $projects->where('id', $projectId);
        }

        $projects = $projects->get();

        if ($projects->isEmpty()) {
            return response()->json([
                'success' => false,
                'message' => 'No projects found'
            ], 404);
        }

        $projectIds = $projects->pluck('id')->toArray();

        $selectCols = 'id, order_number, project_id, batch_number, received_at, workflow_state, assigned_to, drawer_id, completed_at, due_in';

        // For batch report, due_in already stores the final absolute deadline.
        // Do not re-apply the assignment dashboard's project-16 offset here,
        // otherwise the batch buckets drift by about an extra hour or more.
        $batchDueInExpr = 'due_in';

        $rawUnion = $this->buildQueueUnionQuery(
            $projectIds,
            $selectCols,
            []
        );

        /*
        |--------------------------------------------------------------------------
        | TODAY ORDERS (10 PM → 10 PM based strictly on received_at)
        |--------------------------------------------------------------------------
        */
        $query = DB::table(DB::raw("({$rawUnion}) as orders"))
            ->selectRaw("
                orders.*,
                CASE
                    WHEN due_in IS NOT NULL THEN GREATEST(TIMESTAMPDIFF(MINUTE, ?, {$batchDueInExpr}), 0)
                    ELSE NULL
                END as batch_remaining_minutes,
                CASE
                    WHEN received_at IS NOT NULL AND due_in IS NOT NULL
                        THEN GREATEST(TIMESTAMPDIFF(MINUTE, received_at, {$batchDueInExpr}), 0)
                    ELSE NULL
                END as batch_due_duration_minutes
            ", [$batchNowPkt])
            ->where('received_at', '>=', $shiftStartLocal)
            ->where('received_at', '<', $shiftEndLocal);

        if ($projectId) {
            $query->where('project_id', $projectId);
        }

        $orders = $query->get();

        /*
        |--------------------------------------------------------------------------
        | ALL TIME ORDERS
        |--------------------------------------------------------------------------
        */
        $statusWindowQuery = DB::table(DB::raw("({$rawUnion}) as orders"))
            ->where('received_at', '>=', $shiftStartLocal)
            ->where('received_at', '<', $shiftEndLocal);

        if ($projectId) {
            $statusWindowQuery->where('project_id', $projectId);
        }

        $statusWindowOrders = $statusWindowQuery->get();

        /*
        |--------------------------------------------------------------------------
        | Batch Summary (use filtered orders directly)
        |--------------------------------------------------------------------------
        */
        $ordersForBatches = $orders;

        $batches = $ordersForBatches
            ->whereNotNull('batch_number')
            ->groupBy('batch_number')
            ->map(function ($items, $batchNo) {
                $minReceived = \Carbon\Carbon::parse(
                    $items->min('received_at'),
                    'Asia/Karachi'
                );

                $activeOrders = $items->filter(
                    fn($o) =>
                    $o->workflow_state !== 'DELIVERED'
                        && !empty($o->due_in)
                );

                $remainingTimes = $activeOrders
                    ->pluck('batch_remaining_minutes')
                    ->filter(fn($minutes) => $minutes !== null)
                    ->map(fn($minutes) => (int) $minutes);

                $minRemaining = $remainingTimes->min() ?? 0;
                $maxRemaining = $remainingTimes->max() ?? 0;

                $dueDurations = $items
                    ->pluck('batch_due_duration_minutes')
                    ->filter(fn($minutes) => $minutes !== null)
                    ->map(fn($minutes) => (int) $minutes);

                $minDueDuration = $dueDurations->min() ?? 0;
                $maxDueDuration = $dueDurations->max() ?? 0;

                return [
                    'batch_no' => $batchNo,
                    'batch_label' => 'Batch ' . str_pad((string) $batchNo, 2, '0', STR_PAD_LEFT),
                    'received_time' => $minReceived->format('h:i A'),
                    'received_time_full' => $minReceived->format('h:i:s A'),
                    'remaining_minutes' => $minRemaining,
                    'remaining_time' =>
                        floor($minDueDuration / 60) . 'h ' .
                        ($minDueDuration % 60) . 'm - ' .
                        floor($maxDueDuration / 60) . 'h ' .
                        ($maxDueDuration % 60) . 'm',
                    'plans' => $items->count(),
                    'done' => $items->where('workflow_state', 'DELIVERED')->count(),
                    'pending' => $items->filter(
                        fn($o) => !in_array(
                            $o->workflow_state,
                            ['DELIVERED', 'CANCELLED']
                        )
                    )->count(),
                    'fixing' => $items->where('workflow_state', 'PENDING_BY_DRAWER')->count(),
                    'drawing' => $items->where('workflow_state', 'IN_DRAW')->count(),
                    'min_remaining_minutes' => $minRemaining,
                    'max_remaining_minutes' => $maxRemaining,
                ];
            })
            ->sortBy(fn($b) => (int)$b['batch_no'])
            ->values();

        /*
        |--------------------------------------------------------------------------
        | Total Summary
        |--------------------------------------------------------------------------
        */
        $totalSummary = [
            'plans' => $orders->count(),
            'done' => $orders->where('workflow_state', 'DELIVERED')->count(),
            'pending' => $orders->filter(
                fn($o) => !in_array(
                    $o->workflow_state,
                    ['DELIVERED', 'CANCELLED']
                )
            )->count(),
            'untouched_orders' => $statusWindowOrders->filter(
                fn($o) => empty($o->drawer_id)
            )->count(),
            'drawing_process' => $statusWindowOrders->where('workflow_state', 'IN_DRAW')->count(),
            'sent_to_fixing' => $statusWindowOrders->where('workflow_state', 'PENDING_BY_DRAWER')->count(),
        ];

        
        /*
        |--------------------------------------------------------------------------
        | Plans Remaining (Include pending orders from the last 5 days)
        |--------------------------------------------------------------------------
        */
        $plansRemainingStartLocal = $shiftStartPkt
            ->copy()
            ->subDays(2)
            ->format('Y-m-d H:i:s');

        $plansRemainingQuery = DB::table(DB::raw("({$rawUnion}) as orders"))
            ->selectRaw("GREATEST(TIMESTAMPDIFF(HOUR, ?, {$batchDueInExpr}), 0) as remaining_hour_bucket", [$batchNowPkt])
            ->where('received_at', '>=', $plansRemainingStartLocal)
            ->where('received_at', '<', $shiftEndLocal)
            ->whereNotNull('due_in')
            ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED', 'PENDING_BY_DRAWER']);

        if ($projectId) {
            $plansRemainingQuery->where('project_id', $projectId);
        }

        $plansRemainingOrders = $plansRemainingQuery->get();

        $plansRemaining = $plansRemainingOrders
            ->groupBy(fn($o) => (int) $o->remaining_hour_bucket)
            ->map(fn($items, $hour) => [
                'hour' => (int)$hour,
                'plans' => $items->count(),
                'hour_label' => str_pad((string) $hour, 2, '0', STR_PAD_LEFT) . ' hrs',
            ])
            ->sortBy('hour')
            ->values();

        /*
        |--------------------------------------------------------------------------
        | Hourly Received Orders
        |--------------------------------------------------------------------------
        */
        $last24h = $shiftStartLocal;

        $doneOrdersLast24h = collect(
            DB::table(DB::raw("({$rawUnion}) as orders"))
                ->where('workflow_state', 'DELIVERED')
                ->whereNotNull('completed_at')
                ->where('completed_at', '>=', $last24h)
                ->where('completed_at', '<', $shiftEndLocal)
                ->when(
                    $projectId,
                    fn($q) => $q->where('project_id', $projectId)
                )
                ->get()
        );

        $hourlySlots = collect([
            ['label' => '10pm to 12am', 'start' => 22, 'end' => 24],
            ['label' => '12am to 02am', 'start' => 0, 'end' => 2],
            ['label' => '02am to 04am', 'start' => 2, 'end' => 4],
            ['label' => '04am to 06am', 'start' => 4, 'end' => 6],
            ['label' => '06am to 08am', 'start' => 6, 'end' => 8],
            ['label' => '08am to 10am', 'start' => 8, 'end' => 10],
            ['label' => '10am to 12pm', 'start' => 10, 'end' => 12],
            ['label' => '12pm to 02pm', 'start' => 12, 'end' => 14],
            ['label' => '02pm to 04pm', 'start' => 14, 'end' => 16],
            ['label' => '04pm to 06pm', 'start' => 16, 'end' => 18],
            ['label' => '06pm to 08pm', 'start' => 18, 'end' => 20],
            ['label' => '08pm to 10pm', 'start' => 20, 'end' => 22],
        ]);

        $hourlyCounts = $hourlySlots->map(fn($slot) => [
            'label' => $slot['label'],
            'orders' => $doneOrdersLast24h
                ->filter(function ($o) use ($slot) {
                    $hour = \Carbon\Carbon::parse(
                        $o->completed_at,
                        'Asia/Karachi'
                    )->hour;

                    return $hour >= $slot['start']
                        && $hour < $slot['end'];
                })
                ->count()
        ]);

        /*
        |--------------------------------------------------------------------------
        | Min Remaining
        |--------------------------------------------------------------------------
        */
        $untouchedMin = $batches
            ->where('done', 0)
            ->sortBy('remaining_minutes')
            ->first();

        if ($untouchedMin) {
            $untouchedMin['remaining_time'] =
                floor($untouchedMin['min_remaining_minutes'] / 60) . 'h ' .
                ($untouchedMin['min_remaining_minutes'] % 60) . 'm';
        }

        $fixedMin = $batches
            ->where('fixing', '>', 0)
            ->sortBy('remaining_minutes')
            ->first();

        if ($fixedMin) {
            $fixedMin['remaining_time'] =
                floor($fixedMin['min_remaining_minutes'] / 60) . 'h ' .
                ($fixedMin['min_remaining_minutes'] % 60) . 'm';
        }

        if (!$fixedMin) {
            $fixedMin = [
                'batch_no' => null,
                'received_time' => '00:00',
                'remaining_minutes' => 0,
                'remaining_time' => '0h 0m',
                'plans' => 0,
                'done' => 0,
                'pending' => 0,
                'fixing' => 0,
                'drawing' => 0,
                'min_remaining_minutes' => 0,
                'max_remaining_minutes' => 0,
            ];
        }

        /*
        |--------------------------------------------------------------------------
        | Response
        |--------------------------------------------------------------------------
        */
        return response()->json([
            'success' => true,
            'project_name' => $projects->count() === 1
                ? $projects->first()->name
                : $projects->pluck('name')->implode(', '),
            'selected_date' => $date,
            'selected_date_display' => \Carbon\Carbon::parse($date, 'Asia/Karachi')->format('d-m-Y'),
            'start_time' => $shiftStartPkt->format('Y-m-d H:i:s'),
            'end_time' => $shiftEndPkt->format('Y-m-d H:i:s'),
            'total_orders' => $totalSummary,
            'batches' => $batches,
            'plans_remaining' => $plansRemaining,
            'hourly_counts' => $hourlyCounts,
            'untouched_min' => $untouchedMin,
            'fixed_min' => $fixedMin,
        ]);

    } catch (\Throwable $e) {

        \Log::error('Batch Status Report Error: ' . $e->getMessage());

        return response()->json([
            'success' => false,
            'message' => $e->getMessage()
        ], 500);
    }
}





    /**
     * Request-scoped cache for Schema introspection.
     * Avoids repeated INFORMATION_SCHEMA queries (hasTable/hasColumn) inside loops.
     */
    private static array $tableExistsCache = [];
    private static array $columnExistsCache = [];

    private static function tableExists(string $tableName): bool
    {
        if (!isset(self::$tableExistsCache[$tableName])) {
            self::$tableExistsCache[$tableName] = Schema::hasTable($tableName);
        }
        return self::$tableExistsCache[$tableName];
    }

    private static function columnExists(string $tableName, string $column): bool
    {
        $key = "{$tableName}.{$column}";
        if (!isset(self::$columnExistsCache[$key])) {
            self::$columnExistsCache[$key] = Schema::hasColumn($tableName, $column);
        }
        return self::$columnExistsCache[$key];
    }

    /**
     * GET /dashboard/master
     * CEO/Director: Org → Country → Department → Project drilldown.
     */
    public function master(Request $request)
    {
        $user = $request->user();
        if (!in_array($user->role, ['ceo', 'director', 'accounts_manager'])) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Cache master dashboard for 120s — 26 projects × 7 queries is heavy on file cache
        $cacheKey = 'dashboard_master_' . $this->businessDayBounds()[0]->toDateString();
        $data = \Illuminate\Support\Facades\Cache::remember($cacheKey, 120, function () {
            return $this->generateMasterData();
        });

        return response()->json($data);
    }

    private function generateMasterData(): array
    {
        // BULK LOAD all data up front to avoid N+1 queries
        $activeProjects = Project::where('status', 'active')->get();
        $allProjectIds = $activeProjects->pluck('id');
        
        // Bulk load all order counts by project + state (across per-project tables)
        $orderCounts = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->selectRaw('project_id, workflow_state, COUNT(*) as cnt')
              ->groupBy('project_id', 'workflow_state');
        })->groupBy('project_id');

        $deliveredToday = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->where('workflow_state', 'DELIVERED')
              ->where('delivered_at', '>=', $this->businessDayBounds()[0])
              ->where('delivered_at', '<', $this->businessDayBounds()[1])
              ->selectRaw('project_id, COUNT(*) as cnt')
              ->groupBy('project_id');
        })->pluck('cnt', 'project_id');

        $receivedToday = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->where('received_at', '>=', $this->businessDayBounds()[0])
              ->where('received_at', '<', $this->businessDayBounds()[1])
              ->selectRaw('project_id, COUNT(*) as cnt')
              ->groupBy('project_id');
        })->pluck('cnt', 'project_id');

        $slaBreaches = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
              ->whereNotNull('due_date')
              ->where('due_date', '<', now())
              ->selectRaw('project_id, COUNT(*) as cnt')
              ->groupBy('project_id');
        })->pluck('cnt', 'project_id');

        // Bulk load all staff
        $allStaff = User::whereIn('project_id', $allProjectIds)->where('is_active', true)->get();
        $staffByProject = $allStaff->groupBy('project_id');

        $countries = $activeProjects->groupBy('country');
        $summary = [];

        foreach ($countries as $country => $countryProjects) {
            $countryProjectIds = $countryProjects->pluck('id');

            $departments = [];
            foreach ($countryProjects->groupBy('department') as $dept => $deptProjects) {
                $deptProjectIds = $deptProjects->pluck('id');

                $deptTotalOrders = 0;
                $deptPending = 0;
                foreach ($deptProjectIds as $pid) {
                    $projectOrders = $orderCounts->get($pid, collect());
                    $deptTotalOrders += $projectOrders->sum('cnt');
                    $deptPending += $projectOrders->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])->sum('cnt');
                }

                $deptData = [
                    'department' => $dept,
                    'project_count' => $deptProjects->count(),
                    'total_orders' => $deptTotalOrders,
                    'delivered_today' => $deptProjectIds->sum(fn($pid) => $deliveredToday->get($pid, 0)),
                    'pending' => $deptPending,
                    'sla_breaches' => $deptProjectIds->sum(fn($pid) => $slaBreaches->get($pid, 0)),
                    'projects' => $deptProjects->map(fn($p) => [
                        'id' => $p->id,
                        'code' => $p->code,
                        'name' => $p->name,
                        'workflow_type' => $p->workflow_type,
                        'pending' => $orderCounts->get($p->id, collect())
                            ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])->sum('cnt'),
                        'delivered_today' => $deliveredToday->get($p->id, 0),
                    ])->values(),
                ];
                $departments[] = $deptData;
            }

            $countryStaff = $staffByProject->filter(fn($v, $k) => $countryProjectIds->contains($k))->flatten();
            $totalStaff = $countryStaff->count();
            $activeStaff = $countryStaff->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count();
            $absentStaff = $countryStaff->where('is_absent', true)->count();

            $summary[] = [
                'country' => $country,
                'project_count' => $countryProjects->count(),
                'total_staff' => $totalStaff,
                'active_staff' => $activeStaff,
                'absent_staff' => $absentStaff,
                'received_today' => $countryProjectIds->sum(fn($pid) => $receivedToday->get($pid, 0)),
                'delivered_today' => $countryProjectIds->sum(fn($pid) => $deliveredToday->get($pid, 0)),
                'total_pending' => $orderCounts->filter(fn($v, $k) => $countryProjectIds->contains($k))
                    ->flatten()->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])->sum('cnt'),
                'departments' => $departments,
            ];
        }

        // Productivity & Overtime Analysis (per CEO requirements)
        $standardShiftHours = 9; // 9-hour shift per requirements
        
        // Calculate overtime/undertime based on work items (bulk loaded)
        $todayWorkItems = WorkItem::where('status', 'completed')
            ->where('completed_at', '>=', $this->businessDayBounds()[0])
            ->where('completed_at', '<', $this->businessDayBounds()[1])
            ->selectRaw('assigned_user_id, COUNT(*) as cnt')
            ->groupBy('assigned_user_id')
            ->pluck('cnt', 'assigned_user_id');
        
        $usersWithOvertime = 0;
        $usersUnderTarget = 0;
        $totalTargetAchieved = 0;
        $totalStaffWithTargets = 0;
        
        foreach ($allStaff as $staff) {
            if ($staff->daily_target > 0) {
                $totalStaffWithTargets++;
                $todayCompleted = $todayWorkItems->get($staff->id, 0);
                if ($todayCompleted >= $staff->daily_target) {
                    $totalTargetAchieved++;
                }
                // Overtime: completed more than 120% of target
                if ($todayCompleted > ($staff->daily_target * 1.2)) {
                    $usersWithOvertime++;
                }
                // Under-target: completed less than 80% of target
                if ($todayCompleted < ($staff->daily_target * 0.8)) {
                    $usersUnderTarget++;
                }
            }
        }
        
        $targetHitRate = $totalStaffWithTargets > 0 
            ? round(($totalTargetAchieved / $totalStaffWithTargets) * 100, 1) 
            : 0;

        // Org-wide totals (reuse already-loaded data — NO re-querying)
        // Combine week+month received/delivered into a single cross-project scan
        $weekMonthStats = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->selectRaw("
                SUM(CASE WHEN received_at >= ? AND received_at < ? THEN 1 ELSE 0 END) as received_today,
                SUM(CASE WHEN workflow_state = 'DELIVERED' AND delivered_at >= ? AND delivered_at < ? THEN 1 ELSE 0 END) as delivered_today,
                SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) as received_week,
                SUM(CASE WHEN workflow_state = 'DELIVERED' AND delivered_at >= ? THEN 1 ELSE 0 END) as delivered_week,
                SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) as received_month,
                SUM(CASE WHEN workflow_state = 'DELIVERED' AND delivered_at >= ? THEN 1 ELSE 0 END) as delivered_month,
                SUM(CASE WHEN workflow_state NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) as pending
            ", [
                $this->businessDayBounds()[0], $this->businessDayBounds()[1],
                $this->businessDayBounds()[0], $this->businessDayBounds()[1],
                now()->startOfWeek(),
                now()->startOfWeek(),
                now()->startOfMonth(),
                now()->startOfMonth(),
            ]);
        });
        $wm = (object) [
            'received_today' => $weekMonthStats->sum('received_today'),
            'delivered_today' => $weekMonthStats->sum('delivered_today'),
            'received_week' => $weekMonthStats->sum('received_week'),
            'delivered_week' => $weekMonthStats->sum('delivered_week'),
            'received_month' => $weekMonthStats->sum('received_month'),
            'delivered_month' => $weekMonthStats->sum('delivered_month'),
            'pending' => $weekMonthStats->sum('pending'),
        ];

        $orgTotals = [
            'total_projects' => $activeProjects->count(),
            'total_staff' => $allStaff->count(),
            'active_staff' => $allStaff->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count(),
            'absentees' => $allStaff->where('is_absent', true)->count(),
            // Inactive users flagged (15+ days) — reuse allStaff
            'inactive_flagged' => $allStaff->where('inactive_days', '>=', 15)->count(),
            'orders_received_today' => $wm->received_today,
            'orders_delivered_today' => $wm->delivered_today,
            'orders_received_week' => $wm->received_week,
            'orders_delivered_week' => $wm->delivered_week,
            'orders_received_month' => $wm->received_month,
            'orders_delivered_month' => $wm->delivered_month,
            'total_pending' => $wm->pending,
            // Overtime/Productivity Analysis per CEO requirements
            'standard_shift_hours' => $standardShiftHours,
            'staff_with_overtime' => $usersWithOvertime,
            'staff_under_target' => $usersUnderTarget,
            'target_hit_rate' => $targetHitRate,
            'staff_achieved_target' => $totalTargetAchieved,
            'staff_with_targets' => $totalStaffWithTargets,
        ];

        // Team-wise output analysis
        $teams = \App\Models\Team::with(['project:id,name,code,country,department'])
            ->where('is_active', true)
            ->get();
        
        $teamDeliveredToday = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->whereNotNull('team_id')
              ->where('workflow_state', 'DELIVERED')
              ->where('delivered_at', '>=', $this->businessDayBounds()[0])
              ->where('delivered_at', '<', $this->businessDayBounds()[1])
              ->selectRaw('team_id, COUNT(*) as cnt')
              ->groupBy('team_id');
        })->pluck('cnt', 'team_id');
        
        $teamPending = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->whereNotNull('team_id')
              ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
              ->selectRaw('team_id, COUNT(*) as cnt')
              ->groupBy('team_id');
        })->pluck('cnt', 'team_id');
        
        $teamOutput = $teams->map(function ($team) use ($teamDeliveredToday, $teamPending, $allStaff) {
            $teamStaff = $allStaff->where('team_id', $team->id);
            $activeTeamStaff = $teamStaff->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)));
            $delivered = $teamDeliveredToday->get($team->id, 0);
            $pending = $teamPending->get($team->id, 0);
            
            return [
                'id' => $team->id,
                'name' => $team->name,
                'project_code' => $team->project->code ?? '-',
                'project_name' => $team->project->name ?? '-',
                'country' => $team->project->country ?? '-',
                'department' => $team->project->department ?? '-',
                'staff_count' => $teamStaff->count(),
                'active_staff' => $activeTeamStaff->count(),
                'delivered_today' => $delivered,
                'pending' => $pending,
                'efficiency' => $teamStaff->count() > 0 ? round($delivered / max($teamStaff->count(), 1), 1) : 0,
            ];
        })->sortByDesc('delivered_today')->values();

        // ═══════════════════════════════════════════════════════════════
        // NEW CEO METRICS — Financial, Quality, SLA, Turnaround, Trends
        // ═══════════════════════════════════════════════════════════════

        // 1. SLA BREACHES (top-level)
        $totalSlaBreaches = $slaBreaches->sum();

        // 2. REJECTION METRICS
        $rejectionStats = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->selectRaw("
                SUM(CASE WHEN workflow_state IN ('REJECTED_BY_CHECK','REJECTED_BY_QA') THEN 1 ELSE 0 END) as active_rejections,
                SUM(CASE WHEN rejected_at >= ? AND rejected_at < ? THEN 1 ELSE 0 END) as rejected_today,
                SUM(CASE WHEN rejected_at >= ? THEN 1 ELSE 0 END) as rejected_week,
                SUM(CASE WHEN rejected_at >= ? THEN 1 ELSE 0 END) as rejected_month,
                SUM(CASE WHEN workflow_state = 'DELIVERED' AND recheck_count > 0 THEN 1 ELSE 0 END) as rework_delivered,
                SUM(CASE WHEN workflow_state = 'DELIVERED' THEN 1 ELSE 0 END) as total_delivered_all
            ", [
                $this->businessDayBounds()[0], $this->businessDayBounds()[1],
                now()->startOfWeek(),
                now()->startOfMonth(),
            ]);
        });
        $rejections = [
            'active_rejections' => (int) $rejectionStats->sum('active_rejections'),
            'rejected_today' => (int) $rejectionStats->sum('rejected_today'),
            'rejected_week' => (int) $rejectionStats->sum('rejected_week'),
            'rejected_month' => (int) $rejectionStats->sum('rejected_month'),
            'rework_rate' => $rejectionStats->sum('total_delivered_all') > 0
                ? round(($rejectionStats->sum('rework_delivered') / $rejectionStats->sum('total_delivered_all')) * 100, 1)
                : 0,
        ];

        // 3. TURNAROUND TIME (avg hours from received to delivered — this month)
        $turnaroundData = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->where('workflow_state', 'DELIVERED')
              ->whereNotNull('received_at')
              ->whereNotNull('delivered_at')
              ->where('delivered_at', '>=', now()->startOfMonth())
              ->whereRaw('delivered_at >= received_at') // exclude corrupt timestamps
              ->selectRaw("
                  project_id,
                  AVG(TIMESTAMPDIFF(HOUR, received_at, delivered_at)) as avg_hours,
                  MIN(TIMESTAMPDIFF(HOUR, received_at, delivered_at)) as min_hours,
                  MAX(TIMESTAMPDIFF(HOUR, received_at, delivered_at)) as max_hours,
                  COUNT(*) as cnt
              ")
              ->groupBy('project_id');
        });
        $totalTurnaroundOrders = $turnaroundData->sum('cnt');
        $weightedAvg = $totalTurnaroundOrders > 0
            ? $turnaroundData->sum(fn($r) => $r->avg_hours * $r->cnt) / $totalTurnaroundOrders
            : 0;
        $turnaround = [
            'avg_hours' => round($weightedAvg, 1),
            'min_hours' => $turnaroundData->min('min_hours') ?? 0,
            'max_hours' => $turnaroundData->max('max_hours') ?? 0,
            'sample_size' => $totalTurnaroundOrders,
        ];

        // 4. BACKLOG AGING (pending orders age buckets)
        $agingData = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
              ->whereNotNull('received_at')
              ->selectRaw("
                  SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) as age_0_24h,
                  SUM(CASE WHEN received_at >= ? AND received_at < ? THEN 1 ELSE 0 END) as age_1_3d,
                  SUM(CASE WHEN received_at >= ? AND received_at < ? THEN 1 ELSE 0 END) as age_3_7d,
                  SUM(CASE WHEN received_at < ? THEN 1 ELSE 0 END) as age_7_plus
              ", [
                  now()->subHours(24),
                  now()->subDays(3), now()->subHours(24),
                  now()->subDays(7), now()->subDays(3),
                  now()->subDays(7),
              ]);
        });
        $backlogAging = [
            'age_0_24h' => (int) $agingData->sum('age_0_24h'),
            'age_1_3d' => (int) $agingData->sum('age_1_3d'),
            'age_3_7d' => (int) $agingData->sum('age_3_7d'),
            'age_7_plus' => (int) $agingData->sum('age_7_plus'),
        ];

        // 5. REVENUE / FINANCIAL SUMMARY (from invoices)
        $currentMonth = now()->month;
        $currentYear = now()->year;
        $invoiceStats = Invoice::selectRaw("
            SUM(CASE WHEN status IN ('approved','issued','sent') THEN total_amount ELSE 0 END) as revenue_approved,
            SUM(CASE WHEN status = 'sent' THEN total_amount ELSE 0 END) as revenue_sent,
            SUM(CASE WHEN status IN ('draft','prepared','pending_approval') THEN total_amount ELSE 0 END) as revenue_pipeline,
            SUM(CASE WHEN month = ? AND year = ? THEN total_amount ELSE 0 END) as revenue_this_month,
            SUM(total_amount) as revenue_total,
            COUNT(*) as total_invoices,
            SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as invoices_sent,
            SUM(CASE WHEN status IN ('draft','prepared') THEN 1 ELSE 0 END) as invoices_pending
        ", [$currentMonth, $currentYear])->first();
        $financial = [
            'revenue_approved' => round((float) ($invoiceStats->revenue_approved ?? 0), 2),
            'revenue_sent' => round((float) ($invoiceStats->revenue_sent ?? 0), 2),
            'revenue_pipeline' => round((float) ($invoiceStats->revenue_pipeline ?? 0), 2),
            'revenue_this_month' => round((float) ($invoiceStats->revenue_this_month ?? 0), 2),
            'revenue_total' => round((float) ($invoiceStats->revenue_total ?? 0), 2),
            'total_invoices' => (int) ($invoiceStats->total_invoices ?? 0),
            'invoices_sent' => (int) ($invoiceStats->invoices_sent ?? 0),
            'invoices_pending' => (int) ($invoiceStats->invoices_pending ?? 0),
        ];

        // 6. STAFF UTILIZATION (who has active WIP vs not)
        $staffWithWip = $allStaff->filter(fn($u) => ($u->wip_count ?? 0) > 0)->count();
        $activeNonAbsent = $allStaff->filter(fn($u) => !$u->is_absent && $u->is_active)->count();
        $utilization = [
            'staff_with_wip' => $staffWithWip,
            'total_available' => $activeNonAbsent,
            'utilization_rate' => $activeNonAbsent > 0 ? round(($staffWithWip / $activeNonAbsent) * 100, 1) : 0,
        ];

        // 7. CAPACITY vs DEMAND
        $totalDailyCapacity = $allStaff->filter(fn($u) => !$u->is_absent && $u->is_active)->sum('daily_target');
        // Fallback: when daily_target is not configured (all zeros), estimate from 30-day historical avg output
        if ($totalDailyCapacity === 0) {
            $thirtyDayDeliveries = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
                $q->where('workflow_state', 'DELIVERED')
                  ->where('delivered_at', '>=', now()->subDays(30)->startOfDay())
                  ->selectRaw('COUNT(*) as cnt');
            })->sum('cnt');
            $totalDailyCapacity = (int) round($thirtyDayDeliveries / 30);
        }
        $capacityDemand = [
            'daily_capacity' => (int) $totalDailyCapacity,
            'today_received' => $wm->received_today,
            'capacity_ratio' => $totalDailyCapacity > 0
                ? round(($wm->received_today / $totalDailyCapacity) * 100, 1)
                : 0,
        ];

        // 8. 7-DAY TREND (received vs delivered per day)
        $trendData = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->where(function($sub) {
                $sub->where('received_at', '>=', now()->subDays(7)->startOfDay())
                    ->orWhere(function($sub2) {
                        $sub2->where('workflow_state', 'DELIVERED')
                             ->where('delivered_at', '>=', now()->subDays(7)->startOfDay());
                    });
              })
              ->selectRaw("
                  DATE(received_at) as recv_date,
                  SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) as received,
                  SUM(CASE WHEN workflow_state = 'DELIVERED' AND delivered_at >= ? AND DATE(delivered_at) = DATE(received_at) THEN 1 ELSE 0 END) as delivered_same_day
              ", [now()->subDays(7)->startOfDay(), now()->subDays(7)->startOfDay()])
              ->groupByRaw('DATE(received_at)');
        });
        // Build a cleaner approach: separate received and delivered queries
        $trendReceived = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->where('received_at', '>=', now()->subDays(7)->startOfDay())
              ->selectRaw("DATE(received_at) as the_date, COUNT(*) as cnt")
              ->groupByRaw('DATE(received_at)');
        })->groupBy('the_date')->map(fn($rows) => $rows->sum('cnt'));

        $trendDelivered = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->where('workflow_state', 'DELIVERED')
              ->where('delivered_at', '>=', now()->subDays(7)->startOfDay())
              ->selectRaw("DATE(delivered_at) as the_date, COUNT(*) as cnt")
              ->groupByRaw('DATE(delivered_at)');
        })->groupBy('the_date')->map(fn($rows) => $rows->sum('cnt'));

        $trendRejected = Order::queryAcrossProjects($allProjectIds->toArray(), function($q) {
            $q->where('rejected_at', '>=', now()->subDays(7)->startOfDay())
              ->whereNotNull('rejected_at')
              ->selectRaw("DATE(rejected_at) as the_date, COUNT(*) as cnt")
              ->groupByRaw('DATE(rejected_at)');
        })->groupBy('the_date')->map(fn($rows) => $rows->sum('cnt'));

        $trend7d = [];
        for ($i = 6; $i >= 0; $i--) {
            $date = now()->subDays($i)->format('Y-m-d');
            $trend7d[] = [
                'date' => $date,
                'label' => now()->subDays($i)->format('D'),
                'received' => (int) ($trendReceived[$date] ?? 0),
                'delivered' => (int) ($trendDelivered[$date] ?? 0),
                'rejected' => (int) ($trendRejected[$date] ?? 0),
            ];
        }

        // 9. QUALITY METRICS (org-level QA compliance)
        $qualityData = WorkItem::where('status', 'completed')
            ->where('stage', 'qa')
            ->where('completed_at', '>=', now()->startOfMonth())
            ->selectRaw("COUNT(*) as total_qa, SUM(CASE WHEN rejection_code IS NULL OR rejection_code = '' THEN 1 ELSE 0 END) as passed")
            ->first();
        $quality = [
            'total_qa_reviews' => (int) ($qualityData->total_qa ?? 0),
            'qa_passed' => (int) ($qualityData->passed ?? 0),
            'qa_compliance_rate' => ($qualityData->total_qa ?? 0) > 0
                ? round(((int) $qualityData->passed / (int) $qualityData->total_qa) * 100, 1)
                : 0,
        ];

        // 10. TOP/BOTTOM PERFORMERS (by completed work items today)
        $performerData = WorkItem::where('status', 'completed')
            ->where('completed_at', '>=', $this->businessDayBounds()[0])
            ->where('completed_at', '<', $this->businessDayBounds()[1])
            ->selectRaw('assigned_user_id, COUNT(*) as completed, AVG(time_spent_seconds) as avg_seconds')
            ->groupBy('assigned_user_id')
            ->orderByDesc('completed')
            ->limit(50)
            ->get();

        $performerUserIds = $performerData->pluck('assigned_user_id')->toArray();
        $performerUsers = User::whereIn('id', $performerUserIds)
            ->select('id', 'name', 'role', 'project_id', 'team_id')
            ->get()
            ->keyBy('id');

        $performers = $performerData->map(function($p) use ($performerUsers) {
            $user = $performerUsers->get($p->assigned_user_id);
            if (!$user) return null;
            return [
                'id' => $user->id,
                'name' => $user->name,
                'role' => $user->role,
                'completed' => (int) $p->completed,
                'avg_minutes' => round(($p->avg_seconds ?? 0) / 60, 1),
            ];
        })->filter()->values();

        $topPerformers = $performers->take(5)->values()->toArray();
        $bottomPerformers = $performers->count() > 5
            ? $performers->sortBy('completed')->take(5)->values()->toArray()
            : [];

        // 11. COUNTRY COMPARISON (efficiency per country)
        $countryComparison = collect($summary)->map(function($c) {
            $eff = ($c['received_today'] ?? 0) > 0
                ? round((($c['delivered_today'] ?? 0) / $c['received_today']) * 100, 1)
                : 0;
            return [
                'country' => $c['country'],
                'efficiency' => min($eff, 100),
                'staff_utilization' => ($c['total_staff'] ?? 0) > 0
                    ? round((($c['active_staff'] ?? 0) / $c['total_staff']) * 100, 1)
                    : 0,
                'pending_per_staff' => ($c['active_staff'] ?? 0) > 0
                    ? round(($c['total_pending'] ?? 0) / $c['active_staff'], 1)
                    : 0,
            ];
        })->values()->toArray();

        // 12. ALERTS (anomaly detection)
        $alerts = [];
        // High SLA breaches
        if ($totalSlaBreaches > 5) {
            $alerts[] = ['type' => 'critical', 'message' => "{$totalSlaBreaches} orders past SLA deadline"];
        }
        // Rejection spike
        if ($rejections['rejected_today'] > 10) {
            $alerts[] = ['type' => 'warning', 'message' => "{$rejections['rejected_today']} rejections today — check quality"];
        }
        // Capacity overload
        if ($capacityDemand['capacity_ratio'] > 120) {
            $alerts[] = ['type' => 'warning', 'message' => "Demand exceeds capacity by " . round($capacityDemand['capacity_ratio'] - 100) . "%"];
        }
        // Low utilization
        if ($utilization['utilization_rate'] < 50 && $activeNonAbsent > 5) {
            $alerts[] = ['type' => 'info', 'message' => "Staff utilization at {$utilization['utilization_rate']}% — {$staffWithWip} of {$activeNonAbsent} working"];
        }
        // Aged backlog
        if ($backlogAging['age_7_plus'] > 0) {
            $alerts[] = ['type' => 'critical', 'message' => "{$backlogAging['age_7_plus']} orders stuck for 7+ days"];
        }
        // High absentees
        if (($orgTotals['absentees'] ?? 0) > ($allStaff->count() * 0.2) && $allStaff->count() > 10) {
            $alerts[] = ['type' => 'warning', 'message' => "High absenteeism: {$orgTotals['absentees']} staff absent"];
        }

        // Add new metrics to org_totals
        $orgTotals['sla_breaches'] = $totalSlaBreaches;

        return [
            'org_totals' => $orgTotals,
            'countries' => $summary,
            'teams' => $teamOutput,
            'rejections' => $rejections,
            'turnaround' => $turnaround,
            'backlog_aging' => $backlogAging,
            'financial' => $financial,
            'utilization' => $utilization,
            'capacity_demand' => $capacityDemand,
            'trend_7d' => $trend7d,
            'quality' => $quality,
            'top_performers' => $topPerformers,
            'bottom_performers' => $bottomPerformers,
            'country_comparison' => $countryComparison,
            'alerts' => $alerts,
        ];
    }



    /**
     * GET /dashboard/project/{id}
     * Project dashboard: queue health, staffing, performance.
     */
     
    public function project(Request $request, int $id)
    {
        $user = $request->user();
        $project = Project::findOrFail($id);

        // Access control: verify user can view this project
        if (!in_array($user->role, ['ceo', 'director'])) {
            $allowedProjectIds = $user->getManagedProjectIds();
            if (!in_array($id, $allowedProjectIds)) {
                return response()->json(['message' => 'Access denied: you do not have access to this project.'], 403);
            }
        }

        $workflowType = $project->workflow_type ?? 'FP_3_LAYER';
        $states = $workflowType === 'PH_2_LAYER' ? StateMachine::PH_STATES : StateMachine::FP_STATES;

        // Queue health: single GROUP BY instead of per-state COUNT
        $stateCountsRaw = Order::forProject($id)
            ->selectRaw('workflow_state, COUNT(*) as cnt')
            ->groupBy('workflow_state')
            ->pluck('cnt', 'workflow_state');
        $stateCounts = [];
        foreach ($states as $state) {
            $stateCounts[$state] = $stateCountsRaw->get($state, 0);
        }

        // Load ALL users for the project once, then filter in memory
        $allProjectUsers = User::where('project_id', $id)->get();
        $stages = StateMachine::getStages($workflowType);
        if ($workflowType === 'FP_3_LAYER' && in_array(12, $projectIds, true) && !in_array('FILL', $stages, true)) {
            $checkIndex = array_search('CHECK', $stages, true);
            if ($checkIndex === false) {
                $stages[] = 'FILL';
            } else {
                array_splice($stages, $checkIndex + 1, 0, ['FILL']);
            }
        }
        if ($workflowType === 'FP_3_LAYER' && in_array(12, $projectIds, true) && !in_array('FILL', $stages, true)) {
            $checkIndex = array_search('CHECK', $stages, true);
            if ($checkIndex === false) {
                $stages[] = 'FILL';
            } else {
                array_splice($stages, $checkIndex + 1, 0, ['FILL']);
            }
        }
        if ($workflowType === 'FP_3_LAYER' && in_array(12, $projectIds, true) && !in_array('FILL', $stages, true)) {
            $insertAfter = array_search('CHECK', $stages, true);
            if ($insertAfter === false) {
                $stages[] = 'FILL';
            } else {
                array_splice($stages, $insertAfter + 1, 0, ['FILL']);
            }
        }

        // Staffing (from in-memory collection)
        $staffing = [];
        foreach ($stages as $stage) {
            $role = StateMachine::STAGE_TO_ROLE[$stage];
            $roleUsers = $allProjectUsers->where('role', $role);
            $staffing[$stage] = [
                'required' => $roleUsers->count(),
                'active' => $roleUsers->where('is_active', true)->where('is_absent', false)->count(),
                'absent' => $roleUsers->where('is_absent', true)->count(),
                'online' => $roleUsers->filter(fn($u) => $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count(),
            ];
        }

        // Performance: single WorkItem GROUP BY stage instead of per-stage queries
        $completionsByStage = WorkItem::where('project_id', $id)
            ->where('status', 'completed')
            ->where('completed_at', '>=', $this->businessDayBounds()[0])
            ->where('completed_at', '<', $this->businessDayBounds()[1])
            ->selectRaw('stage, COUNT(*) as cnt')
            ->groupBy('stage')
            ->pluck('cnt', 'stage');

        $performance = [];
        foreach ($stages as $stage) {
            $role = StateMachine::STAGE_TO_ROLE[$stage];
            $activeRoleUsers = $allProjectUsers->where('role', $role)->where('is_active', true);
            $totalTarget = $activeRoleUsers->sum('daily_target');
            $totalCompleted = $completionsByStage->get($stage, 0);

            $performance[$stage] = [
                'today_completed' => $totalCompleted,
                'total_target' => $totalTarget,
                'hit_rate' => $totalTarget > 0 ? round(($totalCompleted / $totalTarget) * 100, 1) : 0,
            ];
        }

        // Production stats: single aggregation query instead of 7 separate counts
        $prodStats = Order::forProject($id)
            ->selectRaw("
                COUNT(*) as total_orders,
                SUM(CASE WHEN workflow_state = 'DELIVERED' THEN 1 ELSE 0 END) as completed_orders,
                SUM(CASE WHEN workflow_state NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) as pending_orders,
                SUM(CASE WHEN received_at >= ? AND received_at < ? THEN 1 ELSE 0 END) as received_today,
                SUM(CASE WHEN workflow_state = 'DELIVERED' AND delivered_at >= ? AND delivered_at < ? THEN 1 ELSE 0 END) as delivered_today,
                SUM(CASE WHEN workflow_state NOT IN ('DELIVERED','CANCELLED') AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END) as sla_breaches,
                SUM(CASE WHEN workflow_state = 'ON_HOLD' THEN 1 ELSE 0 END) as on_hold
            ", [
                $this->businessDayBounds()[0], $this->businessDayBounds()[1],
                $this->businessDayBounds()[0], $this->businessDayBounds()[1],
                now(),
            ])->first();

        // Team statistics
        $allTeams = \App\Models\Team::where('project_id', $id)->get();
        $activeTeams = $allTeams->where('is_active', true)->count();
        $totalTeams = $allTeams->count();

        // Staff statistics (from already-loaded users)
        $allProjectStaff = $allProjectUsers->where('is_active', true);
        $totalStaff = $allProjectStaff->count();
        $activeStaff = $allProjectStaff->where('is_absent', false)
            ->filter(fn($u) => $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count();
        $absentStaff = $allProjectStaff->where('is_absent', true)->count();

        // Daily Absentee list
        $absentees = User::where('project_id', $id)
            ->where('is_active', true)
            ->where('is_absent', true)
            ->select('id', 'name', 'email', 'role', 'team_id')
            ->with('team:id,name')
            ->get();

        // Shift & Overtime Analysis (9-hour shift)
        $shiftHours = 9;
        $workItemsToday = WorkItem::where('project_id', $id)
            ->where('status', 'completed')
            ->where('completed_at', '>=', $this->businessDayBounds()[0])
            ->where('completed_at', '<', $this->businessDayBounds()[1])
            ->selectRaw('assigned_user_id, COUNT(*) as completed')
            ->groupBy('assigned_user_id')
            ->get()
            ->keyBy('assigned_user_id');

        $overtimeWorkers = 0;
        $undertimeWorkers = 0;
        $targetAchieved = 0;
        $targetMissed = 0;

        foreach ($allProjectStaff->where('is_absent', false) as $staff) {
            $completed = $workItemsToday->get($staff->id)?->completed ?? 0;
            $target = $staff->daily_target ?? 0;
            
            if ($target > 0) {
                if ($completed >= $target) {
                    $targetAchieved++;
                    if ($completed > $target * 1.2) {
                        $overtimeWorkers++;
                    }
                } else {
                    $targetMissed++;
                    if ($completed < $target * 0.8) {
                        $undertimeWorkers++;
                    }
                }
            }
        }

        return response()->json([
            'project' => $project,
            // Queue health per state
            'state_counts' => $stateCounts,
            // Staffing per layer
            'staffing' => $staffing,
            // Performance per layer
            'performance' => $performance,
            // Production stats (from single aggregation query)
            'production' => [
                'total_orders' => (int) $prodStats->total_orders,
                'completed_orders' => (int) $prodStats->completed_orders,
                'pending_orders' => (int) $prodStats->pending_orders,
                'received_today' => (int) $prodStats->received_today,
                'delivered_today' => (int) $prodStats->delivered_today,
                'sla_breaches' => (int) $prodStats->sla_breaches,
                'on_hold' => (int) $prodStats->on_hold,
            ],
            // Team stats
            'teams' => [
                'total' => $totalTeams,
                'active' => $activeTeams,
            ],
            // Staff overview
            'staff' => [
                'total' => $totalStaff,
                'active' => $activeStaff,
                'absent' => $absentStaff,
            ],
            // Daily absentees
            'absentees' => $absentees,
            // Shift & performance analysis
            'shift_analysis' => [
                'shift_hours' => $shiftHours,
                'overtime_workers' => $overtimeWorkers,
                'undertime_workers' => $undertimeWorkers,
                'target_achieved' => $targetAchieved,
                'target_missed' => $targetMissed,
            ],
        ]);
    }
    
    
    
    
    
    
    

    
    /**
     * GET /dashboard/project-stats
     * Project stats based on selected date.
     */
     
    public function projectStats(Request $request)
    {
        $date = $request->query('date', today()->toDateString());
        $startDate = $request->query('start_date', $request->input('start_date'));
        $endDate = $request->query('end_date', $request->input('end_date'));
        $selectedProjectId = $request->query('project_id');
        $selectedProjectId = is_numeric($selectedProjectId) && (int) $selectedProjectId > 0
            ? (int) $selectedProjectId
            : null;
        $detailOnly = $selectedProjectId !== null && $request->boolean('detail_only');
        $selectedRole = strtolower(trim((string) $request->query('role', $request->input('role', ''))));
        $selectedRole = in_array($selectedRole, ['drawer', 'designer', 'checker', 'qa', 'filler'], true) ? $selectedRole : null;

        if ($startDate) {
            $startDate = \Carbon\Carbon::parse($startDate)->toDateString();
            $endDate = $endDate
                ? \Carbon\Carbon::parse($endDate)->toDateString()
                : $startDate;

            if ($startDate > $endDate) {
                [$startDate, $endDate] = [$endDate, $startDate];
            }
            
        } else {
            $startDate = \Carbon\Carbon::parse($date)->toDateString();
            $endDate = $startDate;
        }

        $dateFilterType = $startDate === $endDate ? 'single_date' : 'date_range';
        $dateFormatted = \Carbon\Carbon::parse($startDate)->format('d-m-Y');
        $endDateFormatted = \Carbon\Carbon::parse($endDate)->format('d-m-Y');

        $selectedProject = $selectedProjectId !== null
            ? Project::where('status', 'active')->find($selectedProjectId)
            : null;

        if ($selectedProject) {
            $selectedWorkflowType = $selectedProject->workflow_type ?? 'FP_3_LAYER';

            if ($selectedWorkflowType === 'PH_2_LAYER' && $selectedRole === 'drawer') {
                $selectedRole = 'designer';
            } elseif ($selectedWorkflowType !== 'PH_2_LAYER' && $selectedRole === 'designer') {
                $selectedRole = 'drawer';
            }
        }

        // Cache key includes date range, selected project and role
        $cacheKey = 'ceo_pstats:v2:' . $startDate . ':' . $endDate . ':' . ($selectedProjectId ?? '0')
            . ':' . ($selectedRole ?? 'all') . ':' . ($detailOnly ? 'detail' : 'summary');
        if (\Illuminate\Support\Facades\Cache::has($cacheKey)) {
            return response()->json(\Illuminate\Support\Facades\Cache::get($cacheKey));
        }

        if ($detailOnly) {
            $breakdown = $selectedProject
                ? $this->buildProjectDoneBreakdown($selectedProjectId, $startDate, $endDate, $selectedRole)
                : [
                    'project_id' => $selectedProjectId,
                    'project_name' => null,
                    'selected_date' => $startDate,
                    'start_date' => $startDate,
                    'end_date' => $endDate,
                    'date_filter_type' => $dateFilterType,
                    'selected_role' => $selectedRole,
                    'total_received_done_orders' => 0,
                    'total_done_orders' => 0,
                    'roles' => [],
                ];

            $responseData = [
                'success' => true,
                'selected_date' => $startDate,
                'start_date' => $startDate,
                'end_date' => $endDate,
                'date_filter_type' => $dateFilterType,
                'selected_role' => $selectedRole,
                'totals' => [
                    'total_projects' => $selectedProject ? 1 : 0,
                    'raw_total_projects' => $selectedProject ? 1 : 0,
                    'country_count' => $selectedProject ? 1 : 0,
                    'received_orders_today' => 0,
                    'received_done_orders' => 0,
                    'done_orders' => 0,
                    'delayed_pending_orders' => 0,
                    'delayed_done_orders' => 0,
                    'delayed_orders' => 0,
                    'total_staff' => 0,
                    'present_staff' => 0,
                    'absent_staff' => 0,
                    'online_staff' => 0,
                ],
                'online_users' => [],
                'projects' => [],
                'countries' => [],
                'selected_project_breakdown' => $breakdown,
            ];

            \Illuminate\Support\Facades\Cache::put($cacheKey, $responseData, 60);

            return response()->json($responseData);
        }

        $applyTimestampRange = function ($query, string $column) use ($startDate, $endDate) {
            // Same jugaar as assignment dashboard: always use PKT timezone
            // received_at values are stored as PKT display strings, so filter using PKT boundaries
            $storageTimezone = 'Asia/Karachi';

            $parsedStart = \Carbon\Carbon::parse($startDate, $storageTimezone)->startOfDay();
            $parsedEnd   = \Carbon\Carbon::parse($endDate, $storageTimezone)->endOfDay();

            $query->whereBetween($column, [
                $parsedStart->toDateTimeString(),
                $parsedEnd->toDateTimeString(),
            ]);
        };

        $applyProject16DateRange = function ($query, string $column) use ($startDate, $endDate, $dateFormatted, $endDateFormatted) {
            if ($startDate === $endDate) {
                $query->where($column, $dateFormatted);
                return;
            }

            $query->whereRaw(
                "STR_TO_DATE({$column}, '%d-%m-%Y') BETWEEN ? AND ?",
                [$startDate, $endDate]
            );
        };

        $applyProject16DeliveredRange = function ($query, string $column) use ($startDate, $endDate) {
            // Same jugaar as assignment dashboard: use PKT timezone
            $storageTimezone = 'Asia/Karachi';

            $rangeStart = \Carbon\Carbon::parse($startDate, $storageTimezone)->subDay()->setTime(22, 0, 0);
            $rangeEnd = \Carbon\Carbon::parse($endDate, $storageTimezone)->setTime(22, 0, 0);

            $query->where($column, '>=', $rangeStart->toDateTimeString())
                ->where($column, '<', $rangeEnd->toDateTimeString());
        };

        $projects = Project::where('status', 'active')
            ->when($selectedProjectId !== null, fn ($query) => $query->whereKey($selectedProjectId))
            ->get();
        $projectIds = $projects->pluck('id')->toArray();
        $projectDueNow = $projects->mapWithKeys(function ($project) {
            $timezone = (int) $project->id === self::ASSIGNMENT_DASHBOARD_VIETNAM_PROJECT_ID
                ? self::ASSIGNMENT_DASHBOARD_VIETNAM_TIMEZONE
                : $this->resolveAssignmentDashboardProjectTimezone($project->timezone);

            return [
                (int) $project->id => now($timezone)->format('Y-m-d H:i:s'),
            ];
        });

        // Separate project 16 from others
        $otherProjectIds = array_filter($projectIds, fn($id) => $id != 16);
        $hasProject16 = in_array(16, $projectIds);
        $onlineCutoff = now()->subMinutes(15);

$userCounts = User::whereIn('project_id', $projectIds)
    ->where(function ($q) {
        $q->whereNull('inactive_days')
          ->orWhere('inactive_days', '<=', 10);
    })
    ->selectRaw('
        project_id,
        COUNT(*) as total_staff,
        SUM(CASE WHEN is_absent = 0 THEN 1 ELSE 0 END) as present_staff,
        SUM(CASE WHEN is_absent = 1 THEN 1 ELSE 0 END) as absent_staff,
        SUM(CASE WHEN is_absent = 0 AND last_activity > ? THEN 1 ELSE 0 END) as online_staff
    ', [$onlineCutoff])
    ->groupBy('project_id')
    ->get()
    ->keyBy('project_id');

        $onlineUsersByProject = User::whereIn('project_id', $projectIds)
            ->where('is_active', true)
            ->where('is_absent', false)
            ->where('last_activity', '>', $onlineCutoff)
            ->where(function ($q) {
                $q->whereNull('inactive_days')
                  ->orWhere('inactive_days', '<=', 10);
            })
            ->orderByDesc('last_activity')
            ->get([
                'id', 'name', 'email', 'role', 'project_id', 'team_id',
                'is_active', 'is_absent', 'last_activity',
                'wip_count', 'today_completed', 'daily_target',
            ])
            ->groupBy('project_id')
            ->map(function ($users) {
                return $users->map(function ($user) {
                    return [
                        'id' => $user->id,
                        'name' => $user->name,
                        'email' => $user->email,
                        'role' => $user->role,
                        'project_id' => $user->project_id,
                        'team_id' => $user->team_id,
                        'is_active' => $user->is_active,
                        'is_absent' => $user->is_absent,
                        'is_online' => true,
                        'last_activity' => $user->last_activity,
                        'wip_count' => $user->wip_count,
                        'today_completed' => $user->today_completed,
                        'daily_target' => $user->daily_target,
                    ];
                })->values();
            });

        // RECEIVED COUNTS: project 16 uses date column, others use received_at
        $receivedCounts = collect();
        if (!empty($otherProjectIds)) {
            $otherReceived = Order::queryAcrossProjects($otherProjectIds, function ($q, $pid) use ($applyTimestampRange) {
                $applyTimestampRange($q, 'received_at');
                $q
                    ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                    ->groupBy('project_id');
            });
            $receivedCounts = $receivedCounts->concat($otherReceived);
        }
        if ($hasProject16) {
            $table16 = \App\Services\ProjectOrderService::getTableName(16);
            if (self::tableExists($table16) && self::columnExists($table16, 'date')) {
                $project16Received = Order::queryAcrossProjects([16], function ($q, $pid) use ($applyProject16DateRange) {
                    $applyProject16DateRange($q, 'date');
                    $q
                        ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                        ->groupBy('project_id');
                });
                $receivedCounts = $receivedCounts->concat($project16Received);
            }
        }
        $receivedCounts = $receivedCounts->pluck('cnt', 'project_id');

        // RECEIVED + DONE COUNTS: project 16 uses date column, others use received_at
        $completedCounts = collect();
        if (!empty($otherProjectIds)) {
            $otherCompleted = Order::queryAcrossProjects($otherProjectIds, function ($q, $pid) use ($applyTimestampRange) {
                $q->where('workflow_state', 'DELIVERED')
                    ;
                $applyTimestampRange($q, 'received_at');
                $q
                    ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                    ->groupBy('project_id');
            });
            $completedCounts = $completedCounts->concat($otherCompleted);
        }
        if ($hasProject16) {
            $table16 = \App\Services\ProjectOrderService::getTableName(16);
            if (self::tableExists($table16) && self::columnExists($table16, 'date')) {
                $project16Completed = Order::queryAcrossProjects([16], function ($q, $pid) use ($applyProject16DateRange) {
                    $q->where('workflow_state', 'DELIVERED')
                        ;
                    $applyProject16DateRange($q, 'date');
                    $q
                        ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                        ->groupBy('project_id');
                });
                $completedCounts = $completedCounts->concat($project16Completed);
            }
        }
        $completedCounts = $completedCounts->pluck('cnt', 'project_id');

        // ALL DONE COUNTS: done in selected range regardless of received date
        $doneCounts = collect();
        if (!empty($otherProjectIds)) {
            $otherDone = Order::queryAcrossProjects($otherProjectIds, function ($q, $pid) use ($applyTimestampRange) {
                $q->where('workflow_state', 'DELIVERED');
                $applyTimestampRange($q, 'delivered_at');
                $q
                    ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                    ->groupBy('project_id');
            });
            $doneCounts = $doneCounts->concat($otherDone);
        }
        if ($hasProject16) {
            $table16 = \App\Services\ProjectOrderService::getTableName(16);
            if (self::tableExists($table16) && self::columnExists($table16, 'delivered_at')) {
                $project16Done = Order::queryAcrossProjects([16], function ($q, $pid) use ($applyProject16DeliveredRange) {
                    $q->where('workflow_state', 'DELIVERED');
                    $applyProject16DeliveredRange($q, 'delivered_at');
                    $q
                        ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                        ->groupBy('project_id');
                });
                $doneCounts = $doneCounts->concat($project16Done);
            }
        }
        $doneCounts = $doneCounts->pluck('cnt', 'project_id');

        // UNTOUCHED COUNTS: project 16 uses date column, others use received_at
        $untouchedCounts = collect();
        if (!empty($otherProjectIds)) {
            $otherUntouched = Order::queryAcrossProjects($otherProjectIds, function ($q, $pid) use ($applyTimestampRange) {
                $applyTimestampRange($q, 'received_at');
                $q
                    ->whereNull('assigned_to')
                    ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                    ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                    ->groupBy('project_id');
            });
            $untouchedCounts = $untouchedCounts->concat($otherUntouched);
        }
        if ($hasProject16) {
            $table16 = \App\Services\ProjectOrderService::getTableName(16);
            if (self::tableExists($table16) && self::columnExists($table16, 'date')) {
                $project16Untouched = Order::queryAcrossProjects([16], function ($q, $pid) use ($applyProject16DateRange) {
                    $applyProject16DateRange($q, 'date');
                    $q
                        ->whereNull('assigned_to')
                        ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                        ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                        ->groupBy('project_id');
                });
                $untouchedCounts = $untouchedCounts->concat($project16Untouched);
            }
        }
        $untouchedCounts = $untouchedCounts->pluck('cnt', 'project_id');

        // PENDING COUNTS: project 16 uses date column, others use received_at
        $pendingCounts = collect();
        if (!empty($otherProjectIds)) {
            $otherPending = Order::queryAcrossProjects($otherProjectIds, function ($q, $pid) use ($applyTimestampRange) {
                $applyTimestampRange($q, 'received_at');
                $q
                    ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                    ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                    ->groupBy('project_id');
            });
            $pendingCounts = $pendingCounts->concat($otherPending);
        }
        if ($hasProject16) {
            $table16 = \App\Services\ProjectOrderService::getTableName(16);
            if (self::tableExists($table16) && self::columnExists($table16, 'date')) {
                $project16Pending = Order::queryAcrossProjects([16], function ($q, $pid) use ($applyProject16DateRange) {
                    $applyProject16DateRange($q, 'date');
                    $q
                        ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                        ->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                        ->groupBy('project_id');
                });
                $pendingCounts = $pendingCounts->concat($project16Pending);
            }
        }
        $pendingCounts = $pendingCounts->pluck('cnt', 'project_id');

        // DELAYED PENDING COUNTS: pending orders with remaining time already passed
        $delayedPendingCounts = collect();
        if (!empty($otherProjectIds)) {
            $otherDelayedPending = Order::queryAcrossProjects($otherProjectIds, function ($q, $pid) use ($applyTimestampRange, $projectDueNow) {
                $offsetHours = self::ASSIGNMENT_DASHBOARD_DUE_IN_OFFSETS[(int) $pid] ?? 0;
                $projectNow = $projectDueNow->get(
                    (int) $pid,
                    now(self::DEFAULT_PROJECT_TIMEZONE)->format('Y-m-d H:i:s')
                );
                $applyTimestampRange($q, 'received_at');
                $q->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED', 'PENDING_BY_DRAWER'])
                    ->whereNotNull('due_in');

                if ($offsetHours !== 0) {
                    $q->whereRaw("DATE_ADD(due_in, INTERVAL {$offsetHours} HOUR) < ?", [$projectNow]);
                } else {
                    $q->where('due_in', '<', $projectNow);
                }

                $q->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                    ->groupBy('project_id');
            });
            $delayedPendingCounts = $delayedPendingCounts->concat($otherDelayedPending);
        }
        if ($hasProject16) {
            $table16 = \App\Services\ProjectOrderService::getTableName(16);
            if (self::tableExists($table16) && self::columnExists($table16, 'date')) {
                $project16DelayedPending = Order::queryAcrossProjects([16], function ($q, $pid) use ($applyProject16DateRange, $projectDueNow) {
                    $offsetHours = self::ASSIGNMENT_DASHBOARD_DUE_IN_OFFSETS[(int) $pid] ?? 0;
                    $projectNow = $projectDueNow->get(
                        (int) $pid,
                        now(self::DEFAULT_PROJECT_TIMEZONE)->format('Y-m-d H:i:s')
                    );
                    $applyProject16DateRange($q, 'date');
                    $q->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED', 'PENDING_BY_DRAWER'])
                        ->whereNotNull('due_in');

                    if ($offsetHours !== 0) {
                        $q->whereRaw("DATE_ADD(due_in, INTERVAL {$offsetHours} HOUR) < ?", [$projectNow]);
                    } else {
                        $q->where('due_in', '<', $projectNow);
                    }

                    $q->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                        ->groupBy('project_id');
                });
                $delayedPendingCounts = $delayedPendingCounts->concat($project16DelayedPending);
            }
        }
        $delayedPendingCounts = $delayedPendingCounts->pluck('cnt', 'project_id');

        // DELAYED DONE COUNTS: RECEIVED cohort + completed after due_in
        // Using UTC columns when available (99.8% backfilled) for explicit timezone handling
        $delayedDoneCounts = collect();
        if (!empty($otherProjectIds)) {
            $otherDelayedDone = Order::queryAcrossProjects($otherProjectIds, function ($q, $pid) use ($applyTimestampRange) {
                $offsetHours = self::ASSIGNMENT_DASHBOARD_DUE_IN_OFFSETS[(int) $pid] ?? 0;
                $q->where('workflow_state', 'DELIVERED')
                    ->whereNotNull('due_in')
                    ->where(function ($completionQuery) {
                        $completionQuery->whereNotNull('delivered_at_utc')
                            ->orWhereNotNull('delivered_at')
                            ->orWhereNotNull('completed_at');
                    });
                // Match projectStats received cohort (not all-time completed range)
                $applyTimestampRange($q, 'received_at');

                if ($offsetHours !== 0) {
                    $q->whereRaw("COALESCE(delivered_at_utc, delivered_at, completed_at) > DATE_ADD(due_in, INTERVAL {$offsetHours} HOUR)");
                } else {
                    $q->whereRaw('COALESCE(delivered_at_utc, delivered_at, completed_at) > due_in');
                }

                $q->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                    ->groupBy('project_id');
            });
            $delayedDoneCounts = $delayedDoneCounts->concat($otherDelayedDone);
        }
        if ($hasProject16) {
            $table16 = \App\Services\ProjectOrderService::getTableName(16);
            if (self::tableExists($table16) && self::columnExists($table16, 'completed_at')) {
                $project16DelayedDone = Order::queryAcrossProjects([16], function ($q, $pid) use ($applyProject16DateRange) {
                    $offsetHours = self::ASSIGNMENT_DASHBOARD_DUE_IN_OFFSETS[(int) $pid] ?? 0;
                    $q->where('workflow_state', 'DELIVERED')
                        ->whereNotNull('due_in')
                        ->where(function ($completionQuery) {
                            $completionQuery->whereNotNull('delivered_at_utc')
                                ->orWhereNotNull('delivered_at')
                                ->orWhereNotNull('completed_at');
                        });
                    // Match project 16 received cohort used across projectStats
                    $applyProject16DateRange($q, 'date');

                    if ($offsetHours !== 0) {
                        $q->whereRaw("COALESCE(delivered_at_utc, delivered_at, completed_at) > DATE_ADD(due_in, INTERVAL {$offsetHours} HOUR)");
                    } else {
                        $q->whereRaw('COALESCE(delivered_at_utc, delivered_at, completed_at) > due_in');
                    }

                    $q->selectRaw('? as project_id, COUNT(*) as cnt', [$pid])
                        ->groupBy('project_id');
                });
                $delayedDoneCounts = $delayedDoneCounts->concat($project16DelayedDone);
            }
        }
        $delayedDoneCounts = $delayedDoneCounts->pluck('cnt', 'project_id');

        $clientNameBreakdownProjectIds = array_values(array_intersect($projectIds, [14, 9, 46]));
        $clientNameCountsByProject = collect();

        foreach ($clientNameBreakdownProjectIds as $clientBreakdownProjectId) {
            $tableName = ProjectOrderService::getTableName($clientBreakdownProjectId);

            if (!self::tableExists($tableName) || !self::columnExists($tableName, 'client_name')) {
                $clientNameCountsByProject[$clientBreakdownProjectId] = [];
                continue;
            }

            $clientNameExpr = "COALESCE(NULLIF(TRIM(client_name), ''), 'Unknown')";

            // Keep the full client list from all-time data so selected-date counts can still show explicit 0 entries.
            $allTimeClientRows = DB::table($tableName)
                ->selectRaw(
                    "? as project_id, {$clientNameExpr} as client_name, COUNT(*) as orders_count",
                    [$clientBreakdownProjectId]
                )
                ->groupByRaw("{$clientNameExpr}")
                ->get();

            $dateScopedClientRows = DB::table($tableName)
                ->selectRaw(
                    "{$clientNameExpr} as client_name, COUNT(*) as orders_count"
                );

            if ($clientBreakdownProjectId === 16 && self::columnExists($tableName, 'date')) {
                $applyProject16DateRange($dateScopedClientRows, 'date');
            } elseif (self::columnExists($tableName, 'received_at')) {
                $applyTimestampRange($dateScopedClientRows, 'received_at');
            } elseif (self::columnExists($tableName, 'created_at')) {
                $applyTimestampRange($dateScopedClientRows, 'created_at');
            } elseif (self::columnExists($tableName, 'date')) {
                $applyProject16DateRange($dateScopedClientRows, 'date');
            }

            $dateScopedCounts = $dateScopedClientRows
                ->groupByRaw("{$clientNameExpr}")
                ->get()
                ->mapWithKeys(function ($row) {
                    return [($row->client_name ?? 'Unknown') => (int) $row->orders_count];
                });

            $clientNameCountsByProject[$clientBreakdownProjectId] = collect($allTimeClientRows)
                ->map(fn($row) => [
                    'project_id' => (int) $row->project_id,
                    'client_name' => $row->client_name,
                    'code_client_name' => $row->client_name,
                    'orders_count' => (int) ($dateScopedCounts->get(($row->client_name ?? 'Unknown'), 0)),
                ])
                ->sortByDesc('orders_count')
                ->sortBy('client_name')
                ->values()
                ->all();
        }

        $effectiveProjectCounts = collect();
        foreach ($projects as $project) {
            $projectId = (int) $project->id;

            if (in_array($projectId, $clientNameBreakdownProjectIds, true)) {
                $namedClientProjects = collect($clientNameCountsByProject->get($projectId, []))
                    ->pluck('client_name')
                    ->filter(fn($clientName) => $clientName !== null && $clientName !== '' && $clientName !== 'Unknown')
                    ->unique()
                    ->count();

                $effectiveProjectCounts[$projectId] = max($namedClientProjects, 1);
            } else {
                $effectiveProjectCounts[$projectId] = 1;
            }
        }

        $stats = [];
        $totals = [
            'total_projects' => 0,
            'raw_total_projects' => $projects->count(),
            'country_count' => 0,
            'received_orders_today' => 0,
            'received_done_orders' => 0,
            'done_orders' => 0,
            'delayed_pending_orders' => 0,
            'delayed_done_orders' => 0,
            'delayed_orders' => 0,
            'total_staff' => 0,
            'present_staff' => 0,
            'absent_staff' => 0,
            'online_staff' => 0,
        ];

        foreach ($projects as $project) {
            $projectId = $project->id;
            $userCount = $userCounts->get($projectId);
            $receivedToday = (int) ($receivedCounts->get($projectId, 0));
            $totalStaff = (int) ($userCount?->total_staff ?? 0);
            $presentStaff = (int) ($userCount?->present_staff ?? 0);
            $absentStaff = (int) ($userCount?->absent_staff ?? 0);
            $onlineStaff = (int) ($userCount?->online_staff ?? 0);
            $onlineUsers = $onlineUsersByProject->get($projectId, collect());
            $delayedPending = (int) ($delayedPendingCounts->get($projectId, 0));
            $delayedDone = (int) ($delayedDoneCounts->get($projectId, 0));
            $effectiveProjectCount = (int) ($effectiveProjectCounts->get($projectId, 1));

            $stats[] = [
                'project_id' => $projectId,
                'project_code' => $project->code,
                'project_name' => $project->name,
                'country' => $project->country,
                'effective_project_count' => $effectiveProjectCount,
                'raw_project_count' => 1,
                'received_orders_today' => $receivedToday,
                'completed_orders_today' => (int) ($completedCounts->get($projectId, 0)),
                'received_done_orders' => (int) ($completedCounts->get($projectId, 0)),
                'done_orders_today' => (int) ($doneCounts->get($projectId, 0)),
                'done_orders' => (int) ($doneCounts->get($projectId, 0)),
                'untouched_orders' => (int) ($untouchedCounts->get($projectId, 0)),
                'pending_orders' => (int) ($pendingCounts->get($projectId, 0)),
                'delayed_pending_orders' => $delayedPending,
                'delayed_done_orders' => $delayedDone,
                'delayed_orders' => $delayedPending + $delayedDone,
                'total_staff' => $totalStaff,
                'present_staff' => $presentStaff,
                'absent_staff' => $absentStaff,
                'online_staff' => $onlineStaff,
                'online_users' => $onlineUsers->values()->all(),
                'client_name_counts' => $clientNameCountsByProject->get($projectId, []),
            ];

            $totals['total_projects'] += $effectiveProjectCount;

            $totals['received_orders_today'] += $receivedToday;
            $totals['received_done_orders'] += (int) ($completedCounts->get($projectId, 0));
            $totals['done_orders'] += (int) ($doneCounts->get($projectId, 0));
            $totals['delayed_pending_orders'] += $delayedPending;
            $totals['delayed_done_orders'] += $delayedDone;
            $totals['delayed_orders'] += ($delayedPending + $delayedDone);
            $totals['total_staff'] += $totalStaff;
            $totals['present_staff'] += $presentStaff;
            $totals['absent_staff'] += $absentStaff;
            $totals['online_staff'] += $onlineStaff;
        }

        // Order projects so those with today_received orders appear first.
        $stats = collect($stats)
            ->sortByDesc('received_orders_today')
            ->values()
            ->all();
        $onlineUsers = collect($stats)
            ->flatMap(fn($row) => $row['online_users'])
            ->values()
            ->all();

        // Country-wise aggregation for the same projectStats payload.
        // Uses per-project stats already computed above to avoid extra scans.
        $countryStats = collect($stats)
            ->groupBy(fn($row) => $row['country'] ?: 'Unknown')
            ->map(function ($countryProjects, $country) {
                return [
                    'country' => $country,
                    'project_count' => (int) $countryProjects->sum('effective_project_count'),
                    'projects_count' => (int) $countryProjects->sum('effective_project_count'),
                    'raw_project_count' => $countryProjects->count(),
                    'received_orders_today' => (int) $countryProjects->sum('received_orders_today'),
                    'received_done_orders' => (int) $countryProjects->sum('received_done_orders'),
                    'done_orders' => (int) $countryProjects->sum('done_orders'),
                    'untouched_orders' => (int) $countryProjects->sum('untouched_orders'),
                    'pending_orders' => (int) $countryProjects->sum('pending_orders'),
                    'delayed_pending_orders' => (int) $countryProjects->sum('delayed_pending_orders'),
                    'delayed_done_orders' => (int) $countryProjects->sum('delayed_done_orders'),
                    'delayed_orders' => (int) $countryProjects->sum('delayed_orders'),
                    'total_staff' => (int) $countryProjects->sum('total_staff'),
                    'present_staff' => (int) $countryProjects->sum('present_staff'),
                    'absent_staff' => (int) $countryProjects->sum('absent_staff'),
                    'online_staff' => (int) $countryProjects->sum('online_staff'),
                    'online_users' => $countryProjects->flatMap(fn($row) => $row['online_users'])->values()->all(),
                    'projects' => $countryProjects->values(),
                ];
            })
            ->sortBy('country')
            ->values()
            ->all();

        $totals['country_count'] = count($countryStats);

        // Safely compute overall received orders today across all active project tables.
        $totals['received_orders_today'] = Order::countAcrossProjects($projectIds, function ($q) use ($applyTimestampRange) {
            $applyTimestampRange($q, 'received_at');
        });

        $responseData = [
            'success' => true,
            'selected_date' => $startDate,
            'start_date' => $startDate,
            'end_date' => $endDate,
            'date_filter_type' => $dateFilterType,
            'selected_role' => $selectedRole,
            'totals' => $totals,
            'online_users' => $onlineUsers,
            'projects' => $stats,
            'countries' => $countryStats,
            'selected_project_breakdown' => $selectedProjectId
                ? $this->buildProjectDoneBreakdown((int) $selectedProjectId, $startDate, $endDate, $selectedRole)
                : null,
        ];
        \Illuminate\Support\Facades\Cache::put($cacheKey, $responseData, 60);
        return response()->json($responseData);
    }

    /**
     * GET /dashboard/country-stats
     * Country-wise project and order statistics.
     * Defaults to UK, Canada, Australia, and Vietnam.
     */
    public function countryStats(Request $request)
    {
        $countryAliasToCanonical = [
            'uk' => 'uk',
            'u.k' => 'uk',
            'united kingdom' => 'uk',
            'england' => 'uk',
            'canada' => 'canada',
            'canda' => 'canada',
            'australia' => 'australia',
            'au' => 'australia',
            'vietnam' => 'vietnam',
            'viet nam' => 'vietnam',
            'vaitnam' => 'vietnam',
        ];

        $canonicalLabels = [
            'uk' => 'UK',
            'canada' => 'Canada',
            'australia' => 'Australia',
            'vietnam' => 'Vietnam',
        ];

        $requestedCountries = $request->query('countries');
        if (is_string($requestedCountries) && trim($requestedCountries) !== '') {
            $requestedCountries = array_filter(array_map('trim', explode(',', $requestedCountries)));
        }

        if (!is_array($requestedCountries) || empty($requestedCountries)) {
            $requestedCountries = ['uk', 'canada', 'australia', 'vietnam'];
        }

        $selectedCanonicalCountries = collect($requestedCountries)
            ->map(function ($country) use ($countryAliasToCanonical) {
                $normalized = strtolower(trim((string) $country));
                return $countryAliasToCanonical[$normalized] ?? $normalized;
            })
            ->filter(fn($country) => isset($canonicalLabels[$country]))
            ->unique()
            ->values();

        if ($selectedCanonicalCountries->isEmpty()) {
            $selectedCanonicalCountries = collect(['uk', 'canada', 'australia', 'vietnam']);
        }

        $projects = Project::where('status', 'active')
            ->get(['id', 'name', 'code', 'country']);

        $projectCanonicalCountry = [];
        foreach ($projects as $project) {
            $rawCountry = strtolower(trim((string) $project->country));
            $projectCanonicalCountry[$project->id] = $countryAliasToCanonical[$rawCountry] ?? $rawCountry;
        }

        $filteredProjects = $projects->filter(function ($project) use ($projectCanonicalCountry, $selectedCanonicalCountries) {
            $canonical = $projectCanonicalCountry[$project->id] ?? null;
            return $canonical !== null && $selectedCanonicalCountries->contains($canonical);
        })->values();

        $projectIds = $filteredProjects->pluck('id')->toArray();

        $orderCounts = collect();
        if (!empty($projectIds)) {
            $orderCounts = Order::queryAcrossProjects($projectIds, function ($q, $pid) {
                $q->selectRaw(
                    "? as project_id,
                     COUNT(*) as total_orders,
                     SUM(CASE WHEN workflow_state = 'DELIVERED' THEN 1 ELSE 0 END) as delivered_orders,
                     SUM(CASE WHEN workflow_state NOT IN ('DELIVERED', 'CANCELLED') THEN 1 ELSE 0 END) as pending_orders",
                    [$pid]
                )->groupBy('project_id');
            })->keyBy('project_id');
        }

        $countryStats = $selectedCanonicalCountries->map(function ($canonicalCountry) use ($canonicalLabels, $filteredProjects, $projectCanonicalCountry, $orderCounts) {
            $countryProjects = $filteredProjects
                ->filter(fn($project) => ($projectCanonicalCountry[$project->id] ?? null) === $canonicalCountry)
                ->values();

            $projectRows = $countryProjects->map(function ($project) use ($orderCounts) {
                $counts = $orderCounts->get($project->id);
                return [
                    'project_id' => $project->id,
                    'project_code' => $project->code,
                    'project_name' => $project->name,
                    'country' => $project->country,
                    'total_orders' => (int) ($counts->total_orders ?? 0),
                    'pending_orders' => (int) ($counts->pending_orders ?? 0),
                    'delivered_orders' => (int) ($counts->delivered_orders ?? 0),
                ];
            })->values();

            return [
                'country_key' => $canonicalCountry,
                'country_name' => $canonicalLabels[$canonicalCountry] ?? ucfirst($canonicalCountry),
                'project_count' => $projectRows->count(),
                'total_orders' => (int) $projectRows->sum('total_orders'),
                'pending_orders' => (int) $projectRows->sum('pending_orders'),
                'delivered_orders' => (int) $projectRows->sum('delivered_orders'),
                'projects' => $projectRows,
            ];
        })->values();

        return response()->json([
            'success' => true,
            'countries' => $countryStats,
            'totals' => [
                'project_count' => (int) $countryStats->sum('project_count'),
                'total_orders' => (int) $countryStats->sum('total_orders'),
                'pending_orders' => (int) $countryStats->sum('pending_orders'),
                'delivered_orders' => (int) $countryStats->sum('delivered_orders'),
            ],
        ]);
    }


    
    private function buildProjectDoneBreakdown(int $projectId, string $startDate, ?string $endDate = null, ?string $selectedRole = null): array
{
    $endDate = $endDate ?: $startDate;
    $project = Project::find($projectId);

    $applyTimestampRange = function ($query, string $column) use ($startDate, $endDate) {
        if ($startDate === $endDate) {
            $query->whereDate($column, $startDate);
            return;
        }

        $query->whereBetween($column, [
            $startDate . ' 00:00:00',
            $endDate . ' 23:59:59',
        ]);
    };

    $applyProject16DeliveredRange = function ($query, string $column) use ($startDate, $endDate) {
        $rangeStart = \Carbon\Carbon::parse($startDate)->subDay()->setTime(22, 0, 0);
        $rangeEnd = \Carbon\Carbon::parse($endDate)->setTime(22, 0, 0);

        $query->where($column, '>=', $rangeStart->toDateTimeString())
            ->where($column, '<', $rangeEnd->toDateTimeString());
    };

    
    if (!$project) {
        return [
            'project_id' => $projectId,
            'project_name' => null,
            'selected_date' => $startDate,
            'start_date' => $startDate,
            'end_date' => $endDate,
            'date_filter_type' => $startDate === $endDate ? 'single_date' : 'date_range',
            'selected_role' => $selectedRole,
            'total_received_done_orders' => 0,
            'total_done_orders' => 0,
            'roles' => [],
        ];
    }

    $table = ProjectOrderService::getTableName($projectId);

    if (!self::tableExists($table)) {
        return [
            'project_id' => $projectId,
            'project_name' => $project->name,
            'selected_date' => $startDate,
            'start_date' => $startDate,
            'end_date' => $endDate,
            'date_filter_type' => $startDate === $endDate ? 'single_date' : 'date_range',
            'selected_role' => $selectedRole,
            'total_received_done_orders' => 0,
            'total_done_orders' => 0,
            'roles' => [],
        ];
    }

    $workflowType = $project->workflow_type ?? 'FP_3_LAYER';
    if (
        empty($project->workflow_type)
        && self::columnExists($table, 'workflow_type')
    ) {
        $tableWorkflowType = DB::table($table)
            ->whereNotNull('workflow_type')
            ->where('workflow_type', '!=', '')
            ->value('workflow_type');

        if (!empty($tableWorkflowType)) {
            $workflowType = $tableWorkflowType;
        }
    }
    $isFloorPlan = $workflowType === 'FP_3_LAYER';

    if ($isFloorPlan && $selectedRole === 'designer') {
        $selectedRole = 'drawer';
    } elseif (!$isFloorPlan && $selectedRole === 'drawer') {
        $selectedRole = 'designer';
    }

    $roles = [
        'drawer' => [
            'id_col' => 'drawer_id',
            'name_col' => 'drawer_name',
            'done_col' => 'drawer_done',
            'done_date_col' => 'drawer_date',
        ],
        'designer' => [
            'id_col' => 'drawer_id',
            'name_col' => 'drawer_name',
            'done_col' => 'drawer_done',
            'done_date_col' => 'drawer_date',
        ],
        'checker' => [
            'id_col' => 'checker_id',
            'name_col' => 'checker_name',
            'done_col' => 'checker_done',
            'done_date_col' => 'checker_date',
        ],
        'qa' => [
            'id_col' => 'qa_id',
            'name_col' => 'qa_name',
            'done_col' => 'final_upload',
            'done_date_col' => 'delivered_at',
        ],
        'filler' => [
            'id_col' => 'file_uploader_id',
            'name_col' => 'file_uploader_name',
            'done_col' => 'file_uploaded',
            'done_date_col' => 'file_upload_date',
        ],
    ];

    $projectRoleOverrides = [
        12 => [
            'filler' => [
                'done_col' => 'file_uploaded',
                'done_date_col' => 'file_upload_date',
            ],
        ],
    ];

    $alwaysIncludeRolesByProject = [
        12 => ['filler'],
    ];

    $baseRoleKeys = $isFloorPlan ? ['drawer', 'checker', 'qa'] : ['designer', 'qa'];
    $projectExtraRolesById = [
        12 => ['filler'],
    ];
    $roleKeys = array_values(array_unique(array_merge(
        $baseRoleKeys,
        $projectExtraRolesById[(int) $projectId] ?? []
    )));

    $roleBreakdown = [];
    $teamBreakdownRows = collect();

    $applyProjectCohortRange = function ($query) use ($projectId, $table, $startDate, $endDate, $applyTimestampRange) {
        if ((int) $projectId === 16 && self::columnExists($table, 'date')) {
            if ($startDate === $endDate) {
                $query->where('date', \Carbon\Carbon::parse($startDate)->format('d-m-Y'));
                return true;
            }

            $dateList = [];
            $cursor = \Carbon\Carbon::parse($startDate);
            $rangeEnd = \Carbon\Carbon::parse($endDate);

            while ($cursor->lte($rangeEnd)) {
                $dateList[] = $cursor->format('d-m-Y');
                $cursor->addDay();
            }

            $query->whereIn('date', $dateList);
            return true;
        }

        if (self::columnExists($table, 'received_at')) {
            $applyTimestampRange($query, 'received_at');
            return true;
        }

        if (self::columnExists($table, 'created_at')) {
            $applyTimestampRange($query, 'created_at');
            return true;
        }

        return false;
    };

    $applyRoleDoneRange = function ($query, string $doneDateColumn) use ($table, $startDate, $endDate, $applyTimestampRange) {
        if (self::columnExists($table, $doneDateColumn)) {
            $applyTimestampRange($query, $doneDateColumn);
            return true;
        }

        if (self::columnExists($table, 'received_at')) {
            $applyTimestampRange($query, 'received_at');
            return true;
        }

        if (self::columnExists($table, 'created_at')) {
            $applyTimestampRange($query, 'created_at');
            return true;
        }

        return false;
    };

    foreach ($roleKeys as $roleKey) {
        $config = $roles[$roleKey] ?? null;
        if ($config === null) {
            continue;
        }

        if ($selectedRole !== null && $selectedRole !== $roleKey) {
            continue;
        }

        $roleOverride = $projectRoleOverrides[(int) $projectId][$roleKey] ?? null;
        if ($roleOverride !== null) {
            $config = array_merge($config, $roleOverride);
        }

        // Skip if required columns missing
        if (
            !self::columnExists($table, $config['name_col'])
            || !self::columnExists($table, $config['done_col'])
        ) {
            continue;
        }

        /* =====================================================
           1. ALL DONE TODAY
           QA stays on delivered_at.
           Other roles use their own done date columns.
           Project 16 keeps its 10 PM -> 10 PM delivery window.
        ===================================================== */

        $queryDoneToday = DB::table($table)
            ->whereNotNull($config['name_col'])
            ->where($config['name_col'], '!=', '');

        if ($roleKey === 'designer') {
            $queryDoneToday->where(function ($query) use ($config, $table) {
                $query->where($config['done_col'], 'yes');

                if (self::columnExists($table, 'final_upload')) {
                    $query->orWhere('final_upload', 'yes');
                }

                if (self::columnExists($table, 'workflow_state')) {
                    $query->orWhere('workflow_state', 'DELIVERED');
                }
            });
        } else {
            $queryDoneToday->where($config['done_col'], 'yes');
        }

        if ((int) $projectId === 12 && $roleKey === 'filler') {
            if (!self::columnExists($table, $config['done_date_col'])) {
                continue;
            }

            $applyTimestampRange($queryDoneToday, $config['done_date_col']);
        } elseif ($roleKey === 'qa') {
            if ((int) $projectId === 16 && self::columnExists($table, 'delivered_at')) {
                $applyProject16DeliveredRange($queryDoneToday, 'delivered_at');
            } elseif (self::columnExists($table, 'delivered_at')) {
                $applyTimestampRange($queryDoneToday, 'delivered_at');
            } elseif (!$applyRoleDoneRange($queryDoneToday, $config['done_date_col'])) {
                continue;
            }
        } elseif (
            $roleKey === 'designer'
            && self::columnExists($table, 'delivered_at')
            && !self::columnExists($table, $config['done_date_col'])
        ) {
            $applyTimestampRange($queryDoneToday, 'delivered_at');
        } elseif (!$applyRoleDoneRange($queryDoneToday, $config['done_date_col'])) {
            continue;
        }

        $doneTodayAll = $queryDoneToday
            ->selectRaw("{$config['name_col']} as name, COUNT(*) as done_count")
            ->groupBy($config['name_col'])
            ->orderByDesc('done_count')
            ->orderBy($config['name_col'])
            ->get()
            ->map(fn ($row) => [
                'name' => $row->name,
                'done_count' => (int) $row->done_count,
            ])
            ->values();

        if (in_array($roleKey, ['drawer', 'checker', 'qa'], true) && self::columnExists($table, 'team_id')) {
            $userIdSelect = self::columnExists($table, $config['id_col'])
                ? "{$config['id_col']} as user_id"
                : "NULL as user_id";

            $queryTeamDoneToday = DB::table($table)
                ->whereNotNull($config['name_col'])
                ->where($config['name_col'], '!=', '');

            if ($roleKey === 'designer') {
                $queryTeamDoneToday->where(function ($query) use ($config, $table) {
                    $query->where($config['done_col'], 'yes');

                    if (self::columnExists($table, 'final_upload')) {
                        $query->orWhere('final_upload', 'yes');
                    }

                    if (self::columnExists($table, 'workflow_state')) {
                        $query->orWhere('workflow_state', 'DELIVERED');
                    }
                });
            } else {
                $queryTeamDoneToday->where($config['done_col'], 'yes');
            }

            if (!$applyProjectCohortRange($queryTeamDoneToday)) {
                $queryTeamDoneToday = null;
            }

            if ($queryTeamDoneToday !== null) {
                $teamBreakdownRows = $teamBreakdownRows->concat(
                    $queryTeamDoneToday
                        ->selectRaw("team_id as order_team_id, {$userIdSelect}, {$config['name_col']} as name, COUNT(*) as done_count")
                        ->groupBy('team_id', $config['name_col'])
                        ->when(
                            self::columnExists($table, $config['id_col']),
                            fn($query) => $query->groupBy($config['id_col'])
                        )
                        ->get()
                        ->map(fn($row) => [
                            'role' => $roleKey,
                            'order_team_id' => $row->order_team_id ? (int) $row->order_team_id : null,
                            'user_id' => $row->user_id ? (int) $row->user_id : null,
                            'name' => $row->name,
                            'done_count' => (int) $row->done_count,
                        ])
                );
            }
        }


        /* =====================================================
           2. RECEIVED TODAY + DONE TODAY
        ===================================================== */

        $queryReceivedDone = DB::table($table)
            ->whereNotNull($config['name_col'])
            ->where($config['name_col'], '!=', '');

        if ($roleKey === 'designer') {
            $queryReceivedDone->where(function ($query) use ($config, $table) {
                $query->where($config['done_col'], 'yes');

                if (self::columnExists($table, 'final_upload')) {
                    $query->orWhere('final_upload', 'yes');
                }

                if (self::columnExists($table, 'workflow_state')) {
                    $query->orWhere('workflow_state', 'DELIVERED');
                }
            });
        } else {
            $queryReceivedDone->where($config['done_col'], 'yes');
        }

        if (!$applyProjectCohortRange($queryReceivedDone)) {
            continue;
        }

        $receivedTodayDone = $queryReceivedDone
            ->selectRaw("{$config['name_col']} as name, COUNT(*) as done_count")
            ->groupBy($config['name_col'])
            ->orderByDesc('done_count')
            ->orderBy($config['name_col'])
            ->get()
            ->map(fn ($row) => [
                'name' => $row->name,
                'done_count' => (int) $row->done_count,
            ])
            ->values();


        // Skip filler if empty (your existing behavior)
        $alwaysIncludeRoles = $alwaysIncludeRolesByProject[(int) $projectId] ?? [];
        if (!in_array($roleKey, $alwaysIncludeRoles, true) && $roleKey === 'filler' && $doneTodayAll->isEmpty() && $receivedTodayDone->isEmpty()) {
            continue;
        }

        /* =====================================================
           FINAL STRUCTURE
        ===================================================== */

        $roleBreakdown[] = [
            'role' => $roleKey,
            'label' => ucfirst($roleKey),

            // 🔹 Metric 1
            'today_received_done' => $receivedTodayDone,
            'total_today_received_done' => $receivedTodayDone->sum('done_count'),

            // 🔹 Metric 2
            'today_done_all' => $doneTodayAll,
            'total_today_done_all' => $doneTodayAll->sum('done_count'),
        ];
    }

    $teamsBreakdown = $this->buildTeamWiseDoneBreakdown($projectId, $teamBreakdownRows, $startDate, $endDate, $selectedRole);

    return [
        'project_id' => $project->id,
        'project_name' => $project->name,
        'selected_date' => $startDate,
        'start_date' => $startDate,
        'end_date' => $endDate,
        'date_filter_type' => $startDate === $endDate ? 'single_date' : 'date_range',
        'selected_role' => $selectedRole,
        'total_received_done_orders' => collect($roleBreakdown)->sum('total_today_received_done'),
        'total_done_orders' => collect($roleBreakdown)->sum('total_today_done_all'),
        'roles' => $roleBreakdown,
        'teams' => $teamsBreakdown,
    ];
}




    private function buildTeamWiseDoneBreakdown(
        int $projectId,
        \Illuminate\Support\Collection $teamBreakdownRows,
        string $startDate,
        string $endDate,
        ?string $selectedRole = null
    ): array
    {
        if ($teamBreakdownRows->isEmpty()) {
            return [];
        }

        $teams = \App\Models\Team::where('project_id', $projectId)
            ->get(['id', 'name'])
            ->keyBy('id');

        $users = User::where('project_id', $projectId)
            ->whereIn('role', ['drawer', 'checker', 'qa'])
            ->get(['id', 'name', 'role', 'team_id', 'wip_count'])
            ->keyBy('id');

        $usersByNameRole = $users
            ->groupBy(fn($user) => strtolower(trim($user->role . '|' . $user->name)));

        $teamGroups = [];

        foreach ($teamBreakdownRows as $row) {
            $role = $row['role'];
            $user = !empty($row['user_id'])
                ? $users->get((int) $row['user_id'])
                : null;

            if ($user === null && !empty($row['name'])) {
                $nameKey = strtolower(trim($role . '|' . $row['name']));
                $user = optional($usersByNameRole->get($nameKey))->first();
            }

            $teamId = $row['order_team_id'] ?: ($user?->team_id ? (int) $user->team_id : 0);
            $teamName = $teamId > 0
                ? ($teams->get($teamId)?->name ?? 'Unknown Team')
                : 'Unassigned Team';

            if (!isset($teamGroups[$teamId])) {
                $teamGroups[$teamId] = [
                    'team_id' => $teamId,
                    'team_name' => $teamName,
                    'selected_date' => $startDate,
                    'start_date' => $startDate,
                    'end_date' => $endDate,
                    'date_filter_type' => $startDate === $endDate ? 'single_date' : 'date_range',
                    'selected_role' => $selectedRole,
                    'drawer_done' => 0,
                    'checker_done' => 0,
                    'qa_done' => 0,
                    'total_completed_orders' => 0,
                    'total_role_done' => 0,
                    'total_done_selected_date' => 0,
                    'drawers' => [],
                    'checkers' => [],
                    'qas' => [],
                ];
            }

            $doneCount = (int) $row['done_count'];
            $doneKey = "{$role}_done";
            $memberKey = $role === 'qa' ? 'qas' : "{$role}s";

            $teamGroups[$teamId][$doneKey] += $doneCount;
            $teamGroups[$teamId]['total_role_done'] += $doneCount;

            $memberId = $user?->id ? (int) $user->id : 0;
            $memberMapKey = $memberId > 0 ? "id:{$memberId}" : 'name:' . strtolower(trim((string) $row['name']));

            if (!isset($teamGroups[$teamId][$memberKey][$memberMapKey])) {
                $teamGroups[$teamId][$memberKey][$memberMapKey] = [
                    'id' => $memberId > 0 ? $memberId : null,
                    'name' => $user?->name ?? $row['name'],
                    'role' => $role,
                    'team_id' => $teamId,
                    'team_name' => $teamName,
                    'total_done' => 0,
                    'total_done_selected_date' => 0,
                    'wip' => (int) ($user?->wip_count ?? 0),
                ];
            }

            $teamGroups[$teamId][$memberKey][$memberMapKey]['total_done'] += $doneCount;
            $teamGroups[$teamId][$memberKey][$memberMapKey]['total_done_selected_date'] += $doneCount;
        }

        // Fetch pending order counts per team (current snapshot, not date-filtered)
        $table = \App\Services\ProjectOrderService::getTableName($projectId);
        $teamPendingCounts = collect();

        if (self::tableExists($table) && self::columnExists($table, 'workflow_state')) {
            // Try direct team_id on orders first
            if (self::columnExists($table, 'team_id')) {
                $direct = DB::table($table)
                    ->whereNotNull('team_id')
                    ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                    ->selectRaw('team_id, COUNT(*) as cnt')
                    ->groupBy('team_id')
                    ->pluck('cnt', 'team_id');
                if ($direct->isNotEmpty()) {
                    $teamPendingCounts = $direct;
                }
            }
            // Fallback: infer team from drawer assignment via users table
            if ($teamPendingCounts->isEmpty() && self::columnExists($table, 'drawer_id')) {
                $teamPendingCounts = DB::table($table . ' as o')
                    ->join('users as u', 'o.drawer_id', '=', 'u.id')
                    ->whereNotNull('u.team_id')
                    ->whereNotIn('o.workflow_state', ['DELIVERED', 'CANCELLED'])
                    ->selectRaw('u.team_id, COUNT(DISTINCT o.id) as cnt')
                    ->groupBy('u.team_id')
                    ->pluck('cnt', 'team_id');
            }
        }

        foreach ($teamGroups as &$team) {
            $team['total_completed_orders'] = (int) $team['qa_done'];
            $team['total_done'] = (int) $team['total_role_done'];
            $team['total_done_selected_date'] = (int) $team['total_role_done'];
            $team['completed_orders_selected_date'] = (int) $team['qa_done'];
            $team['pending'] = (int) ($teamPendingCounts->get($team['team_id'], 0));
            $team['total_assigned'] = $team['pending'] + $team['total_done_selected_date'];

            foreach (['drawers', 'checkers', 'qas'] as $memberKey) {
                $team[$memberKey] = collect($team[$memberKey])
                    ->sortByDesc('total_done')
                    ->values()
                    ->all();
            }
        }
        unset($team);

        return collect($teamGroups)
            ->sortByDesc('total_completed_orders')
            ->values()
            ->all();
    }



    /**
     * GET /dashboard/operations
     * Ops Manager: assigned projects overview.
     */
    public function operations(Request $request)
    {
        $t0 = microtime(true);
        $user = $request->user();
        $dateFilter = $request->input('date');
        $startDate = $request->input('start_date');
        $endDate = $request->input('end_date');

        if (!in_array($user->role, ['ceo', 'director', 'operations_manager'])) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // ─── CACHE LAYER (20s TTL — Smart Polling checks every 10s) ──
        $cacheKey = 'ops_dashboard_' . $user->id . '_' . md5(json_encode([
            'date' => $dateFilter,
            'start_date' => $startDate,
            'end_date' => $endDate,
        ]));
        $cached = \Illuminate\Support\Facades\Cache::get($cacheKey);
        if ($cached) {
            $ms = round((microtime(true) - $t0) * 1000);
            return response($cached, 200, [
                'Content-Type' => 'application/json',
                'Server-Timing' => "total;dur={$ms}",
            ]);
        }

        // Get projects based on role
        if ($user->role === 'operations_manager') {
            $projectIds = $user->getManagedProjectIds();
            $projects = Project::whereIn('id', $projectIds)->where('status', 'active')->get();
        } else {
            // CEO/Director — see all (or country-scoped)
            $projects = Project::where('status', 'active')->get();
        }

        $projectIds = $projects->pluck('id');
        $projectIdsArray = $projectIds->toArray();

        // ─── BULK LOADS (minimize table scans) ──────────────────────

        // Reusable date boundaries
        $todayStart = $this->businessDayBounds()[0];
        $tomorrowStart = $this->businessDayBounds()[1];
        $weekStart = now()->subDays(6)->startOfDay();

        // 1. All staff once (replaces per-project User::where + later allStaff re-query)
        $allStaff = User::whereIn('project_id', $projectIds)
            ->where('is_active', true)->get();
        $staffByProject = $allStaff->groupBy('project_id');

        // 2. Today's completions — single query on WorkItem (small table)
        $todayCompletions = WorkItem::where('completed_at', '>=', $todayStart)
            ->where('completed_at', '<', $tomorrowStart)
            ->where('status', 'completed')
            ->selectRaw('assigned_user_id, COUNT(*) as cnt')
            ->groupBy('assigned_user_id')
            ->pluck('cnt', 'assigned_user_id');

        // 3. State counts — SPLIT into 2 fast queries (avoids CASE WHEN table lookups)
        //    Query A: Simple GROUP BY workflow_state (uses workflow_state index, ~300ms)
        $allStateCounts = Order::queryAcrossProjects($projectIdsArray, function($q) {
            $q->selectRaw('project_id, workflow_state, COUNT(*) as cnt')
              ->groupBy('project_id', 'workflow_state');
        })->groupBy('project_id');

        //    Query B: Delivered today count (uses idx_delivered_at, ~5ms)
        $deliveredTodayByProject = Order::queryAcrossProjects($projectIdsArray, function($q) use ($todayStart, $tomorrowStart) {
            $q->where('workflow_state', 'DELIVERED')
              ->where('delivered_at', '>=', $todayStart)
              ->where('delivered_at', '<', $tomorrowStart)
              ->selectRaw('project_id, COUNT(*) as cnt')
              ->groupBy('project_id');
        })->pluck('cnt', 'project_id');

        // 4. Worker assigned counts — batch GROUP BY (single scan per table)
        $workerAssignedCounts = Order::queryAcrossProjects($projectIdsArray, function($q) {
            $q->whereNotNull('assigned_to')
              ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
              ->selectRaw('assigned_to, COUNT(*) as cnt')
              ->groupBy('assigned_to');
        })->pluck('cnt', 'assigned_to');

        // 5. Team stats — SPLIT into 2 queries (avoids CASE WHEN on delivered_at)
        //    Query A: Team pending counts (uses workflow_state index)
        $teamPendingStats = Order::queryAcrossProjects($projectIdsArray, function($q) {
            $q->whereNotNull('team_id')
              ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
              ->selectRaw('team_id, COUNT(*) as pending')
              ->groupBy('team_id');
        });

        //    Query B: Team delivered today (uses idx_delivered_at, very fast)
        $teamDeliveredStats = Order::queryAcrossProjects($projectIdsArray, function($q) use ($todayStart, $tomorrowStart) {
            $q->whereNotNull('team_id')
              ->where('workflow_state', 'DELIVERED')
              ->where('delivered_at', '>=', $todayStart)
              ->where('delivered_at', '<', $tomorrowStart)
              ->selectRaw('team_id, COUNT(*) as delivered_today')
              ->groupBy('team_id');
        });

        // ─── BUILD PROJECT DATA (zero individual queries) ───────────

        $totalPending = 0;
        $totalDeliveredToday = 0;

        $data = $projects->map(function ($project) use (
            $staffByProject, $todayCompletions, $allStateCounts,
            $deliveredTodayByProject, &$totalPending, &$totalDeliveredToday
        ) {
            $staff = $staffByProject->get($project->id, collect());
            $activeStaff = $staff->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count();

            // State counts from bulk-loaded data (no queries!)
            $projectStates = $allStateCounts->get($project->id, collect());
            $stateCountsMap = $projectStates->pluck('cnt', 'workflow_state');

            // Pending = everything except DELIVERED and CANCELLED
            $pending = $stateCountsMap->except(['DELIVERED', 'CANCELLED'])->sum();
            $deliveredToday = (int) ($deliveredTodayByProject[$project->id] ?? 0);

            $totalPending += $pending;
            $totalDeliveredToday += $deliveredToday;

            // Queue health — filter to relevant workflow states
            $workflowType = $project->workflow_type ?? 'FP_3_LAYER';
            $states = $workflowType === 'PH_2_LAYER' ? StateMachine::PH_STATES : StateMachine::FP_STATES;
            $stateCounts = [];
            foreach ($states as $state) {
                $count = (int) ($stateCountsMap[$state] ?? 0);
                if ($count > 0) {
                    $stateCounts[$state] = $count;
                }
            }

            // Staffing details
            $staffDetails = $staff->map(fn($s) => [
                'id' => $s->id,
                'name' => $s->name,
                'role' => $s->role,
                'is_online' => $s->last_activity && $s->last_activity->gt(now()->subMinutes(15)),
                'is_absent' => $s->is_absent,
                'wip_count' => $s->wip_count,
                'assignment_score' => round((float) $s->assignment_score, 2),
                'today_completed' => $todayCompletions->get($s->id, 0),
            ]);

            return [
                'project' => $project->only(['id', 'code', 'name', 'country', 'department', 'workflow_type', 'queue_name']),
                'pending' => $pending,
                'delivered_today' => $deliveredToday,
                'total_staff' => $staff->count(),
                'active_staff' => $activeStaff,
                'queue_health' => [
                    'stages' => $stateCounts,
                    'staffing' => $staffDetails,
                ],
            ];
        });

        // Totals computed from bulk-loaded data — NO redundant re-queries
        $totalActiveStaff = $allStaff->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count();
        $totalAbsent = $allStaff->where('is_absent', true)->count();
        // $totalPending and $totalDeliveredToday already accumulated in the project loop above

        // Role-wise completion statistics — only roles relevant to the OM's projects
        $roleStats = [];
        $projectWorkflowTypes = $projects->pluck('workflow_type')->unique();
        $relevantRoles = [];
        if ($projectWorkflowTypes->contains('FP_3_LAYER') || $projectWorkflowTypes->contains(null)) {
            $relevantRoles = array_merge($relevantRoles, ['drawer', 'checker', 'qa']);
        }
        if ($projectWorkflowTypes->contains('PH_2_LAYER')) {
            $relevantRoles = array_merge($relevantRoles, ['designer', 'qa']);
        }
        $roles = array_unique($relevantRoles);
        foreach ($roles as $role) {
            $roleUsers = $allStaff->where('role', $role);
            $roleUserIds = $roleUsers->pluck('id');
            $roleStats[$role] = [
                'total_staff' => $roleUsers->count(),
                'active' => $roleUsers->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count(),
                'absent' => $roleUsers->where('is_absent', true)->count(),
                'today_completed' => $roleUserIds->sum(fn($uid) => $todayCompletions->get($uid, 0)),
                'total_wip' => $roleUsers->sum('wip_count'),
            ];
        }

        // Date-wise statistics (last 7 days) — bulk load
        $allStaffIds = $allStaff->pluck('id');
        $roleUserIds = [];
        foreach ($roles as $role) {
            $roleUserIds[$role] = $allStaff->where('role', $role)->pluck('id');
        }

        $weekCompletions = WorkItem::whereIn('assigned_user_id', $allStaffIds)
            ->where('status', 'completed')
            ->where('completed_at', '>=', now()->subDays(6)->startOfDay())
            ->selectRaw('assigned_user_id, DATE(completed_at) as completed_date, COUNT(*) as cnt')
            ->groupBy('assigned_user_id', 'completed_date')
            ->get()
            ->groupBy('completed_date');

        $weekReceived = Order::queryAcrossProjects($projectIds->toArray(), function($q) {
            $q->where('received_at', '>=', now()->subDays(6)->startOfDay())
              ->selectRaw('DATE(received_at) as the_date, COUNT(*) as cnt')
              ->groupBy('the_date');
        });
        // Merge counts for same dates across projects
        $weekReceivedMerged = $weekReceived->groupBy('the_date')->map(fn($items) => $items->sum('cnt'));

        $weekDelivered = Order::queryAcrossProjects($projectIds->toArray(), function($q) {
            $q->where('workflow_state', 'DELIVERED')
              ->where('delivered_at', '>=', now()->subDays(6)->startOfDay())
              ->selectRaw('DATE(delivered_at) as the_date, COUNT(*) as cnt')
              ->groupBy('the_date');
        });
        $weekDeliveredMerged = $weekDelivered->groupBy('the_date')->map(fn($items) => $items->sum('cnt'));

        $dateStats = [];
        for ($i = 6; $i >= 0; $i--) {
            $date = now()->subDays($i)->format('Y-m-d');
            $dateLabel = now()->subDays($i)->format('D');
            
            $dayItems = $weekCompletions->get($date, collect());
            $roleCompletions = [];
            foreach ($roles as $role) {
                $roleCompletions[$role] = $dayItems->whereIn('assigned_user_id', $roleUserIds[$role])->sum('cnt');
            }
            
            $dateStats[] = [
                'date' => $date,
                'label' => $dateLabel,
                'received' => $weekReceivedMerged->get($date, 0),
                'delivered' => $weekDeliveredMerged->get($date, 0),
                'by_role' => $roleCompletions,
            ];
        }

        // Absentees detail
        $absentees = $allStaff->where('is_absent', true)->map(fn($u) => [
            'id' => $u->id,
            'name' => $u->name,
            'role' => $u->role,
            'project_name' => $projects->firstWhere('id', $u->project_id)?->name,
        ])->values();

        // Workers list — uses bulk-loaded assigned counts (no N+1 queries)
        // Bulk-load week + month completions in SINGLE query (bucketed)
        $monthStart = now()->startOfMonth();
        $workerCombinedCompletions = WorkItem::whereIn('assigned_user_id', $allStaffIds)
            ->where('status', 'completed')
            ->where('completed_at', '>=', $monthStart)
            ->selectRaw('assigned_user_id, COUNT(*) as month_cnt, SUM(CASE WHEN completed_at >= ? THEN 1 ELSE 0 END) as week_cnt', [$weekStart])
            ->groupBy('assigned_user_id')
            ->get()
            ->keyBy('assigned_user_id');
        $workerWeekCompletions = $workerCombinedCompletions->mapWithKeys(fn($r, $k) => [$k => $r->week_cnt]);
        $workerMonthCompletions = $workerCombinedCompletions->mapWithKeys(fn($r, $k) => [$k => $r->month_cnt]);

        // Pre-load project names and team names for workers display
        $projectNamesMap = $projects->pluck('name', 'id');
        $teamIds = $allStaff->pluck('team_id')->filter()->unique();
        $teamNamesMap = \App\Models\Team::whereIn('id', $teamIds)->pluck('name', 'id');

        $workers = $allStaff->map(function ($u) use ($todayCompletions, $workerAssignedCounts, $workerWeekCompletions, $workerMonthCompletions, $projectNamesMap, $teamNamesMap) {
            $assignedWork = (int) ($workerAssignedCounts[$u->id] ?? 0);
            return [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'role' => $u->role,
                'project_id' => $u->project_id,
                'project_name' => $projectNamesMap->get($u->project_id, '—'),
                'team_id' => $u->team_id,
                'team_name' => $teamNamesMap->get($u->team_id, '—'),
                'is_active' => $u->is_active,
                'is_absent' => $u->is_absent,
                'wip_count' => $u->wip_count,
                'assignment_score' => round((float) $u->assignment_score, 2),
                'today_completed' => $todayCompletions->get($u->id, 0),
                'completed_week' => $workerWeekCompletions->get($u->id, 0),
                'completed_month' => $workerMonthCompletions->get($u->id, 0),
                'assigned_work' => $assignedWork,
                'pending_work' => max(0, $assignedWork - $u->wip_count),
                'daily_target' => $u->daily_target ?? 0,
                'avg_completion_minutes' => round((float) ($u->avg_completion_minutes ?? 0), 1),
                'last_activity' => $u->last_activity,
                'is_online' => $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)),
            ];
        })->values();

        // Filtered completed work per worker for team member breakdown.
        // For now, use today's completions (same as in roleStats) to avoid complex date filtering
        // TODO: Implement proper per-project date window filtering for team members
        $teamMemberCompletions = WorkItem::whereIn('assigned_user_id', $allStaffIds)
            ->where('status', 'completed')
            ->where('completed_at', '>=', $todayStart)
            ->where('completed_at', '<', $tomorrowStart)
            ->selectRaw('assigned_user_id, COUNT(*) as cnt')
            ->groupBy('assigned_user_id')
            ->pluck('cnt', 'assigned_user_id');

        // Team-wise Performance — uses bulk-loaded teamStats (no extra queries)
        $teams = \App\Models\Team::whereIn('project_id', $projectIds)
            ->with(['project:id,name,code', 'qaLead:id,name'])
            ->where('is_active', true)
            ->get();

        // Derive team delivered/pending from the split team queries
        $teamDeliveredToday = collect();
        $teamPending = collect();
        foreach ($teamDeliveredStats as $row) {
            $teamDeliveredToday[$row->team_id] = ($teamDeliveredToday[$row->team_id] ?? 0) + (int) $row->delivered_today;
        }
        foreach ($teamPendingStats as $row) {
            $teamPending[$row->team_id] = ($teamPending[$row->team_id] ?? 0) + (int) $row->pending;
        }

        $teamPerformance = $teams->map(function ($team) use ($teamDeliveredToday, $teamPending, $allStaff, $teamMemberCompletions) {
            $teamStaff = $allStaff->where('team_id', $team->id);
            $activeTeamStaff = $teamStaff->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)));
            $teamStaffIds = $teamStaff->pluck('id');
            $teamTodayCompleted = $teamStaffIds->sum(fn($uid) => $teamMemberCompletions->get($uid, 0));

            $buildRoleMembers = function (string $role) use ($teamStaff, $teamMemberCompletions) {
                return $teamStaff->where('role', $role)
                    ->map(fn($u) => [
                        'id' => $u->id,
                        'name' => $u->name,
                        'total_done' => (int) ($teamMemberCompletions->get($u->id, 0)),
                        'wip' => (int) ($u->wip_count ?? 0),
                    ])
                    ->values();
            };

            $drawers = $buildRoleMembers('drawer');
            $checkers = $buildRoleMembers('checker');
            $qas = $buildRoleMembers('qa');
            $drawerTotalDone = (int) $drawers->sum('total_done');
            $checkerTotalDone = (int) $checkers->sum('total_done');
            $qaTotalDone = (int) $qas->sum('total_done');
            $teamTotalDone = $drawerTotalDone + $checkerTotalDone + $qaTotalDone;
            
            return [
                'id' => $team->id,
                'name' => $team->name,
                'project_code' => $team->project->code ?? '-',
                'qa_lead' => $team->qaLead?->name ?? 'Unassigned',
                'staff_count' => $teamStaff->count(),
                'active_staff' => $activeTeamStaff->count(),
                'absent_staff' => $teamStaff->where('is_absent', true)->count(),
                'delivered_today' => $teamDeliveredToday->get($team->id, 0),
                'pending' => $teamPending->get($team->id, 0),
                'today_completed' => $teamTodayCompleted,
                'drawer_total_done' => $drawerTotalDone,
                'checker_total_done' => $checkerTotalDone,
                'qa_total_done' => $qaTotalDone,
                'total_done' => $teamTotalDone,
                // As requested, delivered mirrors completed count for team summary.
                'delivered' => $teamTotalDone,
                'efficiency' => $teamStaff->count() > 0 ? round($teamTodayCompleted / max($teamStaff->count(), 1), 1) : 0,
                // Backward-safe additive fields for role-level visibility.
                'drawer_names' => $drawers->pluck('name')->implode(', '),
                'checker_names' => $checkers->pluck('name')->implode(', '),
                'qa_names' => $qas->pluck('name')->implode(', '),
                'drawers' => $drawers,
                'checkers' => $checkers,
                'qas' => $qas,
            ];
        })->sortByDesc('delivered_today')->values();

        // Project managers (scoped to requesting user's projects for OM visibility)
        $pmQuery = User::where('role', 'project_manager')
            ->where('is_active', true)
            ->with('managedProjects:id,code,name');

        // For OM: only show PMs assigned to the OM's projects
        if ($user->role === 'operations_manager') {
            $pmQuery->whereHas('managedProjects', function ($q) use ($projectIds) {
                $q->whereIn('projects.id', $projectIds);
            });
        }

        $projectManagers = $pmQuery->get()
            ->map(fn($pm) => [
                'id' => $pm->id,
                'name' => $pm->name,
                'email' => $pm->email,
                'projects' => $pm->managedProjects->map(fn($p) => ['id' => $p->id, 'code' => $p->code, 'name' => $p->name]),
            ])->values();

        // ─── QA SUMMARY WITH DATE SELECTION ──────────────────────
        // Build QA-specific done count query with date filtering
        $qaDateStart = $todayStart;
        $qaDateEnd = $tomorrowStart;

        // Parse date parameters if provided (for date range filtering)
        if ($dateFilter === 'range' && $startDate && $endDate) {
            $qaDateStart = \Carbon\Carbon::parse($startDate)->startOfDay();
            $qaDateEnd = \Carbon\Carbon::parse($endDate)->endOfDay();
        } elseif ($dateFilter === 'custom' && $startDate) {
            $qaDateStart = \Carbon\Carbon::parse($startDate)->startOfDay();
            $qaDateEnd = \Carbon\Carbon::parse($startDate)->endOfDay();
        }

        // Get all QAs across projects
        $qaStaff = $allStaff->where('role', 'qa');
        $qaIds = $qaStaff->pluck('id');

        // Query QA done counts for selected date range
        $qaCompletionsByDate = WorkItem::whereIn('assigned_user_id', $qaIds)
            ->where('status', 'completed')
            ->where('completed_at', '>=', $qaDateStart)
            ->where('completed_at', '<=', $qaDateEnd)
            ->selectRaw('assigned_user_id, COUNT(*) as cnt')
            ->groupBy('assigned_user_id')
            ->pluck('cnt', 'assigned_user_id');

        // Build QA summary with safe filtering
        $qaSummary = [
            'date_range' => [
                'filter_type' => $dateFilter ?? 'today',
                'from' => $qaDateStart->format('Y-m-d H:i:s'),
                'to' => $qaDateEnd->format('Y-m-d H:i:s'),
            ],
            'total_qa_staff' => $qaStaff->count(),
            'qa_with_uploads' => $qaStaff->filter(fn($qa) => $qaCompletionsByDate->get($qa->id, 0) > 0)->count(),
            'total_qa_done' => $qaCompletionsByDate->sum(),
            'qa_members' => $qaStaff->map(function ($qa) use ($qaCompletionsByDate) {
                $doneCount = (int) ($qaCompletionsByDate->get($qa->id, 0));
                return [
                    'id' => $qa->id,
                    'name' => $qa->name,
                    'email' => $qa->email,
                    'team_id' => $qa->team_id,
                    'done_count' => $doneCount,
                    'has_uploads' => $doneCount > 0,
                    'is_active' => !$qa->is_absent && $qa->last_activity && $qa->last_activity->gt(now()->subMinutes(15)),
                    'wip_count' => $qa->wip_count,
                ];
            })->sortByDesc('done_count')->values(),
        ];

        $responseData = [
            'projects' => $data,
            'total_active_staff' => $totalActiveStaff,
            'total_absent' => $totalAbsent,
            'total_pending' => $totalPending,
            'total_delivered_today' => $totalDeliveredToday,
            'role_stats' => $roleStats,
            'date_stats' => $dateStats,
            'absentees' => $absentees,
            'workers' => $workers,
            'team_performance' => $teamPerformance,
            'qa_summary' => $qaSummary,
            'project_managers' => $projectManagers,
        ];

        // Cache as JSON string to avoid serialization issues with Collections
        $json = json_encode($responseData);
        if ($json) {
            \Illuminate\Support\Facades\Cache::put($cacheKey, $json, 20);
        }

        $ms = round((microtime(true) - $t0) * 1000);
        return response($json, 200, [
            'Content-Type' => 'application/json',
            'Server-Timing' => "total;dur={$ms}",
        ]);
    }

    /**
     * GET /dashboard/worker
     * Worker's personal dashboard.
     */
    public function worker(Request $request)
    {
        $user = $request->user();

        // Only production workers should access this endpoint
        if (!in_array($user->role, ['drawer', 'checker', 'filler', 'qa', 'designer'])) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $currentOrder = null;
        if ($user->project_id) {
            // Primary: check by assigned_to (new system)
            $currentOrder = Order::forProject($user->project_id)
                ->where('assigned_to', $user->id)
                ->whereIn('workflow_state', ['IN_DRAW', 'IN_CHECK', 'IN_FILLER', 'IN_QA', 'IN_DESIGN'])
                ->with('project:id,name,code')
                ->first();

            // Fallback: check by role-specific ID column + legacy states
            if (!$currentOrder) {
                $legacyStateMap = ['drawer' => 'DRAW', 'checker' => 'CHECK', 'filler' => 'FILLER', 'qa' => 'QA', 'designer' => 'DESIGN'];
                $idColMap = ['drawer' => 'drawer_id', 'checker' => 'checker_id', 'filler' => 'file_uploader_id', 'qa' => 'qa_id', 'designer' => 'drawer_id'];
                $doneColMap = ['drawer' => 'drawer_done', 'checker' => 'checker_done', 'filler' => 'file_uploaded', 'qa' => 'final_upload', 'designer' => 'drawer_done'];
                $legacyState = $legacyStateMap[$user->role] ?? null;
                $idCol = $idColMap[$user->role] ?? null;
                $doneCol = $doneColMap[$user->role] ?? null;

                if ($legacyState && $idCol) {
                    $inState = ['drawer' => 'IN_DRAW', 'checker' => 'IN_CHECK', 'filler' => 'IN_FILLER', 'qa' => 'IN_QA', 'designer' => 'IN_DESIGN'][$user->role];
                    // Include legacy state + for drawers also RECEIVED/PENDING_QA_REVIEW/REJECTED states
                    $validStates = [$inState, $legacyState];
                    if ($user->role === 'drawer') {
                        $validStates = array_merge($validStates, ['RECEIVED', 'PENDING_QA_REVIEW', 'REJECTED_BY_CHECK', 'REJECTED_BY_QA']);
                    }
                    $currentOrder = Order::forProject($user->project_id)
                        ->where($idCol, $user->id)
                        ->whereIn('workflow_state', $validStates)
                        ->where(function ($q) use ($doneCol) {
                            $q->whereNull($doneCol)
                              ->orWhere($doneCol, '')
                              ->orWhere($doneCol, 'no');
                        })
                        ->with('project:id,name,code')
                        ->first();
                }
            }

            // ── CRM OVERLAY FALLBACK ──
            // Sync may have overwritten CRM data in the project table.
            // Re-apply from crm_order_assignments and retry.
            if (!$currentOrder) {
                $crmIdCol = $idCol ?? (['drawer' => 'drawer_id', 'checker' => 'checker_id', 'filler' => 'file_uploader_id', 'qa' => 'qa_id', 'designer' => 'drawer_id'][$user->role] ?? 'assigned_to');
                $crmDoneCol = $doneCol ?? (['drawer' => 'drawer_done', 'checker' => 'checker_done', 'filler' => 'file_uploaded', 'qa' => 'final_upload', 'designer' => 'drawer_done'][$user->role] ?? null);

                $crmAssign = DB::table('crm_order_assignments')
                    ->where('project_id', $user->project_id)
                    ->where($crmIdCol, $user->id)
                    ->where(function ($q) use ($crmDoneCol) {
                        if ($crmDoneCol) {
                            $q->whereNull($crmDoneCol)
                              ->orWhere($crmDoneCol, '')
                              ->orWhere($crmDoneCol, 'no');
                        }
                    })
                    ->whereNotNull('workflow_state')
                    ->where('workflow_state', '!=', '')
                    ->first();

                if ($crmAssign) {
                    $table = ProjectOrderService::getTableName($user->project_id);
                    $overlay = [];
                    foreach (['assigned_to','drawer_id','drawer_name','checker_id','checker_name','qa_id','qa_name','workflow_state','dassign_time','cassign_time','drawer_done','checker_done','final_upload','drawer_date','checker_date','ausFinaldate'] as $col) {
                        if (isset($crmAssign->$col) && $crmAssign->$col !== null && $crmAssign->$col !== '') {
                            $overlay[$col] = $crmAssign->$col;
                        }
                    }
                    if (!empty($overlay)) {
                        DB::table($table)
                            ->where('order_number', $crmAssign->order_number)
                            ->update(array_merge($overlay, ['updated_at' => now()]));

                        $currentOrder = Order::forProject($user->project_id)
                            ->where('order_number', $crmAssign->order_number)
                            ->with('project:id,name,code')
                            ->first();
                    }
                }
            }
        }

        $todayCompleted = WorkItem::where('assigned_user_id', $user->id)
            ->where('status', 'completed')
            ->where('completed_at', '>=', $this->businessDayBounds()[0])
            ->where('completed_at', '<', $this->businessDayBounds()[1])
            ->count();

        // Fallback: count from project table (Metro-synced orders)
        if ($todayCompleted === 0 && $user->project_id) {
            $table = ProjectOrderService::getTableName($user->project_id);
            if (self::tableExists($table)) {
                [$idCol, $doneCol, , $dateCol] = self::getWorkerRoleColumns($user->role);
                if ($idCol && $doneCol) {
                    $todayCompleted = DB::table($table)
                        ->where($idCol, $user->id)
                        ->where($doneCol, 'yes')
                        ->where($dateCol, '>=', $this->businessDayBounds()[0])
                        ->where($dateCol, '<', $this->businessDayBounds()[1])
                        ->count();
                }
            }
        }

        $queueCount = 0;
        if ($user->project_id) {
            $project = $user->project;
            if ($project) {
                // Count new-system QUEUED_* states — only orders assigned to THIS user
                $queueStates = StateMachine::getQueuedStates($project->workflow_type ?? 'FP_3_LAYER');
                $roleIdColMap = ['drawer' => 'drawer_id', 'checker' => 'checker_id', 'filler' => 'file_uploader_id', 'qa' => 'qa_id', 'designer' => 'drawer_id'];
                $userIdCol = $roleIdColMap[$user->role] ?? null;
                foreach ($queueStates as $state) {
                    $role = StateMachine::getRoleForState($state);
                    if ($role === $user->role) {
                        $queueCount += Order::forProject($user->project_id)
                            ->where('workflow_state', $state)
                            ->where(function ($q) use ($user, $userIdCol) {
                                $q->where('assigned_to', $user->id);
                                if ($userIdCol) {
                                    $q->orWhere($userIdCol, $user->id);
                                }
                            })
                            ->count();
                    }
                }

                // Also count legacy states (DRAW, CHECK, QA) assigned to this user
                $legacyStateMap = ['drawer' => 'DRAW', 'checker' => 'CHECK', 'filler' => 'FILLER', 'qa' => 'QA', 'designer' => 'DESIGN'];
                $idColMap = ['drawer' => 'drawer_id', 'checker' => 'checker_id', 'filler' => 'file_uploader_id', 'qa' => 'qa_id', 'designer' => 'drawer_id'];
                $doneColMap = ['drawer' => 'drawer_done', 'checker' => 'checker_done', 'filler' => 'file_uploaded', 'qa' => 'final_upload', 'designer' => 'drawer_done'];
                $legacyState = $legacyStateMap[$user->role] ?? null;
                $idCol = $idColMap[$user->role] ?? null;
                $doneCol = $doneColMap[$user->role] ?? null;
                if ($legacyState && $idCol) {
                    // Include legacy state + for drawers also RECEIVED/PENDING_QA_REVIEW/REJECTED states
                    $countStates = [$legacyState];
                    if ($user->role === 'drawer') {
                        $countStates = array_merge($countStates, ['RECEIVED', 'PENDING_QA_REVIEW', 'REJECTED_BY_CHECK', 'REJECTED_BY_QA']);
                    }
                    $queueCount += Order::forProject($user->project_id)
                        ->whereIn('workflow_state', $countStates)
                        ->where($idCol, $user->id)
                        ->where(function ($q) use ($doneCol) {
                            $q->whereNull($doneCol)
                              ->orWhere($doneCol, '')
                              ->orWhere($doneCol, 'no');
                        })
                        ->count();
                }
            }

            // CRM OVERLAY FALLBACK for queue count
            if ($queueCount === 0) {
                $crmIdCol = ['drawer' => 'drawer_id', 'checker' => 'checker_id', 'filler' => 'file_uploader_id', 'qa' => 'qa_id', 'designer' => 'drawer_id'][$user->role] ?? 'assigned_to';
                $crmDoneCol = ['drawer' => 'drawer_done', 'checker' => 'checker_done', 'qa' => 'final_upload', 'designer' => 'drawer_done'][$user->role] ?? null;

                $crmQueueCount = DB::table('crm_order_assignments')
                    ->where('project_id', $user->project_id)
                    ->where($crmIdCol, $user->id)
                    ->where(function ($q) use ($crmDoneCol) {
                        if ($crmDoneCol) {
                            $q->whereNull($crmDoneCol)
                              ->orWhere($crmDoneCol, '')
                              ->orWhere($crmDoneCol, 'no');
                        }
                    })
                    ->whereNotNull('workflow_state')
                    ->where('workflow_state', '!=', '')
                    ->count();

                if ($crmQueueCount > 0) {
                    $queueCount = $crmQueueCount;
                }
            }
        }

        return response()->json([
            'current_order' => $currentOrder,
            'today_completed' => $todayCompleted,
            'daily_target' => $user->daily_target ?? 0,
            'target_progress' => $user->daily_target > 0
                ? round(($todayCompleted / $user->daily_target) * 100, 1)
                : 0,
            'queue_count' => $queueCount,
            'wip_count' => $user->wip_count,
        ]);
    }


    /**
     * GET /dashboard/absentees
     * List all absentees (org-wide or project-scoped).
     * Includes daily absentee statistics per CEO requirements.
     */
    public function absentees(Request $request)
    {
        $user = $request->user();
        $query = User::where('is_active', true)->where('is_absent', true);

        if (!in_array($user->role, ['ceo', 'director'])) {
            // OM/PM: scope to their assigned projects via pivot tables
            $managedProjectIds = $user->getManagedProjectIds();
            if (!empty($managedProjectIds)) {
                $query->whereIn('project_id', $managedProjectIds);
            } elseif ($user->project_id) {
                $query->where('project_id', $user->project_id);
            } else {
                // No project access — return empty
                $query->whereRaw('1 = 0');
            }
        }

        $absentees = $query->with(['project:id,name,code,country,department', 'team:id,name'])
            ->get([
                'id', 'name', 'email', 'role', 'project_id', 'team_id', 
                'last_activity', 'inactive_days',
            ]);

        // Group by country for CEO view
        $byCountry = $absentees->groupBy(fn($u) => $u->project?->country ?? 'Unassigned');
        $byDepartment = $absentees->groupBy(fn($u) => $u->project?->department ?? 'Unassigned');
        $byRole = $absentees->groupBy('role');

        return response()->json([
            'total' => $absentees->count(),
            'by_country' => $byCountry->map->count(),
            'by_department' => $byDepartment->map->count(),
            'by_role' => $byRole->map->count(),
            'absentees' => $absentees,
        ]);
    }



    /**
     * GET /dashboard/daily-operations
     * CEO Daily Operations View - All projects with layer-wise worker activity and QA metrics.
     * Shows Drawer/Designer → Checker → QA work per project for a specific date.
     * Cached for 5 minutes to reduce database load.
     */
 public function dailyOperations(Request $request)
{
    $user = $request->user();
    if (!in_array($user->role, ['ceo', 'director', 'operations_manager'])) {
        return response()->json(['message' => 'Unauthorized'], 403);
    }

    // ✅ Support both old (date) and new (date_from/date_to)
    $from = $request->get('date_from')
        ?? $request->get('date')
        ?? $this->businessDayBounds()[0]->toDateString();

    $to = $request->get('date_to', $from);

    try {
        $fromDate = \Carbon\Carbon::parse($from);
        $toDate   = \Carbon\Carbon::parse($to);

        if ($fromDate->isFuture() || $toDate->isFuture()) {
            return response()->json(['message' => 'Cannot view future dates'], 400);
        }

        if ($fromDate->lt(now()->subYear()) || $toDate->lt(now()->subYear())) {
            return response()->json(['message' => 'Date too far in the past'], 400);
        }

        if ($fromDate->gt($toDate)) {
            return response()->json(['message' => 'From date cannot be after To date'], 400);
        }
    } catch (\Exception $e) {
        return response()->json(['message' => 'Invalid date format'], 400);
    }

    // Audit log (keep your existing behavior)
    \App\Models\ActivityLog::log(
        'view_daily_operations',
        'Dashboard',
        null,
        ['from' => $from, 'to' => $to]
    );

    $viewMode = $request->get('view_mode', 'stage');
    $noCache = $request->get('no_cache', false) === 'true' || $request->get('no_cache') === true;

    $dailyOperationsProjectConfig = [
        12 => [
            'extra_stages' => ['FILLER'],
        ],
    ];

    // Scope projects for OM
    $scopedProjectIds = null;
    if ($user->role === 'operations_manager') {
        $scopedProjectIds = $user->getManagedProjectIds();
    }

    // ✅ Normalized cache key (important)
    // Version hash includes the report configuration to auto-invalidate when projects are changed
    $reportConfigHash = md5(json_encode([
        'received_at_projects' => [15, 16],
        'project_config' => $dailyOperationsProjectConfig,
    ]));
    $cacheKey = "daily_operations_"
        . $fromDate->format('Y-m-d') . "_"
        . $toDate->format('Y-m-d') . "_{$viewMode}_v{$reportConfigHash}"
        . ($scopedProjectIds ? '_om_' . $user->id : '');

    $data = !$noCache ? \Illuminate\Support\Facades\Cache::get($cacheKey) : null;

    if (!$data) {
        $results = [];
        $current = $fromDate->copy();

        while ($current->lte($toDate)) {
            $results[] = $this->generateDailyOperationsData(
                $current,
                $scopedProjectIds,
                $viewMode
            );
            $current->addDay();
        }

        $data = $results;

        // Cache the results if not explicitly bypassed
        if (!$noCache) {
            \Illuminate\Support\Facades\Cache::put($cacheKey, $data, 300);
        }
    }

    // ✅ CRITICAL FIX: keep old response format for single date
    if ($fromDate->eq($toDate)) {
        $response = $data[0] ?? [];
        // Add debug info showing which projects use received_at
        $response['_debug'] = [
            'projects_using_received_at' => [15, 16],
            'note' => 'For projects 15, 16: "delivered" field actually shows orders RECEIVED (not delivered)',
            'cache_key' => $cacheKey,
            'no_cache' => $noCache,
        ];
        return response()->json($response);
    }

    // ✅ Range response (frontend-safe)
    return response()->json([
        'range' => [
            'from' => $fromDate->format('Y-m-d'),
            'to'   => $toDate->format('Y-m-d'),
        ],
        'days' => $data,
        '_debug' => [
            'projects_using_received_at' => [15, 16],
            'note' => 'For projects 15, 16: "delivered" field actually shows orders RECEIVED (not delivered)',
            'cache_key' => $cacheKey,
            'no_cache' => $noCache,
        ],
    ]);
}


    /**
     * Internal: Generate daily operations data.
     * Uses direct per-project table queries for Metro compatibility
     * (WorkItems table may be empty, project_id column may differ from actual project ID).
     */
    private function generateDailyOperationsData(\Carbon\Carbon $dateObj, ?array $scopedProjectIds = null, string $viewMode = 'stage')
    {
        // Projects that should be counted from the orders table by received_at only.
        $receivedAtProjects = [15, 16];

        $dailyOperationsProjectConfig = [
            12 => [
                'extra_stages' => ['FILLER'],
            ],
        ];

        // Get active projects (scoped for OM, all for CEO/Director)
        $query = Project::where('status', 'active')
            ->orderBy('country')
            ->orderBy('department')
            ->orderBy('code');

        if ($scopedProjectIds !== null) {
            $query->whereIn('id', $scopedProjectIds);
        }

        $projects = $query->get();
        $projectsData = [];

        // Column map: stage → [date_col, id_col, name_col] in per-project order tables
        // IMPORTANT: ausFinaldate is stored in Australian AEDT (UTC+11), while
        // drawer_date/checker_date are in Pakistan PKT (UTC+5). Offset = 6h.
        // We normalize ausFinaldate → PKT by subtracting 6 hours in queries.
        $layerColumnMap = [
            'DRAW'   => ['date_col' => 'drawer_date',   'id_col' => 'drawer_id',  'name_col' => 'drawer_name',  'tz_offset' => 0],
            'CHECK'  => ['date_col' => 'checker_date',  'id_col' => 'checker_id', 'name_col' => 'checker_name', 'tz_offset' => 0],
            'QA'     => ['date_col' => 'ausFinaldate',  'id_col' => 'qa_id',      'name_col' => 'qa_name',      'tz_offset' => -6],
            'FILLER' => ['date_col' => 'file_upload_date', 'id_col' => 'file_uploader_id', 'name_col' => 'file_uploader_name', 'tz_offset' => 0],
            'DESIGN' => ['date_col' => 'drawer_date',   'id_col' => 'drawer_id',  'name_col' => 'drawer_name',  'tz_offset' => 0],
        ];

        foreach ($projects as $project) {
            $tableName = ProjectOrderService::getTableName($project->id);
            if (!self::tableExists($tableName)) {
                continue;
            }

            $workflowType = $project->workflow_type ?? 'FP_3_LAYER';
            $isFloorPlan  = $workflowType === 'FP_3_LAYER';
            $useReceivedAtOrderCounts = in_array((int) $project->id, $receivedAtProjects, true);
            $receivedBaseQuery = DB::table($tableName);

            if ((int) $project->id === 16 && self::columnExists($tableName, 'date')) {
                $receivedBaseQuery->where('date', $dateObj->format('d-m-Y'));
            } else {
                $receivedBaseQuery->whereDate('received_at', $dateObj);
            }

            // ─── RECEIVED: orders that came in on this date ──────────────────
            $received = (clone $receivedBaseQuery)->count();

            // ─── DELIVERED: orders finalised on this date ────────────────────
            // For specific projects, report based on received_at instead of delivered_at
            $hasAusFinal = self::columnExists($tableName, 'ausFinaldate');
            $dateStr = $dateObj->format('Y-m-d');
            
            if ($useReceivedAtOrderCounts) {
                // For these projects, "delivered" means received today and already done by status.
                $delivered = (clone $receivedBaseQuery)
                    ->where('workflow_state', 'DELIVERED')
                    ->count();
            } else {
                // Standard logic: count orders delivered on this date
                $deliveredQuery = DB::table($tableName)->where('workflow_state', 'DELIVERED');
                if ($hasAusFinal) {
                    // Normalize ausFinaldate from AEDT to PKT (-6h) for accurate day boundary
                    $deliveredQuery->where(function ($q) use ($dateStr) {
                        $q->whereRaw("DATE(received_at) = ?", [$dateStr])
                          ->orWhere(function ($q2) use ($dateStr) {
                              $q2->whereNull('delivered_at')
                                 ->whereRaw("DATE(DATE_ADD(ausFinaldate, INTERVAL -6 HOUR)) = ?", [$dateStr]);
                          });
                    });
                } else {
                    $deliveredQuery->whereDate('delivered_at', $dateObj);
                }
                $delivered = $deliveredQuery->count();
            }

            // ─── PENDING ─────────────────────────────────────────────────────
            $pending = $useReceivedAtOrderCounts
                ? (clone $receivedBaseQuery)->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])->count()
                : DB::table($tableName)->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])->count();

            // ─── LAYER WORK (DRAW / CHECK / QA) ─────────────────────────────
            // Count layer output from order-table done flags using the received_at cohort only.
            // This avoids mismatches from ausFinaldate/delivered_at/date-column differences.
            $projectDailyConfig = $dailyOperationsProjectConfig[(int) $project->id] ?? [];
            $extraStages = $projectDailyConfig['extra_stages'] ?? [];
            $stages = $isFloorPlan ? ['DRAW', 'CHECK', 'QA'] : ['DESIGN', 'QA'];
            $stages = array_values(array_unique(array_merge($stages, $extraStages)));
            $layerWork = [];

            foreach ($stages as $stage) {
                $map = $layerColumnMap[$stage] ?? null;
                if (!$map) {
                    $layerWork[$stage] = ['total' => 0, 'workers' => collect()];
                    continue;
                }

                $doneCol = match ($stage) {
                    'DRAW', 'DESIGN' => 'drawer_done',
                    'CHECK' => 'checker_done',
                    'QA' => 'final_upload',
                    'FILLER' => 'file_uploaded',
                    default => null,
                };

                if (!$doneCol || !self::columnExists($tableName, $doneCol)) {
                    $layerWork[$stage] = ['total' => 0, 'workers' => collect()];
                    continue;
                }

                $stageQuery = (clone $receivedBaseQuery)->where($doneCol, 'yes');

                $total = (clone $stageQuery)->count();
                $workers = collect();

                if ($total > 0 && self::columnExists($tableName, $map['id_col'])) {
                    $workerRows = (clone $stageQuery)
                        ->whereNotNull($map['id_col'])
                        ->selectRaw("{$map['id_col']} as worker_id, {$map['name_col']} as worker_name, COUNT(*) as completed, GROUP_CONCAT(order_number ORDER BY order_number SEPARATOR ',') as order_nums")
                        ->groupBy($map['id_col'], $map['name_col'])
                        ->get();

                    if ($workerRows->isEmpty() && self::columnExists($tableName, $map['name_col'])) {
                        $workerRows = (clone $stageQuery)
                            ->whereNotNull($map['name_col'])
                            ->where($map['name_col'], '!=', '')
                            ->selectRaw("NULL as worker_id, {$map['name_col']} as worker_name, COUNT(*) as completed, GROUP_CONCAT(order_number ORDER BY order_number SEPARATOR ',') as order_nums")
                            ->groupBy($map['name_col'])
                            ->get();
                    }

                    $workers = $workerRows->map(function ($row) {
                        $allOrders = collect(explode(',', $row->order_nums ?? ''))->filter()->unique();
                        return [
                            'id'        => $row->worker_id,
                            'name'      => $row->worker_name ?? 'Unknown',
                            'completed' => (int) $row->completed,
                            'orders'    => $allOrders->take(15)->values(),
                            'has_more'  => $allOrders->count() > 15,
                        ];
                    })->values();
                }

                $layerWork[$stage] = ['total' => $total, 'workers' => $workers];
            }

            // ─── QA CHECKLIST / MISTAKE COMPLIANCE ───────────────────────────
            $checklistStats = [
                'total_orders'    => $delivered,
                'total_items'     => 0,
                'completed_items' => 0,
                'mistake_count'   => 0,
                'compliance_rate' => 0,
            ];

            if ($delivered > 0) {
                // Collect order IDs for today's data
                // For received_at projects: orders received on this date
                // For delivered_at projects: orders delivered on this date
                if ($useReceivedAtOrderCounts) {
                    // For these projects, QA/checklist stats also follow the received_at cohort.
                    $orderIdQuery = clone $receivedBaseQuery;
                    $ordersIds = $orderIdQuery->pluck('id');
                } else {
                    // Get orders delivered on this date (existing logic)
                    $dlvIdQuery = DB::table($tableName)->where('workflow_state', 'DELIVERED');
                    if ($hasAusFinal) {
                        $dlvIdQuery->where(function ($q) use ($dateStr) {
                            $q->whereRaw("DATE(received_at) = ?", [$dateStr])
                              ->orWhere(function ($q2) use ($dateStr) {
                                  $q2->whereNull('received_at')
                                     ->whereRaw("DATE(DATE_ADD(ausFinaldate, INTERVAL -6 HOUR)) = ?", [$dateStr]);
                              });
                        });
                    } else {
                        $dlvIdQuery->whereDate('delivered_at', $dateObj);
                    }
                    $ordersIds = $dlvIdQuery->pluck('id');
                }

                // Try OrderChecklist first (standard system)
                $checklists = \App\Models\OrderChecklist::whereIn('order_id', $ordersIds)->get();

                if ($checklists->isNotEmpty()) {
                    $checklistStats['total_items']     = $checklists->count();
                    $checklistStats['completed_items']  = $checklists->where('is_checked', true)->count();
                    $checklistStats['mistake_count']    = $checklists->sum('mistake_count');
                } else {
                    // Fallback: project-specific mistake tables (Metro)
                    $totalMistakes = 0;
                    foreach (['drawer', 'checker', 'qa'] as $layer) {
                        $mt = "project_{$project->id}_{$layer}_mistake";
                        if (self::tableExists($mt)) {
                            $totalMistakes += DB::table($mt)
                                ->whereIn('order_id', $ordersIds)
                                ->count();
                        }
                    }
                    $checklistStats['mistake_count']    = $totalMistakes;
                    // 7 standard checklist items per order
                    $checklistStats['total_items']      = $delivered * 7;
                    $checklistStats['completed_items']   = max(0, $checklistStats['total_items'] - $totalMistakes);
                }

                $checklistStats['compliance_rate'] = $checklistStats['total_items'] > 0
                    ? round(($checklistStats['completed_items'] / $checklistStats['total_items']) * 100, 1)
                    : 100;
            }

            $projectsData[] = [
                'id'            => $project->id,
                'code'          => $project->code,
                'name'          => $project->name,
                'country'       => $project->country,
                'department'    => $project->department,
                'workflow_type' => $workflowType,
                'received'      => $received,
                'delivered'     => $delivered,
                'pending'       => $pending,
                'report_metric' => $useReceivedAtOrderCounts ? 'received_at' : 'delivered_at',
                'layers'        => $layerWork,
                'qa_checklist'  => $checklistStats,
            ];
        }

        // Group by country for summary
        $byCountry = collect($projectsData)->groupBy('country')->map(function ($projects, $country) {
            return [
                'country'         => $country,
                'project_count'   => $projects->count(),
                'total_received'  => $projects->sum('received'),
                'total_delivered' => $projects->sum('delivered'),
                'total_pending'   => $projects->sum('pending'),
            ];
        })->values();

        // Overall totals
        $totals = [
            'projects'         => count($projectsData),
            'received'         => collect($projectsData)->sum('received'),
            'delivered'        => collect($projectsData)->sum('delivered'),
            'pending'          => collect($projectsData)->sum('pending'),
            'total_work_items' => collect($projectsData)->sum(function ($p) {
                return collect($p['layers'])->sum('total');
            }),
        ];

        return [
            'date'       => $dateObj->format('Y-m-d'),
            'view_mode'  => $viewMode,
            'view_modes' => [
                'stage'   => 'Each stage counted by its own done time',
                'unified' => 'All stages counted by QA done time (same day)',
            ],
            'report_config' => [
                'received_at_projects' => $receivedAtProjects,
                'note' => 'Daily operations metrics in this function are reported based on received_at instead of delivered_at',
            ],
            'totals'     => $totals,
            'by_country' => $byCountry,
            'projects'   => $projectsData,
        ];
    }




    /**
     * GET /dashboard/project-manager
     * Project Manager: see only their assigned projects, order queues, team stats & staff report.
     */
    public function projectManager(Request $request)
    {
        $user = $request->user();
        $dateFilter = $request->input('date');
        $startDate = $request->input('start_date');
        $endDate = $request->input('end_date');

        if ($user->role !== 'project_manager') {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $projectIds = $user->getManagedProjectIds();
        $projectIdsArray = is_array($projectIds) ? $projectIds : $projectIds->toArray();
        $projects = Project::whereIn('id', $projectIds)->where('status', 'active')->get();

        if ($projects->isEmpty()) {
            return response()->json([
                'projects' => [],
                'totals' => ['total_orders' => 0, 'pending' => 0, 'delivered_today' => 0, 'in_progress' => 0],
                'staff_report' => [],
                'order_queue' => [],
            ]);
        }

        // Determine department-appropriate roles from the project's workflow_type
        // FP_3_LAYER (Floor Plan): drawer, checker, qa
        // PH_2_LAYER (Photos Enhancement): designer, qa
        $departmentRoles = [];
        foreach ($projects as $proj) {
            $wf = $proj->workflow_type ?? 'FP_3_LAYER';
            if ($wf === 'PH_2_LAYER') {
                $departmentRoles = array_merge($departmentRoles, ['designer', 'qa']);
            } else {
                $departmentRoles = array_merge($departmentRoles, ['drawer', 'checker', 'qa']);
            }
        }
        $departmentRoles = array_unique($departmentRoles);

        // Get active teams belonging to PM's projects
        $pmTeamIds = \App\Models\Team::whereIn('project_id', $projectIds)
            ->where('is_active', true)
            ->pluck('id');

        // Staff: must be in PM's project, have a worker role.
        // Team filter is applied only when pmTeamIds is non-empty AND the user has a team_id set
        // (some photo projects have designers with no team_id assigned yet — include them too)
        $staffQuery = User::whereIn('project_id', $projectIds)
            ->where('is_active', true)
            ->whereIn('role', $departmentRoles);
        if ($pmTeamIds->isNotEmpty()) {
            $staffQuery->where(function ($q) use ($pmTeamIds) {
                $q->whereNull('team_id')
                  ->orWhereIn('team_id', $pmTeamIds);
            });
        }
        $allStaff = $staffQuery->get();
        $allStaffIds = $allStaff->pluck('id');
        $todayCompletions = WorkItem::where('completed_at', '>=', $this->businessDayBounds()[0])
            ->where('completed_at', '<', $this->businessDayBounds()[1])
            ->where('status', 'completed')
            ->whereIn('assigned_user_id', $allStaffIds)
            ->selectRaw('assigned_user_id, COUNT(*) as cnt')
            ->groupBy('assigned_user_id')
            ->pluck('cnt', 'assigned_user_id');

        // Per-project stats (using single aggregation + GROUP BY instead of N+1)
        $projectData = $projects->map(function ($project) use ($allStaff, $todayCompletions) {
            // Single aggregation query instead of 4 separate counts
            $stats = Order::forProject($project->id)
                ->selectRaw("
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN workflow_state NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN workflow_state = 'DELIVERED' AND delivered_at >= ? AND delivered_at < ? THEN 1 ELSE 0 END) as delivered_today,
                    SUM(CASE WHEN workflow_state IN ('IN_DRAW','IN_CHECK','IN_QA','IN_DESIGN') THEN 1 ELSE 0 END) as in_progress
                ", [$this->businessDayBounds()[0], $this->businessDayBounds()[1]])->first();

            $staff = $allStaff->where('project_id', $project->id);

            // Queue per stage: single GROUP BY instead of per-state loop
            $workflowType = $project->workflow_type ?? 'FP_3_LAYER';
            $stateCountsRaw = Order::forProject($project->id)
                ->selectRaw('workflow_state, COUNT(*) as cnt')
                ->groupBy('workflow_state')
                ->pluck('cnt', 'workflow_state');
            $stateCounts = $stateCountsRaw->filter(fn($cnt) => $cnt > 0)->toArray();

            return [
                'project' => $project->only(['id', 'code', 'name', 'country', 'department', 'workflow_type']),
                'total_orders' => (int) ($stats->total_orders ?? 0),
                'pending' => (int) ($stats->pending ?? 0),
                'delivered_today' => (int) ($stats->delivered_today ?? 0),
                'in_progress' => (int) ($stats->in_progress ?? 0),
                'total_staff' => $staff->count(),
                'active_staff' => $staff->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count(),
                'queue_stages' => $stateCounts,
            ];
        });

        // Totals: single combined cross-project query instead of 5 separate scans
        $totalStats = Order::queryAcrossProjects($projectIds, function($q) {
            $q->selectRaw("
                SUM(CASE WHEN workflow_state NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN workflow_state = 'DELIVERED' AND delivered_at >= ? AND delivered_at < ? THEN 1 ELSE 0 END) as delivered_today,
                SUM(CASE WHEN workflow_state IN ('IN_DRAW','IN_CHECK','IN_QA','IN_DESIGN') THEN 1 ELSE 0 END) as in_progress,
                COUNT(*) as total_orders,
                SUM(CASE WHEN received_at >= ? AND received_at < ? THEN 1 ELSE 0 END) as received_today
            ", [$this->businessDayBounds()[0], $this->businessDayBounds()[1], $this->businessDayBounds()[0], $this->businessDayBounds()[1]]);
        });
        $totalPending = $totalStats->sum('pending');
        $totalDeliveredToday = $totalStats->sum('delivered_today');
        $totalInProgress = $totalStats->sum('in_progress');
        $totalOrders = $totalStats->sum('total_orders');
        $totalReceivedToday = $totalStats->sum('received_today');

        // Staff report: work assigned, completed, pending, active per staff member
        // Pre-load project names and team names for display
        $projectNamesMap = $projects->pluck('name', 'id');
        $teamNamesMap = \App\Models\Team::whereIn('id', $pmTeamIds)->pluck('name', 'id');

        // Bulk-load week + month completions in a SINGLE query (bucketed)
        $weekStart = now()->subDays(6)->startOfDay();
        $monthStart = now()->startOfMonth();
        $combinedCompletions = WorkItem::where('completed_at', '>=', $monthStart)
            ->where('status', 'completed')
            ->whereIn('assigned_user_id', $allStaffIds)
            ->selectRaw('assigned_user_id, COUNT(*) as month_cnt, SUM(CASE WHEN completed_at >= ? THEN 1 ELSE 0 END) as week_cnt', [$weekStart])
            ->groupBy('assigned_user_id')
            ->get()
            ->keyBy('assigned_user_id');
        $weekCompletions = $combinedCompletions->mapWithKeys(fn($r, $k) => [$k => $r->week_cnt]);
        $monthCompletions = $combinedCompletions->mapWithKeys(fn($r, $k) => [$k => $r->month_cnt]);

        // Bulk-load assigned counts for all staff (single query instead of N queries)
        $assignedCounts = [];
        foreach ($projectIds as $pid) {
            $rows = Order::forProject($pid)
                ->whereNotNull('assigned_to')
                ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                ->whereIn('assigned_to', $allStaffIds)
                ->selectRaw('assigned_to, COUNT(*) as cnt')
                ->groupBy('assigned_to')
                ->pluck('cnt', 'assigned_to');
            foreach ($rows as $uid => $cnt) {
                $assignedCounts[$uid] = ($assignedCounts[$uid] ?? 0) + $cnt;
            }
        }

        $staffReport = $allStaff->map(function ($s) use ($todayCompletions, $weekCompletions, $monthCompletions, $assignedCounts, $projectNamesMap, $teamNamesMap) {
            $assignedCount = $assignedCounts[$s->id] ?? 0;

            return [
                'id' => $s->id,
                'name' => $s->name,
                'email' => $s->email,
                'role' => $s->role,
                'project_id' => $s->project_id,
                'project_name' => $projectNamesMap->get($s->project_id, '—'),
                'team_id' => $s->team_id,
                'team_name' => $teamNamesMap->get($s->team_id, '—'),
                'is_online' => $s->last_activity && $s->last_activity->gt(now()->subMinutes(15)),
                'is_absent' => $s->is_absent,
                'assigned_work' => $assignedCount,
                'completed_today' => $todayCompletions->get($s->id, 0),
                'completed_week' => $weekCompletions->get($s->id, 0),
                'completed_month' => $monthCompletions->get($s->id, 0),
                'pending_work' => max(0, $assignedCount - $s->wip_count),
                'wip_count' => $s->wip_count,
                'daily_target' => $s->daily_target ?? 0,
                'avg_completion_minutes' => round((float) ($s->avg_completion_minutes ?? 0), 1),
                'assignment_score' => round((float) $s->assignment_score, 2),
            ];
        })->values();

        // Role summary — aggregated stats per role for summary cards
        $roleSummary = [];
        foreach ($departmentRoles as $role) {
            $roleStaff = $allStaff->where('role', $role);
            $roleIds = $roleStaff->pluck('id');
            $totalToday = $roleIds->sum(fn($uid) => $todayCompletions->get($uid, 0));
            $totalWeek = $roleIds->sum(fn($uid) => $weekCompletions->get($uid, 0));
            $totalAssigned = $roleIds->sum(fn($uid) => $assignedCounts[$uid] ?? 0);
            $online = $roleStaff->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count();
            $absent = $roleStaff->where('is_absent', true)->count();
            $roleSummary[$role] = [
                'total' => $roleStaff->count(),
                'online' => $online,
                'absent' => $absent,
                'completed_today' => $totalToday,
                'completed_week' => $totalWeek,
                'total_assigned' => $totalAssigned,
            ];
        }

        // Order queue: recently received orders not yet assigned (for PM's projects)
        $orderQueue = [];
        foreach ($projectIds as $pid) {
            $queued = Order::forProject($pid)
                ->whereNull('assigned_to')
                ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                ->orderByRaw("FIELD(priority, 'rush', 'urgent', 'high', 'normal', 'low', '') ASC")
                ->orderBy('received_at', 'asc')
                ->limit(20)
                ->get(['id', 'order_number', 'project_id', 'workflow_state', 'priority', 'received_at', 'client_reference', 'address', 'due_in']);
            foreach ($queued as $o) {
                $orderQueue[] = $o;
            }
        }

        // Team performance
        $teams = \App\Models\Team::whereIn('project_id', $projectIds)
            ->with(['project:id,name,code', 'qaLead:id,name'])
            ->where('is_active', true)->get();

        $todayStart = $this->businessDayBounds()[0];
        $tomorrowStart = $this->businessDayBounds()[1];

        // Team delivered today (uses idx_delivered_at, very fast)
        $pmTeamDeliveredToday = Order::queryAcrossProjects($projectIds, function($q) use ($todayStart, $tomorrowStart) {
            $q->whereNotNull('team_id')
              ->where('workflow_state', 'DELIVERED')
              ->where('delivered_at', '>=', $todayStart)
              ->where('delivered_at', '<', $tomorrowStart)
              ->selectRaw('team_id, COUNT(*) as cnt')
              ->groupBy('team_id');
        })->pluck('cnt', 'team_id');

        // Team pending counts
        $pmTeamPending = Order::queryAcrossProjects($projectIds, function($q) {
            $q->whereNotNull('team_id')
              ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
              ->selectRaw('team_id, COUNT(*) as cnt')
              ->groupBy('team_id');
        })->pluck('cnt', 'team_id');

        // Team member completions (today)
        $pmTotalCompletions = WorkItem::whereIn('assigned_user_id', $allStaff->pluck('id'))
            ->where('status', 'completed')
            ->where('completed_at', '>=', $todayStart)
            ->where('completed_at', '<', $tomorrowStart)
            ->selectRaw('assigned_user_id, COUNT(*) as cnt')
            ->groupBy('assigned_user_id')
            ->pluck('cnt', 'assigned_user_id');

        $teamPerformance = $teams->map(function ($team) use ($allStaff, $pmTeamDeliveredToday, $pmTeamPending, $pmTotalCompletions) {
            $teamStaff = $allStaff->where('team_id', $team->id);
            $teamStaffIds = $teamStaff->pluck('id');
            $teamCompleted = $teamStaffIds->sum(fn($uid) => $pmTotalCompletions->get($uid, 0));
            $delivered = $pmTeamDeliveredToday->get($team->id, 0);
            $pending = $pmTeamPending->get($team->id, 0);

            $buildRoleMembers = function (string $role) use ($teamStaff, $pmTotalCompletions) {
                return $teamStaff->where('role', $role)
                    ->map(fn($u) => [
                        'id' => $u->id,
                        'name' => $u->name,
                        'total_done' => (int) ($pmTotalCompletions->get($u->id, 0)),
                        'wip' => (int) ($u->wip_count ?? 0),
                    ])
                    ->values();
            };

            $drawers = $buildRoleMembers('drawer');
            $checkers = $buildRoleMembers('checker');
            $qas = $buildRoleMembers('qa');
            $drawerTotalDone = (int) $drawers->sum('total_done');
            $checkerTotalDone = (int) $checkers->sum('total_done');
            $qaTotalDone = (int) $qas->sum('total_done');
            $teamTotalDone = $drawerTotalDone + $checkerTotalDone + $qaTotalDone;

            return [
                'id' => $team->id,
                'name' => $team->name,
                'project_code' => $team->project->code ?? '-',
                'qa_lead' => $team->qaLead?->name ?? 'Unassigned',
                'staff_count' => $teamStaff->count(),
                'active_staff' => $teamStaff->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count(),
                'today_completed' => $teamCompleted,
                'delivered_today' => $delivered,
                'pending' => $pending,
                'drawer_total_done' => $drawerTotalDone,
                'checker_total_done' => $checkerTotalDone,
                'qa_total_done' => $qaTotalDone,
                'total_done' => $teamTotalDone,
                // As requested, delivered mirrors completed count for team summary.
                'delivered' => $teamTotalDone,
                'efficiency' => $teamStaff->count() > 0 ? round($teamCompleted / max($teamStaff->count(), 1), 1) : 0,
                'drawer_names' => $drawers->pluck('name')->implode(', '),
                'checker_names' => $checkers->pluck('name')->implode(', '),
                'qa_names' => $qas->pluck('name')->implode(', '),
                'drawers' => $drawers,
                'checkers' => $checkers,
                'qas' => $qas,
            ];
        })->values();

        // ─── QA SUMMARY WITH DATE SELECTION FOR PM ──────────────────
        $pmQaDateStart = $this->businessDayBounds()[0];
        $pmQaDateEnd = $this->businessDayBounds()[1];

        // Parse date parameters if provided
        if ($dateFilter === 'range' && $startDate && $endDate) {
            $pmQaDateStart = \Carbon\Carbon::parse($startDate)->startOfDay();
            $pmQaDateEnd = \Carbon\Carbon::parse($endDate)->endOfDay();
        } elseif ($dateFilter === 'custom' && $startDate) {
            $pmQaDateStart = \Carbon\Carbon::parse($startDate)->startOfDay();
            $pmQaDateEnd = \Carbon\Carbon::parse($startDate)->endOfDay();
        }

        // Get all QAs for PM's projects
        $pmQaStaff = $allStaff->where('role', 'qa');
        $pmQaIds = $pmQaStaff->pluck('id');

        // Query QA done counts for selected date range
        $pmQaCompletionsByDate = WorkItem::whereIn('assigned_user_id', $pmQaIds)
            ->where('status', 'completed')
            ->where('completed_at', '>=', $pmQaDateStart)
            ->where('completed_at', '<=', $pmQaDateEnd)
            ->selectRaw('assigned_user_id, COUNT(*) as cnt')
            ->groupBy('assigned_user_id')
            ->pluck('cnt', 'assigned_user_id');

        // Build QA summary for PM
        $pmQaSummary = [
            'date_range' => [
                'filter_type' => $dateFilter ?? 'today',
                'from' => $pmQaDateStart->format('Y-m-d H:i:s'),
                'to' => $pmQaDateEnd->format('Y-m-d H:i:s'),
            ],
            'total_qa_staff' => $pmQaStaff->count(),
            'qa_with_uploads' => $pmQaStaff->filter(fn($qa) => $pmQaCompletionsByDate->get($qa->id, 0) > 0)->count(),
            'total_qa_done' => $pmQaCompletionsByDate->sum(),
            'qa_members' => $pmQaStaff->map(function ($qa) use ($pmQaCompletionsByDate) {
                $doneCount = (int) ($pmQaCompletionsByDate->get($qa->id, 0));
                return [
                    'id' => $qa->id,
                    'name' => $qa->name,
                    'email' => $qa->email,
                    'team_id' => $qa->team_id,
                    'done_count' => $doneCount,
                    'has_uploads' => $doneCount > 0,
                    'is_active' => !$qa->is_absent && $qa->last_activity && $qa->last_activity->gt(now()->subMinutes(15)),
                    'wip_count' => $qa->wip_count,
                ];
            })->sortByDesc('done_count')->values(),
        ];

        return response()->json([
            'projects' => $projectData,
            'totals' => [
                'total_orders' => $totalOrders,
                'pending' => $totalPending,
                'delivered_today' => $totalDeliveredToday,
                'in_progress' => $totalInProgress,
                'received_today' => $totalReceivedToday,
            ],
            'staff_report' => $staffReport,
            'role_summary' => $roleSummary,
            'order_queue' => $orderQueue,
            'team_performance' => $teamPerformance,
            'qa_summary' => $pmQaSummary,
            'department_roles' => array_values($departmentRoles),
        ]);
    }

    /**
     * GET /dashboard/queues
     * Returns distinct queue names with their project IDs and metadata.
     */
    public function queues(Request $request)
    {
        $user = $request->user();

        $query = Project::where('status', 'active');

        // Scope by role
        if ($user->role === 'operations_manager') {
            $omProjectIds = $user->getManagedProjectIds();
            if (!empty($omProjectIds)) {
                $query->whereIn('id', $omProjectIds);
            }
        } elseif ($user->role === 'project_manager') {
            $pmProjectIds = $user->getManagedProjectIds();
            $query->whereIn('id', $pmProjectIds);
        } elseif ($user->role === 'qa' || $user->role === 'live_qa') {
            $query->where('id', $user->project_id);
        }

        $projects = $query->orderBy('queue_name')->orderBy('name')->get(['id', 'code', 'name', 'queue_name', 'country', 'department', 'workflow_type']);

        // Group by queue_name
        $queues = [];
        foreach ($projects as $p) {
            $qn = $p->queue_name ?: $p->name;
            if (!isset($queues[$qn])) {
                $queues[$qn] = [
                    'queue_name' => $qn,
                    'projects' => [],
                    'department' => $p->department,
                    'country' => $p->country,
                    'workflow_type' => $p->workflow_type,
                ];
            }
            $queues[$qn]['projects'][] = [
                'id' => $p->id,
                'code' => $p->code,
                'name' => $p->name,
                'country' => $p->country,
                'department' => $p->department,
                'workflow_type' => $p->workflow_type,
            ];
        }

        return response()->json(['queues' => array_values($queues)]);
    }




    /**
     * GET /dashboard/assignment/{queueName}
     * Assignment Dashboard — queue-based view combining orders from all projects in a queue.
     * The dropdown now shows queue names instead of individual projects.
     * Accessible to: project_manager, operations_manager, qa, ceo, director
     */

     
    public function assignmentDashboard(Request $request, string $queueName)
    {
        $user = $request->user();
        $accessScope = match ($user->role) {
            'ceo', 'director' => [],
            'operations_manager', 'project_manager' => $user->getManagedProjectIds(),
            'qa', 'live_qa' => [$user->project_id],
            default => [$user->id],
        };
        $accessScope = array_values(array_unique(array_map('intval', array_filter($accessScope))));
        sort($accessScope);

        $queryParams = $request->query();
        unset($queryParams['_'], $queryParams['cache_bust']);
        $this->sortAssignmentDashboardCacheParams($queryParams);

        $cacheKey = 'assignment_dashboard:v2:' . sha1(json_encode([
            'queue' => urldecode($queueName),
            'role' => $user->role,
            'scope' => $accessScope,
            'query' => $queryParams,
        ]));

        try {
            $cached = Cache::get($cacheKey);
            if (is_array($cached)) {
                return response()->json($cached);
            }
        } catch (\Throwable $e) {
            // Cache failure must never block the live dashboard.
        }

        $lock = null;
        try {
            $lock = Cache::lock($cacheKey . ':lock', 15);
            if (!$lock->get()) {
                for ($attempt = 0; $attempt < 10; $attempt++) {
                    usleep(100000);
                    $cached = Cache::get($cacheKey);
                    if (is_array($cached)) {
                        return response()->json($cached);
                    }
                }
                $lock = null;
            } else {
                $cached = Cache::get($cacheKey);
                if (is_array($cached)) {
                    $lock->release();
                    return response()->json($cached);
                }
            }
        } catch (\Throwable $e) {
            $lock = null;
        }

        try {
            $response = $this->buildAssignmentDashboardResponse($request, $queueName);

            if ($response->getStatusCode() === 200) {
                $responseData = $response->getData(true);
                try {
                    Cache::put($cacheKey, $responseData, now()->addSeconds(5));
                } catch (\Throwable $e) {
                    // Fall back to the uncached response when the cache store is unavailable.
                }
            }

            return $response;
        } finally {
            if ($lock) {
                try {
                    $lock->release();
                } catch (\Throwable $e) {
                    // The response is still valid if releasing the cache lock fails.
                }
            }
        }
    }

    private function buildAssignmentDashboardResponse(Request $request, string $queueName)
    {
        $user = $request->user();
        $queueName = urldecode($queueName);

        // ─── Find all projects in this queue ───
        $projects = Project::where('queue_name', $queueName)
            ->where('status', 'active')
            ->get();

        if ($projects->isEmpty()) {
            return response()->json(['message' => 'Queue not found.'], 404);
        }

        $projectIds = $projects->pluck('id')->toArray();

        // ─── Access control ───
        if (in_array($user->role, ['ceo', 'director'])) {
            // Full access
        } elseif ($user->role === 'operations_manager') {
            $omProjectIds = $user->getManagedProjectIds();
            if (!empty($omProjectIds)) {
                $projectIds = array_intersect($projectIds, $omProjectIds);
                if (empty($projectIds)) {
                    return response()->json(['message' => 'Access denied.'], 403);
                }
            }
        } elseif ($user->role === 'project_manager') {
            $pmProjectIds = $user->getManagedProjectIds();
            $projectIds = array_intersect($projectIds, $pmProjectIds);
            if (empty($projectIds)) {
                return response()->json(['message' => 'Access denied.'], 403);
            }
        } elseif ($user->role === 'qa' || $user->role === 'live_qa') {
            if (!in_array($user->project_id, $projectIds)) {
                return response()->json(['message' => 'Access denied.'], 403);
            }
            $projectIds = [$user->project_id];
        } else {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        // Filter projects to only accessible ones
        $projects = $projects->whereIn('id', $projectIds)->values();
        $primaryProject = $projects->first();
        $workflowType = $primaryProject->workflow_type ?? 'FP_3_LAYER';
        $isUkQueue = $projects->contains(function ($project) {
            $country = strtolower(trim((string) ($project->country ?? '')));
            return in_array($country, ['uk', 'united kingdom', 'great britain'], true);
        });

        // ─── 1. Workers by role (single query, then group in memory) ───
        $stages = StateMachine::getStages($workflowType);
        if ($workflowType === 'FP_3_LAYER' && in_array(12, $projectIds, true) && !in_array('FILL', $stages, true)) {
            $checkIndex = array_search('CHECK', $stages, true);
            if ($checkIndex === false) {
                $stages[] = 'FILL';
            } else {
                array_splice($stages, $checkIndex + 1, 0, ['FILL']);
            }
        }
        $allWorkers = User::whereIn('project_id', $projectIds)
            ->where('is_active', true)
            ->whereIn('role', array_values(array_intersect_key(StateMachine::STAGE_TO_ROLE, array_flip($stages))))
            ->get(['id', 'name', 'email', 'role', 'team_id', 'project_id', 'is_active', 'is_absent',
                    'wip_count', 'today_completed', 'last_activity', 'daily_target']);
        $workers = [];

        

        // ─── 2. Build UNION query across all project order tables ───
        $statusFilter = $request->input('status', 'all');
        $dateFilter = $request->input('date'); // keep old (no default now)
$startDate = $request->input('start_date');
$endDate = $request->input('end_date');

        $search = $request->input('search');
        $assignedTo = $request->input('assigned_to');
        $sortByInput = strtolower(trim((string) $request->input('sort_by', $request->input('sortBy', ''))));
        $sortOrderInput = strtolower(trim((string) $request->input('sort_order', $request->input('sortOrder', 'asc'))));
        $sortOrder = $sortOrderInput === 'desc' ? 'desc' : 'asc';
        $roleSortByInput = strtolower(trim((string) $request->input('role_sort_by', $request->input('roleSortBy', ''))));
        $roleSortModeInput = strtolower(trim((string) $request->input('role_sort_mode', $request->input('roleSortMode', ''))));
        $defaultRoleSortMode = $sortOrder === 'desc' ? 'non_waiting_first' : 'waiting_first';
        $roleSortMode = in_array($roleSortModeInput, ['waiting_first', 'non_waiting_first'], true)
            ? $roleSortModeInput
            : $defaultRoleSortMode;
        $sortableColumns = [
            'drawer' => 'drawer_name',
            'drawer_name' => 'drawer_name',
            'checker' => 'checker_name',
            'checker_name' => 'checker_name',
            'filler' => 'file_uploader_name',
            'file_uploader_name' => 'file_uploader_name',
            'qa' => 'qa_name',
            'qa_name' => 'qa_name',
        ];
        $sortColumn = $sortableColumns[$sortByInput] ?? null;
        $roleSortableColumns = [
            'drawer' => 'drawer',
            'checker' => 'checker',
            'filler' => 'filler',
            'qa' => 'qa',
        ];
        $roleSortColumn = $roleSortableColumns[$roleSortByInput] ?? null;
        $roleSortColumnFromSortBy = $roleSortableColumns[$sortByInput] ?? null;
        $effectiveRoleSortColumn = $roleSortColumn ?? $roleSortColumnFromSortBy;
        $shouldPaginateOrders = true;
        $hasSpecialPriorityProjects = !empty(array_intersect($projectIds, self::ASSIGNMENT_DASHBOARD_SPECIAL_PRIORITY_PROJECT_IDS));
        $isDateRangeSelection = !empty($startDate) && !empty($endDate)
            && Carbon::parse($startDate)->toDateString() !== Carbon::parse($endDate)->toDateString();
        $useDueInFirstOrdering = $hasSpecialPriorityProjects && $isDateRangeSelection;
        $page = max((int) $request->input('page', 1), 1);
        $defaultPerPage = $shouldPaginateOrders ? self::ASSIGNMENT_DASHBOARD_SPECIAL_PROJECTS_PER_PAGE : 15;
        $requestedPerPage = max((int) $request->input('per_page', $defaultPerPage), 1);
        $perPage = $shouldPaginateOrders
            ? min($requestedPerPage, self::ASSIGNMENT_DASHBOARD_SPECIAL_PROJECTS_PER_PAGE)
            : $requestedPerPage;

        // Selected columns
        $selectCols = 'id, order_number, code, plan_type, project_id, client_reference, address, client_name, instruction,'
            . 'workflow_state, priority, assigned_to, '
            . 'drawer_id, drawer_name, checker_id, checker_name, qa_id, qa_name, '
            . 'dassign_time, cassign_time, drawer_done, checker_done, final_upload, '
            . 'drawer_date, checker_date, ausFinaldate, '
            . 'amend, recheck_count, is_on_hold, '
            . 'due_in, due_date, '
            . 'received_at, delivered_at, created_at';

        // Optional columns that may not exist in all project tables
        $optionalCols = [
              'VARIANT_no', 'batch_number', 'date', 'bedrooms', 'client_portal_id', 'clint_order_number',
                        'company', 'branch', 'photographer',
            'current_layer', 'file_uploader_id', 'file_uploader_name',
            'fassign_time', 'file_uploaded', 'file_upload_date',
            'images', 'total_raw_files', 'hdr_images_count', 'single_images_count', 'final_images_count', 'edited_images_count',
            'it_datetime',
        ];

        // Push the received_at range into each project SELECT so MySQL can use
        // per-table indexes before building the UNION. The outer date filter
        // remains in place as a correctness guard.
        $appTimezone = config('app.timezone');
        $genericRange = $this->buildAssignmentDashboardGenericRange(
            $startDate,
            $endDate,
            $dateFilter,
            $appTimezone
        );
        $projectReceivedAtRanges = [];
        foreach ($projects as $project) {
            $projectReceivedAtRanges[(int) $project->id] =
                $this->buildAssignmentDashboardProjectRange(
                    $project,
                    $startDate,
                    $endDate,
                    $dateFilter,
                    $appTimezone
                ) ?? $genericRange;
        }

        // Keep an unfiltered UNION for the independent seven-day summary.
        $rawUnionForDateStats = $this->buildQueueUnionQuery(
            $projectIds,
            $selectCols,
            $optionalCols
        );

        // Build a date-filtered UNION for the current sheet and worker metrics.
        $rawUnion = $this->buildQueueUnionQuery(
            $projectIds,
            $selectCols,
            $optionalCols,
            $projectReceivedAtRanges
        );

        // Overlay CRM assignments (survives external cron truncation of project tables)
        // LEFT JOIN crm_order_assignments and COALESCE to prefer CRM values
        $unionQuery = "SELECT qo.id, qo.order_number, qo.client_portal_id, qo.clint_order_number, qo.VARIANT_no, qo.batch_number, qo.date, qo.bedrooms, qo.images, qo.total_raw_files, qo.hdr_images_count, qo.single_images_count, qo.final_images_count, qo.edited_images_count, qo.it_datetime, qo.project_id, qo.client_reference, qo.address, qo.client_name, qo.company, qo.branch, qo.photographer, qo.code, qo.plan_type, qo.instruction,"
            . "COALESCE(NULLIF(coa.current_layer,''), qo.current_layer) as current_layer, "
            . "COALESCE(coa.workflow_state, qo.workflow_state) as workflow_state, "
            . "qo.priority, "
            . "COALESCE(coa.assigned_to, qo.assigned_to) as assigned_to, "
            . "COALESCE(coa.drawer_id, qo.drawer_id) as drawer_id, "
            . "COALESCE(NULLIF(coa.drawer_name,''), qo.drawer_name) as drawer_name, "
            . "COALESCE(coa.checker_id, qo.checker_id) as checker_id, "
            . "COALESCE(NULLIF(coa.checker_name,''), qo.checker_name) as checker_name, "
            . "COALESCE(coa.file_uploader_id, qo.file_uploader_id) as file_uploader_id, "
            . "COALESCE(NULLIF(coa.file_uploader_name,''), qo.file_uploader_name) as file_uploader_name, "
            . "COALESCE(coa.qa_id, qo.qa_id) as qa_id, "
            . "COALESCE(NULLIF(coa.qa_name,''), qo.qa_name) as qa_name, "
            . "COALESCE(coa.dassign_time, qo.dassign_time) as dassign_time, "
            . "COALESCE(coa.cassign_time, qo.cassign_time) as cassign_time, "
            . "COALESCE(coa.fassign_time, qo.fassign_time) as fassign_time, "
            . "COALESCE(coa.drawer_done, qo.drawer_done) as drawer_done, "
            . "COALESCE(coa.checker_done, qo.checker_done) as checker_done, "
            . "COALESCE(coa.file_uploaded, qo.file_uploaded) as file_uploaded, "
            . "COALESCE(coa.final_upload, qo.final_upload) as final_upload, "
            . "COALESCE(coa.drawer_date, qo.drawer_date) as drawer_date, "
            . "COALESCE(coa.checker_date, qo.checker_date) as checker_date, "
            . "COALESCE(coa.file_upload_date, qo.file_upload_date) as file_upload_date, "
            . "COALESCE(coa.ausFinaldate, qo.ausFinaldate) as ausFinaldate, "
            . "qo.amend, qo.recheck_count, qo.is_on_hold, "
            . "qo.due_in, qo.due_date, "
            . "qo.received_at, qo.delivered_at, qo.created_at "
            . "FROM ({$rawUnion}) as qo "
            . "LEFT JOIN crm_order_assignments coa ON qo.project_id = coa.project_id AND qo.order_number = coa.order_number";
        $unionQueryForDateStats = str_replace($rawUnion, $rawUnionForDateStats, $unionQuery);

        // Work item timestamps keep their existing application-timezone behavior.
        if ($startDate || $endDate) {
            if ($startDate && $endDate) {
                $workerDateStart = Carbon::parse($startDate, $appTimezone)->startOfDay();
                $workerDateEnd = Carbon::parse($endDate, $appTimezone)->endOfDay();
            } elseif ($startDate) {
                $workerDateStart = Carbon::parse($startDate, $appTimezone)->startOfDay();
                $workerDateEnd = now($appTimezone)->endOfDay();
            } else {
                $workerDateStart = now($appTimezone)->startOfDay();
                $workerDateEnd = Carbon::parse($endDate, $appTimezone)->endOfDay();
            }
        } elseif ($dateFilter) {
            $workerDateStart = Carbon::parse($dateFilter, $appTimezone)->startOfDay();
            $workerDateEnd = Carbon::parse($dateFilter, $appTimezone)->endOfDay();
        } else {
            $workerDateStart = now($appTimezone)->startOfDay();
            $workerDateEnd = now($appTimezone)->endOfDay();
        }

        $workerIds = $allWorkers->pluck('id')->all();

        $todayCompletedByWorker = collect();
        $todayCompletedByRole = [];

        if ($isUkQueue) {
            $roleDateColumns = [
                'drawer' => ['id' => 'drawer_id', 'done' => 'drawer_done'],
                'designer' => ['id' => 'drawer_id', 'done' => 'drawer_done'],
                'checker' => ['id' => 'checker_id', 'done' => 'checker_done'],
                'qa' => ['id' => 'qa_id', 'done' => 'final_upload'],
                'filler' => ['id' => 'file_uploader_id', 'done' => 'file_uploaded'],
            ];

            foreach ($roleDateColumns as $roleKey => $roleColumns) {
                $roleCompletionQuery = DB::table(DB::raw("({$unionQuery}) as queue_orders"))
                    ->whereNotNull($roleColumns['id']);

                if ($roleKey === 'designer' && $workflowType === 'PH_2_LAYER') {
                    // PH designers can be marked complete via drawer_done, final_upload, or delivered state.
                    $roleCompletionQuery->where(function ($q) use ($roleColumns) {
                        $q->where($roleColumns['done'], 'yes')
                          ->orWhere('final_upload', 'yes')
                          ->orWhere('workflow_state', 'DELIVERED');
                    });
                } else {
                    $roleCompletionQuery->where($roleColumns['done'], 'yes');
                }

                $this->applyAssignmentDashboardDateFilter(
                    $roleCompletionQuery,
                    $projects,
                    $projectIds,
                    $dateFilter,
                    $startDate,
                    $endDate
                );

                $todayCompletedByRole[$roleKey] = $roleCompletionQuery
                    ->selectRaw("{$roleColumns['id']} as worker_id, COUNT(*) as cnt")
                    ->groupBy($roleColumns['id'])
                    ->pluck('cnt', 'worker_id');
            }
        } else {
            $todayCompletedByWorker = WorkItem::whereIn('assigned_user_id', $workerIds)
                ->where('status', 'completed')
                ->whereBetween('completed_at', [$workerDateStart, $workerDateEnd])
                ->selectRaw('assigned_user_id, COUNT(*) as cnt')
                ->groupBy('assigned_user_id')
                ->pluck('cnt', 'assigned_user_id');
        }

        $drawerWipByWorkerQuery = DB::table(DB::raw("({$unionQuery}) as queue_orders"))
            ->whereNotNull('drawer_id')
            ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
            ->where(function ($q) {
                $q->whereNull('drawer_done')
                  ->orWhere('drawer_done', '!=', 'yes');
            });
        $this->applyAssignmentDashboardDateFilter($drawerWipByWorkerQuery, $projects, $projectIds, $dateFilter, $startDate, $endDate);
        $drawerWipByWorker = $drawerWipByWorkerQuery
            ->selectRaw('drawer_id as worker_id, COUNT(*) as wip_count')
            ->groupBy('drawer_id')
            ->pluck('wip_count', 'worker_id');

        $checkerWipByWorkerQuery = DB::table(DB::raw("({$unionQuery}) as queue_orders"))
            ->whereNotNull('checker_id')
            ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
            ->where(function ($q) {
                $q->whereNull('checker_done')
                  ->orWhere('checker_done', '!=', 'yes');
            });
        $this->applyAssignmentDashboardDateFilter($checkerWipByWorkerQuery, $projects, $projectIds, $dateFilter, $startDate, $endDate);
        $checkerWipByWorker = $checkerWipByWorkerQuery
            ->selectRaw('checker_id as worker_id, COUNT(*) as wip_count')
            ->groupBy('checker_id')
            ->pluck('wip_count', 'worker_id');

        $qaWipByWorkerQuery = DB::table(DB::raw("({$unionQuery}) as queue_orders"))
            ->whereNotNull('qa_id')
            ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
            ->where(function ($q) {
                $q->whereNull('final_upload')
                  ->orWhere('final_upload', '!=', 'yes');
            });
        $this->applyAssignmentDashboardDateFilter($qaWipByWorkerQuery, $projects, $projectIds, $dateFilter, $startDate, $endDate);
        $qaWipByWorker = $qaWipByWorkerQuery
            ->selectRaw('qa_id as worker_id, COUNT(*) as wip_count')
            ->groupBy('qa_id')
            ->pluck('wip_count', 'worker_id');

        $fillerWipByWorkerQuery = DB::table(DB::raw("({$unionQuery}) as queue_orders"))
            ->whereNotNull('file_uploader_id')
            ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
            ->where(function ($q) {
                $q->whereNull('file_uploaded')
                  ->orWhere('file_uploaded', '!=', 'yes');
            });
        $this->applyAssignmentDashboardDateFilter($fillerWipByWorkerQuery, $projects, $projectIds, $dateFilter, $startDate, $endDate);
        $fillerWipByWorker = $fillerWipByWorkerQuery
            ->selectRaw('file_uploader_id as worker_id, COUNT(*) as wip_count')
            ->groupBy('file_uploader_id')
            ->pluck('wip_count', 'worker_id');

        $wipMapByRole = [
            'drawer' => $drawerWipByWorker,
            'designer' => $drawerWipByWorker,
            'checker' => $checkerWipByWorker,
            'qa' => $qaWipByWorker,
            'filler' => $fillerWipByWorker,
        ];

        foreach ($stages as $stage) {
            $role = StateMachine::STAGE_TO_ROLE[$stage];
            $roleUsers = $allWorkers->where('role', $role);
            $roleWipMap = $wipMapByRole[$role] ?? collect();
            $roleTodayMap = $todayCompletedByRole[$role] ?? $todayCompletedByWorker;

            $workers[$role] = $roleUsers->map(function ($u) use ($roleWipMap, $roleTodayMap) {
                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'role' => $u->role,
                    'team_id' => $u->team_id,
                    'project_id' => $u->project_id,
                    'is_active' => $u->is_active,
                    'is_absent' => $u->is_absent,
                    'is_online' => $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)),
                    'wip_count' => (int) ($roleWipMap[$u->id] ?? 0),
                    'today_completed' => (int) ($roleTodayMap[$u->id] ?? 0),
                ];
            })->values();
        }

        $query = DB::table(DB::raw("({$unionQuery}) as queue_orders"));

// ✅ ADD HERE (global filter)
if ($statusFilter !== 'completed' && $statusFilter !== 'pending_by_drawer') {
    $query->where('workflow_state', '!=', 'DELIVERED');
    $query->where('workflow_state', '!=', 'PENDING_BY_DRAWER');
}

// Global hide
// Global hide (applies to "all" / "pending" etc, but skips drawer-pending & rejected)
if (!in_array($statusFilter, ['completed', 'rejected', 'pending_by_drawer'])) {
    $query->where('workflow_state', '!=', 'DELIVERED')
          ->where('workflow_state', 'NOT LIKE', '%REJECT%');
}

// Specific filters
if ($statusFilter === 'completed') {
    $query->where('workflow_state', 'DELIVERED');
}

if ($statusFilter === 'rejected') {
    $query->where('workflow_state', 'LIKE', '%REJECT%');
}

if ($statusFilter === 'pending_by_drawer') {
    $query->where('workflow_state', 'PENDING_BY_DRAWER');
}

        // Apply filters to the union result
        if ($statusFilter === 'pending') {
            $query->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                  ->where(function ($q) use ($workflowType) {
                      if ($workflowType === 'PH_2_LAYER') {
                          $q->where('final_upload', '!=', 'yes')
                            ->orWhereNull('final_upload');
                      } else {
                          $q->where('drawer_done', '!=', 'yes')
                            ->orWhereNull('drawer_done');
                      }
                  });
        } elseif ($statusFilter === 'completed') {
            $query->where('workflow_state', 'DELIVERED');
        } elseif ($statusFilter === 'amends') {
            $query->where('amend', 'yes');
        } elseif ($statusFilter === 'unassigned') {
            $query->whereNull('drawer_id')
                  ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED']);
        }



        $this->applyAssignmentDashboardDateFilter(
            $query,
            $projects,
            $projectIds,
            $dateFilter,
            $startDate,
            $endDate
        );




        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('order_number', 'like', "%{$search}%")
                                    ->orWhere('clint_order_number', 'like', "%{$search}%")
                  ->orWhere('address', 'like', "%{$search}%")
                  ->orWhere('client_reference', 'like', "%{$search}%")
                  ->orWhere('client_name', 'like', "%{$search}%")
                  ->orWhere('drawer_name', 'like', "%{$search}%")
                  ->orWhere('checker_name', 'like', "%{$search}%")
                  ->orWhere('file_uploader_name', 'like', "%{$search}%")
                  ->orWhere('qa_name', 'like', "%{$search}%");
            });
        }

        if ($assignedTo) {
            $query->where(function ($q) use ($assignedTo) {
                $q->where('assigned_to', $assignedTo)
                  ->orWhere('drawer_id', $assignedTo)
                  ->orWhere('checker_id', $assignedTo)
                  ->orWhere('file_uploader_id', $assignedTo)
                  ->orWhere('qa_id', $assignedTo);
            });
        }

        $dueInOrderExpr = "CASE
            WHEN project_id = 16 AND due_in IS NOT NULL THEN DATE_ADD(due_in, INTERVAL 2 HOUR)
            ELSE due_in
        END";

        $priorityOrderExpr = "FIELD(priority, 'rush', 'urgent', 'priority', 'high', 'normal', 'low', '')";

        $orderedQuery = (clone $query);

        if ($effectiveRoleSortColumn !== null) {
            $drawerDoneExpr = "(TRIM(COALESCE(drawer_done, '')) <> '' AND LOWER(TRIM(COALESCE(drawer_done, ''))) NOT IN ('no', '0', 'false'))";
            $checkerDoneExpr = "(TRIM(COALESCE(checker_done, '')) <> '' AND LOWER(TRIM(COALESCE(checker_done, ''))) NOT IN ('no', '0', 'false'))";
            $qaDoneExpr = "(TRIM(COALESCE(final_upload, '')) <> '' AND LOWER(TRIM(COALESCE(final_upload, ''))) NOT IN ('no', '0', 'false'))";
            $drawerNotDoneExpr = "(TRIM(COALESCE(drawer_done, '')) = '' OR LOWER(TRIM(COALESCE(drawer_done, ''))) IN ('no', '0', 'false'))";
            $checkerNotDoneExpr = "(TRIM(COALESCE(checker_done, '')) = '' OR LOWER(TRIM(COALESCE(checker_done, ''))) IN ('no', '0', 'false'))";
            $fillerNotDoneExpr = "(TRIM(COALESCE(file_uploaded, '')) = '' OR LOWER(TRIM(COALESCE(file_uploaded, ''))) IN ('no', '0', 'false'))";
            $qaNotDoneExpr = "(TRIM(COALESCE(final_upload, '')) = '' OR LOWER(TRIM(COALESCE(final_upload, ''))) IN ('no', '0', 'false'))";

            // Sort the requested role's workflow queue globally before pagination.
            // waiting_first puts the stage-appropriate "done but not yet assigned" rows first.
            // non_waiting_first flips that order while keeping the same global query.
            $roleWaitSignalExpr = match ($effectiveRoleSortColumn) {
                'drawer' => "(
                    (drawer_id IS NULL OR drawer_id = 0)
                    AND (drawer_name IS NULL OR TRIM(drawer_name) = '')
                    AND {$drawerNotDoneExpr}
                )",
                'checker' => "(
                    {$drawerDoneExpr}
                    AND (checker_id IS NULL OR checker_id = 0)
                    AND (checker_name IS NULL OR TRIM(checker_name) = '')
                    AND {$checkerNotDoneExpr}
                )",
                'filler' => "(
                    {$checkerDoneExpr}
                    AND (file_uploader_id IS NULL OR file_uploader_id = 0)
                    AND (file_uploader_name IS NULL OR TRIM(file_uploader_name) = '')
                    AND {$fillerNotDoneExpr}
                )",
                'qa' => "(
                    {$checkerDoneExpr}
                    AND (qa_id IS NULL OR qa_id = 0)
                    AND (qa_name IS NULL OR TRIM(qa_name) = '')
                    AND {$qaNotDoneExpr}
                )",
                default => null,
            };

            if ($roleWaitSignalExpr !== null) {
                $orderedQuery->orderByRaw(
                    $roleSortMode === 'non_waiting_first'
                        ? "CASE WHEN {$roleWaitSignalExpr} THEN 1 ELSE 0 END ASC"
                        : "CASE WHEN {$roleWaitSignalExpr} THEN 0 ELSE 1 END ASC"
                );
            }
        }

        if ($sortColumn !== null) {
            $orderedQuery
                ->orderByRaw("CASE WHEN {$sortColumn} IS NULL OR {$sortColumn} = '' THEN 1 ELSE 0 END ASC")
                ->orderBy($sortColumn, $sortOrder);
        }

if ($useDueInFirstOrdering) {
    $orderedQuery->reorder();

    $orderedQuery
        ->orderByRaw("CASE WHEN due_in IS NULL THEN 1 ELSE 0 END ASC")
        ->orderByRaw("CAST({$dueInOrderExpr} AS DATETIME) ASC")
        ->orderByRaw("{$priorityOrderExpr} ASC")
        ->orderBy('received_at', 'asc')
        ->orderBy('id', 'asc');
} else {
            $orderedQuery
                ->orderByRaw("{$priorityOrderExpr} ASC")
                ->orderByRaw("CASE WHEN due_in IS NOT NULL THEN TIMESTAMPDIFF(SECOND, NOW(), {$dueInOrderExpr}) ELSE 999999999 END ASC")
                ->orderBy('received_at', 'asc')
                ->orderBy('id', 'asc');
        }

        $priorityCountsRow = (clone $query)->selectRaw("
            COUNT(*) as total_count,
            SUM(CASE WHEN priority = 'normal' THEN 1 ELSE 0 END) as normal_count,
            SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_count,
            SUM(CASE WHEN priority = 'priority' THEN 1 ELSE 0 END) as priority_count,
            SUM(CASE WHEN priority IN ('urgent', 'rush') THEN 1 ELSE 0 END) as urgent_count
        ")->first();

        $total = (int) ($priorityCountsRow->total_count ?? 0);
        $normalPriorityCount = (int) ($priorityCountsRow->normal_count ?? 0);
        $highPriorityCount = (int) ($priorityCountsRow->high_count ?? 0);
        $priorityPriorityCount = (int) ($priorityCountsRow->priority_count ?? 0);
        $urgentPriorityCount = (int) ($priorityCountsRow->urgent_count ?? 0);

        if ($shouldPaginateOrders) {
            $orderedQuery->forPage($page, $perPage);
        }

        $orders = $orderedQuery->get();

        $assignmentCommentMap = $this->buildAssignmentDashboardCommentMap($orders);

        $orders->transform(function ($order) use ($assignmentCommentMap) {
            $offsetHours = self::ASSIGNMENT_DASHBOARD_DUE_IN_OFFSETS[(int) $order->project_id] ?? 0;

            if ($offsetHours !== 0 && !empty($order->due_in)) {
                try {
                    $order->due_in = \Carbon\Carbon::parse($order->due_in)
                        ->addHours($offsetHours)
                        ->toDateTimeString();
                } catch (\Throwable $e) {
                    // Keep original due_in if parsing fails.
                }
            }

            $orderKey = ((int) $order->project_id) . ':' . ((int) $order->id);
            $commentMeta = $assignmentCommentMap[$orderKey] ?? [];
            $order->area = $commentMeta['area'] ?? null;
            $order->total_images = $commentMeta['total_images'] ?? null;
            $order->final_images = $commentMeta['final_images'] ?? null;

            return $order;
        });

        $ordersResponseData = $orders->values();

        // ─── 3. Counts (single aggregation query instead of 6 separate queries) ───
        $baseQ = DB::table(DB::raw("({$unionQuery}) as queue_orders"));
//         if ($statusFilter !== 'completed') {
//     $baseQ->where('workflow_state', '!=', 'DELIVERED');
// }



// ─── Apply SAME date logic to counts ───
        $this->applyAssignmentDashboardDateFilter(
            $baseQ,
            $projects,
            $projectIds,
            $dateFilter,
            $startDate,
            $endDate
        );




        $countsRow = (clone $baseQ)->selectRaw("
            COUNT(*) as total,
            SUM(CASE WHEN workflow_state NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN workflow_state = 'DELIVERED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN amend = 'yes' THEN 1 ELSE 0 END) as amends,
            SUM(CASE WHEN assigned_to IS NOT NULL AND workflow_state NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) as assigned,
            SUM(CASE WHEN drawer_id IS NULL AND workflow_state NOT IN ('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) as unassigned,
            SUM(CASE WHEN workflow_state LIKE '%REJECT%' THEN 1 ELSE 0 END) as rejected,
            SUM(CASE WHEN workflow_state = 'PENDING_BY_DRAWER' THEN 1 ELSE 0 END) as pending_by_drawer
        ")->first();

        $todayTotal = (int) ($countsRow->total ?? 0);
        $pendingCount = (int) ($countsRow->pending ?? 0);
        $completedCount = (int) ($countsRow->completed ?? 0);
        $amendsCount = (int) ($countsRow->amends ?? 0);
        $assignedCount = (int) ($countsRow->assigned ?? 0);
        $unassignedCount = (int) ($countsRow->unassigned ?? 0);
        $rejectedCount = (int) ($countsRow->rejected ?? 0);
        $pendingByDrawerCount = (int) ($countsRow->pending_by_drawer ?? 0);

        // ─── 4. Date-wise summary (last 7 days) — 2 bulk queries instead of 42+ ───
        $sevenDaysAgo = today()->subDays(6)->toDateString();

        // Received stats by date — single query with conditional aggregation
        $receivedByDate = DB::table(DB::raw("({$unionQueryForDateStats}) as queue_orders"))
            ->where('received_at', '>=', $sevenDaysAgo)
            ->selectRaw("
                DATE(received_at) as the_date,
                SUM(CASE WHEN priority = 'urgent' OR priority = 'rush' THEN 1 ELSE 0 END) as urgent_count,
                SUM(CASE WHEN priority = 'priority' THEN 1 ELSE 0 END) as priority_count,
                SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as high_count,
                SUM(CASE WHEN priority IN ('normal','low') THEN 1 ELSE 0 END) as regular_count,
                SUM(CASE WHEN drawer_done = 'yes' THEN 1 ELSE 0 END) as drawer_done,
                SUM(CASE WHEN checker_done = 'yes' THEN 1 ELSE 0 END) as checker_done,
                SUM(CASE WHEN final_upload = 'yes' THEN 1 ELSE 0 END) as qa_done,
                SUM(CASE WHEN amend = 'yes' THEN 1 ELSE 0 END) as amender_done,
                SUM(CASE WHEN file_uploaded = 'yes' THEN 1 ELSE 0 END) as filler_done
            ")
            ->groupBy('the_date')
            ->get()
            ->keyBy('the_date');

        // Delivered stats by date — separate query since it uses delivered_at
        $deliveredByDate = DB::table(DB::raw("({$unionQueryForDateStats}) as queue_orders"))
            ->where('workflow_state', 'DELIVERED')
            ->where('delivered_at', '>=', $sevenDaysAgo)
            ->selectRaw('DATE(delivered_at) as the_date, COUNT(*) as cnt')
            ->groupBy('the_date')
            ->pluck('cnt', 'the_date');

        $dateStats = [];
        for ($i = 6; $i >= 0; $i--) {
            $d = today()->subDays($i);
            $dStr = $d->toDateString();
            $dayData = $receivedByDate[$dStr] ?? null;
            $urgentCount = (int) ($dayData->urgent_count ?? 0);
            $priorityCount = (int) ($dayData->priority_count ?? 0);
            $highCount = (int) ($dayData->high_count ?? 0);
            $regularCount = (int) ($dayData->regular_count ?? 0);

            $dateStats[] = [
                'date' => $dStr,
                'label' => $d->format('D'),
                'day_label' => $d->format('d M'),
                'urgent' => $urgentCount,
                'priority' => $priorityCount,
                'high' => $highCount,
                'regular' => $regularCount,
                'total' => $urgentCount + $priorityCount + $highCount + $regularCount,
                'drawer_done' => (int) ($dayData->drawer_done ?? 0),
                'checker_done' => (int) ($dayData->checker_done ?? 0),
                'qa_done' => (int) ($dayData->qa_done ?? 0),
                'amender_done' => (int) ($dayData->amender_done ?? 0),
                'filler_done' => (int) ($dayData->filler_done ?? 0),
                'delivered' => (int) ($deliveredByDate[$dStr] ?? 0),
            ];
        }

        // ─── 5. Role-wise completion stats for today ───
        $roleCompletions = [];
        $todayCompletions = WorkItem::where('completed_at', '>=', $this->businessDayBounds()[0])
            ->where('completed_at', '<', $this->businessDayBounds()[1])
            ->where('status', 'completed')
            ->whereIn('assigned_user_id', $allWorkers->pluck('id'))
            ->selectRaw('assigned_user_id, COUNT(*) as cnt')
            ->groupBy('assigned_user_id')
            ->pluck('cnt', 'assigned_user_id');

        foreach ($stages as $stage) {
            $role = StateMachine::STAGE_TO_ROLE[$stage];
            $roleUsers = $allWorkers->where('role', $role);
            $roleCompletionsMap = $isUkQueue
                ? ($todayCompletedByRole[$role] ?? collect())
                : $todayCompletions;

            $roleCompletions[$role] = [
                'total_staff' => $roleUsers->count(),
                'active' => $roleUsers->filter(fn($u) => !$u->is_absent && $u->last_activity && $u->last_activity->gt(now()->subMinutes(15)))->count(),
                'today_completed' => $roleUsers->pluck('id')->sum(fn($uid) => $roleCompletionsMap->get($uid, 0)),
            ];
        }

        // ─── Build queue info for response ───
        $queueInfo = [
            'queue_name' => $queueName,
            'projects' => $projects->map(fn($p) => $p->only(['id', 'code', 'name', 'country', 'department', 'workflow_type']))->values(),
            'department' => $primaryProject->department,
            'country' => $primaryProject->country,
            'workflow_type' => $workflowType,
        ];

        $counts = [
            'today_total' => $todayTotal,
            'pending' => $pendingCount,
            'completed' => $completedCount,
            'amends' => $amendsCount,
            'assigned' => $assignedCount,
            'pending_by_drawer' => $pendingByDrawerCount,
            'unassigned' => $unassignedCount,
            'normal_priority' => $normalPriorityCount,
            'high_priority' => $highPriorityCount,
            'urgent_priority' => $urgentPriorityCount,
        ];

        if ($priorityPriorityCount > 0) {
            $counts['priority_priority'] = $priorityPriorityCount;
        }

        $responseData = [
            'queue' => $queueInfo,
            // Keep backward compat: 'project' key returns first project info
            'project' => $primaryProject->only(['id', 'code', 'name', 'country', 'department', 'workflow_type', 'timezone']),
            'workers' => $workers,
            'orders' => [
                'data' => $ordersResponseData,
                'current_page' => $shouldPaginateOrders ? $page : 1,
                'per_page' => $shouldPaginateOrders ? $perPage : ($total ?: 1),
                'total' => $total,
                'last_page' => $shouldPaginateOrders ? max((int) ceil($total / $perPage), 1) : 1,
            ],
            'counts' => $counts,
            'date_stats' => $dateStats,
            'role_completions' => $roleCompletions,
        ];

        return response()->json($this->sanitizeAssignmentDashboardJson($responseData));
    }

 
 
 
 
 
 
 

    /**
     * Build a UNION ALL SQL string across all project order tables in a queue.
     * Each project has its own table (project_{id}_orders), so no project_id filter needed.
     * We override project_id in SELECT to ensure correctness (imported data may have legacy IDs).
     */
    private function buildQueueUnionQuery(
        array $projectIds,
        string $selectCols,
        array $optionalCols = [],
        array $receivedAtRanges = []
    ): string
    {
        $parts = [];
        foreach ($projectIds as $pid) {
            $tableName = ProjectOrderService::getTableName($pid);
            if (self::tableExists($tableName)) {
                // Replace project_id in SELECT with the correct value (table already scopes to this project)
                $cols = str_replace('project_id', "{$pid} as project_id", $selectCols);
                // Handle optional columns that may not exist in all tables
                foreach ($optionalCols as $optCol) {
                    if (self::columnExists($tableName, $optCol)) {
                        $cols .= ", {$optCol}";
                    } else {
                        $cols .= ", NULL as {$optCol}";
                    }
                }
                $rangeSql = isset($receivedAtRanges[(int) $pid])
                    ? $this->buildAssignmentDashboardRangeSql($receivedAtRanges[(int) $pid])
                    : '';
                $parts[] = "SELECT {$cols} FROM `{$tableName}`{$rangeSql}";
            }
        }
        if (empty($parts)) {
            // Return a dummy empty query that returns no rows
            $firstTable = ProjectOrderService::getTableName($projectIds[0] ?? 0);
            $fallbackCols = $selectCols;
            foreach ($optionalCols as $optCol) {
                $fallbackCols .= ", NULL as {$optCol}";
            }
            return "SELECT {$fallbackCols} FROM `{$firstTable}` WHERE 1=0";
        }
        return implode(' UNION ALL ', $parts);
    }

    private function buildAssignmentDashboardRangeSql(array $range): string
    {
        $type = $range['type'] ?? 'between';
        $quote = fn ($value) => DB::connection()->getPdo()->quote(
            $value instanceof \DateTimeInterface
                ? $value->format('Y-m-d H:i:s')
                : (string) $value
        );

        if ($type === 'start') {
            return ' WHERE `received_at` >= ' . $quote($range['start']);
        }

        if ($type === 'end') {
            return ' WHERE `received_at` <= ' . $quote($range['end']);
        }

        return ' WHERE `received_at` BETWEEN '
            . $quote($range['start'])
            . ' AND '
            . $quote($range['end']);
    }

    private function sortAssignmentDashboardCacheParams(array &$params): void
    {
        ksort($params);

        foreach ($params as &$value) {
            if (is_array($value)) {
                $this->sortAssignmentDashboardCacheParams($value);
            }
        }
        unset($value);
    }

    private function applyAssignmentDashboardDateFilter(
        $query,
        \Illuminate\Support\Collection $projects,
        array $projectIds,
        ?string $dateFilter,
        ?string $startDate,
        ?string $endDate
    ): void {
        $appTimezone = config('app.timezone');
        $genericRange = $this->buildAssignmentDashboardGenericRange($startDate, $endDate, $dateFilter, $appTimezone);
        $overrideRanges = [];

        foreach ($projects as $project) {
            $range = $this->buildAssignmentDashboardProjectRange($project, $startDate, $endDate, $dateFilter, $appTimezone);
            if ($range !== null) {
                $overrideRanges[(int) $project->id] = $range;
            }
        }

        if (empty($overrideRanges)) {
            $this->applyAssignmentDashboardRangeConstraint($query, $genericRange);
            return;
        }

        $genericProjectIds = array_values(array_diff($projectIds, array_keys($overrideRanges)));

        $query->where(function ($scopedDateQuery) use ($overrideRanges, $genericProjectIds, $genericRange) {
            $hasAnyClause = false;

            foreach ($overrideRanges as $projectId => $range) {
                $method = $hasAnyClause ? 'orWhere' : 'where';
                $scopedDateQuery->{$method}(function ($projectQuery) use ($projectId, $range) {
                    $projectQuery->where('project_id', $projectId);
                    $this->applyAssignmentDashboardRangeConstraint($projectQuery, $range);
                });
                $hasAnyClause = true;
            }

            if (!empty($genericProjectIds)) {
                $method = $hasAnyClause ? 'orWhere' : 'where';
                $scopedDateQuery->{$method}(function ($projectQuery) use ($genericProjectIds, $genericRange) {
                    $projectQuery->whereIn('project_id', $genericProjectIds);
                    $this->applyAssignmentDashboardRangeConstraint($projectQuery, $genericRange);
                });
            }
        });
    }

    private function buildAssignmentDashboardGenericRange(
        ?string $startDate,
        ?string $endDate,
        ?string $dateFilter,
        string $appTimezone
    ): array {
        if ($startDate || $endDate) {
            $parsedStart = $startDate ? \Carbon\Carbon::parse($startDate, $appTimezone)->startOfDay() : null;
            $parsedEnd   = $endDate   ? \Carbon\Carbon::parse($endDate,   $appTimezone)->endOfDay()   : null;

            // Single date: treat as full day
            if ($parsedStart && !$parsedEnd) {
                $parsedEnd = \Carbon\Carbon::parse($startDate, $appTimezone)->endOfDay();
            }
            if ($parsedEnd && !$parsedStart) {
                $parsedStart = \Carbon\Carbon::parse($endDate, $appTimezone)->startOfDay();
            }

            return [
                'type'  => 'between',
                'start' => $parsedStart,
                'end'   => $parsedEnd,
            ];
        }

        if ($dateFilter) {
            return [
                'type' => 'between',
                'start' => \Carbon\Carbon::parse($dateFilter, $appTimezone)->startOfDay(),
                'end' => \Carbon\Carbon::parse($dateFilter, $appTimezone)->endOfDay(),
            ];
        }

        return [
            'type' => 'between',
            'start' => now($appTimezone)->startOfDay(),
            'end' => now($appTimezone)->endOfDay(),
        ];
    }

    private function buildAssignmentDashboardProjectRange(
        Project $project,
        ?string $startDate,
        ?string $endDate,
        ?string $dateFilter,
        string $appTimezone
    ): ?array {
        $storageTimezone = self::ASSIGNMENT_DASHBOARD_STORAGE_TIMEZONE;

        if ((int) $project->id === self::ASSIGNMENT_DASHBOARD_VIETNAM_PROJECT_ID) {
            return $this->buildAssignmentDashboardVietnamRange(
                $startDate,
                $endDate,
                $dateFilter,
                $storageTimezone
            );
        }

        // received_at is stored as PKT display values for all projects (after migrations).
        // Using project display timezone (e.g. Etc/GMT, Europe/London) shifts the boundary
        // by 1–5h, causing early-morning PKT orders to fall on the wrong date.
        $projectTimezone = $storageTimezone; // Always PKT — matches actual storage
        $toStorageTimezone = fn (Carbon $date) => $date->setTimezone($storageTimezone);

        if ($startDate || $endDate) {
            $parsedStart = $startDate ? Carbon::parse($startDate, $projectTimezone)->startOfDay() : null;
            $parsedEnd   = $endDate   ? Carbon::parse($endDate,   $projectTimezone)->endOfDay()   : null;

            // Single date: treat as full day in project timezone
            if ($parsedStart && !$parsedEnd) {
                $parsedEnd = Carbon::parse($startDate, $projectTimezone)->endOfDay();
            }
            if ($parsedEnd && !$parsedStart) {
                $parsedStart = Carbon::parse($endDate, $projectTimezone)->startOfDay();
            }

            return [
                'type'  => 'between',
                'start' => $toStorageTimezone($parsedStart),
                'end'   => $toStorageTimezone($parsedEnd),
            ];
        }

        if ($dateFilter) {
            $selectedDate = Carbon::parse($dateFilter, $projectTimezone);

            return [
                'type' => 'between',
                'start' => $toStorageTimezone($selectedDate->copy()->startOfDay()),
                'end' => $toStorageTimezone($selectedDate->copy()->endOfDay()),
            ];
        }

        // Today in project timezone — no date sent from frontend
        $projectNow = now($projectTimezone);

        return [
            'type'  => 'between',
            'start' => $toStorageTimezone($projectNow->copy()->startOfDay()),
            'end'   => $toStorageTimezone($projectNow->copy()->endOfDay()),
        ];
    }

    private function buildAssignmentDashboardVietnamRange(
        ?string $startDate,
        ?string $endDate,
        ?string $dateFilter,
        string $storageTimezone
    ): array {
        $vietnamTimezone = self::ASSIGNMENT_DASHBOARD_VIETNAM_TIMEZONE;
        $toStoredTime = fn (Carbon $date) => $date->copy()->setTimezone($storageTimezone);
        $storageToday = now($storageTimezone)->toDateString();
        $vietnamToday = now($vietnamTimezone)->toDateString();

        // The frontend initializes its date fields in PKT. From 10 PM PKT,
        // Vietnam is already on the next calendar day, so roll only that
        // default current-day selection forward. Custom/historical dates stay unchanged.
        if ($storageToday !== $vietnamToday) {
            $requestedStart = $startDate
                ? Carbon::parse($startDate, $storageTimezone)->toDateString()
                : null;
            $requestedEnd = $endDate
                ? Carbon::parse($endDate, $storageTimezone)->toDateString()
                : null;

            $isCurrentSingleDaySelection = ($requestedStart === $storageToday && $requestedEnd === $storageToday)
                || ($requestedStart === $storageToday && $requestedEnd === null)
                || ($requestedEnd === $storageToday && $requestedStart === null);

            if ($isCurrentSingleDaySelection) {
                $startDate = $startDate ? $vietnamToday : null;
                $endDate = $endDate ? $vietnamToday : null;
            }

            if (
                $dateFilter
                && Carbon::parse($dateFilter, $storageTimezone)->toDateString() === $storageToday
            ) {
                $dateFilter = $vietnamToday;
            }
        }

        if ($startDate || $endDate) {
            $parsedStart = $startDate ? Carbon::parse($startDate, $vietnamTimezone)->startOfDay() : null;
            $parsedEnd   = $endDate   ? Carbon::parse($endDate,   $vietnamTimezone)->endOfDay()   : null;

            if ($parsedStart && !$parsedEnd) {
                $parsedEnd = Carbon::parse($startDate, $vietnamTimezone)->endOfDay();
            }
            if ($parsedEnd && !$parsedStart) {
                $parsedStart = Carbon::parse($endDate, $vietnamTimezone)->startOfDay();
            }

            return [
                'type'  => 'between',
                'start' => $toStoredTime($parsedStart),
                'end'   => $toStoredTime($parsedEnd),
            ];
        }

        $selectedDate = $dateFilter
            ? Carbon::parse($dateFilter, $vietnamTimezone)
            : now($vietnamTimezone);

        return [
            'type' => 'between',
            'start' => $toStoredTime($selectedDate->copy()->startOfDay()),
            'end' => $toStoredTime($selectedDate->copy()->endOfDay()),
        ];
    }

    private function resolveAssignmentDashboardProjectTimezone(?string $timezone): string
    {
        $timezone = trim((string) $timezone);

        if ($timezone === '') {
            return self::DEFAULT_PROJECT_TIMEZONE;
        }

        try {
            new \DateTimeZone($timezone);

            return $timezone;
        } catch (\Throwable $e) {
            return self::DEFAULT_PROJECT_TIMEZONE;
        }
    }

    private function applyAssignmentDashboardRangeConstraint($query, array $range): void
    {
        $type = $range['type'] ?? 'between';

        if ($type === 'start') {
            $query->where('received_at', '>=', $range['start']);
            return;
        }

        if ($type === 'end') {
            $query->where('received_at', '<=', $range['end']);
            return;
        }

        $query->whereBetween('received_at', [$range['start'], $range['end']]);
    }

    private function applyProjectAwareDateFilter(
        $query,
        \Illuminate\Support\Collection $projects,
        array $projectIds,
        ?string $dateFilter,
        ?string $startDate,
        ?string $endDate,
        string $column
    ): void {
        $appTimezone = config('app.timezone');
        $genericRange = $this->buildAssignmentDashboardGenericRange($startDate, $endDate, $dateFilter, $appTimezone);
        $overrideRanges = [];

        foreach ($projects as $project) {
            $range = $this->buildAssignmentDashboardProjectRange($project, $startDate, $endDate, $dateFilter, $appTimezone);
            if ($range !== null) {
                $overrideRanges[(int) $project->id] = $range;
            }
        }

        if (empty($overrideRanges)) {
            $this->applyProjectAwareRangeConstraint($query, $genericRange, $column);
            return;
        }

        $genericProjectIds = array_values(array_diff($projectIds, array_keys($overrideRanges)));

        $query->where(function ($scopedDateQuery) use ($overrideRanges, $genericProjectIds, $genericRange, $column) {
            $hasAnyClause = false;

            foreach ($overrideRanges as $projectId => $range) {
                $method = $hasAnyClause ? 'orWhere' : 'where';
                $scopedDateQuery->{$method}(function ($projectQuery) use ($projectId, $range, $column) {
                    $projectQuery->where('project_id', $projectId);
                    $this->applyProjectAwareRangeConstraint($projectQuery, $range, $column);
                });
                $hasAnyClause = true;
            }

            if (!empty($genericProjectIds)) {
                $method = $hasAnyClause ? 'orWhere' : 'where';
                $scopedDateQuery->{$method}(function ($projectQuery) use ($genericProjectIds, $genericRange, $column) {
                    $projectQuery->whereIn('project_id', $genericProjectIds);
                    $this->applyProjectAwareRangeConstraint($projectQuery, $genericRange, $column);
                });
            }
        });
    }

    private function applyProjectAwareRangeConstraint($query, array $range, string $column): void
    {
        $type = $range['type'] ?? 'between';

        if ($type === 'start') {
            $query->where($column, '>=', $range['start']);
            return;
        }

        if ($type === 'end') {
            $query->where($column, '<=', $range['end']);
            return;
        }

        $query->whereBetween($column, [$range['start'], $range['end']]);
    }

    private function buildAssignmentDashboardCommentMap(\Illuminate\Support\Collection $orders): array
    {
        $orderIds = $orders->pluck('id')
            ->filter()
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();

        $projectIds = $orders->pluck('project_id')
            ->filter()
            ->map(fn ($projectId) => (int) $projectId)
            ->unique()
            ->values();

        if ($orderIds->isEmpty() || $projectIds->isEmpty()) {
            return [];
        }

        $workItems = WorkItem::query()
            ->whereIn('project_id', $projectIds->all())
            ->whereIn('order_id', $orderIds->all())
            ->whereNotNull('comments')
            ->orderByDesc('id')
            ->get(['id', 'project_id', 'order_id', 'comments']);

        $commentMap = [];

        foreach ($workItems as $workItem) {
            $key = ((int) $workItem->project_id) . ':' . ((int) $workItem->order_id);

            if (array_key_exists($key, $commentMap)) {
                continue;
            }

            $area = $this->extractAreaFromAssignmentComment($workItem->comments);
            $totalImages = $this->extractImageCountFromAssignmentComment($workItem->comments, 'Total');
            $finalImages = $this->extractImageCountFromAssignmentComment($workItem->comments, 'Final');

            if ($area === null && $totalImages === null && $finalImages === null) {
                continue;
            }

            $commentMap[$key] = [
                'area' => $area,
                'total_images' => $totalImages,
                'final_images' => $finalImages,
            ];
        }

        return $commentMap;
    }

    private function extractAreaFromAssignmentComment(?string $comments)
    {
        if (empty($comments)) {
            return null;
        }

        if (!preg_match('/Area\s*:\s*([^,]+)/i', $comments, $matches)) {
            return null;
        }

        $area = trim($matches[1]);
        if ($area === '') {
            return null;
        }

        if (preg_match('/^-?\d+$/', $area)) {
            return (int) $area;
        }

        if (is_numeric($area)) {
            $numericArea = (float) $area;

            return is_finite($numericArea) ? $numericArea : $area;
        }

        return $area;
    }

    private function sanitizeAssignmentDashboardJson($value)
    {
        if (is_float($value)) {
            return is_finite($value) ? $value : null;
        }

        if (is_array($value)) {
            foreach ($value as $key => $item) {
                $value[$key] = $this->sanitizeAssignmentDashboardJson($item);
            }

            return $value;
        }

        if ($value instanceof \Illuminate\Support\Collection) {
            return $value->map(fn ($item) => $this->sanitizeAssignmentDashboardJson($item));
        }

        if ($value instanceof \JsonSerializable) {
            return $this->sanitizeAssignmentDashboardJson($value->jsonSerialize());
        }

        if (is_object($value)) {
            foreach (get_object_vars($value) as $key => $item) {
                $value->{$key} = $this->sanitizeAssignmentDashboardJson($item);
            }
        }

        return $value;
    }

    private function extractImageCountFromAssignmentComment(?string $comments, string $label): ?int
    {
        if (empty($comments)) {
            return null;
        }

        $pattern = '/\\b' . preg_quote($label, '/') . '\\s*:\\s*(-?\\d+)\\b/i';
        if (!preg_match($pattern, $comments, $matches)) {
            return null;
        }

        return (int) $matches[1];
    }

    /**
     * Map worker role to project table columns.
     * Returns [id_column, done_column, in_progress_state, date_column]
     */
    private static function getWorkerRoleColumns(string $role): array
    {
        return match ($role) {
            'drawer', 'designer' => ['drawer_id', 'drawer_done', 'IN_DRAW', 'drawer_date'],
            'checker'            => ['checker_id', 'checker_done', 'IN_CHECK', 'checker_date'],
            'filler'             => ['file_uploader_id', 'file_uploaded', 'IN_FILLER', 'file_upload_date'],
            'qa'                 => ['qa_id', 'final_upload', 'IN_QA', 'ausFinaldate'],
            default              => [null, null, null, null],
        };
    }
}


