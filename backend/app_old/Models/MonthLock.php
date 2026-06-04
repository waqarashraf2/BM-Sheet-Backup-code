<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class MonthLock extends Model
{
    use HasFactory;

    protected $fillable = [
        'project_id', 'month', 'year', 'is_locked',
        'locked_by', 'locked_at', 'unlocked_by', 'unlocked_at', 'frozen_counts',
    ];

    protected $casts = [
        'is_locked' => 'boolean',
        'locked_at' => 'datetime',
        'unlocked_at' => 'datetime',
        'frozen_counts' => 'array',
    ];

    public function project() { return $this->belongsTo(Project::class); }
    public function lockedByUser() { return $this->belongsTo(User::class, 'locked_by'); }
    public function unlockedByUser() { return $this->belongsTo(User::class, 'unlocked_by'); }

    public function scopeLocked($query) { return $query->where('is_locked', true); }
}
