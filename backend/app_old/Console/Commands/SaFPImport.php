<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\SaFPImportService;

class SaFPImport extends Command
{
    /**
     * Command signature
     */
    protected $signature = 'app:safp-import';

    /**
     * Command description
     */
    protected $description = 'Import Project 12 Floorplan tasks from Python API';

    /**
     * Execute the command
     */
    public function handle()
    {
        try {
            $this->info('⏳ Starting SA FP import...');

            app(SaFPImportService::class)->run();

            $this->info('✅ SA FP import completed successfully.');

        } catch (\Exception $e) {

            \Log::error('SAFP Command Error: ' . $e->getMessage());

            $this->error('❌ SA FP import failed. Check logs.');
        }
    }
}