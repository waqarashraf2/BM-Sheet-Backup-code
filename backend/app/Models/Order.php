<?php

namespace App\Models;

use App\Services\ProjectOrderService;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Order model with per-project dynamic table support.
 *
 * Each project stores its orders in `project_{id}_orders`.
 * Each table uses its own auto-increment ID.
 * Orders are identified by (project_id, id) pair.
 *
 * Usage:
 *   Order::forProject($projectId)->where('workflow_state', ...)->get();
 *   Order::findInProject($projectId, $id);
 *   Order::createForProject($projectId, [...]);
 */
class Order extends Model
{
    use HasFactory;

    private static array $tableColumnsCache = [];

    /**
     * Default table — overridden at runtime by forProject().
     */
    protected $table = 'orders';

    /**
     * Auto-increment per project table.
     */
    public $incrementing = true;

    protected $fillable = [
        'order_number', 'project_id', 'batch_number', 'client_reference',
        'address', 'client_name', 'company', 'branch', 'photographer', 'client_portal_id',
        'current_layer', 'status', 'workflow_state', 'workflow_type',
        'assigned_to', 'qa_supervisor_id', 'team_id', 'priority',
        'complexity_weight', 'estimated_minutes', 'order_type',
        'received_at', 'started_at', 'completed_at', 'delivered_at', 'due_date',
        'year', 'month', 'date', 'ausDatein',
        'code', 'plan_type', 'instruction', 'bedrooms', 'images', 'project_type', 'due_in',
        'total_raw_files', 'hdr_images_count', 'single_images_count', 'final_images_count', 'edited_images_count',
        'it_datetime',
        'metadata', 'import_source', 'import_log_id',
        'recheck_count', 'rejected_by', 'rejected_at',
        'rejection_reason', 'rejection_type', 'checker_self_corrected',
        'client_portal_id', 'client_portal_synced_at',
        'attempt_draw', 'attempt_check', 'attempt_qa',
        'is_on_hold', 'hold_reason', 'hold_set_by',
        'supervisor_notes', 'attachments',
        'pre_hold_state',
        // Assignment role columns
        'drawer_id', 'drawer_name', 'dassign_time',
        'checker_id', 'checker_name', 'cassign_time',
        'file_uploader_id', 'file_uploader_name', 'fassign_time',
        'qa_id', 'qa_name',
        'drawer_done', 'drawer_date',
        'checker_done', 'checker_date',
        'file_uploaded', 'file_upload_date',
        'final_upload', 'ausFinaldate',
    ];

    protected $casts = [
        'received_at' => 'datetime',
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
        'delivered_at' => 'datetime',
        'rejected_at' => 'datetime',
        'client_portal_synced_at' => 'datetime',
        'ausDatein' => 'datetime',
        'due_date' => 'date',
        'metadata' => 'array',
        'attachments' => 'array',
        'images' => 'integer',
        'total_raw_files' => 'integer',
        'hdr_images_count' => 'integer',
        'single_images_count' => 'integer',
        'final_images_count' => 'integer',
        'edited_images_count' => 'integer',
        'it_datetime' => 'datetime',
        'checker_self_corrected' => 'boolean',
        'is_on_hold' => 'boolean',
    ];

    private static function filterAttributesForTable(string $tableName, array $attributes): array
    {
        if (!array_key_exists($tableName, self::$tableColumnsCache)) {
            self::$tableColumnsCache[$tableName] = Schema::hasTable($tableName)
                ? array_flip(Schema::getColumnListing($tableName))
                : null;
        }

        if (self::$tableColumnsCache[$tableName] === null) {
            return $attributes;
        }

        return array_intersect_key($attributes, self::$tableColumnsCache[$tableName]);
    }

    // ─── Dynamic Table Resolution ───────────────────────────────────

    /**
     * Return a new query builder scoped to a specific project's order table.
     * PRIMARY entry point for all project-scoped queries.
     */
    public static function forProject(int $projectId): \Illuminate\Database\Eloquent\Builder
    {
        $instance = new static;
        $instance->setTable(ProjectOrderService::getTableName($projectId));
        return $instance->newQuery();
    }

    /**
     * Find an order in a specific project table.
     * Ensures the model's project_id matches the table it was found in.
     */
    public static function findInProject(int $projectId, int $id, array $columns = ['*']): ?static
    {
        $instance = new static;
        $instance->setTable(ProjectOrderService::getTableName($projectId));
        $order = $instance->newQuery()->find($id, $columns);
        if ($order) {
            // Ensure the model knows which table it belongs to
            // (legacy data may have wrong project_id in the row)
            $order->project_id = $projectId;
            $order->setTable(ProjectOrderService::getTableName($projectId));
        }
        return $order;
    }

    /**
     * Find an order by its ID when you don't know the project.
     * Scans all project tables — use findInProject() when project is known.
     */
    public static function findByGlobalId(int $id, array $columns = ['*']): ?static
    {
        $projectId = ProjectOrderService::findProjectForOrder($id);
        if (!$projectId) return null;

        return static::findInProject($projectId, $id, $columns);
    }

    /**
     * Find an order by global ID or throw 404.
     */
    public static function findOrFailGlobal(int $id, array $columns = ['*']): static
    {
        $order = static::findByGlobalId($id, $columns);
        if (!$order) {
            throw (new \Illuminate\Database\Eloquent\ModelNotFoundException)->setModel(static::class, [$id]);
        }
        return $order;
    }

    /**
     * Create an order in a project's table. ID is auto-incremented by MySQL.
     */
    public static function createForProject(int $projectId, array $attributes): static
    {
        if (!isset($attributes['order_number'])) {
            $attributes['order_number'] = 'ORD-' . now()->timestamp . '-' . rand(1000, 9999);
        }
        $attributes['project_id'] = $projectId;

        $instance = new static;
        $instance->setTable(ProjectOrderService::getTableName($projectId));
        $attributes = self::filterAttributesForTable($instance->getTable(), $attributes);

        $model = $instance->newInstance($attributes);
        $model->setTable(ProjectOrderService::getTableName($projectId));
        $model->save();

        return $model;
    }

    /**
     * Ensure the model knows its correct table when saving/updating.
     */
    public function save(array $options = [])
    {
        if ($this->project_id) {
            $this->setTable(ProjectOrderService::getTableName($this->project_id));
            $this->attributes = self::filterAttributesForTable($this->getTable(), $this->attributes);
        }
        return parent::save($options);
    }

    /**
     * Ensure updates go to the right table.
     */
    public function update(array $attributes = [], array $options = [])
    {
        if ($this->project_id) {
            $this->setTable(ProjectOrderService::getTableName($this->project_id));
            $attributes = self::filterAttributesForTable($this->getTable(), $attributes);
        }
        return parent::update($attributes, $options);
    }

    /**
     * Ensure deletes go to the right table.
     */
    public function delete()
    {
        if ($this->project_id) {
            $this->setTable(ProjectOrderService::getTableName($this->project_id));
        }
        return parent::delete();
    }

    /**
     * Refresh from the correct project table.
     */
    public function fresh($with = [])
    {
        if ($this->project_id) {
            $this->setTable(ProjectOrderService::getTableName($this->project_id));
        }
        return parent::fresh($with);
    }

    /**
     * Ensure newInstance preserves the dynamic table.
     */
    public function newInstance($attributes = [], $exists = false)
    {
        $model = parent::newInstance($attributes, $exists);
        if ($this->getTable() !== 'orders') {
            $model->setTable($this->getTable());
        }
        return $model;
    }

    // ─── Cross-Project Queries ──────────────────────────────────────

    /**
     * Query across multiple project tables (UNION).
     * For dashboard aggregations spanning projects.
     */
    public static function acrossProjects(array $projectIds, ?\Closure $queryModifier = null): \Illuminate\Support\Collection
    {
        if (empty($projectIds)) {
            return collect();
        }

        // Cache table existence for the lifetime of this request
        static $tableExistsCache = [];

        $queries = [];
        foreach ($projectIds as $pid) {
            $tableName = ProjectOrderService::getTableName($pid);
            if (!isset($tableExistsCache[$tableName])) {
                $tableExistsCache[$tableName] = Schema::hasTable($tableName);
            }
            if (!$tableExistsCache[$tableName]) continue;

            $query = DB::table($tableName);
            if ($queryModifier) {
                $queryModifier($query, $pid);
            }
            $queries[] = $query;
        }

        if (empty($queries)) {
            return collect();
        }

        $first = array_shift($queries);
        foreach ($queries as $q) {
            $first->unionAll($q);
        }

        return $first->get();
    }

    /**
     * Count across multiple project tables.
     */
    public static function countAcrossProjects(array $projectIds, ?\Closure $queryModifier = null): int
    {
        // Cache table existence for the lifetime of this request
        static $tableExistsCache = [];

        $total = 0;
        foreach ($projectIds as $pid) {
            $tableName = ProjectOrderService::getTableName($pid);
            if (!isset($tableExistsCache[$tableName])) {
                $tableExistsCache[$tableName] = Schema::hasTable($tableName);
            }
            if (!$tableExistsCache[$tableName]) continue;

            $query = DB::table($tableName);
            if ($queryModifier) {
                $queryModifier($query, $pid);
            }
            $total += $query->count();
        }
        return $total;
    }

    /**
     * Run a raw DB query per project table and merge results.
     * Ideal for dashboard aggregations with selectRaw + groupBy.
     *
     * @param array $projectIds
     * @param \Closure $queryBuilder fn(Builder $query, int $projectId) → void
     * @return \Illuminate\Support\Collection
     */
    public static function queryAcrossProjects(array $projectIds, \Closure $queryBuilder): \Illuminate\Support\Collection
    {
        // Cache table existence for the lifetime of this request (avoid repeated SHOW TABLES queries)
        static $tableExistsCache = [];

        $results = collect();
        foreach ($projectIds as $pid) {
            $tableName = ProjectOrderService::getTableName($pid);
            if (!isset($tableExistsCache[$tableName])) {
                $tableExistsCache[$tableName] = Schema::hasTable($tableName);
            }
            if (!$tableExistsCache[$tableName]) continue;

            $query = DB::table($tableName);
            $queryBuilder($query, $pid);
            $results = $results->merge($query->get());
        }
        return $results;
    }

    // ─── Relationships ──────────────────────────────────────────────

    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    public function assignedUser()
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    public function qaSupervisor()
    {
        return $this->belongsTo(User::class, 'qa_supervisor_id');
    }

    public function team()
    {
        return $this->belongsTo(Team::class);
    }

    public function workAssignments()
    {
        return $this->hasMany(WorkAssignment::class);
    }

    public function workItems()
    {
        return $this->hasMany(WorkItem::class);
    }

    public function importLog()
    {
        return $this->belongsTo(OrderImportLog::class, 'import_log_id');
    }

    public function rejectedBy()
    {
        return $this->belongsTo(User::class, 'rejected_by');
    }

    public function checklists()
    {
        return $this->hasMany(OrderChecklist::class);
    }

    // ─── Instance Methods ───────────────────────────────────────────

    public function hasCompletedChecklist(): bool
    {
        $project = $this->project;
        $requiredItems = ChecklistTemplate::where('project_id', $project->id)
            ->where('layer', $this->current_layer)
            ->where('is_required', true)
            ->where('is_active', true)
            ->pluck('id');

        if ($requiredItems->isEmpty()) {
            return true;
        }

        $completedItems = $this->checklists()
            ->whereIn('checklist_template_id', $requiredItems)
            ->where('is_checked', true)
            ->pluck('checklist_template_id');

        return $requiredItems->diff($completedItems)->isEmpty();
    }

    public function reject(int $rejectedById, string $reason, string $type = 'quality')
    {
        $this->update([
            'status' => 'pending',
            'current_layer' => 'drawer',
            'rejected_by' => $rejectedById,
            'rejected_at' => now(),
            'rejection_reason' => $reason,
            'rejection_type' => $type,
            'recheck_count' => $this->recheck_count + 1,
            'assigned_to' => null,
        ]);
    }

    public function markSelfCorrected()
    {
        $this->update(['checker_self_corrected' => true]);
    }

    public function markSyncedToClientPortal()
    {
        $this->update(['client_portal_synced_at' => now()]);
    }

    // ─── Scopes ─────────────────────────────────────────────────────

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeInProgress($query)
    {
        return $query->where('status', 'in-progress');
    }

    public function scopePriority($query, $priority)
    {
        return $query->where('priority', $priority);
    }

    public function scopeLayer($query, $layer)
    {
        return $query->where('current_layer', $layer);
    }

    public function scopeRejected($query)
    {
        return $query->whereNotNull('rejected_at');
    }

    public function scopeNeedsRecheck($query)
    {
        return $query->where('recheck_count', '>', 0)->where('status', 'pending');
    }

    public function scopeUnsynced($query)
    {
        return $query->where('status', 'completed')->whereNull('client_portal_synced_at');
    }
}
