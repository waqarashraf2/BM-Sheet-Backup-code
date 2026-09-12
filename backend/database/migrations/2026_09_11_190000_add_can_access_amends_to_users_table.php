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
        if (!Schema::hasColumn('users', 'can_access_amends')) {
            Schema::table('users', function (Blueprint $table) {
                $table->boolean('can_access_amends')->default(false)->after('is_active');
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        if (Schema::hasColumn('users', 'can_access_amends')) {
            Schema::table('users', function (Blueprint $table) {
                $table->dropColumn('can_access_amends');
            });
        }
    }
};
