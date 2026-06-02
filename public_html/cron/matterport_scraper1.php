<?php
/**
 * Matterport Xactimate Scraper
 * Logs in to fa-pb2-floor-plan-app-web-prod.azurewebsites.net,
 * scrapes the Xactimate table, and inserts new rows into project_3_orders_test.
 *
 * cPanel cron command:
 *   /usr/local/bin/php /home/crmbenchmarkstud/public_html/cron/matterport_scraper.php
 */

// ── Paths (absolute, based on this file's location) ─────────────────────────
define('BASE_DIR',    __DIR__);
define('LOG_FILE',    __DIR__ . '/scraper.log');
define('OUTPUT_FILE', __DIR__ . '/xactimate_tables.json');
define('LOCK_FILE',   __DIR__ . '/scraper.lock');

// ── Config ───────────────────────────────────────────────────────────────────
define('LOGIN_URL',          'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net/Identity/Account/Login');
define('TARGET_URL_READY',      'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net/matterport/PropertyVision?jobStatus=Ready');
define('TARGET_URL_INPROGRESS', 'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net/matterport/PropertyVision?jobStatus=InProgress');
define('EMAIL',      'focal.matterport@benchmarkstudio.biz');
define('PASSWORD',   'Mpfocal$%^123');

// ── Database ─────────────────────────────────────────────────────────────────
define('DB_HOST',    '127.0.0.1');
define('DB_NAME',    'crmbenchmarkstud_bmdb');
define('DB_USER',    'crmbenchmarkstud_crmUser');
define('DB_PASS',    'Ygykk_BKw#$*');
define('DB_TABLE',   'project_3_orders');
define('PROJECT_ID', 3);

// Max log size before rotation (5 MB)
define('LOG_MAX_BYTES', 5 * 1024 * 1024);

// ── Logging ──────────────────────────────────────────────────────────────────
function writeLog(string $level, string $message): void
{
    // Rotate log if it exceeds LOG_MAX_BYTES
    if (file_exists(LOG_FILE) && filesize(LOG_FILE) >= LOG_MAX_BYTES) {
        rename(LOG_FILE, LOG_FILE . '.' . date('YmdHis') . '.bak');
    }

    $line = date('Y-m-d H:i:s') . '  ' . str_pad($level, 8) . '  ' . $message . PHP_EOL;
    file_put_contents(LOG_FILE, $line, FILE_APPEND | LOCK_EX);
    // Echo to stdout so cPanel cron emails it on failure
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

// ── cURL session helpers ──────────────────────────────────────────────────────
$cookieJar = tempnam(sys_get_temp_dir(), 'matterport_cookies_');

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

    if ($err) {
        throw new RuntimeException("cURL GET error: $err");
    }
    if ($code >= 400) {
        throw new RuntimeException("HTTP $code on GET $url");
    }
    return $body;
}

function curlPost(string $url, array $fields): array
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
            'Origin: https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net',
            'Referer: ' . LOGIN_URL,
        ],
    ]);
    $body     = curl_exec($ch);
    $err      = curl_error($ch);
    $code     = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $finalUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
    curl_close($ch);

    if ($err) {
        throw new RuntimeException("cURL POST error: $err");
    }
    if ($code >= 400) {
        throw new RuntimeException("HTTP $code on POST $url");
    }
    return ['body' => $body, 'final_url' => $finalUrl];
}

// ── Step 1: Get antiforgery token ─────────────────────────────────────────────
logInfo(str_repeat('=', 60));
logInfo('Scraper run started');
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
logInfo('Antiforgery token obtained.');

// ── Step 2: Login ─────────────────────────────────────────────────────────────
logInfo('Sending login request ...');

try {
    $loginResult = curlPost(LOGIN_URL . '?ReturnUrl=%2F', [
        'Input.Email'                => EMAIL,
        'Input.Password'             => PASSWORD,
        '__RequestVerificationToken' => $token,
        'Input.RememberMe'           => 'false',
    ]);
} catch (RuntimeException $e) {
    logError('Login request failed: ' . $e->getMessage());
    exit(1);
}

// Verify the identity cookie was set
$cookieContents = file_get_contents($cookieJar);
if (strpos($cookieContents, '.AspNetCore.Identity.Application') === false) {
    logError('Login failed: identity cookie not found. Check credentials.');
    exit(1);
}
logInfo('Login successful.');

// ── Step 3: Fetch Xactimate pages (Ready + InProgress) ───────────────────────
logInfo('Fetching Ready page: ' . TARGET_URL_READY);
try {
    $pageHtmlReady = curlGet(TARGET_URL_READY);
} catch (RuntimeException $e) {
    logError('Failed to fetch Ready page: ' . $e->getMessage());
    exit(1);
}

logInfo('Fetching InProgress page: ' . TARGET_URL_INPROGRESS);
try {
    $pageHtmlInProgress = curlGet(TARGET_URL_INPROGRESS);
} catch (RuntimeException $e) {
    logError('Failed to fetch InProgress page: ' . $e->getMessage());
    exit(1);
}

// ── Step 4: Parse tables ──────────────────────────────────────────────────────
$allRows = [];

foreach (['Ready' => $pageHtmlReady, 'InProgress' => $pageHtmlInProgress] as $jobStatus => $pageHtml) {
    $dom2 = new DOMDocument();
    @$dom2->loadHTML($pageHtml);
    $xpath2 = new DOMXPath($dom2);

    $tables = $xpath2->query('//table');
    logInfo("[$jobStatus] Found " . $tables->length . ' table(s) on the page.');

foreach ($tables as $table) {
    $headers = [];
    $rows    = [];

    // Try thead first
    $theadThs = $xpath2->query('.//thead//th', $table);
    if ($theadThs->length > 0) {
        foreach ($theadThs as $th) {
            $headers[] = trim($th->textContent);
        }
    } else {
        // Fall back to first row
        $firstRowCells = $xpath2->query('.//tr[1]/th|.//tr[1]/td', $table);
        foreach ($firstRowCells as $cell) {
            $headers[] = trim($cell->textContent);
        }
    }

    // Body rows (skip header row if no thead)
    $tbodyRows = $xpath2->query('.//tbody/tr', $table);
    if ($tbodyRows->length === 0) {
        $tbodyRows = $xpath2->query('.//tr', $table);
    }

    foreach ($tbodyRows as $tr) {
        $cells = $xpath2->query('.//td|.//th', $tr);
        if ($cells->length === 0) {
            continue;
        }
        $cellValues = [];
        foreach ($cells as $cell) {
            $cellValues[] = trim($cell->textContent);
        }
        if (!empty($headers)) {
            $row = array_combine(
                array_slice($headers, 0, count($cellValues)),
                $cellValues
            );
        } else {
            $row = $cellValues;
        }
        $rows[]    = $row;
        $allRows[] = $row;
    }
}
} // end foreach jobStatus

logInfo('Total rows to process: ' . count($allRows));

// Save JSON snapshot
file_put_contents(OUTPUT_FILE, json_encode(['rows' => $allRows], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
logInfo('Saved snapshot to ' . OUTPUT_FILE);

// ── Step 5: Field helpers ─────────────────────────────────────────────────────

function parseDateTime(?string $raw): ?string
{
    if (!$raw) return null;
    $raw = str_replace(' Utc', '', trim($raw));
    foreach (['m/d/Y H:i:s', 'm/d/Y'] as $fmt) {
        $dt = DateTime::createFromFormat($fmt, $raw);
        if ($dt) {
            return $dt->format('Y-m-d H:i:s');
        }
    }
    return null;
}

function parseDueDate(?string $raw): ?string
{
    if (!$raw) return null;
    foreach (['m/d/Y H:i:s', 'm/d/Y'] as $fmt) {
        $dt = DateTime::createFromFormat($fmt, $raw);
        if ($dt) {
            return $dt->format('Y-m-d');
        }
    }
    return null;
}

function parseTimeLeftHours(?string $raw): float
{
    if (!$raw) return 9999.0;
    $minutes = 0;
    if (preg_match('/(\d+)\s*day/i',    $raw, $m)) $minutes += (int)$m[1] * 1440;
    if (preg_match('/(\d+)\s*hour/i',   $raw, $m)) $minutes += (int)$m[1] * 60;
    if (preg_match('/(\d+)\s*minute/i', $raw, $m)) $minutes += (int)$m[1];
    return $minutes / 60.0;
}

function priorityFromTimeLeft(?string $raw): string
{
    $hours = parseTimeLeftHours($raw);
    if ($hours > 24) return 'normal';
    if ($hours > 6)  return 'Priority';
    return 'urgent';
}

function rowToRecord(array $row): array
{
    $mappedKeys   = ['Id', 'Job Id', 'Address', 'Job Type', 'Date Received', 'Date Due', 'Time Left', ''];
    $addressRaw   = $row['Address'] ?? '';
    $address      = (stripos($addressRaw, 'no address supplied') !== false) ? null : (trim($addressRaw) ?: null);
    $timeLeftRaw  = $row['Time Left'] ?? '';
    $priority     = priorityFromTimeLeft($timeLeftRaw);
    $receivedAt   = parseDateTime($row['Date Received'] ?? '');
    if ($receivedAt) {
        $receivedAt = (new DateTime($receivedAt))->modify('+1 hour')->format('Y-m-d H:i:s');
    }
    $dueDateRaw   = $row['Date Due'] ?? '';
    $dueDate      = parseDueDate($dueDateRaw);
    // due_in stores the full Date Due datetime (varchar) for display/sorting
    // Portal returns UTC; shift +1h to BST so Remaining badge matches London wall-clock.
    // TODO: revisit at DST changeover (Oct 2026) — set back to 0 when UK is on GMT.
    $dueIn        = parseDateTime($dueDateRaw);
    if ($dueIn) {
        $dueIn = (new DateTime($dueIn))->modify('+1 hour')->format('Y-m-d H:i:s');
    }
    $dueIn        = $dueIn ?: ($dueDateRaw ?: null);

    // Unmapped fields → extra_col_json (Time Left preserved here)
    $extra = [];
    if ($timeLeftRaw !== '') {
        $extra['time_left'] = $timeLeftRaw;
    }
    foreach ($row as $k => $v) {
        if (!in_array($k, $mappedKeys, true) && $v !== null && $v !== '') {
            $extra[$k] = $v;
        }
    }
    $extraJson = $extra ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null;

    $now = gmdate('Y-m-d H:i:s');

    return [
        'order_number'   => $row['Job Id'] ?? '',
        'VARIANT_no'     => null,
        'project_id'     => PROJECT_ID,
        'extra_col_json' => $extraJson,
        'client_portal_id' => $row['Id'] ?? null,
        'address'        => $address,
        'client_name'    => null,
        'current_layer'  => 'drawer',
        'status'         => 'pending',
        'workflow_state' => 'RECEIVED',
        'workflow_type'  => 'FP_3_LAYER',
        'project_type'   => $row['Job Type'] ?? null,
        'priority'       => $priority,
        'received_at'    => $receivedAt,
        'due_date'       => $dueDate,
        'due_in'         => $dueIn,
        'import_source'  => 'api',
        'created_at'     => $now,
        'updated_at'     => $now,
    ];
}

// ── Step 6: Insert into DB ────────────────────────────────────────────────────
if (empty($allRows)) {
    logInfo('No rows scraped — nothing to insert.');
} else {
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

        // ── Pre-flight: verify required columns exist in target table ──────
        $requiredCols = [
            'order_number', 'project_id', 'client_portal_id',
            'extra_col_json', 'priority', 'due_in', 'import_source',
        ];
        $existingCols = [];
        $colStmt = $pdo->query('SHOW COLUMNS FROM `' . DB_TABLE . '`');
        foreach ($colStmt->fetchAll() as $col) {
            $existingCols[] = $col['Field'];
        }
        $missingCols = array_diff($requiredCols, $existingCols);
        if (!empty($missingCols)) {
            logError('Table `' . DB_TABLE . '` is missing column(s): ' . implode(', ', $missingCols));
            logError('Run this SQL on the database to fix:');
            foreach ($missingCols as $col) {
                if ($col === 'extra_col_json') {
                    logError("  ALTER TABLE `" . DB_TABLE . "` ADD `extra_col_json` TEXT NULL DEFAULT NULL AFTER `client_reference`;");
                } else {
                    logError("  -- Add missing column: $col");
                }
            }
            exit(1);
        }
        logInfo('Pre-flight column check passed.');

        // Fetch existing client_portal_ids
        $existing = [];
        $stmt = $pdo->query('SELECT client_portal_id FROM `' . DB_TABLE . '` WHERE client_portal_id IS NOT NULL');
        foreach ($stmt->fetchAll() as $r) {
            $existing[$r['client_portal_id']] = true;
        }
        logInfo('Loaded ' . count($existing) . ' existing client_portal_id(s) from DB.');

        $inserted = 0;
        $skipped  = 0;

        foreach ($allRows as $row) {
            $rec      = rowToRecord($row);
            $portalId = $rec['client_portal_id'];

            // PHP-level duplicate check (UNIQUE constraint is the DB safety net)
            if ($portalId && isset($existing[$portalId])) {
                logInfo("Skipping duplicate client_portal_id: $portalId");
                $skipped++;
                continue;
            }

            $cols         = array_keys($rec);
            $colList      = implode(', ', array_map(fn($c) => "`$c`", $cols));
            $placeholders = implode(', ', array_fill(0, count($cols), '?'));
            // Plain INSERT (not IGNORE) so MySQL errors surface in the catch block
            $sql = "INSERT INTO `" . DB_TABLE . "` ($colList) VALUES ($placeholders)";

            logInfo("Attempting insert for client_portal_id: $portalId  order_number: " . $rec['order_number']);

            try {
                $pdo->beginTransaction();
                $stmtIns = $pdo->prepare($sql);
                $stmtIns->execute(array_values($rec));
                $pdo->commit();

                if ($portalId) {
                    $existing[$portalId] = true;
                }
                $inserted++;
                logInfo("Inserted OK  client_portal_id: $portalId");

            } catch (PDOException $e) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                // Duplicate entry (UNIQUE violation) = expected skip, not an error
                if ($e->getCode() === '23000') {
                    logInfo("Duplicate skipped (DB constraint)  client_portal_id: $portalId");
                    $skipped++;
                } else {
                    logError("Insert FAILED for client_portal_id=$portalId  order_number=" . $rec['order_number']);
                    logError("MySQL error: [" . $e->getCode() . "] " . $e->getMessage());
                    logError("Values attempted: " . json_encode($rec));
                    $skipped++;
                }
            }
        }

        logInfo("DB insert complete — inserted: $inserted, skipped (duplicates): $skipped");

    } catch (PDOException $e) {
        logError('Database connection/query error: ' . $e->getMessage());
        if (isset($pdo) && $pdo->inTransaction()) {
            $pdo->rollBack();
            logError('Transaction rolled back.');
        }
        exit(1);
    }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
@unlink($cookieJar);
logInfo('Scraper run finished');
logInfo(str_repeat('=', 60));

flock($lockFh, LOCK_UN);
fclose($lockFh);
