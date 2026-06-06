<?php

namespace App\Console\Commands;

use App\Services\FocalCrmPhotoService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ImportFocalCrmPhotoJobs extends Command
{
    /**
     * The name and signature of the console command.
     *
     * @var string
     */
    protected $signature = 'focalcrm:import-photo {--debug : Show raw API response}';

    /**
     * The console command description.
     *
     * @var string
     */
    protected $description = 'Import Photo jobs from FocalCRM API (Project 22)';

    /**
     * Execute the console command.
     */
    public function handle(): int
    {
        $this->info('Starting FocalCRM Photo import...');

        try {
            $service = new FocalCrmPhotoService();

            // Step 1: Always fetch and count first
            $this->info('Step 1: Fetching from API...');
            $raw = $service->fetchRaw();
            $allJobs = $raw['jobs'] ?? [];
            $this->info('  → Total jobs in API: ' . count($allJobs));

            if (empty($allJobs)) {
                $this->warn('API returned no jobs. Raw response:');
                $this->line(json_encode($raw, JSON_PRETTY_PRINT));
                return 1;
            }

            // Count by Product
            $productCounts = [];
            foreach ($allJobs as $job) {
                $product = $job['Product'] ?? 'NULL';
                $productCounts[$product] = ($productCounts[$product] ?? 0) + 1;
            }
            foreach ($productCounts as $product => $cnt) {
                $this->line("  → Product [{$product}]: {$cnt} jobs");
            }

            if ($this->option('debug')) {
                $this->info('Sample job structure:');
                $this->line(json_encode($allJobs[0] ?? [], JSON_PRETTY_PRINT));
                return 0;
            }

            // Step 2: Import
            $this->info('Step 2: Importing Photo jobs (PH_2_LAYER)...');
            $result = $service->import();

            if ($result['success']) {
                $this->info('✓ Import completed successfully!');
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
            } else {
                $this->error('✗ Import failed: ' . $result['message']);
                return 1;
            }

        } catch (\Exception $e) {
            $this->error('Error: ' . $e->getMessage());
            Log::error('FocalCRM Photo import command error', ['exception' => $e]);
            return 1;
        }
    }
}
