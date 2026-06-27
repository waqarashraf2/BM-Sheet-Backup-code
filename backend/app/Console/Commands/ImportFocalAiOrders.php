<?php

namespace App\Console\Commands;

use App\Services\FocalAiImportService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ImportFocalAiOrders extends Command
{
    protected $signature = 'focalai:import';

    protected $description = 'Import Project 52 FocalAI orders from job_ids API';

    public function handle(): int
    {
        $this->info('Starting FocalAI import...');

        try {
            $result = app(FocalAiImportService::class)->import();

            if (!($result['success'] ?? false)) {
                $this->error('FocalAI import failed: ' . (string) ($result['message'] ?? 'Unknown error'));
                return 1;
            }

            $this->info('FocalAI import completed successfully.');
            $this->line('Fetched: ' . (string) ($result['fetched'] ?? 0));
            $this->line('Inserted: ' . (string) ($result['inserted'] ?? 0));
            $this->line('Updated: ' . (string) ($result['updated'] ?? 0));
            $this->line('Skipped: ' . (string) ($result['skipped'] ?? 0));

            return 0;
        } catch (\Throwable $e) {
            Log::error('FocalAI command error', ['error' => $e->getMessage()]);
            $this->error('FocalAI import failed. Check logs.');

            return 1;
        }
    }
}
