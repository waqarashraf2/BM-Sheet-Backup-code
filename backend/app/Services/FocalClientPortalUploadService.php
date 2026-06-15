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

    public function status(Order $order): array
    {
        $required = $this->isRequiredForProject((int) $order->project_id);
        $upload = $required && Schema::hasTable('client_portal_uploads')
            ? ClientPortalUpload::query()
                ->where('project_id', $order->project_id)
                ->where('order_id', $order->id)
                ->latest('id')
                ->first()
            : null;

        return [
            'required' => $required,
            'uploaded' => in_array($upload?->status, ['uploaded', 'submitted', 'submit_failed'], true),
            'submitted' => $upload?->status === 'submitted',
            'status' => $upload?->status ?? ($required ? 'not_uploaded' : 'not_required'),
            'file_names' => $upload?->file_names ?? [],
            'uploaded_at' => $upload?->uploaded_at?->toIso8601String(),
            'submitted_at' => $upload?->submitted_at?->toIso8601String(),
            'failure_reason' => $upload?->failure_reason,
        ];
    }

    /**
     * @param array<int, UploadedFile> $files
     */
    public function upload(Order $order, User $user, array $files): ClientPortalUpload
    {
        $projectId = (int) $order->project_id;
        if (!$this->isRequiredForProject($projectId)) {
            throw ValidationException::withMessages([
                'project_id' => 'Client portal upload is not enabled for this project.',
            ]);
        }

        $jobOrderId = $this->jobOrderId($order);
        $fileNames = collect($files)
            ->map(fn (UploadedFile $file) => $file->getClientOriginalName())
            ->values();

        $this->validateFileNames($projectId, $jobOrderId, $fileNames);

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
                    fclose($stream);
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
            return strcasecmp(pathinfo($fileName, PATHINFO_FILENAME), $jobOrderId) !== 0;
        })->values();

        if ($invalid->isNotEmpty()) {
            throw ValidationException::withMessages([
                'files' => 'Each file name (before its extension) must exactly match order ID '
                    . $jobOrderId . '. Invalid: ' . $invalid->implode(', '),
            ]);
        }
    }

    private function jobOrderId(Order $order): string
    {
        $jobOrderId = trim((string) ($order->client_portal_id ?: $order->order_number));
        if ($jobOrderId === '') {
            throw ValidationException::withMessages([
                'order' => 'The client portal job/order ID is missing.',
            ]);
        }

        return $jobOrderId;
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
        return (string) (
            data_get($response->json(), 'Error')
            ?? data_get($response->json(), 'Errors.0.Error')
            ?? data_get($response->json(), 'Message')
            ?? "{$fallback} (HTTP {$response->status()})"
        );
    }
}
