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

class MetroExecutiveImportService
{
    protected int $maxPages = 10;

    // ✅ HARD-CODED CONFIG (METRO EXECUTIVE)
    protected string $url = 'https://es-portal.captur3d.io/external_supplier/trueplan_orders?filter=pending';
    protected string $username = 'order@benchmarkstudio.biz';
    protected string $password = 'OgLilaA@yqE1&Rfc';
    protected int $projectId = 6;
    protected string $table = 'project_6_orders';

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
     * Parse HTML table and extract order records.
     */
    protected function parseOrdersFromHtml(string $html, int $projectId, array $auth, ?string $processOrderValue = null): array
    {
        $records = [];

        libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        $dom->loadHTML('<?xml encoding="UTF-8">' . $html);
        $xpath = new DOMXPath($dom);

        $rows = $xpath->query('//table//tr');
        if ($rows->length < 2) {
            return [];
        }

        $headers = [];
        foreach ($rows->item(0)->getElementsByTagName('th') as $th) {
            $headers[] = trim($th->textContent);
        }

        for ($i = 1; $i < $rows->length; $i++) {
            $cells = $rows->item($i)->getElementsByTagName('td');
            if ($cells->length === 0) {
                continue;
            }

            $row = [];
            foreach ($cells as $idx => $cell) {
                if (isset($headers[$idx])) {
                    $row[$headers[$idx]] = trim($cell->textContent);
                }
            }

            $rawOrderId = $row['Order ID'] ?? null;
            if (!$rawOrderId) {
                continue;
            }

            $address = $row['Address'] ?? '';
            $priorityRaw = strtolower(trim($row['Priority'] ?? 'normal'));
            $priority = in_array($priorityRaw, ['low', 'normal', 'high', 'urgent'], true) ? $priorityRaw : 'normal';

            $receivedAt = new DateTime('now', new DateTimeZone('Asia/Karachi'));
            $dueInRaw = trim($row['Due in'] ?? $row['Due In'] ?? '');
            $dueIn = $this->parseDueIn($dueInRaw);

            // Keep import lightweight for frequent cron runs.
            // We only fetch portal table data and do not perform per-order API lookups here.
            $variantNo = null;

            $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));

            $record = [
                'order_number' => $rawOrderId,
                'client_reference' => $rawOrderId,
                'project_id' => $projectId,
                'address' => $address,
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
                    'variant_fetch_method' => 'pending_backfill',
                ]),
                'import_source' => 'cron',
                'year' => $nowPK->format('Y'),
                'month' => $nowPK->format('m'),
                'date' => $nowPK->format('d-m-Y'),
                'created_at' => $nowPK->format('Y-m-d H:i:s'),
                'updated_at' => $nowPK->format('Y-m-d H:i:s'),
            ];

            if ($processOrderValue !== null) {
                $record['process_order'] = $processOrderValue;
            }

            $records[] = $record;
        }

        return $records;
    }

    /**
     * Fetch records from a single URL with pagination.
     */
    protected function fetchFromUrl(string $baseUrl, int $projectId, array $auth, ?string $processOrderValue = null): array
    {
        $allRecords = [];
        $page = 1;
        $username = $auth[0];
        $password = $auth[1];

        while ($page <= $this->maxPages) {
            try {
                $pageUrl = $baseUrl . (str_contains($baseUrl, '?') ? '&' : '?') . 'page=' . $page;

                $response = Http::timeout(60)
                    ->withHeaders([
                        'User-Agent' => 'BenchmarkCron/1.0',
                        'Accept' => 'text/html',
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
                Log::info('Fetched ' . count($pageRecords) . " records from page {$page} of {$baseUrl}");

                $page++;
                usleep(300000);
            } catch (Exception $e) {
                Log::error("Import error on page {$page} from {$baseUrl}: " . $e->getMessage());
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
     * MAIN IMPORT FUNCTION
     */
    public function run()
    {
        $username = $this->username;
        $password = $this->password;
        $projectId = $this->projectId;
        $table = $this->table;

        Log::info("Starting MetroExecutiveImportService for project {$projectId}");

        $pendingOrdersUrl = $this->url;
        Log::info("Fetching pending orders from: {$pendingOrdersUrl}");
        $pendingRecords = $this->fetchFromUrl($pendingOrdersUrl, $projectId, [$username, $password], null);
        Log::info('Pending orders fetch completed: ' . count($pendingRecords) . ' records');

        $processingOrdersUrl = 'https://es-portal.captur3d.io/external_supplier/trueplan_orders?status=processing';
        Log::info("Fetching processing orders from: {$processingOrdersUrl}");
        $processingRecords = $this->fetchFromUrl($processingOrdersUrl, $projectId, [$username, $password], 'yes');
        Log::info('Processing orders fetch completed: ' . count($processingRecords) . ' records');

        $orderMap = [];
        foreach ($pendingRecords as $record) {
            $orderMap[$record['order_number']] = $record;
        }
        foreach ($processingRecords as $record) {
            $orderMap[$record['order_number']] = $record;
        }

        $allRecords = array_values($orderMap);
        $allRecords = $this->normalizeRecordsForInsert($allRecords, $table);

        Log::info('Total unique records after merge: ' . count($allRecords));

        $totalInserted = 0;
        if (!empty($allRecords)) {
            Log::info('Insert-only mode active. Attempting to insert unique records: ' . count($allRecords));
            $totalInserted = (int) DB::table($table)->insertOrIgnore($allRecords);
        }

        Log::info("MetroExecutiveImportService finished. Total inserted: {$totalInserted}");
    }
}