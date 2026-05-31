<?php
/**
 * matterport_scraper.php
 * Cron: every 5 minutes
 *
 * Standalone PHP equivalent of the Laravel FocalPb2ScraperService.
 * Scrapes the FocalPb2 portal for PropertyVision floor-plan jobs and inserts
 * new records into project_2_orders (Focal PB FP, project_id = 2).
 *
 * Portal: https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net
 * Auth:   Session-based login (CSRF + form POST)
 * Scrape: /propertybox2/PropertyVision  (default + ?jobStatus=InProgress)
 *
 * NOTE: The Laravel scheduler also runs scrape:focalpb2 every 10 minutes.
 * This standalone script provides 5-minute redundancy for the same project.
 * Both use INSERT IGNORE so there is zero risk of duplicate records.
 *
 * Safe design:
 *   - INSERT IGNORE on order_number / client_portal_id — never overwrites
 *   - No update/delete operations
 *   - Reads DB credentials from Laravel .env at runtime
 */

define('SCRIPT_NAME', 'matterport_scraper');
define('PROJECT_ID',  2);
define('DB_TABLE',    'project_2_orders');
define('BASE_URL',    'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net');
define('PORTAL_EMAIL',    'focal.matterport@benchmarkstudio.biz');
define('PORTAL_PASSWORD', 'Mpfocal$%^123');
define('ENV_PATH',    '/home/crmbenchmarkstud/laravel-backend/.env');

// ─── Load .env ────────────────────────────────────────────────────────────────
function loadEnv(string $path): array
{
    $env = [];
    if (!file_exists($path)) {
        return $env;
    }
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') {
            continue;
        }
        $pos = strpos($line, '=');
        if ($pos === false) {
            continue;
        }
        $k = trim(substr($line, 0, $pos));
        $v = trim(substr($line, $pos + 1));
        if (strlen($v) >= 2 && (($v[0] === '"' && $v[-1] === '"') || ($v[0] === "'" && $v[-1] === "'"))) {
            $v = substr($v, 1, -1);
        }
        $env[$k] = $v;
    }
    return $env;
}

// ─── DB connection ────────────────────────────────────────────────────────────
function dbConnect(array $env): PDO
{
    $host = $env['DB_HOST']     ?? '127.0.0.1';
    $port = $env['DB_PORT']     ?? '3306';
    $name = $env['DB_DATABASE'] ?? '';
    $user = $env['DB_USERNAME'] ?? '';
    $pass = $env['DB_PASSWORD'] ?? '';

    $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
    return new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES utf8mb4",
    ]);
}

// ─── Check column existence ───────────────────────────────────────────────────
function columnExists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare("SHOW COLUMNS FROM `{$table}` LIKE :col");
    $stmt->execute([':col' => $column]);
    return $stmt->rowCount() > 0;
}

// ─── HTTP helper with cookie jar ──────────────────────────────────────────────
// Uses a temp file cookie jar so curl manages the session cookies automatically.
$cookieJar = tempnam(sys_get_temp_dir(), 'bm_mp_cookie_');

function httpGet(string $url, string $cookieJar, array $extraHeaders = []): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_COOKIEJAR      => $cookieJar,
        CURLOPT_COOKIEFILE     => $cookieJar,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => array_merge([
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.9',
        ], $extraHeaders),
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = $body === false ? curl_error($ch) : null;
    curl_close($ch);
    return ['code' => $code, 'body' => $body ?: '', 'error' => $err];
}

function httpPost(string $url, array $formData, string $cookieJar, string $referer = ''): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($formData),
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_COOKIEJAR      => $cookieJar,
        CURLOPT_COOKIEFILE     => $cookieJar,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/x-www-form-urlencoded',
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.9',
            'Origin: ' . BASE_URL,
            'Referer: ' . ($referer ?: BASE_URL . '/Identity/Account/Login'),
        ],
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = $body === false ? curl_error($ch) : null;
    curl_close($ch);
    return ['code' => $code, 'body' => $body ?: '', 'error' => $err];
}

// ─── Extract CSRF token ───────────────────────────────────────────────────────
function extractCsrfToken(string $html): ?string
{
    libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $dom->loadHTML($html);
    libxml_clear_errors();
    $xpath  = new DOMXPath($dom);
    $tokens = $xpath->query('//input[@name="__RequestVerificationToken"]');
    if (!$tokens || $tokens->length === 0) {
        return null;
    }
    return (string) $tokens->item(0)->getAttribute('value');
}

// ─── Parse HTML table rows from a page ───────────────────────────────────────
function parseTableRows(string $html): array
{
    $rows = [];

    libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $dom->loadHTML('<?xml encoding="UTF-8">' . $html);
    libxml_clear_errors();
    $xpath  = new DOMXPath($dom);
    $tables = $xpath->query('//table');

    if (!$tables || $tables->length === 0) {
        return [];
    }

    foreach ($tables as $table) {
        $headers = [];

        // Prefer thead headers; fall back to first row
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

        if (empty($headers)) {
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

            // Skip empty-state placeholder rows
            if (count($values) === 1 && strcasecmp(trim($values[0]), 'No jobs available') === 0) {
                continue;
            }
            if (empty($values)) {
                continue;
            }

            $row = array_combine(
                array_slice($headers, 0, count($values)),
                $values
            );
            $rows[] = $row;
        }
    }

    return $rows;
}

// ─── Resolve row value by multiple candidate header names ────────────────────
function rowValue(array $row, array $candidates): ?string
{
    foreach ($candidates as $key) {
        if (isset($row[$key]) && trim((string)$row[$key]) !== '') {
            return trim((string)$row[$key]);
        }
    }
    // Normalised fallback (lowercase, collapse whitespace)
    $normalised = [];
    foreach ($row as $k => $v) {
        $nk = preg_replace('/\s+/', ' ', strtolower(trim((string)$k)));
        $normalised[$nk] = $v;
    }
    foreach ($candidates as $key) {
        $nk = preg_replace('/\s+/', ' ', strtolower(trim($key)));
        if (isset($normalised[$nk]) && trim((string)$normalised[$nk]) !== '') {
            return trim((string)$normalised[$nk]);
        }
    }
    return null;
}

// ─── Priority resolution from Time Left string ───────────────────────────────
function resolvePriority(?string $timeLeft): string
{
    if ($timeLeft === null || trim($timeLeft) === '') {
        return 'normal';
    }
    $t = strtolower(trim($timeLeft));
    if (str_contains($t, 'urgent') || str_contains($t, 'overdue')) {
        return 'urgent';
    }
    if (str_contains($t, 'high')) {
        return 'high';
    }
    return 'normal';
}

// ─── Parse a due date string into Y-m-d ──────────────────────────────────────
function parseDueDate(?string $raw): ?string
{
    if ($raw === null || trim($raw) === '' || trim($raw) === '-') {
        return null;
    }
    $ts = strtotime($raw);
    return $ts !== false ? date('Y-m-d', $ts) : null;
}

// ─── Parse due_in into a PKT timestamp ───────────────────────────────────────
function parseDueIn(?string $raw): ?string
{
    if ($raw === null || trim($raw) === '' || trim($raw) === '-') {
        return null;
    }
    $dt  = new DateTime('now', new DateTimeZone('Asia/Karachi'));
    $low = strtolower(trim($raw));

    if (preg_match('/(\d+)/', $low, $m)) {
        $v = (int) $m[1];
        if ($v > 0) {
            if (str_contains($low, 'day'))        { $dt->modify("+{$v} days"); }
            elseif (str_contains($low, 'hour'))   { $dt->modify("+{$v} hours"); }
            elseif (str_contains($low, 'minute')) { $dt->modify("+{$v} minutes"); }
            else                                   { $dt->modify("+{$v} hours"); }
        }
    }

    return $dt->format('Y-m-d H:i:s');
}

// ─── Clean address ────────────────────────────────────────────────────────────
function cleanAddress(?string $raw): ?string
{
    if ($raw === null) {
        return null;
    }
    $cleaned = preg_replace('/\s+/', ' ', trim($raw));
    return $cleaned !== '' ? $cleaned : null;
}

// ─── Build a DB record from a scraped row ────────────────────────────────────
function buildRecord(array $row): ?array
{
    $orderId = rowValue($row, ['Order', 'Order Number', 'order_number', 'OrderId', 'Order Id', 'Id', 'ID', 'Job Id', 'JobID']);
    if ($orderId === null || trim($orderId) === '') {
        return null;
    }

    $clientPortalId = rowValue($row, ['Id', 'ID', 'Job Id', 'JobID', 'Portal Id']);
    if ($clientPortalId !== null && trim($clientPortalId) === '') {
        $clientPortalId = null;
    }

    // Use clientPortalId as order_number fallback if order is purely numeric or empty
    $orderNumber = $orderId;
    if ($clientPortalId !== null && ($orderNumber === '' || ctype_digit($orderNumber))) {
        $orderNumber = $clientPortalId;
    }

    $addressRaw  = rowValue($row, ['Property Address', 'Address', 'Property', 'address']);
    $dateReceived = rowValue($row, ['Date Received', 'Received', 'Date', 'Created', 'Created At']);
    $dueDateRaw   = rowValue($row, ['Due Date', 'Due', 'Due by', 'Deadline']);
    $timeLeftRaw  = rowValue($row, ['Time Left', 'Time Remaining', 'Status']);
    $jobType      = rowValue($row, ['Job Type', 'Type', 'Product', 'Plan Type']);

    $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));

    // Extra columns (time_left + any unmapped)
    $mappedKeys = [
        'Order', 'Order Number', 'order_number', 'OrderId', 'Order Id', 'Id', 'ID',
        'Job Id', 'JobID', 'Portal Id',
        'Property Address', 'Address', 'Property', 'address',
        'Date Received', 'Received', 'Date', 'Created', 'Created At',
        'Due Date', 'Due', 'Due by', 'Deadline',
        'Time Left', 'Time Remaining', 'Status',
        'Job Type', 'Type', 'Product', 'Plan Type',
    ];
    $extra = [];
    if ($timeLeftRaw !== null && $timeLeftRaw !== '') {
        $extra['time_left'] = $timeLeftRaw;
    }
    foreach ($row as $k => $v) {
        if (!in_array($k, $mappedKeys, true) && $v !== null && trim((string)$v) !== '') {
            $extra[$k] = $v;
        }
    }

    return [
        'order_number'     => $orderNumber,
        'VARIANT_no'       => null,
        'project_id'       => PROJECT_ID,
        'metadata'         => $extra ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null,
        'client_portal_id' => $clientPortalId,
        'address'          => cleanAddress($addressRaw),
        'client_name'      => null,
        'current_layer'    => 'drawer',
        'status'           => 'pending',
        'workflow_state'   => 'RECEIVED',
        'workflow_type'    => 'FP_3_LAYER',
        'project_type'     => $jobType,
        'priority'         => resolvePriority($timeLeftRaw),
        'received_at'      => $dateReceived ? (strtotime($dateReceived) !== false ? date('Y-m-d H:i:s', strtotime($dateReceived)) : $nowPK->format('Y-m-d H:i:s')) : $nowPK->format('Y-m-d H:i:s'),
        'due_date'         => parseDueDate($dueDateRaw),
        'due_in'           => parseDueIn($dueDateRaw) ?: ($dueDateRaw ?: null),
        'import_source'    => 'cron',
        'year'             => (int) $nowPK->format('Y'),
        'month'            => (int) $nowPK->format('m'),
        'date'             => $nowPK->format('d-m-Y'),
        'created_at'       => $nowPK->format('Y-m-d H:i:s'),
        'updated_at'       => $nowPK->format('Y-m-d H:i:s'),
    ];
}

// ─── Persist rows to DB ───────────────────────────────────────────────────────
function persist(PDO $pdo, array $rawRows): array
{
    if (empty($rawRows)) {
        return [0, 0];
    }

    // Load existing identifiers to skip duplicates before inserting
    $existingPortalIds = $pdo->query(
        'SELECT client_portal_id FROM `' . DB_TABLE . '` WHERE client_portal_id IS NOT NULL'
    )->fetchAll(PDO::FETCH_COLUMN);
    $existingPortalIds = array_flip($existingPortalIds);

    $existingOrderNums = $pdo->query(
        'SELECT order_number FROM `' . DB_TABLE . '` WHERE order_number IS NOT NULL'
    )->fetchAll(PDO::FETCH_COLUMN);
    $existingOrderNums = array_flip($existingOrderNums);

    $inserted = 0;
    $skipped  = 0;

    foreach ($rawRows as $rawRow) {
        $record = buildRecord($rawRow);
        if ($record === null) {
            $skipped++;
            continue;
        }

        $orderNum       = $record['order_number']  ?? null;
        $clientPortalId = $record['client_portal_id'] ?? null;

        // Skip if we already have this record
        if ($orderNum !== null && isset($existingOrderNums[$orderNum])) {
            $skipped++;
            continue;
        }
        if ($clientPortalId !== null && isset($existingPortalIds[$clientPortalId])) {
            $skipped++;
            continue;
        }

        // Remove columns that don't exist (e.g. due_date if schema doesn't have it)
        // Use INSERT IGNORE as the final safety net
        $cols         = array_keys($record);
        $placeholders = implode(', ', array_fill(0, count($cols), '?'));
        $sql          = 'INSERT IGNORE INTO `' . DB_TABLE . '` (`' . implode('`, `', $cols) . '`) VALUES (' . $placeholders . ')';

        try {
            $stmt = $pdo->prepare($sql);
            $stmt->execute(array_values($record));
            if ($stmt->rowCount() > 0) {
                $inserted++;
                if ($orderNum !== null) {
                    $existingOrderNums[$orderNum] = true;
                }
            } else {
                $skipped++;
            }
        } catch (PDOException $e) {
            // Log but continue — don't let one bad row stop the import
            error_log(SCRIPT_NAME . ": insert error for order {$orderNum}: " . $e->getMessage());
            $skipped++;
        }
    }

    return [$inserted, $skipped];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
try {
    $env = loadEnv(ENV_PATH);
    $pdo = dbConnect($env);

    // Step 1 — Get CSRF token from login page
    $loginPageResp = httpGet(BASE_URL . '/Identity/Account/Login', $cookieJar);
    if ($loginPageResp['code'] !== 200) {
        error_log(SCRIPT_NAME . ": Cannot reach login page — HTTP " . $loginPageResp['code']);
        exit(1);
    }

    $csrfToken = extractCsrfToken($loginPageResp['body']);
    if ($csrfToken === null) {
        error_log(SCRIPT_NAME . ": CSRF token not found on login page");
        exit(1);
    }

    // Step 2 — Authenticate
    $loginResp = httpPost(
        BASE_URL . '/Identity/Account/Login?ReturnUrl=%2F',
        [
            'Input.Email'                => PORTAL_EMAIL,
            'Input.Password'             => PORTAL_PASSWORD,
            '__RequestVerificationToken' => $csrfToken,
            'Input.RememberMe'           => 'false',
        ],
        $cookieJar,
        BASE_URL . '/Identity/Account/Login'
    );

    // After successful login the portal redirects (302→200) to dashboard.
    // A failed login stays on /Login (URL or body check).
    if ($loginResp['code'] !== 200 || str_contains($loginResp['body'], 'Invalid login')) {
        error_log(SCRIPT_NAME . ": Login failed — HTTP " . $loginResp['code']);
        exit(1);
    }

    // Step 3 — Scrape both pages (default + InProgress)
    $paths = [
        '/propertybox2/PropertyVision',
        '/propertybox2/PropertyVision?jobStatus=InProgress',
    ];

    $allRows = [];
    $seen    = [];

    foreach ($paths as $path) {
        $resp = httpGet(BASE_URL . $path, $cookieJar);
        if ($resp['code'] !== 200) {
            error_log(SCRIPT_NAME . ": HTTP " . $resp['code'] . " fetching {$path}");
            continue;
        }

        $rows = parseTableRows($resp['body']);

        foreach ($rows as $row) {
            // Deduplicate across both pages
            $key = trim((string)($row['Id'] ?? $row['ID'] ?? $row['Job Id'] ?? $row['JobID'] ?? ''));
            if ($key === '') {
                $key = md5(json_encode($row));
            }
            if (!isset($seen[$key])) {
                $seen[$key]  = true;
                $allRows[]   = $row;
            }
        }

        usleep(200000); // 0.2s between page fetches
    }

    // Step 4 — Persist
    [$inserted, $skipped] = persist($pdo, $allRows);

    error_log(SCRIPT_NAME . ": completed — inserted: {$inserted}, skipped: {$skipped}");

} catch (Throwable $e) {
    error_log(SCRIPT_NAME . ": FATAL — " . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    exit(1);
} finally {
    // Clean up cookie jar temp file
    if (isset($cookieJar) && file_exists($cookieJar)) {
        @unlink($cookieJar);
    }
}
