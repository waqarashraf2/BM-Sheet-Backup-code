<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class IssueFlag extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_id',
        'flagged_by',
        'project_id',
        'flag_type',
        'description',
        'severity',
        'status',
        'resolved_by',
        'resolved_at',
        'resolution_notes',
    ];

    protected $casts = [
        'resolved_at' => 'datetime',
    ];

    const FLAG_TYPES = [
        'quality',
        'missing_info',
        'wrong_specs',
        'unclear_instructions',
        'file_issue',
        'other',
    ];

    /**
     * Dynamically resolve the order from the per-project table.
     * Cannot use simple belongsTo because orders live in project_{id}_orders.
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

    public function flagger()
    {
        return $this->belongsTo(User::class, 'flagged_by');
    }

    public function resolver()
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }

    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    public function scopeOpen($query)
    {
        return $query->where('status', 'open');
    }

    public function scopeResolved($query)
    {
        return $query->where('status', 'resolved');
    }
}
