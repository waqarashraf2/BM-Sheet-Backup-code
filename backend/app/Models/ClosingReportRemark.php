<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class ClosingReportRemark extends Model
{
    use HasFactory;

    protected $fillable = [
        'report_date',
        'country',
        'project_id',
        'remarks',
        'created_by',
        'updated_by',
    ];

    protected $casts = [
        'report_date' => 'date',
        'project_id' => 'integer',
        'created_by' => 'integer',
        'updated_by' => 'integer',
    ];
}
