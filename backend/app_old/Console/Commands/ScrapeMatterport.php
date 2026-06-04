<?php

namespace App\Console\Commands;

use App\Services\FocalPb2ScraperService;
use Illuminate\Console\Command;

/**
 * ScrapeFocalPb2 — Login to FocalPb2 portal and scrape PropertyVision orders.
 *
 * Authenticates with fa-pb2-floor-plan-app-web-prod.azurewebsites.net,
 * scrapes /propertybox2/PropertyVision, and persists new rows into
 * project_2_orders (project_id = 3).
 *
 * Usage:
 *   php artisan scrape:focalpb2
 */
class ScrapeMatterport extends Command
{
    protected $signature = 'scrape:focalpb2';

    protected $description = 'Scrape FocalPb2 PropertyVision portal and import new orders into project_2_orders';

    public function handle(FocalPb2ScraperService $scraper): int
    {
        $this->info('Starting FocalPb2 scraper...');

        $result = $scraper->run();

        if (!($result['ok'] ?? false)) {
            $this->error('Scraper failed: ' . ($result['error'] ?? 'Unknown error'));
            return self::FAILURE;
        }

        $this->info('FocalPb2 scraper completed successfully.');
        $this->line('Inserted : ' . $result['inserted']);
        $this->line('Skipped  : ' . $result['skipped']);

        return self::SUCCESS;
    }
}
