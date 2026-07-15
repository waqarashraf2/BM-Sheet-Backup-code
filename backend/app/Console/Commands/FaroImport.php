<?php

namespace App\Console\Commands;

use App\Services\FaroImportService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class FaroImport extends Command
{
    protected $signature = 'app:faro-import';

    protected $description = 'Import Faro universal floorplan orders for Project 27';

    public function handle(): int
    {
        $this->info('Starting Faro import...');

        try {
            $result = app(FaroImportService::class)->import();

            if (!($result['success'] ?? false)) {
                $this->error('Faro import failed: ' . (string) ($result['message'] ?? 'Unknown error'));
                return self::FAILURE;
            }

            $this->info('Faro import completed successfully.');
            $this->line('Pending fetched: ' . (string) ($result['pending_fetched'] ?? 0));
            $this->line('Processing fetched: ' . (string) ($result['processing_fetched'] ?? 0));
            $this->line('Unique records: ' . (string) ($result['unique_records'] ?? 0));
            $this->line('Inserted: ' . (string) ($result['inserted'] ?? 0));
            $this->line('Ignored/existing: ' . (string) ($result['ignored_or_existing'] ?? 0));

            return self::SUCCESS;
        } catch (\Throwable $e) {
            Log::error('Faro command error.', ['error' => $e->getMessage()]);
            $this->error('Faro import failed. Check logs.');

            return self::FAILURE;
        }
    }
}
