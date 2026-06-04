<?php

namespace App\Http\Controllers\Api\Import;

use App\Http\Controllers\Controller;
use App\Services\FocalCrmPhotoService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public endpoint for project-22 photo job ingestion.
 *
 * Other projects/services that already fetched jobs from the FocalCRM API
 * can POST those jobs here so they are saved into project_22_orders without
 * making a second live API call.
 *
 * Authentication: shared secret key passed in the X-Import-Secret header.
 * Set PHOTO_IMPORT_SECRET in .env (must match on the calling side).
 */
class FocalCrmPhotoPublicImportController extends Controller
{
    public function __construct(private FocalCrmPhotoService $service) {}

    /**
     * POST /api/public-import/project-22/photo-orders
     *
     * Body (JSON):
     *   { "jobs": [ <FocalCRM job object>, ... ] }
     *   or
     *   { "jobs": { "0": <job>, ... } }   (associative array is also accepted)
     */
    public function store(Request $request): JsonResponse
    {
        // ── Shared-secret authentication ──────────────────────────────────
        $secret = config('services.photo_import.secret');

        if (empty($secret)) {
            return response()->json([
                'success' => false,
                'message' => 'Import endpoint not configured (PHOTO_IMPORT_SECRET missing).',
            ], 500);
        }

        if ($request->header('X-Import-Secret') !== $secret) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized.',
            ], 401);
        }

        // ── Validate payload ──────────────────────────────────────────────
        $validated = $request->validate([
            'jobs'   => ['required', 'array', 'min:1'],
            'jobs.*' => ['array'],
        ]);

        $jobs = array_values($validated['jobs']);

        // ── Import ────────────────────────────────────────────────────────
        $result = $this->service->importFromPayload($jobs);

        $status = $result['success'] ? 200 : 422;

        return response()->json($result, $status);
    }
}
