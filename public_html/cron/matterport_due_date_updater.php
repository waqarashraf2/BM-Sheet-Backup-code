<?php
/**
 * Matterport Due-Date Updater
 *
 * For every row in project_3_orders with a given received_at date,
 * fetches the JobDetails page from the Matterport portal, extracts
 * the "Date Due" cell, and updates due_in_date_time (DATETIME).
 *
 * Usage:
 *   php matterport_due_date_updater.php                 # defaults to today (UTC)
 *   php matterport_due_date_updater.php 2026-06-11      # process rows received on this date
 *
 * cPanel cron (e.g. nightly refresh for today's intake):
 *   /usr/local/bin/php /home/crmbenchmarkstud/public_html/cron/matterport_due_date_updater.php
 */

// ── Paths ────────────────────────────────────────────────────────────────────
define('BASE_DIR',  __DIR__);
define('LOG_FILE',  __DIR__ . '/matterport_due_date_updater.log');
define('LOCK_FILE', __DIR__ . '/matterport_due_date_updater.lock');

// ── Portal config ────────────────────────────────────────────────────────────
define('BASE_URL',        'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net');
define('LOGIN_URL',       'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net/Identity/Account/Login');
define('JOB_DETAIL_BASE', 'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net/matterport/PropertyVision/Jobs/JobDetails/');
define('EMAIL',    'focal.matterport@benchmarkstudio.biz');
define('PASSWORD', 'Mpfocal$%^123');

// ── Database ─────────────────────────────────────────────────────────────────
define('DB_HOST',    '127.0.0.1');
define('DB_NAME',    'crmbenchmarkstud_bmdb');
define('DB_USER',    'crmbenchmarkstud_crmUser');
define('DB_PASS',    'Ygykk_BKw#$*');
define('DB_TABLE',   'project_3_orders');
define('PROJECT_ID', 3);

// Pause between portal requests (microseconds)
define('PORTAL_DELAY_US', 500000); // 0.5 s
// Max log size before rotation (5 MB)
define('LOG_MAX_BYTES',   5 * 1024 * 1024);

// ── CLI arg: received_at date ────────────────────────────────────────────────
$receivedDate = $argv[1] ?? gmdate('Y-m-d');
$dt = DateTime::createFromFormat('Y-m-d', $receivedDate);
if (!$dt || $dt->format('Y-m-d') !== $receivedDate) {
    fwrite(STDERR, "Invalid date arg: '$receivedDate'. Expected format Y-m-d (e.g. 2026-06-11)\n");
    exit(1);
}

// ── Logging ──────────────────────────────────────────────────────────────────
function writeLog(string $level, string $message): void
{
    if (file_exists(LOG_FILE) && filesize(LOG_FILE) >= LOG_MAX_BYTES) {
        rename(LOG_FILE, LOG_FILE . '.' . date('YmdHis') . '.bak');
    }
    $line = date('Y-m-d H:i:s') . '  ' . str_pad($level, 8) . '  ' . $message . PHP_EOL;
    file_put_contents(LOG_FILE, $line, FILE_APPEND | LOCK_EX);
    echo $line;
}
function logInfo(string $msg):    void { writeLog('INFO',    $msg); }
function logWarning(string $msg): void { writeLog('WARNING', $msg); }
function logError(string $msg):   void { writeLog('ERROR',   $msg); }

// ── Lock: prevent overlapping cron runs ──────────────────────────────────────
$lockFh = fopen(LOCK_FILE, 'w');
if (!$lockFh || !flock($lockFh, LOCK_EX | LOCK_NB)) {
    logWarning('Another instance is already running (lock held). Exiting.');
    exit(0);
}

// ── cURL helpers ─────────────────────────────────────────────────────────────
$cookieJar = tempnam(sys_get_temp_dir(), 'matterport_due_cookies_');

function curlGet(string $url): string
{
    global $cookieJar;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_COOKIEFILE     => $cookieJar,
        CURLOPT_COOKIEJAR      => $cookieJar,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.9',
        ],
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($err)        throw new RuntimeException("cURL GET error: $err");
    if ($code >= 400) throw new RuntimeException("HTTP $code on GET $url");
    return $body;
}

function curlPost(string $url, array $fields, string $referer = LOGIN_URL): array
{
    global $cookieJar;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => http_build_query($fields),
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_COOKIEFILE     => $cookieJar,
        CURLOPT_COOKIEJAR      => $cookieJar,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_USERAGENT      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        CURLOPT_HTTPHEADER     => [
            'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language: en-US,en;q=0.9',
            'Content-Type: application/x-www-form-urlencoded',
            'Origin: ' . BASE_URL,
            'Referer: ' . $referer,
        ],
    ]);
    $body = curl_exec($ch);
    $err  = curl_error($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($err)        throw new RuntimeException("cURL POST error: $err");
    if ($code >= 400) throw new RuntimeException("HTTP $code on POST $url");
    return ['body' => $body];
}

/**
 * Parses "06/13/2026 14:05:54 Utc" → "2026-06-13 14:05:54"
 * Also accepts the date-only form "06/13/2026".
 */
function parsePortalDateTime(?string $raw): ?string
{
    if (!$raw) return null;
    $raw = trim(preg_replace('/\s+/', ' ', $raw));
    $raw = preg_replace('/\s*Utc\s*$/i', '', $raw);
    foreach (['m/d/Y H:i:s', 'm/d/Y'] as $fmt) {
        $dt = DateTime::createFromFormat($fmt, $raw);
        if ($dt) return $dt->format('Y-m-d H:i:s');
    }
    return null;
}

/**
 * Pulls the value of the <td> that sits next to <th>Date Due</th> on the
 * JobDetails page. Returns the raw cell text or null if not found.
 */
function extractDateDueCell(string $html): ?string
{
    $dom = new DOMDocument();
    @$dom->loadHTML($html);
    $xpath = new DOMXPath($dom);

    // <th>Date Due</th><td>...</td>
    $nodes = $xpath->query('//th[normalize-space(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"))="date due"]/following-sibling::td[1]');
    if ($nodes->length > 0) {
        return trim($nodes->item(0)->textContent);
    }
    return null;
}

// ── Step 1: Login ────────────────────────────────────────────────────────────
logInfo(str_repeat('=', 60));
logInfo("Due-date updater started — received_at = $receivedDate");
logInfo('Fetching login page for antiforgery token ...');

try {
    $loginPageHtml = curlGet(LOGIN_URL);
} catch (RuntimeException $e) {
    logError('Failed to fetch login page: ' . $e->getMessage());
    exit(1);
}

$dom = new DOMDocument();
@$dom->loadHTML($loginPageHtml);
$xpath = new DOMXPath($dom);
$tokenNodes = $xpath->query('//input[@name="__RequestVerificationToken"]');
if ($tokenNodes->length === 0) {
    logError('__RequestVerificationToken not found on login page.');
    exit(1);
}
$token = $tokenNodes->item(0)->getAttribute('value');

logInfo('Sending login request ...');
try {
    curlPost(LOGIN_URL . '?ReturnUrl=%2F', [
        'Input.Email'                => EMAIL,
        'Input.Password'             => PASSWORD,
        '__RequestVerificationToken' => $token,
        'Input.RememberMe'           => 'false',
    ]);
} catch (RuntimeException $e) {
    logError('Login request failed: ' . $e->getMessage());
    exit(1);
}

if (strpos(file_get_contents($cookieJar), '.AspNetCore.Identity.Application') === false) {
    logError('Login failed: identity cookie not found. Check credentials.');
    exit(1);
}
logInfo('Login successful.');

// ── Step 2: Pull candidate rows from DB ─────────────────────────────────────
try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );
} catch (PDOException $e) {
    logError('Database connection error: ' . $e->getMessage());
    exit(1);
}

$sql = 'SELECT id, client_portal_id, order_number, due_in_date_time
        FROM `' . DB_TABLE . '`
        WHERE project_id = :pid
          AND client_portal_id IS NOT NULL
          AND client_portal_id <> ""
          AND DATE(received_at) = :rdate';
$sel = $pdo->prepare($sql);
$sel->execute([':pid' => PROJECT_ID, ':rdate' => $receivedDate]);
$rows = $sel->fetchAll();

logInfo('Rows to refresh: ' . count($rows));
if (empty($rows)) {
    logInfo('Nothing to do.');
    @unlink($cookieJar);
    flock($lockFh, LOCK_UN);
    fclose($lockFh);
    exit(0);
}

// ── Step 3: For each row, scrape detail page and update ─────────────────────
$updated = 0;
$unchanged = 0;
$notFound = 0;
$errors = 0;

$updStmt = $pdo->prepare(
    'UPDATE `' . DB_TABLE . '`
        SET due_in_date_time = :ddt
      WHERE id = :id'
);

foreach ($rows as $r) {
    $guid       = $r['client_portal_id'];
    $rowId      = (int)$r['id'];
    $orderNum   = $r['order_number'];
    $detailUrl  = JOB_DETAIL_BASE . $guid;

    logInfo("→ id=$rowId order=$orderNum guid=$guid");

    try {
        $html = curlGet($detailUrl);
    } catch (RuntimeException $e) {
        logError("  GET detail failed: " . $e->getMessage());
        $errors++;
        usleep(PORTAL_DELAY_US);
        continue;
    }

    $rawDue = extractDateDueCell($html);
    if ($rawDue === null) {
        logWarning("  'Date Due' cell not found on detail page");
        $notFound++;
        usleep(PORTAL_DELAY_US);
        continue;
    }

    $parsed = parsePortalDateTime($rawDue);
    if ($parsed === null) {
        logWarning("  Could not parse Date Due value: \"$rawDue\"");
        $notFound++;
        usleep(PORTAL_DELAY_US);
        continue;
    }

    if (($r['due_in_date_time'] ?? null) === $parsed) {
        logInfo("  unchanged ($parsed)");
        $unchanged++;
        usleep(PORTAL_DELAY_US);
        continue;
    }

    try {
        $updStmt->execute([
            ':ddt' => $parsed,
            ':id'  => $rowId,
        ]);
        logInfo("  updated due_in_date_time = $parsed  (was: " . ($r['due_in_date_time'] ?? 'NULL') . ")");
        $updated++;
    } catch (PDOException $e) {
        logError("  UPDATE failed: " . $e->getMessage());
        $errors++;
    }

    usleep(PORTAL_DELAY_US);
}

logInfo("Summary — updated: $updated, unchanged: $unchanged, not-found: $notFound, errors: $errors");

// ── Cleanup ─────────────────────────────────────────────────────────────────
@unlink($cookieJar);
logInfo('Due-date updater finished');
logInfo(str_repeat('=', 60));

flock($lockFh, LOCK_UN);
fclose($lockFh);
