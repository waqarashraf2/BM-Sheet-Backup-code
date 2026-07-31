<?php

namespace App\Logging;

use Monolog\Handler\AbstractProcessingHandler;
use Monolog\LogRecord;

class WeeklyLogHandler extends AbstractProcessingHandler
{
    protected function write(LogRecord $record): void
    {
        // Format: laravel-YYYY-Wweeknumber.log (e.g. laravel-2026-W31.log)
        // This keeps 1 log file for all 7 days of the week, and creates a new file after 7 days.
        $fileName = 'laravel-' . date('o-\WW') . '.log';
        $filePath = storage_path('logs/' . $fileName);

        file_put_contents($filePath, (string) $record->formatted, FILE_APPEND);
    }
}