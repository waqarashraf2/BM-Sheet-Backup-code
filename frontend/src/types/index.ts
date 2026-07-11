// ═══════════════════════════════════════════
// WORKFLOW STATES (must match backend StateMachine)
// ═══════════════════════════════════════════

export const FP_STATES = [
  'RECEIVED', 'PENDING_QA_REVIEW', 'QUEUED_DRAW', 'IN_DRAW', 'SUBMITTED_DRAW',
  'QUEUED_CHECK', 'IN_CHECK', 'REJECTED_BY_CHECK', 'SUBMITTED_CHECK',
  'QUEUED_FILLER', 'IN_FILLER', 'SUBMITTED_FILLER',
  'QUEUED_QA', 'IN_QA', 'REJECTED_BY_QA', 'APPROVED_QA',
  'DELIVERED', 'ON_HOLD', 'CANCELLED',
] as const;

export const PH_STATES = [
  'RECEIVED', 'QUEUED_DESIGN', 'IN_DESIGN', 'SUBMITTED_DESIGN',
  'QUEUED_QA', 'IN_QA', 'REJECTED_BY_QA', 'APPROVED_QA',
  'DELIVERED', 'ON_HOLD', 'CANCELLED',
] as const;

export type WorkflowState = typeof FP_STATES[number] | typeof PH_STATES[number];
export type WorkflowType = 'FP_3_LAYER' | 'PH_2_LAYER';

export const INVOICE_STATUSES = ['draft', 'prepared', 'approved', 'issued', 'sent'] as const;
export type InvoiceStatus = typeof INVOICE_STATUSES[number];

export const REJECTION_CODES = ['quality', 'incomplete', 'wrong_specs', 'rework', 'formatting', 'missing_info'] as const;
export type RejectionCode = typeof REJECTION_CODES[number];

export const ROLES = ['ceo', 'director', 'operations_manager', 'project_manager', 'qa', 'checker', 'filler', 'drawer', 'designer', 'admin', 'accounts_manager', 'live_qa'] as const;
export type UserRole = typeof ROLES[number];

export const PRODUCTION_ROLES: UserRole[] = ['drawer', 'checker', 'filler', 'qa', 'designer'];
export const MANAGEMENT_ROLES: UserRole[] = ['ceo', 'director', 'operations_manager', 'project_manager', 'admin'];
export const QA_OVERSIGHT_ROLES: UserRole[] = ['live_qa', 'ceo', 'director'];





// ─────────────────────────────────────────
// Project Column Type (FULL)
// ─────────────────────────────────────────
export type ProjectColumn = {
  id?: number;
  project_id: number;

  // naming fix → support both backend + frontend
  name: string;        // DB column
  label?: string;      // UI fallback (optional)

  field: string;       // key used in data

  visible: boolean;    // show/hide
  sortable: boolean;   // sorting enable/disable

  width?: number;      // column width (optional)
  order: number;       // display order


};

// ─────────────────────────────────────────
// Responses
// ─────────────────────────────────────────
export type ProjectColumnsResponse = {
  success: boolean;
  data: ProjectColumn[];
};

export type SaveProjectColumnsInput = {
  project_id?: number; // optional for "all projects"

  columns: ProjectColumn[];
};

export type SaveProjectColumnsResponse = {
  success: boolean;
  message: string;
  data: ProjectColumn[];
};

// ═══════════════════════════════════════════
// CORE ENTITIES
// ═══════════════════════════════════════════

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  country: string;
  department: string;
  project_id: number | null;
  team_id: number | null;
  layer: string | null;
  is_active: boolean;
  is_absent: boolean;
  is_online: boolean;
  last_activity: string | null;
  inactive_days: number;
  wip_count: number;
  wip_limit: number;
  today_completed: number;
  daily_target: number;
  avg_completion_minutes: number;
  rejection_rate_30d: number;
  assignment_score: number;
  skills: string[] | null;
  shift_start: string | null;
  shift_end: string | null;
  project?: Project;
  team?: Team;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  token: string;
  warning?: string;
}

export interface SessionCheckResponse {
  valid: boolean;
  reason?: string;
}

export interface Project {
  id: number;
  code: string;
  name: string;
  country: string;
  department: string;
  client_name: string;
  status: string;
  workflow_type: WorkflowType;
  wip_cap: number;
  total_orders: number;
  completed_orders: number;
  pending_orders: number;
  total_teams: number;
  active_teams: number;
  total_staff: number;
  active_staff: number;
  workflow_layers: string[];
  sla_config: Record<string, unknown> | null;
  invoice_categories_config: Record<string, unknown>[] | null;
  client_portal_config: Record<string, unknown> | null;
  target_config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  description?: string;
  timezone?: string;
  queue_name?: string;
}

export interface ProjectInput {
  code: string;
  name: string;
  country: string;
  department: string;
  client_name?: string;
  status?: string;
  workflow_type?: WorkflowType;
  wip_cap?: number;
  workflow_layers?: string[];
  metadata?: Record<string, unknown>;
}

export interface Team {
  id: number;
  project_id: number;
  qa_user_id: number | null;
  name: string;
  qa_count: number;
  checker_count: number;
  drawer_count: number;
  designer_count: number;
  is_active: boolean;
  structure_config: Record<string, unknown> | null;
  auto_assignment_rules: Record<string, unknown> | null;
  // Relationships
  qa_lead?: User;
  project?: Project;
}

export interface Order {
  id: number;
  order_number: string;
  project_id: number;
  client_reference: string;
  client_portal_id?: string | null;
  current_layer: string;
  status: string;
  workflow_state: WorkflowState;
  workflow_type: WorkflowType;
  assigned_to: number | null;
  qa_supervisor_id: number | null;
  team_id: number | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  complexity_weight: number;
  estimated_minutes: number | null;
  order_type: string;
  received_at: string;
  started_at: string | null;
  completed_at: string | null;
  delivered_at: string | null;
  assigned_at?: string | null;
  due_date: string | null;
  due_in: string | null;
  metadata: Record<string, unknown> | null;
  recheck_count: number;
  attempt_draw: number;
  attempt_check: number;
  attempt_qa: number;
  is_on_hold: boolean;
  hold_reason: string | null;
  rejected_by: number | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  rejection_type: string | null;
  created_at: string;
  updated_at: string;
  project?: Project;
  team?: Team;
  assignedUser?: User;
  qaSupervisor?: User;
  work_items?: WorkItem[];
}

export interface WorkItem {
  id: number;
  order_id: number;
  project_id: number;
  stage: string;
  assigned_user_id: number | null;
  team_id: number | null;
  status: string;
  assigned_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  comments: string | null;
  rework_reason: string | null;
  rejection_code: string | null;
  attempt_number: number;
  assignedUser?: User;
}

// Batch Items 

export interface BatchItem {
  batch_no: number;
  received_time: string;
  plans: number;
  done: number;
  pending: number;
  fixing: number;
}

export interface BatchStatusResponse {
  success: boolean;
  data: BatchItem[];
}



export interface MonthLock {
  id: number;
  project_id: number;
  month: number;
  year: number;
  is_locked: boolean;
  locked_by: number | null;
  locked_at: string | null;
  unlocked_by: number | null;
  unlocked_at: string | null;
  frozen_counts: ProductionCounts | null;
  lockedByUser?: User;
  unlockedByUser?: User;
}

export interface ProductionCounts {
  received: number;
  delivered: number;
  pending: number;
  stage_completions: Record<string, number>;
  computed_at: string;
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  date: string | null;
  attn: string | null;
  client_name: string | null;
  client_phone_email: string | null;
  billing_period: string | null;
  invoice_items: InvoiceItem[] | null;
  project_id: number;
  month: string;
  year: string;
  service_counts: Record<string, number> | null;
  total_amount: number;
  status: InvoiceStatus;
  prepared_by: number | null;
  approved_by: number | null;
  approved_at: string | null;
  issued_by: number | null;
  issued_at: string | null;
  sent_at: string | null;
  locked_month_id: number | null;
  created_at: string;
  updated_at: string;
  project?: Project;
  preparedBy?: User;
  approvedBy?: User;
  issuedBy?: User;
}

export interface InvoiceInput {
  invoice_number?: string;
  project_id: number;
  month: string;
  year: string;
  date?: string;
  attn?: string;
  client_name?: string;
  client_phone_email?: string;
  billing_period?: string;
  invoice_items?: InvoiceItem[];
  service_counts?: Record<string, number>;
  total_amount?: number;
}

export interface InvoiceMonthlyQuantity {
  id: number;
  project_id: number;
  year: number;
  month: number;
  // System quantities (auto-computed from orders)
  system_qty_total: number | null;
  system_qty_delivered: number | null;
  system_qty_completed: number | null;
  system_qty_rework: number | null;
  system_qty_breakdown: Record<string, unknown> | null;
  system_computed_at: string | null;
  system_computed_by: number | null;
  // Manual quantities (entered by OM)
  manual_qty_total: number | null;
  manual_qty_breakdown: Record<string, number> | null;
  manual_notes: string | null;
  manual_created_by: number | null;
  manual_updated_by: number | null;
  manual_created_at: string | null;
  manual_updated_at: string | null;
  // Lock
  is_quantity_locked: boolean;
  quantity_locked_by: number | null;
  quantity_locked_at: string | null;
  // Resolved final qty used for invoicing
  final_qty: number | null;
  // Relations
  manualCreatedBy?: User;
  manualUpdatedBy?: User;
  quantityLockedBy?: User;
  systemComputedBy?: User;
  invoice?: { id: number; invoice_number: string; status: string } | null;
}

// ═══════════════════════════════════════════
// DASHBOARD TYPES
// ═══════════════════════════════════════════

export interface MasterDashboard {
  org_totals: OrgTotals;
  countries: CountryDashboard[];
  teams: TeamOutput[];
  rejections: RejectionMetrics;
  turnaround: TurnaroundMetrics;
  backlog_aging: BacklogAging;
  financial: FinancialMetrics;
  utilization: UtilizationMetrics;
  capacity_demand: CapacityDemand;
  trend_7d: TrendDay[];
  quality: QualityMetrics;
  top_performers: PerformerEntry[];
  bottom_performers: PerformerEntry[];
  country_comparison: CountryCompare[];
  alerts: DashboardAlert[];
}

export interface RejectionMetrics {
  active_rejections: number;
  rejected_today: number;
  rejected_week: number;
  rejected_month: number;
  rework_rate: number;
}

export interface TurnaroundMetrics {
  avg_hours: number;
  min_hours: number;
  max_hours: number;
  sample_size: number;
}

export interface BacklogAging {
  age_0_24h: number;
  age_1_3d: number;
  age_3_7d: number;
  age_7_plus: number;
}

export interface FinancialMetrics {
  revenue_approved: number;
  revenue_sent: number;
  revenue_pipeline: number;
  revenue_this_month: number;
  revenue_total: number;
  total_invoices: number;
  invoices_sent: number;
  invoices_pending: number;
}

export interface UtilizationMetrics {
  staff_with_wip: number;
  total_available: number;
  utilization_rate: number;
}

export interface CapacityDemand {
  daily_capacity: number;
  today_received: number;
  capacity_ratio: number;
}

export interface TrendDay {
  date: string;
  label: string;
  received: number;
  delivered: number;
  rejected: number;
}

export interface QualityMetrics {
  total_qa_reviews: number;
  qa_passed: number;
  qa_compliance_rate: number;
}

export interface PerformerEntry {
  id: number;
  name: string;
  role: string;
  completed: number;
  avg_minutes: number;
}

export interface CountryCompare {
  country: string;
  efficiency: number;
  staff_utilization: number;
  pending_per_staff: number;
}

export interface DashboardAlert {
  type: 'critical' | 'warning' | 'info';
  message: string;
}

export interface TeamOutput {
  id: number;
  name: string;
  project_code: string;
  project_name: string;
  country: string;
  department: string;
  staff_count: number;
  active_staff: number;
  received_today?: number;
  in_progress?: number;
  delivered_today: number;
  pending: number;
  efficiency: number;
}

export interface OrgTotals {
  total_projects: number;
  total_staff: number;
  active_staff: number;
  absentees: number;
  inactive_flagged: number; // Users inactive 15+ days per CEO requirements
  orders_received_today: number;
  orders_delivered_today: number;
  orders_received_week: number;
  orders_delivered_week: number;
  orders_received_month: number;
  orders_delivered_month: number;
  total_pending: number;
  // Overtime/Productivity Analysis per CEO requirements
  standard_shift_hours: number;
  staff_with_overtime: number;
  staff_under_target: number;
  target_hit_rate: number;
  staff_achieved_target: number;
  staff_with_targets: number;
  sla_breaches: number;
}

export interface CountryDashboard {
  country: string;
  project_count: number;
  total_staff: number;
  active_staff: number;
  absent_staff: number;
  received_today: number;
  delivered_today: number;
  total_pending: number;
  departments: DepartmentDashboard[];
}

export interface DepartmentDashboard {
  department: string;
  project_count: number;
  total_orders: number;
  delivered_today: number;
  pending: number;
  sla_breaches: number;
  projects: ProjectSummary[];
}

export interface ProjectSummary {
  id: number;
  code: string;
  name: string;
  workflow_type: WorkflowType;
  received_today?: number;
  in_progress?: number;
  pending: number;
  delivered_today: number;
}

export interface ProjectDashboard {
  project: Project;
  state_counts: Record<string, { count: number; oldest: string | null }>;
  staffing: Record<string, StageStaffing>;
  performance: Record<string, StagePerformance>;
  sla_breaches: number;
  on_hold: number;
  received_today: number;
  delivered_today: number;
}

export interface StageStaffing {
  role: string;
  total: number;
  active: number;
  absent: number;
  online: number;
  users?: User[];
}

export interface StagePerformance {
  today_completed: number;
  total_target: number;
  hit_rate: number;
}

export interface WorkerDashboardData {
  current_order: Order | null;
  today_completed: number;
  daily_target: number;
  target_progress: number;
  queue_count: number;
  wip_count: number;
}

export interface DashboardTeamMember {
  id: number;
  name: string;
  email: string;
  role: string;
  team_id?: number | null;
  is_active?: boolean;
  is_absent?: boolean;
  is_online?: boolean;
  assigned_work?: number;
  pending_work?: number;
  wip_count?: number;
  completed_today?: number;
  completed_week?: number;
  completed_month?: number;
}

export interface DashboardTeamRoleMember {
  id: number;
  name: string;
  total_done?: number;
  wip?: number;
}

export interface DashboardTeamPerformance {
  id: number;
  name: string;
  project_id?: number;
  project_code?: string;
  qa_lead?: string;
  staff_count?: number;
  active_staff?: number;
  absent_staff?: number;
  delivered_today?: number;
  pending?: number;
  today_completed?: number;
  efficiency?: number;
  is_active?: boolean;
  qa_count?: number;
  checker_count?: number;
  drawer_count?: number;
  designer_count?: number;
  raw_done?: number;
  check_done?: number;
  qa_done?: number;
  drawer_total_done?: number;
  checker_total_done?: number;
  qa_total_done?: number;
  total_done?: number;
  delivered?: number;
  drawer_names?: string;
  checker_names?: string;
  qa_names?: string;
  total_delivered_orders?: number;
  users?: DashboardTeamMember[];
  drawers?: DashboardTeamRoleMember[];
  checkers?: DashboardTeamRoleMember[];
  qas?: DashboardTeamRoleMember[];
}

export interface DashboardQaSummaryMember {
  id: number;
  name: string;
  email?: string;
  team_id?: number;
  done_count?: number;
  has_uploads?: boolean;
  is_active?: boolean;
  wip_count?: number;
}

export interface DashboardQaSummary {
  date_range?: {
    filter_type?: string;
    from?: string;
    to?: string;
  };
  total_qa_staff?: number;
  qa_with_uploads?: number;
  total_qa_done?: number;
  qa_members?: DashboardQaSummaryMember[];
}

export interface OpsDashboardData {
  projects: OpsProjectItem[];
  total_active_staff?: number;
  total_absent?: number;
  total_pending?: number;
  total_delivered_today?: number;
  role_stats?: Record<string, {
    total_staff: number;
    active: number;
    absent: number;
    today_completed: number;
    total_wip: number;
  }>;
  date_stats?: Array<{
    date: string;
    label: string;
    received: number;
    delivered: number;
    by_role: Record<string, number>;
  }>;
  absentees?: Array<{ id: number; name: string; role: string; project_name?: string }>;
  team_performance?: DashboardTeamPerformance[];
  workers?: Array<{
    id: number;
    name: string;
    email: string;
    role: string;
    project_id?: number | null;
    project_name?: string;
    team_id?: number | null;
    team_name?: string;
    is_active: boolean;
    is_absent: boolean;
    is_online: boolean;
    wip_count: number;
    today_completed: number;
    completed_week?: number;
    completed_month?: number;
    assigned_work?: number;
    pending_work?: number;
    daily_target?: number;
    avg_completion_minutes?: number;
    assignment_score: number;
    last_activity: string | null;
  }>;
  project_managers?: Array<{
    id: number;
    name: string;
    email: string;
    projects: Array<{ id: number; code: string; name: string }>;
  }>;
  qa_summary?: DashboardQaSummary;
}

export interface OpsProjectItem {
  project: Pick<Project, 'id' | 'code' | 'name' | 'country' | 'department' | 'workflow_type'>;
  pending: number;
  delivered_today: number;
  total_staff: number;
  active_staff: number;
  queue_health?: {
    stages: Record<string, number>;
    staffing: Array<{
      id: number;
      name: string;
      role: string;
      is_online: boolean;
      is_absent: boolean;
      wip_count: number;
      today_completed: number;
    }>;
  };
}

export interface TimeWiseCountProject {
  id: number;
  code: string;
  name: string;
  workflow_type: WorkflowType;
}

export interface TimeWiseCountSummary {
  role: 'drawer' | 'designer' | 'checker' | 'qa' | 'filler';
  done: number;
  wip: number;
  image_count?: number;
  workers: number;
}

export interface TimeWiseCountWorker {
  worker_id: number;
  worker_name: string;
  role: TimeWiseCountSummary['role'];
  done: number;
  wip: number;
  image_count?: number;
  projects: Array<{
    project_id: number;
    project_name: string;
    done: number;
    wip: number;
    image_count?: number;
  }>;
}

export type TimeWiseProductionRole = 'drawer' | 'designer' | 'checker' | 'qa' | 'filler';

export interface TimeWiseCountTeamStatus {
  project_id: number;
  project_name: string;
  team_id: number | null;
  team_name: string;
  is_online?: boolean;
  received: number;
  done: number;
  pending: number;
  delayed: number;
  drawers?: TimeWiseCountTeamMember[];
  designers?: TimeWiseCountTeamMember[];
  checkers?: TimeWiseCountTeamMember[];
  qas?: TimeWiseCountTeamMember[];
  fillers?: TimeWiseCountTeamMember[];
}

export interface TimeWiseCountTeamMember {
  id: number;
  name: string;
  role: TimeWiseProductionRole;
  is_online?: boolean;
  total_assigned: number;
  total_done: number;
  wip: number;
  selected_wip?: number;
}

export interface ProjectThreeHourlyDone {
  label: string;
  start_at: string;
  end_at: string;
  done_orders: number;
}

export interface ProjectThreePendingDate {
  date: string | null;
  day_label: string | null;
  total_orders?: number;
  pending_orders: number;
  done_orders?: number;
  delayed_orders: number;
}

export interface ProjectThreeOperationsReport {
  project_name?: string;
  generated_at?: string;
  hourly_done: ProjectThreeHourlyDone[];
  last_10_days_pending: ProjectThreePendingDate[];
  previous_pending_summary?: ProjectThreePendingDate;
}

export interface TimeWiseProjectStatus {
  project_id: number;
  project_code?: string;
  project_name: string;
  workflow_type?: WorkflowType;
  received_orders: number;
  pending_orders: number;
  delayed_pending_orders: number;
  done_orders: number;
  delayed_done_orders: number;
  untouched_orders: number;
  total_staff: number;
  present_staff: number;
  absent_staff: number;
  online_staff: number;
  team_summary?: {
    total_teams: number;
    online_teams: number;
    offline_teams: number;
    unassigned: number;
    unassigned_drawers?: number;
    unassigned_designers?: number;
    unassigned_checkers?: number;
    unassigned_qas?: number;
    unassigned_fillers?: number;
  };
  team_statuses: TimeWiseCountTeamStatus[];
  project_operations_report?: ProjectThreeOperationsReport;
  project_3_operations_report?: ProjectThreeOperationsReport;
}

export interface TimeWiseCountData {
  start_at: string;
  end_at: string;
  timezone: string;
  projects: TimeWiseCountProject[];
  summary: TimeWiseCountSummary[];
  workers: TimeWiseCountWorker[];
  project_statuses?: TimeWiseProjectStatus[];
  team_statuses?: TimeWiseCountTeamStatus[];
  totals: {
    done: number;
    wip: number;
    image_count?: number;
    received?: number;
    pending?: number;
    delayed?: number;
  };
}

export interface ClosingReportProjectRow {
  project_id: number;
  project_code: string;
  project_name: string;
  country: string;
  department: string;
  workflow_type: WorkflowType;
  total_orders: number;
  uploaded_orders: number;
  pending_orders: number;
  remarks: string;
  remarks_updated_at: string | null;
  remarks_updated_by: number | null;
}

export interface ClosingReportCountry {
  country: string;
  project_count: number;
  total_orders: number;
  uploaded_orders: number;
  pending_orders: number;
  projects: ClosingReportProjectRow[];
}

export interface ClosingReportData {
  date: string;
  timezone: string;
  countries: ClosingReportCountry[];
  totals: {
    project_count: number;
    total_orders: number;
    uploaded_orders: number;
    pending_orders: number;
  };
}

export interface QueueHealth {
  project_id: number;
  workflow_type: WorkflowType;
  state_counts: Record<string, { count: number; oldest: string | null }>;
  stages?: Record<string, { queued: number; in_progress: number }>;
  staffing?: Array<{ user_id: number; name: string; role: string; wip_count: number; is_absent: boolean; is_online: boolean }>;
  sla_breaches: number;
  total_pending: number;
  total_delivered: number;
}

// ═══════════════════════════════════════════
// PROJECT MANAGER DASHBOARD
// ═══════════════════════════════════════════

export interface PMDashboardData {
  projects: Array<{
    project: Pick<Project, 'id' | 'code' | 'name' | 'country' | 'department' | 'workflow_type'>;
    total_orders: number;
    pending: number;
    delivered_today: number;
    in_progress: number;
    total_staff: number;
    active_staff: number;
    queue_stages: Record<string, number>;
  }>;
  totals: {
    total_orders: number;
    pending: number;
    delivered_today: number;
    in_progress: number;
    received_today: number;
  };
  staff_report: Array<{
    id: number;
    name: string;
    email: string;
    role: string;
    project_id: number | null;
    project_name?: string;
    team_id?: number | null;
    team_name?: string;
    is_online: boolean;
    is_absent: boolean;
    assigned_work: number;
    completed_today: number;
    completed_week: number;
    completed_month: number;
    pending_work: number;
    wip_count: number;
    daily_target: number;
    avg_completion_minutes: number;
    assignment_score: number;
  }>;
  role_summary: Record<string, {
    total: number;
    online: number;
    absent: number;
    completed_today: number;
    completed_week: number;
    total_assigned: number;
  }>;
  order_queue: Array<{
    id: number;
    order_number: string;
    project_id: number;
    workflow_state: string;
    priority: string;
    received_at: string;
    client_reference: string | null;
  }>;
  team_performance: DashboardTeamPerformance[];
  department_roles: string[];
}

// ═══════════════════════════════════════════
// DAILY OPERATIONS (CEO View)
// ═══════════════════════════════════════════

export interface DailyOperationsWorker {
  id: number;
  name: string;
  completed: number;
  orders: string[];
  has_more?: boolean;
}

export interface DailyOperationsLayer {
  total: number;
  workers: DailyOperationsWorker[];
}

export interface DailyOperationsQAChecklist {
  total_orders: number;
  total_items: number;
  completed_items: number;
  mistake_count: number;
  compliance_rate: number;
}

export interface DailyOperationsProject {
  id: number;
  code: string;
  name: string;
  country: string;
  department: string;
  workflow_type: WorkflowType;
  received: number;
  delivered: number;
  pending: number;
  layers: Record<string, DailyOperationsLayer>;
  qa_checklist: DailyOperationsQAChecklist;
}

export interface DailyOperationsCountry {
  country: string;
  project_count: number;
  total_received: number;
  total_delivered: number;
  total_pending: number;
}

export interface DailyOperationsTotals {
  projects: number;
  received: number;
  delivered: number;
  pending: number;
  total_work_items: number;
}
interface DailyOperationsDay {
  date: string;
  view_mode: string;
  projects?: DailyOperationsProject[];
  by_country?: any[];
  totals?: any;
}
export interface DailyOperationsData {
  date: string;
  totals: DailyOperationsTotals;
  by_country: DailyOperationsCountry[];
  projects: DailyOperationsProject[];
  days?: DailyOperationsDay[];
}

// ═══════════════════════════════════════════
// ASSIGNMENT DASHBOARD (Supervisor/PM View)
// ═══════════════════════════════════════════

export interface AssignmentWorker {
  id: number;
  name: string;
  email: string;
  role: string;
  team_id: number | null;
  project_id: number | null;
  is_active: boolean;
  is_absent: boolean;
  is_online: boolean;
  wip_count: number;
  today_completed: number;
}

export interface Project51PortalAccount {
  id: number;
  client_user_id: number;
  resource_name: string;
  name: string;
  account_type: 'editor' | 'qc' | 'both' | string;
  pending_assigned_count: number;
}

export interface QueueProject {
  id: number;
  code: string;
  name: string;
  country: string;
  department: string;
  workflow_type: string;
}

export interface QueueInfo {
  queue_name: string;
  projects: QueueProject[];
  department: string;
  country: string;
  workflow_type: string;
}

export interface AssignmentOrder {
  id: number;
  order_number: string;
  it_datetime?: string | null;
  total_raw_files?: string | number | null;
  hdr_images_count?: number | null;
  single_images_count?: number | null;
  final_images_count?: number | null;
  edited_images_count?: number | null;
  flambient_order_count?: number | null;
  day_to_dusk_count?: number | null;
  object_removal_count?: number | null;
  project_50_total_raw_files?: number | string | null;
  project_50_total_outputs?: number | string | null;
  project_50_single_exposure_images?: number | string | null;
  project_50_jpeg_to_hdr?: number | string | null;
  project_50_raw_to_hdr_without_edit?: number | string | null;
  project_50_raw_to_hdr_with_base_edit?: number | string | null;
  project_50_dusk_images?: number | string | null;
  project_50_object_removal_jpeg_hdr_less_than_45?: number | string | null;
  project_50_object_removal_jpeg_hdr_more_than_45?: number | string | null;
  project_50_object_removal_jpeg_hdr_advance_declutter?: number | string | null;
  project_50_object_removal_raw_hdr_less_than_45?: number | string | null;
  project_50_object_removal_raw_hdr_more_than_45?: number | string | null;
  project_50_object_removal_raw_hdr_advance_declutter?: number | string | null;
  project_50_aerial_boundries_single_property?: number | string | null;
  project_50_aerial_adding_multiple_location_pins?: number | string | null;
  project_50_aerial_boundries_multiple_properties?: number | string | null;
  project_50_vf_images?: number | string | null;
  instruction?: string | null;
  instructions?: string | null;
  supervisor_notes?: string | null;
  metadata?: Record<string, unknown> | null;
  area?: string | number | null;
  date?: string | null;
  code: string;
  plan_type: string | null;
  project_id: number;
  client_reference: string | null;
  address: string | null;
  client_name: string | null;
  workflow_state: string;
  priority: string;
  assigned_to: number | null;
  drawer_id: number | null;
  drawer_name: string | null;
  checker_id: number | null;
  checker_name: string | null;
  file_uploader_id?: number | null;
  file_uploader_name?: string | null;
  qa_id: number | null;
  qa_name: string | null;
  dassign_time: string | null;
  cassign_time: string | null;
  drawer_done: string | null;
  checker_done: string | null;
  final_upload: string | null;
  drawer_date: string | null;
  checker_date: string | null;
  ausFinaldate: string | null;
  amend: string | null;
  recheck_count: number;
  is_on_hold: boolean;
  due_in: string | null;
  due_date: string | null;
  received_at: string | null;
  delivered_at: string | null;
  created_at: string | null;
  editor_portal_account_id?: number | null;
  qc_portal_account_id?: number | null;
  editor_login_name?: string | null;
  qc_account_name?: string | null;
  fixing_started_at?: string | null;
  fixing_completed_at?: string | null;
  fixing_time_seconds?: number | null;
}

export interface AssignmentDateStat {
  date: string;
  label: string;
  day_label: string;
  high: number;
  priority?: number;
  regular: number;
  total: number;
  drawer_done: number;
  checker_done: number;
  qa_done: number;
  amender_done: number;
  filler_done?: number;
  delivered: number;
}

export interface AssignmentRoleCompletion {
  total_staff: number;
  active: number;
  today_completed: number;
}

export interface AssignmentDashboardData {
  queue: QueueInfo;
  project: Pick<Project, 'id' | 'code' | 'name' | 'country' | 'department' | 'workflow_type'>;
  workers: Record<string, AssignmentWorker[]>;
  orders: PaginatedResponse<AssignmentOrder>;
  counts: {
    today_total: number;
    pending: number;
    pending_by_drawer: number;
    completed: number;
    amends: number;
    assigned: number;
    unassigned: number;
  };
  date_stats: AssignmentDateStat[];
  role_completions: Record<string, AssignmentRoleCompletion>;
  project_51_portal_accounts?: {
    editors: Project51PortalAccount[];
    qc_accounts: Project51PortalAccount[];
  };
}

// ═══════════════════════════════════════════
// FILTER / API TYPES
// ═══════════════════════════════════════════

export interface PaginatedResponse<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

export interface ApiResponse<T> {
  data?: T;
  message?: string;
  error?: string;
}

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

export interface ProjectFilters {
  country?: string;
  department?: string;
  status?: string;
  search?: string;
}

export interface UserFilters {
  role?: string;
  country?: string;
  project_id?: number;
  is_active?: boolean;
}

export interface OrderFilters {
  state?: WorkflowState;
  priority?: string;
  assigned_to?: number;
  team_id?: number;
}

// ═══════════════════════════════════════════
// IMPORT TYPES (preserved from existing)
// ═══════════════════════════════════════════

export interface OrderImportSource {
  id: number;
  project_id: number;
  type: 'csv' | 'api' | 'cron';
  name: string;
  api_endpoint?: string;
  cron_schedule?: string;
  last_sync_at?: string;
  orders_synced: number;
  is_active: boolean;
  field_mapping?: Record<string, string>;
}

export interface OrderImportLog {
  id: number;
  import_source_id: number;
  imported_by: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_rows: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  orders_imported?: number;
  orders_skipped?: number;
  errors?: Array<{ row: number; message: string; timestamp: string }>;
  file_path?: string;
  started_at?: string;
  completed_at?: string;
  created_at?: string;
}

export interface ChecklistItem {
  id: number;
  template_id: number;
  title: string;
  is_checked: boolean;
  is_required?: boolean;
  description?: string;
  mistake_count?: number;
  notes?: string;
  completed_at?: string;
  completed_by?: number;
}

export interface ChecklistTemplate {
  id: number;
  project_id: number;
  layer: string;
  title: string;
  description: string;
  sort_order: number;
  is_required: boolean;
  is_active: boolean;
}

export interface OrderChecklist {
  id: number;
  order_id: number;
  checklist_template_id: number;
  completed_by: number | null;
  is_checked: boolean;
  mistake_count: number;
  notes: string;
  completed_at: string | null;
}

// ═══════════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════════
export type NotificationType =
  | 'order_assigned'
  | 'work_submitted'
  | 'order_rejected'
  | 'order_returned'
  | 'order_received'
  | 'order_on_hold'
  | 'order_resumed'
  | 'order_delivered'
  | 'user_deactivated'
  | 'force_logout'
  | 'invoice_transition'
  | 'month_locked'
  | 'worker_inactive';

export interface Notification {
  id: number;
  user_id: number;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
}
