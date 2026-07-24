<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'machine_id')) {
                $table->string('machine_id', 100)->nullable()->after('email');
                $table->index('machine_id', 'users_machine_id_idx');
            }
        });

        if (!Schema::hasTable('user_documents')) {
            Schema::create('user_documents', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->string('machine_id', 100)->nullable();
                $table->enum('document_type', [
                    'copy_of_cnic',
                    'two_pics',
                    'nda',
                    'contract_letter',
                    'extra',
                ]);
                $table->string('original_name');
                $table->string('file_name');
                $table->string('file_path');
                $table->string('mime_type', 100)->nullable();
                $table->unsignedBigInteger('file_size')->nullable();
                $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('uploaded_at')->nullable();
                $table->timestamps();

                $table->index('machine_id', 'user_documents_machine_id_idx');
                $table->index(['user_id', 'document_type'], 'user_documents_user_type_idx');
                $table->index(['machine_id', 'document_type'], 'user_documents_machine_type_idx');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_documents');

        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'machine_id')) {
                $table->dropIndex('users_machine_id_idx');
                $table->dropColumn('machine_id');
            }
        });
    }
};
