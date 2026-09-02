<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        if (Schema::hasTable('client_issues')) {
            Schema::table('client_issues', function (Blueprint $table) {
                if (!Schema::hasColumn('client_issues', 'order_id')) {
                    $table->unsignedBigInteger('order_id')->default(0)->after('project_id')->index();
                    $table->index(['project_id', 'order_id'], 'client_issues_project_order_idx');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('client_issues') && Schema::hasColumn('client_issues', 'order_id')) {
            Schema::table('client_issues', function (Blueprint $table) {
                $table->dropIndex('client_issues_project_order_idx');
                $table->dropColumn('order_id');
            });
        }
    }
};
