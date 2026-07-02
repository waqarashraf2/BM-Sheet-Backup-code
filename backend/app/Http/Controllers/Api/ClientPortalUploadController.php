<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Order;
use App\Services\FocalClientPortalUploadService;
use Illuminate\Http\Request;

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
            'project_id' => 'nullable|integer|in:22,23,25',
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
        $maxFileKb = (int) config('services.focal_client_portal.max_file_kb', 614400);
        $data = $request->validate([
            'job_order_id' => 'nullable|string|max:120',
            'force_reupload' => 'sometimes|boolean',
            'files' => 'required|array|min:1|max:100',
            'files.*' => "required|file|max:{$maxFileKb}",
        ], [
            'files.*.max' => 'Each upload file must not be greater than ' . $this->formatFileSize($maxFileKb) . '.',
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

            return response()->json([
                'message' => $e->getMessage(),
                'status' => 'failed',
            ], $statusCode);
        }

        return response()->json([
            'message' => 'Files uploaded successfully to the client portal.',
            'status' => $this->service->status($order),
            'upload_id' => $upload->id,
        ]);
    }

    public function submit(Request $request, int $orderId)
    {
        $order = $this->portalOrder($request, $orderId, false);
        abort_unless($request->user()?->role === 'qa', 403, 'Only QA can submit orders to the client portal.');

        try {
            $upload = $this->service->submit($order);
        } catch (\Illuminate\Validation\ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => $e->getMessage(),
                'status' => 'submit_failed',
            ], 502);
        }

        return response()->json([
            'message' => 'Order accepted by the client portal. You can now complete it here.',
            'status' => $this->service->status($order),
            'upload_id' => $upload->id,
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

        $enabledProjectIds = [22, 23, 25];
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
        if ($kilobytes >= 1024) {
            $megabytes = $kilobytes / 1024;

            return rtrim(rtrim(number_format($megabytes, 1), '0'), '.') . ' MB';
        }

        return $kilobytes . ' KB';
    }
}
