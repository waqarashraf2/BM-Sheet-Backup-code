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
        Schema::create('client_issues', function (Blueprint $table) {
            $table->id();
            $table->foreignId('project_id')->index();
            $table->unsignedBigInteger('order_id')->index();
            $table->string('reason');
            $table->text('comment_text')->nullable();
            $table->timestamp('comment_entered_at')->nullable();
            $table->text('client_reply_text')->nullable();
            $table->timestamp('client_replied_at')->nullable();
            $table->integer('comment_to_reply_diff_minutes')->nullable();
            $table->timestamp('team_started_at')->nullable();
            $table->integer('reply_to_start_diff_minutes')->nullable();
            $table->timestamp('team_finished_at')->nullable();
            $table->integer('time_taken_to_finish_minutes')->nullable();
            $table->timestamps();

            $table->index(['project_id', 'order_id']);
        });
    }
    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('client_issues');
    }
};
