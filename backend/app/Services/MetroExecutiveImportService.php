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
