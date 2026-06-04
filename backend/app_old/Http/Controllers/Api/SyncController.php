<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * SyncController — Receives real-time order updates from the old Metro system.
 *
 * The old system sends a webhook on every order action (assign, done, etc.).
 * This controller mirrors that action into project_13_orders.
 *
 * Security: Uses a shared secret token (no user auth needed — machine-to-machine).
 */
class SyncController extends Controller
{
    private const SYNC_TOKEN = 'BM_SYNC_2026_x9K4mP7qR2vL';
    private const PROJECT_ID = 13;

    /**
     * POST /api/sync/order
     *
     * Receives a single order update from the old system.
     * Upserts into project_13_orders matching by old order ID.
     */
    public function syncOrder(Request $request)
    {
        // Validate sync token
        if ($request->header('X-Sync-Token') !== self::SYNC_TOKEN) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        $data = $request->all();

        if (empty($data['old_id'])) {
            return response()->json(['error' => 'old_id is required'], 400);
        }

        try {
            $table = 'project_' . self::PROJECT_ID . '_orders';
            $oldId = (int) $data['old_id'];

            // Find existing order by old_id in metadata
            $existing = DB::table($table)
                ->where('order_number', 'METRO-' . $oldId)
                ->first();

            // Map old fields to new schema
            $mapped = $this->mapFields($data);

            if ($existing) {
                // UPDATE existing order
                DB::table($table)
                    ->where('id', $existing->id)
                    ->update($mapped);

                // Re-apply CRM overlay (CRM assignments are authoritative over Metro)
                $this->reApplyCrmOverlay($table, $existing->order_number, self::PROJECT_ID);

                Log::channel('daily')->info("SYNC: Updated order METRO-{$oldId} (id={$existing->id})");

                return response()->json([
                    'success' => true,
                    'action' => 'updated',
                    'order_id' => $existing->id,
                    'order_number' => $existing->order_number,
                ]);
            } else {
                // INSERT new order
                $mapped['order_number'] = 'METRO-' . $oldId;
                $mapped['project_id'] = self::PROJECT_ID;
                $mapped['workflow_type'] = 'FP_3_LAYER';
                $mapped['import_source'] = 'api';
                $mapped['created_at'] = now();
                $mapped['updated_at'] = now();

                // Store full old data in metadata
                $mapped['metadata'] = json_encode([
                    '_migration' => 'live_sync',
                    '_old_id' => $oldId,
                    '_synced_at' => now()->toDateTimeString(),
                ]);

                $newId = DB::table($table)->insertGetId($mapped);

                Log::channel('daily')->info("SYNC: Inserted new order METRO-{$oldId} (new_id={$newId})");

                return response()->json([
                    'success' => true,
                    'action' => 'inserted',
                    'order_id' => $newId,
                    'order_number' => 'METRO-' . $oldId,
                ]);
            }
        } catch (\Exception $e) {
            Log::channel('daily')->error("SYNC ERROR: " . $e->getMessage(), [
                'old_id' => $data['old_id'] ?? null,
                'data' => $data,
            ]);

            return response()->json([
                'success' => false,
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * POST /api/sync/batch
     *
     * Receives multiple order updates at once (for cron-based sync).
     */
    public function syncBatch(Request $request)
    {
        if ($request->header('X-Sync-Token') !== self::SYNC_TOKEN) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        $orders = $request->input('orders', []);
        if (empty($orders)) {
            return response()->json(['error' => 'orders array is required'], 400);
        }

        $results = ['inserted' => 0, 'updated' => 0, 'errors' => 0];
        $table = 'project_' . self::PROJECT_ID . '_orders';

        foreach ($orders as $data) {
            try {
                if (empty($data['old_id'])) {
                    $results['errors']++;
                    continue;
                }

                $oldId = (int) $data['old_id'];
                $mapped = $this->mapFields($data);

                $existing = DB::table($table)
                    ->where('order_number', 'METRO-' . $oldId)
                    ->first();

                if ($existing) {
                    DB::table($table)->where('id', $existing->id)->update($mapped);
                    // Re-apply CRM overlay (CRM assignments are authoritative over Metro)
                    $this->reApplyCrmOverlay($table, $existing->order_number, self::PROJECT_ID);
                    $results['updated']++;
                } else {
                    $mapped['order_number'] = 'METRO-' . $oldId;
                    $mapped['project_id'] = self::PROJECT_ID;
                    $mapped['workflow_type'] = 'FP_3_LAYER';
                    $mapped['import_source'] = 'api';
                    $mapped['created_at'] = now();
                    $mapped['updated_at'] = now();
                    $mapped['metadata'] = json_encode([
                        '_migration' => 'live_sync',
                        '_old_id' => $oldId,
                        '_synced_at' => now()->toDateTimeString(),
                    ]);
                    DB::table($table)->insertGetId($mapped);
                    $results['inserted']++;
                }
            } catch (\Exception $e) {
                $results['errors']++;
                Log::channel('daily')->error("SYNC BATCH ERROR: " . $e->getMessage());
            }
        }

        Log::channel('daily')->info("SYNC BATCH: inserted={$results['inserted']}, updated={$results['updated']}, errors={$results['errors']}");

        return response()->json(['success' => true, 'results' => $results]);
    }

    /**
     * GET /api/sync/status
     *
     * Check sync health and stats.
     */
    public function status(Request $request)
    {
        if ($request->header('X-Sync-Token') !== self::SYNC_TOKEN) {
            return response()->json(['error' => 'Unauthorized'], 401);
        }

        $table = 'project_' . self::PROJECT_ID . '_orders';

        $total = DB::table($table)->count();
        $synced = DB::table($table)->where('import_source', 'api')->count();
        $migrated = DB::table($table)->where('import_source', 'csv')->count();
        $latest = DB::table($table)->orderByDesc('updated_at')->first(['order_number', 'updated_at']);

        return response()->json([
            'success' => true,
            'project_id' => self::PROJECT_ID,
            'total_orders' => $total,
            'migrated_orders' => $migrated,
            'live_synced_orders' => $synced,
            'latest_update' => $latest ? [
                'order' => $latest->order_number,
                'at' => $latest->updated_at,
            ] : null,
        ]);
    }

    /**
     * Re-apply CRM assignment overlay after Metro sync update.
     * CRM assignments (stored in crm_order_assignments) are authoritative
     * and must not be overwritten by Metro data.
     */
    private function reApplyCrmOverlay(string $table, string $orderNumber, int $projectId): void
    {
        $crm = DB::table('crm_order_assignments')
            ->where('project_id', $projectId)
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
     * Map incoming old system fields to new system columns.
     */
    private function mapFields(array $data): array
    {
        $mapped = [];

        // Client reference & address
        if (isset($data['order_id'])) {
            $mapped['client_reference'] = $data['order_id'];
            $clientPortalId = $data['order_id'];
            if (str_contains($clientPortalId, '_')) {
                $clientPortalId = explode('_', $clientPortalId)[0];
            }
            $mapped['client_portal_id'] = $clientPortalId;
        }

        if (isset($data['property'])) {
            $mapped['address'] = trim($data['property']);
        }

        // Priority (old client_name = priority)
        if (isset($data['client_name'])) {
            $cn = strtolower(trim($data['client_name']));
            $mapped['priority'] = match (true) {
                $cn === 'high' => 'high',
                $cn === 'urgent' => 'urgent',
                default => 'normal',
            };
        }

        // Worker names
        if (isset($data['dname'])) {
            $mapped['drawer_name'] = trim($data['dname']);
            $mapped['drawer_id'] = $this->resolveWorkerId(trim($data['dname']), 'drawer');
        }
        if (isset($data['cname'])) {
            $mapped['checker_name'] = trim($data['cname']);
            $mapped['checker_id'] = $this->resolveWorkerId(trim($data['cname']), 'checker');
        }
        if (isset($data['qa_person'])) {
            $mapped['qa_name'] = trim($data['qa_person']);
            $mapped['qa_id'] = $this->resolveWorkerId(trim($data['qa_person']), 'qa');
        }

        // Timestamps
        if (isset($data['dassign_time'])) $mapped['dassign_time'] = $data['dassign_time'];
        if (isset($data['cassign_time'])) $mapped['cassign_time'] = $data['cassign_time'];
        if (isset($data['drawer_date']))  $mapped['drawer_date'] = $data['drawer_date'];
        if (isset($data['checker_date'])) $mapped['checker_date'] = $data['checker_date'];
        if (isset($data['ausDatein']))    $mapped['ausDatein'] = $this->parseDate($data['ausDatein']);
        if (isset($data['ausFinaldate'])) $mapped['ausFinaldate'] = $data['ausFinaldate'];

        // Completion flags
        if (isset($data['drawer_done'])) $mapped['drawer_done'] = $data['drawer_done'];
        if (isset($data['checker_done'])) $mapped['checker_done'] = $data['checker_done'];
        if (isset($data['final_upload'])) $mapped['final_upload'] = $data['final_upload'];

        // Mistakes
        if (isset($data['mistake'])) $mapped['mistake'] = $data['mistake'];
        if (isset($data['cmistake'])) $mapped['cmistake'] = $data['cmistake'];
        if (isset($data['reason'])) $mapped['rejection_type'] = $data['reason'];

        // Legacy fields
        if (isset($data['code'])) $mapped['code'] = $data['code'];
        if (isset($data['plan_type'])) $mapped['plan_type'] = $data['plan_type'];
        if (isset($data['instruction'])) $mapped['instruction'] = $data['instruction'];
        if (isset($data['year'])) $mapped['year'] = (int) $data['year'];
        if (isset($data['month'])) $mapped['month'] = (int) $data['month'];
        if (isset($data['date'])) $mapped['date'] = $data['date'];
        if (isset($data['status'])) $mapped['rejection_type'] = $data['status'] === 'pending' ? ($data['reason'] ?? null) : null;
        if (isset($data['d_id'])) $mapped['d_id'] = (int) $data['d_id'];
        if (isset($data['amend'])) $mapped['amend'] = $data['amend'];
        if (isset($data['d_live_qa'])) $mapped['d_live_qa'] = (int) $data['d_live_qa'];
        if (isset($data['c_live_qa'])) $mapped['c_live_qa'] = (int) $data['c_live_qa'];
        if (isset($data['qa_live_qa'])) $mapped['qa_live_qa'] = (int) $data['qa_live_qa'];

        $mapped['project_type'] = 'Metro';

        // Derive workflow state from completion flags
        $mapped = array_merge($mapped, $this->deriveWorkflowState($data));

        // Determine current assigned_to
        $wfState = $mapped['workflow_state'] ?? 'RECEIVED';
        if (in_array($wfState, ['QUEUED_DRAW', 'IN_DRAW', 'SUBMITTED_DRAW'])) {
            $mapped['assigned_to'] = $mapped['drawer_id'] ?? null;
        } elseif (in_array($wfState, ['QUEUED_CHECK', 'IN_CHECK', 'SUBMITTED_CHECK'])) {
            $mapped['assigned_to'] = $mapped['checker_id'] ?? null;
        } elseif (in_array($wfState, ['QUEUED_QA', 'IN_QA'])) {
            $mapped['assigned_to'] = $mapped['qa_id'] ?? null;
        }

        if (isset($mapped['qa_id'])) {
            $mapped['qa_supervisor_id'] = $mapped['qa_id'];
        }

        $mapped['updated_at'] = now();

        return $mapped;
    }

    /**
     * Derive workflow_state, status, current_layer from old system flags.
     */
    private function deriveWorkflowState(array $data): array
    {
        $drawerDone = trim($data['drawer_done'] ?? '');
        $checkerDone = trim($data['checker_done'] ?? '');
        $finalUpload = trim($data['final_upload'] ?? '');
        $status = trim($data['status'] ?? '');
        $dname = trim($data['dname'] ?? '');
        $cname = trim($data['cname'] ?? '');
        $reason = trim($data['reason'] ?? '');

        // Fully delivered
        if ($drawerDone === 'yes' && $checkerDone === 'yes' && $finalUpload === 'yes') {
            return ['status' => 'completed', 'workflow_state' => 'DELIVERED', 'current_layer' => 'qa'];
        }

        // Checker done, awaiting QA
        if ($drawerDone === 'yes' && $checkerDone === 'yes') {
            return ['status' => 'pending', 'workflow_state' => 'QUEUED_QA', 'current_layer' => 'qa'];
        }

        // Drawer done, awaiting/in checker
        if ($drawerDone === 'yes') {
            if ($cname) {
                return ['status' => 'in-progress', 'workflow_state' => 'IN_CHECK', 'current_layer' => 'checker'];
            }
            return ['status' => 'pending', 'workflow_state' => 'QUEUED_CHECK', 'current_layer' => 'checker'];
        }

        // Pending with reason = rejection
        if ($status === 'pending' && $reason) {
            return ['status' => 'pending', 'workflow_state' => 'REJECTED_BY_CHECK', 'current_layer' => 'drawer'];
        }

        // Drawer assigned but not done
        if ($dname) {
            return ['status' => 'in-progress', 'workflow_state' => 'IN_DRAW', 'current_layer' => 'drawer'];
        }

        // Not started
        return ['status' => 'pending', 'workflow_state' => 'RECEIVED', 'current_layer' => 'drawer'];
    }

    /**
     * Resolve worker name to new system user ID.
     */
    private function resolveWorkerId(string $name, string $role): ?int
    {
        if (empty($name)) return null;

        $user = DB::table('users')
            ->where('name', $name)
            ->where('role', $role)
            ->where('email', 'like', '%@benchmark-metro.internal')
            ->first(['id']);

        if ($user) return $user->id;

        // Case-insensitive fallback
        $user = DB::table('users')
            ->whereRaw('LOWER(name) = ?', [strtolower($name)])
            ->where('role', $role)
            ->where('email', 'like', '%@benchmark-metro.internal')
            ->first(['id']);

        if ($user) return $user->id;

        // Cross-role fallback
        $user = DB::table('users')
            ->whereRaw('LOWER(name) = ?', [strtolower($name)])
            ->where('email', 'like', '%@benchmark-metro.internal')
            ->first(['id']);

        return $user?->id;
    }

    /**
     * Parse various date formats.
     */
    private function parseDate(?string $dateStr): ?string
    {
        if (!$dateStr || trim($dateStr) === '') return null;
        $dateStr = ltrim(trim($dateStr), '.');
        if (str_starts_with($dateStr, '1970')) return null;

        try {
            return \Carbon\Carbon::parse($dateStr)->toDateTimeString();
        } catch (\Exception $e) {
            return null;
        }
    }
}
