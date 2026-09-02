<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\ClientIssue;
use App\Models\Order;
use App\Models\Project;
use App\Services\ProjectOrderService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Auth;

class ClientIssueController extends Controller
{
    /**
     * Store or update client issue for a specific project order.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'project_id' => 'required|integer|exists:projects,id',
            'order_id' => 'required|integer',
            'reason' => 'required|string|max:255',
            'comment_text' => 'nullable|string',
            'comment_entered_at' => 'nullable|date',
            'client_reply_text' => 'nullable|string',
            'client_replied_at' => 'nullable|date',
            'comment_to_reply_diff_minutes' => 'nullable|integer',
            'team_started_at' => 'nullable|date',
            'reply_to_start_diff_minutes' => 'nullable|integer',
            'team_finished_at' => 'nullable|date',
            'time_taken_to_finish_minutes' => 'nullable|integer',
        ]);

        $projectId = (int) $validated['project_id'];
        $orderId = (int) $validated['order_id'];

        $order = Order::findInProject($projectId, $orderId);

        $log = ClientIssue::updateOrCreate(
            [
                'project_id' => $projectId,
                'order_id' => $orderId,
            ],
            $validated
        );

        // Safely update the order's state to CLIENT_ISSUE (paused order)
        if ($order) {
            $tableName = ProjectOrderService::getTableName($projectId);
            $updates = [
                'workflow_state' => 'CLIENT_ISSUE',
                'status' => 'pending',
                'rejection_reason' => $validated['reason'],
                'updated_at' => now(),
            ];

            // If finished has been marked, optionally transition back or keep state
            if (!empty($validated['team_finished_at'])) {
                // Team completed the fix after client reply
                $updates['workflow_state'] = 'QUEUED_DRAW';
            }

            DB::table($tableName)
                ->where('id', $orderId)
                ->update($updates);

            // Also update crm_order_assignments if present
            if (isset($order->order_number)) {
                DB::table('crm_order_assignments')
                    ->where('order_number', $order->order_number)
                    ->update([
                        'workflow_state' => $updates['workflow_state'],
                        'updated_at' => now(),
                    ]);
            }
        }

        return response()->json([
            'message' => 'Action logged successfully',
            'data' => $log,
            'order' => $order ? Order::findInProject($projectId, $orderId) : null,
        ], 200);
    }

    /**
     * Show client issue for a specific project order.
     */
    public function show($projectId, $orderId = null)
    {
        $query = ClientIssue::where('project_id', (int) $projectId);

        if ($orderId) {
            $query->where('order_id', (int) $orderId);
        }

        $log = $query->latest('updated_at')->first();
        $order = null;

        if ($orderId) {
            $order = Order::findInProject((int) $projectId, (int) $orderId);
        } elseif ($log && $log->order_id) {
            $order = Order::findInProject((int) $projectId, (int) $log->order_id);
        }

        return response()->json([
            'data' => $log,
            'order' => $order ? [
                'id' => $order->id,
                'order_number' => $order->order_number,
                'client_reference' => $order->client_reference ?? null,
                'address' => $order->address ?? null,
                'workflow_state' => $order->workflow_state ?? null,
                'status' => $order->status ?? null,
                'project_id' => (int) $projectId,
            ] : null,
        ]);
    }

    /**
     * Resume an order from CLIENT_ISSUE back into active workflow.
     */
    public function resume(Request $request, $projectId, $orderId)
    {
        $projectId = (int) $projectId;
        $orderId = (int) $orderId;

        $order = Order::findInProject($projectId, $orderId);
        if (!$order) {
            return response()->json(['message' => 'Order not found.'], 404);
        }

        $tableName = ProjectOrderService::getTableName($projectId);
        DB::table($tableName)
            ->where('id', $orderId)
            ->update([
                'workflow_state' => 'QUEUED_DRAW',
                'status' => 'pending',
                'updated_at' => now(),
            ]);

        if (isset($order->order_number)) {
            DB::table('crm_order_assignments')
                ->where('order_number', $order->order_number)
                ->update([
                    'workflow_state' => 'QUEUED_DRAW',
                    'updated_at' => now(),
                ]);
        }

        return response()->json([
            'message' => 'Order resumed successfully.',
            'order' => Order::findInProject($projectId, $orderId),
        ]);
    }

    /**
     * Dashboard listing of all client issues across project(s).
     */
    public function dashboard(Request $request)
    {
        $user = $request->user();
        $projectId = $request->query('project_id');
        $search = $request->query('search');

        $query = ClientIssue::query()->with('project:id,name,code');

        if ($user && $user->role === 'client') {
            $clientProjectIds = $user->getManagedProjectIds();
            if (!empty($clientProjectIds)) {
                $query->whereIn('project_id', $clientProjectIds);
            } else {
                $query->whereRaw('1 = 0'); // No projects assigned
            }
        } elseif ($projectId) {
            $query->where('project_id', (int) $projectId);
        }

        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('reason', 'LIKE', "%{$search}%")
                  ->orWhere('comment_text', 'LIKE', "%{$search}%")
                  ->orWhere('client_reply_text', 'LIKE', "%{$search}%");
            });
        }

        $issues = $query->orderBy('updated_at', 'desc')->paginate(25);

        $items = collect($issues->items())->map(function ($issue) {
            $order = Order::findInProject((int) $issue->project_id, (int) $issue->order_id);
            return [
                'id' => $issue->id,
                'project_id' => $issue->project_id,
                'order_id' => $issue->order_id,
                'reason' => $issue->reason,
                'comment_text' => $issue->comment_text,
                'comment_entered_at' => $issue->comment_entered_at,
                'client_reply_text' => $issue->client_reply_text,
                'client_replied_at' => $issue->client_replied_at,
                'comment_to_reply_diff_minutes' => $issue->comment_to_reply_diff_minutes,
                'team_started_at' => $issue->team_started_at,
                'reply_to_start_diff_minutes' => $issue->reply_to_start_diff_minutes,
                'team_finished_at' => $issue->team_finished_at,
                'time_taken_to_finish_minutes' => $issue->time_taken_to_finish_minutes,
                'project_name' => $issue->project->name ?? "Project #{$issue->project_id}",
                'project_code' => $issue->project->code ?? null,
                'order_number' => $order->order_number ?? "Order #{$issue->order_id}",
                'client_reference' => $order->client_reference ?? '-',
                'address' => $order->address ?? '-',
                'workflow_state' => $order->workflow_state ?? 'CLIENT_ISSUE',
                'updated_at' => $issue->updated_at,
            ];
        });

        return response()->json([
            'data' => $items,
            'current_page' => $issues->currentPage(),
            'last_page' => $issues->lastPage(),
            'total' => $issues->total(),
            'per_page' => $issues->perPage(),
        ]);
    }

    /**
     * Submit client reply for an issue.
     */
    public function reply(Request $request, $projectId, $orderId)
    {
        $validated = $request->validate([
            'reply_text' => 'required|string|min:1',
        ]);

        $projectId = (int) $projectId;
        $orderId = (int) $orderId;

        $user = $request->user();
        if ($user && $user->role === 'client') {
            $allowedProjects = $user->getManagedProjectIds();
            if (!in_array($projectId, $allowedProjects)) {
                return response()->json(['message' => 'Unauthorized project issue.'], 403);
            }
        }

        $issue = ClientIssue::where('project_id', $projectId)
            ->where('order_id', $orderId)
            ->latest('updated_at')
            ->first();

        if (!$issue) {
            return response()->json(['message' => 'Issue record not found.'], 404);
        }

        $now = now();
        $diffMinutes = null;
        if ($issue->comment_entered_at) {
            $diffMinutes = (int) $now->diffInMinutes(\Carbon\Carbon::parse($issue->comment_entered_at));
        }

        $issue->update([
            'client_reply_text' => $validated['reply_text'],
            'client_replied_at' => $now,
            'comment_to_reply_diff_minutes' => $diffMinutes,
        ]);

        return response()->json([
            'message' => 'Client reply recorded successfully.',
            'data' => $issue,
        ]);
    }
}
