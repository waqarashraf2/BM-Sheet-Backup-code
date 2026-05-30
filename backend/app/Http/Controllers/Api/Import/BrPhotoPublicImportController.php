<?php

namespace App\Http\Controllers\Api\Import;

use App\Http\Controllers\Controller;
use App\Services\ProjectOrderService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;

class BrPhotoPublicImportController extends Controller
{
    private const PROJECT_ID = 17;
    private const PROJECT_NAME = 'BrPhoto';
     private const SUBSCRIPTION_KEY = 'BrPh-X7k2$mNqL9#vRtZ4@wJcE3!pYs8^HdFa6&uQiO0';

    private const ALLOWED_FIELDS = [
        'order_number',
        'client_portal_id',
        'client_reference',
        'address',
        'client_name',
        'company',
        'total_raw_files',
        'received_at',
        'due_in',
        'code',
        'plan_type',
        'instruction',
    ];

    public function template()
    {
        $tableName = ProjectOrderService::getTableName(self::PROJECT_ID);

        return response()->json([
            'message' => 'Client portal import template for BrPhoto.',
            'project_id' => self::PROJECT_ID,
            'project_name' => self::PROJECT_NAME,
            'table' => $tableName,
            'method' => 'POST',
            'endpoint' => url('/api/public-import/brphoto/orders'),
            'auth' => [
                'subscription_key_header' => 'X-Subscription-Key',
                'alternative_header' => 'Ocp-Apim-Subscription-Key',
                'subscription_key_type' => 'static',
                'token_header' => 'X-Client-Portal-Token',
                'optional_env' => 'BR_PHOTO_PUBLIC_IMPORT_TOKEN',
            ],
            'accepted_payloads' => [
                'single' => [
                    'order_number' => 'BR-1001',
                    'address' => '12 High Street, London',
                    'company' => 'BR Photo Ltd',
                    'total_raw_files' => 48,
                    'client_portal_id' => 'portal-1001',
                ],
                'bulk' => [
                    'orders' => [
                        [
                            'order_number' => 'BR-1001',
                            'address' => '12 High Street, London',
                            'company' => 'BR Photo Ltd',
                            'total_raw_files' => 48,
                        ],
                        [
                            'order_number' => 'BR-1002',
                            'address' => '24 Green Road, Manchester',
                            'company' => 'BR Photo Ltd',
                            'total_raw_files' => 61,
                        ],
                    ],
                ],
            ],
            'required_fields' => ['order_number', 'total_raw_files'],
            'optional_fields' => self::ALLOWED_FIELDS,
            'supported_aliases' => [
                'orderNo' => 'order_number',
                'order_no' => 'order_number',
                'company_name' => 'company',
                'total_raw_images' => 'total_raw_files',
                'totalRawImages' => 'total_raw_files',
                'raw_files_count' => 'total_raw_files',
                'images_raw_files_count' => 'total_raw_files',
                'total_raw_files_count' => 'total_raw_files',
                'rawFilesCount' => 'total_raw_files',
                'clientName' => 'client_name',
                'client_name' => 'client_name',
                'plane_type' => 'plan_type',
                'instructions' => 'instruction',
                'clint_name' => 'client_name',
            ],
        ]);
    }

    public function store(Request $request)
    {
        $tableName = ProjectOrderService::getTableName(self::PROJECT_ID);

        if (!ProjectOrderService::tableExists(self::PROJECT_ID)) {
            return response()->json([
                'message' => 'BrPhoto orders table does not exist.',
            ], 500);
        }

        if (!$this->passesTokenCheck($request)) {
            return response()->json([
                'message' => 'Unauthorized client portal request.',
            ], 401);
        }

        $payloadOrders = $request->input('orders');
        $orders = is_array($payloadOrders) ? array_values($payloadOrders) : [$request->all()];

        if (empty($orders)) {
            return response()->json([
                'message' => 'No order payload provided.',
            ], 422);
        }

        $tableColumns = Schema::getColumnListing($tableName);
        $results = [
            'inserted' => 0,
            'updated' => 0,
            'skipped' => 0,
            'errors' => [],
        ];

        DB::beginTransaction();

        try {
            foreach ($orders as $index => $orderPayload) {
                if (!is_array($orderPayload)) {
                    $results['errors'][] = [
                        'index' => $index,
                        'message' => 'Each order must be an object.',
                    ];
                    $results['skipped']++;
                    continue;
                }

                $normalizedPayload = $this->normalizePayload($orderPayload);

                $validator = Validator::make($normalizedPayload, [
                    'order_number' => 'required|string|max:191',
                    'total_raw_files' => 'required',
                    'address' => 'nullable|string|max:255',
                    'client_name' => 'nullable|string|max:255',
                    'company' => 'nullable|string|max:255',
                    'client_reference' => 'nullable|string|max:191',
                    'client_portal_id' => 'nullable|string|max:191',
                    'received_at' => 'nullable|date',
                    'due_in' => 'nullable|string|max:255',
                    'code' => 'nullable|string|max:255',
                    'plan_type' => 'nullable|string|max:255',
                    'instruction' => 'nullable|string|max:255',
                ]);

                if ($validator->fails()) {
                    $results['errors'][] = [
                        'index' => $index,
                        'order_number' => $normalizedPayload['order_number'] ?? null,
                        'message' => 'Validation failed.',
                        'details' => $validator->errors()->toArray(),
                    ];
                    $results['skipped']++;
                    continue;
                }

                $validated = $validator->validated();
                $orderNumber = trim((string) $validated['order_number']);

                $existing = DB::table($tableName)
                    ->where('order_number', $orderNumber)
                    ->first();

                if (!$existing && !empty($validated['client_portal_id'])) {
                    $existing = DB::table($tableName)
                        ->where('client_portal_id', $validated['client_portal_id'])
                        ->first();
                }

                $payload = $this->buildPayload($validated, $tableColumns, $existing === null);

                if ($existing) {
                    DB::table($tableName)
                        ->where('id', $existing->id)
                        ->update($payload);
                    $results['updated']++;
                } else {
                    DB::table($tableName)->insert($payload);
                    $results['inserted']++;
                }
            }

            DB::commit();

            return response()->json([
                'message' => 'Orders imported successfully.',
                'project_id' => self::PROJECT_ID,
                'project_name' => self::PROJECT_NAME,
                'table' => $tableName,
                'inserted_count' => $results['inserted'],
                'updated_count' => $results['updated'],
                'skipped_count' => $results['skipped'],
                'errors' => $results['errors'],
            ], 201);
        } catch (\Throwable $e) {
            DB::rollBack();

            return response()->json([
                'message' => 'Import failed.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    private function normalizePayload(array $payload): array
    {
        if (array_key_exists('orderNo', $payload) && !array_key_exists('order_number', $payload)) {
            $payload['order_number'] = $payload['orderNo'];
        }

        if (array_key_exists('order_no', $payload) && !array_key_exists('order_number', $payload)) {
            $payload['order_number'] = $payload['order_no'];
        }

        if (array_key_exists('company_name', $payload) && !array_key_exists('company', $payload)) {
            $payload['company'] = $payload['company_name'];
        }

        if (array_key_exists('total_raw_images', $payload) && !array_key_exists('total_raw_files', $payload)) {
            $payload['total_raw_files'] = $payload['total_raw_images'];
        }

        if (array_key_exists('totalRawImages', $payload) && !array_key_exists('total_raw_files', $payload)) {
            $payload['total_raw_files'] = $payload['totalRawImages'];
        }

        if (array_key_exists('raw_files_count', $payload) && !array_key_exists('total_raw_files', $payload)) {
            $payload['total_raw_files'] = $payload['raw_files_count'];
        }

        if (array_key_exists('images_raw_files_count', $payload) && !array_key_exists('total_raw_files', $payload)) {
            $payload['total_raw_files'] = $payload['images_raw_files_count'];
        }

        if (array_key_exists('total_raw_files_count', $payload) && !array_key_exists('total_raw_files', $payload)) {
            $payload['total_raw_files'] = $payload['total_raw_files_count'];
        }

        if (array_key_exists('rawFilesCount', $payload) && !array_key_exists('total_raw_files', $payload)) {
            $payload['total_raw_files'] = $payload['rawFilesCount'];
        }

        if (array_key_exists('clientName', $payload) && !array_key_exists('client_name', $payload)) {
            $payload['client_name'] = $payload['clientName'];
        }

        if (array_key_exists('plane_type', $payload) && !array_key_exists('plan_type', $payload)) {
            $payload['plan_type'] = $payload['plane_type'];
        }

        if (array_key_exists('instructions', $payload) && !array_key_exists('instruction', $payload)) {
            $payload['instruction'] = $payload['instructions'];
        }

        return $payload;
    }

    private function buildPayload(array $validated, array $tableColumns, bool $isInsert): array
    {
        $now = now();
        $payload = array_intersect_key($validated, array_flip(array_intersect(self::ALLOWED_FIELDS, $tableColumns)));

        if (array_key_exists('total_raw_files', $payload) && $payload['total_raw_files'] !== null) {
            $payload['total_raw_files'] = (string) $payload['total_raw_files'];
        }

        if ($isInsert) {
            return array_merge([
                'project_id' => self::PROJECT_ID,
                'current_layer' => 'designer',
                'status' => 'pending',
                'workflow_state' => 'RECEIVED',
                'workflow_type' => 'PH_2_LAYER',
                'priority' => 'normal',
                'complexity_weight' => 1,
                'order_type' => 'standard',
                'received_at' => $this->normalizeDateTime($validated['received_at'] ?? null) ?? $now->format('Y-m-d H:i:s'),
                'import_source' => 'api',
                'recheck_count' => 0,
                'attempt_draw' => 0,
                'attempt_check' => 0,
                'attempt_qa' => 0,
                'checker_self_corrected' => false,
                'is_on_hold' => false,
                'client_portal_synced_at' => $now->format('Y-m-d H:i:s'),
                'created_at' => $now->format('Y-m-d H:i:s'),
                'updated_at' => $now->format('Y-m-d H:i:s'),
            ], $payload);
        }

        $payload['updated_at'] = $now->format('Y-m-d H:i:s');
        $payload['client_portal_synced_at'] = $now->format('Y-m-d H:i:s');

        return $payload;
    }

    private function normalizeDateTime(mixed $value): ?string
    {
        if (!$value) {
            return null;
        }

        $raw = trim((string) $value);
        foreach (['Y-m-d H:i:s', 'm/d/Y H:i:s', 'd/m/Y H:i:s', 'Y-m-d', 'm/d/Y', 'd/m/Y'] as $format) {
            $dt = \DateTime::createFromFormat($format, $raw);
            if ($dt instanceof \DateTime) {
                return $dt->format('Y-m-d H:i:s');
            }
        }

        try {
            return (new \DateTime($raw))->format('Y-m-d H:i:s');
        } catch (\Throwable) {
            return null;
        }
    }

    private function passesTokenCheck(Request $request): bool
    {
        $subscriptionKey = trim((string) $request->header('X-Subscription-Key', ''));
        if ($subscriptionKey === '') {
            $subscriptionKey = trim((string) $request->header('Ocp-Apim-Subscription-Key', ''));
        }

        if (!hash_equals(self::SUBSCRIPTION_KEY, $subscriptionKey)) {
            return false;
        }

        $expected = trim((string) $this->getEnv('BR_PHOTO_PUBLIC_IMPORT_TOKEN', ''));
        if ($expected === '') {
            return true;
        }

        $provided = trim((string) $request->header('X-Client-Portal-Token', ''));
        if ($provided !== '' && hash_equals($expected, $provided)) {
            return true;
        }

        $authorization = trim((string) $request->bearerToken());
        if ($authorization !== '' && hash_equals($expected, $authorization)) {
            return true;
        }

        return false;
    }

    private function getEnv(string $key, string $default = ''): string
    {
        $value = getenv($key);
        if ($value === false || $value === null || $value === '') {
            $value = $_ENV[$key] ?? $_SERVER[$key] ?? null;
        }

        if ($value === null || $value === '') {
            return $default;
        }

        return (string) $value;
    }
}
