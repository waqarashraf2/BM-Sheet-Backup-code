<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserSalaryIncrement extends Model
{
    protected $fillable = [
        'user_id',
        'previous_salary',
        'increment_amount',
        'new_salary',
        'effective_date',
        'notes',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'previous_salary' => 'decimal:2',
            'increment_amount' => 'decimal:2',
            'new_salary' => 'decimal:2',
            'effective_date' => 'date',
        ];
    }

    public function user()
    {
        return $this->belongsTo(User::class);
    }
}
