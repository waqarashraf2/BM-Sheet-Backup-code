<?php

namespace App\Services\QaReport\Contracts;

interface ChecklistParserInterface
{
    /**
     * Get the ordered list of checklist column keys and their display labels.
     *
     * @return array<string, string> Key => Display Label
     */
    public function getColumns(): array;

    /**
     * Parse a completed work_item comment.
     *
     * @param string $comment
     * @return array{
     *     column_mistakes: array<string, int>,
     *     total_mistakes: int,
     *     remarks: array<string>
     * }
     */
    public function parse(string $comment): array;
}
