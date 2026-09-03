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
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

class ClientIssueController extends Controller
{
    /**
     * Helper to compute timeline timestamps & breakdown durations.
     */
    private function buildTimelineMetrics($issue, $order)
    {
        // 1. From Orders table
        $receivedAt = $order ? ($order->received_at ?? $order->date ?? $order->ausDatein ?? $order->created_at ?? null) : null;
        $dueIn = $order ? ($order->due_in ?? $order->due_date ?? null) : null;
        $completedAt = $order ? ($order->completed_at ?? $order->delivered_at ?? $order->ausFinaldate ?? null) : null;

        // 2. From Client Issues table
        $issueTime = $issue ? ($issue->comment_entered_at ?? $issue->created_at ?? null) : null;
        $fixedTime = $issue ? ($issue->resumed_at ?? null) : null;
        $clientRepliedAt = $issue ? ($issue->client_replied_at ?? null) : null;

        $now = now();

        $timeToPauseMinutes = ($receivedAt && $issueTime) 
            ? max(0, Carbon::parse($receivedAt)->diffInMinutes(Carbon::parse($issueTime), false)) 
            : null;

        $clientHoldMinutes = null;
        if ($issueTime) {
            $endHold = $fixedTime ?? $clientRepliedAt ?? ($order && in_array($order->workflow_state, ['CLIENT_ISSUE']) ? $now : null);
            if ($endHold) {
                $clientHoldMinutes = max(0, Carbon::parse($issueTime)->diffInMinutes(Carbon::parse($endHold), false));
            }
        }

        $postResumeWorkMinutes = null;
        if ($fixedTime) {
            $endWork = $completedAt ?? $now;
            $postResumeWorkMinutes = max(0, Carbon::parse($fixedTime)->diffInMinutes(Carbon::parse($endWork), false));
        }

        $totalElapsedMinutes = $receivedAt 
            ? max(0, Carbon::parse($receivedAt)->diffInMinutes(Carbon::parse($completedAt ?? $now), false)) 
            : null;

        $netProductionMinutes = $totalElapsedMinutes !== null 
            ? max(0, $totalElapsedMinutes - ($clientHoldMinutes ?? 0)) 
            : null;

        return [
            'received_at' => $receivedAt ? Carbon::parse($receivedAt)->toIso8601String() : null,
            'due_in' => $dueIn,
            'issue_time' => $issueTime ? Carbon::parse($issueTime)->toIso8601String() : null,
            'paused_at' => $issueTime ? Carbon::parse($issueTime)->toIso8601String() : null,
            'client_replied_at' => $clientRepliedAt ? Carbon::parse($clientRepliedAt)->toIso8601String() : null,
            'fixed_time' => $fixedTime ? Carbon::parse($fixedTime)->toIso8601String() : null,
            'resumed_at' => $fixedTime ? Carbon::parse($fixedTime)->toIso8601String() : null,
            'completed_at' => $completedAt ? Carbon::parse($completedAt)->toIso8601String() : null,
            'delivered_at' => $completedAt ? Carbon::parse($completedAt)->toIso8601String() : null,
            'is_completed' => !empty($completedAt) || ($order && in_array(strtolower($order->status ?? ''), ['completed', 'delivered', 'done'])),
            'metrics' => [
                'time_to_pause_minutes' => $timeToPauseMinutes,
                'client_hold_minutes' => $clientHoldMinutes,
                'post_resume_work_minutes' => $postResumeWorkMinutes,
                'total_elapsed_minutes' => $totalElapsedMinutes,
                'net_production_minutes' => $netProductionMinutes,
            ]
        ];
    }

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

        try {
            $log = ClientIssue::updateOrCreate(
                [
                    'project_id' => $projectId,
                    'order_id' => $orderId,
                ],
                $validated
            );
        } catch (\Throwable $e) {
            Log::error("[ClientIssue] updateOrCreate failed: " . $e->getMessage(), [
                'project_id' => $projectId,
                'order_id' => $orderId,
                'error' => $e->getMessage(),
            ]);
            return response()->json([
                'message' => 'Database error saving client issue: ' . $e->getMessage(),
            ], 500);
        }

        // Safely update the order's state to CLIENT_ISSUE (paused order)
        if ($order) {
            try {
                $tableName = ProjectOrderService::getTableName($projectId);
                $updates = [
                    'workflow_state' => 'CLIENT_ISSUE',
                    'status' => 'pending',
                    'updated_at' => now(),
                ];

                if (Schema::hasColumn($tableName, 'rejection_reason')) {
                    $updates['rejection_reason'] = $validated['reason'];
                }

                // If finished has been marked, optionally transition back
                if (!empty($validated['team_finished_at'])) {
                    $updates['workflow_state'] = 'QUEUED_DRAW';
                }

                DB::table($tableName)
                    ->where('id', $orderId)
                    ->update($updates);

                // Safely update crm_order_assignments only if table & column exist
                if (isset($order->order_number) && Schema::hasTable('crm_order_assignments')) {
                    $crmUpdates = [];
                    if (Schema::hasColumn('crm_order_assignments', 'workflow_state')) {
                        $crmUpdates['workflow_state'] = $updates['workflow_state'];
                    }
                    if (Schema::hasColumn('crm_order_assignments', 'updated_at')) {
                        $crmUpdates['updated_at'] = now();
                    }
                    if (!empty($crmUpdates)) {
                        DB::table('crm_order_assignments')
                            ->where('order_number', $order->order_number)
                            ->update($crmUpdates);
                    }
                }
            } catch (\Throwable $e) {
                Log::warning("[ClientIssue] Order status update warning: " . $e->getMessage());
            }
        }

        $freshOrder = $order ? Order::findInProject($projectId, $orderId) : null;
        $timeline = $this->buildTimelineMetrics($log, $freshOrder);

        return response()->json([
            'message' => 'Action logged successfully',
            'data' => $log,
            'order' => $freshOrder,
            'timeline' => $timeline,
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

        $timeline = $this->buildTimelineMetrics($log, $order);

        return response()->json([
            'data' => $log,
            'order' => $order ? [
                'id' => $order->id,
                'order_number' => $order->order_number,
                'client_reference' => $order->client_reference ?? null,
                'address' => $order->address ?? null,
                'workflow_state' => $order->workflow_state ?? null,
                'status' => $order->status ?? null,
                'received_at' => $order->received_at ?? $order->date ?? $order->ausDatein ?? $order->created_at ?? null,
                'due_in' => $order->due_in ?? $order->due_date ?? null,
                'completed_at' => $order->completed_at ?? $order->delivered_at ?? $order->ausFinaldate ?? null,
                'delivered_at' => $order->delivered_at ?? $order->completed_at ?? $order->ausFinaldate ?? null,
                'project_id' => (int) $projectId,
            ] : null,
            'timeline' => $timeline,
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

        $now = now();

        // 1. Record resumed_at in client_issues table
        try {
            $issue = ClientIssue::where('project_id', $projectId)
                ->where('order_id', $orderId)
                ->latest('updated_at')
                ->first();

            if ($issue) {
                $pauseStart = $issue->comment_entered_at ?? $issue->created_at;
                $diff = $pauseStart ? Carbon::parse($pauseStart)->diffInMinutes($now) : null;
                $updateData = ['resumed_at' => $now];
                if (Schema::hasColumn('client_issues', 'resumed_by')) {
                    $updateData['resumed_by'] = Auth::id();
                }
                if (Schema::hasColumn('client_issues', 'pause_to_resume_diff_minutes')) {
                    $updateData['pause_to_resume_diff_minutes'] = $diff;
                }
                $issue->update($updateData);
            }
        } catch (\Throwable $e) {
            Log::warning("[ClientIssue] Resume issue log update warning: " . $e->getMessage());
        }

        // 2. Update order workflow state to QUEUED_DRAW
        $tableName = ProjectOrderService::getTableName($projectId);
        DB::table($tableName)
            ->where('id', $orderId)
            ->update([
                'workflow_state' => 'QUEUED_DRAW',
                'status' => 'pending',
                'updated_at' => $now,
            ]);

        if (isset($order->order_number) && Schema::hasTable('crm_order_assignments')) {
            $crmUpdates = [];
            if (Schema::hasColumn('crm_order_assignments', 'workflow_state')) {
                $crmUpdates['workflow_state'] = 'QUEUED_DRAW';
            }
            if (Schema::hasColumn('crm_order_assignments', 'updated_at')) {
                $crmUpdates['updated_at'] = $now;
            }
            if (!empty($crmUpdates)) {
                DB::table('crm_order_assignments')
                    ->where('order_number', $order->order_number)
                    ->update($crmUpdates);
            }
        }

        $freshOrder = Order::findInProject($projectId, $orderId);
        $latestIssue = ClientIssue::where('project_id', $projectId)->where('order_id', $orderId)->latest('updated_at')->first();
        $timeline = $this->buildTimelineMetrics($latestIssue, $freshOrder);

        return response()->json([
            'message' => 'Order resumed successfully.',
            'order' => $freshOrder,
            'timeline' => $timeline,
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
            $timeline = $this->buildTimelineMetrics($issue, $order);

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
                'resumed_at' => $issue->resumed_at,
                'pause_to_resume_diff_minutes' => $issue->pause_to_resume_diff_minutes,
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
                'timeline' => $timeline,
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
