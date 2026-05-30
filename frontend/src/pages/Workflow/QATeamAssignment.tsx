import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { columnService, workflowService, projectService } from '../../services';
import { useSmartPolling } from '../../hooks/useSmartPolling';
import { useNewOrderHighlight } from '../../hooks/useNewOrderHighlight';
import type { Order, ProjectColumn, User } from '../../types';
import { AnimatedPage, StatusBadge, Button, useToast } from '../../components/ui';
import { Users, RefreshCw, Pencil, CheckSquare, AlertTriangle, Eye, Clock, Search, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

type AssignmentTableColumn = {
  key: string;
  label: string;
  width?: string;
  headerClassName?: string;
  cellClassName?: string;
};

function getProjectTime(tz: string): string {
  return new Date().toLocaleString('en-AU', {
    timeZone: tz || 'Australia/Sydney',
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function getTzLabel(tz: string): string {
  if (!tz) return 'Project Time';
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date());
    const name = parts.find(p => p.type === 'timeZoneName')?.value || '';
    return name || tz.split('/').pop()?.replace(/_/g, ' ') || 'Project Time';
  } catch { return 'Project Time'; }
}

export default function QATeamAssignment() {
  const { user } = useSelector((state: RootState) => state.auth);
  const [orders, setOrders] = useState<Order[]>([]);
  const [drawers, setDrawers] = useState<User[]>([]);
  const [checkers, setCheckers] = useState<User[]>([]);
  const [projectColumns, setProjectColumns] = useState<ProjectColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /* ── Inline assign dropdown state ── */
  const [assignDropdown, setAssignDropdown] = useState<{ orderId: number; role: 'drawer' | 'checker'; anchorRect?: DOMRect } | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assigning, setAssigning] = useState(false);

  const { toast } = useToast();
  const canAccess = user?.role === 'qa';
  const activeProjectId = useMemo(
    () => orders.find((order) => order.project_id != null)?.project_id ?? user?.project_id ?? null,
    [orders, user?.project_id]
  );

  /* ── Project timezone ── */
  const [projectTz, setProjectTz] = useState('Australia/Sydney');
  useEffect(() => {
    if (activeProjectId) {
      projectService.list().then(res => {
        const d = res.data?.data || res.data;
        const list = Array.isArray(d) ? d : [];
        const proj = list.find((p: any) => p.id === activeProjectId);
        if (proj?.timezone) setProjectTz(proj.timezone);
      }).catch(() => { });
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      setProjectColumns([]);
      return;
    }

    columnService.getAllColumns(activeProjectId)
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
  }, [activeProjectId]);

  /* ── Project Time clock ── */
  const [ausTime, setAusTime] = useState(getProjectTime('Australia/Sydney'));
  useEffect(() => {
    const timer = setInterval(() => setAusTime(getProjectTime(projectTz)), 1000);
    return () => clearInterval(timer);
  }, [projectTz]);

  /* ── Highlight newly arrived orders ── */
  const highlightedIds = useNewOrderHighlight(orders);

  const loadData = useCallback(async (isRefresh = false) => {
    if (!canAccess) return;
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const [ordersRes, teamRes] = await Promise.all([
        workflowService.qaOrders(),
        workflowService.qaTeamMembers(),
      ]);
      setOrders(ordersRes.data?.orders || []);
      setDrawers(teamRes.data?.drawers || []);
      setCheckers(teamRes.data?.checkers || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  }, [canAccess]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Smart Polling: auto-refresh when assignments change ── */
  useSmartPolling({
    scope: 'all',
    interval: 45_000, // Changed from 10_000 to 45_000 (45 seconds)
    onDataChanged: () => loadData(true),
    enabled: canAccess,
  });

  /* ── Inline assign logic ── */
  const assignableWorkers = useMemo(() => {
    if (!assignDropdown) return [];
    const list = assignDropdown.role === 'drawer' ? drawers.filter(d => !d.is_absent) : checkers.filter(c => !c.is_absent);
    if (!assignSearch) return list;
    const q = assignSearch.toLowerCase();
    return list.filter(w => w.name.toLowerCase().includes(q) || w.email.toLowerCase().includes(q) || String(w.id).includes(q));
  }, [assignDropdown, drawers, checkers, assignSearch]);

  const openAssignDropdown = (e: React.MouseEvent, orderId: number, role: 'drawer' | 'checker') => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAssignDropdown({ orderId, role, anchorRect: rect });
    setAssignSearch('');
  };

  const handleAssign = async (orderId: number, role: string, userId: number) => {
    try {
      setAssigning(true);
      const worker = [...drawers, ...checkers].find((w: User) => w.id === userId);
      // Find order's project_id to avoid cross-project ID collision
      const orderProjectId = orders.find(o => o.id === orderId)?.project_id;
      let res;
      if (role === 'drawer') {
        res = await workflowService.assignToDrawer(orderId, userId, orderProjectId);
      } else {
        res = await workflowService.assignRole(orderId, role, userId, orderProjectId);
      }
      setAssignDropdown(null);
      setAssignSearch('');

      // Optimistic update
      if (worker) {
        const roleColMap: Record<string, string> = { drawer: 'drawer_name', checker: 'checker_name' };
        const roleIdMap: Record<string, string> = { drawer: 'drawer_id', checker: 'checker_id' };
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, [roleColMap[role]]: worker.name, [roleIdMap[role]]: worker.id, assigned_to: role === 'drawer' ? worker.id : o.assigned_to } as any : o));
      }

      toast({ type: 'success', title: `${role.charAt(0).toUpperCase() + role.slice(1)} Assigned`, description: res.data?.message || `${role} assigned successfully` });
      loadData(true);
    } catch (e: any) {
      console.error(e);
      toast({ type: 'error', title: 'Assignment Failed', description: e?.response?.data?.message || `Could not assign ${role}` });
    } finally { setAssigning(false); }
  };

  if (!canAccess) {
    return (
      <AnimatedPage>
        <div className="text-center py-12">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-900">Access Restricted</h2>
          <p className="text-sm text-slate-500">Only QA supervisors can access team assignment.</p>
        </div>
      </AnimatedPage>
    );
  }

  const pendingAssignment = orders.filter(o => o.workflow_state === 'PENDING_QA_REVIEW');
  const inDrawing = orders.filter(o => ['QUEUED_DRAW', 'IN_DRAW'].includes(o.workflow_state));
  const inChecking = orders.filter(o => ['QUEUED_CHECK', 'IN_CHECK'].includes(o.workflow_state));
  const readyForQA = orders.filter(o => ['QUEUED_QA', 'IN_QA'].includes(o.workflow_state));

  /* ── Duration formatter for role time ── */
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

  /* ── Reusable cell renderer ── */
  const RoleCell = ({ order, role, color, startTime, endTime }: { order: Order; role: 'drawer' | 'checker'; color: string; startTime?: string | null; endTime?: string | null }) => {
    const name = role === 'drawer' ? ((order as any).drawer_name || order.assignedUser?.name || null) : ((order as any).checker_name || null);
    const isDrawerRole = role === 'drawer';
    const doneCol = role === 'drawer' ? 'drawer_done' : 'checker_done';
    const isDone = (order as any)[doneCol] === 'yes';
    const canAssign = !isDone && (order.workflow_state === 'PENDING_QA_REVIEW' || order.workflow_state === 'QUEUED_DRAW' || (isDrawerRole && !order.assigned_to));
    const duration = fmtDuration(startTime || null, endTime || null);
    return (
      <td className="px-3 py-2">
        {canAssign ? (
          <button onClick={(e) => openAssignDropdown(e, order.id, role)}
            className="flex flex-col group cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1 py-0.5 transition-colors w-full text-left"
            title={name ? `Click to change ${role}` : `Assign ${role}`}>
            <div className="flex items-center gap-1">
              {name ? (
                <>
                  <div className={`w-5 h-5 rounded-full ${color} text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0`}>{name.charAt(0)}</div>
                  <span className="text-slate-700 whitespace-nowrap">{name}</span>
                </>
              ) : (
                <span className="text-slate-300 group-hover:text-brand-500 text-xs">— assign</span>
              )}
            </div>
            {duration && (
              <div className="text-[10px] text-slate-400 ml-6 mt-0.5 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />{duration}
              </div>
            )}
          </button>
        ) : isDone && name ? (
          <div className="flex flex-col cursor-default opacity-80" title={`${role} completed — cannot reassign`}>
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">✓</div>
              <span className="text-emerald-600 whitespace-nowrap">{name}</span>
            </div>
            {duration && (
              <div className="text-[10px] text-emerald-400 ml-6 mt-0.5 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />{duration}
              </div>
            )}
          </div>
        ) : name ? (
          <div className="flex flex-col">
            <div className="flex items-center gap-1">
              <div className={`w-5 h-5 rounded-full ${color} text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0`}>{name.charAt(0)}</div>
              <span className="text-slate-700 whitespace-nowrap">{name}</span>
            </div>
            {duration && (
              <div className="text-[10px] text-slate-400 ml-6 mt-0.5 flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />{duration}
              </div>
            )}
          </div>
        ) : (
          <span className="text-slate-300 text-xs">—</span>
        )}
      </td>
    );
  };

  const defaultPrimaryColumns = useMemo<AssignmentTableColumn[]>(() => [
    { key: 'order_number', label: 'Order #', width: '7.5%' },
    { key: 'VARIANT_no', label: 'Variant', width: '9%' },
    { key: 'address', label: 'Address' },
    { key: 'priority', label: 'Priority', width: '5.5%', headerClassName: 'text-center', cellClassName: 'px-2 py-2 text-center' },
    { key: 'received_at', label: 'Received', width: '7%' },
  ], []);

  const fixedTrailingFields = useMemo(() => new Set([
    'drawer_name',
    'checker_name',
    'drawer_id',
    'checker_id',
    'workflow_state',
    'status',
  ]), []);

  const dynamicPrimaryColumns = useMemo<AssignmentTableColumn[]>(() => {
    const hasSavedColumnConfig = projectColumns.length > 0;
    const visibleColumns = projectColumns
      .filter((column) => column.visible && !fixedTrailingFields.has(column.field))
      .map((column) => ({
        key: column.field,
        label: column.label || column.name || column.field,
        width: column.width ? `${column.width}px` : undefined,
        headerClassName: column.field === 'priority' ? 'text-center' : undefined,
        cellClassName: column.field === 'priority' ? 'px-2 py-2 text-center' : undefined,
      }));

    if (!hasSavedColumnConfig) return defaultPrimaryColumns;
    if (visibleColumns.length === 0) return [];

    return visibleColumns;
  }, [defaultPrimaryColumns, fixedTrailingFields, projectColumns]);

  const renderPrimaryCell = (order: Order, column: AssignmentTableColumn) => {
    const value = (order as any)[column.key];

    switch (column.key) {
      case 'order_number':
        return (
          <td className={column.cellClassName || 'px-3 py-2'}>
            <div className="font-semibold text-slate-900">{order.order_number || '—'}</div>
            <div className="text-[10px] text-slate-400 truncate max-w-[120px]">{order.client_reference || ''}</div>
          </td>
        );

      case 'VARIANT_no':
        return <td className={column.cellClassName || 'px-2 py-2 text-slate-600 whitespace-nowrap'}>{value || '—'}</td>;

      case 'address':
        return (
          <td className={column.cellClassName || 'px-3 py-2 overflow-hidden'}>
            <div className="text-xs text-slate-700 truncate" title={(value as string) || ''}>{value || '—'}</div>
          </td>
        );

      case 'priority':
        const normalizedPriority = (order.priority || '').toString().toLowerCase();
        return (
          <td className={column.cellClassName || 'px-2 py-2 text-center'}>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${normalizedPriority === 'urgent' ? 'bg-rose-100 text-rose-700' :
                normalizedPriority === 'high' ? 'bg-amber-100 text-amber-700' :
                  normalizedPriority === 'rush' ? 'bg-purple-100 text-purple-700' :
                    'bg-slate-100 text-slate-600'
              }`}>{order.priority?.toUpperCase() || 'NORMAL'}</span>
          </td>
        );

      case 'received_at':
        return (
          <td className={column.cellClassName || 'px-3 py-2 whitespace-nowrap'}>
            {order.received_at ? (
              <>
                <div className="text-xs text-slate-500">{new Date(order.received_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
                <div className="text-[10px] text-blue-500 flex items-center gap-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  {new Date(order.received_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </>
            ) : '—'}
          </td>
        );

      default:
        return <td className={column.cellClassName || 'px-3 py-2 text-slate-600'}>{value == null || value === '' ? '—' : String(value)}</td>;
    }
  };

  return (
    <AnimatedPage>
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-brand-600" />
              My Team Orders
            </h1>
            <p className="text-xs text-slate-500">Assign orders to your team members and track progress</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-slate-500 font-medium flex items-center gap-1 justify-end"><Clock className="w-3 h-3" />{getTzLabel(projectTz)}</div>
              <div className="text-sm font-semibold text-slate-800 font-mono">{ausTime}</div>
            </div>
            <Button variant="secondary" icon={RefreshCw} onClick={() => loadData(true)} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-xs text-slate-500">Pending</span>
            </div>
            <div className="text-2xl font-bold text-amber-600">{pendingAssignment.length}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Pencil className="w-4 h-4 text-blue-500" />
              <span className="text-xs text-slate-500">In Drawing</span>
            </div>
            <div className="text-2xl font-bold text-blue-600">{inDrawing.length}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckSquare className="w-4 h-4 text-purple-500" />
              <span className="text-xs text-slate-500">In Checking</span>
            </div>
            <div className="text-2xl font-bold text-purple-600">{inChecking.length}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="w-4 h-4 text-brand-500" />
              <span className="text-xs text-slate-500">Ready for QA</span>
            </div>
            <div className="text-2xl font-bold text-brand-600">{readyForQA.length}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-4 h-4 text-slate-500" />
              <span className="text-xs text-slate-500">Team Size</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{drawers.length + checkers.length}</div>
          </div>
        </div>

        {/* Priority Breakdown */}
        <div className="bg-white rounded-xl border border-slate-200/60 px-4 py-2.5 flex items-center gap-4 flex-wrap text-xs">
          <span className="font-bold text-slate-700">Priority:</span>
          <span className="font-semibold text-red-600">High: {orders.filter(o => (o.priority || '').toLowerCase() === 'high').length}</span>
          <span className="font-semibold text-slate-600">Normal: {orders.filter(o => !o.priority || (o.priority || '').toLowerCase() === 'normal' || (o.priority as string) === '').length}</span>
          {orders.filter(o => (o.priority || '').toLowerCase() === 'rush').length > 0 && (
            <span className="font-semibold text-purple-600">Rush: {orders.filter(o => (o.priority || '').toLowerCase() === 'rush').length}</span>
          )}
          {orders.filter(o => (o.priority || '').toLowerCase() === 'urgent').length > 0 && (
            <span className="font-semibold text-orange-600">Urgent: {orders.filter(o => (o.priority || '').toLowerCase() === 'urgent').length}</span>
          )}
        </div>

        {/* Team Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Drawers */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Pencil className="w-4 h-4 text-blue-500" /> Drawers ({drawers.length})
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {drawers.map(d => (
                <div key={d.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold ${d.is_absent ? 'bg-slate-400' : 'bg-blue-600'}`}>{d.name.charAt(0)}</div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">{d.name}</div>
                      <div className="text-[10px] text-slate-500">{d.is_absent ? 'Absent' : 'Available'}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-600">WIP: {d.wip_count || 0}/{d.wip_limit || 5}</div>
                    <div className="text-xs text-slate-400">Today: {d.today_completed || 0}</div>
                  </div>
                </div>
              ))}
              {drawers.length === 0 && <div className="text-sm text-slate-400 text-center py-2">No drawers in team</div>}
            </div>
          </div>
          {/* Checkers */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-purple-500" /> Checkers ({checkers.length})
            </h3>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {checkers.map(c => (
                <div key={c.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold ${c.is_absent ? 'bg-slate-400' : 'bg-purple-600'}`}>{c.name.charAt(0)}</div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">{c.name}</div>
                      <div className="text-[10px] text-slate-500">{c.is_absent ? 'Absent' : 'Available'}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-600">WIP: {c.wip_count || 0}/{c.wip_limit || 5}</div>
                    <div className="text-xs text-slate-400">Today: {c.today_completed || 0}</div>
                  </div>
                </div>
              ))}
              {checkers.length === 0 && <div className="text-sm text-slate-400 text-center py-2">No checkers in team</div>}
            </div>
          </div>
        </div>

        {/* ══════ ORDERS TABLE (LiveQA-style) ══════ */}
        {pendingAssignment.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" /> Orders Needing Assignment ({pendingAssignment.length})
            </h3>
          </div>
        )}

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
                  {dynamicPrimaryColumns.map((column) => (
                    <col key={column.key} style={column.width ? { width: column.width } : undefined} />
                  ))}
                  <col style={{ width: '7%' }} />{/* State */}
                  <col style={{ width: '14%' }} />{/* Drawer */}
                  <col style={{ width: '14%' }} />{/* Checker */}
                  <col style={{ width: '8%' }} />{/* Status */}
                </colgroup>
                <thead>
                  <tr className="bg-brand-700 text-white">
                    {dynamicPrimaryColumns.map((column) => (
                      <th
                        key={column.key}
                        className={`px-3 py-2 font-semibold ${column.headerClassName || 'text-left'}`}
                      >
                        {column.label}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center font-semibold">State</th>
                    <th className="px-3 py-2 text-left font-semibold">
                      <div className="flex items-center gap-1"><Pencil className="w-3 h-3" /> Drawer</div>
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">
                      <div className="flex items-center gap-1"><CheckSquare className="w-3 h-3" /> Checker</div>
                    </th>
                    <th className="px-2 py-2 text-center font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {[...orders].sort((a, b) => {
                      const pw: Record<string, number> = { rush: 0, urgent: 0, high: 1, normal: 2, low: 3 };
                      return (pw[a.priority || 'normal'] ?? 2) - (pw[b.priority || 'normal'] ?? 2);
                    }).map((o, idx) => (
                      <motion.tr key={o.id}
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ delay: idx * 0.02 }}
                        className={`border-b border-slate-100 hover:bg-brand-50/40 transition-colors ${o.workflow_state === 'PENDING_QA_REVIEW' ? 'bg-amber-50/30' : ''
                          } ${highlightedIds.has(o.id) ? 'new-order-highlight' : ''}`}>
                        {dynamicPrimaryColumns.map((column) => (
                          <React.Fragment key={`${o.id}-${column.key}`}>
                            {renderPrimaryCell(o, column)}
                          </React.Fragment>
                        ))}
                        {/* State */}
                        <td className="px-2 py-2 text-center"><StatusBadge status={o.workflow_state} size="sm" /></td>
                        {/* Drawer — inline clickable */}
                        <RoleCell order={o} role="drawer" color="bg-blue-600" startTime={(o as any).dassign_time} endTime={(o as any).drawer_date} />
                        {/* Checker — inline clickable */}
                        <RoleCell order={o} role="checker" color="bg-purple-600" startTime={(o as any).cassign_time} endTime={(o as any).checker_date} />
                        {/* Status indicator */}
                        <td className="px-2 py-2 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${o.workflow_state?.includes('COMPLETE') || o.workflow_state?.includes('DELIVER') ? 'bg-green-100 text-green-700'
                              : o.workflow_state?.includes('HOLD') ? 'bg-red-100 text-red-700'
                                : o.workflow_state?.includes('CHECK') ? 'bg-blue-100 text-blue-700'
                                  : o.workflow_state?.includes('QA') ? 'bg-purple-100 text-purple-700'
                                    : o.workflow_state?.includes('DRAW') ? 'bg-brand-100 text-brand-700'
                                      : o.workflow_state === 'PENDING_QA_REVIEW' ? 'bg-amber-100 text-amber-700'
                                        : 'bg-slate-100 text-slate-600'
                            }`}>
                            {(o.workflow_state || 'PENDING').replace(/_/g, ' ')}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {orders.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Users className="w-10 h-10 mb-2" />
                  <div className="text-sm font-medium">No orders assigned to your team</div>
                  <div className="text-xs mt-1">Orders will appear here once assigned</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══════ Assign Role Dropdown (floating) ══════ */}
      {assignDropdown && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setAssignDropdown(null); setAssignSearch(''); }} />
          <div className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 w-64 max-h-80 flex flex-col overflow-hidden"
            style={{
              top: Math.min((assignDropdown.anchorRect?.bottom ?? 200) + 4, window.innerHeight - 330),
              left: Math.min((assignDropdown.anchorRect?.left ?? 200), window.innerWidth - 280),
            }}>
            {/* Header */}
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-slate-700 capitalize">Assign {assignDropdown.role}</span>
                <button onClick={() => { setAssignDropdown(null); setAssignSearch(''); }} className="p-0.5 hover:bg-slate-200 rounded">
                  <X className="w-3 h-3 text-slate-400" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                <input type="text" autoFocus value={assignSearch} onChange={e => setAssignSearch(e.target.value)}
                  placeholder={`Search ${assignDropdown.role}s...`}
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
              ) : assignableWorkers.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No available {assignDropdown.role}s found
                </div>
              ) : (
                <div className="py-1">
                  {assignableWorkers.map(w => (
                    <button key={w.id} onClick={() => handleAssign(assignDropdown.orderId, assignDropdown.role, w.id)}
                      disabled={(w.wip_count || 0) >= (w.wip_limit || 5)}
                      className={`w-full flex items-center gap-2 px-3 py-2 hover:bg-brand-50 transition-colors text-left ${(w.wip_count || 0) >= (w.wip_limit || 5) ? 'opacity-40 cursor-not-allowed' : ''
                        }`}>
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 ${assignDropdown.role === 'drawer' ? 'bg-blue-600' : 'bg-purple-600'
                        }`}>{w.name.charAt(0)}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-800 truncate">#{w.id} – {w.name}</div>
                        <div className="text-[10px] text-slate-400">WIP: {w.wip_count || 0}/{w.wip_limit || 5} · Today: {w.today_completed || 0}</div>
                      </div>
                      {(w.wip_count || 0) >= (w.wip_limit || 5) && <span className="text-[10px] text-rose-500 font-medium">Full</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </AnimatedPage>
  );
}
