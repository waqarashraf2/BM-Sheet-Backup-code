<?php

namespace App\Models;

use App\Services\ProjectOrderService;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Project extends Model
{
    use HasFactory, SoftDeletes;

    private const CHECKER_COMPLETION_PROJECT_IDS = [1, 2, 3];

    protected $fillable = [
        'code', 'name', 'queue_name', 'country', 'department', 'client_name', 'status',
        'total_orders', 'completed_orders', 'pending_orders',
        'total_teams', 'active_teams', 'total_staff', 'active_staff',
        'workflow_layers', 'metadata', 'timezone',
        'workflow_type', 'sla_config', 'invoice_categories_config',
        'client_portal_config', 'target_config', 'wip_cap', 'action',
    ];

    protected $casts = [
        'workflow_layers' => 'array',
        'metadata' => 'array',
        'sla_config' => 'array',
        'invoice_categories_config' => 'array',
        'client_portal_config' => 'array',
        'target_config' => 'array',
        'total_orders' => 'integer',
        'completed_orders' => 'integer',
        'pending_orders' => 'integer',
        'total_teams' => 'integer',
        'active_teams' => 'integer',
        'total_staff' => 'integer',
        'active_staff' => 'integer',
        'wip_cap' => 'integer',
        'action' => 'boolean',
    ];

    /**
     * Get all teams for this project.
     */
    public function teams()
    {
        return $this->hasMany(Team::class);
    }

    /**
     * Get all orders for this project (from dynamic per-project table).
     */
    public function orders()
    {
        if ($this->exists && $this->id) {
            $tableName = ProjectOrderService::getTableName($this->id);
            $instance = new Order;
            $instance->setTable($tableName);
            return new \Illuminate\Database\Eloquent\Relations\HasMany(
                $instance->newQuery(), $this, $tableName . '.project_id', 'id'
            );
        }
        return $this->hasMany(Order::class);
    }

    /**
     * Get all users assigned to this project.
     */
    public function users()
    {
        return $this->hasMany(User::class);
    }

    /**
     * Get project managers assigned to this project (M2M pivot).
     */
    public function projectManagers()
    {
        return $this->belongsToMany(User::class, 'project_manager_projects');
    }

    /**
     * Get operation managers assigned to this project (M2M pivot).
     */
    public function operationManagers()
    {
        return $this->belongsToMany(User::class, 'operation_manager_projects');
    }

    /**
     * Get all invoices for this project.
     */
    public function invoices()
    {
        return $this->hasMany(Invoice::class);
    }

    /**
     * Scope a query to only include active projects.
     */
    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }

    /**
     * Scope a query to filter by country.
     */
    public function scopeCountry($query, $country)
    {
        return $query->where('country', $country);
    }

    /**
     * Scope a query to filter by department.
     */
    public function scopeDepartment($query, $department)
    {
        return $query->where('department', $department);
    }

    /**
     * Projects where checker submission is the final delivery step.
     */
    public static function checkerCompletesOrder(?int $projectId): bool
    {
        if (!$projectId) {
            return false;
        }

        return in_array((int) $projectId, self::CHECKER_COMPLETION_PROJECT_IDS, true);
    }
}
