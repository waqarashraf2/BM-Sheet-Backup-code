<?php

namespace App\Services\Amends;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use App\Services\ProjectOrderService;
use DateTime;
use DateTimeZone;
use Exception;

class RoomioAmendService
{
    protected int $projectId = 15;
    protected string $amendmentsJsonUrl = 'https://es-portal.captur3d.io/external_supplier/plann3d_floorplan_orders/amendments.json';
    protected string $portalLoginUrl = 'https://es-portal.captur3d.io/external_supplier/login';
    protected string $orderDetailsUrlTemplate = 'https://es-portal.captur3d.io/external_supplier/orders/{id}.json';
    protected int $maxPages = 20;

    protected array $sessionCookies = [];
    protected bool $sessionAuthenticated = false;
    protected array $lastErrors = [];

    /**
     * Main entry point: Fetch amendments from Roomio portal and sync into database.
     */
    public function syncAmends(?int $projectId = null): array
    {
        $pid = $projectId ?: $this->projectId;

        // Ensure amend table exists lazily
        try {
            if (!ProjectOrderService::amendTableExists($pid)) {
                ProjectOrderService::createAmendTable($pid);
            }
        } catch (\Throwable $e) {
            Log::warning("RoomioAmendService: Could not ensure amend table for project {$pid}: " . $e->getMessage());
        }

        $orderTable = ProjectOrderService::getTableName($pid);
        $amendTable = ProjectOrderService::getAmendTableName($pid);

        if (!Schema::hasTable($orderTable)) {
            return [
                'success' => false,
                'message' => "Order table {$orderTable} does not exist",
                'total_fetched' => 0,
                'synced' => 0,
            ];
        }

        $auth = [
            env('EXTERNAL_PORTAL_USERNAME', 'wgondal835@gmail.com'),
            env('EXTERNAL_PORTAL_PASSWORD', 'Ca35@$35'),
        ];

        Log::info("RoomioAmendService: Starting amendments sync for project {$pid}...");

        // Fetch amendments from portal (pending, processing, in_progress)
        $statusesToFetch = ['pending', 'processing', 'in_progress'];
        $fetchedOrders = [];

        foreach ($statusesToFetch as $status) {
            $records = $this->fetchAmendmentsByStatus($status, $auth);
            foreach ($records as $rec) {
                $rawId = $rec['id'] ?? null;
                if ($rawId) {
                    $fetchedOrders[(string) $rawId] = $rec;
                }
            }
        }

        $totalFetched = count($fetchedOrders);
        Log::info("RoomioAmendService: Total unique amendments fetched from portal: {$totalFetched}");

        $syncedCount = 0;
        $newOrdersCreated = 0;
        $ordersUpdated = 0;

        foreach ($fetchedOrders as $orderId => $orderData) {
            try {
                $res = $this->processAmendmentOrder($orderData, $pid, $orderTable, $amendTable, $auth);
                if ($res['synced']) {
                    $syncedCount++;
                }
                if ($res['created_new_order']) {
                    $newOrdersCreated++;
                }
                if ($res['updated_existing_order']) {
                    $ordersUpdated++;
                }
            } catch (Exception $e) {
                Log::error("RoomioAmendService: Error processing amendment order #{$orderId}: " . $e->getMessage());
            }
        }

        return [
            'success' => true,
            'project_id' => $pid,
            'total_fetched' => $totalFetched,
            'synced' => $syncedCount,
            'new_orders_created' => $newOrdersCreated,
            'orders_updated' => $ordersUpdated,
            'errors' => $this->lastErrors,
        ];
    }

    /**
     * Fetch amendments for a given status with pagination.
     */
    protected function fetchAmendmentsByStatus(string $status, array $auth): array
    {
        $allOrders = [];
        $page = 1;
        $totalPages = 1;
        [$startDate, $endDate] = $this->buildDateWindow();

        while ($page <= $this->maxPages && $page <= $totalPages) {
            try {
                $query = [
                    'page' => $page,
                    'status' => $status,
                    'start_date' => $startDate,
                    'end_date' => $endDate,
                ];

                $response = $this->requestJson($this->amendmentsJsonUrl, $query, $auth);

                if (!$response->successful()) {
                    $this->lastErrors[] = "HTTP {$response->status()} fetching amendments page {$page} (status: {$status})";
                    Log::warning("RoomioAmendService: HTTP {$response->status()} for amendments page {$page}");
                    break;
                }

                $payload = $response->json();
                if (!is_array($payload)) {
                    $this->lastErrors[] = "Invalid JSON on amendments page {$page}";
                    break;
                }

                $meta = $payload['data']['meta'] ?? $payload['meta'] ?? [];
                $totalPages = max(1, (int) ($meta['totalPages'] ?? 1));

                $orders = $payload['data']['orders'] ?? $payload['orders'] ?? [];
                if (!is_array($orders) || empty($orders)) {
                    break;
                }

                foreach ($orders as $o) {
                    if (is_array($o)) {
                        $allOrders[] = $o;
                    }
                }

                if ($page >= $totalPages) {
                    break;
                }

                $page++;
                usleep(250000); // 250ms delay
            } catch (Exception $e) {
                $this->lastErrors[] = "Exception fetching amendments page {$page}: " . $e->getMessage();
                Log::error("RoomioAmendService: " . $e->getMessage());
                break;
            }
        }

        return $allOrders;
    }

    /**
     * Process an individual amendment order and persist to database.
     */
    protected function processAmendmentOrder(
        array $order,
        int $projectId,
        string $orderTable,
        string $amendTable,
        array $auth
    ): array {
        $rawOrderId = $order['id'] ?? null;
        if (!$rawOrderId) {
            return ['synced' => false, 'created_new_order' => false, 'updated_existing_order' => false];
        }

        $orderNumber = (string) $rawOrderId;
        $requestId = isset($order['requestId']) ? (string) $order['requestId'] : $orderNumber;
        $address = $order['propertyAddress'] ?? ($order['orderableSummary']['originalPropertyAddress'] ?? null);
        $priority = $this->normalizePriority($order['priority'] ?? null);
        $portalStatus = strtolower((string) ($order['status'] ?? 'pending'));
        $receivedAt = $this->parsePortalDate($order['orderedAt'] ?? null) ?? new DateTime('now', new DateTimeZone('Asia/Karachi'));
        $deadline = $this->parsePortalDate(
            $order['deliveryDeadline']
                ?? $order['targetDeadline']
                ?? $order['customerDeliveryDeadline']
                ?? null
        );

        $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));
        $planType = $order['orderableSummary']['combinationType']
            ?? $order['orderableSummary']['originalOrderType']
            ?? null;

        // Fetch detail payload to get exact customerNotes and previousOrder link
        $detailData = $this->fetchOrderDetailPayload($orderNumber, $auth);
        $fullPayload = $detailData ?: $order;

        // Extract amend notes from detail or summary payload
        $amendNotes = $this->extractNotesFromDetailOrPayload($detailData, $order);

        // Extract previous order ID if available (e.g. 363533)
        $previousOrderId = null;
        if (!empty($detailData['orderable']['previousOrder']['id'])) {
            $previousOrderId = (string) $detailData['orderable']['previousOrder']['id'];
        } elseif (!empty($order['orderable']['previousOrder']['id'])) {
            $previousOrderId = (string) $order['orderable']['previousOrder']['id'];
        }

        // Map status: 'pending' or 'in_progress'
        $amendStatus = ($portalStatus === 'in_progress' || $portalStatus === 'started' || $portalStatus === 'processing') ? 'in_progress' : 'pending';

        // Check if previous order or amendment order exists in base project order table
        $existingOrder = null;
        if ($previousOrderId) {
            $existingOrder = DB::table($orderTable)
                ->where('order_number', $previousOrderId)
                ->orWhere('client_portal_id', $previousOrderId)
                ->first();
        }

        if (!$existingOrder) {
            $existingOrder = DB::table($orderTable)
                ->where('order_number', $orderNumber)
                ->orWhere('client_portal_id', $orderNumber)
                ->first();
        }

        $createdNewOrder = false;
        $updatedExistingOrder = false;

        if ($existingOrder) {
            // Update base order to flag as amend
            $orderId = $existingOrder->id;
            $updates = [
                'amend' => 'yes',
                'updated_at' => $nowPK->format('Y-m-d H:i:s'),
            ];

            if (empty($existingOrder->address) && $address) {
                $updates['address'] = $address;
            }
            if (empty($existingOrder->due_in) && $deadline) {
                $updates['due_in'] = $deadline->format('Y-m-d H:i:s');
            }
            if (!empty($amendNotes)) {
                $updates['instruction'] = $amendNotes;
            }

            DB::table($orderTable)->where('id', $orderId)->update($updates);
            $updatedExistingOrder = true;
        } else {
            // Insert new order into base project order table
            $orderId = DB::table($orderTable)->insertGetId([
                'order_number'     => $orderNumber,
                'client_reference' => $requestId,
                'client_portal_id' => $orderNumber,
                'project_id'       => $projectId,
                'address'          => $address,
                'priority'         => $priority,
                'current_layer'    => 'drawer',
                'status'           => 'pending',
                'workflow_state'   => 'RECEIVED',
                'workflow_type'    => 'FP_3_LAYER',
                'plan_type'        => $planType,
                'instruction'      => $amendNotes,
                'amend'            => 'yes',
                'received_at'      => $receivedAt->format('Y-m-d H:i:s'),
                'due_in'           => $deadline ? $deadline->format('Y-m-d H:i:s') : null,
                'due_date'         => $deadline ? $deadline->format('Y-m-d') : null,
                'metadata'         => json_encode($fullPayload),
                'import_source'    => 'api',
                'year'             => $receivedAt->format('Y'),
                'month'            => $receivedAt->format('m'),
                'date'             => $receivedAt->format('d-m-Y'),
                'created_at'       => $nowPK->format('Y-m-d H:i:s'),
                'updated_at'       => $nowPK->format('Y-m-d H:i:s'),
            ]);
            $createdNewOrder = true;
        }

        // Upsert into project amends table
        if (Schema::hasTable($amendTable)) {
            $existingAmend = DB::table($amendTable)
                ->where('order_id', $orderId)
                ->orWhere('order_number', $orderNumber)
                ->first();

            if ($existingAmend) {
                $amendUpdates = [
                    'amend' => 'yes',
                    'updated_at' => $nowPK->format('Y-m-d H:i:s'),
                ];
                if (!empty($amendNotes)) {
                    $amendUpdates['amend_notes'] = $amendNotes;
                }
                // Keep local completed/delivered status if already set
                if (!in_array($existingAmend->amend_status, ['delivered', 'done'])) {
                    $amendUpdates['amend_status'] = $amendStatus;
                }
                DB::table($amendTable)->where('id', $existingAmend->id)->update($amendUpdates);
            } else {
                DB::table($amendTable)->insert([
                    'order_id'     => $orderId,
                    'order_number' => $orderNumber,
                    'amend'        => 'yes',
                    'amend_notes'  => $amendNotes,
                    'amend_status' => $amendStatus,
                    'created_at'   => $nowPK->format('Y-m-d H:i:s'),
                    'updated_at'   => $nowPK->format('Y-m-d H:i:s'),
                ]);
            }
        }

        return [
            'synced' => true,
            'created_new_order' => $createdNewOrder,
            'updated_existing_order' => $updatedExistingOrder,
        ];
    }

    /**
     * Fetch order detail payload from /orders/{id}.json
     */
    protected function fetchOrderDetailPayload(string $orderNumber, array $auth): ?array
    {
        try {
            $url = str_replace('{id}', urlencode($orderNumber), $this->orderDetailsUrlTemplate);
            $response = $this->requestJson($url, [], $auth);

            if ($response->successful()) {
                $json = $response->json();
                return $json['data'] ?? $json;
            }
        } catch (Exception $e) {
            Log::warning("RoomioAmendService: Could not fetch detail for order #{$orderNumber}: " . $e->getMessage());
        }

        return null;
    }

    /**
     * Extract amendment notes from detail response or summary payload.
     */
    protected function extractNotesFromDetailOrPayload(?array $detailData, array $order): ?string
    {
        // 1. Check detail payload first
        if ($detailData && is_array($detailData)) {
            $candidates = [
                $detailData['customerNotes'] ?? null,
                $detailData['orderable']['requestNotes'] ?? null,
                $detailData['customer_notes'] ?? null,
                $detailData['requestNotes'] ?? null,
                $detailData['notes'] ?? null,
                $detailData['instruction'] ?? null,
                $detailData['instructions'] ?? null,
                $detailData['amendmentNotes'] ?? null,
                $detailData['amendment_notes'] ?? null,
                $detailData['orderable']['customerNotes'] ?? null,
                $detailData['orderable']['notes'] ?? null,
                $detailData['orderable']['instruction'] ?? null,
                $detailData['orderable']['previousOrder']['customerNotes'] ?? null,
            ];

            foreach ($candidates as $c) {
                if ($c !== null && trim((string) $c) !== '') {
                    return trim((string) $c);
                }
            }
        }

        // 2. Check summary payload
        $summaryCandidates = [
            $order['notes'] ?? null,
            $order['customerNotes'] ?? null,
            $order['instruction'] ?? null,
            $order['instructions'] ?? null,
            $order['amendmentNotes'] ?? null,
            $order['amendment_notes'] ?? null,
            $order['orderableSummary']['notes'] ?? null,
            $order['orderable']['requestNotes'] ?? null,
            $order['orderable']['notes'] ?? null,
        ];

        foreach ($summaryCandidates as $c) {
            if ($c !== null && trim((string) $c) !== '') {
                return trim((string) $c);
            }
        }

        return null;
    }

    /**
     * Request JSON with API token, Basic Auth, or Session fallback.
     */
    protected function requestJson(string $url, array $query, array $auth)
    {
        $headers = [
            'User-Agent' => 'BenchmarkCron/1.0',
            'Accept'     => 'application/json',
        ];

        // 1. API Token (Bearer)
        $token = env('ROOMIO_API_TOKEN');
        if (!empty($token)) {
            $res = Http::timeout(60)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders([...$headers, 'Authorization' => 'Bearer ' . $token])
                ->get($url, $query);

            if ($res->successful()) {
                return $res;
            }
        }

        // 2. Basic Auth
        $res = Http::timeout(60)
            ->withOptions(['curl' => [CURLOPT_PROXY => '']])
            ->withHeaders($headers)
            ->withBasicAuth((string) ($auth[0] ?? ''), (string) ($auth[1] ?? ''))
            ->get($url, $query);

        if ($res->successful()) {
            return $res;
        }

        // 3. Portal Session Login (CSRF + Cookie)
        if ($this->ensurePortalSession($auth)) {
            $host = parse_url($url, PHP_URL_HOST) ?: 'es-portal.captur3d.io';
            $sessionRes = Http::timeout(60)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders($headers)
                ->withCookies($this->sessionCookies, $host)
                ->get($url, $query);

            if ($sessionRes->successful()) {
                return $sessionRes;
            }
        }

        return $res;
    }

    /**
     * Ensure session cookies are authenticated.
     */
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
                    'Accept'     => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ])
                ->get($this->portalLoginUrl);

            if (!$loginPage->successful()) {
                return false;
            }

            $this->captureResponseCookies($loginPage);

            $html = $loginPage->body();
            if (!preg_match('/name="csrf-token"\s+content="([^"]+)"/i', $html, $match)) {
                return false;
            }

            $csrfToken = $match[1];
            $payload = [
                'external_supplier_user' => [
                    'email'    => $auth[0] ?? '',
                    'password' => $auth[1] ?? '',
                ],
            ];

            $loginResponse = Http::timeout(60)
                ->withOptions(['curl' => [CURLOPT_PROXY => '']])
                ->withHeaders([
                    'User-Agent'   => 'BenchmarkCron/1.0',
                    'Accept'       => 'application/json',
                    'Content-Type' => 'application/json',
                    'X-CSRF-Token' => $csrfToken,
                    'Origin'       => $origin,
                    'Referer'      => $this->portalLoginUrl,
                ])
                ->withCookies($this->sessionCookies, $host)
                ->post($this->portalLoginUrl, $payload);

            $this->captureResponseCookies($loginResponse);

            if (!$loginResponse->successful() || str_contains(strtolower($loginResponse->body()), '"errors"')) {
                return false;
            }

            $this->sessionAuthenticated = true;
            return true;
        } catch (Exception $e) {
            Log::warning('RoomioAmendService: Session login failed: ' . $e->getMessage());
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
            // Ignore cookie parse failure
        }
    }

    protected function buildDateWindow(): array
    {
        $timezone = new DateTimeZone('Asia/Karachi');
        $startDt = new DateTime('now', $timezone);
        $startDt->modify('-30 days')->setTime(0, 0, 0, 0)->setTimezone(new DateTimeZone('UTC'));

        $endDt = new DateTime('now', $timezone);
        $endDt->modify('+1 day')->setTime(23, 59, 59, 999000)->setTimezone(new DateTimeZone('UTC'));

        return [
            $startDt->format('Y-m-d\TH:i:s.v\Z'),
            $endDt->format('Y-m-d\TH:i:s.v\Z'),
        ];
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
            return null;
        }
    }
}
