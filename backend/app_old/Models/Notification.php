<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Notification extends Model
{
    protected $fillable = [
        'user_id',
        'type',
        'title',
        'message',
        'data',
        'read_at',
        'action_url',
    ];

    protected $casts = [
        'data' => 'array',
        'read_at' => 'datetime',
    ];

    // ── Scopes ──

    public function scopeUnread($query)
    {
        return $query->whereNull('read_at');
    }

    public function scopeForUser($query, int $userId)
    {
        return $query->where('user_id', $userId);
    }

    // ── Relationships ──

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    // ── Helpers ──

    /**
     * Create a notification for a specific user.
     */
    public static function send(int $userId, string $type, string $title, string $message, ?array $data = null, ?string $actionUrl = null): self
    {
        return self::create([
            'user_id' => $userId,
            'type' => $type,
            'title' => $title,
            'message' => $message,
            'data' => $data,
            'action_url' => $actionUrl,
        ]);
    }

    /**
     * Send a notification to multiple users.
     */
    public static function sendToMany(array $userIds, string $type, string $title, string $message, ?array $data = null, ?string $actionUrl = null): int
    {
        $count = 0;
        foreach ($userIds as $uid) {
            self::send($uid, $type, $title, $message, $data, $actionUrl);
            $count++;
        }
        return $count;
    }

    /**
     * Send to all users with a specific role.
     */
    public static function sendToRole(string $role, string $type, string $title, string $message, ?array $data = null, ?string $actionUrl = null): int
    {
        $userIds = User::where('role', $role)->where('is_active', true)->pluck('id')->toArray();
        return self::sendToMany($userIds, $type, $title, $message, $data, $actionUrl);
    }

    /**
     * Send to all managers for a specific project.
     */
    public static function sendToProjectManagers(int $projectId, string $type, string $title, string $message, ?array $data = null, ?string $actionUrl = null): int
    {
        $userIds = User::whereIn('role', ['ceo', 'director', 'operations_manager'])
            ->where('is_active', true)
            ->where(function ($q) use ($projectId) {
                $q->whereNull('project_id')
                  ->orWhere('project_id', $projectId);
            })
            ->pluck('id')
            ->toArray();
        return self::sendToMany($userIds, $type, $title, $message, $data, $actionUrl);
    }
}
