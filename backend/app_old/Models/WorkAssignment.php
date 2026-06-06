<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class WorkAssignment extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_id',
        'user_id',
        'layer',
        'assigned_at',
        'started_at',
        'completed_at',
        'status',
    ];

    protected $casts = [
        'assigned_at' => 'datetime',
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    /**
     * Get the order that owns the work assignment.
     */
    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * Get the user assigned to this work.
     */
    public function user()
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Scope a query to only include assigned work.
     */
    public function scopeAssigned($query)
    {
        return $query->where('status', 'assigned');
    }

    /**
     * Scope a query to only include in-progress work.
     */
    public function scopeInProgress($query)
    {
        return $query->where('status', 'in-progress');
    }

    /**
     * Scope a query to only include completed work.
     */
    public function scopeCompleted($query)
    {
        return $query->where('status', 'completed');
    }
}
