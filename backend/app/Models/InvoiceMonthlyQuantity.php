<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * InvoiceMonthlyQuantity
 *
 * Tracks the per-project, per-month quantity data used for invoicing.
 *
 * Two quantity sources exist side-by-side:
 *   system_qty_*  – auto-computed from order records
 *   manual_qty_*  – entered / overridden by authorised staff
 *
 * The final_qty_* fields hold the resolved value:
 *   → manual if present, otherwise system.
 *
 * @property int    $id
 * @property int    $project_id
 * @property int    $month
 * @property int    $year
 * @property int|null $invoice_id
 *
 * @property int    $system_qty_total
 * @property int    $system_qty_delivered
 * @property int    $system_qty_completed
 * @property int    $system_qty_rework
 * @property array|null $system_qty_breakdown
 * @property \Carbon\Carbon|null $system_computed_at
 * @property int|null $system_computed_by
 *
 * @property int|null   $manual_qty_total
 * @property array|null $manual_qty_breakdown
 * @property string|null $manual_notes
 * @property int|null   $manual_created_by
 * @property \Carbon\Carbon|null $manual_created_at
 * @property int|null   $manual_updated_by
 * @property \Carbon\Carbon|null $manual_updated_at
 *
 * @property int|null   $final_qty_total
 * @property array|null $final_qty_breakdown
 *
 * @property bool   $is_quantity_locked
 * @property int|null $quantity_locked_by
 * @property \Carbon\Carbon|null $quantity_locked_at
 */
class InvoiceMonthlyQuantity extends Model
{
    protected $table = 'invoice_monthly_quantities';

    protected $fillable = [
        'project_id',
        'month',
        'year',
        'invoice_id',

        // System
        'system_qty_total',
        'system_qty_delivered',
        'system_qty_completed',
        'system_qty_rework',
        'system_qty_breakdown',
        'system_computed_at',
        'system_computed_by',

        // Manual
        'manual_qty_total',
        'manual_qty_breakdown',
        'manual_notes',
        'manual_created_by',
        'manual_created_at',
        'manual_updated_by',
        'manual_updated_at',

        // Final (resolved)
        'final_qty_total',
        'final_qty_breakdown',

        // Lock
        'is_quantity_locked',
        'quantity_locked_by',
        'quantity_locked_at',
    ];

    protected $casts = [
        'month'                  => 'integer',
        'year'                   => 'integer',
        'system_qty_total'       => 'integer',
        'system_qty_delivered'   => 'integer',
        'system_qty_completed'   => 'integer',
        'system_qty_rework'      => 'integer',
        'system_qty_breakdown'   => 'array',
        'system_computed_at'     => 'datetime',
        'manual_qty_total'       => 'integer',
        'manual_qty_breakdown'   => 'array',
        'manual_created_at'      => 'datetime',
        'manual_updated_at'      => 'datetime',
        'final_qty_total'        => 'integer',
        'final_qty_breakdown'    => 'array',
        'is_quantity_locked'     => 'boolean',
        'quantity_locked_at'     => 'datetime',
    ];

    // ── Relationships ──────────────────────────────────────────────

    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    public function invoice()
    {
        return $this->belongsTo(Invoice::class);
    }

    public function manualCreatedBy()
    {
        return $this->belongsTo(User::class, 'manual_created_by');
    }

    public function manualUpdatedBy()
    {
        return $this->belongsTo(User::class, 'manual_updated_by');
    }

    public function systemComputedBy()
    {
        return $this->belongsTo(User::class, 'system_computed_by');
    }

    public function quantityLockedBy()
    {
        return $this->belongsTo(User::class, 'quantity_locked_by');
    }

    // ── Helpers ────────────────────────────────────────────────────

    /**
     * Recalculate and persist final_qty_* from current manual/system values.
     * Call this after updating either source.
     */
    public function resolveFinal(): void
    {
        $this->final_qty_total     = $this->manual_qty_total ?? $this->system_qty_delivered;
        $this->final_qty_breakdown = $this->manual_qty_breakdown ?? $this->system_qty_breakdown;
    }

    /**
     * Whether a manual quantity has been entered for this record.
     */
    public function hasManualQuantity(): bool
    {
        return $this->manual_qty_total !== null;
    }

    /**
     * Scope: records for a given project.
     */
    public function scopeForProject($query, int $projectId)
    {
        return $query->where('project_id', $projectId);
    }

    /**
     * Scope: records for a given year.
     */
    public function scopeForYear($query, int $year)
    {
        return $query->where('year', $year);
    }

    /**
     * Scope: locked records.
     */
    public function scopeLocked($query)
    {
        return $query->where('is_quantity_locked', true);
    }
}
