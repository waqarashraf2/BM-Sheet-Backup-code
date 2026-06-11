<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        $projects = [1, 2, 3, 4, 5, 12, 16, 19];

        foreach ($projects as $projectId) {
            $table = "project_{$projectId}_orders";

            if (!Schema::hasTable($table)) {
                continue;
            }

            // Add new columns for proper UTC storage (non-breaking)
            // These will be populated by async job, old columns stay untouched
            Schema::table($table, function (Blueprint $table) {
                if (!Schema::hasColumn($table->getTable(), 'received_at_utc')) {
                    $table->dateTime('received_at_utc')->nullable()->comment('Proper UTC timestamp for received_at');
                }
                if (!Schema::hasColumn($table->getTable(), 'delivered_at_utc')) {
                    $table->dateTime('delivered_at_utc')->nullable()->comment('Proper UTC timestamp for delivered_at');
                }
                if (!Schema::hasColumn($table->getTable(), 'received_at_timezone')) {
                    $table->string('received_at_timezone', 50)->nullable()->comment('Timezone of received_at value');
                }
            });
        }
    }

    public function down(): void
    {
        $projects = [1, 2, 3, 4, 5, 12, 16, 19];

        foreach ($projects as $projectId) {
            $table = "project_{$projectId}_orders";

            if (!Schema::hasTable($table)) {
                continue;
            }

            Schema::table($table, function (Blueprint $table) {
                $columns = Schema::getColumns($table->getTable());
                $columnNames = array_column($columns, 'name');

                if (in_array('received_at_utc', $columnNames)) {
                    $table->dropColumn('received_at_utc');
                }
                if (in_array('delivered_at_utc', $columnNames)) {
                    $table->dropColumn('delivered_at_utc');
                }
                if (in_array('received_at_timezone', $columnNames)) {
                    $table->dropColumn('received_at_timezone');
                }
            });
        }
    }
};
