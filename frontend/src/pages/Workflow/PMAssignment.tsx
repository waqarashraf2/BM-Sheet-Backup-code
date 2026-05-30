import React, { useEffect, useState, useMemo } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { columnService, pmService, workflowService, projectService, userService } from '../../services';
import { useSmartPolling } from '../../hooks/useSmartPolling';
import { useNewOrderHighlight } from '../../hooks/useNewOrderHighlight';
import type { Order, ProjectColumn, User } from '../../types';
import { AnimatedPage, StatusBadge, Button, useToast } from '../../components/ui';
import { UserCheck, RefreshCw, Users, AlertTriangle, Search, X, Loader2, Eye, Clock } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ClockDisplay from '../../components/ClockDisplay';

type AssignmentTableColumn = {
  key: string;
  label: string;
  width?: string;
  headerClassName?: string;
  cellClassName?: string;
};

type PMAssignmentUser = {
  id: number;
  managed_projects?: { id: number }[];
};

export default function PMAssignment() {
  const { user } = useSelector((state: RootState) => state.auth);
  const [orders, setOrders] = useState<Order[]>([]);
  const [qaUsers, setQaUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [projectColumns, setProjectColumns] = useState<ProjectColumn[]>([]);

  /* ── Inline assign dropdown state ── */
  const [assignDropdown, setAssignDropdown] = useState<{ orderId: number; anchorRect?: DOMRect } | null>(null);
  const [assignSearch, setAssignSearch] = useState('');
  const [assigning, setAssigning] = useState(false);

  const { toast } = useToast();
  const canAccess = ['ceo', 'director', 'operations_manager', 'project_manager'].includes(user?.role || '');

  /* ── Project timezone ── */
  const selectedProjectData = projects.find((p: any) => p.id === selectedProject);
  const projectTz = selectedProjectData?.timezone || 'Australia/Sydney';

  /* ── Project Time clock ── */

  /* ── Highlight newly arrived orders ── */
  const highlightedIds = useNewOrderHighlight(orders);

  useEffect(() => {
    if (!canAccess) return;

    const loadProjects = async () => {
      try {
        const res = await projectService.list();
        const d = res.data?.data || res.data;
        const list = Array.isArray(d) ? d : [];

        if (user?.role === 'project_manager' && user.id) {
          const pmRes = await pmService.list();
          const pmList = Array.isArray(pmRes.data) ? pmRes.data : [];
          const currentPm = pmList.find((pm: PMAssignmentUser) => pm.id === user.id);
          const assignedProjectIds = new Set((currentPm?.managed_projects || []).map((project: { id: number }) => project.id));
          const allowedProjects = list.filter((project: any) => assignedProjectIds.has(project.id));

          setProjects(allowedProjects);
          setSelectedProject((prev) => {
            if (prev && allowedProjects.some((project: any) => project.id === prev)) return prev;
            return allowedProjects[0]?.id ?? null;
          });
          return;
        }

        setProjects(list);
        setSelectedProject((prev) => prev ?? list[0]?.id ?? null);
      } catch (error) {
        console.error(error);
      }
    };

    loadProjects();
  }, [canAccess, user?.id, user?.role]);

  useEffect(() => {
    if (selectedProject) {
      loadOrders();
      loadQAUsers();
    }
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setProjectColumns([]);
      return;
    }

    columnService.getAllColumns(selectedProject)
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
  }, [selectedProject]);

  /* ── Smart Polling: auto-refresh when orders change ── */
  useSmartPolling({
    projectIds: selectedProject ? [selectedProject] : [],
    scope: 'orders',
    interval: 45_000, // Changed from 10_000 to 45_000 (45 seconds)
    onDataChanged: () => loadOrders(true),
    enabled: !!selectedProject,
  });

  const loadOrders = async (isRefresh = false) => {
    if (!selectedProject) return;
    try {
      isRefresh ? setRefreshing(true) : setLoading(true);
      const res = await workflowService.projectOrders(selectedProject);
      const d = res.data?.data || res.data;
      const allOrders = Array.isArray(d) ? d : [];
      const filteredOrders = allOrders.filter((o: Order) =>
        o.workflow_state === 'RECEIVED' ||
        o.workflow_state === 'PENDING_QA_REVIEW' ||
        (o.workflow_state === 'QUEUED_DRAW' && !o.qa_supervisor_id)
      );
      // Sort by priority: urgent/rush → high → normal → low
      const priorityWeight: Record<string, number> = { rush: 0, urgent: 0, high: 1, normal: 2, low: 3 };
      filteredOrders.sort((a: Order, b: Order) => (priorityWeight[a.priority] ?? 2) - (priorityWeight[b.priority] ?? 2));
      setOrders(filteredOrders);
    } catch (e) { console.error(e); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const loadQAUsers = async () => {
    try {
      const res = await userService.list({ role: 'qa' });
      const d = res.data?.data || res.data;
      setQaUsers(Array.isArray(d) ? d : []);
    } catch (e) { console.error(e); }
  };

  /* ── Inline assign logic ── */
  const assignableQA = useMemo(() => {
    if (!assignDropdown) return [];
    if (!assignSearch) return qaUsers;
    const q = assignSearch.toLowerCase();
    return qaUsers.filter(w => w.name.toLowerCase().includes(q) || w.email.toLowerCase().includes(q) || String(w.id).includes(q));
  }, [assignDropdown, qaUsers, assignSearch]);

  const openAssignDropdown = (e: React.MouseEvent, orderId: number) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAssignDropdown({ orderId, anchorRect: rect });
    setAssignSearch('');
  };

  const handleAssign = async (orderId: number, qaUserId: number) => {
    try {
      setAssigning(true);
      const qaUser = qaUsers.find(u => u.id === qaUserId);
      // Find order's project_id to avoid cross-project ID collision
      const orderProjectId = orders.find(o => o.id === orderId)?.project_id;
      const res = await workflowService.assignToQA(orderId, qaUserId, orderProjectId);
      setAssignDropdown(null);
      setAssignSearch('');

      // Optimistic update: immediately reflect the assigned QA in the table
      if (qaUser) {
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, qa_supervisor_id: qaUser.id, qaSupervisor: { ...qaUser } } as any : o));
      }

      toast({ type: 'success', title: 'QA Assigned', description: res.data?.message || 'QA supervisor assigned successfully' });
      loadOrders(true);
    } catch (e: any) {
      console.error(e);
      toast({ type: 'error', title: 'Assignment Failed', description: e?.response?.data?.message || 'Could not assign QA' });
    } finally { setAssigning(false); }
  };

  /* ── QA Cell renderer ── */
  const QACell = ({ order }: { order: Order }) => {
    const qaName = order.qaSupervisor?.name || null;
    // const qaId = order.qaSupervisor?.id || null;
    return (
      <td className="px-3 py-2">
        <button onClick={(e) => openAssignDropdown(e, order.id)}
          className="flex items-center gap-1 group cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1 py-0.5 transition-colors w-full text-left"
          title={qaName ? 'Click to change QA' : 'Assign QA'}>
          {qaName ? (
            <>
              <div className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">{qaName.charAt(0)}</div>
              <span className="text-slate-700 whitespace-nowrap">{qaName}</span>
            </>
          ) : (
            <span className="text-slate-300 group-hover:text-brand-500 text-xs">— assign</span>
          )}
        </button>
      </td>
    );
  };

  const defaultPrimaryColumns = useMemo<AssignmentTableColumn[]>(() => [
    { key: 'order_number', label: 'Order #', width: '8%' },
    { key: 'VARIANT_no', label: 'Variant', width: '10%' },
    { key: 'address', label: 'Address' },
    { key: 'priority', label: 'Priority', width: '7%', headerClassName: 'text-center', cellClassName: 'px-2 py-2 text-center' },
    { key: 'received_at', label: 'Received', width: '8%' },
  ], []);

  const fixedTrailingFields = useMemo(() => new Set([
    'qa_name',
    'qa_supervisor_id',
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
          <td className={column.cellClassName || 'px-3 py-2 text-slate-500 whitespace-nowrap'}>
            {order.received_at ? (
              <>
                <div>{new Date(order.received_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
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

  if (!canAccess) {
    return (
      <AnimatedPage>
        <div className="text-center py-12">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-900">Access Restricted</h2>
          <p className="text-sm text-slate-500">Only management can assign orders to QA supervisors.</p>
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-brand-600" />
              Assign Orders to QA
            </h1>
            <p className="text-xs text-slate-500">Assign incoming orders to QA supervisors for team distribution</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <ClockDisplay timezone={projectTz} className="text-sm font-semibold text-slate-800 font-mono" />
            </div>
            <Button variant="secondary" icon={RefreshCw} onClick={() => loadOrders(true)} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="text-2xl font-bold text-slate-900">{orders.length}</div>
            <div className="text-xs text-slate-500">Pending Assignment</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="text-2xl font-bold text-rose-600">{orders.filter(o => o.priority === 'urgent').length}</div>
            <div className="text-xs text-slate-500">Urgent</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="text-2xl font-bold text-purple-600">{orders.filter(o => (o.priority as string) === 'rush').length}</div>
            <div className="text-xs text-slate-500">Rush</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="text-2xl font-bold text-amber-600">{orders.filter(o => o.priority === 'high').length}</div>
            <div className="text-xs text-slate-500">High Priority</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="text-2xl font-bold text-slate-600">{orders.filter(o => !o.priority || o.priority === 'normal' || (o.priority as string) === '').length}</div>
            <div className="text-xs text-slate-500">Normal</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="text-2xl font-bold text-brand-600">{qaUsers.length}</div>
            <div className="text-xs text-slate-500">Available QA</div>
          </div>
        </div>

        {/* Project selector */}
        {projects.length > 1 && (
          <select
            value={selectedProject || ''}
            onChange={e => setSelectedProject(Number(e.target.value))}
            className="select text-sm"
            aria-label="Select project"
          >
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}

        {/* ══════ ORDERS TABLE (LiveQA-style) ══════ */}
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
                  <col style={{ width: '9%' }} />{/* State */}
                  <col style={{ width: '15%' }} />{/* QA Supervisor */}
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
                      <div className="flex items-center gap-1">
                        <Eye className="w-3 h-3" /> QA Supervisor
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {orders.map((o, idx) => (
                      <motion.tr key={o.id}
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                        transition={{ delay: idx * 0.02 }}
                        className={`border-b border-slate-100 hover:bg-brand-50/40 transition-colors ${highlightedIds.has(o.id) ? 'new-order-highlight' : ''}`}>
                        {dynamicPrimaryColumns.map((column) => (
                          <React.Fragment key={`${o.id}-${column.key}`}>
                            {renderPrimaryCell(o, column)}
                          </React.Fragment>
                        ))}
                        {/* State */}
                        <td className="px-2 py-2 text-center"><StatusBadge status={o.workflow_state} size="sm" /></td>
                        {/* QA Supervisor — inline clickable */}
                        <QACell order={o} />
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
              {orders.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Users className="w-10 h-10 mb-2" />
                  <div className="text-sm font-medium">No orders pending QA assignment</div>
                  <div className="text-xs mt-1">All orders have been assigned</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ══════ Assign QA Dropdown (floating) ══════ */}
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
                <span className="text-xs font-semibold text-slate-700">Assign QA Supervisor</span>
                <button onClick={() => { setAssignDropdown(null); setAssignSearch(''); }} className="p-0.5 hover:bg-slate-200 rounded">
                  <X className="w-3 h-3 text-slate-400" />
                </button>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                <input type="text" autoFocus value={assignSearch} onChange={e => setAssignSearch(e.target.value)}
                  placeholder="Search QA supervisors..."
                  className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500" />
              </div>
            </div>
            {/* QA list */}
            <div className="flex-1 overflow-y-auto">
              {assigning ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />
                  <span className="ml-2 text-xs text-slate-500">Assigning...</span>
                </div>
              ) : assignableQA.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">No QA supervisors found</div>
              ) : (
                <div className="py-1">
                  {assignableQA.map(qa => (
                    <button key={qa.id} onClick={() => handleAssign(assignDropdown.orderId, qa.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-brand-50 transition-colors text-left">
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0 bg-purple-600">
                        {qa.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-slate-800 truncate">#{qa.id} – {qa.name}</div>
                        <div className="text-[10px] text-slate-400">WIP: {qa.wip_count || 0} · Today: {qa.today_completed || 0}</div>
                      </div>
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
