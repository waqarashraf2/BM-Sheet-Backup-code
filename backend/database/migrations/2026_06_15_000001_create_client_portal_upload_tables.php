<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Production already has these tables. Do not attempt schema changes
        // during deploy; just make sure configured project rows exist.
        if (!Schema::hasTable('client_portal_upload_projects')) {
            return;
        }

        $now = now();
        DB::table('client_portal_upload_projects')->insertOrIgnore([
            [
                'project_id' => 22,
                'provider' => 'focal',
                'is_active' => true,
                'qa_upload_required' => true,
                'enforce_order_filename' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'project_id' => 23,
                'provider' => 'focal',
                'is_active' => true,
                'qa_upload_required' => true,
                'enforce_order_filename' => true,
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);
    }

    public function down(): void
    {
        // Intentionally no-op: these production tables may contain upload audit data.
    }
};
