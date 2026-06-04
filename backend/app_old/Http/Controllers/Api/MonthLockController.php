<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\MonthLock;
use App\Models\Order;
use App\Models\WorkItem;
use App\Services\AuditService;
use App\Services\NotificationService;
use Illuminate\Http\Request;

class MonthLockController extends Controller
{
    /**
     * GET /month-locks/{projectId}
     * List all month locks for a project.
     */
    public function index(int $projectId)
    {
        $locks = MonthLock::where('project_id', $projectId)
            ->with(['lockedByUser:id,name', 'unlockedByUser:id,name'])
            ->orderByDesc('year')
            ->orderByDesc('month')
            ->get();

        return response()->json(['locks' => $locks]);
    }

    /**
     * POST /month-locks/{projectId}/lock
     * Lock a month for a project — freezes production counts.
     */
    public function lock(Request $request, int $projectId)
    {
        $request->validate([
            'month' => 'required|integer|min:1|max:12',
            'year' => 'required|integer|min:2020|max:2100',
        ]);

        $user = $request->user();
        if (!in_array($user->role, ['operations_manager', 'director', 'ceo'])) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $month = $request->input('month');
        $year = $request->input('year');

        // Check if already locked
        $existing = MonthLock::where('project_id', $projectId)
            ->where('month', $month)
            ->where('year', $year)
            ->first();

        if ($existing && $existing->is_locked) {
            return response()->json(['message' => 'Month is already locked.'], 422);
        }

        // Compute frozen counts
        $frozenCounts = $this->computeProductionCounts($projectId, $month, $year);

        $lock = MonthLock::updateOrCreate(
            ['project_id' => $projectId, 'month' => $month, 'year' => $year],
            [
                'is_locked' => true,
                'locked_by' => $user->id,
                'locked_at' => now(),
                'unlocked_by' => null,
                'unlocked_at' => null,
                'frozen_counts' => $frozenCounts,
            ]
        );

        AuditService::logMonthLock($lock->id, $projectId, 'LOCK_MONTH');

        NotificationService::monthLocked($projectId, $month, $year, $user);

        return response()->json([
            'lock' => $lock,
            'message' => "Month {$month}/{$year} locked successfully.",
        ]);
    }

    /**
     * POST /month-locks/{projectId}/unlock
     * Unlock a month (CEO/Director only).
     */
    public function unlock(Request $request, int $projectId)
    {
        $request->validate([
            'month' => 'required|integer|min:1|max:12',
            'year' => 'required|integer|min:2020|max:2100',
        ]);

        $user = $request->user();
        if (!in_array($user->role, ['director', 'ceo'])) {
            return response()->json(['message' => 'Only CEO/Director can unlock months.'], 403);
        }

        $lock = MonthLock::where('project_id', $projectId)
            ->where('month', $request->input('month'))
            ->where('year', $request->input('year'))
            ->firstOrFail();

        if (!$lock->is_locked) {
            return response()->json(['message' => 'Month is not locked.'], 422);
        }

        $lock->update([
            'is_locked' => false,
            'unlocked_by' => $user->id,
            'unlocked_at' => now(),
        ]);

        AuditService::logMonthLock($lock->id, $projectId, 'UNLOCK_MONTH');

        return response()->json([
            'lock' => $lock->fresh(),
            'message' => 'Month unlocked.',
        ]);
    }

    /**
     * GET /month-locks/{projectId}/counts
     * Get production counts for a month (frozen if locked, live if not).
     */
    public function counts(Request $request, int $projectId)
    {
        $request->validate([
            'month' => 'required|integer|min:1|max:12',
            'year' => 'required|integer|min:2020|max:2100',
        ]);

        $month = $request->input('month');
        $year = $request->input('year');

        $lock = MonthLock::where('project_id', $projectId)
            ->where('month', $month)
            ->where('year', $year)
            ->first();

        if ($lock && $lock->is_locked) {
            return response()->json([
                'counts' => $lock->frozen_counts,
                'is_locked' => true,
                'locked_at' => $lock->locked_at,
            ]);
        }

        $counts = $this->computeProductionCounts($projectId, $month, $year);

        return response()->json([
            'counts' => $counts,
            'is_locked' => false,
        ]);
    }

    /**
     * POST /month-locks/{projectId}/clear
     * Clear panel — resets view to new month. Does NOT delete data.
     */
    public function clearPanel(Request $request, int $projectId)
    {
        $user = $request->user();
        if (!in_array($user->role, ['operations_manager', 'director', 'ceo'])) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        AuditService::log($user->id, 'CLEAR_PANEL', 'Project', $projectId, $projectId, null, [
            'cleared_at' => now()->toIso8601String(),
        ]);

        return response()->json(['message' => 'Panel cleared. Historical data preserved.']);
    }

    /**
     * POST /month-locks/{projectId}/update-counts
     * Operations Manager can update service category counts before locking.
     */
    public function updateCounts(Request $request, int $projectId)
    {
        $request->validate([
            'month' => 'required|integer|min:1|max:12',
            'year' => 'required|integer|min:2020|max:2100',
            'service_counts' => 'required|array',
        ]);

        $user = $request->user();
        if (!in_array($user->role, ['operations_manager', 'director', 'ceo'])) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $month = $request->input('month');
        $year = $request->input('year');

        $lock = MonthLock::where('project_id', $projectId)
            ->where('month', $month)
            ->where('year', $year)
            ->first();

        if ($lock && $lock->is_locked) {
            return response()->json(['message' => 'Cannot update counts for a locked month.'], 422);
        }

        // Compute base counts first
        $baseCounts = $this->computeProductionCounts($projectId, $month, $year);

        // Merge with manually entered service counts
        $serviceCounts = $request->input('service_counts');
        $mergedCounts = array_merge($baseCounts, ['service_categories' => $serviceCounts]);

        $lock = MonthLock::updateOrCreate(
            ['project_id' => $projectId, 'month' => $month, 'year' => $year],
            [
                'frozen_counts' => $mergedCounts,
                'is_locked' => false,
            ]
        );

        AuditService::log($user->id, 'UPDATE_SERVICE_COUNTS', 'MonthLock', $lock->id, $projectId, null, [
            'service_counts' => $serviceCounts,
        ]);

        return response()->json([
            'lock' => $lock,
            'message' => 'Service counts updated.',
        ]);
    }

    // ── Private ──

    private function computeProductionCounts(int $projectId, int $month, int $year): array
    {
        $startDate = "{$year}-" . str_pad($month, 2, '0', STR_PAD_LEFT) . "-01";
        $endDate = date('Y-m-t', strtotime($startDate));

        $received = Order::forProject($projectId)
            ->whereBetween('received_at', [$startDate, $endDate . ' 23:59:59'])
            ->count();

        $deliveredOrders = Order::forProject($projectId)
            ->where('workflow_state', 'DELIVERED')
            ->whereBetween('delivered_at', [$startDate, $endDate . ' 23:59:59'])
            ->get();

        $delivered = $deliveredOrders->count();

        $pending = Order::forProject($projectId)
            ->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])
            ->count();

        // Per-stage completed work items
        $stageCompletions = WorkItem::where('project_id', $projectId)
            ->where('status', 'completed')
            ->whereBetween('completed_at', [$startDate, $endDate . ' 23:59:59'])
            ->selectRaw('stage, COUNT(*) as count')
            ->groupBy('stage')
            ->pluck('count', 'stage')
            ->all();

        // ── Floor Plan Invoice Categories ──
        // Aggregate by plan_type, bedrooms, area_range from metadata
        $byPlanType = [
            'black_and_white' => 0,
            'color' => 0,
            'texture' => 0,
            '3d' => 0,
            'other' => 0,
        ];

        $byBedrooms = [
            '1br' => 0,
            '2br' => 0,
            '3br' => 0,
            '4br' => 0,
            '5br_plus' => 0,
        ];

        $byAreaRange = [
            'under_1000sqft' => 0,
            '1000_2000sqft' => 0,
            '2000_3000sqft' => 0,
            '3000_4000sqft' => 0,
            'over_4000sqft' => 0,
        ];

        // ── Photos Enhancement Invoice Categories ──
        // Aggregate by image_type from metadata
        $byImageType = [
            'general' => 0,
            'hdr' => 0,
            'object_removal' => 0,
            'virtual_furniture' => 0,
            'other' => 0,
        ];

        foreach ($deliveredOrders as $order) {
            $meta = $order->metadata ?? [];

            // Plan Type (Floor Plan)
            $planType = strtolower($meta['plan_type'] ?? 'other');
            $planType = str_replace([' ', '&'], ['_', 'and'], $planType);
            if (isset($byPlanType[$planType])) {
                $byPlanType[$planType]++;
            } else {
                $byPlanType['other']++;
            }

            // Bedrooms (Floor Plan)
            $bedrooms = intval($meta['bedrooms'] ?? 0);
            if ($bedrooms >= 5) {
                $byBedrooms['5br_plus']++;
            } elseif ($bedrooms >= 1) {
                $byBedrooms[$bedrooms . 'br']++;
            }

            // Area (Floor Plan - square feet)
            $area = intval($meta['area_sqft'] ?? 0);
            if ($area < 1000) {
                $byAreaRange['under_1000sqft']++;
            } elseif ($area < 2000) {
                $byAreaRange['1000_2000sqft']++;
            } elseif ($area < 3000) {
                $byAreaRange['2000_3000sqft']++;
            } elseif ($area < 4000) {
                $byAreaRange['3000_4000sqft']++;
            } else {
                $byAreaRange['over_4000sqft']++;
            }

            // Image Type (Photos Enhancement)
            $imageType = strtolower($meta['image_type'] ?? 'general');
            $imageType = str_replace([' ', '-'], '_', $imageType);
            if (isset($byImageType[$imageType])) {
                $byImageType[$imageType]++;
            } else {
                $byImageType['other']++;
            }
        }

        return [
            'received' => $received,
            'delivered' => $delivered,
            'pending' => $pending,
            'stage_completions' => $stageCompletions,
            // Floor Plan categories
            'by_plan_type' => $byPlanType,
            'by_bedrooms' => $byBedrooms,
            'by_area_range' => $byAreaRange,
            // Photos Enhancement categories
            'by_image_type' => $byImageType,
            'computed_at' => now()->toIso8601String(),
        ];
    }
}
