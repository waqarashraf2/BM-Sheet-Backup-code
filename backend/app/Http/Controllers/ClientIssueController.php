<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\ClientIssue;

class ClientIssueController extends Controller
{
    public function store(Request $request)
    {
        $validated = $request->validate([
            'project_id' => 'required|exists:projects,id',
            'reason' => 'required|string|max:255',
            'comment_text' => 'nullable|string',
            'comment_entered_at' => 'nullable|date',
            'client_reply_text' => 'nullable|string',
            'client_replied_at' => 'nullable|date',
            'comment_to_reply_diff_minutes' => 'nullable|integer',
            'team_started_at' => 'nullable|date',
            'reply_to_start_diff_minutes' => 'nullable|integer',
            'team_finished_at' => 'nullable|date',
            'time_taken_to_finish_minutes' => 'nullable|integer',
        ]);

        $log = ClientIssue::updateOrCreate(
            ['project_id' => $validated['project_id']],
            $validated
        );

        return response()->json([
            'message' => 'Action logged successfully',
            'data' => $log
        ], 200);
    }

    public function show($projectId)
    {
        $log = ClientIssue::where('project_id', $projectId)->first();
        
        return response()->json([
            'data' => $log
        ]);
    }
}
