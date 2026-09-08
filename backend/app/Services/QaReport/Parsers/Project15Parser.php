<?php

namespace App\Services\QaReport\Parsers;

use App\Services\QaReport\Contracts\ChecklistParserInterface;

class Project15Parser implements ChecklistParserInterface
{
    /**
     * Columns for Project 15 (Roomio FP)
     */
    public function getColumns(): array
    {
        return [
            'template'         => '1. Template',
            'video_meshes'     => '2. Walkthrough & Meshes',
            'dimensions'       => '3. Dimensions',
            'labeling'         => '4. Labeling',
            'site_plan'        => '5. Site Plan',
            'north_disclaimer' => '6. North & Disclaimer',
            'address_title'    => '7. Address / Title',
            'area'             => '8. Area',
            'datasheet'        => '9. Data Sheet',
            'notes_point'      => '10. Notes',
            'final_files'      => '11. Final Files',
        ];
    }

    /**
     * Parse comment for Project 15
     */
    public function parse(string $comment): array
    {
        $columns = array_keys($this->getColumns());
        $mistakes = array_fill_keys($columns, 0);
        $remarks = [];

        // Split comment lines
        $lines = preg_split('/\r\n|\r|\n/', $comment);

        foreach ($lines as $line) {
            $trimmed = trim($line);
            if ($trimmed === '') continue;

            // Check if this line is marked as UNCHECKED / FAIL / NO
            $isMistake = (
                str_contains($trimmed, '[UNCHECKED]') ||
                str_contains($trimmed, '[FAIL]') ||
                str_contains($trimmed, '[NO]') ||
                str_contains($trimmed, '✗')
            ) && !str_contains($trimmed, '[PASS]') && !str_contains($trimmed, '[YES]') && !str_contains($trimmed, '✓');

            if (!$isMistake) continue;

            // Clean item label for remarks
            $cleanItem = preg_replace('/^[✗x—\s\-]*(\[(?:UNCHECKED|FAIL|NO)\])?\s*(\([^\)]+\))?\s*/i', '', $trimmed);

            // Match category to column
            if (preg_match('/(?:1\.\s*Template|\(1\.\s*Template\))/i', $trimmed)) {
                $mistakes['template'] = 1;
                $remarks[] = $cleanItem ?: '1. Template';
            } elseif (preg_match('/(?:2\.\s*Video|Walkthrough|Meshes)/i', $trimmed)) {
                $mistakes['video_meshes'] = 1;
                $remarks[] = $cleanItem ?: '2. Walkthrough & Meshes';
            } elseif (preg_match('/(?:3\.\s*Dimensions|\(3\.\s*Dimensions\))/i', $trimmed)) {
                $mistakes['dimensions'] = 1;
                $remarks[] = $cleanItem ?: '3. Dimensions';
            } elseif (preg_match('/(?:4\.\s*Labeling|\(4\.\s*Labeling\))/i', $trimmed)) {
                $mistakes['labeling'] = 1;
                $remarks[] = $cleanItem ?: '4. Labeling';
            } elseif (preg_match('/(?:5\.\s*Site\s*Plan|\(5\.\s*Site\s*Plan\))/i', $trimmed)) {
                $mistakes['site_plan'] = 1;
                $remarks[] = $cleanItem ?: '5. Site Plan';
            } elseif (preg_match('/(?:6\.\s*North|Disclaimer)/i', $trimmed)) {
                $mistakes['north_disclaimer'] = 1;
                $remarks[] = $cleanItem ?: '6. North & Disclaimer';
            } elseif (preg_match('/(?:7\.\s*Address|Address\/Title)/i', $trimmed)) {
                $mistakes['address_title'] = 1;
                $remarks[] = $cleanItem ?: '7. Address/Title';
            } elseif (preg_match('/(?:8\.\s*Area|\(8\.\s*Area\))/i', $trimmed)) {
                $mistakes['area'] = 1;
                $remarks[] = $cleanItem ?: '8. Area';
            } elseif (preg_match('/(?:9\.\s*Data\s*Sheet|\(9\.\s*Data\s*Sheet\))/i', $trimmed)) {
                $mistakes['datasheet'] = 1;
                $remarks[] = $cleanItem ?: '9. Data Sheet';
            } elseif (preg_match('/(?:10\.\s*Notes|\(10\.\s*Notes\))/i', $trimmed)) {
                $mistakes['notes_point'] = 1;
                $remarks[] = $cleanItem ?: '10. Notes';
            } elseif (preg_match('/(?:11\.\s*Final|Deliverables|SVG|File\s*Formats)/i', $trimmed)) {
                $mistakes['final_files'] = 1;
                $remarks[] = $cleanItem ?: '11. Final Files';
            }
        }

        // Extract any free-text QA Comment / Notes at the bottom: e.g. "QA Comment: ...", "Notes: ..."
        if (preg_match_all('/(?:^|\n)\s*(?:QA\s*Comment|Comment|Notes|Remarks)\s*:\s*([\s\S]*?)(?=\n[A-Z][A-Za-z0-9\s]*:|\z)/i', $comment, $allMatches)) {
            foreach ($allMatches[1] as $rawText) {
                $notesText = trim($rawText);
                if ($notesText !== '' && !in_array(strtolower($notesText), ['-', '--', 'n/a', 'none', 'nil'], true)) {
                    $remarks[] = $notesText;
                }
            }
        }

        return [
            'column_mistakes' => $mistakes,
            'total_mistakes'  => array_sum($mistakes),
            'remarks'         => array_values(array_unique(array_filter($remarks))),
        ];
    }
}
