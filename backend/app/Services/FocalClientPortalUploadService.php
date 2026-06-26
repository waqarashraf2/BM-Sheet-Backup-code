<?php

namespace App\Services;

use App\Models\ClientPortalUpload;
use App\Models\Order;
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
    public function isRequiredForProject(int $projectId): bool
    {
        return Schema::hasTable('client_portal_upload_projects')
            && DB::table('client_portal_upload_projects')
                ->where('project_id', $projectId)
                ->where('is_active', true)
                ->where('qa_upload_required', true)
                ->exists();
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
        $upload = $canUpload && Schema::hasTable('client_portal_uploads')
            ? ClientPortalUpload::query()
                ->where('project_id', $order->project_id)
                ->where('order_id', $order->id)
                ->latest('id')
                ->first()
            : null;

        return [
            'required' => $required,
            'can_upload' => $canUpload,
            'uploaded' => in_array($upload?->status, ['uploaded', 'submitted', 'submit_failed'], true),
            'submitted' => $upload?->status === 'submitted',
            'status' => $upload?->status ?? ($canUpload ? 'not_uploaded' : 'not_required'),
            'order_id' => (int) $order->id,
            'project_id' => (int) $order->project_id,
            'job_order_id' => $jobOrderId !== '' ? $jobOrderId : null,
            'client_portal_job_id' => $clientPortalJobId !== '' ? $clientPortalJobId : null,
            'order_number' => $order->order_number,
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
    public function upload(Order $order, User $user, array $files, ?string $requestedJobOrderId = null): ClientPortalUpload
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

                if (!$lastResponse->successful()) {
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
            $successful = $response->successful()
                && ($acceptanceStatus === null || strcasecmp((string) $acceptanceStatus, 'Accepted') === 0);

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

    private function validateFileNames(int $projectId, string $jobOrderId, Collection $fileNames): void
    {
        $enforce = DB::table('client_portal_upload_projects')
            ->where('project_id', $projectId)
            ->value('enforce_order_filename');

        if (!$enforce) {
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
}
