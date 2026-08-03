<?php

namespace App\Console\Commands;

use App\Services\FocalCrmPhotoService;
use Illuminate\Console\Command;

class ImportFocalCrmPhotoJobs extends Command
{
    protected $signature = 'focalcrm:photo-import {--debug : Show raw API response only, do not import}';

    protected $description = 'Import Photography jobs from FocalCRM API into Project 22 (PB Photo Jobs)';

    public function handle(): int
    {
        $this->info('Starting FocalCRM Photo import for Project 22...');

        try {
            $service = new FocalCrmPhotoService();
            $raw = $service->fetchRaw();
            $allJobs = is_array($raw['jobs'] ?? null) ? $raw['jobs'] : [];
            $fallbackDiagnostics = is_array($raw['fallback'] ?? null) ? $raw['fallback'] : [];

            $this->info('Step 1: Fetching from API...');
            $this->info('  -> Total jobs in API: ' . count($allJobs));
            if (!empty($raw['meta'])) {
                $this->line('  -> URL: ' . ($raw['meta']['url'] ?? 'unknown'));
                $this->line('  -> HTTP status: ' . ($raw['meta']['http_status'] ?? 'unknown'));
                $this->line('  -> Status fallback URL: ' . ($raw['meta']['status_api_url'] ?? 'unknown'));
            }

            foreach ($fallbackDiagnostics as $diagnostic) {
                $this->line(sprintf(
                    '  -> Fallback [%s]: HTTP %s, jobs %s, photo %s',
                    $diagnostic['status_filter'] ?? 'unknown',
                    $diagnostic['http_status'] ?? 'error',
                    $diagnostic['job_count'] ?? 0,
                    $diagnostic['photo_count'] ?? 0
                ));
                if (!empty($diagnostic['product_diagnostic'])) {
                    $this->line('     ' . $diagnostic['product_diagnostic']);
                }
            }

            $hasPhotoJob = function (array $jobs): bool {
                $photoProducts = [
                    'photography',
                    'drone photography',
                    'streetscape',
                    'additional photo',
                    'photo enhancement',
                    'elevated photography',
                ];

                foreach ($jobs as $job) {
                    if (!is_array($job)) {
                        continue;
                    }

                    $product = strtolower(trim((string) ($job['Product'] ?? $job['product'] ?? '')));
                    $productOption = strtolower(trim((string) ($job['ProductOption'] ?? $job['productOption'] ?? '')));
                    if (in_array($product, $photoProducts, true) || in_array($productOption, $photoProducts, true)) {
                        return true;
                    }
                }

                return false;
            };

            if (!$hasPhotoJob($allJobs)) {
                $fallbackJobs = $service->fetchFallbackJobsForImport();
                if (!empty($fallbackJobs)) {
                    $this->warn('Primary feed has no Photo jobs. Merging fallback status feed jobs...');
                    $this->line('  -> Fallback import jobs: ' . count($fallbackJobs));
                    $allJobs = array_merge($allJobs, $fallbackJobs);
                }
            }

            $productCounts = [];
            foreach ($allJobs as $job) {
                if (!is_array($job)) {
                    continue;
                }

                $product = $job['Product'] ?? $job['product'] ?? 'NULL';
                $productCounts[$product] = ($productCounts[$product] ?? 0) + 1;
            }
            foreach ($productCounts as $product => $count) {
                $this->line("  -> Product [{$product}]: {$count} jobs");
            }

            $photoProducts = [
                'photography',
                'drone photography',
                'streetscape',
                'additional photo',
                'photo enhancement',
                'elevated photography',
            ];
            $photoJobs = collect($allJobs)
                ->filter(function ($job) use ($photoProducts) {
                    if (!is_array($job)) {
                        return false;
                    }

                    $product = strtolower(trim((string) ($job['Product'] ?? $job['product'] ?? '')));
                    $productOption = strtolower(trim((string) ($job['ProductOption'] ?? $job['productOption'] ?? '')));

                    return in_array($product, $photoProducts, true) || in_array($productOption, $photoProducts, true);
                })
                ->values();

            $this->info('  -> Photo jobs selected for import: ' . $photoJobs->count());
            foreach ($photoJobs->take(10) as $job) {
                $this->line(sprintf(
                    '     [%s] %s | %s | %s',
                    $job['Product'] ?? $job['product'] ?? 'NULL',
                    $job['Id'] ?? $job['id'] ?? 'no-id',
                    $job['OrderReference'] ?? $job['orderReference'] ?? '-',
                    $job['CustomerName'] ?? $job['customerName'] ?? '-'
                ));
            }

            if ($this->option('debug')) {
                $this->info('Raw API diagnostic response:');
                $this->line(json_encode($raw, JSON_PRETTY_PRINT));
                return 0;
            }

            $this->info('Step 2: Importing Photo jobs...');
            $result = $service->import($allJobs);

            if (!$result['success']) {
                $this->warn('Import finished with warning: ' . $result['message']);
                return 1;
            }

            $this->info('Import completed successfully.');
            $this->table(
                ['Inserted', 'Updated', 'Skipped', 'Total Processed'],
                [[
                    $result['inserted'],
                    $result['updated'],
                    $result['skipped'],
                    $result['total_processed'] ?? ($result['inserted'] + $result['updated'] + $result['skipped']),
                ]]
            );

            return 0;

        } catch (\Exception $e) {
            $this->error('Import failed: ' . $e->getMessage());
            \Log::error('FocalCRM Photo import command error: ' . $e->getMessage());
            return 1;
        }
    }
}
