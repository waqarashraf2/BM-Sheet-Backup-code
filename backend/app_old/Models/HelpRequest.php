<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class HelpRequest extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_id',
        'requested_by',
        'project_id',
        'question',
        'response',
        'responded_by',
        'responded_at',
        'status',
    ];

    protected $casts = [
        'responded_at' => 'datetime',
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

    public function requester()
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function responder()
    {
        return $this->belongsTo(User::class, 'responded_by');
    }

    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeAnswered($query)
    {
        return $query->where('status', 'answered');
    }
}
