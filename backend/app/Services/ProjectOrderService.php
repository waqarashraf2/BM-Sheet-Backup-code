<?php

namespace App\Services;

use App\Models\Project;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;

/**
 * Manages per-project order tables.
 *
 * Each project gets its own `project_{id}_orders` table with the full orders schema.
 * Each table uses its own auto-increment ID (IDs are NOT globally unique).
 * Orders are always identified by (project_id, id) pair.
 *
 * Usage:
 *   ProjectOrderService::createTableForProject($project);
 *   ProjectOrderService::getTableName($projectId); // "project_5_orders"
 *   ProjectOrderService::dropTableForProject($projectId);
 */
class ProjectOrderService
{
    /**
     * Get the table name for a given project.
     */
    public static function getTableName(int $projectId): string
    {
        return "project_{$projectId}_orders";
    }

    /**
     * Check if a project's order table exists.
     */
    public static function tableExists(int $projectId): bool
    {
        return Schema::hasTable(static::getTableName($projectId));
    }

    /**
     * Create the orders table for a project with the full schema.
     * No-op if the table already exists.
     */
    public static function createTableForProject(Project $project): void
    {
        $tableName = static::getTableName($project->id);

        if (Schema::hasTable($tableName)) {
            return;
        }

        Schema::create($tableName, function (Blueprint $table) {
            // Auto-increment primary key — scoped to this project table
            $table->id();

            $table->string('order_number', 191);
            $table->unsignedBigInteger('project_id');
            $table->string('client_reference')->nullable();
            $table->string('address', 255)->nullable();
            $table->string('client_name', 255)->nullable();

            $table->enum('current_layer', ['drawer', 'checker', 'qa', 'designer'])->default('drawer');
            $table->enum('status', ['pending', 'in-progress', 'completed', 'on-hold', 'cancelled'])->default('pending');
            $table->string('workflow_state', 30)->default('RECEIVED');
            $table->string('workflow_type', 20)->default('FP_3_LAYER');

            $table->unsignedBigInteger('assigned_to')->nullable();

            // Worker tracking per layer
            $table->integer('drawer_id')->nullable();
            $table->string('drawer_name')->nullable();
            $table->integer('checker_id')->nullable();
            $table->string('checker_name')->nullable();
            $table->integer('qa_id')->nullable();
            $table->string('qa_name')->nullable();

            // Assignment & completion timestamps per layer
            $table->string('dassign_time')->nullable();
            $table->string('cassign_time')->nullable();
            $table->string('drawer_done', 10)->nullable();
            $table->string('drawer_date')->nullable();
            $table->string('checker_done', 10)->nullable();
            $table->string('checker_date')->nullable();
            $table->string('final_upload', 10)->nullable();
            $table->string('ausFinaldate')->nullable();

            // Mistake/error tracking
            $table->text('mistake')->nullable();
            $table->text('cmistake')->nullable();

            // Old system references
            $table->integer('d_id')->nullable();
            $table->string('amend', 10)->nullable();
            $table->integer('d_live_qa')->nullable();
            $table->integer('c_live_qa')->nullable();
            $table->integer('qa_live_qa')->nullable();

            $table->unsignedBigInteger('qa_supervisor_id')->nullable();
            $table->unsignedBigInteger('team_id')->nullable();
            $table->enum('priority', ['low', 'normal', 'high', 'urgent'])->default('normal');

            // Smart assignment fields
            $table->unsignedSmallInteger('complexity_weight')->default(1);
            $table->unsignedInteger('estimated_minutes')->nullable();
            $table->string('order_type', 50)->default('standard');

            $table->timestamp('received_at')->nullable();
            $table->date('due_date')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('delivered_at')->nullable();

            // Legacy date fields
            $table->integer('year')->nullable();
            $table->integer('month')->nullable();
            $table->string('date', 255)->nullable();
            $table->timestamp('ausDatein')->nullable();

            // Order classification
            $table->string('code', 255)->nullable();
            $table->string('plan_type', 255)->nullable();
            $table->string('instruction', 255)->nullable();
            $table->string('project_type', 255)->nullable();
            $table->string('due_in', 255)->nullable();

            $table->json('metadata')->nullable();
            $table->text('supervisor_notes')->nullable();
            $table->json('attachments')->nullable();

            // Import tracking
            $table->enum('import_source', ['api', 'cron', 'csv', 'manual'])->default('manual');
            $table->unsignedBigInteger('import_log_id')->nullable();

            // Rejection / recheck
            $table->integer('recheck_count')->default(0);
            $table->unsignedInteger('attempt_draw')->default(0);
            $table->unsignedInteger('attempt_check')->default(0);
            $table->unsignedInteger('attempt_qa')->default(0);

            $table->unsignedBigInteger('rejected_by')->nullable();
            $table->timestamp('rejected_at')->nullable();
            $table->text('rejection_reason')->nullable();
            $table->string('rejection_type')->nullable();
            $table->boolean('checker_self_corrected')->default(false);

            // Client portal sync
            $table->string('client_portal_id')->nullable();
            $table->timestamp('client_portal_synced_at')->nullable();

            // Hold management
            $table->boolean('is_on_hold')->default(false);
            $table->string('hold_reason')->nullable();
            $table->unsignedBigInteger('hold_set_by')->nullable();
            $table->string('pre_hold_state', 30)->nullable();

            $table->timestamps();

            // Indexes
            $table->unique('order_number');
            $table->index('project_id');
            $table->index(['project_id', 'status', 'current_layer']);
            $table->index('assigned_to');
            $table->index(['priority', 'received_at']);
            $table->index('workflow_state');
            $table->index(['project_id', 'workflow_state']);
            $table->index(['qa_supervisor_id', 'workflow_state']);
            $table->index(['project_id', 'workflow_state', 'delivered_at']);
            $table->index(['project_id', 'received_at']);
        });
    }

    /**
     * Drop the orders table for a project.
     */
    public static function dropTableForProject(int $projectId): void
    {
        Schema::dropIfExists(static::getTableName($projectId));
    }

    /**
     * Add a custom column to a project's order table.
     * Allows independent schema evolution per project.
     */
    public static function addColumn(int $projectId, string $column, string $type, ?string $after = null, bool $nullable = true): void
    {
        $tableName = static::getTableName($projectId);

        if (Schema::hasColumn($tableName, $column)) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($column, $type, $after, $nullable) {
            $col = $table->$type($column);
            if ($nullable) $col->nullable();
            if ($after) $col->after($after);
        });
    }

    /**
     * Find which project table contains an order by scanning all project tables.
     * Uses indexed PK lookup — fast even with many projects.
     * Returns project_id or null.
     */
    public static function findProjectForOrder(int $orderId): ?int
    {
        $projectIds = Project::pluck('id');
        foreach ($projectIds as $pid) {
            $tableName = static::getTableName($pid);
            if (!Schema::hasTable($tableName)) continue;
            $exists = DB::table($tableName)->where('id', $orderId)->value('project_id');
            if ($exists) return (int) $exists;
        }
        return null;
    }

    // ─── Per-Project Mistake/Checklist Tables ──────────────────────────

    /**
     * Get mistake table name for a project and layer.
     * e.g. project_13_drawer_mistake, project_13_checker_mistake, project_13_qa_mistake
     */
    public static function getMistakeTableName(int $projectId, string $layer): string
    {
        return "project_{$projectId}_{$layer}_mistake";
    }

    /**
     * Create all three mistake tables for a project (drawer, checker, qa).
     * Each table records Live QA findings per order per checklist item.
     */
    public static function createMistakeTablesForProject(int $projectId): void
    {
        foreach (['drawer', 'checker', 'qa'] as $layer) {
            $tableName = static::getMistakeTableName($projectId, $layer);

            if (Schema::hasTable($tableName)) {
                continue;
            }

            Schema::create($tableName, function (Blueprint $table) use ($projectId, $layer) {
                $table->id();
                $table->string('order_id', 100)->comment('Order reference (order_number or old order_id)');
                $table->unsignedBigInteger('product_checklist_id')->comment('FK to product_checklists.id');
                $table->string('worker', 500)->nullable()->comment('Name of drawer/checker/qa being checked');
                $table->integer('worker_type_id')->default(0);
                $table->boolean('is_checked')->default(false)->comment('true = mistake found');
                $table->integer('count_value')->default(0)->comment('Number of mistakes for this item');
                $table->string('text_value', 255)->default('')->comment('Comment/description of mistake');
                $table->string('created_by', 100)->comment('Live QA person who checked');
                $table->string('updated_by', 100)->nullable();
                $table->timestamps();

                $table->index('order_id');
                $table->index(['order_id', 'product_checklist_id']);
            });
        }
    }

    /**
     * Check if mistake tables exist for a project.
     */
    public static function mistakeTablesExist(int $projectId): bool
    {
        return Schema::hasTable(static::getMistakeTableName($projectId, 'drawer'))
            && Schema::hasTable(static::getMistakeTableName($projectId, 'checker'))
            && Schema::hasTable(static::getMistakeTableName($projectId, 'qa'));
    }

    // ─── Internal QA Mistake Table ─────────────────────────────────────

    /**
     * Get internal QA mistake table name for a project.
     * e.g. project_16_internal_qa_mistake
     */
    public static function getInternalQaMistakeTableName(int $projectId): string
    {
        return "project_{$projectId}_internal_qa_mistake";
    }

    /**
     * Create the internal QA mistake table for a project if it does not exist.
     * Matches the schema of project_16_internal_qa_mistake exactly.
     */
    public static function createInternalQaMistakeTable(int $projectId): void
    {
        $tableName = static::getInternalQaMistakeTableName($projectId);

        if (Schema::hasTable($tableName)) {
            return;
        }

        Schema::create($tableName, function (Blueprint $table) {
            $table->id();
            $table->string('order_id', 100)->comment('Order reference (order_number)');
            $table->unsignedBigInteger('product_checklist_id')->default(0);
            $table->string('worker', 500)->nullable();
            $table->integer('worker_type_id')->default(0);
            $table->boolean('is_checked')->nullable();
            $table->integer('count_value')->default(0);
            $table->string('text_value', 255)->nullable();
            $table->string('created_by', 100)->default('');
            $table->string('updated_by', 100)->nullable();
            $table->timestamps();

            $table->index('order_id');
            $table->index('product_checklist_id');
            $table->index('worker_type_id');
        });
    }

    /**
     * Check if the internal QA mistake table exists for a project.
     */
    public static function internalQaMistakeTableExists(int $projectId): bool
    {
        return Schema::hasTable(static::getInternalQaMistakeTableName($projectId));
    }
}
