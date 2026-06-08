<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Performance indexes identified by audit:
 * - drawer_id, checker_id, qa_id on order tables (used in assignment queries)
 * - Composite user index (project_id, role, is_active) for dashboard aggregation
 * - Composite order index (status, completed_at, assigned_user_id) for daily-ops
 */
return new class extends Migration
{
    public function up(): void
    {
        // Add indexes to project-specific order tables
        $projects = \DB::table('projects')->pluck('id');

        foreach ($projects as $projectId) {
            $table = "project_{$projectId}_orders";
            if (!Schema::hasTable($table)) continue;

            Schema::table($table, function (Blueprint $t) use ($table) {
                // Assignment lookup indexes
                if (Schema::hasColumn($table, 'drawer_id') && !$this->hasIndex($table, 'drawer_id')) {
                    $t->index('drawer_id');
                }
                if (Schema::hasColumn($table, 'checker_id') && !$this->hasIndex($table, 'checker_id')) {
                    $t->index('checker_id');
                }
                if (Schema::hasColumn($table, 'qa_id') && !$this->hasIndex($table, 'qa_id')) {
                    $t->index('qa_id');
                }

                // Daily operations: status + completed_at for date-range queries
                if (Schema::hasColumn($table, 'status') && Schema::hasColumn($table, 'completed_at')) {
                    if (!$this->hasIndexByName($table, "{$table}_status_completed_idx")) {
                        $t->index(['status', 'completed_at'], "{$table}_status_completed_idx");
                    }
                }

                // workflow_state is frequently used in WHERE clauses
                if (Schema::hasColumn($table, 'workflow_state') && !$this->hasIndex($table, 'workflow_state')) {
                    $t->index('workflow_state');
                }
            });
        }

        // Users table: composite index for dashboard queries
        if (!$this->hasIndexByName('users', 'users_active_role_idx')) {
            Schema::table('users', function (Blueprint $t) {
                $t->index(['is_active', 'role'], 'users_active_role_idx');
            });
        }
    }

    public function down(): void
    {
        $projects = \DB::table('projects')->pluck('id');

        foreach ($projects as $projectId) {
            $table = "project_{$projectId}_orders";
            if (!Schema::hasTable($table)) continue;

            Schema::table($table, function (Blueprint $t) use ($table) {
                try { $t->dropIndex("{$table}_drawer_id_index"); } catch (\Exception $e) {}
                try { $t->dropIndex("{$table}_checker_id_index"); } catch (\Exception $e) {}
                try { $t->dropIndex("{$table}_qa_id_index"); } catch (\Exception $e) {}
                try { $t->dropIndex("{$table}_status_completed_idx"); } catch (\Exception $e) {}
                try { $t->dropIndex("{$table}_workflow_state_index"); } catch (\Exception $e) {}
            });
        }

        Schema::table('users', function (Blueprint $t) {
            try { $t->dropIndex('users_active_role_idx'); } catch (\Exception $e) {}
        });
    }

    private function hasIndex(string $table, string $column): bool
    {
        $indexes = \DB::select("SHOW INDEX FROM `{$table}` WHERE Column_name = ?", [$column]);
        return count($indexes) > 0;
    }

    private function hasIndexByName(string $table, string $indexName): bool
    {
        $indexes = \DB::select("SHOW INDEX FROM `{$table}` WHERE Key_name = ?", [$indexName]);
        return count($indexes) > 0;
    }
};
