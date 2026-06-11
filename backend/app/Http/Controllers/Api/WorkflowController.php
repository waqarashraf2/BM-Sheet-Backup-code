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
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class WorkflowController extends Controller
{
    private static array $tableExistsCache = [];

    private static function tableExists(string $table): bool
    {
        if (!array_key_exists($table, self::$tableExistsCache)) {
            self::$tableExistsCache[$table] = Schema::hasTable($table);
        }

        return self::$tableExistsCache[$table];
    }

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
        $allowedProjectIds = array_values(array_unique(array_map('intval', $this->resolveProjectIds($user))));
        $requestedProjectIds = array_values(array_unique(array_filter(
            array_map('intval', (array) $request->input('project_ids', [])),
            fn (int $projectId) => $projectId > 0
        )));
        $projectIds = empty($requestedProjectIds)
            ? $allowedProjectIds
            : array_values(array_intersect($requestedProjectIds, $allowedProjectIds));

        $timestamps = [];

        // Check order tables
        if (in_array($scope, ['orders', 'all'])) {
            foreach ($projectIds as $pid) {
                $table = ProjectOrderService::getTableName($pid);
                if (self::tableExists($table)) {
                    $tableVersion = DB::table($table)
                        ->selectRaw('MAX(updated_at) as max_updated_at, COUNT(*) as row_count')
                        ->first();
                    $timestamps[] = "{$pid}:{$tableVersion->max_updated_at}:{$tableVersion->row_count}";
                }
            }
        }

        // Check users table
        if (in_array($scope, ['users', 'all'])) {
            $userVersion = DB::table('users')
                ->selectRaw('MAX(updated_at) as max_updated_at, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_count')
                ->first();
            $timestamps[] = "users:{$userVersion->max_updated_at}:{$userVersion->active_count}";
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
        $portalUploadStatus = null;

        // External assetdetail links are currently available for FocalCRM photo jobs (project 22).
        if ($includeExternal && in_array(22, $candidateProjectIds, true)) {
            $externalLinks = $this->fetchFocalAssetDetailLinks($jobOrderId);
        }

        // Project 1 workers must be able to confirm that the completed floor-plan
        // file exists in the client portal before finishing drawer/checker work.
        if (in_array(1, $candidateProjectIds, true)) {
            $portalUploadStatus = $this->getProjectOnePortalUploadStatus($jobOrderId);
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
            'portal_upload_status' => $portalUploadStatus,
            'count' => $allLinks->count(),
            'links' => $allLinks,
        ]);
    }

    private function getProjectOnePortalUploadStatus(string $jobOrderId, bool $checkFailedJobs = true): array
    {
        $apiUrl = (string) env('FOCAL_CRM_API_URL', 'https://api.focalagent.com/supplier-enhancement/v3/jobs');
        $supplierSecret = (string) env('FOCAL_CRM_SUPPLIER_SECRET', 'N4ctEg%$SXGg6SF4wu');
        $subscriptionKey = (string) env('FOCAL_CRM_SUBSCRIPTION_KEY', 'daee797833ca4dbd87fc98b1421c57b1');
        $headers = [
            'Accept' => '*/*',
            'Supplier-Secret' => $supplierSecret,
            'Ocp-Apim-Subscription-Key' => $subscriptionKey,
        ];
        $failedJobsUrl = rtrim(
            (string) env(
                'FOCAL_CRM_STATUS_API_URL',
                str_replace('/v3/jobs', '/v2/jobs', $apiUrl)
            ),
            '/'
        ) . '?jobstatus=Failed';
        $endpoints = [
            rtrim($apiUrl, '/') . '/' . rawurlencode($jobOrderId) . '/assetdetail',
            str_replace('/v3/', '/v2/', rtrim($apiUrl, '/')) . '/' . rawurlencode($jobOrderId) . '/assetdetail',
        ];

        try {
            if ($checkFailedJobs) {
                $failedJobsResponse = Http::timeout(30)
                    ->withHeaders($headers)
                    ->get($failedJobsUrl);

                if (!$failedJobsResponse->successful()) {
                    return [
                        'required' => true,
                        'checked' => false,
                        'uploaded' => false,
                        'failed' => false,
                        'job_status' => null,
                        'uploaded_count' => 0,
                        'message' => 'Focal job status could not be checked. Please retry before submitting.',
                    ];
                }

                $failedJob = collect((array) (($failedJobsResponse->json() ?? [])['jobs'] ?? []))
                    ->first(function ($job) use ($jobOrderId) {
                        if (!is_array($job)) {
                            return false;
                        }

                        return trim((string) ($job['Id'] ?? $job['id'] ?? '')) === $jobOrderId
                            && strtolower(trim((string) ($job['ProductOption'] ?? $job['productOption'] ?? ''))) === 'propertyvision';
                    });

                if (is_array($failedJob)) {
                    $jobStatus = trim((string) ($failedJob['JobStatus'] ?? $failedJob['jobStatus'] ?? 'Failed')) ?: 'Failed';

                    return [
                        'required' => true,
                        'checked' => true,
                        'uploaded' => false,
                        'failed' => true,
                        'job_status' => $jobStatus,
                        'uploaded_count' => 0,
                        'message' => 'Failed by Client Portal. Upload the corrected file and submit again.',
                    ];
                }
            }

            foreach (array_unique($endpoints) as $url) {
                $response = Http::timeout(30)
                    ->withHeaders($headers)
                    ->get($url);

                if (!$response->successful()) {
                    continue;
                }

                $assets = collect((array) (($response->json() ?? [])['Assets'] ?? []))
                    ->filter(function ($asset) {
                        if (!is_array($asset)) {
                            return false;
                        }

                        return !empty($asset['Url'] ?? $asset['url'] ?? $asset['URL'] ?? null)
                            || !empty($asset['FileName'] ?? $asset['file_name'] ?? null);
                    })
                    ->values();
                $uploadedCount = $assets->count();

                return [
                    'required' => true,
                    'checked' => true,
                    'uploaded' => $uploadedCount > 0,
                    'failed' => false,
                    'job_status' => $uploadedCount > 0 ? 'Uploaded' : 'Not Uploaded',
                    'uploaded_count' => $uploadedCount,
                    'message' => $uploadedCount > 0
                        ? 'File uploaded successfully on the Focal client portal.'
                        : 'No completed file is uploaded on the Focal client portal yet.',
                ];
            }
        } catch (\Throwable $e) {
            report($e);
        }

        return [
            'required' => true,
            'checked' => false,
            'uploaded' => false,
            'failed' => false,
            'job_status' => null,
            'uploaded_count' => 0,
            'message' => 'Client portal could not be checked. Please retry before submitting.',
        ];
    }

    private function submitProjectOneToClientPortal(string $jobOrderId): array
    {
        $apiBase = rtrim(
            (string) env(
                'FOCAL_CRM_SUBMIT_API_URL',
                'https://api.focalagent.com/supplier-enhancement/v2/jobs'
            ),
            '/'
        );
        $supplierSecret = (string) env('FOCAL_CRM_SUPPLIER_SECRET', 'N4ctEg%$SXGg6SF4wu');
        $subscriptionKey = (string) env('FOCAL_CRM_SUBSCRIPTION_KEY', 'daee797833ca4dbd87fc98b1421c57b1');

        try {
            // Match the proven legacy cURL request exactly: POST with an empty
            // body. Sending Laravel's default JSON [] can be rejected by Focal.
            $response = Http::timeout(60)
                ->withHeaders([
                    'Accept' => '*/*',
                    'Content-Type' => 'application/json',
                    'Supplier-Secret' => $supplierSecret,
                    'Ocp-Apim-Subscription-Key' => $subscriptionKey,
                ])
                ->withBody('', 'application/json')
                ->post($apiBase . '/' . rawurlencode($jobOrderId) . '/submit');

            $responseBody = trim($response->body());
            $responseJson = $response->json();
            $normalizedBody = strtolower($responseBody);
            $alreadySubmitted = str_contains($normalizedBody, 'already submitted')
                || str_contains($normalizedBody, 'already been submitted')
                || str_contains($normalizedBody, 'already completed')
                || str_contains($normalizedBody, 'already been completed');
            $portalRejected = is_array($responseJson) && (
                (array_key_exists('success', $responseJson) && $responseJson['success'] === false)
                || (array_key_exists('isSuccess', $responseJson) && $responseJson['isSuccess'] === false)
                || strtolower(trim((string) ($responseJson['status'] ?? $responseJson['JobStatus'] ?? ''))) === 'failed'
                || !empty($responseJson['error'] ?? null)
            ) && !$alreadySubmitted;

            Log::info('Project 1 Focal client portal submit response', [
                'job_order_id' => $jobOrderId,
                'http_status' => $response->status(),
                'successful' => $response->successful(),
                'already_submitted' => $alreadySubmitted,
                'portal_rejected' => $portalRejected,
                'response_body' => mb_substr($responseBody, 0, 2000),
            ]);

            return [
                'submitted' => true,
                'status' => $response->status(),
                'already_submitted' => $alreadySubmitted,
                'response_indicated_failure' => $portalRejected,
                'response' => $responseBody !== '' ? $responseBody : null,
                'message' => $alreadySubmitted
                    ? 'Order was already submitted on Client Portal.'
                    : 'Client Portal submission request was sent.',
            ];
        } catch (\Throwable $e) {
            Log::error('Project 1 Focal client portal submit exception', [
                'job_order_id' => $jobOrderId,
                'error' => $e->getMessage(),
            ]);

            return [
                'submitted' => false,
                'status' => null,
                'message' => 'Client Portal could not be reached. The internal order was not submitted.',
            ];
        }
    }

    private function checkProjectOneFailedJob(string $jobOrderId): array
    {
        $apiUrl = (string) env('FOCAL_CRM_API_URL', 'https://api.focalagent.com/supplier-enhancement/v3/jobs');
        $failedJobsUrl = rtrim(
            (string) env(
                'FOCAL_CRM_STATUS_API_URL',
                str_replace('/v3/jobs', '/v2/jobs', $apiUrl)
            ),
            '/'
        ) . '?jobstatus=Failed';
        $supplierSecret = (string) env('FOCAL_CRM_SUPPLIER_SECRET', 'N4ctEg%$SXGg6SF4wu');
        $subscriptionKey = (string) env('FOCAL_CRM_SUBSCRIPTION_KEY', 'daee797833ca4dbd87fc98b1421c57b1');

        try {
            $response = Http::timeout(30)
                ->withHeaders([
                    'Accept' => '*/*',
                    'Supplier-Secret' => $supplierSecret,
                    'Ocp-Apim-Subscription-Key' => $subscriptionKey,
                ])
                ->get($failedJobsUrl);

            if (!$response->successful()) {
                return ['checked' => false, 'failed' => false];
            }

            $failed = collect((array) (($response->json() ?? [])['jobs'] ?? []))
                ->contains(function ($job) use ($jobOrderId) {
                    if (!is_array($job)) {
                        return false;
                    }

                    return trim((string) ($job['Id'] ?? $job['id'] ?? '')) === $jobOrderId
                        && strtolower(trim((string) ($job['ProductOption'] ?? $job['productOption'] ?? ''))) === 'propertyvision';
                });

            return ['checked' => true, 'failed' => $failed];
        } catch (\Throwable $e) {
            Log::warning('Project 1 Focal failed-list check exception', [
                'job_order_id' => $jobOrderId,
                'error' => $e->getMessage(),
            ]);

            return ['checked' => false, 'failed' => false];
        }
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

    private function fetchFocalAssetDetailLinks(string $jobOrderId)
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

            return $this->extractFocalAssetLinks($assetDetail, $jobOrderId);
        } catch (\Throwable $e) {
            return collect();
        }
    }

    private function extractFocalAssetLinks(array $assetDetail, string $jobOrderId)
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
                'project_id' => 22,
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
                'project_id' => 22,
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
                'project_id' => 22,
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

    /**
     * POST /workflow/orders/uploads/notify-success
     *
     * Frontend-only upload flow safety check:
     * verifies uploaded file names against Focal assetdetail before allowing submit.
     */
    public function notifyUploadSuccess(Request $request)
    {
        $user = $request->user();

        $data = $request->validate([
            'order_id' => 'required|integer|min:1',
            'job_order_id' => 'nullable|string|max:255',
            'uploaded_files' => 'required|array|min:1',
            'uploaded_files.*' => 'required|string|max:500',
            'expected_count' => 'nullable|integer|min:1',
        ]);

        $order = self::findOrderForUser((int) $data['order_id'], $user);

        if (!self::isOrderAssignedToUser($order, $user)) {
            return response()->json(['message' => 'This order is not assigned to you.'], 403);
        }

        $requiredRole = strtoupper((string) $order->workflow_type) === 'PH_2_LAYER' ? 'qa' : 'checker';
        if (($user->role ?? '') !== $requiredRole) {
            return response()->json([
                'message' => "Only {$requiredRole} can verify uploads for this order.",
            ], 403);
        }

        $jobOrderId = trim((string) ($data['job_order_id'] ?? ''));
        if ($jobOrderId === '') {
            $jobOrderId = trim((string) ($order->order_number ?? ''));
        }

        if ($jobOrderId === '') {
            return response()->json(['message' => 'job_order_id is required.'], 422);
        }

        $uploadedFiles = collect((array) $data['uploaded_files'])
            ->map(fn ($name) => strtolower(trim((string) $name)))
            ->filter(fn ($name) => $name !== '')
            ->unique()
            ->values();

        if ($uploadedFiles->isEmpty()) {
            return response()->json(['message' => 'At least one uploaded file is required.'], 422);
        }

        $expectedCount = (int) ($data['expected_count'] ?? $uploadedFiles->count());
        if ($expectedCount < 1) {
            $expectedCount = $uploadedFiles->count();
        }

        $assetLinks = $this->fetchFocalAssetDetailLinks($jobOrderId);
        $assetNames = $assetLinks
            ->map(function ($row) {
                return strtolower(trim((string) ($row['name'] ?? '')));
            })
            ->filter(fn ($name) => $name !== '')
            ->unique()
            ->values();

        $missingFiles = $uploadedFiles
            ->filter(fn ($fileName) => !$assetNames->contains($fileName))
            ->values();

        $allUploaded = $missingFiles->isEmpty() && $uploadedFiles->count() >= $expectedCount;

        return response()->json([
            'message' => $allUploaded
                ? 'Upload verification completed successfully.'
                : 'Upload verification failed. Some files are still missing in client portal.',
            'all_uploaded' => $allUploaded,
            'job_order_id' => $jobOrderId,
            'expected_count' => $expectedCount,
            'verified_count' => $uploadedFiles->count() - $missingFiles->count(),
            'missing_files' => $missingFiles->values(),
        ]);
    }

    /**
     * POST /workflow/orders/{jobOrderId}/client-portal-submit
     *
     * Optional helper endpoint to submit completed jobs to client portal.
     * Existing internal submitWork flow remains unchanged.
     */
    public function submitOrderToClientPortal(Request $request, string $jobOrderId)
    {
        if (!filter_var(env('FOCAL_CLIENT_PORTAL_SUBMIT_ENABLED', false), FILTER_VALIDATE_BOOLEAN)) {
            return response()->json([
                'message' => 'Client portal submit is disabled while migration testing is active.',
                'job_order_id' => trim($jobOrderId),
                'submit_enabled' => false,
            ], 423);
        }

        $user = $request->user();
        $jobOrderId = trim($jobOrderId);

        if ($jobOrderId === '') {
            return response()->json(['message' => 'job_order_id is required.'], 422);
        }

        $payload = $request->validate([
            'order_id' => 'nullable|integer|min:1',
        ]);

        if (!in_array($user->role, ['qa', 'checker'], true)) {
            return response()->json(['message' => 'Only checker/qa can submit to client portal.'], 403);
        }

        if (!empty($payload['order_id'])) {
            $order = self::findOrderForUser((int) $payload['order_id'], $user);
            if (!self::isOrderAssignedToUser($order, $user)) {
                return response()->json(['message' => 'This order is not assigned to you.'], 403);
            }
        }

        $apiBase = (string) env('FOCAL_CRM_PHOTO_SUBMIT_API_URL', 'https://api.focalagent.com/supplier-enhancement/v2/jobs');
        $supplierSecret = (string) env('FOCAL_CRM_PHOTO_SUPPLIER_SECRET', env('FOCAL_CRM_SUPPLIER_SECRET', 'N4ctEg%$SXGg6SF4wu'));
        $subscriptionKey = (string) env('FOCAL_CRM_PHOTO_SUBSCRIPTION_KEY', env('FOCAL_CRM_SUBSCRIPTION_KEY', 'daee797833ca4dbd87fc98b1421c57b1'));

        try {
            $url = rtrim($apiBase, '/') . '/' . rawurlencode($jobOrderId) . '/submit';

            $response = Http::timeout(60)
                ->withHeaders([
                    'Accept' => '*/*',
                    'Supplier-Secret' => $supplierSecret,
                    'Ocp-Apim-Subscription-Key' => $subscriptionKey,
                ])
                ->post($url, []);

            if (!$response->successful()) {
                return response()->json([
                    'message' => 'Client portal submit failed.',
                    'status' => $response->status(),
                    'response' => $response->body(),
                ], 502);
            }

            return response()->json([
                'message' => 'Client portal submit sent successfully.',
                'job_order_id' => $jobOrderId,
                'response' => $response->json() ?? $response->body(),
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'message' => 'Client portal submit failed.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }


    public function submitWork(Request $request, int $id)
    {
        $user = $request->user();
        $order = self::findOrderForUser($id, $user);

        // Submit requires ownership of this exact role stage. General order
        // assignment is not enough because downstream roles may be pre-assigned.
        if (!self::isOrderStageAssignedToUser($order, $user)) {
            return response()->json(['message' => 'This workflow stage is not assigned to you.'], 403);
        }

        // A retained or pre-assigned role ID must never authorize submission
        // for another stage (for example drawer submitting IN_CHECK).
        if (!StateMachine::roleCanWorkState($user->role, $order->workflow_state)) {
            return response()->json([
                'message' => "Your {$user->role} role cannot submit an order in {$order->workflow_state} state.",
            ], 422);
        }

        if ($user->role === 'checker' && !self::isOrderCompletionFlagYes($order, 'drawer_done')) {
            return response()->json([
                'message' => 'Checker work cannot be submitted before the drawer has completed the order.',
            ], 422);
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

        if ((int) $order->project_id === 1 && $user->role === 'checker') {
            $jobOrderId = trim((string) ($order->client_portal_id ?? $order->order_number ?? ''));
            if ($jobOrderId === '') {
                return response()->json([
                    'message' => 'Client portal file check failed because the portal job ID is missing.',
                ], 422);
            }

            // Project 1 checker is the final stage. Submit to Focal before the
            // internal transition; an explicit Failed-list match blocks it.
            $portalSubmit = $this->submitProjectOneToClientPortal($jobOrderId);
            if (!$portalSubmit['submitted']) {
                return response()->json([
                    'message' => $portalSubmit['message'],
                    'client_portal_submit' => $portalSubmit,
                ], 422);
            }

            $failedStatus = ['checked' => false, 'failed' => false];
            for ($attempt = 1; $attempt <= 3; $attempt++) {
                $failedStatus = $this->checkProjectOneFailedJob($jobOrderId);
                if ($failedStatus['failed']) {
                    break;
                }

                if ($attempt < 3) {
                    usleep(750000);
                }
            }

            if ($failedStatus['failed']) {
                return response()->json([
                    'message' => 'Failed by Client Portal. The internal order was not submitted.',
                    'portal_upload_status' => [
                        'required' => true,
                        'checked' => true,
                        'uploaded' => false,
                        'failed' => true,
                        'job_status' => 'Failed',
                        'uploaded_count' => 0,
                        'message' => 'Failed by Client Portal. The internal order was not submitted.',
                    ],
                    'client_portal_submit' => $portalSubmit,
                ], 422);
            }

            if (!$failedStatus['checked']) {
                Log::warning('Project 1 Focal failed-list verification unavailable after successful submit', [
                    'job_order_id' => $jobOrderId,
                    'role' => $user->role,
                    'submit_status' => $portalSubmit['status'] ?? null,
                ]);
            }
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
        $legacyState = self::getRoleLegacyState($user->role);
        [$idCol, $doneCol] = self::getRoleColumns($user->role);

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

    $legacyState = self::getRoleLegacyState($user->role);

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

        $stateRows = Order::forProject($projectId)
            ->selectRaw('workflow_state, COUNT(*) as state_count, MIN(received_at) as oldest_received_at')
            ->groupBy('workflow_state')
            ->get()
            ->keyBy('workflow_state');

        $counts = [];
        foreach ($states as $state) {
            $stateRow = $stateRows->get($state);
            $counts[$state] = [
                'count' => (int) ($stateRow->state_count ?? 0),
                'oldest' => $stateRow->oldest_received_at ?? null,
            ];
        }

        // SLA breaches (orders past due_date)
        $slaBreaches = Order::forProject($projectId)
            ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
            ->whereNotNull('due_date')
            ->where('due_date', '<', now())
            ->count();

        $totalPending = $stateRows
            ->filter(fn ($row, $state) => $state !== null && !in_array($state, ['DELIVERED', 'CANCELLED'], true))
            ->sum(fn ($row) => (int) $row->state_count);
        $totalDelivered = (int) data_get($stateRows->get('DELIVERED'), 'state_count', 0);

        return response()->json([
            'project_id' => $projectId,
            'workflow_type' => $project->workflow_type,
            'state_counts' => $counts,
            'sla_breaches' => $slaBreaches,
            'total_pending' => $totalPending,
            'total_delivered' => $totalDelivered,
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
        $roles = array_values(array_unique(array_map(
            fn (string $stage) => StateMachine::STAGE_TO_ROLE[$stage],
            $stages
        )));
        $usersByRole = \App\Models\User::where('project_id', $projectId)
            ->whereIn('role', $roles)
            ->get(['id', 'name', 'role', 'team_id', 'is_active', 'is_absent', 'wip_count', 'today_completed', 'last_activity', 'daily_target'])
            ->groupBy('role');
        $staffing = [];

        foreach ($stages as $stage) {
            $role = StateMachine::STAGE_TO_ROLE[$stage];
            $users = $usersByRole->get($role, collect());

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
            $receivedAt = now();

            // Calculate due_in based on project's historical SLA
            $table = ProjectOrderService::getTableName($project->id);
            $avgSlaHours = DB::table($table)
                ->selectRaw('AVG(TIMESTAMPDIFF(HOUR, received_at, due_in)) as avg_sla')
                ->where('received_at', '>=', $receivedAt->copy()->subDays(30))
                ->whereNotNull('received_at')
                ->whereNotNull('due_in')
                ->value('avg_sla');

            $slaHours = max((int) round($avgSlaHours ?? 24), 1);
            $dueIn = $receivedAt->copy()->addHours($slaHours);

            $order = Order::createForProject($project->id, [
                'order_number' => 'ORD-' . strtoupper(uniqid()),
                'client_reference' => $request->input('client_reference'),
                'workflow_state' => 'RECEIVED',
                'workflow_type' => $project->workflow_type,
                'current_layer' => $project->workflow_type === 'PH_2_LAYER' ? 'designer' : 'drawer',
                'status' => 'pending',
                'priority' => $request->input('priority', 'normal'),
                'due_date' => $request->input('due_date'),
                'received_at' => $receivedAt,
                'due_in' => $dueIn,
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

        $hasInstructionInput = $request->exists('instruction');
        $hasPlanTypeInput = $request->exists('plan_type');
        $hasCodeInput = $request->exists('code');
        $hasItDatetimeInput = $request->exists('it_datetime');

        if (!$hasInstructionInput && !$hasPlanTypeInput && !$hasCodeInput && !$hasItDatetimeInput) {
            return response()->json([
                'message' => 'Nothing to update.',
            ], 422);
        }

        DB::transaction(function () use ($order, $actor, $instruction, $planType, $code, $itDatetime, $hasInstructionInput, $hasPlanTypeInput, $hasCodeInput, $hasItDatetimeInput) {
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
                ($hasInstructionInput || $hasPlanTypeInput || $hasCodeInput)
                    && (
                        ($hasInstructionInput ? 1 : 0)
                        + ($hasPlanTypeInput ? 1 : 0)
                        + ($hasCodeInput ? 1 : 0)
                        + ($hasItDatetimeInput ? 1 : 0)
                    ) > 1
                    ? 'update_order_details'
                    : ($hasCodeInput
                        ? 'update_code'
                        : ($hasPlanTypeInput ? 'update_plan_type' : ($hasItDatetimeInput ? 'update_it_datetime' : 'update_instruction'))),
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
                (($hasInstructionInput ? 1 : 0) + ($hasPlanTypeInput ? 1 : 0) + ($hasCodeInput ? 1 : 0) + ($hasItDatetimeInput ? 1 : 0)) > 1
            )
                ? 'Order details updated successfully.'
                : ($hasCodeInput
                    ? 'Code updated successfully.'
                    : ($hasPlanTypeInput ? 'Plan type updated successfully.' : ($hasItDatetimeInput ? 'IT datetime updated successfully.' : 'Instruction updated successfully.'))),
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

        // QA/checker supervisors can assign their team's drawer, as can management.
        $isQASupervisor = $actor->role === 'qa' && $order->qa_supervisor_id === $actor->id;
        $isAssignedChecker = $actor->role === 'checker'
            && self::isOrderAssignedToUser($order, $actor);
        $isManagement = in_array($actor->role, ['operations_manager', 'director', 'ceo']);
        
        if (!$isQASupervisor && !$isAssignedChecker && !$isManagement) {
            return response()->json(['message' => 'Only the assigned QA/checker supervisor or management can assign to drawers.'], 403);
        }

        // Verify drawer user role
        if ($drawerUser->role !== 'drawer') {
            return response()->json(['message' => 'Target user must be a drawer.'], 422);
        }

        // Verify order state
        if (!in_array($order->workflow_state, ['RECEIVED', 'PENDING_QA_REVIEW', 'QUEUED_DRAW', 'IN_DRAW', 'REJECTED_BY_CHECK'])) {
            return response()->json(['message' => 'Order cannot be assigned to drawer from its current state.'], 422);
        }

        DB::transaction(function () use ($order, $drawerUser, $actor) {
            // Get old assignee if any and safely decrement their wip_count
            $oldAssignee = $order->assigned_to;
            if ($oldAssignee) {
                \App\Models\User::where('id', $oldAssignee)->where('wip_count', '>', 0)->decrement('wip_count');
            }

            self::pauseActiveWorkItemsForAssignment($order, $oldAssignee);

            // Assignment queues drawing. Starting work is the only action that moves it to IN_DRAW.
            if ($order->workflow_state !== 'QUEUED_DRAW') {
                if (StateMachine::canTransition($order, 'QUEUED_DRAW')) {
                    $order = StateMachine::transition($order, 'QUEUED_DRAW', $actor->id);
                } else {
                    $order->update([
                        'workflow_state' => 'QUEUED_DRAW',
                        'status' => 'pending',
                    ]);
                }
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

        $page    = max((int) $request->input('page', 1), 1);
        $perPage = min((int) $request->input('per_page', 50), 200);

        $baseQuery = null;
        $pendingCount = 0;
        $inProgressCount = 0;

        if ($user->project_id) {
            $baseQuery = Order::forProject($user->project_id)
                ->where('qa_supervisor_id', $user->id)
                ->whereIn('workflow_state', [
                    'PENDING_QA_REVIEW', 'QUEUED_DRAW', 'IN_DRAW',
                    'QUEUED_CHECK', 'IN_CHECK', 'QUEUED_FILLER',
                    'IN_FILLER', 'QUEUED_QA', 'IN_QA',
                ]);

            $pendingCount    = (clone $baseQuery)->where('workflow_state', 'PENDING_QA_REVIEW')->count();
            $inProgressCount = (clone $baseQuery)->whereIn('workflow_state', ['IN_DRAW', 'IN_CHECK', 'IN_FILLER', 'IN_QA'])->count();

            $paginated = $baseQuery
                ->with(['project', 'team', 'assignedUser'])
                ->orderBy('priority', 'desc')
                ->orderBy('created_at', 'asc')
                ->paginate($perPage, ['*'], 'page', $page);

            return response()->json([
                'orders'             => $paginated->items(),
                'current_page'       => $paginated->currentPage(),
                'per_page'           => $paginated->perPage(),
                'total'              => $paginated->total(),
                'last_page'          => $paginated->lastPage(),
                'pending_assignment' => $pendingCount,
                'in_progress'        => $inProgressCount,
            ]);
        }

        return response()->json([
            'orders'             => [],
            'current_page'       => 1,
            'per_page'           => $perPage,
            'total'              => 0,
            'last_page'          => 1,
            'pending_assignment' => 0,
            'in_progress'        => 0,
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
     * Checker supervisor gets orders in checker stage for team distribution.
     */
    public function checkerOrders(Request $request)
    {
        $user = $request->user();

        if ($user->role !== 'checker') {
            return response()->json(['message' => 'Only checker supervisors can access this endpoint.'], 403);
        }

        $page    = max((int) $request->input('page', 1), 1);
        $perPage = min((int) $request->input('per_page', 200), 200);

        if (!$user->project_id) {
            return response()->json([
                'orders' => [], 'current_page' => 1, 'per_page' => $perPage,
                'total' => 0, 'last_page' => 1,
                'pending_assignment' => 0, 'in_progress' => 0,
            ]);
        }

        // A checker can be assigned before drawing starts. Pull every active
        // draw/check stage order across the checker's queue and overlay the
        // durable CRM assignment, which survives external project-table sync.
        $checkerStates = [
            'RECEIVED', 'PENDING_QA_REVIEW',
            'QUEUED_DRAW', 'IN_DRAW', 'PENDING_BY_DRAWER', 'SUBMITTED_DRAW',
            'QUEUED_CHECK', 'IN_CHECK', 'REJECTED_BY_CHECK',
        ];
        $projectIds = self::queueProjectIdsForUser($user);
        $crmAssignments = DB::table('crm_order_assignments')
            ->whereIn('project_id', $projectIds)
            ->where('checker_id', $user->id)
            ->get()
            ->keyBy(fn ($assignment) => ((int) $assignment->project_id) . ':' . $assignment->order_number);

        $orders = collect();

        foreach ($projectIds as $projectId) {
            $table = ProjectOrderService::getTableName((int) $projectId);
            if (!Schema::hasTable($table)) {
                continue;
            }

            $crmOrderNumbers = $crmAssignments
                ->filter(fn ($assignment) => (int) $assignment->project_id === (int) $projectId)
                ->pluck('order_number')
                ->values();

            $projectOrders = Order::forProject((int) $projectId)
                ->where(function ($query) use ($user, $table, $crmOrderNumbers) {
                    $query->where('checker_id', $user->id);

                    if (Schema::hasColumn($table, 'checker_supervisor_id')) {
                        $query->orWhere('checker_supervisor_id', $user->id);
                    }

                    if ($crmOrderNumbers->isNotEmpty()) {
                        $query->orWhereIn('order_number', $crmOrderNumbers);
                    }
                })
                ->with(['project', 'team', 'assignedUser'])
                ->get();

            foreach ($projectOrders as $order) {
                $crm = $crmAssignments->get(((int) $projectId) . ':' . $order->order_number);

                if ($crm) {
                    foreach ([
                        'assigned_to', 'drawer_id', 'drawer_name', 'checker_id', 'checker_name',
                        'workflow_state', 'dassign_time', 'cassign_time', 'drawer_done',
                        'checker_done', 'drawer_date', 'checker_date',
                    ] as $column) {
                        if (isset($crm->{$column}) && $crm->{$column} !== '') {
                            $order->setAttribute($column, $crm->{$column});
                        }
                    }
                }

                $effectiveState = (string) ($order->workflow_state ?? '');
                $checkerIsDone = strtolower(trim((string) ($order->checker_done ?? ''))) === 'yes';

                if (in_array($effectiveState, $checkerStates, true) && !$checkerIsDone) {
                    $orders->push($order);
                }
            }
        }

        $orders = $orders
            ->sortBy([
                [fn ($order) => match (strtolower((string) ($order->priority ?? 'normal'))) {
                    'urgent', 'rush' => 0,
                    'high' => 1,
                    'normal' => 2,
                    'low' => 3,
                    default => 4,
                }, 'asc'],
                ['created_at', 'asc'],
            ])
            ->values();

        $total = $orders->count();
        $pageOrders = $orders->forPage($page, $perPage)->values();
        $pendingCount = $orders->filter(
            fn ($order) => empty($order->drawer_id) && empty($order->drawer_name)
        )->count();
        $inProgressCount = $orders->whereIn('workflow_state', ['QUEUED_CHECK', 'IN_CHECK'])->count();

        return response()->json([
            'orders'             => $pageOrders,
            'current_page'       => $page,
            'per_page'           => $perPage,
            'total'              => $total,
            'last_page'          => max(1, (int) ceil($total / $perPage)),
            'pending_assignment' => $pendingCount,
            'in_progress'        => $inProgressCount,
        ]);
    }

    /**
     * GET /workflow/checker-team-members
     * Checker supervisor gets their team members for assignment.
     */
    public function checkerTeamMembers(Request $request)
    {
        $user = $request->user();

        if ($user->role !== 'checker') {
            return response()->json(['message' => 'Only checker supervisors can access this endpoint.'], 403);
        }

        // Return the full active drawer pool for this project. The frontend
        // uses is_own_team to separate regular members from guest drawers
        // assigned from another team.
        $drawers = \App\Models\User::where('project_id', $user->project_id)
            ->where('role', 'drawer')
            ->where('is_active', true)
            ->select(['id', 'name', 'email', 'role', 'team_id', 'wip_count', 'wip_limit', 'today_completed', 'is_absent'])
            ->orderByRaw('CASE WHEN team_id = ? THEN 0 ELSE 1 END', [$user->team_id])
            ->orderBy('name')
            ->get()
            ->map(function ($drawer) use ($user) {
                $drawer->setAttribute('is_own_team', (int) $drawer->team_id === (int) $user->team_id);
                return $drawer;
            })
            ->values();

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
        $config = self::getRoleStageConfig($role);

        return [
            $config['id_column'] ?? null,
            $config['done_column'] ?? null,
            $config['in_progress_state'] ?? null,
            $config['done_date_column'] ?? null,
        ];
    }

    private static function getRoleAssignmentColumns(string $role): array
    {
        $config = self::getRoleStageConfig($role);

        return [
            'id_col' => $config['id_column'] ?? null,
            'name_col' => $config['name_column'] ?? null,
            'time_col' => $config['assign_time_column'] ?? null,
        ];
    }

    private static function getRoleLegacyState(string $role): ?string
    {
        $config = self::getRoleStageConfig($role);

        return $config['legacy_state'] ?? null;
    }

    private static function getRoleQueueState(string $role): ?string
    {
        $config = self::getRoleStageConfig($role);

        return $config['queue_state'] ?? null;
    }

    private static function pauseActiveWorkItemsForAssignment(Order $order, ?int $assignedUserId): void
    {
        if (!$assignedUserId) {
            return;
        }

        $workItems = WorkItem::where('order_id', $order->id)
            ->where('project_id', $order->project_id)
            ->where('assigned_user_id', $assignedUserId)
            ->where('status', 'in_progress')
            ->get();

        foreach ($workItems as $workItem) {
            $elapsed = $workItem->last_timer_start
                ? max(0, now()->diffInSeconds($workItem->last_timer_start))
                : 0;

            $workItem->update([
                'time_spent_seconds' => (int) $workItem->time_spent_seconds + $elapsed,
                'last_timer_start' => null,
                'status' => 'paused',
            ]);
        }
    }

    private static function getRoleStageConfig(string $role): array
    {
        $defaults = self::getDefaultRoleStageConfig();
        $configured = config("role_stage_columns.{$role}");

        if (!is_array($configured)) {
            return $defaults[$role] ?? [];
        }

        return array_replace($defaults[$role] ?? [], $configured);
    }

    private static function getDefaultRoleStageConfig(): array
    {
        return [
            'drawer' => [
                'id_column' => 'drawer_id',
                'name_column' => 'drawer_name',
                'assign_time_column' => 'dassign_time',
                'done_column' => 'drawer_done',
                'done_date_column' => 'drawer_date',
                'queue_state' => 'QUEUED_DRAW',
                'in_progress_state' => 'IN_DRAW',
                'legacy_state' => 'DRAW',
            ],
            'designer' => [
                'id_column' => 'drawer_id',
                'name_column' => 'drawer_name',
                'assign_time_column' => 'dassign_time',
                'done_column' => 'drawer_done',
                'done_date_column' => 'drawer_date',
                'queue_state' => 'QUEUED_DESIGN',
                'in_progress_state' => 'IN_DESIGN',
                'legacy_state' => 'DESIGN',
            ],
            'checker' => [
                'id_column' => 'checker_id',
                'name_column' => 'checker_name',
                'assign_time_column' => 'cassign_time',
                'done_column' => 'checker_done',
                'done_date_column' => 'checker_date',
                'queue_state' => 'QUEUED_CHECK',
                'in_progress_state' => 'IN_CHECK',
                'legacy_state' => 'CHECK',
            ],
            'filler' => [
                'id_column' => 'file_uploader_id',
                'name_column' => 'file_uploader_name',
                'assign_time_column' => 'fassign_time',
                'done_column' => 'file_uploaded',
                'done_date_column' => 'file_upload_date',
                'queue_state' => 'QUEUED_FILLER',
                'in_progress_state' => 'IN_FILLER',
                'legacy_state' => 'FILLER',
            ],
            'qa' => [
                'id_column' => 'qa_id',
                'name_column' => 'qa_name',
                'assign_time_column' => null,
                'done_column' => 'final_upload',
                'done_date_column' => 'ausFinaldate',
                'queue_state' => 'QUEUED_QA',
                'in_progress_state' => 'IN_QA',
                'legacy_state' => 'QA',
            ],
        ];
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
    private static function isOrderCompletionFlagYes($order, string $column): bool
    {
        if (strtolower(trim((string) ($order->{$column} ?? ''))) === 'yes') {
            return true;
        }

        if (!$order->project_id || !$order->order_number || !Schema::hasColumn('crm_order_assignments', $column)) {
            return false;
        }

        $value = DB::table('crm_order_assignments')
            ->where('project_id', $order->project_id)
            ->where('order_number', $order->order_number)
            ->value($column);

        return strtolower(trim((string) $value)) === 'yes';
    }
    private static function isOrderStageAssignedToUser($order, $user): bool
    {
        [$idCol] = self::getRoleColumns($user->role);

        if ($idCol) {
            $roleId = $order->{$idCol};
            if ($roleId !== null && $roleId !== '' && (int) $roleId !== 0) {
                return (int) $roleId === (int) $user->id;
            }
        }

        if ($order->assigned_to !== null && (int) $order->assigned_to === (int) $user->id) {
            return true;
        }

        if ($order->project_id && $order->order_number) {
            $crm = DB::table('crm_order_assignments')
                ->where('project_id', $order->project_id)
                ->where('order_number', $order->order_number)
                ->first();

            if ($crm && $idCol && isset($crm->{$idCol})) {
                return (int) $crm->{$idCol} === (int) $user->id;
            }
        }

        return false;
    }

    private static function isOrderAssignedToUser($order, $user): bool
    {
        // Check role-specific ID column first (authoritative for Metro-synced orders)
        [$idCol] = self::getRoleColumns($user->role);

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
// DONE LOCK (optional warning only, does not block assignment)
[, $doneCol] = self::getRoleColumns($role);
$queuedState = self::getRoleQueueState($role);
if (!$queuedState) {
    return response()->json(['message' => 'Invalid role configuration.'], 422);
}
if ($doneCol && strtolower(trim($order->{$doneCol} ?? '')) === 'yes') {
    // Log a warning instead of blocking
    \Log::warning("Reassigning {$role} for order #{$order->id} which is already done.");
    // If you want, you could also set $updates['status'] = 'in-progress'; here
}

    $cols = self::getRoleAssignmentColumns($role);

    DB::transaction(function () use ($order, $user, $cols, $actor, $role, $queuedState) {

        $oldAssignedTo = $order->assigned_to;
        $drawerIsDone = strtolower(trim((string) ($order->drawer_done ?? ''))) === 'yes';
        $isCheckerPreAssignment = $role === 'checker' && !$drawerIsDone;

        // =========================
        // ALWAYS UPDATE ASSIGNMENT
        // =========================
        $updates = [
            $cols['id_col']   => $user->id,
            $cols['name_col'] => $user->name,
        ];

        // Checker can be reserved before drawing starts without becoming the
        // active worker or advancing the order past the drawer.
        if (!$isCheckerPreAssignment) {
            $updates['assigned_to'] = $user->id;
        }

        if ($role === 'checker' && Schema::hasColumn($order->getTable(), 'checker_supervisor_id')) {
            $updates['checker_supervisor_id'] = $user->id;
        }

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

        // Assignment only queues the stage. The worker's start action moves it to IN_*.
        if (!$isCheckerPreAssignment) {
            $updates['workflow_state'] = $queuedState;
            $updates['status'] = 'pending';
        }

        $order->update($updates);

        // =========================
        // WIP MANAGEMENT (ALWAYS ON REASSIGN)
        // =========================
        if (!$isCheckerPreAssignment && $oldAssignedTo && (int)$oldAssignedTo !== (int)$user->id) {

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
        if (!$isCheckerPreAssignment) {
            self::pauseActiveWorkItemsForAssignment($order, $oldAssignedTo);
        }

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
