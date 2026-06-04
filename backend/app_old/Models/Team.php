<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * Team Model
 * 
 * Team Hierarchy:
 * - Each team has exactly 1 QA as the team lead (qa_user_id)
 * - Team members (checkers, drawers, designers) belong to the team via their team_id
 * - Floor Plan: QA → multiple Checkers → multiple Drawers
 * - Photos Enhancement: QA → multiple Designers
 * - Team size is flexible and scales per project volume
 */
class Team extends Model
{
    use HasFactory;

    protected $fillable = [
        'project_id',
        'qa_user_id',
        'name',
        'qa_count',
        'checker_count',
        'drawer_count',
        'designer_count',
        'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'qa_count' => 'integer',
        'checker_count' => 'integer',
        'drawer_count' => 'integer',
        'designer_count' => 'integer',
    ];

    /**
     * Get the project that owns the team.
     */
    public function project()
    {
        return $this->belongsTo(Project::class);
    }

    /**
     * Get the QA user who leads this team.
     */
    public function qaLead()
    {
        return $this->belongsTo(User::class, 'qa_user_id');
    }

    /**
     * Get all users in this team (excluding QA lead).
     */
    public function users()
    {
        return $this->hasMany(User::class);
    }

    /**
     * Get all team members including QA lead.
     */
    public function allMembers()
    {
        return User::where('team_id', $this->id)
            ->orWhere('id', $this->qa_user_id)
            ->get();
    }

    /**
     * Get checkers in this team (Floor Plan).
     */
    public function checkers()
    {
        return $this->hasMany(User::class)->where('role', 'checker');
    }

    /**
     * Get drawers in this team (Floor Plan).
     */
    public function drawers()
    {
        return $this->hasMany(User::class)->where('role', 'drawer');
    }

    /**
     * Get designers in this team (Photos Enhancement).
     */
    public function designers()
    {
        return $this->hasMany(User::class)->where('role', 'designer');
    }

    /**
     * Get all orders assigned to this team.
     */
    public function orders()
    {
        return $this->hasMany(Order::class);
    }

    /**
     * Scope a query to only include active teams.
     */
    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    /**
     * Get computed team member counts.
     */
    public function getMemberCountsAttribute(): array
    {
        $users = $this->users;
        return [
            'checkers' => $users->where('role', 'checker')->count(),
            'drawers' => $users->where('role', 'drawer')->count(),
            'designers' => $users->where('role', 'designer')->count(),
            'total' => $users->count() + ($this->qa_user_id ? 1 : 0),
        ];
    }
}
