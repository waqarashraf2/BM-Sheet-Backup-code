<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Invoice;
use App\Models\InvoiceMonthlyQuantity;
use App\Models\MonthLock;
use App\Models\Order;
use App\Models\Project;
use App\Services\AuditService;
use App\Services\ProjectOrderService;
use App\Services\NotificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class InvoiceController extends Controller
{
    /**
     * Invoice status workflow: draft → prepared → approved → issued → sent
     */
    const STATUS_TRANSITIONS = [
        'draft'    => ['prepared'],
        'prepared' => ['approved', 'draft'], // Can send back to draft
        'approved' => ['issued'],
        'issued'   => ['sent'],
        'sent'     => [],
    ];

    /**
     * GET /invoices
     * List invoices with filters.
     */
    public function index(Request $request)
    {
        $user = $request->user();
        $query = Invoice::with(['project:id,name,code,country', 'preparedBy:id,name', 'approvedBy:id,name']);

        if ($request->has('project_id')) {
            $query->where('project_id', $request->input('project_id'));
        }
        if ($request->has('status')) {
            $query->where('status', $request->input('status'));
        }
        if ($request->has('month') && $request->has('year')) {
            $query->where('month', $request->input('month'))->where('year', $request->input('year'));
        }

        return response()->json($query->orderByDesc('created_at')->paginate(25));
    }

    /**
     * POST /invoices
     * Create a draft invoice from locked month counts.
     * Only CEO/Director can create invoices.
     */
    public function store(Request $request)
    {
        $request->validate([
            'project_id'         => 'required|exists:projects,id',
            'month'              => 'required|integer|min:1|max:12',
            'year'               => 'required|integer|min:2020|max:2100',
            'date'               => 'nullable|date',
            'attn'               => 'nullable|string|max:255',
            'client_name'        => 'nullable|string|max:255',
            'client_phone_email' => 'nullable|string|max:255',
            'billing_period'     => 'nullable|string|max:100',
            'invoice_items'      => 'nullable|array',
            'invoice_items.*.description' => 'required_with:invoice_items|string',
            'invoice_items.*.quantity'    => 'required_with:invoice_items|numeric|min:0',
            'invoice_items.*.unit_price'  => 'required_with:invoice_items|numeric|min:0',
        ]);

        $user = $request->user();
        if (!in_array($user->role, ['ceo', 'director', 'operations_manager', 'accounts_manager'])) {
            return response()->json(['message' => 'Unauthorized to create invoices.'], 403);
        }

        $projectId = $request->input('project_id');
        $month     = $request->input('month');
        $year      = $request->input('year');

        // Check for duplicate invoice
        $existing = Invoice::where('project_id', $projectId)
            ->where('month', $month)
            ->where('year', $year)
            ->first();

        if ($existing) {
            return response()->json([
                'message' => 'Invoice already exists for this month.',
                'invoice' => $existing,
            ], 409);
        }

        $project = Project::findOrFail($projectId);

        // Optional: use locked month frozen counts for auto-calculation
        $lock = MonthLock::where('project_id', $projectId)
            ->where('month', $month)
            ->where('year', $year)
            ->where('is_locked', true)
            ->first();

        // Build invoice items and calculate total
        $invoiceItems = $request->input('invoice_items');
        if ($invoiceItems) {
            foreach ($invoiceItems as &$item) {
                $item['total'] = round(floatval($item['quantity']) * floatval($item['unit_price']), 2);
            }
            unset($item);
            $totalAmount = round(array_sum(array_column($invoiceItems, 'total')), 2);
        } elseif ($lock) {
            // Fallback: calculate from frozen counts if month is locked
            $counts      = $lock->frozen_counts;
            $totalAmount = $this->calculateTotal($counts, $project->invoice_categories_config);
        } else {
            $totalAmount = 0;
        }

        $payload = [
            'invoice_number'     => 'INV-' . strtoupper($project->code ?? $project->id) . '-' . $year . str_pad($month, 2, '0', STR_PAD_LEFT),
            'date'               => $request->input('date', now()->toDateString()),
            'attn'               => $request->input('attn'),
            'client_name'        => $request->input('client_name'),
            'client_phone_email' => $request->input('client_phone_email'),
            'billing_period'     => $request->input('billing_period'),
            'invoice_items'      => $invoiceItems ?? null,
            'project_id'         => $projectId,
            'month'              => $month,
            'year'               => $year,
            'service_counts'     => $lock?->frozen_counts ?? [],
            'total_amount'       => $totalAmount,
            'status'             => 'draft',
            'prepared_by'        => $user->id,
            'locked_month_id'    => $lock?->id,
        ];

        \Log::debug('Invoice::create payload', $payload);

        try {
            $invoice = Invoice::create($payload);
        } catch (\Throwable $e) {
            \Log::error('Invoice::create failed', [
                'message' => $e->getMessage(),
                'trace'   => $e->getTraceAsString(),
                'payload' => $payload,
            ]);
            return response()->json([
                'debug_error'   => $e->getMessage(),
                'debug_payload' => $payload,
            ], 500);
        }

        try {
            AuditService::logInvoiceAction($invoice->id, $projectId, 'INVOICE_CREATED', null, [
                'status'       => 'draft',
                'total_amount' => $totalAmount,
            ]);
        } catch (\Throwable $e) {
            \Log::warning('AuditService::logInvoiceAction failed (non-fatal)', ['message' => $e->getMessage()]);
        }

        return response()->json(['invoice' => $invoice->load(['project:id,name,code,country', 'preparedBy:id,name'])], 201);
    }

    /**
     * PUT /invoices/{id}
     * Update header fields and line items for a draft invoice.
     */
    public function update(Request $request, int $id)
    {
        $invoice = Invoice::findOrFail($id);

        if ($invoice->status !== 'draft') {
            return response()->json(['message' => 'Only draft invoices can be edited.'], 422);
        }

        $user = $request->user();
        if (!in_array($user->role, ['ceo', 'director', 'operations_manager', 'accounts_manager'])) {
            return response()->json(['message' => 'Unauthorized to edit invoices.'], 403);
        }

        $request->validate([
            'date'               => 'nullable|date',
            'attn'               => 'nullable|string|max:255',
            'client_name'        => 'nullable|string|max:255',
            'client_phone_email' => 'nullable|string|max:255',
            'billing_period'     => 'nullable|string|max:100',
            'invoice_items'      => 'nullable|array',
            'invoice_items.*.description' => 'required_with:invoice_items|string',
            'invoice_items.*.quantity'    => 'required_with:invoice_items|numeric|min:0',
            'invoice_items.*.unit_price'  => 'required_with:invoice_items|numeric|min:0',
        ]);

        $invoiceItems = $request->input('invoice_items');
        $totalAmount  = $invoice->total_amount;

        if ($invoiceItems !== null) {
            foreach ($invoiceItems as &$item) {
                $item['total'] = round(floatval($item['quantity']) * floatval($item['unit_price']), 2);
            }
            unset($item);
            $totalAmount = round(array_sum(array_column($invoiceItems, 'total')), 2);
        }

        $before = $invoice->only(['date', 'attn', 'client_name', 'client_phone_email', 'billing_period', 'invoice_items', 'total_amount']);

        $invoice->update(array_filter([
            'date'               => $request->input('date'),
            'attn'               => $request->input('attn'),
            'client_name'        => $request->input('client_name'),
            'client_phone_email' => $request->input('client_phone_email'),
            'billing_period'     => $request->input('billing_period'),
            'invoice_items'      => $invoiceItems,
            'total_amount'       => $totalAmount,
        ], fn($v) => $v !== null));

        AuditService::logInvoiceAction($invoice->id, $invoice->project_id, 'INVOICE_UPDATED', $before, $invoice->fresh()->toArray());

        return response()->json([
            'invoice' => $invoice->fresh()->load(['project:id,name,code,country', 'preparedBy:id,name', 'approvedBy:id,name']),
            'message' => 'Invoice updated.',
        ]);
    }

    /**
     * GET /invoices/{id}
     */
    public function show(int $id)
    {
        $invoice = Invoice::with([
            'project:id,name,code,country,department',
            'preparedBy:id,name',
            'approvedBy:id,name',
        ])->findOrFail($id);

        return response()->json(['invoice' => $invoice]);
    }

    /**
     * POST /invoices/{id}/transition
     * Advance invoice through workflow: draft→prepared→approved→issued→sent
     */
    public function transition(Request $request, int $id)
    {
        $request->validate([
            'to_status' => 'required|string|in:draft,prepared,approved,issued,sent',
        ]);

        $user = $request->user();
        $invoice = Invoice::findOrFail($id);
        $toStatus = $request->input('to_status');

        // Validate transition
        $allowed = self::STATUS_TRANSITIONS[$invoice->status] ?? [];
        if (!in_array($toStatus, $allowed)) {
            return response()->json([
                'message' => "Cannot transition from '{$invoice->status}' to '{$toStatus}'.",
                'allowed' => $allowed,
            ], 422);
        }

        // Only CEO/Director can approve/issue
        if (in_array($toStatus, ['approved', 'issued', 'sent']) && !in_array($user->role, ['ceo', 'director'])) {
            return response()->json(['message' => 'Only CEO/Director can approve/issue invoices.'], 403);
        }

        $before = ['status' => $invoice->status];
        $updates = ['status' => $toStatus];

        if ($toStatus === 'approved') {
            $updates['approved_by'] = $user->id;
            $updates['approved_at'] = now();
        }
        if ($toStatus === 'issued') {
            $updates['issued_by'] = $user->id;
            $updates['issued_at'] = now();
        }
        if ($toStatus === 'sent') {
            $updates['sent_at'] = now();
        }

        $invoice->update($updates);

        AuditService::logInvoiceAction($invoice->id, $invoice->project_id, 'INVOICE_' . strtoupper($toStatus), $before, $updates);

        NotificationService::invoiceTransition($invoice->id, $before['status'], $toStatus, $user);

        return response()->json([
            'invoice' => $invoice->fresh(),
            'message' => "Invoice status changed to '{$toStatus}'.",
        ]);
    }

    /**
     * DELETE /invoices/{id}
     * Only draft invoices can be deleted.
     */
    public function destroy(int $id)
    {
        $invoice = Invoice::findOrFail($id);

        if ($invoice->status !== 'draft') {
            return response()->json(['message' => 'Only draft invoices can be deleted.'], 422);
        }

        AuditService::logInvoiceAction($invoice->id, $invoice->project_id, 'INVOICE_DELETED');
        $invoice->delete();

        return response()->json(['message' => 'Invoice deleted.']);
    }

    // ── Private ──

    private function calculateTotal(?array $counts, ?array $categoryConfig): float
    {
        if (!$counts || !$categoryConfig) {
            // Simple count-based calculation
            return ($counts['delivered'] ?? 0) * 10.0; // Default rate
        }

        $total = 0;
        foreach ($categoryConfig as $category) {
            $rate = floatval($category['rate'] ?? 0);
            $countKey = $category['count_key'] ?? 'delivered';

            // Support nested keys like "by_plan_type.color" or "by_bedrooms.3br"
            $count = $this->getNestedCount($counts, $countKey);

            // Support service_categories for manually entered counts
            if ($count === 0 && isset($counts['service_categories'][$countKey])) {
                $count = intval($counts['service_categories'][$countKey]);
            }

            $total += $rate * $count;
        }

        return round($total, 2);
    }

    /**
     * Get a count from a nested array structure using dot notation.
     * e.g., "by_plan_type.color" => $counts['by_plan_type']['color']
     */
    private function getNestedCount(array $counts, string $key): int
    {
        $parts = explode('.', $key);
        $value = $counts;

        foreach ($parts as $part) {
            if (!is_array($value) || !isset($value[$part])) {
                return 0;
            }
            $value = $value[$part];
        }

        return intval($value);
    }

    // ══════════════════════════════════════════════════════════════════
    // MONTHLY QUANTITY METHODS
    // ══════════════════════════════════════════════════════════════════

    /**
     * GET /invoices/monthly-quantity/{projectId}/{year}/{month}
     *
     * Returns the InvoiceMonthlyQuantity record for the given scope.
     * If no record exists yet, one is auto-created with system quantities
     * computed on the fly from orders.
     */
    public function getMonthlyQuantity(Request $request, int $projectId, int $year, int $month)
    {
        Project::findOrFail($projectId); // 404 guard

        $record = InvoiceMonthlyQuantity::where('project_id', $projectId)
            ->where('year', $year)
            ->where('month', $month)
            ->with([
                'manualCreatedBy:id,name,role',
                'manualUpdatedBy:id,name,role',
                'systemComputedBy:id,name,role',
                'quantityLockedBy:id,name,role',
                'invoice:id,invoice_number,status',
            ])
            ->first();

        if (!$record) {
            // Auto-create with system counts
            $record = $this->computeAndPersistSystemQty($projectId, $year, $month, $request->user());
        }

        return response()->json(['monthly_quantity' => $record]);
    }

    /**
     * POST /invoices/monthly-quantity/{projectId}/{year}/{month}/compute
     *
     * Re-triggers system quantity computation from orders.
     * Allowed for: ceo, director, operations_manager, accounts_manager
     */
    public function computeMonthlyQuantity(Request $request, int $projectId, int $year, int $month)
    {
        Project::findOrFail($projectId);

        $record = $this->computeAndPersistSystemQty($projectId, $year, $month, $request->user());

        AuditService::log(
            $request->user()->id,
            'MONTHLY_QTY_COMPUTED',
            'invoice_monthly_quantity',
            $record->id,
            $projectId,
            null,
            ['system_qty_delivered' => $record->system_qty_delivered]
        );

        return response()->json([
            'monthly_quantity' => $record->fresh([
                'manualCreatedBy:id,name,role',
                'manualUpdatedBy:id,name,role',
                'systemComputedBy:id,name,role',
            ]),
            'message' => 'System quantities recomputed.',
        ]);
    }

    /**
     * POST /invoices/monthly-quantity
     *
     * Create or update the manual quantity entry for a project/month/year.
     * If a record does not exist, it is first auto-created with system data.
     *
     * Authority: ceo, director, operations_manager
     */
    public function storeManualQuantity(Request $request)
    {
        $user = $request->user();
        if (!in_array($user->role, ['ceo', 'director', 'operations_manager'])) {
            return response()->json(['message' => 'Unauthorized to enter manual quantities.'], 403);
        }

        $request->validate([
            'project_id'           => 'required|exists:projects,id',
            'month'                => 'required|integer|min:1|max:12',
            'year'                 => 'required|integer|min:2020|max:2100',
            'manual_qty_total'     => 'required|integer|min:0',
            'manual_qty_breakdown' => 'nullable|array',
            'manual_notes'         => 'nullable|string|max:1000',
        ]);

        $projectId = $request->input('project_id');
        $month     = $request->input('month');
        $year      = $request->input('year');

        // Load or auto-create the record (with system data)
        $record = InvoiceMonthlyQuantity::where('project_id', $projectId)
            ->where('year', $year)
            ->where('month', $month)
            ->first();

        if (!$record) {
            $record = $this->computeAndPersistSystemQty($projectId, $year, $month, $user);
        }

        if ($record->is_quantity_locked) {
            return response()->json(['message' => 'Monthly quantity is locked. Only CEO/Director can unlock it.'], 422);
        }

        $isFirstManual = !$record->hasManualQuantity();
        $before = $record->only(['manual_qty_total', 'manual_qty_breakdown', 'manual_notes']);

        $record->manual_qty_total     = $request->input('manual_qty_total');
        $record->manual_qty_breakdown = $request->input('manual_qty_breakdown');
        $record->manual_notes         = $request->input('manual_notes');

        if ($isFirstManual) {
            $record->manual_created_by = $user->id;
            $record->manual_created_at = now();
        }

        $record->manual_updated_by = $user->id;
        $record->manual_updated_at = now();

        $record->resolveFinal();
        $record->save();

        AuditService::log(
            $user->id,
            $isFirstManual ? 'MONTHLY_QTY_MANUAL_CREATED' : 'MONTHLY_QTY_MANUAL_UPDATED',
            'invoice_monthly_quantity',
            $record->id,
            $projectId,
            $isFirstManual ? null : $before,
            $record->only(['manual_qty_total', 'manual_qty_breakdown', 'manual_notes'])
        );

        return response()->json([
            'monthly_quantity' => $record->fresh([
                'manualCreatedBy:id,name,role',
                'manualUpdatedBy:id,name,role',
            ]),
            'message' => $isFirstManual ? 'Manual quantity created.' : 'Manual quantity updated.',
        ], $isFirstManual ? 201 : 200);
    }

    /**
     * PUT /invoices/monthly-quantity/{id}
     *
     * Update an existing InvoiceMonthlyQuantity record's manual fields.
     * Authority: ceo, director, operations_manager
     */
    public function updateManualQuantity(Request $request, int $id)
    {
        $user = $request->user();
        if (!in_array($user->role, ['ceo', 'director', 'operations_manager'])) {
            return response()->json(['message' => 'Unauthorized to update manual quantities.'], 403);
        }

        $record = InvoiceMonthlyQuantity::findOrFail($id);

        if ($record->is_quantity_locked) {
            return response()->json(['message' => 'Monthly quantity is locked and cannot be edited.'], 422);
        }

        $request->validate([
            'manual_qty_total'     => 'sometimes|integer|min:0',
            'manual_qty_breakdown' => 'sometimes|nullable|array',
            'manual_notes'         => 'sometimes|nullable|string|max:1000',
        ]);

        $before = $record->only(['manual_qty_total', 'manual_qty_breakdown', 'manual_notes']);

        $isFirstManual = !$record->hasManualQuantity();

        if ($request->has('manual_qty_total')) {
            $record->manual_qty_total = $request->input('manual_qty_total');
        }
        if ($request->has('manual_qty_breakdown')) {
            $record->manual_qty_breakdown = $request->input('manual_qty_breakdown');
        }
        if ($request->has('manual_notes')) {
            $record->manual_notes = $request->input('manual_notes');
        }

        if ($isFirstManual && $record->manual_qty_total !== null) {
            $record->manual_created_by = $user->id;
            $record->manual_created_at = now();
        }

        $record->manual_updated_by = $user->id;
        $record->manual_updated_at = now();

        $record->resolveFinal();
        $record->save();

        AuditService::log(
            $user->id,
            'MONTHLY_QTY_MANUAL_UPDATED',
            'invoice_monthly_quantity',
            $record->id,
            $record->project_id,
            $before,
            $record->only(['manual_qty_total', 'manual_qty_breakdown', 'manual_notes'])
        );

        return response()->json([
            'monthly_quantity' => $record->fresh([
                'manualCreatedBy:id,name,role',
                'manualUpdatedBy:id,name,role',
            ]),
            'message' => 'Manual quantity updated.',
        ]);
    }

    /**
     * POST /invoices/monthly-quantity/{id}/lock
     *
     * Lock the monthly quantity record – no further manual edits allowed.
     * Authority: ceo, director only
     */
    public function lockMonthlyQuantity(Request $request, int $id)
    {
        $user = $request->user();
        if (!in_array($user->role, ['ceo', 'director'])) {
            return response()->json(['message' => 'Only CEO/Director can lock monthly quantities.'], 403);
        }

        $record = InvoiceMonthlyQuantity::findOrFail($id);

        if ($record->is_quantity_locked) {
            return response()->json(['message' => 'Already locked.'], 422);
        }

        $record->is_quantity_locked    = true;
        $record->quantity_locked_by    = $user->id;
        $record->quantity_locked_at    = now();
        $record->save();

        AuditService::log(
            $user->id,
            'MONTHLY_QTY_LOCKED',
            'invoice_monthly_quantity',
            $record->id,
            $record->project_id,
            null,
            ['locked_at' => $record->quantity_locked_at]
        );

        return response()->json([
            'monthly_quantity' => $record->fresh(['quantityLockedBy:id,name,role']),
            'message'          => 'Monthly quantity locked.',
        ]);
    }

    /**
     * POST /invoices/monthly-quantity/{id}/unlock
     *
     * Unlock the monthly quantity record.
     * Authority: ceo, director only
     */
    public function unlockMonthlyQuantity(Request $request, int $id)
    {
        $user = $request->user();
        if (!in_array($user->role, ['ceo', 'director'])) {
            return response()->json(['message' => 'Only CEO/Director can unlock monthly quantities.'], 403);
        }

        $record = InvoiceMonthlyQuantity::findOrFail($id);

        if (!$record->is_quantity_locked) {
            return response()->json(['message' => 'Record is not locked.'], 422);
        }

        $record->is_quantity_locked = false;
        $record->quantity_locked_by = null;
        $record->quantity_locked_at = null;
        $record->save();

        AuditService::log(
            $user->id,
            'MONTHLY_QTY_UNLOCKED',
            'invoice_monthly_quantity',
            $record->id,
            $record->project_id
        );

        return response()->json([
            'monthly_quantity' => $record->fresh(),
            'message'          => 'Monthly quantity unlocked.',
        ]);
    }

    /**
     * GET /invoices/monthly-quantity/{projectId}/{year}
     *
     * List all 12 months for a given project/year, returning both
     * system and manual quantities side-by-side.
     */
    public function listMonthlyQuantities(Request $request, int $projectId, int $year)
    {
        Project::findOrFail($projectId);

        $records = InvoiceMonthlyQuantity::where('project_id', $projectId)
            ->where('year', $year)
            ->with([
                'manualCreatedBy:id,name,role',
                'manualUpdatedBy:id,name,role',
                'quantityLockedBy:id,name,role',
                'invoice:id,invoice_number,status',
            ])
            ->orderBy('month')
            ->get();

        return response()->json([
            'project_id' => $projectId,
            'year'       => $year,
            'months'     => $records,
        ]);
    }

    // ── Private helpers ────────────────────────────────────────────

    /**
     * Compute system quantity totals from orders for the given project/month/year
     * and upsert the InvoiceMonthlyQuantity record.
     */
    private function computeAndPersistSystemQty(int $projectId, int $year, int $month, $triggeredBy = null): InvoiceMonthlyQuantity
    {
        // Date range for the calendar month
        $from = \Carbon\Carbon::createFromDate($year, $month, 1)->startOfMonth();
        $to   = $from->copy()->endOfMonth();

        // Use the per-project order table (e.g. project_1_orders)
        $baseQuery = Order::forProject($projectId);
        $projectTable = ProjectOrderService::getTableName($projectId);

        // Total orders received/registered in the month
        $systemTotal = (clone $baseQuery)
            ->whereBetween('created_at', [$from, $to])
            ->count();

        // Delivered in the month
        $systemDelivered = (clone $baseQuery)
            ->whereNotNull('delivered_at')
            ->whereBetween('delivered_at', [$from, $to])
            ->count();

        // QA-completed in the month
        $systemCompleted = (clone $baseQuery)
            ->whereNotNull('completed_at')
            ->whereBetween('completed_at', [$from, $to])
            ->count();

        // Orders that went through at least one rework
        $systemRework = (clone $baseQuery)
            ->whereNotNull('delivered_at')
            ->whereBetween('delivered_at', [$from, $to])
            ->where(function ($q) {
                $q->where('attempt_draw', '>', 1)
                  ->orWhere('attempt_check', '>', 1);
            })
            ->count();

        // Breakdown by workflow_type
        $byWorkflowType = (clone $baseQuery)
            ->whereNotNull('delivered_at')
            ->whereBetween('delivered_at', [$from, $to])
            ->selectRaw('workflow_type, COUNT(*) as cnt')
            ->groupBy('workflow_type')
            ->pluck('cnt', 'workflow_type')
            ->toArray();

        // Breakdown by plan_type (if column exists on the per-project table)
        $byPlanType = [];
        if (\Schema::hasColumn($projectTable, 'plan_type')) {
            $byPlanType = (clone $baseQuery)
                ->whereNotNull('delivered_at')
                ->whereBetween('delivered_at', [$from, $to])
                ->selectRaw('plan_type, COUNT(*) as cnt')
                ->groupBy('plan_type')
                ->pluck('cnt', 'plan_type')
                ->toArray();
        }

        $breakdown = array_filter([
            'by_workflow_type' => $byWorkflowType ?: null,
            'by_plan_type'     => $byPlanType     ?: null,
        ]);

        $record = InvoiceMonthlyQuantity::firstOrNew([
            'project_id' => $projectId,
            'year'       => $year,
            'month'      => $month,
        ]);

        $record->system_qty_total      = $systemTotal;
        $record->system_qty_delivered  = $systemDelivered;
        $record->system_qty_completed  = $systemCompleted;
        $record->system_qty_rework     = $systemRework;
        $record->system_qty_breakdown  = $breakdown ?: null;
        $record->system_computed_at    = now();
        $record->system_computed_by    = $triggeredBy?->id;

        $record->resolveFinal();
        $record->save();

        return $record;
    }
}
