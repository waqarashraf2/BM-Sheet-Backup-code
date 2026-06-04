<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Models\ActivityLog;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Http\Request;

class UserController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $query = User::with(['project', 'team']);

        // Scope by role
        $authUser = $request->user();
        if ($authUser->role === 'ceo') {
            // CEO only sees Directors and Operations Managers
            $query->whereIn('role', ['director', 'operations_manager']);
        } elseif ($authUser->role === 'project_manager') {
            // PM sees only workers in their team/projects — NOT other PMs or themselves
            // Only OM can manage PM accounts
            $query->where('id', '!=', $authUser->id);
            $query->where('role', '!=', 'project_manager');
            if ($authUser->team_id) {
                $query->where('team_id', $authUser->team_id);
            } else {
                $managedIds = $authUser->getManagedProjectIds();
                $query->whereIn('project_id', $managedIds);
            }
        } elseif ($authUser->role === 'operations_manager') {
            $managedIds = $authUser->getManagedProjectIds();
            $query->where(function ($q) use ($managedIds, $authUser) {
                // OM sees workers in their projects + PMs assigned to their projects + self
                $q->whereIn('project_id', $managedIds)
                  ->orWhereHas('managedProjects', function ($sub) use ($managedIds) {
                      $sub->whereIn('projects.id', $managedIds);
                  })
                  ->orWhere('id', $authUser->id);
            });
        }

        // Filter by role
        if ($request->has('role')) {
            $query->where('role', $request->role);
        }

        // Filter by country
        if ($request->has('country')) {
            $query->where('country', $request->country);
        }

        // Filter by department
        if ($request->has('department')) {
            $query->where('department', $request->department);
        }

        // Filter by project
        if ($request->has('project_id')) {
            $query->where('project_id', $request->project_id);
        }

        // Filter by team
        if ($request->has('team_id')) {
            $query->where('team_id', $request->team_id);
        }

        // Filter by status
        if ($request->has('is_active')) {
            $query->where('is_active', $request->is_active);
        }

        // Search by name or email
        if ($request->has('search')) {
            $query->where(function ($q) use ($request) {
                $q->where('name', 'like', '%' . $request->search . '%')
                  ->orWhere('email', 'like', '%' . $request->search . '%');
            });
        }

        $users = $query->latest()->paginate($request->per_page ?? 15);

        return response()->json($users);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(StoreUserRequest $request)
    {
        $data = $request->validated();
        // Password is auto-hashed by User model's 'hashed' cast

        // Store plain text password so PM/OM can view it later
        if (!empty($data['password'])) {
            $data['plain_password'] = $data['password'];
        }

        // Auto-derive country from project if not provided
        if (empty($data['country']) && !empty($data['project_id'])) {
            $project = \App\Models\Project::find($data['project_id']);
            if ($project) {
                $data['country'] = $project->country;
            }
        }

        $user = User::create($data);

        ActivityLog::log('created_user', User::class, $user->id, null, $user->toArray());
        \App\Services\AuditService::logUserCreated($user->id, $user->toArray());

        return response()->json([
            'message' => 'User created successfully',
            'data' => $user->load(['project', 'team']),
        ], 201);
    }

    /**
     * Display the specified resource.
     */
    public function show(string $id)
    {
        $user = User::with(['project', 'team', 'workAssignments.order'])->findOrFail($id);

        return response()->json([
            'data' => $user,
        ]);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(UpdateUserRequest $request, string $id)
    {
        $user = User::findOrFail($id);
        $authUser = $request->user();

        // PM can only update users in their team/project scope — NOT themselves
        if ($authUser->role === 'project_manager') {
            // Block self-edit — only OM can edit a PM's own record
            if ((int)$user->id === (int)$authUser->id) {
                return response()->json(['message' => 'You cannot edit your own account. Contact your Operations Manager.'], 403);
            }
            $canEdit = false;
            if ($authUser->team_id && $user->team_id === $authUser->team_id) {
                $canEdit = true;
            } elseif (!$authUser->team_id) {
                $managedIds = $authUser->getManagedProjectIds();
                if (in_array($user->project_id, $managedIds)) {
                    $canEdit = true;
                }
            }
            if (!$canEdit) {
                return response()->json(['message' => 'You can only edit users in your team.'], 403);
            }
        }

        $oldValues = $user->toArray();
        $oldProjectId = $user->project_id;

        $data = $request->validated();
        // Password is auto-hashed by User model's 'hashed' cast

        // Store plain text password so PM/OM can view it later
        if (!empty($data['password'])) {
            $data['plain_password'] = $data['password'];
        }

        $user->update($data);

        ActivityLog::log('updated_user', User::class, $user->id, $oldValues, $user->toArray());
        \App\Services\AuditService::logUserUpdated($user->id, $oldValues, $user->fresh()->toArray());

        // Log project switch if project_id changed
        if (isset($data['project_id']) && $data['project_id'] != $oldProjectId) {
            \App\Services\AuditService::logResourceSwitch(
                $user->id,
                $oldProjectId,
                $data['project_id'],
                'User project changed via update'
            );
        }

        return response()->json([
            'message' => 'User updated successfully',
            'data' => $user->load(['project', 'team']),
        ]);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        $user = User::findOrFail($id);
        $authUser = auth()->user();

        // Prevent self-deletion
        if ((int)$id === (int)$authUser->id) {
            return response()->json(['message' => 'You cannot delete yourself.'], 403);
        }

        // Role hierarchy check: prevent deleting users at same or higher level
        $roleHierarchy = ['ceo' => 6, 'director' => 5, 'operations_manager' => 4, 'project_manager' => 3, 'accounts_manager' => 3, 'qa' => 2, 'live_qa' => 2, 'drawer' => 1, 'checker' => 1, 'designer' => 1];
        $authLevel = $roleHierarchy[$authUser->role] ?? 0;
        $targetLevel = $roleHierarchy[$user->role] ?? 0;

        if ($targetLevel >= $authLevel) {
            return response()->json(['message' => 'You cannot delete a user with equal or higher role.'], 403);
        }

        $oldValues = $user->toArray();

        $user->delete();

        ActivityLog::log('deleted_user', User::class, $id, $oldValues, null);
        \App\Services\AuditService::logUserDeleted((int)$id, $oldValues);

        return response()->json([
            'message' => 'User deleted successfully',
        ]);
    }

    /**
     * Update user activity timestamp.
     */
    public function updateActivity(string $id)
    {
        $user = User::findOrFail($id);
        $user->update([
            'last_activity' => now(),
            'inactive_days' => 0,
        ]);

        return response()->json([
            'message' => 'Activity updated',
        ]);
    }

    /**
     * Get inactive users.
     */
    public function inactive()
    {
        $users = User::where('inactive_days', '>', 0)
            ->orWhere('last_activity', '<', now()->subDays(1))
            ->with(['project', 'team'])
            ->get();

        return response()->json($users);
    }

    /**
     * Deactivate a user and reassign their work.
     */
    public function deactivate(string $id)
    {
        $user = User::findOrFail($id);
        $oldValues = ['is_active' => $user->is_active];

        $user->update(['is_active' => false, 'is_absent' => true]);

        // Reassign any active work
        \App\Services\AssignmentEngine::reassignFromUser($user, auth()->id());

        NotificationService::userDeactivated($user, auth()->user());

        ActivityLog::log('deactivated_user', User::class, $user->id, $oldValues, ['is_active' => false]);
        \App\Services\AuditService::logUserDeactivated($user->id, $user->name);

        return response()->json([
            'message' => 'User deactivated and work reassigned.',
            'data' => $user->fresh(),
        ]);
    }

    /**
     * Reassign all work from a user.
     */
    public function reassignWork(Request $request)
    {
        $request->validate(['user_id' => 'required|exists:users,id']);

        $user = User::findOrFail($request->user_id);
        \App\Services\AssignmentEngine::reassignFromUser($user, auth()->id());

        ActivityLog::log('reassigned_work', User::class, $user->id, null, ['reassigned_by' => auth()->id()]);

        return response()->json([
            'message' => 'All work reassigned from user.',
            'data' => $user->fresh(),
        ]);
    }
}
