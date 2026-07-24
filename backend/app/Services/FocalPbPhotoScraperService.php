<?php

namespace App\Services;

use DateTime;
use DateTimeZone;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use RuntimeException;

class FocalPbPhotoScraperService
{
    protected string $baseUrl;
    protected string $email;
    protected string $password;
    protected int $projectId;
    protected string $table;

    protected array $cookies = [];
    protected array $jobDetailsCache = [];

    public function __construct()
    {
        $this->baseUrl = rtrim((string) env('FOCAL_PB_PHOTO_BASE_URL', 'https://fa-pb2-tlc-app-web-prod.azurewebsites.net'), '/');
        $this->email = (string) env('FOCAL_PB_PHOTO_EMAIL', 'sajid@benchmarkstudio.biz');
        $this->password = (string) env('FOCAL_PB_PHOTO_PASSWORD', 'Bm123$%^789');
        $this->projectId = (int) env('FOCAL_PB_PHOTO_PROJECT_ID', 24);
        $this->table = (string) env('FOCAL_PB_PHOTO_TABLE', "project_{$this->projectId}_orders");
    }

    public function run(): array
    {
        Log::channel('daily')->info('FocalPbPhoto Scraper started', [
            'base_url' => $this->baseUrl,
            'table' => $this->table,
            'project_id' => $this->projectId,
        ]);

        try {
            $this->validateSetup();
            $token = $this->fetchCsrfToken();
            $this->authenticate($token);
            $rows = $this->scrapeTable();
            [$inserted, $skipped] = $this->persist($rows);
        } catch (\Throwable $e) {
            Log::error('FocalPbPhoto Scraper failed: ' . $e->getMessage());
            return ['ok' => false, 'inserted' => 0, 'skipped' => 0, 'error' => $e->getMessage()];
        }

        Log::channel('daily')->info("FocalPbPhoto Scraper finished — inserted: {$inserted}, skipped: {$skipped}");

        return ['ok' => true, 'inserted' => $inserted, 'skipped' => $skipped];
    }

    private function validateSetup(): void
    {
        if ($this->email === '' || $this->password === '') {
            throw new RuntimeException('FOCAL_PB_PHOTO_EMAIL or FOCAL_PB_PHOTO_PASSWORD is missing in environment.');
        }

        if (!DB::getSchemaBuilder()->hasTable($this->table)) {
            throw new RuntimeException("Target table {$this->table} not found. Set FOCAL_PB_PHOTO_TABLE or create table.");
        }

        if (!DB::getSchemaBuilder()->hasColumn($this->table, 'orignal_image_id')) {
            throw new RuntimeException("Target table {$this->table} is missing the orignal_image_id column.");
        }
    }

    private function http()
    {
        return Http::withHeaders([
            'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
            'Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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

    private function fetchCsrfToken(): string
    {
        Log::channel('daily')->info('FocalPbPhoto: Fetching login page for CSRF token');

        $response = $this->http()->get($this->baseUrl . '/Identity/Account/Login');
        $this->captureCookies($response);

        $dom = new \DOMDocument();
        libxml_use_internal_errors(true);
        $dom->loadHTML($response->body());
        libxml_clear_errors();

        $xpath = new \DOMXPath($dom);
        $tokenNodes = $xpath->query('//input[@name="__RequestVerificationToken"]');

        if (!$tokenNodes || $tokenNodes->length === 0) {
            throw new RuntimeException('__RequestVerificationToken not found on login page.');
        }

        return (string) $tokenNodes->item(0)?->getAttribute('value');
    }

    private function authenticate(string $token): void
    {
        Log::channel('daily')->info('FocalPbPhoto: Sending login request');

        $response = $this->http()
            ->withHeaders([
                'Content-Type' => 'application/x-www-form-urlencoded',
                'Origin' => $this->baseUrl,
                'Referer' => $this->baseUrl . '/Identity/Account/Login',
            ])
            ->asForm()
            ->post($this->baseUrl . '/Identity/Account/Login?ReturnUrl=%2F', [
                'Input.Email' => $this->email,
                'Input.Password' => $this->password,
                '__RequestVerificationToken' => $token,
                'Input.RememberMe' => 'false',
            ]);

        $this->captureCookies($response);

        if (!array_key_exists('.AspNetCore.Identity.Application', $this->cookies)) {
            throw new RuntimeException('Authentication failed: identity cookie not set. Check credentials.');
        }
    }

    private function scrapeTable(): array
    {
        Log::channel('daily')->info('FocalPbPhoto: Fetching all active Jobs sections (Ready + InProgress)');

        $sections = [
            'Ready' => '/Jobs/Jobs?jobStatus=Ready',
            'InProgress' => '/Jobs/Jobs?jobStatus=InProgress',
        ];

        $rows = [];
        $seen = [];

        foreach ($sections as $portalStatus => $path) {
            $response = $this->http()->get($this->baseUrl . $path);
            $response->throw();

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

                $theadTh = $xpath->query('.//thead//th', $table);
                if ($theadTh && $theadTh->length > 0) {
                    foreach ($theadTh as $th) {
                        $headers[] = trim($th->textContent);
                    }
                }

                $bodyRows = $xpath->query('.//tbody/tr', $table);
                if (!$bodyRows || $bodyRows->length === 0) {
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

                    if (count($headers) === 0 || count($values) === 0) {
                        continue;
                    }

                    if (count($values) === 1 && strcasecmp($values[0], 'No jobs available') === 0) {
                        continue;
                    }

                    $row = array_combine(array_slice($headers, 0, count($values)), $values);
                    if (!is_array($row)) {
                        continue;
                    }

                    $row['_portal_status'] = $portalStatus;
                    $detailUrl = $this->extractDetailUrlFromRow($xpath, $tr);
                    if ($detailUrl) {
                        $row['_detail_url'] = $detailUrl;
                    }

                    $rowId = trim((string) ($row['Id'] ?? $row['ID'] ?? ''));
                    $key = $rowId !== '' ? $rowId : md5(json_encode($row));

                    if (isset($seen[$key])) {
                        continue;
                    }

                    $seen[$key] = true;
                    $rows[] = $row;
                }
            }
        }

        Log::channel('daily')->info('FocalPbPhoto: Scraped ' . count($rows) . ' row(s)');
        return $rows;
    }

    private function persist(array $rows): array
    {
        if (empty($rows)) {
            return [0, 0];
        }

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

        $inserted = 0;
        $skipped = 0;

        foreach ($rows as $row) {
            $record = $this->map($row);
            $portalId = $record['client_portal_id'];
            $orderNumber = trim((string) ($record['order_number'] ?? ''));

            if ($orderNumber === '' && $portalId) {
                $orderNumber = (string) $portalId;
                $record['order_number'] = $orderNumber;
            }

            if ($orderNumber === '') {
                $skipped++;
                continue;
            }

            if (($portalId && isset($existingPortalIds[$portalId])) || isset($existingOrderNumbers[$orderNumber])) {
                $matchColumn = $portalId && isset($existingPortalIds[$portalId])
                    ? 'client_portal_id'
                    : 'order_number';
                $matchValue = $matchColumn === 'client_portal_id' ? $portalId : $orderNumber;

                $updates = [
                    'received_at' => $record['received_at'],
                    'due_date' => $record['due_date'],
                    'due_in' => $record['due_in'],
                    'priority' => $record['priority'],
                    'metadata' => $record['metadata'],
                    'updated_at' => now(),
                ];

                // Keep an existing URL if the details page was temporarily unavailable.
                if ($record['orignal_image_id'] !== null) {
                    $updates['orignal_image_id'] = $record['orignal_image_id'];
                }

                DB::table($this->table)
                    ->where($matchColumn, $matchValue)
                    ->update($updates);

                $skipped++;
                continue;
            }

            try {
                DB::table($this->table)->insert($record);

                if ($portalId) {
                    $existingPortalIds[$portalId] = true;
                }
                $existingOrderNumbers[$orderNumber] = true;
                $inserted++;
            } catch (\Throwable $e) {
                $skipped++;
                Log::warning('FocalPbPhoto: Row skipped on insert', [
                    'error' => $e->getMessage(),
                    'client_portal_id' => $portalId,
                    'order_number' => $orderNumber,
                ]);
            }
        }

        return [$inserted, $skipped];
    }

    private function map(array $row): array
    {
        $clientPortalId = $this->rowValue($row, ['Id', 'ID']);
        $enhancementId = $this->rowValue($row, ['Enhancement Id', 'Enhancement ID']);
        $propertyId = $this->rowValue($row, ['Property Id', 'Property ID']);
        $jobType = $this->rowValue($row, ['Job Type', 'Type']) ?? 'default';
        $category = $this->rowValue($row, ['Category', 'Categories', 'Job Category', 'Product Category', 'Plan Type', 'Plane Type']);
        $comment = $this->rowValue($row, ['Comment', 'Comments', 'Instruction', 'Instructions', 'Notes', 'Internal Notes']);
        $detailUrl = $this->rowValue($row, ['_detail_url']);
        $originalImageUrl = null;
        $originalImageId = null;

        if ($detailUrl !== null) {
            $details = $this->fetchJobDetails($detailUrl);
            $category = $category ?? ($details['category'] ?? null);
            $comment = $comment ?? ($details['comment'] ?? null);
            $originalImageUrl = $details['original_image_url'] ?? null;
            $originalImageId = $this->extractOriginalImageId($originalImageUrl);
        }

        $dateReceived = $this->rowValue($row, ['Date Received', 'Received']);
        $dateDue = $this->rowValue($row, ['Date Due', 'Due Date']);
        $timeLeft = $this->rowValue($row, ['Time Left']) ?? '';
        $portalStatus = $this->rowValue($row, ['_portal_status']) ?? 'Ready';

        $extra = [
            'enhancement_id' => $enhancementId,
            'property_id' => $propertyId,
            'time_left' => $timeLeft,
            'portal_status' => $portalStatus,
            'detail_url' => $detailUrl,
            'original_image_url' => $originalImageUrl,
            'original_image_id' => $originalImageId,
            'category' => $category,
            'comment' => $comment,
            'source' => 'focal_pb_photo_jobs',
            'raw_row' => $row,
        ];

        return [
            'order_number' => $clientPortalId,
            'clint_order_number' => $enhancementId,
            'VARIANT_no' => $propertyId,
            'project_id' => $this->projectId,
            'metadata' => json_encode($extra, JSON_UNESCAPED_UNICODE),
            'client_portal_id' => $clientPortalId,
            'client_reference' => $enhancementId,
            'orignal_image_id' => $originalImageId,
            'address' => null,
            'client_name' => null,
            'current_layer' => 'designer',
            'status' => 'pending',
            'workflow_state' => 'RECEIVED',
            'workflow_type' => 'PH_2_LAYER',
            'plan_type' => $this->truncate($category, 255),
            'instruction' => $this->truncate($comment, 255),
            'code' => $propertyId,
            'project_type' => $jobType,
            'priority' => $this->resolvePriority($timeLeft),
            'received_at' => $this->parseDateTime($dateReceived),
            'due_date' => $this->parseDueDate($dateDue),
            'due_in' => $this->parseDateTime($dateDue),
            'import_source' => 'cron',
            'created_at' => now(),
            'updated_at' => now(),
        ];
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

    private function truncate(?string $value, int $maxLength): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim($value);
        if ($value === '') {
            return null;
        }

        if (function_exists('mb_substr')) {
            return mb_substr($value, 0, $maxLength);
        }

        return substr($value, 0, $maxLength);
    }

    private function extractDetailUrlFromRow(\DOMXPath $xpath, \DOMNode $row): ?string
    {
        $anchors = $xpath->query('.//a[@href]', $row);
        if (!$anchors || $anchors->length === 0) {
            return null;
        }

        foreach ($anchors as $anchor) {
            $href = trim((string) $anchor->attributes?->getNamedItem('href')?->nodeValue);
            if ($href === '') {
                continue;
            }

            if (stripos($href, '/Jobs/JobDetails/') !== false) {
                return $this->toAbsoluteUrl($href);
            }
        }

        return null;
    }

    private function toAbsoluteUrl(string $href): string
    {
        if (preg_match('/^https?:\/\//i', $href) === 1) {
            return $href;
        }

        if (str_starts_with($href, '/')) {
            return $this->baseUrl . $href;
        }

        return $this->baseUrl . '/' . ltrim($href, '/');
    }

    private function fetchJobDetails(string $detailUrl): array
    {
        if (isset($this->jobDetailsCache[$detailUrl])) {
            return $this->jobDetailsCache[$detailUrl];
        }

        try {
            $response = $this->http()->get($detailUrl);
            $response->throw();
            $html = (string) $response->body();

            $details = [
                'category' => $this->extractFieldFromHtml($html, ['Category', 'Categories', 'Job Category', 'Product Category', 'Plan Type', 'Plane Type']),
                'comment' => $this->extractFieldFromHtml($html, ['Comment', 'Comments', 'Instruction', 'Instructions', 'Notes', 'Internal Notes']),
                'original_image_url' => $this->extractOriginalImageUrl($html),
            ];

            $this->jobDetailsCache[$detailUrl] = $details;
            return $details;
        } catch (\Throwable $e) {
            Log::warning('FocalPbPhoto: Failed to fetch job details', [
                'detail_url' => $detailUrl,
                'error' => $e->getMessage(),
            ]);

            $this->jobDetailsCache[$detailUrl] = [
                'category' => null,
                'comment' => null,
                'original_image_url' => null,
            ];
            return $this->jobDetailsCache[$detailUrl];
        }
    }

    private function extractOriginalImageUrl(string $html): ?string
    {
        $dom = new \DOMDocument();
        libxml_use_internal_errors(true);
        $dom->loadHTML($html);
        libxml_clear_errors();
        $xpath = new \DOMXPath($dom);

        $headers = $xpath->query('//th');
        if (!$headers) {
            return null;
        }

        foreach ($headers as $header) {
            $heading = trim(preg_replace('/\s+/', ' ', (string) $header->textContent));
            if (strcasecmp($heading, 'Original Image') !== 0) {
                continue;
            }

            $table = $xpath->query('./ancestor::table[1]', $header)?->item(0);
            if (!$table) {
                continue;
            }

            foreach (['.//a[@href]', './/img[@src]'] as $query) {
                $nodes = $xpath->query($query, $table);
                if (!$nodes) {
                    continue;
                }

                foreach ($nodes as $node) {
                    $attribute = strtolower((string) $node->nodeName) === 'a' ? 'href' : 'src';
                    $url = trim((string) $node->attributes?->getNamedItem($attribute)?->nodeValue);

                    if (filter_var($url, FILTER_VALIDATE_URL) !== false
                        && in_array(strtolower((string) parse_url($url, PHP_URL_SCHEME)), ['http', 'https'], true)) {
                        return $url;
                    }
                }
            }
        }

        return null;
    }

    private function extractOriginalImageId(?string $url): ?string
    {
        if ($url === null) {
            return null;
        }

        $path = parse_url(trim($url), PHP_URL_PATH);
        if (!is_string($path) || trim($path, '/') === '') {
            return null;
        }

        $segments = array_values(array_filter(explode('/', trim($path, '/')), static fn ($segment) => $segment !== ''));
        if (count($segments) === 0) {
            return null;
        }

        return end($segments);
    }

    private function extractFieldFromHtml(string $html, array $labels): ?string
    {
        $dom = new \DOMDocument();
        libxml_use_internal_errors(true);
        $dom->loadHTML($html);
        libxml_clear_errors();
        $xpath = new \DOMXPath($dom);

        foreach ($labels as $label) {
            $value = $this->extractFieldByLabelFromDom($xpath, $label);
            if ($value !== null) {
                return $this->sanitizeExtractedValue($label, $value);
            }
        }

        foreach ($labels as $label) {
            $value = $this->extractFieldByRegex($html, $label);
            if ($value !== null) {
                return $this->sanitizeExtractedValue($label, $value);
            }
        }

        return null;
    }

    private function extractFieldByLabelFromDom(\DOMXPath $xpath, string $label): ?string
    {
        $queryLabel = strtolower(trim($label));
        $nodes = $xpath->query('//td|//th|//dt|//label|//strong|//b|//span|//div');
        if (!$nodes) {
            return null;
        }

        foreach ($nodes as $node) {
            $nodeText = trim(preg_replace('/\s+/', ' ', (string) $node->textContent));
            if ($nodeText === '') {
                continue;
            }

            $normalized = strtolower(rtrim($nodeText, ':'));
            if ($normalized !== $queryLabel && !str_contains($normalized, $queryLabel . ':')) {
                continue;
            }

            $candidates = [
                './following-sibling::*[1]',
                './ancestor::tr[1]/td[last()]',
                './ancestor::tr[1]/th[last()]',
                './parent::*/*[last()]',
            ];

            foreach ($candidates as $candidateXpath) {
                $candidateNode = $xpath->query($candidateXpath, $node)?->item(0);
                if (!$candidateNode) {
                    continue;
                }

                $value = $this->extractValueFromCandidateNode($xpath, $candidateNode);

                if ($value !== '' && strcasecmp($value, $nodeText) !== 0) {
                    return $value;
                }
            }
        }

        return null;
    }

    private function extractValueFromCandidateNode(\DOMXPath $xpath, \DOMNode $candidateNode): string
    {
        $nodeName = strtolower((string) $candidateNode->nodeName);

        if ($nodeName === 'input') {
            return trim((string) $candidateNode->attributes?->getNamedItem('value')?->nodeValue);
        }

        if ($nodeName === 'textarea') {
            $value = trim(preg_replace('/\s+/', ' ', (string) $candidateNode->textContent));
            return trim($value, ": \t\n\r\0\x0B");
        }

        if ($nodeName === 'select') {
            $selected = $xpath->query('.//option[@selected][1]', $candidateNode)?->item(0);
            if (!$selected) {
                $selected = $xpath->query('.//option[1]', $candidateNode)?->item(0);
            }

            if ($selected) {
                $selectedText = trim(preg_replace('/\s+/', ' ', (string) $selected->textContent));
                if ($selectedText !== '' && !preg_match('/^select\b/i', $selectedText)) {
                    return $selectedText;
                }
            }

            return '';
        }

        $value = trim(preg_replace('/\s+/', ' ', (string) $candidateNode->textContent));
        return trim($value, ": \t\n\r\0\x0B");
    }

    private function sanitizeExtractedValue(string $label, string $value): ?string
    {
        $clean = trim(preg_replace('/\s+/', ' ', $value));
        if ($clean === '') {
            return null;
        }

        $labelLower = strtolower($label);
        $valueLower = strtolower($clean);

        // If category extraction accidentally captures the whole dropdown options list,
        // treat it as missing so plan_type remains null.
        if (str_contains($labelLower, 'categor') || str_contains($labelLower, 'plan type') || str_contains($labelLower, 'plane type')) {
            if (str_contains($valueLower, 'select category') && str_contains($valueLower, 'cancelled by customer') && str_contains($valueLower, 'source unavailable') && str_contains($valueLower, 'other')) {
                return null;
            }
            if (preg_match('/^select\s+categor/i', $valueLower)) {
                return null;
            }
        }

        return $clean;
    }

    private function extractFieldByRegex(string $html, string $label): ?string
    {
        $quoted = preg_quote($label, '/');
        $patterns = [
            '/(?:>|\b)' . $quoted . '\s*[:\-]\s*<[^>]+>\s*([^<\r\n]+)/iu',
            '/(?:>|\b)' . $quoted . '\s*[:\-]\s*([^<\r\n]+)/iu',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $html, $m) === 1) {
                $value = trim(html_entity_decode(strip_tags((string) ($m[1] ?? '')), ENT_QUOTES | ENT_HTML5));
                if ($value !== '') {
                    return preg_replace('/\s+/', ' ', $value);
                }
            }
        }

        return null;
    }

    private function resolvePriority(?string $timeLeft): string
    {
        $hours = $this->parseTimeLeftHours($timeLeft);

        if ($hours > 24) {
            return 'normal';
        }
        if ($hours > 6) {
            return 'high';
        }

        return 'urgent';
    }

    private function parseTimeLeftHours(?string $raw): float
    {
        if (!$raw) {
            return 9999.0;
        }

        // Any negative time left means overdue; treat as urgent.
        if (str_contains($raw, '-')) {
            return -1.0;
        }

        $minutes = 0;

        if (preg_match('/-?(\d+)\s*day/i', $raw, $m)) {
            $minutes += (int) $m[1] * 1440;
        }
        if (preg_match('/-?(\d+)\s*hour/i', $raw, $m)) {
            $minutes += (int) $m[1] * 60;
        }
        if (preg_match('/-?(\d+)\s*minute/i', $raw, $m)) {
            $minutes += (int) $m[1];
        }

        return $minutes / 60.0;
    }

    private function parseDateTime(?string $raw): ?string
    {
        if (!$raw) {
            return null;
        }

        $raw = trim($raw);
        $raw = preg_replace('/\s+Utc$/i', '', $raw);

        foreach (['m/d/Y H:i:s', 'd/m/Y H:i:s', 'm/d/Y', 'd/m/Y'] as $format) {
            $dt = DateTime::createFromFormat('!' . $format, $raw, new DateTimeZone('UTC'));
            $errors = DateTime::getLastErrors();

            if ($dt && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0))) {
                return $dt->format('Y-m-d H:i:s');
            }
        }

        return null;
    }

    private function parseDueDate(?string $raw): ?string
    {
        if (!$raw) {
            return null;
        }

        $raw = preg_replace('/\s+Utc$/i', '', trim($raw));

        foreach (['m/d/Y H:i:s', 'd/m/Y H:i:s', 'm/d/Y', 'd/m/Y'] as $format) {
            $dt = DateTime::createFromFormat('!' . $format, $raw, new DateTimeZone('UTC'));
            $errors = DateTime::getLastErrors();

            if ($dt && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0))) {
                return $dt->format('Y-m-d');
            }
        }

        return null;
    }
}

