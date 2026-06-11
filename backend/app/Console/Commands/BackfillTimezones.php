<?php

namespace App\Console\Commands;

use App\Jobs\BackfillTimezoneAwareTimestamps;
use App\Models\Project;
use Illuminate\Console\Command;

class BackfillTimezones extends Command
{
    protected $signature = 'timezones:backfill {--project-id= : Specific project ID to backfill}';
    protected $description = 'Backfill timezone-aware UTC timestamps for all projects (non-blocking async job)';

    public function handle(): int
    {
        $this->info('Starting timezone backfill (async, non-blocking)...');

        $projectId = $this->option('project-id');

        if ($projectId) {
            $projects = Project::where('id', $projectId)->get();
        } else {
            $projects = Project::where('status', 'active')->get();
        }

        foreach ($projects as $project) {
            $this->info("Queuing backfill job for {$project->name} (Project {$project->id})");

            $timezone = $project->timezone ?? 'Asia/Karachi';

            BackfillTimezoneAwareTimestamps::dispatch($project->id, $timezone);
        }

        $this->info('All backfill jobs queued. They will run in the background.');
        $this->info('Check logs: storage/logs/laravel.log for progress.');

        return 0;
    }
}
