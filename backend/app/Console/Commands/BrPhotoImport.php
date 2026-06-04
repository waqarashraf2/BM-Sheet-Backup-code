<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\BrPhotoService;

class BrPhotoImport extends Command
{
    /**
     * Command signature
     */
    protected $signature = 'app:brphoto-import';

    /**
     * Command description
     */
    protected $description = 'Import Project 17 BR photo orders from EMS API';

    /**
     * Execute the command
     */
    public function handle()
    {
        try {
            $this->info('⏳ Starting BR Photo import...');

            $result = app(BrPhotoService::class)->run();

            if (!($result['ok'] ?? false)) {
                $this->error('❌ BR Photo import did not insert data: ' . (string) ($result['error'] ?? 'Unknown error'));
                return 1;
            }

            $this->info('✅ BR Photo import completed successfully.');
            $this->line('Fetched: ' . (string) ($result['fetched'] ?? 0));
            $this->line('Inserted: ' . (string) ($result['inserted'] ?? 0));
            $this->line('Skipped: ' . (string) ($result['skipped'] ?? 0));
            return 0;

        } catch (\Exception $e) {

            \Log::error('BrPhoto Command Error: ' . $e->getMessage());

            $this->error('❌ BR Photo import failed. Check logs.');
            return 1;
        }
    }
}
