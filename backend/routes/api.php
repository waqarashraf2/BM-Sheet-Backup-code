<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\ProjectController;
use App\Http\Controllers\Api\UserController;
use App\Http\Controllers\Api\DashboardController;
use App\Http\Controllers\Api\TimeWiseCountController;
use App\Http\Controllers\Api\ManagerOrderAssetLinkController;
use App\Http\Controllers\Api\AssignmentController;
use App\Http\Controllers\Api\WorkflowController;
use App\Http\Controllers\Api\InvoiceController;
use App\Http\Controllers\Api\MonthLockController;
use App\Http\Controllers\Api\OrderImportController;
use App\Http\Controllers\Api\ChecklistController;
use App\Http\Controllers\Api\NotificationController;
use App\Http\Controllers\Api\Import\ProjectNinePublicImportController;
use App\Http\Controllers\Api\Import\BrPhotoPublicImportController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\SyncController;
use App\Http\Controllers\Api\LiveQAController;
use App\Http\Controllers\Api\ClientPortalUploadController;
use App\Http\Controllers\Api\OrderAssetZipDownloadController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

// ── Health Check (no auth required) ──
Route::get('/health', [HealthController::class, 'check']);
Route::get('/ping', [HealthController::class, 'ping']);
Route::get('/public-import/project-7/orders/template', [ProjectNinePublicImportController::class, 'template'])
    ->middleware('throttle:30,1');
Route::post('/public-import/project-7/orders', [ProjectNinePublicImportController::class, 'store'])
    ->middleware('throttle:30,1');
Route::get('/public-import/brphoto/orders/template', [BrPhotoPublicImportController::class, 'template'])
    ->middleware('throttle:30,1');
Route::post('/public-import/brphoto/orders', [BrPhotoPublicImportController::class, 'store'])
    ->middleware('throttle:30,1');


// ── Public: Auth ──
Route::post('/auth/login', [AuthController::class, 'login'])
    ->middleware('throttle:login');

// ── Authenticated routes ──
Route::middleware(['auth:sanctum', 'single.session', 'throttle:api'])->group(function () {

    // ── Auth ──
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::get('/auth/profile', [AuthController::class, 'profile']);
    Route::get('/auth/session-check', [AuthController::class, 'sessionCheck']);

    // ── Notifications (all authenticated users) ──
    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::get('/notifications/unread-count', [NotificationController::class, 'unreadCount']);
    Route::post('/notifications/{id}/read', [NotificationController::class, 'markRead']);
    Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead']);
    Route::delete('/notifications/{id}', [NotificationController::class, 'destroy']);

    // Dedicated QA client-portal upload routes. Kept outside /workflow so generic
    // workflow order routes cannot interfere with upload method matching.
    Route::prefix('client-portal')->group(function () {
        Route::get('/access', [ClientPortalUploadController::class, 'access']);
        Route::get('/in-progress', [ClientPortalUploadController::class, 'inProgress']);
        Route::get('/orders/{orderId}/status', [ClientPortalUploadController::class, 'status']);
        Route::post('/orders/{orderId}/asset-upload', [ClientPortalUploadController::class, 'upload']);
        Route::post('/orders/{orderId}/submit', [ClientPortalUploadController::class, 'submit']);
    });

    // ═══════════════════════════════════════════
    // PRODUCTION WORKER ROUTES
    // (drawer, checker, qa, designer)
    // ═══════════════════════════════════════════
    Route::prefix('workflow')->group(function () {
        // Smart Polling: Lightweight change detection (all authenticated users)
        Route::get('/check-updates', [WorkflowController::class, 'checkUpdates']);

        // Start Next (auto-assignment — NO manual picking)
        Route::post('/start-next', [WorkflowController::class, 'startNext']);

        // Current assigned order
        Route::get('/my-current', [WorkflowController::class, 'myCurrent']);

        // Separate link APIs by job_order_id (standalone, no my-current dependency)
        Route::get('/orders/links/{jobOrderId}/download-zip', OrderAssetZipDownloadController::class);
        Route::get('/orders/links/{jobOrderId}', [WorkflowController::class, 'orderAssetLinks']);

        // Backward-compatible alias
        Route::get('/orders/images/{jobOrderId}', [WorkflowController::class, 'orderImageLinks']);

        // QA-only client portal delivery for configured projects (22/23 by default).
        Route::get('/orders/{orderId}/client-portal/status', [ClientPortalUploadController::class, 'status']);
        Route::post('/orders/{orderId}/client-portal/asset-upload', [ClientPortalUploadController::class, 'upload']);
        Route::post('/orders/{orderId}/client-portal/upload-files', [ClientPortalUploadController::class, 'upload']);
        Route::post('/orders/{orderId}/client-portal/upload', [ClientPortalUploadController::class, 'upload']);
        Route::post('/orders/{orderId}/client-portal/submit', [ClientPortalUploadController::class, 'submit']);

        // My stats
     Route::get('/my-stats', [WorkflowController::class, 'myStats']);
        
        // My queue (drawer order list)
        Route::get('/my-queue', [WorkflowController::class, 'myQueue']);
        
        // My completed orders today
        Route::get('/my-completed', [WorkflowController::class, 'myCompleted']);
        
        // My order history (all time)
        Route::get('/my-history', [WorkflowController::class, 'myHistory']);
        
        // My performance stats
        Route::get('/my-performance', [WorkflowController::class, 'myPerformance']);

        // Submit completed work
        Route::post('/orders/{id}/submit', [WorkflowController::class, 'submitWork']);

        // Reject (checker/QA only)
        Route::post('/orders/{id}/reject', [WorkflowController::class, 'rejectOrder']);
                Route::post('/orders/{id}/cancel', [WorkflowController::class, 'cancelOrder']);


        // Hold/Resume
        Route::post('/orders/{id}/hold', [WorkflowController::class, 'holdOrder']);
        Route::post('/orders/{id}/resume', [WorkflowController::class, 'resumeOrder']);
        
        // Reassign to queue (worker releases order)
        Route::post('/orders/{id}/reassign-queue', [WorkflowController::class, 'reassignToQueue']);
        
        // Flag issue
        Route::post('/orders/{id}/flag-issue', [WorkflowController::class, 'flagIssue']);
        
        // Request help/clarification
        Route::post('/orders/{id}/request-help', [WorkflowController::class, 'requestHelp']);
        
        // Timer controls
        Route::post('/orders/{id}/timer/start', [WorkflowController::class, 'startTimer']);
        Route::post('/orders/{id}/timer/stop', [WorkflowController::class, 'stopTimer']);
        
        // Full order details (with notes, attachments, flags, help requests)
        Route::get('/orders/{id}/full-details', [WorkflowController::class, 'orderFullDetails']);

        // Order details (role-filtered)
        Route::get('/orders/{id}', [WorkflowController::class, 'orderDetails']);

        // Work item history for an order
        Route::get('/work-items/{orderId}', [WorkflowController::class, 'workItemHistory']);
        
        // QA Supervisor: Orders assigned to them for team distribution
        Route::get('/qa-orders', [WorkflowController::class, 'qaOrders']);
        Route::get('/qa-team-members', [WorkflowController::class, 'qaTeamMembers']);

        // Checker: Orders assigned to them + their team drawers
        Route::get('/checker-orders', [WorkflowController::class, 'checkerOrders']);
        Route::get('/checker-team-members', [WorkflowController::class, 'checkerTeamMembers']);
    });


        // Order checklists (accessible to production + management)
    Route::put('/orders/{id}/instruction', [WorkflowController::class, 'updateInstruction']);
    Route::get('/orders/{orderId}/checklist', [ChecklistController::class, 'orderChecklist']);
    Route::put('/orders/{orderId}/checklist/{templateId}', [ChecklistController::class, 'updateOrderChecklist']);
    Route::put('/orders/{orderId}/checklist', [ChecklistController::class, 'bulkUpdateOrderChecklist']);
    Route::get('/orders/{orderId}/checklist-status', [ChecklistController::class, 'checklistStatus']);

    // ── Dashboards (role-guarded) ──
    Route::middleware('role:ceo,director,accounts_manager')->group(function () {
        Route::get('/dashboard/master', [DashboardController::class, 'master']);
    });
    
        Route::middleware('auth:sanctum')->group(function () {
    Route::get('/dashboard/batch-status', [DashboardController::class, 'batchStatusReport']);
    Route::get('/dashboard/batch-statusv2', [DashboardController::class, 'batchStatusReportv2']);
   Route::get('/test-date-debug', [DashboardController::class, 'testDateDebug']);
   Route::get('/test-vet-date', [DashboardController::class, 'testVetDate']);
});


    
    Route::middleware('role:ceo,director,operations_manager,project_manager,drawer,checker,qa,live_qa')->group(function () {
        Route::middleware('throttle:10,1')->get('/dashboard/daily-operations', [DashboardController::class, 'dailyOperations']);
        
        
                // ── Assignment Routes ──
Route::prefix('assignments')->group(function () {

    // ✅ Fetch assignments data
    Route::get('/', [AssignmentController::class, 'getAssignments']);

    // ✅ Create assignment
    Route::post('/', [AssignmentController::class, 'createAssignment']);

    // ✅ Update assignment
    Route::put('/{projectId}/{id}', [AssignmentController::class, 'updateAssignment']);

    // ✅ Columns (IMPORTANT - match frontend)
    Route::get('/columns', [AssignmentController::class, 'getAllColumns']);
    Route::post('/columns/save', [AssignmentController::class, 'saveAllColumns']);
});
    });
    
    
    
    
    Route::middleware('role:ceo,director,operations_manager,project_manager')->get('/dashboard/project/{id}', [DashboardController::class, 'project']);
        Route::middleware('role:ceo,director,operations_manager')->get('/dashboard/project-stats', [DashboardController::class, 'projectStats']);
    Route::middleware('role:ceo,director,operations_manager')->get('/dashboard/operations', [DashboardController::class, 'operations']);
    Route::middleware('role:project_manager')->get('/dashboard/project-manager', [DashboardController::class, 'projectManager']);
    Route::middleware('role:operations_manager,project_manager')->get('/dashboard/time-wise-counts', [TimeWiseCountController::class, 'index']);
    Route::middleware('role:operations_manager,project_manager')->get('/dashboard/order-asset-links', [ManagerOrderAssetLinkController::class, 'index']);
    Route::middleware('role:ceo,director,operations_manager,project_manager,qa,live_qa')->get('/dashboard/queues', [DashboardController::class, 'queues']);
    Route::middleware('role:ceo,director,operations_manager,project_manager,qa,live_qa,checker')->get('/dashboard/assignment/{queueName}', [DashboardController::class, 'assignmentDashboard'])->where('queueName', '.*');
    Route::middleware('role:drawer,checker,filler,qa,designer')->get('/dashboard/worker', [DashboardController::class, 'worker']);
    Route::middleware('role:ceo,director,operations_manager,project_manager')->get('/dashboard/absentees', [DashboardController::class, 'absentees']);

    // ═══════════════════════════════════════════
    // ═══════════════════════════════════════════
    // SHARED WORKFLOW ROUTES (management + QA supervisor)
    // QA can view projects/orders and reassign drawers
    // ═══════════════════════════════════════════
    Route::middleware('role:ceo,director,operations_manager,project_manager,qa,live_qa')->group(function () {
        Route::get('/projects', [ProjectController::class, 'index']);
        Route::get('/projects/{id}', [ProjectController::class, 'show']);
        Route::get('/projects/{id}/statistics', [ProjectController::class, 'statistics']);
        Route::get('/projects/{id}/teams', [ProjectController::class, 'teams']);
        Route::post('/projects/{id}/teams', [ProjectController::class, 'createTeam']);
        Route::delete('/projects/{projectId}/teams/{teamId}', [ProjectController::class, 'deleteTeam']);
        Route::post('/workflow/orders/{id}/reassign', [WorkflowController::class, 'reassignOrder']);
        Route::post('/workflow/orders/bulk-assign-role', [WorkflowController::class, 'bulkAssignRole']);
        Route::post('/workflow/orders/{id}/assign-role', [WorkflowController::class, 'assignRole']);
        Route::get('/workflow/{projectId}/orders', [WorkflowController::class, 'projectOrders']);
        Route::get('/workflow/{projectId}/staffing', [WorkflowController::class, 'staffing']);
    });

    // Assign-to-drawer: management + QA supervisor + checker (controller enforces per-role guards)
    Route::middleware('role:ceo,director,operations_manager,project_manager,qa,live_qa,checker')->group(function () {
        Route::post('/workflow/orders/{id}/assign-to-drawer', [WorkflowController::class, 'assignToDrawer']);
    });

    // ═══════════════════════════════════════════
    // MANAGEMENT ROUTES (ops_manager, director, ceo)
    // ═══════════════════════════════════════════
    Route::middleware('role:ceo,director,operations_manager,project_manager')->group(function () {

        // Projects (write operations — CEO/Director only)
        // Moved to Director+ group below

        // Users
        Route::apiResource('users', UserController::class);
        Route::post('/users/{id}/deactivate', [UserController::class, 'deactivate']);
        Route::get('/users-inactive', [UserController::class, 'inactive']);
        Route::post('/users/reassign-work', [UserController::class, 'reassignWork']);

        // Force logout
        Route::post('/auth/force-logout/{userId}', [AuthController::class, 'forceLogout']);

        // Workflow management
        Route::post('/workflow/receive', [WorkflowController::class, 'receiveOrder']);
        Route::post('/workflow/orders/{id}/assign-to-qa', [WorkflowController::class, 'assignToQA']);
        Route::get('/workflow/{projectId}/queue-health', [WorkflowController::class, 'queueHealth']);

        // Month Lock
        Route::get('/month-locks/{projectId}', [MonthLockController::class, 'index']);
        Route::post('/month-locks/{projectId}/lock', [MonthLockController::class, 'lock']);
        Route::post('/month-locks/{projectId}/unlock', [MonthLockController::class, 'unlock']);
        Route::get('/month-locks/{projectId}/counts', [MonthLockController::class, 'counts']);
        Route::post('/month-locks/{projectId}/clear', [MonthLockController::class, 'clearPanel']);
        Route::post('/month-locks/{projectId}/update-counts', [MonthLockController::class, 'updateCounts']);

        // Order Import (PM can also import orders for their projects)
        Route::get('/projects/{projectId}/import-sources', [OrderImportController::class, 'sources']);
        Route::post('/projects/{projectId}/import-sources', [OrderImportController::class, 'createSource']);
        Route::put('/import-sources/{sourceId}', [OrderImportController::class, 'updateSource']);
        Route::post('/projects/{projectId}/import-csv', [OrderImportController::class, 'importCsv']);
        Route::post('/import-sources/{sourceId}/sync', [OrderImportController::class, 'syncFromApi']);
        Route::get('/projects/{projectId}/import-history', [OrderImportController::class, 'importHistory']);
        Route::get('/import-logs/{importLogId}', [OrderImportController::class, 'importDetails']);
        Route::post('/projects/{project}/import-csv-text', [OrderImportController::class, 'importCsvText']);
        Route::get('/projects/{projectId}/imported-orders', [OrderImportController::class, 'importedOrders']);
        Route::put('/projects/{projectId}/imported-orders/{orderId}', [OrderImportController::class, 'updateImportedOrder']);
        Route::delete('/projects/{projectId}/imported-orders/{orderId}', [OrderImportController::class, 'deleteImportedOrder']);
        Route::get('/projects/{projectId}/csv-headers', [OrderImportController::class, 'getProjectCsvHeaders']);
        Route::post('/projects/{projectId}/csv-headers', [OrderImportController::class, 'saveProjectCsvHeaders']);
        Route::put('/projects/{projectId}/csv-headers', [OrderImportController::class, 'saveProjectCsvHeaders']);
        Route::delete('/projects/{projectId}/csv-headers', [OrderImportController::class, 'deleteProjectCsvHeaders']);

        
        
        

        // Checklist templates
        Route::get('/projects/{projectId}/checklists', [ChecklistController::class, 'templates']);
        Route::post('/projects/{projectId}/checklists', [ChecklistController::class, 'createTemplate']);
        Route::put('/checklists/{templateId}', [ChecklistController::class, 'updateTemplate']);
        Route::delete('/checklists/{templateId}', [ChecklistController::class, 'deleteTemplate']);

        // Audit logs
        Route::get('/audit-logs', function (\Illuminate\Http\Request $request) {
            $query = \App\Models\ActivityLog::with('user:id,name,email,role')
                ->orderBy('created_at', 'desc');

            // OM & PM should NOT see CEO/Director activity logs
            $currentUser = $request->user();
            if (in_array($currentUser->role, ['operations_manager', 'project_manager'])) {
                $ceoDirectorIds = \App\Models\User::whereIn('role', ['ceo', 'director'])->pluck('id');
                if ($ceoDirectorIds->isNotEmpty()) {
                    $query->whereNotIn('user_id', $ceoDirectorIds);
                }
            }

            if ($request->has('action') && $request->action) {
                // Support comma-separated actions: ?action=PM_PROJECT_ASSIGNED,OM_PROJECT_ASSIGNED
                $actions = explode(',', $request->action);
                if (count($actions) > 1) {
                    $query->whereIn('action', $actions);
                } else {
                    $query->where('action', $request->action);
                }
            }
            if ($request->has('user_id') && $request->user_id) {
                $query->where('user_id', $request->user_id);
            }
            if ($request->has('entity_type') && $request->entity_type) {
                $query->where('model_type', $request->entity_type);
            }
            if ($request->has('project_id') && $request->project_id) {
                $query->where('project_id', $request->project_id);
            }
            // Date range filters
            if ($request->has('from') && $request->from) {
                $query->whereDate('created_at', '>=', $request->from);
            }
            if ($request->has('to') && $request->to) {
                $query->whereDate('created_at', '<=', $request->to);
            }
            // Search in action or old_values/new_values
            if ($request->has('search') && $request->search) {
                $search = $request->search;
                $query->where(function ($q) use ($search) {
                    $q->where('action', 'like', "%{$search}%")
                      ->orWhere('old_values', 'like', "%{$search}%")
                      ->orWhere('new_values', 'like', "%{$search}%");
                });
            }
            // Also load the target user (model_id when model_type=User)
            $logs = $query->paginate($request->per_page ?? 50);

            // Resolve target user names for User-type logs
            $userIds = collect($logs->items())
                ->filter(fn ($l) => $l->model_type === 'User' || $l->model_type === \App\Models\User::class)
                ->pluck('model_id')
                ->unique()
                ->filter()
                ->values();

            $targetUsers = $userIds->isNotEmpty()
                ? \App\Models\User::whereIn('id', $userIds)->pluck('name', 'id')
                : collect();

            // Append target_user_name to each log
            $logs->getCollection()->transform(function ($log) use ($targetUsers) {
                if (($log->model_type === 'User' || $log->model_type === \App\Models\User::class) && $log->model_id) {
                    $log->target_user_name = $targetUsers->get($log->model_id);
                }
                return $log;
            });

            return response()->json($logs);
        });
    });

    // ═══════════════════════════════════════════
    // DIRECTOR+ ROUTES (CEO/Director only)
    // Project CRUD + OM project assignment
    // ═══════════════════════════════════════════
    Route::middleware('role:ceo,director')->group(function () {
        // Projects CRUD (only Director+ can create/update/delete)
        Route::post('/projects', [ProjectController::class, 'store']);
        Route::put('/projects/{project}', [ProjectController::class, 'update']);
        Route::delete('/projects/{project}', [ProjectController::class, 'destroy']);

        // OM project assignments (Director assigns projects to OMs — OM can have multiple)
        Route::get('/operation-managers', function () {
            return response()->json(
                \App\Models\User::where('role', 'operations_manager')
                    ->where('is_active', true)
                    ->with('omProjects:id,code,name,country,department')
                    ->get(['id', 'name', 'email', 'role', 'country'])
            );
        });
        Route::post('/operation-managers/{userId}/assign-projects', function (\Illuminate\Http\Request $request, $userId) {
            $om = \App\Models\User::where('role', 'operations_manager')->findOrFail($userId);
            $requestedProjectIds = $request->input('project_ids', []);

            // Enforce: each project can only belong to ONE OM at a time
            if (!empty($requestedProjectIds)) {
                $conflicts = \DB::table('operation_manager_projects')
                    ->whereIn('project_id', $requestedProjectIds)
                    ->where('user_id', '!=', $om->id)
                    ->get(['project_id', 'user_id']);

                if ($conflicts->isNotEmpty()) {
                    $conflictNames = [];
                    $conflictUserIds = $conflicts->pluck('user_id')->unique();
                    $users = \App\Models\User::whereIn('id', $conflictUserIds)->pluck('name', 'id');
                    $projects = \App\Models\Project::whereIn('id', $conflicts->pluck('project_id'))->pluck('name', 'id');

                    foreach ($conflicts as $c) {
                        $conflictNames[] = ($projects[$c->project_id] ?? "Project #{$c->project_id}") . ' (assigned to ' . ($users[$c->user_id] ?? 'another OM') . ')';
                    }

                    return response()->json([
                        'message' => 'Some projects are already assigned to another Operation Manager: ' . implode(', ', $conflictNames),
                        'conflicts' => $conflicts->map(fn ($c) => ['project_id' => $c->project_id, 'assigned_to_user_id' => $c->user_id]),
                    ], 422);
                }
            }

            // Log the switch
            $oldProjectIds = $om->omProjects()->pluck('projects.id')->toArray();
            $om->omProjects()->sync($requestedProjectIds);
            \App\Services\AuditService::logOMProjectAssignment($om->id, $oldProjectIds, $requestedProjectIds);
            return response()->json([
                'message' => 'Projects assigned to Operation Manager',
                'projects' => $om->omProjects()->get(['projects.id', 'code', 'name', 'country'])
            ]);
        });
    });

    // ═══════════════════════════════════════════
    // PM PROJECT ASSIGNMENTS (OM only — only the OM assigns PMs to their projects)
    // ═══════════════════════════════════════════
    Route::middleware('role:operations_manager')->group(function () {
        Route::get('/project-managers', function (\Illuminate\Http\Request $request) {
            $user = $request->user();
            $query = \App\Models\User::where('role', 'project_manager')
                ->where('is_active', true)
                ->with('managedProjects:id,code,name');

            // OM: show PMs assigned to the OM's own projects + unassigned PMs
            if ($user->role === 'operations_manager') {
                $omProjectIds = $user->getManagedProjectIds();
                $query->where(function ($q) use ($omProjectIds) {
                    $q->whereHas('managedProjects', function ($sub) use ($omProjectIds) {
                        $sub->whereIn('projects.id', $omProjectIds);
                    })->orWhereDoesntHave('managedProjects'); // newly created PMs with no assignments
                });
            }

            return response()->json(
                $query->get(['id', 'name', 'email', 'role', 'country'])
            );
        });
        Route::post('/project-managers/{userId}/assign-projects', function (\Illuminate\Http\Request $request, $userId) {
            $user = $request->user();
            $pm = \App\Models\User::where('role', 'project_manager')->findOrFail($userId);
            $projectIds = $request->input('project_ids', []);
            // OM: verify they manage the target project
            if ($user->role === 'operations_manager' && !empty($projectIds)) {
                $omProjectIds = $user->getManagedProjectIds();
                foreach ($projectIds as $pid) {
                    if (!in_array((int) $pid, $omProjectIds)) {
                        return response()->json(['message' => 'You can only assign PMs to your own projects.'], 403);
                    }
                }
            }
            // Log the switch
            $oldProjectIds = $pm->managedProjects()->pluck('projects.id')->toArray();
            $pm->managedProjects()->sync($projectIds);
            \App\Services\AuditService::logPMProjectAssignment($pm->id, $oldProjectIds, $projectIds);
            return response()->json(['message' => 'Project assigned', 'projects' => $pm->managedProjects()->get(['projects.id', 'code', 'name'])]);
        });
    });

   // ═══════════════════════════════════════════
    // FINANCE ROUTES (CEO/Director + Accounts Manager read, CEO/Director write)
    // ═══════════════════════════════════════════
    Route::middleware('role:ceo,director,accounts_manager,operations_manager')->group(function () {
        Route::get('/invoices', [InvoiceController::class, 'index']);
        Route::get('/invoices/{id}', [InvoiceController::class, 'show']);
        Route::post('/invoices', [InvoiceController::class, 'store']);
        Route::put('/invoices/{id}', [InvoiceController::class, 'update']);
        Route::delete('/invoices/{id}', [InvoiceController::class, 'destroy']);

        // ── Monthly Quantity (read + compute + manual entry) ──
        // List all months for a project/year
        Route::get('/invoices/monthly-quantity/{projectId}/{year}', [InvoiceController::class, 'listMonthlyQuantities']);
        // Get (or auto-create) a single month record
        Route::get('/invoices/monthly-quantity/{projectId}/{year}/{month}', [InvoiceController::class, 'getMonthlyQuantity']);
        // Re-compute system quantities from orders
        Route::post('/invoices/monthly-quantity/{projectId}/{year}/{month}/compute', [InvoiceController::class, 'computeMonthlyQuantity']);
        // Create or overwrite manual quantities (upsert by project/month/year)
        Route::post('/invoices/monthly-quantity', [InvoiceController::class, 'storeManualQuantity']);
        // Patch an existing record's manual fields
        Route::put('/invoices/monthly-quantity/{id}', [InvoiceController::class, 'updateManualQuantity']);
    });

    
    Route::middleware('role:ceo,director')->group(function () {
        Route::post('/invoices/{id}/transition', [InvoiceController::class, 'transition']);

        // ── Monthly Quantity lock/unlock (CEO/Director only) ──
        Route::post('/invoices/monthly-quantity/{id}/lock',   [InvoiceController::class, 'lockMonthlyQuantity']);
        Route::post('/invoices/monthly-quantity/{id}/unlock', [InvoiceController::class, 'unlockMonthlyQuantity']);
    });
});




// ─── Live QA Routes ────────────────────────────────────────────────
Route::middleware('auth:sanctum')->prefix('live-qa')->group(function () {
    // Product checklists (shared item definitions)
    Route::get('/checklists', [LiveQAController::class, 'getChecklists']);
    Route::post('/checklists', [LiveQAController::class, 'createChecklist']);
    Route::put('/checklists/{id}', [LiveQAController::class, 'updateChecklist']);
    Route::delete('/checklists/{id}', [LiveQAController::class, 'deleteChecklist']);

    // Overview: unified view (matches old Metro layout)
    Route::get('/overview/{projectId}', [LiveQAController::class, 'getOverview']);

    // Orders ready for Live QA review (per-layer)
    Route::get('/orders/{projectId}', [LiveQAController::class, 'getOrders']);

    // Review checklist per order
    Route::get('/review/{projectId}/{orderNumber}/{layer}', [LiveQAController::class, 'getReview']);
    Route::post('/review/{projectId}/{orderNumber}/{layer}', [LiveQAController::class, 'submitReview']);

    // Mistake summary reports
    Route::get('/mistake-summary/{projectId}/{layer}', [LiveQAController::class, 'mistakeSummary']);

    // Stats
    Route::get('/stats/{projectId}', [LiveQAController::class, 'stats']);

    // ── Internal QA (checks delivered orders, any date, all-projects report) ──
    Route::get('/internal-qa/orders/{projectId}', [LiveQAController::class, 'getInternalQaOrders']);
    Route::get('/internal-qa/review/{projectId}/{orderNumber}', [LiveQAController::class, 'getInternalQaReview']);
    Route::post('/internal-qa/review/{projectId}/{orderNumber}', [LiveQAController::class, 'submitInternalQaReview']);
    Route::get('/internal-qa/mistake-summary/{projectId}', [LiveQAController::class, 'getInternalQaMistakeSummary']);
    Route::get('/internal-qa/all-projects-report', [LiveQAController::class, 'getInternalQaAllProjectsReport']);
});





// ─── Sync Routes (Old Metro System → New System) ───────────────────
// These routes use X-Sync-Token header for authentication (no user auth).
Route::prefix('sync')->group(function () {
    Route::post('/order', [SyncController::class, 'syncOrder']);
    Route::post('/batch', [SyncController::class, 'syncBatch']);
    Route::get('/status', [SyncController::class, 'status']);
});
