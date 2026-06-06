<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OrderImportLog extends Model
{
    use HasFactory;

    protected $fillable = [
        'import_source_id',
        'imported_by',
        'status',
        'total_rows',
        'imported_count',
        'skipped_count',
        'error_count',
        'errors',
        'file_path',
        'started_at',
        'completed_at',
    ];

    protected $casts = [
        'errors' => 'array',
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    /**
     * Get the import source.
     */
    public function importSource()
    {
        return $this->belongsTo(OrderImportSource::class, 'import_source_id');
    }

    /**
     * Get the user who imported.
     */
    public function importedBy()
    {
        return $this->belongsTo(User::class, 'imported_by');
    }

    /**
     * Get all orders imported in this batch.
     */
    public function orders()
    {
        return $this->hasMany(Order::class, 'import_log_id');
    }

    /**
     * Mark import as started.
     */
    public function markStarted()
    {
        $this->update([
            'status' => 'processing',
            'started_at' => now(),
        ]);
    }

    /**
     * Mark import as completed.
     */
    public function markCompleted()
    {
        $this->update([
            'status' => 'completed',
            'completed_at' => now(),
        ]);
    }

    /**
     * Mark import as failed.
     */
    public function markFailed(array $errors = [])
    {
        $this->update([
            'status' => 'failed',
            'errors' => array_merge($this->errors ?? [], $errors),
            'completed_at' => now(),
        ]);
    }

    /**
     * Add error to the log.
     */
    public function addError(string $error, int $row = null)
    {
        $errors = $this->errors ?? [];
        $errors[] = [
            'row' => $row,
            'message' => $error,
            'timestamp' => now()->toIso8601String(),
        ];
        $this->update([
            'errors' => $errors,
            'error_count' => count($errors),
        ]);
    }

    /**
     * Increment imported count.
     */
    public function incrementImported()
    {
        $this->increment('imported_count');
    }

    /**
     * Increment skipped count.
     */
    public function incrementSkipped()
    {
        $this->increment('skipped_count');
    }
}
