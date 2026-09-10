<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\User;
use App\Models\Project;
use App\Services\ProjectOrderService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Auth;
use Carbon\Carbon;

class AmendController extends Controller
{
    /**
     * Ensure the project amends table exists on-demand (lazy creation).
     */
    private function ensureAmendTableReady(int $projectId): bool
    {
        try {
            if (!ProjectOrderService::amendTableExists($projectId)) {
                ProjectOrderService::createAmendTable($projectId);
            }
            return true;
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * GET /api/amends/orders/{projectId}
     * Fetch orders that have amends for a specific project.
     */
    public function getOrders(Request $request, int $projectId)
    {
        $orderTable = ProjectOrderService::getTableName($projectId);
        if (!Schema::hasTable($orderTable)) {
            return response()->json(['error' => 'Project table not found'], 404);
        }

        $this->ensureAmendTableReady($projectId);
        $amendTable = ProjectOrderService::getAmendTableName($projectId);
        $hasAmendTable = Schema::hasTable($amendTable);

        $status = $request->input('status', 'all'); // all, pending, in_progress, delivered
        $search = trim((string) $request->input('search', ''));
        $perPage = max(1, min(100, (int) $request->input('per_page', 25)));

        // Base query joining orders table and project amends table
        $query = DB::table($orderTable . ' as o');

        if ($hasAmendTable) {
            $query->leftJoin($amendTable . ' as a', 'a.order_id', '=', 'o.id')
                ->select([
                    'o.id as order_id',
                    'o.order_number',
                    'o.client_name',
                    'o.client_reference',
                    'o.address',
                    'o.plan_type',
                    'o.instruction',
                    'o.workflow_state',
                    'o.status as order_status',
                    'o.priority',
                    'o.due_in',
                    'o.received_at',
                    'o.delivered_at',
                    // Original workers
                    'o.drawer_id',
                    'o.drawer_name',
                    'o.checker_id',
                    'o.checker_name',
                    'o.qa_id',
                    'o.qa_name',
                    'o.amend as order_amend_flag',
                    // Amend tracking fields
                    DB::raw('COALESCE(a.id, 0) as amend_id'),
                    DB::raw("COALESCE(a.amend, o.amend, 'yes') as amend"),
                    'a.amend_notes',
                    DB::raw("COALESCE(a.amend_status, 'pending') as amend_status"),
                    'a.amender_id',
                    'a.amender_name',
                    'a.assigned_at as amend_assigned_at',
                    'a.started_at as amend_started_at',
                    'a.completed_at as amend_completed_at',
                    'a.created_at as amend_created_at',
                ])
                ->where(function ($w) {
                    $w->where('o.amend', 'yes')
                      ->orWhereNotNull('a.id');
                });
        } else {
            $query->select([
                'o.id as order_id',
                'o.order_number',
                'o.client_name',
                'o.client_reference',
                'o.address',
                'o.plan_type',
                'o.instruction',
                'o.workflow_state',
                'o.status as order_status',
                'o.priority',
                'o.due_in',
                'o.received_at',
                'o.delivered_at',
                'o.drawer_id',
                'o.drawer_name',
                'o.checker_id',
                'o.checker_name',
                'o.qa_id',
                'o.qa_name',
                'o.amend as order_amend_flag',
                DB::raw('0 as amend_id'),
                DB::raw("'yes' as amend"),
                DB::raw("NULL as amend_notes"),
                DB::raw("'pending' as amend_status"),
                DB::raw("NULL as amender_id"),
                DB::raw("NULL as amender_name"),
                DB::raw("NULL as amend_assigned_at"),
                DB::raw("NULL as amend_started_at"),
                DB::raw("NULL as amend_completed_at"),
                DB::raw("NULL as amend_created_at"),
            ])
            ->where('o.amend', 'yes');
        }

        // Apply status filter
        if ($status !== 'all') {
            if ($status === 'delivered' || $status === 'done') {
                if ($hasAmendTable) {
                    $query->whereIn('a.amend_status', ['delivered', 'done']);
                } else {
                    $query->whereRaw('1 = 0');
                }
            } elseif ($status === 'in_progress') {
                if ($hasAmendTable) {
                    $query->where('a.amend_status', 'in_progress');
                } else {
                    $query->whereRaw('1 = 0');
                }
            } elseif ($status === 'pending') {
                if ($hasAmendTable) {
                    $query->where(function ($sub) {
                        $sub->where('a.amend_status', 'pending')
                            ->orWhereNull('a.amend_status');
                    });
                }
            }
        }

        // Search
        if (!empty($search)) {
            $query->where(function ($sub) use ($search, $hasAmendTable) {
                $sub->where('o.order_number', 'like', "%{$search}%")
                    ->orWhere('o.client_name', 'like', "%{$search}%")
                    ->orWhere('o.address', 'like', "%{$search}%")
                    ->orWhere('o.client_reference', 'like', "%{$search}%")
                    ->orWhere('o.drawer_name', 'like', "%{$search}%")
                    ->orWhere('o.checker_name', 'like', "%{$search}%")
                    ->orWhere('o.qa_name', 'like', "%{$search}%");

                if ($hasAmendTable) {
                    $sub->orWhere('a.amender_name', 'like', "%{$search}%")
                        ->orWhere('a.amend_notes', 'like', "%{$search}%");
                }
            });
        }

        // Order by latest amend / order date
        $orders = $query->orderBy('o.id', 'desc')->paginate($perPage);

        // Compute counts
        $countsQuery = DB::table($orderTable . ' as o');
        if ($hasAmendTable) {
            $countsQuery->leftJoin($amendTable . ' as a', 'a.order_id', '=', 'o.id')
                ->where(function ($w) {
                    $w->where('o.amend', 'yes')
                      ->orWhereNotNull('a.id');
                });

            $countsData = $countsQuery->selectRaw("
                COUNT(*) as total,
                SUM(CASE WHEN a.amend_status = 'pending' OR a.amend_status IS NULL THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN a.amend_status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
                SUM(CASE WHEN a.amend_status IN ('delivered', 'done') THEN 1 ELSE 0 END) as delivered_count
            ")->first();

            $counts = [
                'total'       => (int) ($countsData->total ?? 0),
                'pending'     => (int) ($countsData->pending_count ?? 0),
                'in_progress' => (int) ($countsData->in_progress_count ?? 0),
                'delivered'   => (int) ($countsData->delivered_count ?? 0),
            ];
        } else {
            $totalCount = $countsQuery->where('o.amend', 'yes')->count();
            $counts = [
                'total'       => $totalCount,
                'pending'     => $totalCount,
                'in_progress' => 0,
                'delivered'   => 0,
            ];
        }

        return response()->json([
            'data'   => $orders->items(),
            'counts' => $counts,
            'pagination' => [
                'current_page' => $orders->currentPage(),
                'last_page'    => $orders->lastPage(),
                'per_page'     => $orders->perPage(),
                'total'        => $orders->total(),
            ],
        ]);
    }

    /**
     * GET /api/amends/workers
     * Returns list of users who can be assigned to amends (role='amender', drawer, checker, etc.)
     */
    public function getAmenders(Request $request)
    {
        $users = User::where('is_active', true)
            ->whereIn('role', ['amender', 'drawer', 'checker', 'qa'])
            ->select(['id', 'name', 'role', 'email'])
            ->orderByRaw("FIELD(role, 'amender', 'drawer', 'checker', 'qa')")
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $users]);
    }

    /**
     * POST /api/amends/assign/{projectId}/{orderId}
     * Assign an amender to this order.
     */
    public function assignOrder(Request $request, int $projectId, int $orderId)
    {
        $request->validate([
            'amender_id' => 'required|exists:users,id',
        ]);

        $this->ensureAmendTableReady($projectId);
        $orderTable = ProjectOrderService::getTableName($projectId);
        $amendTable = ProjectOrderService::getAmendTableName($projectId);

        $order = DB::table($orderTable)->where('id', $orderId)->first();
        if (!$order) {
            return response()->json(['error' => 'Order not found'], 404);
        }

        $amender = User::findOrFail($request->input('amender_id'));
        $now = now();

        // Check if amend row exists
        $existing = DB::table($amendTable)->where('order_id', $orderId)->first();

        if ($existing) {
            DB::table($amendTable)->where('id', $existing->id)->update([
                'amender_id'   => $amender->id,
                'amender_name' => $amender->name,
                'amend_status' => 'in_progress',
                'assigned_at'  => $now,
                'started_at'   => $existing->started_at ?? $now,
                'updated_at'   => $now,
            ]);
        } else {
            DB::table($amendTable)->insert([
                'order_id'     => $order->id,
                'order_number' => $order->order_number,
                'amend'        => 'yes',
                'amend_notes'  => $request->input('amend_notes') ?? null,
                'amend_status' => 'in_progress',
                'amender_id'   => $amender->id,
                'amender_name' => $amender->name,
                'assigned_at'  => $now,
                'started_at'   => $now,
                'created_at'   => $now,
                'updated_at'   => $now,
            ]);
        }

        // Ensure base order amend flag is set
        DB::table($orderTable)->where('id', $orderId)->update([
            'amend'      => 'yes',
            'updated_at' => $now,
        ]);

        return response()->json([
            'message' => "Order assigned to {$amender->name} successfully",
            'amender_name' => $amender->name,
            'amend_status' => 'in_progress',
        ]);
    }

    /**
     * POST /api/amends/complete/{projectId}/{orderId}
     * Mark an amend order as completed/delivered by the amender.
     */
    public function completeOrder(Request $request, int $projectId, int $orderId)
    {
        $this->ensureAmendTableReady($projectId);
        $orderTable = ProjectOrderService::getTableName($projectId);
        $amendTable = ProjectOrderService::getAmendTableName($projectId);

        $order = DB::table($orderTable)->where('id', $orderId)->first();
        if (!$order) {
            return response()->json(['error' => 'Order not found'], 404);
        }

        $now = now();
        $currentUser = Auth::user();

        $existing = DB::table($amendTable)->where('order_id', $orderId)->first();

        if ($existing) {
            $updates = [
                'amend_status' => 'delivered',
                'completed_at' => $now,
                'updated_at'   => $now,
            ];
            // If no amender recorded yet, assign current user
            if (empty($existing->amender_id) && $currentUser) {
                $updates['amender_id']   = $currentUser->id;
                $updates['amender_name'] = $currentUser->name;
            }
            DB::table($amendTable)->where('id', $existing->id)->update($updates);
        } else {
            DB::table($amendTable)->insert([
                'order_id'     => $order->id,
                'order_number' => $order->order_number,
                'amend'        => 'yes',
                'amend_notes'  => $request->input('amend_notes') ?? null,
                'amend_status' => 'delivered',
                'amender_id'   => $currentUser?->id,
                'amender_name' => $currentUser?->name,
                'assigned_at'  => $now,
                'started_at'   => $now,
                'completed_at' => $now,
                'created_at'   => $now,
                'updated_at'   => $now,
            ]);
        }

        return response()->json([
            'message'      => 'Amend marked as delivered successfully',
            'amend_status' => 'delivered',
            'completed_at' => $now->toDateTimeString(),
        ]);
    }

    /**
     * POST /api/amends/notes/{projectId}/{orderId}
     * Update amend notes for an order.
     */
    public function updateNotes(Request $request, int $projectId, int $orderId)
    {
        $request->validate([
            'amend_notes' => 'nullable|string',
        ]);

        $this->ensureAmendTableReady($projectId);
        $orderTable = ProjectOrderService::getTableName($projectId);
        $amendTable = ProjectOrderService::getAmendTableName($projectId);

        $order = DB::table($orderTable)->where('id', $orderId)->first();
        if (!$order) {
            return response()->json(['error' => 'Order not found'], 404);
        }

        $now = now();
        $notes = $request->input('amend_notes');
        $existing = DB::table($amendTable)->where('order_id', $orderId)->first();

        if ($existing) {
            DB::table($amendTable)->where('id', $existing->id)->update([
                'amend_notes' => $notes,
                'updated_at'  => $now,
            ]);
        } else {
            DB::table($amendTable)->insert([
                'order_id'     => $order->id,
                'order_number' => $order->order_number,
                'amend'        => 'yes',
                'amend_notes'  => $notes,
                'amend_status' => 'pending',
                'created_at'   => $now,
                'updated_at'   => $now,
            ]);
        }

        // Ensure order amend flag is set
        DB::table($orderTable)->where('id', $orderId)->update([
            'amend'      => 'yes',
            'updated_at' => $now,
        ]);

        return response()->json([
            'message'     => 'Amend notes saved successfully',
            'amend_notes' => $notes,
        ]);
    }

    /**
     * POST /api/amends/mark-as-amend/{projectId}/{orderId}
     * Explicitly flag an order as amend with optional notes and status.
     */
    public function markAsAmend(Request $request, int $projectId, int $orderId)
    {
        $request->validate([
            'amend_notes'  => 'nullable|string',
            'amend_status' => 'nullable|string|in:pending,in_progress,delivered,done',
        ]);

        $this->ensureAmendTableReady($projectId);
        $orderTable = ProjectOrderService::getTableName($projectId);
        $amendTable = ProjectOrderService::getAmendTableName($projectId);

        $order = DB::table($orderTable)->where('id', $orderId)->first();
        if (!$order) {
            return response()->json(['error' => 'Order not found'], 404);
        }

        $now = now();
        $notes  = $request->input('amend_notes');
        $status = $request->input('amend_status', 'pending');

        $existing = DB::table($amendTable)->where('order_id', $orderId)->first();

        if ($existing) {
            DB::table($amendTable)->where('id', $existing->id)->update([
                'amend'        => 'yes',
                'amend_notes'  => $notes ?? $existing->amend_notes,
                'amend_status' => $status,
                'updated_at'   => $now,
            ]);
        } else {
            DB::table($amendTable)->insert([
                'order_id'     => $order->id,
                'order_number' => $order->order_number,
                'amend'        => 'yes',
                'amend_notes'  => $notes,
                'amend_status' => $status,
                'created_at'   => $now,
                'updated_at'   => $now,
            ]);
        }

        DB::table($orderTable)->where('id', $orderId)->update([
            'amend'      => 'yes',
            'updated_at' => $now,
        ]);

        return response()->json([
            'message'      => 'Order successfully marked as amend',
            'amend_status' => $status,
            'amend_notes'  => $notes,
        ]);
    }

    /**
     * POST /api/amends/sync/{projectId}
     * On-demand sync of amendments from client portal (e.g. Roomio Project 15).
     * Triggered manually via Amend Dashboard refresh/sync button.
     */
    public function syncFromPortal(Request $request, int $projectId)
    {
        if ($projectId === 15) {
            $service = new \App\Services\Amends\RoomioAmendService();
            $result = $service->syncAmends($projectId);

            return response()->json([
                'success' => $result['success'] ?? false,
                'message' => "Synced {$result['synced']} amendments from Roomio portal",
                'data'    => $result,
            ]);
        }

        return response()->json([
            'success' => true,
            'message' => 'No external portal configured for this project',
            'data'    => ['synced' => 0, 'total_fetched' => 0],
        ]);
    }
}
