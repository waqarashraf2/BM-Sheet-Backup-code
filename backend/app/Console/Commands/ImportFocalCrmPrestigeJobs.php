<?php

namespace App\Console\Commands;

use App\Services\FocalCrmPrestigeService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ImportFocalCrmPrestigeJobs extends Command
{
    protected $signature = 'focalcrm:import-prestige {--debug : Show raw API response}';

    protected $description = 'Import Prestige Photography jobs from FocalCRM API (Project 25)';

    public function handle(): int
    {
        $this->info('Starting FocalCRM Prestige import...');

        try {
            $service = new FocalCrmPrestigeService();

            $this->info('Step 1: Fetching from API...');
            $raw = $service->fetchRaw();
            $allJobs = $raw['jobs'] ?? [];
            $this->info('  -> Total jobs in API: ' . count($allJobs));

            if (empty($allJobs)) {
                $this->warn('API returned no jobs. Raw response:');
                $this->line(json_encode($raw, JSON_PRETTY_PRINT));
                return 1;
            }

            $productCounts = [];
            foreach ($allJobs as $job) {
                $product = $job['Product'] ?? 'NULL';
                $productCounts[$product] = ($productCounts[$product] ?? 0) + 1;
            }
            foreach ($productCounts as $product => $cnt) {
                $this->line("  -> Product [{$product}]: {$cnt} jobs");
            }

            if ($this->option('debug')) {
                $this->info('Sample job structure:');
                $this->line(json_encode($allJobs[0] ?? [], JSON_PRETTY_PRINT));
                return 0;
            }

            $this->info('Step 2: Importing Prestige Photography jobs...');
            $result = $service->import();

            if ($result['success']) {
                $this->info('Import completed successfully!');
                $this->table(
                    ['Metric', 'Count'],
                    [
                        ['Inserted', $result['inserted']],
                        ['Updated', $result['updated']],
                        ['Skipped', $result['skipped']],
                        ['Total', $result['total_processed']],
                    ]
                );
                return 0;
            }

            $this->error('Import failed: ' . $result['message']);
            return 1;
        } catch (\Exception $e) {
            $this->error('Error: ' . $e->getMessage());
            Log::error('FocalCRM Prestige import command error', ['exception' => $e]);
            return 1;
        }
    }
}
