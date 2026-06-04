<?php

namespace App\Services;

use App\Models\ActivityLog;
use Illuminate\Support\Facades\Auth;

class AuditService
{
    /**
     * Log an action with full context.
     */
    public static function log(
        ?int $actorId,
        string $action,
        ?string $entityType = null,
        ?int $entityId = null,
        ?int $projectId = null,
        ?array $before = null,
        ?array $after = null
    ): ActivityLog {
        return ActivityLog::create([
            'user_id'     => $actorId ?? Auth::id(),
            'action'      => $action,
            'entity_type' => $entityType,
            'entity_id'   => $entityId,
            'project_id'  => $projectId,
            'model_type'  => $entityType,
            'model_id'    => $entityId,
            'old_values'  => $before,
            'new_values'  => $after,
            'ip_address'  => request()->ip(),
            'user_agent'  => request()->userAgent(),
        ]);
    }

    /**
     * Log a login attempt.
     */
    public static function logLogin(int $userId, bool $success, ?string $reason = null): ActivityLog
    {
        return self::log(
            $userId,
            $success ? 'LOGIN' : 'LOGIN_FAILED',
            'User',
            $userId,
            null,
            null,
            ['success' => $success, 'reason' => $reason, 'ip' => request()->ip()]
        );
    }

    /**
     * Log a logout.
     */
    public static function logLogout(int $userId): ActivityLog
    {
        return self::log($userId, 'LOGOUT', 'User', $userId);
    }

    /**
     * Log an assignment action.
     */
    public static function logAssignment(int $orderId, int $projectId, ?int $fromUserId, ?int $toUserId, string $reason = 'auto'): ActivityLog
    {
        return self::log(
            Auth::id(),
            'ASSIGN',
            'Order',
            $orderId,
            $projectId,
            ['assigned_to' => $fromUserId],
            ['assigned_to' => $toUserId, 'reason' => $reason]
        );
    }

    /**
     * Log an invoice action.
     */
    public static function logInvoiceAction(int $invoiceId, int $projectId, string $action, ?array $before = null, ?array $after = null): ActivityLog
    {
        return self::log(Auth::id(), $action, 'Invoice', $invoiceId, $projectId, $before, $after);
    }

    /**
     * Log month lock/unlock.
     */
    public static function logMonthLock(int $lockId, int $projectId, string $action): ActivityLog
    {
        return self::log(Auth::id(), $action, 'MonthLock', $lockId, $projectId);
    }

    /**
     * Log PM project assignment/switch.
     */
    public static function logPMProjectAssignment(int $pmId, array $oldProjectIds, array $newProjectIds): ActivityLog
    {
        return self::log(
            Auth::id(),
            'PM_PROJECT_ASSIGNED',
            'User',
            $pmId,
            null,
            ['project_ids' => $oldProjectIds],
            ['project_ids' => $newProjectIds, 'assigned_by' => Auth::id()]
        );
    }

    /**
     * Log OM project assignment/switch.
     */
    public static function logOMProjectAssignment(int $omId, array $oldProjectIds, array $newProjectIds): ActivityLog
    {
        return self::log(
            Auth::id(),
            'OM_PROJECT_ASSIGNED',
            'User',
            $omId,
            null,
            ['project_ids' => $oldProjectIds],
            ['project_ids' => $newProjectIds, 'assigned_by' => Auth::id()]
        );
    }

    /**
     * Log worker/resource project switch (user moved to different project).
     */
    public static function logResourceSwitch(int $userId, ?int $oldProjectId, ?int $newProjectId, string $reason = ''): ActivityLog
    {
        return self::log(
            Auth::id(),
            'RESOURCE_PROJECT_SWITCH',
            'User',
            $userId,
            $newProjectId,
            ['project_id' => $oldProjectId],
            ['project_id' => $newProjectId, 'reason' => $reason, 'switched_by' => Auth::id()]
        );
    }

    /**
     * Log order reassignment between workers.
     */
    public static function logOrderReassignment(int $orderId, int $projectId, ?int $fromUserId, ?int $toUserId, string $reason = ''): ActivityLog
    {
        return self::log(
            Auth::id(),
            'ORDER_REASSIGNED',
            'Order',
            $orderId,
            $projectId,
            ['assigned_to' => $fromUserId],
            ['assigned_to' => $toUserId, 'reason' => $reason, 'reassigned_by' => Auth::id()]
        );
    }

    /**
     * Log QA supervisor assignment.
     */
    public static function logQAAssignment(int $orderId, int $projectId, ?int $qaSupervisorId): ActivityLog
    {
        return self::log(
            Auth::id(),
            'QA_ASSIGNED',
            'Order',
            $orderId,
            $projectId,
            null,
            ['qa_supervisor_id' => $qaSupervisorId, 'assigned_by' => Auth::id()]
        );
    }

    /**
     * Log user creation.
     */
    public static function logUserCreated(int $userId, array $userData): ActivityLog
    {
        return self::log(
            Auth::id(),
            'USER_CREATED',
            'User',
            $userId,
            $userData['project_id'] ?? null,
            null,
            [
                'name' => $userData['name'] ?? null,
                'email' => $userData['email'] ?? null,
                'role' => $userData['role'] ?? null,
                'project_id' => $userData['project_id'] ?? null,
                'team_id' => $userData['team_id'] ?? null,
                'created_by' => Auth::id(),
            ]
        );
    }

    /**
     * Log user update with field-level diff.
     */
    public static function logUserUpdated(int $userId, array $oldValues, array $newValues): ActivityLog
    {
        $trackedFields = ['name', 'email', 'role', 'project_id', 'team_id', 'country', 'department', 'daily_target', 'is_active', 'is_absent'];
        $changes = [];
        $before = [];

        foreach ($trackedFields as $field) {
            $oldVal = $oldValues[$field] ?? null;
            $newVal = $newValues[$field] ?? null;
            if ($oldVal != $newVal && array_key_exists($field, $newValues)) {
                $before[$field] = $oldVal;
                $changes[$field] = $newVal;
            }
        }

        if (empty($changes)) {
            // No tracked fields changed, still log generic update
            $changes = ['_note' => 'non-tracked fields updated'];
        }

        $changes['updated_by'] = Auth::id();

        return self::log(
            Auth::id(),
            'USER_UPDATED',
            'User',
            $userId,
            $newValues['project_id'] ?? $oldValues['project_id'] ?? null,
            $before,
            $changes
        );
    }

    /**
     * Log user deactivation.
     */
    public static function logUserDeactivated(int $userId, string $userName): ActivityLog
    {
        return self::log(
            Auth::id(),
            'USER_DEACTIVATED',
            'User',
            $userId,
            null,
            ['is_active' => true],
            ['is_active' => false, 'deactivated_by' => Auth::id(), 'user_name' => $userName]
        );
    }

    /**
     * Log user deletion.
     */
    public static function logUserDeleted(int $userId, array $oldData): ActivityLog
    {
        return self::log(
            Auth::id(),
            'USER_DELETED',
            'User',
            $userId,
            $oldData['project_id'] ?? null,
            ['name' => $oldData['name'] ?? null, 'email' => $oldData['email'] ?? null, 'role' => $oldData['role'] ?? null],
            ['deleted_by' => Auth::id()]
        );
    }

    /**
     * Log project creation.
     */
    public static function logProjectCreated(int $projectId, array $data): ActivityLog
    {
        return self::log(
            Auth::id(),
            'PROJECT_CREATED',
            'Project',
            $projectId,
            $projectId,
            null,
            ['name' => $data['name'] ?? null, 'code' => $data['code'] ?? null, 'country' => $data['country'] ?? null, 'created_by' => Auth::id()]
        );
    }

    /**
     * Log project update with field-level diff.
     */
    public static function logProjectUpdated(int $projectId, array $oldValues, array $newValues): ActivityLog
    {
        $trackedFields = ['name', 'code', 'country', 'department', 'status', 'client_name', 'daily_target', 'description'];
        $changes = [];
        $before = [];

        foreach ($trackedFields as $field) {
            $oldVal = $oldValues[$field] ?? null;
            $newVal = $newValues[$field] ?? null;
            if ($oldVal != $newVal && array_key_exists($field, $newValues)) {
                $before[$field] = $oldVal;
                $changes[$field] = $newVal;
            }
        }

        if (empty($changes)) {
            $changes = ['_note' => 'non-tracked fields updated'];
        }
        $changes['updated_by'] = Auth::id();

        return self::log(Auth::id(), 'PROJECT_UPDATED', 'Project', $projectId, $projectId, $before, $changes);
    }

    /**
     * Log project deletion.
     */
    public static function logProjectDeleted(int $projectId, array $oldData): ActivityLog
    {
        return self::log(
            Auth::id(),
            'PROJECT_DELETED',
            'Project',
            $projectId,
            $projectId,
            ['name' => $oldData['name'] ?? null, 'code' => $oldData['code'] ?? null],
            ['deleted_by' => Auth::id()]
        );
    }
}
