import React, { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import {
  liveQAService, projectService,
  type LiveQAOverviewOrder,
  type LiveQAWorkerOrder,
  type LiveQAStats,
  type MistakeSummaryTeam,
  type ProductChecklistItem,
} from '../../services';
import { AnimatedPage, PageHeader, StatCard, Button, Select, Modal, LiveQATableSkeleton, LiveQAStatsSkeleton } from '../../components/ui';
import LiveQAChecklistModal from '../../components/LiveQAChecklistModal';
import {
  ShieldCheck, Search, AlertTriangle, CheckCircle, BarChart3,
  Loader2, FileSearch, Users, ClipboardList, Plus, Pencil, Trash2,
  ChevronLeft, Eye, Calendar, Clock,
  FileText, RefreshCw, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ClockDisplay from '../../components/ClockDisplay';

/* ───── Types ───── */
interface ProjectOption {
  id: number;
  name: string;
  country: string;
  client_name?: string;
  timezone?: string;
}

// Re-export from service for convenience
type OverviewOrder = LiveQAOverviewOrder;
type Stats = LiveQAStats;
type MistakeTeam = MistakeSummaryTeam;
type ChecklistItem = ProductChecklistItem;

interface OverviewCounts {
  today_total: number;
  pending: number;
  completed: number;
  amends: number;
  unassigned?: number;
}

type ViewTab = 'overview' | 'worker-live-qa' | 'drawer-report' | 'checker-report' | 'qa-report' | 'checklists';

/* ───── Helpers ───── */

function timeSince(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr.replace(/\//g, '-'));
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return '0m';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function getOrderStatus(order: OverviewOrder): { label: string; color: string } {
  if (order.workflow_state?.includes('DELIVER') || order.workflow_state?.includes('COMPLETE') || order.final_upload === 'yes') {
    return { label: 'Delivered', color: 'green' };
  }
  if (Number(order.amend) > 0) return { label: 'Amend', color: 'amber' };
  return { label: 'Process', color: 'rose' };
}

function formatReportColumnLabel(column: string): string {
  const normalized = String(column || '').trim();
  if (!normalized) return '';

  if (normalized === 'order_number') return 'Order Number';
  if (normalized === 'first_order_date') return 'First Order Date';
  if (normalized === 'live_qa_time') return 'Live QA Time';
  if (normalized === 'drawer_name') return 'Drawer Name';
  if (normalized === 'checker_name') return 'Checker Name';
  if (normalized === 'qa_name') return 'QA Name';
  if (normalized === 'total_mistakes') return 'Total Mistakes';

  return normalized;
}

function getReportLayerFromTab(tab: ViewTab): 'drawer' | 'checker' | 'qa' | null {
  if (tab === 'drawer-report') return 'drawer';
  if (tab === 'checker-report') return 'checker';
  if (tab === 'qa-report') return 'qa';
  return null;
}

function getLayerDisplayName(layer: 'drawer' | 'checker' | 'qa'): string {
  if (layer === 'drawer') return 'Drawer';
  if (layer === 'checker') return 'Checker';
  return 'QA';
}

// ─── Projects with special display rules ────────────────────────────────────
// Shows client_name after order_number in overview, checklist modal & mistake summary.
// Shows address instead of order_number in drawer/checker/qa reports.
// Add more project IDs here as needed in the future.
const CLIENT_ADDRESS_PROJECT_IDS = [14, 42, 46];

/** Parse due_in → ms remaining (PK timezone). */
function parseDueIn(rawInput: unknown, receivedAtInput?: unknown): number | null {
  const getPkNow = () => {
    const pkStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' });
    return new Date(pkStr).getTime();
  };
  // Safely coerce to string — API may return objects or numbers
  const raw = (rawInput != null && typeof rawInput !== 'object') ? String(rawInput) : null;
  const receivedAt = (receivedAtInput != null && typeof receivedAtInput !== 'object') ? String(receivedAtInput) : null;

  if (raw) {
    let d = new Date(raw);
    if (isNaN(d.getTime())) {
      const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})$/);
      if (m) d = new Date(+m[3], +m[1] - 1, +m[2], +m[4], +m[5], +m[6]);
    }
    if (!isNaN(d.getTime())) return d.getTime() - getPkNow();
  }
  if (receivedAt) {
    const rd = new Date(receivedAt);
    if (!isNaN(rd.getTime())) return (rd.getTime() + 24 * 3600_000) - getPkNow();
  }
  return null;
}

/** Remaining time badge with colour coding */
function RemainingBadge({ dueIn, receivedAt }: { dueIn?: unknown; receivedAt?: unknown }) {
  const ms = parseDueIn(dueIn, receivedAt);
  if (ms === null) return <span className="text-slate-300">—</span>;
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
}

function LiveRoleBadge({
  name,
  done,
  color,
  timeLabel,
}: {
  name?: string;
  done: boolean;
  color: string;
  timeLabel?: string;
}) {
  if (!name) {
    return <span className="text-xs text-slate-400 font-medium italic">Waiting</span>;
  }

  return (
    <div className="flex items-center justify-center gap-1.5">
      <div className={`w-5 h-5 rounded-full ${done ? 'bg-green-400' : color} text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0`}>
        {done ? '✓' : name.charAt(0).toUpperCase()}
      </div>
      <span className={`text-xs whitespace-nowrap ${done ? 'text-green-700 font-medium' : 'text-slate-800 font-medium'}`}>
        {name}
      </span>
      {done && <span className="text-green-500 text-[10px] font-bold">✓</span>}
      {timeLabel && (
        <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold bg-brand-500 text-white rounded">
          {timeLabel}
        </span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════ */

export default function LiveQADashboard() {
  const user = useSelector((state: RootState) => state.auth.user);
  const isWorkerLiveQaRole = user?.role === 'checker' || user?.role === 'qa';
  const canUseProject16WorkerLiveQa = isWorkerLiveQaRole && Number(user?.project_id) === 16;
  const workerLiveQaLayer = user?.role === 'checker' ? 'drawer' : user?.role === 'qa' ? 'checker' : null;

  // View state
  const [activeTab, setActiveTab] = useState<ViewTab>(canUseProject16WorkerLiveQa ? 'worker-live-qa' : 'overview');
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState<number>(0);
  // Overview state
  const [orders, setOrders] = useState<OverviewOrder[]>([]);
  const [counts, setCounts] = useState<OverviewCounts>({ today_total: 0, pending: 0, completed: 0, amends: 0, unassigned: 0 });
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [workerOrders, setWorkerOrders] = useState<LiveQAWorkerOrder[]>([]);
  const [workerOrdersLoading, setWorkerOrdersLoading] = useState(false);
  const [workerOrdersError, setWorkerOrdersError] = useState('');
  const [workerOrderPage, setWorkerOrderPage] = useState(1);
  const [workerOrdersPagination, setWorkerOrdersPagination] = useState({
    total: 0,
    per_page: 50,
    current_page: 1,
    last_page: 1,
  });
  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Stats state
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [reportDateFrom, setReportDateFrom] = useState('');
  const [reportDateTo, setReportDateTo] = useState('');
  const [reportFromDateTime, setReportFromDateTime] = useState('');
  const [reportToDateTime, setReportToDateTime] = useState('');
  const [reportExporting, setReportExporting] = useState<'csv' | 'jpg' | 'pdf' | null>(null);

  // Mistake summary state
  const [mistakeTeams, setMistakeTeams] = useState<MistakeTeam[]>([]);
  const [mistakeChecklistItems, setMistakeChecklistItems] = useState<string[]>([]);
  const [mistakeLoading, setMistakeLoading] = useState(false);
  const [mistakeSummary, setMistakeSummary] = useState({ total_orders: 0, total_mistakes: 0 });
  const [mistakeDateFrom, setMistakeDateFrom] = useState('');
  const [mistakeDateTo, setMistakeDateTo] = useState('');
  const [mistakeFromDateTime, setMistakeFromDateTime] = useState('');
  const [mistakeToDateTime, setMistakeToDateTime] = useState('');
  const [mistakeWorkerFilter, setMistakeWorkerFilter] = useState('');
  const [mistakeExporting, setMistakeExporting] = useState<'csv' | 'jpg' | 'pdf' | null>(null);

  // Checklist management
  const [checklists, setChecklists] = useState<ChecklistItem[]>([]);
  const [checklistsLoading, setChecklistsLoading] = useState(false);
  const [showAddChecklist, setShowAddChecklist] = useState(false);
  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [newChecklistClient, setNewChecklistClient] = useState('');
  const [editingChecklist, setEditingChecklist] = useState<ChecklistItem | null>(null);

  // Review modal
  const [reviewModal, setReviewModal] = useState<{ open: boolean; orderNumber: string; layer: string }>({
    open: false, orderNumber: '', layer: 'drawer',
  });

  // Mistake Summary Modal
  const [mistakeModal, setMistakeModal] = useState<{ open: boolean; layer: string }>({ open: false, layer: 'drawer' });

  // Project timezone
  const selectedProjectData = projects.find(p => p.id === selectedProject);
  const checklistClientOptions = Array.from(
    new Set(
      projects
        .map((p) => String(p.client_name || '').trim())
        .filter(Boolean)
    )
  );
  const projectTz = selectedProjectData?.timezone || 'Australia/Sydney';
  const isProject16WorkerLiveQaView = canUseProject16WorkerLiveQa && selectedProject === 16 && !!workerLiveQaLayer;
  const workerLiveQaTabLabel = user?.role === 'checker' ? 'My Drawer Live QA' : 'My Checker Live QA';

  useEffect(() => {
    if (!newChecklistClient && selectedProjectData?.client_name) {
      setNewChecklistClient(String(selectedProjectData.client_name));
    }
  }, [newChecklistClient, selectedProjectData?.client_name]);

  // Load projects
  useEffect(() => {
    projectService.list({ per_page: 100 } as any).then((res: any) => {
      const data = res.data?.data || res.data || [];
      const mapped = Array.isArray(data)
        ? data.map((p: any) => ({
          id: p.id,
          name: p.name,
          country: p.country,
          client_name: p.client_name,
          timezone: p.timezone,
        }))
        : [];
      setProjects(mapped);
      if (canUseProject16WorkerLiveQa) {
        const assignedProject = mapped.find((p: ProjectOption) => p.id === Number(user?.project_id));
        setSelectedProject(assignedProject?.id || Number(user?.project_id) || 16);
        return;
      }
      // Default to Metro FP (project 13)
      const metro = mapped.find((p: ProjectOption) => p.id === 13);
      setSelectedProject(metro ? 13 : mapped[0]?.id || 0);
    }).catch(() => {
      if (canUseProject16WorkerLiveQa) {
        setSelectedProject(Number(user?.project_id) || 16);
        return;
      }
      // Fallback: even if project list fails, still default to Metro
      setSelectedProject(13);
    });
  }, [canUseProject16WorkerLiveQa, user?.project_id]);

  useEffect(() => {
    if (canUseProject16WorkerLiveQa) {
      setActiveTab('worker-live-qa');
    }
  }, [canUseProject16WorkerLiveQa]);

  /* ─── Data fetchers ─── */

  const fetchOverview = useCallback(async () => {
    if (!selectedProject) return;
    setOrdersLoading(true);
    try {
      const res = await liveQAService.getOverview(selectedProject, {
        per_page: 10000,
        search: orderSearch || undefined,
        date: dateFilter || undefined,
        filter: statusFilter,
      });
      const d = res.data;
      setOrders(d.data || []);
      setCounts(d.counts || { today_total: 0, pending: 0, completed: 0, amends: 0 });
    } catch {
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  }, [selectedProject, orderSearch, dateFilter, statusFilter]);

  useEffect(() => {
    if (activeTab === 'overview') fetchOverview();
  }, [fetchOverview, activeTab]);

  const fetchWorkerOrders = useCallback(async () => {
    if (!isProject16WorkerLiveQaView || !workerLiveQaLayer) return;

    setWorkerOrdersLoading(true);
    setWorkerOrdersError('');
    try {
      const res = await liveQAService.getOrders(selectedProject, {
        layer: workerLiveQaLayer,
        page: workerOrderPage,
        per_page: 50,
        search: orderSearch || undefined,
      });
      const nextData = res.data?.data || [];
      const pagination = res.data?.pagination || res.data?.meta || {};

      setWorkerOrders(nextData);
      setWorkerOrdersPagination({
        total: Number(pagination.total ?? nextData.length ?? 0),
        per_page: Number(pagination.per_page ?? 50),
        current_page: Number(pagination.current_page ?? workerOrderPage),
        last_page: Number(pagination.last_page ?? 1),
      });
    } catch (error: any) {
      console.error(error);
      setWorkerOrders([]);
      setWorkerOrdersError(
        error?.response?.status === 403
          ? 'You do not have access to this Live QA layer/order.'
          : error?.response?.data?.message || 'Could not load your Live QA orders.'
      );
      setWorkerOrdersPagination({
        total: 0,
        per_page: 50,
        current_page: 1,
        last_page: 1,
      });
    } finally {
      setWorkerOrdersLoading(false);
    }
  }, [isProject16WorkerLiveQaView, orderSearch, selectedProject, workerLiveQaLayer, workerOrderPage]);

  useEffect(() => {
    if (activeTab === 'worker-live-qa') fetchWorkerOrders();
  }, [activeTab, fetchWorkerOrders]);

  useEffect(() => {
    setWorkerOrderPage(1);
  }, [selectedProject, orderSearch, workerLiveQaLayer]);

  const fetchMistakeSummary = useCallback(async (
    layer: string,
    dateFrom?: string,
    dateTo?: string,
    worker?: string,
    fromDateTime?: string,
    toDateTime?: string,
  ) => {
    if (!selectedProject) return;
    setMistakeLoading(true);
    try {
      const params: Record<string, string> = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (worker) params.worker = worker;
      if (fromDateTime) params.from_datetime = fromDateTime;
      if (toDateTime) params.to_datetime = toDateTime;
      const res = await liveQAService.getMistakeSummary(selectedProject, layer, params);
      const sanitizeText = (value: unknown) => {
        const text = String(value ?? '').trim();
        if (!text) return '';
        const lower = text.toLowerCase();
        if (lower === 'null' || lower === 'undefined') return '';
        return text;
      };

      const getClientFromRow = (row: Record<string, unknown>) =>
        sanitizeText(row.client_name) || sanitizeText(row.client) || sanitizeText(row.clint_name);

      const getWorkerKeyByLayer = (layerName: string) => {
        if (layerName === 'drawer') return 'drawer_name';
        if (layerName === 'checker') return 'checker_name';
        return 'qa_name';
      };

      const workerKey = getWorkerKeyByLayer(layer);
      const reportRows = Array.isArray((res.data as any)?.report_rows)
        ? ((res.data as any).report_rows as Array<Record<string, unknown>>)
        : [];

      const checklistItems = Array.isArray(res.data.checklist_items) ? res.data.checklist_items : [];

      const buildClientGroupedTeams = () => {
        const clientMap = new Map<string, {
          team_id: number;
          team_name: string;
          client_name: string | null;
          workers: Map<string, {
            name: string;
            client_name: string | null;
            plan_count: number;
            items: Record<string, number>;
            mistake_total: number;
            orderNumbers: Set<string>;
          }>;
        }>();

        reportRows.forEach((row) => {
          const workerName = sanitizeText(row?.[workerKey]);
          const clientName = getClientFromRow(row || {});
          if (!workerName || !clientName) return;

          const clientKey = clientName;
          if (!clientMap.has(clientKey)) {
            clientMap.set(clientKey, {
              team_id: clientMap.size + 1,
              team_name: clientName,
              client_name: clientName,
              workers: new Map(),
            });
          }

          const clientGroup = clientMap.get(clientKey)!;
          if (!clientGroup.workers.has(workerName)) {
            const initialItems: Record<string, number> = {};
            checklistItems.forEach((item) => {
              initialItems[item] = 0;
            });

            clientGroup.workers.set(workerName, {
              name: workerName,
              client_name: clientName,
              plan_count: 0,
              items: initialItems,
              mistake_total: 0,
              orderNumbers: new Set<string>(),
            });
          }

          const workerGroup = clientGroup.workers.get(workerName)!;
          const orderNumber = sanitizeText(row.order_number);
          if (orderNumber && !workerGroup.orderNumbers.has(orderNumber)) {
            workerGroup.orderNumbers.add(orderNumber);
            workerGroup.plan_count += 1;
          }

          let derivedMistakeTotal = 0;
          checklistItems.forEach((item) => {
            const rawValue = row[item];
            const numericValue = Number(rawValue ?? 0);
            const safeValue = Number.isFinite(numericValue) ? numericValue : 0;
            workerGroup.items[item] = (workerGroup.items[item] || 0) + safeValue;
            derivedMistakeTotal += safeValue;
          });

          const rowMistakeTotal = Number(row.total_mistakes ?? derivedMistakeTotal);
          workerGroup.mistake_total += Number.isFinite(rowMistakeTotal) ? rowMistakeTotal : derivedMistakeTotal;
        });

        return Array.from(clientMap.values())
          .map((team) => ({
            team_id: team.team_id,
            team_name: team.team_name,
            client_name: team.client_name,
            workers: Array.from(team.workers.values())
              .map(({ orderNumbers, ...worker }) => worker)
              .sort((a, b) => a.name.localeCompare(b.name)),
          }))
          .sort((a, b) => a.team_name.localeCompare(b.team_name));
      };

      const clientByWorker = new Map<string, string>();

      reportRows.forEach((row) => {
        const workerName = sanitizeText(row?.[workerKey]);
        const clientName = getClientFromRow(row || {});
        if (workerName && clientName && !clientByWorker.has(workerName)) {
          clientByWorker.set(workerName, clientName);
        }
      });

      const orderComments = Array.isArray((res.data as any)?.order_comments)
        ? ((res.data as any).order_comments as Array<Record<string, unknown>>)
        : [];

      orderComments.forEach((row) => {
        const workerName = sanitizeText(row.worker) || sanitizeText(row.worker_name) || sanitizeText(row.name);
        const clientName = getClientFromRow(row || {});
        if (workerName && clientName && !clientByWorker.has(workerName)) {
          clientByWorker.set(workerName, clientName);
        }
      });

      const normalizedTeams = CLIENT_ADDRESS_PROJECT_IDS.includes(selectedProject) && reportRows.length > 0
        ? buildClientGroupedTeams()
        : (res.data.teams || []).map((team) => {
          const teamClient = sanitizeText((team as any).client_name) || sanitizeText((team as any).client) || sanitizeText((team as any).clint_name);

          const normalizedWorkers = (team.workers || []).map((workerRow) => {
            const workerName = sanitizeText(workerRow.name);
            const workerClient = sanitizeText((workerRow as any).client_name)
              || sanitizeText((workerRow as any).client)
              || sanitizeText((workerRow as any).clint_name)
              || (workerName ? (clientByWorker.get(workerName) || '') : '');

            return {
              ...workerRow,
              client_name: workerClient || null,
            };
          });

          const fallbackWorkerClient = normalizedWorkers.find((w) => sanitizeText(w.client_name))?.client_name || null;

          return {
            ...team,
            client_name: teamClient || fallbackWorkerClient,
            workers: normalizedWorkers,
          };
        });

      setMistakeTeams(normalizedTeams);
      setMistakeChecklistItems(checklistItems);
      setMistakeSummary(res.data.summary || { total_orders: 0, total_mistakes: 0 });
    } catch {
      setMistakeTeams([]);
    } finally {
      setMistakeLoading(false);
    }
  }, [selectedProject]);

  const fetchChecklists = useCallback(async () => {
    setChecklistsLoading(true);
    try {
      const res = await liveQAService.getChecklists();
      setChecklists(res.data.data || []);
    } catch { setChecklists([]); }
    finally { setChecklistsLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'checklists') fetchChecklists();
  }, [fetchChecklists, activeTab]);

  // Fetch report
  const fetchReport = useCallback(async (layer: string) => {
    if (!selectedProject) return;
    setStatsLoading(true);
    try {
      const params: Record<string, string> = {};
      if (reportDateFrom) params.date_from = reportDateFrom;
      if (reportDateTo) params.date_to = reportDateTo;
      if (reportFromDateTime) params.from_datetime = reportFromDateTime;
      if (reportToDateTime) params.to_datetime = reportToDateTime;

      const res = await liveQAService.getStats(selectedProject, layer, params);
      setStats(res.data);
    } catch { setStats(null); }
    finally { setStatsLoading(false); }
  }, [reportDateFrom, reportDateTo, reportFromDateTime, reportToDateTime, selectedProject]);

  useEffect(() => {
    const reportLayer = getReportLayerFromTab(activeTab);
    if (reportLayer) fetchReport(reportLayer);
  }, [activeTab, fetchReport]);

  /* ─── Handlers ─── */
  const handleSearch = () => {
    if (activeTab === 'worker-live-qa') {
      setWorkerOrderPage(1);
      fetchWorkerOrders();
      return;
    }
    fetchOverview();
  };

  const openReview = (orderNumber: string, layer: string) => {
    if (!orderNumber || !layer) {
      console.error('❌ Cannot open review modal - missing parameters:', { orderNumber, layer });
      return;
    }
    setReviewModal({ open: true, orderNumber, layer });
  };

  const openMistakeSummary = (layer: string) => {
    setMistakeModal({ open: true, layer });
    setMistakeDateFrom('');
    setMistakeDateTo('');
    setMistakeFromDateTime('');
    setMistakeToDateTime('');
    setMistakeWorkerFilter('');
    fetchMistakeSummary(layer);
  };

  const handleAddChecklist = async () => {
    if (!newChecklistTitle.trim()) return;
    try {
      const selectedClient = (newChecklistClient || selectedProjectData?.client_name || selectedProjectData?.name || '').trim();
      await liveQAService.createChecklist({
        title: newChecklistTitle.trim(),
        check_list_type_id: 1,
        client: selectedClient,
      });
      setNewChecklistTitle('');
      setNewChecklistClient(selectedProjectData?.client_name || '');
      setShowAddChecklist(false);
      fetchChecklists();
    } catch { }
  };

  const handleUpdateChecklist = async () => {
    if (!editingChecklist) return;
    try {
      await liveQAService.updateChecklist(editingChecklist.id, {
        title: editingChecklist.title,
        client: editingChecklist.client,
      });
      setEditingChecklist(null);
      fetchChecklists();
    } catch { }
  };

  const handleDeleteChecklist = async (id: number) => {
    if (!confirm('Deactivate this checklist item?')) return;
    try { await liveQAService.deleteChecklist(id); fetchChecklists(); } catch { }
  };

  const isManager = user?.role === 'ceo' || user?.role === 'director' || user?.role === 'live_qa';
  const canManageChecklists = isManager || isWorkerLiveQaRole;

  if (isWorkerLiveQaRole && !canUseProject16WorkerLiveQa) {
    return (
      <AnimatedPage>
        <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-rose-500" />
          <h1 className="text-xl font-bold text-slate-900">Live QA Not Available</h1>
          <p className="mt-2 text-sm text-slate-600">
            Live QA worker access is currently enabled only for project 16. Your current assignment does not have worker Live QA access yet.
          </p>
        </div>
      </AnimatedPage>
    );
  }

  /* ═══════════════════════════════════════════════════════════════ */
  return (
    <AnimatedPage>
      {/* ─── Header with Project Time ─── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5">
        <PageHeader
          title="Live QA Panel"
          subtitle="New Order Entries — Quality Monitoring"
          badge={
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-brand-50 text-brand-700 rounded-full ring-1 ring-brand-200">
              <ShieldCheck className="h-3.5 w-3.5" /> Live QA
            </span>
          }
        />
        <div className="text-right mt-2 sm:mt-0">
          <ClockDisplay timezone={projectTz} className="text-sm font-semibold text-slate-800 font-mono" />
        </div>
      </div>

      {/* ─── Top Action Buttons ─── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {/* Project Selector */}
        <Select
          value={String(selectedProject)}
          onChange={(e) => {
            setSelectedProject(Number(e.target.value));
          }}
          className="min-w-[180px]"
          disabled={canUseProject16WorkerLiveQa}
        >
          <option value="0">Select Project</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name} ({p.country})</option>
          ))}
        </Select>

        <div className="h-6 w-px bg-slate-200 mx-1" />

        {isProject16WorkerLiveQaView ? (
          <button
            onClick={() => setActiveTab('worker-live-qa')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'worker-live-qa'
              ? 'bg-brand-700 text-white shadow-sm ring-1 ring-brand-800'
              : 'bg-brand-600 text-white hover:bg-brand-700'
              }`}
          >
            {workerLiveQaTabLabel}
          </button>
        ) : (
          <>
            {/* Report Buttons */}
            <button
              onClick={() => setActiveTab('drawer-report')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'drawer-report'
                ? 'bg-brand-700 text-white shadow-sm ring-1 ring-brand-800'
                : 'bg-brand-600 text-white hover:bg-brand-700'
                }`}
            >
              Drawer Report
            </button>
            <button
              onClick={() => openMistakeSummary('drawer')}
              className="px-3 py-1.5 text-xs font-semibold bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-all"
            >
              Drawer Mistake Summary
            </button>
            <button
              onClick={() => setActiveTab('checker-report')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'checker-report'
                ? 'bg-brand-700 text-white shadow-sm ring-1 ring-brand-800'
                : 'bg-brand-600 text-white hover:bg-brand-700'
                }`}
            >
              Checker Report
            </button>
            <button
              onClick={() => openMistakeSummary('checker')}
              className="px-3 py-1.5 text-xs font-semibold bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-all"
            >
              Checker Mistake Summary
            </button>
            <button
              onClick={() => setActiveTab('qa-report')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'qa-report'
                ? 'bg-brand-700 text-white shadow-sm ring-1 ring-brand-800'
                : 'bg-brand-600 text-white hover:bg-brand-700'
                }`}
            >
              QA Report
            </button>
            <button
              onClick={() => openMistakeSummary('qa')}
              className="px-3 py-1.5 text-xs font-semibold bg-accent-500 text-white rounded-lg hover:bg-accent-600 transition-all"
            >
              QA Mistake Summary
            </button>

            <div className="h-6 w-px bg-slate-200 mx-1" />

            {/* Quick filter buttons */}
            <button
              onClick={() => { setStatusFilter('all'); setActiveTab('overview'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'overview' && statusFilter === 'all'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
            >
              Pending ({counts.pending})
            </button>
            <button
              onClick={() => { setStatusFilter('unassigned'); setActiveTab('overview'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${statusFilter === 'unassigned' && activeTab === 'overview'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
            >
              Unassigned ({counts.unassigned ?? 0})
            </button>
            <button
              onClick={() => { setStatusFilter('completed'); setActiveTab('overview'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${statusFilter === 'completed' && activeTab === 'overview'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
            >
              Completed Orders ({counts.completed})
            </button>
            <button
              onClick={() => { setStatusFilter('amends'); setActiveTab('overview'); }}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${statusFilter === 'amends' && activeTab === 'overview'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
            >
              Done Amends ({counts.amends})
            </button>

            {canManageChecklists && (
              <>
                <div className="h-6 w-px bg-slate-200 mx-1" />
                <button
                  onClick={() => setActiveTab('checklists')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${activeTab === 'checklists'
                    ? 'bg-brand-600 text-white'
                    : 'bg-brand-100 text-brand-700 hover:bg-brand-200'
                    }`}
                >
                  <span className="flex items-center gap-1"><ClipboardList className="h-3 w-3" /> Manage Checklists</span>
                </button>
              </>
            )}
          </>
        )}

        {/* Refresh */}
        <button
          onClick={() => {
            if (activeTab === 'overview') fetchOverview();
            if (activeTab === 'worker-live-qa') fetchWorkerOrders();
            const reportLayer = getReportLayerFromTab(activeTab);
            if (reportLayer) fetchReport(reportLayer);
          }}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ml-auto"
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* ═══ TODAY TOTAL COUNTER ═══ */}
      {activeTab === 'worker-live-qa' && (
        <div className="mb-4 rounded-xl border border-brand-100 bg-brand-50/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-brand-800">{workerLiveQaTabLabel}</div>
              <p className="text-xs text-brand-700/80">
                {user?.role === 'checker'
                  ? 'You can review only drawer layer orders assigned to you for project 16.'
                  : 'You can review only checker layer orders assigned to you for project 16.'}
              </p>
            </div>
            <div className="text-xs font-medium text-brand-700">
              Layer: <span className="font-bold uppercase">{workerLiveQaLayer}</span>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'worker-live-qa' && (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[220px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search assigned orders..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
              />
            </div>
            <Button variant="secondary" size="sm" onClick={handleSearch}>
              <Search className="h-3.5 w-3.5 mr-1" /> Search
            </Button>
          </div>

          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden shadow-sm">
            {workerOrdersLoading ? (
              <LiveQATableSkeleton />
            ) : workerOrdersError ? (
              <div className="flex flex-col items-center justify-center py-16 text-rose-600">
                <AlertTriangle className="h-10 w-10 mb-3" />
                <p className="text-sm font-medium">{workerOrdersError}</p>
              </div>
            ) : workerOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <FileSearch className="h-12 w-12 mb-3" />
                <p className="text-sm font-medium">No assigned Live QA orders found</p>
                <p className="text-xs mt-1">Only backend-approved assigned orders appear here.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-brand-700 text-white">
                        <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Order</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Address</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Drawer</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Checker</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Progress</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workerOrders.map((order, index) => {
                        const liveQaDone = workerLiveQaLayer === 'drawer'
                          ? Boolean(order.d_live_qa)
                          : Boolean(order.c_live_qa);

                        return (
                          <motion.tr
                            key={order.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: Math.min(index * 0.02, 0.35) }}
                            className="border-b border-slate-100 hover:bg-slate-50/50"
                          >
                            <td className="px-3 py-3">
                              <div className="text-xs font-semibold text-slate-900">{order.order_number || '—'}</div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="max-w-md truncate text-xs text-slate-700" title={String(order.address || '')}>
                                {order.address || '—'}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <LiveRoleBadge
                                name={order.drawer_name || undefined}
                                done={order.drawer_done === 'yes'}
                                color="bg-brand-600"
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <LiveRoleBadge
                                name={order.checker_name || undefined}
                                done={order.checker_done === 'yes'}
                                color="bg-blue-600"
                              />
                            </td>
                            <td className="px-3 py-3 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${liveQaDone ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {liveQaDone ? 'Reviewed' : 'Pending'}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  {order.qa_reviewed_items || 0}/{order.qa_total_items || 0} items
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <button
                                onClick={() => {
                                  if (!order.order_number || !workerLiveQaLayer) return;
                                  openReview(order.order_number, workerLiveQaLayer);
                                }}
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-md transition-all ${liveQaDone
                                  ? 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm'
                                  : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 ring-1 ring-slate-200'
                                  }`}
                              >
                                {liveQaDone ? <CheckCircle className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                                {liveQaDone ? 'Open Review' : 'Start Review'}
                              </button>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-4 py-3">
                  <span className="text-xs text-slate-500">
                    Page {workerOrdersPagination.current_page} of {Math.max(workerOrdersPagination.last_page, 1)} • {workerOrdersPagination.total} orders
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={ChevronLeft}
                      onClick={() => setWorkerOrderPage((prev) => Math.max(1, prev - 1))}
                      disabled={workerOrdersLoading || workerOrdersPagination.current_page <= 1}
                    >
                      Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setWorkerOrderPage((prev) => Math.min(workerOrdersPagination.last_page, prev + 1))}
                      disabled={workerOrdersLoading || workerOrdersPagination.current_page >= workerOrdersPagination.last_page}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'overview' && (
        <div className="bg-brand-50/60 border border-brand-100 rounded-xl px-4 py-2.5 mb-4 flex items-center justify-center gap-3 flex-wrap">
          <span className="text-sm font-medium text-brand-700">
            Today Total Properties: <span className="text-lg font-bold text-brand-800">{counts.today_total}</span>
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-sm font-semibold text-red-600">High: {orders.filter(o => (o.priority || '').toLowerCase() === 'high').length}</span>
          <span className="text-sm font-semibold text-slate-600">Normal: {orders.filter(o => !o.priority || (o.priority || '').toLowerCase() === 'normal' || o.priority === '').length}</span>
          {orders.filter(o => (o.priority || '').toLowerCase() === 'rush').length > 0 && (
            <span className="text-sm font-semibold text-purple-600">Rush: {orders.filter(o => (o.priority || '').toLowerCase() === 'rush').length}</span>
          )}
          {orders.filter(o => (o.priority || '').toLowerCase() === 'urgent').length > 0 && (
            <span className="text-sm font-semibold text-orange-600">Urgent: {orders.filter(o => (o.priority || '').toLowerCase() === 'urgent').length}</span>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══ OVERVIEW TAB — Unified Order Table ═══ */}
      {/* ═══════════════════════════════════════════════════════════ */}


      {activeTab === 'overview' && (
        <div>
          {/* Search & Date Filter */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="Search order, address, worker..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-slate-400" />
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => { setDateFilter(e.target.value); }}
                className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                title="Filter by date"
              />
              {dateFilter && (
                <button
                  onClick={() => { setDateFilter(''); }}
                  className="p-1 rounded text-slate-400 hover:text-slate-600"
                  title="Clear date filter (show today)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={handleSearch}>
              <Search className="h-3.5 w-3.5 mr-1" /> Search
            </Button>
          </div>

          {/* ─── Main Orders Table ─── */}
          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden shadow-sm">
            {ordersLoading ? (
              <LiveQATableSkeleton />
            ) : orders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                <FileSearch className="h-12 w-12 mb-3" />
                <p className="text-sm font-medium">No orders found</p>
                <p className="text-xs mt-1">
                  {selectedProject ? 'No orders match your filters' : 'Select a project first'}
                </p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-brand-700 text-white">
                        <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Date</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Order</th>
                        {CLIENT_ADDRESS_PROJECT_IDS.includes(selectedProject) && (
                          <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Client</th>
                        )}
                        <th className="px-2 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Variant</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Priority</th>
                        <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Address</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Drawer</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">D-LiveQA</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Checker</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">C-LiveQA</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">QA</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Q-LiveQA</th>
                        <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Order Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...orders].sort((a, b) => {
                        const pw: Record<string, number> = { rush: 0, urgent: 0, high: 1, normal: 2, low: 3 };
                        return (pw[a.priority || 'normal'] ?? 2) - (pw[b.priority || 'normal'] ?? 2);
                      }).map((order, i) => {
                        const status = getOrderStatus(order);
                        const receivedAt = (order as any).received_at || order.created_at;
                        const hasDrawerDone = order.drawer_done === 'yes';
                        const hasCheckerDone = order.checker_done === 'yes';
                        const checkerWaiting = !order.checker_name;
                        const dLiveQaDone = Boolean(order.d_qa_done || Number(order.d_live_qa) > 0);
                        const cLiveQaDone = Boolean(order.c_qa_done || Number(order.c_live_qa) > 0);
                        const qLiveQaValue = order.qa_live_qa ?? order.q_live_qa;
                        // Reviewed = value was set (non-null), even with 0 mistakes — mirrors d_qa_done / c_qa_done logic
                        const qLiveQaDone = qLiveQaValue != null;
                        const qaWaiting = !order.qa_name;
                        const hasQaLayer = Boolean(order.qa_name || order.qa_done || qLiveQaDone);
                        const delivered = order.workflow_state?.includes('DELIVER') || order.workflow_state?.includes('COMPLETE') || order.final_upload === 'yes';
                        const checklistLayer = hasQaLayer ? 'qa' : hasCheckerDone ? 'checker' : hasDrawerDone ? 'drawer' : null;

                        return (
                          <motion.tr
                            key={order.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: Math.min(i * 0.015, 0.5) }}
                            className={`border-b border-slate-100 transition-colors ${!hasDrawerDone
                              ? 'bg-amber-50/50'
                              : checkerWaiting
                                ? 'bg-slate-50/40'
                                : 'hover:bg-slate-50/50'
                              }`}
                          >
                            {/* Date + Receive Time */}
                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="text-xs font-medium text-slate-700">
                                {receivedAt ? new Date(receivedAt).toLocaleDateString('en-GB', {
                                  day: '2-digit', month: 'short'
                                }) : '—'}
                              </div>
                              {receivedAt && (
                                <div className="text-[10px] text-blue-500 flex items-center gap-0.5 mt-0.5">
                                  <Clock className="w-2.5 h-2.5" />
                                  {new Date(receivedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                                </div>
                              )}
                              {order.dassign_time && (
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                  {timeSince(order.dassign_time)}
                                </div>
                              )}
                            </td>

                            {/* Order ID */}
                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="text-xs font-semibold text-slate-900">{String(order.order_number || '—')}</div>
                              {Number(order.amend) > 0 && (
                                <span className="text-[10px] text-amber-600 font-medium">AMEND</span>
                              )}
                            </td>
                            {CLIENT_ADDRESS_PROJECT_IDS.includes(selectedProject) && (
                              <td className="px-3 py-2 whitespace-nowrap">
                                <div className="text-xs text-slate-700">{order.client_name || '—'}</div>
                              </td>
                            )}

                            {/* Variant */}
                            <td className="px-2 py-2 text-slate-600 whitespace-nowrap text-xs">
                              {String((order as any).VARIANT_no ?? '') || '—'}
                            </td>

                            {/* Client / Priority */}
                            <td className="px-3 py-2 text-center">
                              <span className={`inline-flex px-2 py-0.5 text-[10px] font-bold uppercase rounded ${order.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                order.priority === 'high' ? 'bg-amber-100 text-amber-700' :
                                  order.priority === 'normal' ? 'bg-slate-100 text-slate-600' :
                                    'bg-slate-100 text-slate-500'
                                }`}>
                                {String(order.priority || 'Normal')}
                              </span>
                            </td>

                            {/* Address + Remaining Time */}
                            <td className="px-3 py-2">
                              <div className="text-xs text-slate-700 truncate" title={String(order.address || '')}>
                                {String(order.address || '') || '—'}
                              </div>
                              {!(order.workflow_state?.includes('COMPLETE') || order.workflow_state?.includes('DELIVER') || order.final_upload === 'yes') && (
                                <div className="mt-0.5">
                                  <RemainingBadge dueIn={(order as any).due_in} receivedAt={(order as any).received_at || order.created_at} />
                                </div>
                              )}
                            </td>

                            {/* Drawer */}
                            <td className="px-3 py-2 text-center">
                              <LiveRoleBadge
                                name={order.drawer_name}
                                done={hasDrawerDone}
                                color="bg-brand-600"
                                timeLabel={hasDrawerDone ? (timeSince(order.drawer_date) || '0m') : undefined}
                              />
                            </td>

                            {/* D-LiveQA */}
                            <td className="px-3 py-2 text-center">
                              {hasDrawerDone ? (
                                <button
                                  onClick={() => {
                                    if (!order?.order_number) {
                                      console.error('❌ Order number is missing:', order);
                                      return;
                                    }
                                    openReview(order.order_number, 'drawer');
                                  }}
                                  className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${dLiveQaDone
                                    ? 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm'
                                    : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 ring-1 ring-slate-200'
                                    }`}
                                >
                                  {dLiveQaDone ? (
                                    <>
                                      <CheckCircle className="h-3 w-3" />
                                      D-LiveQA
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="h-3 w-3" />
                                      Review
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-medium italic">Waiting</span>
                              )}
                            </td>

                            {/* Checker */}
                            <td className={`px-3 py-2 text-center ${checkerWaiting ? 'bg-slate-50' : ''}`}>
                              <LiveRoleBadge
                                name={order.checker_name}
                                done={hasCheckerDone}
                                color="bg-blue-600"
                                timeLabel={hasCheckerDone ? (timeSince(order.checker_date) || '0m') : undefined}
                              />
                            </td>

                            {/* C-LiveQA */}
                            <td className={`px-3 py-2 text-center ${checkerWaiting ? 'bg-slate-50' : ''}`}>
                              {hasCheckerDone ? (
                                <button
                                  onClick={() => {
                                    if (!order?.order_number) {
                                      console.error('❌ Order number is missing:', order);
                                      return;
                                    }
                                    openReview(order.order_number, 'checker');
                                  }}
                                  className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${cLiveQaDone
                                    ? 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm'
                                    : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 ring-1 ring-slate-200'
                                    }`}
                                >
                                  {cLiveQaDone ? (
                                    <>
                                      <CheckCircle className="h-3 w-3" />
                                      C-LiveQA
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="h-3 w-3" />
                                      Review
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-medium italic">Waiting</span>
                              )}
                            </td>

                            {/* QA */}
                            <td className={`px-3 py-2 text-center ${qaWaiting ? 'bg-slate-50' : ''}`}>
                              <LiveRoleBadge
                                name={order.qa_name}
                                done={qLiveQaDone}
                                color="bg-purple-600"
                              />
                            </td>

                            {/* Q-LiveQA */}
                            <td className={`px-3 py-2 text-center ${qaWaiting ? 'bg-slate-50' : ''}`}>
                              {order.qa_name ? (
                                <button
                                  onClick={() => {
                                    if (!order?.order_number) {
                                      console.error('❌ Order number is missing:', order);
                                      return;
                                    }
                                    openReview(order.order_number, 'qa');
                                  }}
                                  className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${qLiveQaDone
                                    ? 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm'
                                    : 'bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 ring-1 ring-slate-200'
                                    }`}
                                >
                                  {qLiveQaDone ? (
                                    <>
                                      <CheckCircle className="h-3 w-3" />
                                      Q-LiveQA
                                    </>
                                  ) : (
                                    <>
                                      <Eye className="h-3 w-3" />
                                      Review
                                    </>
                                  )}
                                </button>
                              ) : (
                                <span className="text-[10px] text-slate-400 font-medium italic">Waiting</span>
                              )}
                            </td>

                            {/* Order Status */}
                            <td className="px-3 py-2 text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold rounded-md ${status.color === 'green'
                                  ? 'bg-brand-500 text-white'
                                  : status.color === 'amber'
                                    ? 'bg-amber-500 text-white'
                                    : 'bg-slate-100 text-slate-600'
                                  }`}>
                                  {delivered && <CheckCircle className="h-3 w-3" />}
                                  {status.label}
                                </span>
                                {checklistLayer && (
                                  <button
                                    onClick={() => {
                                      if (!order?.order_number) {
                                        console.error('❌ Order number is missing:', order);
                                        return;
                                      }
                                      if (!checklistLayer) {
                                        console.error('❌ Checklist layer is missing');
                                        return;
                                      }
                                      openReview(order.order_number, checklistLayer);
                                    }}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold rounded-md bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 ring-1 ring-slate-200 transition-all"
                                  >
                                    <ClipboardList className="h-3 w-3" />
                                    Checklist
                                  </button>
                                )}
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Total count */}
                {orders.length > 0 && (
                  <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/30">
                    <span className="text-xs text-slate-500">{orders.length} orders</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══ DRAWER REPORT / CHECKER REPORT TAB ═══ */}
      {/* ═══════════════════════════════════════════════════════════ */}

      {(activeTab === 'drawer-report' || activeTab === 'checker-report' || activeTab === 'qa-report') && (
        <div>
          {(() => {
            const currentLayer = getReportLayerFromTab(activeTab) || 'drawer';
            const currentLayerLabel = getLayerDisplayName(currentLayer);
            const hasReportRows = !!stats
              && Array.isArray(stats.report_columns)
              && stats.report_columns.length > 0
              && Array.isArray(stats.report_rows)
              && stats.report_rows.length > 0;

            const reportDateRangeLabel = `${stats?.from_datetime || stats?.date_from || reportFromDateTime || reportDateFrom || '-'} to ${stats?.to_datetime || stats?.date_to || reportToDateTime || reportDateTo || '-'}`;
            const useAddressInReport = CLIENT_ADDRESS_PROJECT_IDS.includes(selectedProject);
            const getReportColLabel = (column: string) => {
              if (column === 'order_number' && useAddressInReport) return 'Address';
              return formatReportColumnLabel(column);
            };
            // Build order_comments map: order_id + checklist_item -> text_value for quick lookup
            const orderCommentsMap = new Map<string, string>();

            if (Array.isArray((stats as any)?.order_comments)) {
              ((stats as any).order_comments as Array<Record<string, unknown>>).forEach((comment) => {
                const orderId = String(comment.order_id ?? '');
                const checklistItem = String(comment.checklist_item ?? '');
                const textValue = comment?.text_value;

                if (orderId && checklistItem && textValue != null && textValue !== '' && String(textValue).trim() !== 'null') {
                  // Create composite key: order_id + checklist_item
                  const key = `${orderId}|${checklistItem}`;
                  orderCommentsMap.set(key, String(textValue).trim());
                }
              });
            }

            // Use all report columns as-is, no filtering
            const displayColumns = stats?.report_columns || [];

            const getReportCellValue = (column: string, row: Record<string, unknown>) => {
              if (column === 'order_number' && useAddressInReport) {
                const addr = row?.address;
                return addr == null || addr === '' ? null : String(addr);
              }

              // For checklist item columns, look up text_value from order_comments
              const rowOrderId = String(row?.order_id ?? row?.order_number ?? '');
              if (rowOrderId) {
                // Try to find matching order comment for this column (column name = checklist_item)
                const key = `${rowOrderId}|${column}`;
                if (orderCommentsMap.has(key)) {
                  return orderCommentsMap.get(key) || null;
                }
              }

              // Fall back to original row value
              const rawValue = row?.[column];
              return rawValue == null || rawValue === '' ? null : String(rawValue);
            };
            const sanitizeHtml = (value: unknown) => {
              return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            };

            const buildReportSnapshotHtml = () => {
              const summaryHtml = `
                <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px;">
                  <div style="border:1px solid #dbeafe;border-radius:10px;padding:10px;background:#eff6ff;">
                    <div style="font-size:16px;font-weight:700;color:#1e293b;">Orders Reviewed</div>
                    <div style="font-size:34px;font-weight:800;color:#1e40af;">${sanitizeHtml(stats?.orders_reviewed ?? 0)}</div>
                  </div>
                  <div style="border:1px solid #fecaca;border-radius:10px;padding:10px;background:#fff1f2;">
                    <div style="font-size:16px;font-weight:700;color:#1e293b;">Total Mistakes</div>
                    <div style="font-size:34px;font-weight:800;color:#be123c;">${sanitizeHtml(stats?.total_mistakes ?? 0)}</div>
                  </div>
                  <div style="border:1px solid #bfdbfe;border-radius:10px;padding:10px;background:#f0f9ff;">
                    <div style="font-size:16px;font-weight:700;color:#1e293b;">Total Reviews</div>
                    <div style="font-size:34px;font-weight:800;color:#0369a1;">${sanitizeHtml(stats?.total_reviews ?? 0)}</div>
                  </div>
                </div>
              `;

              const tableHead = (displayColumns || [])
                .map((column) => `<th style="border:1px solid #cbd5e1;padding:10px 12px;background:#0f766e;color:#ffffff;text-align:left;font-size:12px;font-weight:800;white-space:normal;word-break:break-word;">${sanitizeHtml(getReportColLabel(column))}</th>`)
                .join('');

              const tableBody = (stats?.report_rows || [])
                .map((row) => {
                  const cells = (displayColumns || []).map((column) => {
                    const displayValue = getReportCellValue(column, row || {});
                    const cellContent = displayValue ? sanitizeHtml(displayValue) : '';
                    return `<td style="border:1px solid #e2e8f0;padding:10px 12px;font-size:14px;font-weight:700;color:#0f172a;vertical-align:top;word-break:break-word;max-width:200px;word-wrap:break-word;line-height:1.5;">${cellContent}</td>`;
                  }).join('');

                  return `<tr>${cells}</tr>`;
                })
                .join('');

              return `
                <div style="font-family:Segoe UI,Arial,sans-serif;background:#ffffff;color:#0f172a;padding:16px;">
                  <div style="margin-bottom:14px;text-align:center;">
                    <h1 style="font-size:24px;font-weight:800;line-height:1.2;margin:0 0 8px 0;color:#0f172a;">${sanitizeHtml(currentLayerLabel)} Report</h1>
                    <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:4px;">Date & Time Filter: ${sanitizeHtml(reportDateRangeLabel)}</div>
                    <div style="font-size:14px;font-weight:700;color:#1e293b;">Generated: ${sanitizeHtml(new Date().toLocaleString())}</div>
                  </div>
                  ${summaryHtml}
                  <div style="font-size:14px;font-weight:800;color:#1e293b;margin:10px 0;text-align:center;">Orders Report (${sanitizeHtml(stats?.report_rows?.length ?? 0)} records)</div>
                  <table style="width:100%;border-collapse:collapse;table-layout:auto;">
                    <thead><tr>${tableHead}</tr></thead>
                    <tbody>${tableBody}</tbody>
                  </table>
                </div>
              `;
            };

            const downloadReportCsv = async () => {
              if (!hasReportRows) return;

              try {
                setReportExporting('csv');
                const csv = [
                  (displayColumns || []).map((column) => getReportColLabel(column)).join(','),
                  ...stats!.report_rows!.map((row) =>
                    (displayColumns || []).map((column) => {
                      const cell = getReportCellValue(column, row || {});
                      const cellValue = cell ?? '';
                      return `"${String(cellValue).replace(/"/g, '""')}"`;
                    }).join(',')
                  ),
                ].join('\n');

                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = `${currentLayer}_report_${selectedProject}_${new Date().toISOString().slice(0, 10)}.csv`;
                link.click();
                URL.revokeObjectURL(url);
              } finally {
                setReportExporting(null);
              }
            };

            const downloadReportJpg = async () => {
              if (!hasReportRows) return;

              let container: HTMLDivElement | null = null;
              try {
                setReportExporting('jpg');
                const { default: html2canvas } = await import('html2canvas');

                container = document.createElement('div');
                container.style.position = 'fixed';
                container.style.left = '-99999px';
                container.style.top = '0';
                container.style.width = '1900px';
                container.style.zIndex = '-1';
                container.innerHTML = buildReportSnapshotHtml();
                document.body.appendChild(container);

                const canvas = await html2canvas(container, {
                  backgroundColor: '#ffffff',
                  scale: 3,
                  useCORS: true,
                  logging: false,
                  windowWidth: 1900,
                });

                const dataUrl = canvas.toDataURL('image/jpeg', 0.96);
                const link = document.createElement('a');
                link.href = dataUrl;
                link.download = `${currentLayer}_report_${selectedProject}_${new Date().toISOString().slice(0, 10)}.jpg`;
                link.click();
              } catch (error) {
                console.error('Failed to export JPG report:', error);
              } finally {
                if (container && container.parentNode) {
                  container.parentNode.removeChild(container);
                }
                setReportExporting(null);
              }
            };

            const downloadReportPdf = async () => {
              if (!hasReportRows) return;

              try {
                setReportExporting('pdf');
                const { default: jsPDF } = await import('jspdf');
                const { default: autoTable } = await import('jspdf-autotable');

                const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
                const pageWidth = doc.internal.pageSize.getWidth();
                doc.setTextColor(15, 23, 42);
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(18);
                doc.text(`${currentLayerLabel} Report`, pageWidth / 2, 38, { align: 'center' });

                doc.setFontSize(12);
                doc.text(`Project ID: ${selectedProject}`, pageWidth / 2, 58, { align: 'center' });
                doc.text(`Date & Time Filter: ${reportDateRangeLabel}`, pageWidth / 2, 74, { align: 'center' });
                doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, 90, { align: 'center' });

                doc.setFontSize(13);
                doc.text(`Summary  |  Orders Reviewed: ${stats?.orders_reviewed ?? 0}  |  Total Mistakes: ${stats?.total_mistakes ?? 0}  |  Total Reviews: ${stats?.total_reviews ?? 0}`, pageWidth / 2, 110, { align: 'center' });

                const tableHeaders = (displayColumns || []).map((column) => getReportColLabel(column));
                const tableRows = (stats?.report_rows || []).map((row) =>
                  (displayColumns || []).map((column) => {
                    const cellValue = getReportCellValue(column, row || {});
                    return cellValue ?? '';
                  })
                );

                autoTable(doc, {
                  startY: 126,
                  head: [tableHeaders],
                  body: tableRows,
                  styles: {
                    fontSize: 9.5,
                    fontStyle: 'bold',
                    textColor: [15, 23, 42],
                    cellPadding: 5,
                    overflow: 'linebreak',
                  },
                  headStyles: {
                    fillColor: [15, 118, 110],
                    textColor: 255,
                    fontStyle: 'bold',
                    fontSize: 10.5,
                  },
                  margin: { left: 24, right: 24 },
                });

                doc.save(`${currentLayer}_report_${selectedProject}_${new Date().toISOString().slice(0, 10)}.pdf`);
              } catch (error) {
                console.error('Failed to export PDF report:', error);
              } finally {
                setReportExporting(null);
              }
            };

            return (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-brand-600" />
                    {currentLayerLabel} Report
                  </h3>
                  <Button variant="secondary" size="sm" onClick={() => setActiveTab('overview')}>
                    <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back to Overview
                  </Button>
                </div>

                <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[140px]">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Date From</label>
                      <input
                        type="date"
                        value={reportDateFrom}
                        onChange={(e) => setReportDateFrom(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                    </div>
                    <div className="min-w-[140px]">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Date To</label>
                      <input
                        type="date"
                        value={reportDateTo}
                        onChange={(e) => setReportDateTo(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                    </div>
                    <div className="min-w-[190px]">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">From Date Time</label>
                      <input
                        type="datetime-local"
                        value={reportFromDateTime}
                        onChange={(e) => setReportFromDateTime(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                    </div>
                    <div className="min-w-[190px]">
                      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">To Date Time</label>
                      <input
                        type="datetime-local"
                        value={reportToDateTime}
                        onChange={(e) => setReportToDateTime(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                      />
                    </div>
                    <button
                      onClick={() => fetchReport(currentLayer)}
                      className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700"
                    >
                      Apply Filters
                    </button>
                    <button
                      onClick={() => {
                        setReportDateFrom('');
                        setReportDateTo('');
                        setReportFromDateTime('');
                        setReportToDateTime('');
                      }}
                      className="rounded-lg bg-slate-200 px-4 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-300"
                    >
                      Clear
                    </button>
                    <button
                      onClick={downloadReportCsv}
                      disabled={!hasReportRows || reportExporting !== null}
                      className="ml-auto rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {reportExporting === 'csv' ? 'Exporting CSV...' : 'Download CSV'}
                    </button>
                    <button
                      onClick={downloadReportJpg}
                      disabled={!hasReportRows || reportExporting !== null}
                      className="rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {reportExporting === 'jpg' ? 'Exporting JPG...' : 'Download JPG'}
                    </button>
                    <button
                      onClick={downloadReportPdf}
                      disabled={!hasReportRows || reportExporting !== null}
                      className="rounded-lg bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {reportExporting === 'pdf' ? 'Exporting PDF...' : 'Download PDF'}
                    </button>
                  </div>
                </div>

                {statsLoading ? (
                  <LiveQAStatsSkeleton />
                ) : !stats ? (
                  <div className="text-center py-20 text-slate-400">
                    <BarChart3 className="h-12 w-12 mx-auto mb-3" />
                    <p className="text-sm">No data available</p>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <StatCard label="Orders Reviewed" value={stats.orders_reviewed} icon={FileSearch} color="blue" />
                      <StatCard label="Total Mistakes" value={stats.total_mistakes} icon={AlertTriangle} color="rose" />
                      <StatCard label="Total Reviews" value={stats.total_reviews} icon={ClipboardList} color="brand" />
                    </div>

                    {Array.isArray(stats.report_columns) && stats.report_columns.length > 0 && Array.isArray(stats.report_rows) && stats.report_rows.length > 0 && (
                      <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                            <FileText className="h-4 w-4 text-slate-500" />
                            {currentLayerLabel} Comment Report
                          </h3>
                          {(stats.from_datetime || stats.to_datetime || stats.date_from || stats.date_to) && (
                            <p className="mt-1 text-xs text-slate-500">
                              {stats.from_datetime || stats.date_from || '-'} to {stats.to_datetime || stats.date_to || '-'}
                            </p>
                          )}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-brand-700 text-white">
                                {displayColumns.map((column) => (
                                  <th key={column} className="px-3 py-2 text-left font-semibold text-[11px] whitespace-nowrap">
                                    {getReportColLabel(column)}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {stats.report_rows.map((row, rowIndex) => (
                                <tr key={rowIndex} className="border-b border-slate-100 hover:bg-slate-50/50 align-top">
                                  {displayColumns!.map((column) => {
                                    const displayValue = getReportCellValue(column, row || {});
                                    const isTotalColumn = column === 'total_mistakes';

                                    return (
                                      <td
                                        key={`${rowIndex}-${column}`}
                                        className={`px-3 py-2 text-[11px] ${isTotalColumn ? 'text-right' : 'text-left'} ${displayValue ? 'text-slate-700' : 'text-slate-400'}`}
                                      >
                                        {displayValue ? (
                                          isTotalColumn ? (
                                            <span className={`font-semibold ${Number(displayValue) > 0 ? 'text-rose-600' : 'text-green-600'}`}>
                                              {displayValue}
                                            </span>
                                          ) : (
                                            <span className="whitespace-pre-wrap break-words leading-tight">{displayValue}</span>
                                          )
                                        ) : null}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Worker Stats */}
                    {stats.worker_stats && stats.worker_stats.length > 0 && (
                      <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                            <Users className="h-4 w-4 text-slate-500" />
                            {currentLayerLabel} - Mistakes by Worker
                          </h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-brand-700 text-white">
                                <th className="px-4 py-2 text-left font-semibold text-xs">#</th>
                                <th className="px-4 py-2 text-left font-semibold text-xs">Worker Name</th>
                                <th className="px-4 py-2 text-right font-semibold text-xs">Orders Checked</th>
                                <th className="px-4 py-2 text-right font-semibold text-xs">Total Mistakes</th>
                                <th className="px-4 py-2 text-right font-semibold text-xs">Avg / Order</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(stats.worker_stats || []).map((ws, i) => (
                                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                                  <td className="px-4 py-2 text-slate-400 text-xs">{i + 1}</td>
                                  <td className="px-4 py-2 font-medium text-slate-800">{String(ws.worker ?? '')}</td>
                                  <td className="px-4 py-2 text-right text-slate-600">{ws.orders_checked}</td>
                                  <td className="px-4 py-2 text-right">
                                    <span className={`font-bold ${ws.total_mistakes > 0 ? 'text-rose-600' : 'text-green-600'}`}>
                                      {ws.total_mistakes}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-right text-slate-500">
                                    {ws.orders_checked > 0 ? (ws.total_mistakes / ws.orders_checked).toFixed(1) : '0'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Checklist Item Stats */}
                    {stats.checklist_stats && stats.checklist_stats.length > 0 && (
                      <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
                        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
                          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                            <ClipboardList className="h-4 w-4 text-slate-500" /> Mistakes by Checklist Item
                          </h3>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-brand-700 text-white">
                                <th className="px-4 py-2 text-left font-semibold text-xs">Checklist Item</th>
                                <th className="px-4 py-2 text-right font-semibold text-xs">Total Mistakes</th>
                                <th className="px-4 py-2 text-right font-semibold text-xs">Orders Affected</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(stats.checklist_stats || []).map((cs, i) => (
                                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                                  <td className="px-4 py-2 font-medium text-slate-800">{String(cs.title ?? '')}</td>
                                  <td className="px-4 py-2 text-right">
                                    <span className={`font-bold ${cs.total_mistakes > 0 ? 'text-rose-600' : 'text-green-600'}`}>
                                      {cs.total_mistakes}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-right text-slate-600">{cs.orders_affected}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* ═══ CHECKLISTS TAB (Checklist managers + Live QA roles) ═══ */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {activeTab === 'checklists' && canManageChecklists && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Product Checklist Items
            </h3>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setShowAddChecklist(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Item
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setActiveTab('overview')}>
                <ChevronLeft className="h-3.5 w-3.5 mr-1" /> Back
              </Button>
            </div>
          </div>

          <AnimatePresence>
            {showAddChecklist && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="mb-4 bg-white rounded-xl ring-1 ring-black/[0.04] p-4"
              >
                <div className="flex items-center gap-2">
                  <select
                    value={newChecklistClient}
                    onChange={(e) => setNewChecklistClient(e.target.value)}
                    className="w-52 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
                    title="Select client"
                  >
                    <option value="">Select Client</option>
                    {checklistClientOptions.map((client) => (
                      <option key={client} value={client}>{client}</option>
                    ))}
                  </select>
                  <input
                    type="text" value={newChecklistTitle}
                    onChange={(e) => setNewChecklistTitle(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddChecklist()}
                    placeholder="Checklist item title (e.g., Missing Elements)"
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
                    autoFocus
                  />
                  <Button size="sm" onClick={handleAddChecklist}>Add</Button>
                  <Button size="sm" variant="secondary" onClick={() => {
                    setShowAddChecklist(false);
                    setNewChecklistTitle('');
                    setNewChecklistClient(selectedProjectData?.client_name || '');
                  }}>
                    Cancel
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
            {checklistsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
              </div>
            ) : checklists.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <ClipboardList className="h-10 w-10 mx-auto mb-2" />
                <p className="text-sm">No checklist items yet</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-brand-700 text-white">
                    <th className="px-4 py-2 text-left font-semibold text-xs w-8">#</th>
                    <th className="px-4 py-2 text-left font-semibold text-xs">Title</th>
                    <th className="px-4 py-2 text-left font-semibold text-xs">Client</th>
                    <th className="px-4 py-2 text-left font-semibold text-xs">Product</th>
                    <th className="px-4 py-2 text-center font-semibold text-xs">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {checklists.map((item, i) => (
                    <tr key={item.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-2 text-slate-400 text-xs">{i + 1}</td>
                      <td className="px-4 py-2">
                        {editingChecklist?.id === item.id ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text" value={editingChecklist.title}
                              onChange={(e) => setEditingChecklist({ ...editingChecklist, title: e.target.value })}
                              onKeyDown={(e) => e.key === 'Enter' && handleUpdateChecklist()}
                              className="flex-1 px-2 py-1 text-sm border border-brand-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                              title="Edit checklist title"
                              autoFocus
                            />
                            <button onClick={handleUpdateChecklist} className="text-brand-600 hover:text-brand-700" title="Save"><CheckCircle className="h-4 w-4" /></button>
                            <button onClick={() => setEditingChecklist(null)} className="text-slate-400 hover:text-slate-600" title="Cancel">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (<span className="font-medium text-slate-800">{item.title}</span>)}
                      </td>
                      <td className="px-4 py-2 text-slate-600">
                        {editingChecklist?.id === item.id ? (
                          <select
                            value={editingChecklist.client || ''}
                            onChange={(e) => setEditingChecklist({ ...editingChecklist, client: e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-brand-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                            title="Edit client"
                          >
                            <option value="">Select Client</option>
                            {checklistClientOptions.map((client) => (
                              <option key={client} value={client}>{client}</option>
                            ))}
                          </select>
                        ) : (
                          String(item.client ?? '')
                        )}
                      </td>
                      <td className="px-4 py-2 text-slate-600">{String(item.product ?? '')}</td>
                      <td className="px-4 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={() => setEditingChecklist(item)} className="p-1.5 rounded-md text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors" title="Edit">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDeleteChecklist(item.id)} className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors" title="Deactivate">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

        </div>
      )}


      {/* ═══ MISTAKE SUMMARY MODAL — TEAM-GROUPED PIVOT ═══ */}
      {mistakeModal.open && (() => {
        const cols = mistakeChecklistItems.length > 0 ? mistakeChecklistItems : [];
        const projectName = projects.find(p => p.id === selectedProject)?.name || 'Project';
        const layerLabel = mistakeModal.layer === 'drawer' ? 'Drawer' : mistakeModal.layer === 'checker' ? 'Checker' : 'QA';
        const hasMistakeData = mistakeTeams.length > 0 && cols.length > 0;
        const selectedWorkerLabel = mistakeWorkerFilter.trim() || 'All';
        const appliedRangeLabel = [
          mistakeDateFrom ? `Date From ${mistakeDateFrom}` : '',
          mistakeDateTo ? `Date To ${mistakeDateTo}` : '',
          mistakeFromDateTime ? `From ${mistakeFromDateTime}` : '',
          mistakeToDateTime ? `To ${mistakeToDateTime}` : '',
        ].filter(Boolean).join(' | ') || 'Current selection';
        const exportMetaRows = [
          ['Report', `F.P. ${layerLabel} Checklist Summary`],
          ['Project', projectName],
          ['Project ID', String(selectedProject || '')],
          ['Layer', layerLabel],
          ['Worker Filter', selectedWorkerLabel],
          ['Date/Time Filter', appliedRangeLabel],
          ['Orders Reviewed', String(mistakeSummary.total_orders)],
          ['Total Mistakes', String(mistakeSummary.total_mistakes)],
          ['Generated At', new Date().toLocaleString()],
        ];

        const toValidText = (value: unknown) => {
          const text = String(value ?? '').trim();
          if (!text) return '';
          const lowered = text.toLowerCase();
          if (lowered === 'null' || lowered === 'undefined') return '';
          return text;
        };

        const getClientLabel = (obj: unknown) => {
          if (!obj || typeof obj !== 'object') return '';
          const row = obj as Record<string, unknown>;
          return toValidText(row.client_name)
            || toValidText(row.client)
            || toValidText(row.clint_name);
        };

        // Team label helper: for selected projects show client label, else team name
        const getTeamLabel = (team: MistakeTeam) => {
          if (!CLIENT_ADDRESS_PROJECT_IDS.includes(selectedProject)) return team.team_name;

          const teamClientLabel = getClientLabel(team);
          const workerClientLabel = team.workers.reduce<string>((found, worker) => {
            if (found) return found;
            return getClientLabel(worker);
          }, '');

          return teamClientLabel || workerClientLabel || team.team_name;
        };

        // Compute grand totals
        const grandPlanCount = mistakeTeams.reduce((s, t) => s + t.workers.reduce((ws, w) => ws + w.plan_count, 0), 0);
        const grandTotals: Record<string, number> = {};
        cols.forEach(c => { grandTotals[c] = 0; });
        let grandMistakeTotal = 0;
        mistakeTeams.forEach(t => t.workers.forEach(w => {
          Object.entries(w.items).forEach(([k, v]) => { grandTotals[k] = (grandTotals[k] || 0) + v; });
          grandMistakeTotal += w.mistake_total;
        }));

        // CSV download
        const downloadCSV = async () => {
          if (!hasMistakeData) return;

          try {
            setMistakeExporting('csv');
            const headers = [layerLabel, 'Plan Count', ...cols, 'Mistake Total'];
            const rows: string[][] = [];
            mistakeTeams.forEach(team => {
              rows.push([getTeamLabel(team), '', ...cols.map(() => ''), '']);
              team.workers.forEach(w => {
                const workerCsvName = CLIENT_ADDRESS_PROJECT_IDS.includes(selectedProject) && w.client_name
                  ? `${w.name} (${w.client_name})`
                  : w.name;
                rows.push([workerCsvName, String(w.plan_count), ...cols.map(c => String(w.items[c] || 0)), String(w.mistake_total)]);
              });
              const teamPlan = team.workers.reduce((s, w) => s + w.plan_count, 0);
              const teamItems = cols.map(c => String(team.workers.reduce((s, w) => s + (w.items[c] || 0), 0)));
              const teamTotal = team.workers.reduce((s, w) => s + w.mistake_total, 0);
              rows.push([`${getTeamLabel(team)} TOTAL`, String(teamPlan), ...teamItems, String(teamTotal)]);
            });
            rows.push(['GRAND TOTAL', String(grandPlanCount), ...cols.map(c => String(grandTotals[c] || 0)), String(grandMistakeTotal)]);
            const metaCsvRows = exportMetaRows.map(([label, value]) => `"${label.replace(/"/g, '""')}","${value.replace(/"/g, '""')}"`);
            const csvDataRows = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))];
            const csv = [...metaCsvRows, '', ...csvDataRows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${projectName.replace(/\s+/g, '_')}_${layerLabel}_Mistake_Summary_${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          } finally {
            setMistakeExporting(null);
          }
        };

        const escapeHtml = (value: unknown) => String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

        const buildMistakeSummaryHtml = () => {
          const headers = [layerLabel, 'Plan Count', ...cols, 'Mistake Total'];
          const dynamicColWidth = Math.max(44, Math.min(68, Math.floor(860 / Math.max(cols.length, 1))));
          const headerHtml = headers
            .map((h, idx) => `<th style="border:1px solid #cbd5e1;padding:8px 6px;background:${idx === headers.length - 1 ? '#9f1239' : '#0f766e'};color:#ffffff;text-align:center;font-size:12px;font-weight:800;line-height:1.35;white-space:normal;word-break:break-word;">${escapeHtml(h)}</th>`)
            .join('');

          const colGroupHtml = `
            <colgroup>
              <col style="width:150px;" />
              <col style="width:74px;" />
              ${cols.map(() => `<col style="width:${dynamicColWidth}px;" />`).join('')}
              <col style="width:94px;" />
            </colgroup>
          `;

          let bodyHtml = '';
          mistakeTeams.forEach((team) => {
            bodyHtml += `<tr><td colspan="${headers.length}" style="border:1px solid #e2e8f0;padding:8px 6px;background:#1e293b;color:#ffffff;font-weight:800;font-size:14px;line-height:1.35;">${escapeHtml(getTeamLabel(team))}</td></tr>`;

            team.workers.forEach((w) => {
              const rowCells = [
                `<td style="border:1px solid #e2e8f0;padding:8px 7px;font-size:15px;font-weight:700;color:#0f172a;line-height:1.4;">${escapeHtml(w.name)}${CLIENT_ADDRESS_PROJECT_IDS.includes(selectedProject) && w.client_name ? `<br/><span style="font-size:13px;font-weight:700;color:#475569;">${escapeHtml(w.client_name)}</span>` : ''}</td>`,
                `<td style="border:1px solid #e2e8f0;padding:8px 5px;font-size:15px;font-weight:700;color:#0f172a;text-align:center;line-height:1.4;">${escapeHtml(w.plan_count)}</td>`,
                ...cols.map((c) => `<td style="border:1px solid #e2e8f0;padding:8px 5px;font-size:15px;font-weight:700;color:#0f172a;text-align:center;line-height:1.4;">${escapeHtml(w.items[c] || 0)}</td>`),
                `<td style="border:1px solid #e2e8f0;padding:8px 5px;font-size:15px;font-weight:800;color:#be123c;text-align:center;line-height:1.4;">${escapeHtml(w.mistake_total)}</td>`,
              ].join('');

              bodyHtml += `<tr>${rowCells}</tr>`;
            });

            const teamPlan = team.workers.reduce((s, w) => s + w.plan_count, 0);
            const teamTotal = team.workers.reduce((s, w) => s + w.mistake_total, 0);
            const teamItemCells = cols.map((c) => String(team.workers.reduce((s, w) => s + (w.items[c] || 0), 0)));

            const teamTotalCells = [
              `<td style="border:1px solid #e2e8f0;padding:7px 6px;font-size:12px;font-weight:800;background:#fff1f2;color:#0f172a;line-height:1.35;">${escapeHtml(`${getTeamLabel(team)} TOTAL`)}</td>`,
              `<td style="border:1px solid #e2e8f0;padding:7px 4px;font-size:12px;font-weight:800;background:#fff1f2;color:#0f172a;text-align:center;line-height:1.35;">${escapeHtml(teamPlan)}</td>`,
              ...teamItemCells.map((v) => `<td style="border:1px solid #e2e8f0;padding:7px 4px;font-size:12px;font-weight:800;background:#fff1f2;color:#0f172a;text-align:center;line-height:1.35;">${escapeHtml(v)}</td>`),
              `<td style="border:1px solid #e2e8f0;padding:7px 4px;font-size:12px;font-weight:800;background:#fff1f2;text-align:center;color:#9f1239;line-height:1.35;">${escapeHtml(teamTotal)}</td>`,
            ].join('');

            bodyHtml += `<tr>${teamTotalCells}</tr>`;
          });

          const grandCells = [
            `<td style="border:1px solid #334155;padding:8px 6px;font-size:12px;font-weight:800;background:#1e293b;color:#ffffff;line-height:1.35;">GRAND TOTAL</td>`,
            `<td style="border:1px solid #334155;padding:8px 4px;font-size:12px;font-weight:800;background:#1e293b;color:#ffffff;text-align:center;line-height:1.35;">${escapeHtml(grandPlanCount)}</td>`,
            ...cols.map((c) => `<td style="border:1px solid #334155;padding:8px 4px;font-size:12px;font-weight:800;background:#1e293b;color:#ffffff;text-align:center;line-height:1.35;">${escapeHtml(grandTotals[c] || 0)}</td>`),
            `<td style="border:1px solid #334155;padding:8px 4px;font-size:12px;font-weight:800;background:#9f1239;color:#ffffff;text-align:center;line-height:1.35;">${escapeHtml(grandMistakeTotal)}</td>`,
          ].join('');

          return `
            <div style="font-family:Segoe UI,Arial,sans-serif;background:#ffffff;color:#0f172a;padding:16px;">
              <div style="text-align:center;margin-bottom:12px;">
                <h1 style="margin:0 0 8px 0;font-size:24px;font-weight:800;color:#0f172a;">F.P. ${escapeHtml(layerLabel)} Checklist Summary (${escapeHtml(projectName)})</h1>
                <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:4px;">${escapeHtml(appliedRangeLabel)}</div>
                <div style="font-size:14px;font-weight:700;color:#1e293b;">Generated: ${escapeHtml(new Date().toLocaleString())}</div>
              </div>
              <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px;">
                <div style="border:1px solid #bfdbfe;border-radius:8px;padding:10px;background:#eff6ff;">
                  <div style="font-size:16px;font-weight:700;color:#1e293b;">Orders Reviewed</div>
                  <div style="font-size:34px;font-weight:800;color:#1d4ed8;">${escapeHtml(mistakeSummary.total_orders)}</div>
                </div>
                <div style="border:1px solid #fecdd3;border-radius:8px;padding:10px;background:#fff1f2;">
                  <div style="font-size:16px;font-weight:700;color:#1e293b;">Total Mistakes</div>
                  <div style="font-size:34px;font-weight:800;color:#be123c;">${escapeHtml(mistakeSummary.total_mistakes)}</div>
                </div>
              </div>
              <table style="width:100%;border-collapse:collapse;table-layout:fixed;">
                ${colGroupHtml}
                <thead><tr>${headerHtml}</tr></thead>
                <tbody>${bodyHtml}</tbody>
                <tfoot><tr>${grandCells}</tr></tfoot>
              </table>
            </div>
          `;
        };

        const downloadJPG = async () => {
          if (!hasMistakeData) return;

          let container: HTMLDivElement | null = null;
          try {
            setMistakeExporting('jpg');
            const { default: html2canvas } = await import('html2canvas');

            container = document.createElement('div');
            container.style.position = 'fixed';
            container.style.left = '-99999px';
            container.style.top = '0';
            container.style.width = '1200px';
            container.style.zIndex = '-1';
            container.innerHTML = buildMistakeSummaryHtml();
            document.body.appendChild(container);

            const canvas = await html2canvas(container, {
              windowWidth: 1200,
              backgroundColor: '#ffffff',
              scale: 3,
              useCORS: true,
              logging: false,
            });

            const url = canvas.toDataURL('image/jpeg', 0.96);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${layerLabel}_Mistake_Summary_${new Date().toISOString().slice(0, 10)}.jpg`;
            a.click();
          } catch (error) {
            console.error('Failed to export mistake summary JPG:', error);
          } finally {
            if (container && container.parentNode) {
              container.parentNode.removeChild(container);
            }
            setMistakeExporting(null);
          }
        };

        const downloadPDF = async () => {
          if (!hasMistakeData) return;

          try {
            setMistakeExporting('pdf');
            const { default: jsPDF } = await import('jspdf');
            const { default: autoTable } = await import('jspdf-autotable');

            const headers = [layerLabel, 'Plan Count', ...cols, 'Mistake Total'];
            const rows: string[][] = [];

            mistakeTeams.forEach(team => {
              rows.push([getTeamLabel(team), '', ...cols.map(() => ''), '']);
              team.workers.forEach(w => {
                const workerPdfName = CLIENT_ADDRESS_PROJECT_IDS.includes(selectedProject) && w.client_name
                  ? `${w.name} (${w.client_name})`
                  : w.name;
                rows.push([workerPdfName, String(w.plan_count), ...cols.map(c => String(w.items[c] || 0)), String(w.mistake_total)]);
              });

              const teamPlan = team.workers.reduce((s, w) => s + w.plan_count, 0);
              const teamItems = cols.map(c => String(team.workers.reduce((s, w) => s + (w.items[c] || 0), 0)));
              const teamTotal = team.workers.reduce((s, w) => s + w.mistake_total, 0);
              rows.push([`${getTeamLabel(team)} TOTAL`, String(teamPlan), ...teamItems, String(teamTotal)]);
            });

            rows.push(['GRAND TOTAL', String(grandPlanCount), ...cols.map(c => String(grandTotals[c] || 0)), String(grandMistakeTotal)]);

            const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            const pageWidth = doc.internal.pageSize.getWidth();
            doc.setTextColor(15, 23, 42);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.text(`F.P. ${layerLabel} Checklist Summary (${projectName})`, pageWidth / 2, 36, { align: 'center' });
            doc.setFontSize(12);
            doc.text(`Project ID: ${selectedProject || ''}`, pageWidth / 2, 54, { align: 'center' });
            doc.text(`Worker Filter: ${selectedWorkerLabel}`, pageWidth / 2, 68, { align: 'center' });
            doc.text(`Filter: ${appliedRangeLabel}`, pageWidth / 2, 82, { align: 'center' });
            doc.text(`Generated: ${new Date().toLocaleString()}`, pageWidth / 2, 96, { align: 'center' });
            doc.setFontSize(13);
            doc.text(`Orders Reviewed: ${mistakeSummary.total_orders} | Total Mistakes: ${mistakeSummary.total_mistakes}`, pageWidth / 2, 112, { align: 'center' });

            autoTable(doc, {
              startY: 128,
              head: [headers],
              body: rows,
              styles: {
                fontSize: 9.5,
                fontStyle: 'bold',
                textColor: [15, 23, 42],
                cellPadding: 5,
                overflow: 'linebreak',
              },
              headStyles: {
                fillColor: [15, 118, 110],
                textColor: 255,
                fontStyle: 'bold',
                fontSize: 10.5,
              },
              margin: { left: 20, right: 20 },
            });

            doc.save(`${projectName.replace(/\s+/g, '_')}_${layerLabel}_Mistake_Summary_${new Date().toISOString().slice(0, 10)}.pdf`);
          } catch (error) {
            console.error('Failed to export mistake summary PDF:', error);
          } finally {
            setMistakeExporting(null);
          }
        };

        return (
          <Modal
            open={mistakeModal.open}
            onClose={() => setMistakeModal({ open: false, layer: 'drawer' })}
            title=""
            size="full"
          >
            <div className="p-auto space-y-4">
              {/* Title */}
              {/* Filter Controls */}
              <div className="flex flex-wrap gap-3 items-end">
                <div className="min-w-[190px]">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">From Date</label>
                  <input
                    type="date"
                    value={mistakeDateFrom}
                    onChange={e => setMistakeDateFrom(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
                  />
                </div>
                <div className="min-w-[190px]">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">To Date</label>
                  <input
                    type="date"
                    value={mistakeDateTo}
                    onChange={e => setMistakeDateTo(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
                  />
                </div>
                <div className="min-w-[190px]">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">From Date Time</label>
                  <input
                    type="datetime-local"
                    value={mistakeFromDateTime}
                    onChange={e => setMistakeFromDateTime(e.target.value)}
                    title="From date time"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
                  />
                </div>
                <div className="min-w-[190px]">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">To Date Time</label>
                  <input
                    type="datetime-local"
                    value={mistakeToDateTime}
                    onChange={e => setMistakeToDateTime(e.target.value)}
                    title="To date time"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-brand-400 focus:border-brand-400"
                  />
                </div>
                <button
                  onClick={() => fetchMistakeSummary(
                    mistakeModal.layer,
                    mistakeDateFrom,
                    mistakeDateTo,
                    mistakeWorkerFilter,
                    mistakeFromDateTime,
                    mistakeToDateTime,
                  )}
                  className="px-4 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
                >
                  Apply Filters
                </button>
                <button
                  onClick={downloadCSV}
                  disabled={!hasMistakeData || mistakeExporting !== null}
                  className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileText className="h-3 w-3" /> {mistakeExporting === 'csv' ? 'Exporting CSV...' : 'Download CSV'}
                </button>
                <button
                  onClick={downloadJPG}
                  disabled={!hasMistakeData || mistakeExporting !== null}
                  className="px-4 py-1.5 text-xs font-semibold bg-sky-600 text-white rounded-lg hover:bg-sky-700 transition-colors flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileText className="h-3 w-3" /> {mistakeExporting === 'jpg' ? 'Exporting JPG...' : 'Download JPG'}
                </button>
                <button
                  onClick={downloadPDF}
                  disabled={!hasMistakeData || mistakeExporting !== null}
                  className="px-4 py-1.5 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <FileText className="h-3 w-3" /> {mistakeExporting === 'pdf' ? 'Exporting PDF...' : 'Download PDF'}
                </button>
              </div>
            </div>

            {/* Report subtitle */}
            {(mistakeDateFrom || mistakeDateTo || mistakeFromDateTime || mistakeToDateTime) && (
              <div className="text-center text-xs text-slate-500 font-medium">
                {projectName} ({layerLabel} Person) QA Report
                {mistakeWorkerFilter && ` | Worker: ${mistakeWorkerFilter}`}
                {mistakeDateFrom && ` From ${mistakeDateFrom}`}
                {mistakeDateTo && ` To ${mistakeDateTo}`}
                {mistakeFromDateTime && ` From ${mistakeFromDateTime}`}
                {mistakeToDateTime && ` To ${mistakeToDateTime}`}
              </div>
            )}

            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-brand-50 rounded-lg p-3 text-center ring-1 ring-brand-200">
                <div className="text-3xl font-extrabold text-brand-700">{mistakeSummary.total_orders}</div>
                <div className="text-[10px] text-brand-600 font-semibold uppercase">Orders Reviewed</div>
              </div>
              <div className="bg-rose-50 rounded-lg p-3 text-center ring-1 ring-rose-200">
                <div className="text-3xl font-extrabold text-rose-700">{mistakeSummary.total_mistakes}</div>
                <div className="text-[10px] text-rose-600 font-semibold uppercase">Total Mistakes</div>
              </div>
            </div>

            {/* Loading */}
            {mistakeLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
              </div>
            ) : mistakeTeams.length > 0 && cols.length > 0 ? (
              <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[205vh] overflow-y-auto">
                <table className="w-full text-xs whitespace-nowrap border-collapse">

                  {/* Header */}

                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-700 text-white">
                      <th className="px-3 py-2.5 text-left font-semibold sticky left-0 bg-slate-700 z-20 min-w-[150px] border-r border-slate-600">{layerLabel}</th>
                      <th className="px-3 py-2.5 text-center font-semibold min-w-[70px] border-r border-slate-600">Plan Count</th>
                      {cols.map(item => (
                        <th key={item} className="px-2 py-2.5 text-center font-semibold min-w-[85px] border-r border-slate-600" title={item}>
                          {item}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-center font-semibold min-w-[80px] bg-rose-800">Mistake Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {mistakeTeams.map((team) => {
                      // Team subtotals
                      const teamPlan = team.workers.reduce((s, w) => s + w.plan_count, 0);
                      const teamItems: Record<string, number> = {};
                      cols.forEach(c => { teamItems[c] = team.workers.reduce((s, w) => s + (w.items[c] || 0), 0); });
                      const teamMistakeTotal = team.workers.reduce((s, w) => s + w.mistake_total, 0);

                      return (
                        <React.Fragment key={team.team_id}>
                          {/* Team header row */}
                          <tr className="bg-slate-800">
                            <td colSpan={cols.length + 3} className="px-3 py-2 font-bold text-white text-xs sticky left-0 bg-slate-800 z-[5]">
                              {String(getTeamLabel(team) ?? '')}
                            </td>
                          </tr>
                          {/* Worker rows */}
                          {team.workers.map((w, wi) => (
                            <tr key={w.name} className={`border-b border-slate-100 hover:bg-brand-50/30 ${wi % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                              <td className="px-3 py-1.5 font-medium text-slate-700 sticky left-0 bg-inherit z-[5] border-r border-slate-100">
                                {String(w.name ?? '')}
                                {CLIENT_ADDRESS_PROJECT_IDS.includes(selectedProject) && w.client_name && (
                                  <div className="text-[10px] text-slate-500 font-normal">{w.client_name}</div>
                                )}
                              </td>
                              <td className="px-3 py-1.5 text-center font-semibold text-brand-700 border-r border-slate-100">
                                {w.plan_count}
                              </td>
                              {cols.map(c => {
                                const val = w.items[c] || 0;
                                return (
                                  <td key={c} className="px-2 py-1.5 text-center border-r border-slate-100">
                                    <span className={`font-semibold ${val === 0 ? 'text-slate-400' : val <= 2 ? 'text-amber-600' : 'text-rose-600 font-bold'}`}>
                                      {val}
                                    </span>
                                  </td>
                                );
                              })}
                              <td className="px-3 py-1.5 text-center">
                                <span className={`inline-flex items-center justify-center min-w-[26px] h-5 rounded text-xs font-bold ${w.mistake_total === 0 ? 'text-slate-400' : 'text-white bg-rose-500 px-1.5'}`}>
                                  {w.mistake_total}
                                </span>
                              </td>
                            </tr>
                          ))}


                          {/* Team total row */}
                          <tr className="bg-rose-50 border-b-2 border-slate-200">
                            <td className="px-3 py-1.5 font-bold text-slate-700 text-center sticky left-0 bg-rose-50 z-[5] border-r border-slate-200">
                              {getTeamLabel(team)} TOTAL
                            </td>
                            <td className="px-3 py-1.5 text-center font-bold text-brand-800 border-r border-slate-200">{teamPlan}</td>
                            {cols.map(c => (
                              <td key={c} className="px-2 py-1.5 text-center font-bold border-r border-slate-200">
                                <span className={teamItems[c] > 0 ? 'text-rose-600' : 'text-slate-400'}>{teamItems[c]}</span>
                              </td>
                            ))}
                            <td className="px-3 py-1.5 text-center font-bold text-rose-700">{teamMistakeTotal}</td>
                          </tr>

                        </React.Fragment>

                      );
                    })}
                  </tbody>

                  {/* Grand Total footer */}
                  <tfoot className="sticky bottom-0 z-10">
                    <tr className="bg-slate-800 text-white font-bold">
                      <td className="px-3 py-2.5 sticky left-0 bg-slate-800 z-20 border-r border-slate-600 text-center">GRAND TOTAL</td>
                      <td className="px-3 py-2.5 text-center border-r border-slate-600">{grandPlanCount}</td>
                      {cols.map(c => (
                        <td key={c} className="px-2 py-2.5 text-center border-r border-slate-600">
                          <span className={grandTotals[c] > 0 ? 'text-rose-300' : 'text-slate-400'}>{grandTotals[c] || 0}</span>
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-center bg-rose-800">
                        <span className="text-sm">{grandMistakeTotal}</span>
                      </td>
                    </tr>
                  </tfoot>

                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-slate-400">
                <CheckCircle className="h-10 w-10 mx-auto mb-2 text-green-400" />
                <p className="text-sm font-medium">No mistakes recorded yet</p>
              </div>
            )}
          </Modal>
        );
      })()}

      {/* ═══ REVIEW MODAL ═══ */}
      <LiveQAChecklistModal
        open={reviewModal.open}
        onClose={() => setReviewModal({ open: false, orderNumber: '', layer: 'drawer' })}
        projectId={selectedProject}
        orderNumber={reviewModal.orderNumber}
        layer={reviewModal.layer}
        onSaved={() => fetchOverview()}
      />

    </AnimatedPage>
  );
}
