<?php

namespace App\Services\QaReport\Parsers;

use App\Services\QaReport\Contracts\ChecklistParserInterface;

class Project13Parser implements ChecklistParserInterface
{
    /**
     * Columns for Project 13 (Metro FP)
     */
    public function getColumns(): array
    {
        return [
            'template'         => '1. Template',
            'tour_walkthrough' => '2. Tour Walkthrough',
            'dimensions'       => '3. Dimensions',
            'labeling'         => '4. Labeling',
            'site_plan'        => '5. Site Plan',
            'north_arrow'      => '6. North Arrow',
            'address_title'    => '7. Address / Title',
            'area'             => '8. Area',
            'views_360'        => '9. 360° Views',
            'notes_point'      => '10. Notes',
            'final_files'      => '11. Final Files',
        ];
    }

    /**
     * Parse comment for Project 13
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

            // Check if this line is marked as NO / Mistake
            $isNo = (
                str_contains($trimmed, '[NO]') ||
                str_contains($trimmed, '✗') ||
                str_contains($trimmed, '[FAIL]')
            ) && !str_contains($trimmed, '[YES]') && !str_contains($trimmed, '✓');

            if (!$isNo) continue;

            // Record column mistakes only (DO NOT add checklist labels to remarks)
            if (preg_match('/1\.\s*Template/i', $trimmed)) {
                $mistakes['template'] = 1;
            } elseif (preg_match('/2\.\s*Tour\s*Walkthrough/i', $trimmed)) {
                $mistakes['tour_walkthrough'] = 1;
            } elseif (preg_match('/3\.\s*Dimensions/i', $trimmed)) {
                $mistakes['dimensions'] = 1;
            } elseif (preg_match('/4\.\s*Labeling/i', $trimmed)) {
                $mistakes['labeling'] = 1;
            } elseif (preg_match('/5\.\s*Site\s*Plan/i', $trimmed)) {
                $mistakes['site_plan'] = 1;
            } elseif (preg_match('/6\.\s*North\s*Arrow/i', $trimmed)) {
                $mistakes['north_arrow'] = 1;
            } elseif (preg_match('/7\.\s*Address/i', $trimmed)) {
                $mistakes['address_title'] = 1;
            } elseif (preg_match('/8\.\s*Area/i', $trimmed)) {
                $mistakes['area'] = 1;
            } elseif (preg_match('/9\.\s*360/i', $trimmed)) {
                $mistakes['views_360'] = 1;
            } elseif (preg_match('/10\.\s*Notes/i', $trimmed)) {
                $mistakes['notes_point'] = 1;
            } elseif (
                preg_match('/File\s*Formats/i', $trimmed) ||
                preg_match('/Naming/i', $trimmed) ||
                preg_match('/Resolution/i', $trimmed) ||
                preg_match('/Line\s*Weights/i', $trimmed) ||
                preg_match('/No\s*Overlaps/i', $trimmed) ||
                preg_match('/11\.\s*Final/i', $trimmed)
            ) {
                $mistakes['final_files'] = 1;
            }
        }

        // ONLY extract what was manually typed by QA in the comment / notes during submission
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
