<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnforceProjectIsolation
{
    /**
     * Ensure users can only access resources within their assigned project(s).
     * CEO/Director bypass this (they have org-wide access).
     */
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated'], 401);
        }

        // CEO and Director have org-wide access
        if (in_array($user->role, ['ceo', 'director'])) {
            return $next($request);
        }

        // Check route parameters for project_id
        $projectId = $request->route('projectId')
            ?? $request->route('project')
            ?? $request->input('project_id');

        if ($projectId) {
            // Project Managers: scoped to their assigned projects (M2M pivot)
            if ($user->role === 'project_manager') {
                $allowedProjects = $user->getManagedProjectIds();
                if (!in_array((int)$projectId, $allowedProjects)) {
                    return response()->json([
                        'message' => 'Access denied: you do not have access to this project.',
                        'code' => 'PROJECT_ISOLATION_VIOLATION',
                    ], 403);
                }
            }
            // Operations managers: scoped to their assigned projects (M2M pivot)
            elseif ($user->role === 'operations_manager') {
                $allowedProjects = $user->getManagedProjectIds();

                if (!in_array((int)$projectId, $allowedProjects)) {
                    return response()->json([
                        'message' => 'Access denied: you do not have access to this project.',
                        'code' => 'PROJECT_ISOLATION_VIOLATION',
                    ], 403);
                }
            } else {
                // Production workers: must match their project_id exactly
                if ($user->project_id && (int)$projectId !== $user->project_id) {
                    return response()->json([
                        'message' => 'Access denied: you do not have access to this project.',
                        'code' => 'PROJECT_ISOLATION_VIOLATION',
                    ], 403);
                }
            }
        }

        return $next($request);
    }
}
