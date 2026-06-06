<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Fix project_2_orders: received_at and due_in were stored in UTC
     * by FocalPb2ScraperService (setTimezone('UTC') before format).
     * Pakistan (PKT) is UTC+5 — add 5 hours to align dates with the PKT
     * calendar so that "today's" dashboard date filter shows correct counts.
     *
     * Uses DATE_ADD instead of CONVERT_TZ to avoid dependency on MySQL
     * timezone tables (not always loaded on shared hosting).
     *
     * REVERT: Run php artisan migrate:rollback --step=1
     * This will subtract 5 hours, restoring original UTC values.
     */
    public function up(): void
    {
        if (!Schema::hasTable('project_2_orders')) {
            return;
        }

        DB::statement("
            UPDATE project_2_orders
            SET received_at = DATE_ADD(received_at, INTERVAL 5 HOUR)
            WHERE received_at IS NOT NULL
        ");

        DB::statement("
            UPDATE project_2_orders
            SET due_in = DATE_ADD(due_in, INTERVAL 5 HOUR)
            WHERE due_in IS NOT NULL
        ");

        Log::info('Migration fix_project2_received_at_utc_to_pkt: converted received_at/due_in from UTC to PKT (+5h) for 4889+ rows');
    }

    public function down(): void
    {
        if (!Schema::hasTable('project_2_orders')) {
            return;
        }

        DB::statement("
            UPDATE project_2_orders
            SET received_at = DATE_SUB(received_at, INTERVAL 5 HOUR)
            WHERE received_at IS NOT NULL
        ");

        DB::statement("
            UPDATE project_2_orders
            SET due_in = DATE_SUB(due_in, INTERVAL 5 HOUR)
            WHERE due_in IS NOT NULL
        ");

        Log::info('Migration fix_project2_received_at_utc_to_pkt: ROLLED BACK — reverted received_at/due_in from PKT back to UTC (-5h)');
    }
};
