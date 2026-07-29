<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'joining_salary')) {
                $table->decimal('joining_salary', 12, 2)->nullable()->after('bank_account_number');
            }
        });

        if (!Schema::hasTable('user_leave_entries')) {
            Schema::create('user_leave_entries', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->date('leave_date');
                $table->unsignedTinyInteger('leave_days')->default(1);
                $table->string('reason', 500);
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();

                $table->index(['user_id', 'leave_date']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_leave_entries');

        Schema::table('users', function (Blueprint $table) {
            if (Schema::hasColumn('users', 'joining_salary')) {
                $table->dropColumn('joining_salary');
            }
        });
    }
};
