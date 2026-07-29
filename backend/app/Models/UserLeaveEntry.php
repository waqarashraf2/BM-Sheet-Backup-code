<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserLeaveEntry extends Model
{
    protected $fillable = [
        'user_id',
        'leave_date',
        'leave_days',
        'reason',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'leave_date' => 'date',
            'leave_days' => 'integer',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
