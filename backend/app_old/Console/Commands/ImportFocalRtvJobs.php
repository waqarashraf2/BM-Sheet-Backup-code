<?php

namespace App\Console\Commands;

use App\Services\FocalRtvService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ImportFocalRtvJobs extends Command
{
    protected $signature = 'focalrtv:import {--debug : Show raw API response}';

    protected $description = 'Import Focal RTV Photography jobs from Focal API (Project 26)';

    public function handle(): int
    {
        $this->info('Starting Focal RTV import...');

        try {
            $service = new FocalRtvService();

            $this->info('Step 1: Fetching from API...');
            $raw = $service->fetchRaw();
            $allJobs = $raw['Jobs'] ?? [];
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

            foreach ($productCounts as $product => $count) {
                $this->line("  -> Product [{$product}]: {$count} jobs");
            }

            if ($this->option('debug')) {
                $this->info('Sample job structure:');
                $this->line(json_encode($allJobs[0] ?? [], JSON_PRETTY_PRINT));
                return 0;
            }

            $this->info('Step 2: Importing Photography jobs...');
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
            Log::error('Focal RTV import command error', ['exception' => $e]);
            return 1;
        }
    }
}
