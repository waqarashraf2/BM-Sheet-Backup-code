<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Invoice extends Model
{
    use HasFactory;

    protected $fillable = [
        'invoice_number',
        'date',
        'attn',
        'client_name',
        'client_phone_email',
        'billing_period',
        'invoice_items',
        'project_id',
        'month',
        'year',
        'service_counts',
        'total_amount',
        'status',
        'prepared_by',
        'approved_by',
        'approved_at',
        'issued_by',
        'issued_at',
        'sent_at',
        'locked_month_id',
    ];

    protected $casts = [
        'service_counts' => 'array',
        'invoice_items'  => 'array',
        'total_amount'   => 'decimal:2',
        'date'           => 'date:Y-m-d',
        'month'          => 'integer',
        'year'           => 'integer',
        'approved_at'    => 'datetime',
        'issued_at'      => 'datetime',
        'sent_at'        => 'datetime',
    ];

    public function issuedBy()
    {
        return $this->belongsTo(User::class, 'issued_by');
    }

    /**
     * Get the monthly quantity record linked to this invoice.
     */
    public function monthlyQuantity()
    {
        return $this->hasOne(InvoiceMonthlyQuantity::class);
    }

    /**
     * Get the project that owns the invoice.
     */
    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * Get the user who prepared the invoice.
     */
    public function preparedBy()
    {
        return $this->belongsTo(User::class, 'prepared_by');
    }

    /**
     * Get the user who approved the invoice.
     */
    public function approvedBy()
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    /**
     * Scope a query to only include draft invoices.
     */
    public function scopeDraft($query)
    {
        return $query->where('status', 'draft');
    }

    /**
     * Scope a query to only include approved invoices.
     */
    public function scopeApproved($query)
    {
        return $query->where('status', 'approved');
    }
}
