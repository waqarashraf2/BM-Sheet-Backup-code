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
        $order = $this->qaOrder($request, $orderId);

        return response()->json($this->service->status($order));
    }

    public function upload(Request $request, int $orderId)
    {
        $order = $this->qaOrder($request, $orderId);
        $data = $request->validate([
            'job_order_id' => 'nullable|string|max:120',
            'files' => 'required|array|min:1|max:100',
            'files.*' => 'required|file|max:51200',
        ]);

        try {
            $upload = $this->service->upload($order, $request->user(), $data['files'], $data['job_order_id'] ?? null);
        } catch (\Illuminate\Validation\ValidationException $e) {
            throw $e;
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => $e->getMessage(),
                'status' => 'failed',
            ], 502);
        }

        return response()->json([
            'message' => 'Files uploaded successfully to the client portal.',
            'status' => $this->service->status($order),
            'upload_id' => $upload->id,
        ]);
    }

    public function submit(Request $request, int $orderId)
    {
        $order = $this->qaOrder($request, $orderId);

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

    private function qaOrder(Request $request, int $orderId): Order
    {
        $user = $request->user();
        abort_unless($user && $user->role === 'qa', 403, 'Only QA can upload or submit these orders.');
        abort_unless($user->project_id, 422, 'QA user is not assigned to a project.');

        $order = Order::findInProject((int) $user->project_id, $orderId);
        abort_if(!$order, 404, 'Order not found in your project.');

        $qaId = (int) ($order->qa_id ?: $order->assigned_to);
        abort_unless($qaId === (int) $user->id, 403, 'This QA stage is not assigned to you.');

        return $order;
    }
}
