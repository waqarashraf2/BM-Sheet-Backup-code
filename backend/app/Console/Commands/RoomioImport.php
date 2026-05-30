<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use App\Services\RoomioImportService;

class RoomioImport extends Command
{
    protected $signature = 'app:romio-import';

    protected $description = 'Import Roomio orders';

    public function handle()
    {
        app(RoomioImportService::class)->run();

        $this->info('Roomio import completed successfully.');
    }
}