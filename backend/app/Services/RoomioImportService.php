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
    protected string $externalPortalUrl = 'https://es-portal.captur3d.io/external_supplier/plann3d_floorplan_orders?filter=pending';
    protected string $externalPortalUsername = 'wgondal835@gmail.com';
    protected string $externalPortalPassword = 'Ca35@$35';
    protected string $externalPortalStartUrl = 'https://es-portal.captur3d.io/external_supplier/orders/%s/start';
    protected int $maxPages = 200;
    protected string $jsonOrdersUrl = 'https://es-portal.captur3d.io/external_supplier/plann3d_floorplan_orders.json';
    protected string $legacyJsonOrdersUrl = 'https://es-portal.captur3d.io/external_supplier/floorplan_orders.json';
    protected string $portalLoginUrl = 'https://es-portal.captur3d.io/external_supplier/login';
    protected int $activeProjectId = 15;
    protected array $lastErrors = [];
    protected array $sessionCookies = [];
    protected bool $sessionAuthenticated = false;
    protected int $variantBackfillBatchSize = 10;

    /**
     * Fetch variant number from JSON API
     */
    public function fetchVariantNo(string $orderId, array $auth): ?string
    {
        $cleanId = ltrim($orderId, '#');

        $response = $this->requestOrderDetails($cleanId, $auth);
        if (!$response->successful()) {
            Log::warning("Variant fetch failed for order {$orderId}, HTTP code: {$response->status()}");
            return null;
        }

        $data = $response->json();

        if (!is_array($data)) {
            Log::warning("Variant fetch returned invalid JSON for order {$orderId}");
            return null;
        }

        $orderData = $data['data'] ?? $data;
        if (is_array($orderData)) {
            $variant = $this->extractVariantNameFromOrder($orderData);
            if ($variant !== null) {
                return $variant;
            }
        }

        Log::warning("Variant not found in JSON for order {$orderId}");
        return '';
    }

    /**
     * Safely request order details endpoint with auth fallbacks.
     */
    protected function requestOrderDetails(string $orderId, array $auth)
    {
        $urlTemplate = (string) env('ROOMIO_ORDER_DETAILS_URL_TEMPLATE', 'https://es-portal.captur3d.io/external_supplier/orders/{id}.json');
        $url = str_replace('{id}', urlencode($orderId), $urlTemplate);

        $headers = [
            'User-Agent' => 'BenchmarkCron/1.0',
            'Accept' => 'application/json',
        ];

        $token = env('ROOMIO_API_TOKEN');
        if (!empty($token)) {
            $tokenResponse = Http::timeout(60)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders([
                    ...$headers,
                    'Authorization' => 'Bearer ' . $token,
                ])
                ->get($url);

            if ($tokenResponse->successful()) {
                return $tokenResponse;
            }
        }

        $basicResponse = Http::timeout(60)
            ->withOptions(['curl' => [CURLOPT_PROXY => '']])
            ->withHeaders($headers)
            ->withBasicAuth($auth[0] ?? '', $auth[1] ?? '')
            ->get($url);

        if ($basicResponse->successful()) {
            return $basicResponse;
        }

        if ($this->ensurePortalSession($auth)) {
            $host = parse_url($url, PHP_URL_HOST) ?: 'es-portal.captur3d.io';
            $sessionResponse = Http::timeout(60)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders($headers)
                ->withCookies($this->sessionCookies, $host)
                ->get($url);

            if ($sessionResponse->successful()) {
                return $sessionResponse;
            }
        }

        return Http::timeout(60)
            ->withOptions(['curl' => [CURLOPT_PROXY => '']])
            ->withHeaders($headers)
            ->get($url);
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

        $username = $auth[0] ?? $this->externalPortalUsername;
        $password = $auth[1] ?? $this->externalPortalPassword;

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
     * Parse the new Captur3D JSON response shape:
     * data.orders[] plus data.meta pagination.
     */
    protected function parseOrdersFromJson(array $payload, int $projectId, ?string $processOrderValue = null): array
    {
        $orders = $payload['data']['orders'] ?? $payload['orders'] ?? [];
        if (!is_array($orders)) {
            return [];
        }

        $records = [];
        foreach ($orders as $order) {
            if (!is_array($order)) {
                continue;
            }

            $rawOrderId = $order['id'] ?? null;
            if (!$rawOrderId) {
                Log::warning('Roomio JSON order skipped because id is missing', ['order' => $order]);
                continue;
            }

            $orderNumber = (string) $rawOrderId;
            $portalStatus = strtolower((string) ($order['status'] ?? 'pending'));
            $priority = $this->normalizePriority($order['priority'] ?? null);
            $variantNo = $this->extractVariantNameFromOrder($order);
            $receivedAt = $this->parsePortalDate($order['orderedAt'] ?? null) ?? new DateTime('now', new DateTimeZone('Asia/Karachi'));
            $deadline = $this->parsePortalDate(
                $order['deliveryDeadline']
                    ?? $order['targetDeadline']
                    ?? $order['customerDeliveryDeadline']
                    ?? null
            );
            $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));

            $metadata = [
                'portal_status' => $portalStatus,
                'provider_name' => $order['providerName'] ?? null,
                'request_id' => $order['requestId'] ?? null,
                'orderable_type' => $order['orderableType'] ?? null,
                'orderable_summary' => $order['orderableSummary'] ?? null,
                'target_deadline' => $order['targetDeadline'] ?? null,
                'customer_delivery_deadline' => $order['customerDeliveryDeadline'] ?? null,
                'delivery_deadline' => $order['deliveryDeadline'] ?? null,
                'assigned_user_name' => $order['assignedUserName'] ?? null,
                'supplier_name' => $order['supplierName'] ?? null,
                'variant_fetch_method' => $variantNo ? 'orders_json' : 'pending_backfill',
                'source_response' => 'json',
            ];

            $record = [
                'order_number' => $orderNumber,
                'client_reference' => (string) ($order['requestId'] ?? $orderNumber),
                'client_portal_id' => $orderNumber,
                'project_id' => $projectId,
                'address' => $order['propertyAddress'] ?? null,
                'priority' => $priority,
                'current_layer' => 'drawer',
                'status' => 'pending',
                'workflow_state' => 'RECEIVED',
                'workflow_type' => 'FP_3_LAYER',
                'received_at' => $receivedAt->format('Y-m-d H:i:s'),
                'due_date' => $deadline ? $deadline->format('Y-m-d') : null,
                'due_in' => $deadline ? $deadline->format('Y-m-d H:i:s') : null,
                'variant_no' => $variantNo,
                'plan_type' => $order['orderableSummary']['combinationType'] ?? null,
                'project_type' => $order['orderableSummary']['sourceType'] ?? null,
                'metadata' => json_encode($metadata),
                'import_source' => 'cron',
                'year' => $receivedAt->format('Y'),
                'month' => $receivedAt->format('m'),
                'date' => $receivedAt->format('d-m-Y'),
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

    protected function extractVariantNameFromOrder(array $order): ?string
    {
        $candidates = [
            $order['orderable']['variantName'] ?? null,
            $order['orderable']['variant_name'] ?? null,
            $order['orderableSummary']['variantName'] ?? null,
            $order['orderableSummary']['variant_name'] ?? null,
            $order['variantName'] ?? null,
            $order['variant_name'] ?? null,
            $order['variant'] ?? null,
        ];

        foreach ($candidates as $candidate) {
            if ($candidate === null) {
                continue;
            }

            $value = trim((string) $candidate);
            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    protected function normalizePriority(?string $priorityRaw): string
    {
        $priorityRaw = strtolower(trim((string) $priorityRaw));

        return match ($priorityRaw) {
            'urgent', 'rush' => 'urgent',
            'high' => 'high',
            'low' => 'low',
            default => 'normal',
        };
    }

    protected function parsePortalDate(?string $raw): ?DateTime
    {
        if (!$raw) {
            return null;
        }

        try {
            $dt = new DateTime($raw);
            $dt->setTimezone(new DateTimeZone('Asia/Karachi'));
            return $dt;
        } catch (Exception $e) {
            Log::warning("Roomio date parse failed for value {$raw}: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Fetch records from a single URL with pagination
     */
    protected function fetchFromUrl(string $baseUrl, int $projectId, ?array $auth = null, ?string $processOrderValue = null): array
    {
        $allRecords = [];
        $page = 1;
        $username = $auth[0] ?? $this->externalPortalUsername;
        $password = $auth[1] ?? $this->externalPortalPassword;

        while ($page <= $this->maxPages) {
            try {
                $pageUrl = $baseUrl . (str_contains($baseUrl, '?') ? '&' : '?') . 'page=' . $page;

                $response = Http::timeout(60)
                    ->withOptions(['curl' => [CURLOPT_PROXY => '']])
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
     * Fetch records from the new JSON endpoint. Pagination is controlled by
     * response meta.totalPages so all portal pages are consumed.
     */
    protected function fetchJsonStatus(string $status, int $projectId, array $auth, ?string $processOrderValue = null): array
    {
        $allRecords = [];
        $page = 1;
        $totalPages = null;
        $ordersUrl = $this->resolveOrdersUrlForStatus($status);
        [$startDate, $endDate] = $this->buildJsonDateWindow();

        while ($page <= $this->maxPages && ($totalPages === null || $page <= $totalPages)) {
            try {
                $query = $this->buildOrdersQuery($ordersUrl, $status, $page, $startDate, $endDate);

                $response = $this->requestJsonOrders($ordersUrl, $query, $auth);

                if (!$response->successful()) {
                    $this->lastErrors[] = "HTTP {$response->status()} fetching {$status} page {$page}";
                    Log::warning("Roomio JSON HTTP error {$response->status()} fetching {$status} page {$page}", [
                        'url' => $ordersUrl,
                        'query' => $query,
                        'body_preview' => substr($response->body(), 0, 300),
                    ]);
                    break;
                }

                $payload = $response->json();
                if (!is_array($payload)) {
                    $this->lastErrors[] = "Invalid JSON fetching {$status} page {$page}";
                    Log::warning("Roomio JSON response was not valid JSON for {$status} page {$page}");
                    break;
                }

                $meta = $payload['data']['meta'] ?? [];
                $totalPages = max(1, (int) ($meta['totalPages'] ?? $totalPages ?? 1));
                $pageRecords = $this->parseOrdersFromJson($payload, $projectId, $processOrderValue);

                Log::info("Roomio JSON fetched " . count($pageRecords) . " {$status} records from page {$page}/{$totalPages}", [
                    'total_count' => $meta['totalCount'] ?? null,
                    'orders_tab_count' => $meta['ordersTabCount'] ?? null,
                    'status_counts' => $meta['statusCounts'] ?? null,
                ]);

                $allRecords = array_merge($allRecords, $pageRecords);

                if ($page >= $totalPages) {
                    break;
                }

                $page++;
                usleep(300000);
            } catch (Exception $e) {
                $this->lastErrors[] = "Exception fetching {$status} page {$page}: " . $e->getMessage();
                Log::error("Roomio JSON import error for {$status} page {$page}: " . $e->getMessage());
                break;
            }
        }

        if ($totalPages !== null && $totalPages > $this->maxPages) {
            Log::warning("Roomio JSON pagination hit maxPages={$this->maxPages} for {$status}; totalPages={$totalPages}");
        }

        return $allRecords;
    }

    protected function requestJsonOrders(string $ordersUrl, array $query, array $auth)
    {
        $headers = [
            'User-Agent' => 'BenchmarkCron/1.0',
            'Accept' => 'application/json',
        ];

        $token = env('ROOMIO_API_TOKEN');
        if (!empty($token)) {
            return Http::timeout(60)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders([
                    ...$headers,
                    'Authorization' => 'Bearer ' . $token,
                ])
                ->get($ordersUrl, $query);
        }

        $response = Http::timeout(60)
            ->withOptions(['curl' => [CURLOPT_PROXY => '']])
            ->withHeaders($headers)
            ->withBasicAuth((string) ($auth[0] ?? ''), (string) ($auth[1] ?? ''))
            ->get($ordersUrl, $query);

        if ($response->successful()) {
            return $response;
        }

        // Some endpoints require a session login (CSRF + cookie), similar to
        // legacy cron scripts. Try that path before giving up.
        if ($this->ensurePortalSession($auth)) {
            $host = parse_url($ordersUrl, PHP_URL_HOST) ?: 'es-portal.captur3d.io';
            $sessionResponse = Http::timeout(60)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders($headers)
                ->withCookies($this->sessionCookies, $host)
                ->get($ordersUrl, $query);

            if ($sessionResponse->successful()) {
                return $sessionResponse;
            }
        }

        // Final fallback: no Authorization header, for trusted-network gateways.
        return Http::timeout(60)
            ->withOptions(['curl' => [CURLOPT_PROXY => '']])
            ->withHeaders($headers)
            ->get($ordersUrl, $query);
    }

    protected function resolveOrdersUrlForStatus(string $status): string
    {
        $defaultPendingUrl = $this->activeProjectId === 13
            ? $this->legacyJsonOrdersUrl
            : $this->jsonOrdersUrl;

        $pendingUrl = trim($this->externalPortalUrl) !== ''
            ? str_replace('/plann3d_floorplan_orders?', '/plann3d_floorplan_orders.json?', trim($this->externalPortalUrl))
            : $defaultPendingUrl;
        $processingUrl = trim((string) env('ROOMIO_PROCESSING_URL', ''));

        if ($status === 'processing' && $processingUrl !== '') {
            return $processingUrl;
        }

        if ($status === 'pending') {
            return $pendingUrl;
        }

        // If processing URL isn't configured, use pending URL so we still
        // preserve existing behavior where endpoint supports status query.
        return $pendingUrl;
    }

    protected function buildOrdersQuery(string $ordersUrl, string $status, int $page, string $startDate, string $endDate): array
    {
        $query = ['page' => $page];

        $isLegacyFloorplan = str_contains($ordersUrl, '/external_supplier/floorplan_orders.json')
            && !str_contains($ordersUrl, '/external_supplier/plann3d_floorplan_orders.json');

        if ($isLegacyFloorplan) {
            // Legacy endpoint uses filter=pending style.
            $query['filter'] = $status === 'processing' ? 'processing' : 'pending';
            return $query;
        }

        // New endpoint supports status + date range.
        $query['status'] = $status;
        $query['start_date'] = $startDate;
        $query['end_date'] = $endDate;

        return $query;
    }

    protected function ensurePortalSession(array $auth): bool
    {
        if ($this->sessionAuthenticated) {
            return true;
        }

        try {
            $host = parse_url($this->portalLoginUrl, PHP_URL_HOST) ?: 'es-portal.captur3d.io';
            $origin = 'https://' . $host;

            $loginPage = Http::timeout(60)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders([
                    'User-Agent' => 'BenchmarkCron/1.0',
                    'Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ])
                ->get($this->portalLoginUrl);

            if (!$loginPage->successful()) {
                $this->lastErrors[] = 'Roomio session login page failed: HTTP ' . $loginPage->status();
                return false;
            }

            $this->captureResponseCookies($loginPage);

            $html = $loginPage->body();
            if (!preg_match('/name="csrf-token"\s+content="([^"]+)"/i', $html, $match)) {
                $this->lastErrors[] = 'Roomio session login failed: csrf token missing';
                return false;
            }

            $csrfToken = $match[1];
            $payload = [
                'external_supplier_user' => [
                    'email' => $auth[0] ?? '',
                    'password' => $auth[1] ?? '',
                ],
            ];

            $loginResponse = Http::timeout(60)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders([
                    'User-Agent' => 'BenchmarkCron/1.0',
                    'Accept' => 'application/json',
                    'Content-Type' => 'application/json',
                    'X-CSRF-Token' => $csrfToken,
                    'Origin' => $origin,
                    'Referer' => $this->portalLoginUrl,
                ])
                ->withCookies($this->sessionCookies, $host)
                ->post($this->portalLoginUrl, $payload);

            $this->captureResponseCookies($loginResponse);

            if (!$loginResponse->successful() || str_contains(strtolower($loginResponse->body()), '"errors"')) {
                $this->lastErrors[] = 'Roomio session login post failed: HTTP ' . $loginResponse->status();
                return false;
            }

            $this->sessionAuthenticated = true;
            return true;
        } catch (Exception $e) {
            $this->lastErrors[] = 'Roomio session login exception: ' . $e->getMessage();
            return false;
        }
    }

    protected function captureResponseCookies($response): void
    {
        try {
            foreach ($response->cookies() as $cookie) {
                $this->sessionCookies[$cookie->getName()] = $cookie->getValue();
            }
        } catch (Exception $e) {
            Log::warning('Roomio could not capture response cookies: ' . $e->getMessage());
        }
    }

    protected function buildJsonDateWindow(): array
    {
        $start = env('ROOMIO_IMPORT_START_DATE');
        $end = env('ROOMIO_IMPORT_END_DATE');

        if ($start && $end) {
            return [$start, $end];
        }

        $timezone = new DateTimeZone('Asia/Karachi');
        $startDt = new DateTime('now', $timezone);
        $startDt->modify('-90 days')->setTime(0, 0, 0, 0)->setTimezone(new DateTimeZone('UTC'));

        $endDt = new DateTime('now', $timezone);
        $endDt->modify('+1 day')->setTime(23, 59, 59, 999000)->setTimezone(new DateTimeZone('UTC'));

        return [
            $startDt->format('Y-m-d\TH:i:s.v\Z'),
            $endDt->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }

    /**
     * Bulk inserts require every row to have the same keys.
     */
    protected function normalizeRecordsForInsert(array $records, string $table): array
    {
        if (empty($records)) {
            return [];
        }

        $columns = Schema::getColumnListing($table);
        $columnsByLower = [];
        foreach ($columns as $column) {
            $columnsByLower[strtolower($column)] = $column;
        }

        $hasProcessOrderColumn = $this->resolveColumnName($table, 'process_order') !== null;

        foreach ($records as &$record) {
            if ($hasProcessOrderColumn) {
                $record['process_order'] = $record['process_order'] ?? null;
            } else {
                unset($record['process_order']);
            }

            $normalized = [];
            foreach ($record as $key => $value) {
                $resolved = $columnsByLower[strtolower((string) $key)] ?? null;
                if ($resolved !== null) {
                    $normalized[$resolved] = $value;
                }
            }
            $record = $normalized;
        }
        unset($record);

        return $records;
    }

    protected function resolveColumnName(string $table, string $expected): ?string
    {
        foreach (Schema::getColumnListing($table) as $column) {
            if (strcasecmp($column, $expected) === 0) {
                return $column;
            }
        }

        return null;
    }

    /**
     * MAIN IMPORT FUNCTION - Fetches from both new and processing orders URLs
     */
    public function run(): array
    {
        $username = $this->externalPortalUsername;
        $password = $this->externalPortalPassword;
        $projectId = (int) (config('services.roomio.project_id') ?? env('ROOMIO_PROJECT_ID', 15));
        $table = (string) (config('services.roomio.table') ?? env('ROOMIO_TABLE', $projectId === 13 ? 'project_13_orders' : 'project_15_orders'));
        $fetchProcessing = filter_var(config('services.roomio.fetch_processing') ?? env('ROOMIO_FETCH_PROCESSING', true), FILTER_VALIDATE_BOOL);
        $totalInserted = 0;
        $this->lastErrors = [];
        $this->sessionCookies = [];
        $this->sessionAuthenticated = false;
        $this->activeProjectId = $projectId;

        Log::info("Starting RoomioImportService for project {$projectId}");

        // Fetch pending orders from JSON API.
        Log::info("Fetching pending Roomio orders from JSON API");
        $newRecords = $this->fetchJsonStatus('pending', $projectId, [$username, $password], null);
        Log::info("New orders fetch completed: ".count($newRecords)." records");

        // Fetch processing orders from JSON API.
        Log::info("Fetching processing Roomio orders from JSON API");
        $processingRecords = $fetchProcessing
            ? $this->fetchJsonStatus('processing', $projectId, [$username, $password], 'yes')
            : [];
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
        $allRecords = $this->normalizeRecordsForInsert($allRecords, $table);

        Log::info("Total unique records after merge: ".count($allRecords));

        if (!empty($allRecords)) {
            Log::info("Insert-only mode active. Attempting to insert unique records: ".count($allRecords));
            $totalInserted = (int) DB::table($table)->insertOrIgnore($allRecords);
        }

        $summary = [
            'pending_fetched' => count($newRecords),
            'processing_fetched' => count($processingRecords),
            'unique_records' => count($allRecords),
            'inserted' => $totalInserted,
            'ignored_or_existing' => max(count($allRecords) - $totalInserted, 0),
            'errors' => $this->lastErrors,
        ];

        Log::info('RoomioImportService finished.', $summary);

        // Backfill variant_no for any newly inserted rows that still have it null.
        // This runs AFTER insert so we only hit the API for genuinely new orders,
        // not on every cron cycle for every order on the portal.
        $this->backfillVariantNos($table, $projectId, [$username, $password]);

        return $summary;
    }

    /**
     * Fetch and store variant_no for orders that were inserted without one.
     * Processes up to 50 rows per run to stay within cron time limits.
     */
    protected function backfillVariantNos(string $table, int $projectId, array $auth): void
    {
        $variantColumn = $this->resolveColumnName($table, 'variant_no');
        if ($variantColumn === null) {
            Log::info("Variant backfill skipped: {$table}.variant_no/VARIANT_no column does not exist.");
            return;
        }

        $limit = (int) env('ROOMIO_VARIANT_BACKFILL_LIMIT', $this->variantBackfillBatchSize);
        if ($limit < 1) {
            $limit = 1;
        }

        $rows = DB::table($table)
            ->where('project_id', $projectId)
            ->whereNull($variantColumn)
            ->select('id', 'order_number')
            ->orderBy('id', 'desc')
            ->limit($limit)
            ->get();

        if ($rows->isEmpty()) {
            Log::info('Variant backfill: no rows need updating.');
            return;
        }

        Log::info("Variant backfill: processing {$rows->count()} rows (limit={$limit}).");
        $updated = 0;

        foreach ($rows as $row) {
            try {
                $variantNo = $this->fetchVariantNo($row->order_number, $auth);
                if ($variantNo !== null && $variantNo !== '') {
                    DB::table($table)->where('id', $row->id)->update([
                        $variantColumn => $variantNo,
                        'metadata' => DB::raw("JSON_SET(COALESCE(metadata, '{}'), '$.variant_fetch_method', 'detail_page')"),
                        'updated_at' => now(),
                    ]);
                    $updated++;
                } elseif ($variantNo === '') {
                    // API request succeeded but order has no variant name; set '-' so whereNull doesn't get stuck in an infinite loop
                    DB::table($table)->where('id', $row->id)->update([
                        $variantColumn => '-',
                        'metadata' => DB::raw("JSON_SET(COALESCE(metadata, '{}'), '$.variant_fetch_method', 'detail_page_not_found')"),
                        'updated_at' => now(),
                    ]);
                    $updated++;
                } else {
                    Log::info("Variant backfill: HTTP request failed for order {$row->order_number}, will retry next run.");
                }

                // Keep detail endpoint traffic low when many jobs run in parallel.
                usleep(150000);
            } catch (Exception $e) {
                Log::warning("Variant backfill failed for order {$row->order_number}: ".$e->getMessage());
            }
        }

        Log::info("Variant backfill complete: {$updated} of {$rows->count()} rows updated.");
    }
}
