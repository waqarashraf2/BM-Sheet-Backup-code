<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ClientPortalUpload extends Model
{
    protected $fillable = [
        'project_id',
        'order_id',
        'job_order_id',
        'uploaded_by',
        'status',
        'file_names',
        'file_count',
        'upload_http_status',
        'upload_response',
        'uploaded_at',
        'submit_http_status',
        'submit_response',
        'submitted_at',
        'failure_reason',
    ];

    protected $casts = [
        'file_names' => 'array',
        'uploaded_at' => 'datetime',
        'submitted_at' => 'datetime',
    ];
}
