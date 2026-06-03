<?php

namespace App\Services;

use DateTime;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class FocalPb2ScraperService
{
    // ── Config (kept in-file as with other services) ─────────────────────────
    protected string $baseUrl   = 'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net';
    protected string $email     = 'focal.matterport@benchmarkstudio.biz';
    protected string $password  = 'Mpfocal$%^123';
    protected int    $projectId = 2;          // project_id column value (matches original PHP script)
    protected string $table     = 'project_2_orders';

    protected array $cookies = [];

    // ─────────────────────────────────────────────────────────────────────────
    // Public entry point
    // ─────────────────────────────────────────────────────────────────────────

    public function run(): array
    {
        Log::channel('daily')->info('FocalPb2 Scraper started');

        try {
            $token = $this->fetchCsrfToken();
            $this->authenticate($token);
            $rows  = $this->scrapeTable();
            [$inserted, $skipped] = $this->persist($rows);
        } catch (\Throwable $e) {
            Log::error('FocalPb2 Scraper failed: ' . $e->getMessage());
            return ['ok' => false, 'inserted' => 0, 'skipped' => 0, 'error' => $e->getMessage()];
        }

        Log::channel('daily')->info("FocalPb2 Scraper finished — inserted: {$inserted}, skipped: {$skipped}");

        return ['ok' => true, 'inserted' => $inserted, 'skipped' => $skipped];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HTTP helpers
    // ─────────────────────────────────────────────────────────────────────────

    private function http()
    {
        return Http::withHeaders([
            'User-Agent'      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
            'Accept'          => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language' => 'en-US,en;q=0.9',
        ])->withCookies($this->cookies, parse_url($this->baseUrl, PHP_URL_HOST))
          ->retry(3, 300)
          ->timeout(30);
    }

    private function captureCookies($response): void
    {
        foreach ($response->cookies() as $cookie) {
            $this->cookies[$cookie->getName()] = $cookie->getValue();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 1 — CSRF token
    // ─────────────────────────────────────────────────────────────────────────

    private function fetchCsrfToken(): string
    {
        Log::channel('daily')->info('FocalPb2: Fetching login page for CSRF token');

        $response = $this->http()->get($this->baseUrl . '/Identity/Account/Login');

        $this->captureCookies($response);

        $dom = new \DOMDocument();
        libxml_use_internal_errors(true);
        $dom->loadHTML($response->body());
        libxml_clear_errors();

        $xpath = new \DOMXPath($dom);
        $tokenNodes = $xpath->query('//input[@name="__RequestVerificationToken"]');

        if (!$tokenNodes || $tokenNodes->length === 0) {
            throw new \RuntimeException('__RequestVerificationToken not found on login page.');
        }

        Log::channel('daily')->info('FocalPb2: CSRF token obtained');

        return (string) $tokenNodes->item(0)?->getAttribute('value');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 2 — Login
    // ─────────────────────────────────────────────────────────────────────────

    private function authenticate(string $token): void
    {
        Log::channel('daily')->info('FocalPb2: Sending login request');

        $response = $this->http()
            ->withHeaders([
                'Content-Type' => 'application/x-www-form-urlencoded',
                'Origin'       => $this->baseUrl,
                'Referer'      => $this->baseUrl . '/Identity/Account/Login',
            ])
            ->asForm()
            ->post($this->baseUrl . '/Identity/Account/Login?ReturnUrl=%2F', [
                'Input.Email'                => $this->email,
                'Input.Password'             => $this->password,
                '__RequestVerificationToken' => $token,
                'Input.RememberMe'           => 'false',
            ]);

        $this->captureCookies($response);

        if (!array_key_exists('.AspNetCore.Identity.Application', $this->cookies)) {
            throw new \RuntimeException('Authentication failed: identity cookie not set. Check credentials.');
        }

        Log::channel('daily')->info('FocalPb2: Login successful');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 3 — Scrape PropertyVision table
    // ─────────────────────────────────────────────────────────────────────────

    private function scrapeTable(): array
    {
        Log::channel('daily')->info('FocalPb2: Fetching PropertyVision pages (default + InProgress)');

        $paths = [
            '/propertybox2/PropertyVision',
            '/propertybox2/PropertyVision?jobStatus=InProgress',
        ];

        $rows = [];
        $seen = [];

        foreach ($paths as $path) {
            $response = $this->http()->get($this->baseUrl . $path);

            $dom = new \DOMDocument();
            libxml_use_internal_errors(true);
            $dom->loadHTML($response->body());
            libxml_clear_errors();

            $xpath = new \DOMXPath($dom);
            $tables = $xpath->query('//table');

            if (!$tables) {
                continue;
            }

            foreach ($tables as $table) {
                $headers = [];

                // Try thead headers first, then fallback to first row.
                $theadTh = $xpath->query('.//thead//th', $table);
                if ($theadTh && $theadTh->length > 0) {
                    foreach ($theadTh as $th) {
                        $headers[] = trim($th->textContent);
                    }
                } else {
                    $firstRow = $xpath->query('.//tr[1]/th|.//tr[1]/td', $table);
                    if ($firstRow) {
                        foreach ($firstRow as $cell) {
                            $headers[] = trim($cell->textContent);
                        }
                    }
                }

                if (!$this->isExpectedPropertyVisionHeaderRow($headers)) {
                    continue;
                }

                $bodyRows = $xpath->query('.//tbody/tr', $table);
                if (!$bodyRows || $bodyRows->length === 0) {
                    $bodyRows = $xpath->query('.//tr', $table);
                }

                if (!$bodyRows) {
                    continue;
                }

                foreach ($bodyRows as $tr) {
                    $cells = $xpath->query('.//td|.//th', $tr);
                    if (!$cells || $cells->length === 0) {
                        continue;
                    }

                    $values = [];
                    foreach ($cells as $cell) {
                        $values[] = trim($cell->textContent);
                    }

                    if (empty($headers)) {
                        continue;
                    }

                    // Ignore the empty-state row rendered by the portal.
                    if (count($values) === 1 && strcasecmp($values[0], 'No jobs available') === 0) {
                        continue;
                    }

                    $columnCount = min(count($headers), count($values));
                    if ($columnCount < 7) {
                        continue;
                    }

                    $row = array_combine(
                        array_slice($headers, 0, $columnCount),
                        array_slice($values, 0, $columnCount)
                    );

                    if (!is_array($row)) {
                        continue;
                    }

                    // Safe dedupe across both pages.
                    $key = trim((string)($row['Id'] ?? $row['ID'] ?? $row['Job Id'] ?? $row['JobID'] ?? md5(json_encode($row))));
                    if ($key === '') {
                        $key = md5(json_encode($row));
                    }

                    if (!isset($seen[$key])) {
                        $seen[$key] = true;
                        $rows[] = $row;
                    }
                }
            }
        }

        Log::channel('daily')->info('FocalPb2: Scraped ' . count($rows) . ' unique row(s) from both pages');

        return $rows;
    }

    private function isExpectedPropertyVisionHeaderRow(array $headers): bool
    {
        if (empty($headers)) {
            return false;
        }

        $normalized = [];
        foreach ($headers as $header) {
            $normalized[] = $this->normalizeHeader((string) $header);
        }

        // Expected source table:
        // Id | User Name | Address | Job Type | Date Received | Date Due | Time Left | (empty action column)
        $required = [
            'id',
            'user name',
            'address',
            'job type',
            'date received',
            'date due',
            'time left',
        ];

        foreach ($required as $header) {
            if (!in_array($header, $normalized, true)) {
                return false;
            }
        }

        return true;
    }

    private function normalizeHeader(string $header): string
    {
        $header = strtolower(trim($header));
        $header = preg_replace('/\s+/', ' ', $header);

        return $header ?? '';
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Step 4 — Persist to DB
    // ─────────────────────────────────────────────────────────────────────────

    private function persist(array $rows): array
    {
        if (empty($rows)) {
            Log::channel('daily')->info('FocalPb2: No rows to insert');
            return [0, 0];
        }

        // Load existing IDs for duplicate checks
        $existingPortalIds = DB::table($this->table)
            ->whereNotNull('client_portal_id')
            ->pluck('client_portal_id')
            ->flip()
            ->all();

        $existingOrderNumbers = DB::table($this->table)
            ->whereNotNull('order_number')
            ->pluck('order_number')
            ->flip()
            ->all();

        Log::channel('daily')->info('FocalPb2: Loaded ' . count($existingPortalIds) . ' existing client_portal_id(s) and ' . count($existingOrderNumbers) . ' order_number(s)');

        $inserted = 0;
        $skipped  = 0;

        foreach ($rows as $row) {
            $record   = $this->map($row);
            $portalId = $record['client_portal_id'];
            $orderNumber = trim((string) ($record['order_number'] ?? ''));

            // order_number is NOT NULL + UNIQUE in project_2_orders.
            // If source does not provide it, use client_portal_id as stable fallback.
            if ($orderNumber === '' && $portalId) {
                $orderNumber = (string) $portalId;
                $record['order_number'] = $orderNumber;
            }

            if ($orderNumber === '') {
                $skipped++;
                Log::warning('FocalPb2: Skipped row during insert (empty order_number)', [
                    'reason' => 'empty_order_number',
                    'client_portal_id' => $portalId,
                    'mapped_record' => $record,
                    'backend_row' => $row,
                ]);
                continue;
            }

            if (($portalId && isset($existingPortalIds[$portalId])) || isset($existingOrderNumbers[$orderNumber])) {
                $skipped++;
                $reason = ($portalId && isset($existingPortalIds[$portalId]))
                    ? 'duplicate_client_portal_id'
                    : 'duplicate_order_number';

                Log::warning('FocalPb2: Skipped row during insert (duplicate)', [
                    'reason' => $reason,
                    'client_portal_id' => $portalId,
                    'order_number' => $orderNumber,
                    'mapped_record' => $record,
                    'backend_row' => $row,
                ]);
                continue;
            }

            try {
                DB::transaction(function () use ($record) {
                    DB::table($this->table)->insert($record);
                });

                if ($portalId) {
                    $existingPortalIds[$portalId] = true;
                }
                $existingOrderNumbers[$orderNumber] = true;

                $inserted++;
                Log::channel('daily')->info("FocalPb2: Inserted client_portal_id={$portalId}");

            } catch (\Throwable $e) {
                // Duplicate key from DB constraint = expected skip
                if (str_contains($e->getMessage(), '23000') || str_contains($e->getMessage(), 'Duplicate entry')) {
                    $skipped++;
                    Log::warning('FocalPb2: Skipped row during insert (duplicate from DB constraint)', [
                        'reason' => 'duplicate_db_constraint',
                        'error' => $e->getMessage(),
                        'client_portal_id' => $portalId,
                        'order_number' => $orderNumber,
                        'mapped_record' => $record,
                        'backend_row' => $row,
                    ]);
                } else {
                    Log::error("FocalPb2: Insert failed for client_portal_id={$portalId} — " . $e->getMessage());
                    $skipped++;
                }
            }
        }

        Log::info("FocalPb2 DB done — inserted: {$inserted}, skipped: {$skipped}");

        return [$inserted, $skipped];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Field mapping
    // ─────────────────────────────────────────────────────────────────────────

    private function map(array $row): array
    {
        $clientPortalId = $this->sanitizeClientPortalId(
            $this->rowValue($row, ['Id', 'ID', 'Client Portal Id', 'Client Portal ID'])
        );
        $orderNumber = $this->rowValue($row, ['Job Id', 'JobID', 'Order Number', 'Order No', 'Name', 'Job Name']);
        $addressRaw = $this->rowValue($row, ['Address', 'Property Address']) ?? '';
        $jobType = $this->rowValue($row, ['Job Type', 'Type', 'Project Type']);
        $dateReceived = $this->rowValue($row, ['Date Received', 'Received', 'Created']);
        $dueDateRaw = $this->rowValue($row, ['Date Due', 'Due Date', 'Due']);
        $timeLeftRaw = $this->rowValue($row, ['Time Left', 'Remaining Time']) ?? '';
        $receivedAt = $this->parseDateTime($dateReceived);

        $mappedKeys  = ['Id', 'ID', 'Job Id', 'JobID', 'Order Number', 'Order No', 'Name', 'Job Name', 'Address', 'Property Address', 'Job Type', 'Type', 'Project Type', 'Date Received', 'Received', 'Created', 'Date Due', 'Due Date', 'Due', 'Time Left', 'Remaining Time'];

        // Build extra_col_json for unmapped columns (Time Left is always included)
        $extra = [];
        if ($timeLeftRaw !== '') {
            $extra['time_left'] = $timeLeftRaw;
        }
        foreach ($row as $k => $v) {
            if (!in_array($k, $mappedKeys, true) && $v !== null && $v !== '') {
                $extra[$k] = $v;
            }
        }

        return [
            'order_number'     => $orderNumber,
            'VARIANT_no'       => null,
            'project_id'       => $this->projectId,
            'metadata'         => $extra ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null,
            'client_portal_id' => $clientPortalId,
            'address'          => $this->cleanAddress($addressRaw),
            'client_name'      => null,
            'current_layer'    => 'drawer',
            'status'           => 'pending',
            'workflow_state'   => 'RECEIVED',
            'workflow_type'    => 'FP_3_LAYER',
            'project_type'     => $jobType,
            'priority'         => $this->resolvePriority($timeLeftRaw),
            'received_at'      => $receivedAt,
            'due_date'         => $this->parseDueDate($dueDateRaw),
            'due_in'           => $this->calculateDueInFromReceivedAt($receivedAt),
            'import_source'    => 'cron',
            'created_at'       => now(),
            'updated_at'       => now(),
        ];
    }

    private function sanitizeClientPortalId(?string $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim($value);
        if ($value === '' || strcasecmp($value, 'No jobs available') === 0) {
            return null;
        }

        return $value;
    }

    private function rowValue(array $row, array $candidates): ?string
    {
        foreach ($candidates as $candidate) {
            if (array_key_exists($candidate, $row) && $row[$candidate] !== null && trim((string) $row[$candidate]) !== '') {
                return trim((string) $row[$candidate]);
            }
        }

        $normalized = [];
        foreach ($row as $k => $v) {
            $nk = preg_replace('/\s+/', ' ', strtolower(trim((string) $k)));
            $normalized[$nk] = $v;
        }

        foreach ($candidates as $candidate) {
            $nk = preg_replace('/\s+/', ' ', strtolower(trim($candidate)));
            if (array_key_exists($nk, $normalized) && $normalized[$nk] !== null && trim((string) $normalized[$nk]) !== '') {
                return trim((string) $normalized[$nk]);
            }
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private function cleanAddress(?string $address): ?string
    {
        if (!$address) {
            return null;
        }

        return stripos($address, 'no address') !== false ? null : trim($address);
    }

    private function resolvePriority(?string $timeLeft): string
    {
        $hours = $this->parseTimeLeftHours($timeLeft);

        if ($hours > 24) return 'normal';
        if ($hours > 6)  return 'high';

        return 'urgent';
    }

    private function parseTimeLeftHours(?string $raw): float
    {
        if (!$raw) return 9999.0;

        $minutes = 0;

        if (preg_match('/(\d+)\s*day/i',    $raw, $m)) $minutes += (int) $m[1] * 1440;
        if (preg_match('/(\d+)\s*hour/i',   $raw, $m)) $minutes += (int) $m[1] * 60;
        if (preg_match('/(\d+)\s*minute/i', $raw, $m)) $minutes += (int) $m[1];

        return $minutes / 60.0;
    }

    private function parseDateTime(?string $raw): ?string
    {
        $dt = $this->parsePortalDateTime($raw);

        if (!$dt) {
            return null;
        }

        $dt = $this->applyHourOffset($dt);

        return $dt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private function parseDueDate(?string $raw): ?string
    {
        $dt = $this->parsePortalDateTime($raw);

        return $dt ? $dt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d') : null;
    }

    private function parseDueInWithManualOffset(?string $raw): ?string
    {
        $dt = $this->parsePortalDateTime($raw);

        if (!$dt) {
            return null;
        }

        // Preserve existing business behavior (+1h target), but normalize to UTC.
        $dt = $this->applyHourOffset($dt);

        return $dt->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s');
    }

    private function calculateDueInFromReceivedAt(?string $receivedAtUtc): ?string
    {
        if (!$receivedAtUtc) {
            return null;
        }

        try {
            $dt = new DateTime($receivedAtUtc, new \DateTimeZone('UTC'));
            $dt->modify('+4 hours');

            return $dt->format('Y-m-d H:i:s');
        } catch (\Throwable $e) {
            Log::warning('FocalPb2: Failed to calculate due_in from received_at', [
                'received_at' => $receivedAtUtc,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    private function applyHourOffset(DateTime $dt): DateTime
    {
        $shifted = clone $dt;
        $shifted->modify('+1 hour');

        return $shifted;
    }

    /**
     * Parse portal date strings in a timezone-stable way across environments.
     * If no timezone marker is present, treat source as UTC to avoid server TZ drift.
     */
    private function parsePortalDateTime(?string $raw): ?DateTime
    {
        if (!$raw) {
            return null;
        }

        $raw = trim($raw);
        if ($raw === '') {
            return null;
        }

        $isUtc = preg_match('/\b(utc|z|gmt)\b/i', $raw) === 1;
        $clean = preg_replace('/\s*(utc|z|gmt)$/i', '', $raw);
        $clean = trim((string) $clean);

        $sourceTz = new \DateTimeZone('UTC');

        $formats = [
            'm/d/Y H:i:s',
            'm/d/Y H:i',
            'm/d/Y',
            'd/m/Y H:i:s',
            'd/m/Y H:i',
            'd/m/Y',
            'Y-m-d H:i:s',
            'Y-m-d H:i',
            'Y-m-d',
        ];

        foreach ($formats as $format) {
            $dt = DateTime::createFromFormat($format, $clean, $sourceTz);
            if ($dt instanceof DateTime) {
                return $dt;
            }
        }

        // Final fallback for uncommon variants.
        try {
            if ($isUtc) {
                return new DateTime($clean, new \DateTimeZone('UTC'));
            }

            return new DateTime($clean, $sourceTz);
        } catch (\Throwable $e) {
            Log::warning('FocalPb2: Failed to parse portal datetime', [
                'raw' => $raw,
                'clean' => $clean,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }
}
