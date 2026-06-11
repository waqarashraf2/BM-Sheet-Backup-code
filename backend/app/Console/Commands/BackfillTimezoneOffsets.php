<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Models\Project;

class BackfillTimezoneOffsets extends Command
{
    protected $signature = 'timezones:backfill-offsets {--project-id= : Specific project ID to backfill}';
    protected $description = 'Backfill timezone offset (+5 hours) for received_at and delivered_at timestamps from scrapers (UTC → PKT conversion)';

    public function handle(): int
    {
        $this->info('Starting timezone offset backfill...');
        $this->warn('This adds 5 hours to all received_at and delivered_at timestamps');
        $this->warn('These timestamps were stored as UTC but treated as PKT by the app');

        if (!$this->confirm('Continue with backfill?')) {
            return 0;
        }

        $projectId = $this->option('project-id');

        if ($projectId) {
            $projects = Project::where('id', $projectId)->get();
        } else {
            $projects = Project::where('status', 'active')->get();
        }

        $totalUpdated = 0;

        foreach ($projects as $project) {
            $table = "project_{$project->id}_orders";

            if (!DB::getSchemaBuilder()->hasTable($table)) {
                $this->line("⊘ Project {$project->id} ({$project->name}): table does not exist");
                continue;
            }

            try {
                // Count how many will be updated
                $count = DB::table($table)
                    ->where(function ($q) {
                        $q->whereNotNull('received_at')
                            ->orWhereNotNull('delivered_at');
                    })
                    ->count();

                if ($count === 0) {
                    $this->line("✓ Project {$project->id} ({$project->name}): 0 orders to update");
                    continue;
                }

                $this->line("Updating Project {$project->id} ({$project->name}): {$count} orders...");

                // Update received_at: add 5 hours
                DB::table($table)
                    ->whereNotNull('received_at')
                    ->update([
                        'received_at' => DB::raw('DATE_ADD(received_at, INTERVAL 5 HOUR)')
                    ]);

                // Update delivered_at: add 5 hours
                DB::table($table)
                    ->whereNotNull('delivered_at')
                    ->update([
                        'delivered_at' => DB::raw('DATE_ADD(delivered_at, INTERVAL 5 HOUR)')
                    ]);

                $totalUpdated += $count;
                $this->line("✓ Project {$project->id} ({$project->name}): updated {$count} orders");

            } catch (\Throwable $e) {
                $this->error("✗ Project {$project->id} ({$project->name}): {$e->getMessage()}");
                return 1;
            }
        }

        $this->info("\n✓ Timezone offset backfill completed!");
        $this->info("Total orders updated: {$totalUpdated}");
        $this->info("\nNOTE: Run dashboard queries again to see updated delayed percentages");

        return 0;
    }
}
