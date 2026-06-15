<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('client_portal_upload_projects', function (Blueprint $table) {
            $table->unsignedBigInteger('project_id')->primary();
            $table->string('provider', 50)->default('focal');
            $table->boolean('is_active')->default(true);
            $table->boolean('qa_upload_required')->default(true);
            $table->boolean('enforce_order_filename')->default(true);
            $table->timestamps();
        });

        Schema::create('client_portal_uploads', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('project_id');
            $table->unsignedBigInteger('order_id');
            $table->string('job_order_id', 191);
            $table->unsignedBigInteger('uploaded_by');
            $table->string('status', 30)->default('uploading');
            $table->json('file_names')->nullable();
            $table->unsignedInteger('file_count')->default(0);
            $table->unsignedSmallInteger('upload_http_status')->nullable();
            $table->text('upload_response')->nullable();
            $table->timestamp('uploaded_at')->nullable();
            $table->unsignedSmallInteger('submit_http_status')->nullable();
            $table->text('submit_response')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->text('failure_reason')->nullable();
            $table->timestamps();

            $table->index(['project_id', 'order_id']);
            $table->index(['project_id', 'job_order_id']);
            $table->index(['status', 'submitted_at']);
        });

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
        Schema::dropIfExists('client_portal_uploads');
        Schema::dropIfExists('client_portal_upload_projects');
    }
};