<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Models\WorkItem;
use App\Models\Project;
use App\Services\StateMachine;
use App\Services\AssignmentEngine;
use App\Services\AuditService;
use App\Services\NotificationService;
use App\Services\ProjectOrderService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;

class WorkflowController extends Controller
{
    // ═══════════════════════════════════════════
    // SMART POLLING — Lightweight change detection
    // ═══════════════════════════════════════════

    /**
     * GET /workflow/check-updates
     *
     * Lightweight endpoint for Smart Polling.
     * Returns a hash based on MAX(updated_at) across requested project tables
     * so the frontend only reloads data when something actually changed.
     *
     * Query params:
     *   - project_ids[]  (optional) specific project tables to check
     *   - scope           'orders' (default), 'users', 'all'
     *   - last_hash       previous hash — response includes `changed` boolean
     */
    public function checkUpdates(Request $request)
    {
        $user = $request->user();
        $scope = $request->input('scope', 'orders');
        $lastHash = $request->input('last_hash', '');

        // Determine which project IDs to check
        $projectIds = $request->input('project_ids', []);
        if (empty($projectIds)) {
            // Auto-detect from user role
            $projectIds = $this->resolveProjectIds($user);
        }
        $projectIds = array_map('intval', (array) $projectIds);

        $timestamps = [];

        // Check order tables
        if (in_array($scope, ['orders', 'all'])) {
            foreach ($projectIds as $pid) {
                $table = ProjectOrderService::getTableName($pid);
                if (Schema::hasTable($table)) {
                    $maxAt = DB::table($table)->max('updated_at');
                    $count = DB::table($table)->count();
                    $timestamps[] = "{$pid}:{$maxAt}:{$count}";
                }
            }
        }

        // Check users table
        if (in_array($scope, ['users', 'all'])) {
            $maxUserAt = DB::table('users')->max('updated_at');
            $userCount = DB::table('users')->where('is_active', true)->count();
            $timestamps[] = "users:{$maxUserAt}:{$userCount}";
        }

        $hash = md5(implode('|', $timestamps));

        return response()->json([
            'hash' => $hash,
            'changed' => $lastHash !== '' && $lastHash !== $hash,
            'server_time' => now()->toIso8601String(),
        ]);
    }

    /**
     * Resolve which project IDs a user should check, based on role.
     */
    private function resolveProjectIds($user): array
    {
        switch ($user->role) {
            case 'ceo':
            case 'director':
                return Project::pluck('id')->toArray();
            case 'operations_manager':
                return $user->getManagedProjectIds();
            case 'project_manager':
                return $user->getManagedProjectIds();
            case 'qa':
            case 'live_qa':
            case 'drawer':
            case 'checker':
            case 'designer':
                return $user->project_id ? [$user->project_id] : [];
            default:
                return [];
        }
    }

    // ═══════════════════════════════════════════
    // WORKER ENDPOINTS (Production roles)
    // ═══════════════════════════════════════════

    /**
     * GET /workflow/start-next

     */
public function startNext(Request $request)
{
    $user = $request->user();

    if (!in_array($user->role, ['drawer', 'checker', 'filler', 'qa', 'designer'])) {
        return response()->json(['message' => 'Only production roles can start work.'], 403);
    }

    if (!$user->project_id) {
        return response()->json(['message' => 'You are not assigned to a project.'], 422);
    }

    if ($request->has('project_id') && (int)$request->input('project_id') !== $user->project_id) {
        return response()->json(['message' => 'You can only work on your assigned project.'], 403);
    }

    $table = ProjectOrderService::getTableName($user->project_id);

    // Determine role column
    [$idCol] = self::getRoleColumns($user->role);

    // 🟢 Keep current orders as is (don't pause)

    // 🟢 Assign next order
    $order = AssignmentEngine::startNext($user);

    if (!$order) {
        return response()->json([
            'message' => 'No orders available in your queue, or you are at max WIP capacity.',
            'queue_empty' => true,
        ]);
    }

    // 🟢 Create WorkItem for timer tracking
    $currentStage = StateMachine::STATE_TO_STAGE[$order->workflow_state] ?? null;
    $workItem = WorkItem::where('order_id', $order->id)
        ->where('project_id', $order->project_id)
        ->where('assigned_user_id', $user->id)
        ->when($currentStage, fn ($q) => $q->where('stage', $currentStage))
        ->where('status', 'in_progress')
        ->latest('id')
        ->first();

    if ($workItem) {
        $workItem->update([
            'last_timer_start' => now(),
        ]);
    } else {
        WorkItem::create([
            'order_id' => $order->id,
            'project_id' => $order->project_id,
            'stage' => $currentStage,
            'assigned_user_id' => $user->id,
            'team_id' => $user->team_id,
            'status' => 'in_progress',
            'assigned_at' => now(),
            'started_at' => now(),
            'time_spent_seconds' => 0,
            'last_timer_start' => now(),
            'attempt_number' => 1,
        ]);
    }

    NotificationService::orderAssigned($order, $user);

    return response()->json([
        'order' => $order->load(['project', 'team', 'workItems']),
        'message' => 'Order assigned successfully.',
    ]);
}



    /**
     * GET /workflow/my-current
     * Get the user's currently assigned in-progress order.
     * Also checks project table by role-specific ID (Metro-synced orders).
     */
public function myCurrent(Request $request)
{
    $user = $request->user();

    $currentOrder = null;
    $pausedOrders = collect();

    if (!$user->project_id) {
        return response()->json([
            'current_order' => null,
            'paused_orders' => [],
        ]);
    }

    // 🆕 STEP 1: Get current project
    $project = \App\Models\Project::find($user->project_id);

    $projectIds = [$user->project_id]; // default (SAFE)

    // ✅ APPLY QUEUE LOGIC ONLY FOR THESE QUEUES
    $allowedQueues = ['Canada', 'AUS Others FP', 'CAD'];

    if ($project && in_array($project->queue_name, $allowedQueues)) {

        $projectIds = \App\Models\Project::where('queue_name', $project->queue_name)
            ->where('status', 'active')
            ->pluck('id')
            ->toArray();
    }

    [$idCol] = self::getRoleColumns($user->role);

    // 🟢 STEP 2: Get latest active order across selected projects
    $latestOrder = null;

    foreach ($projectIds as $pid) {

        $table = ProjectOrderService::getTableName($pid);

        $order = DB::table($table)
            ->where($idCol ?? 'assigned_to', $user->id)
            ->where('status', 'in-progress')
            ->orderByDesc('started_at')
            ->first();

        if (!$order) continue;

        $orderTime = strtotime($order->started_at ?? '1970-01-01');

        if (!$latestOrder || $orderTime > strtotime($latestOrder->started_at ?? '1970-01-01')) {
            $latestOrder = $order;
        }
    }

    $currentOrder = $latestOrder;

    // 🟢 STEP 3: Timer logic (UNCHANGED)
    if ($currentOrder) {
        $sourceProjectId = (int) $currentOrder->project_id;
        $currentOrder->source_project_id = $sourceProjectId;

        // 🔥 IMPORTANT: send QUEUE project_id (for frontend match)
        if ($project && in_array($project->queue_name, $allowedQueues)) {
            $currentOrder->project_id = $user->project_id;
        }

        $workItem = WorkItem::where('project_id', $sourceProjectId)
            ->where('order_id', $currentOrder->id)
            ->where('assigned_user_id', $user->id)
            ->latest('id')
            ->first();

        if ($workItem) {

            $runningSeconds = $workItem->last_timer_start
                ? max(0, now()->diffInSeconds($workItem->last_timer_start))
                : 0;

            $currentOrder->timer_seconds =
                $workItem->time_spent_seconds + $runningSeconds;

        } else {
            $currentOrder->timer_seconds = 0;
        }
    }

    // 🟢 STEP 4: Fetch paused orders
    foreach ($projectIds as $pid) {

        $table = ProjectOrderService::getTableName($pid);

        $orders = DB::table($table)
            ->where($idCol ?? 'assigned_to', $user->id)
            ->where('status', 'paused')
            ->orderByDesc('started_at')
            ->get();

        $pausedOrders = $pausedOrders->merge($orders);
    }

    // 🔥 Fix project_id ONLY for allowed queues
    if ($project && in_array($project->queue_name, $allowedQueues)) {
        $pausedOrders = $pausedOrders->map(function ($order) use ($user) {
            $order->project_id = $user->project_id;
            return $order;
        });
    }

    return response()->json([
        'current_order' => $currentOrder,
        'paused_orders' => $pausedOrders->values(),
        'message' => "Fetched current and paused orders for {$user->role}.",
    ]);
}

    /**
     * Backward-compatible endpoint name.
     * GET /workflow/orders/images/{jobOrderId}
     */
    public function orderImageLinks(Request $request, string $jobOrderId)
    {
        return $this->orderAssetLinks($request, $jobOrderId);
    }

    /**
     * Standalone links endpoint for frontend.
     * GET /workflow/orders/links/{jobOrderId}
     *
     * Query params:
     * - project_id (optional)
     * - include_external (optional: 1|0) -> include live Focal assetdetail links for project 22
     */
    public function orderAssetLinks(Request $request, string $jobOrderId)
    {
        $jobOrderId = trim($jobOrderId);
        if ($jobOrderId === '') {
            return response()->json(['message' => 'job_order_id is required.'], 422);
        }

        $user = $request->user();
        $allowedProjectIds = $this->resolveProjectIds($user);

        if (empty($allowedProjectIds)) {
            return response()->json(['message' => 'No accessible projects found for this user.'], 403);
        }

        $requestedProjectId = (int) $request->query('project_id', 0);
        if ($requestedProjectId > 0 && !in_array($requestedProjectId, $allowedProjectIds, true)) {
            return response()->json(['message' => 'Access denied to this project.'], 403);
        }

        $candidateProjectIds = $requestedProjectId > 0
            ? [$requestedProjectId]
            : $allowedProjectIds;

        $tableLinks = collect();
        $projectsWithData = [];

        foreach ($candidateProjectIds as $pid) {
            $rows = $this->fetchProjectTableLinks((int) $pid, $jobOrderId);
            if ($rows->isNotEmpty()) {
                $projectsWithData[] = (int) $pid;
                $tableLinks = $tableLinks->merge($rows);
            }
        }

        $includeExternal = (string) $request->query('include_external', '0') === '1';
        $externalLinks = collect();

        // For project 1 (FP) orders, the order_number has an "FCP-" prefix — strip it for the Focal API.
        $focalJobId = preg_match('/^FCP-(.+)$/i', $jobOrderId, $m) ? $m[1] : $jobOrderId;

        // Project 1 (FP): always try Focal assetdetail — assets appear once the photographer uploads.
        if (in_array(1, $candidateProjectIds, true)) {
            $externalLinks = $externalLinks->merge(
                $this->fetchFocalAssetDetailLinks($focalJobId, 1)
            );
        }

        // Project 22 (Photos): include live assetdetail when explicitly requested.
        if ($includeExternal && in_array(22, $candidateProjectIds, true)) {
            $externalLinks = $externalLinks->merge(
                $this->fetchFocalAssetDetailLinks($jobOrderId, 22)
            );
        }

        // Project 25 (Prestige Photography): same supplier-enhancement API — try assetdetail when explicitly requested.
        if ($includeExternal && in_array(25, $candidateProjectIds, true)) {
            $externalLinks = $externalLinks->merge(
                $this->fetchFocalAssetDetailLinks($jobOrderId, 25)
            );
        }

        $allLinks = $tableLinks
            ->merge($externalLinks)
            ->unique(fn ($row) => strtolower(trim((string) ($row['url'] ?? ''))))
            ->filter(fn ($row) => !empty($row['url']))
            ->values();

        return response()->json([
            'job_order_id' => $jobOrderId,
            'requested_project_id' => $requestedProjectId > 0 ? $requestedProjectId : null,
            'matched_project_ids' => $projectsWithData,
            'include_external' => $includeExternal,
            'count' => $allLinks->count(),
            'links' => $allLinks,
        ]);
    }

    private function fetchProjectTableLinks(int $projectId, string $jobOrderId)
    {
        $table = "job_detail_{$projectId}_images";

        if (!Schema::hasTable($table)) {
            return collect();
        }

        $rows = DB::table($table)
            ->where('job_order_id', $jobOrderId)
            ->orderBy('id')
            ->get(['id', 'images_url', 'file_name', 'job_order_id']);

        return $rows->map(function ($row) use ($projectId, $table) {
            return [
                'source' => 'project_table',
                'source_table' => $table,
                'project_id' => $projectId,
                'job_order_id' => $row->job_order_id,
                'id' => $row->id,
                'name' => $row->file_name,
                'url' => $row->images_url,
                'link_type' => 'asset',
                'meta' => null,
            ];
        });
    }

    private function fetchFocalAssetDetailLinks(string $jobOrderId, int $projectId = 22)
    {
        $apiUrl = (string) env('FOCAL_CRM_PHOTO_API_URL', env('FOCAL_CRM_API_URL', 'https://api.focalagent.com/supplier-enhancement/v3/jobs'));
        $supplierSecret = (string) env('FOCAL_CRM_PHOTO_SUPPLIER_SECRET', env('FOCAL_CRM_SUPPLIER_SECRET', 'N4ctEg%$SXGg6SF4wu'));
        $subscriptionKey = (string) env('FOCAL_CRM_PHOTO_SUBSCRIPTION_KEY', env('FOCAL_CRM_SUBSCRIPTION_KEY', 'daee797833ca4dbd87fc98b1421c57b1'));

        try {
            $url = rtrim($apiUrl, '/') . '/' . $jobOrderId . '/assetdetail';

            $response = Http::timeout(60)
                ->withHeaders([
                    'Accept' => '*/*',
                    'Supplier-Secret' => $supplierSecret,
                    'Ocp-Apim-Subscription-Key' => $subscriptionKey,
                ])
                ->get($url);

            if (!$response->successful()) {
                return collect();
            }

            $assetDetail = $response->json() ?? [];

            return $this->extractFocalAssetLinks($assetDetail, $jobOrderId, $projectId);
        } catch (\Throwable $e) {
            return collect();
        }
    }

    private function extractFocalAssetLinks(array $assetDetail, string $jobOrderId, int $projectId = 22)
    {
        $links = collect();

        foreach ((array) ($assetDetail['RawPhotoAssets'] ?? []) as $row) {
            $url = $row['Url'] ?? $row['url'] ?? $row['URL'] ?? null;
            if (!$url) {
                continue;
            }
            $links->push([
                'source' => 'focal_assetdetail',
                'source_table' => null,
                'project_id' => $projectId,
                'job_order_id' => $jobOrderId,
                'id' => null,
                'name' => $row['FileName'] ?? $row['file_name'] ?? basename($url),
                'url' => $url,
                'link_type' => 'raw_photo_asset',
                'meta' => null,
            ]);
        }

        foreach ((array) ($assetDetail['Assets'] ?? []) as $row) {
            $url = $row['Url'] ?? $row['url'] ?? $row['URL'] ?? null;
            if (!$url) {
                continue;
            }
            $links->push([
                'source' => 'focal_assetdetail',
                'source_table' => null,
                'project_id' => $projectId,
                'job_order_id' => $jobOrderId,
                'id' => null,
                'name' => $row['FileName'] ?? $row['file_name'] ?? basename($url),
                'url' => $url,
                'link_type' => 'asset',
                'meta' => null,
            ]);
        }

        foreach ((array) ($assetDetail['AdditionalLinks'] ?? []) as $row) {
            $url = $row['Href'] ?? $row['href'] ?? null;
            if (!$url) {
                continue;
            }
            $links->push([
                'source' => 'focal_assetdetail',
                'source_table' => null,
                'project_id' => $projectId,
                'job_order_id' => $jobOrderId,
                'id' => null,
                'name' => $row['Description'] ?? $row['description'] ?? basename($url),
                'url' => $url,
                'link_type' => 'additional_link',
                'meta' => [
                    'description' => $row['Description'] ?? $row['description'] ?? null,
                ],
            ]);
        }

        return $links;
    }


    public function submitWork(Request $request, int $id)
    {
        $user = $request->user();
        $order = self::findOrderForUser($id, $user);

        // Verify the user is assigned to this order
        if (!self::isOrderAssignedToUser($order, $user)) {
            return response()->json(['message' => 'This order is not assigned to you.'], 403);
        }

        // Verify order is in an IN_ state or legacy workable state
        $legacyWorkableStates = ['DRAW', 'CHECK', 'FILLER', 'QA', 'DESIGN'];
        // Metro-synced orders may have these states when a drawer is working
        $metroDrawerStates = ['RECEIVED', 'PENDING_QA_REVIEW', 'REJECTED_BY_CHECK', 'REJECTED_BY_QA'];
        // Auto-transition from QUEUED_* to IN_* if still queued
        $inProgressState = \App\Services\StateMachine::getInProgressState($order->workflow_state);
        if ($inProgressState) {
            \App\Services\StateMachine::transition($order, $inProgressState, $user->id);
            $order = $order->fresh();
        }
        // Auto-transition Metro drawer states to IN_DRAW
        if (in_array($order->workflow_state, $metroDrawerStates) && in_array($user->role, ['drawer', 'designer'])) {
            $order->update([
                'workflow_state' => 'IN_DRAW',
                'assigned_to' => $user->id,
            ]);
            $order = $order->fresh();
        }
        if (!str_starts_with($order->workflow_state, 'IN_') && !in_array($order->workflow_state, $legacyWorkableStates)) {
            return response()->json(['message' => 'Order is not in a workable state.'], 422);
        }

        // If order is in legacy state, transition it to IN_* first
        $legacyToNewState = ['DRAW' => 'IN_DRAW', 'CHECK' => 'IN_CHECK', 'FILLER' => 'IN_FILLER', 'QA' => 'IN_QA', 'DESIGN' => 'IN_DESIGN'];
        if (isset($legacyToNewState[$order->workflow_state])) {
            $order->update([
                'workflow_state' => $legacyToNewState[$order->workflow_state],
                'assigned_to' => $user->id,
            ]);
        }

        // Check project isolation
        if (!in_array((int) $order->project_id, self::queueProjectIdsForUser($user), true)) {
            return response()->json(['message' => 'Project isolation violation.'], 403);
        }

        $comments = $request->input('comments');
        $order = AssignmentEngine::submitWork($order, $user, $comments);

        // Complete only the active WorkItem for this project/order/user/role-stage.
        // Important for filler: stage is stored as FILL in work_items.
        $stageMap = [
            'drawer' => 'DRAW',
            'designer' => 'DESIGN',
            'checker' => 'CHECK',
            'filler' => 'FILL',
            'qa' => 'QA',
        ];
        $targetStage = $stageMap[$user->role] ?? null;

        $workItemQuery = WorkItem::where('project_id', $order->project_id)
            ->where('order_id', $order->id)
            ->where('assigned_user_id', $user->id)
            ->where('status', 'in_progress');

        if ($targetStage) {
            $workItemQuery->where('stage', $targetStage);
        }

        $workItem = $workItemQuery->latest('id')->first();
        if ($workItem) {
            $workItem->update([
                'status' => 'completed',
                'completed_at' => now(),
                'last_timer_start' => null,
            ]);
        }

        NotificationService::workSubmitted($order, $user);

        return response()->json([
            'order' => $order,
            'message' => 'Work submitted successfully.',
        ]);
    }



/* Reject an order (checker/QA only) with mandatory reason.
     */
public function rejectOrder(Request $request, int $id)
{
    $request->validate([
        'reason' => 'required|string|min:5',
        'rejection_code' => 'required|string|in:quality,incomplete,wrong_specs,rework,formatting,missing_info',
        'route_to' => 'nullable|string|in:draw,check,design',
    ]);

    $user = $request->user();
    $order = self::findOrderForUser($id, $user);

    if (!self::isOrderAssignedToUser($order, $user)) {
        return response()->json(['message' => 'This order is not assigned to you.'], 403);
    }

    if (!in_array($user->role, ['checker', 'qa'])) {
        return response()->json(['message' => 'Only checkers and QA can reject orders.'], 403);
    }

    if (!in_array($order->workflow_state, ['IN_CHECK', 'IN_QA'])) {
        return response()->json(['message' => 'Order is not in a rejectable state.'], 422);
    }

    // ✅ ORIGINAL LOGIC (UNCHANGED)
    $order = AssignmentEngine::rejectOrder(
        $order,
        $user,
        $request->input('reason'),
        $request->input('rejection_code'),
        $request->input('route_to')
    );

    // ===============================
    // ✅ ADD: CRM ORDER ASSIGNMENTS UPDATE
    // ===============================
    try {
        $rejectedState = $user->role === 'qa'
            ? 'REJECTED_BY_QA'
            : 'REJECTED_BY_CHECK';

        DB::table('crm_order_assignments')
            ->where('order_number', $order->order_number)
            ->update([
                'workflow_state' => $rejectedState,

                // optional safe resets (only if needed)
                'checker_done' => null,
                'final_upload' => null,

                'updated_at' => now(),
            ]);
    } catch (\Exception $e) {
        \Log::error('CRM reject update failed', [
            'order_number' => $order->order_number,
            'error' => $e->getMessage(),
        ]);
    }

    // ✅ ORIGINAL LOGIC (UNCHANGED)
    NotificationService::orderRejected($order, $user, $request->input('reason'));

    return response()->json([
        'order' => $order,
        'message' => 'Order rejected successfully.',
    ]);
}


public function cancelOrder(Request $request, int $id)
{
    $request->validate([
        'reason' => 'required|string|min:5',
    ]);

    $user = $request->user();
    $order = self::findOrderForUser($id, $user);

    if (!in_array($user->role, ['operations_manager', 'project_manager', 'qa'])) {
        return response()->json(['message' => 'Only operations managers, project managers, and QA can cancel orders.'], 403);
    }

    if (!StateMachine::canTransition($order, 'CANCELLED')) {
        return response()->json(['message' => 'Order is not in a cancellable state.'], 422);
    }

    $order = AssignmentEngine::cancelOrder(
        $order,
        $user,
        $request->input('reason')
    );

    try {
        DB::table('crm_order_assignments')
            ->where('order_number', $order->order_number)
            ->update([
                'workflow_state' => 'CANCELLED',
                'checker_done' => null,
                'final_upload' => null,
                'updated_at' => now(),
            ]);
    } catch (\Exception $e) {
        \Log::error('CRM cancel update failed', [
            'order_number' => $order->order_number,
            'error' => $e->getMessage(),
        ]);
    }

    NotificationService::orderCancelled($order, $user, $request->input('reason'));

    return response()->json([
        'order' => $order,
        'message' => 'Order cancelled successfully.',
    ]);
}


    /**
     * POST /workflow/orders/{id}/hold
     * Place an order on hold (checker/QA/ops only).
     */
   public function holdOrder(Request $request, int $id)
{
    $request->validate([
        'hold_reason' => 'required|string|min:3',
    ]);

    $user = $request->user();
    $order = self::findOrderForUser($id, $user);

    if (!$order) {
        return response()->json([
            'message' => 'Order not found.'
        ], 404);
    }

    // =========================================
    // ✅ DRAWER → PENDING
    // =========================================
    if ($user->role === 'drawer') {

        if (!self::isOrderAssignedToUser($order, $user)) {
            return response()->json([
                'message' => 'This order is not assigned to you.'
            ], 403);
        }

        if (!in_array($order->workflow_state, ['IN_DRAW'])) {
            return response()->json([
                'message' => 'Order is not in drawing state.'
            ], 422);
        }

        DB::transaction(function () use ($order, $user, $request) {

            DB::table($order->getTable())
                ->where('id', $order->id)
                ->update([
                    'status' => 'pending',
                    'workflow_state' => 'PENDING_BY_DRAWER',
                    'rejection_reason' => $request->hold_reason,
                    'rejection_type' => 'pending',
                    'assigned_to' => null,
                    'updated_at' => now(),
                ]);

            if ($user->wip_count > 0) {
                $user->decrement('wip_count');
            }

            // CRM update
            DB::table('crm_order_assignments')
                ->where('order_number', $order->order_number)
                ->update([
                    'workflow_state' => 'PENDING_BY_DRAWER',
                    'updated_at' => now(),
                ]);
        });

        NotificationService::orderOnHold(
            $order,
            $user,
            'Pending: ' . $request->hold_reason
        );

        return response()->json([
            'order' => self::findOrderForUser($id, $user),
            'message' => 'Order moved to pending by drawer.',
        ]);
    }

    // =========================================
    // ✅ OTHER ROLES → ORIGINAL HOLD LOGIC
    // =========================================

    if (!in_array($user->role, StateMachine::HOLD_ALLOWED_ROLES)) {
        return response()->json([
            'message' => 'You are not allowed to place orders on hold.'
        ], 403);
    }

    if (!StateMachine::canTransition($order, 'ON_HOLD')) {
        return response()->json([
            'message' => 'Cannot put this order on hold from its current state.'
        ], 422);
    }

    DB::transaction(function () use ($order, $user, $request) {

        $order->update([
            'pre_hold_state' => $order->workflow_state
        ]);

        if ($order->assigned_to === $user->id && $user->wip_count > 0) {
            $user->decrement('wip_count');
        }

        StateMachine::transition(
            $order,
            'ON_HOLD',
            $user->id,
            [
                'hold_reason' => $request->input('hold_reason'),
            ]
        );
    });

    NotificationService::orderOnHold(
        $order,
        $user,
        $request->input('hold_reason')
    );

    return response()->json([
        'order' => $order->fresh(),
        'message' => 'Order placed on hold.',
    ]);
}

    /**
     * POST /workflow/orders/{id}/resume
     * Resume an order from ON_HOLD.
     */
    public function resumeOrder(Request $request, int $id)
    {
        $user = $request->user();

        // Project-aware lookup to avoid ID collision across project tables
        $projectId = $request->input('project_id');
        if ($projectId) {
            $order = Order::findInProject((int) $projectId, $id);
            if (!$order) {
                return response()->json(['message' => 'Order not found in the specified project.'], 404);
            }
        } else {
            // Fallback: try user's project first, then global scan
            $order = self::findOrderForUser($id, $user);
        }

        if ($order->workflow_state !== 'ON_HOLD') {
            return response()->json(['message' => 'Order is not on hold.'], 422);
        }

        // Allow managers, QA supervisors, and the assigned worker to resume
        $isAssignedWorker = ($order->assigned_to === $user->id)
            || ($order->drawer_id === $user->id)
            || ($order->checker_id === $user->id)
            || ($order->qa_id === $user->id);
        $isManager = in_array($user->role, ['operations_manager', 'project_manager', 'qa_supervisor', 'director', 'ceo']);

        if (!$isManager && !$isAssignedWorker) {
            return response()->json(['message' => 'You are not allowed to resume this order.'], 403);
        }

        // Determine which queue to return to based on what state it was in before hold
        $preHoldState = $order->pre_hold_state;
        if ($preHoldState && str_starts_with($preHoldState, 'IN_')) {
            // Was actively being worked on — return to queue for that stage
            $queueState = str_replace('IN_', 'QUEUED_', $preHoldState);
        } elseif ($preHoldState && str_starts_with($preHoldState, 'QUEUED_')) {
            // Was already in queue — return there
            $queueState = $preHoldState;
        } else {
            // Fallback: determine from workflow type
        $queueState = $order->workflow_type === 'PH_2_LAYER' ? 'QUEUED_DESIGN' : 'QUEUED_DRAW';
        }

        DB::transaction(function () use ($order, $queueState, $user) {
            StateMachine::transition($order, $queueState, $user->id, ['resumed_from_hold' => true]);
            $order->update(['pre_hold_state' => null]);
        });

        NotificationService::orderResumed($order, $user);

        return response()->json([
            'order' => $order->fresh(),
            'message' => 'Order resumed.',
        ]);
    }

    /**
     * GET /workflow/my-stats
     * Worker's today stats: completed, target, time.
     */
public function myStats(Request $request)
{
    $user = $request->user();

    // ✅ NEW: queue-safe project resolution
    $project = $user->project;

    $projectIds = [$user->project_id];

    if ($project && in_array($project->queue_name, ['Canada', 'Australia', 'AUS Others FP'])) {
        $projectIds = \App\Models\Project::where('queue_name', $project->queue_name)
            ->where('status', 'active')
            ->pluck('id')
            ->toArray();
    }

    // 🟢 Try WorkItem first
    $todayCompleted = WorkItem::where('assigned_user_id', $user->id)
        ->where('status', 'completed')
        ->whereDate('completed_at', today())
        ->count();

    // 🟡 Fallback: Metro tables (QUEUE SAFE)
    if ($todayCompleted === 0) {

        foreach ($projectIds as $pid) {

            $table = ProjectOrderService::getTableName($pid);

            if (Schema::hasTable($table)) {

                [$idCol, $doneCol, , $dateCol] = self::getRoleColumns($user->role);

                if ($idCol && $doneCol) {

                    $todayCompleted += DB::table($table)
                        ->where($idCol, $user->id)
                        ->where($doneCol, 'yes')
                        ->whereDate($dateCol, today())
                        ->count();
                }
            }
        }
    }

    $queueCount = 0;

    if ($user->project_id && in_array($user->role, ['drawer', 'checker', 'filler', 'qa', 'designer'])) {

        $project = $user->project;

        $queueStates = StateMachine::getQueuedStates(self::resolveWorkflowTypeForUser($user, $project));

        $roleQueueState = collect($queueStates)->first(function ($state) use ($user) {
            $role = StateMachine::getRoleForState($state);
            return $role === $user->role;
        });

        // 🟢 QUEUE PROJECT LOOP (IMPORTANT FIX)
        if ($roleQueueState) {

            foreach ($projectIds as $pid) {

                $queueCount += Order::forProject($pid)
                    ->where('workflow_state', $roleQueueState)
                    ->count();
            }
        }

        // 🟡 Legacy states (QUEUE SAFE)
        $legacyStateMap = [
            'drawer' => 'DRAW',
            'checker' => 'CHECK',
            'qa' => 'QA',
            'designer' => 'DESIGN'
        ];

        $idColMap = [
            'drawer' => 'drawer_id',
            'checker' => 'checker_id',
            'qa' => 'qa_id',
            'designer' => 'drawer_id'
        ];

        $doneColMap = [
            'drawer' => 'drawer_done',
            'checker' => 'checker_done',
            'qa' => 'final_upload',
            'designer' => 'drawer_done'
        ];

        $legacyState = $legacyStateMap[$user->role] ?? null;
        $idCol = $idColMap[$user->role] ?? null;
        $doneCol = $doneColMap[$user->role] ?? null;

        if ($legacyState && $idCol) {

            $countStates = [$legacyState];

            if ($user->role === 'drawer') {
                $countStates = array_merge($countStates, ['RECEIVED', 'PENDING_QA_REVIEW']);
            }

            foreach ($projectIds as $pid) {

                $queueCount += Order::forProject($pid)
                    ->whereIn('workflow_state', $countStates)
                    ->where($idCol, $user->id)
                    ->where(function ($q) use ($doneCol) {
                        $q->whereNull($doneCol)
                          ->orWhere($doneCol, '')
                          ->orWhere($doneCol, 'no');
                    })
                    ->count();
            }

            // 🔴 REJECTED (drawer only) — QUEUE SAFE
            if ($user->role === 'drawer') {

                foreach ($projectIds as $pid) {

                    $queueCount += Order::forProject($pid)
                        ->whereIn('workflow_state', ['REJECTED_BY_CHECK', 'REJECTED_BY_QA'])
                        ->where('assigned_to', $user->id)
                        ->where(function ($q) use ($doneCol) {
                            $q->whereNull($doneCol)
                              ->orWhere($doneCol, '')
                              ->orWhere($doneCol, 'no');
                        })
                        ->count();
                }
            }
        }
    }

    return response()->json([
        'today_completed' => $todayCompleted,
        'daily_target' => $user->daily_target ?? 0,
        'wip_count' => $user->wip_count,
        'queue_count' => $queueCount,
        'is_absent' => $user->is_absent,
    ]);
}

    /**
     * GET /workflow/my-queue
     * Worker's orders in queue (assigned or waiting for their role).
     */
public function myQueue(Request $request)
{
    $user = $request->user();

    if (!in_array($user->role, ['drawer', 'checker', 'filler', 'qa', 'designer'])) {
        return response()->json(['message' => 'Only production roles have a queue.'], 403);
    }

    if (!$user->project_id) {
        return response()->json(['orders' => []]);
    }

    $project = $user->project;

    // ✅ NEW: resolve project IDs (QUEUE SAFE - SAME AS myCurrent)
    $projectIds = [$user->project_id];

    if ($project && in_array($project->queue_name, ['Canada', 'Australia', 'AUS Others FP'])) {
        $projectIds = \App\Models\Project::where('queue_name', $project->queue_name)
            ->where('status', 'active')
            ->pluck('id')
            ->toArray();
    }

    $queueStates = StateMachine::getQueuedStates(self::resolveWorkflowTypeForUser($user, $project));
    
    $roleQueueState = collect($queueStates)->first(function ($state) use ($user) {
        $role = StateMachine::getRoleForState($state);
        return $role === $user->role;
    });
    
    $inProgressStates = ['IN_DRAW', 'IN_CHECK', 'IN_FILLER', 'IN_QA', 'IN_DESIGN'];

    $roleInProgressState = collect($inProgressStates)->first(function ($state) use ($user) {
        $role = StateMachine::getRoleForState($state);
        return $role === $user->role;
    });

    $legacyStateMap = ['drawer' => 'DRAW', 'checker' => 'CHECK', 'filler' => 'FILLER', 'qa' => 'QA', 'designer' => 'DESIGN'];
    $legacyState = $legacyStateMap[$user->role] ?? null;

    [$idCol] = self::getRoleColumns($user->role);

    $preTransitionStates = [];
    if ($user->role === 'drawer') {
        $preTransitionStates = ['RECEIVED', 'PENDING_QA_REVIEW'];
    }

    // ✅ NEW: collect orders from multiple projects
    $orders = collect();

    foreach ($projectIds as $pid) {

        $projectOrders = Order::forProject($pid)
            ->where(function ($query) use ($roleQueueState, $roleInProgressState, $legacyState, $idCol, $user, $preTransitionStates) {

                $query->where(function ($q) use ($roleQueueState, $idCol, $user) {
                        $q->where('workflow_state', $roleQueueState)
                          ->where(function ($sq) use ($user, $idCol) {
                              $sq->where('assigned_to', $user->id);
                              if ($idCol) {
                                  $sq->orWhere($idCol, $user->id);
                              }
                          });
                    })
                    ->orWhere(function ($q) use ($roleInProgressState, $user) {
                        $q->where('workflow_state', $roleInProgressState)
                          ->where('assigned_to', $user->id);
                    });

                if ($legacyState && $idCol) {
                    $query->orWhere(function ($q) use ($legacyState, $idCol, $user) {
                        $q->where('workflow_state', $legacyState)
                          ->where($idCol, $user->id);
                    });
                }

                if (!empty($preTransitionStates) && $idCol) {
                    $query->orWhere(function ($q) use ($preTransitionStates, $idCol, $user) {
                        $q->whereIn('workflow_state', $preTransitionStates)
                          ->where($idCol, $user->id);
                    });
                }

                $query->orWhere(function ($q) use ($user) {
                    $q->whereIn('workflow_state', ['REJECTED_BY_CHECK', 'REJECTED_BY_QA'])
                      ->where('assigned_to', $user->id);
                });
            })
            ->with(['project', 'team'])
            ->orderBy('priority', 'asc')
            ->orderBy('due_date', 'asc')
            ->get();

        // ✅ IMPORTANT: force queue project_id for frontend compatibility
        $projectOrders = $projectOrders->map(function ($order) use ($user) {
            $order->project_id = $user->project_id;
            return $order;
        });

        $orders = $orders->merge($projectOrders);
    }

    // ── CRM OVERLAY FALLBACK (UNCHANGED — JUST LOOP SAFE) ──
    if ($orders->isEmpty()) {

        [$crmIdCol, $crmDoneCol] = self::getRoleColumns($user->role);
        $crmCol = $crmIdCol ?? 'assigned_to';

        $crmAssignments = DB::table('crm_order_assignments')
            ->whereIn('project_id', $projectIds) // ✅ UPDATED for queue
            ->where($crmCol, $user->id)
            ->where(function ($q) use ($crmDoneCol) {
                if ($crmDoneCol) {
                    $q->whereNull($crmDoneCol)
                      ->orWhere($crmDoneCol, '')
                      ->orWhere($crmDoneCol, 'no');
                }
            })
            ->whereNotNull('workflow_state')
            ->where('workflow_state', '!=', '')
            ->get();

        if ($crmAssignments->isNotEmpty()) {

            foreach ($projectIds as $pid) {

                $table = ProjectOrderService::getTableName($pid);

                foreach ($crmAssignments as $crmAssign) {

                    $overlay = [];

                    foreach ([
                        'assigned_to','drawer_id','drawer_name','checker_id','checker_name',
                        'qa_id','qa_name','workflow_state','dassign_time','cassign_time',
                        'drawer_done','checker_done','final_upload','drawer_date',
                        'checker_date','ausFinaldate'
                    ] as $col) {
                        if (isset($crmAssign->$col) && $crmAssign->$col !== null && $crmAssign->$col !== '') {
                            $overlay[$col] = $crmAssign->$col;
                        }
                    }

                    if (!empty($overlay)) {
                        DB::table($table)
                            ->where('order_number', $crmAssign->order_number)
                            ->update(array_merge($overlay, ['updated_at' => now()]));
                    }
                }
            }

            // Re-fetch
            foreach ($projectIds as $pid) {

                $projectOrders = Order::forProject($pid)
                    ->whereIn('order_number', $crmAssignments->pluck('order_number'))
                    ->with(['project', 'team'])
                    ->orderBy('priority', 'asc')
                    ->orderBy('due_date', 'asc')
                    ->get();

                $projectOrders = $projectOrders->map(function ($order) use ($user) {
                    $order->project_id = $user->project_id;
                    return $order;
                });

                $orders = $orders->merge($projectOrders);
            }
        }
    }

    // Keep pending-by-drawer orders out of worker queue panels without
    // changing any underlying workflow or assignment behavior.
    $orders = $orders->reject(function ($order) {
        return data_get($order, 'workflow_state') === 'PENDING_BY_DRAWER';
    });

    return response()->json(['orders' => $orders->values()]);
}



    /**
     * GET /workflow/my-completed
     * Worker's completed orders today.
     * Falls back to project table for Metro-synced orders.
     */
public function myCompleted(Request $request)
{
    $user = $request->user();

        if (!in_array($user->role, ['drawer', 'checker', 'filler', 'qa', 'designer'])) {
            return response()->json(['message' => 'Only production roles have completed orders.'], 403);
        }

    // ✅ NEW: resolve project IDs (QUEUE SAFE)
    $project = \App\Models\Project::find($user->project_id);

    $projectIds = [$user->project_id];

    if ($project && in_array($project->queue_name, ['Canada', 'Australia', 'AUS Others FP'])) {
        $projectIds = \App\Models\Project::where('queue_name', $project->queue_name)
            ->where('status', 'active')
            ->pluck('id')
            ->toArray();
    }

    // 🟢 Try WorkItem first (new system)
    $completedOrderIds = WorkItem::where('assigned_user_id', $user->id)
        ->where('status', 'completed')
        ->whereDate('completed_at', today())
        ->pluck('order_id')
        ->unique();

    $orders = collect();

    if ($user->project_id && $completedOrderIds->isNotEmpty()) {

        // ✅ LOOP PROJECTS (QUEUE SUPPORT)
        foreach ($projectIds as $pid) {

            $projectOrders = Order::forProject($pid)
                ->whereIn('id', $completedOrderIds)
                ->with(['project', 'team'])
                ->orderBy('updated_at', 'desc')
                ->get();

            // ✅ FORCE QUEUE project_id (frontend fix)
            $projectOrders = $projectOrders->map(function ($order) use ($user) {
                $order->project_id = $user->project_id;
                return $order;
            });

            $orders = $orders->merge($projectOrders);
        }
    }

    // 🟡 Fallback: project tables (Metro orders)
    if ($orders->isEmpty() && $user->project_id) {

        foreach ($projectIds as $pid) {

            $table = ProjectOrderService::getTableName($pid);

            if (Schema::hasTable($table)) {

                [$idCol, $doneCol, , $dateCol] = self::getRoleColumns($user->role);

                if ($idCol && $doneCol) {

                    $projectOrders = collect(
                        DB::table($table)
                            ->where($idCol, $user->id)
                            ->where($doneCol, 'yes')
                            ->whereDate($dateCol, today())
                            ->orderByDesc('updated_at')
                            ->limit(50)
                            ->get()
                    );

                    // ✅ FORCE QUEUE project_id
                    $projectOrders = $projectOrders->map(function ($order) use ($user) {
                        $order->project_id = $user->project_id;
                        return $order;
                    });

                    $orders = $orders->merge($projectOrders);
                }
            }
        }
    }

    return response()->json(['orders' => $orders->values()]);
}

    /**
     * GET /workflow/my-history
     * Worker's order history (all time, paginated).
     * Falls back to project table for Metro-synced orders.
     */
public function myHistory(Request $request)
{
    $user = $request->user();

    if (!in_array($user->role, ['drawer', 'checker', 'filler', 'qa', 'designer'])) {
        return response()->json(['message' => 'Only production roles have history.'], 403);
    }

    // ✅ NEW: resolve project IDs (QUEUE SAFE)
    $project = \App\Models\Project::find($user->project_id);

    $projectIds = [$user->project_id];

    if ($project && in_array($project->queue_name, ['Canada', 'Australia', 'AUS Others FP'])) {
        $projectIds = \App\Models\Project::where('queue_name', $project->queue_name)
            ->where('status', 'active')
            ->pluck('id')
            ->toArray();
    }

    // 🟢 Try WorkItem first (new system)
    $completedOrderIds = WorkItem::where('assigned_user_id', $user->id)
        ->where('status', 'completed')
        ->pluck('order_id')
        ->unique();

    if ($user->project_id && $completedOrderIds->isNotEmpty()) {

        $orders = collect();

        // ✅ LOOP PROJECTS (QUEUE SUPPORT)
        foreach ($projectIds as $pid) {

            $projectOrders = Order::forProject($pid)
                ->whereIn('id', $completedOrderIds)
                ->with(['project', 'team'])
                ->orderBy('updated_at', 'desc')
                ->get();

            // ✅ FORCE QUEUE project_id (frontend fix)
            $projectOrders = $projectOrders->map(function ($order) use ($user) {
                $order->project_id = $user->project_id;
                return $order;
            });

            $orders = $orders->merge($projectOrders);
        }

        // ✅ MANUAL PAGINATION (since multi-project)
        $page = request()->get('page', 1);
        $perPage = 20;

        $paginated = new \Illuminate\Pagination\LengthAwarePaginator(
            $orders->forPage($page, $perPage)->values(),
            $orders->count(),
            $perPage,
            $page,
            ['path' => request()->url()]
        );

        return response()->json($paginated);
    }

    // 🟡 Fallback: project tables (Metro orders)
    if ($user->project_id) {

        foreach ($projectIds as $pid) {

            $table = ProjectOrderService::getTableName($pid);

            if (Schema::hasTable($table)) {

                [$idCol, $doneCol] = self::getRoleColumns($user->role);

                if ($idCol && $doneCol) {

                    $paginated = DB::table($table)
                        ->where($idCol, $user->id)
                        ->where($doneCol, 'yes')
                        ->orderByDesc('updated_at')
                        ->paginate(20);

                    // ✅ FORCE QUEUE project_id
                    $paginated->getCollection()->transform(function ($order) use ($user) {
                        $order->project_id = $user->project_id;
                        return $order;
                    });

                    return response()->json($paginated);
                }
            }
        }
    }

    return response()->json(['data' => [], 'meta' => []]);
}

    /**
     * GET /workflow/my-performance
     * Worker's performance stats (daily/weekly completion rates).
     */
    public function myPerformance(Request $request)
    {
        $user = $request->user();

        if (!in_array($user->role, ['drawer', 'checker', 'filler', 'qa', 'designer'])) {
            return response()->json(['message' => 'Only production roles have performance stats.'], 403);
        }

        // Try WorkItem first
        $todayCompleted = WorkItem::where('assigned_user_id', $user->id)
            ->where('status', 'completed')
            ->whereDate('completed_at', today())
            ->count();

        $weekCompleted = WorkItem::where('assigned_user_id', $user->id)
            ->where('status', 'completed')
            ->where('completed_at', '>=', now()->startOfWeek())
            ->count();

        $monthCompleted = WorkItem::where('assigned_user_id', $user->id)
            ->where('status', 'completed')
            ->where('completed_at', '>=', now()->startOfMonth())
            ->count();

        $dailyStats = [];
        for ($i = 6; $i >= 0; $i--) {
            $date = now()->subDays($i);
            $count = WorkItem::where('assigned_user_id', $user->id)
                ->where('status', 'completed')
                ->whereDate('completed_at', $date)
                ->count();
            $dailyStats[] = [
                'date' => $date->format('Y-m-d'),
                'day' => $date->format('D'),
                'count' => $count,
            ];
        }

        $avgTimeSeconds = WorkItem::where('assigned_user_id', $user->id)
            ->where('status', 'completed')
            ->where('time_spent_seconds', '>', 0)
            ->avg('time_spent_seconds') ?? 0;

        // Fallback: count from project table (Metro orders)
        if ($todayCompleted === 0 && $user->project_id) {
            $table = ProjectOrderService::getTableName($user->project_id);
            if (Schema::hasTable($table)) {
                [$idCol, $doneCol, , $dateCol] = self::getRoleColumns($user->role);
                if ($idCol && $doneCol) {
                    $todayCompleted = DB::table($table)
                        ->where($idCol, $user->id)
                        ->where($doneCol, 'yes')
                        ->whereDate($dateCol, today())
                        ->count();

                    $weekCompleted = DB::table($table)
                        ->where($idCol, $user->id)
                        ->where($doneCol, 'yes')
                        ->where($dateCol, '>=', now()->startOfWeek())
                        ->count();

                    $monthCompleted = DB::table($table)
                        ->where($idCol, $user->id)
                        ->where($doneCol, 'yes')
                        ->where($dateCol, '>=', now()->startOfMonth())
                        ->count();

                    $dailyStats = [];
                    for ($i = 6; $i >= 0; $i--) {
                        $date = now()->subDays($i);
                        $cnt = DB::table($table)
                            ->where($idCol, $user->id)
                            ->where($doneCol, 'yes')
                            ->whereDate($dateCol, $date)
                            ->count();
                        $dailyStats[] = [
                            'date' => $date->format('Y-m-d'),
                            'day' => $date->format('D'),
                            'count' => $cnt,
                        ];
                    }
                }
            }
        }

        // Completion rate (vs target)
        $weeklyTarget = ($user->daily_target ?? 0) * 5;
        $weeklyRate = $weeklyTarget > 0 ? round(($weekCompleted / $weeklyTarget) * 100, 1) : 100;

        return response()->json([
            'today_completed' => $todayCompleted,
            'week_completed' => $weekCompleted,
            'month_completed' => $monthCompleted,
            'daily_target' => $user->daily_target ?? 0,
            'weekly_target' => $weeklyTarget,
            'weekly_rate' => $weeklyRate,
            'avg_time_minutes' => round($avgTimeSeconds / 60, 1),
            'daily_stats' => $dailyStats,
        ]);
    }

    /**
     * POST /workflow/orders/{id}/reassign-queue
     * Worker reassigns order back to queue (unassigns from self).
     */
    public function reassignToQueue(Request $request, int $id)
    {
        $user = $request->user();
        $order = self::findOrderForUser($id, $user);

        if (!self::isOrderAssignedToUser($order, $user)) {
            return response()->json(['message' => 'This order is not assigned to you.'], 403);
        }

        $reason = $request->input('reason', 'Released by worker');

        // Determine which queue state to return to
        $currentState = $order->workflow_state;
        $queueState = match($currentState) {
            'IN_DRAW' => 'QUEUED_DRAW',
            'IN_CHECK' => 'QUEUED_CHECK',
            'IN_FILLER' => 'QUEUED_FILLER',
            'IN_QA' => 'QUEUED_QA',
            'IN_DESIGN' => 'QUEUED_DESIGN',
            default => null,
        };

        if (!$queueState) {
            return response()->json(['message' => 'Cannot release from current state.'], 422);
        }

        // Release the order
        $order->update([
            'workflow_state' => $queueState,
            'assigned_to' => null,
        ]);

        // Safely decrement wip_count
        if ($user->wip_count > 0) {
            $user->decrement('wip_count');
        }

        // Log the action
        AuditService::log($user->id, 'order_released', 'Order', $order->id, $order->project_id, [
            'reason' => $reason,
            'previous_state' => $currentState,
        ]);

        return response()->json([
            'order' => $order->fresh(['project', 'team']),
            'message' => 'Order released back to queue.',
        ]);
    }

    /**
     * POST /workflow/orders/{id}/flag-issue
     * Worker flags an issue on an order.
     */
    public function flagIssue(Request $request, int $id)
    {
        $request->validate([
            'flag_type' => 'required|string|in:quality,missing_info,wrong_specs,unclear_instructions,file_issue,other',
            'description' => 'required|string|min:5',
            'severity' => 'nullable|string|in:low,medium,high',
        ]);

        $user = $request->user();
        $order = self::findOrderForUser($id, $user);

        // Verify user is working on this order or is a supervisor
        if (!self::isOrderAssignedToUser($order, $user) && !in_array($user->role, ['operations_manager', 'director', 'ceo'])) {
            return response()->json(['message' => 'You cannot flag issues on orders not assigned to you.'], 403);
        }

        $flag = \App\Models\IssueFlag::create([
            'order_id' => $order->id,
            'flagged_by' => $user->id,
            'project_id' => $order->project_id,
            'flag_type' => $request->input('flag_type'),
            'description' => $request->input('description'),
            'severity' => $request->input('severity', 'medium'),
            'status' => 'open',
        ]);

        return response()->json([
            'flag' => $flag->load(['flagger', 'order']),
            'message' => 'Issue flagged successfully.',
        ]);
    }

    /**
     * POST /workflow/orders/{id}/request-help
     * Worker requests help/clarification on an order.
     */
    public function requestHelp(Request $request, int $id)
    {
        $request->validate([
            'question' => 'required|string|min:5',
        ]);

        $user = $request->user();
        $order = self::findOrderForUser($id, $user);

        // Verify user is working on this order
        if (!self::isOrderAssignedToUser($order, $user)) {
            return response()->json(['message' => 'You cannot request help on orders not assigned to you.'], 403);
        }

        $helpRequest = \App\Models\HelpRequest::create([
            'order_id' => $order->id,
            'requested_by' => $user->id,
            'project_id' => $order->project_id,
            'question' => $request->input('question'),
            'status' => 'pending',
        ]);

        // TODO: Notify supervisors

        return response()->json([
            'help_request' => $helpRequest->load(['requester', 'order']),
            'message' => 'Help request submitted.',
        ]);
    }


    /**
     * POST /workflow/orders/{id}/timer/start
     * Start work timer for an order.
     */
public function startTimer(Request $request, int $id)
{
    $user = $request->user();
    $role = $user->role;

    [$idCol, $doneCol, $inState] = self::getRoleColumns($role);

    // ✅ NEW: queue-safe project resolution
    $project = $user->project;

    $projectIds = [$user->project_id];

    if ($project && in_array($project->queue_name, ['Canada', 'Australia', 'AUS Others FP'])) {
        $projectIds = \App\Models\Project::where('queue_name', $project->queue_name)
            ->where('status', 'active')
            ->pluck('id')
            ->toArray();
    }

    $workflowMap = [
        'drawer'   => 'IN_DRAW',
        'designer' => 'IN_DESIGN',
        'checker'  => 'IN_CHECK',
        'filler'   => 'IN_FILLER',
        'qa'       => 'IN_QA',
    ];

    $workflowState = $workflowMap[$role] ?? 'IN_' . strtoupper($role);

    $stageMap = [
        'drawer'   => 'DRAW',
        'designer' => 'DESIGN',
        'checker'  => 'CHECK',
        'filler'   => 'FILL',
        'qa'       => 'QA',
    ];

    $stage = $stageMap[$role] ?? strtoupper($role);

    DB::transaction(function () use (
        $user,
        $role,
        $idCol,
        $doneCol,
        $projectIds,
        $id,
        $workflowState,
        $stage
    ) {

        // 🟡 Pause current running WorkItem
        $currentWorkItem = WorkItem::where('assigned_user_id', $user->id)
            ->where('status', 'in_progress')
            ->latest('id')
            ->first();

            // 🟢 update ALL possible queue tables safely
        // 🟢 FIND ORDER IN ANY QUEUE PROJECT TABLE
        $order = null;
        $tableUsed = null;

        foreach ($projectIds as $pid) {

            $table = ProjectOrderService::getTableName($pid);

            $found = DB::table($table)->where('id', $id)->first();

            if ($found) {
                $order = $found;
                $tableUsed = $table;
                break;
            }
        }

        if (!$order) {
            throw new \RuntimeException("Order #{$id} not found in any queue project table.");
        }

        // 🟢 Auto-assign role if empty
        if (
            $currentWorkItem
            && (
                (int) $currentWorkItem->order_id !== (int) $id
                || (int) $currentWorkItem->project_id !== (int) $order->project_id
            )
        ) {
            $elapsed = $currentWorkItem->last_timer_start
                ? now()->diffInSeconds($currentWorkItem->last_timer_start)
                : 0;

            $currentWorkItem->update([
                'time_spent_seconds' => $currentWorkItem->time_spent_seconds + $elapsed,
                'last_timer_start' => null,
                'status' => 'paused',
            ]);

            DB::table(ProjectOrderService::getTableName((int) $currentWorkItem->project_id))
                ->where('id', $currentWorkItem->order_id)
                ->update(['status' => 'pending']);
        }

        $updates = [];

        if ($idCol && (!$order->{$idCol} || $order->{$idCol} == 0)) {
            $updates[$idCol] = $user->id;
            $updates[
                $role === 'filler'
                    ? 'file_uploader_name'
                    : ($role === 'designer' ? 'drawer_name' : "{$role}_name")
            ] = $user->name;
        }

        $updates['assigned_to'] = $user->id;
        $updates['workflow_state'] = $workflowState;
        $updates['status'] = 'in-progress';
        $updates['started_at'] = now();
        if ($role === 'filler') $updates['current_layer'] = 'filler';
        if ($role === 'designer') $updates['current_layer'] = 'designer';

        if ($role === 'drawer' || $role === 'designer') $updates['dassign_time'] = now();
        if ($role === 'checker') $updates['cassign_time'] = now();
        if ($role === 'filler') $updates['fassign_time'] = now();

        DB::table($tableUsed)->where('id', $id)->update($updates);

        // 🟢 CRM update (unchanged logic)
        $crmAssignData = [
            'project_id' => $order->project_id,
            'order_number' => $order->order_number,
            $idCol => $user->id,
            (
                $role === 'filler'
                    ? 'file_uploader_name'
                    : ($role === 'designer' ? 'drawer_name' : "{$role}_name")
            ) => $user->name,
            'assigned_to' => $user->id,
            'workflow_state' => $workflowState,
            'updated_at' => now(),
        ];
        if ($role === 'filler' && Schema::hasColumn('crm_order_assignments', 'current_layer')) $crmAssignData['current_layer'] = 'filler';
        if ($role === 'designer' && Schema::hasColumn('crm_order_assignments', 'current_layer')) $crmAssignData['current_layer'] = 'designer';

        if ($role === 'drawer' || $role === 'designer') $crmAssignData['dassign_time'] = now();
        if ($role === 'checker') $crmAssignData['cassign_time'] = now();
        if ($role === 'filler' && Schema::hasColumn('crm_order_assignments', 'fassign_time')) $crmAssignData['fassign_time'] = now();

        DB::table('crm_order_assignments')
            ->updateOrInsert(
                [
                    'project_id' => $order->project_id,
                    'order_number' => $order->order_number
                ],
                $crmAssignData
            );

        // 🟢 WorkItem stage mapping (UNCHANGED)
        $stageMap = [
            'drawer'   => 'DRAW',
            'designer' => 'DESIGN',
            'checker'  => 'CHECK',
            'filler'   => 'FILL',
            'qa'       => 'QA',
        ];

        $stage = $stageMap[$role] ?? strtoupper($role);

        $workItem = WorkItem::where('project_id', $order->project_id)
            ->where('order_id', $order->id)
            ->where('assigned_user_id', $user->id)
            ->where('stage', $stage)
            ->whereIn('status', ['in_progress', 'paused'])
            ->latest('id')
            ->first();

        if (!$workItem) {
            $workItem = WorkItem::create([
                'order_id' => $order->id,
                'project_id' => $order->project_id,
                'stage' => $stage,
                'assigned_user_id' => $user->id,
                'team_id' => $user->team_id,
                'status' => 'in_progress',
                'assigned_at' => now(),
                'started_at' => now(),
                'time_spent_seconds' => 0,
            ]);
        }

        $workItem->update([
            'last_timer_start' => now(),
            'status' => 'in_progress',
            'stage' => $stage,
        ]);
    });

    // Reload order safely from correct table
    $finalOrder = null;
    foreach ($projectIds as $pid) {

        $table = ProjectOrderService::getTableName($pid);

        $found = DB::table($table)->where('id', $id)->first();

        if ($found) {
            $finalOrder = $found;
            break;
        }
    }

    $workItem = WorkItem::where('project_id', $finalOrder->project_id ?? $user->project_id)
        ->where('order_id', $id)
        ->where('assigned_user_id', $user->id)
        ->where('stage', $stage)
        ->where('status', 'in_progress')
        ->latest('id')
        ->first();

    return response()->json([
        'order' => $finalOrder,
        'work_item' => $workItem,
        'message' => 'Timer started safely across queue projects.',
    ]);
}




    /**
     * POST /workflow/orders/{id}/timer/stop
     * Stop work timer and record time.
     */
    public function stopTimer(Request $request, int $id)
    {
        $user = $request->user();
        $order = self::findOrderForUser($id, $user);

        if (!self::isOrderAssignedToUser($order, $user)) {
            return response()->json(['message' => 'This order is not assigned to you.'], 403);
        }

        $stage = StateMachine::STATE_TO_STAGE[$order->workflow_state] ?? null;

        $workItem = WorkItem::where('project_id', $order->project_id)
            ->where('order_id', $order->id)
            ->where('assigned_user_id', $user->id)
            ->where('status', 'in_progress')
            ->when($stage, fn ($query) => $query->where('stage', $stage))
            ->latest('id')
            ->first();

        if (!$workItem || !$workItem->last_timer_start) {
            return response()->json(['message' => 'Timer not running.'], 422);
        }

        $elapsed = now()->diffInSeconds($workItem->last_timer_start);
        $workItem->update([
            'time_spent_seconds' => $workItem->time_spent_seconds + $elapsed,
            'last_timer_start' => null,
        ]);

        return response()->json([
            'work_item' => $workItem,
            'time_added_seconds' => $elapsed,
            'total_time_seconds' => $workItem->time_spent_seconds,
            'message' => 'Timer stopped.',
        ]);
    }
    
    

    /**
     * GET /workflow/orders/{id}/details
     * Get full order details including supervisor notes, attachments, flags, help requests.
     */
    public function orderFullDetails(Request $request, int $id)
    {
        $user = $request->user();
        $order = self::findOrderForUser($id, $user);
        $order->load([
            'project',
            'team',
            'workItems' => fn ($query) => $query
                ->where('project_id', $order->project_id)
                ->with('assignedUser'),
        ]);

        // Get help requests for this order
        $helpRequests = \App\Models\HelpRequest::where('order_id', $order->id)
            ->with(['requester', 'responder'])
            ->get();

        // Get issue flags for this order
        $issueFlags = \App\Models\IssueFlag::where('order_id', $order->id)
            ->with(['flagger', 'resolver'])
            ->get();

        // Current work item time tracking
        $currentWorkItem = WorkItem::where('order_id', $order->id)
            ->where('project_id', $order->project_id)
            ->where('assigned_user_id', $user->id)
            ->where('status', 'in_progress')
            ->first();

        $currentTimeSeconds = 0;
        if ($currentWorkItem) {
            $currentTimeSeconds = (int) $currentWorkItem->time_spent_seconds;
            if ($currentWorkItem->last_timer_start) {
                $currentTimeSeconds += (int) abs(now()->diffInSeconds($currentWorkItem->last_timer_start));
            }
        }

        return response()->json([
            'order' => $order,
            'supervisor_notes' => $order->supervisor_notes,
            'attachments' => $order->attachments ?? [],
            'help_requests' => $helpRequests,
            'issue_flags' => $issueFlags,
            'current_time_seconds' => $currentTimeSeconds,
            'timer_running' => $currentWorkItem?->last_timer_start !== null,
        ]);
    }

    // ═══════════════════════════════════════════
    // MANAGEMENT ENDPOINTS (Ops/Director/CEO)
    // ═══════════════════════════════════════════

    /**
     * GET /workflow/{projectId}/queue-health
     * Queue health for a project: counts per state, oldest item, SLA breaches.
     */
    public function queueHealth(Request $request, int $projectId)
    {
        $project = Project::findOrFail($projectId);

        $states = $project->workflow_type === 'PH_2_LAYER'
            ? StateMachine::PH_STATES
            : StateMachine::FP_STATES;

        $counts = [];
        foreach ($states as $state) {
            $query = Order::forProject($projectId)->where('workflow_state', $state);
            $counts[$state] = [
                'count' => $query->count(),
                'oldest' => $query->min('received_at'),
            ];
        }

        // SLA breaches (orders past due_date)
        $slaBreaches = Order::forProject($projectId)
            ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
            ->whereNotNull('due_date')
            ->where('due_date', '<', now())
            ->count();

        return response()->json([
            'project_id' => $projectId,
            'workflow_type' => $project->workflow_type,
            'state_counts' => $counts,
            'sla_breaches' => $slaBreaches,
            'total_pending' => Order::forProject($projectId)
                ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
                ->count(),
            'total_delivered' => Order::forProject($projectId)
                ->where('workflow_state', 'DELIVERED')
                ->count(),
        ]);
    }

    /**
     * GET /workflow/{projectId}/staffing
     * Staffing overview for a project.
     */
    public function staffing(Request $request, int $projectId)
    {
        $project = Project::findOrFail($projectId);

        $stages = StateMachine::getStages($project->workflow_type);
        $staffing = [];

        foreach ($stages as $stage) {
            $role = StateMachine::STAGE_TO_ROLE[$stage];
            $users = \App\Models\User::where('project_id', $projectId)
                ->where('role', $role)
                ->get(['id', 'name', 'role', 'team_id', 'is_active', 'is_absent', 'wip_count', 'today_completed', 'last_activity', 'daily_target']);

            $staffing[$stage] = [
                'role' => $role,
                'total' => $users->count(),
                'active' => $users->where('is_active', true)->where('is_absent', false)->count(),
                'absent' => $users->where('is_absent', true)->count(),
                'users' => $users,
            ];
        }

        return response()->json([
            'project_id' => $projectId,
            'staffing' => $staffing,
        ]);
    }

    /**
     * POST /workflow/orders/{id}/reassign
     * Manually reassign an order (management only).
     */
    public function reassignOrder(Request $request, int $id)
    {
        $request->validate([
            'user_id' => 'nullable|exists:users,id',
            'reason' => 'required|string',
            'project_id' => 'nullable|integer|exists:projects,id',
        ]);

        $actor = $request->user();
        $projectId = $request->input('project_id');
        $order = $projectId
            ? (Order::findInProject($projectId, $id) ?? Order::findOrFailGlobal($id))
            : Order::findOrFailGlobal($id);

        $oldAssignee = $order->assigned_to;

        // If reassigning to null, return to queue
        if (!$request->input('user_id')) {
            $queueState = str_replace('IN_', 'QUEUED_', $order->workflow_state);
            $isInProgress = str_starts_with($order->workflow_state, 'IN_');
            $isRejected = in_array($order->workflow_state, ['REJECTED_BY_CHECK', 'REJECTED_BY_QA']);

            // Map rejected states to the correct queue
            if ($isRejected) {
                if ($order->workflow_state === 'REJECTED_BY_CHECK') {
                    $queueState = 'QUEUED_DRAW';
                } else {
                    // REJECTED_BY_QA → default to QUEUED_CHECK, or QUEUED_DRAW if route specified
                    $queueState = 'QUEUED_CHECK';
                    if ($order->workflow_type === 'PH_2_LAYER') {
                        $queueState = 'QUEUED_DESIGN';
                    }
                }
            }

            if ($isInProgress || $isRejected) {
                DB::transaction(function () use ($order, $oldAssignee, $queueState, $actor, $request, $isInProgress) {
                    if ($isInProgress) {
                        // Abandon current work item
                        WorkItem::where('project_id', $order->project_id)
                            ->where('order_id', $order->id)
                            ->where('assigned_user_id', $oldAssignee)
                            ->where('status', 'in_progress')
                            ->update(['status' => 'abandoned', 'completed_at' => now()]);
                    }

                    // Safely decrement old assignee's wip_count
                    if ($oldAssignee) {
                        \App\Models\User::where('id', $oldAssignee)->where('wip_count', '>', 0)->decrement('wip_count');
                    }

                    StateMachine::transition($order, $queueState, $actor->id, [
                        'reason' => $request->input('reason'),
                    ]);
                });
            }
        } else {
            $newUser = \App\Models\User::findOrFail($request->input('user_id'));

            // Cross-team flag: management can override team constraint for checker/QA
            $isCrossTeam = $order->team_id && $newUser->team_id
                && in_array($newUser->role, ['checker', 'qa'])
                && $newUser->team_id !== $order->team_id;

            DB::transaction(function () use ($order, $oldAssignee, $newUser, $actor, $request, $isCrossTeam) {
                if ($isCrossTeam) {
                    // Log cross-team override for audit trail
                    AuditService::log(
                        $actor->id,
                        'CROSS_TEAM_ASSIGN',
                        'Order',
                        (int) $order->id,
                        (int) $order->project_id,
                        ['team_id' => $order->team_id],
                        ['team_id' => $newUser->team_id, 'new_user_id' => $newUser->id, 'reason' => $request->input('reason')]
                    );
                }
                // Safely decrement old user's WIP
                if ($oldAssignee) {
                    \App\Models\User::where('id', $oldAssignee)->where('wip_count', '>', 0)->decrement('wip_count');
                }
                
                // Assign to new user — set role-specific columns
                $assignData = ['assigned_to' => $newUser->id, 'team_id' => $newUser->team_id];
                $role = $newUser->role;
                if ($role === 'drawer' || $role === 'designer') {
                    $assignData['drawer_id']    = $newUser->id;
                    $assignData['drawer_name']  = $newUser->name;
                    $assignData['dassign_time'] = now();
                } elseif ($role === 'checker') {
                    $assignData['checker_id']    = $newUser->id;
                    $assignData['checker_name']  = $newUser->name;
                    $assignData['cassign_time']  = now();
                } elseif ($role === 'qa') {
                    $assignData['qa_id']   = $newUser->id;
                    $assignData['qa_name'] = $newUser->name;
                }
                $order->update($assignData);
                $newUser->increment('wip_count');

                // Sync to project table + CRM
                AssignmentEngine::syncToProjectTable($order->fresh(), $newUser, 'start');

                AuditService::logAssignment(
                    $order->id,
                    $order->project_id,
                    $oldAssignee,
                    $newUser->id,
                    $request->input('reason')
                );
            });
        }

        // ── Sync reassignment to crm_order_assignments ──
        // Only write fields that were actually changed (assigned_to, workflow_state).
        // Do NOT overwrite other roles' columns from the project table — external
        // sync may have wiped them, and the CRM holds the authoritative values.
        $fresh = $order->fresh();
        $assignData = [
            'assigned_to'    => $fresh->assigned_to,
            'workflow_state' => $fresh->workflow_state,
            'updated_at'     => now(),
        ];
        $existingAssign = DB::table('crm_order_assignments')
            ->where('project_id', $fresh->project_id)
            ->where('order_number', $fresh->order_number)
            ->first();
        if ($existingAssign) {
            DB::table('crm_order_assignments')->where('id', $existingAssign->id)->update($assignData);
        } else {
            // New CRM row: safe to include all known values
            $assignData['project_id']   = $fresh->project_id;
            $assignData['order_number'] = $fresh->order_number;
            $assignData['created_at']   = now();
            $assignData['drawer_id']    = $fresh->drawer_id;
            $assignData['drawer_name']  = $fresh->drawer_name;
            $assignData['checker_id']   = $fresh->checker_id;
            $assignData['checker_name'] = $fresh->checker_name;
            $assignData['qa_id']        = $fresh->qa_id;
            $assignData['qa_name']      = $fresh->qa_name;
            $assignData['dassign_time'] = $fresh->dassign_time;
            $assignData['cassign_time'] = $fresh->cassign_time;
            DB::table('crm_order_assignments')->insert($assignData);
        }

        return response()->json([
            'order' => $fresh,
            'message' => 'Order reassigned.',
        ]);
    }

    /**
     * POST /workflow/receive
     * Receive a new order into the system (creates in RECEIVED state).
     */
    public function receiveOrder(Request $request)
    {
        $request->validate([
            'project_id' => 'required|exists:projects,id',
            'client_reference' => 'required|string',
            'priority' => 'nullable|in:low,normal,high,urgent',
            'due_date' => 'nullable|date',
            'metadata' => 'nullable|array',
        ]);

        $project = Project::findOrFail($request->input('project_id'));

        // Idempotency check: client_reference + project
        $existing = Order::forProject($project->id)
            ->where('client_reference', $request->input('client_reference'))
            ->first();

        if ($existing) {
            return response()->json([
                'message' => 'Duplicate order: this client reference already exists for this project.',
                'existing_order' => $existing,
            ], 409);
        }

        $order = DB::transaction(function () use ($request, $project) {
            $order = Order::createForProject($project->id, [
                'order_number' => 'ORD-' . strtoupper(uniqid()),
                'client_reference' => $request->input('client_reference'),
                'workflow_state' => 'RECEIVED',
                'workflow_type' => $project->workflow_type,
                'current_layer' => $project->workflow_type === 'PH_2_LAYER' ? 'designer' : 'drawer',
                'status' => 'pending',
                'priority' => $request->input('priority', 'normal'),
                'due_date' => $request->input('due_date'),
                'received_at' => now(),
                'metadata' => $request->input('metadata'),
            ]);

            // Auto-advance to first queue
            $firstQueue = $project->workflow_type === 'PH_2_LAYER' ? 'QUEUED_DESIGN' : 'QUEUED_DRAW';
            StateMachine::transition($order, $firstQueue, auth()->id());

            return $order;
        });

        NotificationService::orderReceived($order, auth()->user());

        return response()->json([
            'order' => $order->fresh(),
            'message' => 'Order received and queued.',
        ], 201);
    }

    /**
     * GET /workflow/orders/{id}
     * Get order details with role-based field visibility.
     */
    public function orderDetails(Request $request, int $id)
    {
        $user = $request->user();
        $order = Order::findOrFailGlobal($id);
        $order->load(['project', 'team', 'assignedUser', 'workItems.assignedUser']);

        // Project isolation check for production users
        if (in_array($user->role, ['drawer', 'checker', 'filler', 'qa', 'designer'])) {
            if ($order->project_id !== $user->project_id) {
                return response()->json(['message' => 'Access denied.'], 403);
            }
            // Workers can only see their own assigned orders
            if (!self::isOrderAssignedToUser($order, $user)) {
                return response()->json(['message' => 'Access denied.'], 403);
            }
        }

        // Role-based field filtering
        $data = $this->filterOrderFieldsByRole($order, $user->role);

        return response()->json(['order' => $data]);
    }

    /**
     * GET /workflow/{projectId}/orders
     * List orders for a project with filters.
     */
    public function projectOrders(Request $request, int $projectId)
    {
        $query = Order::forProject($projectId)
            ->with(['assignedUser:id,name,role', 'team:id,name']);

        $user = $request->user();
        if (!in_array($user->role, ['ceo', 'director'])) {
            if ($user->project_id && $user->project_id != $projectId) {
                return response()->json(['message' => 'Access denied to this project.'], 403);
            }
        }

        if ($request->has('state')) {
            $query->where('workflow_state', $request->input('state'));
        }
        if ($request->has('priority')) {
            $query->where('priority', $request->input('priority'));
        }
        if ($request->has('assigned_to')) {
            $query->where('assigned_to', $request->input('assigned_to'));
        }
        if ($request->has('team_id')) {
            $query->where('team_id', $request->input('team_id'));
        }

        $orders = $query
            ->orderByRaw("FIELD(priority, 'rush', 'urgent', 'high', 'normal', 'low', '') ASC")
            ->orderBy('received_at', 'desc')
            ->paginate(50);

        return response()->json($orders);
    }

    /**
     * GET /workflow/work-items/{orderId}
     * Get all work items (per-stage history) for an order.
     */
    public function workItemHistory(int $orderId)
    {
        $items = WorkItem::where('order_id', $orderId)
            ->with('assignedUser:id,name,role')
            ->orderBy('created_at', 'asc')
            ->get();

        return response()->json(['work_items' => $items]);
    }
    
    /**
     * PUT /workflow/orders/{id}/instruction
     * Add or update instruction text for an order in the dynamic project table.
     */
    public function updateInstruction(Request $request, int $id)
    {
        $request->validate([
            'instruction' => 'nullable',
            'plan_type' => 'nullable|string|max:255',
            'code' => 'nullable|string|max:255',
            'it_datetime' => 'nullable|date',
            'received_at' => 'nullable|date',
            'total_raw_files' => 'nullable|integer|min:0',
            'hdr_images_count' => 'nullable|integer|min:0',
            'single_images_count' => 'nullable|integer|min:0',
            'final_images_count' => 'nullable|integer|min:0',
            'edited_images_count' => 'nullable|integer|min:0',
            'project_id' => 'nullable|integer|exists:projects,id',
        ]);

        $actor = $request->user();

        if (!in_array($actor->role, [
            'ceo',
            'director',
            'operations_manager',
            'project_manager',
            'qa',
            'live_qa',
            'drawer',
            'checker',
            'designer',
        ])) {
            return response()->json(['message' => 'You are not allowed to update order instructions.'], 403);
        }

        $projectId = $request->input('project_id');
        $order = $projectId
            ? (Order::findInProject($projectId, $id) ?? Order::findOrFailGlobal($id))
            : self::findOrderForUser($id, $actor);

        $managementRoles = ['ceo', 'director', 'operations_manager', 'project_manager'];

        if (
            $actor->project_id &&
            !in_array($actor->role, $managementRoles) &&
            (int) $order->project_id !== (int) $actor->project_id
        ) {
            return response()->json(['message' => 'Project isolation violation.'], 403);
        }

        $instruction = trim((string) ($request->input('instruction') ?? ''));
        $instruction = $instruction === '' ? null : $instruction;

        $planType = trim((string) ($request->input('plan_type') ?? ''));
        $planType = $planType === '' ? null : $planType;

        $code = trim((string) ($request->input('code') ?? ''));
        $code = $code === '' ? null : $code;

        $itDatetime = $request->input('it_datetime');
        if (is_string($itDatetime)) {
            $itDatetime = trim($itDatetime);
            $itDatetime = $itDatetime === '' ? null : $itDatetime;
        }

        $receivedAt = $request->input('received_at');
        if (is_string($receivedAt)) {
            $receivedAt = trim($receivedAt);
            $receivedAt = $receivedAt === '' ? null : $receivedAt;
        }

        $totalRawFiles = $request->input('total_raw_files');
        if ($totalRawFiles !== null) {
            $totalRawFiles = (int) $totalRawFiles;
        }

        $hdrImagesCount = $request->input('hdr_images_count');
        if ($hdrImagesCount !== null) {
            $hdrImagesCount = (int) $hdrImagesCount;
        }

        $singleImagesCount = $request->input('single_images_count');
        if ($singleImagesCount !== null) {
            $singleImagesCount = (int) $singleImagesCount;
        }

        $finalImagesCount = $request->input('final_images_count');
        if ($finalImagesCount !== null) {
            $finalImagesCount = (int) $finalImagesCount;
        }

        $editedImagesCount = $request->input('edited_images_count');
        if ($editedImagesCount !== null) {
            $editedImagesCount = (int) $editedImagesCount;
        }

        $hasInstructionInput = $request->exists('instruction');
        $hasPlanTypeInput = $request->exists('plan_type');
        $hasCodeInput = $request->exists('code');
        $hasItDatetimeInput = $request->exists('it_datetime');
        $hasReceivedAtInput = $request->exists('received_at');
        $hasTotalRawFilesInput = $request->exists('total_raw_files');
        $hasHdrImagesCountInput = $request->exists('hdr_images_count');
        $hasSingleImagesCountInput = $request->exists('single_images_count');
        $hasFinalImagesCountInput = $request->exists('final_images_count');
        $hasEditedImagesCountInput = $request->exists('edited_images_count');

        if (!$hasInstructionInput && !$hasPlanTypeInput && !$hasCodeInput && !$hasItDatetimeInput && !$hasReceivedAtInput && !$hasTotalRawFilesInput && !$hasHdrImagesCountInput && !$hasSingleImagesCountInput && !$hasFinalImagesCountInput && !$hasEditedImagesCountInput) {
            return response()->json([
                'message' => 'Nothing to update.',
            ], 422);
        }

        DB::transaction(function () use ($order, $actor, $instruction, $planType, $code, $itDatetime, $receivedAt, $totalRawFiles, $hdrImagesCount, $singleImagesCount, $finalImagesCount, $editedImagesCount, $hasInstructionInput, $hasPlanTypeInput, $hasCodeInput, $hasItDatetimeInput, $hasReceivedAtInput, $hasTotalRawFilesInput, $hasHdrImagesCountInput, $hasSingleImagesCountInput, $hasFinalImagesCountInput, $hasEditedImagesCountInput) {
            $before = [];
            $after = [];
            $orderUpdates = [];

            if ($hasInstructionInput) {
                $before['instruction'] = $order->instruction;
                $after['instruction'] = $instruction;
                $orderUpdates['instruction'] = $instruction;
            }

            if ($hasPlanTypeInput) {
                $before['plan_type'] = $order->plan_type;
                $after['plan_type'] = $planType;
                $orderUpdates['plan_type'] = $planType;
            }

            if ($hasCodeInput) {
                $before['code'] = $order->code;
                $after['code'] = $code;
                $orderUpdates['code'] = $code;
            }

            if ($hasItDatetimeInput) {
                $before['it_datetime'] = $order->it_datetime;
                $after['it_datetime'] = $itDatetime;
                $orderUpdates['it_datetime'] = $itDatetime;
            }

            if ($hasReceivedAtInput) {
                $before['received_at'] = $order->received_at;
                $after['received_at'] = $receivedAt;
                $orderUpdates['received_at'] = $receivedAt;
            }

            if ($hasTotalRawFilesInput) {
                $before['total_raw_files'] = $order->total_raw_files;
                $after['total_raw_files'] = $totalRawFiles;
                $orderUpdates['total_raw_files'] = $totalRawFiles;
            }

            if ($hasHdrImagesCountInput) {
                $before['hdr_images_count'] = $order->hdr_images_count;
                $after['hdr_images_count'] = $hdrImagesCount;
                $orderUpdates['hdr_images_count'] = $hdrImagesCount;
            }

            if ($hasSingleImagesCountInput) {
                $before['single_images_count'] = $order->single_images_count;
                $after['single_images_count'] = $singleImagesCount;
                $orderUpdates['single_images_count'] = $singleImagesCount;
            }

            if ($hasFinalImagesCountInput) {
                $before['final_images_count'] = $order->final_images_count;
                $after['final_images_count'] = $finalImagesCount;
                $orderUpdates['final_images_count'] = $finalImagesCount;
            }

            if ($hasEditedImagesCountInput) {
                $before['edited_images_count'] = $order->edited_images_count;
                $after['edited_images_count'] = $editedImagesCount;
                $orderUpdates['edited_images_count'] = $editedImagesCount;
            }

            if (!empty($orderUpdates)) {
                $order->update($orderUpdates);
            }

            if (Schema::hasTable('crm_order_assignments')) {
                $existingCrm = DB::table('crm_order_assignments')
                    ->where('project_id', $order->project_id)
                    ->where('order_number', $order->order_number)
                    ->first();

                $crmData = ['updated_at' => now()];

                if ($hasInstructionInput && Schema::hasColumn('crm_order_assignments', 'instruction')) {
                    $crmData['instruction'] = $instruction;
                }

                if ($hasPlanTypeInput && Schema::hasColumn('crm_order_assignments', 'plan_type')) {
                    $crmData['plan_type'] = $planType;
                }

                if ($hasCodeInput && Schema::hasColumn('crm_order_assignments', 'code')) {
                    $crmData['code'] = $code;
                }

                if ($hasItDatetimeInput && Schema::hasColumn('crm_order_assignments', 'it_datetime')) {
                    $crmData['it_datetime'] = $itDatetime;
                }

                if ($hasReceivedAtInput && Schema::hasColumn('crm_order_assignments', 'received_at')) {
                    $crmData['received_at'] = $receivedAt;
                }

                if ($hasTotalRawFilesInput && Schema::hasColumn('crm_order_assignments', 'total_raw_files')) {
                    $crmData['total_raw_files'] = $totalRawFiles;
                }

                if ($hasHdrImagesCountInput && Schema::hasColumn('crm_order_assignments', 'hdr_images_count')) {
                    $crmData['hdr_images_count'] = $hdrImagesCount;
                }

                if ($hasSingleImagesCountInput && Schema::hasColumn('crm_order_assignments', 'single_images_count')) {
                    $crmData['single_images_count'] = $singleImagesCount;
                }

                if ($hasFinalImagesCountInput && Schema::hasColumn('crm_order_assignments', 'final_images_count')) {
                    $crmData['final_images_count'] = $finalImagesCount;
                }

                if ($hasEditedImagesCountInput && Schema::hasColumn('crm_order_assignments', 'edited_images_count')) {
                    $crmData['edited_images_count'] = $editedImagesCount;
                }

                if ($existingCrm) {
                    DB::table('crm_order_assignments')
                        ->where('id', $existingCrm->id)
                        ->update($crmData);
                } elseif (count($crmData) > 1) {
                    DB::table('crm_order_assignments')->insert(array_merge($crmData, [
                        'project_id' => $order->project_id,
                        'order_number' => $order->order_number,
                        'created_at' => now(),
                    ]));
                }
            }

            AuditService::log(
                $actor->id,
                ($hasInstructionInput || $hasPlanTypeInput || $hasCodeInput || $hasReceivedAtInput || $hasTotalRawFilesInput || $hasHdrImagesCountInput || $hasSingleImagesCountInput || $hasFinalImagesCountInput || $hasEditedImagesCountInput)
                    && (
                        ($hasInstructionInput ? 1 : 0)
                        + ($hasPlanTypeInput ? 1 : 0)
                        + ($hasCodeInput ? 1 : 0)
                        + ($hasItDatetimeInput ? 1 : 0)
                        + ($hasReceivedAtInput ? 1 : 0)
                        + ($hasTotalRawFilesInput ? 1 : 0)
                        + ($hasHdrImagesCountInput ? 1 : 0)
                        + ($hasSingleImagesCountInput ? 1 : 0)
                        + ($hasFinalImagesCountInput ? 1 : 0)
                        + ($hasEditedImagesCountInput ? 1 : 0)
                    ) > 1
                    ? 'update_order_details'
                    : ($hasCodeInput
                        ? 'update_code'
                        : ($hasPlanTypeInput ? 'update_plan_type' : ($hasItDatetimeInput ? 'update_it_datetime' : ($hasReceivedAtInput ? 'update_received_at' : ($hasTotalRawFilesInput ? 'update_total_raw_files' : ($hasHdrImagesCountInput ? 'update_hdr_images_count' : ($hasSingleImagesCountInput ? 'update_single_images_count' : ($hasFinalImagesCountInput ? 'update_final_images_count' : ($hasEditedImagesCountInput ? 'update_edited_images_count' : 'update_instruction'))))))))),
                'Order',
                (int) $order->id,
                (int) $order->project_id,
                $before,
                $after
            );
        });

        return response()->json([
            'order' => $order->fresh(),
            'message' => (
                (($hasInstructionInput ? 1 : 0) + ($hasPlanTypeInput ? 1 : 0) + ($hasCodeInput ? 1 : 0) + ($hasItDatetimeInput ? 1 : 0) + ($hasReceivedAtInput ? 1 : 0) + ($hasTotalRawFilesInput ? 1 : 0) + ($hasHdrImagesCountInput ? 1 : 0) + ($hasSingleImagesCountInput ? 1 : 0) + ($hasFinalImagesCountInput ? 1 : 0) + ($hasEditedImagesCountInput ? 1 : 0)) > 1
            )
                ? 'Order details updated successfully.'
                : ($hasCodeInput
                    ? 'Code updated successfully.'
                    : ($hasPlanTypeInput ? 'Plan type updated successfully.' : ($hasItDatetimeInput ? 'IT datetime updated successfully.' : ($hasReceivedAtInput ? 'Received at updated successfully.' : ($hasTotalRawFilesInput ? 'Total raw files updated successfully.' : ($hasHdrImagesCountInput ? 'HDR images count updated successfully.' : ($hasSingleImagesCountInput ? 'Single images count updated successfully.' : ($hasFinalImagesCountInput ? 'Final images count updated successfully.' : ($hasEditedImagesCountInput ? 'Edited images count updated successfully.' : 'Instruction updated successfully.'))))))))),
        ]);
    }



    // ═══════════════════════════════════════════
    // PM → QA → DRAWER ASSIGNMENT WORKFLOW
    // ═══════════════════════════════════════════

    /**
     * POST /workflow/orders/{id}/assign-to-qa
     * PM assigns an order to a QA supervisor for team distribution.
     */
    public function assignToQA(Request $request, int $id)
    {
        $request->validate([
            'qa_user_id' => 'required|exists:users,id',
            'project_id' => 'nullable|integer|exists:projects,id',
        ]);

        $actor = $request->user();
        
        // Only PM/management can assign to QA
        if (!in_array($actor->role, ['project_manager', 'operations_manager', 'director', 'ceo'])) {
            return response()->json(['message' => 'Only project managers can assign orders to QA supervisors.'], 403);
        }

        $projectId = $request->input('project_id');
        $order = $projectId
            ? (Order::findInProject($projectId, $id) ?? Order::findOrFailGlobal($id))
            : Order::findOrFailGlobal($id);
        $qaUser = \App\Models\User::findOrFail($request->input('qa_user_id'));

        // Verify QA user role
        if ($qaUser->role !== 'qa') {
            return response()->json(['message' => 'Target user must be a QA supervisor.'], 422);
        }

        // Verify order is in assignable state (RECEIVED or already PENDING_QA_REVIEW)
        if (!in_array($order->workflow_state, ['RECEIVED', 'QUEUED_DRAW', 'PENDING_QA_REVIEW'])) {
            return response()->json(['message' => 'Order cannot be assigned to QA from its current state.'], 422);
        }

        DB::transaction(function () use ($order, $qaUser, $actor) {
            // Assign to QA supervisor
            $order->update([
                'qa_supervisor_id' => $qaUser->id,
                'assigned_to' => null,  // Not yet assigned to a drawer
                'team_id' => $qaUser->team_id,
            ]);

            // Transition to PENDING_QA_REVIEW if coming from RECEIVED
            if ($order->workflow_state === 'RECEIVED') {
                StateMachine::transition($order, 'PENDING_QA_REVIEW', $actor->id);
            }

            AuditService::log(
                $actor->id,
                'assign_to_qa',
                'Order',
                (int) $order->id,
                (int) $order->project_id,
                null,
                ['qa_supervisor_id' => $qaUser->id, 'message' => "PM assigned order to QA supervisor: {$qaUser->name}"]
            );
        });

        NotificationService::orderAssigned($order->fresh(), $qaUser);

        return response()->json([
            'order' => $order->fresh()->load(['project', 'team']),
            'message' => "Order assigned to QA supervisor {$qaUser->name}.",
        ]);
    }

    /**
     * POST /workflow/orders/{id}/assign-to-drawer
     * QA supervisor assigns an order to a drawer in their team.
     */
    public function assignToDrawer(Request $request, int $id)
    {
        $request->validate([
            'drawer_user_id' => 'required|exists:users,id',
            'project_id' => 'nullable|integer|exists:projects,id',
        ]);

        $actor = $request->user();
        $projectId = $request->input('project_id');
        $order = $projectId
            ? (Order::findInProject($projectId, $id) ?? Order::findOrFailGlobal($id))
            : Order::findOrFailGlobal($id);
        $drawerUser = \App\Models\User::findOrFail($request->input('drawer_user_id'));

        // QA supervisor can assign, or management
        $isQASupervisor = $actor->role === 'qa' && $order->qa_supervisor_id === $actor->id;
        $isManagement = in_array($actor->role, ['operations_manager', 'director', 'ceo']);
        // Checker can assign drawers ONLY to orders they are the assigned checker on.
        // Use loose int cast to avoid string/int type mismatch from the DB.
        $isAssignedChecker = $actor->role === 'checker' && (int)$order->checker_id === (int)$actor->id;
        
        if (!$isQASupervisor && !$isManagement && !$isAssignedChecker) {
            return response()->json(['message' => 'Only the assigned QA supervisor, management, or the assigned checker can assign to drawers.'], 403);
        }

        // Verify drawer user role
        if ($drawerUser->role !== 'drawer') {
            return response()->json(['message' => 'Target user must be a drawer.'], 422);
        }

        // Verify order state
        if (!in_array($order->workflow_state, ['PENDING_QA_REVIEW', 'QUEUED_DRAW', 'REJECTED_BY_CHECK'])) {
            return response()->json(['message' => 'Order cannot be assigned to drawer from its current state.'], 422);
        }

        // Checker may only assign from QUEUED_DRAW or REJECTED_BY_CHECK (not PENDING_QA_REVIEW — that belongs to QA)
        if ($isAssignedChecker && $order->workflow_state === 'PENDING_QA_REVIEW') {
            return response()->json(['message' => 'Checkers cannot assign drawers while order is pending QA review.'], 422);
        }

        // Checker may only assign drawers from the same project
        if ($isAssignedChecker && (int)$drawerUser->project_id !== (int)$actor->project_id) {
            return response()->json(['message' => 'You can only assign drawers from your project.'], 422);
        }

        DB::transaction(function () use ($order, $drawerUser, $actor) {
            // Get old assignee if any and safely decrement their wip_count
            $oldAssignee = $order->assigned_to;
            if ($oldAssignee) {
                \App\Models\User::where('id', $oldAssignee)->where('wip_count', '>', 0)->decrement('wip_count');
            }

            // Transition to QUEUED_DRAW first (if needed), then assign
            // Note: StateMachine clears assigned_to on QUEUED_ transitions,
            // so we must set the assignment AFTER the transition.
            if ($order->workflow_state === 'PENDING_QA_REVIEW') {
                StateMachine::transition($order, 'QUEUED_DRAW', $actor->id);
            }

            // Now assign to the specific drawer — set role-specific columns
            $order->update([
                'assigned_to'  => $drawerUser->id,
                'team_id'      => $drawerUser->team_id,
                'drawer_id'    => $drawerUser->id,
                'drawer_name'  => $drawerUser->name,
                'dassign_time' => now(),
            ]);

            // Increment drawer's WIP
            $drawerUser->increment('wip_count');

            // Sync to project table + CRM
            AssignmentEngine::syncToProjectTable($order->fresh(), $drawerUser, 'start');

            AuditService::log(
                $actor->id,
                'assign_to_drawer',
                'Order',
                (int) $order->id,
                (int) $order->project_id,
                null,
                ['drawer_user_id' => $drawerUser->id, 'message' => "QA assigned order to drawer: {$drawerUser->name}"]
            );
        });

        NotificationService::orderAssigned($order->fresh(), $drawerUser);

        return response()->json([
            'order' => $order->fresh()->load(['project', 'team', 'assignedUser']),
            'message' => "Order assigned to drawer {$drawerUser->name}.",
        ]);
    }

    /**
     * GET /workflow/qa-orders
     * QA supervisor gets orders assigned to them for team distribution.
     */
    public function qaOrders(Request $request)
    {
        $user = $request->user();
        
        if ($user->role !== 'qa') {
            return response()->json(['message' => 'Only QA supervisors can access this endpoint.'], 403);
        }

        $orders = collect();
        if ($user->project_id) {
            $orders = Order::forProject($user->project_id)
                ->where('qa_supervisor_id', $user->id)
                ->whereIn('workflow_state', ['PENDING_QA_REVIEW', 'QUEUED_DRAW', 'IN_DRAW', 'QUEUED_CHECK', 'IN_CHECK', 'QUEUED_FILLER', 'IN_FILLER', 'QUEUED_QA', 'IN_QA'])
                ->with(['project', 'team', 'assignedUser'])
                ->orderBy('priority', 'desc')
                ->orderBy('created_at', 'asc')
                ->get();
        }

        return response()->json([
            'orders' => $orders,
            'pending_assignment' => $orders->where('workflow_state', 'PENDING_QA_REVIEW')->count(),
            'in_progress' => $orders->whereIn('workflow_state', ['IN_DRAW', 'IN_CHECK', 'IN_FILLER', 'IN_QA'])->count(),
        ]);
    }

    /**
     * GET /workflow/qa-team-members
     * QA supervisor gets their team's drawers and checkers for assignment.
     */
public function qaTeamMembers(Request $request)
{
    $user = $request->user();
    
    if ($user->role !== 'qa') {
        return response()->json(['message' => 'Only QA supervisors can access this endpoint.'], 403);
    }

    // ✅ Get ONLY same team members (not whole project)
    $members = \App\Models\User::where('project_id', $user->project_id)
        ->where('team_id', $user->team_id) // ✅ FIX ADDED
        ->whereIn('role', $user->project_id == 12 ? ['drawer', 'checker', 'filler'] : ['drawer', 'checker'])
        ->where('is_active', true)
        ->select([
            'id', 'name', 'email', 'role',
            'team_id', 'wip_count', 'wip_limit',
            'today_completed', 'is_absent'
        ])
        ->orderBy('role')
        ->orderBy('name')
        ->get();

    // Group by role
    $drawers = $members->where('role', 'drawer')->values();
    $checkers = $members->where('role', 'checker')->values();
    $fillers = $members->where('role', 'filler')->values();

    return response()->json([
        'drawers' => $drawers,
        'checkers' => $checkers,
        'fillers' => $fillers,
        'total' => $members->count(),
    ]);
}

    /**
     * GET /workflow/checker-orders
     * Checker gets all orders where they are the assigned checker,
     * so they can distribute drawing work to their team drawers.
     */
    public function checkerOrders(Request $request)
    {
        $user = $request->user();

        if ($user->role !== 'checker') {
            return response()->json(['message' => 'Only checkers can access this endpoint.'], 403);
        }

        $orders = collect();
        if ($user->project_id) {
            $orders = Order::forProject($user->project_id)
                ->where('checker_id', $user->id)
                ->whereNotIn('workflow_state', ['APPROVED_QA', 'DELIVERED', 'CANCELLED'])
                ->with(['project', 'team', 'assignedUser'])
                ->orderBy('created_at', 'asc')
                ->get();
        }

        return response()->json([
            'orders'   => $orders,
            'in_draw'  => $orders->whereIn('workflow_state', ['QUEUED_DRAW', 'IN_DRAW'])->count(),
            'in_check' => $orders->whereIn('workflow_state', ['QUEUED_CHECK', 'IN_CHECK'])->count(),
        ]);
    }

    /**
     * GET /workflow/checker-team-members
     * Checker gets drawers from their own team for assignment.
     */
    public function checkerTeamMembers(Request $request)
    {
        $user = $request->user();

        if ($user->role !== 'checker') {
            return response()->json(['message' => 'Only checkers can access this endpoint.'], 403);
        }

        // Return ALL active drawers in the project (not just own team).
        // Own-team drawers come first so the UI can highlight them.
        $drawers = \App\Models\User::where('project_id', $user->project_id)
            ->where('role', 'drawer')
            ->where('is_active', true)
            ->select(['id', 'name', 'email', 'role', 'team_id', 'wip_count', 'wip_limit', 'today_completed', 'is_absent'])
            ->orderByRaw('(team_id = ?) DESC, name ASC', [$user->team_id ?? 0])
            ->get()
            // Flag which drawers belong to this checker's team so frontend can mark them
            ->map(function ($drawer) use ($user) {
                $drawer->is_own_team = $user->team_id !== null && (int)$drawer->team_id === (int)$user->team_id;
                return $drawer;
            });

        return response()->json([
            'drawers' => $drawers,
            'total'   => $drawers->count(),
        ]);
    }

    // ═══════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════

    /**
     * Filter order fields based on user role.
     * Backend enforces role-based data — not just UI hiding.
     */
    private function filterOrderFieldsByRole(Order $order, string $role): array
    {
        $base = [
            'id' => $order->id,
            'order_number' => $order->order_number,
            'client_reference' => $order->client_reference,
            'workflow_state' => $order->workflow_state,
            'priority' => $order->priority,
            'due_date' => $order->due_date,
            'received_at' => $order->received_at,
            'project' => $order->project ? ['id' => $order->project->id, 'name' => $order->project->name, 'code' => $order->project->code] : null,
            'team' => $order->team ? ['id' => $order->team->id, 'name' => $order->team->name] : null,
        ];

        // Drawer/Designer: instructions, specs, assets
        if (in_array($role, ['drawer', 'designer'])) {
            $base['metadata'] = $order->metadata; // Contains specs/instructions
            $base['attempt_draw'] = $order->attempt_draw;
            $base['rejection_reason'] = $order->rejection_reason; // So they know what to fix
            $base['rejection_type'] = $order->rejection_type;
            return $base;
        }

        // Checker: expected vs produced, error points, delta checklist
        if ($role === 'checker') {
            $base['metadata'] = $order->metadata;
            $base['attempt_draw'] = $order->attempt_draw;
            $base['attempt_check'] = $order->attempt_check;
            $base['rejection_reason'] = $order->rejection_reason;
            $base['rejection_type'] = $order->rejection_type;
            $base['recheck_count'] = $order->recheck_count;
            $base['work_items'] = $order->workItems->where('stage', 'DRAW')->values();
            return $base;
        }

        // QA: final checklist + rejection history
        if ($role === 'qa') {
            $base['metadata'] = $order->metadata;
            $base['attempt_draw'] = $order->attempt_draw;
            $base['attempt_check'] = $order->attempt_check;
            $base['attempt_qa'] = $order->attempt_qa;
            $base['rejection_reason'] = $order->rejection_reason;
            $base['rejection_type'] = $order->rejection_type;
            $base['recheck_count'] = $order->recheck_count;
            $base['work_items'] = $order->workItems; // Full history for QA
            return $base;
        }

        // Management: everything
        $base = $order->toArray();
        $base['work_items'] = $order->workItems;
        return $base;
    }

    /**
     * Map user role to the corresponding project table columns.
     * Returns: [id_column, done_column, in_progress_state, date_column]
     */
    private static function getRoleColumns(string $role): array
    {
        return match ($role) {
            'drawer' => ['drawer_id', 'drawer_done', 'IN_DRAW', 'drawer_date'],
            'designer' => ['drawer_id', 'drawer_done', 'IN_DESIGN', 'drawer_date'],
            'checker' => ['checker_id', 'checker_done', 'IN_CHECK', 'checker_date'],
            'filler' => ['file_uploader_id', 'file_uploaded', 'IN_FILLER', 'file_upload_date'],
            'qa' => ['qa_id', 'final_upload', 'IN_QA', 'ausFinaldate'],
            default => [null, null, null, null],
        };
    }

    private static function resolveWorkflowTypeForUser($user, $project): string
    {
        if (($user->role ?? null) === 'designer') {
            return 'PH_2_LAYER';
        }

        return $project->workflow_type ?? 'FP_3_LAYER';
    }

    /**
     * Find an order using the user's project first to prevent ID collision across project tables.
     * Falls back to findOrFailGlobal for managers who don't have a project_id.
     */
    private static function findOrderForUser(int $id, $user): Order
    {
        if ($user->project_id) {
            foreach (self::queueProjectIdsForUser($user) as $projectId) {
                $order = Order::findInProject((int) $projectId, $id);
                if ($order && self::isOrderAssignedToUser($order, $user)) {
                    return $order;
                }
            }

            $order = Order::findInProject((int) $user->project_id, $id);
            if ($order) return $order;
        }

        return Order::findOrFailGlobal($id);
    }

    private static function queueProjectIdsForUser($user): array
    {
        if (!$user->project_id) {
            return [];
        }

        $project = Project::find($user->project_id);
        $allowedQueues = ['Canada', 'Australia', 'AUS Others FP', 'CAD'];

        if (!$project || !in_array($project->queue_name, $allowedQueues, true)) {
            return [(int) $user->project_id];
        }

        return Project::where('queue_name', $project->queue_name)
            ->where('status', 'active')
            ->pluck('id')
            ->map(fn ($projectId) => (int) $projectId)
            ->prepend((int) $user->project_id)
            ->unique()
            ->values()
            ->all();
    }

    /**
     * Check if a user is assigned to an order.
     * Prioritizes role-specific ID columns (Metro-synced data is authoritative).
     * Falls back to assigned_to, then crm_order_assignments (survives cron sync).
     */
    private static function isOrderAssignedToUser($order, $user): bool
    {
        // Check role-specific ID column first (authoritative for Metro-synced orders)
        $roleIdMap = [
            'drawer'   => 'drawer_id',
            'designer' => 'drawer_id',
            'checker'  => 'checker_id',
            'filler'   => 'file_uploader_id',
            'qa'       => 'qa_id',
        ];

        $idCol = $roleIdMap[$user->role] ?? null;

        if ($idCol) {
            $roleId = $order->{$idCol};
            // If the role column is set, it's authoritative — must match
            if ($roleId !== null && $roleId !== '' && $roleId !== 0) {
                return (int) $roleId === (int) $user->id;
            }
        }

        // Role column is empty — fall back to assigned_to
        if ($order->assigned_to !== null && (int) $order->assigned_to === (int) $user->id) {
            return true;
        }

        // Final fallback: check crm_order_assignments (persists through cron sync)
        if ($order->project_id && $order->order_number) {
            $crmAssign = DB::table('crm_order_assignments')
                ->where('project_id', $order->project_id)
                ->where('order_number', $order->order_number)
                ->first();

            if ($crmAssign) {
                if ($idCol && $crmAssign->{$idCol} !== null && (int) $crmAssign->{$idCol} === (int) $user->id) {
                    return true;
                }
                if ($crmAssign->assigned_to !== null && (int) $crmAssign->assigned_to === (int) $user->id) {
                    return true;
                }
            }
        }

        return false;
    }


    /**
     * POST /workflow/orders/{id}/assign-role
     * PM assigns a specific role (drawer/designer/checker/filler/qa) user to an order.
     */
public function assignRole(Request $request, int $id)
{
    $request->validate([
        'role' => 'required|in:drawer,designer,checker,filler,qa',
        'user_id' => 'required|exists:users,id',
        'project_id' => 'nullable|integer|exists:projects,id',
    ]);

    $actor = $request->user();
    $projectId = $request->input('project_id');

    $order = $projectId
        ? (Order::findInProject($projectId, $id) ?: Order::findOrFailGlobal($id))
        : Order::findOrFailGlobal($id);

    if (in_array($order->workflow_state, ['DELIVERED', 'CANCELLED'])) {
        return response()->json(['message' => 'Cannot reassign a completed or cancelled order.'], 422);
    }

    $user = \App\Models\User::findOrFail($request->input('user_id'));
    $role = $request->input('role');

    if ($user->role !== $role) {
        return response()->json(['message' => "Selected user must have the {$role} role."], 422);
    }

    if ($role === 'filler' && (int) $order->project_id !== 12) {
        return response()->json(['message' => 'Filler assignment is only enabled for project 12.'], 422);
    }

    if ($role === 'designer' && $order->workflow_type !== 'PH_2_LAYER') {
        return response()->json(['message' => 'Designer assignment is only enabled for PH_2_LAYER workflow orders.'], 422);
    }

    // DONE LOCK
    $doneLockMap = [
        'drawer'  => 'drawer_done',
        'designer' => 'drawer_done',
        'checker' => 'checker_done',
        'filler'  => 'file_uploaded',
        'qa'      => 'final_upload',
    ];

// DONE LOCK (optional warning only, does not block assignment)
$doneCol = $doneLockMap[$role] ?? null;
if ($doneCol && strtolower(trim($order->{$doneCol} ?? '')) === 'yes') {
    // Log a warning instead of blocking
    \Log::warning("Reassigning {$role} for order #{$order->id} which is already done.");
    // If you want, you could also set $updates['status'] = 'in-progress'; here
}

    // Role column mapping
    $colMap = [
        'drawer'  => ['id_col' => 'drawer_id',  'name_col' => 'drawer_name',  'time_col' => 'dassign_time'],
        'designer' => ['id_col' => 'drawer_id',  'name_col' => 'drawer_name',  'time_col' => 'dassign_time'],
        'checker' => ['id_col' => 'checker_id', 'name_col' => 'checker_name', 'time_col' => 'cassign_time'],
        'filler'  => ['id_col' => 'file_uploader_id', 'name_col' => 'file_uploader_name', 'time_col' => 'fassign_time'],
        'qa'      => ['id_col' => 'qa_id',      'name_col' => 'qa_name',      'time_col' => null],
    ];

    $cols = $colMap[$role];

    $roleToInState = [
        'drawer'  => 'IN_DRAW',
        'designer' => 'IN_DESIGN',
        'checker' => 'IN_CHECK',
        'filler'  => 'IN_FILLER',
        'qa'      => 'IN_QA',
    ];

    $targetState = $roleToInState[$role];

    DB::transaction(function () use ($order, $user, $cols, $actor, $role, $targetState) {

        $oldAssignedTo = $order->assigned_to;

        // =========================
        // ALWAYS UPDATE ASSIGNMENT
        // =========================
        $updates = [
            $cols['id_col']   => $user->id,
            $cols['name_col'] => $user->name,
            'assigned_to'     => $user->id, // 🔥 FIXED (CRITICAL)
        ];
        if ($role === 'filler') {
            $updates['current_layer'] = 'filler';
        } elseif ($role === 'designer') {
            $updates['current_layer'] = 'designer';
        }

        if ($cols['time_col']) {
            $updates[$cols['time_col']] = now();
        }

        // =========================
        // STATE HANDLING
        // =========================
        $currentState = $order->workflow_state;

        // If role is changed, move to the role's working state even when currently IN_*.
        // This prevents checker->drawer reassignment from staying in IN_CHECK.
        if ($currentState !== $targetState) {
            $updates['workflow_state'] = $targetState;
            $updates['status'] = 'in-progress';
            $updates['started_at'] = now();
        }

        $order->update($updates);

        // =========================
        // WIP MANAGEMENT (ALWAYS ON REASSIGN)
        // =========================
        if ($oldAssignedTo && (int)$oldAssignedTo !== (int)$user->id) {

            \App\Models\User::where('id', $oldAssignedTo)
                ->where('wip_count', '>', 0)
                ->decrement('wip_count');

            $user->increment('wip_count');
        }

        // =========================
        // VERIFY UPDATE
        // =========================
        $verified = $order->fresh();

        if ((int)$verified->{$cols['id_col']} !== (int)$user->id) {
            throw new \RuntimeException("Assignment failed for {$role} on order #{$order->id}");
        }

        // =========================
        // UPDATE WORK ITEMS (🔥 VERY IMPORTANT)
        // =========================
// Only update assigned_user_id, keep timers intact
\App\Models\WorkItem::where('order_id', $order->id)
    ->where('project_id', $order->project_id)
    ->where('assigned_user_id', $oldAssignedTo)
    ->where('status', 'in_progress')
    ->update([
        'assigned_user_id' => $user->id,
    ]);

        // =========================
        // AUDIT LOG
        // =========================
        AuditService::log(
            $actor->id,
            'assign_role',
            'Order',
            (int)$order->id,
            (int)$order->project_id,
            null,
            [
                'role' => $role,
                'user_id' => $user->id,
                'user_name' => $user->name,
                'state_from' => $currentState,
                'state_to' => $verified->workflow_state
            ]
        );

        // =========================
        // CRM SYNC (SAFE + CLEAN)
        // =========================
        $assignData = [
            'project_id'     => $order->project_id,
            'order_number'  => $order->order_number,
            'workflow_state'=> $verified->workflow_state,
            'assigned_to'   => $verified->assigned_to,
            $cols['id_col'] => $user->id,
            $cols['name_col'] => $user->name,
            'updated_at'    => now(),
        ];

        if ($cols['time_col']) {
            $assignData[$cols['time_col']] = now();
        }

        if (Schema::hasColumn('crm_order_assignments', 'current_layer') && isset($updates['current_layer'])) {
            $assignData['current_layer'] = $updates['current_layer'];
        }

        // preserve full data on insert
        $assignData['drawer_id']    = $verified->drawer_id;
        $assignData['drawer_name']  = $verified->drawer_name;
        $assignData['checker_id']   = $verified->checker_id;
        $assignData['checker_name'] = $verified->checker_name;
        $assignData['qa_id']        = $verified->qa_id;
        $assignData['qa_name']      = $verified->qa_name;
        $assignData['dassign_time'] = $verified->dassign_time;
        $assignData['cassign_time'] = $verified->cassign_time;

        if (!isset($assignData['created_at'])) {
            $assignData['created_at'] = now();
        }

        DB::table('crm_order_assignments')->updateOrInsert(
            [
                'project_id'   => $order->project_id,
                'order_number' => $order->order_number,
            ],
            $assignData
        );

    });

    return response()->json([
        'order' => $order->fresh(),
        'message' => ucfirst($role) . " assigned: {$user->name}",
    ]);
}


}

