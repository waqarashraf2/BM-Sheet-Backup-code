<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Services\FocalClientPortalUploadService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class ClientPortalUploadController extends Controller
{
    public function __construct(private readonly FocalClientPortalUploadService $service)
    {
    }

    public function status(Request $request, int $orderId)
    {
        $order = $this->portalOrder($request, $orderId, false);

        return response()->json($this->service->status($order));
    }

    public function inProgress(Request $request)
    {
        $user = $request->user();
        abort_unless($user && in_array($user->role, ['operations_manager', 'project_manager', 'qa'], true), 403);

        $data = $request->validate([
            'status' => 'nullable|string|in:InProgress,Failed',
            'project_id' => 'nullable|integer|in:1,22,23,25,26',
        ]);

        return response()->json($this->service->inProgressOrdersForUser(
            $user,
            $data['status'] ?? 'InProgress',
            isset($data['project_id']) ? (int) $data['project_id'] : null
        ));
    }

    public function access(Request $request)
    {
        $user = $request->user();
        $canAccess = $user && $this->service->canAccessInProgressOrders($user);

        return response()->json([
            'can_access_in_progress' => (bool) $canAccess,
        ]);
    }

    public function upload(Request $request, int $orderId)
    {
        $order = $this->portalOrder($request, $orderId, true);
        $maxFileKb = (int) config('services.focal_client_portal.max_file_kb', 5242880);
        $data = $request->validate([
            'job_order_id' => 'nullable|string|max:120',
            'force_reupload' => 'sometimes|boolean',
            'files' => 'required|array|min:1|max:100',
            'files.*' => "required|file|max:{$maxFileKb}",
        ], [
            'files.*.max' => 'Each upload file must not be greater than ' . $this->formatFileSize($maxFileKb) . '.',
        ]);

        Log::info('Client portal upload request received', [
            'order_id' => $order->id,
            'project_id' => $order->project_id,
            'user_id' => $request->user()?->id,
            'file_count' => count($data['files']),
            'file_names' => collect($data['files'])->map->getClientOriginalName()->values()->all(),
            'file_sizes' => collect($data['files'])->map->getSize()->values()->all(),
        ]);

        try {
            $upload = $this->service->upload(
                $order,
                $request->user(),
                $data['files'],
                $data['job_order_id'] ?? null,
                (bool) ($data['force_reupload'] ?? false)
            );
        } catch (\Illuminate\Validation\ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            report($e);

            $statusCode = str_contains($e->getMessage(), 'Job Status - Completed') ? 422 : 502;
            $status = $this->service->status($order, false);

            Log::warning('Client portal upload request failed', [
                'order_id' => $order->id,
                'project_id' => $order->project_id,
                'user_id' => $request->user()?->id,
                'message' => $e->getMessage(),
            ]);

            return response()->json([
                'message' => $e->getMessage(),
                'status' => 'failed',
                'upload_status' => $status,
                'client_portal_response' => [
                    'stage' => 'upload',
                    'http_status' => $status['upload_http_status'] ?? null,
                    'body' => $status['upload_response'] ?? null,
                    'failure_reason' => $status['failure_reason'] ?? $e->getMessage(),
                ],
            ], $statusCode);
        }

        $status = $this->service->status($order, false);

        return response()->json([
            'message' => 'Files uploaded successfully to the client portal.',
            'status' => $status,
            'upload_id' => $upload->id,
            'client_portal_response' => [
                'stage' => 'upload',
                'http_status' => $upload->upload_http_status,
                'body' => $upload->upload_response,
                'failure_reason' => $upload->failure_reason,
            ],
        ]);
    }

    public function directUploadUrl(Request $request, int $orderId)
    {
        $order = $this->portalOrder($request, $orderId, true);
        $maxFileKb = (int) config('services.focal_client_portal.max_file_kb', 5242880);
        $data = $request->validate([
            'job_order_id' => 'nullable|string|max:120',
            'force_reupload' => 'sometimes|boolean',
            'file_name' => 'required|string|max:255',
            'file_size' => "required|integer|min:1|max:" . ($maxFileKb * 1024),
        ]);

        try {
            $prepared = $this->service->prepareDirectFespUpload(
                $order,
                $request->user(),
                $data['file_name'],
                (int) $data['file_size'],
                $data['job_order_id'] ?? null,
                (bool) ($data['force_reupload'] ?? false)
            );
        } catch (\Illuminate\Validation\ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            report($e);
            $status = $this->service->status($order, false);

            return response()->json([
                'message' => $e->getMessage(),
                'status' => 'failed',
                'upload_status' => $status,
                'client_portal_response' => [
                    'stage' => 'upload',
                    'http_status' => $status['upload_http_status'] ?? null,
                    'body' => $status['upload_response'] ?? null,
                    'failure_reason' => $status['failure_reason'] ?? $e->getMessage(),
                ],
            ], 502);
        }

        return response()->json($prepared);
    }

    public function confirmDirectUpload(Request $request, int $orderId)
    {
        $order = $this->portalOrder($request, $orderId, true);
        $data = $request->validate([
            'upload_id' => 'required|integer',
            'http_status' => 'nullable|integer|min:100|max:599',
            'response' => 'nullable|string|max:5000',
        ]);

        try {
            $upload = $this->service->confirmDirectFespUpload(
                $order,
                $request->user(),
                (int) $data['upload_id'],
                isset($data['http_status']) ? (int) $data['http_status'] : null,
                $data['response'] ?? null
            );
        } catch (\Illuminate\Validation\ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            report($e);
            $status = $this->service->status($order, false);

            return response()->json([
                'message' => $e->getMessage(),
                'status' => 'failed',
                'upload_status' => $status,
                'client_portal_response' => [
                    'stage' => 'upload',
                    'http_status' => $status['upload_http_status'] ?? null,
                    'body' => $status['upload_response'] ?? null,
                    'failure_reason' => $status['failure_reason'] ?? $e->getMessage(),
                ],
            ], 502);
        }

        $status = $this->service->status($order, false);

        return response()->json([
            'message' => 'Files uploaded successfully to the client portal.',
            'status' => $status,
            'upload_id' => $upload->id,
            'client_portal_response' => [
                'stage' => 'upload',
                'http_status' => $upload->upload_http_status,
                'body' => $upload->upload_response,
                'failure_reason' => $upload->failure_reason,
            ],
        ]);
    }

    public function submit(Request $request, int $orderId)
    {
        $order = $this->portalOrder($request, $orderId, false);
        $user = $request->user();
        abort_unless(
            $user && in_array($user->role, ['operations_manager', 'project_manager', 'qa'], true),
            403,
            'Only OM, PM, or QA can submit orders to the client portal.'
        );

        try {
            $upload = $this->service->submit($order, $user);
        } catch (\Illuminate\Validation\ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            report($e);
            $status = $this->service->status($order, false);

            return response()->json([
                'message' => $e->getMessage(),
                'status' => 'submit_failed',
                'upload_status' => $status,
                'client_portal_response' => [
                    'stage' => 'submit',
                    'http_status' => $status['submit_http_status'] ?? null,
                    'body' => $status['submit_response'] ?? null,
                    'failure_reason' => $status['failure_reason'] ?? $e->getMessage(),
                ],
            ], 502);
        }

        $status = $this->service->status($order, false);

        return response()->json([
            'message' => 'Order accepted by the client portal. You can now complete it here.',
            'status' => $status,
            'upload_id' => $upload->id,
            'client_portal_response' => [
                'stage' => 'submit',
                'http_status' => $upload->submit_http_status,
                'body' => $upload->submit_response,
                'failure_reason' => $upload->failure_reason,
            ],
        ]);
    }

    private function portalOrder(Request $request, int $orderId, bool $forUpload): Order
    {
        $user = $request->user();
        abort_unless($user, 403);

        $allowedProjectIds = match ($user->role) {
            'operations_manager', 'project_manager' => array_map('intval', $user->getManagedProjectIds()),
            'qa' => $user->project_id ? [(int) $user->project_id] : [],
            default => [],
        };

        $enabledProjectIds = [1, 22, 23, 25, 26];
        $allowedProjectIds = array_values(array_intersect($allowedProjectIds, $enabledProjectIds));
        abort_unless(!empty($allowedProjectIds), 403, 'Client portal upload is not enabled for your projects.');

        $order = null;
        $requestedProjectId = (int) ($request->input('project_id') ?: $request->query('project_id'));
        if ($requestedProjectId > 0) {
            abort_unless(in_array($requestedProjectId, $allowedProjectIds, true), 403, 'Access denied to this project.');
            $allowedProjectIds = [$requestedProjectId];
        }

        foreach ($allowedProjectIds as $projectId) {
            $order = Order::findInProject((int) $projectId, $orderId);
            if ($order) {
                break;
            }
        }

        abort_if(!$order, 404, 'Order not found in your allowed projects.');

        if ($user->role === 'qa') {
            $qaId = (int) ($order->qa_id ?: $order->assigned_to);
            abort_unless($qaId === (int) $user->id, 403, 'This QA stage is not assigned to you.');
        }

        if ($forUpload) {
            abort_unless(
                in_array($user->role, ['operations_manager', 'project_manager', 'qa'], true),
                403,
                'Only OM, PM, or assigned QA can reupload these orders.'
            );
        }

        return $order;
    }

    private function formatFileSize(int $kilobytes): string
    {
        if ($kilobytes >= 1048576) {
            $gigabytes = $kilobytes / 1048576;

            return rtrim(rtrim(number_format($gigabytes, 1), '0'), '.') . ' GB';
        }

        if ($kilobytes >= 1024) {
            $megabytes = $kilobytes / 1024;

            return rtrim(rtrim(number_format($megabytes, 1), '0'), '.') . ' MB';
        }

        return $kilobytes . ' KB';
    }
}
