<?php

namespace App\Console\Commands;

use App\Services\IGuideImportService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class IGuideImport extends Command
{
    protected $signature = 'app:iguide-import';

    protected $description = 'Import iGUIDE floorplan orders for Project 55';

    public function handle(): int
    {
        $this->info('Starting iGUIDE import...');

        try {
            $result = app(IGuideImportService::class)->import();

            if (!($result['success'] ?? false)) {
                $this->error('iGUIDE import failed: ' . (string) ($result['message'] ?? 'Unknown error'));
                return self::FAILURE;
            }

            $this->info('iGUIDE import completed successfully.');
            $this->line('Pending fetched: ' . (string) ($result['pending_fetched'] ?? 0));
            $this->line('Processing fetched: ' . (string) ($result['processing_fetched'] ?? 0));
            $this->line('Unique records: ' . (string) ($result['unique_records'] ?? 0));
            $this->line('Inserted: ' . (string) ($result['inserted'] ?? 0));
            $this->line('Ignored/existing: ' . (string) ($result['ignored_or_existing'] ?? 0));

            return self::SUCCESS;
        } catch (\Throwable $e) {
            Log::error('iGUIDE command error.', ['error' => $e->getMessage()]);
            $this->error('iGUIDE import failed. Check logs.');

            return self::FAILURE;
        }
    }
}
