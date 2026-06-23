<?php
/**
 * project_51_orderImport.php
 * Cron: every 6 minutes
 *
 * Imports jobs from the esoft Lychee production-tracking system
 * into project_51_orders (project_id = 51).
 *
 * Auth flow:
 *   1. POST https://prod-sso-service.esoftsystems.com/authentication
 *      Basic <client_id:client_secret> + JSON {username,password}
 *      Returns accessToken (Bearer, ~24h validity) cached to /tmp/lychee_token_p51.json
 *   2. POST https://prod-lychee-service.esoftsystems.com/jobs/search
 *      Bearer <accessToken> + JSON search payload
 *      Returns {total, jobs:[{id,jobId,...}]}
 *
 * Mapping:
 *   jobs[].id              -> client_portal_id  (the unique upsert key)
 *   jobs[].jobId           -> VARIANT_no
 *   jobs[].startedTime     -> received_at        (Unix ms -> PKT datetime)
 *   jobs[].finishedTime    -> due_in             (Unix ms -> PKT datetime, fallback now)
 *   jobs[].state           -> status             (COMPLETE -> completed, etc.)
 *   jobs[] (full record)   -> metadata           (JSON dump of every field)
 *
 * Safe design:
 *   - INSERT IGNORE on client_portal_id  -- never overwrites existing rows
 *   - No update / delete operations
 *   - Reads DB credentials from Laravel .env at runtime
 *   - Token cached to disk to avoid re-authenticating on every run
 */

define('SCRIPT_NAME',         'project_51_orderImport');
define('PROJECT_ID',          51);
define('DB_TABLE',            'project_51_orders_test');
define('AUTH_URL',            'https://prod-sso-service.esoftsystems.com/authentication');
define('JOBS_URL',            'https://prod-lychee-service.esoftsystems.com/jobs/search');
define('TOKEN_CACHE_FILE',    '/tmp/lychee_token_p51.json');
define('MAX_PAGES',           20);
define('PAGE_SIZE',           500);
define('LOOKBACK_HOURS',      72); // fetch jobs created in the last 72h on each run
define('ENV_PATH',            '/home/crmbenchmarkstud/laravel-backend/.env');

// Lychee credentials (override via .env if present).
define('DEFAULT_LYCHEE_CLIENT_ID',     'LYCHEE_APPLICATION');
define('DEFAULT_LYCHEE_CLIENT_SECRET', 'ow4oi34krjtoeDD554@@sss##8ghjfgph3');
define('DEFAULT_LYCHEE_USERNAME',      'shahbaz@benchmarkstudio.biz');
define('DEFAULT_LYCHEE_PASSWORD',      'S1234567');
define('LYCHEE_TEAM',                  'BENAM');

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

// -- Check if a column exists in the table ------------------------------------
function columnExists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare("SHOW COLUMNS FROM `{$table}` LIKE :col");
    $stmt->execute([':col' => $column]);
    return $stmt->rowCount() > 0;
}

// -- Get list of columns that exist in the table ------------------------------
function getTableColumns(PDO $pdo, string $table): array
{
    $cols = [];
    $stmt = $pdo->query("SHOW COLUMNS FROM `{$table}`");
    while ($row = $stmt->fetch()) {
        $cols[$row['Field']] = true;
    }
    return $cols;
}

// -- Get a valid Lychee access token (from cache or fresh authentication) -----
function getLycheeAccessToken(array $env): ?string
{
    // Try cached token first.
    if (file_exists(TOKEN_CACHE_FILE)) {
        $raw = @file_get_contents(TOKEN_CACHE_FILE);
        if ($raw !== false) {
            $cached = json_decode($raw, true);
            if (is_array($cached) && !empty($cached['accessToken']) && !empty($cached['accessTokenExpiresAt'])) {
                // Refresh 5 minutes before actual expiry to avoid mid-request expiry.
                $expiresAt = strtotime($cached['accessTokenExpiresAt']);
                if ($expiresAt !== false && $expiresAt > (time() + 300)) {
                    return $cached['accessToken'];
                }
            }
        }
    }

    // Fall back to fresh authentication.
    $clientId     = $env['LYCHEE_CLIENT_ID']     ?? DEFAULT_LYCHEE_CLIENT_ID;
    $clientSecret = $env['LYCHEE_CLIENT_SECRET'] ?? DEFAULT_LYCHEE_CLIENT_SECRET;
    $username     = $env['LYCHEE_USERNAME']      ?? DEFAULT_LYCHEE_USERNAME;
    $password     = $env['LYCHEE_PASSWORD']      ?? DEFAULT_LYCHEE_PASSWORD;

    $payload = json_encode(['username' => $username, 'password' => $password]);
    $basic   = base64_encode($clientId . ':' . $clientSecret);

    $ch = curl_init(AUTH_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Accept: application/json',
            'Content-Type: application/json',
            'Authorization: Basic ' . $basic,
        ],
        CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200 || !$body) {
        error_log(SCRIPT_NAME . ": Lychee authentication HTTP {$code}: " . substr((string) $body, 0, 300));
        return null;
    }

    $decoded = json_decode($body, true);
    if (!is_array($decoded) || empty($decoded['accessToken'])) {
        error_log(SCRIPT_NAME . ': Lychee authentication response missing accessToken: ' . substr($body, 0, 300));
        return null;
    }

    // Cache for next run (chmod 600 - readable only by owner).
    @file_put_contents(TOKEN_CACHE_FILE, json_encode($decoded), LOCK_EX);
    @chmod(TOKEN_CACHE_FILE, 0600);

    return $decoded['accessToken'];
}

// -- POST /jobs/search and return one page of results --------------------------
function fetchJobsPage(string $token, array $payload): ?array
{
    $ch = curl_init(JOBS_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => [
            'Accept: application/json',
            'Content-Type: application/json',
            'Authorization: Bearer ' . $token,
        ],
        CURLOPT_USERAGENT      => 'BenchmarkCron/1.0',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code === 401) {
        // Token expired between cache write and now -- delete cache so next run re-auths.
        @unlink(TOKEN_CACHE_FILE);
        error_log(SCRIPT_NAME . ': /jobs/search returned 401 -- cleared token cache');
        return null;
    }

    if ($code !== 200 || !$body) {
        error_log(SCRIPT_NAME . ": /jobs/search HTTP {$code}: " . substr((string) $body, 0, 300));
        return null;
    }

    $decoded = json_decode($body, true);
    return is_array($decoded) ? $decoded : null;
}

// -- Convert Unix ms timestamp to PKT datetime string -------------------------
function msToPktDatetime($ms): string
{
    if (!is_numeric($ms) || (int) $ms <= 0) {
        return (new DateTime('now', new DateTimeZone('Asia/Karachi')))->format('Y-m-d H:i:s');
    }
    $secs = (int) ((int) $ms / 1000);
    $dt   = new DateTime('@' . $secs);
    $dt->setTimezone(new DateTimeZone('Asia/Karachi'));
    return $dt->format('Y-m-d H:i:s');
}

// -- Map Lychee state -> internal status --------------------------------------
function mapJobState(?string $state): string
{
    return match (strtoupper($state ?? '')) {
        'COMPLETE'  => 'completed',
        'CANCELLED' => 'cancelled',
        'ON_HOLD'   => 'on_hold',
        'RUNNING'   => 'in_progress',
        'STARTED'   => 'in_progress',
        default     => 'pending',
    };
}

// -- Map one Lychee job to a DB record ----------------------------------------
function mapJob(array $job, array $tableCols): array
{
    $nowPK     = new DateTime('now', new DateTimeZone('Asia/Karachi'));
    $clientPid = $job['id'] ?? null; // <-- the upsert key the user requested

    $record = [
        'project_id'        => PROJECT_ID,
        'client_portal_id'  => $clientPid,
        'order_number'      => '#' . $clientPid,
        'client_reference'  => '#' . $clientPid,
        'VARIANT_no'        => $job['jobId'] ?? null,
        'status'            => mapJobState($job['state'] ?? null),
        'workflow_state'    => strtoupper($job['state'] ?? 'PENDING'),
        'workflow_type'     => $job['operation'] ?? null,
        'current_layer'     => 'drawer',
        'priority'          => 'normal',
        'received_at'       => msToPktDatetime($job['startedTime']  ?? null),
        'due_in'            => msToPktDatetime($job['finishedTime'] ?? null),
        'address'           => null,
        'metadata'          => json_encode([
            'id'                     => $job['id']                     ?? null,
            'jobId'                  => $job['jobId']                  ?? null,
            'prodOrderId'            => $job['prodOrderId']            ?? null,
            'batchId'                => $job['batchId']                ?? null,
            'operation'              => $job['operation']              ?? null,
            'resource'               => $job['resource']               ?? null,
            'teamCode'               => $job['teamCode']               ?? null,
            'variant'                => $job['variant']                ?? null,
            'variantPublic'          => $job['variantPublic']          ?? null,
            'standardProcessingTime' => $job['standardProcessingTime'] ?? null,
            'productionHours'        => $job['productionHours']        ?? null,
            'description'            => $job['description']            ?? null,
            'orderQuantity'          => $job['orderQuantity']          ?? null,
            'approvedQuantity'       => $job['approvedQuantity']       ?? null,
            'state'                  => $job['state']                  ?? null,
            'startedTime'            => $job['startedTime']            ?? null,
            'finishedTime'           => $job['finishedTime']           ?? null,
            'jobHistory'             => $job['jobHistory']             ?? [],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        'import_source'     => 'cron',
        'year'              => (int) $nowPK->format('Y'),
        'month'             => (int) $nowPK->format('m'),
        'date'              => $nowPK->format('d-m-Y'),
        'created_at'        => $nowPK->format('Y-m-d H:i:s'),
        'updated_at'        => $nowPK->format('Y-m-d H:i:s'),
    ];

    // Only return columns that actually exist in the table.
    return array_intersect_key($record, $tableCols);
}

// -- Bulk INSERT IGNORE on client_portal_id -----------------------------------
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

// -- Build the /jobs/search payload for one page ------------------------------
function buildSearchPayload(int $pageIndex): array
{
    // ISO8601 UTC with milliseconds. From: LOOKBACK_HOURS ago; To: now.
    $now = new DateTime('now', new DateTimeZone('UTC'));
    $to  = $now->format('Y-m-d\TH:i:s') . '.999Z';

    $from = (clone $now)->sub(new DateInterval('PT' . LOOKBACK_HOURS . 'H'));
    $from = $from->format('Y-m-d\TH:i:s') . '.000Z';

    return [
        'searchTerm'          => '',
        'termField'           => 'batchId',
        'dateTimeFilterField' => 'CREATED_AT',
        'fromDateTime'        => $from,
        'toDateTime'          => $to,
        'team'                => LYCHEE_TEAM,
        'pageSize'            => PAGE_SIZE,
        'pageIndex'           => $pageIndex,
        'sortField'           => 'createdAt',
        'sortType'            => 'desc',
    ];
}

// -- Main ---------------------------------------------------------------------
try {
    $env = loadEnv(ENV_PATH);
    $pdo = dbConnect($env);

    // Cache the table column list once so we only insert columns that exist.
    $tableCols = getTableColumns($pdo, DB_TABLE);
    if (!isset($tableCols['client_portal_id'])) {
        error_log(SCRIPT_NAME . ': table ' . DB_TABLE . ' is missing column client_portal_id -- aborting');
        exit(1);
    }

    $token = getLycheeAccessToken($env);
    if ($token === null) {
        error_log(SCRIPT_NAME . ': could not obtain Lychee access token -- aborting');
        exit(1);
    }

    $totalInserted = 0;
    $totalFetched  = 0;

    for ($page = 0; $page < MAX_PAGES; $page++) {
        $payload = buildSearchPayload($page);
        $data    = fetchJobsPage($token, $payload);

        if ($data === null) {
            break;
        }

        $jobs = $data['jobs'] ?? [];
        $totalFetched += count($jobs);
        if (empty($jobs)) {
            break;
        }

        $records = array_map(fn($j) => mapJob($j, $tableCols), $jobs);
        $totalInserted += insertIgnore($pdo, DB_TABLE, $records);

        // Stop when we've fetched everything the server says exists.
        $reportedTotal = (int) ($data['total'] ?? 0);
        if (($totalFetched >= $reportedTotal) || (count($jobs) < PAGE_SIZE)) {
            break;
        }

        usleep(300000); // 300 ms politeness delay between pages
    }

    error_log(SCRIPT_NAME . ": completed -- fetched {$totalFetched} job(s), inserted {$totalInserted} new row(s) into " . DB_TABLE);

} catch (Throwable $e) {
    error_log(SCRIPT_NAME . ': FATAL -- ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    exit(1);
}
