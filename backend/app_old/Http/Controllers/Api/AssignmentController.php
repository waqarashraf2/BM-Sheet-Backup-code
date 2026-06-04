<?php

namespace App\Http\Controllers\Api;
use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

class AssignmentController extends Controller
{
    /**
     * Fetch dynamic columns for a project or queue
     */
    public function getAssignments(Request $request)
    {
        $projectId = $request->input('project_id');
        $queueName = $request->input('queue_name');
        $columns   = $request->input('columns', ['*']); // selected columns, fallback *

        $startDate = $request->input('start_date');
        $endDate   = $request->input('end_date');
        $search    = $request->input('search');
        $sortBy    = $request->input('sort_by', 'received_at');
        $sortOrder = $request->input('sort_order', 'asc');

        // Get projects for queue if provided
        if ($queueName) {
            $projects = DB::table('projects')
                ->where('queue_name', $queueName)
                ->where('status', 'active')
                ->pluck('id')->toArray();
            if (!$projects) return response()->json(['message' => 'Queue not found'], 404);
        } elseif ($projectId) {
            $projects = [$projectId];
        } else {
            return response()->json(['message' => 'Project or Queue required'], 400);
        }

        // Build dynamic union query for all project tables
        $unionQuery = $this->buildDynamicUnion($projects, $columns);

        $query = DB::table(DB::raw("({$unionQuery}) as assignments"));

        // Apply search
        if ($search) {
            $query->where(function($q) use ($search) {
                $q->where('order_number', 'like', "%{$search}%")
                  ->orWhere('client_name', 'like', "%{$search}%")
                  ->orWhere('address', 'like', "%{$search}%");
            });
        }

        // Apply date filtering
        if ($startDate || $endDate) {
            if ($startDate && $endDate) {
                $query->whereBetween('received_at', [
                    Carbon::parse($startDate)->startOfDay(),
                    Carbon::parse($endDate)->endOfDay()
                ]);
            } elseif ($startDate) {
                $query->where('received_at', '>=', Carbon::parse($startDate)->startOfDay());
            } elseif ($endDate) {
                $query->where('received_at', '<=', Carbon::parse($endDate)->endOfDay());
            }
        }

        // Apply sorting
        $query->orderBy($sortBy, $sortOrder);

        // Fetch results
        $data = $query->get();

        return response()->json([
            'data' => $data,
            'total' => $data->count()
        ]);
    }

    /**
     * Build dynamic UNION query for multiple projects
     */
private function buildDynamicUnion(array $projectIds, array $columns)
{
    $unionParts = [];

    foreach ($projectIds as $pid) {
        $tableName = "project_{$pid}_orders";

        // ✅ Get actual DB columns
        $actualColumns = DB::getSchemaBuilder()->getColumnListing($tableName);

        // ✅ Extract only field names
        $requestedColumns = array_map(function ($col) {
            return is_array($col) ? $col['field'] : $col;
        }, $columns);

        // ✅ Validate columns
        $validColumns = array_intersect($requestedColumns, $actualColumns);

        // fallback
        if (empty($validColumns)) {
            $validColumns = ['*'];
        }

        $cols = implode(',', $validColumns);

        $unionParts[] = "SELECT {$cols} FROM {$tableName}";
    }

    return implode(' UNION ALL ', $unionParts);
}

    /**
     * Insert a new assignment
     */
    public function createAssignment(Request $request)
    {
        $projectId = $request->input('project_id');
        $tableName = "project_{$projectId}_orders";
        $data = $request->except(['project_id']);

        $id = DB::table($tableName)->insertGetId($data);
        return response()->json(['id' => $id, 'message' => 'Assignment created']);
    }

    /**
     * Update an assignment
     */

public function getAllColumns(Request $request)
{
    $projectId = $request->input('project_id');

    if (!$projectId) {
        return response()->json([
            'success' => false,
            'message' => 'project_id is required'
        ], 400);
    }

    $tableName = "project_{$projectId}_orders";

    // ✅ Get actual DB columns
    $actualColumns = DB::getSchemaBuilder()->getColumnListing($tableName);

    // ✅ Get saved columns
    $savedColumns = DB::table('project_columns')
        ->where('project_id', $projectId)
        ->orderBy('order_index')
        ->get();

    // ✅ If saved columns exist → use them
    if ($savedColumns->count() > 0) {
        $mapped = $savedColumns
            ->filter(fn($col) => in_array($col->column_key, $actualColumns))
            ->map(function ($col) {
                return [
                    'id' => $col->id,
                    'project_id' => $col->project_id,
                    'name' => $col->column_key,
                    'label' => $col->label,
                    'field' => $col->column_key,
                    'visible' => (bool) $col->visible,
                    'sortable' => (bool) $col->sortable,
                    'width' => $col->width,
                    'order' => $col->order_index
                ];
            })->values();
    } 
    // ✅ ELSE → generate default columns from DB
    else {
        $mapped = collect($actualColumns)->map(function ($col, $index) use ($projectId) {
            return [
                'id' => null,
                'project_id' => $projectId,
                'name' => $col,
                'label' => ucfirst(str_replace('_', ' ', $col)),
                'field' => $col,
                'visible' => true,
                'sortable' => true,
                'width' => 120,
                'order' => $index + 1
            ];
        });
    }

    return response()->json([
        'success' => true,
        'data' => $mapped
    ]);
}

public function saveAllColumns(Request $request)
{
    $columns = $request->input('columns', []);

    foreach ($columns as $col) {

        $data = [
            'project_id'   => $col['project_id'],
            'column_key'   => $col['field'],
            'label'        => $col['label'] ?? $col['name'],
            'visible'      => $col['visible'],
            'order_index'  => $col['order'],
            'sortable'     => $col['sortable'] ?? true,
            'width'        => $col['width'] ?? null,
        ];

        if (!empty($col['id'])) {
            DB::table('project_columns')
                ->where('id', $col['id'])
                ->update($data);
        } else {
            DB::table('project_columns')->insert($data);
        }
    }

    return response()->json([
        'success' => true,
        'message' => 'Columns saved successfully'
    ]);
}



    public function updateAssignment(Request $request, $projectId, $id)
    {
        $tableName = "project_{$projectId}_orders";
        $data = $request->except(['project_id', 'id']);

        DB::table($tableName)->where('id', $id)->update($data);
        return response()->json(['message' => 'Assignment updated']);
    }
}