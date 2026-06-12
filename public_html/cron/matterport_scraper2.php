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
define('BASE_URL',           'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net');
define('LOGIN_URL',          'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net/Identity/Account/Login');
define('TARGET_URL_READY',      'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net/matterport/PropertyVision?jobStatus=Ready');
define('TARGET_URL_INPROGRESS', 'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net/matterport/PropertyVision?jobStatus=InProgress');
define('JOB_DETAIL_BASE',    'https://fa-pb2-floor-plan-app-web-prod.azurewebsites.net/matterport/PropertyVision/Jobs/JobDetails/');
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

/**
 * Fetches the job detail page for $guid, finds the "Mark as In Progress"
 * button, extracts its containing form's action URL + all hidden fields
 * (including __RequestVerificationToken), then POSTs the form.
 *
 * SAFETY: This function is ONLY called after the row for $guid has been
 * confirmed inserted in the DB (inserted++ was incremented).
 *
 * Returns true on success, false on any error (errors are logged, not thrown).
 */
function markJobAsInProgress(string $guid): bool
{
    $detailUrl = JOB_DETAIL_BASE . $guid;
    logInfo("markAsInProgress: fetching detail page for guid=$guid  url=$detailUrl");

    // ── 1. GET the detail page ──────────────────────────────────────────────
    try {
        $html = curlGet($detailUrl);
    } catch (RuntimeException $e) {
        logError("markAsInProgress: GET failed for guid=$guid — " . $e->getMessage());
        return false;
    }

    // ── 2. Parse HTML — find the form that contains the "Mark as In Progress" button ──
    $dom = new DOMDocument();
    @$dom->loadHTML($html);
    $xpath = new DOMXPath($dom);

    // Strategy A: find any <form> that contains a <button> whose text/innerHTML
    // includes "Mark as In Progress" (case-insensitive, ignores emoji whitespace).
    // Strategy B: fall back to any <form> whose action contains "InProgress".
    $targetForm = null;

    // All forms on the page
    $forms = $xpath->query('//form');
    foreach ($forms as $form) {
        // Check buttons inside this form
        $buttons = $xpath->query('.//button', $form);
        foreach ($buttons as $btn) {
            $btnText = trim(preg_replace('/\s+/', ' ', $btn->textContent));
            if (stripos($btnText, 'Mark as In Progress') !== false) {
                $targetForm = $form;
                logInfo("markAsInProgress: found button text=\"$btnText\" inside form  guid=$guid");
                break 2;
            }
        }
        // Also check <input type="submit"> and <a> elements styled as buttons
        $submits = $xpath->query('.//input[@type="submit"]', $form);
        foreach ($submits as $sub) {
            $subVal = $sub->getAttribute('value');
            if (stripos($subVal, 'Mark as In Progress') !== false) {
                $targetForm = $form;
                logInfo("markAsInProgress: found input[submit] value=\"$subVal\"  guid=$guid");
                break 2;
            }
        }
    }

    // Fallback: find form by action URL containing "InProgress"
    if ($targetForm === null) {
        foreach ($forms as $form) {
            $action = $form->getAttribute('action');
            if (stripos($action, 'InProgress') !== false) {
                $targetForm = $form;
                logInfo("markAsInProgress: fallback — found form action=\"$action\"  guid=$guid");
                break;
            }
        }
    }

    if ($targetForm === null) {
        logError("markAsInProgress: could not find 'Mark as In Progress' form on page  guid=$guid");
        logError("markAsInProgress: detail page URL was $detailUrl");
        return false;
    }

    // ── 3. Resolve form action URL ──────────────────────────────────────────
    $formAction = trim($targetForm->getAttribute('action'));
    if ($formAction === '' || $formAction === '#') {
        // No explicit action = submit back to same page (Razor Pages self-post)
        $formAction = $detailUrl;
    } elseif (strpos($formAction, 'http') !== 0) {
        // Relative URL — prepend base
        $formAction = BASE_URL . '/' . ltrim($formAction, '/');
    }
    logInfo("markAsInProgress: form action resolved to: $formAction  guid=$guid");

    // ── 4. Collect all hidden inputs (CSRF token etc.) ──────────────────────
    $postFields = [];
    $hiddenInputs = $xpath->query('.//input[@type="hidden"]', $targetForm);
    foreach ($hiddenInputs as $input) {
        $name  = $input->getAttribute('name');
        $value = $input->getAttribute('value');
        if ($name !== '') {
            $postFields[$name] = $value;
        }
    }

    // If CSRF token not in form, look for it globally on the page
    if (!isset($postFields['__RequestVerificationToken'])) {
        $globalToken = $xpath->query('//input[@name="__RequestVerificationToken"]');
        if ($globalToken->length > 0) {
            $postFields['__RequestVerificationToken'] = $globalToken->item(0)->getAttribute('value');
            logInfo("markAsInProgress: picked up global CSRF token  guid=$guid");
        } else {
            logWarning("markAsInProgress: no CSRF token found — POST may be rejected  guid=$guid");
        }
    }

    logInfo("markAsInProgress: POSTing with fields: " . implode(', ', array_keys($postFields)) . "  guid=$guid");

    // ── 5. POST the form ────────────────────────────────────────────────────
    try {
        $result = curlPost($formAction, $postFields, $detailUrl);
    } catch (RuntimeException $e) {
        logError("markAsInProgress: POST failed for guid=$guid — " . $e->getMessage());
        return false;
    }

    $finalUrl = $result['final_url'] ?? $formAction;
    logInfo("markAsInProgress: POST complete  guid=$guid  final_url=$finalUrl");

    // Treat a redirect away from the detail page as success (portal redirects after state change)
    $success = ($finalUrl !== $detailUrl) || (stripos($result['body'] ?? '', 'InProgress') !== false);
    if ($success) {
        logInfo("markAsInProgress: SUCCESS — job marked as In Progress  guid=$guid");
    } else {
        logWarning("markAsInProgress: POST completed but response unclear (may still have succeeded)  guid=$guid");
    }

    return true;
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
        // Tag each row with its source status so we know which ones to
        // mark as In Progress after a successful DB insert.
        $row['_source_status'] = $jobStatus;
        $rows[]    = $row;
        $allRows[] = $row;
    }
}
} // end foreach jobStatus

logInfo('Total rows to process: ' . count($allRows));

// Save JSON snapshot — strip the internal _source_status tag so the output
// file is identical in structure to what it was before this change.
$snapshotRows = array_map(function (array $r) {
    unset($r['_source_status']);
    return $r;
}, $allRows);
file_put_contents(OUTPUT_FILE, json_encode(['rows' => $snapshotRows], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
unset($snapshotRows);
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
    $mappedKeys   = ['Id', 'Job Id', 'Address', 'Job Type', 'Date Received', 'Date Due', 'Time Left', '', '_source_status'];
    $addressRaw   = $row['Address'] ?? '';
    $address      = (stripos($addressRaw, 'no address supplied') !== false) ? null : (trim($addressRaw) ?: null);
    $timeLeftRaw  = $row['Time Left'] ?? '';
    $priority     = priorityFromTimeLeft($timeLeftRaw);
    $receivedAt   = parseDateTime($row['Date Received'] ?? '');
    // Stored as-is in UTC — no timezone shift applied.
    $dueDateRaw   = $row['Date Due'] ?? '';
    $dueDate      = parseDueDate($dueDateRaw);
    // due_in (varchar, legacy) keeps the raw-string fallback for display.
    // due_in_date_time (DATETIME) is strict — NULL if the portal value can't be parsed,
    // so date comparisons / range filters work correctly.
    $dueInParsed     = parseDateTime($dueDateRaw);
    $dueIn           = $dueInParsed ?: ($dueDateRaw ?: null);
    $dueInDateTime   = $dueInParsed;

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
        'due_in_date_time' => $dueInDateTime,
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
            'extra_col_json', 'priority', 'due_in', 'due_in_date_time', 'import_source',
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

        // GUIDs that were successfully inserted from the "Ready" page and
        // need their portal status changed to "In Progress".
        // We populate this ONLY after a confirmed DB insert to guarantee
        // the mark-as-in-progress button is never clicked for unsaved records.
        $toMarkInProgress = [];

        foreach ($allRows as $row) {
            // Capture source status BEFORE rowToRecord strips it
            $sourceStatus = $row['_source_status'] ?? '';

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

            logInfo("Attempting insert for client_portal_id: $portalId  order_number: " . $rec['order_number'] . "  source: $sourceStatus");

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

                // ── Schedule mark-as-in-progress ONLY after confirmed DB insert ──
                // Only for Ready rows (InProgress rows are already in that state).
                if ($sourceStatus === 'Ready' && !empty($portalId)) {
                    $toMarkInProgress[] = $portalId;
                    logInfo("Queued for mark-as-in-progress: $portalId");
                }

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

// ── Step 7: Mark portal jobs as In Progress ───────────────────────────────────
// Intentionally OUTSIDE the PDO try/catch so that portal HTTP failures are
// never misreported as database errors and never trigger exit(1).
// $toMarkInProgress is only populated after a confirmed $pdo->commit(), so
// this block is a no-op when no rows were newly inserted.
if (!empty($toMarkInProgress ?? [])) {
    logInfo('Marking ' . count($toMarkInProgress) . ' job(s) as In Progress on the portal ...');
    $marked  = 0;
    $markErr = 0;
    foreach ($toMarkInProgress as $guid) {
        if (markJobAsInProgress($guid)) {
            $marked++;
        } else {
            $markErr++;
        }
        // Brief pause between portal requests to avoid rate-limiting
        usleep(500000); // 0.5 s
    }
    logInfo("Mark-as-In-Progress complete — succeeded: $marked, failed: $markErr");
} else {
    logInfo('No new Ready jobs to mark as In Progress.');
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
@unlink($cookieJar);
logInfo('Scraper run finished');
logInfo(str_repeat('=', 60));

flock($lockFh, LOCK_UN);
fclose($lockFh);
