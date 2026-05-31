<?php
/**
 * project_4_orderImport.php
 * Cron: every 6 minutes
 *
 * Imports PENDING schematic floor-plan orders from the Captur3d external-supplier
 * portal into project_4_orders (Schematic FP, project_id = 4).
 *
 * Portal URL: /external_supplier/schematic_floorplan_orders?filter=pending
 * Auth: HTTP Basic Auth (hard-coded, same across all Captur3d scripts)
 *
 * Table columns captured:
 *   Order ID     → order_number
 *   MP Job ID    → VARIANT_no   (alphanumeric Captur3d job identifier)
 *   Variant Name → stored in metadata
 *   Address      → address
 *   Elapsed time since order → metadata.elapsed
 *   Due in       → due_in (calculated) + metadata.due_in (raw)
 *   Priority     → priority
 *
 * Safe design:
 *   - INSERT IGNORE on order_number — never overwrites existing rows
 *   - No update/delete operations
 *   - Reads DB credentials from Laravel .env at runtime
 */

define('SCRIPT_NAME', 'project_4_orderImport');
define('PROJECT_ID',  4);
define('DB_TABLE',    'project_4_orders');
define('PORTAL_BASE', 'https://es-portal.captur3d.io');
define('PORTAL_PATH', '/external_supplier/schematic_floorplan_orders');
define('PORTAL_FILTER', 'filter=pending');
define('PORTAL_USER', 'order@benchmarkstudio.biz');
define('PORTAL_PASS', 'OgLilaA@yqE1&Rfc');
define('MAX_PAGES',   10);
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

// ─── parseDueIn ───────────────────────────────────────────────────────────────
function parseDueIn(string $raw): string
{
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

// ─── HTTP fetch (Basic Auth) ──────────────────────────────────────────────────
function fetchPage(string $url): ?string
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERPWD        => PORTAL_USER . ':' . PORTAL_PASS,
        CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 3,
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = $body === false ? curl_error($ch) : null;
    curl_close($ch);

    if ($err || $code !== 200) {
        error_log(SCRIPT_NAME . ": HTTP {$code} fetching {$url}" . ($err ? " — {$err}" : ''));
        return null;
    }
    return $body;
}

// ─── Parse HTML table into records ───────────────────────────────────────────
function parseOrders(string $html, bool $hasProcessOrderCol, ?string $processOrderValue = null): array
{
    $records = [];

    libxml_use_internal_errors(true);
    $dom = new DOMDocument();
    $dom->loadHTML('<?xml encoding="UTF-8">' . $html);
    libxml_clear_errors();
    $xpath = new DOMXPath($dom);

    $rows = $xpath->query('//table//tr');
    if (!$rows || $rows->length < 2) {
        return [];
    }

    // Extract headers from first row
    $headers = [];
    foreach ($rows->item(0)->getElementsByTagName('th') as $th) {
        $headers[] = trim($th->textContent);
    }
    if (empty($headers)) {
        return [];
    }

    $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));

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

        $orderId = trim($row['Order ID'] ?? '');
        if ($orderId === '') {
            continue;
        }

        $address      = $row['Address'] ?? '';
        $priorityRaw  = strtolower(trim($row['Priority'] ?? 'normal'));
        $priority     = in_array($priorityRaw, ['low', 'normal', 'high', 'urgent'], true)
            ? $priorityRaw : 'normal';

        $dueInRaw = trim($row['Due in'] ?? $row['Due In'] ?? '');
        $dueIn    = parseDueIn($dueInRaw);

        // Schematic-specific columns
        $mpJobId     = trim($row['MP Job ID'] ?? '');      // stored as VARIANT_no
        $variantName = trim($row['Variant Name'] ?? '');   // stored in metadata
        $elapsed     = trim($row['Elapsed time since order'] ?? '');

        $metadata = json_encode([
            'due_in'               => $dueInRaw,
            'elapsed'              => $elapsed,
            'portal_order_date_raw'=> null,  // schematic table has no Order Date column
            'variant_name'         => $variantName !== '' ? $variantName : null,
        ], JSON_UNESCAPED_UNICODE);

        $record = [
            'order_number'    => $orderId,
            'client_reference'=> $orderId,
            'project_id'      => PROJECT_ID,
            'address'         => $address,
            'priority'        => $priority,
            'current_layer'   => 'drawer',
            'status'          => 'pending',
            'workflow_state'  => 'RECEIVED',
            'workflow_type'   => 'FP_3_LAYER',
            'received_at'     => $nowPK->format('Y-m-d H:i:s'),
            'due_in'          => $dueIn,
            'VARIANT_no'      => $mpJobId !== '' ? $mpJobId : null,
            'metadata'        => $metadata,
            'import_source'   => 'cron',
            'year'            => (int) $nowPK->format('Y'),
            'month'           => (int) $nowPK->format('m'),
            'date'            => $nowPK->format('d-m-Y'),
            'created_at'      => $nowPK->format('Y-m-d H:i:s'),
            'updated_at'      => $nowPK->format('Y-m-d H:i:s'),
        ];

        if ($hasProcessOrderCol) {
            $record['process_order'] = $processOrderValue;
        }

        $records[] = $record;
    }

    return $records;
}

// ─── Bulk INSERT IGNORE ───────────────────────────────────────────────────────
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

// ─── Main ─────────────────────────────────────────────────────────────────────
try {
    $env = loadEnv(ENV_PATH);
    $pdo = dbConnect($env);

    $hasProcessOrderCol = columnExists($pdo, DB_TABLE, 'process_order');

    $totalInserted = 0;
    $baseUrl       = PORTAL_BASE . PORTAL_PATH . '?' . PORTAL_FILTER;

    for ($page = 1; $page <= MAX_PAGES; $page++) {
        $url  = $baseUrl . '&page=' . $page;
        $html = fetchPage($url);

        if ($html === null) {
            break;
        }

        $records = parseOrders($html, $hasProcessOrderCol, null);

        if (empty($records)) {
            break;
        }

        $inserted       = insertIgnore($pdo, DB_TABLE, $records);
        $totalInserted += $inserted;

        usleep(300000); // 0.3s between pages
    }

    error_log(SCRIPT_NAME . ": completed — {$totalInserted} new record(s) inserted into " . DB_TABLE);

} catch (Throwable $e) {
    error_log(SCRIPT_NAME . ": FATAL — " . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    exit(1);
}
