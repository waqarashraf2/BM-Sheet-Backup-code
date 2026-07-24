<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\UserDocument;
use App\Models\WorkItem;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class HrController extends Controller
{
    public function dashboard(Request $request)
    {
        $this->authorizeHr($request);

        $userBase = User::query();
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
            'month' => $month->format('Y-m'),
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
            'month' => $month->format('Y-m'),
        ]));
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

        $file = $request->file('file');
        $machineId = Schema::hasColumn('users', 'machine_id') ? ($user->machine_id ?: null) : null;
        $folderKey = Str::slug($machineId ?: "user-{$user->id}");
        $extension = strtolower($file->getClientOriginalExtension() ?: 'bin');
        $fileName = $validated['document_type'] . '-' . now()->format('YmdHis') . '-' . Str::random(8) . '.' . $extension;
        $path = $file->storeAs("private/user-documents/{$folderKey}", $fileName, 'local');

        $document = UserDocument::create([
            'user_id' => $user->id,
            'machine_id' => $machineId,
            'document_type' => $validated['document_type'],
            'original_name' => $file->getClientOriginalName(),
            'file_name' => $fileName,
            'file_path' => $path,
            'mime_type' => $file->getMimeType(),
            'file_size' => $file->getSize(),
            'uploaded_by' => $request->user()->id,
            'uploaded_at' => now(),
        ]);

        return response()->json([
            'message' => 'Document uploaded successfully.',
            'data' => $document,
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

    private function authorizeHr(Request $request): void
    {
        abort_unless($request->user() && $request->user()->role === 'hr', 403);
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

        if (Schema::hasColumn('users', 'machine_id')) {
            $columns[] = 'machine_id';
        }

        return $columns;
    }

    private function applyUserFilters($query, Request $request)
    {
        if ($request->filled('role') && $request->input('role') !== 'all') {
            $query->where('role', $request->input('role'));
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
}
