<?php

namespace App\Jobs;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use DateTime;
use DateTimeZone;

class BackfillTimezoneAwareTimestamps implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    protected int $projectId;
    protected string $timezone;
    protected int $batchSize = 1000;

    public function __construct(int $projectId, string $timezone)
    {
        $this->projectId = $projectId;
        $this->timezone = $timezone;
        $this->onQueue('default');
        $this->delay(now()->addSeconds(5));
    }

    public function handle(): void
    {
        $table = "project_{$this->projectId}_orders";

        if (!DB::table($table)->exists()) {
            Log::warning("BackfillTimezoneAwareTimestamps: Table {$table} does not exist");
            return;
        }

        $totalUpdated = 0;

        try {
            $query = DB::table($table)
                ->whereNull('received_at_utc')
                ->whereNotNull('received_at');

            $totalRemaining = (clone $query)->count();

            while ($totalRemaining > 0) {
                $orders = (clone $query)
                    ->limit($this->batchSize)
                    ->get();

                if ($orders->isEmpty()) {
                    break;
                }

                foreach ($orders as $order) {
                    try {
                        $receivedUtc = $this->convertToUTC($order->received_at, $this->timezone);
                        $deliveredUtc = null;

                        if ($order->delivered_at) {
                            $deliveredUtc = $this->convertToUTC($order->delivered_at, $this->timezone);
                        }

                        DB::table($table)
                            ->where('id', $order->id)
                            ->update([
                                'received_at_utc' => $receivedUtc,
                                'delivered_at_utc' => $deliveredUtc,
                                'received_at_timezone' => $this->timezone,
                            ]);

                        $totalUpdated++;
                    } catch (\Throwable $e) {
                        Log::warning("BackfillTimezoneAwareTimestamps: Failed to convert order {$order->id}", [
                            'project_id' => $this->projectId,
                            'error' => $e->getMessage(),
                        ]);
                        continue;
                    }
                }

                $totalRemaining -= $this->batchSize;

                Log::info("BackfillTimezoneAwareTimestamps progress", [
                    'project_id' => $this->projectId,
                    'timezone' => $this->timezone,
                    'updated_so_far' => $totalUpdated,
                    'remaining' => max(0, $totalRemaining),
                ]);
            }

            Log::info("BackfillTimezoneAwareTimestamps completed", [
                'project_id' => $this->projectId,
                'timezone' => $this->timezone,
                'total_updated' => $totalUpdated,
            ]);
        } catch (\Throwable $e) {
            Log::error("BackfillTimezoneAwareTimestamps failed", [
                'project_id' => $this->projectId,
                'timezone' => $this->timezone,
                'error' => $e->getMessage(),
            ]);
            throw $e;
        }
    }

    private function convertToUTC(string $value, string $sourceTimezone): string
    {
        try {
            $dt = new DateTime($value, new DateTimeZone($sourceTimezone));
            $dt->setTimezone(new DateTimeZone('UTC'));
            return $dt->format('Y-m-d H:i:s');
        } catch (\Throwable $e) {
            Log::warning("convertToUTC failed", [
                'value' => $value,
                'source_timezone' => $sourceTimezone,
                'error' => $e->getMessage(),
            ]);
            // Fallback: assume it's already in the source timezone, just format it
            return $value;
        }
    }
}
