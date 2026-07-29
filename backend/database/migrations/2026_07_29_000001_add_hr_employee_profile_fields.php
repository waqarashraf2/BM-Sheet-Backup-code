<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (!Schema::hasColumn('users', 'blood_group')) {
                $table->string('blood_group', 10)->nullable()->after('machine_id');
            }
            if (!Schema::hasColumn('users', 'contact_number')) {
                $table->string('contact_number', 50)->nullable()->after('blood_group');
            }
            if (!Schema::hasColumn('users', 'bank_account_number')) {
                $table->string('bank_account_number', 100)->nullable()->after('contact_number');
            }
            if (!Schema::hasColumn('users', 'salary')) {
                $table->decimal('salary', 12, 2)->nullable()->after('bank_account_number');
            }
        });

        if (!Schema::hasTable('user_salary_increments')) {
            Schema::create('user_salary_increments', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->decimal('previous_salary', 12, 2)->nullable();
                $table->decimal('increment_amount', 12, 2);
                $table->decimal('new_salary', 12, 2);
                $table->date('effective_date');
                $table->text('notes')->nullable();
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();

                $table->index(['user_id', 'effective_date']);
            });
        }

        if (!Schema::hasTable('user_leave_balances')) {
            Schema::create('user_leave_balances', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->unsignedSmallInteger('year');
                $table->unsignedTinyInteger('annual_allowed')->default(14);
                $table->unsignedTinyInteger('leaves_taken')->default(0);
                $table->text('notes')->nullable();
                $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();

                $table->unique(['user_id', 'year']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('user_leave_balances');
        Schema::dropIfExists('user_salary_increments');

        Schema::table('users', function (Blueprint $table) {
            foreach (['blood_group', 'contact_number', 'bank_account_number', 'salary'] as $column) {
                if (Schema::hasColumn('users', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
