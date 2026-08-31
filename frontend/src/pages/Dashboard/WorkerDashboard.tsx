import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { RootState } from '../../store/store';
import { workflowService, columnService } from '../../services';
import { useSmartPolling } from '../../hooks/useSmartPolling';
import type { Order, WorkerDashboardData, ProjectColumn } from '../../types';
import { REJECTION_CODES } from '../../types';
import { AnimatedPage, PageHeader, StatCard, StatusBadge, Modal, Button, Select, Textarea, WorkerDashboardSkeleton } from '../../components/ui';
import { Play, X, Clock, Target, Inbox, CheckCircle, History, BarChart3, TrendingUp, Loader2, ClipboardList, Pencil, Eye, Palette, Info, Upload, UploadCloud, User as UserIcon, Image as ImageIcon } from 'lucide-react';
import { motion } from 'framer-motion';
import DrawerWorkForm from '../../components/DrawerWorkForm';
import CheckerWorkForm from '../../components/CheckerWorkForm';
import FillerWorkForm from '../../components/FillerWorkForm';
import QAWorkForm from '../../components/QAWorkForm';
import DesignerWorkForm from '../../components/DesignerWorkForm';


interface PerformanceStats {
  today_completed: number;
  week_completed: number;
  month_completed: number;
  daily_target: number;
  weekly_target: number;
  weekly_rate: number;
  avg_time_minutes: number;
  daily_stats: Array<{ date: string; day: string; count: number }>;
}

// Role-specific labels and icons
const CLIENT_NAME_PROJECT_IDS = [7, 8, 9, 10, 11, 12, 14, 46, 42,];
const IMAGE_LINK_PROJECT_IDS = [1, 22, 25, 26];
const DESIGNER_PH_IMAGE_LINK_PROJECT_IDS = [22, 23, 25, 26];
const ORDER_NUMBER_IMAGE_LINK_PROJECT_IDS = [22, 23, 25, 26];
const CLIENT_PORTAL_UPLOAD_PROJECT_IDS = [22, 23, 25, 26];

const ROLE_CONFIG: Record<string, { label: string; icon: any; description: string }> = {
  drawer: {
    label: 'Drawing Station',
    icon: Pencil,
    description: 'Create floor plans following specifications'
  },
  checker: {
    label: 'Checking Station',
    icon: ClipboardList,
    description: 'Verify accuracy and document corrections'
  },
  filler: {
    label: 'Filler Station',
    icon: Upload,
    description: 'Verify upload handoff details before QA'
  },
  qa: {
    label: 'QA Station',
    icon: Eye,
    description: 'Final quality check against client standards'
  },
  designer: {
    label: 'Design Station',
    icon: Palette,
    description: 'Enhance photos per design specifications'
  },
};

const DEFAULT_WORKER_DYNAMIC_FIELDS = ['variant', 'priority', 'address', 'instruction'] as const;

const WORKER_COLUMN_ALIASES: Record<string, string[]> = {
  variant: ['variant_no', 'variant', 'variant_number'],
  priority: ['priority'],
  address: ['address'],
  instruction: ['instruction', 'instructions', 'supervisor_notes'],
  plan_type: ['plan_type', 'plantype'],
  client_order_number: ['client_order_number', 'clint_order_number', 'client_order_no'],
};

const DEFAULT_PROJECT_TIMEZONE = 'Asia/Karachi';
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
  if (Number(nextProjectId) === 16) {
    return DEFAULT_PROJECT_TIMEZONE;
  }

  if (isValidTimeZone(nextTimezone)) {
    return String(nextTimezone).trim();
  }

  if (typeof nextTimezone === 'string' && nextTimezone.trim() !== '') {
    console.warn(`Invalid project timezone "${nextTimezone}"${nextCountry ? ` for ${nextCountry}` : ''}. Falling back to ${DEFAULT_PROJECT_TIMEZONE}.`);
  }

  return DEFAULT_PROJECT_TIMEZONE;
};

const normalizeFieldKey = (field: string) => field.trim().toLowerCase();

export default function WorkerDashboard() {
  const navigate = useNavigate();
  const user = useSelector((state: RootState) => state.auth.user);
  const [data, setData] = useState<WorkerDashboardData | null>(null);
  const [currentOrder, setCurrentOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setSubmitting] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCode, setRejectCode] = useState('');
  const [routeTo, setRouteTo] = useState('');
  const [showHold, setShowHold] = useState(false);
  const [holdReason, setHoldReason] = useState('');

  // Stats view state
  const [viewMode, setViewMode] = useState<'work' | 'done' | 'history' | 'stats'>('work');
  const [doneOrders, setDoneOrders] = useState<Order[]>([]);
  const [historyOrders, setHistoryOrders] = useState<Order[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLastPage, setHistoryLastPage] = useState(1);
  const [performanceStats, setPerformanceStats] = useState<PerformanceStats | null>(null);

  // Auto-assignment state
  const [autoAssigning, setAutoAssigning] = useState(false);

  // Manual order assignment protection (prevents polling override)
  const [manualOrderAssigned, setManualOrderAssigned] = useState(false);
  const [manualOrderTimestamp, setManualOrderTimestamp] = useState<number>(0);

  // Checker/QA: all assigned orders list
  const [roleQueue, setRoleQueue] = useState<Order[]>([]);

  // Order started state (controls order ID visibility)
  const [orderStarted, setOrderStarted] = useState(false);
  const [startingOrderId, setStartingOrderId] = useState<number | null>(null);

  // Forms
  const [showDrawerForm, setShowDrawerForm] = useState(false);
  const [showCheckerForm, setShowCheckerForm] = useState(false);
  const [showFillerForm, setShowFillerForm] = useState(false);
  const [showQAForm, setShowQAForm] = useState(false);
  const [showDesignerForm, setShowDesignerForm] = useState(false);

  // Role helpers
  const roleConfig = ROLE_CONFIG[user?.role ?? 'drawer'] || ROLE_CONFIG.drawer;
  const isDrawer = user?.role === 'drawer';
  const isDesigner = user?.role === 'designer';
  const isChecker = user?.role === 'checker';
  const isFiller = user?.role === 'filler';
  const isQA = user?.role === 'qa';
  const isFirstStageWorker = isDrawer || isDesigner;
  const firstStageLabel = isDesigner ? 'Designer' : 'Drawer';
  const holdActionLabel = isFirstStageWorker ? 'Pending' : 'Hold';
  const holdActionTitle = isFirstStageWorker ? 'Move Order to Pending' : 'Put Order On Hold';
  const holdActionSubtitle = isFirstStageWorker
    ? 'Move this order to pending by drawer/fixing until it is reassigned'
    : 'Temporarily pause this order until issues are resolved';
  const isQueueWorker = isFirstStageWorker || isChecker || isFiller || isQA;
  const isProject12Filler = isFiller && user?.project?.id === 12;
  const currentProjectId = currentOrder?.project_id ?? user?.project?.id ?? null;
  const showClientName = currentProjectId != null && CLIENT_NAME_PROJECT_IDS.includes(currentProjectId);
  const [projectTz, setProjectTz] = useState(DEFAULT_PROJECT_TIMEZONE);
  const [projectColumns, setProjectColumns] = useState<ProjectColumn[]>([]);

  useEffect(() => {
    setProjectTz(
      resolveProjectTimezone(
        currentProjectId,
        user?.project?.timezone,
        user?.project?.country,
      )
    );
  }, [currentProjectId, user?.project?.country, user?.project?.timezone]);

  const isOrderForCurrentRole = useCallback((order: Order) => {
    const state = order.workflow_state || '';

    if (isDesigner) {
      return state.includes('DESIGN')
        || ['RECEIVED', 'PENDING_QA_REVIEW', 'REJECTED_BY_QA'].includes(state);
    }

    if (isDrawer) {
      return state.includes('DRAW')
        || ['RECEIVED', 'PENDING_QA_REVIEW', 'REJECTED_BY_CHECK', 'REJECTED_BY_QA'].includes(state);
    }

    if (isChecker) {
      return state.includes('CHECK');
    }

    if (isFiller) {
      return state.includes('FILL');
    }

    if (isQA) {
      return state.includes('QA');
    }

    return false;
  }, [isChecker, isDesigner, isDrawer, isFiller, isQA]);

  useEffect(() => {
    if (!currentProjectId) {
      setProjectColumns([]);
      return;
    }

    let cancelled = false;

    columnService.getAllColumns(currentProjectId)
      .then((res) => {
        if (cancelled) return;
        const cols = res.data?.data ?? [];
        setProjectColumns([...cols].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      })
      .catch((error) => {
        console.error('Failed to load worker project columns:', error);
        if (!cancelled) {
          setProjectColumns([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentProjectId]);

  const hasSavedProjectColumns = projectColumns.length > 0;

  const visibleProjectColumnMap = useMemo(() => {
    const map = new Map<string, ProjectColumn>();

    projectColumns
      .filter((column) => column.visible)
      .forEach((column) => {
        map.set(normalizeFieldKey(column.field), column);
      });

    return map;
  }, [projectColumns]);

  const isProjectFieldVisible = useCallback((field: string) => {
    if (!hasSavedProjectColumns) {
      return DEFAULT_WORKER_DYNAMIC_FIELDS.includes(field as (typeof DEFAULT_WORKER_DYNAMIC_FIELDS)[number]);
    }

    const aliases = WORKER_COLUMN_ALIASES[field] ?? [field];
    return aliases.some((alias) => visibleProjectColumnMap.has(normalizeFieldKey(alias)));
  }, [hasSavedProjectColumns, visibleProjectColumnMap]);

  const getProjectFieldLabel = useCallback((
    field: string,
    fallbackLabel: string,
  ) => {
    if (!hasSavedProjectColumns) {
      return fallbackLabel;
    }

    const aliases = WORKER_COLUMN_ALIASES[field] ?? [field];

    for (const alias of aliases) {
      const column = visibleProjectColumnMap.get(normalizeFieldKey(alias));
      if (column) {
        return column.label || column.name || fallbackLabel;
      }
    }

    return fallbackLabel;
  }, [hasSavedProjectColumns, visibleProjectColumnMap]);

  /**
   * For PH_2_LAYER orders (photo enhancement), show client_order_number when
   * available instead of the internal order_number.
   * Falls back to order_number for all other workflow types.
   */
  const isPhotoEnhancementOrder = useCallback((order: Order): boolean => {
    return order.workflow_type === 'PH_2_LAYER';
  }, []);

  const getPhotoEnhancementClientOrderNumber = useCallback((order: Order): string | null => {
    const raw = order as any;
    const metadata = (order.metadata || {}) as Record<string, string>;
    const value = raw.client_order_number
      || raw.clint_order_number
      || raw.client_order_no
      || metadata.client_order_number
      || metadata.clint_order_number
      || metadata.client_order_no;

    return value ? String(value) : null;
  }, []);

  const getDisplayOrderNumber = useCallback((order: Order): string => {
    const clientOrderNumber = getPhotoEnhancementClientOrderNumber(order);
    if (isPhotoEnhancementOrder(order) && clientOrderNumber) {
      return String(clientOrderNumber);
    }
    return order.order_number;
  }, [getPhotoEnhancementClientOrderNumber, isPhotoEnhancementOrder]);

  const shouldShowOrderAssetsButton = useCallback((order: Order): boolean => {
    if (!order) return false;

    if (isDesigner && ORDER_NUMBER_IMAGE_LINK_PROJECT_IDS.includes(Number(order.project_id))) {
      return true;
    }

    const workflowType = String(order.workflow_type || '').toUpperCase();

    if (workflowType === 'PH_2_LAYER') {
      return isDesigner && DESIGNER_PH_IMAGE_LINK_PROJECT_IDS.includes(Number(order.project_id));
    }

    if (workflowType === 'FP_3_LAYER') {
      return order.project_id === 1 && (isDrawer || isDesigner || isChecker);
    }

    return IMAGE_LINK_PROJECT_IDS.includes(order.project_id)
      && (isDrawer || isDesigner || isChecker);
  }, [isChecker, isDesigner, isDrawer]);

  const shouldShowClientUploadButton = useCallback((order: Order): boolean => {
    if (!order) return false;
    return String(order.workflow_type || '').toUpperCase() === 'PH_2_LAYER'
      && CLIENT_PORTAL_UPLOAD_PROJECT_IDS.includes(Number(order.project_id))
      && isQA;
  }, [isQA]);

  const openClientUploadPage = useCallback((order: Order) => {
    const metadata = (order.metadata || {}) as Record<string, unknown>;
    const jobOrderId = String(
      (order as any).client_portal_id
      || (order as any).client_order_number
      || (order as any).clint_order_number
      || (order as any).client_order_no
      || metadata.client_order_number
      || metadata.clint_order_number
      || metadata.client_order_no
      || order.order_number
      || ''
    ).trim();
    const clientReference = String((order as any).client_reference || metadata.client_reference || '').trim();
    const clientName = String((order as any).client_name || metadata.client_name || '').trim();
    const customerParentCompany = String(
      (order as any).CustomerParentCompany
      || (order as any).customer_parent_company
      || (order as any).parent_company
      || metadata.customer_parent_company
      || metadata.CustomerParentCompany
      || ((metadata.raw_api_response || {}) as Record<string, unknown>).CustomerParentCompany
      || ''
    ).trim();

    const params = new URLSearchParams({
      projectId: String(order.project_id),
      displayOrder: getDisplayOrderNumber(order),
      orderNumber: String(order.order_number || ''),
      clientName,
      CustomerParentCompany: customerParentCompany,
      clientReference,
      jobOrderId,
    });

    navigate(`/client-upload/${order.id}?${params.toString()}`);
  }, [getDisplayOrderNumber, navigate]);

  const getOrderAssetsLookupValue = useCallback((order: Order): string => {
    if ((isDesigner || isQA) && ORDER_NUMBER_IMAGE_LINK_PROJECT_IDS.includes(Number(order.project_id))) {
      return String(order.order_number || '').trim();
    }

    if (isPhotoEnhancementOrder(order)) {
      const clientOrderNumber = getPhotoEnhancementClientOrderNumber(order);
      if (clientOrderNumber) return clientOrderNumber;
    }

    return String(order.order_number || '').trim();
  }, [getPhotoEnhancementClientOrderNumber, isDesigner, isPhotoEnhancementOrder, isQA]);

  const getOrderClientReference = useCallback((order: Order): string => {
    const metadata = (order.metadata || {}) as Record<string, string>;
    const clientReference = String(order.client_reference || metadata.client_reference || '').trim();
    const clientName = String((order as any).client_name || metadata.client_name || '').trim();

    if (IMAGE_LINK_PROJECT_IDS.includes(order.project_id)) {
      if (clientReference && clientName) {
        return `${clientReference} (${clientName})`;
      }
      return clientReference || clientName || '';
    }

    return clientReference || '';
  }, []);

  const shouldShowOrderReference = useCallback((order: Order): boolean => {
    const projectId = Number(order.project_id);

    return (isDesigner || isQA)
      && (IMAGE_LINK_PROJECT_IDS.includes(projectId) || ORDER_NUMBER_IMAGE_LINK_PROJECT_IDS.includes(projectId))
      && getOrderClientReference(order) !== '';
  }, [getOrderClientReference, isDesigner, isQA]);

  const shouldShowQueueReferenceColumn = roleQueue.some((order) => (
    shouldShowOrderReference(order)
  ));

  const openOrderAssetsPage = useCallback((order: Order) => {
    const jobOrderId = getOrderAssetsLookupValue(order);
    if (!jobOrderId) return;

    const metadata = (order.metadata || {}) as Record<string, unknown>;
    const clientOrderNumber = getPhotoEnhancementClientOrderNumber(order)
      || String((order as any).client_order_number || (order as any).clint_order_number || (order as any).client_order_no || metadata.client_order_number || metadata.clint_order_number || metadata.client_order_no || '').trim();

    const params = new URLSearchParams({
      projectId: String(order.project_id),
      displayOrder: getDisplayOrderNumber(order),
      orderNumber: String(order.order_number || ''),
      clientName: String((order as any).client_name || metadata.client_name || ''),
      clientReference: getOrderClientReference(order),
      clientOrderNumber,
    });

    navigate(`/order-assets/${encodeURIComponent(jobOrderId)}?${params.toString()}`);
  }, [getDisplayOrderNumber, getOrderAssetsLookupValue, getOrderClientReference, getPhotoEnhancementClientOrderNumber, navigate]);
  const getDisplayPlanType = useCallback((order: Order): string => {
    const rawPlanType = (order as any).plan_type || ((order.metadata as Record<string, string> | null)?.plan_type);
    return rawPlanType || '—';
  }, []);

  const shouldShowPlanType = useCallback((order: Order): boolean => {
    // Safety rule: always show plan_type for PH workflow even if columns are unavailable.
    if (isPhotoEnhancementOrder(order)) return true;
    return isProjectFieldVisible('plan_type');
  }, [isPhotoEnhancementOrder, isProjectFieldVisible]);

  const isProject12FillerOrder = useCallback((order: Order) => (
    order.project_id === 12
    && ['SUBMITTED_CHECK', 'QUEUED_FILLER', 'IN_FILLER'].includes(order.workflow_state)
    && order.workflow_state !== 'SUBMITTED_FILLER'
  ), []);

  // Filter orders based on role - exclude completed states
  const filterQueueByRole = useCallback((orders: Order[]): Order[] => {
    return orders.filter((order) => {
      const state = order.workflow_state;

      if (!isOrderForCurrentRole(order)) {
        return false;
      }

      // Checker: exclude SUBMITTED_CHECK (already handed to filler)
      if (isChecker) {
        return !['SUBMITTED_CHECK', 'APPROVED_QA', 'DELIVERED', 'CANCELLED'].includes(state);
      }

      // Filler: exclude SUBMITTED_FILLER and all QA states (already handed to QA)
      if (isFiller) {
        return !['SUBMITTED_FILLER', 'QUEUED_QA', 'IN_QA', 'APPROVED_QA', 'DELIVERED', 'CANCELLED'].includes(state);
      }

      // QA: exclude APPROVED_QA (already done)
      if (isQA) {
        return !['APPROVED_QA', 'DELIVERED', 'CANCELLED'].includes(state);
      }

      // First-stage worker: exclude submitted first-stage states
      if (isDesigner) {
        return !['SUBMITTED_DESIGN', 'APPROVED_QA', 'DELIVERED', 'CANCELLED'].includes(state);
      }

      if (isDrawer) {
        return !['SUBMITTED_DRAW', 'APPROVED_QA', 'DELIVERED', 'CANCELLED'].includes(state);
      }

      if (isFirstStageWorker) {
        return !['SUBMITTED_DRAW', 'SUBMITTED_DESIGN', 'DELIVERED', 'CANCELLED'].includes(state);
      }

      return true;
    });
  }, [isChecker, isDesigner, isDrawer, isFiller, isFirstStageWorker, isOrderForCurrentRole, isQA]);

  const mergeOrdersById = useCallback((orders: Order[]) => {
    const seen = new Map<number, Order>();

    orders.forEach((order) => {
      seen.set(order.id, order);
    });

    return Array.from(seen.values());
  }, []);

  /* ── Countdown tick (every 30s) ── */
  const [, setCountdownTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setCountdownTick(t => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  /** Parse due_in "MM/DD/YYYY HH:MM:SS" or ISO → ms remaining.
   *  due_in is in PK time; remaining = due_in − current PK time.
   *  Fallback: if due_in is empty, use received_at + 24h as default deadline. */
  const parseDueIn = useCallback((raw: string | null | undefined, receivedAt?: string | null): number | null => {
    const getProjectNow = () => {
      const projectNowStr = new Date().toLocaleString('en-US', { timeZone: projectTz });
      return new Date(projectNowStr).getTime();
    };
    if (raw) {
      let d = new Date(raw);
      if (isNaN(d.getTime())) {
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
        if (m) d = new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
      }
      if (!isNaN(d.getTime())) return d.getTime() - getProjectNow();
    }
    // Fallback: received_at + 24 hours
    if (receivedAt) {
      const rd = new Date(receivedAt);
      if (!isNaN(rd.getTime())) return (rd.getTime() + 24 * 3600_000) - getProjectNow();
    }
    return null;
  }, [projectTz]);

  const fmtCountdown = (ms: number) => {
    const overdue = ms < 0;
    const absTotalMin = Math.floor(Math.abs(ms) / 60000);
    const hrs = Math.floor(absTotalMin / 60);
    const mins = absTotalMin % 60;
    const label = overdue
      ? (hrs > 0 ? `-${hrs}h ${mins}m` : `-${mins}m`)
      : (hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`);
    return { label, overdue, hrs };
  };

  // Critical data: worker dashboard + current order (runs on every poll)
  const loadCritical = useCallback(async () => {
    try {
      const promises: Promise<any>[] = [
        workflowService.myStats({ includeQueueCount: false }),
        workflowService.myCurrent({ includePaused: false }),
      ];
      // Checkers & QA: also fetch full queue so we can show all assigned orders
      if (isQueueWorker) {
        promises.push(workflowService.getQueue());
      }
      const results = await Promise.all(promises);
      const statsRes = results[0];
      const currentRes = results[1];
      const rawApiOrder = currentRes.data.current_order || currentRes.data.order || null;
      const apiOrder = rawApiOrder && isOrderForCurrentRole(rawApiOrder) ? rawApiOrder : null;

      setData((prev) => ({
        current_order: apiOrder,
        target_progress: prev?.target_progress ?? 0,
        ...statsRes.data,
      }));

      setCurrentOrder((prev) => {
        // Protect manual order assignment from polling override for 5 seconds
        if (manualOrderAssigned && (Date.now() - manualOrderTimestamp) < 5000) {
          return prev; // Keep the manually assigned order
        }

        // Keep the active in-progress order stable during polling.
        if (orderStarted && prev) {
          if (!apiOrder || prev.id === apiOrder.id) {
            return prev;
          }
        }

        return apiOrder;
      });

      // Update checker/QA queue
      if (isQueueWorker && results[2]) {
        const queueOrders = results[2].data?.orders || [];
        let nextQueue = filterQueueByRole(queueOrders);

        if (isProject12Filler) {
          try {
            const projectOrdersRes = await workflowService.projectOrders(12);
            const projectOrders = projectOrdersRes.data?.data || [];

            nextQueue = mergeOrdersById([
              ...nextQueue,
              ...filterQueueByRole(projectOrders.filter(isProject12FillerOrder)),
            ]);
          } catch (project12QueueError) {
            console.error('Failed to load project 12 filler queue fallback:', project12QueueError);
          }
        }

        const visibleCurrentOrderId = orderStarted
          ? (apiOrder?.id ?? currentOrder?.id ?? null)
          : null;

        setRoleQueue(
          nextQueue.filter((o: Order) => {
            if (!visibleCurrentOrderId) return true;
            return o.id !== visibleCurrentOrderId;
          })
        );
      }

      // Determine if order is already started (timer running or time spent)
      if (apiOrder) {
        const workflowState = apiOrder.workflow_state || '';

        if (workflowState.startsWith('IN_')) {
          setOrderStarted(true);
          setCurrentOrder(apiOrder);
        } else {
          try {
            const detailsRes = await workflowService.orderFullDetails(apiOrder.id);

            if (
              detailsRes.data?.timer_running ||
              (detailsRes.data?.current_time_seconds ?? 0) > 0
            ) {
              setOrderStarted(true);
              setCurrentOrder(apiOrder); // ensure restore after refresh
            } else {
              setOrderStarted(false);
            }
          } catch {
            setOrderStarted(false);
          }
        }
      } else {
        setOrderStarted(false);
      }

    } catch (e) { console.error(e); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrder, isOrderForCurrentRole, isProject12Filler, isProject12FillerOrder, isQueueWorker, filterQueueByRole, mergeOrdersById]);

  const queueCount = isQueueWorker ? roleQueue.length + (currentOrder && !orderStarted ? 1 : 0) : (data?.queue_count ?? 0);


  // Stats data: completed orders + performance (only on mount + manual refresh)
  const loadStats = useCallback(async () => {
    try {
      const [doneRes, perfRes] = await Promise.all([
        workflowService.getCompleted(),
        workflowService.getPerformance(),
      ]);
      setDoneOrders(doneRes.data.orders || []);
      setPerformanceStats(perfRes.data);
    } catch {
      // Endpoints may not exist yet
    }
  }, []);

  // Full load: critical on mount
  const loadData = useCallback(async () => {
    await loadCritical();
  }, [loadCritical]);

  const loadHistory = useCallback(async (page: number = 1) => {
    try {
      const res = await workflowService.getHistory(page);
      setHistoryOrders(res.data.data || []);
      setHistoryPage(res.data.current_page);
      setHistoryLastPage(res.data.last_page);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    loadData();
  }, []); // Run only on mount, NOT on loadData changes

  /* ── Smart Polling: only reload critical data when data changes ── */
  useSmartPolling({
    projectIds: user?.project?.id ? [user.project.id] : [],
    scope: 'orders',
    interval: 45_000,
    onDataChanged: loadCritical,
    enabled: !showDrawerForm && !showCheckerForm && !showFillerForm && !showQAForm && !showDesignerForm,
  });

  // Lazy-load stats and completed orders only when worker switches to those views
  useEffect(() => {
    if ((viewMode === 'done' || viewMode === 'stats') && doneOrders.length === 0 && !performanceStats) {
      loadStats();
    }
  }, [viewMode, loadStats, doneOrders.length, performanceStats]);

  useEffect(() => {
    if (viewMode === 'history' && historyOrders.length === 0) {
      loadHistory(1);
    }
  }, [viewMode, loadHistory, historyOrders.length]);

  // Auto-assignment: Get next order from queue (no manual picking)
  const handleGetNextOrder = async () => {
    setAutoAssigning(true);
    try {
      const res = await workflowService.startNext();
      if (res.data.order) {
        setCurrentOrder(res.data.order);
        setOrderStarted(false); // Order ID hidden until Start is clicked
        // Protect manual assignment from polling override for 5 seconds
        setManualOrderAssigned(true);
        setManualOrderTimestamp(Date.now());
        loadCritical();
      }
    } catch (e) { console.error(e); }
    finally { setAutoAssigning(false); }
  };

  // Reset manual order assignment protection after 5 seconds
  useEffect(() => {
    if (manualOrderAssigned) {
      const timer = setTimeout(() => {
        setManualOrderAssigned(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [manualOrderAssigned]);

  const openRoleWorkForm = useCallback(() => {
    if (isDrawer) setShowDrawerForm(true);
    else if (isChecker) setShowCheckerForm(true);
    else if (isFiller) setShowFillerForm(true);
    else if (isQA) setShowQAForm(true);
    else if (isDesigner) setShowDesignerForm(true);
  }, [isChecker, isDesigner, isDrawer, isFiller, isQA]);

  const ensureTimerStarted = useCallback(async (order: Order) => {
    const details = await workflowService.orderFullDetails(order.id);

    if (!details.data?.timer_running && (details.data?.current_time_seconds ?? 0) <= 0) {
      await workflowService.startTimer(order.id);
    }

    setCurrentOrder(order);
    setOrderStarted(true);
    return true;
  }, []);

  // Start order: starts timer, reveals order ID, opens work form
  const handleStartOrder = async () => {
    if (!currentOrder) return;
    setStartingOrderId(currentOrder.id);
    try {
      await workflowService.startTimer(currentOrder.id);
      setOrderStarted(true);
      openRoleWorkForm();
    } catch (e: any) {
      console.error(e);
    } finally {
      setStartingOrderId(null);
    }
  };

  const handleReject = async () => {
    if (!currentOrder || !rejectReason || !rejectCode) return;
    setSubmitting(true);
    try {
      await workflowService.rejectOrder(currentOrder.id, rejectReason, rejectCode, routeTo || undefined);
      setShowReject(false); setRejectReason(''); setRejectCode(''); setRouteTo('');
      setOrderStarted(false); setCurrentOrder(null); setShowDrawerForm(false); setShowCheckerForm(false); setShowFillerForm(false); setShowQAForm(false); setShowDesignerForm(false); loadData();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleHold = async () => {
    if (!currentOrder || !holdReason) return;
    setSubmitting(true);
    try {
      await workflowService.holdOrder(currentOrder.id, holdReason);
      setShowHold(false); setHoldReason(''); setOrderStarted(false); setCurrentOrder(null); setShowDrawerForm(false); setShowCheckerForm(false); setShowFillerForm(false); setShowQAForm(false); setShowDesignerForm(false); loadData();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const canReject = user?.role === 'checker' || user?.role === 'qa';
  const canHold = ['drawer', 'checker', 'filler', 'qa', 'designer'].includes(user?.role ?? '');

  if (loading) return (
    <AnimatedPage>
      <WorkerDashboardSkeleton />
    </AnimatedPage>
  );

  const progress = data?.daily_target ? Math.min(100, Math.round(((data?.today_completed ?? 0) / data.daily_target) * 100)) : 0;
  const RoleIcon = roleConfig.icon;
  const historyHasPlanTypeColumn = historyOrders.some((order) => shouldShowPlanType(order));
  const queueHasPlanTypeColumn = roleQueue.some((order) => shouldShowPlanType(order));

  // Role-specific instruction panels
  const renderRoleInstructions = () => {
    if (!currentOrder) return null;
    const metadata = (currentOrder.metadata || {}) as Record<string, string>;

    if (isDrawer) {
      // Drawer: Show ONLY drawing instructions and specifications per CEO requirements
      return (
        <div className="bg-brand-50/50 rounded-xl p-5 mb-6">
          <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Info className="h-4 w-4 text-brand-600" /> Drawing Instructions
          </h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-slate-500 font-medium">Template:</span>
              <span className="ml-2 text-slate-900">{metadata.template || 'Standard'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-medium">Plan Type:</span>
              <span className="ml-2 text-slate-900">{metadata.plan_type || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-medium">Wall Thickness:</span>
              <span className="ml-2 text-slate-900">{metadata.wall_thickness || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-medium">Structure:</span>
              <span className="ml-2 text-slate-900">{metadata.structure || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-medium">Dimensions:</span>
              <span className="ml-2 text-slate-900">{metadata.label_dimension || 'Imperial'}</span>
            </div>
            <div>
              <span className="text-slate-500 font-medium">North:</span>
              <span className="ml-2 text-slate-900">{metadata.north || '—'}</span>
            </div>
          </div>
          {metadata.instruction && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <span className="text-brand-600 font-medium">Special Instructions:</span>
              <p className="mt-1 text-slate-900">{metadata.instruction}</p>
            </div>
          )}
        </div>
      );
    }

    if (isChecker) {
      // Checker: Show comparison data and error points per CEO requirements
      return (
        <div className="bg-brand-50/50 rounded-xl p-5 mb-6">
          <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-brand-600" /> Comparison Data
          </h4>
          <div className="text-sm text-slate-600 mb-3">
            <p>Compare drawer's output against source data. Document any errors found.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="text-xs text-slate-500 mb-1">Previous Stage</div>
              <div className="font-medium text-slate-900">
                {currentOrder.workflow_state?.includes('REJECTED') ? 'Correction Review'
                  : currentOrder.workflow_type === 'PH_2_LAYER' ? 'Photo Enhancement' : 'Drawing'}
              </div>
            </div>
            <div className="bg-white rounded-lg p-3 shadow-sm">
              <div className="text-xs text-slate-500 mb-1">Check Required</div>
              <div className="font-medium text-slate-900">
                {currentOrder.workflow_type === 'PH_2_LAYER' ? 'Enhancement Verification' : 'Full Verification'}
              </div>
            </div>
          </div>
          {currentOrder.rejection_reason && (
            <div className="mt-3 p-3 bg-rose-50 rounded-lg">
              <div className="text-xs font-medium text-rose-700 mb-1">Previous Error:</div>
              <p className="text-sm text-rose-600">{currentOrder.rejection_reason}</p>
            </div>
          )}
        </div>
      );
    }

    if (isFiller) {
      return (
        <div className="bg-brand-50/50 rounded-xl p-5 mb-6">
          <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Upload className="h-4 w-4 text-brand-600" /> Filler Checklist
          </h4>
          <div className="space-y-2">
            {[
              'Confirm the order moved into the filler layer',
              'Verify file uploader details are present',
              'Check upload status and upload date before QA handoff',
              'Add any notes QA should review',
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                <CheckCircle className="h-4 w-4 text-brand-500" /> {item}
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (isQA) {
      // QA: Show final checklists and client standards per CEO requirements
      return (
        <div className="bg-brand-50/50 rounded-xl p-5 mb-6">
          <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <Eye className="h-4 w-4 text-brand-600" /> QA Checklist
          </h4>
          <div className="space-y-2">
            {(currentOrder.workflow_type === 'PH_2_LAYER'
              ? [
                'Verify photo enhancement matches client standards',
                'Check color accuracy and styling',
                'Validate file resolution and format',
                'Confirm all corrections from previous stages applied',
              ]
              : [
                'Verify all specifications match client standards',
                'Check dimensions and measurements',
                'Validate file format and quality',
                'Confirm all corrections from previous stages applied',
              ]
            ).map((item, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-slate-600">
                <CheckCircle className="h-4 w-4 text-brand-500" /> {item}
              </div>
            ))}
          </div>
          {metadata.client_standards && (
            <div className="mt-3 pt-3 border-t border-slate-200">
              <span className="text-brand-600 font-medium">Client Standards:</span>
              <p className="mt-1 text-slate-900">{metadata.client_standards}</p>
            </div>
          )}
        </div>
      );
    }

    // Designer: Show design-specific content
    return (
      <div className="bg-brand-50/50 rounded-xl p-5 mb-6">
        <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <Palette className="h-4 w-4 text-brand-600" /> Design Specifications
        </h4>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-500 font-medium">Enhancement Type:</span>
            <span className="ml-2 text-slate-900">{metadata.enhancement_type || 'Standard'}</span>
          </div>
          <div>
            <span className="text-slate-500 font-medium">Style:</span>
            <span className="ml-2 text-slate-900">{metadata.style || '—'}</span>
          </div>
        </div>
        {metadata.design_notes && (
          <div className="mt-3 pt-3 border-t border-slate-200">
            <span className="text-brand-600 font-medium">Design Notes:</span>
            <p className="mt-1 text-slate-900">{metadata.design_notes}</p>
          </div>
        )}
      </div>
    );
  };

  // UNIFIED AUTO-ASSIGNMENT VIEW - No manual order picking per CEO requirements
  return (
    <AnimatedPage>
      <PageHeader
        title={roleConfig.label}
        subtitle={`${user?.project?.name || ''} ${roleConfig.description ? `· ${roleConfig.description}` : ''}`}
        badge={
          <span className="flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 px-2.5 py-1 rounded-full">
            <RoleIcon className="h-3.5 w-3.5" /> {user?.role?.replace('_', ' ').toUpperCase()}
          </span>
        }
      />

      {/* View Mode Tabs - No Queue tab (auto-assignment only) */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <button
          onClick={() => setViewMode('work')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${viewMode === 'work'
            ? 'bg-brand-500 text-white shadow-sm'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
        >
          <RoleIcon className="h-4 w-4" />
          Work Area
        </button>
        <button
          onClick={() => setViewMode('done')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${viewMode === 'done'
            ? 'bg-brand-500 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
        >
          <CheckCircle className="h-4 w-4" />
          Done ({doneOrders.length})
        </button>
        <button
          onClick={() => setViewMode('history')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${viewMode === 'history'
            ? 'bg-brand-500 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
        >
          <History className="h-4 w-4" />
          History
        </button>
        <button
          onClick={() => setViewMode('stats')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${viewMode === 'stats'
            ? 'bg-amber-600 text-white'
            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
        >
          <BarChart3 className="h-4 w-4" />
          My Stats
        </button>
      </div>

      {/* Performance Stats View */}
      {viewMode === 'stats' && !performanceStats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-slate-100 animate-pulse rounded-xl" />)}
          </div>
          <div className="h-40 bg-slate-100 animate-pulse rounded-xl" />
          <div className="h-40 bg-slate-100 animate-pulse rounded-xl" />
        </div>
      )}

      {/* Performance Stats View */}
      {viewMode === 'stats' && performanceStats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Today" value={performanceStats.today_completed} icon={Target} color="green" />
            <StatCard label="This Week" value={performanceStats.week_completed} icon={TrendingUp} color="blue" />
            <StatCard label="This Month" value={performanceStats.month_completed} icon={BarChart3} color="brand" />
            <StatCard label="Avg Time" value={`${performanceStats.avg_time_minutes}m`} icon={Clock} color="amber" />
          </div>
          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Weekly Progress</h3>
            <div className="flex items-center gap-4 mb-4">
              <div className="flex-1">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">Target: {performanceStats.weekly_target}</span>
                  <span className="font-medium text-slate-900">{performanceStats.weekly_rate}%</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, performanceStats.weekly_rate)}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className={`h-full rounded-full ${performanceStats.weekly_rate >= 100 ? 'bg-brand-500' : performanceStats.weekly_rate >= 80 ? 'bg-blue-500' : 'bg-amber-500'}`}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-4">Last 7 Days</h3>
            <div className="flex items-end justify-between gap-2 h-32">
              {(performanceStats.daily_stats || []).map((day, i) => {
                const maxCount = Math.max(...(performanceStats.daily_stats || []).map(d => d.count), 1);
                const height = (day.count / maxCount) * 100;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-xs font-medium text-slate-700">{day.count}</span>
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${height}%` }}
                      transition={{ duration: 0.5, delay: i * 0.1 }}
                      className="w-full bg-blue-500 rounded-t-md min-h-[4px]"
                    />
                    <span className="text-xs text-slate-500">{day.day}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Done Orders View */}
      {viewMode === 'done' && (
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Completed Today</h3>
            <p className="text-xs text-slate-400 mt-0.5">Orders you completed today</p>
          </div>
          {doneOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                <CheckCircle className="h-6 w-6 text-slate-400" />
              </div>
              <h3 className="text-[15px] font-semibold text-slate-700 mb-1">No completed orders today</h3>
              <p className="text-sm text-slate-400">Complete orders to see them here</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {doneOrders.map((order) => {
                const metadata = (order.metadata || {}) as Record<string, string>;
                return (
                  <div key={order.id} className="px-5 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-slate-900">{isFirstStageWorker ? '••••••' : getDisplayOrderNumber(order)}</div>
                      <div className="text-xs text-slate-500">{metadata.address || order.client_reference || '—'}</div>
                    </div>
                    <StatusBadge status={order.workflow_state || 'completed'} size="sm" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* History View */}
      {viewMode === 'history' && (
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">Order History</h3>
            <p className="text-xs text-slate-400 mt-0.5">All orders you have worked on</p>
          </div>
          {historyOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                <History className="h-6 w-6 text-slate-400" />
              </div>
              <h3 className="text-[15px] font-semibold text-slate-700 mb-1">No order history yet</h3>
              <p className="text-sm text-slate-400">Complete orders to build your history</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {historyOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                    <History className="h-6 w-6 text-slate-400" />
                  </div>
                  <h3 className="text-[15px] font-semibold text-slate-700 mb-1">No order history yet</h3>
                  <p className="text-sm text-slate-400">Complete orders to build your history</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50/80">
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Order #</th>
                        {isProjectFieldVisible('variant') && (
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{getProjectFieldLabel('variant', 'Variant')}</th>
                        )}
                        {historyHasPlanTypeColumn && (
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{getProjectFieldLabel('plan_type', 'Plan Type')}</th>
                        )}
                        {isProjectFieldVisible('priority') && (
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{getProjectFieldLabel('priority', 'Priority')}</th>
                        )}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{firstStageLabel}</th>
                        {isQA && (
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Checker</th>
                        )}
                        {isProjectFieldVisible('address') && (
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{getProjectFieldLabel('address', 'Address')}</th>
                        )}
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold text-slate-600">Date</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-100">
                      {historyOrders.map((order) => {
                        return (
                          <tr key={order.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-semibold text-slate-900">
                              {getDisplayOrderNumber(order)}
                            </td>
                            {isProjectFieldVisible('variant') && (
                              <td className="px-4 py-3 text-slate-600">
                                {(order as any).VARIANT_no || '—'}
                              </td>
                            )}
                            {historyHasPlanTypeColumn && (
                              <td className="px-4 py-3 text-slate-600">
                                {getDisplayPlanType(order)}
                              </td>
                            )}
                            {isProjectFieldVisible('priority') && (
                              <td className="px-4 py-3">
                                <StatusBadge status={order.priority} />
                              </td>
                            )}
                            <td className="px-4 py-3 text-slate-700">
                              {(order as any).drawer_name || '—'}
                            </td>

                            {isQA && (
                              <td className="px-4 py-3 text-slate-700">
                                {(order as any).checker_name || '—'}
                              </td>
                            )}
                            {isProjectFieldVisible('address') && (
                              <td className="px-4 py-3 text-slate-600 truncate max-w-[200px]">
                                {(order as any).address || '—'}
                              </td>
                            )}
                            <td className="px-4 py-3">
                              <StatusBadge status={order.workflow_state} size="sm" />
                            </td>

                            <td className="px-4 py-3 text-xs text-slate-500">
                              {new Date(order.created_at).toLocaleDateString('en-GB', { timeZone: projectTz })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {historyLastPage > 1 && (
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between">
              <span className="text-sm text-slate-500">Page {historyPage} of {historyLastPage}</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" disabled={historyPage === 1} onClick={() => loadHistory(historyPage - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={historyPage === historyLastPage} onClick={() => loadHistory(historyPage + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Work Area - Main auto-assignment view */}
      {viewMode === 'work' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Completed Today" value={data?.today_completed ?? 0} icon={Target} color="green" />
            <StatCard label="Daily Target" value={data?.daily_target ?? 0} icon={Target} color="blue" />
            <StatCard label="Queue Size" value={queueCount} icon={Inbox} color="amber" />
            <StatCard label="Progress" value={`${progress}%`} icon={Target} color="brand">
              <div className="mt-3 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="h-full bg-brand-500 rounded-full"
                />
              </div>
            </StatCard>
          </div>

          {/* Current Order or Get Next */}
          {isQueueWorker ? (
            /* ── CHECKER / QA: Show ALL assigned orders in a list ── */
            <>
              {/* Active order being worked on */}
              {currentOrder && orderStarted && (
                <>
                  {renderRoleInstructions()}
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-xl ring-2 ring-brand-500/30 overflow-hidden mb-6"
                  >
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-brand-50/30">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Currently Working On</h3>
                        <p className="text-xs text-slate-400 mt-0.5">Complete this order or use the actions below</p>
                      </div>
                      <StatusBadge status={currentOrder.workflow_state} />
                    </div>
                    <div className="p-5">
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-5">
                        <div>
                          <div className="text-xs text-slate-400 mb-1">Order #</div>
                          <div className="text-sm font-semibold text-slate-900">{getDisplayOrderNumber(currentOrder)}</div>
                        </div>
                        {isProjectFieldVisible('variant') && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1">{getProjectFieldLabel('variant', 'Variant')}</div>
                            <div className="text-sm font-semibold text-slate-900">{(currentOrder as any).VARIANT_no || '—'}</div>
                          </div>
                        )}
                        {shouldShowPlanType(currentOrder) && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1">{getProjectFieldLabel('plan_type', 'Plan Type')}</div>
                            <div className="text-sm font-semibold text-slate-900">{getDisplayPlanType(currentOrder)}</div>
                          </div>
                        )}
                        {isProjectFieldVisible('priority') && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1">{getProjectFieldLabel('priority', 'Priority')}</div>
                            <StatusBadge status={currentOrder.priority} />
                          </div>
                        )}
                        {shouldShowOrderReference(currentOrder) && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1">Order Reference</div>
                            <div className="text-sm font-semibold text-slate-900">{getOrderClientReference(currentOrder)}</div>
                          </div>
                        )}
                        {showClientName && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1">Client Name</div>
                            <div className="text-sm font-semibold text-slate-900">{(currentOrder as any).client_name || 'N/A'}</div>
                          </div>
                        )}
                        {showClientName && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1">Code</div>
                            <div className="text-sm font-semibold text-slate-900">{(currentOrder as any).code || 'N/A'}</div>
                          </div>
                        )}

                        {isProjectFieldVisible('instruction') && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1">{getProjectFieldLabel('instruction', 'Instruction')}</div>
                            <div className="text-sm font-semibold text-slate-900">
                              {(currentOrder as any).instruction || (currentOrder as any).supervisor_notes || ((currentOrder.metadata as Record<string, string> | null)?.instruction) || 'N/A'}
                            </div>
                          </div>
                        )}
                        <div>
                          <div className="text-xs text-slate-400 mb-1">{firstStageLabel}</div>
                          <div className="text-sm font-medium text-slate-700 flex items-center gap-1">
                            <UserIcon className="w-3.5 h-3.5 text-blue-500" />
                            {(currentOrder as any).drawer_name || '—'}
                          </div>
                        </div>
                        {isQA && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1">Checker</div>
                            <div className="text-sm font-medium text-slate-700 flex items-center gap-1">
                              <UserIcon className="w-3.5 h-3.5 text-purple-500" />
                              {(currentOrder as any).checker_name || '—'}
                            </div>
                          </div>
                        )}

                        {isProjectFieldVisible('address') && (
                          <div>
                            <div className="text-xs text-slate-400 mb-1">{getProjectFieldLabel('address', 'Address')}</div>
                            <div className="text-sm font-medium leading-snug text-slate-700 whitespace-normal break-words" title={(currentOrder as any).address || '—'}>{(currentOrder as any).address || '—'}</div>
                          </div>
                        )}

                        <div>
                          <div className="text-xs text-slate-400 mb-1">Due In</div>
                          {(() => {
                            const ms = parseDueIn((currentOrder as any).due_in, currentOrder.received_at);
                            if (ms === null) return <div className="text-sm font-medium text-slate-400">—</div>;
                            const { label, overdue, hrs } = fmtCountdown(ms);
                            const cls = overdue ? 'text-red-600' : hrs < 1 ? 'text-orange-600' : hrs < 4 ? 'text-yellow-600' : 'text-green-600';
                            return (
                              <div className={`text-sm font-bold flex items-center gap-1 ${cls}`}>
                                <Clock className="w-3.5 h-3.5" />
                                {label}
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={openRoleWorkForm}
                          icon={<ClipboardList className="h-4 w-4" />}
                          className="bg-brand-500 hover:bg-brand-600"
                        >
                          {isDesigner ? 'Open Design Form' : isDrawer ? 'Open Work Form' : isQA ? 'Open QA Review' : isFiller ? 'Open Filler Form' : 'Open Check Form'}
                        </Button>

                        {shouldShowClientUploadButton(currentOrder) ? (
                          <Button
                            variant="secondary"
                            onClick={() => openClientUploadPage(currentOrder)}
                            icon={<UploadCloud className="h-4 w-4" />}
                          >
                            Upload Images
                          </Button>
                        ) : shouldShowOrderAssetsButton(currentOrder) ? (
                          <Button
                            variant="secondary"
                            onClick={() => openOrderAssetsPage(currentOrder)}
                            icon={<ImageIcon className="h-4 w-4" />}
                          >
                            View Images
                          </Button>
                        ) : null}

                        {!isFirstStageWorker && (
                          <Button variant="danger" onClick={() => setShowReject(true)} icon={<X className="h-4 w-4" />}>
                            Reject
                          </Button>
                        )}

                        <Button variant="secondary" onClick={() => setShowHold(true)} icon={<Clock className="h-4 w-4" />}>
                          {holdActionLabel}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                </>
              )}

              {/* All assigned orders table */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden"
              >
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Assigned Orders</h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {roleQueue.length} order{roleQueue.length !== 1 ? 's' : ''} assigned to you
                    </p>
                  </div>
                </div>
                {roleQueue.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16">
                    <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
                      <ClipboardList className="h-6 w-6 text-brand-500" />
                    </div>
                    <h3 className="text-[15px] font-semibold text-slate-700 mb-1">No orders in your queue</h3>
                    <p className="text-sm text-slate-400">Orders will appear here when assigned to you</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50/80">
                          <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Date</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Order #</th>
                          {isProjectFieldVisible('variant') && (
                            <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">{getProjectFieldLabel('variant', 'Variant')}</th>
                          )}
                          {queueHasPlanTypeColumn && (
                            <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">{getProjectFieldLabel('plan_type', 'Plan Type')}</th>
                          )}
                          {shouldShowQueueReferenceColumn && (
                            <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Order Reference</th>
                          )}
                          {isProjectFieldVisible('priority') && (
                            <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">{getProjectFieldLabel('priority', 'Priority')}</th>
                          )}
                          <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">
                            <span className="flex items-center gap-1"><UserIcon className="w-3.5 h-3.5" /> {firstStageLabel}</span>
                          </th>
                          {isQA && (
                            <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">
                              <span className="flex items-center gap-1"><UserIcon className="w-3.5 h-3.5" /> Checker</span>
                            </th>
                          )}
                          {isProjectFieldVisible('address') && (
                            <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">{getProjectFieldLabel('address', 'Address')}</th>
                          )}
                          <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Due In</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wider">Status</th>
                          <th className="px-4 py-3 text-center font-semibold text-slate-600 text-xs uppercase tracking-wider">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {roleQueue.map((order) => {
                          const isActive = currentOrder?.id === order.id && orderStarted;
                          const isHeld = order.workflow_state === 'ON_HOLD' || order.is_on_hold;
                          const ms = parseDueIn((order as any).due_in, order.received_at);
                          const dueInfo = ms !== null ? fmtCountdown(ms) : null;
                          const dueCls = dueInfo ? (dueInfo.overdue ? 'text-red-600' : dueInfo.hrs < 1 ? 'text-orange-600' : dueInfo.hrs < 4 ? 'text-yellow-600' : 'text-green-600') : '';
                          return (
                            <tr
                              key={order.id}
                              className={`hover:bg-slate-50 transition-colors ${isActive ? 'bg-brand-50/40 ring-1 ring-inset ring-brand-200' : ''} ${isHeld ? 'bg-orange-50/50' : ''}`}
                            >
                              <td className="px-4 py-3 text-slate-600">
                                {order.created_at
                                  ? new Date(order.created_at).toLocaleDateString('en-GB', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                    timeZone: projectTz,
                                  })
                                  : '—'}
                              </td>
                              <td className="px-4 py-3">
                                <span className="font-semibold text-slate-900">{isDrawer ? '••••••' : getDisplayOrderNumber(order)}</span>
                              </td>
                              {isProjectFieldVisible('variant') && (
                                <td className="px-4 py-3 text-slate-600">{isDrawer ? '••••' : ((order as any).VARIANT_no || '—')}</td>
                              )}
                              {queueHasPlanTypeColumn && (
                                <td className="px-4 py-3 text-slate-600">{getDisplayPlanType(order)}</td>
                              )}
                              {shouldShowQueueReferenceColumn && (
                                <td className="px-4 py-3 text-slate-600 max-w-[180px] truncate" title={getOrderClientReference(order)}>
                                  {getOrderClientReference(order) || '-'}
                                </td>
                              )}
                              {isProjectFieldVisible('priority') && (
                                <td className="px-4 py-3"><StatusBadge status={order.priority} /></td>
                              )}
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                                    <UserIcon className="w-3.5 h-3.5 text-blue-600" />
                                  </div>
                                  <span className="text-slate-700 font-medium">{(order as any).drawer_name || '—'}</span>
                                </div>
                              </td>
                              {isQA && (
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-6 h-6 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                                      <UserIcon className="w-3.5 h-3.5 text-purple-600" />
                                    </div>
                                    <span className="text-slate-700 font-medium">{(order as any).checker_name || '—'}</span>
                                  </div>
                                </td>
                              )}
                              {isProjectFieldVisible('address') && (
                                <td className="px-4 py-3 text-slate-600 whitespace-normal break-words" title={(order as any).address || ''}>{isDrawer ? '••••••' : ((order as any).address || '—')}</td>
                              )}
                              <td className="px-4 py-3">
                                {dueInfo ? (
                                  <span className={`font-bold flex items-center gap-1 ${dueCls}`}>
                                    <Clock className="w-3.5 h-3.5" />
                                    {dueInfo.label}
                                  </span>
                                ) : <span className="text-slate-400">—</span>}
                              </td>
                              <td className="px-4 py-3"><StatusBadge status={order.workflow_state} size="sm" /></td>
                              <td className="px-4 py-3 text-center">
                                <div className="inline-flex items-center gap-2 flex-wrap justify-center">
                                  {isHeld ? (
                                    <Button
                                      size="sm"
                                      onClick={async () => {
                                        setStartingOrderId(order.id);

                                        try {
                                          await ensureTimerStarted(order);
                                          openRoleWorkForm();
                                        } catch (e) {
                                          console.error(e);
                                        } finally {
                                          setStartingOrderId(null);
                                        }
                                      }}
                                      loading={startingOrderId === order.id}
                                      icon={<Play className="h-3.5 w-3.5" />}
                                      className="bg-emerald-600 hover:bg-emerald-700"
                                    >
                                      Resume
                                    </Button>
                                  ) : isActive ? (
                                    <Button
                                      size="sm"
                                      onClick={() => {
                                        if (!orderStarted || currentOrder?.id !== order.id) return;
                                        openRoleWorkForm();
                                      }}
                                      icon={<ClipboardList className="h-3.5 w-3.5" />}
                                      className="bg-brand-500 hover:bg-brand-600"
                                    >
                                      Continue
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      onClick={async () => {
                                        setStartingOrderId(order.id);

                                        try {
                                          await ensureTimerStarted(order);
                                          openRoleWorkForm();
                                        } catch (e) {
                                          console.error(e);
                                        } finally {
                                          setStartingOrderId(null);
                                        }
                                      }}
                                      loading={startingOrderId === order.id}
                                      icon={<Play className="h-3.5 w-3.5" />}
                                      variant="secondary"
                                    >
                                      Start
                                    </Button>
                                  )}

                                  {shouldShowClientUploadButton(order) ? (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => openClientUploadPage(order)}
                                      icon={<UploadCloud className="h-3.5 w-3.5" />}
                                    >
                                      Upload Images
                                    </Button>
                                  ) : shouldShowOrderAssetsButton(order) ? (
                                    <Button
                                      size="sm"
                                      variant="secondary"
                                      onClick={() => openOrderAssetsPage(order)}
                                      icon={<ImageIcon className="h-3.5 w-3.5" />}
                                    >
                                      {order.project_id === 1 ? 'Files / Portal Check' : 'Images'}
                                    </Button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </motion.div>
            </>
          ) : currentOrder && orderStarted ? (
            <>
              {/* Role-specific instructions panel - only show when working */}
              {renderRoleInstructions()}

              {/* Current Order Card - Full Details (Only when actively working) */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden"
              >
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Now Working On</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Complete this before getting a new one</p>
                  </div>
                  <StatusBadge status={currentOrder.workflow_state} />
                </div>
                <div className="p-5">
                  <div className={`grid grid-cols-2 ${(isFirstStageWorker || isChecker || isFiller) ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-4 mb-5`}>
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Order #</div>
                      <div className="text-sm font-semibold text-slate-900">{getDisplayOrderNumber(currentOrder)}</div>
                    </div>
                    {(isFirstStageWorker || isChecker || isFiller) && (
                      <div>
                        {isProjectFieldVisible('variant') && (
                          <div className="text-xs text-slate-400 mb-1">{getProjectFieldLabel('variant', 'Variant')}</div>
                        )}
                        {isProjectFieldVisible('variant') && (
                          <div className="text-sm font-semibold text-slate-900">{(currentOrder as any).VARIANT_no || '—'}</div>
                        )}
                      </div>
                    )}
                    {shouldShowPlanType(currentOrder) && (
                      <div>
                        <div className="text-xs text-slate-400 mb-1">{getProjectFieldLabel('plan_type', 'Plan Type')}</div>
                        <div className="text-sm font-semibold text-slate-900">{getDisplayPlanType(currentOrder)}</div>
                      </div>
                    )}
                    {showClientName && (
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Client Name</div>
                        <div className="text-sm font-semibold text-slate-900">{(currentOrder as any).client_name || 'N/A'}</div>
                      </div>
                    )}
                    {shouldShowOrderReference(currentOrder) && (
                      <div>
                        <div className="text-xs text-slate-400 mb-1">Order Reference</div>
                        <div className="text-sm font-semibold text-slate-900">{getOrderClientReference(currentOrder)}</div>
                      </div>
                    )}
                    {isProjectFieldVisible('priority') && (
                      <div>
                        <div className="text-xs text-slate-400 mb-1">{getProjectFieldLabel('priority', 'Priority')}</div>
                        <StatusBadge status={currentOrder.priority} />
                      </div>
                    )}
                    {isProjectFieldVisible('address') && (
                      <div>
                        <div className="text-xs text-slate-400 mb-1">{getProjectFieldLabel('address', 'Address')}</div>
                        <div className="text-sm font-medium leading-snug text-slate-700 whitespace-normal break-words" title={(currentOrder as any).address || '—'}>{(currentOrder as any).address || '—'}</div>
                      </div>
                    )}
                    <div>
                      <div className="text-xs text-slate-400 mb-1">Due In</div>
                      {(() => {
                        const ms = parseDueIn((currentOrder as any).due_in, currentOrder.received_at);
                        if (ms === null) return <div className="text-sm font-medium text-slate-400">—</div>;
                        const { label, overdue, hrs } = fmtCountdown(ms);
                        const cls = overdue ? 'text-red-600' : hrs < 1 ? 'text-orange-600' : hrs < 4 ? 'text-yellow-600' : 'text-green-600';
                        return (
                          <div className={`text-sm font-bold flex items-center gap-1 ${cls}`}>
                            <Clock className="w-3.5 h-3.5" />
                            {label}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    {isDrawer && (
                      <Button onClick={openRoleWorkForm} icon={<Pencil className="h-4 w-4" />}>
                        Open Work Form
                      </Button>
                    )}
                    {isChecker && (
                      <Button onClick={openRoleWorkForm} icon={<ClipboardList className="h-4 w-4" />} className="bg-brand-500 hover:bg-brand-600">
                        Open Check Form
                      </Button>
                    )}
                    {isFiller && (
                      <Button onClick={openRoleWorkForm} icon={<Upload className="h-4 w-4" />} className="bg-sky-600 hover:bg-sky-700">
                        Open Filler Form
                      </Button>
                    )}
                    {isQA && (
                      <Button onClick={openRoleWorkForm} icon={<Eye className="h-4 w-4" />} className="bg-emerald-600 hover:bg-emerald-700">
                        Open QA Review
                      </Button>
                    )}
                    {isDesigner && (
                      <Button onClick={openRoleWorkForm} icon={<Palette className="h-4 w-4" />} className="bg-pink-600 hover:bg-pink-700">
                        Open Design Form
                      </Button>
                    )}
                    {shouldShowOrderAssetsButton(currentOrder) && (
                      <Button
                        variant="secondary"
                        onClick={() => openOrderAssetsPage(currentOrder)}
                        icon={<ImageIcon className="h-4 w-4" />}
                      >
                        {currentOrder.project_id === 1 ? 'Files / Portal Check' : 'View Images'}
                      </Button>
                    )}
                    {canReject && (
                      <Button variant="danger" onClick={() => setShowReject(true)} icon={<X className="h-4 w-4" />}>
                        Reject
                      </Button>
                    )}
                    {canHold && (
                      <Button variant="secondary" onClick={() => setShowHold(true)} icon={<Clock className="h-4 w-4" />}>
                        {holdActionLabel}
                      </Button>
                    )}
                  </div>
                </div>
              </motion.div>
            </>
          ) : currentOrder && !orderStarted ? (
            // Minimal preview when order is assigned but not started
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 rounded-xl ring-1 ring-emerald-200 p-6 text-center"
            >
              <h3 className="text-lg font-bold text-emerald-900 mb-2">Order Ready to Start</h3>
              <p className="text-sm text-emerald-700 mb-6">Click the button below to begin working on this order</p>
              <Button
                size="lg"
                onClick={handleStartOrder}
                loading={startingOrderId === currentOrder?.id}
                icon={<Play className="h-5 w-5" />}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-lg"
              >
                {startingOrderId === currentOrder?.id ? 'Starting...' : 'Start Order'}
              </Button>
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl ring-1 ring-black/[0.04] flex flex-col items-center justify-center py-16"
            >
              <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
                {autoAssigning ? (
                  <Loader2 className="h-6 w-6 text-brand-500 animate-spin" />
                ) : (
                  <RoleIcon className="h-6 w-6 text-brand-500" />
                )}
              </div>
              <h3 className="text-[15px] font-semibold text-slate-700 mb-1">Ready for next order</h3>
              <p className="text-sm text-slate-400 mb-5">System will assign the next order from your queue</p>
              <Button
                size="lg"
                onClick={handleGetNextOrder}
                loading={autoAssigning}
                icon={<Play className="h-4 w-4" />}
                className="bg-brand-500 hover:bg-brand-600"
                disabled={queueCount === 0}
              >
                {queueCount === 0 ? 'Queue Empty' : 'Get Next Order'}
              </Button>
              {queueCount === 0 && (
                <div className="mt-4 text-center">
                  <p className="text-xs text-slate-400">No orders available right now</p>
                  <p className="text-xs text-slate-300 mt-1">Auto-checking every 45 seconds...</p>
                </div>
              )}
            </motion.div>
          )}
        </>
      )}

      {/* Drawer Work Form Modal */}
      {currentOrder && showDrawerForm && (
        <DrawerWorkForm
          order={currentOrder}
          onClose={() => setShowDrawerForm(false)}
          onComplete={() => {
            setShowDrawerForm(false);
            setOrderStarted(false);
            setCurrentOrder(null);
            loadData();
          }}
        />
      )}

      {/* Checker Work Form Modal */}
      {currentOrder && showCheckerForm && (
        <CheckerWorkForm
          order={currentOrder}
          onClose={() => setShowCheckerForm(false)}
          onComplete={() => {
            setShowCheckerForm(false);
            setOrderStarted(false);
            setCurrentOrder(null);
            loadData();
          }}
        />
      )}

      {/* Filler Work Form Modal */}
      {currentOrder && showFillerForm && (
        <FillerWorkForm
          order={currentOrder}
          onClose={() => setShowFillerForm(false)}
          onComplete={() => {
            setShowFillerForm(false);
            setOrderStarted(false);
            setCurrentOrder(null);
            loadData();
          }}
        />
      )}

      {/* QA Work Form Modal */}
      {currentOrder && showQAForm && (
        <QAWorkForm
          order={currentOrder}
          onClose={() => setShowQAForm(false)}
          onComplete={() => {
            setShowQAForm(false);
            setOrderStarted(false);
            setCurrentOrder(null);
            loadData();
          }}
        />
      )}

      {/* Designer Work Form Modal */}
      {currentOrder && showDesignerForm && (
        <DesignerWorkForm
          order={currentOrder}
          onClose={() => setShowDesignerForm(false)}
          onComplete={() => {
            setShowDesignerForm(false);
            setOrderStarted(false);
            setCurrentOrder(null);
            loadData();
          }}
        />
      )}

      {/* Reject Modal */}
      <Modal
        open={showReject}
        onClose={() => setShowReject(false)}
        title="Reject Order"
        subtitle="Document the issue and route back for corrections"
        variant="danger"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowReject(false)} className="flex-1">Cancel</Button>
            <Button
              variant="danger"
              onClick={handleReject}
              loading={startingOrderId === currentOrder?.id}
              disabled={!rejectCode || !rejectReason || rejectReason.length < 10}
              className="flex-1"
            >
              Reject & Route Back
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Select
            id="reject-code-select"
            label="Rejection Code"
            required
            value={rejectCode}
            onChange={e => setRejectCode(e.target.value)}
            error={rejectCode === '' && rejectReason ? 'Please select a rejection code' : undefined}
          >
            <option value="">Select reason code...</option>
            {REJECTION_CODES.map(c => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </option>
            ))}
          </Select>

          <Textarea
            id="reject-details"
            label="Issue Details"
            required
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Describe the issue in detail (minimum 10 characters)..."
            rows={4}
            showCharCount
            maxLength={500}
            currentLength={rejectReason.length}
            error={rejectReason.length > 0 && rejectReason.length < 10 ? 'Please provide at least 10 characters' : undefined}
            hint="Be specific about what needs to be fixed"
          />

          {user?.role === 'qa' && (
            <Select
              id="route-to-select"
              label="Route to"
              value={routeTo}
              onChange={e => setRouteTo(e.target.value)}
              hint="Leave as Auto to route to the previous stage"
            >
              <option value="">Auto (previous stage)</option>
              <option value="draw">Drawing Stage</option>
              <option value="check">Checking Stage</option>
            </Select>
          )}
        </div>
      </Modal>

      {/* Hold Modal */}
      <Modal
        open={showHold}
        onClose={() => setShowHold(false)}
        title={holdActionTitle}
        subtitle={holdActionSubtitle}
        variant="warning"
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowHold(false)} className="flex-1">Cancel</Button>
            <Button
              onClick={handleHold}
              loading={startingOrderId === currentOrder?.id}
              disabled={!holdReason || holdReason.length < 10}
              className="flex-1 bg-amber-500 hover:bg-amber-600 focus-visible:ring-amber-500/30"
            >
              Confirm {holdActionLabel}
            </Button>
          </>
        }
      >
        <Textarea
          id="hold-reason"
          label={`Reason for ${holdActionLabel}`}
          required
          value={holdReason}
          onChange={e => setHoldReason(e.target.value)}
          placeholder={`Explain why this order needs to be ${isFirstStageWorker ? 'pending' : 'held'} (minimum 10 characters)...`}
          rows={4}
          showCharCount
          maxLength={300}
          currentLength={holdReason.length}
          error={holdReason.length > 0 && holdReason.length < 10 ? 'Please provide at least 10 characters' : undefined}
          hint={isFirstStageWorker ? 'This will move the order to pending and notify supervisors' : 'This will pause the order and notify supervisors'}
        />
      </Modal>
    </AnimatedPage>
  );
}
