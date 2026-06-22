<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Project51PortalAccount extends Model
{
    protected $table = 'project_51_portal_accounts';

    protected $fillable = [
        'client_user_id',
        'resource_name',
        'first_name',
        'last_name',
        'account_type',
        'is_active',
    ];

    protected $casts = [
        'client_user_id' => 'integer',
        'is_active' => 'boolean',
    ];
}
