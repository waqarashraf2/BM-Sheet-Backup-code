<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Fix project_12_orders: received_at and due_in were stored in UTC
     * (API returns Z-suffix timestamps, stored without conversion).
     * Pakistan (PKT) is UTC+5 — add 5 hours to align dates with the PKT
     * calendar so that "today's" date filter works correctly for the team.
     *
     * Uses DATE_ADD instead of CONVERT_TZ to avoid dependency on MySQL
     * timezone tables (not always loaded on shared hosting).
     */
    public function up(): void
    {
        if (!Schema::hasTable('project_12_orders')) {
            return;
        }

        // Shift received_at from UTC to PKT (+5 hours) for all existing rows.
        // New rows imported after this migration will be stored in PKT directly
        // by the updated SaFPImportService.
        DB::statement("
            UPDATE project_12_orders
            SET received_at = DATE_ADD(received_at, INTERVAL 5 HOUR)
            WHERE received_at IS NOT NULL
        ");

        DB::statement("
            UPDATE project_12_orders
            SET due_in = DATE_ADD(due_in, INTERVAL 5 HOUR)
            WHERE due_in IS NOT NULL
        ");

        Log::info('Migration fix_project12_received_at_utc_to_pkt: converted received_at/due_in from UTC to PKT (+5h)');
    }

    public function down(): void
    {
        if (!Schema::hasTable('project_12_orders')) {
            return;
        }

        DB::statement("
            UPDATE project_12_orders
            SET received_at = DATE_SUB(received_at, INTERVAL 5 HOUR)
            WHERE received_at IS NOT NULL
        ");

        DB::statement("
            UPDATE project_12_orders
            SET due_in = DATE_SUB(due_in, INTERVAL 5 HOUR)
            WHERE due_in IS NOT NULL
        ");
    }
};
