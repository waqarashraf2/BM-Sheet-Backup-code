<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ChecklistTemplate;
use App\Models\Order;
use App\Models\OrderImportLog;
use App\Models\OrderImportSource;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use App\Services\ProjectOrderService;
use Illuminate\Support\Str;

class OrderImportController extends Controller
{
    
    
        /**
     * Get saved CSV header configuration for a project.
     */
    public function getProjectCsvHeaders(Request $request, int $projectId)
    {
        $project = Project::findOrFail($projectId);

        $row = DB::table('project_csv_headers')
            ->where('project_id', $project->id)
            ->first();

        return response()->json([
            'project_id' => $project->id,
            'project_name' => $project->name,
            'headers' => $row && $row->headers ? json_decode($row->headers, true) : [],
            'is_required' => $row && $row->is_required ? json_decode($row->is_required, true) : [],
            'default_values' => $row && $row->default_values ? json_decode($row->default_values, true) : [],
            'created_at' => $row->created_at ?? null,
            'updated_at' => $row->updated_at ?? null,
        ]);
    }

    /**
     * Create or update CSV header configuration for a project.
     */
    public function saveProjectCsvHeaders(Request $request, int $projectId)
    {
        $project = Project::findOrFail($projectId);

        $validated = $request->validate([
            'headers' => 'required|array|min:1',
            'headers.*' => 'required|string|max:255',
            'is_required' => 'nullable|array',
            'default_values' => 'nullable|array',
        ]);

        $headers = array_values(array_unique(array_filter(array_map(
            fn ($header) => trim((string) $header),
            $validated['headers']
        ))));

        $isRequired = [];
        foreach (($validated['is_required'] ?? []) as $key => $value) {
            $key = trim((string) $key);
            if (in_array($key, $headers, true)) {
                $isRequired[$key] = (bool) $value;
            }
        }

        $defaultValues = [];
        foreach (($validated['default_values'] ?? []) as $key => $value) {
            $key = trim((string) $key);
            if (in_array($key, $headers, true)) {
                $defaultValues[$key] = is_array($value) ? $value : trim((string) $value);
            }
        }

        DB::table('project_csv_headers')->updateOrInsert(
            ['project_id' => $project->id],
            [
                'project_name' => $project->name,
                'headers' => json_encode($headers),
                'is_required' => json_encode($isRequired),
                'default_values' => json_encode($defaultValues),
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );

        $saved = DB::table('project_csv_headers')->where('project_id', $project->id)->first();

        return response()->json([
            'message' => 'Project CSV headers saved successfully.',
            'data' => [
                'project_id' => $project->id,
                'project_name' => $project->name,
                'headers' => $saved && $saved->headers ? json_decode($saved->headers, true) : [],
                'is_required' => $saved && $saved->is_required ? json_decode($saved->is_required, true) : [],
                'default_values' => $saved && $saved->default_values ? json_decode($saved->default_values, true) : [],
                'created_at' => $saved->created_at ?? null,
                'updated_at' => $saved->updated_at ?? null,
            ],
        ]);
    }

    /**
     * Delete CSV header configuration for a project.
     */
    public function deleteProjectCsvHeaders(Request $request, int $projectId)
    {
        Project::findOrFail($projectId);

        DB::table('project_csv_headers')
            ->where('project_id', $projectId)
            ->delete();

        return response()->json([
            'message' => 'Project CSV headers deleted successfully.',
        ]);
    }



    /**
     * List imported orders for a project with pagination.
     */
    public function importedOrders(Request $request, int $projectId)
    {
        Project::findOrFail($projectId);

        $perPage = min(max((int) $request->query('per_page', 50), 1), 100);
        $search = trim((string) $request->query('search', ''));

        $query = Order::forProject($projectId)
            ->whereNotNull('import_source')
            ->select([
                'id',
                'order_number',
                'address',
                'client_name',
                'import_source',
                'import_log_id',
                'created_at',
                'updated_at',
            ])
            ->orderByDesc('id');

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('order_number', 'like', "%{$search}%")
                    ->orWhere('address', 'like', "%{$search}%")
                    ->orWhere('client_name', 'like', "%{$search}%");
            });
        }

        $orders = $query->paginate($perPage);

        $orders->getCollection()->transform(function ($order) {
            return [
                'order_id' => $order->id,
                'order_number' => $order->order_number,
                'address' => $order->address,
                'client_name' => $order->client_name,
                'import_source' => $order->import_source,
                'import_log_id' => $order->import_log_id,
                'created_at' => $order->created_at,
                'updated_at' => $order->updated_at,
            ];
        });

        return response()->json([
            'success' => true,
            'project_id' => $projectId,
            'data' => $orders->items(),
            'pagination' => [
                'total' => $orders->total(),
                'per_page' => $orders->perPage(),
                'current_page' => $orders->currentPage(),
                'last_page' => $orders->lastPage(),
            ],
        ]);
    }

    /**
     * Update an imported order safely.
     */
    public function updateImportedOrder(Request $request, int $projectId, int $orderId)
    {
        Project::findOrFail($projectId);

        $order = Order::findInProject($projectId, $orderId);
        abort_unless($order, 404, 'Order not found');

        $validated = $request->validate([
            'order_number' => 'sometimes|string|max:255',
            'address' => 'nullable|string|max:255',
            'client_name' => 'nullable|string|max:255',
        ]);

        if (array_key_exists('order_number', $validated)) {
            $exists = Order::forProject($projectId)
                ->where('order_number', $validated['order_number'])
                ->where('id', '!=', $orderId)
                ->exists();

            if ($exists) {
                return response()->json([
                    'message' => 'Order number already exists for this project.',
                    'errors' => [
                        'order_number' => ['The order number has already been taken.'],
                    ],
                ], 422);
            }
        }

        $order->update($validated);

        return response()->json([
            'success' => true,
            'message' => 'Imported order updated successfully.',
            'data' => [
                'order_id' => $order->id,
                'order_number' => $order->order_number,
                'address' => $order->address,
                'client_name' => $order->client_name,
                'import_source' => $order->import_source,
                'import_log_id' => $order->import_log_id,
                'created_at' => $order->created_at,
                'updated_at' => $order->updated_at,
            ],
        ]);
    }

    /**
     * Delete an imported order safely.
     */
    public function deleteImportedOrder(Request $request, int $projectId, int $orderId)
    {
        Project::findOrFail($projectId);

        $order = Order::findInProject($projectId, $orderId);
        abort_unless($order, 404, 'Order not found');

        $order->delete();

        return response()->json([
            'success' => true,
            'message' => 'Imported order deleted successfully.',
            'order_id' => $orderId,
        ]);
    }


    
    
    /**
     * List all import sources for a project.
     */
    public function sources(Request $request, int $projectId)
    {
        $sources = OrderImportSource::where('project_id', $projectId)
            ->with('latestImport')
            ->get();

        return response()->json($sources);
    }

    /**
     * Create a new import source.
     */
    public function createSource(Request $request, int $projectId)
    {
        $validated = $request->validate([
            'type' => 'required|in:api,cron,csv,manual',
            'name' => 'required|string|max:255',
            'api_endpoint' => 'nullable|url',
            'api_credentials' => 'nullable|array',
            'cron_schedule' => 'nullable|string',
            'field_mapping' => 'nullable|array',
        ]);

        $source = OrderImportSource::create([
            'project_id' => $projectId,
            ...$validated,
        ]);

        return response()->json([
            'message' => 'Import source created successfully',
            'data' => $source,
        ], 201);
    }

    /**
     * Update an import source.
     */
    public function updateSource(Request $request, int $sourceId)
    {
        $source = OrderImportSource::findOrFail($sourceId);

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'api_endpoint' => 'nullable|url',
            'api_credentials' => 'nullable|array',
            'cron_schedule' => 'nullable|string',
            'field_mapping' => 'nullable|array',
            'is_active' => 'sometimes|boolean',
        ]);

        $source->update($validated);

        return response()->json([
            'message' => 'Import source updated successfully',
            'data' => $source,
        ]);
    }

    /**
     * Import orders from CSV file.
     */
     
    public function importCsv(Request $request, int $projectId)
    {
        $request->validate([
            'file' => 'required|file|max:10240',
            'source_id' => 'nullable|exists:order_import_sources,id',
        ]);

        // Manually check file extension (php_fileinfo may not be available)
        $ext = strtolower($request->file('file')->getClientOriginalExtension());
        if (!in_array($ext, ['csv', 'txt'])) {
            return response()->json([
                'message' => 'The file must be a CSV or TXT file.',
                'errors' => ['file' => ['Only .csv and .txt files are allowed.']],
            ], 422);
        }

        $project = Project::findOrFail($projectId);
        $user = auth()->user();

        // Get or create import source
        $source = $request->source_id 
            ? OrderImportSource::findOrFail($request->source_id)
            : OrderImportSource::firstOrCreate(
                ['project_id' => $projectId, 'type' => 'csv', 'name' => 'CSV Import'],
                ['is_active' => true]
            );

        // Store the file
        $path = $request->file('file')->store('imports');

        // Create import log
        $importLog = OrderImportLog::create([
            'import_source_id' => $source->id,
            'imported_by' => $user->id,
            'status' => 'pending',
            'file_path' => $path,
        ]);

        // Process CSV
        $result = $this->processCsvFile($path, $project, $importLog, $source->field_mapping);

        return response()->json([
            'message' => 'CSV import completed',
            'data' => [
                'import_log_id' => $importLog->id,
                'total_rows' => $result['total'],
                'imported' => $result['imported'],
                'skipped' => $result['skipped'],
                'errors' => $result['errors'],
            ],
        ]);
    }



    /**
     * Process CSV file and import orders.
     */
    private function processCsvFile(string $path, Project $project, OrderImportLog $importLog, ?array $fieldMapping = null): array
    {
        $importLog->markStarted();

        $fullPath = Storage::path($path);
        if (!file_exists($fullPath)) {
            $importLog->markFailed(['File not found after upload']);
            return ['total' => 0, 'imported' => 0, 'skipped' => 0, 'errors' => [['row' => 0, 'message' => 'File not found']]];
        }

        $handle = fopen($fullPath, 'r');
        $headers = fgetcsv($handle);

        if (!$headers || count($headers) === 0) {
            fclose($handle);
            $importLog->markFailed(['CSV has no headers']);
            return ['total' => 0, 'imported' => 0, 'skipped' => 0, 'errors' => [['row' => 0, 'message' => 'CSV has no headers']]];
        }

        // Trim BOM and whitespace from headers
        $headers = array_map(fn($h) => trim($h, "\xEF\xBB\xBF \t\n\r"), $headers);
        
        // Default field mapping — also add common CSV column name aliases
        $mapping = $fieldMapping ?? [
            'order_number' => 'order_number',
            'client_reference' => 'client_reference',
            'client_name' => 'client_name',
            'address' => 'address',
            'priority' => 'priority',
            'received_at' => 'received_at',
            'due_in' => 'due_in',
            'due_date' => 'due_date',
            'total_raw_files' => 'total_raw_files',
            'hdr_images_count' => 'hdr_images_count',
            'single_images_count' => 'single_images_count',
            'final_images_count' => 'final_images_count',
        ];

        // Also auto-map any CSV header that exactly matches a known column
        $knownCols = ['order_number','client_reference','client_name','address','priority','received_at',
            'due_in','due_date','order_type','complexity_weight','estimated_minutes',
            'total_raw_files','hdr_images_count','single_images_count','final_images_count'];
        foreach ($headers as $h) {
            $lh = strtolower(trim($h));
            if (in_array($lh, $knownCols) && !isset($mapping[$lh])) {
                $mapping[$lh] = $h;
            }
        }

        $total = 0;
        $imported = 0;
        $skipped = 0;
        $errors = [];

        while (($row = fgetcsv($handle)) !== false) {
            $total++;
            $data = array_combine($headers, $row);

            try {
                // Map fields
                $orderData = [
                    'project_id' => $project->id,
                    'import_source' => 'csv',
                    'import_log_id' => $importLog->id,
                    'current_layer' => $project->workflow_layers[0] ?? 'drawer',
                    'status' => 'pending',
                ];

                foreach ($mapping as $ourField => $csvField) {
                    if (isset($data[$csvField])) {
                        $orderData[$ourField] = $data[$csvField];
                    }
                }

                // Generate order number if not provided
                if (empty($orderData['order_number'])) {
                    $orderData['order_number'] = $project->code . '-' . Str::upper(Str::random(8));
                }

                // Set default received_at
                if (empty($orderData['received_at'])) {
                    $orderData['received_at'] = now();
                }

                // Validate
                $tableName = ProjectOrderService::getTableName($project->id);
                $validator = Validator::make($orderData, [
                    'order_number' => 'required|unique:' . $tableName . ',order_number',
                    'project_id' => 'required|exists:projects,id',
                    'priority' => 'nullable|in:low,normal,high,urgent',
                ]);

                if ($validator->fails()) {
                    $errors[] = [
                        'row' => $total,
                        'message' => $validator->errors()->first(),
                        'data' => $data,
                    ];
                    $skipped++;
                    continue;
                }

                // Set default priority
                $orderData['priority'] = $orderData['priority'] ?? 'normal';

                // Set workflow state so orders enter the queue
                if (empty($orderData['workflow_state'])) {
                    $orderData['workflow_state'] = ($project->workflow_type === 'PH_2_LAYER') ? 'QUEUED_DESIGN' : 'QUEUED_DRAW';
                }
                if (empty($orderData['workflow_type'])) {
                    $orderData['workflow_type'] = $project->workflow_type;
                }

                Order::createForProject($project->id, $orderData);
                $imported++;
                $importLog->incrementImported();

            } catch (\Exception $e) {
                $errors[] = [
                    'row' => $total,
                    'message' => $e->getMessage(),
                ];
                $skipped++;
                $importLog->addError($e->getMessage(), $total);
            }
        }

        fclose($handle);

        $importLog->update([
            'total_rows' => $total,
            'skipped_count' => $skipped,
        ]);
        $importLog->markCompleted();

        // Update source stats
        $source = $importLog->importSource;
        $source->update([
            'last_sync_at' => now(),
            'orders_synced' => $source->orders_synced + $imported,
        ]);

        return [
            'total' => $total,
            'imported' => $imported,
            'skipped' => $skipped,
            'errors' => $errors,
        ];
    }
    
    
    
    
    public function importCsvText(Request $request, int $projectId)
{
    $request->validate([
        'csv_text' => 'required|string'
    ]);

    $project = Project::findOrFail($projectId);
    $user = auth()->user();

    $source = OrderImportSource::firstOrCreate(
        ['project_id' => $projectId, 'type' => 'csv', 'name' => 'CSV Text Import'],
        ['is_active' => true]
    );

    $importLog = OrderImportLog::create([
        'import_source_id' => $source->id,
        'imported_by' => $user->id,
        'status' => 'pending',
        'file_path' => null,
    ]);

    $result = $this->processCsvString($request->csv_text, $project, $importLog);

    return response()->json([
        'message' => 'CSV text import completed',
        'data' => $result
    ]);
}






private function processCsvString(string $csvText, Project $project, OrderImportLog $importLog): array
{
    $importLog->markStarted();

    /*
    |--------------------------------------------------------------------------
    | Split lines safely
    |--------------------------------------------------------------------------
    */
    $lines = array_filter(array_map('trim', preg_split('/\r\n|\r|\n/', $csvText)));

    if (count($lines) < 1) {
        return [
            'total' => 0,
            'imported' => 0,
            'skipped' => 0,
            'errors' => ['Invalid CSV format']
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | Detect delimiter (TAB, comma, or multi-space)
    |--------------------------------------------------------------------------
    */
    $headerLine = array_shift($lines);

    if (str_contains($headerLine, "\t")) {
        $delimiter = "\t";
    } elseif (str_contains($headerLine, ",")) {
        $delimiter = ",";
    } else {
        $delimiter = 'space';
    }

    /*
    |--------------------------------------------------------------------------
    | Parse headers
    |--------------------------------------------------------------------------
    */
    if ($delimiter === 'space') {
        $rawHeaders = preg_split('/\s{2,}|\t+/', $headerLine);
    } else {
        $rawHeaders = str_getcsv($headerLine, $delimiter);
    }

    $headers = array_map(function ($h) {

        $hTrimmed = trim($h);
        $normalized = strtolower(str_replace([' ', '-'], '_', $hTrimmed));

        if ($normalized === 'project_code') {
            return 'client_name';
        }

        return strtoupper($hTrimmed) === 'VARIANT_NO'
            ? 'VARIANT_no'
            : $normalized;

    }, $rawHeaders);

    /*
    |--------------------------------------------------------------------------
    | Identify VARIANT_no
    |--------------------------------------------------------------------------
    */
    $variantHeader = null;
    foreach ($headers as $h) {
        if ($h === 'VARIANT_no') {
            $variantHeader = $h;
            break;
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Stats
    |--------------------------------------------------------------------------
    */
    $total = 0;
    $imported = 0;
    $skipped = 0;
    $errors = [];

    $debug = [
        'delimiter' => $delimiter,
        'raw_headers' => $rawHeaders,
        'normalized_headers' => $headers,
        'sample_rows' => []
    ];

    /*
    |--------------------------------------------------------------------------
    | Cache table columns
    |--------------------------------------------------------------------------
    */
    $table = "project_{$project->id}_orders";
    static $columnCache = [];

    if (!isset($columnCache[$table])) {
        $columnCache[$table] = \Schema::getColumnListing($table);
    }

    $columns = $columnCache[$table];

    /*
    |--------------------------------------------------------------------------
    | Process rows
    |--------------------------------------------------------------------------
    */
    foreach ($lines as $lineIndex => $line) {

        $total++;

        try {

            /*
            |--------------------------------------------------------------------------
            | Parse row flexibly
            |--------------------------------------------------------------------------
            */
            if ($delimiter === 'space') {
                // First try 2+ space / tab separator (fixed-width style)
                $row = preg_split('/\s{2,}|\t+/', $line);
                // Fallback: if column count doesn't match, use single-space limited split
                // so the last column can absorb spaces (e.g. address "12 Alpha Street")
                if (count($row) !== count($headers)) {
                    $row = preg_split('/\s+/', $line, count($headers));
                }
            } else {
                $row = str_getcsv($line, $delimiter);
            }

            $row = array_map('trim', $row);

            if (count($row) !== count($headers)) {
                throw new \Exception('Column mismatch');
            }

            $data = array_combine($headers, $row);

            if ($lineIndex < 3) {
                $debug['sample_rows'][] = $data;
            }

            /*
            |--------------------------------------------------------------------------
            | received_at logic
            |--------------------------------------------------------------------------
            */
            if (!empty($data['received_at'])) {

                $receivedAtRaw = $data['received_at'];

                try {
                    $receivedAt = \Carbon\Carbon::createFromFormat('m/d/Y h:i:s A', $receivedAtRaw);
                } catch (\Exception $e1) {
                    try {
                        $receivedAt = \Carbon\Carbon::createFromFormat('m/d/Y H:i:s', $receivedAtRaw);
                    } catch (\Exception $e2) {
                        $receivedAt = \Carbon\Carbon::parse($receivedAtRaw);
                    }
                }

            } else {

                // default current time
                $receivedAt = now();

            }

            /*
            |--------------------------------------------------------------------------
            | due_in logic
            |--------------------------------------------------------------------------
            */
            if (!empty($data['due_in'])) {

                $dueInRaw = trim((string) $data['due_in']);

                preg_match('/^\s*(?:(\d+)\s*h(?:ours?)?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?\s*$/i', $dueInRaw, $m);

                $hours = isset($m[1]) ? (int) $m[1] : 0;
                $minutes = isset($m[2]) ? (int) $m[2] : 0;

                if ($hours > 0 || $minutes > 0) {
                    $dueAt = $receivedAt->copy()
                        ->addHours($hours)
                        ->addMinutes($minutes);
                } else {
                    $looksLikeAbsoluteDateTime =
                        preg_match('/[\/\-]/', $dueInRaw)
                        && (
                            preg_match('/\d{1,2}:\d{2}/', $dueInRaw)
                            || preg_match('/\b(am|pm)\b/i', $dueInRaw)
                        );

                    if (!$looksLikeAbsoluteDateTime) {
                        throw new \Exception('Invalid due_in format');
                    }

                    try {
                        $dueAt = \Carbon\Carbon::parse($dueInRaw);
                    } catch (\Throwable $e) {
                        throw new \Exception('Invalid due_in format');
                    }
                }

            } else {

                // default 12 hours
                $dueAt = $receivedAt->copy()->addHours(12);

            }

            /*
            |--------------------------------------------------------------------------
            | Variant safe
            |--------------------------------------------------------------------------
            */
            $variantNo = $variantHeader
                ? ($data[$variantHeader] ?? null)
                : null;

            if ($lineIndex < 3) {
                $debug['sample_rows'][$lineIndex]['_debug_variant'] = $variantNo;
            }

            /*
            |--------------------------------------------------------------------------
            | Base Order Data
            |--------------------------------------------------------------------------
            */
            $isPhotoTwoLayer = ($project->workflow_type === 'PH_2_LAYER');

            $orderData = [

                'order_number'  => $data['order_number'] ?? null,
                'project_id'    => $project->id,
                'received_at'   => $receivedAt,
                'due_in'        => $dueAt->toDateTimeString(),
                'due_date'      => $dueAt->toDateString(),
                'status'        => 'pending',
                'current_layer' => $project->workflow_layers[0] ?? ($isPhotoTwoLayer ? 'designer' : 'drawer'),
                'workflow_state'=> $isPhotoTwoLayer ? 'QUEUED_DESIGN' : 'QUEUED_DRAW',
                'workflow_type' => $project->workflow_type,
                'import_source' => 'csv',
                'import_log_id' => $importLog->id,
            ];

            if (in_array('client_portal_id', $columns, true)) {
                $orderData['client_portal_id'] = null;
            }

            if ($project->id === 16 && in_array('date', $columns, true)) {
                $orderDate = $receivedAt->copy();

                if ($receivedAt->hour >= 22) {
                    $orderDate->addDay();
                }

                $orderData['date'] = $orderDate->format('d-m-Y');
            }

            /*
            |--------------------------------------------------------------------------
            | Dynamic column mapping
            |--------------------------------------------------------------------------
            */
            $csvToDbMap = [

                'client_portal_id'    => 'client_portal_id',
                'client_name'         => 'client_name',
                'company'             => 'company',
                'branch'              => 'branch',
                'photographer'        => 'photographer',
                'address'             => 'address',
                'plan_type'           => 'plan_type',
                'code'                => 'code',
                'batch_number'        => 'batch_number',
                'VARIANT_no'          => 'VARIANT_no',
                'project_type'        => 'project_type',
                'bedrooms'            => 'bedrooms',
                'total_raw_files'     => 'total_raw_files',
                'hdr_images_count'    => 'hdr_images_count',
                'single_images_count' => 'single_images_count',
                'final_images_count'  => 'final_images_count',
            ];

            foreach ($csvToDbMap as $csvField => $dbColumn) {

                if (in_array($dbColumn, $columns)) {

                    if ($dbColumn === 'VARIANT_no') {
                        $orderData[$dbColumn] = $variantNo;
                        continue;
                    }

                    $rawValue = $data[$csvField] ?? null;

                    if (is_string($rawValue)) {
                        $rawValue = trim($rawValue);
                    }

                    if (in_array($dbColumn, ['total_raw_files', 'hdr_images_count', 'single_images_count', 'final_images_count'], true)) {
                        // Only write the key when a real value is provided.
                        // Omitting it lets MySQL use the column DEFAULT (avoids NULL into NOT NULL columns).
                        if ($rawValue !== '' && $rawValue !== null) {
                            $orderData[$dbColumn] = (int) preg_replace('/[^0-9\-]/', '', (string) $rawValue);
                        }
                        continue;
                    }

                    $orderData[$dbColumn] = ($rawValue === '') ? null : $rawValue;
                }
            }

            // Fallback for image counts when incoming header text has slight formatting differences.
            $readImageCount = function (string $column) use ($data): ?int {
                $raw = $data[$column] ?? null;

                if ($raw === null) {
                    $targetKey = strtolower(preg_replace('/[^a-z0-9]/', '', $column));
                    foreach ($data as $k => $v) {
                        $candidateKey = strtolower(preg_replace('/[^a-z0-9]/', '', (string) $k));
                        if ($candidateKey === $targetKey) {
                            $raw = $v;
                            break;
                        }
                    }
                }

                if (is_string($raw)) {
                    $raw = trim($raw);
                }

                if ($raw === '' || $raw === null) {
                    return null;
                }

                return (int) preg_replace('/[^0-9\-]/', '', (string) $raw);
            };

            foreach (['total_raw_files', 'hdr_images_count', 'single_images_count', 'final_images_count'] as $imgCol) {
                if (!in_array($imgCol, $columns, true)) {
                    continue;
                }

                $imgValue = $readImageCount($imgCol);
                if ($imgValue !== null) {
                    $orderData[$imgCol] = $imgValue;
                }
            }

            /*
            |--------------------------------------------------------------------------
            | Insert
            |--------------------------------------------------------------------------
            */
            // Auto-generate order number when not provided in the CSV (mirrors processCsvFile behaviour)
            if (empty($orderData['order_number'])) {
                $orderData['order_number'] = $project->code . '-' . Str::upper(Str::random(8));
            }

            // Graceful duplicate skip — avoids a raw SQL unique-key exception in the errors list
            $alreadyExists = Order::forProject($project->id)
                ->where('order_number', $orderData['order_number'])
                ->exists();
            if ($alreadyExists) {
                $skipped++;
                $errors[] = "Row {$total}: Order {$orderData['order_number']} already exists — skipped";
                continue;
            }

            Order::createForProject($project->id, $orderData);

            $imported++;
            $importLog->incrementImported();

        } catch (\Throwable $e) {

            $skipped++;
            $errors[] = "Row {$total}: " . $e->getMessage();
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Final log
    |--------------------------------------------------------------------------
    */
    $importLog->update([
        'total_rows' => $total,
        'skipped_count' => $skipped,
    ]);

    $importLog->markCompleted();

    return [
        'message'  => 'CSV text import completed',
        'total'    => $total,
        'imported' => $imported,
        'skipped'  => $skipped,
        'errors'   => $errors,
        'debug'    => $debug
    ];
}




    /**
     * Sync orders from API source.
     */
    public function syncFromApi(Request $request, int $sourceId)
    {
        $source = OrderImportSource::findOrFail($sourceId);

        if ($source->type !== 'api' && $source->type !== 'cron') {
            return response()->json([
                'message' => 'This source is not configured for API sync',
            ], 400);
        }

        if (!$source->api_endpoint) {
            return response()->json([
                'message' => 'API endpoint not configured',
            ], 400);
        }

        $user = auth()->user();
        $project = $source->project;

        // Create import log
        $importLog = OrderImportLog::create([
            'import_source_id' => $source->id,
            'imported_by' => $user->id,
            'status' => 'processing',
            'started_at' => now(),
        ]);

        try {
            // Make API request
            $response = Http::withHeaders($this->buildApiHeaders($source))
                ->get($source->api_endpoint);

            if (!$response->successful()) {
                $importLog->markFailed(['API request failed: ' . $response->status()]);
                return response()->json([
                    'message' => 'API request failed',
                    'status' => $response->status(),
                ], 400);
            }

            $orders = $response->json('orders') ?? $response->json('data') ?? $response->json();
            
            if (!is_array($orders)) {
                $importLog->markFailed(['Invalid response format']);
                return response()->json([
                    'message' => 'Invalid response format from API',
                ], 400);
            }

            $result = $this->processApiOrders($orders, $project, $importLog, $source);

            return response()->json([
                'message' => 'API sync completed',
                'data' => $result,
            ]);

        } catch (\Exception $e) {
            $importLog->markFailed([$e->getMessage()]);
            return response()->json([
                'message' => 'API sync failed: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Build API headers from source credentials.
     */
    private function buildApiHeaders(OrderImportSource $source): array
    {
        $headers = [
            'Accept' => 'application/json',
        ];

        $creds = $source->api_credentials ?? [];

        if (isset($creds['api_key'])) {
            $headers['Authorization'] = 'Bearer ' . $creds['api_key'];
        }

        if (isset($creds['headers'])) {
            $headers = array_merge($headers, $creds['headers']);
        }

        return $headers;
    }

    /**
     * Process orders from API response.
     */
    private function processApiOrders(array $orders, Project $project, OrderImportLog $importLog, OrderImportSource $source): array
    {
        $mapping = $source->field_mapping ?? [];
        $total = count($orders);
        $imported = 0;
        $skipped = 0;
        $errors = [];

        foreach ($orders as $index => $orderData) {
            try {
                // Map fields
                $mappedData = [
                    'project_id' => $project->id,
                    'import_source' => $source->type,
                    'import_log_id' => $importLog->id,
                    'current_layer' => $project->workflow_layers[0] ?? 'drawer',
                    'status' => 'pending',
                    'received_at' => now(),
                ];

                // Apply field mapping
                foreach ($mapping as $ourField => $apiField) {
                    if (isset($orderData[$apiField])) {
                        $mappedData[$ourField] = $orderData[$apiField];
                    }
                }

                // Use API's order ID as client_portal_id
                if (isset($orderData['id'])) {
                    $mappedData['client_portal_id'] = (string) $orderData['id'];
                }

                // Generate order number if not mapped
                if (empty($mappedData['order_number'])) {
                    $mappedData['order_number'] = $project->code . '-' . ($mappedData['client_portal_id'] ?? Str::upper(Str::random(8)));
                }

                // Check for duplicate by order_number or client_portal_id
                $existsQuery = Order::forProject($project->id)
                    ->where('order_number', $mappedData['order_number']);

                if (!empty($mappedData['client_portal_id'])) {
                    $existsQuery->orWhere(function ($query) use ($mappedData, $project) {
                        $query->where('project_id', $project->id)
                            ->where('client_portal_id', $mappedData['client_portal_id']);
                    });
                }

                $exists = $existsQuery->exists();

                if ($exists) {
                    $skipped++;
                    continue;
                }

                Order::createForProject($project->id, $mappedData);
                $imported++;

            } catch (\Exception $e) {
                $errors[] = [
                    'index' => $index,
                    'message' => $e->getMessage(),
                ];
                $importLog->addError($e->getMessage(), $index);
            }
        }

        $importLog->update([
            'total_rows' => $total,
            'imported_count' => $imported,
            'skipped_count' => $skipped,
        ]);
        $importLog->markCompleted();

        $source->update([
            'last_sync_at' => now(),
            'orders_synced' => $source->orders_synced + $imported,
        ]);

        return [
            'total' => $total,
            'imported' => $imported,
            'skipped' => $skipped,
            'errors' => $errors,
        ];
    }

    /**
     * Get import history for a project.
     */
    public function importHistory(Request $request, int $projectId)
    {
        $logs = OrderImportLog::whereHas('importSource', function ($query) use ($projectId) {
            $query->where('project_id', $projectId);
        })
        ->with(['importSource', 'importedBy'])
        ->orderBy('created_at', 'desc')
        ->paginate(20);

        return response()->json($logs);
    }

    /**
     * Get details of a specific import.
     */
    public function importDetails(int $importLogId)
    {
        $log = OrderImportLog::with(['importSource', 'importedBy', 'orders'])
            ->findOrFail($importLogId);

        return response()->json($log);
    }
}


