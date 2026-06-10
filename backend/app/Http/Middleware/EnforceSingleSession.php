<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class EnforceSingleSession
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        // Check if the user's current token matches the stored session token
        $currentToken = $request->bearerToken();
        if ($user->current_session_token && $currentToken) {
            $tokenHash = hash('sha256', explode('|', $currentToken)[1] ?? $currentToken);
            $storedHash = $user->current_session_token;

            // If tokens don't match, this session was invalidated
            if ($tokenHash !== $storedHash) {
                return response()->json([
                    'message' => 'Your session has been invalidated. You were logged out because your account was used elsewhere.',
                    'code' => 'SESSION_INVALIDATED',
                ], 401);
            }
        }

        // Activity timestamps are informational, so avoid two writes on every
        // authenticated API request. Query-builder updates also leave
        // users.updated_at unchanged, preventing polling hashes from changing
        // because of heartbeat traffic.
        $activityCutoff = now()->subMinute();
        if (!$user->last_activity || $user->last_activity->lt($activityCutoff)) {
            $activityTime = now();

            DB::table('user_sessions')
                ->where('user_id', $user->id)
                ->where(function ($query) use ($activityCutoff) {
                    $query->whereNull('last_activity')
                        ->orWhere('last_activity', '<', $activityCutoff);
                })
                ->update(['last_activity' => $activityTime]);

            DB::table('users')
                ->where('id', $user->id)
                ->where(function ($query) use ($activityCutoff) {
                    $query->whereNull('last_activity')
                        ->orWhere('last_activity', '<', $activityCutoff);
                })
                ->update(['last_activity' => $activityTime]);
        }

        return $next($request);
    }
}
