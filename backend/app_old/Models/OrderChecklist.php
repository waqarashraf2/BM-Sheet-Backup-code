<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OrderChecklist extends Model
{
    use HasFactory;

    protected $fillable = [
        'order_id',
        'checklist_template_id',
        'completed_by',
        'is_checked',
        'mistake_count',
        'notes',
        'completed_at',
    ];

    protected $casts = [
        'is_checked' => 'boolean',
        'mistake_count' => 'integer',
        'completed_at' => 'datetime',
    ];

    /**
     * Get the order.
     */
    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    /**
     * Get the checklist template.
     */
    public function template()
    {
        return $this->belongsTo(ChecklistTemplate::class, 'checklist_template_id');
    }

    /**
     * Get the user who completed this checklist item.
     */
    public function completedBy()
    {
        return $this->belongsTo(User::class, 'completed_by');
    }

    /**
     * Mark as checked.
     */
    public function check()
    {
        $this->update([
            'is_checked' => true,
            'completed_at' => now(),
        ]);
    }

    /**
     * Uncheck.
     */
    public function uncheck()
    {
        $this->update([
            'is_checked' => false,
            'completed_at' => null,
        ]);
    }
}
