<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Carbon\Carbon;

/**
 * Migrate Metro FP data from the old system to the new Benchmark system.
 *
 * Expects the old Metro database to be imported as `sheetbenchmark_transdat_aus_metro`
 * on the same MySQL server. Run:
 *   mysql -u root -p -e "CREATE DATABASE sheetbenchmark_transdat_aus_metro;"
 *   mysql -u root -p sheetbenchmark_transdat_aus_metro < /path/to/dump.sql
 *
 * Then execute:
 *   php artisan migrate:metro --dry-run        (preview only)
 *   php artisan migrate:metro                  (execute migration)
 *   php artisan migrate:metro --rollback       (undo migration)
 */
class MigrateMetroData extends Command
{
    protected $signature = 'migrate:metro
        {--dry-run : Preview what would be migrated without making changes}
        {--rollback : Undo the migration (delete migrated data)}
        {--skip-workers : Skip worker creation, only import orders}
        {--skip-orders : Skip order import, only create workers}
        {--batch-size=500 : Number of orders to insert per batch}
        {--start-id=0 : Start from this old order ID (for resuming)}';

    protected $description = 'Migrate Metro FP data from the old system database';

    // ── Constants ──────────────────────────────────────────────────────
    private const TARGET_PROJECT_ID = 13;       // Metro FP in new system
    private const OLD_DB = 'stellarinstitute_metro_old';
    private const DEFAULT_PASSWORD = 'Benchmark@123';
    private const IMPORT_SOURCE = 'csv';        // Mark migrated orders
    private const MIGRATION_TAG = 'metro_migration_v1';

    // Old team_id → New team mapping (will be resolved at runtime)
    private array $teamMap = [];
    // Old worker name → New user ID mapping
    private array $drawerNameToId = [];
    private array $checkerNameToId = [];
    private array $qaNameToId = [];

    // Stats
    private array $stats = [
        'teams_created' => 0,
        'drawers_created' => 0,
        'checkers_created' => 0,
        'qa_created' => 0,
        'orders_migrated' => 0,
        'orders_skipped' => 0,
        'errors' => [],
    ];

    public function handle(): int
    {
        $this->info('╔══════════════════════════════════════════════════════════╗');
        $this->info('║       METRO FP DATA MIGRATION                          ║');
        $this->info('║       Old System → New Benchmark System                 ║');
        $this->info('╚══════════════════════════════════════════════════════════╝');
        $this->newLine();

        $dryRun = $this->option('dry-run');
        $rollback = $this->option('rollback');

        if ($dryRun) {
            $this->warn('🏜️  DRY RUN MODE — No changes will be made');
            $this->newLine();
        }

        if ($rollback) {
            return $this->rollbackMigration();
        }

        // ── Step 0: Verify prerequisites ──────────────────────────────
        if (!$this->verifyPrerequisites()) {
            return Command::FAILURE;
        }

        // ── Step 1: Create teams ──────────────────────────────────────
        if (!$this->option('skip-workers')) {
            $this->createTeams($dryRun);
            $this->newLine();

            // ── Step 2: Create worker users ───────────────────────────
            $this->createWorkers($dryRun);
            $this->newLine();
        } else {
            $this->info('⏭️  Skipping worker creation (--skip-workers)');
            $this->loadExistingWorkerMappings();
        }

        // ── Step 3: Import orders ─────────────────────────────────────
        if (!$this->option('skip-orders')) {
            $this->importOrders($dryRun);
            $this->newLine();
        } else {
            $this->info('⏭️  Skipping order import (--skip-orders)');
        }

        // ── Summary ───────────────────────────────────────────────────
        $this->printSummary();

        return Command::SUCCESS;
    }

    /**
     * Verify the old database is accessible and the target table exists.
     */
    private function verifyPrerequisites(): bool
    {
        $this->info('📋 Verifying prerequisites...');

        // Check old database exists
        try {
            $tables = DB::select("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [self::OLD_DB]);
            $tableNames = array_map(fn($t) => $t->TABLE_NAME, $tables);
            $this->info("  ✅ Old database '" . self::OLD_DB . "' accessible (" . count($tables) . " tables)");

            $required = ['order', 'drawer', 'checker', 'supervisor', 'metro_teams'];
            $missing = array_diff($required, $tableNames);
            if (!empty($missing)) {
                $this->error("  ❌ Missing required tables: " . implode(', ', $missing));
                return false;
            }
        } catch (\Exception $e) {
            $this->error("  ❌ Cannot access old database '" . self::OLD_DB . "': " . $e->getMessage());
            $this->warn("  💡 Import it first: mysql -u USER -p -e 'CREATE DATABASE " . self::OLD_DB . "' && mysql -u USER -p " . self::OLD_DB . " < dump.sql");
            return false;
        }

        // Check target project exists
        $project = DB::table('projects')->where('id', self::TARGET_PROJECT_ID)->first();
        if (!$project) {
            $this->error("  ❌ Project ID " . self::TARGET_PROJECT_ID . " not found");
            return false;
        }
        $this->info("  ✅ Target project: {$project->name} (ID={$project->id})");

        // Check target order table exists
        $orderTable = "project_" . self::TARGET_PROJECT_ID . "_orders";
        if (!Schema::hasTable($orderTable)) {
            $this->error("  ❌ Table '{$orderTable}' does not exist");
            return false;
        }

        $existingCount = DB::table($orderTable)->count();
        $this->info("  ✅ Table '{$orderTable}' exists ({$existingCount} existing orders)");

        if ($existingCount > 0 && !$this->option('dry-run')) {
            if (!$this->confirm("  ⚠️  Table already has {$existingCount} orders. Continue and ADD to them?")) {
                return false;
            }
        }

        // Count old data
        $oldOrderCount = DB::select("SELECT COUNT(*) as cnt FROM " . self::OLD_DB . ".`order`")[0]->cnt;
        $oldDrawerCount = DB::select("SELECT COUNT(*) as cnt FROM " . self::OLD_DB . ".drawer")[0]->cnt;
        $oldCheckerCount = DB::select("SELECT COUNT(*) as cnt FROM " . self::OLD_DB . ".checker")[0]->cnt;
        $oldTeamCount = DB::select("SELECT COUNT(*) as cnt FROM " . self::OLD_DB . ".metro_teams")[0]->cnt;

        $this->info("  📊 Old system data:");
        $this->info("     Orders: {$oldOrderCount}");
        $this->info("     Drawers: {$oldDrawerCount}");
        $this->info("     Checkers: {$oldCheckerCount}");
        $this->info("     Teams: {$oldTeamCount}");

        return true;
    }

    /**
     * Create teams in the new system mapped from old metro_teams.
     */
    private function createTeams(bool $dryRun): void
    {
        $this->info('👥 Creating teams...');

        $oldTeams = DB::select("SELECT * FROM " . self::OLD_DB . ".metro_teams ORDER BY team_id");

        foreach ($oldTeams as $oldTeam) {
            $teamName = trim($oldTeam->team);
            if (empty($teamName)) continue;

            // Check if team already exists for this project
            $existing = DB::table('teams')
                ->where('project_id', self::TARGET_PROJECT_ID)
                ->where('name', $teamName)
                ->first();

            if ($existing) {
                $this->teamMap[$oldTeam->team_id] = $existing->id;
                $this->info("  ⏭️  Team '{$teamName}' already exists (ID={$existing->id})");
                continue;
            }

            if ($dryRun) {
                $this->info("  [DRY] Would create team: '{$teamName}' (old_id={$oldTeam->team_id})");
                $this->teamMap[$oldTeam->team_id] = -1; // placeholder
                $this->stats['teams_created']++;
                continue;
            }

            $newTeamId = DB::table('teams')->insertGetId([
                'project_id' => self::TARGET_PROJECT_ID,
                'name' => $teamName,
                'is_active' => (bool) $oldTeam->is_active,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $this->teamMap[$oldTeam->team_id] = $newTeamId;
            $this->stats['teams_created']++;
            $this->info("  ✅ Created team '{$teamName}' (old_id={$oldTeam->team_id} → new_id={$newTeamId})");
        }

        // Map team_id=0 (Others/unassigned) to the default Metro FP Team (id=13)
        if (!isset($this->teamMap[0])) {
            $defaultTeam = DB::table('teams')
                ->where('project_id', self::TARGET_PROJECT_ID)
                ->first();
            if ($defaultTeam) {
                $this->teamMap[0] = $defaultTeam->id;
                $this->info("  ℹ️  team_id=0 (Others) → existing default team ID={$defaultTeam->id}");
            }
        }
    }

    /**
     * Create drawer, checker, and QA worker users.
     */
    private function createWorkers(bool $dryRun): void
    {
        $this->info('🔧 Creating worker users...');
        $hashedPassword = Hash::make(self::DEFAULT_PASSWORD);

        // ── Drawers ──────────────────────────────────────────────────
        $this->info('  📐 Drawers:');
        $drawers = DB::select("SELECT * FROM " . self::OLD_DB . ".drawer ORDER BY d_id");

        foreach ($drawers as $drawer) {
            $name = trim($drawer->dname);
            if (empty($name)) continue;

            $email = $this->generateEmail($name, $drawer->dusername, 'drawer');

            $existing = DB::table('users')->where('email', $email)->first();
            if ($existing) {
                $this->drawerNameToId[$name] = $existing->id;
                // Also map common variations
                $this->drawerNameToId[strtolower($name)] = $existing->id;
                continue;
            }

            $teamId = $this->teamMap[$drawer->team_id] ?? ($this->teamMap[0] ?? null);

            if ($dryRun) {
                $this->stats['drawers_created']++;
                $this->drawerNameToId[$name] = -1;
                continue;
            }

            $userId = DB::table('users')->insertGetId([
                'name' => $name,
                'email' => $email,
                'password' => $hashedPassword,
                'role' => 'drawer',
                'layer' => 'drawer',
                'project_id' => self::TARGET_PROJECT_ID,
                'team_id' => $teamId,
                'is_active' => $drawer->dstatus === 'yes',
                'country' => 'Australia',
                'department' => 'floor_plan',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $this->drawerNameToId[$name] = $userId;
            $this->drawerNameToId[strtolower($name)] = $userId;
            $this->stats['drawers_created']++;
        }
        $this->info("    Created {$this->stats['drawers_created']} drawers");

        // ── Checkers ─────────────────────────────────────────────────
        $this->info('  ✅ Checkers:');
        $checkers = DB::select("SELECT * FROM " . self::OLD_DB . ".checker ORDER BY c_id");

        foreach ($checkers as $checker) {
            $name = trim($checker->cname);
            if (empty($name)) continue;

            $email = $this->generateEmail($name, $checker->cusername, 'checker');

            $existing = DB::table('users')->where('email', $email)->first();
            if ($existing) {
                $this->checkerNameToId[$name] = $existing->id;
                $this->checkerNameToId[strtolower($name)] = $existing->id;
                continue;
            }

            $teamId = $this->teamMap[$checker->team_id] ?? ($this->teamMap[0] ?? null);

            if ($dryRun) {
                $this->stats['checkers_created']++;
                $this->checkerNameToId[$name] = -1;
                continue;
            }

            $userId = DB::table('users')->insertGetId([
                'name' => $name,
                'email' => $email,
                'password' => $hashedPassword,
                'role' => 'checker',
                'layer' => 'checker',
                'project_id' => self::TARGET_PROJECT_ID,
                'team_id' => $teamId,
                'is_active' => $checker->cstatus === 'yes',
                'country' => 'Australia',
                'department' => 'floor_plan',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $this->checkerNameToId[$name] = $userId;
            $this->checkerNameToId[strtolower($name)] = $userId;
            $this->stats['checkers_created']++;
        }
        $this->info("    Created {$this->stats['checkers_created']} checkers");

        // ── QA Workers (extract from unique qa_person names in orders) ──
        $this->info('  🔍 QA Workers:');
        $qaNames = DB::select("SELECT DISTINCT TRIM(qa_person) as name FROM " . self::OLD_DB . ".`order` WHERE qa_person IS NOT NULL AND TRIM(qa_person) != '' AND TRIM(qa_person) != ' '");

        // Normalize QA names (same person, different casing)
        $normalizedQa = [];
        foreach ($qaNames as $qa) {
            $name = trim($qa->name);
            if (empty($name) || strlen($name) <= 1) continue;
            $key = strtolower(preg_replace('/\s+/', ' ', $name));
            if (!isset($normalizedQa[$key])) {
                $normalizedQa[$key] = $name; // keep first occurrence as canonical
            }
        }

        foreach ($normalizedQa as $key => $name) {
            $email = $this->generateEmail($name, null, 'qa');

            // Check if already created as drawer or checker
            $existing = DB::table('users')->where('email', $email)->first();
            if ($existing) {
                $this->qaNameToId[$name] = $existing->id;
                $this->qaNameToId[$key] = $existing->id;
                continue;
            }

            if ($dryRun) {
                $this->stats['qa_created']++;
                $this->qaNameToId[$name] = -1;
                $this->qaNameToId[$key] = -1;
                continue;
            }

            $userId = DB::table('users')->insertGetId([
                'name' => $name,
                'email' => $email,
                'password' => Hash::make(self::DEFAULT_PASSWORD),
                'role' => 'qa',
                'layer' => 'qa',
                'project_id' => self::TARGET_PROJECT_ID,
                'team_id' => $this->teamMap[0] ?? null,
                'is_active' => true,
                'country' => 'Australia',
                'department' => 'floor_plan',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $this->qaNameToId[$name] = $userId;
            $this->qaNameToId[$key] = $userId;
            $this->stats['qa_created']++;
        }
        $this->info("    Created {$this->stats['qa_created']} QA workers");

        // Build cross-reference maps for name variations in orders
        $this->buildNameCrossReference();
    }

    /**
     * Import orders from the old system.
     */
    private function importOrders(bool $dryRun): void
    {
        $this->info('📦 Importing orders...');

        $orderTable = "project_" . self::TARGET_PROJECT_ID . "_orders";
        $batchSize = (int) $this->option('batch-size');
        $startId = (int) $this->option('start-id');

        // Get total count for progress
        $totalCount = DB::select("SELECT COUNT(*) as cnt FROM " . self::OLD_DB . ".`order` WHERE id >= ?", [$startId])[0]->cnt;
        $this->info("  📊 Total orders to process: {$totalCount} (starting from ID {$startId})");

        $bar = $this->output->createProgressBar($totalCount);
        $bar->start();

        $offset = 0;
        $insertBatch = [];
        $orderNumberTracker = []; // Prevent duplicate order_numbers

        while (true) {
            $orders = DB::select(
                "SELECT * FROM " . self::OLD_DB . ".`order` WHERE id >= ? ORDER BY id ASC LIMIT ? OFFSET ?",
                [$startId, $batchSize, $offset]
            );

            if (empty($orders)) break;

            foreach ($orders as $old) {
                $bar->advance();

                try {
                    $mapped = $this->mapOrder($old, $orderNumberTracker);
                    if ($mapped === null) {
                        $this->stats['orders_skipped']++;
                        continue;
                    }

                    $insertBatch[] = $mapped;
                    $orderNumberTracker[$mapped['order_number']] = true;

                    if (count($insertBatch) >= $batchSize) {
                        if (!$dryRun) {
                            DB::table($orderTable)->insert($insertBatch);
                        }
                        $this->stats['orders_migrated'] += count($insertBatch);
                        $insertBatch = [];
                    }
                } catch (\Exception $e) {
                    $this->stats['errors'][] = "Order ID {$old->id}: " . $e->getMessage();
                    $this->stats['orders_skipped']++;
                }
            }

            $offset += $batchSize;
        }

        // Flush remaining batch
        if (!empty($insertBatch)) {
            if (!$dryRun) {
                DB::table($orderTable)->insert($insertBatch);
            }
            $this->stats['orders_migrated'] += count($insertBatch);
        }

        $bar->finish();
        $this->newLine();
        $this->info("  ✅ Imported {$this->stats['orders_migrated']} orders, skipped {$this->stats['orders_skipped']}");

        // Update project counters
        if (!$dryRun) {
            $this->updateProjectCounters();
        }
    }

    /**
     * Map a single old order row to the new schema.
     */
    private function mapOrder(object $old, array &$orderNumberTracker): ?array
    {
        // ── Order Number (must be unique) ─────────────────────────────
        // Format: METRO-{old_id}
        $orderNumber = 'METRO-' . $old->id;
        if (isset($orderNumberTracker[$orderNumber])) {
            $orderNumber = 'METRO-' . $old->id . '-' . Str::random(4);
        }

        // ── Client Portal ID ──────────────────────────────────────────
        // Old: '#172992_225439' → extract '#172992'
        $clientPortalId = $old->order_id;
        if ($clientPortalId && str_contains($clientPortalId, '_')) {
            $clientPortalId = explode('_', $clientPortalId)[0];
        }

        // ── Priority ──────────────────────────────────────────────────
        // Old client_name is actually priority: 'Regular' → 'normal', 'High'/'HIGH' → 'high'
        $priority = 'normal';
        $clientName = trim($old->client_name ?? '');
        if (strtolower($clientName) === 'high') {
            $priority = 'high';
        } elseif (strtolower($clientName) === 'urgent') {
            $priority = 'urgent';
        }

        // ── Address ───────────────────────────────────────────────────
        $address = trim($old->property ?? '');

        // ── Dates ─────────────────────────────────────────────────────
        $receivedAt = $this->parseOldDate($old->ausDatein);
        $completedAt = null;
        $deliveredAt = null;
        $startedAt = $this->parseOldDate($old->dassign_time);

        if ($old->checker_done === 'yes' && $old->checker_date) {
            $completedAt = $this->parseOldDate($old->checker_date);
        }
        if ($old->final_upload === 'yes' && $completedAt) {
            $deliveredAt = $completedAt;
        }

        // ── Status & Workflow State ───────────────────────────────────
        [$status, $workflowState, $currentLayer] = $this->mapStatus($old);

        // ── Worker Assignment ─────────────────────────────────────────
        $assignedTo = null;
        $qaSupervisorId = null;

        $dname = trim($old->dname ?? '');
        $cname = trim($old->cname ?? '');
        $qaName = trim($old->qa_person ?? '');

        // Determine current assigned worker based on workflow state
        if (in_array($workflowState, ['QUEUED_DRAW', 'IN_DRAW', 'SUBMITTED_DRAW'])) {
            $assignedTo = $this->resolveWorkerId($dname, 'drawer');
        } elseif (in_array($workflowState, ['QUEUED_CHECK', 'IN_CHECK', 'SUBMITTED_CHECK'])) {
            $assignedTo = $this->resolveWorkerId($cname, 'checker');
        } elseif (in_array($workflowState, ['QUEUED_QA', 'IN_QA'])) {
            $assignedTo = $this->resolveWorkerId($qaName, 'qa');
        }

        if ($qaName) {
            $qaSupervisorId = $this->resolveWorkerId($qaName, 'qa');
        }

        // ── Metadata (preserve all old data) ──────────────────────────
        $metadata = [
            '_migration' => self::MIGRATION_TAG,
            '_old_id' => $old->id,
            '_old_order_id' => $old->order_id,
            '_old_date' => $old->date,
            '_old_dname' => $dname,
            '_old_cname' => $cname,
            '_old_qa_person' => $qaName,
            '_old_drawer_done' => $old->drawer_done,
            '_old_checker_done' => $old->checker_done,
            '_old_final_upload' => $old->final_upload,
            '_old_status' => $old->status,
            '_old_mistake' => $old->mistake ?? null,
            '_old_cmistake' => $old->cmistake ?? null,
            '_old_reason' => $old->reason ?? null,
            '_old_d_live_qa' => $old->d_live_qa ?? 0,
            '_old_c_live_qa' => $old->c_live_qa ?? 0,
            '_old_qa_live_qa' => $old->qa_live_qa ?? 0,
        ];

        // ── Year/Month from old data ──────────────────────────────────
        $year = $old->year ? (int) $old->year : null;
        $month = $old->month ? (int) $old->month : null;

        // ── Rejection info ────────────────────────────────────────────
        $rejectionReason = null;
        if ($old->mistake) $rejectionReason = $old->mistake;
        if ($old->cmistake) $rejectionReason = ($rejectionReason ? $rejectionReason . ' | ' : '') . $old->cmistake;

        return [
            'order_number' => $orderNumber,
            'project_id' => self::TARGET_PROJECT_ID,
            'client_reference' => $old->order_id,
            'address' => $address ?: null,
            'client_name' => null,
            'current_layer' => $currentLayer,
            'status' => $status,
            'workflow_state' => $workflowState,
            'workflow_type' => 'FP_3_LAYER',
            'assigned_to' => $assignedTo,
            'qa_supervisor_id' => $qaSupervisorId,
            'team_id' => null,
            'priority' => $priority,
            'complexity_weight' => 1,
            'estimated_minutes' => null,
            'order_type' => 'standard',
            'received_at' => $receivedAt,
            'due_date' => null,
            'started_at' => $startedAt,
            'completed_at' => $completedAt,
            'delivered_at' => $deliveredAt,
            'year' => $year,
            'month' => $month,
            'date' => $old->date,
            'ausDatein' => $receivedAt,
            'code' => $old->code ?: null,
            'plan_type' => $old->plan_type ?: null,
            'instruction' => $old->instruction ?: null,
            'project_type' => 'Metro',
            'due_in' => null,
            'metadata' => json_encode($metadata),
            'supervisor_notes' => $rejectionReason,
            'attachments' => null,
            'import_source' => self::IMPORT_SOURCE,
            'import_log_id' => null,
            'recheck_count' => 0,
            'attempt_draw' => $old->drawer_done === 'yes' ? 1 : ($dname ? 1 : 0),
            'attempt_check' => $old->checker_done === 'yes' ? 1 : ($cname ? 1 : 0),
            'attempt_qa' => $old->final_upload === 'yes' ? 1 : 0,
            'rejected_by' => null,
            'rejected_at' => null,
            'rejection_reason' => $rejectionReason,
            'rejection_type' => $old->reason ?: null,
            'checker_self_corrected' => false,
            'client_portal_id' => $clientPortalId,
            'client_portal_synced_at' => null,
            'is_on_hold' => false,
            'hold_reason' => null,
            'hold_set_by' => null,
            'pre_hold_state' => null,
            'created_at' => $old->date_time ?? now(),
            'updated_at' => now(),
        ];
    }

    /**
     * Map old status fields to new status, workflow_state, and current_layer.
     *
     * Old system status logic:
     *   drawer_done=NULL/'' + dname='' → Not started (RECEIVED)
     *   drawer_done=NULL/'' + dname set → Drawing in progress (IN_DRAW)
     *   drawer_done='yes' + checker_done=NULL/'' → Drawer done (QUEUED_CHECK)
     *   drawer_done='yes' + checker_done='yes' + final_upload=NULL → QA pending (QUEUED_QA)
     *   drawer_done='yes' + checker_done='yes' + final_upload='yes' → Complete (DELIVERED)
     *   status='pending' + reason set → Rejected/rework pending
     */
    private function mapStatus(object $old): array
    {
        $drawerDone = trim($old->drawer_done ?? '');
        $checkerDone = trim($old->checker_done ?? '');
        $finalUpload = trim($old->final_upload ?? '');
        $statusField = trim($old->status ?? '');
        $dname = trim($old->dname ?? '');
        $cname = trim($old->cname ?? '');
        $reason = trim($old->reason ?? '');

        // Case 1: Fully delivered
        if ($drawerDone === 'yes' && $checkerDone === 'yes' && $finalUpload === 'yes') {
            return ['completed', 'DELIVERED', 'qa'];
        }

        // Case 2: Checker done, awaiting QA/final upload
        if ($drawerDone === 'yes' && $checkerDone === 'yes') {
            return ['pending', 'QUEUED_QA', 'qa'];
        }

        // Case 3: Drawer done, awaiting checker
        if ($drawerDone === 'yes' && $checkerDone !== 'yes') {
            if ($cname) {
                return ['in-progress', 'IN_CHECK', 'checker'];
            }
            return ['pending', 'QUEUED_CHECK', 'checker'];
        }

        // Case 4: Pending with reason = rejection
        if ($statusField === 'pending' && $reason) {
            return ['pending', 'REJECTED_BY_CHECK', 'drawer'];
        }

        // Case 5: Drawer assigned but not done
        if ($dname && $drawerDone !== 'yes') {
            return ['in-progress', 'IN_DRAW', 'drawer'];
        }

        // Case 6: Not started
        return ['pending', 'RECEIVED', 'drawer'];
    }

    /**
     * Parse various old date formats into a proper timestamp string.
     */
    private function parseOldDate(?string $dateStr): ?string
    {
        if (!$dateStr || trim($dateStr) === '' || $dateStr === '0000-00-00 00:00:00') {
            return null;
        }

        $dateStr = trim($dateStr);

        // Remove leading dots
        $dateStr = ltrim($dateStr, '.');

        // Skip epoch dates
        if (str_starts_with($dateStr, '1970/01/01') || str_starts_with($dateStr, '1970-01-01')) {
            return null;
        }

        try {
            // Try standard formats
            foreach ([
                'Y/m/d H:i:s',
                'Y-m-d H:i:s',
                'd-M-y',
                'd-M-Y',
                'd-m-Y',
                'd-m.Y',
                'D d M y (h:i a)',    // "Tue 31 Dec 24 (10:01 pm)"
                'D d M y (H:i)',
                'Y/m/d',
                'Y-m-d',
            ] as $format) {
                try {
                    $parsed = Carbon::createFromFormat($format, $dateStr);
                    if ($parsed && $parsed->year >= 2020 && $parsed->year <= 2030) {
                        return $parsed->toDateTimeString();
                    }
                } catch (\Exception $e) {
                    continue;
                }
            }

            // Last resort: Carbon's fuzzy parser
            $parsed = Carbon::parse($dateStr);
            if ($parsed->year >= 2020 && $parsed->year <= 2030) {
                return $parsed->toDateTimeString();
            }
        } catch (\Exception $e) {
            // Unparseable date — return null
        }

        return null;
    }

    /**
     * Resolve a worker name to a user ID using the name mapping tables.
     */
    private function resolveWorkerId(string $name, string $type): ?int
    {
        if (empty($name)) return null;

        $map = match ($type) {
            'drawer' => $this->drawerNameToId,
            'checker' => $this->checkerNameToId,
            'qa' => $this->qaNameToId,
            default => [],
        };

        // Exact match
        if (isset($map[$name]) && $map[$name] > 0) return $map[$name];

        // Case-insensitive match
        $lower = strtolower(trim($name));
        if (isset($map[$lower]) && $map[$lower] > 0) return $map[$lower];

        // Try all maps (worker might be in drawer table but checking orders)
        foreach ([$this->drawerNameToId, $this->checkerNameToId, $this->qaNameToId] as $fallbackMap) {
            if (isset($fallbackMap[$name]) && $fallbackMap[$name] > 0) return $fallbackMap[$name];
            if (isset($fallbackMap[$lower]) && $fallbackMap[$lower] > 0) return $fallbackMap[$lower];
        }

        // Fuzzy match: try without dots, spaces
        $normalized = strtolower(preg_replace('/[\s.]+/', '', $name));
        foreach ([$this->drawerNameToId, $this->checkerNameToId, $this->qaNameToId] as $fallbackMap) {
            foreach ($fallbackMap as $mapName => $userId) {
                if ($userId <= 0) continue;
                $mapNorm = strtolower(preg_replace('/[\s.]+/', '', $mapName));
                if ($mapNorm === $normalized) return $userId;
            }
        }

        return null;
    }

    /**
     * Generate a unique email for a worker.
     */
    private function generateEmail(string $name, ?string $username, string $role): string
    {
        // Clean the name to create an email-safe slug
        $slug = $username ? trim($username) : $name;
        $slug = strtolower(preg_replace('/[^a-zA-Z0-9.]+/', '.', trim($slug)));
        $slug = trim($slug, '.');

        if (empty($slug)) {
            $slug = 'worker.' . Str::random(6);
        }

        $email = "{$slug}.{$role}@benchmark-metro.internal";

        // Ensure uniqueness
        $counter = 1;
        $baseEmail = $email;
        while (DB::table('users')->where('email', $email)->exists()) {
            $email = str_replace("@benchmark-metro.internal", ".{$counter}@benchmark-metro.internal", $baseEmail);
            $counter++;
        }

        return $email;
    }

    /**
     * Build cross-reference maps for name variations found in order data.
     * Workers may appear under slightly different names.
     */
    private function buildNameCrossReference(): void
    {
        // Load all users we just created for Metro FP
        $workers = DB::table('users')
            ->where('project_id', self::TARGET_PROJECT_ID)
            ->whereIn('role', ['drawer', 'checker', 'qa'])
            ->get(['id', 'name', 'role']);

        foreach ($workers as $w) {
            $name = $w->name;
            $lower = strtolower($name);

            if ($w->role === 'drawer') {
                $this->drawerNameToId[$name] = $w->id;
                $this->drawerNameToId[$lower] = $w->id;
            }
            if ($w->role === 'checker') {
                $this->checkerNameToId[$name] = $w->id;
                $this->checkerNameToId[$lower] = $w->id;
            }
            if ($w->role === 'qa') {
                $this->qaNameToId[$name] = $w->id;
                $this->qaNameToId[$lower] = $w->id;
            }
        }
    }

    /**
     * Load existing worker name-to-ID mappings (when --skip-workers is used).
     */
    private function loadExistingWorkerMappings(): void
    {
        $this->info('📖 Loading existing worker mappings...');

        // Load teams
        $teams = DB::table('teams')
            ->where('project_id', self::TARGET_PROJECT_ID)
            ->get();
        foreach ($teams as $team) {
            // Map by name similarity
            $this->teamMap[0] = $team->id; // default
        }

        // Load all workers
        $this->buildNameCrossReference();

        $totalWorkers = count($this->drawerNameToId) + count($this->checkerNameToId) + count($this->qaNameToId);
        $this->info("  Loaded {$totalWorkers} worker name mappings");
    }

    /**
     * Update project order counters after import.
     */
    private function updateProjectCounters(): void
    {
        $orderTable = "project_" . self::TARGET_PROJECT_ID . "_orders";

        $total = DB::table($orderTable)->count();
        $completed = DB::table($orderTable)->where('workflow_state', 'DELIVERED')->count();
        $pending = DB::table($orderTable)->whereNotIn('workflow_state', ['DELIVERED', 'CANCELLED'])->count();

        DB::table('projects')->where('id', self::TARGET_PROJECT_ID)->update([
            'total_orders' => $total,
            'completed_orders' => $completed,
            'pending_orders' => $pending,
            'updated_at' => now(),
        ]);

        $this->info("  📊 Updated project counters: total={$total}, completed={$completed}, pending={$pending}");
    }

    /**
     * Rollback the migration — delete all migrated data.
     */
    private function rollbackMigration(): int
    {
        $this->warn('⚠️  ROLLBACK MODE — This will delete all migrated data!');

        if (!$this->confirm('Are you sure you want to rollback?')) {
            return Command::SUCCESS;
        }

        $orderTable = "project_" . self::TARGET_PROJECT_ID . "_orders";

        // Delete migrated orders (those with our migration tag in metadata)
        $deletedOrders = DB::table($orderTable)
            ->where('import_source', self::IMPORT_SOURCE)
            ->whereRaw("JSON_EXTRACT(metadata, '$._migration') = ?", ['"' . self::MIGRATION_TAG . '"'])
            ->delete();
        $this->info("  🗑️  Deleted {$deletedOrders} migrated orders");

        // Delete migrated workers (internal emails)
        $deletedWorkers = DB::table('users')
            ->where('email', 'like', '%@benchmark-metro.internal')
            ->delete();
        $this->info("  🗑️  Deleted {$deletedWorkers} migrated workers");

        // Delete teams created for migration (keep the original default team)
        $deletedTeams = DB::table('teams')
            ->where('project_id', self::TARGET_PROJECT_ID)
            ->where('id', '!=', 13) // keep the default Metro FP Team
            ->delete();
        $this->info("  🗑️  Deleted {$deletedTeams} migrated teams");

        // Reset project counters
        $this->updateProjectCounters();

        $this->info('✅ Rollback complete');
        return Command::SUCCESS;
    }

    /**
     * Print final migration summary.
     */
    private function printSummary(): void
    {
        $this->newLine();
        $this->info('╔══════════════════════════════════════════════════════════╗');
        $this->info('║       MIGRATION SUMMARY                                ║');
        $this->info('╚══════════════════════════════════════════════════════════╝');
        $this->table(
            ['Metric', 'Count'],
            [
                ['Teams Created', $this->stats['teams_created']],
                ['Drawers Created', $this->stats['drawers_created']],
                ['Checkers Created', $this->stats['checkers_created']],
                ['QA Workers Created', $this->stats['qa_created']],
                ['Orders Migrated', $this->stats['orders_migrated']],
                ['Orders Skipped', $this->stats['orders_skipped']],
                ['Errors', count($this->stats['errors'])],
            ]
        );

        if (!empty($this->stats['errors'])) {
            $this->newLine();
            $this->warn('⚠️  Errors (first 20):');
            foreach (array_slice($this->stats['errors'], 0, 20) as $err) {
                $this->error("  • {$err}");
            }
        }
    }
}
