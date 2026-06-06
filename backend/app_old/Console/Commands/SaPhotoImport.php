<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\SaPhotoService;

class SaPhotoImport extends Command
{
    /**
     * Command signature
     */
    protected $signature = 'app:saphoto-import';

    /**
     * Command description
     */
    protected $description = 'Import Project 19 photo tasks from Python API';

    /**
     * Execute the command
     */
    public function handle()
    {
        try {
            $this->info('Starting SA Photo import...');

            app(SaPhotoService::class)->run();

            $this->info('SA Photo import completed successfully.');

        } catch (\Exception $e) {

            \Log::error('SaPhoto Command Error: ' . $e->getMessage());

            $this->error('SA Photo import failed. Check logs.');
        }
    }
}
