<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Notification;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    /**
     * GET /notifications
     * List notifications for the authenticated user.
     */
    public function index(Request $request)
    {
        $user = $request->user();

        $query = Notification::forUser($user->id)
            ->orderBy('created_at', 'desc');

        if ($request->has('unread_only') && $request->boolean('unread_only')) {
            $query->unread();
        }

        $notifications = $query->paginate($request->input('per_page', 20));

        return response()->json($notifications);
    }

    /**
     * GET /notifications/unread-count
     * Quick poll endpoint — returns just the count.
     */
    public function unreadCount(Request $request)
    {
        $count = Notification::forUser($request->user()->id)->unread()->count();

        return response()->json(['unread_count' => $count]);
    }

    /**
     * POST /notifications/{id}/read
     * Mark a single notification as read.
     */
    public function markRead(Request $request, int $id)
    {
        $notification = Notification::forUser($request->user()->id)->findOrFail($id);
        $notification->update(['read_at' => now()]);

        return response()->json(['message' => 'Marked as read.']);
    }

    /**
     * POST /notifications/read-all
     * Mark all notifications as read.
     */
    public function markAllRead(Request $request)
    {
        Notification::forUser($request->user()->id)
            ->unread()
            ->update(['read_at' => now()]);

        return response()->json(['message' => 'All notifications marked as read.']);
    }

    /**
     * DELETE /notifications/{id}
     * Delete a single notification.
     */
    public function destroy(Request $request, int $id)
    {
        $notification = Notification::forUser($request->user()->id)->findOrFail($id);
        $notification->delete();

        return response()->json(['message' => 'Notification deleted.']);
    }
}
