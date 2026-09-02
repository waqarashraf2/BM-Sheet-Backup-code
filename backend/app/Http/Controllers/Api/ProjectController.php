<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreProjectRequest;
use App\Http\Requests\UpdateProjectRequest;
use App\Models\ActivityLog;
use App\Models\Project;
use App\Models\Team;
use App\Services\ProjectOrderService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class ProjectController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = Project::with(['teams:id,name,project_id,is_active'])
            ->withCount(['teams', 'users']);

        // Scope projects by role: OM/PM only see their assigned projects
        $user = $request->user();
        if ($user->role === 'operations_manager') {
            $omProjectIds = $user->getManagedProjectIds();
            $query->whereIn('id', $omProjectIds);
        } elseif ($user->role === 'project_manager') {
            $pmProjectIds = $user->getManagedProjectIds();
            $query->whereIn('id', $pmProjectIds);
        } elseif ($user->role === 'client') {
            $clientProjectIds = $user->getManagedProjectIds();
            $query->whereIn('id', $clientProjectIds);
        }

        // Filter by country
        if ($request->has('country')) {
            $query->where('country', $request->country);
        }

        // Filter by department
        if ($request->has('department')) {
            $query->where('department', $request->department);
        }

        // Filter by status
        if ($request->has('status')) {
            $query->where('status', $request->status);
        }

        // Search by name or code
        if ($request->has('search')) {
            $query->where(function ($q) use ($request) {
                $q->where('name', 'like', '%' . $request->search . '%')
                  ->orWhere('code', 'like', '%' . $request->search . '%')
                  ->orWhere('client_name', 'like', '%' . $request->search . '%');
            });
        }

        $projects = $query->latest()->paginate($request->per_page ?? 50);

        return response()->json($projects);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(StoreProjectRequest $request)
    {
        $data = $request->validated();
        $data['timezone'] = trim((string) ($data['timezone'] ?? '')) ?: 'Asia/Karachi';
        $project = Project::create($data);

        // Create per-project order table
        ProjectOrderService::createTableForProject($project);

        ActivityLog::log('created_project', Project::class, $project->id, null, $project->toArray());
        \App\Services\AuditService::logProjectCreated($project->id, $project->toArray());

        return response()->json([
            'message' => 'Project created successfully',
            'data' => $project->load(['teams', 'users']),
        ], 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(string $id)
    {
        $project = Project::with(['teams.users', 'users', 'invoices'])->findOrFail($id);

        // Load order counts from the per-project dynamic table
        $tableName = \App\Services\ProjectOrderService::getTableName($project->id);
        if (Schema::hasTable($tableName)) {
            $project->setAttribute('order_count', DB::table($tableName)->count());
        }

        return response()->json([
            'data' => $project,
        ]);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(UpdateProjectRequest $request, string $id)
    {
        $project = Project::findOrFail($id);
        $oldValues = $project->toArray();

        $data = $request->validated();
        if (array_key_exists('timezone', $data)) {
            $data['timezone'] = trim((string) $data['timezone']) ?: 'Asia/Karachi';
        }
        $project->update($data);

        ActivityLog::log('updated_project', Project::class, $project->id, $oldValues, $project->toArray());
        \App\Services\AuditService::logProjectUpdated($project->id, $oldValues, $project->fresh()->toArray());

        return response()->json([
            'message' => 'Project updated successfully',
            'data' => $project->load(['teams', 'users']),
        ]);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        $project = Project::findOrFail($id);
        $oldValues = $project->toArray();

        // Drop the per-project order table
        ProjectOrderService::dropTableForProject((int) $id);

        $project->delete();

        ActivityLog::log('deleted_project', Project::class, $id, $oldValues, null);
        \App\Services\AuditService::logProjectDeleted((int)$id, $oldValues);

        return response()->json([
            'message' => 'Project deleted successfully',
        ]);
    }

    /**
     * Get project statistics.
     */
    public function statistics(string $id)
    {
        $project = Project::findOrFail($id);

        $stats = [
            'total_orders' => $project->orders()->count(),
            'pending_orders' => $project->orders()->where('status', 'pending')->count(),
            'in_progress_orders' => $project->orders()->where('status', 'in-progress')->count(),
            'completed_orders' => $project->orders()->where('status', 'completed')->count(),
            'total_teams' => $project->teams()->count(),
            'active_teams' => $project->teams()->where('is_active', true)->count(),
            'total_staff' => $project->users()->count(),
            'active_staff' => $project->users()->where('is_active', true)->count(),
        ];

        return response()->json($stats);
    }

    /**
     * Get teams for a project.
     */
    public function teams(Request $request, string $id)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json([
                'message' => 'Unauthorized',
            ], 401);
        }

        if (in_array($user->role, ['operations_manager', 'project_manager'], true)) {
            $managedProjectIds = array_map('intval', $user->getManagedProjectIds());
            if (!in_array((int) $id, $managedProjectIds, true)) {
                return response()->json([
                    'message' => 'Unauthorized',
                ], 403);
            }
        }

        $project = Project::findOrFail($id);
        $teams = $project->teams()->with('users:id,name,email,role,team_id,is_active,is_absent')->get();

        // Build team metrics only when the dynamic order table/columns exist.
        $tableName = ProjectOrderService::getTableName((int) $project->id);
        $metricsByTeam = collect();

        try {
            if (Schema::hasTable($tableName) && Schema::hasColumn($tableName, 'team_id')) {
                $hasDrawerDone = Schema::hasColumn($tableName, 'drawer_done');
                $hasCheckerDone = Schema::hasColumn($tableName, 'checker_done');
                $hasFinalUpload = Schema::hasColumn($tableName, 'final_upload');
                $hasWorkflowState = Schema::hasColumn($tableName, 'workflow_state');

                $metricsQuery = DB::table($tableName)
                    ->select('team_id')
                    ->whereNotNull('team_id');

                if ($hasDrawerDone) {
                    $metricsQuery->selectRaw("SUM(CASE WHEN drawer_done = 'yes' THEN 1 ELSE 0 END) as raw_done");
                } else {
                    $metricsQuery->selectRaw('0 as raw_done');
                }

                if ($hasCheckerDone) {
                    $metricsQuery->selectRaw("SUM(CASE WHEN checker_done = 'yes' THEN 1 ELSE 0 END) as check_done");
                } else {
                    $metricsQuery->selectRaw('0 as check_done');
                }

                if ($hasFinalUpload) {
                    $metricsQuery->selectRaw("SUM(CASE WHEN final_upload = 'yes' THEN 1 ELSE 0 END) as qa_done");
                } else {
                    $metricsQuery->selectRaw('0 as qa_done');
                }

                if ($hasWorkflowState) {
                    $metricsQuery->selectRaw("SUM(CASE WHEN workflow_state = 'DELIVERED' THEN 1 ELSE 0 END) as total_delivered_orders");
                } else {
                    $metricsQuery->selectRaw('0 as total_delivered_orders');
                }

                $metricsByTeam = $metricsQuery
                    ->groupBy('team_id')
                    ->get()
                    ->keyBy('team_id');
            }
        } catch (\Throwable $e) {
            // Fail safe: keep endpoint working even if dynamic metrics query breaks.
            Log::warning('Project teams metrics fallback triggered', [
                'project_id' => (int) $project->id,
                'table' => $tableName,
                'error' => $e->getMessage(),
            ]);
            $metricsByTeam = collect();
        }

        $teams = $teams->map(function ($team) use ($metricsByTeam) {
            $metrics = $metricsByTeam->get($team->id);

            $team->setAttribute('raw_done', (int) ($metrics->raw_done ?? 0));
            $team->setAttribute('check_done', (int) ($metrics->check_done ?? 0));
            $team->setAttribute('qa_done', (int) ($metrics->qa_done ?? 0));
            $team->setAttribute('total_delivered_orders', (int) ($metrics->total_delivered_orders ?? 0));

            return $team;
        });

        return response()->json([
            'data' => $teams,
        ]);
    }

    /**
     * Create a new team for a project.
     */
    public function createTeam(Request $request, string $id)
    {
        $project = Project::findOrFail($id);

        $request->validate([
            'name' => 'required|string|max:100',
        ]);

        $team = $project->teams()->create([
            'name' => $request->name,
            'is_active' => true,
            'qa_count' => 0,
            'checker_count' => 0,
            'drawer_count' => 0,
            'designer_count' => 0,
        ]);

        return response()->json([
            'message' => 'Team created successfully',
            'data' => $team->load('users:id,name,email,role,team_id,is_active,is_absent'),
        ], 201);
    }

    /**
     * Delete a team (only if no members assigned).
     */
    public function deleteTeam(string $projectId, string $teamId)
    {
        $project = Project::findOrFail($projectId);
        $team = $project->teams()->findOrFail($teamId);

        if ($team->users()->count() > 0) {
            return response()->json([
                'message' => 'Cannot delete team with assigned members. Remove all members first.',
            ], 422);
        }

        $team->delete();

        return response()->json([
            'message' => 'Team deleted successfully',
        ]);
    }
}
