<?php

namespace App\Console\Commands;

use App\Services\FocalXactimateScraperService;
use Illuminate\Console\Command;

/**
 * ScrapeFocalXactimate - Login to Focal portal and scrape Xactimate orders.
 *
 * Authenticates with fa-pb2-floor-plan-app-web-prod.azurewebsites.net,
 * scrapes /matterport/Xactimate, and persists new rows into
 * project_2_orders.
 *
 * Usage:
 *   php artisan scrape:focalxactimate
 */
class ScrapeFocalXactimate extends Command
{
    protected $signature = 'scrape:focalxactimate';

    protected $description = 'Scrape Focal Xactimate portal and import new orders into project_2_orders';

    public function handle(FocalXactimateScraperService $scraper): int
    {
        $this->info('Starting Focal Xactimate scraper...');

        $result = $scraper->run();

        if (!($result['ok'] ?? false)) {
            $this->error('Scraper failed: ' . ($result['error'] ?? 'Unknown error'));
            return self::FAILURE;
        }

        $this->info('Focal Xactimate scraper completed successfully.');
        $this->line('Inserted : ' . $result['inserted']);
        $this->line('Skipped  : ' . $result['skipped']);

        return self::SUCCESS;
    }
}
