<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use DateTime;
use DateTimeZone;
use Exception;

class RoomioImportService
{
    protected string $loginUrl   = 'https://es-portal.captur3d.io/external_supplier/login';
    protected string $baseUrl    = 'https://es-portal.captur3d.io/external_supplier/plann3d_floorplan_orders';
    protected string $cookieFile = '/tmp/roomio_portal_session.txt';
    protected int    $maxPages   = 15;

    // ── Session auth ──────────────────────────────────────────────────────────

    protected function portalLogin(): bool
    {
        // Step 1: GET login page to capture CSRF token
        $ch = curl_init($this->loginUrl);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_COOKIEJAR      => $this->cookieFile,
            CURLOPT_COOKIEFILE     => $this->cookieFile,
            CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
        ]);
        $html = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if (!$html || $code !== 200) {
            Log::error("RoomioImportService: Login page fetch failed (HTTP {$code})");
            return false;
        }

        if (!preg_match('/name="csrf-token"\s+content="([^"]+)"/', $html, $matches)) {
            Log::error('RoomioImportService: CSRF token not found in login page');
            return false;
        }
        $csrf = $matches[1];

        // Step 2: POST JSON credentials
        $payload = json_encode([
            'external_supplier_user' => [
                'email'    => env('CAPTUR3D_EMAIL'),
                'password' => env('CAPTUR3D_PASSWORD'),
            ],
        ]);

        $ch = curl_init($this->loginUrl);
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
                'Origin: https://es-portal.captur3d.io',
                'Referer: ' . $this->loginUrl,
            ],
            CURLOPT_COOKIEJAR      => $this->cookieFile,
            CURLOPT_COOKIEFILE     => $this->cookieFile,
            CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code !== 200 || str_contains((string) $body, '"errors"')) {
            Log::error("RoomioImportService: Login POST failed (HTTP {$code}): {$body}");
            return false;
        }

        return true;
    }

    // ── JSON API (single page) ────────────────────────────────────────────────

    protected function fetchOrdersPage(string $url): ?array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER     => ['Accept: application/json'],
            CURLOPT_COOKIEFILE     => $this->cookieFile,
            CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($code !== 200 || !$body) {
            Log::warning("RoomioImportService: JSON fetch HTTP {$code} for {$url}");
            return null;
        }

        $decoded = json_decode($body, true);
        return $decoded['data'] ?? null;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    protected function mapPriority(string $p): string
    {
        return match (strtolower($p)) {
            'low'    => 'low',
            'high'   => 'high',
            'urgent' => 'urgent',
            default  => 'normal',   // "regular" and anything else -> normal
        };
    }

    protected function parseIsoTimestamp(string $raw): string
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

    protected function mapJsonOrder(array $order, int $projectId, ?string $processOrderValue): array
    {
        $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));

        $record = [
            'order_number'     => '#' . $order['id'],
            'client_reference' => '#' . $order['id'],
            'project_id'       => $projectId,
            'address'          => $order['propertyAddress'] ?? null,
            'priority'         => $this->mapPriority($order['priority'] ?? ''),
            'current_layer'    => 'drawer',
            'status'           => 'pending',
            'workflow_state'   => 'RECEIVED',
            'workflow_type'    => 'FP_3_LAYER',
            'received_at'      => $this->parseIsoTimestamp($order['orderedAt'] ?? ''),
            'due_in'           => $this->parseIsoTimestamp($order['deliveryDeadline'] ?? $order['targetDeadline'] ?? ''),
            'VARIANT_no'       => $order['orderableSummary']['combinationType'] ?? null,
            'metadata'         => json_encode([
                'combinationType' => $order['orderableSummary']['combinationType'] ?? null,
                'sourceType'      => $order['orderableSummary']['sourceType']      ?? null,
                'providerName'    => $order['providerName']                        ?? null,
                'requestId'       => $order['requestId']                           ?? null,
                'orderedAt'       => $order['orderedAt']                           ?? null,
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

    // ── Paginated fetch all pages ─────────────────────────────────────────────

    protected function fetchAllOrders(string $filter, int $projectId, ?string $processOrderValue): array
    {
        $allRecords = [];
        $page       = 1;

        while ($page <= $this->maxPages) {
            $url  = $this->baseUrl . ".json?filter={$filter}&page={$page}";
            $data = $this->fetchOrdersPage($url);

            if ($data === null) {
                break;
            }

            $orders = $data['orders'] ?? [];
            if (empty($orders)) {
                break;
            }

            foreach ($orders as $order) {
                $allRecords[] = $this->mapJsonOrder($order, $projectId, $processOrderValue);
            }

            $totalPages = (int) ($data['meta']['totalPages'] ?? 1);
            if ($page >= $totalPages) {
                break;
            }

            $page++;
            usleep(300000);
        }

        return $allRecords;
    }

    protected function normalizeRecords(array $records, string $table): array
    {
        if (empty($records)) {
            return [];
        }

        $hasProcessOrder = Schema::hasColumn($table, 'process_order');

        foreach ($records as &$record) {
            if ($hasProcessOrder) {
                $record['process_order'] = $record['process_order'] ?? null;
            } else {
                unset($record['process_order']);
            }
        }
        unset($record);

        return $records;
    }

    // ── Entry point ───────────────────────────────────────────────────────────

    public function run(): void
    {
        $projectId = 15;
        $table     = 'project_15_orders';

        Log::info("RoomioImportService: starting for project {$projectId}");

        if (!$this->portalLogin()) {
            Log::error('RoomioImportService: portal login failed -- aborting');
            return;
        }

        $pendingRecords    = $this->fetchAllOrders('pending',    $projectId, null);
        $processingRecords = $this->fetchAllOrders('processing', $projectId, 'yes');

        Log::info('RoomioImportService: pending=' . count($pendingRecords) . ', processing=' . count($processingRecords));

        // Merge -- processing record wins on duplicate order_number
        $orderMap = [];
        foreach ($pendingRecords    as $r) { $orderMap[$r['order_number']] = $r; }
        foreach ($processingRecords as $r) { $orderMap[$r['order_number']] = $r; }

        $allRecords = $this->normalizeRecords(array_values($orderMap), $table);

        $inserted = 0;
        if (!empty($allRecords)) {
            $inserted = (int) DB::table($table)->insertOrIgnore($allRecords);
        }

        if (file_exists($this->cookieFile)) {
            @unlink($this->cookieFile);
        }

        Log::info("RoomioImportService: finished -- {$inserted} new record(s) inserted into {$table}");
    }
}
