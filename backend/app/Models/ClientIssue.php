<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ClientIssue extends Model
{
    use HasFactory;

    protected $fillable = [
        'project_id', 
        'reason', 
        'comment_text',
        'comment_entered_at',
        'client_reply_text',
        'client_replied_at',
        'comment_to_reply_diff_minutes',
        'team_started_at',
        'reply_to_start_diff_minutes',
        'team_finished_at',
        'time_taken_to_finish_minutes'
    ];

    public function project()
    {
        return $this->belongsTo(Project::class);
    }
}
