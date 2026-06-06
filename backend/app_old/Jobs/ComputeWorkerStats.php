<?php

namespace App\Jobs;

use App\Models\User;
use App\Models\WorkItem;
use App\Models\Order;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Compute per-worker performance statistics used by the smart assignment engine.
 *
 * Runs every 10 minutes. For each active production worker, calculates:
 *   1. avg_completion_minutes  — rolling 30-day average time from assigned_at → completed_at
 *   2. rejection_rate_30d      — fraction of work items rejected in last 30 days
 *   3. assignment_score        — weighted composite score (higher = should get next order)
 *
 * Score Formula:
 *   SCORE = (capacity_ratio × 0.40) + (throughput_score × 0.25) + (quality_score × 0.20) + (freshness × 0.15)
 *
 *   capacity_ratio   = (wip_limit - current_weighted_load) / wip_limit    [0..1]
 *   throughput_score  = clamp(benchmark_minutes / avg_completion_minutes)  [0..1]
 *   quality_score     = 1 - rejection_rate_30d                            [0..1]
 *   freshness         = minutes_since_last_assignment / 120  (capped at 1) [0..1]
 */
class ComputeWorkerStats implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;
    public int $timeout = 180;

    /**
     * Benchmark completion time in minutes per stage.
     * Used to normalize throughput: a worker completing in exactly this time gets 1.0.
     */
    private const BENCHMARK_MINUTES = [
        'DRAW'   => 30,
        'CHECK'  => 15,
        'QA'     => 10,
        'DESIGN' => 25,
    ];

    public function handle(): void
    {
        Log::info('ComputeWorkerStats: Starting worker stats computation');

        $productionRoles = ['drawer', 'checker', 'qa', 'designer'];

        $workers = User::where('is_active', true)
            ->whereIn('role', $productionRoles)
            ->get();

        $updated = 0;
        $thirtyDaysAgo = now()->subDays(30);

        foreach ($workers as $worker) {
            try {
                $this->computeForWorker($worker, $thirtyDaysAgo);
                $updated++;
            } catch (\Throwable $e) {
                Log::warning("ComputeWorkerStats: Failed for user {$worker->id}", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        Log::info("ComputeWorkerStats: Updated {$updated} workers.");
    }

    private function computeForWorker(User $worker, $since): void
    {
        // ── 1. Average completion time (last 30 days) ──
        $avgMinutes = WorkItem::where('assigned_user_id', $worker->id)
            ->where('status', 'completed')
            ->where('completed_at', '>=', $since)
            ->whereNotNull('assigned_at')
            ->whereNotNull('completed_at')
            ->selectRaw('AVG(TIMESTAMPDIFF(MINUTE, assigned_at, completed_at)) as avg_mins')
            ->value('avg_mins');

        $avgMinutes = $avgMinutes ? round((float) $avgMinutes, 2) : 0;

        // ── 2. Rejection rate (last 30 days) ──
        $totalItems = WorkItem::where('assigned_user_id', $worker->id)
            ->where('completed_at', '>=', $since)
            ->whereIn('status', ['completed', 'abandoned'])
            ->count();

        $rejectedItems = WorkItem::where('assigned_user_id', $worker->id)
            ->where('completed_at', '>=', $since)
            ->whereNotNull('rejection_code')
            ->count();

        $rejectionRate = $totalItems > 0 ? round($rejectedItems / $totalItems, 4) : 0;

        // ── 3. Compute assignment score ──
        $score = $this->computeScore($worker, $avgMinutes, $rejectionRate);

        // ── Update in single query ──
        $worker->update([
            'avg_completion_minutes' => $avgMinutes,
            'rejection_rate_30d'     => $rejectionRate,
            'assignment_score'       => $score,
        ]);
    }

    private function computeScore(User $worker, float $avgMinutes, float $rejectionRate): float
    {
        $wipLimit = $worker->wip_limit ?: 5;

        // ── Capacity Ratio (40%) ──
        // Use weighted load if possible, else fall back to wip_count
        $currentLoad = $this->getWeightedLoad($worker);
        $capacityRatio = max(0, ($wipLimit - $currentLoad) / $wipLimit);

        // ── Throughput Score (25%) ──
        $stage = $this->getStageForRole($worker->role);
        $benchmark = self::BENCHMARK_MINUTES[$stage] ?? 20;
        // If avgMinutes is 0 (no data), give neutral score of 0.5
        $throughputScore = $avgMinutes > 0
            ? min(1.0, $benchmark / $avgMinutes)
            : 0.5;

        // ── Quality Score (20%) ──
        $qualityScore = 1.0 - $rejectionRate;

        // ── Freshness (15%) ──
        // Minutes since last assignment, capped at 120 for score of 1.0
        $lastAssignment = WorkItem::where('assigned_user_id', $worker->id)
            ->whereNotNull('assigned_at')
            ->latest('assigned_at')
            ->value('assigned_at');

        $minutesSinceAssignment = $lastAssignment
            ? now()->diffInMinutes($lastAssignment)
            : 120; // No prior assignment = max freshness

        $freshness = min(1.0, $minutesSinceAssignment / 120);

        // ── Composite Score ──
        $score = ($capacityRatio * 0.40)
               + ($throughputScore * 0.25)
               + ($qualityScore * 0.20)
               + ($freshness * 0.15);

        return round($score, 4);
    }

    /**
     * Get the weighted workload for a worker.
     * Uses complexity_weight from assigned orders instead of flat count.
     */
    private function getWeightedLoad(User $worker): float
    {
        if (!$worker->project_id) return 0;

        $inProgressStates = $this->getInProgressStatesForRole($worker->role);

        $weightedLoad = Order::forProject($worker->project_id)
            ->where('assigned_to', $worker->id)
            ->whereIn('workflow_state', $inProgressStates)
            ->selectRaw('COALESCE(SUM(complexity_weight), 0) as total_weight')
            ->value('total_weight');

        return (float) ($weightedLoad ?? 0);
    }

    private function getStageForRole(string $role): string
    {
        return match ($role) {
            'drawer'   => 'DRAW',
            'checker'  => 'CHECK',
            'qa'       => 'QA',
            'designer' => 'DESIGN',
            default    => 'DRAW',
        };
    }

    private function getInProgressStatesForRole(string $role): array
    {
        return match ($role) {
            'drawer'   => ['IN_DRAW'],
            'checker'  => ['IN_CHECK'],
            'qa'       => ['IN_QA'],
            'designer' => ['IN_DESIGN'],
            default    => [],
        };
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('ComputeWorkerStats job failed', [
            'error' => $exception->getMessage(),
        ]);
    }
}
