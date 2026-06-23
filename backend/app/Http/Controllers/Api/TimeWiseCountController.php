<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Services\ProjectOrderService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Database\QueryException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

class TimeWiseCountController extends Controller
{
    private const REPORT_TIMEZONE = 'Asia/Karachi';

    public function index(Request $request)
    {
        try {
            return $this->generateReport($request);
        } catch (Throwable $exception) {
            Log::error('Time-wise count report failed', [
                'user_id' => $request->user()?->id,
                'parameters' => $request->only(['start_at', 'end_at', 'project_id']),
                'exception' => $exception,
            ]);

            $debug = [
                'exception' => get_class($exception),
                'message' => $exception->getMessage(),
                'code' => $exception->getCode(),
                'file' => $exception->getFile(),
                'line' => $exception->getLine(),
            ];

            if ($exception instanceof QueryException) {
                $debug['sql'] = $exception->getSql();
                $debug['bindings'] = $exception->getBindings();
                $debug['sql_state'] = $exception->errorInfo[0] ?? null;
                $debug['driver_code'] = $exception->errorInfo[1] ?? null;
                $debug['driver_message'] = $exception->errorInfo[2] ?? null;
            }

            return response()->json([
                'message' => 'Time-wise count report failed.',
                'error' => class_basename($exception),
                'debug' => $debug,
            ], 500);
        }
    }

    private function generateReport(Request $request)
    {
        $validated = $request->validate([
            'start_at' => ['required', 'date_format:Y-m-d H:i'],
            'end_at' => ['required', 'date_format:Y-m-d H:i', 'after_or_equal:start_at'],
            'project_id' => ['nullable', 'integer', 'min:1'],
            'status_only' => ['nullable', 'in:true,false,1,0'],
        ]);

        $startAt = Carbon::createFromFormat('Y-m-d H:i', $validated['start_at'], self::REPORT_TIMEZONE)
            ->startOfMinute();
        $endAt = Carbon::createFromFormat('Y-m-d H:i', $validated['end_at'], self::REPORT_TIMEZONE)
            ->endOfMinute();

        if ($startAt->diffInDays($endAt) > 31) {
            return response()->json([
                'message' => 'The selected date-time range cannot exceed 31 days.',
                'errors' => ['end_at' => ['Choose a range of 31 days or less.']],
            ], 422);
        }

        $managedProjectIds = collect($request->user()->getManagedProjectIds())
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        $selectedProjectId = isset($validated['project_id'])
            ? (int) $validated['project_id']
            : null;

        if ($selectedProjectId !== null && !$managedProjectIds->contains($selectedProjectId)) {
            return response()->json(['message' => 'The selected project is not assigned to you.'], 403);
        }

        $projects = Project::query()
            ->where('status', 'active')
            ->whereIn('id', $managedProjectIds)
            ->when($selectedProjectId, fn ($query) => $query->whereKey($selectedProjectId))
            ->orderBy('name')
            ->get(['id', 'code', 'name', 'workflow_type']);

        $statusOnly = filter_var($validated['status_only'] ?? false, FILTER_VALIDATE_BOOLEAN);

        if ($statusOnly) {
            $projectStatuses = collect();
            foreach ($projects as $project) {
                $projectStatuses->push(
                    $this->buildProjectStatus($project, $startAt, $endAt)
                );
            }
            $teamStatuses = $projectStatuses->flatMap(fn (array $project) => $project['team_statuses'] ?? []);

            return response()->json([
                'start_at' => $startAt->format('Y-m-d H:i:s'),
                'end_at' => $endAt->format('Y-m-d H:i:s'),
                'timezone' => self::REPORT_TIMEZONE,
                'projects' => $projects,
                'summary' => [],
                'workers' => [],
                'project_statuses' => $projectStatuses->values(),
                'team_statuses' => $teamStatuses->values(),
                'totals' => [
                    'done' => $projectStatuses->sum('done_orders'),
                    'wip' => 0,
                    'received' => $projectStatuses->sum('received_orders'),
                    'pending' => $projectStatuses->sum('pending_orders'),
                    'delayed' => $projectStatuses->sum('delayed_pending_orders'),
                ],
            ]);
        }

        $roleRows = collect();
        foreach ($projects as $project) {
            $roleRows = $roleRows->concat(
                $this->buildProjectRows($project, $startAt, $endAt)
            );
        }

        $roleOrder = ['drawer' => 1, 'designer' => 2, 'checker' => 3, 'qa' => 4];
        $workers = $roleRows
            ->groupBy(fn (array $row) => $row['role'] . ':' . $row['worker_id'])
            ->map(function (Collection $rows) {
                $first = $rows->first();

                return [
                    'worker_id' => $first['worker_id'],
                    'worker_name' => $first['worker_name'],
                    'role' => $first['role'],
                    'done' => $rows->sum('done'),
                    'wip' => $rows->sum('wip'),
                    'projects' => $rows
                        ->filter(fn (array $row) => $row['done'] > 0 || $row['wip'] > 0)
                        ->map(fn (array $row) => [
                            'project_id' => $row['project_id'],
                            'project_name' => $row['project_name'],
                            'done' => $row['done'],
                            'wip' => $row['wip'],
                        ])
                        ->values(),
                ];
            })
            ->sortBy([
                fn (array $a, array $b) => ($roleOrder[$a['role']] ?? 99) <=> ($roleOrder[$b['role']] ?? 99),
                fn (array $a, array $b) => strcasecmp($a['worker_name'], $b['worker_name']),
            ])
            ->values();

        $summary = collect(array_keys($roleOrder))->map(function (string $role) use ($workers) {
            $roleWorkers = $workers->where('role', $role);

            return [
                'role' => $role,
                'done' => $roleWorkers->sum('done'),
                'wip' => $roleWorkers->sum('wip'),
                'workers' => $roleWorkers->count(),
            ];
        })->values();

        return response()->json([
            'start_at' => $startAt->format('Y-m-d H:i:s'),
            'end_at' => $endAt->format('Y-m-d H:i:s'),
            'timezone' => self::REPORT_TIMEZONE,
            'projects' => $projects,
            'summary' => $summary,
            'workers' => $workers,
            'totals' => [
                'done' => $summary->sum('done'),
                'wip' => $summary->sum('wip'),
            ],
        ]);
    }

    private function buildProjectRows(Project $project, Carbon $startAt, Carbon $endAt): Collection
    {
        $table = ProjectOrderService::getTableName((int) $project->id);
        if (!Schema::hasTable($table)) {
            return collect();
        }

        $roles = $project->workflow_type === 'PH_2_LAYER'
            ? [
                'designer' => ['id' => 'drawer_id', 'name' => 'drawer_name', 'done' => 'drawer_done', 'date' => 'drawer_date', 'offset' => 0],
                'qa' => ['id' => 'qa_id', 'name' => 'qa_name', 'done' => 'final_upload', 'date' => 'ausFinaldate', 'offset' => -6],
            ]
            : [
                'drawer' => ['id' => 'drawer_id', 'name' => 'drawer_name', 'done' => 'drawer_done', 'date' => 'drawer_date', 'offset' => 0],
                'checker' => ['id' => 'checker_id', 'name' => 'checker_name', 'done' => 'checker_done', 'date' => 'checker_date', 'offset' => 0],
                'qa' => ['id' => 'qa_id', 'name' => 'qa_name', 'done' => 'final_upload', 'date' => 'ausFinaldate', 'offset' => -6],
            ];

        return collect($roles)->flatMap(function (array $columns, string $role) use ($project, $table, $startAt, $endAt) {
            $idExpression = $this->overlayExpression($table, $columns['id']);
            $nameExpression = $this->overlayExpression($table, $columns['name'], true);
            $doneExpression = $this->overlayExpression($table, $columns['done'], true);
            $dateExpression = $this->overlayExpression($table, $columns['date']);
            $stateExpression = $this->overlayExpression($table, 'workflow_state', true);
            $normalizedDateExpression = $columns['offset'] === 0
                ? $dateExpression
                : "DATE_ADD({$dateExpression}, INTERVAL {$columns['offset']} HOUR)";
            $doneCondition = "LOWER(TRIM(COALESCE({$doneExpression}, ''))) = 'yes'";
            $activeCondition = "UPPER(TRIM(COALESCE({$stateExpression}, ''))) NOT IN ('DELIVERED', 'CANCELLED')";

            $rows = DB::table("{$table} as orders")
                ->leftJoin('crm_order_assignments as crm', function ($join) use ($project) {
                    $join->on('orders.order_number', '=', 'crm.order_number')
                        ->where('crm.project_id', '=', (int) $project->id);
                })
                ->whereRaw("{$idExpression} IS NOT NULL")
                ->selectRaw("{$idExpression} as worker_id")
                ->selectRaw("COALESCE(MAX(NULLIF(TRIM({$nameExpression}), '')), 'Unknown') as worker_name")
                ->selectRaw(
                    "SUM(CASE WHEN {$doneCondition} AND {$normalizedDateExpression} BETWEEN ? AND ? THEN 1 ELSE 0 END) as done_count",
                    [$startAt->toDateTimeString(), $endAt->toDateTimeString()]
                )
                ->selectRaw("SUM(CASE WHEN NOT ({$doneCondition}) AND {$activeCondition} THEN 1 ELSE 0 END) as wip_count")
                ->groupByRaw($idExpression)
                ->get();

            return $rows
                ->map(fn ($row) => [
                    'worker_id' => (int) $row->worker_id,
                    'worker_name' => $row->worker_name,
                    'role' => $role,
                    'project_id' => (int) $project->id,
                    'project_name' => $project->name,
                    'done' => (int) $row->done_count,
                    'wip' => (int) $row->wip_count,
                ])
                ->filter(fn (array $row) => $row['done'] > 0 || $row['wip'] > 0)
                ->values();
        });
    }

    private function buildProjectStatus(Project $project, Carbon $startAt, Carbon $endAt): array
    {
        $table = ProjectOrderService::getTableName((int) $project->id);
        $empty = [
            'project_id' => (int) $project->id,
            'project_code' => $project->code,
            'project_name' => $project->name,
            'workflow_type' => $project->workflow_type,
            'received_orders' => 0,
            'pending_orders' => 0,
            'delayed_pending_orders' => 0,
            'done_orders' => 0,
            'delayed_done_orders' => 0,
            'untouched_orders' => 0,
            'total_staff' => 0,
            'present_staff' => 0,
            'absent_staff' => 0,
            'online_staff' => 0,
            'team_summary' => [
                'total_teams' => 0,
                'online_teams' => 0,
                'offline_teams' => 0,
                'unassigned' => 0,
            ],
            'team_statuses' => [],
        ];

        $staff = DB::table('users')
            ->where('project_id', (int) $project->id)
            ->where(function ($query) {
                $query->whereNull('inactive_days')
                    ->orWhere('inactive_days', '<=', 10);
            })
            ->selectRaw(
                'COUNT(*) as total_staff,
                 SUM(CASE WHEN is_absent = 0 THEN 1 ELSE 0 END) as present_staff,
                 SUM(CASE WHEN is_absent = 1 THEN 1 ELSE 0 END) as absent_staff,
                 SUM(CASE WHEN is_absent = 0 AND last_activity > ? THEN 1 ELSE 0 END) as online_staff',
                [now()->subMinutes(15)->toDateTimeString()]
            )
            ->first();

        $empty['total_staff'] = (int) ($staff->total_staff ?? 0);
        $empty['present_staff'] = (int) ($staff->present_staff ?? 0);
        $empty['absent_staff'] = (int) ($staff->absent_staff ?? 0);
        $empty['online_staff'] = (int) ($staff->online_staff ?? 0);

        if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'received_at')) {
            return $empty;
        }

        $stateExpression = $this->overlayExpression($table, 'workflow_state', true);
        $activeCondition = "UPPER(TRIM(COALESCE({$stateExpression}, ''))) NOT IN ('DELIVERED', 'CANCELLED')";
        $deliveredCondition = "UPPER(TRIM(COALESCE({$stateExpression}, ''))) = 'DELIVERED'";
        $receivedExpression = 'orders.`received_at`';
        $completionExpression = $this->completionTimestampExpression($table);
        $dueExpression = Schema::hasColumn($table, 'due_in') ? 'orders.`due_in`' : null;
        $assignedExpression = $this->nullableOverlayExpression($table, 'assigned_to');
        $now = now(self::REPORT_TIMEZONE)->toDateTimeString();

        $query = $this->queryWithOptionalCrmOverlay($table, $project)
            ->selectRaw(
                "SUM(CASE WHEN {$receivedExpression} BETWEEN ? AND ? THEN 1 ELSE 0 END) as received_count",
                [$startAt->toDateTimeString(), $endAt->toDateTimeString()]
            )
            ->selectRaw(
                "SUM(CASE WHEN {$activeCondition} AND {$receivedExpression} BETWEEN ? AND ? THEN 1 ELSE 0 END) as pending_count",
                [$startAt->toDateTimeString(), $endAt->toDateTimeString()]
            )
            ;

        if ($assignedExpression !== null) {
            $query->selectRaw(
                "SUM(CASE WHEN {$activeCondition} AND {$receivedExpression} BETWEEN ? AND ? AND ({$assignedExpression} IS NULL OR {$assignedExpression} = 0) THEN 1 ELSE 0 END) as untouched_count",
                [$startAt->toDateTimeString(), $endAt->toDateTimeString()]
            );
        } else {
            $query->selectRaw('0 as untouched_count');
        }

        if ($completionExpression !== null) {
            $query->selectRaw(
                "SUM(CASE WHEN {$deliveredCondition} AND {$completionExpression} BETWEEN ? AND ? THEN 1 ELSE 0 END) as done_count",
                [$startAt->toDateTimeString(), $endAt->toDateTimeString()]
            );
        } else {
            $query->selectRaw('0 as done_count');
        }

        if ($dueExpression !== null) {
            $query->selectRaw(
                "SUM(CASE WHEN {$activeCondition} AND {$receivedExpression} BETWEEN ? AND ? AND {$dueExpression} IS NOT NULL AND {$dueExpression} < ? THEN 1 ELSE 0 END) as delayed_pending_count",
                [$startAt->toDateTimeString(), $endAt->toDateTimeString(), $now]
            );
            if ($completionExpression !== null) {
                $query->selectRaw(
                    "SUM(CASE WHEN {$deliveredCondition} AND {$completionExpression} BETWEEN ? AND ? AND {$dueExpression} IS NOT NULL AND {$completionExpression} > {$dueExpression} THEN 1 ELSE 0 END) as delayed_done_count",
                    [$startAt->toDateTimeString(), $endAt->toDateTimeString()]
                );
            } else {
                $query->selectRaw('0 as delayed_done_count');
            }
        } else {
            $query->selectRaw('0 as delayed_pending_count');
            $query->selectRaw('0 as delayed_done_count');
        }

        $row = $query->first();
        $teamStatuses = $this->buildProjectTeamStatuses($project, $startAt, $endAt);
        $teamSummary = [
            'total_teams' => $teamStatuses->filter(fn (array $team) => $team['team_id'] !== null)->count(),
            'online_teams' => $teamStatuses->filter(fn (array $team) => $team['team_id'] !== null && ($team['is_online'] ?? false))->count(),
            'offline_teams' => $teamStatuses->filter(fn (array $team) => $team['team_id'] !== null && !($team['is_online'] ?? false))->count(),
            'unassigned' => (int) ($teamStatuses->firstWhere('team_id', null)['unassigned_total'] ?? 0),
            'unassigned_drawers' => (int) ($teamStatuses->firstWhere('team_id', null)['unassigned_drawers'] ?? 0),
            'unassigned_checkers' => (int) ($teamStatuses->firstWhere('team_id', null)['unassigned_checkers'] ?? 0),
        ];

        $status = array_merge($empty, [
            'received_orders' => (int) ($row->received_count ?? 0),
            'pending_orders' => (int) ($row->pending_count ?? 0),
            'delayed_pending_orders' => (int) ($row->delayed_pending_count ?? 0),
            'done_orders' => (int) ($row->done_count ?? 0),
            'delayed_done_orders' => (int) ($row->delayed_done_count ?? 0),
            'untouched_orders' => (int) ($row->untouched_count ?? 0),
            'team_summary' => $teamSummary,
            'team_statuses' => $teamStatuses->values()->all(),
        ]);

        if ((int) $project->id === 3) {
            $status['project_3_operations_report'] = $this->buildProjectThreeOperationsReport($project, $table, $startAt);
        }

        return $status;
    }

    private function buildProjectTeamStatuses(Project $project, Carbon $startAt, Carbon $endAt): Collection
    {
        $table = ProjectOrderService::getTableName((int) $project->id);
        if (!Schema::hasTable($table) || !Schema::hasColumn($table, 'received_at')) {
            return collect();
        }

        $teams = DB::table('teams')
            ->where('project_id', (int) $project->id)
            ->where('is_active', true)
            ->get(['id', 'name'])
            ->keyBy('id');

        $onlineCutoff = now()->subMinutes(15);
        $users = DB::table('users')
            ->where('project_id', (int) $project->id)
            ->where(function ($query) {
                $query->whereNull('inactive_days')
                    ->orWhere('inactive_days', '<=', 10);
            })
            ->get(['id', 'name', 'role', 'team_id', 'is_absent', 'last_activity', 'wip_count'])
            ->keyBy('id');

        $userTeamMap = $users
            ->filter(fn ($user) => (int) ($user->team_id ?? 0) > 0)
            ->mapWithKeys(fn ($user) => [(int) $user->id => (int) $user->team_id]);

        $onlineTeamIds = $users
            ->filter(function ($user) use ($onlineCutoff) {
                $role = strtolower(trim((string) ($user->role ?? '')));
                if (
                    !in_array($role, ['drawer', 'checker'], true)
                    || (int) ($user->team_id ?? 0) <= 0
                    || (int) ($user->is_absent ?? 0) === 1
                    || empty($user->last_activity)
                ) {
                    return false;
                }

                try {
                    return Carbon::parse($user->last_activity, self::REPORT_TIMEZONE)->gt($onlineCutoff);
                } catch (Throwable $exception) {
                    return false;
                }
            })
            ->pluck('team_id')
            ->map(fn ($teamId) => (int) $teamId)
            ->unique()
            ->values();

        $unassignedDrawers = $users
            ->filter(fn ($user) => strtolower(trim((string) ($user->role ?? ''))) === 'drawer' && (int) ($user->team_id ?? 0) <= 0)
            ->count();
        $unassignedCheckers = $users
            ->filter(fn ($user) => strtolower(trim((string) ($user->role ?? ''))) === 'checker' && (int) ($user->team_id ?? 0) <= 0)
            ->count();

        $teamRows = $teams
            ->mapWithKeys(fn ($team) => [
                (int) $team->id => [
                    'project_id' => (int) $project->id,
                    'project_name' => $project->name,
                    'team_id' => (int) $team->id,
                    'team_name' => $team->name,
                    'is_online' => $onlineTeamIds->contains((int) $team->id),
                    'received' => 0,
                    'done' => 0,
                    'pending' => 0,
                    'delayed' => 0,
                    'drawers' => [],
                    'checkers' => [],
                ],
            ])
            ->all();

        $teamRows[0] = [
            'project_id' => (int) $project->id,
            'project_name' => $project->name,
            'team_id' => null,
            'team_name' => 'Unassigned Team',
            'is_online' => false,
            'received' => 0,
            'done' => 0,
            'pending' => 0,
            'delayed' => 0,
            'drawers' => [],
            'checkers' => [],
            'unassigned_drawers' => $unassignedDrawers,
            'unassigned_checkers' => $unassignedCheckers,
            'unassigned_total' => $unassignedDrawers + $unassignedCheckers,
        ];

        foreach ($users as $user) {
            $role = strtolower(trim((string) ($user->role ?? '')));
            if (!in_array($role, ['drawer', 'checker'], true)) {
                continue;
            }

            $teamId = (int) ($user->team_id ?? 0);
            if (!isset($teamRows[$teamId])) {
                $teamRows[$teamId] = [
                    'project_id' => (int) $project->id,
                    'project_name' => $project->name,
                    'team_id' => $teamId > 0 ? $teamId : null,
                    'team_name' => $teamId > 0 ? ($teams->get($teamId)?->name ?? 'Unknown Team') : 'Unassigned Team',
                    'is_online' => $teamId > 0 && $onlineTeamIds->contains($teamId),
                    'received' => 0,
                    'done' => 0,
                    'pending' => 0,
                    'delayed' => 0,
                    'drawers' => [],
                    'checkers' => [],
                ];
            }

            $memberKey = $role === 'checker' ? 'checkers' : 'drawers';
            $teamRows[$teamId][$memberKey][(int) $user->id] = [
                'id' => (int) $user->id,
                'name' => $user->name,
                'role' => $role,
                'is_online' => $this->isUserOnline($user, $onlineCutoff),
                'total_assigned' => 0,
                'total_done' => 0,
                'wip' => (int) ($user->wip_count ?? 0),
                'selected_wip' => 0,
            ];
        }

        $stateExpression = $this->overlayExpression($table, 'workflow_state', true);
        $completionExpression = $this->completionTimestampExpression($table);
        $query = $this->queryWithOptionalCrmOverlay($table, $project)
            ->selectRaw('orders.`id` as id')
            ->selectRaw('orders.`received_at` as received_at')
            ->selectRaw('NULL as team_id')
            ->selectRaw("{$stateExpression} as resolved_workflow_state");

        foreach ([
            'drawer_id',
            'checker_id',
            'qa_id',
            'file_uploader_id',
            'assigned_to',
            'due_in',
            'drawer_done',
            'checker_done',
            'drawer_date',
            'checker_date',
        ] as $column) {
            if (Schema::hasColumn($table, $column)) {
                $query->selectRaw("orders.`{$column}` as {$column}");
            }
        }

        if ($completionExpression !== null) {
            $query->selectRaw("{$completionExpression} as completed_time")
                ->where(function ($filter) use ($startAt, $endAt, $completionExpression) {
                    $filter->whereBetween('orders.received_at', [$startAt->toDateTimeString(), $endAt->toDateTimeString()])
                        ->orWhereBetween(DB::raw($completionExpression), [$startAt->toDateTimeString(), $endAt->toDateTimeString()]);
                });
        } else {
            $query->selectRaw('NULL as completed_time')
                ->whereBetween('orders.received_at', [$startAt->toDateTimeString(), $endAt->toDateTimeString()]);
        }

        $now = now(self::REPORT_TIMEZONE);

        foreach ($query->get() as $order) {
            $teamId = $this->resolveOrderTeamId($order, $userTeamMap);
            if (!isset($teamRows[$teamId])) {
                $teamRows[$teamId] = [
                    'project_id' => (int) $project->id,
                    'project_name' => $project->name,
                    'team_id' => $teamId > 0 ? $teamId : null,
                    'team_name' => $teamId > 0 ? ($teams->get($teamId)?->name ?? 'Unknown Team') : 'Unassigned Team',
                    'is_online' => $teamId > 0 && $onlineTeamIds->contains($teamId),
                    'received' => 0,
                    'done' => 0,
                    'pending' => 0,
                    'delayed' => 0,
                ];
            }

            $state = strtoupper(trim((string) ($order->resolved_workflow_state ?? '')));
            $isActive = !in_array($state, ['DELIVERED', 'CANCELLED'], true);
            $isDelivered = $state === 'DELIVERED';
            $receivedInRange = $this->timestampInRange($order->received_at ?? null, $startAt, $endAt);
            $completedInRange = $this->timestampInRange($order->completed_time ?? null, $startAt, $endAt);

            if ($receivedInRange) {
                $teamRows[$teamId]['received']++;
            }

            if ($receivedInRange && $isActive) {
                $teamRows[$teamId]['pending']++;
                if (!empty($order->due_in) && $this->timestampBefore($order->due_in, $now)) {
                    $teamRows[$teamId]['delayed']++;
                }
            }

            if ($completedInRange && $isDelivered) {
                $teamRows[$teamId]['done']++;
            }

            $this->countTeamMemberWork($teamRows, $teamId, $order, $users, 'drawer_id', 'drawers', 'drawer_done', 'drawer_date', $receivedInRange, $isActive, $startAt, $endAt);
            $this->countTeamMemberWork($teamRows, $teamId, $order, $users, 'checker_id', 'checkers', 'checker_done', 'checker_date', $receivedInRange, $isActive, $startAt, $endAt);
        }

        foreach ($teamRows as &$teamRow) {
            $teamRow['drawers'] = collect($teamRow['drawers'])
                ->sortByDesc('total_done')
                ->sortByDesc('total_assigned')
                ->values()
                ->all();
            $teamRow['checkers'] = collect($teamRow['checkers'])
                ->sortByDesc('total_done')
                ->sortByDesc('total_assigned')
                ->values()
                ->all();
        }
        unset($teamRow);

        return collect($teamRows)
            ->filter(fn (array $row) => $row['team_id'] !== null || $row['received'] > 0 || $row['done'] > 0 || $row['pending'] > 0 || $row['delayed'] > 0)
            ->sortBy([
                fn (array $a, array $b) => strcasecmp($a['project_name'], $b['project_name']),
                fn (array $a, array $b) => ($a['team_id'] === null ? 1 : 0) <=> ($b['team_id'] === null ? 1 : 0),
                fn (array $a, array $b) => strcasecmp($a['team_name'], $b['team_name']),
            ])
            ->values();
    }

    private function countTeamMemberWork(
        array &$teamRows,
        int $teamId,
        object $order,
        Collection $users,
        string $idColumn,
        string $memberKey,
        string $doneColumn,
        string $doneDateColumn,
        bool $receivedInRange,
        bool $isActive,
        Carbon $startAt,
        Carbon $endAt
    ): void {
        $userId = (int) ($order->{$idColumn} ?? 0);
        if ($userId <= 0) {
            return;
        }

        $user = $users->get($userId);
        if (!isset($teamRows[$teamId][$memberKey][$userId])) {
            $teamRows[$teamId][$memberKey][$userId] = [
                'id' => $userId,
                'name' => $user?->name ?? "User #{$userId}",
                'role' => $memberKey === 'checkers' ? 'checker' : 'drawer',
                'is_online' => $user ? $this->isUserOnline($user, now()->subMinutes(15)) : false,
                'total_assigned' => 0,
                'total_done' => 0,
                'wip' => (int) ($user?->wip_count ?? 0),
                'selected_wip' => 0,
            ];
        }

        if ($receivedInRange) {
            $teamRows[$teamId][$memberKey][$userId]['total_assigned']++;
        }

        if ($receivedInRange && $isActive) {
            $teamRows[$teamId][$memberKey][$userId]['selected_wip']++;
        }

        $doneAt = $order->{$doneDateColumn} ?? null;
        $isDone = strtolower(trim((string) ($order->{$doneColumn} ?? ''))) === 'yes';
        if ($isDone && $this->timestampInRange($doneAt, $startAt, $endAt)) {
            $teamRows[$teamId][$memberKey][$userId]['total_done']++;
        }
    }

    private function isUserOnline(object $user, Carbon $onlineCutoff): bool
    {
        if ((int) ($user->is_absent ?? 0) === 1 || empty($user->last_activity)) {
            return false;
        }

        try {
            return Carbon::parse($user->last_activity, self::REPORT_TIMEZONE)->gt($onlineCutoff);
        } catch (Throwable $exception) {
            return false;
        }
    }

    private function resolveOrderTeamId(object $order, Collection $userTeamMap): int
    {
        if ((int) ($order->team_id ?? 0) > 0) {
            return (int) $order->team_id;
        }

        foreach (['drawer_id', 'checker_id', 'qa_id', 'file_uploader_id', 'assigned_to'] as $column) {
            $userId = (int) ($order->{$column} ?? 0);
            if ($userId > 0 && $userTeamMap->has($userId)) {
                return (int) $userTeamMap->get($userId);
            }
        }

        return 0;
    }

    private function timestampInRange(?string $value, Carbon $startAt, Carbon $endAt): bool
    {
        if (empty($value)) {
            return false;
        }

        try {
            $timestamp = Carbon::parse($value, self::REPORT_TIMEZONE);
        } catch (Throwable $exception) {
            return false;
        }

        return $timestamp->betweenIncluded($startAt, $endAt);
    }

    private function timestampBefore(?string $value, Carbon $before): bool
    {
        if (empty($value)) {
            return false;
        }

        try {
            return Carbon::parse($value, self::REPORT_TIMEZONE)->lt($before);
        } catch (Throwable $exception) {
            return false;
        }
    }

    private function buildProjectThreeOperationsReport(Project $project, string $table, Carbon $date): array
    {
        return [
            'project_name' => $project->name,
            'generated_at' => now(self::REPORT_TIMEZONE)->toDateTimeString(),
            'hourly_done' => $this->buildProjectThreeHourlyDoneReport($table, $date),
            'last_10_days_pending' => $this->buildProjectThreePendingDateReport($table, $date),
            'previous_pending_summary' => $this->buildProjectThreePreviousPendingSummary($table, $date),
        ];
    }

    private function buildProjectThreeHourlyDoneReport(string $table, Carbon $date): array
    {
        $completionExpression = $this->completionTimestampExpression($table);
        if ($completionExpression === null) {
            return [];
        }

        $rangeStart = $date->copy()->startOfDay();
        $rangeEnd = $date->copy()->addDay()->startOfDay();
        $rows = DB::table("{$table} as orders")
            ->whereNotNull(DB::raw($completionExpression))
            ->whereBetween(DB::raw($completionExpression), [
                $rangeStart->toDateTimeString(),
                $rangeEnd->toDateTimeString(),
            ])
            ->selectRaw("{$completionExpression} as completed_time")
            ->get();

        $slots = [];
        for ($slotStart = $rangeStart->copy(); $slotStart->lt($rangeEnd); $slotStart->addHours(2)) {
            $slotEnd = $slotStart->copy()->addHours(2);
            $doneCount = $rows->filter(function ($row) use ($slotStart, $slotEnd) {
                try {
                    $completedAt = Carbon::parse($row->completed_time, self::REPORT_TIMEZONE);
                } catch (Throwable $exception) {
                    return false;
                }

                return $completedAt->gte($slotStart) && $completedAt->lt($slotEnd);
            })->count();

            $slots[] = [
                'label' => strtolower($slotStart->format('ha')) . ' to ' . strtolower($slotEnd->format('ha')),
                'start_at' => $slotStart->toDateTimeString(),
                'end_at' => $slotEnd->toDateTimeString(),
                'done_orders' => $doneCount,
            ];
        }

        return $slots;
    }

    private function buildProjectThreePendingDateReport(string $table, Carbon $date): array
    {
        if (!Schema::hasColumn($table, 'received_at')) {
            return [];
        }

        $rangeStart = $date->copy()->subDays(9)->startOfDay();
        $rangeEnd = $date->copy()->endOfDay();
        $hasDueIn = Schema::hasColumn($table, 'due_in');
        $now = now(self::REPORT_TIMEZONE)->toDateTimeString();

        $query = DB::table($table)
            ->whereBetween('received_at', [
                $rangeStart->toDateTimeString(),
                $rangeEnd->toDateTimeString(),
            ])
            ->selectRaw('DATE(received_at) as received_date, COUNT(*) as total_count')
            ->selectRaw(
                "SUM(CASE WHEN workflow_state NOT IN ('PENDING_BY_DRAWER', 'REJECTED_BY_CHECK', 'REJECTED BY CHECK', 'COMPLETED', 'DELIVERED', 'CANCELLED') THEN 1 ELSE 0 END) as pending_count"
            )
            ->selectRaw(
                "SUM(CASE WHEN workflow_state IN ('COMPLETED', 'DELIVERED') THEN 1 ELSE 0 END) as done_count"
            );

        if ($hasDueIn) {
            $query->selectRaw(
                "SUM(CASE WHEN workflow_state NOT IN ('PENDING_BY_DRAWER', 'REJECTED_BY_CHECK', 'REJECTED BY CHECK', 'COMPLETED', 'DELIVERED', 'CANCELLED') AND due_in IS NOT NULL AND due_in < ? THEN 1 ELSE 0 END) as delayed_count",
                [$now]
            );
        } else {
            $query->selectRaw('0 as delayed_count');
        }

        return $query
            ->groupBy('received_date')
            ->orderBy('received_date')
            ->get()
            ->filter(fn ($row) => (int) $row->pending_count > 0)
            ->map(function ($row) {
                $receivedDate = Carbon::parse($row->received_date, self::REPORT_TIMEZONE);

                return [
                    'date' => $receivedDate->toDateString(),
                    'day_label' => $receivedDate->format('d M'),
                    'total_orders' => (int) ($row->total_count ?? 0),
                    'pending_orders' => (int) ($row->pending_count ?? 0),
                    'done_orders' => (int) ($row->done_count ?? 0),
                    'delayed_orders' => (int) ($row->delayed_count ?? 0),
                ];
            })
            ->values()
            ->all();
    }

    private function buildProjectThreePreviousPendingSummary(string $table, Carbon $date): array
    {
        if (!Schema::hasColumn($table, 'received_at')) {
            return [
                'date' => null,
                'day_label' => null,
                'total_orders' => 0,
                'pending_orders' => 0,
                'done_orders' => 0,
                'delayed_orders' => 0,
            ];
        }

        $previousDate = $date->copy()->subDay();
        $hasDueIn = Schema::hasColumn($table, 'due_in');
        $now = now(self::REPORT_TIMEZONE)->toDateTimeString();
        $query = DB::table($table)
            ->whereBetween('received_at', [
                $previousDate->copy()->startOfDay()->toDateTimeString(),
                $previousDate->copy()->endOfDay()->toDateTimeString(),
            ])
            ->selectRaw('COUNT(*) as total_orders')
            ->selectRaw(
                "SUM(CASE WHEN workflow_state NOT IN ('PENDING_BY_DRAWER', 'REJECTED_BY_CHECK', 'REJECTED BY CHECK', 'COMPLETED', 'DELIVERED', 'CANCELLED') THEN 1 ELSE 0 END) as pending_orders"
            )
            ->selectRaw(
                "SUM(CASE WHEN workflow_state IN ('COMPLETED', 'DELIVERED') THEN 1 ELSE 0 END) as done_orders"
            );

        if ($hasDueIn) {
            $query->selectRaw(
                "SUM(CASE WHEN workflow_state NOT IN ('PENDING_BY_DRAWER', 'REJECTED_BY_CHECK', 'REJECTED BY CHECK', 'COMPLETED', 'DELIVERED', 'CANCELLED') AND due_in IS NOT NULL AND due_in < ? THEN 1 ELSE 0 END) as delayed_orders",
                [$now]
            );
        } else {
            $query->selectRaw('0 as delayed_orders');
        }

        $row = $query->first();

        return [
            'date' => $previousDate->toDateString(),
            'day_label' => $previousDate->format('d M'),
            'total_orders' => (int) ($row->total_orders ?? 0),
            'pending_orders' => (int) ($row->pending_orders ?? 0),
            'done_orders' => (int) ($row->done_orders ?? 0),
            'delayed_orders' => (int) ($row->delayed_orders ?? 0),
        ];
    }

    private function overlayExpression(string $table, string $column, bool $preferNonEmpty = false): string
    {
        $orderColumn = Schema::hasColumn($table, $column) ? "orders.`{$column}`" : 'NULL';
        $crmColumn = $this->canUseCrmOverlay($table) && Schema::hasColumn('crm_order_assignments', $column)
            ? "crm.`{$column}`"
            : 'NULL';

        if ($preferNonEmpty) {
            return "COALESCE(NULLIF(TRIM({$crmColumn}), ''), {$orderColumn})";
        }

        return "COALESCE({$crmColumn}, {$orderColumn})";
    }

    private function nullableOverlayExpression(string $table, string $column, bool $preferNonEmpty = false): ?string
    {
        $hasOrderColumn = Schema::hasColumn($table, $column);
        $hasCrmColumn = $this->canUseCrmOverlay($table) && Schema::hasColumn('crm_order_assignments', $column);

        if (!$hasOrderColumn && !$hasCrmColumn) {
            return null;
        }

        return $this->overlayExpression($table, $column, $preferNonEmpty);
    }

    private function canUseCrmOverlay(string $table): bool
    {
        return Schema::hasTable('crm_order_assignments')
            && Schema::hasColumn($table, 'order_number')
            && Schema::hasColumn('crm_order_assignments', 'order_number')
            && Schema::hasColumn('crm_order_assignments', 'project_id');
    }

    private function queryWithOptionalCrmOverlay(string $table, Project $project)
    {
        $query = DB::table("{$table} as orders");

        if ($this->canUseCrmOverlay($table)) {
            $query->leftJoin('crm_order_assignments as crm', function ($join) use ($project) {
                $join->on('orders.order_number', '=', 'crm.order_number')
                    ->where('crm.project_id', '=', (int) $project->id);
            });
        }

        return $query;
    }

    private function completionTimestampExpression(string $table): ?string
    {
        $hasDeliveredAt = Schema::hasColumn($table, 'delivered_at');
        $hasCompletedAt = Schema::hasColumn($table, 'completed_at');
        $hasAusFinalDate = Schema::hasColumn($table, 'ausFinaldate');

        if ($hasDeliveredAt && $hasCompletedAt) {
            return 'COALESCE(orders.`delivered_at`, orders.`completed_at`)';
        }

        if ($hasDeliveredAt) {
            return 'orders.`delivered_at`';
        }

        if ($hasCompletedAt) {
            return 'orders.`completed_at`';
        }

        if ($hasAusFinalDate) {
            return 'DATE_ADD(orders.`ausFinaldate`, INTERVAL -6 HOUR)';
        }

        return null;
    }
}
