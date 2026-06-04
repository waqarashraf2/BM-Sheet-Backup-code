<?php

namespace App\Jobs;

use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;

/**
 * Reset daily counters for all users at midnight.
 * Clears today_completed and wip_count for inactive workers.
 */
class ResetDailyCounters implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 60;

    public function handle(): void
    {
        $count = User::where('today_completed', '>', 0)->count();

        // Reset today_completed for all users
        User::where('today_completed', '>', 0)->update(['today_completed' => 0]);

        Log::info("ResetDailyCounters: Reset today_completed for {$count} users.");
    }

    public function failed(\Throwable $exception): void
    {
        Log::error('ResetDailyCounters job failed', [
            'error' => $exception->getMessage(),
        ]);
    }
}
