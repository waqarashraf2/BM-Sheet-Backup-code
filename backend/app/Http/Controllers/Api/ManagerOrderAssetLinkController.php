<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Project;
use App\Services\ProjectOrderService;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;

class ManagerOrderAssetLinkController extends Controller
{
    public function index(Request $request)
    {
        $validated = $request->validate([
            'search' => ['nullable', 'string', 'max:191'],
            'project_id' => ['nullable', 'integer', 'min:1'],
        ]);

        $search = trim((string) ($validated['search'] ?? ''));
        if ($search === '') {
            return response()->json([
                'search' => '',
                'project_id' => null,
                'count' => 0,
                'orders' => [],
            ]);
        }

        $managedProjectIds = collect($request->user()->getManagedProjectIds())
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($managedProjectIds->isEmpty()) {
            return response()->json(['message' => 'No accessible projects found for this user.'], 403);
        }

        $selectedProjectId = isset($validated['project_id']) ? (int) $validated['project_id'] : null;
        if ($selectedProjectId !== null && !$managedProjectIds->contains($selectedProjectId)) {
            return response()->json(['message' => 'The selected project is not assigned to you.'], 403);
        }

        $projects = Project::query()
            ->where('status', 'active')
            ->whereIn('id', $managedProjectIds)
            ->when($selectedProjectId, fn ($query) => $query->whereKey($selectedProjectId))
            ->orderBy('name')
            ->get(['id', 'code', 'name', 'workflow_type']);

        $orders = collect();
        foreach ($projects as $project) {
            $orders = $orders->merge($this->findProjectOrders($project, $search));
        }

        $results = $orders
            ->take(10)
            ->map(function (array $match) {
                $projectId = (int) $match['project']['id'];
                $jobOrderIds = $this->candidateJobOrderIds($match['order']);
                $allLinks = collect();
                $usedJobOrderId = $jobOrderIds->first() ?? '';

                foreach ($jobOrderIds as $jobOrderId) {
                    $projectLinks = $this->fetchProjectTableLinks($projectId, $jobOrderId);
                    if ($projectLinks->isNotEmpty() && $allLinks->isEmpty()) {
                        $usedJobOrderId = $jobOrderId;
                    }
                    $allLinks = $allLinks->merge($projectLinks);

                    if ($projectId === 22) {
                        $externalLinks = $this->fetchFocalAssetDetailLinks($jobOrderId);
                        if ($externalLinks->isNotEmpty() && $allLinks->count() === $externalLinks->count()) {
                            $usedJobOrderId = $jobOrderId;
                        }
                        $allLinks = $allLinks->merge($externalLinks);
                    }
                }

                $links = $allLinks
                    ->unique(fn ($row) => strtolower(trim((string) ($row['url'] ?? ''))))
                    ->filter(fn ($row) => !empty($row['url']))
                    ->values();

                return [
                    'project' => $match['project'],
                    'order' => $match['order'],
                    'job_order_id' => $usedJobOrderId,
                    'count' => $links->count(),
                    'links' => $links,
                ];
            })
            ->values();

        return response()->json([
            'search' => $search,
            'project_id' => $selectedProjectId,
            'count' => $results->count(),
            'orders' => $results,
        ]);
    }

    private function findProjectOrders(Project $project, string $search): Collection
    {
        $table = ProjectOrderService::getTableName((int) $project->id);
        if (!Schema::hasTable($table)) {
            return collect();
        }

        $searchableColumns = collect([
            'order_number',
            'client_reference',
            'client_portal_id',
            'clint_order_number',
            'client_order_number',
        ])->filter(fn ($column) => Schema::hasColumn($table, $column))->values();

        if ($searchableColumns->isEmpty()) {
            return collect();
        }

        $selectColumns = collect([
            'id',
            'order_number',
            'project_id',
            'client_reference',
            'client_name',
            'client_portal_id',
            'clint_order_number',
            'client_order_number',
        ])->filter(fn ($column) => Schema::hasColumn($table, $column))->values()->all();

        return DB::table($table)
            ->where(function ($query) use ($searchableColumns, $search) {
                foreach ($searchableColumns as $index => $column) {
                    $method = $index === 0 ? 'where' : 'orWhere';
                    $query->{$method}($column, $search)
                        ->orWhere($column, 'like', '%' . $search . '%');
                }
            })
            ->orderByDesc('id')
            ->limit(10)
            ->get($selectColumns)
            ->map(fn ($row) => [
                'project' => [
                    'id' => (int) $project->id,
                    'code' => $project->code,
                    'name' => $project->name,
                    'workflow_type' => $project->workflow_type,
                ],
                'order' => [
                    'id' => (int) ($row->id ?? 0),
                    'order_number' => (string) ($row->order_number ?? ''),
                    'client_reference' => $row->client_reference ?? null,
                    'client_name' => $row->client_name ?? null,
                    'client_portal_id' => $row->client_portal_id ?? null,
                    'clint_order_number' => $row->clint_order_number ?? null,
                    'client_order_number' => $row->client_order_number ?? null,
                ],
            ]);
    }

    private function candidateJobOrderIds(array $order): Collection
    {
        return collect([
            $order['client_portal_id'] ?? null,
            $order['order_number'] ?? null,
            $order['clint_order_number'] ?? null,
            $order['client_order_number'] ?? null,
            $order['client_reference'] ?? null,
        ])
            ->map(fn ($value) => trim((string) $value))
            ->filter(fn ($value) => $value !== '')
            ->unique()
            ->values();
    }

    private function fetchProjectTableLinks(int $projectId, string $jobOrderId): Collection
    {
        $table = "job_detail_{$projectId}_images";

        if (!Schema::hasTable($table)) {
            return collect();
        }

        return DB::table($table)
            ->where('job_order_id', $jobOrderId)
            ->orderBy('id')
            ->get(['id', 'images_url', 'file_name', 'job_order_id'])
            ->map(fn ($row) => [
                'source' => 'project_table',
                'source_table' => $table,
                'project_id' => $projectId,
                'job_order_id' => $row->job_order_id,
                'id' => $row->id,
                'name' => $row->file_name,
                'url' => $row->images_url,
                'link_type' => 'asset',
                'meta' => null,
            ]);
    }

    private function fetchFocalAssetDetailLinks(string $jobOrderId): Collection
    {
        $apiUrl = (string) env('FOCAL_CRM_PHOTO_API_URL', env('FOCAL_CRM_API_URL', 'https://api.focalagent.com/supplier-enhancement/v3/jobs'));
        $supplierSecret = (string) env('FOCAL_CRM_PHOTO_SUPPLIER_SECRET', env('FOCAL_CRM_SUPPLIER_SECRET', 'N4ctEg%$SXGg6SF4wu'));
        $subscriptionKey = (string) env('FOCAL_CRM_PHOTO_SUBSCRIPTION_KEY', env('FOCAL_CRM_SUBSCRIPTION_KEY', 'daee797833ca4dbd87fc98b1421c57b1'));

        try {
            $response = Http::timeout(60)
                ->withHeaders([
                    'Accept' => '*/*',
                    'Supplier-Secret' => $supplierSecret,
                    'Ocp-Apim-Subscription-Key' => $subscriptionKey,
                ])
                ->get(rtrim($apiUrl, '/') . '/' . rawurlencode($jobOrderId) . '/assetdetail');

            if (!$response->successful()) {
                return collect();
            }

            return $this->extractFocalAssetLinks($response->json() ?? [], $jobOrderId);
        } catch (\Throwable $exception) {
            report($exception);
            return collect();
        }
    }

    private function extractFocalAssetLinks(array $assetDetail, string $jobOrderId): Collection
    {
        $links = collect();

        foreach ((array) ($assetDetail['RawPhotoAssets'] ?? []) as $row) {
            $url = $row['Url'] ?? $row['url'] ?? $row['URL'] ?? null;
            if (!$url) {
                continue;
            }

            $links->push([
                'source' => 'focal_assetdetail',
                'source_table' => null,
                'project_id' => 22,
                'job_order_id' => $jobOrderId,
                'id' => null,
                'name' => $row['FileName'] ?? $row['file_name'] ?? basename($url),
                'url' => $url,
                'link_type' => 'raw_photo_asset',
                'meta' => null,
            ]);
        }

        foreach ((array) ($assetDetail['Assets'] ?? []) as $row) {
            $url = $row['Url'] ?? $row['url'] ?? $row['URL'] ?? null;
            if (!$url) {
                continue;
            }

            $links->push([
                'source' => 'focal_assetdetail',
                'source_table' => null,
                'project_id' => 22,
                'job_order_id' => $jobOrderId,
                'id' => null,
                'name' => $row['FileName'] ?? $row['file_name'] ?? basename($url),
                'url' => $url,
                'link_type' => 'asset',
                'meta' => null,
            ]);
        }

        foreach ((array) ($assetDetail['AdditionalLinks'] ?? []) as $row) {
            $url = $row['Href'] ?? $row['href'] ?? null;
            if (!$url) {
                continue;
            }

            $links->push([
                'source' => 'focal_assetdetail',
                'source_table' => null,
                'project_id' => 22,
                'job_order_id' => $jobOrderId,
                'id' => null,
                'name' => $row['Description'] ?? $row['description'] ?? basename($url),
                'url' => $url,
                'link_type' => 'additional_link',
                'meta' => [
                    'description' => $row['Description'] ?? $row['description'] ?? null,
                ],
            ]);
        }

        return $links;
    }
}
