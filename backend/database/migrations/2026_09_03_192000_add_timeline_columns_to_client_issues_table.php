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
                if (!Schema::hasColumn('client_issues', 'resumed_at')) {
                    $table->timestamp('resumed_at')->nullable()->after('time_taken_to_finish_minutes');
                }
                if (!Schema::hasColumn('client_issues', 'resumed_by')) {
                    $table->unsignedBigInteger('resumed_by')->nullable()->after('resumed_at');
                }
                if (!Schema::hasColumn('client_issues', 'pause_to_resume_diff_minutes')) {
                    $table->integer('pause_to_resume_diff_minutes')->nullable()->after('resumed_by');
                }
                if (!Schema::hasColumn('client_issues', 'completed_at')) {
                    $table->timestamp('completed_at')->nullable()->after('pause_to_resume_diff_minutes');
                }
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasTable('client_issues')) {
            Schema::table('client_issues', function (Blueprint $table) {
                $cols = [];
                if (Schema::hasColumn('client_issues', 'resumed_at')) $cols[] = 'resumed_at';
                if (Schema::hasColumn('client_issues', 'resumed_by')) $cols[] = 'resumed_by';
                if (Schema::hasColumn('client_issues', 'pause_to_resume_diff_minutes')) $cols[] = 'pause_to_resume_diff_minutes';
                if (Schema::hasColumn('client_issues', 'completed_at')) $cols[] = 'completed_at';
                if (!empty($cols)) {
                    $table->dropColumn($cols);
                }
            });
        }
    }
};
