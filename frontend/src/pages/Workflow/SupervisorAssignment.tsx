import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { columnService, dashboardService, projectService, workflowService } from '../../services';
import { useRef } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { RootState } from '../../store/store';
import { useSmartPolling } from '../../hooks/useSmartPolling';
import { useNewOrderHighlight } from '../../hooks/useNewOrderHighlight';
import type { AssignmentWorker, AssignmentOrder, AssignmentDateStat, AssignmentRoleCompletion, Project51PortalAccount, ProjectColumn, QueueInfo, Team } from '../../types';
import { AnimatedPage, Modal, Button, Textarea, useToast } from '../../components/ui';
import ChecklistModal from '../../components/ChecklistModal';
import {
  Users, RefreshCw, Info, Search, Clock, AlertTriangle,
  Loader2, X, BarChart3, PanelLeftClose, PanelLeftOpen,
  Pencil, CheckSquare, Eye, ShieldCheck, ChevronDown, ChevronUp, Play, Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ClockDisplay from '../../components/ClockDisplay';

const DEFAULT_PROJECT_TIMEZONE = 'Asia/Karachi';
const PROJECT_16_TIMEZONE = 'Asia/Ho_Chi_Minh';
const PROJECT_16_DUE_IN_TIMEZONE = 'Asia/Karachi';
const DIRECT_CHECKER_ASSIGNMENT_PROJECT_IDS = [3, 16, 42];
const TEAM_CHECKER_ASSIGNMENT_PROJECT_IDS = [3, 16];
const QA_WAIT_DURING_FILLER_PROJECT_IDS = [12];
const ORDER_ASSET_LINK_PROJECT_IDS = [1, 22, 25, 26];
const PROJECT_50_REPORT_COLUMNS = [
  { key: 'project_50_total_raw_files', label: 'Total RAW Files' },
  { key: 'project_50_total_outputs', label: 'Total Outputs' },
  { key: 'project_50_single_exposure_images', label: 'Single Exposure Images' },
  { key: 'project_50_jpeg_to_hdr', label: 'Jpeg to HDR' },
  { key: 'project_50_raw_to_hdr_without_edit', label: 'RAW to HDR Without Edit' },
  { key: 'project_50_raw_to_hdr_with_base_edit', label: 'RAW to HDR With Base Edit' },
  { key: 'project_50_dusk_images', label: 'Dusk Images' },
  { key: 'project_50_object_removal_jpeg_hdr_less_than_45', label: 'Object Removal (Jpeg - HDR) Less than 45 minutes' },
  { key: 'project_50_object_removal_jpeg_hdr_more_than_45', label: 'Object Removal (Jpeg - HDR) More than 45 minutes' },
  { key: 'project_50_object_removal_jpeg_hdr_advance_declutter', label: 'Object Removal (Jpeg - HDR) Advance Declutter' },
  { key: 'project_50_object_removal_raw_hdr_less_than_45', label: 'Object Removal (RAW - HDR) Less than 45 minutes' },
  { key: 'project_50_object_removal_raw_hdr_more_than_45', label: 'Object Removal (RAW - HDR) More than 45 minutes' },
  { key: 'project_50_object_removal_raw_hdr_advance_declutter', label: 'Object Removal (RAW - HDR) Advance Declutter' },
  { key: 'project_50_aerial_boundries_single_property', label: 'Aerial Shots Boundries Single Property' },
  { key: 'project_50_aerial_adding_multiple_location_pins', label: 'Aerial Shots Adding Multiple Location Pins' },
  { key: 'project_50_aerial_boundries_multiple_properties', label: 'Aerial Shots Boundries Multiple Properties' },
  { key: 'project_50_vf_images', label: 'VF Images' },
];
const isValidTimeZone = (timeZone?: string | null) => {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }

  try {
    Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
};

const resolveProjectTimezone = (
  nextProjectId?: number | null,
  nextTimezone?: string | null,
  nextCountry?: string | null,
) => {
  if (nextProjectId === 16) {
    return PROJECT_16_TIMEZONE;
  }

  if (isValidTimeZone(nextTimezone)) {
    return String(nextTimezone).trim();
  }

  if (typeof nextTimezone === 'string' && nextTimezone.trim() !== '') {
    console.warn(`Invalid project timezone "${nextTimezone}"${nextCountry ? ` for ${nextCountry}` : ''}. Falling back to ${DEFAULT_PROJECT_TIMEZONE}.`);
  }

  return DEFAULT_PROJECT_TIMEZONE;
};

export default function SupervisorAssignment() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);

  const getOrderInstructionValue = (order: Partial<AssignmentOrder> & Record<string, any>) =>
    order.instruction
    ?? order.instructions
    ?? order.comment
    ?? order.comments
    ?? order.supervisor_notes
    ?? (((order.metadata || {}) as Record<string, unknown>).instruction as string | null | undefined)
    ?? (((order.metadata || {}) as Record<string, unknown>).comment as string | null | undefined)
    ?? (((order.metadata || {}) as Record<string, unknown>).comments as string | null | undefined);

  type AssignmentTableColumn = {
    key: string;
    label: string;
    width?: string;
    headerClassName?: string;
    cellClassName?: string;
  };

  const getProjectDateValue = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());

    const year = parts.find((part) => part.type === 'year')?.value ?? '';
    const month = parts.find((part) => part.type === 'month')?.value ?? '';
    const day = parts.find((part) => part.type === 'day')?.value ?? '';

    return `${year}-${month}-${day}`;
  };

  type AssignmentRoleColumn = {
    key: 'drawer_name' | 'checker_name' | 'file_uploader_name' | 'qa_name';
    label: string;
    width?: string;
    role: 'drawer' | 'checker' | 'filler' | 'qa';
  };
  type BulkAssignmentRole = 'drawer' | 'designer' | 'checker' | 'filler' | 'qa';

  /* Project time clock */
  const [projectTz, setProjectTz] = useState(DEFAULT_PROJECT_TIMEZONE);

  /* Queues and selection */
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [selectedQueue, setSelectedQueue] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /* Data from assignment dashboard */
  const [workers, setWorkers] = useState<Record<string, AssignmentWorker[]>>({});
  const [orders, setOrders] = useState<AssignmentOrder[]>([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [counts, setCounts] = useState({ today_total: 0, pending: 0, pending_by_drawer: 0, completed: 0, amends: 0, assigned: 0, unassigned: 0, rejected: 0 });
  const [dateStats, setDateStats] = useState<AssignmentDateStat[]>([]);
  const [roleCompletions, setRoleCompletions] = useState<Record<string, AssignmentRoleCompletion>>({});
  const [project51PortalAccounts, setProject51PortalAccounts] = useState<{ editors: Project51PortalAccount[]; qc_accounts: Project51PortalAccount[] }>({ editors: [], qc_accounts: [] });
  const [queueInfo, setQueueInfo] = useState<QueueInfo | null>(null);
  const [projectLabel, setProjectLabel] = useState('');

  /* Filters */
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedWorker, setSelectedWorker] = useState<number | null>(null);
  const [workerRoleFilter, setWorkerRoleFilter] = useState<string | null>(null);
  const [globalRoleSort, setGlobalRoleSort] = useState<'drawer' | 'checker' | 'filler' | 'qa' | null>(null);
  const [exportMonth, setExportMonth] = useState(new Date().toISOString().slice(0, 7));
  const [exportingType, setExportingType] = useState<'csv' | 'pdf' | null>(null);

  /* UI toggles */
  const [statsOpen, setStatsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workerSearch, setWorkerSearch] = useState('');

  /* Modals */
  const [showReassign, setShowReassign] = useState<AssignmentOrder | null>(null);
  const [reassignReason, setReassignReason] = useState('');
  const [reassigning, setReassigning] = useState(false);
  const [recentlyReassignedOrderIds, setRecentlyReassignedOrderIds] = useState<Set<number>>(new Set());
  const [showChecklist, setShowChecklist] = useState<AssignmentOrder | null>(null);
  const [showCancelOrder, setShowCancelOrder] = useState<AssignmentOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [showInstructionEditor, setShowInstructionEditor] = useState<AssignmentOrder | null>(null);
  const [showItDateTimeEditor, setShowItDateTimeEditor] = useState<AssignmentOrder | null>(null);
  const [instructionDraft, setInstructionDraft] = useState('');
  const [itDateTimeDraft, setItDateTimeDraft] = useState('');
  const [receivedAtDraft, setReceivedAtDraft] = useState('');
  const [totalRawFilesDraft, setTotalRawFilesDraft] = useState('');
  const [hdrImagesCountDraft, setHdrImagesCountDraft] = useState('');
  const [singleImagesCountDraft, setSingleImagesCountDraft] = useState('');
  const [finalImagesCountDraft, setFinalImagesCountDraft] = useState('');
  const [editedImagesCountDraft, setEditedImagesCountDraft] = useState('');
  const [vfCountDraft, setVfCountDraft] = useState('');
  const [flambientOrderCountDraft, setFlambientOrderCountDraft] = useState('');
  const [dayToDuskCountDraft, setDayToDuskCountDraft] = useState('');
  const [objectRemovalCountDraft, setObjectRemovalCountDraft] = useState('');
  const [planTypeDraft, setPlanTypeDraft] = useState('');
  const [codeDraft, setCodeDraft] = useState('');
  const [updatingInstructionId, setUpdatingInstructionId] = useState<number | null>(null);
  const [updatingItDateTimeId, setUpdatingItDateTimeId] = useState<number | null>(null);
  const [updatingPortalAccountCell, setUpdatingPortalAccountCell] = useState<string | null>(null);
  const [portalAccountMenu, setPortalAccountMenu] = useState<{
    order: AssignmentOrder;
    accountType: 'editor' | 'qc';
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [projectColumns, setProjectColumns] = useState<ProjectColumn[]>([]);
  const [projectTeams, setProjectTeams] = useState<Team[]>([]);
  const [contextMenu, setContextMenu] = useState<{ order: AssignmentOrder; x: number; y: number } | null>(null);
  const [cancellingOrderId, setCancellingOrderId] = useState<number | null>(null);
  const activeDashboardRequestKeyRef = useRef<string | null>(null);
  const latestDashboardRequestIdRef = useRef(0);
  const dashboardFilterKeyRef = useRef<string | null>(null);

  const isProject16 = projectId === 16;
  const isProject50 = projectId === 50;
  const showTeamNameColumn = projectId != null;
  const allowDirectCheckerAssignment = projectId != null && DIRECT_CHECKER_ASSIGNMENT_PROJECT_IDS.includes(projectId);
  const selectedQueueInfo = useMemo(
    () => queues.find((queue) => queue.queue_name === selectedQueue) || null,
    [queues, selectedQueue]
  );
  const effectiveProjectId = projectId ?? selectedQueueInfo?.projects?.[0]?.id ?? null;
  const shouldUseAssignmentPagination = true; // All queues now use real SQL pagination
  const showClientSummaryCard = projectId === 9 || projectId === 46;
  const showCodeQueues = useMemo(() => ['Canada'], []);
  const hasDrawerAssignment = useCallback((order: AssignmentOrder) => {
    const drawerName = typeof order.drawer_name === 'string' ? order.drawer_name.trim() : '';
    const drawerId = (order as any).drawer_id;

    return drawerName !== '' && drawerId != null && drawerId !== '';
  }, []);
  const isPendingOrder = useCallback((order: AssignmentOrder) => {
    const workflowState = (order.workflow_state || '').toUpperCase();

    return workflowState !== ''
      && !workflowState.includes('COMPLETE')
      && !workflowState.includes('DELIVER')
      && !workflowState.includes('CANCEL')
      && !workflowState.includes('PENDING_BY_DRAWER')
      && !workflowState.includes('REJECTED');
  }, []);
  const canOpenOrderAssetLinks = useCallback((order: AssignmentOrder) => {
    return ORDER_ASSET_LINK_PROJECT_IDS.includes(Number(order.project_id)) && !!String(order.order_number || '').trim();
  }, []);
  const openCompletedAssetLinks = useCallback((order: AssignmentOrder) => {
    const jobOrderId = String(order.order_number || '').trim();
    if (!jobOrderId) return;

    const params = new URLSearchParams({
      projectId: String(order.project_id),
      displayOrder: jobOrderId,
      orderNumber: jobOrderId,
    });
    if (order.client_name) params.set('clientName', order.client_name);
    if (order.client_reference) params.set('clientReference', order.client_reference);

    navigate(`/order-assets/${encodeURIComponent(jobOrderId)}?${params.toString()}`);
  }, [navigate]);

  const displayedOrders = useMemo(() => {
    if (statusFilter === 'cancelled') {
      return orders.filter((o) => (o.workflow_state || '').toUpperCase().includes('CANCEL'));
    }

    if (statusFilter === 'pending') {
      return orders.filter(isPendingOrder);
    }

    if (statusFilter === 'unassigned') {
      return orders.filter((o) => !hasDrawerAssignment(o));
    }

    return orders;
  }, [hasDrawerAssignment, isPendingOrder, orders, statusFilter]);

  /* Highlight newly arrived orders */
  const highlightedIds = useNewOrderHighlight(displayedOrders);

  /* Load queue list on mount */
  useEffect(() => {
    dashboardService.queues().then(res => {
      const list = res.data?.queues ?? [];
      setQueues(list);
      if (list.length > 0) setSelectedQueue(list[0].queue_name);
    }).catch(() => { });
  }, []);

  // Reset to the project's current calendar date when its timezone changes.
  // Project 16 reaches the next Vietnam day at 10 PM PKT.
  useEffect(() => {
    const today = getProjectDateValue(projectTz);
    setStartDate(today);
    setEndDate(today);
  }, [projectTz]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [searchQuery]);

  /* Main data loader */
  const loadData = useCallback(async (page = 1, isRefresh = false) => {
    if (!selectedQueue) return;
    const params: any = { page, per_page: 100 };
    if (statusFilter !== 'all' && statusFilter !== 'cancelled' && statusFilter !== 'unassigned' && statusFilter !== 'pending') {
      params.status = statusFilter;
    }
    if (debouncedSearchQuery) params.search = debouncedSearchQuery;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (selectedWorker) params.assigned_to = selectedWorker;
    if (globalRoleSort) params.role_sort_by = globalRoleSort;

    const requestKey = JSON.stringify([selectedQueue, params]);
    if (activeDashboardRequestKeyRef.current === requestKey) return;

    const requestId = latestDashboardRequestIdRef.current + 1;
    latestDashboardRequestIdRef.current = requestId;
    activeDashboardRequestKeyRef.current = requestKey;

    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const res = await dashboardService.assignmentDashboard(selectedQueue, params);
      if (requestId !== latestDashboardRequestIdRef.current) return;

      const d = res.data;
      const dashboardOrders = (d.orders?.data ?? []) as AssignmentOrder[];
      const nextProject = (d.project || {}) as {
        id?: number | null;
        name?: string;
        country?: string | null;
        timezone?: string | null;
      };
      const nextProjectTimezone = resolveProjectTimezone(
        nextProject.id,
        nextProject.timezone,
        nextProject.country,
      );

      setWorkers(d.workers || {});
      setOrders((prev) => {
        const previousInstructions = new Map(
          prev.map((order) => [order.id, getOrderInstructionValue(order)])
        );

        return dashboardOrders.map((order) => {
          const incomingInstruction = getOrderInstructionValue(order as AssignmentOrder & Record<string, any>);
          const preservedInstruction = previousInstructions.get(order.id);

          if (incomingInstruction != null && incomingInstruction !== '') {
            return order;
          }

          if (preservedInstruction == null || preservedInstruction === '') {
            return order;
          }

          return {
            ...order,
            instruction: preservedInstruction,
            instructions: preservedInstruction,
            supervisor_notes: preservedInstruction,
            metadata: {
              ...((((order as any).metadata || {}) as Record<string, unknown>)),
              instruction: preservedInstruction,
            },
          };
        });
      });
      setTotalOrders(d.orders?.total ?? 0);
      setCurrentPage(d.orders?.current_page ?? page);
      setLastPage(d.orders?.last_page ?? 1);
      const defaultCounts = {
        today_total: 0,
        pending: 0,
        completed: 0,
        amends: 0,
        assigned: 0,
        unassigned: 0,
        rejected: 0,
      };

      setProjectLabel(d.project ? `${d.project.name} (${d.project.country})` : '');
      setProjectId(nextProject.id ?? null);
      setProjectTz(nextProjectTimezone);

      setCounts({
        ...defaultCounts,
        ...(d.counts || {}),
        pending_by_drawer: d.counts?.pending_by_drawer ?? 0, // safe fallback
      });
      setDateStats(d.date_stats || []);
      setRoleCompletions(d.role_completions || {});
      setProject51PortalAccounts({
        editors: d.project_51_portal_accounts?.editors ?? [],
        qc_accounts: d.project_51_portal_accounts?.qc_accounts ?? [],
      });
      setQueueInfo(d.queue || null);
      setProjectLabel(d.project ? `${d.project.name} (${d.project.country})` : '');
    } catch (e) {
      if (requestId === latestDashboardRequestIdRef.current) {
        console.error(e);
      }
    } finally {
      if (activeDashboardRequestKeyRef.current === requestKey) {
        activeDashboardRequestKeyRef.current = null;
      }
      if (requestId === latestDashboardRequestIdRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [selectedQueue, statusFilter, debouncedSearchQuery, startDate, endDate, selectedWorker, globalRoleSort]);

  useEffect(() => {
    const filterKey = JSON.stringify([
      selectedQueue,
      statusFilter,
      debouncedSearchQuery,
      startDate,
      endDate,
      selectedWorker,
      globalRoleSort,
    ]);
    const filtersChanged = dashboardFilterKeyRef.current !== filterKey;
    dashboardFilterKeyRef.current = filterKey;

    if (filtersChanged && currentPage !== 1) {
      setCurrentPage(1);
      return;
    }

    loadData(currentPage);
  }, [
    currentPage,
    debouncedSearchQuery,
    endDate,
    globalRoleSort,
    loadData,
    selectedQueue,
    selectedWorker,
    startDate,
    statusFilter,
  ]);

  /* Smart polling: auto-refresh when data changes */
  useSmartPolling({
    projectIds: selectedQueueInfo?.projects?.map((project) => project.id) ?? [],
    scope: 'orders',
    interval: 90_000,
    onDataChanged: () => loadData(currentPage, true),
    enabled: !!selectedQueue,
  });

  const handleReassign = async () => {
    if (!showReassign || reassignReason.length < 3) return;
    const orderId = showReassign.id;
    const confirmed = window.confirm(`Do you really want to reassign order ${showReassign.order_number}?`);
    if (!confirmed) return;
    try {
      setReassigning(true);
      await workflowService.reassignOrder(orderId, null, reassignReason, showReassign.project_id);
      setRecentlyReassignedOrderIds((prev) => {
        const next = new Set(prev);
        next.add(orderId);
        return next;
      });
      setShowReassign(null); setReassignReason('');
      loadData(currentPage, true);
    } catch (e) { console.error(e); }
    finally { setReassigning(false); }
  };

  useEffect(() => {
    if (recentlyReassignedOrderIds.size === 0) return;

    const timeout = setTimeout(() => {
      setRecentlyReassignedOrderIds(new Set());
    }, 120000);

    return () => clearTimeout(timeout);
  }, [recentlyReassignedOrderIds]);

  /* Resume held order */
  const [resumingOrderId, setResumingOrderId] = useState<number | null>(null);
  const handleResume = async (orderId: number, projectId?: number) => {
    try {
      setResumingOrderId(orderId);
      await workflowService.resumeOrder(orderId, projectId);
      toast({ title: 'Order resumed', description: 'Order has been returned to the workflow.', type: 'success' });
      loadData(currentPage, true);
    } catch (e: any) {
      console.error(e);
      toast({ title: 'Resume failed', description: e?.response?.data?.message || 'Could not resume order.', type: 'error' });
    } finally {
      setResumingOrderId(null);
    }
  };

  /* Derived data */
  const allWorkers = useMemo(() => Object.values(workers).flat(), [workers]);
  const workerById = useMemo(() => {
    const map = new Map<number, AssignmentWorker>();
    allWorkers.forEach((worker) => map.set(worker.id, worker));
    return map;
  }, [allWorkers]);
  const teamNameById = useMemo(() => {
    const map = new Map<number, string>();
    projectTeams.forEach((team) => map.set(team.id, team.name));
    return map;
  }, [projectTeams]);
  const filteredWorkers = useMemo(() => workerRoleFilter ? (workers[workerRoleFilter] || []) : allWorkers, [workers, workerRoleFilter, allWorkers]);
  const onlineCount = useMemo(() => allWorkers.filter(w => w.is_online && !w.is_absent).length, [allWorkers]);
  const absentCount = useMemo(() => allWorkers.filter(w => w.is_absent).length, [allWorkers]);
  const wipCount = useMemo(() => allWorkers.reduce((s, w) => s + w.wip_count, 0), [allWorkers]);
  const doneToday = useMemo(() => allWorkers.reduce((s, w) => s + w.today_completed, 0), [allWorkers]);
  const canReassignDoneOrders = useMemo(() => {
    const role = user?.role;
    return role === 'operations_manager' || role === 'project_manager' || role === 'director';
  }, [user?.role]);

  const isDoneWorkflowState = useCallback((workflowState?: string | null) => {
    const state = (workflowState || '').toUpperCase();
    return state.includes('APPROVED_QA')
      || state.includes('COMPLETE')
      || state.includes('DELIVER');
  }, []);

  const isOrderDoneForReassignmentRestriction = useCallback((order: AssignmentOrder) => {
    return isDoneWorkflowState(order.workflow_state);
  }, [isDoneWorkflowState]);

  const hasAssigneeForRole = useCallback((order: AssignmentOrder, role: 'drawer' | 'checker' | 'filler' | 'qa') => {
    if (role === 'drawer') return !!(order as any).drawer_id;
    if (role === 'checker') return !!(order as any).checker_id;
    if (role === 'filler') return !!(order as any).file_uploader_id;
    return !!(order as any).qa_id;
  }, []);
  const hasBulkAssigneeForRole = useCallback((order: AssignmentOrder, role: BulkAssignmentRole) => {
    const effectiveRole = role === 'designer' ? 'drawer' : role;
    const hasValue = (value: unknown) => {
      if (value == null) return false;
      if (typeof value === 'number') return value > 0;
      const normalized = String(value).trim().toLowerCase();
      return normalized !== ''
        && normalized !== '-'
        && normalized !== 'assign'
        && normalized !== '- assign'
        && normalized !== 'waiting';
    };

    if (effectiveRole === 'drawer') return hasValue((order as any).drawer_id) || hasValue(order.drawer_name);
    if (effectiveRole === 'checker') return hasValue((order as any).checker_id) || hasValue(order.checker_name);
    if (effectiveRole === 'filler') return hasValue((order as any).file_uploader_id) || hasValue(order.file_uploader_name);
    return hasValue((order as any).qa_id) || hasValue(order.qa_name);
  }, []);

  const clientOrderSummary = useMemo(() => {
    const counts = new Map<string, { total: number; completed: number }>();

    displayedOrders.forEach((order) => {
      const clientName = (order.client_name || '').trim();
      if (!clientName) return;
      const isCompleted = (order.workflow_state || '').toUpperCase().includes('COMPLETE')
        || (order.workflow_state || '').toUpperCase().includes('DELIVER');

      const current = counts.get(clientName) || { total: 0, completed: 0 };

      counts.set(clientName, {
        total: current.total + 1,
        completed: current.completed + (isCompleted ? 1 : 0),
      });
    });

    return Array.from(counts.entries())
      .map(([name, summary]) => ({
        name,
        total: summary.total,
        completed: summary.completed,
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [displayedOrders]);
  const searchedWorkers = useMemo(() => {
    if (!workerSearch) return filteredWorkers;
    const q = workerSearch.toLowerCase();
    return filteredWorkers.filter(w => w.name.toLowerCase().includes(q) || w.email.toLowerCase().includes(q) || String(w.id).includes(q));
  }, [filteredWorkers, workerSearch]);

  const pendingOrderCount = useMemo(
    () => (typeof counts.pending === 'number' ? counts.pending : orders.filter(isPendingOrder).length),
    [counts.pending, isPendingOrder, orders]
  );
  const unassignedOrderCount = useMemo(
    () => (typeof counts.unassigned === 'number' ? counts.unassigned : orders.filter((order) => !hasDrawerAssignment(order)).length),
    [counts.unassigned, hasDrawerAssignment, orders]
  );
  const currentProjectDate = useMemo(() => {
    return getProjectDateValue(projectTz);
  }, [projectTz]);
  const isPhotoEnhancementQueue = useMemo(() => {
    const workflowType = queueInfo?.workflow_type || selectedQueueInfo?.workflow_type || '';

    return workflowType === 'PH_2_LAYER';
  }, [queueInfo?.workflow_type, selectedQueueInfo?.workflow_type]);
  const getEffectiveAssignmentRole = useCallback((role: 'drawer' | 'checker' | 'filler' | 'qa') => {
    if (isPhotoEnhancementQueue && role === 'drawer') {
      return 'designer';
    }

    return role;
  }, [isPhotoEnhancementQueue]);
  const getRoleDisplayLabel = useCallback((role: 'drawer' | 'checker' | 'filler' | 'qa') => {
    if (isPhotoEnhancementQueue && role === 'drawer') {
      return 'Designer';
    }

    if (role === 'qa') return 'QA';
    if (role === 'filler') return 'Filler';
    if (role === 'checker') return 'Checker';
    return 'Drawer';
  }, [isPhotoEnhancementQueue]);

  const hasFillerColumn = useCallback(() => {
    return projectColumns.some(col => col.field === 'file_uploader_name');
  }, [projectColumns]);

  const usesPrioritySummaryCount = projectId === 1 || projectId === 3;
  const visiblePaginationItems = useMemo<(number | 'ellipsis')[]>(() => {
    if (lastPage <= 1) return [];
    if (lastPage <= 11) {
      return Array.from({ length: lastPage }, (_, index) => index + 1);
    }

    const windowStart = currentPage <= 2 ? 1 : currentPage;
    const windowEnd = Math.min(windowStart + 10, lastPage);
    const pageWindow = Array.from(
      { length: windowEnd - windowStart + 1 },
      (_, index) => windowStart + index,
    );

    if (windowStart === 1) {
      return pageWindow;
    }

    return [1, 'ellipsis', ...pageWindow];
  }, [currentPage, lastPage]);
  const visiblePriorityCounts = useMemo(() => {
    const derivedCounts = displayedOrders.reduce(
      (acc, order) => {
        const normalizedPriority = (order.priority || '').toString().trim().toLowerCase();

        if (normalizedPriority === 'high') {
          acc.high += 1;
        } else if (normalizedPriority === 'priority') {
          acc.priority += 1;
        } else if (normalizedPriority === 'rush') {
          acc.rush += 1;
        } else if (normalizedPriority === 'urgent') {
          acc.urgent += 1;
        } else if (!normalizedPriority || normalizedPriority === 'normal') {
          acc.normal += 1;
        }

        return acc;
      },
      { high: 0, priority: 0, normal: 0, rush: 0, urgent: 0 }
    );

    if (statusFilter === 'all' && dateStats.length > 0) {
      const filteredDateStats = dateStats.filter((stat) => {
        const statDate = stat.date;

        if (startDate && endDate) {
          return statDate >= startDate && statDate <= endDate;
        }

        if (startDate) {
          return statDate === startDate;
        }

        if (endDate) {
          return statDate === endDate;
        }

        return statDate === currentProjectDate;
      });

      return {
        ...derivedCounts,
        high: filteredDateStats.reduce((sum, stat) => sum + (stat.high || 0), 0),
        priority: filteredDateStats.reduce((sum, stat) => sum + (stat.priority || 0), 0),
        normal: filteredDateStats.reduce((sum, stat) => sum + (stat.regular || 0), 0),
      };
    }

    return derivedCounts;
  }, [currentProjectDate, dateStats, displayedOrders, endDate, startDate, statusFilter]);
  const cancelledCount = useMemo(
    () => orders.filter((o) => (o.workflow_state || '').toUpperCase().includes('CANCEL')).length,
    [orders]
  );

  const roleIcons: Record<string, any> = { drawer: Pencil, checker: CheckSquare, qa: Eye, amender: ShieldCheck };
  const roleSortWeight = useCallback((role: string) => {
    const normalized = role.toLowerCase();

    if (normalized === 'drawer') return 0;
    if (normalized === 'checker') return 1;
    if (normalized === 'qa') return 2;
    if (normalized === 'filler' || normalized === 'file_uploader') return 3;
    if (normalized === 'amender') return 4;

    return 99;
  }, []);
  const orderedWorkerRoles = useMemo(
    () => Object.keys(workers).sort((a, b) => roleSortWeight(a) - roleSortWeight(b) || a.localeCompare(b)),
    [roleSortWeight, workers]
  );
  const orderedRoleCompletionEntries = useMemo(
    () => Object.entries(roleCompletions).sort(([roleA], [roleB]) => roleSortWeight(roleA) - roleSortWeight(roleB) || roleA.localeCompare(roleB)),
    [roleCompletions, roleSortWeight]
  );
  const project51EditorAccountSummary = useMemo(
    () => project51PortalAccounts.editors.map((account) => ({
      id: account.id,
      label: account.name || account.resource_name,
      count: Number(account.pending_assigned_count || 0),
    })),
    [project51PortalAccounts.editors]
  );
  const project51QcAccountSummary = useMemo(
    () => project51PortalAccounts.qc_accounts.map((account) => ({
      id: account.id,
      label: account.name || account.resource_name,
      count: Number(account.pending_assigned_count || 0),
    })),
    [project51PortalAccounts.qc_accounts]
  );
  const statusButtons = useMemo(() => {
    const buttons = [
      { key: 'all', label: 'All', count: counts.today_total },
      { key: 'pending', label: 'Pending', count: pendingOrderCount },
      { key: 'pending_by_drawer', label: 'Fixing/Mail', count: counts.pending_by_drawer },
      { key: 'unassigned', label: 'Unassigned', count: unassignedOrderCount },
      { key: 'completed', label: 'Completed', count: counts.completed },
      // { key: 'amends', label: 'Amends', count: counts.amends },
      { key: 'rejected', label: 'Rejected/Re-send', count: counts.rejected },
    ];

    if (isProject16) {
      buttons.push({ key: 'cancelled', label: 'Cancelled', count: cancelledCount });
    }

    return buttons;
  }, [cancelledCount, counts.completed, counts.pending_by_drawer, counts.rejected, counts.today_total, isProject16, pendingOrderCount, unassignedOrderCount]);
  const parseStoredDateTime = useCallback((t: string | null) => {
    if (!t) return null;

    const mysqlMatch = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (mysqlMatch) {
      return {
        year: mysqlMatch[1],
        month: mysqlMatch[2],
        day: mysqlMatch[3],
        hour: mysqlMatch[4] ?? '00',
        minute: mysqlMatch[5] ?? '00',
        second: mysqlMatch[6] ?? '00',
      };
    }

    const d = new Date(t);
    if (isNaN(d.getTime())) return null;

    const parts = new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: projectTz,
    }).formatToParts(d);

    return {
      year: parts.find((part) => part.type === 'year')?.value ?? '',
      month: parts.find((part) => part.type === 'month')?.value ?? '',
      day: parts.find((part) => part.type === 'day')?.value ?? '',
      hour: parts.find((part) => part.type === 'hour')?.value ?? '00',
      minute: parts.find((part) => part.type === 'minute')?.value ?? '00',
      second: parts.find((part) => part.type === 'second')?.value ?? '00',
    };
  }, [projectTz]);
  const fmtReceivedTime = (t: string | null) => {
    const parsed = parseStoredDateTime(t);
    if (!parsed) return '-';
    return `${parsed.hour}:${parsed.minute}`;
  };
  const fmtProjectDateTime = useCallback((t: string | null) => {
    const parsed = parseStoredDateTime(t);
    if (!parsed) return '-';

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthLabel = monthNames[Math.max(0, Number(parsed.month) - 1)] || parsed.month;

    return `${parsed.day} ${monthLabel} ${parsed.hour}:${parsed.minute}`;
  }, [parseStoredDateTime]);
  const toDateTimeLocalValue = useCallback((value: string | null | undefined) => {
    const parsed = parseStoredDateTime(value ?? null);
    if (!parsed) return '';
    return `${parsed.year}-${parsed.month}-${parsed.day}T${parsed.hour}:${parsed.minute}`;
  }, [parseStoredDateTime]);
  const toApiDateTimeValue = useCallback((value: string) => {
    if (!value) return null;
    const trimmed = value.trim();
    const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
    return withSeconds.replace('T', ' ');
  }, []);
  const parseDisplayDateValue = useCallback((t: string | null) => {
    if (!t) return null;

    const isoDateMatch = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateMatch) {
      return {
        year: isoDateMatch[1],
        month: isoDateMatch[2],
        day: isoDateMatch[3],
      };
    }

    const dashDateMatch = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dashDateMatch) {
      return {
        year: dashDateMatch[3],
        month: String(Number(dashDateMatch[2])).padStart(2, '0'),
        day: String(Number(dashDateMatch[1])).padStart(2, '0'),
      };
    }

    const slashDateMatch = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashDateMatch) {
      const first = Number(slashDateMatch[1]);
      const second = Number(slashDateMatch[2]);

      // Supervisor assignment date-only values from the backend are expected
      // to be day/month/year when provided with slash separators.
      const day = String(first).padStart(2, '0');
      const month = String(second).padStart(2, '0');

      return {
        year: slashDateMatch[3],
        month,
        day,
      };
    }

    return parseStoredDateTime(t);
  }, [parseStoredDateTime]);
  const fmtDisplayDate = useCallback((t: string | null) => {
    const parsed = parseDisplayDateValue(t);
    if (!parsed) return '-';
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthLabel = monthNames[Math.max(0, Number(parsed.month) - 1)] || parsed.month;
    return `${parsed.day} ${monthLabel}`;
  }, [parseDisplayDateValue]);
  const fmtDisplayMonthKey = useCallback((t: string | null) => {
    const parsed = parseDisplayDateValue(t);
    return parsed ? `${parsed.year}-${parsed.month}` : '';
  }, [parseDisplayDateValue]);
  const getOrderDisplayDateSource = useCallback((order: AssignmentOrder) => {
    if (isProject16 && order.date) {
      return order.date;
    }

    return order.received_at;
  }, [isProject16]);
  const fmtOrderDisplayDate = useCallback((order: AssignmentOrder) => {
    return fmtDisplayDate(getOrderDisplayDateSource(order));
  }, [fmtDisplayDate, getOrderDisplayDateSource]);
  const fmtOrderMonthKey = useCallback((order: AssignmentOrder) => {
    return fmtDisplayMonthKey(getOrderDisplayDateSource(order));
  }, [fmtDisplayMonthKey, getOrderDisplayDateSource]);
  useEffect(() => {
    if (!projectId) {
      setProjectColumns([]);
      return;
    }

    columnService.getAllColumns(projectId)
      .then((res) => {
        const cols = res.data?.data ?? [];
        setProjectColumns(
          [...cols].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        );
      })
      .catch((error) => {
        console.error(error);
        setProjectColumns([]);
      });
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setProjectTeams([]);
      return;
    }

    projectService.teams(projectId)
      .then((res) => {
        setProjectTeams(res.data?.data ?? []);
      })
      .catch((error) => {
        console.error(error);
        setProjectTeams([]);
      });
  }, [projectId]);

  // fmtTime kept for future use
  // const fmtTime = (t: string | null) => { if (!t) return '-'; const d = new Date(t); return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };

  /* Countdown tick every 30 seconds */
  const [, setTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);
  const [blinkingUrgentOrderIds, setBlinkingUrgentOrderIds] = useState<Set<number>>(new Set());
  const urgentBlinkTriggeredRef = useRef<Set<number>>(new Set());
  /** Parse due_in "MM/DD/YYYY HH:MM:SS" or ISO into milliseconds remaining.
   *  Project 16 is counted in PKT; other projects use their selected timezone.
   *  Fallback: if due_in is empty, use received_at + 24h as default deadline. */
  const parseDueIn = useCallback((raw: string | null, receivedAt?: string | null): number | null => {
    const getCountdownNow = () => {
      const countdownTimeZone = effectiveProjectId === 16
        ? PROJECT_16_DUE_IN_TIMEZONE
        : projectTz;
      const countdownNowStr = new Date().toLocaleString('en-US', { timeZone: countdownTimeZone });
      return new Date(countdownNowStr).getTime();
    };
    if (raw) {
      let d = new Date(raw);
      if (isNaN(d.getTime())) {
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
        if (m) d = new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
      }
      if (!isNaN(d.getTime())) return d.getTime() - getCountdownNow();
    }
    // Fallback: received_at + 24 hours
    if (receivedAt) {
      const rd = new Date(receivedAt);
      if (!isNaN(rd.getTime())) return (rd.getTime() + 24 * 3600_000) - getCountdownNow();
    }
    return null;
  }, [effectiveProjectId, projectTz]);
  const sortedOrders = useMemo(() => {
    const shouldSortByRemainingTime = effectiveProjectId === 1 || effectiveProjectId === 2 || effectiveProjectId === 3;

    if (!shouldSortByRemainingTime) {
      return displayedOrders;
    }

    return [...displayedOrders].sort((a, b) => {
      const aMs = parseDueIn(a.due_in, a.received_at);
      const bMs = parseDueIn(b.due_in, b.received_at);

      if (aMs == null && bMs == null) return 0;
      if (aMs == null) return 1;
      if (bMs == null) return -1;

    return aMs - bMs;
    });
  }, [displayedOrders, effectiveProjectId, parseDueIn]);
  /** Render remaining time badge with colour coding */
  const RemainingBadge = ({ dueIn, receivedAt }: { dueIn: string | null; receivedAt?: string | null }) => {
    const ms = parseDueIn(dueIn, receivedAt);
    if (ms === null) return <span className="text-slate-300">-</span>;
    const totalMin = Math.floor(ms / 60000);
    const overdue = totalMin < 0;
    const absTotalMin = Math.abs(totalMin);
    const hrs = Math.floor(absTotalMin / 60);
    const mins = absTotalMin % 60;
    const label = overdue
      ? (hrs > 0 ? `-${hrs}h ${mins}m` : `-${mins}m`)
      : (hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`);
    const cls = overdue
      ? 'bg-red-100 text-red-700'
      : hrs < 1
        ? 'bg-orange-100 text-orange-700'
        : hrs < 4
          ? 'bg-yellow-100 text-yellow-700'
          : 'bg-green-100 text-green-700';
    return (
      <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}`}>
        <Clock className="w-2.5 h-2.5" />
        {label}
      </span>
    );
  };

  const getOrderTeamName = useCallback((order: AssignmentOrder) => {
    const orderData = order as AssignmentOrder & Record<string, any>;
    const directTeamName = orderData.checker_team_name
      ?? orderData.assigned_checker_team_name
      ?? orderData.team_name
      ?? orderData.drawer_team_name;

    if (typeof directTeamName === 'string' && directTeamName.trim() !== '') {
      return directTeamName.trim();
    }

    const checkerTeamId = order.checker_id ? workerById.get(order.checker_id)?.team_id : null;
    const qaTeamId = order.qa_id ? workerById.get(order.qa_id)?.team_id : null;
    const drawerTeamId = order.drawer_id ? workerById.get(order.drawer_id)?.team_id : null;
    const teamId = checkerTeamId ?? qaTeamId ?? drawerTeamId;

    return teamId ? (teamNameById.get(teamId) || '-') : '-';
  }, [teamNameById, workerById]);

  const TeamNameCell = ({ order }: { order: AssignmentOrder }) => {
    const teamName = getOrderTeamName(order);
    const teamAssignmentRole = TEAM_CHECKER_ASSIGNMENT_PROJECT_IDS.includes(order.project_id) ? 'checker' : 'qa';
    const teamAssignmentLabel = teamAssignmentRole === 'checker' ? 'checker' : 'QA';
    const hasTeamAssignee = teamAssignmentRole === 'checker' ? !!order.checker_name : !!order.qa_name;
    const isDone = isOrderDoneForReassignmentRestriction(order);
    const isExistingAssignmentChangeBlocked = hasTeamAssignee && !canReassignDoneOrders;

    return (
      <td className="px-3 py-2 text-slate-700">
        {projectTeams.length > 0 ? (
          <button
            type="button"
            className="block w-full rounded px-1 -mx-1 py-0.5 text-left font-medium transition-colors hover:bg-slate-50"
            title={isExistingAssignmentChangeBlocked ? 'Team reassignment blocked for non-management users' : `Assign ${teamAssignmentLabel} by team`}
            onClick={(e) => {
              if (isExistingAssignmentChangeBlocked) {
                e.stopPropagation();
                toast({
                  type: 'error',
                  title: 'Reassignment blocked',
                  description: 'Assigned orders can only be changed by OM/PM/Director. Non-management users can assign only unassigned orders.',
                });
                return;
              }

              openAssignDropdown(e, order.id, teamAssignmentRole, { confirmReassign: hasTeamAssignee && isDone, mode: 'team' });
            }}
          >
            <span className="block truncate" title={teamName}>
              {teamName !== '-' ? teamName : '- assign team'}
            </span>
          </button>
        ) : (
          <span className="block truncate font-medium" title={teamName}>
            {teamName}
          </span>
        )}
      </td>
    );
  };

  /* Inline assign dropdown state */
  const [assignDropdown, setAssignDropdown] = useState<{ orderId: number; role: 'drawer' | 'checker' | 'filler' | 'qa'; anchorRect?: DOMRect; mode?: 'worker' | 'team' } | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkRole, setBulkRole] = useState<BulkAssignmentRole>(isPhotoEnhancementQueue ? 'designer' : 'drawer');
  const [bulkUserId, setBulkUserId] = useState('');
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<Set<string>>(new Set());
  const [bulkAssigning, setBulkAssigning] = useState(false);

  useEffect(() => {
    setBulkRole(isPhotoEnhancementQueue ? 'designer' : 'drawer');
    setBulkUserId('');
    setBulkSelectedKeys(new Set());
  }, [isPhotoEnhancementQueue, selectedQueue]);

  const getBulkOrderKey = useCallback((order: Pick<AssignmentOrder, 'id' | 'project_id'>) => (
    `${order.project_id}:${order.id}`
  ), []);

  const getBulkRoleLabel = useCallback((role: BulkAssignmentRole) => {
    if (role === 'designer') return 'Designer';
    if (role === 'qa') return 'QA';
    if (role === 'filler') return 'Filler';
    if (role === 'checker') return 'Checker';
    return 'Drawer';
  }, []);

  const bulkRoleOptions = useMemo<Array<{ value: BulkAssignmentRole; label: string }>>(() => {
    const options: Array<{ value: BulkAssignmentRole; label: string }> = isPhotoEnhancementQueue
      ? [{ value: 'designer', label: 'Designer' }, { value: 'qa', label: 'QA' }]
      : [{ value: 'drawer', label: 'Drawer' }];

    if (isPhotoEnhancementQueue) {
      return options;
    }

    options.push({ value: 'checker', label: 'Checker' });

    if (hasFillerColumn() || workers.filler || workers.file_uploader) {
      options.push({ value: 'filler', label: 'Filler' });
    }

    options.push({ value: 'qa', label: 'QA' });

    return options;
  }, [hasFillerColumn, isPhotoEnhancementQueue, workers.file_uploader, workers.filler]);

  const isBulkDoneValue = useCallback((value: unknown) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized === 'yes'
      || normalized === '1'
      || normalized === 'true'
      || normalized === 'done'
      || normalized === 'ok';
  }, []);

  const isDesignerDoneForBulk = useCallback((order: AssignmentOrder) => {
    const state = String(order.workflow_state || '').toUpperCase();
    return isBulkDoneValue(order.drawer_done)
      || state.includes('QUEUED_QA')
      || state.includes('IN_QA')
      || state.includes('APPROVED_QA')
      || state.includes('DELIVER')
      || state.includes('COMPLETE');
  }, [isBulkDoneValue]);

  const isDrawerDoneForBulk = useCallback((order: AssignmentOrder) => {
    const state = String(order.workflow_state || '').toUpperCase();
    return isBulkDoneValue(order.drawer_done)
      || state.includes('QUEUED_CHECK')
      || state.includes('IN_CHECK')
      || state.includes('SUBMITTED_CHECK')
      || state.includes('QUEUED_FILLER')
      || state.includes('IN_FILLER')
      || state.includes('SUBMITTED_FILLER')
      || state.includes('QUEUED_QA')
      || state.includes('IN_QA')
      || state.includes('APPROVED_QA')
      || state.includes('DELIVER')
      || state.includes('COMPLETE');
  }, [isBulkDoneValue]);

  const isCheckerDoneForBulk = useCallback((order: AssignmentOrder) => {
    const state = String(order.workflow_state || '').toUpperCase();
    return isBulkDoneValue(order.checker_done)
      || state.includes('QUEUED_FILLER')
      || state.includes('IN_FILLER')
      || state.includes('SUBMITTED_FILLER')
      || state.includes('QUEUED_QA')
      || state.includes('IN_QA')
      || state.includes('APPROVED_QA')
      || state.includes('DELIVER')
      || state.includes('COMPLETE');
  }, [isBulkDoneValue]);

  const isFillerDoneForBulk = useCallback((order: AssignmentOrder) => {
    const state = String(order.workflow_state || '').toUpperCase();
    const fileUploaded = (order as any).file_uploaded
      ?? ((order.metadata || {}) as Record<string, unknown>).file_uploaded
      ?? order.final_upload;

    return isBulkDoneValue(fileUploaded)
      || state.includes('SUBMITTED_FILLER')
      || state.includes('QUEUED_QA')
      || state.includes('IN_QA')
      || state.includes('APPROVED_QA')
      || state.includes('DELIVER')
      || state.includes('COMPLETE');
  }, [isBulkDoneValue]);

  const isBulkAssignableOrder = useCallback((order: AssignmentOrder, role: BulkAssignmentRole) => {
    const roleForChecks = role === 'designer' ? 'drawer' : role;
    const hasAssignee = hasAssigneeForRole(order, roleForChecks);

    if (hasBulkAssigneeForRole(order, role)) {
      return false;
    }

    if (hasAssignee && !canReassignDoneOrders) {
      return false;
    }

    if (!canReassignDoneOrders && isOrderDoneForReassignmentRestriction(order) && hasAssignee) {
      return false;
    }

    if (role === 'designer' && !isPhotoEnhancementQueue) {
      return false;
    }

    if (role === 'drawer' && isPhotoEnhancementQueue) {
      return false;
    }

    if (role === 'filler' && order.project_id !== 12) {
      return false;
    }

    if (isPhotoEnhancementQueue) {
      return role === 'designer' || (role === 'qa' && isDesignerDoneForBulk(order));
    }

    if (role === 'checker' && !isDrawerDoneForBulk(order)) {
      return false;
    }

    if (role === 'filler' && !isCheckerDoneForBulk(order)) {
      return false;
    }

    if (role === 'qa') {
      return order.project_id === 12
        ? isFillerDoneForBulk(order)
        : isCheckerDoneForBulk(order);
    }

    return true;
  }, [
    canReassignDoneOrders,
    hasBulkAssigneeForRole,
    hasAssigneeForRole,
    isCheckerDoneForBulk,
    isDesignerDoneForBulk,
    isDrawerDoneForBulk,
    isFillerDoneForBulk,
    isOrderDoneForReassignmentRestriction,
    isPhotoEnhancementQueue,
  ]);

  const bulkWorkers = useMemo(() => {
    const list = bulkRole === 'filler'
      ? (workers.filler || workers.file_uploader || [])
      : (workers[bulkRole] || []);
    return list.filter((worker) => worker.is_active !== false && !worker.is_absent);
  }, [bulkRole, workers]);
  const bulkAssignableOrders = useMemo(
    () => sortedOrders.filter((order) => isBulkAssignableOrder(order, bulkRole)),
    [bulkRole, isBulkAssignableOrder, sortedOrders]
  );
  const selectedBulkOrders = useMemo(
    () => sortedOrders.filter((order) => bulkSelectedKeys.has(getBulkOrderKey(order)) && isBulkAssignableOrder(order, bulkRole)),
    [bulkRole, bulkSelectedKeys, getBulkOrderKey, isBulkAssignableOrder, sortedOrders]
  );
  const allBulkVisibleSelected = bulkAssignableOrders.length > 0
    && bulkAssignableOrders.every((order) => bulkSelectedKeys.has(getBulkOrderKey(order)));

  const getAssignmentWorkerPool = useCallback((role: 'drawer' | 'checker' | 'filler' | 'qa') => {
    if (role === 'filler') {
      return workers.filler || workers.file_uploader || [];
    }

    const effectiveRole = getEffectiveAssignmentRole(role);
    return workers[effectiveRole] || [];
  }, [getEffectiveAssignmentRole, workers]);

  const assignableWorkers = useMemo(() => {
    if (!assignDropdown) return [];
    const list = getAssignmentWorkerPool(assignDropdown.role);
    if (!assignSearch) return list;
    const q = assignSearch.toLowerCase();
    return list.filter(w => w.name.toLowerCase().includes(q) || String(w.id).includes(q));
  }, [assignDropdown, assignSearch, getAssignmentWorkerPool]);
  const showTeamAssignment = !!assignDropdown
    && assignDropdown.mode === 'team'
    && (assignDropdown.role === 'checker' || assignDropdown.role === 'qa');
  const assignableTeamAssignments = useMemo(() => {
    if (!showTeamAssignment || !assignDropdown) return [];

    const assignmentRole = assignDropdown.role;
    const workersForRole = getAssignmentWorkerPool(assignmentRole);
    const q = assignSearch.trim().toLowerCase();

    return projectTeams
      .map((team) => {
        const teamWorkers = workersForRole.filter((worker) => worker.team_id === team.id);
        const qaLead = assignmentRole === 'qa' && team.qa_user_id
          ? workersForRole.find((worker) => worker.id === team.qa_user_id)
          : null;
        const primaryAssignee = qaLead
          ?? teamWorkers.find((worker) => !worker.is_absent)
          ?? teamWorkers[0]
          ?? null;
        const assigneeNames = teamWorkers.map((worker) => worker.name).join(', ');

        return {
          team,
          workers: teamWorkers,
          primaryAssignee,
          assigneeNames,
        };
      })
      .filter((item) => {
        if (!item.primaryAssignee) return false;
        if (!q) return true;

        return item.team.name.toLowerCase().includes(q)
          || item.assigneeNames.toLowerCase().includes(q)
          || String(item.team.id).includes(q)
          || item.workers.some((worker) => String(worker.id).includes(q));
      });
  }, [assignDropdown, assignSearch, getAssignmentWorkerPool, projectTeams, showTeamAssignment]);

  const handleAssignRole = useCallback(async (orderId: number, role: string, userId: number) => {
    try {
      const order = orders.find((o) => o.id === orderId);
      const effectiveRoleForCheck = (role === 'drawer' && isPhotoEnhancementQueue ? 'drawer' : role) as 'drawer' | 'checker' | 'filler' | 'qa';
      const isExistingAssignmentChangeBlocked = !!order
        && hasAssigneeForRole(order, effectiveRoleForCheck)
        && !canReassignDoneOrders;

      if (isExistingAssignmentChangeBlocked) {
        toast({
          type: 'error',
          title: 'Reassignment blocked',
          description: 'Assigned orders can only be changed by OM/PM/Director. Non-management users can assign only unassigned orders.',
        });
        return;
      }

      if (order && !canReassignDoneOrders && isOrderDoneForReassignmentRestriction(order) && hasAssigneeForRole(order, effectiveRoleForCheck)) {
        toast({
          type: 'error',
          title: 'Reassignment blocked',
          description: 'QA can assign pending orders, but done orders can only be reassigned by OM/PM/Director.',
        });
        return;
      }

      setAssigning(true);
      // Find the worker being assigned for optimistic update
      const worker = allWorkers.find(w => w.id === userId);
      // Find the order's project_id to avoid cross-project ID collision
      const orderProjectId = orders.find(o => o.id === orderId)?.project_id;
      const effectiveRole = role === 'drawer' && isPhotoEnhancementQueue ? 'designer' : role;
      const isTeamQaAssignment = role === 'qa' && assignDropdown?.mode === 'team';
      const res = isTeamQaAssignment
        ? await workflowService.assignToQA(orderId, userId, orderProjectId)
        : await workflowService.assignRole(orderId, effectiveRole, userId, orderProjectId);
      setAssignDropdown(null);
      setAssignSearch('');

      // Optimistic update: immediately show the assigned name in the table
      if (worker) {
        const roleColMap: Record<string, string> = { drawer: 'drawer_name', checker: 'checker_name', filler: 'file_uploader_name', qa: 'qa_name' };
        const roleIdMap: Record<string, string> = { drawer: 'drawer_id', checker: 'checker_id', filler: 'file_uploader_id', qa: 'qa_id' };

        setOrders(prev => prev.map(o => o.id === orderId ? {
          ...o,
          [roleColMap[role]]: worker.name,
          [roleIdMap[role]]: worker.id,
        } : o));
      }

      const roleLabel = isTeamQaAssignment ? 'QA supervisor' : role === 'drawer' && isPhotoEnhancementQueue ? 'designer' : role;
      toast({ type: 'success', title: 'Assigned', description: res.data?.message || `${roleLabel} assigned successfully` });
      // Also refresh from server to ensure consistency
      loadData(currentPage, true);
    } catch (e: any) {
      console.error(e);
      toast({ type: 'error', title: 'Assignment Failed', description: e?.response?.data?.message || 'Could not assign role' });
    } finally { setAssigning(false); }
  }, [allWorkers, assignDropdown?.mode, canReassignDoneOrders, hasAssigneeForRole, isOrderDoneForReassignmentRestriction, isPhotoEnhancementQueue, loadData, orders, toast]);

  const toggleBulkOrder = useCallback((order: AssignmentOrder) => {
    if (!isBulkAssignableOrder(order, bulkRole)) return;

    const key = getBulkOrderKey(order);
    setBulkSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [bulkRole, getBulkOrderKey, isBulkAssignableOrder]);

  const toggleAllBulkVisible = useCallback(() => {
    setBulkSelectedKeys((prev) => {
      const next = new Set(prev);
      if (allBulkVisibleSelected) {
        bulkAssignableOrders.forEach((order) => next.delete(getBulkOrderKey(order)));
      } else {
        bulkAssignableOrders.forEach((order) => next.add(getBulkOrderKey(order)));
      }
      return next;
    });
  }, [allBulkVisibleSelected, bulkAssignableOrders, getBulkOrderKey]);

  const handleBulkAssign = useCallback(async () => {
    const userId = Number(bulkUserId);
    if (!userId || selectedBulkOrders.length === 0) return;

    const confirmed = window.confirm(`Assign ${selectedBulkOrders.length} selected order(s) to the selected ${bulkRole}?`);
    if (!confirmed) return;

    try {
      setBulkAssigning(true);
      const res = await workflowService.bulkAssignRole(
        bulkRole,
        userId,
        selectedBulkOrders.map((order) => ({ id: order.id, project_id: order.project_id }))
      );
      const assignedCount = res.data?.assigned_count ?? 0;
      const skippedCount = res.data?.skipped_count ?? 0;
      const firstSkipped = res.data?.skipped?.[0]?.reason;

      toast({
        type: assignedCount > 0 ? 'success' : 'error',
        title: assignedCount > 0 ? 'Bulk assigned' : 'No orders assigned',
        description: skippedCount > 0 && firstSkipped
          ? `${assignedCount} assigned, ${skippedCount} skipped. First skip: ${firstSkipped}`
          : res.data?.message || `${assignedCount} order(s) assigned.`,
      });

      setBulkSelectedKeys(new Set());
      loadData(currentPage, true);
    } catch (e: any) {
      console.error(e);
      toast({ type: 'error', title: 'Bulk assignment failed', description: e?.response?.data?.message || 'Could not assign selected orders.' });
    } finally {
      setBulkAssigning(false);
    }
  }, [bulkRole, bulkUserId, currentPage, loadData, selectedBulkOrders, toast]);

  const openAssignDropdown = (
    e: React.MouseEvent,
    orderId: number,
    role: 'drawer' | 'checker' | 'filler' | 'qa',
    options?: { confirmReassign?: boolean; mode?: 'worker' | 'team' }
  ) => {
    e.stopPropagation();
    if (options?.confirmReassign) {
      const confirmed = window.confirm('Do you really want to reassign this order?');
      if (!confirmed) return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAssignDropdown({ orderId, role, anchorRect: rect, mode: options?.mode ?? 'worker' });
    setAssignSearch('');
  };

  /* Duration formatter for role time */
  const fmtDuration = (startTime: string | null, endTime: string | null): string | null => {
    if (!startTime) return null;
    const start = new Date(startTime).getTime();
    const end = endTime ? new Date(endTime).getTime() : Date.now();
    if (isNaN(start) || isNaN(end) || end <= start) return null;
    const diffMin = Math.floor((end - start) / 60000);
    if (diffMin < 1) return '< 1m';
    const hrs = Math.floor(diffMin / 60);
    const mins = diffMin % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  const fmtSecondsDuration = (seconds?: number | string | null): string => {
    const value = typeof seconds === 'string' ? Number(seconds) : seconds;
    if (value == null || !Number.isFinite(value) || value < 0) return '-';
    if (value < 60) return `${Math.floor(value)}s`;
    const totalMinutes = Math.floor(value / 60);
    const hrs = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  /* Determine if a role stage has not been reached yet */
  const DESIGN_STAGES = ['RECEIVED', 'QUEUED_DESIGN', 'IN_DESIGN', 'SUBMITTED_DESIGN'];
  const DRAW_STAGES = ['RECEIVED', 'QUEUED_DRAW', 'IN_DRAW', 'SUBMITTED_DRAW', 'PENDING_QA_REVIEW'];
  const FILLER_WAIT_STAGES = [...DRAW_STAGES, 'QUEUED_CHECK', 'IN_CHECK'];
  const QA_FILLER_WAIT_STAGES = ['QUEUED_FILLER', 'IN_FILLER'];
  // For PH_2_LAYER queues, QA must wait while design is still in progress.
  const QA_WAIT_STAGES = isPhotoEnhancementQueue
    ? DESIGN_STAGES
    : [...DRAW_STAGES, 'QUEUED_CHECK', 'IN_CHECK', 'SUBMITTED_CHECK'];
  const isWaiting = (order: AssignmentOrder, role: 'drawer' | 'checker' | 'filler' | 'qa'): boolean => {
    const ws = (order.workflow_state || '').toUpperCase();
    if (!ws) return false;
    if (role === 'checker' && allowDirectCheckerAssignment) return false;
    if (role === 'checker') return DRAW_STAGES.includes(ws);
    if (role === 'filler') return FILLER_WAIT_STAGES.includes(ws);
    if (role === 'qa') {
      const shouldWaitDuringFiller = QA_WAIT_DURING_FILLER_PROJECT_IDS.includes(order.project_id)
        && QA_FILLER_WAIT_STAGES.includes(ws);

      return QA_WAIT_STAGES.includes(ws) || shouldWaitDuringFiller;
    }
    return false;
  };

  /* Reusable cell renderer for role columns */
  const isRoleCompleted = useCallback((order: AssignmentOrder, role: 'drawer' | 'checker' | 'filler' | 'qa', done: string | null) => {
    const normalizedDone = String(done || '').trim().toLowerCase();
    const workflowState = (order.workflow_state || '').toUpperCase();

    if (normalizedDone === 'yes' || normalizedDone === '1' || normalizedDone === 'true' || normalizedDone === 'done') {
      return true;
    }

    // Drawer/designer is done when workflow has progressed past draw stages
    if (role === 'drawer') {
      return workflowState.includes('QUEUED_CHECK')
        || workflowState.includes('IN_CHECK')
        || workflowState.includes('SUBMITTED_CHECK')
        || workflowState.includes('QUEUED_QA')
        || workflowState.includes('IN_QA')
        || workflowState.includes('APPROVED_QA')
        || workflowState.includes('DELIVER')
        || workflowState.includes('COMPLETE');
    }

    if (role === 'filler') {
      const fileUploaded = String((order as any).file_uploaded || ((order.metadata || {}) as Record<string, unknown>).file_uploaded || '').trim().toLowerCase();

      return workflowState.includes('SUBMITTED_FILLER')
        || workflowState.includes('QUEUED_QA')
        || workflowState.includes('IN_QA')
        || workflowState.includes('APPROVED_QA')
        || workflowState.includes('DELIVER')
        || fileUploaded === 'yes'
        || fileUploaded === '1'
        || fileUploaded === 'true'
        || fileUploaded === 'done'
        || fileUploaded === 'ok';
    }

    return false;
  }, []);

  const RoleCell = ({ order, role, name, userId: _userId, done, color, startTime, endTime }: { order: AssignmentOrder; role: 'drawer' | 'checker' | 'filler' | 'qa'; name: string | null; userId?: number | null; done: string | null; color: string; startTime?: string | null; endTime?: string | null }) => {
    const duration = fmtDuration(startTime || null, endTime || null);
    const isDone = isRoleCompleted(order, role, done);
    const isDoneOrder = isOrderDoneForReassignmentRestriction(order);
    const isExistingAssignmentChangeBlocked = !!name && !canReassignDoneOrders;
    const isDoneReassignBlocked = isDoneOrder && !!name && isDone && !canReassignDoneOrders;
    const waiting = !name && !isDone && isWaiting(order, role);
    const roleLabel = getRoleDisplayLabel(role);

    return (
      <td className="px-3 py-2">
        {waiting ? (
          <div className="flex items-center gap-1 px-1 py-0.5">
            <div className="w-5 h-5 rounded-full bg-amber-100 text-amber-500 flex items-center justify-center flex-shrink-0">
              <Clock className="w-3 h-3" />
            </div>
            <span className="text-amber-500 text-xs font-medium">Waiting</span>
          </div>
        ) : (
          <button onClick={(e) => {
            if (isExistingAssignmentChangeBlocked) {
              e.stopPropagation();
              toast({
                type: 'error',
                title: 'Reassignment blocked',
                description: 'Assigned orders can only be changed by OM/PM/Director. Non-management users can assign only unassigned orders.',
              });
              return;
            }

            if (isDoneReassignBlocked) {
              e.stopPropagation();
              toast({
                type: 'error',
                title: 'Reassignment blocked',
                description: 'Done orders can only be reassigned by OM/PM/Director.',
              });
              return;
            }

            openAssignDropdown(e, order.id, role, { confirmReassign: !!name && isDone });
          }}
            className={`flex flex-col group rounded px-1 -mx-1 py-0.5 transition-colors w-full text-left ${isDone ? 'cursor-pointer opacity-70 hover:bg-slate-50' : 'cursor-pointer hover:bg-slate-50'
              }`}
            title={isExistingAssignmentChangeBlocked
              ? `${roleLabel} reassignment blocked for non-management users`
              : isDoneReassignBlocked
                ? `${roleLabel} reassignment blocked for done orders`
                : (name ? `Click to change ${roleLabel}` : `Assign ${roleLabel}`)}>
            <div className="flex items-center gap-1 min-w-0">
              {name ? (
                <>
                  <div className={`w-5 h-5 rounded-full ${isDone ? 'bg-green-400' : color} text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0`}>
                    {isDone ? '✓' : name.charAt(0)}
                  </div>
                  <span className={`truncate ${isDone ? 'text-green-700 font-medium' : 'text-slate-700'}`}>{name}</span>
                  {isDone && <span className="text-green-500 text-[10px] font-bold ml-0.5">✓</span>}
                </>
              ) : (
                <span className="text-slate-300 group-hover:text-brand-500 text-xs">- assign</span>
              )}
            </div>
            {duration && (
              <div className="text-[10px] text-slate-400 ml-6 mt-0.5 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />{duration}
              </div>
            )}
          </button>
        )}
      </td>
    );
  };

  const fixedTrailingFields = useMemo(() => new Set([
    'drawer_name',
    'checker_name',
    'file_uploader_name',
    'qa_name',
    'drawer_id',
    'checker_id',
    'qa_id',
    'drawer_done',
    'checker_done',
    'final_upload',
    'dassign_time',
    'cassign_time',
    'drawer_date',
    'checker_date',
    'ausFinaldate',
    'workflow_state',
    'status',
  ]), []);

  const defaultPrimaryColumns = useMemo<AssignmentTableColumn[]>(() => {
    if (isProject16) {
      return [
        { key: '__display_date', label: 'Date', width: '7%' },
        { key: '__received_time', label: 'Rec Time', width: '8%' },
        { key: 'order_number', label: 'Order ID', width: '20%' },
        { key: '__batch_number', label: 'Batch', width: '6%' },
        { key: '__remaining', label: 'Remaining', width: '10%' },
      ];
    }

    if (showCodeQueues.includes(selectedQueue)) {
      return [
        { key: isPhotoEnhancementQueue ? 'received_at' : '__display_date', label: isPhotoEnhancementQueue ? 'Received' : 'Date', width: '7%' },
        ...(selectedQueue === 'HSA' ? [{ key: 'order_number', label: 'Order', width: '9.5%', cellClassName: 'px-3 py-2 font-mono' }] : []),
        { key: 'address', label: 'Address' },
        { key: 'client_name', label: 'Project Code', width: '8%' },
        { key: 'code', label: 'Code', width: '7%' },
        { key: 'plan_type', label: 'Plane Type', width: '10%' },
      ];
    }

    return [
      { key: isPhotoEnhancementQueue ? 'received_at' : '__display_date', label: isPhotoEnhancementQueue ? 'Received' : 'Date', width: '7%' },
      { key: 'order_number', label: 'Order', width: '9.5%' },
      { key: 'VARIANT_no', label: 'Variant', width: '9%' },
      { key: 'address', label: 'Address' },
      { key: 'priority', label: 'Priority', width: '5.5%', headerClassName: 'text-center', cellClassName: 'px-2 py-2 text-center' },
    ];
  }, [isPhotoEnhancementQueue, isProject16, selectedQueue, showCodeQueues]);

  const dynamicPrimaryColumns = useMemo<AssignmentTableColumn[]>(() => {
    if (isProject16) return defaultPrimaryColumns;

    const hasSavedColumnConfig = projectColumns.length > 0;
    const configurableColumns = projectColumns.filter(col => !fixedTrailingFields.has(col.field));
    const allConfigurableColumnsVisible = configurableColumns.length > 0 && configurableColumns.every(col => col.visible);

    const fieldToColumn: Record<string, AssignmentTableColumn> = {
      received_at: {
        key: isPhotoEnhancementQueue ? 'received_at' : '__display_date',
        label: isPhotoEnhancementQueue ? 'Received' : 'Date',
        width: '7%',
      },
      date: {
        key: '__display_date',
        label: 'Date',
        width: '7%',
      },
      rec_time: {
        key: '__received_time',
        label: 'Rec Time',
        width: '8%',
      },
      received_time: {
        key: '__received_time',
        label: 'Rec Time',
        width: '8%',
      },
      batch_number: {
        key: '__batch_number',
        label: 'Batch',
        width: '6%',
      },
      order_number: {
        key: 'order_number',
        label: isProject16 ? 'Order ID' : (selectedQueue === 'HSA' ? 'Order' : 'Order'),
        width: isProject16 ? '20%' : '9.5%',
        cellClassName: selectedQueue === 'HSA' && !isProject16 ? 'px-3 py-2 font-mono' : undefined,
      },
      due_in: {
        key: '__remaining',
        label: 'Remaining',
        width: isProject16 ? '10%' : undefined,
      },
      address: {
        key: 'address',
        label: 'Address',
        width: '14%',
      },
      client_name: {
        key: 'client_name',
        label: 'Project Code',
        width: '8%',
      },
      code: {
        key: 'code',
        label: 'Code',
        width: '7%',
      },
      plan_type: {
        key: 'plan_type',
        label: 'Plane Type',
        width: '10%',
      },
      it_datetime: {
        key: 'it_datetime',
        label: 'IT DateTime',
        width: '10%',
      },
      total_raw_files: {
        key: 'total_raw_files',
        label: 'Total Raw Files',
        width: '6%',
      },
      hdr_images_count: {
        key: 'hdr_images_count',
        label: 'HDR Images',
        width: '6%',
      },
      single_images_count: {
        key: 'single_images_count',
        label: 'Single Images',
        width: '6%',
      },
      final_images_count: {
        key: 'final_images_count',
        label: 'Final Images',
        width: '6%',
      },
      edited_images_count: {
        key: 'edited_images_count',
        label: 'Edited Images',
        width: '6%',
      },
      vf_count: {
        key: 'vf_count',
        label: 'VF Count',
        width: '6%',
      },
      flambient_order_count: {
        key: 'flambient_order_count',
        label: 'Flambient',
        width: '6%',
      },
      day_to_dusk_count: {
        key: 'day_to_dusk_count',
        label: 'Day to Dusk',
        width: '6%',
      },
      object_removal_count: {
        key: 'object_removal_count',
        label: 'Object Removal',
        width: '6%',
      },
      VARIANT_no: {
        key: 'VARIANT_no',
        label: 'Variant',
        width: '9%',
      },
      priority: {
        key: 'priority',
        label: 'Priority',
        width: '5.5%',
        headerClassName: 'text-center',
        cellClassName: 'px-2 py-2 text-center',
      },
      instruction: {
        key: 'instruction',
        label: 'Instruction',
      },
      instructions: {
        key: 'instruction',
        label: 'Instruction',
      },
      comment: {
        key: 'instruction',
        label: 'Instruction',
      },
      comments: {
        key: 'instruction',
        label: 'Instruction',
      },
    };

    const visibleColumns = projectColumns
      .filter(col => col.visible && !fixedTrailingFields.has(col.field))
      .flatMap((col) => {
        if (isProject16 && col.field === 'received_at') {
          return [
            {
              key: '__display_date',
              label: col.label || 'Date',
              width: '7%',
            },
            {
              key: '__received_time',
              label: 'Rec Time',
              width: '8%',
            },
          ];
        }
        if (col.field === 'received_at') {
          return [{
            key: isPhotoEnhancementQueue ? 'received_at' : '__display_date',
            label: col.label || (isPhotoEnhancementQueue ? 'Received' : 'Date'),
            width: '7%',
          }];
        }

        const mappedColumn = fieldToColumn[col.field];
        if (!mappedColumn) {
          const rawWidth = Number(col.width);
          return [{
            key: col.field,
            label: col.label || col.name || col.field,
            width: Number.isFinite(rawWidth) && rawWidth > 0 ? `${Math.max(rawWidth, 60)}px` : undefined,
            headerClassName: 'text-left',
          }];
        }

        return [{
          ...mappedColumn,
          label: col.label || mappedColumn.label,
        }];
      })
      .filter((col): col is AssignmentTableColumn => col !== null);

    if (!hasSavedColumnConfig) return defaultPrimaryColumns;
    if (allConfigurableColumnsVisible) return defaultPrimaryColumns;
    if (visibleColumns.length === 0) return [];

    return visibleColumns;
  }, [defaultPrimaryColumns, fixedTrailingFields, isPhotoEnhancementQueue, isProject16, projectColumns, selectedQueue]);

  const visiblePrimaryFieldSet = useMemo(() => new Set(dynamicPrimaryColumns.map(col => col.key)), [dynamicPrimaryColumns]);
  const hasItDateTimeEditorFields = useMemo(() => {
    if (!showItDateTimeEditor) return false;

    const orderData = showItDateTimeEditor as unknown as Record<string, unknown>;

    return [
      'received_at',
      'total_raw_files',
      'hdr_images_count',
      'single_images_count',
      'final_images_count',
      'edited_images_count',
      'vf_count',
      'flambient_order_count',
      'day_to_dusk_count',
      'object_removal_count',
    ].some((field) => {
      if (visiblePrimaryFieldSet.has(field)) return true;

      const value = orderData[field];
      return value != null && String(value).trim() !== '';
    });
  }, [showItDateTimeEditor, visiblePrimaryFieldSet]);
  const showRemainingInline = !isProject16 && visiblePrimaryFieldSet.has('address');
  const showPlanTypeEditor = visiblePrimaryFieldSet.has('plan_type');
  const showCodeEditor = visiblePrimaryFieldSet.has('code');
  const visibleRoleColumns = useMemo<AssignmentRoleColumn[]>(() => {
    const roleColumnMap: Record<AssignmentRoleColumn['key'], AssignmentRoleColumn> = {
      drawer_name: { key: 'drawer_name', label: isPhotoEnhancementQueue ? 'Designer' : 'Drawer', width: '13%', role: 'drawer' },
      checker_name: { key: 'checker_name', label: 'Checker', width: '13%', role: 'checker' },
      file_uploader_name: { key: 'file_uploader_name', label: 'Filler', width: '13%', role: 'filler' },
      qa_name: { key: 'qa_name', label: 'QA', width: '13%', role: 'qa' },
    };

    const withRequiredRoleColumns = (columns: AssignmentRoleColumn[]) => {
      if (!allowDirectCheckerAssignment) return columns;

      const configuredChecker = columns.find((column) => column.key === 'checker_name');

      if (!isProject16) {
        return configuredChecker ? columns : [roleColumnMap.checker_name, ...columns];
      }

      const configuredDrawer = columns.find((column) => column.key === 'drawer_name');
      const configuredQa = columns.find((column) => column.key === 'qa_name');

      return [
        configuredDrawer || roleColumnMap.drawer_name,
        configuredChecker || roleColumnMap.checker_name,
        configuredQa || roleColumnMap.qa_name,
      ];
    };

    const configuredRoleColumns = projectColumns.filter((column) => column.field in roleColumnMap);

    if (configuredRoleColumns.length === 0) {
      return withRequiredRoleColumns([
        roleColumnMap.drawer_name,
        roleColumnMap.checker_name,
        roleColumnMap.qa_name,
      ]);
    }

    const selectedRoleColumns = configuredRoleColumns
      .filter((column) => column.visible)
      .map((column) => ({
        ...roleColumnMap[column.field as AssignmentRoleColumn['key']],
        label: column.label || roleColumnMap[column.field as AssignmentRoleColumn['key']].label,
      }));

    if (selectedRoleColumns.length === 0) {
      return withRequiredRoleColumns([
        roleColumnMap.drawer_name,
        roleColumnMap.checker_name,
        roleColumnMap.qa_name,
      ]);
    }

    return withRequiredRoleColumns(selectedRoleColumns);
  }, [allowDirectCheckerAssignment, isPhotoEnhancementQueue, isProject16, projectColumns]);
  const integerOnlyColumns = useMemo(() => new Set([
    'hdr_images_count',
    'single_images_count',
    'final_images_count',
    'edited_images_count',
    'flambient_order_count',
    'day_to_dusk_count',
    'object_removal_count',
    'VARIANT_no',
    '__batch_number',
  ]), []);

  const getAdjustedColumnWidths = useCallback((column: AssignmentTableColumn) => {
    const totalColumnsCount = dynamicPrimaryColumns.length + visibleRoleColumns.length + (showTeamNameColumn ? 1 : 0) + 1;
    const isCrowded = totalColumnsCount > 8;

    if (column.key === 'instruction') {
      return isCrowded ? { width: '100px', maxWidth: '120px' } : { width: undefined };
    }

    // Integer-only columns need less space
    if (integerOnlyColumns.has(column.key)) {
      if (isCrowded) {
        return { width: '5%', minWidth: '50px' };
      }
      if (column.width?.endsWith('%')) {
        const percentVal = Number.parseFloat(column.width);
        return { width: `${Math.min(percentVal, 6)}%` };
      }
      return { width: column.width };
    }

    // Address column needs reasonable fixed width
    if (column.key === 'address') {
      if (isCrowded) {
        return { width: '12%', minWidth: '100px' };
      }
      return { width: undefined };
    }

    if (!column.width) return { width: undefined };

    if (isCrowded) {
      if (column.width.endsWith('%')) {
        const percentVal = Number.parseFloat(column.width);
        const reduced = Math.max(percentVal * 0.75, 5.5);
        return { width: `${reduced}%` };
      }

      if (column.width.endsWith('px')) {
        const pxVal = Number.parseInt(column.width, 10);
        const reduced = Math.max(Math.floor(pxVal * 0.75), 50);
        return { width: `${reduced}px` };
      }
    }

    return { width: column.width };
  }, [dynamicPrimaryColumns.length, visibleRoleColumns.length, showTeamNameColumn, integerOnlyColumns]);
  const exportColumns = useMemo(() => {
    const primaryColumns = dynamicPrimaryColumns
      .filter((column) => column.key !== 'area')
      .map((column) => ({ ...column }));

    if (isPhotoEnhancementQueue) {
      primaryColumns.push(
        { key: 'ph_total_images', label: 'Total Images' },
        { key: 'ph_edited_images', label: 'Edited Images' },
        { key: 'ph_final_images', label: 'Final Images' },
      );
    } else {
      primaryColumns.push(
        { key: 'area_feet', label: 'Area Feet' },
        { key: 'area_meter', label: 'Area Meter' },
      );
    }

    if (isProject50) {
      const existingKeys = new Set(primaryColumns.map((column) => column.key));
      PROJECT_50_REPORT_COLUMNS.forEach((column) => {
        if (!existingKeys.has(column.key)) {
          primaryColumns.push(column);
        }
      });
    }

    return [
      { key: '__received_at_datetime', label: 'Received At Date Time' },
      { key: '__due_in_datetime', label: 'Due In Date Time' },
      ...primaryColumns,
      ...(showTeamNameColumn ? [{ key: '__team_name', label: 'Team' }] : []),
      ...visibleRoleColumns.map((column) => ({ key: column.key, label: column.label })),
      { key: 'workflow_state', label: 'Status' },
    ];
  }, [dynamicPrimaryColumns, isPhotoEnhancementQueue, isProject50, showTeamNameColumn, visibleRoleColumns]);

  const ASSIGNMENT_EXPORT_PAGE_RETRIES = 5;
  const ASSIGNMENT_EXPORT_RETRY_DELAY_MS = 800;

  const waitForAssignmentExportRetry = (attempt: number) => new Promise<void>((resolve) => {
    window.setTimeout(resolve, ASSIGNMENT_EXPORT_RETRY_DELAY_MS * attempt);
  });

  const buildAssignmentExportParams = useCallback((page: number, perPage: number) => {
    const params: Record<string, string | number> = { page, per_page: perPage };

    if (statusFilter !== 'all' && statusFilter !== 'cancelled' && statusFilter !== 'unassigned' && statusFilter !== 'pending') {
      params.status = statusFilter;
    }
    if (searchQuery) params.search = searchQuery;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (selectedWorker) params.assigned_to = selectedWorker;

    return params;
  }, [endDate, searchQuery, selectedWorker, startDate, statusFilter]);

  const fetchAssignmentExportPage = useCallback(async (page: number, perPage: number) => {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= ASSIGNMENT_EXPORT_PAGE_RETRIES; attempt += 1) {
      try {
        return await dashboardService.assignmentDashboard(selectedQueue, buildAssignmentExportParams(page, perPage));
      } catch (error) {
        lastError = error;
        console.error(`CSV/month export page ${page} failed, attempt ${attempt}:`, error);
        if (attempt < ASSIGNMENT_EXPORT_PAGE_RETRIES) {
          await waitForAssignmentExportRetry(attempt);
        }
      }
    }

    throw lastError ?? new Error(`Could not fetch export page ${page}.`);
  }, [buildAssignmentExportParams, selectedQueue]);

  const fetchAllOrdersForExport = useCallback(async () => {
    const perPage = 2000;
    const allOrders: AssignmentOrder[] = [];
    let page = 1;
    let lastAvailablePage = 1;

    do {
      const res = await fetchAssignmentExportPage(page, perPage);
      const fetchedOrders = (res.data?.orders?.data ?? []) as AssignmentOrder[];
      allOrders.push(...fetchedOrders);

      const responseLastPage = Number(res.data?.orders?.last_page ?? page);
      lastAvailablePage = Number.isFinite(responseLastPage) && responseLastPage > 0 ? responseLastPage : page;
      page += 1;
    } while (page <= lastAvailablePage);

    const filteredOrders = allOrders.filter((order) => {
      if (statusFilter === 'cancelled') {
        return (order.workflow_state || '').toUpperCase().includes('CANCEL');
      }

      if (statusFilter === 'pending') {
        return isPendingOrder(order);
      }

      if (statusFilter === 'unassigned') {
        return !hasDrawerAssignment(order);
      }

      return true;
    });

    return filteredOrders;
  }, [
    fetchAssignmentExportPage,
    hasDrawerAssignment,
    isPendingOrder,
    statusFilter,
  ]);

  const formatAreaForExport = useCallback((value: unknown) => {
    if (value == null) return '-';

    const raw = String(value).trim();
    if (raw === '') return '-';

    const numericCandidate = raw.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(numericCandidate)) {
      return raw;
    }

    const meterValue = Number(numericCandidate);
    if (!Number.isFinite(meterValue)) {
      return raw;
    }

    const squareFeetValue = Math.round(meterValue * 10.7639);
    const meterDisplay = Number.isInteger(meterValue)
      ? String(meterValue)
      : meterValue.toFixed(2).replace(/\.?0+$/, '');

    return `${meterDisplay}m/${squareFeetValue}f`;
  }, []);

  const getAreaExportParts = useCallback((order: AssignmentOrder) => {
    const metadata = ((order as any).metadata || {}) as Record<string, unknown>;
    const areaValue = (order as any).area ?? metadata.enter_area ?? metadata.area;

    if (areaValue == null) {
      return { meter: '-', feet: '-' };
    }

    const raw = String(areaValue).trim();
    if (raw === '') {
      return { meter: '-', feet: '-' };
    }

    const numericCandidate = raw.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(numericCandidate)) {
      return { meter: raw, feet: raw };
    }

    const meterValue = Number(numericCandidate);
    if (!Number.isFinite(meterValue)) {
      return { meter: raw, feet: raw };
    }

    const meterDisplay = Number.isInteger(meterValue)
      ? String(meterValue)
      : meterValue.toFixed(2).replace(/\.?0+$/, '');

    return {
      meter: meterDisplay,
      feet: String(Math.round(meterValue * 10.7639)),
    };
  }, []);

  const getPhotoEnhancementExportParts = useCallback((order: AssignmentOrder) => {
    const orderData = order as unknown as Record<string, unknown>;
    const metadata = (((order as any).metadata || {}) as Record<string, unknown>);
    const instructionText = String(getOrderInstructionValue(order as AssignmentOrder & Record<string, any>) || '');

    const getValue = (...keys: string[]) => {
      for (const key of keys) {
        const value = metadata[key];
        if (value != null && String(value).trim() !== '') {
          return String(value).trim();
        }
      }
      return '';
    };

    const extractFromInstruction = (pattern: RegExp) => {
      const match = instructionText.match(pattern);
      return match?.[1]?.trim() || '';
    };

    const getOrderFieldValue = (...keys: string[]) => {
      for (const key of keys) {
        const value = orderData[key];
        if (value != null && String(value).trim() !== '') {
          return String(value).trim();
        }
      }
      return '';
    };

    const total = getOrderFieldValue('total_raw_files', 'total_images', 'totalImages')
      || getValue('total_images', 'totalImages')
      || extractFromInstruction(/Total\s*:\s*(\d+)/i);
    const edited = getOrderFieldValue('edited_images_count', 'edited_images', 'editedImages')
      || getValue('edited_images_count', 'edited_images', 'editedImages')
      || extractFromInstruction(/Edited\s*:\s*(\d+)/i);
    const final = getOrderFieldValue('final_images_count', 'final_images', 'finalImages')
      || getValue('final_images', 'finalImages')
      || extractFromInstruction(/Final\s*:\s*(\d+)/i);

    return {
      total: total || '-',
      edited: edited || '-',
      final: final || '-',
    };
  }, [getOrderInstructionValue]);

  const fmtExportDate = useCallback((t: string | null) => {
    const parsed = parseDisplayDateValue(t);
    if (!parsed) return '-';

    return `${Number(parsed.month)}/${Number(parsed.day)}/${parsed.year}`;
  }, [parseDisplayDateValue]);

  const fmtExportDateTime = useCallback((t: string | null) => {
    const parsed = parseStoredDateTime(t);
    if (!parsed) return '-';

    return `${Number(parsed.month)}/${Number(parsed.day)}/${parsed.year} ${parsed.hour}:${parsed.minute}:${parsed.second}`;
  }, [parseStoredDateTime]);

  const fmtDueInExportDateTime = useCallback((t: string | null) => {
    if (!t) return '-';

    const trimmed = t.trim();
    const slashDateTimeMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (slashDateTimeMatch) {
      return `${Number(slashDateTimeMatch[1])}/${Number(slashDateTimeMatch[2])}/${slashDateTimeMatch[3]} ${String(Number(slashDateTimeMatch[4])).padStart(2, '0')}:${slashDateTimeMatch[5]}:${slashDateTimeMatch[6] ?? '00'}`;
    }

    return fmtExportDateTime(trimmed);
  }, [fmtExportDateTime]);

  const fmtOrderExportDate = useCallback((order: AssignmentOrder) => {
    return fmtExportDate(getOrderDisplayDateSource(order));
  }, [fmtExportDate, getOrderDisplayDateSource]);

  const getExportValue = (order: AssignmentOrder, key: string) => {
    switch (key) {
      case '__display_date':
        return fmtOrderExportDate(order);
      case 'received_at':
        return fmtExportDate(order.received_at);
      case '__received_at_datetime':
        return fmtExportDateTime(order.received_at);
      case '__received_time':
        return fmtReceivedTime(order.received_at);
      case '__due_in_datetime':
        return fmtDueInExportDateTime(order.due_in);
      case '__batch_number':
        return String((order as any).batch_number || '-');
      case '__remaining':
      case 'due_in': {
        const ms = parseDueIn(order.due_in, order.received_at);
        if (ms === null) return '-';
        const totalMin = Math.floor(ms / 60000);
        const overdue = totalMin < 0;
        const absTotalMin = Math.abs(totalMin);
        const hrs = Math.floor(absTotalMin / 60);
        const mins = absTotalMin % 60;
        return overdue
          ? (hrs > 0 ? `-${hrs}h ${mins}m` : `-${mins}m`)
          : (hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`);
      }
      case 'workflow_state':
        return (order.workflow_state || 'PENDING').replace(/_/g, ' ');
      case '__team_name':
        return getOrderTeamName(order);
      case 'instruction':
      case 'instructions':
      case 'comment':
      case 'comments': {
        const instructionValue = getOrderInstructionValue(order as AssignmentOrder & Record<string, any>);
        return instructionValue == null || instructionValue === '' ? '-' : String(instructionValue);
      }
      case 'area':
        return formatAreaForExport((order as any).area ?? (((order as any).metadata || {}) as Record<string, unknown>).enter_area ?? (((order as any).metadata || {}) as Record<string, unknown>).area);
      case 'area_feet':
        return getAreaExportParts(order).feet;
      case 'area_meter':
        return getAreaExportParts(order).meter;
      case 'ph_total_images':
        return getPhotoEnhancementExportParts(order).total;
      case 'ph_edited_images':
        return getPhotoEnhancementExportParts(order).edited;
      case 'ph_final_images':
        return getPhotoEnhancementExportParts(order).final;
      default: {
        if (key.startsWith('project_50_')) {
          const metadata = (((order as any).metadata || {}) as Record<string, unknown>);
          const value = (order as any)[key] ?? metadata[key];
          return value == null || value === '' ? '0' : String(value);
        }

        const value = (order as any)[key];
        return value == null || value === '' ? '-' : String(value);
      }
    }
  };

  const downloadBlobParts = (parts: BlobPart[], type: string, filename: string) => {
    const blob = new Blob(parts, { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const MONTH_PDF_EXPORT_CACHE_KEY = 'supervisor-assignment-month-pdf-export';
  const PDF_EXPORT_CHUNK_SIZE = 200;
  const PDF_EXPORT_CHUNK_RETRIES = 3;

  const waitForPdfExportFrame = () => new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0);
  });

  const savePdfExportCheckpoint = (checkpoint: {
    key: string;
    filename: string;
    totalRows: number;
    completedRows: number;
    completedPages: number;
    updatedAt: string;
  }) => {
    try {
      window.sessionStorage.setItem(MONTH_PDF_EXPORT_CACHE_KEY, JSON.stringify(checkpoint));
    } catch (error) {
      console.warn('Unable to save PDF export checkpoint:', error);
    }
  };

  const clearPdfExportCheckpoint = () => {
    try {
      window.sessionStorage.removeItem(MONTH_PDF_EXPORT_CACHE_KEY);
    } catch (error) {
      console.warn('Unable to clear PDF export checkpoint:', error);
    }
  };

  const generateMonthPdf = async (
    filenameBase: string,
    headers: string[],
    rows: string[][],
    dateRangeLabel: string,
  ) => {
    const { default: jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const exportKey = [
      filenameBase,
      headers.join('|'),
      rows.length,
      rows[0]?.join('|') ?? '',
      rows[rows.length - 1]?.join('|') ?? '',
    ].join('::');

    doc.setFontSize(14);
    doc.text(`Orders Export - ${projectLabel || selectedQueue}`, 14, 14);
    doc.setFontSize(9);
    doc.text(dateRangeLabel, 14, 20);

    let completedRows = 0;
    let startY = 26;

    while (completedRows < rows.length) {
      const chunkStart = completedRows;
      const chunkRows = rows.slice(chunkStart, chunkStart + PDF_EXPORT_CHUNK_SIZE);
      let rendered = false;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= PDF_EXPORT_CHUNK_RETRIES && !rendered; attempt += 1) {
        try {
          autoTable(doc, {
            startY,
            head: chunkStart === 0 ? [headers] : undefined,
            body: chunkRows,
            styles: {
              fontSize: 7,
              cellPadding: 2,
              overflow: 'linebreak',
              minCellHeight: 4,
            },
            headStyles: { fillColor: [42, 167, 160] },
            margin: { left: 10, right: 10, top: 14, bottom: 12 },
            showHead: chunkStart === 0 ? 'firstPage' : 'never',
            rowPageBreak: 'auto',
          });

          rendered = true;
        } catch (error) {
          lastError = error;
          console.error(`PDF export chunk failed at row ${chunkStart + 1}, attempt ${attempt}:`, error);
          await waitForPdfExportFrame();
        }
      }

      if (!rendered) {
        savePdfExportCheckpoint({
          key: exportKey,
          filename: `${filenameBase}.pdf`,
          totalRows: rows.length,
          completedRows,
          completedPages: doc.getNumberOfPages(),
          updatedAt: new Date().toISOString(),
        });
        throw lastError ?? new Error(`PDF export failed at row ${chunkStart + 1}.`);
      }

      completedRows += chunkRows.length;
      const lastAutoTable = (doc as any).lastAutoTable;
      startY = Number(lastAutoTable?.finalY ?? 0) + 4;
      if (!Number.isFinite(startY) || startY > 185) {
        doc.addPage();
        startY = 14;
      }

      savePdfExportCheckpoint({
        key: exportKey,
        filename: `${filenameBase}.pdf`,
        totalRows: rows.length,
        completedRows,
        completedPages: doc.getNumberOfPages(),
        updatedAt: new Date().toISOString(),
      });
      await waitForPdfExportFrame();
    }

    doc.save(`${filenameBase}.pdf`);
    clearPdfExportCheckpoint();
  };

  const downloadBackendCsvExport = async (filenameBase: string, hasDateRangeFilter: boolean) => {
    const params: Record<string, string | number> = {
      status: statusFilter,
      columns: JSON.stringify(exportColumns.map((column) => ({ key: column.key, label: column.label }))),
    };

    if (searchQuery) params.search = searchQuery;
    if (selectedWorker) params.assigned_to = selectedWorker;

    if (hasDateRangeFilter) {
      if (startDate) params.start_date = startDate;
      if (endDate) params.end_date = endDate;
    } else if (exportMonth) {
      const [year, month] = exportMonth.split('-').map(Number);
      const lastDay = new Date(year, month, 0).getDate();
      params.start_date = `${exportMonth}-01`;
      params.end_date = `${exportMonth}-${String(lastDay).padStart(2, '0')}`;
      params.month = exportMonth;
    }

    const response = await dashboardService.assignmentDashboardCsvExport(selectedQueue, params);
    const contentDisposition = String(response.headers?.['content-disposition'] || '');
    const filenameMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
    const filename = filenameMatch?.[1] || `${filenameBase}.csv`;
    downloadBlobParts([response.data], 'text/csv;charset=utf-8;', filename);
  };

  const handleMonthExport = async (type: 'csv' | 'pdf') => {
    // Check if date range filters are active, otherwise require exportMonth
    const hasDateRangeFilter = !!(startDate || endDate);

    if (!hasDateRangeFilter && !exportMonth) {
      toast({ title: 'Select month', description: 'Choose a month first.', type: 'error' });
      return;
    }

    // Build filename based on available date filters
    let filenameBase = `${selectedQueue || 'orders'}`;
    if (hasDateRangeFilter) {
      if (startDate && endDate) {
        filenameBase += `_${startDate}_to_${endDate}`;
      } else if (startDate) {
        filenameBase += `_from_${startDate}`;
      } else if (endDate) {
        filenameBase += `_until_${endDate}`;
      }
    } else {
      filenameBase += `_${exportMonth}`;
    }

    try {
      setExportingType(type);
      if (type === 'csv') {
        await downloadBackendCsvExport(filenameBase, hasDateRangeFilter);
        const timeframeLabel = hasDateRangeFilter ? 'date range' : 'month';
        toast({ title: 'CSV ready', description: `Download started for the selected ${timeframeLabel}.`, type: 'success' });
        return;
      }

      const exportOrders = await fetchAllOrdersForExport();

      // Filter orders: use date range if provided, otherwise use month filter
      let filteredOrders: AssignmentOrder[];

      if (hasDateRangeFilter) {
        // Filter by date range
        filteredOrders = exportOrders.filter((order) => {
          const orderDate = getOrderDisplayDateSource(order);
          if (!orderDate) return false;

          // Parse order date to YYYY-MM-DD format for comparison
          const parsed = parseDisplayDateValue(orderDate);
          if (!parsed) return false;

          const orderDateStr = `${parsed.year}-${parsed.month}-${parsed.day}`;

          if (startDate && orderDateStr < startDate) return false;
          if (endDate && orderDateStr > endDate) return false;

          return true;
        });
      } else {
        // Fall back to month-based filtering if no date range is set
        filteredOrders = exportOrders.filter((order) => fmtOrderMonthKey(order) === exportMonth);
      }

      if (filteredOrders.length === 0) {
        const message = hasDateRangeFilter
          ? `No orders are available for the selected date range (${startDate || 'start'} to ${endDate || 'end'}).`
          : 'No orders are available for the selected month.';
        toast({ title: 'No orders found', description: message, type: 'error' });
        return;
      }

      const headers = exportColumns.map((column) => column.label);
      const rows = filteredOrders.map((order, orderIndex) => exportColumns.map((column) => {
        try {
          return getExportValue(order, column.key);
        } catch (error) {
          console.error(`Export value failed for order row ${orderIndex + 1}, column ${column.key}:`, error);
          return '-';
        }
      }));

      const dateRangeLabel = hasDateRangeFilter
        ? `Date Range: ${startDate || 'start'} to ${endDate || 'end'}`
        : `Month: ${exportMonth}`;
      await generateMonthPdf(filenameBase, headers, rows, dateRangeLabel);

      const timeframeLabel = hasDateRangeFilter ? 'date range' : 'month';
      toast({ title: 'PDF ready', description: `${filteredOrders.length} orders exported for the selected ${timeframeLabel}.`, type: 'success' });
    } catch (error) {
      console.error(error);
      toast({ title: 'Export failed', description: `Could not export ${type.toUpperCase()}.`, type: 'error' });
    } finally {
      setExportingType(null);
    }
  };

  const handleUpdateProject51PortalAccount = useCallback(async (
    order: AssignmentOrder,
    accountType: 'editor' | 'qc',
    accountIdValue: string,
  ) => {
    const accountId = Number(accountIdValue);
    const accounts = accountType === 'editor'
      ? project51PortalAccounts.editors
      : project51PortalAccounts.qc_accounts;
    const account = accounts.find((item) => item.id === accountId);

    if (!account || order.project_id !== 51) {
      return;
    }

    const accountLabel = account.name || account.resource_name;
    const cellKey = `${order.id}:${accountType}`;

    try {
      setUpdatingPortalAccountCell(cellKey);
      await workflowService.updateInstruction(order.id, {
        project_id: order.project_id,
        ...(accountType === 'editor'
          ? { editor_portal_account_id: account.id }
          : { qc_portal_account_id: account.id }),
      });

      setOrders((prev) => prev.map((item) => item.id === order.id ? {
        ...item,
        ...(accountType === 'editor'
          ? {
            editor_portal_account_id: account.id,
            editor_login_name: accountLabel,
          }
          : {
            qc_portal_account_id: account.id,
            qc_account_name: accountLabel,
          }),
      } : item));

      toast({
        title: accountType === 'editor' ? 'Editor account updated' : 'QC account updated',
        description: `${accountLabel} saved for order ${order.order_number}.`,
        type: 'success',
      });
      setPortalAccountMenu(null);
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Account update failed',
        description: e?.response?.data?.message
          || e?.response?.data?.errors?.editor_portal_account_id?.[0]
          || e?.response?.data?.errors?.qc_portal_account_id?.[0]
          || 'Could not update account name.',
        type: 'error',
      });
    } finally {
      setUpdatingPortalAccountCell(null);
    }
  }, [project51PortalAccounts.editors, project51PortalAccounts.qc_accounts, toast]);

  const handleOpenProject51PortalAccountMenu = (
    event: React.MouseEvent<HTMLButtonElement>,
    order: AssignmentOrder,
    accountType: 'editor' | 'qc',
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();

    setPortalAccountMenu((current) => (
      current?.order.id === order.id && current.accountType === accountType
        ? null
        : {
          order,
          accountType,
          left: rect.left,
          top: rect.bottom + 4,
          width: Math.max(rect.width, 150),
        }
    ));
  };

  const renderPrimaryCell = (order: AssignmentOrder, column: AssignmentTableColumn) => {
    const openItEditor = () => {
      setShowItDateTimeEditor(order);
      setItDateTimeDraft(toDateTimeLocalValue((order as any).it_datetime));
      setReceivedAtDraft(toDateTimeLocalValue(order.received_at));
      setTotalRawFilesDraft((order as any).total_raw_files == null ? '' : String((order as any).total_raw_files));
      setHdrImagesCountDraft((order as any).hdr_images_count == null ? '' : String((order as any).hdr_images_count));
      setSingleImagesCountDraft((order as any).single_images_count == null ? '' : String((order as any).single_images_count));
      setFinalImagesCountDraft((order as any).final_images_count == null ? '' : String((order as any).final_images_count));
      setEditedImagesCountDraft((order as any).edited_images_count == null ? '' : String((order as any).edited_images_count));
      setVfCountDraft((order as any).vf_count == null ? '' : String((order as any).vf_count));
      setFlambientOrderCountDraft((order as any).flambient_order_count == null ? '' : String((order as any).flambient_order_count));
      setDayToDuskCountDraft((order as any).day_to_dusk_count == null ? '' : String((order as any).day_to_dusk_count));
      setObjectRemovalCountDraft((order as any).object_removal_count == null ? '' : String((order as any).object_removal_count));
    };
    const instructionValue = getOrderInstructionValue(order as AssignmentOrder & Record<string, any>);
    const rawValue = column.key === 'instruction'
      ? instructionValue
      : (order as any)[column.key];
    const orderNumberValue = typeof order.order_number === 'string' ? order.order_number.trim() : '';
    const shouldExpandOrderNumber = orderNumberValue !== '' && !orderNumberValue.includes(' ');
    const isContextMenuCell = column.key === 'order_number' || column.key === 'address';
    const contextMenuCellProps = isContextMenuCell
      ? {
        onContextMenu: (e: React.MouseEvent<HTMLTableCellElement>) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ order, x: e.clientX, y: e.clientY });
        },
        title: 'Right click for order actions',
      }
      : {};
    const instructionCellProps = column.key === 'instruction'
      ? {
        onContextMenu: (e: React.MouseEvent<HTMLTableCellElement>) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu(null);
          setShowInstructionEditor(order);
          setInstructionDraft((instructionValue ?? '').toString());
          setPlanTypeDraft((order.plan_type ?? '').toString());
          setCodeDraft((order.code ?? '').toString());
        },
        title: 'Right click to edit instruction',
      }
      : {};
    const planTypeCellProps = column.key === 'plan_type' && showPlanTypeEditor
      ? {
        onContextMenu: (e: React.MouseEvent<HTMLTableCellElement>) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu(null);
          setShowInstructionEditor(order);
          setInstructionDraft((instructionValue ?? '').toString());
          setPlanTypeDraft((order.plan_type ?? '').toString());
          setCodeDraft((order.code ?? '').toString());
        },
        title: 'Right click to edit instruction and plan type',
      }
      : {};
    const codeCellProps = column.key === 'code' && showCodeEditor
      ? {
        onContextMenu: (e: React.MouseEvent<HTMLTableCellElement>) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu(null);
          setShowInstructionEditor(order);
          setInstructionDraft((instructionValue ?? '').toString());
          setPlanTypeDraft((order.plan_type ?? '').toString());
          setCodeDraft((order.code ?? '').toString());
        },
        title: 'Right click to edit instruction, plan type, and code',
      }
      : {};
    const itDateTimeCellProps = column.key === 'it_datetime'
      ? {
        onContextMenu: (e: React.MouseEvent<HTMLTableCellElement>) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu(null);
          openItEditor();
        },
        title: 'Right click to edit IT date time',
      }
      : {};
    const additionalTimingAndCountCellProps = [
      'received_at',
      'total_raw_files',
      'hdr_images_count',
      'single_images_count',
      'final_images_count',
      'edited_images_count',
      'vf_count',
      'flambient_order_count',
      'day_to_dusk_count',
      'object_removal_count',
    ].includes(column.key)
      ? {
        onContextMenu: (e: React.MouseEvent<HTMLTableCellElement>) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu(null);
          openItEditor();
        },
        title: 'Right click to edit timing and image counts',
      }
      : {};

    switch (column.key) {
      case '__display_date':
        return (
          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
            <div>{fmtOrderDisplayDate(order)}</div>
            {order.received_at && (
              <div className="text-xs font-semibold text-slate-700">
                {fmtReceivedTime(order.received_at)}
              </div>
            )}
          </td>
        );

      case '__batch_number':
        return <td className="px-3 py-2 text-slate-700">{(order as any).batch_number || '-'}</td>;

      case '__received_time':
        return <td className="px-2 py-2 text-slate-600">{fmtReceivedTime(order.received_at)}</td>;

      case '__remaining':
      case 'due_in':
        return (
          <td className="px-3 py-2">
            {!(order.workflow_state?.includes('COMPLETE') || order.workflow_state?.includes('DELIVER')) && (
              <RemainingBadge dueIn={order.due_in} receivedAt={order.received_at} />
            )}
          </td>
        );

      case 'order_number':
        return (
          <td
            {...contextMenuCellProps}
            className={`${column.cellClassName || 'px-3 py-2'} ${isContextMenuCell ? 'cursor-context-menu' : ''} ${shouldExpandOrderNumber ? 'min-w-[220px]' : ''}`}
          >
            <div className={`font-semibold text-slate-900 ${shouldExpandOrderNumber ? 'break-all' : ''}`}>{order.order_number || '-'}</div>
            {order.amend && (
              <span className="text-[10px] text-amber-600 font-medium">AMEND</span>
            )}
          </td>
        );

      case 'address':
        return (
          <td
            {...contextMenuCellProps}
            className={`${column.cellClassName || 'px-3 py-2'} ${isContextMenuCell ? 'cursor-context-menu' : ''}`}
          >
            {order.address || '-'}
            {showRemainingInline && !(order.workflow_state?.includes('COMPLETE') || order.workflow_state?.includes('DELIVER')) && (
              <div className="mt-1">
                <RemainingBadge dueIn={order.due_in} receivedAt={order.received_at} />
              </div>
            )}
          </td>
        );

      case 'priority': {
        const normalizedPriority = order.priority?.toUpperCase() || 'REG';
        const priorityClassName =
          normalizedPriority === 'HIGH'
            ? 'bg-red-100 text-red-700'
            : normalizedPriority === 'URGENT'
              ? 'bg-orange-100 text-orange-700'
              : normalizedPriority === 'RUSH'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-slate-100 text-slate-600';
        return (
          <td className={column.cellClassName || 'px-2 py-2 text-center'}>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${priorityClassName}`}>
              {normalizedPriority}
            </span>
          </td>
        );
      }

      case 'instruction':
        return (
          <td
            {...instructionCellProps}
            className={`${column.cellClassName || 'px-3 py-2 text-slate-700'} cursor-context-menu`}
          >
            <div className="block w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px]">
              {rawValue == null || rawValue === '' ? '-' : String(rawValue)}
            </div>
          </td>
        );

      case 'code':
        return (
          <td
            {...codeCellProps}
            className={`${column.cellClassName || 'px-3 py-2 font-semibold text-slate-900'} ${showCodeEditor ? 'cursor-context-menu' : ''}`}
          >
            {order.code || '-'}
          </td>
        );

      case 'plan_type':
        return (
          <td
            {...planTypeCellProps}
            className={`${column.cellClassName || 'px-3 py-2 text-slate-700'} ${showPlanTypeEditor ? 'cursor-context-menu' : ''}`}
          >
            {order.plan_type || '-'}
          </td>
        );

      case 'it_datetime':
        return (
          <td
            {...itDateTimeCellProps}
            className={`${column.cellClassName || 'px-3 py-2 text-slate-700'} cursor-context-menu`}
          >
            {fmtProjectDateTime((order as any).it_datetime || null)}
          </td>
        );

      case 'received_at':
      case 'fixing_started_at':
      case 'fixing_completed_at':
        return (
          <td
            {...additionalTimingAndCountCellProps}
            className={`px-3 py-2 text-slate-600 ${column.key === 'received_at' ? 'cursor-context-menu' : ''}`}
          >
            {column.key === 'received_at' ? (
              <>
                <div>{fmtOrderDisplayDate(order)}</div>
                {order.received_at && (
                  <div className="text-xs font-semibold text-slate-700">
                    {fmtReceivedTime(order.received_at)}
                  </div>
                )}
              </>
            ) : (
              fmtProjectDateTime((order as any)[column.key] || null)
            )}
          </td>
        );

      case 'fixing_time_seconds':
        return (
          <td className={column.cellClassName || 'px-3 py-2 text-slate-700'}>
            {fmtSecondsDuration((order as any).fixing_time_seconds)}
          </td>
        );

      case 'editor_login_name':
        if (order.project_id === 51 && project51PortalAccounts.editors.length > 0) {
          const cellKey = `${order.id}:editor`;
          const selectedEditorAccount = project51PortalAccounts.editors.find(
            (account) => account.id === Number(order.editor_portal_account_id)
          );
          const editorAccountLabel = selectedEditorAccount
            ? (selectedEditorAccount.name || selectedEditorAccount.resource_name)
            : (order.editor_login_name || '-');
          return (
            <td className={column.cellClassName || 'px-3 py-2 text-slate-700'}>
              <button
                type="button"
                onClick={(e) => handleOpenProject51PortalAccountMenu(e, order, 'editor')}
                disabled={updatingPortalAccountCell === cellKey}
                className="group -mx-1 inline-flex w-full items-center justify-between gap-1 rounded px-1 py-0.5 text-left text-[11px] text-slate-700 transition-colors hover:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-500/30 disabled:opacity-60"
              >
                <span className="truncate">{editorAccountLabel}</span>
                <ChevronDown className="h-3 w-3 flex-shrink-0 text-slate-400 group-hover:text-brand-600" />
              </button>
            </td>
          );
        }

        return (
          <td className={column.cellClassName || 'px-3 py-2 text-slate-700'}>
            {order.editor_login_name || '-'}
          </td>
        );

      case 'qc_account_name':
        if (order.project_id === 51 && project51PortalAccounts.qc_accounts.length > 0) {
          const cellKey = `${order.id}:qc`;
          const selectedQcAccount = project51PortalAccounts.qc_accounts.find(
            (account) => account.id === Number(order.qc_portal_account_id)
          );
          const qcAccountLabel = selectedQcAccount
            ? (selectedQcAccount.name || selectedQcAccount.resource_name)
            : (order.qc_account_name || '-');
          return (
            <td className={column.cellClassName || 'px-3 py-2 text-slate-700'}>
              <button
                type="button"
                onClick={(e) => handleOpenProject51PortalAccountMenu(e, order, 'qc')}
                disabled={updatingPortalAccountCell === cellKey}
                className="group -mx-1 inline-flex w-full items-center justify-between gap-1 rounded px-1 py-0.5 text-left text-[11px] text-slate-700 transition-colors hover:bg-brand-50 focus:outline-none focus:ring-1 focus:ring-brand-500/30 disabled:opacity-60"
              >
                <span className="truncate">{qcAccountLabel}</span>
                <ChevronDown className="h-3 w-3 flex-shrink-0 text-slate-400 group-hover:text-brand-600" />
              </button>
            </td>
          );
        }

        return (
          <td className={column.cellClassName || 'px-3 py-2 text-slate-700'}>
            {order.qc_account_name || '-'}
          </td>
        );

      case 'total_raw_files':
      case 'hdr_images_count':
      case 'single_images_count':
      case 'final_images_count':
      case 'edited_images_count':
      case 'vf_count':
      case 'flambient_order_count':
      case 'day_to_dusk_count':
      case 'object_removal_count':
        return (
          <td
            {...additionalTimingAndCountCellProps}
            className={`${column.cellClassName || 'px-3 py-2 text-slate-700'} cursor-context-menu`}
          >
            {rawValue == null || rawValue === '' ? '-' : String(rawValue)}
          </td>
        );

      default:
        return (
          <td className={column.cellClassName || 'px-3 py-2 text-slate-700'}>
            {rawValue == null || rawValue === '' ? '-' : String(rawValue)}
          </td>
        );
    }
  };

  const getStatusLabel = (workflowState?: string | null) => {
    if (!workflowState) return 'PENDING';
    if (workflowState.includes('COMPLETE') || workflowState.includes('DELIVER')) return 'Delivered';
    return workflowState.replace(/_/g, ' ');
  };

  const isCancelableState = useCallback((workflowState?: string | null) => {
    const normalized = (workflowState || '').toUpperCase();
    return !normalized.includes('CANCEL') && !normalized.includes('DELIVER');
  }, []);

  const handleCancelOrder = async () => {
    if (!showCancelOrder || cancelReason.trim().length < 5) return;

    try {
      setCancellingOrderId(showCancelOrder.id);
      const targetOrder = showCancelOrder;
      const res = await workflowService.cancelOrder(targetOrder.id, cancelReason.trim(), targetOrder.project_id);

      setOrders((prev) => prev.map((order) => (
        order.id === targetOrder.id
          ? { ...order, workflow_state: 'CANCELLED' }
          : order
      )));

      setShowCancelOrder(null);
      setCancelReason('');
      toast({
        title: 'Order cancelled',
        description: res.data?.message || `Order ${targetOrder.order_number} has been cancelled.`,
        type: 'success',
      });
      loadData(currentPage, true);
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Cancel failed',
        description: e?.response?.data?.message || 'Could not cancel the order.',
        type: 'error',
      });
    } finally {
      setCancellingOrderId(null);
    }
  };

  const handleUpdateInstruction = async () => {
    if (!showInstructionEditor) return;

    try {
      setUpdatingInstructionId(showInstructionEditor.id);
      const targetOrder = showInstructionEditor;
      const nextInstruction = instructionDraft.trim() || null;
      const nextPlanType = showPlanTypeEditor
        ? (planTypeDraft.trim() || null)
        : (targetOrder.plan_type || null);
      const nextCode = showCodeEditor
        ? (codeDraft.trim() || targetOrder.code || '')
        : (targetOrder.code || '');
      const res = await workflowService.updateInstruction(targetOrder.id, {
        project_id: targetOrder.project_id,
        instruction: nextInstruction,
        plan_type: nextPlanType,
        code: nextCode,
      });

      setOrders((prev) => prev.map((order) => (
        order.id === targetOrder.id
          ? {
            ...order,
            instruction: nextInstruction,
            instructions: nextInstruction,
            supervisor_notes: nextInstruction,
            plan_type: nextPlanType,
            code: nextCode,
            metadata: {
              ...(((order as any).metadata || {}) as Record<string, unknown>),
              instruction: nextInstruction,
            },
          }
          : order
      )));

      setShowInstructionEditor(null);
      setInstructionDraft('');
      setPlanTypeDraft('');
      setCodeDraft('');
      toast({
        title: (showPlanTypeEditor || showCodeEditor) ? 'Order details updated' : 'Instruction updated',
        description: res.data?.message || `${(showPlanTypeEditor || showCodeEditor) ? 'Instruction, plan type, and code' : 'Instruction'} saved for order ${targetOrder.order_number}.`,
        type: 'success',
      });
      loadData(currentPage, true);
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Update failed',
        description: e?.response?.data?.message || `Could not update the ${(showPlanTypeEditor || showCodeEditor) ? 'order details' : 'instruction'}.`,
        type: 'error',
      });
    } finally {
      setUpdatingInstructionId(null);
    }
  };

  const handleUpdateItDateTime = async () => {
    if (!showItDateTimeEditor) return;

    const parseOptionalNonNegativeInteger = (value: string): number | null => {
      const trimmed = value.trim();
      if (trimmed === '') return null;
      if (!/^\d+$/.test(trimmed)) return NaN;
      return Number(trimmed);
    };

    try {
      setUpdatingItDateTimeId(showItDateTimeEditor.id);
      const targetOrder = showItDateTimeEditor;
      const currentValue = toApiDateTimeValue(toDateTimeLocalValue((targetOrder as any).it_datetime || null));
      const nextValue = toApiDateTimeValue(itDateTimeDraft);
      const currentReceivedAt = toApiDateTimeValue(toDateTimeLocalValue(targetOrder.received_at || null));
      const nextReceivedAt = toApiDateTimeValue(receivedAtDraft);
      const nextTotalRawFiles = totalRawFilesDraft.trim() === '' ? null : totalRawFilesDraft.trim();
      const nextHdrImagesCount = parseOptionalNonNegativeInteger(hdrImagesCountDraft);
      const nextSingleImagesCount = parseOptionalNonNegativeInteger(singleImagesCountDraft);
      const nextFinalImagesCount = parseOptionalNonNegativeInteger(finalImagesCountDraft);
      const nextEditedImagesCount = parseOptionalNonNegativeInteger(editedImagesCountDraft);
      const nextVfCount = vfCountDraft.trim() === '' ? null : vfCountDraft.trim();
      const nextFlambientOrderCount = parseOptionalNonNegativeInteger(flambientOrderCountDraft);
      const nextDayToDuskCount = parseOptionalNonNegativeInteger(dayToDuskCountDraft);
      const nextObjectRemovalCount = parseOptionalNonNegativeInteger(objectRemovalCountDraft);

      if (
        Number.isNaN(nextHdrImagesCount)
        || Number.isNaN(nextSingleImagesCount)
        || Number.isNaN(nextFinalImagesCount)
        || Number.isNaN(nextEditedImagesCount)
        || Number.isNaN(nextFlambientOrderCount)
        || Number.isNaN(nextDayToDuskCount)
        || Number.isNaN(nextObjectRemovalCount)
      ) {
        toast({
          title: 'Invalid counts',
          description: 'Image count fields must be whole numbers (0 or greater).',
          type: 'error',
        });
        return;
      }

      const currentTotalRawFiles = (targetOrder as any).total_raw_files == null ? null : String((targetOrder as any).total_raw_files);
      const currentHdrImagesCount = (targetOrder as any).hdr_images_count ?? null;
      const currentSingleImagesCount = (targetOrder as any).single_images_count ?? null;
      const currentFinalImagesCount = (targetOrder as any).final_images_count ?? null;
      const currentEditedImagesCount = (targetOrder as any).edited_images_count ?? null;
      const currentVfCount = (targetOrder as any).vf_count == null ? null : String((targetOrder as any).vf_count);
      const currentFlambientOrderCount = (targetOrder as any).flambient_order_count ?? null;
      const currentDayToDuskCount = (targetOrder as any).day_to_dusk_count ?? null;
      const currentObjectRemovalCount = (targetOrder as any).object_removal_count ?? null;

      if (
        currentValue === nextValue
        && currentReceivedAt === nextReceivedAt
        && currentTotalRawFiles === nextTotalRawFiles
        && currentHdrImagesCount === nextHdrImagesCount
        && currentSingleImagesCount === nextSingleImagesCount
        && currentFinalImagesCount === nextFinalImagesCount
        && currentEditedImagesCount === nextEditedImagesCount
        && currentVfCount === nextVfCount
        && currentFlambientOrderCount === nextFlambientOrderCount
        && currentDayToDuskCount === nextDayToDuskCount
        && currentObjectRemovalCount === nextObjectRemovalCount
      ) {
        setShowItDateTimeEditor(null);
        setItDateTimeDraft('');
        setReceivedAtDraft('');
        setTotalRawFilesDraft('');
        setHdrImagesCountDraft('');
        setSingleImagesCountDraft('');
        setFinalImagesCountDraft('');
        setEditedImagesCountDraft('');
        setVfCountDraft('');
        setFlambientOrderCountDraft('');
        setDayToDuskCountDraft('');
        setObjectRemovalCountDraft('');
        toast({
          title: 'No changes',
          description: 'Timing and image count values are unchanged.',
          type: 'success',
        });
        return;
      }

      const payload: {
        project_id: number;
        it_datetime?: string | null;
        received_at?: string | null;
        total_raw_files?: string | null;
        hdr_images_count?: number | null;
        single_images_count?: number | null;
        final_images_count?: number | null;
        edited_images_count?: number | null;
        vf_count?: string | null;
        flambient_order_count?: number | null;
        day_to_dusk_count?: number | null;
        object_removal_count?: number | null;
      } = {
        project_id: targetOrder.project_id,
      };
      if (currentValue !== nextValue) payload.it_datetime = nextValue;
      if (currentReceivedAt !== nextReceivedAt) payload.received_at = nextReceivedAt;
      if (currentTotalRawFiles !== nextTotalRawFiles) payload.total_raw_files = nextTotalRawFiles;
      if (currentHdrImagesCount !== nextHdrImagesCount) payload.hdr_images_count = nextHdrImagesCount;
      if (currentSingleImagesCount !== nextSingleImagesCount) payload.single_images_count = nextSingleImagesCount;
      if (currentFinalImagesCount !== nextFinalImagesCount) payload.final_images_count = nextFinalImagesCount;
      if (currentEditedImagesCount !== nextEditedImagesCount) payload.edited_images_count = nextEditedImagesCount;
      if (currentVfCount !== nextVfCount) payload.vf_count = nextVfCount;
      if (currentFlambientOrderCount !== nextFlambientOrderCount) payload.flambient_order_count = nextFlambientOrderCount;
      if (currentDayToDuskCount !== nextDayToDuskCount) payload.day_to_dusk_count = nextDayToDuskCount;
      if (currentObjectRemovalCount !== nextObjectRemovalCount) payload.object_removal_count = nextObjectRemovalCount;

      const res = await workflowService.updateInstruction(targetOrder.id, payload);

      setOrders((prev) => prev.map((order) => (
        order.id === targetOrder.id
          ? {
            ...order,
            ...(payload.it_datetime !== undefined ? { it_datetime: nextValue } : {}),
            ...(payload.received_at !== undefined ? { received_at: nextReceivedAt } : {}),
            ...(payload.total_raw_files !== undefined ? { total_raw_files: nextTotalRawFiles } : {}),
            ...(payload.hdr_images_count !== undefined ? { hdr_images_count: nextHdrImagesCount } : {}),
            ...(payload.single_images_count !== undefined ? { single_images_count: nextSingleImagesCount } : {}),
            ...(payload.final_images_count !== undefined ? { final_images_count: nextFinalImagesCount } : {}),
            ...(payload.edited_images_count !== undefined ? { edited_images_count: nextEditedImagesCount } : {}),
            ...(payload.vf_count !== undefined ? { vf_count: nextVfCount } : {}),
            ...(payload.flambient_order_count !== undefined ? { flambient_order_count: nextFlambientOrderCount } : {}),
            ...(payload.day_to_dusk_count !== undefined ? { day_to_dusk_count: nextDayToDuskCount } : {}),
            ...(payload.object_removal_count !== undefined ? { object_removal_count: nextObjectRemovalCount } : {}),
          }
          : order
      )));

      setShowItDateTimeEditor(null);
      setItDateTimeDraft('');
      setReceivedAtDraft('');
      setTotalRawFilesDraft('');
      setHdrImagesCountDraft('');
      setSingleImagesCountDraft('');
      setFinalImagesCountDraft('');
      setEditedImagesCountDraft('');
      setFlambientOrderCountDraft('');
      setDayToDuskCountDraft('');
      setObjectRemovalCountDraft('');
      toast({
        title: 'Order timing and counts updated',
        description: res.data?.message || `Updated timing/count fields for order ${targetOrder.order_number}.`,
        type: 'success',
      });
      loadData(currentPage, true);
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Update failed',
        description: e?.response?.data?.message || 'Could not update timing/count fields.',
        type: 'error',
      });
    } finally {
      setUpdatingItDateTimeId(null);
    }
  };

  const urgentOrderIds = useMemo(() => {
    return new Set(
      sortedOrders
        .filter((order) => {
          const ms = parseDueIn(order.due_in, order.received_at);
          const normalizedState = (order.workflow_state || '').toUpperCase();
          return ms !== null
            && ms <= 3 * 60 * 60 * 1000
            && !normalizedState.includes('CANCEL')
            && !normalizedState.includes('COMPLETE')
            && !normalizedState.includes('DELIVER');
        })
        .map((order) => order.id)
    );
  }, [parseDueIn, sortedOrders]);

  useEffect(() => {
    urgentOrderIds.forEach((orderId) => {
      if (urgentBlinkTriggeredRef.current.has(orderId)) return;

      urgentBlinkTriggeredRef.current.add(orderId);
      setBlinkingUrgentOrderIds((prev) => new Set(prev).add(orderId));

      window.setTimeout(() => {
        setBlinkingUrgentOrderIds((prev) => {
          const next = new Set(prev);
          next.delete(orderId);
          return next;
        });
      }, 5_000);
    });

    urgentBlinkTriggeredRef.current.forEach((orderId) => {
      if (urgentOrderIds.has(orderId)) return;
      urgentBlinkTriggeredRef.current.delete(orderId);
      setBlinkingUrgentOrderIds((prev) => {
        if (!prev.has(orderId)) return prev;
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    });
  }, [urgentOrderIds]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);

    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [contextMenu]);

  return (
    <AnimatedPage>
      <div className="flex h-[calc(100vh-4rem)]">
        {/* Left sidebar: workers */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }} animate={{ width: 300, opacity: 1 }} exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="flex-shrink-0 overflow-hidden hidden lg:block"
            >
              <div className="w-[300px] h-full bg-white rounded-xl ring-1 ring-black/[0.04] flex flex-col mr-4">
                {/* Header */}
                <div className="p-4 border-b border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="h-5 w-5 text-[#2AA7A0]" />
                    <h3 className="font-semibold text-slate-900">Team Members</h3>
                    <span className="ml-auto text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{allWorkers.length}</span>
                  </div>

                  {/* Quick Stats Grid */}
                  <div className="grid grid-cols-4 gap-2 mb-3">
                    <div className="text-center p-2 bg-green-50 rounded-lg">
                      <div className="text-lg font-bold text-green-600">{onlineCount}</div>
                      <div className="text-[10px] text-green-600">Online</div>
                    </div>
                    <div className="text-center p-2 bg-rose-50 rounded-lg">
                      <div className="text-lg font-bold text-rose-600">{absentCount}</div>
                      <div className="text-[10px] text-rose-600">Absent</div>
                    </div>
                    <div className="text-center p-2 bg-amber-50 rounded-lg">
                      <div className="text-lg font-bold text-amber-600">{wipCount}</div>
                      <div className="text-[10px] text-amber-600">WIP</div>
                    </div>
                    <div className="text-center p-2 bg-blue-50 rounded-lg">
                      <div className="text-lg font-bold text-blue-600">{doneToday}</div>
                      <div className="text-[10px] text-blue-600">Done</div>
                    </div>
                  </div>

                  {showClientSummaryCard && (
                    <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-slate-900">Clients</div>
                          <div className="text-[10px] text-slate-500">Filtered clients with all and completed orders</div>
                        </div>
                        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
                          {clientOrderSummary.length}
                        </span>
                      </div>

                      {clientOrderSummary.length === 0 ? (
                        <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-400">
                          No client orders found
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {clientOrderSummary.map((client) => (
                            <div
                              key={client.name}
                              className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-xs"
                            >
                              <span className="truncate pr-2 font-medium text-slate-700" title={client.name}>
                                {client.name}
                              </span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                                  All {client.total}
                                </span>
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                                  Done {client.completed}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Role Filter Pills */}
                  <div className="flex gap-1 flex-wrap mb-2">
                    <button onClick={() => { setWorkerRoleFilter(null); setSelectedWorker(null); }}
                      className={`px-2 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${!workerRoleFilter ? 'bg-[#2AA7A0] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                      All
                    </button>
                    {orderedWorkerRoles.map(role => (
                      <button key={role} onClick={() => { setWorkerRoleFilter(role); setSelectedWorker(null); }}
                        className={`px-2 py-1 text-xs rounded-md whitespace-nowrap capitalize transition-colors ${workerRoleFilter === role ? 'bg-[#2AA7A0] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                        {role}s ({(workers[role] || []).length})
                      </button>
                    ))}
                  </div>

                  {/* Search */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input type="text" value={workerSearch} onChange={e => setWorkerSearch(e.target.value)}
                      placeholder="Search workers..."
                      className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 bg-white text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/20 focus:border-[#2AA7A0]" />
                  </div>
                </div>

                {/* Workers List */}
                <div className="flex-1 overflow-y-auto p-2">
                  {searchedWorkers.length === 0 ? (
                    <div className="text-center py-8 text-slate-500">
                      <Users className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-sm">No workers found</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {searchedWorkers.map(w => (
                        <button key={w.id} onClick={() => setSelectedWorker(selectedWorker === w.id ? null : w.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left ${selectedWorker === w.id ? 'bg-[#2AA7A0]/10 border border-[#2AA7A0]/30' : 'hover:bg-slate-50 border border-transparent'
                            }`}>
                          {/* Avatar */}
                          <div className="relative flex-shrink-0">
                            <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold ${w.is_absent ? 'bg-slate-400' : 'bg-[#2AA7A0]'
                              }`}>
                              {w.name.charAt(0).toUpperCase()}
                            </div>
                            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${w.is_absent ? 'bg-rose-500' : w.is_online ? 'bg-green-500' : 'bg-amber-500'
                              }`} />
                          </div>
                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`font-medium text-sm truncate ${w.is_absent ? 'text-slate-400' : 'text-slate-900'}`}>#{w.id} - {w.name}</span>
                              {w.is_absent && <AlertTriangle className="h-3 w-3 text-rose-500 flex-shrink-0" />}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <span className="capitalize">{w.role}</span>
                              <span>-</span>
                              <span className="flex items-center gap-0.5"><Clock className="h-3 w-3" /> WIP: {w.wip_count}</span>
                            </div>
                          </div>
                          {/* Done count */}
                          <div className="text-right flex-shrink-0">
                            <div className="text-sm font-semibold text-brand-600">{w.today_completed}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Clear Selection */}
                {selectedWorker && (
                  <div className="p-3 border-t border-slate-100">
                    <button onClick={() => setSelectedWorker(null)}
                      className="w-full py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors">
                      Clear Selection
                    </button>
                  </div>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Sidebar Toggle Button */}
        <button onClick={() => setSidebarOpen(!sidebarOpen)}
          className="hidden lg:flex items-center justify-center w-6 flex-shrink-0 group"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>
          <div className="w-6 h-12 bg-white hover:bg-brand-50 border border-slate-200 rounded-md flex items-center justify-center transition-colors shadow-sm">
            {sidebarOpen ? <PanelLeftClose className="w-3.5 h-3.5 text-slate-400 group-hover:text-brand-600" /> : <PanelLeftOpen className="w-3.5 h-3.5 text-slate-400 group-hover:text-brand-600" />}
          </div>
        </button>

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="p-4 space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-bold text-slate-900">Assignment Dashboard</h1>
                <p className="text-xs text-slate-500">{projectLabel || 'Select a queue to view assignments'}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <ClockDisplay timezone={projectTz} className="text-sm font-semibold text-slate-800 font-mono" />
                </div>
                <Button variant="secondary" icon={RefreshCw} onClick={() => loadData(currentPage, true)} disabled={refreshing}>
                  {refreshing ? 'Refreshing...' : 'Refresh'}
                </Button>
              </div>
            </div>

            {/* Info banner */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-start gap-3">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-700">
                Auto-assignment is active. Orders are assigned based on WIP capacity.
                {selectedWorker && <span className="font-bold"> Filtered by selected worker.</span>}
              </p>
            </div>

            {/* Queue selector + controls */}
            <div className="flex flex-wrap items-center gap-2">
              <select value={selectedQueue} onChange={e => { setSelectedQueue(e.target.value); }}
                className="select text-sm min-w-[200px]" aria-label="Select queue">
                {queues.map(q => <option key={q.queue_name} value={q.queue_name}>{q.queue_name} ({q.department} - {q.country})</option>)}
              </select>

              {/* Status filter buttons */}
              <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
                {statusButtons.map(sb => (
                  <button key={sb.key} onClick={() => { setStatusFilter(sb.key); }}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${statusFilter === sb.key ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                    {sb.label} <span className="opacity-70">({sb.count})</span>
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative flex-1 min-w-[150px] max-w-xs">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input type="text" placeholder="Search order/client..."
                  value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  className="input pl-8 text-xs h-8" />
                {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2"><X className="w-3 h-3 text-slate-400" /></button>}
              </div>

              {/* Date filter */}
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="input text-xs h-8 w-36"
              />

              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="input text-xs h-8 w-36"
              />

              <input
                type="month"
                value={exportMonth}
                onChange={e => setExportMonth(e.target.value)}
                className="input text-xs h-8 w-36"
                title="Select month to export"
              />

              <Button
                variant="secondary"
                size="sm"
                icon={Download}
                onClick={() => handleMonthExport('csv')}
                disabled={exportingType !== null}
              >
                {exportingType === 'csv' ? 'Exporting CSV...' : 'Month CSV'}
              </Button>

              <Button
                variant="secondary"
                size="sm"
                icon={Download}
                onClick={() => handleMonthExport('pdf')}
                disabled={exportingType !== null}
              >
                {exportingType === 'pdf' ? 'Exporting PDF...' : 'Month PDF'}
              </Button>

              {((startDate || endDate) || selectedWorker) && (
                <button onClick={() => {
                  setStartDate('');
                  setEndDate(''); setSelectedWorker(null); setSearchQuery(''); setStatusFilter('all');
                }}
                  className="text-xs text-brand-600 hover:underline">Clear filters</button>
              )}
            </div>

            {/* Collapsible stats strip */}
            <div className="bg-white rounded-xl border border-slate-200/60 overflow-hidden">
              <button onClick={() => setStatsOpen(!statsOpen)}
                className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-50 transition-colors">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <BarChart3 className="w-4 h-4 text-brand-600" />
                  <span className="font-bold text-slate-700">{counts.today_total} Today</span>
                  <span className="text-brand-600">{counts.assigned} Assigned</span>
                  <span className="text-amber-600">{unassignedOrderCount} Unassigned</span>
                  <span className="text-green-600">{counts.completed} Completed</span>
                  {orderedRoleCompletionEntries.map(([role, rc]) => (
                    <span key={role} className="text-slate-500 capitalize">{role}: <b className="text-slate-700">{rc.today_completed}</b></span>
                  ))}
                  {project51EditorAccountSummary.length > 0 && (
                    <div className="flex max-w-[48%] flex-wrap items-center gap-1 border-l border-slate-200 pl-3">
                      <span className="font-semibold text-slate-600">Editor</span>
                      {project51EditorAccountSummary.map((account) => (
                        <span
                          key={account.id}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            account.count === 0
                              ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                              : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                          }`}
                          title={`${account.label}: ${account.count} active orders`}
                        >
                          {account.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {project51QcAccountSummary.length > 0 && (
                    <div className="flex max-w-[48%] flex-wrap items-center gap-1 border-l border-slate-200 pl-3">
                      <span className="font-semibold text-slate-600">QC</span>
                      {project51QcAccountSummary.map((account) => (
                        <span
                          key={account.id}
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            account.count === 0
                              ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-100'
                              : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                          }`}
                          title={`${account.label}: ${account.count} active orders`}
                        >
                          {account.label}
                        </span>
                      ))}
                    </div>
                  )}
                  {!isProject16 && (
                    <>
                      <span className="border-l border-slate-300 pl-4 text-red-600 font-semibold">
                        {usesPrioritySummaryCount ? 'Priority' : 'High'}: {usesPrioritySummaryCount ? visiblePriorityCounts.priority : visiblePriorityCounts.high}
                      </span>
                      <span className="text-slate-600 font-semibold">Normal: {visiblePriorityCounts.normal}</span>
                      {visiblePriorityCounts.rush > 0 && (
                        <span className="text-purple-600 font-semibold">Rush: {visiblePriorityCounts.rush}</span>
                      )}
                      {visiblePriorityCounts.urgent > 0 && (
                        <span className="text-orange-600 font-semibold">Urgent: {visiblePriorityCounts.urgent}</span>
                      )}
                    </>
                  )}
                </div>
                {statsOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>
              <AnimatePresence>
                {statsOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                    <div className="px-4 pb-3 border-t border-slate-100">
                      <div className="flex gap-3 overflow-x-auto py-2">
                        {dateStats.slice().reverse().map(ds => (
                          <div key={ds.date} className="flex-shrink-0 w-36 bg-slate-50 rounded-lg p-2.5 border border-slate-100">
                            <div className="text-[10px] text-slate-400 font-medium">{ds.day_label} {ds.date.slice(5)}</div>
                            <div className="text-sm font-bold text-slate-800 mt-0.5">{ds.total} orders</div>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 mt-1 text-[10px]">
                              <span className="text-blue-600">Draw: {ds.drawer_done}</span>
                              <span className="text-green-600">Check: {ds.checker_done}</span>
                              <span className="text-purple-600">QA: {ds.qa_done}</span>
                              <span className="text-amber-600">Amend: {ds.amender_done}</span>
                              {hasFillerColumn() && (
                                <span className="text-orange-600">Fill: {ds.filler_done ?? 0}</span>
                              )}
                              <span className="text-brand-600 col-span-2">Delivered: {ds.delivered}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Role completion details */}
                      <div className="flex gap-4 mt-1">
                        {orderedRoleCompletionEntries.map(([role, rc]) => {
                          const Icon = roleIcons[role] || Users;
                          return (
                            <div key={role} className="flex items-center gap-1.5 text-xs text-slate-600">
                              <Icon className="w-3.5 h-3.5 text-slate-400" />
                              <span className="capitalize font-medium">{role}</span>
                              <span className="text-brand-600 font-bold">{rc.today_completed}</span>
                              <span className="text-slate-400">/ {rc.active} active / {rc.total_staff} total</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <Button
                type="button"
                variant={bulkMode ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => {
                  setBulkMode((open) => !open);
                  setBulkSelectedKeys(new Set());
                  setBulkUserId('');
                }}
                icon={<CheckSquare className="h-4 w-4" />}
              >
                Bulk Insert
              </Button>

              {bulkMode && (
                <>
                  <select
                    value={bulkRole}
                    onChange={(event) => {
                      setBulkRole(event.target.value as BulkAssignmentRole);
                      setBulkUserId('');
                      setBulkSelectedKeys(new Set());
                    }}
                    className="h-9 rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    aria-label="Bulk assignment role"
                  >
                    {bulkRoleOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <select
                    value={bulkUserId}
                    onChange={(event) => setBulkUserId(event.target.value)}
                    className="h-9 min-w-[180px] rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    aria-label="Bulk assignment worker"
                  >
                    <option value="">Select {getBulkRoleLabel(bulkRole)}</option>
                    {bulkWorkers.map((worker) => (
                      <option key={worker.id} value={worker.id}>
                        #{worker.id} - {worker.name}
                      </option>
                    ))}
                  </select>

                  <Button
                    type="button"
                    size="sm"
                    disabled={!bulkUserId || selectedBulkOrders.length === 0 || bulkAssigning}
                    loading={bulkAssigning}
                    onClick={handleBulkAssign}
                  >
                    Assign Selected ({selectedBulkOrders.length})
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setBulkSelectedKeys(new Set())}
                    disabled={selectedBulkOrders.length === 0 || bulkAssigning}
                  >
                    Clear
                  </Button>

                  <span className="text-xs text-slate-500">
                    {bulkAssignableOrders.length} assignable on this page
                  </span>
                </>
              )}
            </div>

            {/* Orders table */}
            <div className="bg-white rounded-xl border border-slate-200/60 overflow-hidden">
              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 text-brand-600 animate-spin" />
                  <span className="ml-2 text-sm text-slate-500">Loading orders...</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                      {bulkMode && <col style={{ width: '44px' }} />}
                      {dynamicPrimaryColumns.map((column) => {
                        const adjustedStyle = getAdjustedColumnWidths(column);
                        return (
                          <col
                            key={column.key}
                            style={adjustedStyle.width ? { width: adjustedStyle.width } : undefined}
                          />
                        );
                      })}

                      {showTeamNameColumn && <col style={{ width: '10%' }} />}
                      {visibleRoleColumns.map((column) => (
                        <col key={column.key} style={column.width ? { width: column.width } : undefined} />
                      ))}
                      <col style={{ width: '8%' }} />  {/* Status */}

                    </colgroup>


                    <thead>
                      <tr className="bg-brand-700 text-white">
                        {bulkMode && (
                          <th className="px-2 py-2 text-center font-semibold">
                            <input
                              type="checkbox"
                              checked={allBulkVisibleSelected}
                              onChange={toggleAllBulkVisible}
                              disabled={bulkAssignableOrders.length === 0 || bulkAssigning}
                              className="h-4 w-4 rounded border-white/60 text-brand-600 focus:ring-white"
                              aria-label="Select all assignable orders"
                            />
                          </th>
                        )}
                        {dynamicPrimaryColumns.map((column) => (
                          <th
                            key={column.key}
                            className={`px-3 py-2 font-semibold ${column.headerClassName || 'text-left'}`}
                          >
                            {column.label}
                          </th>
                        ))}

                        {showTeamNameColumn && (
                          <th className="px-3 py-2 text-left font-semibold">
                            Team
                          </th>
                        )}
                        {visibleRoleColumns.map((column) => {
                          const toggleRole = column.role === 'drawer' || column.role === 'checker' || column.role === 'filler' || column.role === 'qa'
                            ? column.role
                            : null;
                          const isActive = globalRoleSort === toggleRole;
                          return (
                            <th
                              key={column.key}
                              className={`px-3 py-2 text-left font-semibold cursor-pointer hover:bg-brand-600 transition-colors ${isActive ? 'bg-brand-600 ring-2 ring-white' : ''}`}
                              onClick={() => toggleRole && setGlobalRoleSort(isActive ? null : toggleRole)}
                              title={toggleRole ? `Click to sort all pages by ${toggleRole}` : undefined}
                            >
                              <span className="text-white/95">{column.label}</span>
                              {isActive && <span className="ml-1">✓</span>}
                            </th>
                          );
                        })}
                        <th className="px-2 py-2 text-center font-semibold">Status</th>

                      </tr>
                    </thead>


                    <tbody>
                      <AnimatePresence>
                        {sortedOrders.map((o, idx) => (
                          <motion.tr key={o.id}
                            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                            transition={{ delay: idx * 0.02 }}
                            className={`border-b border-slate-100 hover:bg-brand-50/40 transition-colors ${o.is_on_hold ? 'bg-red-50/50' : ''} ${recentlyReassignedOrderIds.has(o.id) ? 'bg-amber-50/90 ring-1 ring-inset ring-amber-200' : ''} ${highlightedIds.has(o.id) ? 'new-order-highlight' : ''} ${urgentOrderIds.has(o.id) ? 'bg-red-100/80' : ''} ${blinkingUrgentOrderIds.has(o.id) ? 'animate-pulse' : ''}`}>

                            {bulkMode && (
                              <td className="px-2 py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={bulkSelectedKeys.has(getBulkOrderKey(o)) && isBulkAssignableOrder(o, bulkRole)}
                                  onChange={() => toggleBulkOrder(o)}
                                  disabled={!isBulkAssignableOrder(o, bulkRole) || bulkAssigning}
                                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-30"
                                  aria-label={`Select order ${o.order_number || o.id}`}
                                />
                              </td>
                            )}
                            {dynamicPrimaryColumns.map((column) => (
                              <React.Fragment key={`${o.id}-${column.key}`}>
                                {renderPrimaryCell(o, column)}
                              </React.Fragment>
                            ))}
                            {showTeamNameColumn && <TeamNameCell order={o} />}
                            {false && (
                              <>
                                {/* Date */}
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                                  {o.received_at
                                    ? new Date(o.received_at || '').toLocaleDateString('en-GB', {
                                      day: '2-digit',
                                      month: 'short',
                                    })
                                    : '-'}
                                </td>

                                {isProject16 ? (
                                  <>
                                    {/* Batch */}
                                    <td className="px-3 py-2 text-slate-700">
                                      {(o as any).batch_number || '-'}
                                    </td>

                                    {/* Rec Time */}
                                    <td className="px-2 py-2 text-slate-600">
                                      {fmtReceivedTime(o.received_at)}
                                    </td>

                                    {/* Order */}
                                    <td className="px-3 py-2">
                                      <div className="font-semibold text-slate-900">
                                        {showCodeQueues.includes(selectedQueue) ? o.code || '-' : o.order_number || '-'}
                                      </div>
                                      {o.amend && (
                                        <span className="text-[10px] text-amber-600 font-medium">
                                          AMEND
                                        </span>
                                      )}
                                    </td>

                                    {/* Remaining */}
                                    <td className="px-3 py-2">
                                      {!(o.workflow_state?.includes('COMPLETE') ||
                                        o.workflow_state?.includes('DELIVER')) && (
                                          <RemainingBadge
                                            dueIn={o.due_in}
                                            receivedAt={o.received_at}
                                          />
                                        )}
                                    </td>
                                  </>
                                ) : (
                                  <>
                                    {showCodeQueues.includes(selectedQueue) ? (
                                      <>

                                        {selectedQueue === 'HSA' && (
                                          <td className="px-3 py-2 font-mono">
                                            {o.order_number}
                                          </td>
                                        )}

                                        {/* Address */}
                                        <td className="px-3 py-2">
                                          {o.address || '-'}

                                          {!(o.workflow_state?.includes('COMPLETE') ||
                                            o.workflow_state?.includes('DELIVER')) && (
                                              <div className="mt-1">
                                                <RemainingBadge
                                                  dueIn={o.due_in}
                                                  receivedAt={o.received_at}
                                                />
                                              </div>
                                            )}
                                        </td>

                                        {/* Variant */}
                                        <td className="px-2 py-2 text-slate-600">
                                          {(o as any).client_name || '-'}
                                        </td>

                                        {/* Code */}
                                        <td className="px-3 py-2 font-semibold text-slate-900">
                                          {o.code || '-'}
                                        </td>

                                        {/* Plane Type */}
                                        <td className="px-3 py-2 text-slate-700">
                                          {o.plan_type || '-'}
                                        </td>
                                      </>
                                    ) : (
                                      <>
                                        {/* Order */}
                                        <td className="px-3 py-2">
                                          <div className="font-semibold text-slate-900">
                                            {o.order_number || '-'}
                                          </div>
                                          {o.amend && (
                                            <span className="text-[10px] text-amber-600 font-medium">
                                              AMEND
                                            </span>
                                          )}
                                        </td>

                                        {/* Variant */}
                                        <td className="px-2 py-2 text-slate-600">
                                          {(o as any).VARIANT_no || '-'}
                                        </td>

                                        {/* Address */}
                                        <td className="px-3 py-2">
                                          {o.address || '-'}

                                          {!(o.workflow_state?.includes('COMPLETE') ||
                                            o.workflow_state?.includes('DELIVER')) && (
                                              <div className="mt-1">
                                                <RemainingBadge
                                                  dueIn={o.due_in}
                                                  receivedAt={o.received_at}
                                                />
                                              </div>
                                            )}
                                        </td>

                                        {/* Priority */}
                                        <td className="px-2 py-2 text-center">
                                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600">
                                            {o.priority?.toUpperCase() || 'REG'}
                                          </span>
                                        </td>
                                      </>
                                    )}
                                  </>
                                )}
                              </>
                            )}
                            {visibleRoleColumns.map((column) => {
                              if (column.role === 'drawer') {
                                return (
                                  <RoleCell
                                    key={`${o.id}-${column.key}`}
                                    order={o}
                                    role="drawer"
                                    name={o.drawer_name}
                                    userId={(o as any).drawer_id}
                                    done={o.drawer_done}
                                    color="bg-brand-600"
                                    startTime={o.dassign_time}
                                    endTime={o.drawer_date}
                                  />
                                );
                              }

                              if (column.role === 'checker') {
                                return (
                                  <RoleCell
                                    key={`${o.id}-${column.key}`}
                                    order={o}
                                    role="checker"
                                    name={o.checker_name}
                                    userId={(o as any).checker_id}
                                    done={o.checker_done}
                                    color="bg-blue-600"
                                    startTime={o.cassign_time}
                                    endTime={o.checker_date}
                                  />
                                );
                              }

                              if (column.role === 'filler') {
                                return (
                                  <RoleCell
                                    key={`${o.id}-${column.key}`}
                                    order={o}
                                    role="filler"
                                    name={o.file_uploader_name || null}
                                    userId={(o as any).file_uploader_id}
                                    done={String((o as any).file_uploaded ?? o.final_upload ?? '') || null}
                                    color="bg-sky-600"
                                    startTime={(o as any).fassign_time}
                                    endTime={String((o as any).file_upload_date ?? o.ausFinaldate ?? '') || null}
                                  />
                                );
                              }

                              return (
                                <RoleCell
                                  key={`${o.id}-${column.key}`}
                                  order={o}
                                  role="qa"
                                  name={o.qa_name}
                                  userId={(o as any).qa_id}
                                  done={o.final_upload}
                                  color="bg-purple-600"
                                  startTime={o.checker_date}
                                  endTime={o.ausFinaldate}
                                />
                              );
                            })}
                            {/* Status */}
                            <td className="px-2 py-2 text-center">
                              <div className="inline-flex items-center justify-center gap-1">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${o.workflow_state?.includes('COMPLETE') || o.workflow_state?.includes('DELIVER') ? 'bg-green-100 text-green-700'
                                  : o.workflow_state?.includes('HOLD') ? 'bg-red-100 text-red-700'
                                    : o.workflow_state?.includes('REJECTED') ? 'bg-rose-100 text-rose-700'
                                      : o.workflow_state?.includes('CHECK') ? 'bg-blue-100 text-blue-700'
                                        : o.workflow_state?.includes('QA') ? 'bg-purple-100 text-purple-700'
                                          : o.workflow_state?.includes('DRAW') ? 'bg-brand-100 text-brand-700'
                                            : 'bg-slate-100 text-slate-600'
                                  }`}>
                                  {getStatusLabel(o.workflow_state)}
                                </span>
                                {canOpenOrderAssetLinks(o) && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openCompletedAssetLinks(o);
                                    }}
                                    className="inline-flex items-center justify-center w-6 h-6 rounded-md text-slate-500 hover:text-brand-700 hover:bg-brand-50 transition-colors"
                                    title="View order images"
                                    aria-label="View order images"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                              {o.workflow_state === 'ON_HOLD' && (
                                <button
                                  onClick={() => handleResume(o.id, o.project_id)}
                                  disabled={resumingOrderId === o.id}
                                  className="mt-1 flex items-center gap-1 mx-auto px-2 py-1 rounded-md text-[10px] font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors disabled:opacity-50"
                                  title="Resume this order back to workflow"
                                >
                                  {resumingOrderId === o.id ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Play className="w-3 h-3" />
                                  )}
                                  Resume
                                </button>
                              )}
                            </td>

                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                  {sortedOrders.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                      <Users className="w-10 h-10 mb-2" />
                      <div className="text-sm font-medium">No orders found</div>
                      <div className="text-xs mt-1">{selectedWorker ? 'No orders for this worker' : 'Try changing filters or selecting a different queue'}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Total count */}
              {((statusFilter === 'cancelled' || statusFilter === 'unassigned' || statusFilter === 'pending') ? sortedOrders.length : totalOrders) > 0 && (
                <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">
                    {(statusFilter === 'cancelled' || statusFilter === 'unassigned' || statusFilter === 'pending') ? sortedOrders.length : totalOrders} orders
                    {shouldUseAssignmentPagination && lastPage > 1 ? ` • Page ${currentPage} of ${lastPage}` : ''}
                  </span>
                  {shouldUseAssignmentPagination && lastPage > 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                        disabled={currentPage <= 1 || loading || refreshing}
                        className="px-3 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <div className="flex items-center gap-1">
                        {visiblePaginationItems.map((item, index) => {
                          if (item === 'ellipsis') {
                            return (
                              <span
                                key={`ellipsis-${index}`}
                                className="px-1 text-xs font-medium text-slate-400"
                              >
                                ...
                              </span>
                            );
                          }

                          const isActive = item === currentPage;

                          return (
                            <button
                              key={`page-${item}`}
                              type="button"
                              onClick={() => setCurrentPage(item)}
                              disabled={isActive || loading || refreshing}
                              className={`min-w-[30px] px-2 py-1 rounded-md border text-xs font-semibold transition-colors ${isActive
                                ? 'border-brand-500 bg-brand-50 text-brand-700'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'} disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                              {item}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.min(prev + 1, lastPage))}
                        disabled={currentPage >= lastPage || loading || refreshing}
                        className="px-3 py-1 rounded-md border border-slate-200 bg-white text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reassign Modal */}
      <Modal open={!!showReassign} onClose={() => setShowReassign(null)} title="Re-queue Order"
        subtitle={`Unassign from ${showReassign?.drawer_name || showReassign?.checker_name || 'worker'} and return to queue`}
        variant="warning" size="md"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setShowReassign(null)}>Cancel</Button>
            <Button className="flex-1 bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-500/30"
              onClick={handleReassign} loading={reassigning} disabled={reassignReason.length < 3}>
              Confirm Re-queue
            </Button>
          </>
        }>
        <div className="space-y-5">
          <div className="p-4 bg-amber-50 border-l-4 border-amber-400 rounded-lg">
            <p className="text-sm text-amber-800">
              Order <span className="font-bold">{showReassign?.order_number}</span> will be unassigned and automatically reassigned to the next available worker.
            </p>
          </div>
          <Textarea id="reassign-reason" label="Reason for Reassignment" required
            value={reassignReason} onChange={e => setReassignReason(e.target.value)}
            placeholder="Explain why this order needs to be reassigned (minimum 3 characters)..."
            rows={4} showCharCount maxLength={300} currentLength={reassignReason.length}
            error={reassignReason.length > 0 && reassignReason.length < 3 ? 'Please provide at least 3 characters' : undefined}
            hint="This will be logged for audit purposes" />
        </div>
      </Modal>

      {/* Checklist Modal */}
      {showChecklist && (
        <ChecklistModal orderId={showChecklist.id} orderNumber={showChecklist.order_number}
          onComplete={() => { setShowChecklist(null); loadData(1, true); }}
          onClose={() => setShowChecklist(null)} />
      )}

      {portalAccountMenu && (() => {
        const accounts = portalAccountMenu.accountType === 'editor'
          ? project51PortalAccounts.editors
          : project51PortalAccounts.qc_accounts;
        const selectedAccountId = portalAccountMenu.accountType === 'editor'
          ? portalAccountMenu.order.editor_portal_account_id
          : portalAccountMenu.order.qc_portal_account_id;

        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPortalAccountMenu(null)} />
            <div
              className="fixed z-50 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-2xl"
              style={{
                top: Math.min(portalAccountMenu.top, window.innerHeight - 280),
                left: Math.min(portalAccountMenu.left, window.innerWidth - portalAccountMenu.width - 12),
                width: portalAccountMenu.width,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {accounts.map((account) => {
                const accountLabel = account.name || account.resource_name;
                const isSelected = Number(selectedAccountId) === account.id;

                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => handleUpdateProject51PortalAccount(portalAccountMenu.order, portalAccountMenu.accountType, String(account.id))}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                      isSelected
                        ? 'bg-brand-50 font-semibold text-brand-700'
                        : 'text-slate-700 hover:bg-brand-50 hover:text-brand-700'
                    }`}
                  >
                    <span className="truncate">{accountLabel}</span>
                    {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-brand-600" />}
                  </button>
                );
              })}
            </div>
          </>
        );
      })()}

      {contextMenu && (
        <div
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 80),
            left: Math.min(contextMenu.x, window.innerWidth - 180),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-center px-3 py-2 text-left text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!isCancelableState(contextMenu.order.workflow_state)}
            onClick={() => {
              setShowCancelOrder(contextMenu.order);
              setCancelReason('');
              setContextMenu(null);
            }}
          >
            Cancel order
          </button>
        </div>
      )}

      <Modal
        open={!!showCancelOrder}
        onClose={() => setShowCancelOrder(null)}
        title="Cancel Order"
        subtitle={`Cancel order ${showCancelOrder?.order_number || ''}`}
        variant="warning"
        size="sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => { setShowCancelOrder(null); setCancelReason(''); }}>
              Keep Order
            </Button>
            <Button
              className="flex-1 bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500/30"
              onClick={handleCancelOrder}
              loading={cancellingOrderId === showCancelOrder?.id}
              disabled={cancelReason.trim().length < 5}
            >
              Confirm Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            This will cancel <span className="font-semibold">{showCancelOrder?.order_number || '-'}</span> from supervisor assignment.
          </div>
          <Textarea
            id="cancel-reason"
            label="Cancel Reason"
            required
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Enter cancel reason (minimum 5 characters)..."
            rows={4}
            showCharCount
            maxLength={300}
            currentLength={cancelReason.length}
            error={cancelReason.length > 0 && cancelReason.trim().length < 5 ? 'Please provide at least 5 characters' : undefined}
            hint="This reason will be sent to the backend and logged."
          />
        </div>
      </Modal>

      <Modal
        open={!!showInstructionEditor}
        onClose={() => {
          setShowInstructionEditor(null);
          setInstructionDraft('');
          setPlanTypeDraft('');
          setCodeDraft('');
        }}
        title={(showPlanTypeEditor || showCodeEditor) ? 'Update Order Details' : 'Update Instruction'}
        subtitle={`Order ${showInstructionEditor?.order_number || ''}`}
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setShowInstructionEditor(null);
                setInstructionDraft('');
                setPlanTypeDraft('');
                setCodeDraft('');
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleUpdateInstruction}
              loading={updatingInstructionId === showInstructionEditor?.id}
            >
              {(showPlanTypeEditor || showCodeEditor) ? 'Save Details' : 'Save Instruction'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {(showPlanTypeEditor || showCodeEditor)
              ? 'Right-clicking the instruction, plan type, or code cell opens this editor for the selected order.'
              : 'Right-clicking the instruction cell opens this editor for the selected order.'}
          </div>
          {showCodeEditor && (
            <Textarea
              id="order-code"
              label="Code"
              value={codeDraft}
              onChange={(e) => setCodeDraft(e.target.value)}
              placeholder="Enter code for this order..."
              rows={3}
              showCharCount
              maxLength={100}
              currentLength={codeDraft.length}
              hint="This code will be updated on the selected order."
            />
          )}
          <Textarea
            id="order-instruction"
            label="Instruction"
            value={instructionDraft}
            onChange={(e) => setInstructionDraft(e.target.value)}
            placeholder="Enter instruction for this order..."
            rows={6}
            showCharCount
            maxLength={1000}
            currentLength={instructionDraft.length}
            hint="This instruction will be updated on the selected order."
          />
          {showPlanTypeEditor && (
            <Textarea
              id="order-plan-type"
              label="Plan Type"
              value={planTypeDraft}
              onChange={(e) => setPlanTypeDraft(e.target.value)}
              placeholder="Enter plan type for this order..."
              rows={3}
              showCharCount
              maxLength={300}
              currentLength={planTypeDraft.length}
              hint="This plan type will be updated on the selected order."
            />
          )}
        </div>
      </Modal>

      <Modal
        open={!!showItDateTimeEditor}
        onClose={() => {
          setShowItDateTimeEditor(null);
          setItDateTimeDraft('');
          setReceivedAtDraft('');
          setTotalRawFilesDraft('');
          setHdrImagesCountDraft('');
          setSingleImagesCountDraft('');
          setFinalImagesCountDraft('');
          setEditedImagesCountDraft('');
          setVfCountDraft('');
          setFlambientOrderCountDraft('');
          setDayToDuskCountDraft('');
          setObjectRemovalCountDraft('');
        }}
        title={hasItDateTimeEditorFields ? 'Update Timing & Counts' : 'Update IT Date Time'}
        subtitle={`Order ${showItDateTimeEditor?.order_number || ''}`}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => {
                setShowItDateTimeEditor(null);
                setItDateTimeDraft('');
                setReceivedAtDraft('');
                setTotalRawFilesDraft('');
                setHdrImagesCountDraft('');
                setSingleImagesCountDraft('');
                setFinalImagesCountDraft('');
                setEditedImagesCountDraft('');
                setVfCountDraft('');
                setFlambientOrderCountDraft('');
                setDayToDuskCountDraft('');
                setObjectRemovalCountDraft('');
              }}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleUpdateItDateTime}
              loading={updatingItDateTimeId === showItDateTimeEditor?.id}
            >
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Right-click IT date/time, received time, or image count cells to open this editor.
          </div>
          <div className="space-y-2">
            <label htmlFor="order-it-datetime" className="block text-sm font-medium text-slate-700">
              IT Date Time
            </label>
            <input
              id="order-it-datetime"
              type="datetime-local"
              value={itDateTimeDraft}
              onChange={(e) => setItDateTimeDraft(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>
          {hasItDateTimeEditorFields && (
            <>
              <div className="space-y-2">
                <label htmlFor="order-received-at" className="block text-sm font-medium text-slate-700">
                  Received At
                </label>
                <input
                  id="order-received-at"
                  type="datetime-local"
                  value={receivedAtDraft}
                  onChange={(e) => setReceivedAtDraft(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              {visiblePrimaryFieldSet.has('total_raw_files') && (
                <div className="space-y-2">
                  <label htmlFor="order-total-raw-files" className="block text-sm font-medium text-slate-700">
                    Total Raw Files
                  </label>
                  <input
                    id="order-total-raw-files"
                    type="text"
                    value={totalRawFilesDraft}
                    onChange={(e) => setTotalRawFilesDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              )}

              {visiblePrimaryFieldSet.has('hdr_images_count') && (
                <div className="space-y-2">
                  <label htmlFor="order-hdr-images-count" className="block text-sm font-medium text-slate-700">
                    HDR Images Count
                  </label>
                  <input
                    id="order-hdr-images-count"
                    type="number"
                    min={0}
                    step={1}
                    value={hdrImagesCountDraft}
                    onChange={(e) => setHdrImagesCountDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              )}

              {visiblePrimaryFieldSet.has('single_images_count') && (
                <div className="space-y-2">
                  <label htmlFor="order-single-images-count" className="block text-sm font-medium text-slate-700">
                    Single Images Count
                  </label>
                  <input
                    id="order-single-images-count"
                    type="number"
                    min={0}
                    step={1}
                    value={singleImagesCountDraft}
                    onChange={(e) => setSingleImagesCountDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              )}

              {visiblePrimaryFieldSet.has('final_images_count') && (
                <div className="space-y-2">
                  <label htmlFor="order-final-images-count" className="block text-sm font-medium text-slate-700">
                    Final Images Count
                  </label>
                  <input
                    id="order-final-images-count"
                    type="number"
                    min={0}
                    step={1}
                    value={finalImagesCountDraft}
                    onChange={(e) => setFinalImagesCountDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              )}

              {visiblePrimaryFieldSet.has('edited_images_count') && (
                <div className="space-y-2">
                  <label htmlFor="order-edited-images-count" className="block text-sm font-medium text-slate-700">
                    Edited Images Count
                  </label>
                  <input
                    id="order-edited-images-count"
                    type="number"
                    min={0}
                    step={1}
                    value={editedImagesCountDraft}
                    onChange={(e) => setEditedImagesCountDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              )}

              {visiblePrimaryFieldSet.has('vf_count') && (
                <div className="space-y-2">
                  <label htmlFor="order-vf-count" className="block text-sm font-medium text-slate-700">
                    VF Count
                  </label>
                  <input
                    id="order-vf-count"
                    type="text"
                    value={vfCountDraft}
                    onChange={(e) => setVfCountDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              )}

              {visiblePrimaryFieldSet.has('flambient_order_count') && (
                <div className="space-y-2">
                  <label htmlFor="order-flambient-count" className="block text-sm font-medium text-slate-700">
                    Flambient Count
                  </label>
                  <input
                    id="order-flambient-count"
                    type="number"
                    min={0}
                    step={1}
                    value={flambientOrderCountDraft}
                    onChange={(e) => setFlambientOrderCountDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              )}

              {visiblePrimaryFieldSet.has('day_to_dusk_count') && (
                <div className="space-y-2">
                  <label htmlFor="order-day-to-dusk-count" className="block text-sm font-medium text-slate-700">
                    Day to Dusk Count
                  </label>
                  <input
                    id="order-day-to-dusk-count"
                    type="number"
                    min={0}
                    step={1}
                    value={dayToDuskCountDraft}
                    onChange={(e) => setDayToDuskCountDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              )}

              {visiblePrimaryFieldSet.has('object_removal_count') && (
                <div className="space-y-2">
                  <label htmlFor="order-object-removal-count" className="block text-sm font-medium text-slate-700">
                    Object Removal Count
                  </label>
                  <input
                    id="order-object-removal-count"
                    type="number"
                    min={0}
                    step={1}
                    value={objectRemovalCountDraft}
                    onChange={(e) => setObjectRemovalCountDraft(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                  />
                </div>
              )}
            </>
          )}
          <div className="text-xs text-slate-500">
            Only changed fields are sent in the same update request endpoint.
          </div>
        </div>
      </Modal>

      {/* Assign role dropdown */}
      {assignDropdown && (
        <>
          {(() => {
            const assignRoleLabel = getRoleDisplayLabel(assignDropdown.role);
            return (
              <>
                {/* Backdrop */}
                <div className="fixed inset-0 z-40" onClick={() => { setAssignDropdown(null); setAssignSearch(''); }} />
                {/* Dropdown panel */}
                <div className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 w-72 max-h-[26rem] flex flex-col overflow-hidden"
                  style={{
                    top: Math.min((assignDropdown.anchorRect?.bottom ?? 200) + 4, window.innerHeight - 430),
                    left: Math.min((assignDropdown.anchorRect?.left ?? 200), window.innerWidth - 304),
                  }}>
                  {/* Header */}
                  <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-700">Assign {assignRoleLabel}</span>
                      <button onClick={() => { setAssignDropdown(null); setAssignSearch(''); }} className="p-0.5 hover:bg-slate-200 rounded">
                        <X className="w-3 h-3 text-slate-400" />
                      </button>
                    </div>
                    {/* Search */}
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                      <input type="text" autoFocus value={assignSearch} onChange={e => setAssignSearch(e.target.value)}
                        placeholder={`Search ${assignRoleLabel}s...`}
                        className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500" />
                    </div>
                  </div>
                  {/* Worker list */}
                  <div className="flex-1 overflow-y-auto">
                    {assigning ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />
                        <span className="ml-2 text-xs text-slate-500">Assigning...</span>
                      </div>
                    ) : showTeamAssignment ? (
                      assignableTeamAssignments.length === 0 ? (
                        <div className="text-center py-6 text-xs text-slate-400">
                          No {assignRoleLabel} teams found
                        </div>
                      ) : (
                        <div className="py-1">
                          {assignableTeamAssignments.map(({ team, workers: teamWorkers, primaryAssignee, assigneeNames }) => (
                            <button key={team.id} onClick={() => primaryAssignee && handleAssignRole(assignDropdown.orderId, assignDropdown.role, primaryAssignee.id)}
                              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-brand-50 transition-colors text-left">
                              <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 bg-[#2AA7A0]">
                                {team.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-medium text-slate-800 truncate">{team.name}</div>
                                <div className="text-[10px] text-slate-400 truncate" title={assigneeNames}>
                                  {assigneeNames || `No ${assignRoleLabel}`}
                                </div>
                              </div>
                              {teamWorkers.length > 1 && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                                  {teamWorkers.length}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      )
                    ) : assignableWorkers.length === 0 ? (
                      <div className="text-center py-6 text-xs text-slate-400">
                        No {assignRoleLabel}s found
                      </div>
                    ) : (
                      <div className="py-1">
                        {assignableWorkers.map(w => (
                          <button key={w.id} onClick={() => handleAssignRole(assignDropdown.orderId, assignDropdown.role, w.id)}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-brand-50 transition-colors text-left">
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${w.is_absent ? 'bg-slate-400' : 'bg-[#2AA7A0]'
                              }`}>{w.name.charAt(0)}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium text-slate-800 truncate">#{w.id} - {w.name}</div>
                              <div className="text-[10px] text-slate-400">WIP: {w.wip_count} - Done: {w.today_completed}</div>
                            </div>
                            {w.is_absent && <span className="text-[10px] text-rose-500 font-medium">Absent</span>}
                            {w.is_online && !w.is_absent && <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </>
      )}
    </AnimatedPage>
  );
}

