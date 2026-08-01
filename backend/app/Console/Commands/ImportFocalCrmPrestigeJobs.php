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
            $fallbackDiagnostics = is_array($raw['fallback'] ?? null) ? $raw['fallback'] : [];
            $this->info('  -> Total jobs in API: ' . count($allJobs));
            if (!empty($raw['meta'])) {
                $this->line('  -> URL: ' . ($raw['meta']['url'] ?? 'unknown'));
                $this->line('  -> HTTP status: ' . ($raw['meta']['http_status'] ?? 'unknown'));
                $this->line('  -> Status fallback URL: ' . ($raw['meta']['status_api_url'] ?? 'unknown'));
            }

            if (empty($allJobs)) {
                $this->warn('Primary API returned no jobs.');
                foreach ($fallbackDiagnostics as $diagnostic) {
                    $this->line(sprintf(
                        '  -> Fallback [%s]: HTTP %s, jobs %s, prestige %s',
                        $diagnostic['status_filter'] ?? 'unknown',
                        $diagnostic['http_status'] ?? 'error',
                        $diagnostic['job_count'] ?? 0,
                        $diagnostic['prestige_count'] ?? 0
                    ));
                    if (!empty($diagnostic['product_diagnostic'])) {
                        $this->line('     ' . $diagnostic['product_diagnostic']);
                    }
                }

                $fallbackHasPrestige = collect($fallbackDiagnostics)
                    ->contains(fn ($diagnostic) => (int) ($diagnostic['prestige_count'] ?? 0) > 0);

                if ($this->option('debug') || !$fallbackHasPrestige) {
                    $this->warn('Raw diagnostic response:');
                    $this->line(json_encode($raw, JSON_PRETTY_PRINT));
                    return $fallbackHasPrestige ? 0 : 1;
                }

                $this->info('Primary feed is empty, but fallback status feed has Prestige jobs. Continuing import...');
            }

            $hasPrestigeJob = function (array $jobs): bool {
                foreach ($jobs as $job) {
                    if (!is_array($job)) {
                        continue;
                    }

                    $product = strtolower(trim((string) ($job['Product'] ?? $job['product'] ?? '')));
                    $productOption = strtolower(trim((string) ($job['ProductOption'] ?? $job['productOption'] ?? '')));
                    if ($product === 'prestige photography' || $productOption === 'prestige photography') {
                        return true;
                    }
                }

                return false;
            };

            if (!$hasPrestigeJob($allJobs)) {
                $fallbackJobs = $service->fetchFallbackJobsForImport();
                if (!empty($fallbackJobs)) {
                    $this->warn('Primary feed has no Prestige jobs. Merging fallback status feed jobs...');
                    $this->line('  -> Fallback import jobs: ' . count($fallbackJobs));
                    $allJobs = array_merge($allJobs, $fallbackJobs);
                }
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
            $result = $service->import($allJobs);

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
