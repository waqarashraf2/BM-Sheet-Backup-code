<?php

namespace App\Services\QaReport;

use App\Services\QaReport\Contracts\ChecklistParserInterface;
use App\Services\QaReport\Parsers\GenericChecklistParser;
use App\Services\QaReport\Parsers\Project13Parser;
use App\Services\QaReport\Parsers\Project15Parser;

class QaParserFactory
{
    public static function getParser(int $projectId): ChecklistParserInterface
    {
        return match ($projectId) {
            13 => new Project13Parser(),
            15 => new Project15Parser(),
            default => new GenericChecklistParser(),
        };
    }
}
