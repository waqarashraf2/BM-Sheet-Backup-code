<?php

namespace App\Http\Controllers\Api\Import;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Services\ProjectOrderService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Validator;

class ProjectNinePublicImportController extends Controller
{
    private const PROJECT_ID = 7;

    /**
     * Fields we intentionally allow from the public client.
     */
    private const ALLOWED_INPUT_FIELDS = [
        'address',
        'client_name',
        'received_at',
        'code',
        'plan_type',
        'instruction',
        'due_in',
        'client_portal_id',
    ];

    public function template()
    {
        $project = Project::findOrFail(self::PROJECT_ID);
        $tableName = ProjectOrderService::getTableName(self::PROJECT_ID);

        return response()->json([
            'message' => 'Public import template for project 7.',
            'project_id' => self::PROJECT_ID,
            'project_name' => $project->name,
            'table' => $tableName,
            'method' => 'POST',
            'endpoint' => url('/api/public-import/project-7/orders'),
            'accepted_payloads' => [
                'single' => [
                    'address' => '123 Sample Street',
                    'client_name' => 'Client Name',
                    'received_at' => now()->toDateTimeString(),
                    'code' => 'FP',
                    'plan_type' => 'Standard',
                    'instruction' => 'Sample instruction',
                    'due_in' => '2026-04-08 18:00:00',
                    'client_portal_id' => 'portal-order-1001',
                ],
                'bulk' => [
                    'orders' => [
                        ['address' => '123 Sample Street'],
                        ['client_name' => 'Second Client'],
                    ],
                ],
            ],
            'required_fields' => [],
            'optional_fields' => self::ALLOWED_INPUT_FIELDS,
            'supported_aliases' => [
                'clint_name' => 'client_name',
                'plane_type' => 'plan_type',
                'instructions' => 'instruction',
            ],
        ]);
    }

    public function store(Request $request)
    {
        $project = Project::findOrFail(self::PROJECT_ID);
        $tableName = ProjectOrderService::getTableName(self::PROJECT_ID);

        if (!ProjectOrderService::tableExists(self::PROJECT_ID)) {
            return response()->json([
                'message' => 'Project 7 orders table does not exist.',
            ], 500);
        }

        $payloadOrders = $request->input('orders');
        if (is_array($payloadOrders)) {
            $orders = array_values($payloadOrders);
        } else {
            $orders = [$request->all()];
        }

        if (empty($orders)) {
            return response()->json([
                'message' => 'No order payload provided.',
            ], 422);
        }

        $tableColumns = Schema::getColumnListing($tableName);
        $insertedOrders = [];
        $errors = [];

        DB::beginTransaction();

        try {
            foreach ($orders as $index => $orderPayload) {
                if (!is_array($orderPayload)) {
                    $errors[] = [
                        'index' => $index,
                        'message' => 'Each order must be an object.',
                    ];
                    continue;
                }

                $normalizedPayload = $orderPayload;

                if (array_key_exists('clint_name', $normalizedPayload) && !array_key_exists('client_name', $normalizedPayload)) {
                    $normalizedPayload['client_name'] = $normalizedPayload['clint_name'];
                }

                if (array_key_exists('plane_type', $normalizedPayload) && !array_key_exists('plan_type', $normalizedPayload)) {
                    $normalizedPayload['plan_type'] = $normalizedPayload['plane_type'];
                }

                if (array_key_exists('instructions', $normalizedPayload) && !array_key_exists('instruction', $normalizedPayload)) {
                    $normalizedPayload['instruction'] = $normalizedPayload['instructions'];
                }

                $validator = Validator::make($normalizedPayload, [
                    'address' => 'nullable|string|max:255',
                    'client_name' => 'nullable|string|max:255',
                    'received_at' => 'nullable|date',
                    'code' => 'nullable|string|max:255',
                    'plan_type' => 'nullable|string|max:255',
                    'instruction' => 'nullable',
                    'due_in' => 'nullable|string|max:255',
                    'client_portal_id' => 'nullable|string|max:255',
                ]);

                if ($validator->fails()) {
                    $errors[] = [
                        'index' => $index,
                        'message' => 'Validation failed.',
                        'details' => $validator->errors()->toArray(),
                    ];
                    continue;
                }

                $validated = $validator->validated();

                $insertData = array_intersect_key(
                    $validated,
                    array_flip(array_intersect(self::ALLOWED_INPUT_FIELDS, $tableColumns))
                );

                $insertData = array_merge([
                    'order_number' => $this->generateOrderNumber($tableName),
                    'project_id' => self::PROJECT_ID,
                    'current_layer' => 'drawer',
                    'status' => 'pending',
                    'workflow_state' => 'RECEIVED',
                    'workflow_type' => $project->workflow_type ?: 'FP_3_LAYER',
                    'priority' => 'normal',
                    'complexity_weight' => 1,
                    'order_type' => 'standard',
                    'import_source' => 'api',
                    'recheck_count' => 0,
                    'attempt_draw' => 0,
                    'attempt_check' => 0,
                    'attempt_qa' => 0,
                    'checker_self_corrected' => false,
                    'is_on_hold' => false,
                    'created_at' => now(),
                    'updated_at' => now(),
                ], $insertData);

                $insertId = DB::table($tableName)->insertGetId($insertData);

                $insertedOrders[] = [
                    'id' => $insertId,
                    'order_number' => $insertData['order_number'],
                ];
            }

            if (!empty($errors) && empty($insertedOrders)) {
                DB::rollBack();

                return response()->json([
                    'message' => 'No orders were imported.',
                    'inserted_count' => 0,
                    'errors' => $errors,
                ], 422);
            }

            DB::commit();

            return response()->json([
                'message' => 'Orders imported successfully.',
                'project_id' => self::PROJECT_ID,
                'table' => $tableName,
                'inserted_count' => count($insertedOrders),
                'inserted_orders' => $insertedOrders,
                'errors' => $errors,
            ], 201);
        } catch (\Throwable $e) {
            DB::rollBack();

            return response()->json([
                'message' => 'Import failed.',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    private function generateOrderNumber(string $tableName): string
    {
        do {
            $orderNumber = 'P7-' . now()->format('YmdHis') . '-' . random_int(1000, 9999);
        } while (DB::table($tableName)->where('order_number', $orderNumber)->exists());

        return $orderNumber;
    }
}
