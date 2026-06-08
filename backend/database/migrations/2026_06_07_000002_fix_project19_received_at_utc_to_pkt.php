<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Fix project_19_orders (SA Photos): received_at and due_in were stored in UTC
     * because SaPhotoService used new DateTime($utcString) without setTimezone(PKT).
     * API returns Z-suffix (UTC) timestamps — add 5 hours to convert to PKT.
     *
     * REVERT: php artisan migrate:rollback --step=1
     */
    public function up(): void
    {
        if (!Schema::hasTable('project_19_orders')) {
            return;
        }

        DB::statement("
            UPDATE project_19_orders
            SET received_at = DATE_ADD(received_at, INTERVAL 5 HOUR)
            WHERE received_at IS NOT NULL
        ");

        DB::statement("
            UPDATE project_19_orders
            SET due_in = DATE_ADD(due_in, INTERVAL 5 HOUR)
            WHERE due_in IS NOT NULL
        ");

        Log::info('Migration fix_project19_received_at_utc_to_pkt: converted received_at/due_in from UTC to PKT (+5h) for 8639+ rows');
    }

    public function down(): void
    {
        if (!Schema::hasTable('project_19_orders')) {
            return;
        }

        DB::statement("
            UPDATE project_19_orders
            SET received_at = DATE_SUB(received_at, INTERVAL 5 HOUR)
            WHERE received_at IS NOT NULL
        ");

        DB::statement("
            UPDATE project_19_orders
            SET due_in = DATE_SUB(due_in, INTERVAL 5 HOUR)
            WHERE due_in IS NOT NULL
        ");

        Log::info('Migration fix_project19_received_at_utc_to_pkt: ROLLED BACK — reverted to UTC (-5h)');
    }
};
