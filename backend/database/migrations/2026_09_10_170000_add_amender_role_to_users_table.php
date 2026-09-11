<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Convert users.role to varchar(50) safely so all roles work without rigid enum restrictions
        try {
            DB::statement("ALTER TABLE users MODIFY COLUMN role VARCHAR(50) NOT NULL DEFAULT 'drawer'");
        } catch (\Throwable $e) {
            DB::statement("ALTER TABLE users MODIFY COLUMN role ENUM(
                'ceo',
                'director',
                'operations_manager',
                'project_manager',
                'drawer',
                'checker',
                'qa',
                'designer',
                'accounts_manager',
                'live_qa',
                'hr',
                'filler',
                'csr',
                'it',
                'client',
                'amender',
                'direct_amender'
            ) NOT NULL DEFAULT 'drawer'");
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement("ALTER TABLE users MODIFY COLUMN role ENUM(
            'ceo',
            'director',
            'operations_manager',
            'project_manager',
            'drawer',
            'checker',
            'qa',
            'designer',
            'accounts_manager',
            'live_qa',
            'hr',
            'filler',
            'csr',
            'it',
            'client'
        ) NOT NULL");
    }
};
