<?php

namespace App\Services;

use DateTime;
use DateTimeZone;
use Exception;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class BrPhotoService
{
    protected string $apiUrl = 'https://ems-processing.ehouse.co.uk/Orders/GetMyOrders';
    protected string $tokenUrl = 'https://login.microsoftonline.com/afa3da5c-a78f-40cd-8621-a8a4f8b8f20a/oauth2/v2.0/token';

    protected int $projectId = 17;
    protected string $table = 'project_17_orders';

    // Keep credentials in file as requested. Do not log these values.
    protected string $apiUsername = 'davidprice@ehouse-auth.co.uk';
    protected string $apiPassword = 'Cotality101!';

    /**
     * Azure AD token for the API (because this endpoint redirects to Microsoft login).
     * Paste a valid Bearer token here when needed.
     */
    protected string $accessToken = '';

    /**
     * Optional refresh token. If set, service will request a fresh access token automatically.
     */
    protected string $refreshToken = '';

    /**
     * Optional: paste authorization code from redirect URL after Microsoft login.
     * Example redirect: https://processing.ehouse.co.uk/?code=...&state=...
     */
    protected string $authorizationCode = '';

    /**
     * PKCE code_verifier used to generate code_challenge in authorize URL.
     * Required when exchanging authorization code.
     */
    protected string $codeVerifier = '';

    protected string $oauthRedirectUri = 'https://processing.ehouse.co.uk';

    protected string $oauthClientId = 'de6e5ec5-03d8-4932-9527-dfccfc84511b';
    protected string $oauthScope = 'openid profile offline_access email api://2edfb8c0-6753-41f9-b19d-074bcc2e0f12/access_as_user';

    public function run(): array
    {
        try {
            $token = $this->resolveAccessToken();
            if ($token === null) {
                return [
                    'ok' => false,
                    'fetched' => 0,
                    'inserted' => 0,
                    'skipped' => 0,
                    'error' => 'Missing/invalid OAuth token',
                ];
            }

            $response = Http::timeout(60)
                ->acceptJson()
                ->withToken($token)
                ->post($this->apiUrl, []);

            if (!$response->successful()) {
                Log::error('EMS Orders Import: API request failed', [
                    'status' => $response->status(),
                    'body' => $response->body(),
                    'headers' => $response->headers(),
                ]);
                return [
                    'ok' => false,
                    'fetched' => 0,
                    'inserted' => 0,
                    'skipped' => 0,
                    'error' => 'API request failed with status ' . $response->status(),
                ];
            }

            $payload = $response->json();

            // Accept common response shapes: array root, data[], items[]
            $orders = $this->extractOrders($payload);
            if ($orders === null) {
                Log::warning('EMS Orders Import: Unexpected JSON shape', [
                    'json_type' => gettype($payload),
                ]);
                return [
                    'ok' => false,
                    'fetched' => 0,
                    'inserted' => 0,
                    'skipped' => 0,
                    'error' => 'Unexpected JSON shape',
                ];
            }

            $nowPK = new DateTime('now', new DateTimeZone('Asia/Karachi'));
            $inserted = 0;
            $skipped = 0;
            $hasClintOrderNumber = $this->columnExists('clint_order_number');
            $queued = [];

            foreach ($orders as $order) {
                if (!is_array($order)) {
                    $skipped++;
                    continue;
                }

                $portalOrderNo = isset($order['orderNo']) ? trim((string) $order['orderNo']) : '';
                if ($portalOrderNo === '') {
                    $skipped++;
                    continue;
                }

                $clientPortalId = $portalOrderNo;

                if (isset($queued[$clientPortalId])) {
                    $skipped++;
                    continue;
                }
                $queued[$clientPortalId] = true;

                if ($this->clientPortalIdExists($clientPortalId)) {
                    $skipped++;
                    continue;
                }

                $receivedAt = $this->parseDateTimeOrFallback($order['assignedAtTimeUTC'] ?? null, $nowPK);
                $visitAt = $this->parseDateTimeOrNull($order['visitDateTime'] ?? null);

                $record = [
                    'order_number' => $clientPortalId,
                    'client_portal_id' => $clientPortalId,
                    'project_id' => $this->projectId,
                    'address' => $order['fullAddress'] ?? null,
                    'client_name' => $order['company'] ?? null,
                    'priority' => $this->mapPriority($order),
                    'received_at' => $receivedAt->format('Y-m-d H:i:s'),
                    'due_date' => $visitAt ? $visitAt->format('Y-m-d') : null,
                    'metadata' => $this->safeJsonEncode($order),
                    'import_source' => 'api',
                    'year' => (int) $nowPK->format('Y'),
                    'month' => (int) $nowPK->format('m'),
                    'date' => $nowPK->format('d-m-Y'),
                    'created_at' => $nowPK->format('Y-m-d H:i:s'),
                    'updated_at' => $nowPK->format('Y-m-d H:i:s'),
                ];

                if ($hasClintOrderNumber) {
                    $record['clint_order_number'] = $portalOrderNo;
                }

                if ($this->columnExists('branch')) {
                    $record['branch'] = $order['branch'] ?? null;
                }
                if ($this->columnExists('processor_id')) {
                    $record['processor_id'] = $order['processorId'] ?? null;
                }
                if ($this->columnExists('processor_name')) {
                    $record['processor_name'] = $order['processorName'] ?? null;
                }

                try {
                    DB::table($this->table)->insert([$record]);
                    $inserted++;
                } catch (Exception $rowException) {
                    // Safe duplicate guard for race conditions.
                    if ($this->clientPortalIdExists($clientPortalId)) {
                        $skipped++;
                        continue;
                    }

                    $skipped++;
                    Log::warning('EMS Orders Import: Row skipped', [
                        'client_portal_id' => $clientPortalId,
                        'message' => $rowException->getMessage(),
                    ]);
                }
            }

            Log::info('EMS Orders Import Completed', [
                'fetched' => count($orders),
                'inserted' => $inserted,
                'skipped' => $skipped,
                'table' => $this->table,
                'project_id' => $this->projectId,
            ]);

            return [
                'ok' => true,
                'fetched' => count($orders),
                'inserted' => $inserted,
                'skipped' => $skipped,
                'error' => null,
            ];
        } catch (Exception $e) {
            Log::error('EMS Orders Import Error: ' . $e->getMessage());
            return [
                'ok' => false,
                'fetched' => 0,
                'inserted' => 0,
                'skipped' => 0,
                'error' => $e->getMessage(),
            ];
        }
    }

    private function resolveAccessToken(): ?string
    {
        if (trim($this->accessToken) !== '') {
            return trim($this->accessToken);
        }

        $authCodeToken = $this->exchangeAuthorizationCode();
        if ($authCodeToken !== null) {
            return $authCodeToken;
        }

        if (trim($this->refreshToken) === '') {
            Log::error('EMS Orders Import: Missing OAuth token. Set BrPhotoService::$accessToken or BrPhotoService::$refreshToken.');
            return null;
        }

        try {
            $tokenResponse = Http::asForm()
                ->timeout(30)
                ->post($this->tokenUrl, [
                    'client_id' => $this->oauthClientId,
                    'grant_type' => 'refresh_token',
                    'refresh_token' => $this->refreshToken,
                    'scope' => $this->oauthScope,
                ]);

            if (!$tokenResponse->successful()) {
                Log::error('EMS Orders Import: Token refresh failed', [
                    'status' => $tokenResponse->status(),
                    'body' => $tokenResponse->body(),
                ]);
                return null;
            }

            $tokenData = $tokenResponse->json();
            $token = isset($tokenData['access_token']) ? (string) $tokenData['access_token'] : '';
            if ($token === '') {
                Log::error('EMS Orders Import: Token refresh response missing access_token');
                return null;
            }

            return $token;
        } catch (Exception $e) {
            Log::error('EMS Orders Import: Token refresh exception', ['error' => $e->getMessage()]);
            return null;
        }
    }

    private function exchangeAuthorizationCode(): ?string
    {
        if (trim($this->authorizationCode) === '') {
            return null;
        }

        if (trim($this->codeVerifier) === '') {
            Log::error('EMS Orders Import: authorizationCode set but codeVerifier is missing.');
            return null;
        }

        try {
            $tokenResponse = Http::asForm()
                ->timeout(30)
                ->post($this->tokenUrl, [
                    'client_id' => $this->oauthClientId,
                    'grant_type' => 'authorization_code',
                    'code' => $this->authorizationCode,
                    'redirect_uri' => $this->oauthRedirectUri,
                    'code_verifier' => $this->codeVerifier,
                    'scope' => $this->oauthScope,
                ]);

            if (!$tokenResponse->successful()) {
                Log::error('EMS Orders Import: Authorization code exchange failed', [
                    'status' => $tokenResponse->status(),
                    'body' => $tokenResponse->body(),
                ]);
                return null;
            }

            $tokenData = $tokenResponse->json();
            $token = isset($tokenData['access_token']) ? (string) $tokenData['access_token'] : '';
            if ($token === '') {
                Log::error('EMS Orders Import: Code exchange response missing access_token');
                return null;
            }

            return $token;
        } catch (Exception $e) {
            Log::error('EMS Orders Import: Authorization code exchange exception', ['error' => $e->getMessage()]);
            return null;
        }
    }

    private function extractOrders(mixed $payload): ?array
    {
        if (is_array($payload) && array_is_list($payload)) {
            return $payload;
        }

        if (is_array($payload) && isset($payload['data']) && is_array($payload['data'])) {
            return $payload['data'];
        }

        if (is_array($payload) && isset($payload['items']) && is_array($payload['items'])) {
            return $payload['items'];
        }

        return null;
    }

    private function safeJsonEncode(array $value): string
    {
        try {
            return json_encode($value, JSON_THROW_ON_ERROR);
        } catch (Exception $e) {
            return '{}';
        }
    }

    private function clientPortalIdExists(string $clientPortalId): bool
    {
        return DB::table($this->table)
            ->where('client_portal_id', $clientPortalId)
            ->exists();
    }

    private function columnExists(string $column): bool
    {
        try {
            $result = DB::select('SHOW COLUMNS FROM ' . $this->table . ' LIKE ?', [$column]);
            return !empty($result);
        } catch (Exception $e) {
            return false;
        }
    }

    private function parseDateTimeOrFallback(?string $value, DateTime $fallback): DateTime
    {
        if (!$value) {
            return clone $fallback;
        }

        try {
            return new DateTime($value);
        } catch (Exception $e) {
            return clone $fallback;
        }
    }

    private function parseDateTimeOrNull(?string $value): ?DateTime
    {
        if (!$value) {
            return null;
        }

        try {
            return new DateTime($value);
        } catch (Exception $e) {
            return null;
        }
    }

    private function mapPriority(array $order): string
    {
        $priorityOrder = (bool) ($order['priorityOrder'] ?? false);
        $priorityClient = (bool) ($order['priorityClient'] ?? false);
        $level = (int) ($order['clientPriorityLevel'] ?? 0);

        if ($priorityOrder || $priorityClient) {
            return 'urgent';
        }
        if ($level >= 5) {
            return 'high';
        }
        if ($level >= 3) {
            return 'normal';
        }

        return 'low';
    }
}
