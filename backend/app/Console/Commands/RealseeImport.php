<?php

namespace App\Console\Commands;

use App\Services\RealseeImportService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class RealseeImport extends Command
{
    protected $signature = 'app:realsee-import';

    protected $description = 'Import Realsee floorplan orders for Project 56';

    public function handle(): int
    {
        $this->info('Starting Realsee import...');

        try {
            $result = app(RealseeImportService::class)->import();

            if (!($result['success'] ?? false)) {
                $this->error('Realsee import failed: ' . (string) ($result['message'] ?? 'Unknown error'));
                return self::FAILURE;
            }

            $this->info('Realsee import completed successfully.');
            $this->line('Pending fetched: ' . (string) ($result['pending_fetched'] ?? 0));
            $this->line('Processing fetched: ' . (string) ($result['processing_fetched'] ?? 0));
            $this->line('Unique records: ' . (string) ($result['unique_records'] ?? 0));
            $this->line('Inserted: ' . (string) ($result['inserted'] ?? 0));
            $this->line('Ignored/existing: ' . (string) ($result['ignored_or_existing'] ?? 0));

            return self::SUCCESS;
        } catch (\Throwable $e) {
            Log::error('Realsee command error.', ['error' => $e->getMessage()]);
            $this->error('Realsee import failed. Check logs.');

            return self::FAILURE;
        }
    }
}
