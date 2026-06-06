<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChecklistTemplate;
use App\Models\Order;
use App\Models\OrderChecklist;
use Illuminate\Http\Request;

class ChecklistController extends Controller
{
    /**
     * Get checklist templates for a project.
     */
    public function templates(Request $request, int $projectId)
    {
        $query = ChecklistTemplate::where('project_id', $projectId)
            ->active()
            ->ordered();

        if ($request->has('layer')) {
            $query->forLayer($request->layer);
        }

        return response()->json($query->get());
    }

    /**
     * Create a new checklist template.
     */
    public function createTemplate(Request $request, int $projectId)
    {
        $validated = $request->validate([
            'layer' => 'required|in:drawer,checker,qa,designer',
            'title' => 'required|string|max:255',
            'description' => 'nullable|string',
            'sort_order' => 'nullable|integer',
            'is_required' => 'boolean',
        ]);

        $template = ChecklistTemplate::create([
            'project_id' => $projectId,
            ...$validated,
        ]);

        return response()->json([
            'message' => 'Checklist template created successfully',
            'data' => $template,
        ], 201);
    }

    /**
     * Update a checklist template.
     */
    public function updateTemplate(Request $request, int $templateId)
    {
        $template = ChecklistTemplate::findOrFail($templateId);

        $validated = $request->validate([
            'title' => 'sometimes|string|max:255',
            'description' => 'nullable|string',
            'sort_order' => 'nullable|integer',
            'is_required' => 'boolean',
            'is_active' => 'boolean',
        ]);

        $template->update($validated);

        return response()->json([
            'message' => 'Checklist template updated successfully',
            'data' => $template,
        ]);
    }

    /**
     * Delete a checklist template.
     */
    public function deleteTemplate(int $templateId)
    {
        $template = ChecklistTemplate::findOrFail($templateId);
        $template->delete();

        return response()->json([
            'message' => 'Checklist template deleted successfully',
        ]);
    }

    /**
     * Get checklist items for an order (with completion status).
     */
    public function orderChecklist(Request $request, int $orderId)
    {
        $order = Order::findOrFailGlobal($orderId);
        $order->load('project');
        $user = auth()->user();

        // Get templates for current layer
        $templates = ChecklistTemplate::where('project_id', $order->project_id)
            ->where('layer', $order->current_layer)
            ->active()
            ->ordered()
            ->get();

        // Get completed items for this order by current user
        $completedItems = OrderChecklist::where('order_id', $orderId)
            ->where('completed_by', $user->id)
            ->pluck('is_checked', 'checklist_template_id');

        $checklist = $templates->map(function ($template) use ($completedItems, $orderId, $user) {
            $completed = OrderChecklist::where('order_id', $orderId)
                ->where('checklist_template_id', $template->id)
                ->where('completed_by', $user->id)
                ->first();

            return [
                'id' => $template->id,
                'title' => $template->title,
                'description' => $template->description,
                'is_required' => $template->is_required,
                'is_checked' => $completed?->is_checked ?? false,
                'mistake_count' => $completed?->mistake_count ?? 0,
                'notes' => $completed?->notes,
                'completed_at' => $completed?->completed_at,
            ];
        });

        return response()->json([
            'order_id' => $orderId,
            'layer' => $order->current_layer,
            'items' => $checklist,
            'all_required_completed' => $order->hasCompletedChecklist(),
        ]);
    }

    /**
     * Update checklist item for an order.
     */
    public function updateOrderChecklist(Request $request, int $orderId, int $templateId)
    {
        $order = Order::findOrFailGlobal($orderId);
        $template = ChecklistTemplate::findOrFail($templateId);
        $user = auth()->user();

        $validated = $request->validate([
            'is_checked' => 'required|boolean',
            'mistake_count' => 'nullable|integer|min:0',
            'notes' => 'nullable|string',
        ]);

        $checklist = OrderChecklist::updateOrCreate(
            [
                'order_id' => $orderId,
                'checklist_template_id' => $templateId,
                'completed_by' => $user->id,
            ],
            [
                'is_checked' => $validated['is_checked'],
                'mistake_count' => $validated['mistake_count'] ?? 0,
                'notes' => $validated['notes'] ?? null,
                'completed_at' => $validated['is_checked'] ? now() : null,
            ]
        );

        return response()->json([
            'message' => 'Checklist item updated',
            'data' => $checklist,
            'all_required_completed' => $order->hasCompletedChecklist(),
        ]);
    }

    /**
     * Bulk update checklist items for an order.
     */
    public function bulkUpdateOrderChecklist(Request $request, int $orderId)
    {
        $order = Order::findOrFailGlobal($orderId);
        $user = auth()->user();

        $validated = $request->validate([
            'items' => 'required|array',
            'items.*.template_id' => 'required|exists:checklist_templates,id',
            'items.*.is_checked' => 'required|boolean',
            'items.*.mistake_count' => 'nullable|integer|min:0',
            'items.*.notes' => 'nullable|string',
        ]);

        foreach ($validated['items'] as $item) {
            OrderChecklist::updateOrCreate(
                [
                    'order_id' => $orderId,
                    'checklist_template_id' => $item['template_id'],
                    'completed_by' => $user->id,
                ],
                [
                    'is_checked' => $item['is_checked'],
                    'mistake_count' => $item['mistake_count'] ?? 0,
                    'notes' => $item['notes'] ?? null,
                    'completed_at' => $item['is_checked'] ? now() : null,
                ]
            );
        }

        return response()->json([
            'message' => 'Checklist items updated',
            'all_required_completed' => $order->hasCompletedChecklist(),
        ]);
    }

    /**
     * Get checklist completion status for an order.
     */
    public function checklistStatus(int $orderId)
    {
        $order = Order::findOrFailGlobal($orderId);
        $order->load('project');

        $templates = ChecklistTemplate::where('project_id', $order->project_id)
            ->where('layer', $order->current_layer)
            ->active()
            ->ordered()
            ->get();

        $requiredCount = $templates->where('is_required', true)->count();
        $completedRequired = OrderChecklist::where('order_id', $orderId)
            ->whereIn('checklist_template_id', $templates->where('is_required', true)->pluck('id'))
            ->where('is_checked', true)
            ->count();

        $totalCount = $templates->count();
        $completedTotal = OrderChecklist::where('order_id', $orderId)
            ->whereIn('checklist_template_id', $templates->pluck('id'))
            ->where('is_checked', true)
            ->count();

        return response()->json([
            'order_id' => $orderId,
            'layer' => $order->current_layer,
            'required_items' => $requiredCount,
            'completed_required' => $completedRequired,
            'total_items' => $totalCount,
            'completed_total' => $completedTotal,
            'can_complete' => $completedRequired >= $requiredCount,
            'percentage' => $totalCount > 0 ? round(($completedTotal / $totalCount) * 100) : 100,
        ]);
    }
}
