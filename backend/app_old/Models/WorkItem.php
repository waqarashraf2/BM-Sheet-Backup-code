<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WorkItem extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_id', 'project_id', 'stage', 'assigned_user_id', 'team_id',
        'status', 'assigned_at', 'started_at', 'completed_at',
        'time_spent_seconds', 'last_timer_start',
        'comments', 'flags', 'rework_reason', 'rejection_code', 'attempt_number',
    ];

    protected $casts = [
        'assigned_at' => 'datetime',
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
        'last_timer_start' => 'datetime',
        'flags' => 'array',
    ];

    /**
     * Eloquent relationship for eager-loading.
     * Resolves the correct per-project table dynamically.
     */
    public function order()
    {
        $related = new Order;
        if ($this->project_id) {
            $related->setTable("project_{$this->project_id}_orders");
        }
        return new \Illuminate\Database\Eloquent\Relations\BelongsTo(
            $related->newQuery(), $this, 'order_id', 'id', 'order'
        );
    }

    /**
     * Accessor fallback — used when accessing $workItem->order without eager-loading.
     * Resolves the correct project table since IDs are per-project.
     */
    public function getOrderAttribute(): ?Order
    {
        // If the relationship was already loaded, return it
        if ($this->relationLoaded('order')) {
            return $this->getRelation('order');
        }
        if (!$this->project_id || !$this->order_id) return null;
        $order = Order::findInProject($this->project_id, $this->order_id);
        // Cache it so subsequent accesses don't re-query
        $this->setRelation('order', $order);
        return $order;
    }

    public function project() { return $this->belongsTo(Project::class); }
    public function assignedUser() { return $this->belongsTo(User::class, 'assigned_user_id'); }
    public function team() { return $this->belongsTo(Team::class); }

    public function scopeForStage($query, string $stage) { return $query->where('stage', $stage); }
    public function scopePending($query) { return $query->where('status', 'pending'); }
    public function scopeInProgress($query) { return $query->where('status', 'in_progress'); }
    public function scopeCompleted($query) { return $query->where('status', 'completed'); }
}
