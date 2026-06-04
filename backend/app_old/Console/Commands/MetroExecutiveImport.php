<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\MetroExecutiveImportService;

class MetroExecutiveImport extends Command
{
    protected $signature = 'app:metro-import';

    protected $description = 'Import Metro Executive orders';

    public function handle()
    {
        app(MetroExecutiveImportService::class)->run();

        $this->info('Metro Executive import completed successfully.');
    }
}