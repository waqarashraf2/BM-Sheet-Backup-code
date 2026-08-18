import axios from 'axios';
import api from './api';
import type {
  User, LoginCredentials, LoginResponse, SessionCheckResponse,
  Project, ProjectInput, Team,
  Order, WorkItem, MonthLock, Invoice, InvoiceInput, InvoiceMonthlyQuantity,
  MasterDashboard, ProjectDashboard, WorkerDashboardData, OpsDashboardData, QueueHealth,
  DailyOperationsData, PMDashboardData, AssignmentDashboardData, ClosingReportData,
  PaginatedResponse, Notification, UserDocument,
  OrderImportSource, OrderImportLog, ChecklistTemplate, OrderChecklist,
  WorkflowState, InvoiceStatus,
} from '../types';

export interface ClientPortalUploadStatus {
  required: boolean;
  can_upload?: boolean;
  uploaded: boolean;
  submitted: boolean;
  status: 'not_required' | 'not_uploaded' | 'uploading' | 'uploaded' | 'submitted' | 'failed' | 'submit_failed';
  client_portal_job_status?: string | null;
  client_portal_blocks_internal_submit?: boolean;
  order_id?: number;
  project_id?: number;
  job_order_id?: string | null;
  client_portal_id?: string | null;
  client_portal_job_id?: string | null;
  order_number?: string | null;
  VARIANT_no?: string | null;
  variant_no?: string | null;
  client_name?: string | null;
  CustomerParentCompany?: string | null;
  customer_parent_company?: string | null;
  client_reference?: string | null;
  file_names: string[];
  uploaded_at: string | null;
  submitted_at: string | null;
  upload_http_status?: number | null;
  upload_response?: string | null;
  submit_http_status?: number | null;
  submit_response?: string | null;
  failure_reason: string | null;
}

export interface ClientPortalInProgressOrder {
  order_id: number | null;
  project_id: number | null;
  order_number: string | null;
  client_reference: string | null;
  client_name: string | null;
  customer_parent_company: string | null;
  received_at: string | null;
  job_order_id: string | null;
  client_portal_job_id: string | null;
  workflow_state: string | null;
  internal_status: string | null;
  qa_id: number | null;
  qa_name: string | null;
  local_upload_status: string | null;
  uploaded_at: string | null;
  client_portal_job_status: string | null;
  client_portal_reason?: string | null;
  can_reupload?: boolean;
  client_portal_job?: Record<string, unknown> | null;
}

export interface ClientPortalProjectOption {
  id: number;
  label: string;
}

export interface ClientPortalDirectUploadUrlResponse {
  message: string;
  status: ClientPortalUploadStatus;
  upload_id: number;
  upload_url: string | null;
  headers?: Record<string, string>;
  direct_upload: boolean;
}

export interface ClientPortalApiResponseDetails {
  stage?: 'upload' | 'submit' | string | null;
  http_status: number | null;
  body: string | null;
  failure_reason: string | null;
}

// ═══════════════════════════════════════════
// AUTH SERVICE
// ═══════════════════════════════════════════
export const authService = {
  login: (credentials: LoginCredentials) =>
    api.post<LoginResponse>('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  profile: () => api.get<User>('/auth/profile'),
  sessionCheck: () => api.get<SessionCheckResponse>('/auth/session-check'),
  forceLogout: (userId: number) => api.post(`/auth/force-logout/${userId}`),
};

// Project 16 Batch Report
type Batch = {
  batch_no: string;
  received_time: string;
  remaining_time: string;
  plans: number;
  done: number;
  pending: number;
  fixing: number;
};

type BatchSummary = {
  total_batches: number;
  total_plans: number;
  total_done: number;
  total_pending: number;
  total_fixing: number;
};

type BatchStatusResponse = {
  success: boolean;
  data: Batch[];
  summary: BatchSummary;
};

export type CubiQaReportRow = {
  checker_name: string;
  total_plans: number;
  bw: number;
  bugs: number;
  mb: number;
  ok: number;
  mistakes_remarks: string;
};

export type CubiQaReportResponse = {
  success: boolean;
  project_id: number;
  selected_date: string;
  selected_date_display: string;
  start_time: string;
  end_time: string;
  rows: CubiQaReportRow[];
  totals: {
    total_plans: number;
    bw: number;
    bugs: number;
    mb: number;
    ok: number;
  };
  percentages: {
    total_plans: number;
    bw: number;
    bugs: number;
    mb: number;
    ok: number;
  };
  upload_summary: {
    date: string;
    total_plans: number;
    upload: number;
    pending: number;
  };
  qa_counts: Array<{ name: string; count: number }>;
};

// ═══════════════════════════════════════════
// WORKFLOW SERVICE (State Machine)
// ═══════════════════════════════════════════
export const workflowService = {
  // Worker: Start Next (auto-assignment — NO manual picking)
  startNext: () => api.post<{ order: Order; message: string }>('/workflow/start-next'),

  // Worker: Get current assigned order
  myCurrent: (options?: { includePaused?: boolean }) =>
    api.get<{ order: Order | null }>('/workflow/my-current', {
      params: options?.includePaused === false ? { include_paused: 0 } : undefined,
    }),

  // Worker: Get queue of orders assigned to worker
  getQueue: () => api.get<{ orders: Order[] }>('/workflow/my-queue'),

  // Worker: Get completed orders today
  getCompleted: () => api.get<{ orders: Order[] }>('/workflow/my-completed'),

  // Worker: Get order history (all time)
  getHistory: (page?: number) => api.get<{ data: Order[]; current_page: number; last_page: number }>('/workflow/my-history', { params: { page } }),

  // Worker: Get performance stats
  getPerformance: () => api.get<{
    today_completed: number;
    week_completed: number;
    month_completed: number;
    daily_target: number;
    weekly_target: number;
    weekly_rate: number;
    avg_time_minutes: number;
    daily_stats: Array<{ date: string; day: string; count: number }>;
  }>('/workflow/my-performance'),

  // Worker: Submit completed work
  submitWork: (orderId: number, comments?: string) =>
    api.post<{ order: Order; message: string }>(`/workflow/orders/${orderId}/submit`, { comments }),

  // Worker: My daily stats
  myStats: (options?: { includeQueueCount?: boolean }) =>
    api.get<{ today_completed: number; daily_target: number; wip_count: number; queue_count: number; is_absent: boolean }>('/workflow/my-stats', {
      params: options?.includeQueueCount === false ? { include_queue_count: 0 } : undefined,
    }),

  // Worker: Reassign order back to queue
  reassignToQueue: (orderId: number, reason?: string) =>
    api.post<{ order: Order; message: string }>(`/workflow/orders/${orderId}/reassign-queue`, { reason }),

  // Worker: Flag issue on order
  flagIssue: (orderId: number, flagType: string, description: string, severity?: string) =>
    api.post<{ flag: any; message: string }>(`/workflow/orders/${orderId}/flag-issue`, { flag_type: flagType, description, severity }),

  // Worker: Request help/clarification
  requestHelp: (orderId: number, question: string) =>
    api.post<{ help_request: any; message: string }>(`/workflow/orders/${orderId}/request-help`, { question }),

  // Worker: Timer controls
  startTimer: (orderId: number) =>
    api.post<{ work_item: WorkItem; message: string }>(`/workflow/orders/${orderId}/timer/start`),
  stopTimer: (orderId: number) =>
    api.post<{ work_item: WorkItem; time_added_seconds: number; total_time_seconds: number; message: string }>(`/workflow/orders/${orderId}/timer/stop`),

  // Worker: Full order details
  orderFullDetails: (orderId: number) =>
    api.get<{
      order: Order;
      supervisor_notes: string | null;
      attachments: Array<{ name: string; url: string; type: string }>;
      help_requests: any[];
      issue_flags: any[];
      current_time_seconds: number;
      timer_running: boolean;
      work_items?: WorkItem[];
    }>(`/workflow/orders/${orderId}/full-details`),

  // Checker/QA: Reject order (mandatory reason)
  rejectOrder: (orderId: number, reason: string, rejectionCode: string, routeTo?: string) =>
    api.post<{ order: Order }>(`/workflow/orders/${orderId}/reject`, { reason, rejection_code: rejectionCode, route_to: routeTo }),

  // Checker/QA: Cancel order (mandatory reason)
  cancelOrder: (orderId: number, reason: string, projectId?: number) =>
    api.post<{ order: Order; message?: string }>(`/workflow/orders/${orderId}/cancel`, { reason, ...(projectId ? { project_id: projectId } : {}) }),

  // Hold/Resume
  holdOrder: (orderId: number, holdReason: string) =>
    api.post<{ order: Order }>(`/workflow/orders/${orderId}/hold`, { hold_reason: holdReason }),
  resumeOrder: (orderId: number, projectId?: number) =>
    api.post<{ order: Order }>(`/workflow/orders/${orderId}/resume`, projectId ? { project_id: projectId } : {}),

  // Order details (role-filtered by backend)
  orderDetails: (orderId: number) =>
    api.get<{ order: Order }>(`/workflow/orders/${orderId}`),

  // Work item history
  workItemHistory: (orderId: number) =>
    api.get<{ work_items: WorkItem[] }>(`/workflow/work-items/${orderId}`),

  // Order assets/images by external job_order_id value (order_number or client order number)
  orderAssetLinks: (jobOrderId: string, projectId?: number) =>
    api.get<{
      job_order_id: string;
      requested_project_id: number | null;
      matched_project_ids: number[];
      include_external: boolean;
      portal_upload_status?: {
        required: boolean;
        checked: boolean;
        uploaded: boolean;
        failed: boolean;
        job_status: string | null;
        uploaded_count: number;
        message: string;
      } | null;
      count: number;
      links: Array<{
        source: string;
        source_table: string;
        project_id: number;
        job_order_id: string;
        id: number;
        name: string;
        url: string;
        link_type: string;
        meta: Record<string, unknown> | null;
      }>;
    }>(`/workflow/orders/links/${encodeURIComponent(jobOrderId)}`, {
      params: projectId ? { project_id: projectId } : undefined,
    }),

  orderAssetZip: (
    jobOrderId: string,
    options?: { projectId?: number; offset?: number; limit?: number; displayOrder?: string },
    onDownloadProgress?: (progress: number) => void,
  ) =>
    api.get<Blob>(`/workflow/orders/links/${encodeURIComponent(jobOrderId)}/download-zip`, {
      params: {
        ...(options?.projectId ? { project_id: options.projectId } : {}),
        ...(typeof options?.offset === 'number' ? { offset: options.offset } : {}),
        ...(typeof options?.limit === 'number' ? { limit: options.limit } : {}),
        ...(options?.displayOrder ? { display_order: options.displayOrder } : {}),
      },
      responseType: 'blob',
      onDownloadProgress: (event) => {
        if (!event.total) return;
        onDownloadProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      },
    }),

  // Backward-compatible alias for order assets endpoint
  orderImageLinks: (jobOrderId: string, projectId?: number) =>
    api.get<{
      job_order_id: string;
      requested_project_id: number | null;
      matched_project_ids: number[];
      include_external: boolean;
      portal_upload_status?: {
        required: boolean;
        checked: boolean;
        uploaded: boolean;
        failed: boolean;
        job_status: string | null;
        uploaded_count: number;
        message: string;
      } | null;
      count: number;
      links: Array<{
        source: string;
        source_table: string;
        project_id: number;
        job_order_id: string;
        id: number;
        name: string;
        url: string;
        link_type: string;
        meta: Record<string, unknown> | null;
      }>;
    }>(`/workflow/orders/images/${encodeURIComponent(jobOrderId)}`, {
      params: projectId ? { project_id: projectId } : undefined,
    }),

  // Optional helper: submit to client portal (separate from internal submitWork)
  submitOrderToClientPortal: (jobOrderId: string, orderId?: number) =>
    api.post<{
      message: string;
      job_order_id: string;
      response: unknown;
    }>(`/workflow/orders/${encodeURIComponent(jobOrderId)}/client-portal-submit`, orderId ? { order_id: orderId } : {}),

  getClientPortalUploadStatus: (orderId: number, projectId?: number) =>
    api.get<ClientPortalUploadStatus>(`/client-portal/orders/${orderId}/status`, {
      params: projectId ? { project_id: projectId } : undefined,
    }),

  getClientPortalInProgressOrders: (params?: { status?: 'InProgress' | 'Failed'; project_id?: number | null }) =>
    api.get<{
      orders: ClientPortalInProgressOrder[];
      meta: {
        allowed_project_ids: number[];
        project_options: ClientPortalProjectOption[];
        selected_project_id: number | null;
        status: 'InProgress' | 'Failed';
        client_portal_checked: boolean;
        client_portal_error: string | null;
      };
    }>('/client-portal/in-progress', { params }),

  getClientPortalAccess: () =>
    api.get<{ can_access_in_progress: boolean }>('/client-portal/access'),

  uploadToClientPortal: (
    orderId: number,
    files: File[],
    jobOrderId?: string,
    onUploadProgress?: (progress: number) => void,
    options?: { forceReupload?: boolean; projectId?: number },
  ) => {
    const payload = () => {
      const formData = new FormData();
      files.forEach(file => formData.append('files[]', file, file.name));
      if (jobOrderId) formData.append('job_order_id', jobOrderId);
      if (options?.forceReupload) formData.append('force_reupload', '1');
      if (options?.projectId) formData.append('project_id', String(options.projectId));
      return formData;
    };

    return api.post<{
      message: string;
      status: ClientPortalUploadStatus;
      upload_id: number;
      client_portal_response?: ClientPortalApiResponseDetails;
    }>(
      `/client-portal/orders/${orderId}/asset-upload`,
      payload(),
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          if (!event.total) return;
          onUploadProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
        },
      },
    );
  },

  prepareDirectClientPortalUpload: (
    orderId: number,
    file: File,
    jobOrderId?: string,
    options?: { forceReupload?: boolean; projectId?: number },
  ) =>
    api.post<ClientPortalDirectUploadUrlResponse>(
      `/client-portal/orders/${orderId}/direct-upload-url`,
      {
        file_name: file.name,
        file_size: file.size,
        ...(jobOrderId ? { job_order_id: jobOrderId } : {}),
        ...(options?.forceReupload ? { force_reupload: true } : {}),
        ...(options?.projectId ? { project_id: options.projectId } : {}),
      },
    ),

  uploadFileToClientPortalUrl: (
    uploadUrl: string,
    file: File,
    headers?: Record<string, string>,
    onUploadProgress?: (progress: number) => void,
  ) =>
    axios.put(uploadUrl, file, {
      headers: {
        ...(headers || {}),
      },
      onUploadProgress: (event) => {
        if (!event.total) return;
        onUploadProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      },
    }),

  confirmDirectClientPortalUpload: (
    orderId: number,
    uploadId: number,
    result?: { httpStatus?: number; response?: string; projectId?: number },
  ) =>
    api.post<{
      message: string;
      status: ClientPortalUploadStatus;
      upload_id: number;
      client_portal_response?: ClientPortalApiResponseDetails;
    }>(
      `/client-portal/orders/${orderId}/direct-upload-confirm`,
      {
        upload_id: uploadId,
        ...(result?.httpStatus ? { http_status: result.httpStatus } : {}),
        ...(result?.response ? { response: result.response.slice(0, 5000) } : {}),
        ...(result?.projectId ? { project_id: result.projectId } : {}),
      },
    ),

  submitClientPortalOrder: (orderId: number, projectId?: number) =>
    api.post<{
      message: string;
      status: ClientPortalUploadStatus;
      upload_id: number;
      client_portal_response?: ClientPortalApiResponseDetails;
    }>(
      `/client-portal/orders/${orderId}/submit`,
      projectId ? { project_id: projectId } : undefined,
    ),

  // Management: Receive new order
  receiveOrder: (data: { project_id: number; client_reference: string; priority?: string; due_date?: string; metadata?: Record<string, unknown> }) =>
    api.post<{ order: Order }>('/workflow/receive', data),

  // Management: Reassign order
  reassignOrder: (orderId: number, userId: number | null, reason: string, projectId?: number) =>
    api.post<{ order: Order }>(`/workflow/orders/${orderId}/reassign`, { user_id: userId, reason, ...(projectId ? { project_id: projectId } : {}) }),

  // PM: Assign order to QA supervisor
  assignToQA: (orderId: number, qaUserId: number, projectId?: number) =>
    api.post<{ order: Order; message: string }>(`/workflow/orders/${orderId}/assign-to-qa`, { qa_user_id: qaUserId, ...(projectId ? { project_id: projectId } : {}) }),

  // QA: Assign order to drawer in team
  assignToDrawer: (orderId: number, drawerUserId: number, projectId?: number, options?: { editor_portal_account_id?: number | null }) =>
    api.post<{ order: Order; message: string }>(`/workflow/orders/${orderId}/assign-to-drawer`, {
      drawer_user_id: drawerUserId,
      ...(projectId ? { project_id: projectId } : {}),
      ...(options?.editor_portal_account_id ? { editor_portal_account_id: options.editor_portal_account_id } : {}),
    }),

  // PM: Assign role (drawer/checker/qa) to an order
  assignRole: (orderId: number, role: string, userId: number, projectId?: number, options?: { editor_portal_account_id?: number | null; qc_portal_account_id?: number | null }) =>
    api.post<{ order: Order; message: string }>(`/workflow/orders/${orderId}/assign-role`, {
      role,
      user_id: userId,
      ...(projectId ? { project_id: projectId } : {}),
      ...(options?.editor_portal_account_id ? { editor_portal_account_id: options.editor_portal_account_id } : {}),
      ...(options?.qc_portal_account_id ? { qc_portal_account_id: options.qc_portal_account_id } : {}),
    }),

  bulkAssignRole: (role: 'drawer' | 'designer' | 'checker' | 'filler' | 'qa', userId: number, orders: Array<{ id: number; project_id: number }>) =>
    api.post<{
      message: string;
      assigned_count: number;
      skipped_count: number;
      assigned: Array<{ id: number; project_id: number; order_number?: string }>;
      skipped: Array<{ id: number; project_id: number; order_number?: string; reason: string }>;
    }>('/workflow/orders/bulk-assign-role', {
      role,
      user_id: userId,
      orders,
    }),

  // Supervisor: Update order instruction / plan type
  updateInstruction: (
    orderId: number,
    payload: {
      instruction?: string | null;
      plan_type?: string | null;
      code?: string | null;
      it_datetime?: string | null;
      received_at?: string | null;
      total_raw_files?: string | number | null;
      hdr_images_count?: number | null;
      single_images_count?: number | null;
      final_images_count?: number | null;
      edited_images_count?: number | null;
      flambient_order_count?: number | null;
      day_to_dusk_count?: number | null;
      object_removal_count?: number | null;
      editor_portal_account_id?: number | null;
      qc_portal_account_id?: number | null;
      project_id?: number;
    }
  ) =>
    api.put<{ order: Order; message?: string }>(`/orders/${orderId}/instruction`, payload),

  // QA: Get orders assigned to QA supervisor for team distribution
  qaOrders: () =>
    api.get<{ orders: Order[]; pending_assignment: number; in_progress: number }>('/workflow/qa-orders'),

  // QA: Get team members (drawers and checkers) for assignment
  qaTeamMembers: () =>
    api.get<{ drawers: User[]; checkers: User[]; total: number }>('/workflow/qa-team-members'),

  // Checker: Get orders assigned to current checker for drawer distribution
  checkerOrders: () =>
    api.get<{ orders: Order[]; in_draw: number; in_check: number }>('/workflow/checker-orders'),

  // Checker: Get drawers on the checker's team for assignment
  checkerTeamMembers: () =>
    api.get<{ drawers: User[]; total: number }>('/workflow/checker-team-members'),

  // Management: Queue health
  queueHealth: (projectId: number) =>
    api.get<QueueHealth>(`/workflow/${projectId}/queue-health`),

  // Management: Staffing
  staffing: (projectId: number) =>
    api.get<{ project_id: number; staffing: Record<string, { role: string; total: number; active: number; absent: number; users: User[] }> }>(`/workflow/${projectId}/staffing`),

  // Management: Project orders
  projectOrders: (projectId: number, filters?: { state?: WorkflowState; priority?: string }) =>
    api.get<PaginatedResponse<Order>>(`/workflow/${projectId}/orders`, { params: filters }),

  // Smart Polling: Lightweight change detection
  checkUpdates: (params: { project_ids?: number[]; scope?: 'orders' | 'users' | 'all'; last_hash?: string }) =>
    api.get<{ hash: string; changed: boolean; server_time: string }>('/workflow/check-updates', { params }),
};

// ═══════════════════════════════════════════
// DASHBOARD SERVICE
// ═══════════════════════════════════════════
export const dashboardService = {
  // CEO/Director: Master drilldown
  master: () => api.get<MasterDashboard>('/dashboard/master'),

  // Project-level dashboard
  project: (projectId: number) => api.get<ProjectDashboard>(`/dashboard/project/${projectId}`),

  // Ops Manager
  operations: () => api.get<OpsDashboardData>('/dashboard/operations'),

  // Project Manager
  projectManager: () => api.get<PMDashboardData>('/dashboard/project-manager'),

  closingReport: (params?: { date?: string; country?: string }) =>
    api.get<ClosingReportData>('/dashboard/closing-report', { params }),

  saveClosingReportRemark: (data: { date: string; country: string; project_id: number; remarks: string }) =>
    api.put<{ message: string }>('/dashboard/closing-report/remarks', data),

  // OM/PM: role completion counts within a date-time range and current WIP
  timeWiseCounts: (
    dashboard: 'operations' | 'project-manager',
    params: { start_at: string; end_at: string; project_id?: number; status_only?: boolean | 1 | 0 }
  ) =>
    api.get<import('../types').TimeWiseCountData>(`/dashboard/${dashboard}`, {
      params: { ...params, report: 'time-wise-counts' },
    }),

  orderAssetLinks: (params: { search?: string; project_id?: number }) =>
    api.get<{
      search: string;
      project_id: number | null;
      count: number;
      orders: Array<{
        project: {
          id: number;
          code: string;
          name: string;
          workflow_type: string;
        };
        order: {
          id: number;
          order_number: string;
          client_reference: string | null;
          client_name: string | null;
          client_portal_id: string | null;
          clint_order_number: string | null;
          client_order_number: string | null;
        };
        job_order_id: string;
        count: number;
        links: Array<{
          source: string;
          source_table: string | null;
          project_id: number;
          job_order_id: string;
          id: number | null;
          name: string;
          url: string;
          link_type: string;
          meta: Record<string, unknown> | null;
        }>;
      }>;
    }>('/dashboard/order-asset-links', { params }),

  // Worker personal
  worker: () => api.get<WorkerDashboardData>('/dashboard/worker'),

  // Absentees
  absentees: () => api.get<{ absentees: User[] }>('/dashboard/absentees'),

  // CEO: Daily Operations - All projects with layer-wise worker activity
  dailyOperations: (
    dateFrom?: string,
    dateTo?: string,
    viewMode?: string
  ) =>
    api.get<DailyOperationsData>('/dashboard/daily-operations', {
      params: {
        ...(dateFrom && !dateTo ? { date: dateFrom } : {}),
        ...(dateFrom && dateTo ? { date_from: dateFrom, date_to: dateTo } : {}),
        ...(viewMode ? { view_mode: viewMode } : {}),
      }
    }),




  batchStatus: (params?: { date?: string; project_id?: number }) =>
    api.get<BatchStatusResponse>('/dashboard/batch-status', { params }),

  cubiQaReport: (params?: { date?: string }) =>
    api.get<CubiQaReportResponse>('/dashboard/cubi-qa-report', { params }),

  // Queues list — returns distinct queue names with their projects
  queues: () => api.get<{ queues: import('../types').QueueInfo[] }>('/dashboard/queues'),

  // Assignment Dashboard — queue-based view combining orders from all projects in a queue
  assignmentDashboard: (queueName: string, params?: {
    status?: string; date?: string; search?: string; assigned_to?: number; page?: number; per_page?: number; start_date?: string; end_date?: string;
  }) => api.get<AssignmentDashboardData>(`/dashboard/assignment/${encodeURIComponent(queueName)}`, { params }),
  assignmentDashboardCsvExport: (queueName: string, params?: {
    status?: string; date?: string; search?: string; assigned_to?: number; start_date?: string; end_date?: string; month?: string; columns?: string;
  }) => api.get<Blob>(`/dashboard/assignment-export/${encodeURIComponent(queueName)}`, {
    params,
    responseType: 'blob',
  }),
};

// ═══════════════════════════════════════════
// MONTH LOCK SERVICE
// ═══════════════════════════════════════════
export const monthLockService = {
  list: (projectId: number) =>
    api.get<{ locks: MonthLock[] }>(`/month-locks/${projectId}`),

  lock: (projectId: number, month: number, year: number) =>
    api.post<{ lock: MonthLock }>(`/month-locks/${projectId}/lock`, { month, year }),

  unlock: (projectId: number, month: number, year: number) =>
    api.post<{ lock: MonthLock }>(`/month-locks/${projectId}/unlock`, { month, year }),

  counts: (projectId: number, month: number, year: number) =>
    api.get<{ counts: Record<string, unknown>; is_locked: boolean }>(`/month-locks/${projectId}/counts`, { params: { month, year } }),

  clearPanel: (projectId: number) =>
    api.post(`/month-locks/${projectId}/clear`),
};

// ═══════════════════════════════════════════
// INVOICE SERVICE (Draft → Prepared → Approved → Issued → Sent)
// ═══════════════════════════════════════════
export const invoiceService = {
  list: (filters?: { project_id?: number; status?: InvoiceStatus; month?: number; year?: number }) =>
    api.get<PaginatedResponse<Invoice>>('/invoices', { params: filters }),

  create: (data: InvoiceInput) =>
    api.post<{ invoice: Invoice }>('/invoices', data),

  update: (id: number, data: Partial<InvoiceInput>) =>
    api.put<{ invoice: Invoice }>(`/invoices/${id}`, data),

  show: (id: number) =>
    api.get<{ invoice: Invoice }>(`/invoices/${id}`),

  transition: (id: number, toStatus: InvoiceStatus) =>
    api.post<{ invoice: Invoice }>(`/invoices/${id}/transition`, { to_status: toStatus }),

  delete: (id: number) =>
    api.delete(`/invoices/${id}`),

  listMonthlyQuantities: (projectId: number, year: number) =>
    api.get<{ project_id: number; year: number; months: InvoiceMonthlyQuantity[] }>(`/invoices/monthly-quantity/${projectId}/${year}`),

  getMonthlyQuantity: (projectId: number, year: number, month: number) =>
    api.get<{ monthly_quantity: InvoiceMonthlyQuantity }>(`/invoices/monthly-quantity/${projectId}/${year}/${month}`),

  storeManualQuantity: (data: { project_id: number; month: number; year: number; manual_qty_total: number; manual_qty_breakdown?: Record<string, number>; manual_notes?: string }) =>
    api.post<{ monthly_quantity: InvoiceMonthlyQuantity; message: string }>('/invoices/monthly-quantity', data),

  updateManualQuantity: (id: number, data: { manual_qty_total?: number; manual_qty_breakdown?: Record<string, number>; manual_notes?: string }) =>
    api.put<{ monthly_quantity: InvoiceMonthlyQuantity; message: string }>(`/invoices/monthly-quantity/${id}`, data),

  computeMonthlyQuantity: (projectId: number, year: number, month: number) =>
    api.post<{ monthly_quantity: InvoiceMonthlyQuantity; message: string }>(`/invoices/monthly-quantity/${projectId}/${year}/${month}/compute`),
};

// ═══════════════════════════════════════════
// PROJECT SERVICE
// ═══════════════════════════════════════════
export const projectService = {
  list: (filters?: { country?: string; department?: string; status?: string }) =>
    api.get<PaginatedResponse<Project>>('/projects', { params: filters }),
  get: (id: number) => api.get<{ data: Project }>(`/projects/${id}`),
  create: (data: ProjectInput) => api.post<{ data: Project }>('/projects', data),
  update: (id: number, data: Partial<ProjectInput>) => api.put<{ data: Project }>(`/projects/${id}`, data),
  delete: (id: number) => api.delete(`/projects/${id}`),
  statistics: (id: number) => api.get(`/projects/${id}/statistics`),
  teams: (id: number) => api.get<{ data: Team[] }>(`/projects/${id}/teams`),
  createTeam: (projectId: number, name: string) => api.post<{ data: Team; message: string }>(`/projects/${projectId}/teams`, { name }),
  updateTeam: (projectId: number, teamId: number, data: { name: string }) => api.put<{ data: Team; message: string }>(`/projects/${projectId}/teams/${teamId}`, data),
  deleteTeam: (projectId: number, teamId: number) => api.delete(`/projects/${projectId}/teams/${teamId}`),
};

// ═══════════════════════════════════════════
// USER SERVICE
// ═══════════════════════════════════════════
export const userService = {
  list: (filters?: { role?: string; country?: string; department?: string; project_id?: number | string; team_id?: number | string; is_active?: boolean | number | string; search?: string; page?: number; per_page?: number }) =>
    api.get<PaginatedResponse<User>>('/users', { params: filters }),
  get: (id: number) => api.get<{ data: User }>(`/users/${id}`),
  create: (data: Partial<User> & { password: string; password_confirmation: string }) =>
    api.post<{ data: User }>('/users', data),
  update: (id: number, data: Partial<User>) =>
    api.put<{ data: User }>(`/users/${id}`, data),
  delete: (id: number) => api.delete(`/users/${id}`),
  deactivate: (id: number) => api.post(`/users/${id}/deactivate`),
  inactive: () => api.get<{ data: User[] }>('/users-inactive'),
  reassignWork: (userId: number) =>
    api.post('/users/reassign-work', { user_id: userId }),
};

export const hrService = {
  dashboard: (params?: { month?: string; project_id?: number | string }) =>
    api.get<{
      stats: { total: number; active: number; inactive: number; absent: number; present: number };
      employee_analytics: {
        summary: {
          total_employees: number;
          active_employees: number;
          new_joined: number;
          left_this_month: number;
          total_inactive: number;
          probation_due: number;
        };
        project_breakdown: Array<{
          project_name: string;
          total_employees: number;
          active_employees: number;
          new_joined: number;
          left_this_month: number;
          total_inactive: number;
        }>;
        probation_alerts: Array<{
          id: number;
          name: string;
          email?: string | null;
          role?: string | null;
          project_name?: string | null;
          machine_id?: string | null;
          joined_at?: string | null;
          days_completed?: number | null;
        }>;
      };
      document_stats: {
        active_total: number;
        complete_required: number;
        no_documents: number;
        missing: {
          copy_of_cnic: number;
          two_pics: number;
          nda: number;
          contract_letter: number;
        };
      };
      month: string;
      project_id?: number | null;
      project_options: Array<{ id: number; name: string; code?: string | null }>;
      documents_ready: boolean;
      machine_id_ready: boolean;
      monthly_progress: Array<{
        user_id: number;
        name?: string | null;
        email?: string | null;
        machine_id?: string | null;
        role?: string | null;
        completed: number;
        avg_minutes?: number | null;
      }>;
    }>('/hr/dashboard', { params }),
  users: (params?: { page?: number; per_page?: number; search?: string; role?: string; status?: string; month?: string; project_id?: number | string }) =>
    api.get<PaginatedResponse<User> & {
      documents_ready: boolean;
      machine_id_ready: boolean;
      project_options: Array<{ id: number; name: string; code?: string | null }>;
    }>('/hr/users', { params }),
  updateUser: (userId: number, data: Partial<User>) =>
    api.put<{ data: User; message: string }>(`/hr/users/${userId}`, data),
  userDetail: (userId: number, params?: { month?: string }) =>
    api.get<{
      user: User;
      documents: UserDocument[];
      salary_increments: import('../types').UserSalaryIncrement[];
      leave_balances: import('../types').UserLeaveBalance[];
      leave_entries: import('../types').UserLeaveEntry[];
      performance: {
        today_completed: number;
        month_completed: number;
        month_avg_minutes?: number | null;
        daily_progress: Array<{ date: string; completed: number; avg_minutes?: number | null }>;
        recent_work: Array<{ id: number; order_id: number; project_id: number; stage?: string | null; status: string; completed_at?: string | null; minutes?: number | null }>;
      };
      month: string;
      documents_ready: boolean;
      machine_id_ready: boolean;
      payroll_ready: boolean;
      leave_balance_ready: boolean;
      leave_entry_ready: boolean;
    }>(`/hr/users/${userId}`, { params }),
  addSalaryIncrement: (userId: number, data: { increment_amount: number; effective_date: string; notes?: string | null }) =>
    api.post<{ data: import('../types').UserSalaryIncrement; user: User; message: string }>(`/hr/users/${userId}/salary-increments`, data),
  updateLeaveBalance: (userId: number, data: { year: number; annual_allowed?: number; leaves_taken: number; notes?: string | null }) =>
    api.put<{ data: import('../types').UserLeaveBalance; message: string }>(`/hr/users/${userId}/leave-balance`, data),
  addLeaveEntry: (userId: number, data: { leave_date: string; leave_days?: number; reason: string }) =>
    api.post<{
      data: import('../types').UserLeaveEntry;
      leave_balances: import('../types').UserLeaveBalance[];
      leave_entries: import('../types').UserLeaveEntry[];
      message: string;
    }>(`/hr/users/${userId}/leave-entries`, data),
  documents: (userId: number) =>
    api.get<{ data: UserDocument[]; documents_ready: boolean }>(`/hr/users/${userId}/documents`),
  uploadDocument: (userId: number, data: FormData) =>
    api.post<{ data: UserDocument; message: string }>(`/hr/users/${userId}/documents`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  uploadDocuments: (userId: number, data: FormData) =>
    api.post<{ data: UserDocument[]; message: string }>(`/hr/users/${userId}/documents/bulk`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  downloadDocument: (documentId: number) =>
    api.get(`/hr/documents/${documentId}/download`, { responseType: 'blob' }),
  deleteDocument: (documentId: number) =>
    api.delete<{ message: string }>(`/hr/documents/${documentId}`),
  emailDocuments: (userId: number, data: { email: string; subject: string; message: string; document_ids: number[] }) =>
    api.post<{ message: string }>(`/hr/users/${userId}/documents/email`, data),
  deactivateLongAbsent: (data?: { days?: number; dry_run?: boolean }) =>
    api.post<{ message: string; affected: number; matched: number; preview: Array<Partial<User> & { inactive_days?: number }> }>('/hr/absent/deactivate', data || {}),
};

// ═══════════════════════════════════════════
// PROJECT MANAGER ASSIGNMENT SERVICE
// ═══════════════════════════════════════════
export const pmService = {
  list: () => api.get<any[]>('/project-managers'),
  assignProjects: (userId: number, projectIds: number[]) =>
    api.post(`/project-managers/${userId}/assign-projects`, { project_ids: projectIds }),
};

// ═══════════════════════════════════════════
// OPERATION MANAGER ASSIGNMENT SERVICE
// ═══════════════════════════════════════════
export const omService = {
  list: () => api.get<any[]>('/operation-managers'),
  assignProjects: (userId: number, projectIds: number[]) =>
    api.post(`/operation-managers/${userId}/assign-projects`, { project_ids: projectIds }),
};

// ═══════════════════════════════════════════
// IMPORT SERVICE
// ═══════════════════════════════════════════
export const orderImportService = {
  sources: (projectId: number) =>
    api.get<{ data: OrderImportSource[] }>(`/projects/${projectId}/import-sources`),
  createSource: (projectId: number, data: Partial<OrderImportSource>) =>
    api.post(`/projects/${projectId}/import-sources`, data),
  updateSource: (sourceId: number, data: Partial<OrderImportSource>) =>
    api.put(`/import-sources/${sourceId}`, data),
  importCsv: (projectId: number, formData: FormData) =>
    api.post(`/projects/${projectId}/import-csv`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  syncFromApi: (sourceId: number) =>
    api.post(`/import-sources/${sourceId}/sync`),
  importHistory: (projectId: number) =>
    api.get<{ data: OrderImportLog[] }>(`/projects/${projectId}/import-history`),
  importDetails: (logId: number) =>
    api.get<{ data: OrderImportLog }>(`/import-logs/${logId}`),
  getProjectCsvHeaders: (projectId: number) =>
    api.get<{ headers?: unknown; data?: { headers?: unknown } }>(`/projects/${projectId}/csv-headers`),
  saveProjectCsvHeaders: (projectId: number, headers: string[]) =>
    api.post<{ message?: string; headers?: unknown; data?: { headers?: unknown } }>(`/projects/${projectId}/csv-headers`, { headers }),
  updateProjectCsvHeaders: (projectId: number, headers: string[]) =>
    api.put<{ message?: string; headers?: unknown; data?: { headers?: unknown } }>(`/projects/${projectId}/csv-headers`, { headers }),
  deleteProjectCsvHeaders: (projectId: number) =>
    api.delete<{ message?: string }>(`/projects/${projectId}/csv-headers`),
  importCsvText: (projectId: number, data: { csv_text: string }) =>
    api.post(`/projects/${projectId}/import-csv-text`, data),
  importedOrders: (projectId: number, params?: { page?: number; per_page?: number; search?: string }) =>
    api.get<{
      success: boolean;
      project_id: number;
      data: Array<{
        order_id: number;
        order_number: string;
        address: string | null;
        client_name: string | null;
        import_source: string | null;
        import_log_id: number | null;
        created_at: string;
        updated_at: string;
      }>;
      pagination: {
        total: number;
        per_page: number;
        current_page: number;
        last_page: number;
      };
    }>(`/projects/${projectId}/imported-orders`, { params }),
  updateImportedOrder: (
    projectId: number,
    orderId: number,
    data: { order_number?: string; address?: string | null; client_name?: string | null }
  ) =>
    api.put(`/projects/${projectId}/imported-orders/${orderId}`, data),
  deleteImportedOrder: (projectId: number, orderId: number) =>
    api.delete(`/projects/${projectId}/imported-orders/${orderId}`),
};

// ═══════════════════════════════════════════
// CHECKLIST SERVICE
// ═══════════════════════════════════════════
export const checklistService = {
  templates: (projectId: number) =>
    api.get<{ data: ChecklistTemplate[] }>(`/projects/${projectId}/checklists`),
  createTemplate: (projectId: number, data: Partial<ChecklistTemplate>) =>
    api.post(`/projects/${projectId}/checklists`, data),
  updateTemplate: (templateId: number, data: Partial<ChecklistTemplate>) =>
    api.put(`/checklists/${templateId}`, data),
  deleteTemplate: (templateId: number) =>
    api.delete(`/checklists/${templateId}`),
  orderChecklist: (orderId: number) =>
    api.get<{ data: OrderChecklist[] }>(`/orders/${orderId}/checklist`),
  updateOrderChecklist: (orderId: number, templateId: number, data: Partial<OrderChecklist>) =>
    api.put(`/orders/${orderId}/checklist/${templateId}`, data),
  bulkUpdate: (orderId: number, items: Partial<OrderChecklist>[]) =>
    api.put(`/orders/${orderId}/checklist`, { items }),
  checklistStatus: (orderId: number) =>
    api.get(`/orders/${orderId}/checklist-status`),
};

// ═══════════════════════════════════════════
// NOTIFICATION SERVICE
// ═══════════════════════════════════════════
export const notificationService = {
  list: (page = 1, unreadOnly = false) =>
    api.get<PaginatedResponse<Notification>>('/notifications', { params: { page, unread_only: unreadOnly ? 1 : 0 } }),
  unreadCount: () =>
    api.get<{ unread_count: number }>('/notifications/unread-count'),
  markRead: (id: number) =>
    api.post(`/notifications/${id}/read`),
  markAllRead: () =>
    api.post('/notifications/read-all'),
  destroy: (id: number) =>
    api.delete(`/notifications/${id}`),
};

// ═══════════════════════════════════════════
// AUDIT LOG SERVICE (Transfer/Assignment Logs)
// ═══════════════════════════════════════════
export interface AuditLogEntry {
  id: number;
  user_id: number;
  action: string;
  model_type: string | null;
  model_id: number | null;
  project_id: number | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user?: { id: number; name: string; email: string; role: string };
}

export const auditLogService = {
  list: (params: { page?: number; action?: string; user_id?: number; project_id?: number } = {}) =>
    api.get<PaginatedResponse<AuditLogEntry>>('/audit-logs', { params }),
  transferLogs: (params: { page?: number; user_id?: number; project_id?: number } = {}) =>
    api.get<PaginatedResponse<AuditLogEntry>>('/audit-logs', {
      params: {
        ...params,
        action: 'PM_PROJECT_ASSIGNED,OM_PROJECT_ASSIGNED,RESOURCE_PROJECT_SWITCH,ORDER_REASSIGNED,QA_ASSIGNED',
      },
    }),
};

// ═══════════════════════════════════════════
// LIVE QA TYPES
// ═══════════════════════════════════════════

// Product checklist item (shared definition)
export interface ProductChecklistItem {
  id: number;
  title: string;
  client: string;
  product: string;
  check_list_type_id: number;
  is_active: boolean;
  sort_order: number;
}

// Checklist item during review (with review response data)
export interface ReviewChecklistItem {
  product_checklist_id: number;
  title: string;
  client: string;
  product: string;
  is_checked: boolean;
  count_value: number;
  text_value: string;
  review_id: number | null;
  created_by: string | null;
  updated_at: string | null;
}

// Order minimal info for review context
export interface ReviewOrderInfo {
  id: number;
  order_number: string;
  address: string;
  client_name?: string | null;
  drawer_name: string;
  checker_name: string;
  qa_name: string;
  drawer_done: string;
  checker_done: string;
  final_upload: string;
}

// Complete review data structure (matching backend response)
export interface ReviewData {
  order_number: string;
  layer: string;
  worker_name: string;
  order: ReviewOrderInfo | null;
  items: ReviewChecklistItem[];
  total_items: number;
  reviewed_items: number;
}

// Review submission payload
export interface ReviewSubmissionItem {
  product_checklist_id: number;
  is_checked: boolean;
  count_value: number;
  text_value: string;
}

export interface ReviewSubmissionPayload {
  items: ReviewSubmissionItem[];
}

// Stats response
export interface LiveQAStats {
  success?: boolean;
  layer?: string;
  date_from?: string | null;
  date_to?: string | null;
  from_datetime?: string | null;
  to_datetime?: string | null;
  total_reviews: number;
  total_mistakes: number;
  orders_reviewed: number;
  order_comments?: Array<Record<string, unknown>>;
  report_columns?: string[];
  report_rows?: Array<Record<string, unknown>>;
  worker_stats: Array<{
    worker: string;
    orders_checked: number;
    total_mistakes: number;
    comments?: unknown;
    text_values?: unknown;
    mistake_comments?: unknown;
    details?: unknown;
  }>;
  checklist_stats: Array<{
    title: string;
    total_mistakes: number;
    orders_affected: number;
    comments?: unknown;
    text_values?: unknown;
    mistake_comments?: unknown;
    details?: unknown;
  }>;
}

// Mistake summary worker
export interface MistakeSummaryWorker {
  name: string;
  client_name?: string | null;
  plan_count: number;
  items: Record<string, number>;
  mistake_total: number;
  comments?: unknown;
  text_values?: unknown;
  mistake_comments?: unknown;
  details?: unknown;
}

// Mistake summary team
export interface MistakeSummaryTeam {
  team_id: number;
  team_name: string;
  client_name?: string | null;
  workers: MistakeSummaryWorker[];
}

// Mistake summary response
export interface MistakeSummaryResponse {
  teams: MistakeSummaryTeam[];
  checklist_items?: string[];
  report_columns?: string[];
  report_rows?: Array<Record<string, unknown>>;
  order_comments?: Array<Record<string, unknown>>;
  summary?: {
    total_orders: number;
    total_mistakes: number;
  };
}

// Overview order (matches old Metro layout)
export interface LiveQAOverviewOrder {
  id: number;
  order_number: string;
  VARIANT_no?: string;
  address?: string;
  client_name?: string;
  priority?: string;
  due_in?: string;
  received_at?: string;
  drawer_name?: string;
  drawer_done?: string;
  drawer_date?: string;
  dassign_time?: string;
  d_live_qa: number;
  d_qa_reviewed: number;
  d_qa_total: number;
  d_qa_done: boolean;
  checker_name?: string;
  checker_done?: string;
  checker_date?: string;
  cassign_time?: string;
  c_live_qa: number;
  c_qa_reviewed: number;
  c_qa_total: number;
  c_qa_done: boolean;
  qa_name?: string;
  qa_done?: boolean;
  q_live_qa?: number | null;
  qa_live_qa?: number | null;
  final_upload?: string;
  amend?: number;
  status?: string;
  workflow_state?: string;
  created_at?: string;
}

// Overview response
export interface LiveQAOverviewResponse {
  data: LiveQAOverviewOrder[];
  counts: {
    today_total: number;
    pending: number;
    completed: number;
    amends: number;
    unassigned?: number;
  };
}

export interface LiveQAWorkerOrder {
  id: number;
  order_number: string;
  address?: string | null;
  drawer_name?: string | null;
  checker_name?: string | null;
  drawer_done?: string | null;
  checker_done?: string | null;
  final_upload?: string | null;
  d_live_qa?: number;
  c_live_qa?: number;
  qa_reviewed_items?: number;
  qa_total_items?: number;
  qa_review_complete?: boolean;
}

export interface LiveQAWorkerOrdersResponse {
  success?: boolean;
  data: LiveQAWorkerOrder[];
  pagination?: {
    total: number;
    per_page: number;
    current_page: number;
    last_page: number;
  };
  meta?: {
    total?: number;
    per_page?: number;
    current_page?: number;
    last_page?: number;
  };
}

// ═══════════════════════════════════════════
// LIVE QA SERVICE
// ═══════════════════════════════════════════
export const liveQAService = {
  // ─── Checklists (Product Definitions) ───────────────────────────────────
  // GET /live-qa/checklists - Fetch all checklists
  getChecklists: () =>
    api.get<{ data: ProductChecklistItem[] }>('/live-qa/checklists'),

  // POST /live-qa/checklists - Create new checklist
  createChecklist: (data: { title: string; check_list_type_id: number; client?: string; product?: string }) =>
    api.post<{ data: ProductChecklistItem; message: string }>('/live-qa/checklists', data),

  // PUT /live-qa/checklists/{id} - Update checklist
  updateChecklist: (id: number, data: Record<string, any>) =>
    api.put<{ data: ProductChecklistItem; message: string }>(`/live-qa/checklists/${id}`, data),

  // DELETE /live-qa/checklists/{id} - Delete checklist
  deleteChecklist: (id: number) =>
    api.delete<{ message: string }>(`/live-qa/checklists/${id}`),

  // ─── Overview & Orders ──────────────────────────────────────────────────
  // GET /live-qa/overview/{projectId} - Unified view matching old Metro layout
  getOverview: (projectId: number, params: Record<string, any> = {}) =>
    api.get<LiveQAOverviewResponse>(`/live-qa/overview/${projectId}`, { params }),

  // GET /live-qa/orders/{projectId} - Orders ready for Live QA per layer (legacy)
  getOrders: (projectId: number, params: Record<string, any> = {}) =>
    api.get<LiveQAWorkerOrdersResponse>(`/live-qa/orders/${projectId}`, { params }),

  // ─── Review Workflow ────────────────────────────────────────────────────
  // GET /live-qa/review/{projectId}/{orderNumber}/{layer} - Fetch review checklist
  // Returns pre-filled review items with comments (text_value) and mistake counts
  getReview: (projectId: number, orderNumber: string, layer: string) =>
    api.get<ReviewData | { data: ReviewData }>(
      `/live-qa/review/${projectId}/${encodeURIComponent(String(orderNumber))}/${encodeURIComponent(String(layer))}`
    ),

  // POST /live-qa/review/{projectId}/{orderNumber}/{layer} - Submit review
  // Includes: is_checked flags, count_value (mistake counts), text_value (comments)
  submitReview: (projectId: number, orderNumber: string, layer: string, data: ReviewSubmissionPayload) =>
    api.post<{ message: string; data?: ReviewData }>(
      `/live-qa/review/${projectId}/${encodeURIComponent(String(orderNumber))}/${encodeURIComponent(String(layer))}`,
      data
    ),

  // ─── Reports & Analytics ───────────────────────────────────────────────
  // GET /live-qa/stats/{projectId} - QA stats (optional layer filter)
  getStats: (projectId: number, layer?: string, params: Record<string, any> = {}) =>
    api.get<LiveQAStats>(`/live-qa/stats/${projectId}`, {
      params: {
        ...(layer ? { layer } : {}),
        ...params,
      },
    }),

  // GET /live-qa/mistake-summary/{projectId}/{layer} - Mistake summary by team/worker
  getMistakeSummary: (projectId: number, layer: string, params: Record<string, any> = {}) =>
    api.get<MistakeSummaryResponse>(`/live-qa/mistake-summary/${projectId}/${layer}`, { params }),

  // ─── Internal QA ─────────────────────────────────────────────────────────
  getInternalQaOrders: (projectId: number, params: Record<string, any> = {}) =>
    api.get<{ success: boolean; data: any[]; pagination: any }>(`/live-qa/internal-qa/orders/${projectId}`, { params }),

  getInternalQaReview: (projectId: number, orderNumber: string) =>
    api.get<any>(`/live-qa/internal-qa/review/${projectId}/${encodeURIComponent(String(orderNumber))}`),

  submitInternalQaReview: (projectId: number, orderNumber: string, data: ReviewSubmissionPayload) =>
    api.post<{ message: string }>(`/live-qa/internal-qa/review/${projectId}/${encodeURIComponent(String(orderNumber))}`, data),

  getInternalQaMistakeSummary: (projectId: number, params: Record<string, any> = {}) =>
    api.get<MistakeSummaryResponse>(`/live-qa/internal-qa/mistake-summary/${projectId}`, { params }),

  getInternalQaAllProjectsReport: (params: Record<string, any> = {}) =>
    api.get<any>(`/live-qa/internal-qa/all-projects-report`, { params }),
};



// ─────────────────────────────────────────
// Core Column Type (Aligned with Backend + UI)
// ─────────────────────────────────────────
export type ProjectColumn = {
  id?: number;
  project_id: number;

  // Backend + UI compatibility
  name: string;        // DB column name
  label?: string;      // optional UI label

  field: string;       // data key

  visible: boolean;
  sortable: boolean;

  width?: number;
  order: number;
};

// ─────────────────────────────────────────
// API Response Types
// ─────────────────────────────────────────
export type ProjectColumnsResponse = {
  success: boolean;
  data: ProjectColumn[];
};

export type SaveProjectColumnsPayload = {
  project_id?: number; // optional → supports "all"
  columns: ProjectColumn[];
};

export type SaveProjectColumnsResponse = {
  success: boolean;
  message: string;
  data: ProjectColumn[];
};

// ─────────────────────────────────────────
// Service
// ─────────────────────────────────────────
export const columnService = {

  getAllColumns: (projectId: number) =>
    api.get<ProjectColumnsResponse>(`/assignments/columns`, {
      params: { project_id: projectId },
    }),

  saveAllColumns: (columns: ProjectColumn[]) =>
    api.post<SaveProjectColumnsResponse>(`/assignments/columns/save`, {
      columns,
    }),

};
