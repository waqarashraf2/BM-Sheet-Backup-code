<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use App\Models\UserSession;
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

        // Update last activity
        $session = UserSession::where('user_id', $user->id)->first();
        if ($session) {
            $session->update(['last_activity' => now()]);
        }
        $user->update(['last_activity' => now()]);

        return $next($request);
    }
}
