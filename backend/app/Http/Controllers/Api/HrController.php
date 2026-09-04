<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Models\User;
use App\Models\UserDocument;
use App\Models\UserLeaveBalance;
use App\Models\UserLeaveEntry;
use App\Models\UserSalaryIncrement;
use App\Models\WorkItem;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
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
            ->when($request->user()?->role === 'hr', fn ($query) => $query->where('role', '!=', 'ceo'))
            ->when($projectId, fn ($query) => $query->where('project_id', $projectId));
        $inactiveFilter = function ($query) {
            $query->where('is_active', false)
                ->orWhere('inactive_days', '>=', 15)
                ->orWhere(function ($nested) {
                    $nested->where('is_absent', true)->where('inactive_days', '>=', 15);
                });
        };
        $stats = [
            'total' => (clone $userBase)->count(),
            'active' => (clone $userBase)
                ->where('is_active', true)
                ->where(function ($query) {
                    $query->whereNull('inactive_days')->orWhere('inactive_days', '<', 15);
                })
                ->where(function ($query) {
                    $query->where('is_absent', false)
                        ->orWhereNull('inactive_days')
                        ->orWhere('inactive_days', '<', 15);
                })
                ->count(),
            'inactive' => (clone $userBase)->where($inactiveFilter)->count(),
            'absent' => (clone $userBase)->where('is_absent', true)->count(),
            'present' => (clone $userBase)
                ->where('is_active', true)
                ->where('is_absent', false)
                ->where(function ($query) {
                    $query->whereNull('inactive_days')->orWhere('inactive_days', '<', 15);
                })
                ->count(),
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
            ->when($request->user()?->role === 'hr', fn ($query) => $query->where('role', '!=', 'ceo'))
            ->whereIn('id', $monthlyProgress->keys())
            ->get($this->userColumns())
            ->keyBy('id');

        return response()->json([
            'stats' => $stats,
            'document_stats' => $this->documentStats($projectId),
            'employee_analytics' => $this->employeeAnalytics($request, $month, $projectId),
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
                ->whereIn('document_type', $this->requiredDocumentTypes())
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
            return $this->exposePayrollFields($user);
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
        $this->abortIfHrCannotAccessUser($request, $user);
        $oldValues = $user->toArray();

        $rules = [
            'name' => 'sometimes|string|max:255',
            'email' => ['sometimes', 'email', Rule::unique('users', 'email')->ignore($user->id)],
            'role' => 'sometimes|in:drawer,checker,filler,qa,designer,project_manager,operations_manager,accounts_manager,hr,csr,it',
            'country' => 'sometimes|nullable|string|max:255',
            'department' => 'sometimes|nullable|in:floor_plan,photos_enhancement,general,support,it',
            'project_id' => 'sometimes|nullable|exists:projects,id',
            'team_id' => 'sometimes|nullable|exists:teams,id',
            'is_active' => 'sometimes|boolean',
        ];

        foreach ([
            'machine_id' => 'sometimes|nullable|string|max:100',
            'blood_group' => 'sometimes|nullable|string|max:10',
            'contact_number' => 'sometimes|nullable|string|max:50',
            'bank_account_number' => 'sometimes|nullable|string|max:100',
            'joining_salary' => 'sometimes|nullable|numeric|min:0|max:9999999999.99',
            'salary' => 'sometimes|nullable|numeric|min:0|max:9999999999.99',
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

        foreach (['machine_id', 'blood_group', 'contact_number', 'bank_account_number', 'joining_salary', 'salary', 'layer', 'is_absent', 'daily_target', 'wip_limit', 'shift_start', 'shift_end'] as $column) {
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
            'data' => $this->exposePayrollFields($user->fresh(['project:id,name', 'team:id,name,project_id'])),
        ]);
    }

    public function addSalaryIncrement(Request $request, string $userId)
    {
        $this->authorizeHr($request);
        $this->abortUnlessPayrollReady();

        $user = User::findOrFail($userId);
        $this->abortIfHrCannotAccessUser($request, $user);

        $validated = $request->validate([
            'increment_amount' => 'required|numeric|min:0|max:9999999999.99',
            'effective_date' => 'required|date',
            'notes' => 'nullable|string|max:2000',
        ]);

        $increment = DB::transaction(function () use ($request, $user, $validated) {
            $previousSalary = $user->salary !== null ? (float) $user->salary : 0.0;
            $incrementAmount = (float) $validated['increment_amount'];
            $newSalary = $previousSalary + $incrementAmount;

            $record = UserSalaryIncrement::create([
                'user_id' => $user->id,
                'previous_salary' => $previousSalary,
                'increment_amount' => $incrementAmount,
                'new_salary' => $newSalary,
                'effective_date' => $validated['effective_date'],
                'notes' => $validated['notes'] ?? null,
                'created_by' => $request->user()?->id,
            ]);

            $userUpdates = ['salary' => $newSalary];
            if (Schema::hasColumn('users', 'joining_salary') && $user->joining_salary === null) {
                $userUpdates['joining_salary'] = $previousSalary;
            }
            $user->update($userUpdates);

            return $record;
        });

        return response()->json([
            'message' => 'Salary increment added successfully.',
            'data' => $increment->fresh(),
            'user' => $this->exposePayrollFields($user->fresh($this->userDetailRelations())),
        ], 201);
    }

    public function updateLeaveBalance(Request $request, string $userId)
    {
        $this->authorizeHr($request);
        $this->abortUnlessLeaveBalanceReady();

        $user = User::findOrFail($userId);
        $this->abortIfHrCannotAccessUser($request, $user);

        $validated = $request->validate([
            'year' => 'required|integer|min:2020|max:2100',
            'annual_allowed' => 'sometimes|integer|min:0|max:60',
            'leaves_taken' => 'required|integer|min:0|max:60',
            'notes' => 'nullable|string|max:2000',
        ]);

        $allowed = (int) ($validated['annual_allowed'] ?? 14);
        $taken = min((int) $validated['leaves_taken'], $allowed);

        $balance = UserLeaveBalance::updateOrCreate(
            ['user_id' => $user->id, 'year' => (int) $validated['year']],
            [
                'annual_allowed' => $allowed,
                'leaves_taken' => $taken,
                'notes' => $validated['notes'] ?? null,
                'updated_by' => $request->user()?->id,
            ]
        );

        return response()->json([
            'message' => 'Leave balance updated successfully.',
            'data' => $this->formatLeaveBalance($balance),
        ]);
    }

    public function addLeaveEntry(Request $request, string $userId)
    {
        $this->authorizeHr($request);
        $this->abortUnlessLeaveEntryReady();

        $user = User::findOrFail($userId);
        $this->abortIfHrCannotAccessUser($request, $user);

        $validated = $request->validate([
            'leave_date' => 'required|date',
            'leave_days' => 'sometimes|integer|min:1|max:14',
            'reason' => 'required|string|max:500',
        ]);

        $entry = DB::transaction(function () use ($request, $user, $validated) {
            $leaveDate = Carbon::parse($validated['leave_date']);
            $year = (int) $leaveDate->format('Y');
            $leaveDays = (int) ($validated['leave_days'] ?? 1);

            $entry = UserLeaveEntry::create([
                'user_id' => $user->id,
                'leave_date' => $leaveDate->toDateString(),
                'leave_days' => $leaveDays,
                'reason' => $validated['reason'],
                'created_by' => $request->user()?->id,
            ]);

            $balance = UserLeaveBalance::firstOrNew([
                'user_id' => $user->id,
                'year' => $year,
            ]);
            $balance->annual_allowed = $balance->annual_allowed ?: 14;
            $balance->leaves_taken = min(60, (float) ($balance->leaves_taken ?? 0) + $leaveDays);
            $balance->updated_by = $request->user()?->id;
            $balance->save();

            return $entry;
        });

        return response()->json([
            'message' => 'Leave record added successfully.',
            'data' => $this->formatLeaveEntry($entry->fresh()),
            'leave_balances' => $this->leaveBalances($user->id),
            'leave_entries' => $this->leaveEntries($user->id),
        ], 201);
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
        $this->abortIfHrCannotAccessUser($request, $user);

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
        $this->abortIfHrCannotAccessUser($request, $user);

        $documents = collect();
        if (Schema::hasTable('user_documents')) {
            $documents = UserDocument::with('uploader:id,name,email,role')->where('user_id', $user->id)->latest()->get();
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
            'user' => $this->exposePayrollFields($user),
            'documents' => $documents,
            'performance' => $performance,
            'salary_increments' => $this->salaryIncrementHistory($user->id),
            'leave_balances' => $this->leaveBalances($user->id),
            'leave_entries' => $this->leaveEntries($user->id),
            'month' => $month->format('Y-m'),
            'documents_ready' => Schema::hasTable('user_documents'),
            'machine_id_ready' => Schema::hasColumn('users', 'machine_id'),
            'payroll_ready' => $this->payrollReady(),
            'leave_balance_ready' => Schema::hasTable('user_leave_balances'),
            'leave_entry_ready' => Schema::hasTable('user_leave_entries'),
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
        $this->abortIfHrCannotAccessUser($request, $user);
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
        $this->abortIfHrCannotAccessUser($request, $user);
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

    /**
     * Self-service endpoint for employees (CSR, IT, etc.) to view only their own documents.
     */
    public function myDocuments(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!Schema::hasTable('user_documents')) {
            return response()->json(['data' => [], 'documents_ready' => false]);
        }

        $documents = UserDocument::where('user_id', $user->id)
            ->with('uploader:id,name,role')
            ->latest()
            ->get();

        return response()->json([
            'data' => $documents,
            'documents_ready' => true,
        ]);
    }

    /**
     * Self-service endpoint for employees to download their own document.
     */
    public function downloadMyDocument(Request $request, string $documentId)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if (!Schema::hasTable('user_documents')) {
            return response()->json(['message' => 'User documents table is not ready.'], 503);
        }

        $document = UserDocument::where('id', $documentId)
            ->where('user_id', $user->id)
            ->firstOrFail();

        if (!Storage::disk('local')->exists($document->file_path)) {
            return response()->json(['message' => 'File not found on server.'], 404);
        }

        return Storage::disk('local')->download($document->file_path, $document->original_name);
    }

    public function emailDocuments(Request $request, string $userId)
    {
        $this->authorizeHr($request);

        if (!Schema::hasTable('user_documents')) {
            return response()->json(['message' => 'User documents table is not ready.'], 503);
        }

        $user = User::findOrFail($userId);
        $this->abortIfHrCannotAccessUser($request, $user);

        $validated = $request->validate([
            'email' => 'required|email',
            'subject' => 'required|string|max:255',
            'message' => 'required|string',
            'document_ids' => 'required|array|min:1',
            'document_ids.*' => 'integer|exists:user_documents,id',
        ]);

        $documents = UserDocument::where('user_id', $user->id)
            ->whereIn('id', $validated['document_ids'])
            ->get();

        if ($documents->isEmpty()) {
            return response()->json(['message' => 'No valid documents selected to email.'], 422);
        }

        try {
            Mail::send([], [], function ($message) use ($validated, $documents, $user) {
                $message->to($validated['email'], $user->name)
                    ->subject($validated['subject'])
                    ->html(nl2br(e($validated['message'])));

                foreach ($documents as $doc) {
                    if ($doc->file_path && Storage::disk('local')->exists($doc->file_path)) {
                        $message->attach(
                            Storage::disk('local')->path($doc->file_path),
                            ['as' => $doc->original_name]
                        );
                    }
                }
            });

            return response()->json([
                'message' => 'Documents successfully emailed to ' . $validated['email'],
            ]);
        } catch (\Exception $e) {
            \Log::error('HR email documents error: ' . $e->getMessage());
            return response()->json([
                'message' => 'Failed to send email: ' . $e->getMessage(),
            ], 500);
        }
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

    private function payrollReady(): bool
    {
        return Schema::hasTable('user_salary_increments')
            && Schema::hasColumn('users', 'salary')
            && Schema::hasColumn('users', 'joining_salary')
            && Schema::hasColumn('users', 'bank_account_number');
    }

    private function abortUnlessPayrollReady(): void
    {
        abort_unless($this->payrollReady(), 503, 'Payroll tables are not ready. Run migrations first.');
    }

    private function abortUnlessLeaveBalanceReady(): void
    {
        abort_unless(Schema::hasTable('user_leave_balances'), 503, 'Leave balance table is not ready. Run migrations first.');
    }

    private function abortUnlessLeaveEntryReady(): void
    {
        abort_unless(
            Schema::hasTable('user_leave_entries') && Schema::hasTable('user_leave_balances'),
            503,
            'Leave record tables are not ready. Run migrations first.'
        );
    }

    private function abortIfHrCannotAccessUser(Request $request, User $user): void
    {
        abort_if($request->user()?->role === 'hr' && $user->role === 'ceo', 403);
    }

    private function exposePayrollFields(User $user): User
    {
        return $user->makeVisible(['bank_account_number', 'joining_salary', 'salary']);
    }

    private function userDetailRelations(): array
    {
        return ['project:id,name,code', 'team:id,name,project_id'];
    }

    private function salaryIncrementHistory(int $userId)
    {
        if (!Schema::hasTable('user_salary_increments')) {
            return [];
        }

        return UserSalaryIncrement::query()
            ->where('user_id', $userId)
            ->latest('effective_date')
            ->latest('id')
            ->limit(25)
            ->get()
            ->map(fn (UserSalaryIncrement $increment) => [
                'id' => $increment->id,
                'previous_salary' => $increment->previous_salary,
                'increment_amount' => $increment->increment_amount,
                'new_salary' => $increment->new_salary,
                'effective_date' => optional($increment->effective_date)->toDateString(),
                'notes' => $increment->notes,
                'created_at' => optional($increment->created_at)->toDateTimeString(),
            ]);
    }

    private function leaveBalances(int $userId)
    {
        if (!Schema::hasTable('user_leave_balances')) {
            return [];
        }

        return UserLeaveBalance::query()
            ->where('user_id', $userId)
            ->orderByDesc('year')
            ->limit(5)
            ->get()
            ->map(fn (UserLeaveBalance $balance) => $this->formatLeaveBalance($balance));
    }

    private function leaveEntries(int $userId)
    {
        if (!Schema::hasTable('user_leave_entries')) {
            return [];
        }

        return UserLeaveEntry::query()
            ->where('user_id', $userId)
            ->latest('leave_date')
            ->latest('id')
            ->limit(50)
            ->get()
            ->map(fn (UserLeaveEntry $entry) => $this->formatLeaveEntry($entry));
    }

    private function formatLeaveBalance(UserLeaveBalance $balance): array
    {
        return [
            'id' => $balance->id,
            'year' => (int) $balance->year,
            'annual_allowed' => (int) $balance->annual_allowed,
            'leaves_taken' => (int) $balance->leaves_taken,
            'leaves_remaining' => max(0, (int) $balance->annual_allowed - (int) $balance->leaves_taken),
            'notes' => $balance->notes,
            'updated_at' => optional($balance->updated_at)->toDateTimeString(),
        ];
    }

    private function formatLeaveEntry(UserLeaveEntry $entry): array
    {
        return [
            'id' => $entry->id,
            'leave_date' => optional($entry->leave_date)->toDateString(),
            'leave_days' => $entry->leave_days,
            'reason' => $entry->reason,
            'created_at' => optional($entry->created_at)->toDateTimeString(),
        ];
    }

    private function resolveActiveEntities(?int $projectId): array
    {
        $activeUsers = User::query()
            ->where('is_active', true)
            ->when($projectId, fn ($query) => $query->where('project_id', $projectId))
            ->get(['id', 'name', 'email', 'role', 'machine_id', 'created_at', 'updated_at']);

        if ($activeUsers->isEmpty() || !Schema::hasTable('user_documents')) {
            return [];
        }

        $today = now()->toDateString();
        $userDocFlags = DB::table('user_documents')
            ->whereIn('user_id', $activeUsers->pluck('id'))
            ->select('user_id')
            ->selectRaw("MAX(CASE WHEN document_type = 'copy_of_cnic' THEN 1 ELSE 0 END) as has_copy_of_cnic")
            ->selectRaw("MAX(CASE WHEN document_type = 'two_pics' THEN 1 ELSE 0 END) as has_two_pics")
            ->selectRaw("MAX(CASE WHEN document_type = 'nda' THEN 1 ELSE 0 END) as has_nda")
            ->selectRaw("MAX(CASE WHEN document_type = 'contract_letter' THEN 1 ELSE 0 END) as has_contract_letter")
            ->selectRaw("MAX(CASE WHEN DATE(COALESCE(uploaded_at, created_at)) = ? THEN 1 ELSE 0 END) as has_uploaded_today", [$today])
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        $roleWeights = [
            'ceo' => 100,
            'director' => 90,
            'operations_manager' => 80,
            'project_manager' => 70,
            'accounts_manager' => 60,
            'hr' => 50,
            'qa' => 40,
            'checker' => 30,
            'designer' => 20,
            'filler' => 15,
            'drawer' => 10,
            'csr' => 10,
            'it' => 10,
        ];

        // Group active users by non-empty machine_id or individual user id
        $groups = [];
        foreach ($activeUsers as $user) {
            $machine = trim((string) ($user->machine_id ?? ''));
            $groupKey = ($machine !== '') ? 'm_' . $machine : 'u_' . $user->id;
            $groups[$groupKey][] = $user;
        }

        $entities = [];
        foreach ($groups as $groupKey => $usersInGroup) {
            if (count($usersInGroup) === 1) {
                $chosenUser = $usersInGroup[0];
            } else {
                // Sort users: QA > Checker > Drawer, then who has documents, then latest ID
                usort($usersInGroup, function ($a, $b) use ($roleWeights, $userDocFlags) {
                    $wA = $roleWeights[strtolower($a->role ?? '')] ?? 0;
                    $wB = $roleWeights[strtolower($b->role ?? '')] ?? 0;
                    if ($wA !== $wB) {
                        return $wB <=> $wA;
                    }
                    $docsA = $userDocFlags->has($a->id) ? 1 : 0;
                    $docsB = $userDocFlags->has($b->id) ? 1 : 0;
                    if ($docsA !== $docsB) {
                        return $docsB <=> $docsA;
                    }
                    return $b->id <=> $a->id;
                });
                $chosenUser = $usersInGroup[0];
            }

            $hasCnic = false;
            $hasPics = false;
            $hasNda = false;
            $hasContract = false;
            $hasToday = false;

            foreach ($usersInGroup as $member) {
                $flags = $userDocFlags->get($member->id);
                if ($flags) {
                    if (!empty($flags->has_copy_of_cnic)) {
                        $hasCnic = true;
                    }
                    if (!empty($flags->has_two_pics)) {
                        $hasPics = true;
                    }
                    if (!empty($flags->has_nda)) {
                        $hasNda = true;
                    }
                    if (!empty($flags->has_contract_letter)) {
                        $hasContract = true;
                    }
                    if (!empty($flags->has_uploaded_today)) {
                        $hasToday = true;
                    }
                }
            }

            $docCount = ($hasCnic ? 1 : 0) + ($hasPics ? 1 : 0) + ($hasNda ? 1 : 0) + ($hasContract ? 1 : 0);
            $status = 'no_docs';
            if ($docCount === 4) {
                $status = 'complete';
            } elseif ($docCount > 0) {
                $status = 'incomplete';
            }

            $allIds = collect($usersInGroup)->pluck('id')->all();

            $entities[] = [
                'group_key' => $groupKey,
                'user_id' => $chosenUser->id,
                'all_user_ids' => $allIds,
                'chosen_user' => $chosenUser,
                'has_copy_of_cnic' => $hasCnic,
                'has_two_pics' => $hasPics,
                'has_nda' => $hasNda,
                'has_contract_letter' => $hasContract,
                'has_uploaded_today' => $hasToday,
                'doc_count' => $docCount,
                'status' => $status,
            ];
        }

        return $entities;
    }

    private function documentStats(?int $projectId): array
    {
        $requiredTypes = $this->requiredDocumentTypes();

        if (!Schema::hasTable('user_documents')) {
            return [
                'active_total' => User::query()
                    ->where('is_active', true)
                    ->when($projectId, fn ($query) => $query->where('project_id', $projectId))
                    ->count(),
                'complete_required' => 0,
                'incomplete_docs' => 0,
                'no_documents' => 0,
                'uploaded_today' => 0,
                'missing' => array_fill_keys($requiredTypes, 0),
            ];
        }

        $entities = $this->resolveActiveEntities($projectId);

        $activeTotal = count($entities);
        $completeRequired = 0;
        $incompleteDocs = 0;
        $noDocuments = 0;
        $uploadedToday = 0;
        $missingCnic = 0;
        $missingPics = 0;
        $missingNda = 0;
        $missingContract = 0;

        foreach ($entities as $item) {
            if ($item['has_uploaded_today']) {
                $uploadedToday++;
            }

            if ($item['status'] === 'complete') {
                $completeRequired++;
            } elseif ($item['status'] === 'incomplete') {
                $incompleteDocs++;
                if (!$item['has_copy_of_cnic']) {
                    $missingCnic++;
                }
                if (!$item['has_two_pics']) {
                    $missingPics++;
                }
                if (!$item['has_nda']) {
                    $missingNda++;
                }
                if (!$item['has_contract_letter']) {
                    $missingContract++;
                }
            } else {
                $noDocuments++;
            }
        }

        $today = now()->toDateString();
        $todayTotalDocs = 0;
        $todayHrBreakdown = [];
        $totalAllDocs = 0;
        $totalEmployeesWithDocs = 0;
        $inactiveDocsCount = 0;
        $inactiveEmployeesWithDocs = 0;

        if (Schema::hasTable('user_documents')) {
            $todayTotalDocs = DB::table('user_documents as ud')
                ->whereRaw('DATE(COALESCE(ud.uploaded_at, ud.created_at)) = ?', [$today])
                ->when($projectId, function ($query) use ($projectId) {
                    $query->whereExists(function ($sub) use ($projectId) {
                        $sub->select(DB::raw(1))
                            ->from('users as u')
                            ->whereColumn('u.id', 'ud.user_id')
                            ->where('u.project_id', $projectId);
                    });
                })
                ->count();

            $todayHrBreakdown = DB::table('user_documents as ud')
                ->join('users as hr', 'hr.id', '=', 'ud.uploaded_by')
                ->whereRaw('DATE(COALESCE(ud.uploaded_at, ud.created_at)) = ?', [$today])
                ->when($projectId, function ($query) use ($projectId) {
                    $query->whereExists(function ($sub) use ($projectId) {
                        $sub->select(DB::raw(1))
                            ->from('users as u')
                            ->whereColumn('u.id', 'ud.user_id')
                            ->where('u.project_id', $projectId);
                    });
                })
                ->selectRaw('hr.id as hr_id, hr.name as hr_name, hr.email as hr_email, COUNT(DISTINCT ud.user_id) as users_count, COUNT(*) as documents_count')
                ->groupBy('hr.id', 'hr.name', 'hr.email')
                ->orderByDesc('documents_count')
                ->get()
                ->map(fn ($row) => [
                    'hr_id' => (int) $row->hr_id,
                    'hr_name' => $row->hr_name,
                    'hr_email' => $row->hr_email,
                    'users_count' => (int) $row->users_count,
                    'documents_count' => (int) $row->documents_count,
                ])
                ->toArray();

            $totalAllDocs = DB::table('user_documents as ud')
                ->when($projectId, function ($query) use ($projectId) {
                    $query->whereExists(function ($sub) use ($projectId) {
                        $sub->select(DB::raw(1))
                            ->from('users as u')
                            ->whereColumn('u.id', 'ud.user_id')
                            ->where('u.project_id', $projectId);
                    });
                })
                ->count();

            $totalEmployeesWithDocs = DB::table('user_documents as ud')
                ->when($projectId, function ($query) use ($projectId) {
                    $query->whereExists(function ($sub) use ($projectId) {
                        $sub->select(DB::raw(1))
                            ->from('users as u')
                            ->whereColumn('u.id', 'ud.user_id')
                            ->where('u.project_id', $projectId);
                    });
                })
                ->whereNotNull('ud.user_id')
                ->distinct('ud.user_id')
                ->count('ud.user_id');

            $inactiveDocsCount = DB::table('user_documents as ud')
                ->join('users as u', 'u.id', '=', 'ud.user_id')
                ->where(function ($q) {
                    $q->where('u.is_active', false)
                      ->orWhere(function ($sub) {
                          $sub->where('u.is_absent', true)->where('u.inactive_days', '>=', 15);
                      });
                })
                ->when($projectId, fn ($query) => $query->where('u.project_id', $projectId))
                ->count();

            $inactiveEmployeesWithDocs = DB::table('user_documents as ud')
                ->join('users as u', 'u.id', '=', 'ud.user_id')
                ->where(function ($q) {
                    $q->where('u.is_active', false)
                      ->orWhere(function ($sub) {
                          $sub->where('u.is_absent', true)->where('u.inactive_days', '>=', 15);
                      });
                })
                ->when($projectId, fn ($query) => $query->where('u.project_id', $projectId))
                ->distinct('ud.user_id')
                ->count('ud.user_id');
        }

        return [
            'active_total' => $activeTotal,
            'complete_required' => $completeRequired,
            'incomplete_docs' => $incompleteDocs,
            'no_documents' => $noDocuments,
            'uploaded_today' => $uploadedToday,
            'uploaded_today_docs' => (int) $todayTotalDocs,
            'today_hr_breakdown' => $todayHrBreakdown,
            'total_all_docs' => (int) $totalAllDocs,
            'total_employees_with_docs' => (int) $totalEmployeesWithDocs,
            'inactive_docs_count' => (int) $inactiveDocsCount,
            'inactive_employees_with_docs' => (int) $inactiveEmployeesWithDocs,
            'missing' => [
                'copy_of_cnic' => $missingCnic,
                'two_pics' => $missingPics,
                'nda' => $missingNda,
                'contract_letter' => $missingContract,
            ],
        ];
    }

    private function employeeAnalytics(Request $request, Carbon $month, ?int $projectId): array
    {
        $monthStart = $month->copy()->startOfMonth();
        $monthEnd = $month->copy()->endOfMonth();
        $today = now()->startOfDay();
        $probationStart = $today->copy()->subDays(93)->startOfDay();
        $probationEnd = $today->copy()->subDays(90)->endOfDay();

        $restrictedForHr = $request->user()?->role === 'hr';
        $inactiveSql = "(users.is_active = 0 OR (users.is_absent = 1 AND COALESCE(users.inactive_days, 0) >= 15) OR COALESCE(users.inactive_days, 0) >= 15)";

        $projectRows = DB::table('users as users')
            ->leftJoin('projects as projects', 'projects.id', '=', 'users.project_id')
            ->when($restrictedForHr, fn ($query) => $query->where('users.role', '!=', 'ceo'))
            ->when($projectId, fn ($query) => $query->where('users.project_id', $projectId))
            ->selectRaw("COALESCE(projects.name, 'No Project') as project_name")
            ->selectRaw('COUNT(*) as total_employees')
            ->selectRaw('SUM(CASE WHEN users.created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) as new_joined', [$monthStart, $monthEnd])
            ->selectRaw("SUM(CASE WHEN {$inactiveSql} AND users.updated_at BETWEEN ? AND ? THEN 1 ELSE 0 END) as left_this_month", [$monthStart, $monthEnd])
            ->selectRaw("SUM(CASE WHEN {$inactiveSql} THEN 1 ELSE 0 END) as total_inactive")
            ->selectRaw('SUM(CASE WHEN users.is_active = 1 AND NOT (users.is_absent = 1 AND COALESCE(users.inactive_days, 0) >= 15) AND COALESCE(users.inactive_days, 0) < 15 THEN 1 ELSE 0 END) as active_employees')
            ->groupBy('users.project_id', 'projects.name')
            ->orderByDesc('new_joined')
            ->orderBy('project_name')
            ->get()
            ->map(fn ($row) => [
                'project_name' => $row->project_name,
                'total_employees' => (int) $row->total_employees,
                'new_joined' => (int) $row->new_joined,
                'left_this_month' => (int) $row->left_this_month,
                'total_inactive' => (int) $row->total_inactive,
                'active_employees' => (int) $row->active_employees,
            ]);

        $summary = [
            'new_joined' => (int) $projectRows->sum('new_joined'),
            'left_this_month' => (int) $projectRows->sum('left_this_month'),
            'total_inactive' => (int) $projectRows->sum('total_inactive'),
            'active_employees' => (int) $projectRows->sum('active_employees'),
            'total_employees' => (int) $projectRows->sum('total_employees'),
        ];

        $probationEmployees = User::query()
            ->with('project:id,name')
            ->when($restrictedForHr, fn ($query) => $query->where('role', '!=', 'ceo'))
            ->when($projectId, fn ($query) => $query->where('project_id', $projectId))
            ->where('is_active', true)
            ->whereBetween('created_at', [$probationStart, $probationEnd])
            ->orderBy('created_at')
            ->get($this->userColumns())
            ->map(function (User $user) use ($today) {
                $joinedAt = $user->created_at ? Carbon::parse($user->created_at)->startOfDay() : null;
                $days = $joinedAt ? $joinedAt->diffInDays($today) : null;

                return [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'project_name' => $user->project?->name,
                    'machine_id' => $user->machine_id ?? null,
                    'joined_at' => optional($user->created_at)->toDateString(),
                    'days_completed' => $days,
                ];
            });

        return [
            'summary' => array_merge($summary, [
                'probation_due' => $probationEmployees->count(),
            ]),
            'project_breakdown' => $projectRows,
            'probation_alerts' => $probationEmployees,
        ];
    }

    private function requiredDocumentTypes(): array
    {
        return [
            'copy_of_cnic',
            'two_pics',
            'nda',
            'contract_letter',
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
            'blood_group', 'contact_number', 'bank_account_number', 'joining_salary', 'salary',
        ] as $optionalColumn) {
            if (Schema::hasColumn('users', $optionalColumn)) {
                $columns[] = $optionalColumn;
            }
        }

        return $columns;
    }

    private function applyUserFilters($query, Request $request)
    {
        if ($request->user()?->role === 'hr') {
            $query->where('role', '!=', 'ceo');
        }

        if ($request->filled('role') && $request->input('role') !== 'all') {
            $query->where('role', $request->input('role'));
        }

        if ($request->filled('project_id') && $request->input('project_id') !== 'all') {
            $query->where('project_id', (int) $request->input('project_id'));
        }

        if ($request->filled('status') && $request->input('status') !== 'all' && $request->input('doc_status') !== 'inactive_docs') {
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

        if ($request->filled('doc_status') && $request->input('doc_status') !== 'all' && Schema::hasTable('user_documents')) {
            $docFilter = (string) $request->input('doc_status');
            $projectId = $request->filled('project_id') && $request->input('project_id') !== 'all' ? (int) $request->input('project_id') : null;

            if ($docFilter === 'total_docs' || $docFilter === 'all_docs') {
                $query->whereIn('users.id', function ($sub) {
                    $sub->select('user_id')->from('user_documents')->whereNotNull('user_id');
                });
            } elseif ($docFilter === 'inactive_docs') {
                $query->where(function ($q) {
                    $q->where('users.is_active', false)
                      ->orWhere(function ($sub) {
                          $sub->where('users.is_absent', true)->where('users.inactive_days', '>=', 15);
                      });
                })->whereIn('users.id', function ($sub) {
                    $sub->select('user_id')->from('user_documents')->whereNotNull('user_id');
                });
            } else {
                $entities = $this->resolveActiveEntities($projectId);

                $matchedUserIds = [];
                foreach ($entities as $ent) {
                    $matches = false;
                    if ($docFilter === 'complete') {
                        $matches = ($ent['status'] === 'complete');
                    } elseif ($docFilter === 'incomplete' || $docFilter === 'partial') {
                        $matches = ($ent['status'] === 'incomplete');
                    } elseif ($docFilter === 'no_docs') {
                        $matches = ($ent['status'] === 'no_docs');
                    } elseif ($docFilter === 'missing_copy_of_cnic' || $docFilter === 'missing_cnic') {
                        $matches = ($ent['status'] === 'incomplete' && !$ent['has_copy_of_cnic']);
                    } elseif ($docFilter === 'missing_two_pics' || $docFilter === 'missing_pics') {
                        $matches = ($ent['status'] === 'incomplete' && !$ent['has_two_pics']);
                    } elseif ($docFilter === 'missing_nda') {
                        $matches = ($ent['status'] === 'incomplete' && !$ent['has_nda']);
                    } elseif ($docFilter === 'missing_contract_letter' || $docFilter === 'missing_contract') {
                        $matches = ($ent['status'] === 'incomplete' && !$ent['has_contract_letter']);
                    } elseif ($docFilter === 'uploaded_today') {
                        $matches = $ent['has_uploaded_today'];
                    }

                    if ($matches) {
                        foreach ($ent['all_user_ids'] as $uid) {
                            $matchedUserIds[] = $uid;
                        }
                    }
                }

                $query->whereIn('users.id', array_unique($matchedUserIds));
            }
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
