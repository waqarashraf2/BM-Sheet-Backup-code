<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // 1. crm_order_assignments: composite index for the LEFT JOIN in assignmentDashboard
        if (Schema::hasTable('crm_order_assignments')) {
            $this->addIndexIfMissing('crm_order_assignments', 'idx_crm_project_order', function (Blueprint $t) {
                $t->index(['project_id', 'order_number'], 'idx_crm_project_order');
            });
        }

        // 2. work_items: composite index for buildAssignmentDashboardCommentMap
        if (Schema::hasTable('work_items')) {
            $this->addIndexIfMissing('work_items', 'idx_wi_project_order', function (Blueprint $t) {
                $t->index(['project_id', 'order_id'], 'idx_wi_project_order');
            });
        }

        // 3. Per-project order tables: add missing composite indexes
        $projects = DB::table('projects')->pluck('id');
        foreach ($projects as $pid) {
            $table = "project_{$pid}_orders";
            if (!Schema::hasTable($table)) {
                continue;
            }

            // (workflow_state, received_at) — date + status filter combo
            if (Schema::hasColumn($table, 'workflow_state') && Schema::hasColumn($table, 'received_at')) {
                $this->addIndexIfMissing($table, "{$table}_wf_received_idx", function (Blueprint $t) use ($table) {
                    $t->index(['workflow_state', 'received_at'], "{$table}_wf_received_idx");
                });
            }

            // (drawer_id, workflow_state) — drawer WIP queries
            if (Schema::hasColumn($table, 'drawer_id') && Schema::hasColumn($table, 'workflow_state')) {
                $this->addIndexIfMissing($table, "{$table}_drawer_wf_idx", function (Blueprint $t) use ($table) {
                    $t->index(['drawer_id', 'workflow_state'], "{$table}_drawer_wf_idx");
                });
            }

            // (checker_id, workflow_state) — checker WIP queries
            if (Schema::hasColumn($table, 'checker_id') && Schema::hasColumn($table, 'workflow_state')) {
                $this->addIndexIfMissing($table, "{$table}_checker_wf_idx", function (Blueprint $t) use ($table) {
                    $t->index(['checker_id', 'workflow_state'], "{$table}_checker_wf_idx");
                });
            }

            // (qa_id, workflow_state) — QA WIP queries
            if (Schema::hasColumn($table, 'qa_id') && Schema::hasColumn($table, 'workflow_state')) {
                $this->addIndexIfMissing($table, "{$table}_qa_wf_idx", function (Blueprint $t) use ($table) {
                    $t->index(['qa_id', 'workflow_state'], "{$table}_qa_wf_idx");
                });
            }

            // file_uploader_id — filler WIP queries
            if (Schema::hasColumn($table, 'file_uploader_id')) {
                $this->addIndexIfMissing($table, "{$table}_fuploader_idx", function (Blueprint $t) use ($table) {
                    $t->index('file_uploader_id', "{$table}_fuploader_idx");
                });
            }

            // (qa_supervisor_id, workflow_state) — qaOrders endpoint
            if (Schema::hasColumn($table, 'qa_supervisor_id') && Schema::hasColumn($table, 'workflow_state')) {
                $this->addIndexIfMissing($table, "{$table}_qa_sup_wf_idx", function (Blueprint $t) use ($table) {
                    $t->index(['qa_supervisor_id', 'workflow_state'], "{$table}_qa_sup_wf_idx");
                });
            }

            // (checker_supervisor_id, workflow_state) — checkerOrders endpoint
            if (Schema::hasColumn($table, 'checker_supervisor_id') && Schema::hasColumn($table, 'workflow_state')) {
                $this->addIndexIfMissing($table, "{$table}_ck_sup_wf_idx", function (Blueprint $t) use ($table) {
                    $t->index(['checker_supervisor_id', 'workflow_state'], "{$table}_ck_sup_wf_idx");
                });
            }
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('crm_order_assignments')) {
            try { Schema::table('crm_order_assignments', fn (Blueprint $t) => $t->dropIndex('idx_crm_project_order')); } catch (\Exception $e) {}
        }
        if (Schema::hasTable('work_items')) {
            try { Schema::table('work_items', fn (Blueprint $t) => $t->dropIndex('idx_wi_project_order')); } catch (\Exception $e) {}
        }

        $projects = DB::table('projects')->pluck('id');
        foreach ($projects as $pid) {
            $table = "project_{$pid}_orders";
            if (!Schema::hasTable($table)) continue;
            foreach ([
                "{$table}_wf_received_idx", "{$table}_drawer_wf_idx", "{$table}_checker_wf_idx",
                "{$table}_qa_wf_idx", "{$table}_fuploader_idx", "{$table}_qa_sup_wf_idx", "{$table}_ck_sup_wf_idx",
            ] as $idx) {
                try { Schema::table($table, fn (Blueprint $t) => $t->dropIndex($idx)); } catch (\Exception $e) {}
            }
        }
    }

    private function addIndexIfMissing(string $table, string $indexName, \Closure $callback): void
    {
        $exists = DB::select("SHOW INDEX FROM `{$table}` WHERE Key_name = ?", [$indexName]);
        if (!empty($exists)) {
            return;
        }
        Schema::table($table, $callback);
    }
};
