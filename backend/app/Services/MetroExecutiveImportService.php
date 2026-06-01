<<<<<<< HEAD
<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use DateTime;
use DateTimeZone;
use Exception;

/**
 * MetroExecutiveImportService
 *
 * Imports Metro Executive (TruePlan) orders from the Captur3d external-supplier
 * portal into project_6_orders (project_id = 6).
 *
 * Portal endpoints:
 *   GET /external_supplier/trueplan_orders.json?filter=pending
 *   GET /external_supplier/trueplan_orders.json?filter=processing
 *
 * Auth: Session-based JSON login (CAPTUR3D_EMAIL / CAPTUR3D_PASSWORD from .env)
 * VARIANT_no: orderableSummary.jobId (e.g. "dPfzx77p9FR-yX8SU2-jc")
 */
class MetroExecutiveImportService
{
    protected int $maxPages  = 10;
    protected int $projectId = 6;
    protected string $table  = 'project_6_orders';

    private const PORTAL_BASE  = 'https://es-portal.captur3d.io';
    private const PORTAL_LOGIN = 'https://es-portal.captur3d.io/external_supplier/login';
    private const COOKIE_FILE  = '/tmp/bms_portal_p6.txt';

    // -------------------------------------------------------------------------
    // Session login
    // -------------------------------------------------------------------------

    private function portalLogin(): bool
    {
        $email    = env('CAPTUR3D_EMAIL');
        $password = env('CAPTUR3D_PASSWORD');

        if (!$email || !$password) {
            Log::error('MetroExecutiveImportService: CAPTUR3D_EMAIL / CAPTUR3D_PASSWORD not set');
            return false;
        }

        // Step 1: GET login page to capture CSRF token
        $ch = curl_init(self::PORTAL_LOGIN);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_COOKIEJAR      => self::COOKIE_FILE,
            CURLOPT_COOKIEFILE     => self::COOKIE_FILE,
            CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
        ]);
        $html = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (!$html || $code !== 200) {
            Log::error("MetroExecutiveImportService: Login page fetch failed (HTTP {$code})");
            return false;
        }

        if (!preg_match('/name="csrf-token"\s+content="([^"]+)"/', $html, $m)) {
            Log::error('MetroExecutiveImportService: CSRF token not found');
            return false;
        }
        $csrf = $m[1];

        // Step 2: POST JSON credentials
        $payload = json_encode([
            'external_supplier_user' => ['email' => $email, 'password' => $password],
        ]);

        $ch = curl_init(self::PORTAL_LOGIN);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_HTTPHEADER     => [
                'Content-Type: application/json',
                'Accept: application/json',
                "X-CSRF-Token: {$csrf}",
                'Origin: ' . self::PORTAL_BASE,
                'Referer: ' . self::PORTAL_LOGIN,
            ],
            CURLOPT_COOKIEJAR      => self::COOKIE_FILE,
            CURLOPT_COOKIEFILE     => self::COOKIE_FILE,
            CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code !== 200 || str_contains((string) $body, '"errors"')) {
            Log::error("MetroExecutiveImportService: Login POST failed (HTTP {$code})");
            return false;
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // Fetch one JSON page
    // -------------------------------------------------------------------------

    private function fetchOrdersPage(string $url): ?array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
            CURLOPT_COOKIEFILE     => self::COOKIE_FILE,
            CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code !== 200 || !$body) {
            Log::warning("MetroExecutiveImportService: JSON fetch HTTP {$code} for {$url}");
            return null;
        }

        $decoded = json_decode($body, true);
        return $decoded['data'] ?? null;
    }

    // -------------------------------------------------------------------------
    // Map a JSON order to a DB record
    // -------------------------------------------------------------------------

    private function mapOrder(array $o, ?string $processOrderValue = null): array
    {
        $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));

        $priorityMap = ['low' => 'low', 'high' => 'high', 'urgent' => 'urgent'];
        $priority    = $priorityMap[strtolower($o['priority'] ?? '')] ?? 'normal';

        $receivedAt = $this->parseIsoTs($o['orderedAt'] ?? '');
        $dueIn      = $this->parseIsoTs($o['deliveryDeadline'] ?? $o['targetDeadline'] ?? '');

        $record = [
            'order_number'     => '#' . $o['id'],
            'client_reference' => '#' . $o['id'],
            'project_id'       => $this->projectId,
            'address'          => $o['propertyAddress'] ?? null,
            'priority'         => $priority,
            'current_layer'    => 'drawer',
            'status'           => 'pending',
            'workflow_state'   => 'RECEIVED',
            'workflow_type'    => 'FP_3_LAYER',
            'received_at'      => $receivedAt,
            'due_in'           => $dueIn,
            'VARIANT_no'       => $o['orderableSummary']['jobId'] ?? null,
            'metadata'         => json_encode([
                'jobId'         => $o['orderableSummary']['jobId']         ?? null,
                'squareFootage' => $o['orderableSummary']['squareFootage'] ?? null,
                'providerName'  => $o['providerName']                      ?? null,
                'orderedAt'     => $o['orderedAt']                         ?? null,
            ], JSON_UNESCAPED_UNICODE),
            'import_source'    => 'cron',
            'year'             => (int) $nowPK->format('Y'),
            'month'            => (int) $nowPK->format('m'),
            'date'             => $nowPK->format('d-m-Y'),
            'created_at'       => $nowPK->format('Y-m-d H:i:s'),
            'updated_at'       => $nowPK->format('Y-m-d H:i:s'),
        ];

        if ($processOrderValue !== null) {
            $record['process_order'] = $processOrderValue;
        }

        return $record;
    }

    // -------------------------------------------------------------------------
    // Fetch all pages for a given filter
    // -------------------------------------------------------------------------

    private function fetchAllOrders(string $filter, ?string $processOrderValue = null): array
    {
        $allOrders = [];
        $baseUrl   = self::PORTAL_BASE . '/external_supplier/trueplan_orders.json?filter=' . $filter;

        for ($page = 1; $page <= $this->maxPages; $page++) {
            $data = $this->fetchOrdersPage($baseUrl . '&page=' . $page);

            if ($data === null) {
                break;
            }

            $orders = $data['orders'] ?? [];
            if (empty($orders)) {
                break;
            }

            foreach ($orders as $o) {
                $allOrders[$o['id']] = $this->mapOrder($o, $processOrderValue);
            }

            $totalPages = (int) ($data['meta']['totalPages'] ?? 1);
            if ($page >= $totalPages) {
                break;
            }

            usleep(300000);
        }

        return $allOrders;
    }

    // -------------------------------------------------------------------------
    // ISO timestamp → PKT datetime string
    // -------------------------------------------------------------------------

    private function parseIsoTs(string $raw): string
    {
        if ($raw === '') {
            return (new DateTime('now', new DateTimeZone('Asia/Karachi')))->format('Y-m-d H:i:s');
        }
        try {
            $dt = new DateTime($raw);
            $dt->setTimezone(new DateTimeZone('Asia/Karachi'));
            return $dt->format('Y-m-d H:i:s');
        } catch (Exception $e) {
            return (new DateTime('now', new DateTimeZone('Asia/Karachi')))->format('Y-m-d H:i:s');
        }
    }

    // -------------------------------------------------------------------------
    // Main entry point
    // -------------------------------------------------------------------------

    public function run(): void
    {
        Log::info("MetroExecutiveImportService: starting import for project {$this->projectId}");

        if (!$this->portalLogin()) {
            Log::error('MetroExecutiveImportService: portal login failed — aborting');
            return;
        }

        $pending    = $this->fetchAllOrders('pending',    null);
        $processing = $this->fetchAllOrders('processing', 'yes');
        $allOrders  = array_values(array_replace($pending, $processing));

        Log::info('MetroExecutiveImportService: fetched ' . count($allOrders) . ' orders (pending + processing)');

        if (file_exists(self::COOKIE_FILE)) {
            @unlink(self::COOKIE_FILE);
        }

        if (empty($allOrders)) {
            Log::info('MetroExecutiveImportService: no orders to insert');
            return;
        }

        $hasProcessOrder = Schema::hasColumn($this->table, 'process_order');
        if (!$hasProcessOrder) {
            $allOrders = array_map(function ($r) {
                unset($r['process_order']);
                return $r;
            }, $allOrders);
        }

        $inserted = (int) DB::table($this->table)->insertOrIgnore($allOrders);

        Log::info("MetroExecutiveImportService: finished — {$inserted} new record(s) inserted into {$this->table}");
    }
}
=======
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
    protected int $jsonLookbackDays = 180;

    // ✅ HARD-CODED CONFIG (METRO EXECUTIVE)
    protected string $url = 'https://es-portal.captur3d.io/external_supplier/trueplan_orders?status=pending';
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
     * Build JSON API URL with explicit UTC date range to avoid portal default filters.
     */
    protected function buildJsonOrdersUrl(string $status): string
    {
        $startUtc = new DateTime('now', new DateTimeZone('UTC'));
        $startUtc->modify('-' . $this->jsonLookbackDays . ' days')->setTime(0, 0, 0, 0);

        $endUtc = new DateTime('now', new DateTimeZone('UTC'));
        $endUtc->setTime(23, 59, 59, 999000);

        $query = http_build_query([
            'status' => $status,
            'start_date' => $startUtc->format('Y-m-d\TH:i:s.v\Z'),
            'end_date' => $endUtc->format('Y-m-d\TH:i:s.v\Z'),
            'per_page' => 100,
        ]);

        return 'https://es-portal.captur3d.io/external_supplier/trueplan_orders.json?' . $query;
    }

    /**
     * Convert API date into Pakistan local timestamp.
     */
    protected function toPkTimestamp(?string $value): string
    {
        $fallback = new DateTime('now', new DateTimeZone('Asia/Karachi'));
        if (empty($value)) {
            return $fallback->format('Y-m-d H:i:s');
        }

        try {
            $dt = new DateTime($value);
            $dt->setTimezone(new DateTimeZone('Asia/Karachi'));
            return $dt->format('Y-m-d H:i:s');
        } catch (Exception $e) {
            Log::warning('Failed to parse API timestamp, using current time', [
                'value' => $value,
                'error' => $e->getMessage(),
            ]);

            return $fallback->format('Y-m-d H:i:s');
        }
    }

    /**
     * Map a single JSON order payload into local DB format.
     */
    protected function mapJsonOrderToRecord(array $order, int $projectId, ?string $processOrderValue = null): ?array
    {
        $orderId = isset($order['id']) ? (string) $order['id'] : null;
        if (!$orderId) {
            return null;
        }

        $priorityRaw = strtolower(trim((string) ($order['priority'] ?? 'normal')));
        if ($priorityRaw === 'regular') {
            $priorityRaw = 'normal';
        }
        $priority = in_array($priorityRaw, ['low', 'normal', 'high', 'urgent'], true) ? $priorityRaw : 'normal';

        $dueRaw = $order['deliveryDeadline'] ?? $order['targetDeadline'] ?? null;
        $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));

        $record = [
            'order_number' => $orderId,
            'client_reference' => (string) ($order['requestId'] ?? $orderId),
            'project_id' => $projectId,
            'address' => (string) ($order['propertyAddress'] ?? ''),
            'priority' => $priority,
            'current_layer' => 'drawer',
            'status' => 'pending',
            'workflow_state' => 'RECEIVED',
            'workflow_type' => 'FP_3_LAYER',
            'received_at' => $this->toPkTimestamp($order['orderedAt'] ?? null),
            'due_in' => $this->toPkTimestamp($dueRaw),
            'variant_no' => null,
            'metadata' => json_encode([
                'source' => 'trueplan_orders_json',
                'portal_status' => $order['status'] ?? null,
                'provider_name' => $order['providerName'] ?? null,
                'supplier_name' => $order['supplierName'] ?? null,
                'ordered_at' => $order['orderedAt'] ?? null,
                'started_at' => $order['startedAt'] ?? null,
                'delivery_deadline' => $order['deliveryDeadline'] ?? null,
                'target_deadline' => $order['targetDeadline'] ?? null,
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

        return $record;
    }

    /**
     * Fetch orders from JSON endpoint with pagination.
     */
    protected function fetchFromJsonUrl(string $baseUrl, int $projectId, array $auth, ?string $processOrderValue = null): array
    {
        $allRecords = [];
        $hadSuccessfulResponse = false;
        $page = 1;
        $username = $auth[0];
        $password = $auth[1];

        while ($page <= $this->maxPages) {
            try {
                $pageUrl = $baseUrl . '&page=' . $page;

                $response = Http::timeout(60)
                    ->withHeaders([
                        'User-Agent' => 'BenchmarkCron/1.0',
                        'Accept' => 'application/json',
                    ])
                    ->withBasicAuth($username, $password)
                    ->get($pageUrl);

                if (!$response->successful()) {
                    Log::warning("JSON HTTP error {$response->status()} fetching page {$page} from {$baseUrl}");
                    break;
                }

                $hadSuccessfulResponse = true;
                $payload = $response->json();
                $orders = $payload['data']['orders'] ?? [];

                if (empty($orders)) {
                    Log::info("No JSON orders on page {$page}, stopping pagination for {$baseUrl}");
                    break;
                }

                foreach ($orders as $order) {
                    $record = $this->mapJsonOrderToRecord($order, $projectId, $processOrderValue);
                    if ($record !== null) {
                        $allRecords[] = $record;
                    }
                }

                Log::info('Fetched ' . count($orders) . " JSON orders from page {$page} of {$baseUrl}");

                $meta = $payload['data']['meta'] ?? [];
                $totalPages = (int) ($meta['totalPages'] ?? 0);
                if ($totalPages > 0 && $page >= $totalPages) {
                    break;
                }

                $page++;
                usleep(300000);
            } catch (Exception $e) {
                Log::error("JSON import error on page {$page} from {$baseUrl}: " . $e->getMessage());
                break;
            }
        }

        return [
            'records' => $allRecords,
            'ok' => $hadSuccessfulResponse,
        ];
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

        $pendingJsonUrl = $this->buildJsonOrdersUrl('pending');
        Log::info("Fetching pending orders from JSON: {$pendingJsonUrl}");
        $pendingJson = $this->fetchFromJsonUrl($pendingJsonUrl, $projectId, [$username, $password], null);
        $pendingRecords = $pendingJson['records'];
        if (!$pendingJson['ok']) {
            $pendingOrdersUrl = $this->url;
            Log::warning("Pending JSON fetch failed, falling back to HTML: {$pendingOrdersUrl}");
            $pendingRecords = $this->fetchFromUrl($pendingOrdersUrl, $projectId, [$username, $password], null);
        }
        Log::info('Pending orders fetch completed: ' . count($pendingRecords) . ' records');

        $processingJsonUrl = $this->buildJsonOrdersUrl('processing');
        Log::info("Fetching processing orders from JSON: {$processingJsonUrl}");
        $processingJson = $this->fetchFromJsonUrl($processingJsonUrl, $projectId, [$username, $password], 'yes');
        $processingRecords = $processingJson['records'];
        if (!$processingJson['ok']) {
            $processingOrdersUrl = 'https://es-portal.captur3d.io/external_supplier/trueplan_orders?status=processing';
            Log::warning("Processing JSON fetch failed, falling back to HTML: {$processingOrdersUrl}");
            $processingRecords = $this->fetchFromUrl($processingOrdersUrl, $projectId, [$username, $password], 'yes');
        }
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
>>>>>>> 83d9918 (message)
