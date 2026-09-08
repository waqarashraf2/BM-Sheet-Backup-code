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

        // Track final files sub-mistakes
        $finalFilesFailed = [];

        foreach ($lines as $line) {
            $trimmed = trim($line);
            if ($trimmed === '') continue;

            // Check if this line is marked as NO / Mistake
            // Format: ✗ [NO] 1. Template OR [NO] 3. Dimensions
            $isNo = (
                str_contains($trimmed, '[NO]') ||
                str_contains($trimmed, '✗') ||
                str_contains($trimmed, '[FAIL]')
            ) && !str_contains($trimmed, '[YES]') && !str_contains($trimmed, '✓');

            if (!$isNo) continue;

            // Check which point this belongs to
            if (preg_match('/1\.\s*Template/i', $trimmed)) {
                $mistakes['template'] = 1;
                $remarks[] = '1. Template';
            } elseif (preg_match('/2\.\s*Tour\s*Walkthrough/i', $trimmed)) {
                $mistakes['tour_walkthrough'] = 1;
                $remarks[] = '2. Tour Walkthrough';
            } elseif (preg_match('/3\.\s*Dimensions/i', $trimmed)) {
                $mistakes['dimensions'] = 1;
                $remarks[] = '3. Dimensions';
            } elseif (preg_match('/4\.\s*Labeling/i', $trimmed)) {
                $mistakes['labeling'] = 1;
                $remarks[] = '4. Labeling';
            } elseif (preg_match('/5\.\s*Site\s*Plan/i', $trimmed)) {
                $mistakes['site_plan'] = 1;
                $remarks[] = '5. Site Plan';
            } elseif (preg_match('/6\.\s*North\s*Arrow/i', $trimmed)) {
                $mistakes['north_arrow'] = 1;
                $remarks[] = '6. North Arrow';
            } elseif (preg_match('/7\.\s*Address/i', $trimmed)) {
                $mistakes['address_title'] = 1;
                $remarks[] = '7. Address/Title';
            } elseif (preg_match('/8\.\s*Area/i', $trimmed)) {
                $mistakes['area'] = 1;
                $remarks[] = '8. Area';
            } elseif (preg_match('/9\.\s*360/i', $trimmed)) {
                $mistakes['views_360'] = 1;
                $remarks[] = '9. 360° Views';
            } elseif (preg_match('/10\.\s*Notes/i', $trimmed)) {
                $mistakes['notes_point'] = 1;
                $remarks[] = '10. Notes';
            } elseif (
                preg_match('/File\s*Formats/i', $trimmed) ||
                preg_match('/Naming/i', $trimmed) ||
                preg_match('/Resolution/i', $trimmed) ||
                preg_match('/Line\s*Weights/i', $trimmed) ||
                preg_match('/No\s*Overlaps/i', $trimmed) ||
                preg_match('/11\.\s*Final/i', $trimmed)
            ) {
                $mistakes['final_files'] = 1;
                // Extract clean label for remarks
                $cleanedLabel = preg_replace('/^[✓✗—\s\-]*(\[(?:YES|NO|UNANSWERED|PASS|FAIL)\])?\s*/i', '', $trimmed);
                $finalFilesFailed[] = $cleanedLabel;
            }
        }

        if (!empty($finalFilesFailed)) {
            $remarks[] = '11. Final Files (' . implode(', ', array_unique($finalFilesFailed)) . ')';
        }

        // Extract any free-text QA Comment / Notes at the bottom: e.g. "QA Comment: kitchen dim missing, wrong north arrow"
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
