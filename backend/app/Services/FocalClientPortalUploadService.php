<?php

namespace App\Services;

use App\Models\ClientPortalUpload;
use App\Models\Order;
use App\Models\Project;
use App\Models\User;
use Illuminate\Http\Client\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\ValidationException;

class FocalClientPortalUploadService
{
    private const DEFAULT_ENABLED_PROJECT_IDS = [22, 23, 25, 26];
    private const IN_PROGRESS_PRODUCTS = [
        'photography',
        'drone photography',
        'drone photography',
        'prestige photography',
        'streetscape',
        'additional photo',
        'photo enhancement',
    ];

    public function isRequiredForProject(int $projectId): bool
    {
        if (!Schema::hasTable('client_portal_upload_projects')) {
            return in_array($projectId, self::DEFAULT_ENABLED_PROJECT_IDS, true);
        }

        $row = DB::table('client_portal_upload_projects')
            ->where('project_id', $projectId)
            ->first(['is_active', 'qa_upload_required']);

        if ($row) {
            return (bool) $row->is_active && (bool) $row->qa_upload_required;
        }

        return in_array($projectId, self::DEFAULT_ENABLED_PROJECT_IDS, true);
    }

    public function isRequiredForOrder(Order $order): bool
    {
        return strtoupper((string) $order->workflow_type) === 'PH_2_LAYER'
            && $this->isRequiredForProject((int) $order->project_id);
    }

    public function canUploadForOrder(Order $order, ?string $jobOrderId = null): bool
    {
        return strtoupper((string) $order->workflow_type) === 'PH_2_LAYER'
            && $this->isRequiredForProject((int) $order->project_id)
            && $this->uploadJobId($order) !== '';
    }

    public function status(Order $order): array
    {
        $required = $this->isRequiredForOrder($order);
        $canUpload = $this->canUploadForOrder($order);
        $jobOrderId = $this->fileReference($order);
        $clientPortalJobId = $this->uploadJobId($order);
        $customerParentCompany = $this->customerParentCompany($order);
        $upload = $canUpload && Schema::hasTable('client_portal_uploads')
            ? $this->latestUploadForStatus($order)
            : null;

        $portalJobStatus = $canUpload ? $this->clientPortalJobStatus($order) : null;

        return [
            'required' => $required,
            'can_upload' => $canUpload,
            'uploaded' => in_array($upload?->status, ['uploaded', 'submitted', 'submit_failed'], true),
            'submitted' => $upload?->status === 'submitted',
            'status' => $upload?->status ?? ($canUpload ? 'not_uploaded' : 'not_required'),
            'client_portal_job_status' => $portalJobStatus,
            'client_portal_blocks_internal_submit' => $this->blocksInternalSubmit($portalJobStatus, $upload?->status),
            'order_id' => (int) $order->id,
            'project_id' => (int) $order->project_id,
            'job_order_id' => $jobOrderId !== '' ? $jobOrderId : null,
            'client_portal_job_id' => $clientPortalJobId !== '' ? $clientPortalJobId : null,
            'order_number' => $order->order_number,
            'client_name' => $order->client_name,
            'CustomerParentCompany' => $customerParentCompany,
            'customer_parent_company' => $customerParentCompany,
            'client_reference' => $order->client_reference,
            'file_names' => $upload?->file_names ?? [],
            'uploaded_at' => $upload?->uploaded_at?->toIso8601String(),
            'submitted_at' => $upload?->submitted_at?->toIso8601String(),
            'failure_reason' => $upload?->failure_reason,
        ];
    }

    /**
     * @param array<int, UploadedFile> $files
     */
    public function upload(Order $order, User $user, array $files, ?string $requestedJobOrderId = null, bool $forceReupload = false): ClientPortalUpload
    {
        $projectId = (int) $order->project_id;
        if (!$this->canUploadForOrder($order, $requestedJobOrderId)) {
            throw ValidationException::withMessages([
                'order' => 'Client portal upload is not enabled for this order.',
            ]);
        }

        $jobOrderId = $this->uploadJobId($order);
        $fileReference = $this->fileReference($order);
        $this->validateRequestedJobOrderId($requestedJobOrderId, $jobOrderId, $fileReference);
        $fileNames = collect($files)
            ->map(fn (UploadedFile $file) => $file->getClientOriginalName())
            ->values();

        $this->validateFileNames($projectId, $fileReference, $fileNames);

        $existingSubmittedUpload = ClientPortalUpload::query()
            ->where('project_id', $projectId)
            ->where('order_id', $order->id)
            ->where('status', 'submitted')
            ->latest('id')
            ->first();

        if ($existingSubmittedUpload && !$forceReupload) {
            return $existingSubmittedUpload;
        }

        $existingUploadedUpload = ClientPortalUpload::query()
            ->where('project_id', $projectId)
            ->where('order_id', $order->id)
            ->where('status', 'uploaded')
            ->latest('id')
            ->first();

        if ($existingUploadedUpload && !$forceReupload) {
            return $existingUploadedUpload;
        }

        $record = ClientPortalUpload::create([
            'project_id' => $projectId,
            'order_id' => $order->id,
            'job_order_id' => $jobOrderId,
            'uploaded_by' => $user->id,
            'status' => 'uploading',
            'file_names' => $fileNames->all(),
            'file_count' => $fileNames->count(),
        ]);

        try {
            $lastResponse = null;
            foreach ($files as $file) {
                $stream = fopen($file->getRealPath(), 'rb');
                if ($stream === false) {
                    throw new \RuntimeException("Unable to read {$file->getClientOriginalName()}.");
                }

                try {
                    $lastResponse = $this->client()
                        ->attach('files', $stream, $file->getClientOriginalName())
                        ->post($this->uploadUrl($jobOrderId));
                } finally {
                    if (is_resource($stream)) {
                        fclose($stream);
                    }
                }

                if (!$lastResponse->successful() && !$this->isAlreadyDoneResponse($lastResponse, ['uploaded', 'exists', 'duplicate'])) {
                    throw new \RuntimeException($this->responseMessage($lastResponse, 'Client portal upload failed.'));
                }
            }

            $record->update([
                'status' => 'uploaded',
                'upload_http_status' => $lastResponse?->status(),
                'upload_response' => $lastResponse?->body(),
                'uploaded_at' => now(),
                'failure_reason' => null,
            ]);
        } catch (\Throwable $e) {
            $record->update([
                'status' => 'failed',
                'failure_reason' => $e->getMessage(),
            ]);
            throw $e;
        }

        return $record->fresh();
    }

    private function latestUploadForStatus(Order $order): ?ClientPortalUpload
    {
        $successfulUpload = ClientPortalUpload::query()
            ->where('project_id', $order->project_id)
            ->where('order_id', $order->id)
            ->whereIn('status', ['uploaded', 'submitted'])
            ->latest('id')
            ->first();

        if ($successfulUpload) {
            return $successfulUpload;
        }

        return ClientPortalUpload::query()
            ->where('project_id', $order->project_id)
            ->where('order_id', $order->id)
            ->latest('id')
            ->first();
    }

    public function submit(Order $order): ClientPortalUpload
    {
        $record = ClientPortalUpload::query()
            ->where('project_id', $order->project_id)
            ->where('order_id', $order->id)
            ->whereIn('status', ['uploaded', 'submitted', 'submit_failed'])
            ->latest('id')
            ->first();

        if (!$record) {
            throw ValidationException::withMessages([
                'files' => 'Upload the order files successfully before submitting to the client portal.',
            ]);
        }

        if ($record->status === 'submitted') {
            return $record;
        }

        try {
            $response = $this->client()->post($this->submitUrl($record->job_order_id), []);
            $payload = $response->json();
            $acceptanceStatus = data_get($payload, 'Statuses.AcceptanceStatus');
            $alreadySubmitted = $this->isAlreadyDoneResponse($response, ['submitted', 'completed', 'accepted']);
            $successful = $alreadySubmitted || (
                $response->successful()
                && ($acceptanceStatus === null || strcasecmp((string) $acceptanceStatus, 'Accepted') === 0)
            );

            if (!$successful) {
                throw new \RuntimeException($this->responseMessage($response, 'Client portal submit failed.'));
            }

            $record->update([
                'status' => 'submitted',
                'submit_http_status' => $response->status(),
                'submit_response' => $response->body(),
                'submitted_at' => now(),
                'failure_reason' => null,
            ]);
        } catch (\Throwable $e) {
            $record->update([
                'status' => 'submit_failed',
                'failure_reason' => $e->getMessage(),
            ]);
            throw $e;
        }

        return $record->fresh();
    }

    public function blocksInternalSubmit(?string $clientPortalJobStatus, ?string $localUploadStatus = null): bool
    {
        $externalStatus = strtolower(trim((string) $clientPortalJobStatus));
        if (in_array($externalStatus, ['inprogress', 'in progress', 'uploaded'], true)) {
            return true;
        }

        return in_array($localUploadStatus, ['uploaded', 'submit_failed'], true);
    }

    public function clientPortalJobStatus(Order $order): ?string
    {
        $jobOrderId = $this->uploadJobId($order);
        if ($jobOrderId === '') {
            return null;
        }

        foreach (['InProgress', 'Uploaded'] as $status) {
            $job = $this->clientPortalJob($jobOrderId, $status);
            if ($job) {
                return trim((string) ($job['JobStatus'] ?? $job['jobStatus'] ?? $status)) ?: $status;
            }
        }

        return null;
    }

    /**
     * @return array{orders: array<int, array<string, mixed>>, meta: array<string, mixed>}
     */
    public function inProgressOrdersForUser(User $user, string $status = 'InProgress', ?int $requestedProjectId = null): array
    {
        $allowedProjectIds = $this->allowedProjectIdsForUser($user);
        $projectOptions = $this->projectOptions($allowedProjectIds);

        if ($requestedProjectId && in_array($requestedProjectId, $allowedProjectIds, true)) {
            $allowedProjectIds = [$requestedProjectId];
        }

        if (empty($allowedProjectIds)) {
            return [
                'orders' => [],
                'meta' => [
                    'allowed_project_ids' => [],
                    'project_options' => [],
                    'selected_project_id' => null,
                    'status' => $status,
                    'client_portal_checked' => false,
                    'client_portal_error' => null,
                ],
            ];
        }

        $status = in_array($status, ['InProgress', 'Failed'], true) ? $status : 'InProgress';
        $jobsById = $this->clientPortalJobsById([$status]);
        $clientPortalChecked = $jobsById !== null;
        $clientPortalError = null;
        if ($jobsById === null) {
            $jobsById = collect();
            $clientPortalError = "Client portal {$status} status could not be checked. Showing local uploaded but not submitted orders only.";
        }

        $orders = collect();
        foreach ($allowedProjectIds as $projectId) {
            $orders = $orders->merge(
                $this->localOrdersForClientPortalReview($projectId, $jobsById->keys()->all())
            );
        }

        $localRows = $orders
            ->map(function ($order) use ($jobsById, $status) {
                $clientPortalJobId = $this->uploadJobId($order);
                $job = $clientPortalJobId !== '' ? $jobsById->get(strtolower($clientPortalJobId)) : null;
                $latestUpload = Schema::hasTable('client_portal_uploads')
                    ? $this->latestUploadForStatus($order)
                    : null;

                $localUploadStatus = $latestUpload?->status;
                $externalStatus = is_array($job)
                    ? trim((string) ($job['JobStatus'] ?? $job['jobStatus'] ?? $status))
                    : null;

                if (!$job && !in_array($localUploadStatus, ['uploaded', 'submit_failed'], true)) {
                    return null;
                }

                return [
                    'order_id' => (int) $order->id,
                    'project_id' => (int) $order->project_id,
                    'order_number' => $order->order_number,
                    'client_reference' => $order->client_reference,
                    'client_name' => $order->client_name,
                    'customer_parent_company' => $this->customerParentCompany($order),
                    'received_at' => $this->receivedAt($order),
                    'job_order_id' => $this->fileReference($order) ?: null,
                    'client_portal_job_id' => $clientPortalJobId ?: null,
                    'workflow_state' => $order->workflow_state,
                    'internal_status' => $order->status,
                    'qa_id' => $order->qa_id,
                    'qa_name' => $order->qa_name,
                    'local_upload_status' => $localUploadStatus,
                    'uploaded_at' => $latestUpload?->uploaded_at?->toIso8601String(),
                    'client_portal_job_status' => $externalStatus,
                    'client_portal_reason' => $this->clientPortalStatusReason($job, $status),
                    'can_reupload' => true,
                    'client_portal_job' => $job,
                ];
            })
            ->filter()
            ->values();

        $matchedJobIds = $localRows
            ->pluck('client_portal_job_id')
            ->map(fn ($id) => strtolower(trim((string) $id)))
            ->filter()
            ->all();

        $externalOnlyRows = $jobsById
            ->reject(fn ($job, $jobId) => in_array(strtolower((string) $jobId), $matchedJobIds, true))
            ->when($requestedProjectId, fn ($collection) => collect())
            ->map(function (array $job) use ($status) {
                return [
                    'order_id' => null,
                    'project_id' => null,
                    'order_number' => trim((string) ($job['OrderReference'] ?? $job['orderReference'] ?? '')) ?: null,
                    'client_reference' => trim((string) ($job['Property']['Reference'] ?? $job['property']['reference'] ?? '')) ?: null,
                    'client_name' => trim((string) ($job['CustomerName'] ?? $job['customerName'] ?? '')) ?: null,
                    'customer_parent_company' => trim((string) ($job['CustomerParentCompany'] ?? $job['customerParentCompany'] ?? '')) ?: null,
                    'received_at' => trim((string) ($job['DateAssigned'] ?? $job['dateAssigned'] ?? '')) ?: null,
                    'job_order_id' => trim((string) ($job['OrderReference'] ?? $job['orderReference'] ?? '')) ?: null,
                    'client_portal_job_id' => trim((string) ($job['Id'] ?? $job['id'] ?? '')) ?: null,
                    'workflow_state' => null,
                    'internal_status' => null,
                    'qa_id' => null,
                    'qa_name' => null,
                    'local_upload_status' => null,
                    'uploaded_at' => null,
                    'client_portal_job_status' => trim((string) ($job['JobStatus'] ?? $job['jobStatus'] ?? $status)) ?: $status,
                    'client_portal_reason' => $this->clientPortalStatusReason($job, $status),
                    'can_reupload' => false,
                    'client_portal_job' => $job,
                ];
            })
            ->values();

        $rows = $localRows->merge($externalOnlyRows)->values()->all();

        return [
            'orders' => $rows,
            'meta' => [
                'allowed_project_ids' => $allowedProjectIds,
                'project_options' => $projectOptions,
                'selected_project_id' => $requestedProjectId ?: null,
                'status' => $status,
                'client_portal_checked' => $clientPortalChecked,
                'client_portal_error' => $clientPortalError,
            ],
        ];
    }

    public function canAccessInProgressOrders(User $user): bool
    {
        return !empty($this->allowedProjectIdsForUser($user));
    }

    private function validateFileNames(int $projectId, string $jobOrderId, Collection $fileNames): void
    {
        if (!$this->shouldEnforceOrderFilename($projectId)) {
            return;
        }

        $invalid = $fileNames->filter(function (string $fileName) use ($jobOrderId) {
            return !$this->fileNameContainsOrderReference($fileName, $jobOrderId);
        })->values();

        if ($invalid->isNotEmpty()) {
            throw ValidationException::withMessages([
                'files' => 'Each file name must include order reference '
                    . $jobOrderId . '. Invalid: ' . $invalid->implode(', '),
            ]);
        }
    }

    private function shouldEnforceOrderFilename(int $projectId): bool
    {
        if (!Schema::hasTable('client_portal_upload_projects')) {
            return in_array($projectId, self::DEFAULT_ENABLED_PROJECT_IDS, true);
        }

        $enforce = DB::table('client_portal_upload_projects')
            ->where('project_id', $projectId)
            ->value('enforce_order_filename');

        if ($enforce !== null) {
            return (bool) $enforce;
        }

        return in_array($projectId, self::DEFAULT_ENABLED_PROJECT_IDS, true);
    }

    private function fileNameContainsOrderReference(string $fileName, string $jobOrderId): bool
    {
        $baseName = pathinfo($fileName, PATHINFO_FILENAME);
        $pattern = '/(^|[^A-Za-z0-9])' . preg_quote($jobOrderId, '/') . '([^A-Za-z0-9]|$)/i';

        return (bool) preg_match($pattern, $baseName);
    }

    private function uploadJobId(Order $order): string
    {
        $value = trim((string) ($order->getAttribute('clint_order_number') ?? ''));

        if ($value !== '') {
            return $value;
        }

        $table = $order->getTable();
        if (!$order->id || !Schema::hasTable($table) || !Schema::hasColumn($table, 'clint_order_number')) {
            return '';
        }

        return trim((string) (DB::table($table)->where('id', $order->id)->value('clint_order_number') ?? ''));
    }

    private function customerParentCompany(Order $order): ?string
    {
        $value = trim((string) (
            $order->getAttribute('CustomerParentCompany')
            ?? $order->getAttribute('parent_company')
            ?? ''
        ));

        if ($value !== '') {
            return $value;
        }

        $metadata = $order->getAttribute('metadata');
        if (is_string($metadata)) {
            $metadata = json_decode($metadata, true) ?: [];
        }

        if (is_array($metadata)) {
            $value = trim((string) (
                $metadata['customer_parent_company']
                ?? $metadata['CustomerParentCompany']
                ?? data_get($metadata, 'raw_api_response.CustomerParentCompany')
                ?? ''
            ));
        }

        return $value !== '' ? $value : null;
    }

    private function receivedAt(Order $order): ?string
    {
        $value = trim((string) (
            $order->getAttribute('received_at')
            ?? $order->getAttribute('date')
            ?? $order->getAttribute('ausDatein')
            ?? ''
        ));

        return $value !== '' ? $value : null;
    }

    private function fileReference(Order $order): string
    {
        return trim((string) (
            $order->client_reference
            ?: $order->client_portal_id
            ?: $order->order_number
        ));
    }

    private function validateRequestedJobOrderId(?string $requestedJobOrderId, string $uploadJobId, string $fileReference): void
    {
        $requestedJobOrderId = trim((string) $requestedJobOrderId);

        if ($uploadJobId === '') {
            throw ValidationException::withMessages([
                'order' => 'The client portal job/order ID is missing.',
            ]);
        }

        if ($requestedJobOrderId === '') {
            return;
        }

        if (
            strcasecmp($requestedJobOrderId, $fileReference) !== 0
            && strcasecmp($requestedJobOrderId, $uploadJobId) !== 0
        ) {
            throw ValidationException::withMessages([
                'job_order_id' => 'The submitted client portal job ID does not match this order.',
            ]);
        }
    }

    private function client()
    {
        if (
            blank(config('services.focal_client_portal.supplier_secret'))
            || blank(config('services.focal_client_portal.subscription_key'))
        ) {
            throw new \RuntimeException(
                'Focal client portal credentials are not configured on the server.'
            );
        }

        return Http::timeout((int) config('services.focal_client_portal.timeout', 120))
            ->retry(2, 500)
            ->withHeaders([
                'Accept' => '*/*',
                'Supplier-Secret' => (string) config('services.focal_client_portal.supplier_secret'),
                'Ocp-Apim-Subscription-Key' => (string) config('services.focal_client_portal.subscription_key'),
            ]);
    }

    private function statusJobsUrl(string $status): string
    {
        return rtrim((string) config('services.focal_client_portal.status_api_url'), '/')
            . '?jobstatus=' . rawurlencode($status);
    }

    private function clientPortalJob(string $jobOrderId, string $status): ?array
    {
        $jobs = $this->clientPortalJobsById([$status]);

        return $jobs?->get(strtolower($jobOrderId));
    }

    private function clientPortalJobsById(array $statuses): ?Collection
    {
        try {
            $jobs = collect();
            foreach ($statuses as $status) {
                $response = $this->statusClient()->get($this->statusJobsUrl($status));
                if (!$response->successful()) {
                    return null;
                }

                $jobs = $jobs->merge((array) (($response->json() ?? [])['jobs'] ?? []));
            }

            return $jobs
                ->filter(fn ($job) => is_array($job))
                ->filter(fn (array $job) => $this->isInProgressProduct($job))
                ->keyBy(function (array $job) {
                    return strtolower(trim((string) ($job['Id'] ?? $job['id'] ?? '')));
                });
        } catch (\Throwable) {
            return null;
        }
    }

    private function allowedProjectIdsForUser(User $user): array
    {
        if (!in_array($user->role, ['operations_manager', 'project_manager', 'qa'], true)) {
            return [];
        }

        $projectIds = $user->role === 'qa'
            ? ($user->project_id ? [(int) $user->project_id] : [])
            : array_map('intval', $user->getManagedProjectIds());

        return array_values(array_intersect($projectIds, self::DEFAULT_ENABLED_PROJECT_IDS));
    }

    private function projectOptions(array $projectIds): array
    {
        if (empty($projectIds)) {
            return [];
        }

        return Project::query()
            ->whereIn('id', $projectIds)
            ->orderBy('id')
            ->get(['id', 'code', 'name'])
            ->map(fn (Project $project) => [
                'id' => (int) $project->id,
                'label' => trim(($project->code ? "{$project->code} - " : '') . ($project->name ?: "Project {$project->id}")),
            ])
            ->values()
            ->all();
    }

    private function statusClient()
    {
        if (
            blank(config('services.focal_client_portal.supplier_secret'))
            || blank(config('services.focal_client_portal.subscription_key'))
        ) {
            throw new \RuntimeException(
                'Focal client portal credentials are not configured on the server.'
            );
        }

        return Http::timeout((int) config('services.focal_client_portal.status_timeout', 30))
            ->withHeaders([
                'Accept' => '*/*',
                'Supplier-Secret' => (string) config('services.focal_client_portal.supplier_secret'),
                'Ocp-Apim-Subscription-Key' => (string) config('services.focal_client_portal.subscription_key'),
            ]);
    }

    private function localOrdersForClientPortalReview(int $projectId, array $clientPortalJobIds = []): Collection
    {
        $table = \App\Services\ProjectOrderService::getTableName($projectId);
        if (!Schema::hasTable($table)) {
            return collect();
        }

        if (!Schema::hasColumn($table, 'workflow_type') || !Schema::hasColumn($table, 'final_upload')) {
            return collect();
        }

        $columns = collect([
            'id', 'project_id', 'order_number', 'client_reference', 'client_name',
            'parent_company', 'CustomerParentCompany', 'client_portal_id',
            'clint_order_number', 'workflow_state', 'workflow_type', 'status',
            'qa_id', 'qa_name', 'final_upload', 'ausFinaldate', 'received_at',
            'date', 'ausDatein', 'metadata',
        ])->filter(fn ($column) => Schema::hasColumn($table, $column))->values()->all();

        if (empty($columns)) {
            return collect();
        }

        $normalizedJobIds = collect($clientPortalJobIds)
            ->map(fn ($id) => trim((string) $id))
            ->filter()
            ->values()
            ->all();

        return Order::forProject($projectId)
            ->select($columns)
            ->where('workflow_type', 'PH_2_LAYER')
            ->where(function ($query) use ($normalizedJobIds, $table) {
                $query->where('final_upload', 'yes')
                    ->orWhereIn('workflow_state', ['IN_QA', 'SUBMITTED_QA', 'APPROVED_QA', 'DELIVERED']);

                if (!empty($normalizedJobIds)) {
                    if (Schema::hasColumn($table, 'clint_order_number')) {
                        $query->orWhereIn('clint_order_number', $normalizedJobIds);
                    }
                    if (Schema::hasColumn($table, 'order_number')) {
                        $query->orWhereIn('order_number', $normalizedJobIds);
                    }
                    if (Schema::hasColumn($table, 'client_reference')) {
                        $query->orWhereIn('client_reference', $normalizedJobIds);
                    }
                }
            })
            ->latest('id')
            ->limit(500)
            ->get();
    }

    private function isInProgressProduct(array $job): bool
    {
        $product = strtolower(trim((string) ($job['Product'] ?? $job['product'] ?? '')));

        return in_array($product, self::IN_PROGRESS_PRODUCTS, true);
    }

    private function clientPortalStatusReason(?array $job, string $status): ?string
    {
        if (!$job) {
            return null;
        }

        $messages = [];
        $assetCount = $job['AssetCount'] ?? $job['assetCount'] ?? $job['AssetsCount'] ?? null;
        $quantity = $job['Quantity'] ?? $job['quantity'] ?? null;

        if (is_numeric($assetCount) && is_numeric($quantity) && (int) $assetCount < (int) $quantity) {
            $messages[] = "Uploaded image count {$assetCount} is less than required quantity {$quantity}.";
        }

        $statusMessage = trim((string) (
            $job['Message']
            ?? $job['StatusMessage']
            ?? $job['statusMessage']
            ?? $job['Reason']
            ?? $job['reason']
            ?? ''
        ));

        if ($statusMessage !== '') {
            $messages[] = $statusMessage;
        }

        return !empty($messages)
            ? implode(' ', array_unique($messages))
            : (
                $status === 'Failed'
                    ? 'Client portal shows this job as Failed. Check image count, file names, and original order reference before reuploading.'
                    : 'Client portal still shows this job as InProgress. Check image count and file names against the original order reference.'
            );
    }

    private function uploadUrl(string $jobOrderId): string
    {
        return rtrim((string) config('services.focal_client_portal.api_url'), '/')
            . '/' . rawurlencode($jobOrderId) . '/assetupload';
    }

    private function submitUrl(string $jobOrderId): string
    {
        return rtrim((string) config('services.focal_client_portal.api_url'), '/')
            . '/' . rawurlencode($jobOrderId) . '/submit';
    }

    private function responseMessage(Response $response, string $fallback): string
    {
        $payload = $response->json();
        $error = data_get($payload, 'Error');
        $message = data_get($payload, 'Messages.0.Message')
            ?? data_get($payload, 'Errors.0.Error')
            ?? data_get($payload, 'Message');

        if ($error && $message) {
            return trim((string) $error . ' ' . (string) $message);
        }

        return (string) ($message ?? $error ?? "{$fallback} (HTTP {$response->status()})");
    }

    private function isAlreadyDoneResponse(Response $response, array $keywords): bool
    {
        if (!in_array($response->status(), [400, 409], true)) {
            return false;
        }

        $body = strtolower($response->body());
        if ($body === '') {
            return false;
        }

        foreach (array_merge(['already'], $keywords) as $keyword) {
            if (str_contains($body, strtolower($keyword))) {
                return true;
            }
        }

        return false;
    }
}
