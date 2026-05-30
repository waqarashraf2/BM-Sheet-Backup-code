<?php

namespace App\Console\Commands;

use App\Services\FocalPbPhotoScraperService;
use Illuminate\Console\Command;

class ScrapeFocalPbPhoto extends Command
{
    protected $signature = 'scrape:focalpbphoto';

    protected $description = 'Scrape Focal PB Photo Ready jobs and import new orders';

    public function handle(FocalPbPhotoScraperService $scraper): int
    {
        $this->info('Starting FocalPbPhoto scraper...');

        $result = $scraper->run();

        if (!($result['ok'] ?? false)) {
            $this->error('Scraper failed: ' . ($result['error'] ?? 'Unknown error'));
            return self::FAILURE;
        }

        $this->info('FocalPbPhoto scraper completed successfully.');
        $this->line('Inserted : ' . $result['inserted']);
        $this->line('Skipped  : ' . $result['skipped']);

        return self::SUCCESS;
    }
}
