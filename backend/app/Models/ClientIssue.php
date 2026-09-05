<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ClientIssue extends Model
{
    use HasFactory;

    protected $fillable = [
        'project_id',
        'order_id',
        'reason', 
        'comment_text',
        'comment_entered_at',
        'client_reply_text',
        'client_replied_at',
        'comment_to_reply_diff_minutes',
        'team_started_at',
        'reply_to_start_diff_minutes',
        'team_finished_at',
        'time_taken_to_finish_minutes',
        'resumed_at',
        'resumed_by',
        'pause_to_resume_diff_minutes',
        'completed_at'
    ];

    protected $casts = [
        'comment_entered_at' => 'datetime',
        'client_replied_at' => 'datetime',
        'team_started_at' => 'datetime',
        'team_finished_at' => 'datetime',
        'resumed_at' => 'datetime',
        'completed_at' => 'datetime',
        'comment_to_reply_diff_minutes' => 'integer',
        'reply_to_start_diff_minutes' => 'integer',
        'time_taken_to_finish_minutes' => 'integer',
        'pause_to_resume_diff_minutes' => 'integer',
        'resumed_by' => 'integer',
    ];


    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    public function getOrderAttribute()
    {
        if (!$this->project_id || !$this->order_id) {
            return null;
        }
        return Order::findInProject((int) $this->project_id, (int) $this->order_id);
    }
}
