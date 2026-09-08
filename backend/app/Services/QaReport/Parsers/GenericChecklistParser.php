<?php

namespace App\Services\QaReport\Parsers;

use App\Services\QaReport\Contracts\ChecklistParserInterface;

class GenericChecklistParser implements ChecklistParserInterface
{
    public function getColumns(): array
    {
        return [
            'dimensions'    => 'Dimensions & Measurements',
            'format'        => 'File Format & Quality',
            'specifications'=> 'Client Specifications',
            'corrections'   => 'Corrections Applied',
            'labeling'      => 'Labeling & Annotations',
            'completeness'  => 'Completeness Check',
        ];
    }

    public function parse(string $comment): array
    {
        $columns = array_keys($this->getColumns());
        $mistakes = array_fill_keys($columns, 0);
        $remarks = [];

        $lines = preg_split('/\r\n|\r|\n/', $comment);
        foreach ($lines as $line) {
            $trimmed = trim($line);
            if ($trimmed === '') continue;

            $isMistake = (
                str_contains($trimmed, '[UNCHECKED]') ||
                str_contains($trimmed, '[FAIL]') ||
                str_contains($trimmed, '[NO]') ||
                str_contains($trimmed, '✗')
            ) && !str_contains($trimmed, '[PASS]') && !str_contains($trimmed, '[YES]') && !str_contains($trimmed, '✓');

            if (!$isMistake) continue;

            if (stripos($trimmed, 'Dimensions') !== false) {
                $mistakes['dimensions'] = 1;
                $remarks[] = 'Dimensions';
            } elseif (stripos($trimmed, 'Format') !== false) {
                $mistakes['format'] = 1;
                $remarks[] = 'Format & Quality';
            } elseif (stripos($trimmed, 'Specifications') !== false) {
                $mistakes['specifications'] = 1;
                $remarks[] = 'Client Specifications';
            } elseif (stripos($trimmed, 'Corrections') !== false) {
                $mistakes['corrections'] = 1;
                $remarks[] = 'Corrections';
            } elseif (stripos($trimmed, 'Labeling') !== false) {
                $mistakes['labeling'] = 1;
                $remarks[] = 'Labeling';
            } elseif (stripos($trimmed, 'Completeness') !== false) {
                $mistakes['completeness'] = 1;
                $remarks[] = 'Completeness';
            }
        }

        if (preg_match('/(?:^|\n)\s*Notes\s*:\s*([\s\S]*?)(?=\n[A-Z][A-Za-z0-9\s]*:|\z)/i', $comment, $m)) {
            $notesText = trim($m[1]);
            if ($notesText !== '' && !in_array($notesText, ['-', '--', 'N/A', 'none', 'nil'], true)) {
                $remarks[] = $notesText;
            }
        }

        return [
            'column_mistakes' => $mistakes,
            'total_mistakes'  => array_sum($mistakes),
            'remarks'         => array_values(array_unique(array_filter($remarks))),
        ];
    }
}
