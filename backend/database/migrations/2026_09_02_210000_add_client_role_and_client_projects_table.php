<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // 1. Add 'client' role to users table enum safely
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

        // 2. Create pivot table for Client ↔ Projects (multiple projects per client)
        if (!Schema::hasTable('client_projects')) {
            Schema::create('client_projects', function (Blueprint $table) {
                $table->id();
                $table->unsignedBigInteger('user_id');
                $table->unsignedBigInteger('project_id');
                $table->timestamps();

                $table->foreign('user_id')->references('id')->on('users')->onDelete('cascade');
                $table->foreign('project_id')->references('id')->on('projects')->onDelete('cascade');
                $table->unique(['user_id', 'project_id']);
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('client_projects');

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
            'it'
        ) NOT NULL");
    }
};
