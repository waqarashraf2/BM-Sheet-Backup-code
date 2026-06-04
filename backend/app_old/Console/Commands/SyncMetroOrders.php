<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Carbon\Carbon;

/**
 * SyncMetroOrders — Pull recent changes from old Metro DB and mirror to new system.
 *
 * Connects to `stellarinstitute_metro_old` DB (imported on same server).
 * Checks for orders modified since last sync and upserts into project_13_orders.
 *
 * Usage:
 *   php artisan sync:metro                  # Sync changes from last 15 minutes
 *   php artisan sync:metro --minutes=60     # Sync changes from last hour
 *   php artisan sync:metro --full           # Full re-sync all orders
 *   php artisan sync:metro --dry-run        # Preview without writing
 */
class SyncMetroOrders extends Command
{
    protected $signature = 'sync:metro
                            {--minutes=15 : Sync orders changed in last N minutes}
                            {--full : Full re-sync of all orders}
                            {--dry-run : Preview without writing to DB}
                            {--batch=500 : Batch size for processing}';

    protected $description = 'Sync recent order changes from old Metro DB to project_13_orders';

    private const TARGET_PROJECT_ID = 13;
    private const OLD_DB = 'metro_old'; // DB connection name in config/database.php

    private int $inserted = 0;
    private int $updated = 0;
    private int $skipped = 0;
    private int $errors = 0;

    public function handle(): int
    {
        $isDryRun  = $this->option('dry-run');
        $isFull    = $this->option('full');
        $minutes   = (int) $this->option('minutes');
        $batchSize = (int) $this->option('batch');

        $prefix = $isDryRun ? '[DRY RUN] ' : '';
        $this->info("{$prefix}Starting Metro sync...");

        // Test old DB connection
        try {
            $testCount = DB::connection(self::OLD_DB)->table('order')->count();
            $this->info("Connected to old Metro DB. Total orders in old system: {$testCount}");
        } catch (\Exception $e) {
            $this->error("Cannot connect to old Metro DB: " . $e->getMessage());
            $this->error("Make sure METRO_DB_* env vars are set, or the metro_old connection is configured.");
            return 1;
        }

        // Build query for recent changes
        $query = DB::connection(self::OLD_DB)->table('order');

        if (!$isFull) {
            $since = Carbon::now()->subMinutes($minutes)->toDateTimeString();
            $this->info("Syncing orders changed since: {$since}");

            // Old system doesn't have a single `updated_at` column, so check multiple timestamp fields
            $query->where(function ($q) use ($since) {
                $q->where('dassign_time', '>=', $since)
                  ->orWhere('cassign_time', '>=', $since)
                  ->orWhere('drawer_date', '>=', $since)
                  ->orWhere('checker_date', '>=', $since)
                  ->orWhere('ausFinaldate', '>=', $since)
                  ->orWhere('ausDatein', '>=', $since);

                // Also check ID for newly inserted orders (no timestamps)
                // We use a subquery approach: orders with ID > max known METRO-xxx
                $maxSyncedId = $this->getMaxSyncedOldId();
                if ($maxSyncedId) {
                    $q->orWhere('id', '>', $maxSyncedId);
                }
            });
        } else {
            $this->info("Full re-sync mode — processing ALL orders...");
        }

        $totalToProcess = $query->count();
        $this->info("Orders to process: {$totalToProcess}");

        if ($totalToProcess === 0) {
            $this->info("No changes to sync.");
            return 0;
        }

        $bar = $this->output->createProgressBar($totalToProcess);
        $bar->start();

        $table = 'project_' . self::TARGET_PROJECT_ID . '_orders';

        // Process in batches
        $query->orderBy('id')->chunk($batchSize, function ($orders) use ($table, $isDryRun, $bar) {
            foreach ($orders as $oldOrder) {
                try {
                    $oldId = $oldOrder->id;
                    $orderNumber = 'METRO-' . $oldId;

                    // Check if order exists in new system
                    $existing = DB::table($table)
                        ->where('order_number', $orderNumber)
                        ->first();

                    $mapped = $this->mapOldToNew($oldOrder);

                    if ($existing) {
                        // Check if anything actually changed
                        if ($this->hasChanges($existing, $mapped)) {
                            if (!$isDryRun) {
                                DB::table($table)
                                    ->where('id', $existing->id)
                                    ->update($mapped);

                                // Re-apply CRM overlay (CRM assignments are authoritative)
                                $this->reApplyCrmOverlay($table, $orderNumber);
                            }
                            $this->updated++;
                        } else {
                            $this->skipped++;
                        }
                    } else {
                        // New order
                        $mapped['order_number'] = $orderNumber;
                        $mapped['project_id'] = self::TARGET_PROJECT_ID;
                        $mapped['workflow_type'] = 'FP_3_LAYER';
                        $mapped['import_source'] = 'csv';
                        $mapped['created_at'] = now();
                        $mapped['updated_at'] = now();
                        $mapped['metadata'] = json_encode([
                            '_migration' => 'cron_sync',
                            '_old_id' => $oldId,
                            '_synced_at' => now()->toDateTimeString(),
                        ]);

                        if (!$isDryRun) {
                            DB::table($table)->insert($mapped);
                        }
                        $this->inserted++;
                    }
                } catch (\Exception $e) {
                    $this->errors++;
                    Log::channel('daily')->error("SYNC CRON ERROR: old_id={$oldOrder->id} — " . $e->getMessage());
                }

                $bar->advance();
            }
        });

        $bar->finish();
        $this->newLine(2);

        $this->info("━━━━ Sync Complete ━━━━");
        $this->info(" Inserted: {$this->inserted}");
        $this->info(" Updated:  {$this->updated}");
        $this->info(" Skipped:  {$this->skipped} (no changes)");
        $this->info(" Errors:   {$this->errors}");
        $this->info("━━━━━━━━━━━━━━━━━━━━━━");

        if ($isDryRun) {
            $this->warn("DRY RUN — no changes were written to database.");
        }

        Log::channel('daily')->info("SYNC CRON: inserted={$this->inserted}, updated={$this->updated}, skipped={$this->skipped}, errors={$this->errors}");

        return 0;
    }

    /**
     * Re-apply CRM assignment overlay after Metro sync update.
     * CRM assignments (stored in crm_order_assignments) are authoritative
     * and must not be overwritten by Metro data.
     */
    private function reApplyCrmOverlay(string $table, string $orderNumber): void
    {
        $crm = DB::table('crm_order_assignments')
            ->where('project_id', self::TARGET_PROJECT_ID)
            ->where('order_number', $orderNumber)
            ->first();

        if (!$crm) return;

        $overlay = [];
        if ($crm->workflow_state)  $overlay['workflow_state'] = $crm->workflow_state;
        if ($crm->assigned_to)    $overlay['assigned_to']    = $crm->assigned_to;
        if ($crm->drawer_id)      $overlay['drawer_id']      = $crm->drawer_id;
        if ($crm->drawer_name)    $overlay['drawer_name']    = $crm->drawer_name;
        if ($crm->checker_id)     $overlay['checker_id']     = $crm->checker_id;
        if ($crm->checker_name)   $overlay['checker_name']   = $crm->checker_name;
        if ($crm->qa_id)          $overlay['qa_id']          = $crm->qa_id;
        if ($crm->qa_name)        $overlay['qa_name']        = $crm->qa_name;
        if ($crm->dassign_time)   $overlay['dassign_time']   = $crm->dassign_time;
        if ($crm->cassign_time)   $overlay['cassign_time']   = $crm->cassign_time;
        if ($crm->drawer_done)    $overlay['drawer_done']    = $crm->drawer_done;
        if ($crm->checker_done)   $overlay['checker_done']   = $crm->checker_done;
        if ($crm->final_upload)   $overlay['final_upload']   = $crm->final_upload;
        if ($crm->drawer_date)    $overlay['drawer_date']    = $crm->drawer_date;
        if ($crm->checker_date)   $overlay['checker_date']   = $crm->checker_date;
        if ($crm->ausFinaldate)   $overlay['ausFinaldate']   = $crm->ausFinaldate;

        if (!empty($overlay)) {
            DB::table($table)
                ->where('order_number', $orderNumber)
                ->update($overlay);
        }
    }

    /**
     * Get the highest old system ID that we've already synced.
     */
    private function getMaxSyncedOldId(): ?int
    {
        $table = 'project_' . self::TARGET_PROJECT_ID . '_orders';
        $latest = DB::table($table)
            ->where('order_number', 'like', 'METRO-%')
            ->orderByRaw("CAST(REPLACE(order_number, 'METRO-', '') AS UNSIGNED) DESC")
            ->first(['order_number']);

        if ($latest) {
            return (int) str_replace('METRO-', '', $latest->order_number);
        }
        return null;
    }

    /**
     * Map old system row to new system columns.
     */
    private function mapOldToNew(object $old): array
    {
        $mapped = [];

        // Core fields
        $mapped['client_reference'] = $old->order_id ?? null;
        if ($old->order_id ?? null) {
            $clientPortalId = $old->order_id;
            if (str_contains($clientPortalId, '_')) {
                $clientPortalId = explode('_', $clientPortalId)[0];
            }
            $mapped['client_portal_id'] = $clientPortalId;
        }

        $mapped['address'] = trim($old->property ?? '');

        // Priority
        $cn = strtolower(trim($old->client_name ?? ''));
        $mapped['priority'] = match (true) {
            $cn === 'high' => 'high',
            $cn === 'urgent' => 'urgent',
            default => 'normal',
        };

        // Worker info
        $mapped['drawer_name'] = trim($old->dname ?? '');
        $mapped['drawer_id'] = $this->resolveWorkerId($mapped['drawer_name'], 'drawer');
        $mapped['checker_name'] = trim($old->cname ?? '');
        $mapped['checker_id'] = $this->resolveWorkerId($mapped['checker_name'], 'checker');

        // QA — check qa column if exists
        if (isset($old->qa_person)) {
            $mapped['qa_name'] = trim($old->qa_person);
            $mapped['qa_id'] = $this->resolveWorkerId($mapped['qa_name'], 'qa');
        }

        // Timestamps
        $mapped['dassign_time'] = $this->cleanTimestamp($old->dassign_time ?? null);
        $mapped['cassign_time'] = $this->cleanTimestamp($old->cassign_time ?? null);
        $mapped['drawer_date'] = $this->cleanTimestamp($old->drawer_date ?? null);
        $mapped['checker_date'] = $this->cleanTimestamp($old->checker_date ?? null);
        $mapped['ausFinaldate'] = $this->cleanTimestamp($old->ausFinaldate ?? null);

        // Date received
        $ausDatein = trim($old->ausDatein ?? '');
        $mapped['ausDatein'] = $this->parseDate($ausDatein);

        // Completion flags
        $mapped['drawer_done'] = trim($old->drawer_done ?? '');
        $mapped['checker_done'] = trim($old->checker_done ?? '');
        $mapped['final_upload'] = trim($old->final_upload ?? '');

        // Mistakes
        $mapped['mistake'] = trim($old->mistake ?? '');
        $mapped['cmistake'] = trim($old->cmistake ?? '');

        // Other legacy fields
        $mapped['code'] = $old->code ?? null;
        $mapped['plan_type'] = $old->plan_type ?? null;
        $mapped['instruction'] = $old->instruction ?? null;
        $mapped['year'] = isset($old->year) ? (int) $old->year : null;
        $mapped['month'] = isset($old->month) ? (int) $old->month : null;
        $mapped['date'] = $old->date ?? null;
        $mapped['d_id'] = isset($old->d_id) ? (int) $old->d_id : null;
        $mapped['amend'] = $old->amend ?? null;
        $mapped['d_live_qa'] = isset($old->d_live_qa) ? (int) $old->d_live_qa : 0;
        $mapped['c_live_qa'] = isset($old->c_live_qa) ? (int) $old->c_live_qa : 0;
        $mapped['qa_live_qa'] = isset($old->qa_live_qa) ? (int) $old->qa_live_qa : 0;

        // Rejection
        $mapped['rejection_type'] = ($old->status ?? '') === 'pending' ? ($old->reason ?? null) : null;

        // Workflow state derivation
        $mapped = array_merge($mapped, $this->deriveWorkflowState($old));

        // assigned_to
        $wfState = $mapped['workflow_state'] ?? 'RECEIVED';
        if (in_array($wfState, ['QUEUED_DRAW', 'IN_DRAW', 'SUBMITTED_DRAW'])) {
            $mapped['assigned_to'] = $mapped['drawer_id'] ?? null;
        } elseif (in_array($wfState, ['QUEUED_CHECK', 'IN_CHECK', 'SUBMITTED_CHECK'])) {
            $mapped['assigned_to'] = $mapped['checker_id'] ?? null;
        } elseif (in_array($wfState, ['QUEUED_QA', 'IN_QA'])) {
            $mapped['assigned_to'] = $mapped['qa_id'] ?? null;
        }

        $mapped['project_type'] = 'Metro';
        $mapped['updated_at'] = now();

        return $mapped;
    }

    /**
     * Derive workflow_state from old system flags.
     */
    private function deriveWorkflowState(object $old): array
    {
        $drawerDone = trim($old->drawer_done ?? '');
        $checkerDone = trim($old->checker_done ?? '');
        $finalUpload = trim($old->final_upload ?? '');
        $status = trim($old->status ?? '');
        $dname = trim($old->dname ?? '');
        $cname = trim($old->cname ?? '');
        $reason = trim($old->reason ?? '');

        if ($drawerDone === 'yes' && $checkerDone === 'yes' && $finalUpload === 'yes') {
            return ['status' => 'completed', 'workflow_state' => 'DELIVERED', 'current_layer' => 'qa'];
        }
        if ($drawerDone === 'yes' && $checkerDone === 'yes') {
            return ['status' => 'pending', 'workflow_state' => 'QUEUED_QA', 'current_layer' => 'qa'];
        }
        if ($drawerDone === 'yes') {
            if ($cname) {
                return ['status' => 'in-progress', 'workflow_state' => 'IN_CHECK', 'current_layer' => 'checker'];
            }
            return ['status' => 'pending', 'workflow_state' => 'QUEUED_CHECK', 'current_layer' => 'checker'];
        }
        if ($status === 'pending' && $reason) {
            return ['status' => 'pending', 'workflow_state' => 'REJECTED_BY_CHECK', 'current_layer' => 'drawer'];
        }
        if ($dname) {
            return ['status' => 'in-progress', 'workflow_state' => 'IN_DRAW', 'current_layer' => 'drawer'];
        }
        return ['status' => 'pending', 'workflow_state' => 'RECEIVED', 'current_layer' => 'drawer'];
    }

    /**
     * Check if the mapped data is actually different from existing record.
     */
    private function hasChanges(object $existing, array $mapped): bool
    {
        $checkFields = [
            'drawer_name', 'checker_name', 'drawer_done', 'checker_done',
            'final_upload', 'dassign_time', 'cassign_time', 'drawer_date',
            'checker_date', 'status', 'workflow_state', 'address',
            'mistake', 'cmistake', 'qa_name', 'ausFinaldate',
        ];

        foreach ($checkFields as $field) {
            $newVal = $mapped[$field] ?? '';
            $oldVal = $existing->$field ?? '';
            if (trim((string) $newVal) !== trim((string) $oldVal)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Resolve worker name → new system user ID.
     */
    private function resolveWorkerId(string $name, string $role): ?int
    {
        static $cache = [];
        $key = strtolower($name) . '|' . $role;

        if (isset($cache[$key])) return $cache[$key];
        if (empty($name)) return null;

        $user = DB::table('users')
            ->whereRaw('LOWER(name) = ?', [strtolower($name)])
            ->where('email', 'like', '%@benchmark-metro.internal')
            ->first(['id']);

        $cache[$key] = $user?->id;
        return $cache[$key];
    }

    private function cleanTimestamp(?string $val): ?string
    {
        if (!$val || trim($val) === '' || trim($val) === '0000-00-00 00:00:00') return null;
        return $val;
    }

    private function parseDate(?string $dateStr): ?string
    {
        if (!$dateStr || trim($dateStr) === '') return null;
        $dateStr = ltrim(trim($dateStr), '.');
        if (str_starts_with($dateStr, '1970')) return null;
        try {
            return Carbon::parse($dateStr)->toDateTimeString();
        } catch (\Exception $e) {
            return null;
        }
    }
}
