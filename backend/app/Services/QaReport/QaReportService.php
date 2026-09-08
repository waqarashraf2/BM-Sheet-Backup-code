<?php

namespace App\Services\QaReport;

use App\Models\Project;
use App\Models\WorkItem;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class QaReportService
{
    /**
     * Generate QA Report for a given project.
     */
    public function generateReport(int $projectId, Request $request): array
    {
        $startDate = $request->query('start_date');
        $endDate = $request->query('end_date');

        if ($startDate && $endDate) {
            $startDateStr = Carbon::parse((string) $startDate, 'Asia/Karachi')->toDateString();
            $endDateStr = Carbon::parse((string) $endDate, 'Asia/Karachi')->toDateString();
            $date = $startDateStr;
            $shiftStartPkt = Carbon::parse($startDateStr, 'Asia/Karachi')->subDay()->setTime(22, 0, 0);
            $shiftEndPkt = Carbon::parse($endDateStr, 'Asia/Karachi')->setTime(22, 0, 0);
            $isRange = ($startDateStr !== $endDateStr);
            $displayDate = $isRange
                ? Carbon::parse($startDateStr, 'Asia/Karachi')->format('d-M') . ' TO ' . Carbon::parse($endDateStr, 'Asia/Karachi')->format('d-M')
                : Carbon::parse($startDateStr, 'Asia/Karachi')->format('d-M');
        } else {
            $date = $this->selectedDate($request);
            [$shiftStartPkt, $shiftEndPkt] = $this->shiftBounds($date);
            $displayDate = Carbon::parse($date, 'Asia/Karachi')->format('d-M');
        }

        $shiftStartUtc = $shiftStartPkt->copy()->utc();
        $shiftEndUtc = $shiftEndPkt->copy()->utc();

        $tableName = "project_{$projectId}_orders";
        $shiftOrderIds = [];

        if (Schema::hasTable($tableName)) {
            $dateCol = Schema::hasColumn($tableName, 'received_at') ? 'received_at' : (Schema::hasColumn($tableName, 'created_at') ? 'created_at' : null);
            if ($dateCol) {
                $shiftOrderIds = DB::table($tableName)
                    ->where($dateCol, '>=', $shiftStartPkt->format('Y-m-d H:i:s'))
                    ->where($dateCol, '<', $shiftEndPkt->format('Y-m-d H:i:s'))
                    ->pluck('id')
                    ->all();
            }
        }

        $workItemsQuery = WorkItem::query()
            ->with('assignedUser:id,name')
            ->where('project_id', $projectId)
            ->where('stage', 'QA')
            ->where('status', 'completed');

        if (!empty($shiftOrderIds)) {
            $workItemsQuery->where(function ($q) use ($shiftOrderIds, $shiftStartUtc, $shiftEndUtc) {
                $q->whereIn('order_id', $shiftOrderIds)
                  ->orWhereBetween('completed_at', [$shiftStartUtc, $shiftEndUtc]);
            });
        } else {
            // If no received_at order IDs matched, query by QA completed_at
            $workItemsQuery->whereBetween('completed_at', [$shiftStartUtc, $shiftEndUtc]);
        }

        $workItems = $workItemsQuery->orderBy('completed_at', 'desc')
            ->get()
            ->unique('order_id')
            ->reverse()
            ->values();

        $orderIds = $workItems->pluck('order_id')->filter()->unique()->values()->all();
        $orderRows = $this->projectOrderRows($projectId, $orderIds);

        // Resolve Parser
        $parser = QaParserFactory::getParser($projectId);
        $columnsMap = $parser->getColumns(); // ['col_key' => 'Col Label']
        $columnKeys = array_keys($columnsMap);

        $rowsByChecker = [];
        $qaCounts = [];

        foreach ($workItems as $item) {
            $order = $orderRows[(int) $item->order_id] ?? null;
            $checkerName = trim((string) ($order->checker_name ?? ''));
            if ($checkerName === '') {
                $checkerName = 'Unassigned Checker';
            }

            $qaName = trim((string) ($item->assignedUser->name ?? ''));
            if ($qaName === '') {
                $qaName = 'Unknown QA';
            }

            $parsed = $parser->parse((string) ($item->comments ?? ''));

            if (!isset($rowsByChecker[$checkerName])) {
                $initialColumns = array_fill_keys($columnKeys, 0);
                $rowsByChecker[$checkerName] = [
                    'checker_name'     => $checkerName,
                    'total_plans'      => 0,
                    'columns'          => $initialColumns,
                    'mistake_plans'    => 0,
                    'ok_plans'         => 0,
                    'mistakes_remarks' => [],
                ];
            }

            $rowsByChecker[$checkerName]['total_plans']++;

            $hasAnyMistake = false;
            foreach ($columnKeys as $key) {
                $cnt = $parsed['column_mistakes'][$key] ?? 0;
                if ($cnt > 0) {
                    $rowsByChecker[$checkerName]['columns'][$key] += $cnt;
                    $hasAnyMistake = true;
                }
            }

            if ($hasAnyMistake) {
                $rowsByChecker[$checkerName]['mistake_plans']++;
            } else {
                $rowsByChecker[$checkerName]['ok_plans']++;
            }

            foreach ($parsed['remarks'] as $remark) {
                $rowsByChecker[$checkerName]['mistakes_remarks'][] = $remark;
            }

            $qaCounts[$qaName] = ($qaCounts[$qaName] ?? 0) + 1;
        }

        $rows = collect($rowsByChecker)
            ->map(function (array $row) {
                $row['mistakes_remarks'] = implode('. ', array_values(array_unique(array_filter($row['mistakes_remarks']))));
                return $row;
            })
            ->sortBy('checker_name', SORT_NATURAL | SORT_FLAG_CASE)
            ->values();

        // Calculate Totals across all checkers
        $totalPlans = (int) $rows->sum('total_plans');
        $totalMistakePlans = (int) $rows->sum('mistake_plans');
        $totalOkPlans = (int) $rows->sum('ok_plans');

        $columnTotals = [];
        $columnPercentages = [];

        foreach ($columnKeys as $colKey) {
            $sumCol = (int) $rows->sum(fn ($r) => $r['columns'][$colKey] ?? 0);
            $columnTotals[$colKey] = $sumCol;
            $columnPercentages[$colKey] = $totalPlans > 0 ? round(($sumCol / $totalPlans) * 100, 1) : 0.0;
        }

        $totals = [
            'total_plans'   => $totalPlans,
            'mistake_plans' => $totalMistakePlans,
            'ok_plans'      => $totalOkPlans,
            'columns'       => $columnTotals,
        ];

        $percentages = [
            'total_plans'   => $totalPlans > 0 ? 100.0 : 0.0,
            'mistake_plans' => $totalPlans > 0 ? round(($totalMistakePlans / $totalPlans) * 100, 1) : 0.0,
            'ok_plans'      => $totalPlans > 0 ? round(($totalOkPlans / $totalPlans) * 100, 1) : 0.0,
            'columns'       => $columnPercentages,
        ];

        // Resolve Project Name
        $projectName = $this->resolveProjectName($projectId);

        return [
            'success'               => true,
            'project_id'            => $projectId,
            'project_name'          => $projectName,
            'column_definitions'    => $columnsMap, // key => label
            'selected_date'         => $date,
            'selected_date_display' => $displayDate,
            'start_time'            => $shiftStartPkt->format('Y-m-d H:i:s'),
            'end_time'              => $shiftEndPkt->format('Y-m-d H:i:s'),
            'rows'                  => $rows,
            'totals'                => $totals,
            'percentages'           => $percentages,
            'upload_summary'        => $this->uploadSummary($projectId, $shiftStartPkt, $shiftEndPkt),
            'qa_counts'             => collect($qaCounts)
                ->map(fn ($count, $name) => ['name' => $name, 'count' => (int) $count])
                ->sortByDesc('count')
                ->values(),
        ];
    }

    private function selectedDate(Request $request): string
    {
        if ($request->query('date')) {
            return Carbon::parse((string) $request->query('date'), 'Asia/Karachi')->toDateString();
        }

        $now = now('Asia/Karachi');
        return $now->hour >= 22
            ? $now->copy()->addDay()->toDateString()
            : $now->toDateString();
    }

    private function shiftBounds(string $date): array
    {
        $selectedDate = Carbon::parse($date, 'Asia/Karachi');

        return [
            $selectedDate->copy()->subDay()->setTime(22, 0, 0),
            $selectedDate->copy()->setTime(22, 0, 0),
        ];
    }

    private function projectOrderRows(int $projectId, array $orderIds): array
    {
        $table = "project_{$projectId}_orders";
        if (
            empty($orderIds)
            || !Schema::hasTable($table)
            || !Schema::hasColumn($table, 'checker_name')
        ) {
            return [];
        }

        return DB::table($table)
            ->whereIn('id', $orderIds)
            ->get(['id', 'checker_name'])
            ->keyBy('id')
            ->all();
    }

    private function uploadSummary(int $projectId, Carbon $shiftStartPkt, Carbon $shiftEndPkt): array
    {
        $table = "project_{$projectId}_orders";
        if (!Schema::hasTable($table)) {
            return ['date' => $shiftEndPkt->format('j-M'), 'total_plans' => 0, 'upload' => 0, 'pending' => 0];
        }

        $dateCol = Schema::hasColumn($table, 'received_at') ? 'received_at' : (Schema::hasColumn($table, 'created_at') ? 'created_at' : null);

        $query = DB::table($table);
        if ($dateCol) {
            $query->where($dateCol, '>=', $shiftStartPkt->format('Y-m-d H:i:s'))
                  ->where($dateCol, '<', $shiftEndPkt->format('Y-m-d H:i:s'));
        }

        $total = (clone $query)->count();
        $upload = 0;
        if (Schema::hasColumn($table, 'final_upload')) {
            $upload = (clone $query)->where('final_upload', 'yes')->count();
        } elseif (Schema::hasColumn($table, 'status')) {
            $upload = (clone $query)->where('status', 'completed')->count();
        }

        return [
            'date'        => $shiftEndPkt->format('j-M'),
            'total_plans' => (int) $total,
            'upload'      => (int) $upload,
            'pending'     => max(0, (int) $total - (int) $upload),
        ];
    }

    private function resolveProjectName(int $projectId): string
    {
        $project = Project::find($projectId);
        if ($project && !empty($project->name)) {
            return $project->name;
        }

        return match ($projectId) {
            13 => 'Metro FP',
            15 => 'Roomio FP',
            16 => 'Cubi 2D',
            default => "Project {$projectId}",
        };
    }
}
