<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<\Database\Factories\UserFactory> */
    use HasFactory, Notifiable, HasApiTokens;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name', 'email', 'password', 'plain_password', 'role', 'country', 'department',
        'project_id', 'team_id', 'old_system_id', 'layer', 'is_active',
        'last_activity', 'inactive_days',
        'current_session_token', 'wip_count', 'wip_limit', 'today_completed',
        'shift_start', 'shift_end', 'is_absent', 'daily_target',
        'avg_completion_minutes', 'rejection_rate_30d', 'assignment_score', 'skills',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Appended computed attributes.
     */
    protected $appends = ['is_online'];

    /**
     * Determine if the user is currently online.
     * Online = has a session token AND was active in the last 5 minutes.
     */
    public function getIsOnlineAttribute(): bool
    {
        return $this->current_session_token !== null
            && $this->last_activity !== null
            && $this->last_activity->gt(now()->subMinutes(5));
    }

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'last_activity' => 'datetime',
            'is_active' => 'boolean',
            'is_absent' => 'boolean',
            'shift_start' => 'datetime:H:i',
            'shift_end' => 'datetime:H:i',
            'skills' => 'array',
            'avg_completion_minutes' => 'decimal:2',
            'rejection_rate_30d' => 'decimal:4',
            'assignment_score' => 'decimal:4',
        ];
    }

    /**
     * Get the project that the user belongs to.
     */
    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * Get the team that the user belongs to.
     */
    public function team()
    {
        return $this->belongsTo(Team::class);
    }

    /**
     * Get teams that this user leads (for QA role).
     */
    public function ledTeams()
    {
        return $this->hasMany(Team::class, 'qa_user_id');
    }

    /**
     * Get all work assignments for the user.
     */
    public function workAssignments()
    {
        return $this->hasMany(WorkAssignment::class);
    }

    /**
     * Projects managed by this user (for project_manager role — multiple projects allowed).
     */
    public function managedProjects()
    {
        return $this->belongsToMany(Project::class, 'project_manager_projects');
    }

    /**
     * Projects assigned to this operation manager (M2M — can have multiple).
     */
    public function omProjects()
    {
        return $this->belongsToMany(Project::class, 'operation_manager_projects');
    }

    /**
     * Get project IDs this user manages based on role.
     * - OM: from operation_manager_projects pivot (multiple)
     * - PM: from project_manager_projects pivot (multiple allowed)
     * - Others: fallback to project_id column
     */
    public function getManagedProjectIds(): array
    {
        // Cache on the model instance to avoid repeated pivot queries in the same request
        if (isset($this->cachedManagedProjectIds)) {
            return $this->cachedManagedProjectIds;
        }

        if ($this->role === 'operations_manager') {
            $ids = $this->omProjects()->pluck('projects.id')->toArray();
            // Fallback to project_id if pivot is empty (backward compat)
            $result = !empty($ids) ? $ids : ($this->project_id ? [(int) $this->project_id] : []);
        } elseif ($this->role === 'project_manager') {
            $result = $this->managedProjects()->pluck('projects.id')->toArray();
        } else {
            $result = $this->project_id ? [(int) $this->project_id] : [];
        }

        $this->cachedManagedProjectIds = $result;
        return $result;
    }

    /**
     * Get all activity logs for the user.
     */
    public function activityLogs()
    {
        return $this->hasMany(ActivityLog::class);
    }

    public function sessions()
    {
        return $this->hasMany(UserSession::class);
    }

    public function workItems()
    {
        return $this->hasMany(WorkItem::class, 'assigned_user_id');
    }
}
