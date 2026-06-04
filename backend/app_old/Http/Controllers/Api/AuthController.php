<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\UserSession;
use App\Services\AuditService;
use App\Services\NotificationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    /**
     * Login — enforces single active session.
     * If the user is already logged in elsewhere, the OLD session is invalidated
     * and this new login takes over (with a warning in the response).
     */
    public function login(Request $request)
    {
        $request->validate([
            'email' => 'required|email',
            'password' => 'required|string',
        ]);

        $user = User::where('email', $request->email)->first();

        if (!$user || !Hash::check($request->password, $user->password)) {
            if ($user) {
                AuditService::logLogin($user->id, false, 'invalid_password');
            }
            throw ValidationException::withMessages([
                'email' => ['The provided credentials are incorrect.'],
            ]);
        }

        if (!$user->is_active) {
            AuditService::logLogin($user->id, false, 'account_deactivated');
            throw ValidationException::withMessages([
                'email' => ['This account has been deactivated.'],
            ]);
        }

        $hadExistingSession = false;

        // Force-invalidate any existing sessions (single session enforcement)
        $existingSessions = UserSession::where('user_id', $user->id)->get();
        if ($existingSessions->count() > 0) {
            $hadExistingSession = true;
            UserSession::where('user_id', $user->id)->delete();
            $user->tokens()->delete(); // Revoke all old tokens
            AuditService::log($user->id, 'SESSION_FORCE_INVALIDATED', 'User', $user->id, null, null, [
                'reason' => 'new_login_from_different_device',
                'ip' => $request->ip(),
            ]);
        }

        // Create new token
        $token = $user->createToken('auth-token')->plainTextToken;

        // Store token hash for session validation
        $tokenParts = explode('|', $token);
        $tokenHash = hash('sha256', end($tokenParts));
        $user->update([
            'current_session_token' => $tokenHash,
            'last_activity' => now(),
            'inactive_days' => 0,
            'is_absent' => false,
        ]);

        // Create session record
        UserSession::create([
            'user_id' => $user->id,
            'session_id' => $tokenHash,
            'ip_address' => $request->ip(),
            'user_agent' => $request->userAgent(),
            'last_activity' => now(),
        ]);

        AuditService::logLogin($user->id, true);

        $response = [
            'user' => $user->fresh()->load(['project', 'team']),
            'token' => $token,
        ];

        if ($hadExistingSession) {
            $response['warning'] = 'You were logged in on another device. That session has been terminated.';
        }

        return response()->json($response);
    }

    /**
     * Logout — clears session + tokens + audit.
     */
    public function logout(Request $request)
    {
        $user = $request->user();

        UserSession::where('user_id', $user->id)->delete();
        $user->tokens()->delete();
        $user->update(['current_session_token' => null, 'wip_count' => 0]);

        // Reassign any in-progress work
        \App\Services\AssignmentEngine::reassignFromUser($user, $user->id);

        AuditService::logLogout($user->id);

        return response()->json(['message' => 'Logged out successfully']);
    }

    /**
     * Get authenticated user profile with project context.
     */
    public function profile(Request $request)
    {
        $user = $request->user()->load(['project', 'team']);
        return response()->json($user);
    }

    /**
     * Session heartbeat — validates session is still active.
     */
    public function sessionCheck(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['valid' => false], 401);
        }

        $session = UserSession::where('user_id', $user->id)->first();
        if (!$session) {
            return response()->json(['valid' => false, 'reason' => 'session_not_found'], 401);
        }

        $session->update(['last_activity' => now()]);
        $user->update(['last_activity' => now()]);

        return response()->json(['valid' => true]);
    }

    /**
     * Force logout a specific user (admin/ops action).
     */
    public function forceLogout(Request $request, int $userId)
    {
        $actor = $request->user();
        if (!in_array($actor->role, ['ceo', 'director', 'operations_manager', 'admin'])) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $target = User::findOrFail($userId);

        UserSession::where('user_id', $target->id)->delete();
        $target->tokens()->delete();
        $target->update(['current_session_token' => null]);

        // Reassign work
        $reassigned = \App\Services\AssignmentEngine::reassignFromUser($target, $actor->id);

        AuditService::log($actor->id, 'FORCE_LOGOUT', 'User', $target->id, null, null, [
            'reassigned_orders' => $reassigned,
        ]);

        NotificationService::forceLogout($target, $actor);

        return response()->json([
            'message' => "User forcibly logged out. {$reassigned} orders reassigned to queue.",
        ]);
    }
}
