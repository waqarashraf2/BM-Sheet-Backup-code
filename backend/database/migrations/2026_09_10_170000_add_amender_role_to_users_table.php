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
        // Add 'amender' role to users table enum safely
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
            'amender'
        ) NOT NULL");
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
