<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;
use Illuminate\Support\Facades\Cache;

class HealthController extends Controller
{
    /**
     * Health check endpoint for monitoring.
     * Returns 200 if all critical services are operational.
     */
    public function check()
    {
        $checks = [
            'status' => 'healthy',
            'timestamp' => now()->toIso8601String(),
            'services' => [],
        ];

        try {
            // Database check
            DB::connection()->getPdo();
            $checks['services']['database'] = 'ok';
        } catch (\Throwable $e) {
            $checks['status'] = 'unhealthy';
            $checks['services']['database'] = 'failed: ' . $e->getMessage();
        }

        try {
            // Redis check
            Redis::ping();
            $checks['services']['redis'] = 'ok';
        } catch (\Throwable $e) {
            $checks['status'] = 'unhealthy';
            $checks['services']['redis'] = 'failed: ' . $e->getMessage();
        }

        try {
            // Cache check
            Cache::put('health_check', true, 10);
            $value = Cache::get('health_check');
            $checks['services']['cache'] = $value ? 'ok' : 'failed';
        } catch (\Throwable $e) {
            $checks['status'] = 'unhealthy';
            $checks['services']['cache'] = 'failed: ' . $e->getMessage();
        }

        $statusCode = $checks['status'] === 'healthy' ? 200 : 503;
        return response()->json($checks, $statusCode);
    }

    /**
     * Simple ping endpoint (no dependency checks).
     */
    public function ping()
    {
        return response()->json(['status' => 'ok', 'timestamp' => now()->toIso8601String()]);
    }
}
