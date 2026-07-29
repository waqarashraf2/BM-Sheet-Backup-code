<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserLeaveBalance extends Model
{
    protected $fillable = [
        'user_id',
        'year',
        'annual_allowed',
        'leaves_taken',
        'notes',
        'updated_by',
    ];

    protected function casts(): array
    {
        return [
            'year' => 'integer',
            'annual_allowed' => 'integer',
            'leaves_taken' => 'integer',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function getLeavesRemainingAttribute(): int
    {
        return max(0, (int) $this->annual_allowed - (int) $this->leaves_taken);
    }
}
