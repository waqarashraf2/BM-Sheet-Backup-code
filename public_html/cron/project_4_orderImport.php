<?php
/**
 * project_4_orderImport.php
 * Cron: every 6 minutes
 *
 * Imports PENDING schematic floor-plan orders from the Captur3d external-supplier
 * portal into project_4_orders (Schematic FP, project_id = 4).
 *
 * Portal URL: /external_supplier/schematic_floorplan_orders.json?filter=pending
 * Auth: Session-based JSON login (reads CAPTUR3D_EMAIL / CAPTUR3D_PASSWORD from .env)
 *
 * JSON field mapping:
 *   orderableSummary.jobId              -> VARIANT_no   (Captur3d job identifier)
 *   orderableSummary.floorplanVariantName -> metadata.variant_name
 *
 * Safe design:
 *   - INSERT IGNORE on order_number -- never overwrites existing rows
 *   - No update/delete operations
 *   - Reads DB credentials from Laravel .env at runtime
 */

define('SCRIPT_NAME',   'project_4_orderImport');
define('PROJECT_ID',    4);
define('DB_TABLE',      'project_4_orders');
define('PORTAL_BASE',   'https://es-portal.captur3d.io');
define('PORTAL_PATH',   '/external_supplier/schematic_floorplan_orders');
define('PORTAL_FILTER', 'pending');
define('PORTAL_LOGIN',  'https://es-portal.captur3d.io/external_supplier/login');
define('COOKIE_FILE',   '/tmp/bms_portal_p4.txt');
define('MAX_PAGES',     15);
define('ENV_PATH',      '/home/crmbenchmarkstud/laravel-backend/.env');

// -- Load .env ----------------------------------------------------------------
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

// -- DB connection ------------------------------------------------------------
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

// -- Check column existence ---------------------------------------------------
function columnExists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare("SHOW COLUMNS FROM `{$table}` LIKE :col");
    $stmt->execute([':col' => $column]);
    return $stmt->rowCount() > 0;
}

// -- Portal session login -----------------------------------------------------
function portalLogin(array $env): bool
{
    $ch = curl_init(PORTAL_LOGIN);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_COOKIEJAR      => COOKIE_FILE,
        CURLOPT_COOKIEFILE     => COOKIE_FILE,
        CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
    ]);
    $html = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if (!$html || $code !== 200) {
        error_log(SCRIPT_NAME . ": Login page fetch failed (HTTP {$code})");
        return false;
    }

    if (!preg_match('/name="csrf-token"\s+content="([^"]+)"/', $html, $matches)) {
        error_log(SCRIPT_NAME . ': CSRF token not found in login page');
        return false;
    }
    $csrf = $matches[1];

    $email    = $env['CAPTUR3D_EMAIL']    ?? '';
    $password = $env['CAPTUR3D_PASSWORD'] ?? '';
    $payload  = json_encode(['external_supplier_user' => ['email' => $email, 'password' => $password]]);

    $ch = curl_init(PORTAL_LOGIN);
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
            'Referer: ' . PORTAL_LOGIN,
        ],
        CURLOPT_COOKIEJAR      => COOKIE_FILE,
        CURLOPT_COOKIEFILE     => COOKIE_FILE,
        CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200 || str_contains((string) $body, '"errors"')) {
        error_log(SCRIPT_NAME . ": Login POST failed (HTTP {$code}): {$body}");
        return false;
    }

    return true;
}

// -- Fetch one JSON page ------------------------------------------------------
function fetchOrdersJson(string $url): ?array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_HTTPHEADER     => ['Accept: application/json'],
        CURLOPT_COOKIEFILE     => COOKIE_FILE,
        CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200 || !$body) {
        error_log(SCRIPT_NAME . ": JSON fetch HTTP {$code} for {$url}");
        return null;
    }

    $decoded = json_decode($body, true);
    return $decoded['data'] ?? null;
}

// -- Map JSON order to DB record ----------------------------------------------
function mapOrder(array $o, bool $hasProcessOrderCol, ?string $processOrderValue): array
{
    $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));

    $priorityMap = ['low' => 'low', 'high' => 'high', 'urgent' => 'urgent'];
    $priority    = $priorityMap[strtolower($o['priority'] ?? '')] ?? 'normal';

    $receivedAt = parseIsoTs($o['orderedAt'] ?? '');
    $dueIn      = parseIsoTs($o['deliveryDeadline'] ?? $o['targetDeadline'] ?? '');

    // Schematic-specific: jobId -> VARIANT_no, floorplanVariantName -> metadata
    $jobId       = $o['orderableSummary']['jobId']                 ?? null;
    $variantName = $o['orderableSummary']['floorplanVariantName']  ?? null;

    $record = [
        'order_number'     => '#' . $o['id'],
        'client_reference' => '#' . $o['id'],
        'project_id'       => PROJECT_ID,
        'address'          => $o['propertyAddress'] ?? null,
        'priority'         => $priority,
        'current_layer'    => 'drawer',
        'status'           => 'pending',
        'workflow_state'   => 'RECEIVED',
        'workflow_type'    => 'FP_3_LAYER',
        'received_at'      => $receivedAt,
        'due_in'           => $dueIn,
        'VARIANT_no'       => $jobId,
        'metadata'         => json_encode([
            'jobId'                   => $jobId,
            'variant_name'            => $variantName,
            'estimatedSquareFootage'  => $o['orderableSummary']['estimatedSquareFootage'] ?? null,
            'providerName'            => $o['providerName']                               ?? null,
            'orderedAt'               => $o['orderedAt']                                  ?? null,
        ], JSON_UNESCAPED_UNICODE),
        'import_source'    => 'cron',
        'year'             => (int) $nowPK->format('Y'),
        'month'            => (int) $nowPK->format('m'),
        'date'             => $nowPK->format('d-m-Y'),
        'created_at'       => $nowPK->format('Y-m-d H:i:s'),
        'updated_at'       => $nowPK->format('Y-m-d H:i:s'),
    ];

    if ($hasProcessOrderCol) {
        $record['process_order'] = $processOrderValue;
    }

    return $record;
}

// -- ISO timestamp -> PKT datetime string -------------------------------------
function parseIsoTs(string $raw): string
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

// -- Bulk INSERT IGNORE -------------------------------------------------------
function insertIgnore(PDO $pdo, string $table, array $records): int
{
    if (empty($records)) {
        return 0;
    }

    $cols         = array_keys($records[0]);
    $placeholders = '(' . implode(', ', array_fill(0, count($cols), '?')) . ')';
    $sql          = 'INSERT IGNORE INTO `' . $table . '` (`'
        . implode('`, `', $cols) . '`) VALUES ' . $placeholders;

    $stmt     = $pdo->prepare($sql);
    $inserted = 0;

    foreach ($records as $r) {
        $stmt->execute(array_values($r));
        $inserted += $stmt->rowCount();
    }

    return $inserted;
}

// -- Main ---------------------------------------------------------------------
try {
    $env = loadEnv(ENV_PATH);
    $pdo = dbConnect($env);

    $hasProcessOrderCol = columnExists($pdo, DB_TABLE, 'process_order');

    if (!portalLogin($env)) {
        error_log(SCRIPT_NAME . ': portal login failed -- aborting');
        exit(1);
    }

    $totalInserted = 0;
    $baseUrl       = PORTAL_BASE . PORTAL_PATH . '.json?filter=' . PORTAL_FILTER;

    for ($page = 1; $page <= MAX_PAGES; $page++) {
        $url  = $baseUrl . '&page=' . $page;
        $data = fetchOrdersJson($url);

        if ($data === null) {
            break;
        }

        $orders = $data['orders'] ?? [];
        if (empty($orders)) {
            break;
        }

        $records = array_map(fn($o) => mapOrder($o, $hasProcessOrderCol, null), $orders);
        $totalInserted += insertIgnore($pdo, DB_TABLE, $records);

        $totalPages = (int) ($data['meta']['totalPages'] ?? 1);
        if ($page >= $totalPages) {
            break;
        }

        usleep(300000);
    }

    if (file_exists(COOKIE_FILE)) {
        @unlink(COOKIE_FILE);
    }

    error_log(SCRIPT_NAME . ": completed -- {$totalInserted} new record(s) inserted into " . DB_TABLE);

} catch (Throwable $e) {
    error_log(SCRIPT_NAME . ': FATAL -- ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    exit(1);
}
