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

            if ($this->option('debug')) {
                $raw = $service->fetchRaw();
                $this->info('Raw API response:');
                $this->line(json_encode($raw, JSON_PRETTY_PRINT));
                return 0;
            }

            $result = $service->import();

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
