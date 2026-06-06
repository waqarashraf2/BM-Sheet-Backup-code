<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OrderImportSource extends Model
{
    use HasFactory;

    protected $fillable = [
        'project_id',
        'type',
        'name',
        'api_endpoint',
        'api_credentials',
        'cron_schedule',
        'last_sync_at',
        'orders_synced',
        'is_active',
        'field_mapping',
    ];

    protected $casts = [
        'api_credentials' => 'encrypted:array',
        'field_mapping' => 'array',
        'last_sync_at' => 'datetime',
        'is_active' => 'boolean',
    ];

    protected $hidden = [
        'api_credentials',
    ];

    /**
     * Get the project this import source belongs to.
     */
    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * Get all import logs for this source.
     */
    public function importLogs()
    {
        return $this->hasMany(OrderImportLog::class, 'import_source_id');
    }

    /**
     * Get the latest import log.
     */
    public function latestImport()
    {
        return $this->hasOne(OrderImportLog::class, 'import_source_id')->latestOfMany();
    }

    /**
     * Scope to active sources.
     */
    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    /**
     * Scope to sources that need syncing (cron-based).
     */
    public function scopeNeedsSync($query)
    {
        return $query->where('type', 'cron')
            ->where('is_active', true);
    }
}
