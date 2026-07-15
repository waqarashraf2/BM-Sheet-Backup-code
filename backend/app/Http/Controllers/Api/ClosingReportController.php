<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ClosingReportRemark;
use App\Models\Project;
use App\Services\ProjectOrderService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;

class ClosingReportController extends Controller
{
    public function index(Request $request)
    {
        $user = $request->user();
        $validated = $request->validate([
            'date' => ['nullable', 'date'],
            'country' => ['nullable', 'string', 'max:50'],
        ]);

        $timezone = config('app.timezone', 'Asia/Karachi');
        $reportDate = Carbon::parse($validated['date'] ?? now($timezone)->toDateString(), $timezone)->startOfDay();
        $rangeStart = $reportDate->copy()->startOfDay()->toDateTimeString();
        $rangeEnd = $reportDate->copy()->addDay()->startOfDay()->toDateTimeString();

        $projectIds = $this->visibleProjectIds($user);
        if (empty($projectIds)) {
            return response()->json([
                'date' => $reportDate->toDateString(),
                'timezone' => $timezone,
                'countries' => [],
                'totals' => $this->emptyTotals(),
            ]);
        }

        $projects = Project::query()
            ->whereIn('id', $projectIds)
            ->where('status', 'active')
            ->when(!empty($validated['country']), fn ($query) => $query->where('country', $validated['country']))
            ->orderBy('country')
            ->orderBy('name')
            ->get(['id', 'code', 'name', 'country', 'department', 'workflow_type']);

        $remarks = Schema::hasTable('closing_report_remarks')
            ? ClosingReportRemark::query()
                ->whereDate('report_date', $reportDate->toDateString())
                ->whereIn('project_id', $projects->pluck('id'))
                ->get()
                ->keyBy('project_id')
            : collect();

        $rows = $projects->map(function (Project $project) use ($rangeStart, $rangeEnd, $remarks) {
            $counts = $this->projectCounts((int) $project->id, $rangeStart, $rangeEnd);
            $remark = $remarks->get($project->id);

            return [
                'project_id' => (int) $project->id,
                'project_code' => $project->code,
                'project_name' => $project->name,
                'country' => $project->country,
                'department' => $project->department,
                'workflow_type' => $project->workflow_type,
                'total_orders' => $counts['total_orders'],
                'uploaded_orders' => $counts['uploaded_orders'],
                'pending_orders' => max(0, $counts['total_orders'] - $counts['uploaded_orders']),
                'remarks' => $remark?->remarks ?? '',
                'remarks_updated_at' => $remark?->updated_at?->toDateTimeString(),
                'remarks_updated_by' => $remark?->updated_by,
            ];
        });

        $countries = $rows
            ->groupBy('country')
            ->map(function ($countryRows, string $country) {
                return [
                    'country' => $country,
                    'project_count' => $countryRows->count(),
                    'total_orders' => (int) $countryRows->sum('total_orders'),
                    'uploaded_orders' => (int) $countryRows->sum('uploaded_orders'),
                    'pending_orders' => (int) $countryRows->sum('pending_orders'),
                    'projects' => $countryRows->values(),
                ];
            })
            ->values();

        return response()->json([
            'date' => $reportDate->toDateString(),
            'timezone' => $timezone,
            'countries' => $countries,
            'totals' => [
                'project_count' => $rows->count(),
                'total_orders' => (int) $rows->sum('total_orders'),
                'uploaded_orders' => (int) $rows->sum('uploaded_orders'),
                'pending_orders' => (int) $rows->sum('pending_orders'),
            ],
        ]);
    }

    public function saveRemark(Request $request)
    {
        $user = $request->user();
        $validated = $request->validate([
            'date' => ['required', 'date'],
            'project_id' => ['required', 'integer', Rule::exists('projects', 'id')],
            'country' => ['required', 'string', 'max:50'],
            'remarks' => ['nullable', 'string', 'max:2000'],
        ]);

        if (!Schema::hasTable('closing_report_remarks')) {
            return response()->json([
                'message' => 'Closing report remarks table is not created yet. Please run database/sql/create_closing_report_remarks.sql first.',
            ], 503);
        }

        $projectId = (int) $validated['project_id'];
        if (!in_array($projectId, $this->visibleProjectIds($user), true)) {
            return response()->json(['message' => 'You can only update remarks for your assigned projects.'], 403);
        }

        $project = Project::query()->findOrFail($projectId);
        if ($project->country !== $validated['country']) {
            return response()->json(['message' => 'Project country does not match the selected report row.'], 422);
        }

        $reportDate = Carbon::parse($validated['date'])->toDateString();
        $remark = ClosingReportRemark::query()->firstOrNew([
            'report_date' => $reportDate,
            'country' => $project->country,
            'project_id' => $projectId,
        ]);

        if (!$remark->exists) {
            $remark->created_by = $user->id;
        }

        $remark->remarks = trim((string) ($validated['remarks'] ?? ''));
        $remark->updated_by = $user->id;
        $remark->save();

        return response()->json([
            'message' => 'Closing report remarks saved.',
            'remark' => [
                'project_id' => (int) $remark->project_id,
                'country' => $remark->country,
                'report_date' => $remark->report_date->toDateString(),
                'remarks' => $remark->remarks ?? '',
                'updated_at' => $remark->updated_at?->toDateTimeString(),
                'updated_by' => $remark->updated_by,
            ],
        ]);
    }

    private function visibleProjectIds($user): array
    {
        if (in_array($user->role, ['operations_manager', 'project_manager'], true)) {
            return array_map('intval', $user->getManagedProjectIds());
        }

        return [];
    }

    private function projectCounts(int $projectId, string $rangeStart, string $rangeEnd): array
    {
        $tableName = ProjectOrderService::getTableName($projectId);
        if (!Schema::hasTable($tableName)) {
            return $this->emptyCounts();
        }
        if (!Schema::hasColumn($tableName, 'received_at')) {
            return $this->emptyCounts();
        }

        $uploadedChecks = [];
        if (Schema::hasColumn($tableName, 'workflow_state')) {
            $uploadedChecks[] = "workflow_state IN ('COMPLETED', 'DELIVERED', 'APPROVED_QA')";
        }
        if (Schema::hasColumn($tableName, 'delivered_at')) {
            $uploadedChecks[] = 'delivered_at IS NOT NULL';
        }
        if (Schema::hasColumn($tableName, 'completed_at')) {
            $uploadedChecks[] = 'completed_at IS NOT NULL';
        }
        if (Schema::hasColumn($tableName, 'final_upload')) {
            $uploadedChecks[] = "(final_upload IS NOT NULL AND final_upload <> '')";
        }

        $uploadedCondition = empty($uploadedChecks) ? '0 = 1' : implode(' OR ', $uploadedChecks);

        $row = DB::table($tableName)
            ->where('received_at', '>=', $rangeStart)
            ->where('received_at', '<', $rangeEnd)
            ->selectRaw("
                COUNT(*) as total_orders,
                SUM(CASE WHEN {$uploadedCondition} THEN 1 ELSE 0 END) as uploaded_orders
            ")
            ->first();

        return [
            'total_orders' => (int) ($row->total_orders ?? 0),
            'uploaded_orders' => (int) ($row->uploaded_orders ?? 0),
        ];
    }

    private function emptyCounts(): array
    {
        return ['total_orders' => 0, 'uploaded_orders' => 0];
    }

    private function emptyTotals(): array
    {
        return ['project_count' => 0, 'total_orders' => 0, 'uploaded_orders' => 0, 'pending_orders' => 0];
    }
}
