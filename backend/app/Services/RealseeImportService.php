<?php

namespace App\Services;

use DateTime;
use DateTimeZone;
use DOMDocument;
use DOMXPath;
use Exception;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

class RealseeImportService
{
    protected int $projectId = 56;
    protected string $tableName = 'project_56_orders';
    protected string $serviceName = 'Realsee';
    protected string $defaultProjectType = 'Realsee';
    protected int $maxPages = 200;
    protected int $timeout = 60;
    protected string $ordersUrl = 'https://es-portal.captur3d.io/external_supplier/realsee_floorplan_orders';
    protected string $portalLoginUrl = 'https://es-portal.captur3d.io/external_supplier/login';
    protected string $portalUsername = 'wgondal835@gmail.com';
    protected string $portalPassword = 'Ca35@$35';
    protected string $timezone = 'Asia/Karachi';
    protected array $sessionCookies = [];
    protected bool $sessionAuthenticated = false;
    protected array $lastErrors = [];

    public function import(): array
    {
        $this->lastErrors = [];
        $this->sessionCookies = [];
        $this->sessionAuthenticated = false;

        if (!Schema::hasTable($this->tableName)) {
            return $this->failure("Orders table {$this->tableName} does not exist.");
        }

        $username = $this->portalUsername;
        $password = $this->portalPassword;

        if ($username === '' || $password === '') {
            return $this->failure('External portal username/password is missing.');
        }

        try {
            Log::info("Starting {$this->serviceName} import.", [
                'project_id' => $this->projectId,
                'table' => $this->tableName,
            ]);

            $pendingRecords = $this->fetchStatus('pending', [$username, $password], null);
            $processingRecords = $this->fetchStatus('processing', [$username, $password], 'yes');

            $recordsByOrder = [];
            foreach ($pendingRecords as $record) {
                $recordsByOrder[$record['order_number']] = $record;
            }
            foreach ($processingRecords as $record) {
                $recordsByOrder[$record['order_number']] = $record;
            }

            $records = $this->normalizeRecordsForInsert(array_values($recordsByOrder));
            $inserted = empty($records) ? 0 : (int) DB::table($this->tableName)->insertOrIgnore($records);

            $summary = [
                'success' => true,
                'message' => "{$this->serviceName} orders fetched and stored successfully.",
                'pending_fetched' => count($pendingRecords),
                'processing_fetched' => count($processingRecords),
                'unique_records' => count($records),
                'inserted' => $inserted,
                'ignored_or_existing' => max(count($records) - $inserted, 0),
                'errors' => $this->lastErrors,
            ];

            Log::info("{$this->serviceName} import completed.", $summary);

            return $summary;
        } catch (Exception $e) {
            Log::error("{$this->serviceName} import failed.", [
                'project_id' => $this->projectId,
                'error' => $e->getMessage(),
            ]);

            return $this->failure($e->getMessage());
        }
    }

    protected function fetchStatus(string $status, array $auth, ?string $processOrderValue): array
    {
        $allRecords = [];
        $page = 1;
        $totalPages = null;
        [$startDate, $endDate] = $this->buildDateWindow();

        while ($page <= $this->maxPages && ($totalPages === null || $page <= $totalPages)) {
            $query = [
                'status' => $status,
                'page' => $page,
                'start_date' => $startDate,
                'end_date' => $endDate,
            ];

            $response = $this->requestOrders($query, $auth);

            if (!$response->successful()) {
                $this->lastErrors[] = "HTTP {$response->status()} fetching {$status} page {$page}";
                Log::warning("{$this->serviceName} HTTP error {$response->status()} fetching {$status} page {$page}", [
                    'url' => $this->ordersUrl,
                    'query' => $query,
                    'body_preview' => substr($response->body(), 0, 300),
                ]);
                break;
            }

            $contentType = strtolower((string) $response->header('Content-Type', ''));
            $body = ltrim($response->body());
            $looksLikeJson = str_starts_with($body, '{') || str_starts_with($body, '[');
            $payload = str_contains($contentType, 'json') || $looksLikeJson ? $response->json() : null;

            if (is_array($payload)) {
                $meta = $payload['data']['meta'] ?? $payload['meta'] ?? [];
                $totalPages = max(1, (int) ($meta['totalPages'] ?? $meta['total_pages'] ?? $totalPages ?? 1));
                $pageRecords = $this->parseOrdersFromJson($payload, $status, $processOrderValue);
            } else {
                $totalPages = $page;
                $pageRecords = $this->parseOrdersFromHtml($response->body(), $status, $processOrderValue);
            }

            Log::info("{$this->serviceName} fetched " . count($pageRecords) . " {$status} records from page {$page}", [
                'total_pages' => $totalPages,
            ]);

            $allRecords = array_merge($allRecords, $pageRecords);

            if (empty($pageRecords) || $page >= $totalPages) {
                break;
            }

            $page++;
            usleep(300000);
        }

        return $allRecords;
    }

    protected function requestOrders(array $query, array $auth)
    {
        $headers = [
            'User-Agent' => 'BenchmarkCron/1.0',
            'Accept' => 'application/json, text/html;q=0.9',
        ];

        $response = Http::timeout($this->timeout)
            ->withOptions(['curl' => [CURLOPT_PROXY => '']])
            ->withHeaders($headers)
            ->withBasicAuth((string) ($auth[0] ?? ''), (string) ($auth[1] ?? ''))
            ->get($this->ordersUrl, $query);

        if ($response->successful()) {
            return $response;
        }

        if ($this->ensurePortalSession($auth)) {
            $host = parse_url($this->ordersUrl, PHP_URL_HOST) ?: 'es-portal.captur3d.io';

            $sessionResponse = Http::timeout($this->timeout)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders($headers)
                ->withCookies($this->sessionCookies, $host)
                ->get($this->ordersUrl, $query);

            if ($sessionResponse->successful()) {
                return $sessionResponse;
            }
        }

        return $response;
    }

    protected function parseOrdersFromJson(array $payload, string $status, ?string $processOrderValue): array
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

            $rawOrderId = $order['id'] ?? $order['orderId'] ?? $order['order_id'] ?? null;
            if ($rawOrderId === null || trim((string) $rawOrderId) === '') {
                Log::warning("{$this->serviceName} JSON order skipped because id is missing.", ['order' => $order]);
                continue;
            }

            $receivedAt = $this->parsePortalDate($order['orderedAt'] ?? $order['createdAt'] ?? $order['created_at'] ?? null)
                ?? new DateTime('now', new DateTimeZone($this->timezone));
            $deadline = $this->parsePortalDate(
                $order['deliveryDeadline']
                    ?? $order['targetDeadline']
                    ?? $order['customerDeliveryDeadline']
                    ?? null
            );

            $orderNumber = (string) $rawOrderId;
            $portalStatus = strtolower((string) ($order['status'] ?? $status));
            $now = new DateTime('now', new DateTimeZone($this->timezone));

            $record = [
                'order_number' => $orderNumber,
                'client_reference' => (string) ($order['requestId'] ?? $order['clientReference'] ?? $orderNumber),
                'client_portal_id' => $orderNumber,
                'project_id' => $this->projectId,
                'address' => $order['propertyAddress'] ?? $order['address'] ?? null,
                'priority' => $this->normalizePriority($order['priority'] ?? null),
                'current_layer' => 'drawer',
                'status' => 'pending',
                'workflow_state' => 'RECEIVED',
                'workflow_type' => 'FP_3_LAYER',
                'received_at' => $receivedAt->format('Y-m-d H:i:s'),
                'due_date' => $deadline ? $deadline->format('Y-m-d') : null,
                'due_in' => $deadline ? $deadline->format('Y-m-d H:i:s') : null,
                'plan_type' => $order['orderableSummary']['combinationType'] ?? null,
                'project_type' => $order['orderableSummary']['sourceType'] ?? $this->defaultProjectType,
                'metadata' => $this->safeJsonEncode([
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
                    'source_response' => 'json',
                ]),
                'import_source' => 'cron',
                'year' => (int) $receivedAt->format('Y'),
                'month' => (int) $receivedAt->format('m'),
                'date' => $receivedAt->format('d-m-Y'),
                'created_at' => $now->format('Y-m-d H:i:s'),
                'updated_at' => $now->format('Y-m-d H:i:s'),
            ];

            if ($processOrderValue !== null) {
                $record['process_order'] = $processOrderValue;
            }

            $records[] = $record;
        }

        return $records;
    }

    protected function parseOrdersFromHtml(string $html, string $status, ?string $processOrderValue): array
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

            $rawOrderId = $row['Order ID'] ?? $row['Order Id'] ?? $row['ID'] ?? null;
            if (!$rawOrderId) {
                continue;
            }

            $receivedAt = new DateTime('now', new DateTimeZone($this->timezone));
            $deadline = $this->parseDueIn($row['Due in'] ?? $row['Due In'] ?? null);
            $now = new DateTime('now', new DateTimeZone($this->timezone));

            $record = [
                'order_number' => (string) $rawOrderId,
                'client_reference' => (string) $rawOrderId,
                'client_portal_id' => (string) $rawOrderId,
                'project_id' => $this->projectId,
                'address' => $row['Address'] ?? null,
                'priority' => $this->normalizePriority($row['Priority'] ?? null),
                'current_layer' => 'drawer',
                'status' => 'pending',
                'workflow_state' => 'RECEIVED',
                'workflow_type' => 'FP_3_LAYER',
                'received_at' => $receivedAt->format('Y-m-d H:i:s'),
                'due_in' => $deadline,
                'project_type' => $this->defaultProjectType,
                'metadata' => $this->safeJsonEncode([
                    'portal_status' => $status,
                    'due_in_raw' => $row['Due in'] ?? $row['Due In'] ?? null,
                    'source_response' => 'html',
                ]),
                'import_source' => 'cron',
                'year' => (int) $receivedAt->format('Y'),
                'month' => (int) $receivedAt->format('m'),
                'date' => $receivedAt->format('d-m-Y'),
                'created_at' => $now->format('Y-m-d H:i:s'),
                'updated_at' => $now->format('Y-m-d H:i:s'),
            ];

            if ($processOrderValue !== null) {
                $record['process_order'] = $processOrderValue;
            }

            $records[] = $record;
        }

        return $records;
    }

    protected function ensurePortalSession(array $auth): bool
    {
        if ($this->sessionAuthenticated) {
            return true;
        }

        try {
            $host = parse_url($this->portalLoginUrl, PHP_URL_HOST) ?: 'es-portal.captur3d.io';
            $origin = 'https://' . $host;

            $loginPage = Http::timeout($this->timeout)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders([
                    'User-Agent' => 'BenchmarkCron/1.0',
                    'Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ])
                ->get($this->portalLoginUrl);

            if (!$loginPage->successful()) {
                $this->lastErrors[] = "{$this->serviceName} session login page failed: HTTP " . $loginPage->status();
                return false;
            }

            $this->captureResponseCookies($loginPage);

            if (!preg_match('/name="csrf-token"\s+content="([^"]+)"/i', $loginPage->body(), $match)) {
                $this->lastErrors[] = "{$this->serviceName} session login failed: csrf token missing";
                return false;
            }

            $loginResponse = Http::timeout($this->timeout)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders([
                    'User-Agent' => 'BenchmarkCron/1.0',
                    'Accept' => 'application/json',
                    'Content-Type' => 'application/json',
                    'X-CSRF-Token' => $match[1],
                    'Origin' => $origin,
                    'Referer' => $this->portalLoginUrl,
                ])
                ->withCookies($this->sessionCookies, $host)
                ->post($this->portalLoginUrl, [
                    'external_supplier_user' => [
                        'email' => $auth[0] ?? '',
                        'password' => $auth[1] ?? '',
                    ],
                ]);

            $this->captureResponseCookies($loginResponse);

            if (!$loginResponse->successful() || str_contains(strtolower($loginResponse->body()), '"errors"')) {
                $this->lastErrors[] = "{$this->serviceName} session login post failed: HTTP " . $loginResponse->status();
                return false;
            }

            $this->sessionAuthenticated = true;
            return true;
        } catch (Exception $e) {
            $this->lastErrors[] = "{$this->serviceName} session login exception: " . $e->getMessage();
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
            Log::warning("{$this->serviceName} could not capture response cookies: " . $e->getMessage());
        }
    }

    protected function buildDateWindow(): array
    {
        $timezone = new DateTimeZone($this->timezone);
        $start = new DateTime('now', $timezone);
        $start->modify('-90 days')->setTime(0, 0, 0, 0)->setTimezone(new DateTimeZone('UTC'));

        $end = new DateTime('now', $timezone);
        $end->modify('+1 day')->setTime(23, 59, 59, 999000)->setTimezone(new DateTimeZone('UTC'));

        return [
            $start->format('Y-m-d\TH:i:s.v\Z'),
            $end->format('Y-m-d\TH:i:s.v\Z'),
        ];
    }

    protected function parseDueIn(?string $raw): ?string
    {
        if (!$raw) {
            return null;
        }

        $dt = new DateTime('now', new DateTimeZone($this->timezone));
        $value = preg_match('/(\d+)/', strtolower($raw), $match) ? (int) $match[1] : 0;

        if ($value <= 0) {
            return $dt->format('Y-m-d H:i:s');
        }

        if (str_contains(strtolower($raw), 'day')) {
            $dt->modify("+{$value} days");
        } elseif (str_contains(strtolower($raw), 'minute')) {
            $dt->modify("+{$value} minutes");
        } else {
            $dt->modify("+{$value} hours");
        }

        return $dt->format('Y-m-d H:i:s');
    }

    protected function parsePortalDate(?string $raw): ?DateTime
    {
        if (!$raw) {
            return null;
        }

        try {
            $dt = new DateTime($raw);
            $dt->setTimezone(new DateTimeZone($this->timezone));
            return $dt;
        } catch (Exception $e) {
            Log::warning("{$this->serviceName} date parse failed for value {$raw}: " . $e->getMessage());
            return null;
        }
    }

    protected function normalizePriority(mixed $priority): string
    {
        return match (strtolower(trim((string) $priority))) {
            'urgent', 'rush' => 'urgent',
            'high' => 'high',
            'low' => 'low',
            default => 'normal',
        };
    }

    protected function normalizeRecordsForInsert(array $records): array
    {
        if (empty($records)) {
            return [];
        }

        $columns = Schema::getColumnListing($this->tableName);
        $columnsByLower = [];
        foreach ($columns as $column) {
            $columnsByLower[strtolower($column)] = $column;
        }

        $normalized = [];
        $usedColumns = [];
        foreach ($records as $record) {
            $row = [];
            foreach ($record as $key => $value) {
                $column = $columnsByLower[strtolower((string) $key)] ?? null;
                if ($column !== null) {
                    $row[$column] = $value;
                    $usedColumns[$column] = true;
                }
            }

            $normalized[] = $row;
        }

        $usedColumns = array_keys($usedColumns);
        foreach ($normalized as &$row) {
            foreach ($usedColumns as $column) {
                $row[$column] = $row[$column] ?? null;
            }
            ksort($row);
        }
        unset($row);

        return $normalized;
    }

    protected function safeJsonEncode(array $value): string
    {
        try {
            return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        } catch (Exception $e) {
            return '{}';
        }
    }

    protected function failure(string $message): array
    {
        Log::warning("{$this->serviceName} import stopped.", [
            'project_id' => $this->projectId,
            'message' => $message,
        ]);

        return [
            'success' => false,
            'message' => $message,
            'pending_fetched' => 0,
            'processing_fetched' => 0,
            'unique_records' => 0,
            'inserted' => 0,
            'ignored_or_existing' => 0,
            'errors' => $this->lastErrors,
        ];
    }
}
