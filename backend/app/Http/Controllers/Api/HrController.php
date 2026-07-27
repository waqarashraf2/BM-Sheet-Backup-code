<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\User;
use App\Models\UserDocument;
use App\Models\WorkItem;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Illuminate\Support\Str;

class HrController extends Controller
{
    public function dashboard(Request $request)
    {
        $this->authorizeHr($request);

        $projectId = $this->requestedProjectId($request);
        $userBase = User::query()
            ->when($projectId, fn ($query) => $query->where('project_id', $projectId));
        $stats = [
            'total' => (clone $userBase)->count(),
            'active' => (clone $userBase)->where('is_active', true)->count(),
            'inactive' => (clone $userBase)->where('is_active', false)->count(),
            'absent' => (clone $userBase)->where('is_absent', true)->count(),
            'present' => (clone $userBase)->where('is_active', true)->where('is_absent', false)->count(),
        ];

        $month = $this->requestedMonth($request);
        $monthStart = $month->copy()->startOfMonth();
        $monthEnd = $month->copy()->endOfMonth();

        $monthlyProgress = collect();
        if (Schema::hasTable('work_items')) {
            $avgSelect = Schema::hasColumn('work_items', 'time_spent_seconds')
                ? 'AVG(CASE WHEN time_spent_seconds > 0 THEN time_spent_seconds ELSE NULL END) as avg_seconds'
                : 'NULL as avg_seconds';

            $monthlyProgress = WorkItem::query()
                ->where('status', 'completed')
                ->when($projectId, fn ($query) => $query->where('project_id', $projectId))
                ->whereBetween('completed_at', [$monthStart, $monthEnd])
                ->selectRaw("assigned_user_id, COUNT(*) as completed, {$avgSelect}")
                ->groupBy('assigned_user_id')
                ->orderByDesc('completed')
                ->limit(10)
                ->get()
                ->keyBy('assigned_user_id');
        }

        $users = User::query()
            ->whereIn('id', $monthlyProgress->keys())
            ->get($this->userColumns())
            ->keyBy('id');

        return response()->json([
            'stats' => $stats,
            'document_stats' => $this->documentStats($projectId),
            'month' => $month->format('Y-m'),
            'project_id' => $projectId,
            'project_options' => $this->projectOptions(),
            'documents_ready' => Schema::hasTable('user_documents'),
            'machine_id_ready' => Schema::hasColumn('users', 'machine_id'),
            'monthly_progress' => $monthlyProgress->map(function ($row) use ($users) {
                $user = $users->get($row->assigned_user_id);

                return [
                    'user_id' => (int) $row->assigned_user_id,
                    'name' => $user?->name,
                    'email' => $user?->email,
                    'machine_id' => $user?->machine_id,
                    'role' => $user?->role,
                    'completed' => (int) $row->completed,
                    'avg_minutes' => $row->avg_seconds ? round(((float) $row->avg_seconds) / 60, 1) : null,
                ];
            })->values(),
        ]);
    }

    public function users(Request $request)
    {
        $this->authorizeHr($request);

        $perPage = min(max((int) $request->input('per_page', 25), 1), 100);
        $month = $this->requestedMonth($request);
        $monthStart = $month->copy()->startOfMonth();
        $monthEnd = $month->copy()->endOfMonth();

        $query = $this->applyUserFilters(
            User::query()->with(['project:id,name', 'team:id,name,project_id']),
            $request
        );

        $users = $query
            ->select($this->userColumns())
            ->latest()
            ->paginate($perPage);

        $documentCounts = [];
        if (Schema::hasTable('user_documents')) {
            $documentCounts = DB::table('user_documents')
                ->whereIn('user_id', collect($users->items())->pluck('id')->all())
                ->selectRaw('user_id, COUNT(*) as total')
                ->groupBy('user_id')
                ->pluck('total', 'user_id')
                ->toArray();
        }

        $monthlyPerformance = [];
        if (Schema::hasTable('work_items')) {
            $avgSelect = Schema::hasColumn('work_items', 'time_spent_seconds')
                ? 'AVG(CASE WHEN time_spent_seconds > 0 THEN time_spent_seconds ELSE NULL END) as avg_seconds'
                : 'NULL as avg_seconds';

            $monthlyPerformance = WorkItem::query()
                ->whereIn('assigned_user_id', collect($users->items())->pluck('id')->all())
                ->where('status', 'completed')
                ->whereBetween('completed_at', [$monthStart, $monthEnd])
                ->selectRaw("assigned_user_id, COUNT(*) as completed, {$avgSelect}")
                ->groupBy('assigned_user_id')
                ->get()
                ->keyBy('assigned_user_id');
        }

        $users->setCollection($users->getCollection()->map(function (User $user) use ($documentCounts, $monthlyPerformance) {
            $performance = $monthlyPerformance[$user->id] ?? null;
            $user->setAttribute('documents_count', (int) ($documentCounts[$user->id] ?? 0));
            $user->setAttribute('monthly_completed', (int) ($performance?->completed ?? 0));
            $user->setAttribute('monthly_avg_minutes', $performance?->avg_seconds ? round(((float) $performance->avg_seconds) / 60, 1) : null);
            return $user;
        }));

        return response()->json(array_merge($users->toArray(), [
            'documents_ready' => Schema::hasTable('user_documents'),
            'machine_id_ready' => Schema::hasColumn('users', 'machine_id'),
            'project_options' => $this->projectOptions(),
            'month' => $month->format('Y-m'),
        ]));
    }

    public function updateUser(Request $request, string $userId)
    {
        $this->authorizeHr($request);

        $user = User::findOrFail($userId);
        $oldValues = $user->toArray();

        $rules = [
            'name' => 'sometimes|string|max:255',
            'email' => ['sometimes', 'email', Rule::unique('users', 'email')->ignore($user->id)],
            'role' => 'sometimes|in:drawer,checker,filler,qa,designer,project_manager,operations_manager,accounts_manager,hr',
            'country' => 'sometimes|nullable|string|max:255',
            'department' => 'sometimes|nullable|in:floor_plan,photos_enhancement',
            'project_id' => 'sometimes|nullable|exists:projects,id',
            'team_id' => 'sometimes|nullable|exists:teams,id',
            'is_active' => 'sometimes|boolean',
        ];

        foreach ([
            'machine_id' => 'sometimes|nullable|string|max:100',
            'layer' => 'sometimes|nullable|in:drawer,checker,filler,qa,designer',
            'is_absent' => 'sometimes|boolean',
            'daily_target' => 'sometimes|nullable|integer|min:0|max:100000',
            'wip_limit' => 'sometimes|nullable|integer|min:1|max:1000',
            'shift_start' => 'sometimes|nullable|date_format:H:i',
            'shift_end' => 'sometimes|nullable|date_format:H:i',
        ] as $column => $rule) {
            if (Schema::hasColumn('users', $column)) {
                $rules[$column] = $rule;
            }
        }

        $data = $request->validate($rules);

        foreach (['machine_id', 'layer', 'is_absent', 'daily_target', 'wip_limit', 'shift_start', 'shift_end'] as $column) {
            if (!Schema::hasColumn('users', $column)) {
                unset($data[$column]);
            }
        }

        DB::transaction(function () use ($user, $data) {
            $user->update($data);

            if (array_key_exists('machine_id', $data) && Schema::hasTable('user_documents')) {
                DB::table('user_documents')
                    ->where('user_id', $user->id)
                    ->update(['machine_id' => $data['machine_id'] ?: null]);
            }
        });

        \App\Services\AuditService::logUserUpdated($user->id, $oldValues, $user->fresh()->toArray());

        return response()->json([
            'message' => 'User updated successfully.',
            'data' => $user->fresh(['project:id,name', 'team:id,name,project_id']),
        ]);
    }

    public function deactivateLongAbsent(Request $request)
    {
        $this->authorizeHr($request);

        $days = min(max((int) $request->input('days', 15), 15), 365);
        $dryRun = $request->boolean('dry_run', false);

        $query = User::query()
            ->where('is_active', true)
            ->where('is_absent', true)
            ->where('inactive_days', '>=', $days)
            ->whereNotIn('role', ['ceo', 'director', 'hr']);

        $count = (clone $query)->count();
        $preview = (clone $query)
            ->orderByDesc('inactive_days')
            ->limit(10)
            ->get($this->userColumns())
            ->map(fn (User $user) => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
                'machine_id' => $user->machine_id,
                'inactive_days' => $user->inactive_days,
            ]);

        if ($dryRun) {
            return response()->json([
                'message' => "{$count} users match the {$days}+ day absent rule.",
                'affected' => 0,
                'matched' => $count,
                'preview' => $preview,
            ]);
        }

        $affected = DB::transaction(function () use ($query) {
            return $query->update([
                'is_active' => false,
                'updated_at' => now(),
            ]);
        });

        return response()->json([
            'message' => "{$affected} absent users were marked inactive.",
            'affected' => $affected,
            'matched' => $count,
            'preview' => $preview,
        ]);
    }

    public function documents(Request $request, string $userId)
    {
        $this->authorizeHr($request);
        $user = User::findOrFail($userId);

        if (!Schema::hasTable('user_documents')) {
            return response()->json(['data' => [], 'documents_ready' => false]);
        }

        $documents = UserDocument::where('user_id', $user->id)
            ->latest()
            ->get();

        return response()->json([
            'data' => $documents,
            'documents_ready' => true,
        ]);
    }

    public function userDetail(Request $request, string $userId)
    {
        $this->authorizeHr($request);

        $month = $this->requestedMonth($request);
        $monthStart = $month->copy()->startOfMonth();
        $monthEnd = $month->copy()->endOfMonth();
        $todayStart = now()->startOfDay();
        $todayEnd = now()->endOfDay();

        $user = User::query()
            ->with(['project:id,name,code', 'team:id,name,project_id'])
            ->select($this->userColumns())
            ->findOrFail($userId);

        $documents = collect();
        if (Schema::hasTable('user_documents')) {
            $documents = UserDocument::where('user_id', $user->id)->latest()->get();
        }

        $performance = [
            'today_completed' => 0,
            'month_completed' => 0,
            'month_avg_minutes' => null,
            'daily_progress' => [],
            'recent_work' => [],
        ];

        if (Schema::hasTable('work_items')) {
            $avgExpression = Schema::hasColumn('work_items', 'time_spent_seconds')
                ? 'AVG(CASE WHEN time_spent_seconds > 0 THEN time_spent_seconds ELSE NULL END) as avg_seconds'
                : 'NULL as avg_seconds';

            $todayCompleted = WorkItem::query()
                ->where('assigned_user_id', $user->id)
                ->where('status', 'completed')
                ->whereBetween('completed_at', [$todayStart, $todayEnd])
                ->count();

            $monthSummary = WorkItem::query()
                ->where('assigned_user_id', $user->id)
                ->where('status', 'completed')
                ->whereBetween('completed_at', [$monthStart, $monthEnd])
                ->selectRaw("COUNT(*) as completed, {$avgExpression}")
                ->first();

            $dailyProgress = WorkItem::query()
                ->where('assigned_user_id', $user->id)
                ->where('status', 'completed')
                ->whereBetween('completed_at', [$monthStart, $monthEnd])
                ->selectRaw("DATE(completed_at) as work_date, COUNT(*) as completed, {$avgExpression}")
                ->groupBy(DB::raw('DATE(completed_at)'))
                ->orderBy('work_date')
                ->get()
                ->map(fn ($row) => [
                    'date' => $row->work_date,
                    'completed' => (int) $row->completed,
                    'avg_minutes' => $row->avg_seconds ? round(((float) $row->avg_seconds) / 60, 1) : null,
                ]);

            $recentColumns = ['id', 'order_id', 'project_id', 'stage', 'status', 'completed_at'];
            if (Schema::hasColumn('work_items', 'time_spent_seconds')) {
                $recentColumns[] = 'time_spent_seconds';
            }

            $recentWork = WorkItem::query()
                ->where('assigned_user_id', $user->id)
                ->where('status', 'completed')
                ->latest('completed_at')
                ->limit(20)
                ->get($recentColumns)
                ->map(fn (WorkItem $item) => [
                    'id' => $item->id,
                    'order_id' => $item->order_id,
                    'project_id' => $item->project_id,
                    'stage' => $item->stage,
                    'status' => $item->status,
                    'completed_at' => optional($item->completed_at)->toDateTimeString(),
                    'minutes' => isset($item->time_spent_seconds) && $item->time_spent_seconds
                        ? round(((float) $item->time_spent_seconds) / 60, 1)
                        : null,
                ]);

            $performance = [
                'today_completed' => $todayCompleted,
                'month_completed' => (int) ($monthSummary?->completed ?? 0),
                'month_avg_minutes' => $monthSummary?->avg_seconds ? round(((float) $monthSummary->avg_seconds) / 60, 1) : null,
                'daily_progress' => $dailyProgress,
                'recent_work' => $recentWork,
            ];
        }

        return response()->json([
            'user' => $user,
            'documents' => $documents,
            'performance' => $performance,
            'month' => $month->format('Y-m'),
            'documents_ready' => Schema::hasTable('user_documents'),
            'machine_id_ready' => Schema::hasColumn('users', 'machine_id'),
        ]);
    }

    public function uploadDocument(Request $request, string $userId)
    {
        $this->authorizeHr($request);

        if (!Schema::hasTable('user_documents')) {
            return response()->json([
                'message' => 'User documents table is not ready. Run the manual SQL first.',
            ], 503);
        }

        $user = User::findOrFail($userId);
        $validated = $request->validate([
            'document_type' => 'required|in:' . implode(',', UserDocument::TYPES),
            'file' => 'required|file|max:10240|mimes:jpg,jpeg,png,pdf,doc,docx',
        ]);

        $document = $this->storeUserDocument($user, $request->file('file'), $validated['document_type'], $request->user()->id);

        return response()->json([
            'message' => 'Document uploaded successfully.',
            'data' => $document,
        ], 201);
    }

    public function uploadDocuments(Request $request, string $userId)
    {
        $this->authorizeHr($request);

        if (!Schema::hasTable('user_documents')) {
            return response()->json([
                'message' => 'User documents table is not ready. Run the manual SQL first.',
            ], 503);
        }

        $user = User::findOrFail($userId);
        $validated = $request->validate([
            'documents' => 'required|array|min:1|max:12',
            'documents.*.document_type' => 'required|in:' . implode(',', UserDocument::TYPES),
            'documents.*.file' => 'required|file|max:10240|mimes:jpg,jpeg,png,pdf,doc,docx',
        ]);

        $uploaded = [];
        DB::transaction(function () use ($request, $validated, $user, &$uploaded) {
            foreach ($validated['documents'] as $index => $item) {
                $uploaded[] = $this->storeUserDocument(
                    $user,
                    $request->file("documents.{$index}.file"),
                    $item['document_type'],
                    $request->user()->id
                );
            }
        });

        return response()->json([
            'message' => count($uploaded) . ' documents uploaded successfully.',
            'data' => $uploaded,
        ], 201);
    }

    public function downloadDocument(Request $request, string $documentId)
    {
        $this->authorizeHr($request);

        if (!Schema::hasTable('user_documents')) {
            return response()->json(['message' => 'User documents table is not ready.'], 503);
        }

        $document = UserDocument::findOrFail($documentId);

        if (!Storage::disk('local')->exists($document->file_path)) {
            return response()->json(['message' => 'File not found on server.'], 404);
        }

        return Storage::disk('local')->download($document->file_path, $document->original_name);
    }

    public function deleteDocument(Request $request, string $documentId)
    {
        $this->authorizeHr($request);

        if (!Schema::hasTable('user_documents')) {
            return response()->json(['message' => 'User documents table is not ready.'], 503);
        }

        $document = UserDocument::findOrFail($documentId);

        DB::transaction(function () use ($document) {
            if ($document->file_path && Storage::disk('local')->exists($document->file_path)) {
                Storage::disk('local')->delete($document->file_path);
            }

            $document->delete();
        });

        return response()->json([
            'message' => 'Document deleted successfully.',
        ]);
    }

    private function storeUserDocument(User $user, $file, string $documentType, int $uploadedBy): UserDocument
    {
        $machineId = Schema::hasColumn('users', 'machine_id') ? ($user->machine_id ?: null) : null;
        $folderKey = Str::slug($machineId ?: "user-{$user->id}");
        $extension = strtolower($file->getClientOriginalExtension() ?: 'bin');
        $fileName = $documentType . '-' . now()->format('YmdHis') . '-' . Str::random(8) . '.' . $extension;
        $path = $file->storeAs("private/user-documents/{$folderKey}", $fileName, 'local');

        return UserDocument::create([
            'user_id' => $user->id,
            'machine_id' => $machineId,
            'document_type' => $documentType,
            'original_name' => $file->getClientOriginalName(),
            'file_name' => $fileName,
            'file_path' => $path,
            'mime_type' => $file->getMimeType(),
            'file_size' => $file->getSize(),
            'uploaded_by' => $uploadedBy,
            'uploaded_at' => now(),
        ]);
    }

    private function authorizeHr(Request $request): void
    {
        abort_unless($request->user() && in_array($request->user()->role, ['ceo', 'hr', 'director'], true), 403);
    }

    private function documentStats(?int $projectId): array
    {
        $requiredTypes = [
            'copy_of_cnic',
            'two_pics',
            'nda',
            'contract_letter',
        ];

        $empty = [
            'active_total' => User::query()
                ->where('is_active', true)
                ->when($projectId, fn ($query) => $query->where('project_id', $projectId))
                ->count(),
            'complete_required' => 0,
            'no_documents' => 0,
            'missing' => array_fill_keys($requiredTypes, 0),
        ];

        if (!Schema::hasTable('user_documents')) {
            return $empty;
        }

        $flags = DB::table('user_documents')
            ->select('user_id')
            ->selectRaw("MAX(CASE WHEN document_type = 'copy_of_cnic' THEN 1 ELSE 0 END) as has_copy_of_cnic")
            ->selectRaw("MAX(CASE WHEN document_type = 'two_pics' THEN 1 ELSE 0 END) as has_two_pics")
            ->selectRaw("MAX(CASE WHEN document_type = 'nda' THEN 1 ELSE 0 END) as has_nda")
            ->selectRaw("MAX(CASE WHEN document_type = 'contract_letter' THEN 1 ELSE 0 END) as has_contract_letter")
            ->whereNotNull('user_id')
            ->groupBy('user_id');

        $summary = DB::table('users as users')
            ->leftJoinSub($flags, 'docs', 'docs.user_id', '=', 'users.id')
            ->where('users.is_active', true)
            ->when($projectId, fn ($query) => $query->where('users.project_id', $projectId))
            ->selectRaw('COUNT(*) as active_total')
            ->selectRaw('SUM(CASE WHEN docs.user_id IS NULL THEN 1 ELSE 0 END) as no_documents')
            ->selectRaw('SUM(CASE WHEN COALESCE(docs.has_copy_of_cnic, 0) = 0 THEN 1 ELSE 0 END) as missing_copy_of_cnic')
            ->selectRaw('SUM(CASE WHEN COALESCE(docs.has_two_pics, 0) = 0 THEN 1 ELSE 0 END) as missing_two_pics')
            ->selectRaw('SUM(CASE WHEN COALESCE(docs.has_nda, 0) = 0 THEN 1 ELSE 0 END) as missing_nda')
            ->selectRaw('SUM(CASE WHEN COALESCE(docs.has_contract_letter, 0) = 0 THEN 1 ELSE 0 END) as missing_contract_letter')
            ->selectRaw('SUM(CASE WHEN COALESCE(docs.has_copy_of_cnic, 0) = 1 AND COALESCE(docs.has_two_pics, 0) = 1 AND COALESCE(docs.has_nda, 0) = 1 AND COALESCE(docs.has_contract_letter, 0) = 1 THEN 1 ELSE 0 END) as complete_required')
            ->first();

        return [
            'active_total' => (int) ($summary->active_total ?? 0),
            'complete_required' => (int) ($summary->complete_required ?? 0),
            'no_documents' => (int) ($summary->no_documents ?? 0),
            'missing' => [
                'copy_of_cnic' => (int) ($summary->missing_copy_of_cnic ?? 0),
                'two_pics' => (int) ($summary->missing_two_pics ?? 0),
                'nda' => (int) ($summary->missing_nda ?? 0),
                'contract_letter' => (int) ($summary->missing_contract_letter ?? 0),
            ],
        ];
    }

    private function userColumns(): array
    {
        $columns = [
            'id', 'name', 'email', 'role', 'country', 'department',
            'project_id', 'team_id', 'is_active', 'is_absent',
            'last_activity', 'today_completed', 'daily_target',
            'avg_completion_minutes', 'rejection_rate_30d',
            'created_at',
        ];

        foreach ([
            'machine_id', 'inactive_days', 'is_online', 'wip_count', 'wip_limit',
            'shift_start', 'shift_end', 'layer', 'skills', 'assignment_score',
        ] as $optionalColumn) {
            if (Schema::hasColumn('users', $optionalColumn)) {
                $columns[] = $optionalColumn;
            }
        }

        return $columns;
    }

    private function applyUserFilters($query, Request $request)
    {
        if ($request->filled('role') && $request->input('role') !== 'all') {
            $query->where('role', $request->input('role'));
        }

        if ($request->filled('project_id') && $request->input('project_id') !== 'all') {
            $query->where('project_id', (int) $request->input('project_id'));
        }

        if ($request->filled('status') && $request->input('status') !== 'all') {
            if ($request->input('status') === 'active') {
                $query->where('is_active', true);
            } elseif ($request->input('status') === 'inactive') {
                $query->where('is_active', false);
            } elseif ($request->input('status') === 'absent') {
                $query->where('is_absent', true);
            } elseif ($request->input('status') === 'present') {
                $query->where('is_active', true)->where('is_absent', false);
            } elseif ($request->input('status') === 'absent_15_plus') {
                $query->where('is_absent', true)->where('inactive_days', '>=', 15);
            }
        }

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");

                if (Schema::hasColumn('users', 'machine_id')) {
                    $q->orWhere('machine_id', 'like', "%{$search}%");
                }
            });
        }

        return $query;
    }

    private function requestedMonth(Request $request): Carbon
    {
        $month = (string) $request->input('month', now()->format('Y-m'));

        try {
            return Carbon::createFromFormat('Y-m', $month)->startOfMonth();
        } catch (\Throwable) {
            return now()->startOfMonth();
        }
    }

    private function requestedProjectId(Request $request): ?int
    {
        if (!$request->filled('project_id') || $request->input('project_id') === 'all') {
            return null;
        }

        $projectId = (int) $request->input('project_id');
        return $projectId > 0 ? $projectId : null;
    }

    private function projectOptions()
    {
        if (!Schema::hasTable('projects')) {
            return [];
        }

        return Project::query()
            ->orderBy('name')
            ->get(['id', 'name', 'code'])
            ->map(fn (Project $project) => [
                'id' => $project->id,
                'name' => $project->name,
                'code' => $project->code,
            ]);
    }
}
