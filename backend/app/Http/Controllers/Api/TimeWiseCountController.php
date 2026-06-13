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

    private function overlayExpression(string $table, string $column, bool $preferNonEmpty = false): string
    {
        $orderColumn = Schema::hasColumn($table, $column) ? "orders.`{$column}`" : 'NULL';
        $crmColumn = Schema::hasColumn('crm_order_assignments', $column) ? "crm.`{$column}`" : 'NULL';

        if ($preferNonEmpty) {
            return "COALESCE(NULLIF(TRIM({$crmColumn}), ''), {$orderColumn})";
        }

        return "COALESCE({$crmColumn}, {$orderColumn})";
    }
}
