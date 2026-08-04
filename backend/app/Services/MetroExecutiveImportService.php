<?php

namespace App\Services;

use DateTime;
use DateTimeZone;
use Exception;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class MetroExecutiveImportService
{
    protected int $maxPages = 200;
    protected string $jsonOrdersUrl = 'https://es-portal.captur3d.io/external_supplier/trueplan_orders.json';
    protected string $portalLoginUrl = 'https://es-portal.captur3d.io/external_supplier/login';
    protected string $username = 'wgondal835@gmail.com';
    protected string $password = 'Ca35@$35';
    protected int $projectId = 6;
    protected string $table = 'project_6_orders';
    protected array $lastErrors = [];
    protected array $sessionCookies = [];
    protected bool $sessionAuthenticated = false;
    protected int $variantBackfillBatchSize = 10;
    protected array $importStats = [];

    public function fetchVariantNo(string $orderId, array $auth): ?string
    {
        $cleanId = ltrim($orderId, '#');

        $response = $this->requestOrderDetails($cleanId, $auth);
        if (!$response->successful()) {
            Log::warning("Variant fetch failed for Metro Executive order {$orderId}, HTTP code: {$response->status()}");
            return null;
        }

        $data = $response->json();
        if (!is_array($data) || !isset($data['data']['orderable']['variantName'])) {
            Log::debug("Variant not found in JSON for Metro Executive order {$orderId}");
            return null;
        }

        return trim((string) $data['data']['orderable']['variantName']) ?: null;
    }

    protected function requestOrderDetails(string $orderId, array $auth)
    {
        $urlTemplate = (string) env('METRO_EXECUTIVE_ORDER_DETAILS_URL_TEMPLATE', 'https://es-portal.captur3d.io/external_supplier/orders/{id}.json');
        $url = str_replace('{id}', urlencode($orderId), $urlTemplate);

        $headers = [
            'User-Agent' => 'BenchmarkCron/1.0',
            'Accept' => 'application/json',
        ];

        $token = env('METRO_EXECUTIVE_API_TOKEN');
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

            $rawOrderId = $this->firstNonEmpty($order, [
                'id',
                'orderId',
                'orderID',
                'order_number',
                'orderNumber',
            ]);
            if (!$rawOrderId) {
                $this->importStats['missing_order_number']++;
                Log::warning('Metro Executive JSON order skipped because id is missing', ['order' => $order]);
                continue;
            }

            $orderNumber = (string) $rawOrderId;
            $portalStatus = strtolower((string) ($this->firstNonEmpty($order, ['status', 'state']) ?? 'pending'));
            $priority = $this->normalizePriority($this->firstNonEmpty($order, ['priority', 'priorityName']));
            $variantNo = $this->extractVariantNameFromOrder($order);
            $receivedAt = $this->parsePortalDate($this->firstNonEmpty($order, [
                'orderedAt',
                'ordered_at',
                'createdAt',
                'created_at',
                'requestedAt',
                'submittedAt',
            ]))
                ?? new DateTime('now', new DateTimeZone('Asia/Karachi'));
            $deadline = $this->parsePortalDate(
                $this->firstNonEmpty($order, [
                    'deliveryDeadline',
                    'targetDeadline',
                    'customerDeliveryDeadline',
                    'dueAt',
                    'dueDate',
                    'deadline',
                ])
            );
            $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));
            $clientReference = (string) ($this->firstNonEmpty($order, [
                'requestId',
                'clientReference',
                'client_reference',
                'reference',
                'externalId',
                'external_id',
            ]) ?? $orderNumber);
            $address = $this->firstNonEmpty($order, [
                'propertyAddress',
                'address',
                'fullAddress',
                'formattedAddress',
                'property.address',
                'property.fullAddress',
                'orderable.propertyAddress',
                'orderable.address',
                'orderable.fullAddress',
                'orderableSummary.propertyAddress',
                'orderableSummary.address',
            ]);
            $planType = $this->firstNonEmpty($order, [
                'orderableSummary.combinationType',
                'orderableSummary.productName',
                'orderableSummary.name',
                'orderable.combinationType',
                'orderable.productName',
                'productName',
                'planType',
            ]);
            $projectType = $this->firstNonEmpty($order, [
                'orderableSummary.sourceType',
                'orderableSummary.type',
                'orderable.sourceType',
                'orderable.type',
                'projectType',
                'type',
            ]);

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
                'source_keys' => array_keys($order),
            ];

            $record = [
                'order_number' => $orderNumber,
                'client_reference' => $clientReference,
                'client_portal_id' => $orderNumber,
                'project_id' => $projectId,
                'address' => $address,
                'priority' => $priority,
                'current_layer' => 'drawer',
                'status' => 'pending',
                'workflow_state' => 'RECEIVED',
                'workflow_type' => 'FP_3_LAYER',
                'received_at' => $receivedAt->format('Y-m-d H:i:s'),
                'due_date' => $deadline ? $deadline->format('Y-m-d') : null,
                'due_in' => $deadline ? $deadline->format('Y-m-d H:i:s') : null,
                'variant_no' => $variantNo,
                'plan_type' => $planType,
                'project_type' => $projectType,
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

    protected function firstNonEmpty(array $source, array $keys): mixed
    {
        foreach ($keys as $key) {
            $value = data_get($source, $key);

            if (is_array($value)) {
                continue;
            }

            if ($value !== null && trim((string) $value) !== '') {
                return $value;
            }
        }

        return null;
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
            Log::warning("Metro Executive date parse failed for value {$raw}: " . $e->getMessage());
            return null;
        }
    }

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
                    Log::warning("Metro Executive JSON HTTP error {$response->status()} fetching {$status} page {$page}", [
                        'url' => $ordersUrl,
                        'query' => $query,
                        'body_preview' => substr($response->body(), 0, 300),
                    ]);
                    break;
                }

                $payload = $response->json();
                if (!is_array($payload)) {
                    $this->lastErrors[] = "Invalid JSON fetching {$status} page {$page}";
                    Log::warning("Metro Executive JSON response was not valid JSON for {$status} page {$page}");
                    break;
                }

                $meta = $payload['data']['meta'] ?? [];
                $totalPages = max(1, (int) ($meta['totalPages'] ?? $totalPages ?? 1));
                $pageRecords = $this->parseOrdersFromJson($payload, $projectId, $processOrderValue);

                Log::info("Metro Executive JSON fetched " . count($pageRecords) . " {$status} records from page {$page}/{$totalPages}", [
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
                Log::error("Metro Executive JSON import error for {$status} page {$page}: " . $e->getMessage());
                break;
            }
        }

        if ($totalPages !== null && $totalPages > $this->maxPages) {
            Log::warning("Metro Executive JSON pagination hit maxPages={$this->maxPages} for {$status}; totalPages={$totalPages}");
        }

        return $allRecords;
    }

    protected function requestJsonOrders(string $ordersUrl, array $query, array $auth)
    {
        $headers = [
            'User-Agent' => 'BenchmarkCron/1.0',
            'Accept' => 'application/json',
        ];

        $token = env('METRO_EXECUTIVE_API_TOKEN');
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
            ->withBasicAuth($auth[0], $auth[1])
            ->get($ordersUrl, $query);

        if ($response->successful()) {
            return $response;
        }

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

        return Http::timeout(60)
            ->withOptions(['curl' => [CURLOPT_PROXY => '']])
            ->withHeaders($headers)
            ->get($ordersUrl, $query);
    }

    protected function resolveOrdersUrlForStatus(string $status): string
    {
        $pendingUrl = trim((string) env('METRO_EXECUTIVE_PENDING_URL', $this->jsonOrdersUrl));
        $processingUrl = trim((string) env('METRO_EXECUTIVE_PROCESSING_URL', ''));

        if ($status === 'processing' && $processingUrl !== '') {
            return $processingUrl;
        }

        return $pendingUrl;
    }

    protected function buildOrdersQuery(string $ordersUrl, string $status, int $page, string $startDate, string $endDate): array
    {
        $query = ['page' => $page];
        $path = parse_url($ordersUrl, PHP_URL_PATH) ?: '';

        if (!str_ends_with($path, '.json')) {
            $query['filter'] = $status === 'processing' ? 'processing' : 'pending';
            return $query;
        }

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
                $this->lastErrors[] = 'Metro Executive session login page failed: HTTP ' . $loginPage->status();
                return false;
            }

            $this->captureResponseCookies($loginPage);

            $html = $loginPage->body();
            if (!preg_match('/name="csrf-token"\s+content="([^"]+)"/i', $html, $match)) {
                $this->lastErrors[] = 'Metro Executive session login failed: csrf token missing';
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
                $this->lastErrors[] = 'Metro Executive session login post failed: HTTP ' . $loginResponse->status();
                return false;
            }

            $this->sessionAuthenticated = true;
            return true;
        } catch (Exception $e) {
            $this->lastErrors[] = 'Metro Executive session login exception: ' . $e->getMessage();
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
            Log::warning('Metro Executive could not capture response cookies: ' . $e->getMessage());
        }
    }

    protected function buildJsonDateWindow(): array
    {
        $start = env('METRO_EXECUTIVE_IMPORT_START_DATE');
        $end = env('METRO_EXECUTIVE_IMPORT_END_DATE');

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

    public function run(): array
    {
        $username = env('METRO_EXECUTIVE_PORTAL_USERNAME', $this->username);
        $password = env('METRO_EXECUTIVE_PORTAL_PASSWORD', $this->password);
        $projectId = (int) env('METRO_EXECUTIVE_PROJECT_ID', $this->projectId);
        $table = (string) env('METRO_EXECUTIVE_TABLE', $this->table);
        $fetchProcessing = filter_var(env('METRO_EXECUTIVE_FETCH_PROCESSING', true), FILTER_VALIDATE_BOOL);
        $totalInserted = 0;
        $this->lastErrors = [];
        $this->sessionCookies = [];
        $this->sessionAuthenticated = false;
        $this->importStats = [
            'missing_order_number' => 0,
            'insert_failed' => 0,
            'existing_filled' => 0,
        ];

        Log::info("Starting MetroExecutiveImportService for project {$projectId}");

        Log::info('Fetching pending Metro Executive orders from JSON API');
        $pendingRecords = $this->fetchJsonStatus('pending', $projectId, [$username, $password], null);
        Log::info('Pending Metro Executive orders fetch completed: ' . count($pendingRecords) . ' records');

        Log::info('Fetching processing Metro Executive orders from JSON API');
        $processingRecords = $fetchProcessing
            ? $this->fetchJsonStatus('processing', $projectId, [$username, $password], 'yes')
            : [];
        Log::info('Processing Metro Executive orders fetch completed: ' . count($processingRecords) . ' records');

        $orderMap = [];
        foreach ($pendingRecords as $record) {
            $orderMap[$record['order_number']] = $record;
        }
        foreach ($processingRecords as $record) {
            $orderMap[$record['order_number']] = $record;
        }

        $allRecords = array_values($orderMap);
        $allRecords = $this->normalizeRecordsForInsert($allRecords, $table);

        Log::info('Total unique Metro Executive records after merge: ' . count($allRecords));

        if (!empty($allRecords)) {
            Log::info('Insert-only mode active. Attempting to insert unique Metro Executive records: ' . count($allRecords));
            $totalInserted = $this->insertRecordsSafely($table, $allRecords);
            $this->fillMissingFieldsOnExistingRows($table, $allRecords);
        }

        $summary = [
            'pending_fetched' => count($pendingRecords),
            'processing_fetched' => count($processingRecords),
            'unique_records' => count($allRecords),
            'inserted' => $totalInserted,
            'ignored_or_existing' => max(count($allRecords) - $totalInserted, 0),
            'existing_filled' => $this->importStats['existing_filled'] ?? 0,
            'missing_order_number' => $this->importStats['missing_order_number'],
            'insert_failed' => $this->importStats['insert_failed'],
            'errors' => $this->lastErrors,
        ];

        Log::info('MetroExecutiveImportService finished.', $summary);

        $this->backfillVariantNos($table, $projectId, [$username, $password]);

        return $summary;
    }

    protected function insertRecordsSafely(string $table, array $records): int
    {
        try {
            return (int) DB::table($table)->insertOrIgnore($records);
        } catch (Exception $e) {
            $this->lastErrors[] = 'Bulk insert failed; retrying rows one by one: ' . $e->getMessage();
            Log::warning('Metro Executive bulk insert failed; retrying rows one by one.', [
                'error' => $e->getMessage(),
            ]);
        }

        $inserted = 0;
        foreach ($records as $record) {
            if (empty($record['order_number'])) {
                $this->importStats['missing_order_number']++;
                continue;
            }

            try {
                $inserted += (int) DB::table($table)->insertOrIgnore($record);
            } catch (Exception $e) {
                $this->importStats['insert_failed']++;
                $this->lastErrors[] = "Insert failed for order {$record['order_number']}: " . $e->getMessage();
                Log::warning("Metro Executive insert failed for order {$record['order_number']}: " . $e->getMessage(), [
                    'record' => $record,
                ]);
            }
        }

        return $inserted;
    }

    protected function fillMissingFieldsOnExistingRows(string $table, array $records): void
    {
        if (empty($records)) {
            return;
        }

        $columns = Schema::getColumnListing($table);
        $columnsByLower = [];
        foreach ($columns as $column) {
            $columnsByLower[strtolower($column)] = $column;
        }

        $orderNumberColumn = $columnsByLower['order_number'] ?? null;
        if ($orderNumberColumn === null) {
            return;
        }

        $neverFill = [
            'id',
            'order_number',
            'project_id',
            'current_layer',
            'status',
            'workflow_state',
            'workflow_type',
            'created_at',
            'updated_at',
        ];

        foreach ($records as $record) {
            $orderNumber = $record[$orderNumberColumn] ?? $record['order_number'] ?? null;
            if (empty($orderNumber)) {
                continue;
            }

            $existing = DB::table($table)
                ->where($orderNumberColumn, $orderNumber)
                ->first();

            if (!$existing) {
                continue;
            }

            $update = [];
            foreach ($record as $key => $value) {
                $column = $columnsByLower[strtolower((string) $key)] ?? null;
                if ($column === null || in_array(strtolower($column), $neverFill, true)) {
                    continue;
                }

                if ($value === null || (is_string($value) && trim($value) === '')) {
                    continue;
                }

                $current = $existing->{$column} ?? null;
                if ($current === null || (is_string($current) && trim($current) === '')) {
                    $update[$column] = $value;
                }
            }

            if (empty($update)) {
                continue;
            }

            if (isset($columnsByLower['updated_at'])) {
                $update[$columnsByLower['updated_at']] = now();
            }

            try {
                DB::table($table)
                    ->where($orderNumberColumn, $orderNumber)
                    ->update($update);
                $this->importStats['existing_filled']++;
            } catch (Exception $e) {
                $this->lastErrors[] = "Fill missing fields failed for order {$orderNumber}: " . $e->getMessage();
                Log::warning("Metro Executive fill missing fields failed for order {$orderNumber}: " . $e->getMessage(), [
                    'update' => $update,
                ]);
            }
        }
    }

    protected function backfillVariantNos(string $table, int $projectId, array $auth): void
    {
        $variantColumn = $this->resolveColumnName($table, 'variant_no');
        if ($variantColumn === null) {
            Log::info("Variant backfill skipped: {$table}.variant_no/VARIANT_no column does not exist.");
            return;
        }

        $limit = (int) env('METRO_EXECUTIVE_VARIANT_BACKFILL_LIMIT', $this->variantBackfillBatchSize);
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
            Log::info('Variant backfill: no Metro Executive rows need updating.');
            return;
        }

        Log::info("Variant backfill: processing {$rows->count()} Metro Executive rows (limit={$limit}).");
        $updated = 0;
        $metadataColumn = $this->resolveColumnName($table, 'metadata');

        foreach ($rows as $row) {
            try {
                $variantNo = $this->fetchVariantNo($row->order_number, $auth);
                if ($variantNo !== null) {
                    $update = [
                        $variantColumn => $variantNo,
                        'updated_at' => now(),
                    ];

                    if ($metadataColumn !== null) {
                        $update[$metadataColumn] = DB::raw("JSON_SET(COALESCE({$metadataColumn}, '{}'), '$.variant_fetch_method', 'detail_page')");
                    }

                    DB::table($table)->where('id', $row->id)->update($update);
                    $updated++;
                } else {
                    Log::info("Variant backfill: no variant found for Metro Executive order {$row->order_number}, will retry next run.");
                }

                usleep(150000);
            } catch (Exception $e) {
                Log::warning("Variant backfill failed for Metro Executive order {$row->order_number}: " . $e->getMessage());
            }
        }

        Log::info("Variant backfill complete: {$updated} of {$rows->count()} Metro Executive rows updated.");
    }
}
