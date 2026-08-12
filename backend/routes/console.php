<?php

use App\Jobs\AutoAssignOrders;
use App\Jobs\AutoReassignOrders;
use App\Jobs\ComputeWorkerStats;
use App\Jobs\RefreshDashboardCache;
use App\Jobs\ResetDailyCounters;
use App\Jobs\UpdateInactiveUsers;
use App\Models\User;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// ══════════════════════════════════════════════════════════════════════════════
// SCHEDULED JOBS FOR HIGH-VOLUME SCALABILITY
// ══════════════════════════════════════════════════════════════════════════════

// Real-time dashboard cache refresh (every minute)
// DISABLED (cache keys mismatch) Schedule::job(new RefreshDashboardCache())
// DISABLED (cache keys mismatch)     ->everyMinute()
// DISABLED (cache keys mismatch)     ->withoutOverlapping()
// DISABLED (cache keys mismatch)     ->description('Pre-compute dashboard statistics for fast retrieval');

// Auto-reassign orders from inactive workers (every 5 minutes)
// Schedule::job(new AutoReassignOrders(30)) // 30 minutes inactivity threshold
//     ->everyFiveMinutes()
//     ->withoutOverlapping()
//     ->description('Reassign orders from inactive/absent workers');

// Push-based auto-assignment: assign queued orders to available workers (every minute)
// Schedule::job(new AutoAssignOrders())
//     ->everyMinute()
//     ->withoutOverlapping()
//     ->description('Auto-assign queued orders to available idle workers');

// Smart Assignment: compute worker stats & scores (every 10 minutes)
// Schedule::job(new ComputeWorkerStats())
//     ->everyTenMinutes()
//     ->withoutOverlapping()
//     ->description('Compute avg_completion_minutes, rejection_rate, assignment_score per worker');

// Reset daily counters at midnight
Schedule::job(new ResetDailyCounters())
    ->daily()
    ->at('00:00')
    ->withoutOverlapping()
    ->description('Reset today_completed counters for all users');

// Per CEO Requirements: Flag inactive users (daily at midnight)
// Users remove absent mark by logging in
Schedule::job(new UpdateInactiveUsers())
    ->everyFiveMinutes()
    ->withoutOverlapping()
    ->description('Mark all active users as absent once daily after noon - remove upon login');


// Legacy command support
Schedule::command('users:flag-inactive --days=15')
    ->daily()
    ->at('00:05')
    ->description('Legacy: Flag inactive users and reassign their orders');

Schedule::command('app:romio-import')
    ->everyFiveMinutes()
    ->withoutOverlapping(10)
    ->runInBackground();
    
    Schedule::command('app:metro-import')
    ->everyFiveMinutes()
    ->withoutOverlapping()
    ->runInBackground();
    
    // LOW LOAD SYSTEM (IMPORTANT)
Schedule::command('app:safp-import')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();


Schedule::command('app:saphoto-import')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();

Schedule::command('app:savideo-import')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();
    
    Schedule::command('scrape:focalpb2')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();
    
    
Schedule::command('scrape:focalxactimate')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();

// FocalCRM - Project 1 (PropertyVision FloorPlan) //1
Schedule::command('focalcrm:import')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();

// FocalCRM - PB Photo Scraper //2
Schedule::command('scrape:focalpbphoto')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();
    
    
// FocalCRM - Project 22 (Photo Jobs - PH_2_LAYER) //3
Schedule::command('focalcrm:photo-import')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();
    
    
    
// FocalCRM - Project 25 (Prestige Photography) //4
Schedule::command('focalcrm:import-prestige')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();
    

    
// FocalAI - Project 52
Schedule::command('focalai:import')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();

    
// Focal RTV - Project 26 (Photography) //5
Schedule::command('focalrtv:import')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();



// Realsee - Project 56
Schedule::command('app:realsee-import')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();

// iGUIDE - Project 55
Schedule::command('app:iguide-import')
    ->everyTenMinutes()
    ->withoutOverlapping()
    ->runInBackground();

    // Faro - Project 27
Schedule::command('app:faro-import')
    ->everyThirtyMinutes()
    ->withoutOverlapping()
    ->runInBackground();
