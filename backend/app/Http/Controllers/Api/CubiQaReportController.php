<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\WorkItem;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

class CubiQaReportController extends Controller
{
    private const PROJECT_ID = 16;

    public function index(Request $request)
    {
        $startDate = $request->query('start_date');
        $endDate = $request->query('end_date');

        if ($startDate && $endDate) {
            $startDateStr = Carbon::parse((string) $startDate, 'Asia/Karachi')->toDateString();
            $endDateStr = Carbon::parse((string) $endDate, 'Asia/Karachi')->toDateString();
            $date = $startDateStr;
            $shiftStartPkt = Carbon::parse($startDateStr, 'Asia/Karachi')->subDay()->setTime(22, 0, 0);
            $shiftEndPkt = Carbon::parse($endDateStr, 'Asia/Karachi')->setTime(22, 0, 0);
            $isRange = ($startDateStr !== $endDateStr);
            $displayDate = $isRange
                ? Carbon::parse($startDateStr, 'Asia/Karachi')->format('d-M') . ' TO ' . Carbon::parse($endDateStr, 'Asia/Karachi')->format('d-M')
                : Carbon::parse($startDateStr, 'Asia/Karachi')->format('d-M');
        } else {
            $date = $this->selectedDate($request);
            [$shiftStartPkt, $shiftEndPkt] = $this->shiftBounds($date);
            $displayDate = Carbon::parse($date, 'Asia/Karachi')->format('d-M');
        }

        $shiftStartUtc = $shiftStartPkt->copy()->utc();
        $shiftEndUtc = $shiftEndPkt->copy()->utc();

        // Option B: Query orders received within this shift window (received_at)
        $shiftOrderIds = [];
        if (Schema::hasTable('project_16_orders') && Schema::hasColumn('project_16_orders', 'received_at')) {
            $shiftOrderIds = DB::table('project_16_orders')
                ->where('received_at', '>=', $shiftStartPkt->format('Y-m-d H:i:s'))
                ->where('received_at', '<', $shiftEndPkt->format('Y-m-d H:i:s'))
                ->pluck('id')
                ->all();
        }

        $workItemsQuery = WorkItem::query()
            ->with('assignedUser:id,name')
            ->where('project_id', self::PROJECT_ID)
            ->where('stage', 'QA')
            ->where('status', 'completed');

        if (!empty($shiftOrderIds)) {
            $workItemsQuery->whereIn('order_id', $shiftOrderIds);
        } else {
            // Force empty result set if no orders were received in this shift
            $workItemsQuery->whereRaw('1 = 0');
        }

        $workItems = $workItemsQuery->orderBy('completed_at', 'desc')
            ->get()
            ->unique('order_id')
            ->reverse()
            ->values();

        $orderRows = $this->projectOrderRows($workItems->pluck('order_id')->filter()->unique()->values()->all());

        $rowsByChecker = [];
        $qaCounts = [];

        foreach ($workItems as $item) {
            $order = $orderRows[(int) $item->order_id] ?? null;
            $checkerName = trim((string) ($order->checker_name ?? ''));
            if ($checkerName === '') {
                $checkerName = 'Unassigned Checker';
            }

            $qaName = trim((string) ($item->assignedUser->name ?? ''));
            if ($qaName === '') {
                $qaName = 'Unknown QA';
            }

            $parsed = $this->parseCubiComment((string) ($item->comments ?? ''));

            if (!isset($rowsByChecker[$checkerName])) {
                $rowsByChecker[$checkerName] = [
                    'checker_name' => $checkerName,
                    'total_plans' => 0,
                    'bw' => 0,
                    'bugs' => 0,
                    'mb' => 0,
                    'ok' => 0,
                    'mistakes_remarks' => [],
                ];
            }

            $rowsByChecker[$checkerName]['total_plans']++;
            $rowsByChecker[$checkerName]['bw'] += $parsed['bw'];
            $rowsByChecker[$checkerName]['bugs'] += $parsed['bugs'];
            $rowsByChecker[$checkerName]['mb'] += $parsed['mb'];
            $rowsByChecker[$checkerName]['ok'] += $parsed['ok'];

            foreach ($parsed['remarks'] as $remark) {
                $rowsByChecker[$checkerName]['mistakes_remarks'][] = $remark;
            }

            $qaCounts[$qaName] = ($qaCounts[$qaName] ?? 0) + 1;
        }

        $rows = collect($rowsByChecker)
            ->map(function (array $row) {
                $row['mistakes_remarks'] = implode('. ', array_values(array_unique(array_filter($row['mistakes_remarks']))));
                return $row;
            })
            ->sortBy('checker_name', SORT_NATURAL | SORT_FLAG_CASE)
            ->values();

        $totals = [
            'total_plans' => (int) $rows->sum('total_plans'),
            'bw' => (int) $rows->sum('bw'),
            'bugs' => (int) $rows->sum('bugs'),
            'mb' => (int) $rows->sum('mb'),
            'ok' => (int) $rows->sum('ok'),
        ];

        $percentages = [
            'total_plans' => $totals['total_plans'] > 0 ? 100.0 : 0.0,
            'bw' => $this->percentage($totals['bw'], $totals['total_plans']),
            'bugs' => $this->percentage($totals['bugs'], $totals['total_plans']),
            'mb' => $this->percentage($totals['mb'], $totals['total_plans']),
            'ok' => $this->percentage($totals['ok'], $totals['total_plans']),
        ];

        return response()->json([
            'success' => true,
            'project_id' => self::PROJECT_ID,
            'selected_date' => $date,
            'selected_date_display' => $displayDate,
            'start_time' => $shiftStartPkt->format('Y-m-d H:i:s'),
            'end_time' => $shiftEndPkt->format('Y-m-d H:i:s'),
            'rows' => $rows,
            'totals' => $totals,
            'percentages' => $percentages,
            'upload_summary' => $this->uploadSummary($shiftStartPkt, $shiftEndPkt),
            'qa_counts' => collect($qaCounts)
                ->map(fn ($count, $name) => ['name' => $name, 'count' => (int) $count])
                ->sortByDesc('count')
                ->values(),
        ]);
    }

    private function selectedDate(Request $request): string
    {
        if ($request->query('date')) {
            return Carbon::parse((string) $request->query('date'), 'Asia/Karachi')->toDateString();
        }

        $now = now('Asia/Karachi');
        return $now->hour >= 22
            ? $now->copy()->addDay()->toDateString()
            : $now->toDateString();
    }

    private function shiftBounds(string $date): array
    {
        $selectedDate = Carbon::parse($date, 'Asia/Karachi');

        return [
            $selectedDate->copy()->subDay()->setTime(22, 0, 0),
            $selectedDate->copy()->setTime(22, 0, 0),
        ];
    }

    private function projectOrderRows(array $orderIds): array
    {
        if (
            empty($orderIds)
            || !Schema::hasTable('project_16_orders')
            || !Schema::hasColumn('project_16_orders', 'checker_name')
        ) {
            return [];
        }

        return DB::table('project_16_orders')
            ->whereIn('id', $orderIds)
            ->get(['id', 'checker_name'])
            ->keyBy('id')
            ->all();
    }

    private function parseCubiComment(string $comment): array
    {
        $remarks = [
            $this->extractText($comment, 'BW Bugs Comment'),
            $this->extractText($comment, 'Other Field Comment'),
            $this->extractText($comment, 'MB OK Comment'),
            $this->extractText($comment, 'OK Field Comment'),
            $this->extractText($comment, 'Notes'),
        ];

        return [
            'bw' => $this->extractCount($comment, 'BW Bugs Count'),
            'bugs' => $this->extractCount($comment, 'Other Field Count'),
            'mb' => $this->extractCount($comment, 'MB OK Count'),
            'ok' => $this->extractCount($comment, 'OK Field Count'),
            'remarks' => collect($remarks)
                ->map(fn ($value) => trim((string) $value))
                ->filter(fn ($value) => $value !== '' && preg_match('/^[\s\-\x{2013}\x{2014}]+$/u', $value) !== 1)
                ->values()
                ->all(),
        ];
    }

    private function extractCount(string $comment, string $label): int
    {
        $pattern = '/(?:^|\n)\s*-?\s*' . preg_quote($label, '/') . '\s*:\s*(\d+)/i';

        if (preg_match($pattern, $comment, $matches) !== 1) {
            return 0;
        }

        return (int) $matches[1];
    }

    private function extractText(string $comment, string $label): string
    {
        $labels = [
            'BW Bugs Count',
            'BW Bugs Comment',
            'MB OK Count',
            'MB OK Comment',
            'Other Field Count',
            'Other Field Comment',
            'OK Field Count',
            'OK Field Comment',
            'Notes',
        ];

        $alternates = collect($labels)
            ->reject(fn ($item) => $item === $label)
            ->map(fn ($item) => preg_quote($item, '/'))
            ->implode('|');

        $pattern = '/(?:^|\n)\s*-?\s*' . preg_quote($label, '/') . '\s*:\s*([\s\S]*?)(?=\n\s*-?\s*(?:' . $alternates . ')\s*:|\z)/i';

        if (preg_match($pattern, $comment, $matches) !== 1) {
            return '';
        }

        $value = trim($matches[1]);
        return in_array($value, ['-', '--'], true) ? '' : $value;
    }

    private function uploadSummary(Carbon $shiftStartPkt, Carbon $shiftEndPkt): array
    {
        if (
            !Schema::hasTable('project_16_orders')
            || !Schema::hasColumn('project_16_orders', 'received_at')
            || !Schema::hasColumn('project_16_orders', 'final_upload')
        ) {
            return ['date' => $shiftEndPkt->format('j-M'), 'total_plans' => 0, 'upload' => 0, 'pending' => 0];
        }

        $query = DB::table('project_16_orders')
            ->where('received_at', '>=', $shiftStartPkt->format('Y-m-d H:i:s'))
            ->where('received_at', '<', $shiftEndPkt->format('Y-m-d H:i:s'));

        $total = (clone $query)->count();
        $upload = (clone $query)->where('final_upload', 'yes')->count();

        return [
            'date' => $shiftEndPkt->format('j-M'),
            'total_plans' => (int) $total,
            'upload' => (int) $upload,
            'pending' => max(0, (int) $total - (int) $upload),
        ];
    }

    private function percentage(int $value, int $total): float
    {
        if ($total <= 0) {
            return 0.0;
        }

        return round(($value / $total) * 100, 1);
    }
}
