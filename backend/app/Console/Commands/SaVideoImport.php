<?php

namespace App\Console\Commands;

use App\Services\SaVideoService;
use Illuminate\Console\Command;

class SaVideoImport extends Command
{
    /**
     * Command signature
     */
    protected $signature = 'app:savideo-import';

    /**
     * Command description
     */
    protected $description = 'Import Project 57 video tasks from Base44 API';

    /**
     * Execute the command
     */
    public function handle(): void
    {
        try {
            $this->info('Starting SA Video import...');

            app(SaVideoService::class)->run();

            $this->info('SA Video import completed successfully.');
        } catch (\Exception $e) {
            \Log::error('SaVideo Command Error: ' . $e->getMessage());

            $this->error('SA Video import failed. Check logs.');
        }
    }
}
