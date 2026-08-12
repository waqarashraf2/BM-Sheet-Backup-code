<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('crm_order_assignments')) {
            Schema::table('crm_order_assignments', function (Blueprint $table) {
                if (!Schema::hasColumn('crm_order_assignments', 'drawer_assigned_by_name')) {
                    $table->string('drawer_assigned_by_name')->nullable()->after('drawer_name');
                }
                if (!Schema::hasColumn('crm_order_assignments', 'checker_assigned_by_name')) {
                    $table->string('checker_assigned_by_name')->nullable()->after('checker_name');
                }
                if (!Schema::hasColumn('crm_order_assignments', 'qa_assigned_by_name')) {
                    $table->string('qa_assigned_by_name')->nullable()->after('qa_name');
                }
                if (!Schema::hasColumn('crm_order_assignments', 'file_uploader_assigned_by_name')) {
                    $table->string('file_uploader_assigned_by_name')->nullable()->after('file_uploader_name');
                }
                if (!Schema::hasColumn('crm_order_assignments', 'assigned_by_name')) {
                    $table->string('assigned_by_name')->nullable()->after('assigned_to');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('crm_order_assignments')) {
            Schema::table('crm_order_assignments', function (Blueprint $table) {
                if (Schema::hasColumn('crm_order_assignments', 'drawer_assigned_by_name')) {
                    $table->dropColumn('drawer_assigned_by_name');
                }
                if (Schema::hasColumn('crm_order_assignments', 'checker_assigned_by_name')) {
                    $table->dropColumn('checker_assigned_by_name');
                }
                if (Schema::hasColumn('crm_order_assignments', 'qa_assigned_by_name')) {
                    $table->dropColumn('qa_assigned_by_name');
                }
                if (Schema::hasColumn('crm_order_assignments', 'file_uploader_assigned_by_name')) {
                    $table->dropColumn('file_uploader_assigned_by_name');
                }
                if (Schema::hasColumn('crm_order_assignments', 'assigned_by_name')) {
                    $table->dropColumn('assigned_by_name');
                }
            });
        }
    }
};
