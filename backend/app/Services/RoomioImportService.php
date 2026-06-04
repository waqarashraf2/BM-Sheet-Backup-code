<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use DOMDocument;
use DOMXPath;
use DateTime;
use DateTimeZone;
use Exception;

class RoomioImportService
{
    protected int $maxPages = 10;

    /**
     * Fetch variant number from JSON API
     */
    public function fetchVariantNo(string $orderId, array $auth): ?string
    {
        $cleanId = ltrim($orderId, '#');

        $url = "https://es-portal.captur3d.io/external_supplier/orders/{$cleanId}.json";

        $res = $this->curlRequest($url, 'GET', $auth);

        if ($res['error'] || $res['code'] !== 200) {
            Log::warning("Variant fetch failed for order {$orderId}, HTTP code: {$res['code']}");
            return null;
        }

        $data = json_decode($res['body'], true);

        if (!$data || !isset($data['data']['orderable']['variantName'])) {
            Log::warning("Variant not found in JSON for order {$orderId}");
            return null;
        }

        return $data['data']['orderable']['variantName'];
    }

    /**
     * Simple CURL request
     */
    protected function curlRequest(string $url, string $method = 'GET', ?array $auth = null): array
    {
        $ch = curl_init($url);

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
        ]);

        if ($auth) {
            curl_setopt($ch, CURLOPT_USERPWD, $auth[0] . ':' . $auth[1]);
        }

        $response = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = $response === false ? curl_error($ch) : null;

        curl_close($ch);

        return [
            'code' => $code,
            'body' => $response ?: '',
            'error' => $err
        ];
    }

    /**
     * Convert "About 16 hours" or "2 days" to Pakistan timestamp
     * Only update if due_in crosses current date
     */
protected function parseDueIn(string $dueRaw): string
{
    $dt = new DateTime('now', new DateTimeZone('Asia/Karachi'));
    $raw = strtolower(trim($dueRaw));

    preg_match('/(\d+)/', $raw, $match);
    $value = isset($match[1]) ? (int)$match[1] : 0;

    if ($value <= 0) {
        return $dt->format('Y-m-d H:i:s');
    }

    if (str_contains($raw, 'day')) {
        $dt->modify("+{$value} days");
    } elseif (str_contains($raw, 'hour')) {
        $dt->modify("+{$value} hours");
    } elseif (str_contains($raw, 'minute')) {
        $dt->modify("+{$value} minutes");
    } else {
        $dt->modify("+{$value} hours");
    }

    return $dt->format('Y-m-d H:i:s');
}

    /**
     * Parse HTML table and extract order records
     */
    protected function parseOrdersFromHtml(string $html, int $projectId, ?array $auth = null, ?string $processOrderValue = null): array
    {
        $records = [];

        libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        $dom->loadHTML('<?xml encoding="UTF-8">'.$html);
        $xpath = new DOMXPath($dom);

        $rows = $xpath->query('//table//tr');

        if ($rows->length < 2) {
            return [];
        }

        $headers = [];
        foreach ($rows->item(0)->getElementsByTagName('th') as $th) {
            $headers[] = trim($th->textContent);
        }

        $username = $auth[0] ?? env('EXTERNAL_PORTAL_USERNAME');
        $password = $auth[1] ?? env('EXTERNAL_PORTAL_PASSWORD');

        for ($i=1; $i<$rows->length; $i++) {

            $cells = $rows->item($i)->getElementsByTagName('td');
            if ($cells->length === 0) continue;

            $row = [];
            foreach ($cells as $idx => $cell) {
                if (isset($headers[$idx])) {
                    $row[$headers[$idx]] = trim($cell->textContent);
                }
            }

            $rawOrderId = $row['Order ID'] ?? null;
            if (!$rawOrderId) continue;

            $address = $row['Address'] ?? '';
            $priorityRaw = strtolower(trim($row['Priority'] ?? 'normal'));
            $priority = in_array($priorityRaw, ['low','normal','high','urgent']) ? $priorityRaw : 'normal';

            $receivedAt = new DateTime('now', new DateTimeZone('Asia/Karachi'));
            $dueInRaw = trim($row['Due in'] ?? $row['Due In'] ?? '');
            $dueIn = $this->parseDueIn($dueInRaw);

            // variant_no left null — backfilled after insert to avoid per-order API calls during parse
            $variantNo = null;

            $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));

            $record = [
                'order_number' => $rawOrderId,
                'client_reference' => $rawOrderId,
                'project_id' => $projectId,
                'address' => $address ?? null,
                'priority' => $priority,
                'current_layer' => 'drawer',
                'status' => 'pending',
                'workflow_state' => 'RECEIVED',
                'workflow_type' => 'FP_3_LAYER',
                'received_at' => $receivedAt->format('Y-m-d H:i:s'),
                'due_in' => $dueIn,
                'variant_no' => $variantNo,
                'metadata' => json_encode([
                    'due_in_raw' => $dueInRaw,
                    'variant_fetch_method' => 'pending_backfill'
                ]),
                'import_source' => 'cron',
                'year' => $nowPK->format('Y'),
                'month' => $nowPK->format('m'),
                'date' => $nowPK->format('d-m-Y'),
                'created_at' => $nowPK->format('Y-m-d H:i:s'),
                'updated_at' => $nowPK->format('Y-m-d H:i:s')
            ];

            if ($processOrderValue !== null) {
                $record['process_order'] = $processOrderValue;
            }

            $records[] = $record;
        }

        return $records;
    }

    /**
     * Fetch records from a single URL with pagination
     */
    protected function fetchFromUrl(string $baseUrl, int $projectId, ?array $auth = null, ?string $processOrderValue = null): array
    {
        $allRecords = [];
        $page = 1;
        $username = $auth[0] ?? env('EXTERNAL_PORTAL_USERNAME');
        $password = $auth[1] ?? env('EXTERNAL_PORTAL_PASSWORD');

        while ($page <= $this->maxPages) {
            try {
                $pageUrl = $baseUrl . (str_contains($baseUrl, '?') ? '&' : '?') . 'page=' . $page;

                $response = Http::timeout(60)
                    ->withHeaders([
                        'User-Agent' => 'BenchmarkCron/1.0',
                        'Accept' => 'text/html'
                    ])
                    ->withBasicAuth($username, $password)
                    ->get($pageUrl);

                if (!$response->successful()) {
                    Log::warning("HTTP error {$response->status()} fetching page {$page} from {$baseUrl}");
                    break;
                }

                $pageRecords = $this->parseOrdersFromHtml($response->body(), $projectId, [$username, $password], $processOrderValue);

                if (empty($pageRecords)) {
                    Log::info("No records on page {$page}, stopping pagination for {$baseUrl}");
                    break;
                }

                $allRecords = array_merge($allRecords, $pageRecords);
                Log::info("Fetched ".count($pageRecords)." records from page {$page} of {$baseUrl}");

                $page++;
                usleep(300000);

            } catch (Exception $e) {
                Log::error("Import error on page {$page} from {$baseUrl}: ".$e->getMessage());
                break;
            }
        }

        return $allRecords;
    }

    /**
     * Bulk inserts require every row to have the same keys.
     */
    protected function normalizeRecordsForInsert(array $records, string $table): array
    {
        if (empty($records)) {
            return [];
        }

        $hasProcessOrderColumn = Schema::hasColumn($table, 'process_order');

        foreach ($records as &$record) {
            if ($hasProcessOrderColumn) {
                $record['process_order'] = $record['process_order'] ?? null;
            } else {
                unset($record['process_order']);
            }
        }
        unset($record);

        return $records;
    }

    /**
     * MAIN IMPORT FUNCTION - Fetches from both new and processing orders URLs
     */
    public function run()
    {
        $username = env('EXTERNAL_PORTAL_USERNAME');
        $password = env('EXTERNAL_PORTAL_PASSWORD');
        $projectId = 15;
        $totalInserted = 0;

        Log::info("Starting RoomioImportService for project {$projectId}");

        // Fetch from NEW ORDERS URL
        $newOrdersUrl = env('EXTERNAL_PORTAL_URL'); // https://es-portal.captur3d.io/external_supplier/plann3d_floorplan_orders?filter=pending
        Log::info("Fetching new orders from: {$newOrdersUrl}");
        $newRecords = $this->fetchFromUrl($newOrdersUrl, $projectId, [$username, $password], null);
        Log::info("New orders fetch completed: ".count($newRecords)." records");

        // Fetch from PROCESSING ORDERS URL
        $processingOrdersUrl = 'https://es-portal.captur3d.io/external_supplier/plann3d_floorplan_orders?status=processing';
        Log::info("Fetching processing orders from: {$processingOrdersUrl}");
        $processingRecords = $this->fetchFromUrl($processingOrdersUrl, $projectId, [$username, $password], 'yes');
        Log::info("Processing orders fetch completed: ".count($processingRecords)." records");

        // Build unique total where processing source wins on duplicates.
        $orderMap = [];
        foreach ($newRecords as $record) {
            $orderMap[$record['order_number']] = $record;
        }
        foreach ($processingRecords as $record) {
            $orderMap[$record['order_number']] = $record;
        }
        $allRecords = array_values($orderMap);
        $table = 'project_15_orders';
        $allRecords = $this->normalizeRecordsForInsert($allRecords, $table);

        Log::info("Total unique records after merge: ".count($allRecords));

        if (!empty($allRecords)) {
            Log::info("Insert-only mode active. Attempting to insert unique records: ".count($allRecords));
            $totalInserted = (int) DB::table($table)->insertOrIgnore($allRecords);
        }

        Log::info("RoomioImportService finished. Total inserted: {$totalInserted}");

        // Backfill variant_no for any newly inserted rows that still have it null.
        // This runs AFTER insert so we only hit the API for genuinely new orders,
        // not on every cron cycle for every order on the portal.
        $this->backfillVariantNos($table, $projectId, [$username, $password]);
    }

    /**
     * Fetch and store variant_no for orders that were inserted without one.
     * Processes up to 50 rows per run to stay within cron time limits.
     */
    protected function backfillVariantNos(string $table, int $projectId, array $auth): void
    {
        $rows = DB::table($table)
            ->where('project_id', $projectId)
            ->whereNull('variant_no')
            ->select('id', 'order_number')
            ->orderBy('id', 'desc')
            ->limit(50)
            ->get();

        if ($rows->isEmpty()) {
            Log::info('Variant backfill: no rows need updating.');
            return;
        }

        Log::info("Variant backfill: processing {$rows->count()} rows.");
        $updated = 0;

        foreach ($rows as $row) {
            try {
                $variantNo = $this->fetchVariantNo($row->order_number, $auth);
                if ($variantNo !== null) {
                    DB::table($table)->where('id', $row->id)->update([
                        'variant_no' => $variantNo,
                        'metadata' => DB::raw("JSON_SET(COALESCE(metadata, '{}'), '$.variant_fetch_method', 'detail_page')"),
                        'updated_at' => now(),
                    ]);
                    $updated++;
                } else {
                    Log::info("Variant backfill: no variant found for order {$row->order_number}, will retry next run.");
                }
            } catch (Exception $e) {
                Log::warning("Variant backfill failed for order {$row->order_number}: ".$e->getMessage());
            }
        }

        Log::info("Variant backfill complete: {$updated} of {$rows->count()} rows updated.");
    }
}