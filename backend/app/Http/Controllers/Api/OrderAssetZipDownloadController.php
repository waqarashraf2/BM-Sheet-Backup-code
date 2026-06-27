<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Project;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use ZipArchive;

class OrderAssetZipDownloadController extends Controller
{
    private const DEFAULT_LIMIT = 150;
    private const MAX_LIMIT = 200;

    public function __invoke(Request $request, string $jobOrderId)
    {
        @set_time_limit(0);

        $jobOrderId = trim($jobOrderId);
        if ($jobOrderId === '') {
            return response()->json(['message' => 'job_order_id is required.'], 422);
        }

        $user = $request->user();
        $allowedProjectIds = $this->resolveProjectIds($user);
        if (empty($allowedProjectIds)) {
            return response()->json(['message' => 'No accessible projects found for this user.'], 403);
        }

        $requestedProjectId = (int) $request->query('project_id', 0);
        if ($requestedProjectId > 0 && !in_array($requestedProjectId, $allowedProjectIds, true)) {
            return response()->json(['message' => 'Access denied to this project.'], 403);
        }

        $limit = min(max((int) $request->query('limit', self::DEFAULT_LIMIT), 1), self::MAX_LIMIT);
        $offset = max((int) $request->query('offset', 0), 0);
        $candidateProjectIds = $requestedProjectId > 0 ? [$requestedProjectId] : $allowedProjectIds;

        $allLinks = collect($candidateProjectIds)
            ->flatMap(fn (int $projectId) => $this->fetchProjectTableLinks($projectId, $jobOrderId))
            ->unique(fn (array $row) => strtolower(trim((string) ($row['url'] ?? ''))))
            ->filter(fn (array $row) => $this->isImageLike((string) ($row['name'] ?? ''), (string) ($row['url'] ?? '')))
            ->values();

        $total = $allLinks->count();
        $links = $allLinks->slice($offset, $limit)->values();

        if ($links->isEmpty()) {
            return response()->json(['message' => 'No image links found for this download range.'], 404);
        }

        if (!class_exists(ZipArchive::class)) {
            return response()->json(['message' => 'ZIP extension is not available on this server.'], 500);
        }

        $baseName = $this->safeFileName($request->query('display_order') ?: $jobOrderId, 'order-images');
        $chunkNumber = intdiv($offset, $limit) + 1;
        $chunkSuffix = $total > $limit ? "-part-{$chunkNumber}" : '';
        $zipName = "{$baseName}-images{$chunkSuffix}.zip";
        $zipPath = storage_path('app/tmp/' . Str::uuid() . '.zip');

        if (!is_dir(dirname($zipPath))) {
            mkdir(dirname($zipPath), 0775, true);
        }

        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            return response()->json(['message' => 'Unable to create ZIP file.'], 500);
        }

        $usedNames = [];
        $tmpFiles = [];
        $failed = [];
        $added = 0;

        foreach ($links as $index => $link) {
            $name = $this->uniqueZipName(
                $this->safeFileName((string) ($link['name'] ?? ''), 'image-' . ($offset + $index + 1)),
                $usedNames
            );
            $url = (string) ($link['url'] ?? '');
            $tmpFile = storage_path('app/tmp/' . Str::uuid() . '.asset');

            try {
                $response = Http::timeout(300)
                    ->connectTimeout(30)
                    ->retry(1, 500)
                    ->sink($tmpFile)
                    ->get($url);

                if (!$response->successful() || !is_file($tmpFile) || filesize($tmpFile) === 0) {
                    throw new \RuntimeException('HTTP ' . $response->status());
                }

                $zip->addFile($tmpFile, $name);
                $tmpFiles[] = $tmpFile;
                $added++;
            } catch (\Throwable $exception) {
                $failed[] = [
                    'name' => $name,
                    'url' => $url,
                    'error' => $exception->getMessage(),
                ];
                Log::warning('Order asset ZIP image download failed', [
                    'job_order_id' => $jobOrderId,
                    'url' => $url,
                    'error' => $exception->getMessage(),
                ]);
                if (is_file($tmpFile)) {
                    @unlink($tmpFile);
                }
                continue;
            }
        }

        if (!empty($failed)) {
            $zip->addFromString('failed-downloads.txt', $this->failedManifest($failed));
        }

        $zip->close();

        foreach ($tmpFiles as $tmpFile) {
            if (is_file($tmpFile)) {
                @unlink($tmpFile);
            }
        }

        foreach (glob(storage_path('app/tmp/*.asset')) ?: [] as $assetTmp) {
            if (is_file($assetTmp) && filemtime($assetTmp) < time() - 3600) {
                @unlink($assetTmp);
            }
        }

        if ($added === 0) {
            @unlink($zipPath);
            return response()->json(['message' => 'No images could be downloaded into ZIP.'], 502);
        }

        return response()->download($zipPath, $zipName, [
            'Content-Type' => 'application/zip',
            'X-Asset-Zip-Total' => (string) $total,
            'X-Asset-Zip-Offset' => (string) $offset,
            'X-Asset-Zip-Limit' => (string) $limit,
            'X-Asset-Zip-Added' => (string) $added,
            'X-Asset-Zip-Failed' => (string) count($failed),
        ])->deleteFileAfterSend(true);
    }

    private function resolveProjectIds($user): array
    {
        return match ($user->role) {
            'ceo', 'director' => Project::pluck('id')->map(fn ($id) => (int) $id)->all(),
            'operations_manager', 'project_manager' => array_map('intval', $user->getManagedProjectIds()),
            'qa', 'live_qa', 'drawer', 'checker', 'designer' => $user->project_id ? [(int) $user->project_id] : [],
            default => [],
        };
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
                'id' => $row->id,
                'name' => $row->file_name ?: basename(parse_url((string) $row->images_url, PHP_URL_PATH) ?: ''),
                'url' => $row->images_url,
            ]);
    }

    private function isImageLike(string $name, string $url): bool
    {
        $value = strtolower($name . ' ' . $url);

        foreach (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.svg'] as $extension) {
            if (str_contains($value, $extension)) {
                return true;
            }
        }

        return false;
    }

    private function safeFileName(string $name, string $fallback): string
    {
        $clean = trim($name) !== '' ? trim($name) : $fallback;
        $clean = preg_replace('/[\\\\\/:*?"<>|]+/', '_', $clean) ?: $fallback;
        return trim($clean, " \t\n\r\0\x0B.") ?: $fallback;
    }

    private function uniqueZipName(string $name, array &$used): string
    {
        if (!isset($used[strtolower($name)])) {
            $used[strtolower($name)] = true;
            return $name;
        }

        $extension = pathinfo($name, PATHINFO_EXTENSION);
        $base = $extension ? substr($name, 0, -strlen($extension) - 1) : $name;
        $suffix = $extension ? ".{$extension}" : '';
        $counter = 2;

        do {
            $candidate = "{$base} ({$counter}){$suffix}";
            $counter++;
        } while (isset($used[strtolower($candidate)]));

        $used[strtolower($candidate)] = true;
        return $candidate;
    }

    private function failedManifest(array $failed): string
    {
        $lines = [
            'Some images could not be downloaded into this ZIP.',
            'The original links are listed below.',
            '',
        ];

        foreach ($failed as $index => $row) {
            $lines[] = ($index + 1) . '. ' . $row['name'];
            $lines[] = $row['url'];
            $lines[] = $row['error'];
            $lines[] = '';
        }

        return implode(PHP_EOL, $lines);
    }
}
