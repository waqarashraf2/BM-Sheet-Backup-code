<?php

namespace App\Console\Commands;

use App\Services\FocalPb\FocalPbScraperService;
use Illuminate\Console\Command;

/**
 * ScrapeFocalPb — Login to FocalPb portal and scrape PropertyVision orders.
 *
 * Authenticates with the FocalPb site, scrapes the matterport PropertyVision
 * table, and persists new rows into project_2_orders.
 *
 * Requires in config/services.php (or .env):
 *   FOCALPB_BASE_URL, FOCALPB_EMAIL, FOCALPB_PASSWORD
 *
 * Usage:
 *   php artisan scrape:focalpb            # Run the scraper
 *   php artisan scrape:focalpb --verbose  # Run with extra output
 */
class ScrapeFocalPb extends Command
{
    protected $signature = 'app:focalpb';

    protected $description = 'Scrape FocalPb PropertyVision portal and import new orders into project_2_orders';

    public function handle(FocalPbScraperService $scraper): int
    {
        $this->info('Starting FocalPb scraper...');

        try {
            $scraper->run();
            $this->info('FocalPb scraper completed successfully.');
        } catch (\Throwable $e) {
            $this->error('FocalPb scraper failed: ' . $e->getMessage());
            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
