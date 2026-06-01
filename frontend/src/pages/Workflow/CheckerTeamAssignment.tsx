import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { columnService, workflowService, projectService } from '../../services';
import { useSmartPolling } from '../../hooks/useSmartPolling';
import { useNewOrderHighlight } from '../../hooks/useNewOrderHighlight';
import type { Order, ProjectColumn, User } from '../../types';
import { AnimatedPage, StatusBadge, Button, useToast } from '../../components/ui';
import { Users, RefreshCw, Pencil, AlertTriangle, Clock, Search, X, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Backend returns is_own_team flag on each drawer
type DrawerUser = User & { is_own_team?: boolean };

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

export default function CheckerTeamAssignment() {
    const { user } = useSelector((state: RootState) => state.auth);
    const [orders, setOrders] = useState<Order[]>([]);
    const [drawers, setDrawers] = useState<DrawerUser[]>([]);
    const [projectColumns, setProjectColumns] = useState<ProjectColumn[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    /* ── Inline assign dropdown state ── */
    const [assignDropdown, setAssignDropdown] = useState<{ orderId: number; anchorRect?: DOMRect } | null>(null);
    const [assignSearch, setAssignSearch] = useState('');
    const [assigning, setAssigning] = useState(false);

    const { toast } = useToast();
    const canAccess = user?.role === 'checker';

    const activeProjectId = useMemo(
        () => orders.find((o) => o.project_id != null)?.project_id ?? user?.project_id ?? null,
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

    /* ── Project columns ── */
    useEffect(() => {
        if (!activeProjectId) { setProjectColumns([]); return; }
        columnService.getAllColumns(activeProjectId)
            .then((res) => {
                const cols = res.data?.data ?? [];
                setProjectColumns([...cols].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
            })
            .catch(() => setProjectColumns([]));
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

            // ── Orders ──────────────────────────────────────────────────
            // Try dedicated endpoint; fall back to the generic worker queue
            // (which returns QUEUED_CHECK / IN_CHECK orders for checkers).
            let fetchedOrders: Order[] = [];
            try {
                const res = await workflowService.checkerOrders();
                fetchedOrders = res.data?.orders || [];
            } catch {
                try {
                    const res = await workflowService.getQueue();
                    fetchedOrders = res.data?.orders || [];
                } catch { /* leave empty */ }
            }
            setOrders(fetchedOrders);

            // ── Team members ─────────────────────────────────────────────
            // Try dedicated endpoint; fall back to qaTeamMembers which
            // returns the same team's drawers (backend may allow checker role).
            let fetchedDrawers: User[] = [];
            try {
                const res = await workflowService.checkerTeamMembers();
                fetchedDrawers = res.data?.drawers || [];
            } catch {
                try {
                    const res = await workflowService.qaTeamMembers();
                    // qaTeamMembers returns { drawers, checkers } — use only drawers
                    fetchedDrawers = res.data?.drawers || [];
                } catch { /* leave empty */ }
            }
            setDrawers(fetchedDrawers);
        } catch (e) { console.error(e); }
        finally { setLoading(false); setRefreshing(false); }
    }, [canAccess]);

    useEffect(() => { loadData(); }, [loadData]);

    /* ── Smart Polling ── */
    useSmartPolling({
        scope: 'all',
        interval: 45_000,
        onDataChanged: () => loadData(true),
        enabled: canAccess,
    });

    /* ── Assign drawer ── */
    // Show ALL drawers in dropdown (including absent), own-team first, then search-filtered
    const assignableDrawers = useMemo(() => {
        if (!assignDropdown) return [];
        // Sort: own-team first, then by name
        const sorted = [...drawers].sort((a, b) => {
            const ownA = a.is_own_team ? 0 : 1;
            const ownB = b.is_own_team ? 0 : 1;
            if (ownA !== ownB) return ownA - ownB;
            return a.name.localeCompare(b.name);
        });
        if (!assignSearch) return sorted;
        const q = assignSearch.toLowerCase();
        return sorted.filter(w => w.name.toLowerCase().includes(q) || w.email.toLowerCase().includes(q) || String(w.id).includes(q));
    }, [assignDropdown, drawers, assignSearch]);

    const openAssignDropdown = (e: React.MouseEvent, orderId: number) => {
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setAssignDropdown({ orderId, anchorRect: rect });
        setAssignSearch('');
    };

    const handleAssignDrawer = async (orderId: number, userId: number) => {
        try {
            setAssigning(true);
            const worker = drawers.find((w: User) => w.id === userId);
            const orderProjectId = orders.find(o => o.id === orderId)?.project_id;
            const res = await workflowService.assignToDrawer(orderId, userId, orderProjectId);
            setAssignDropdown(null);
            setAssignSearch('');

            // Optimistic update
            if (worker) {
                setOrders(prev => prev.map(o =>
                    o.id === orderId
                        ? { ...o, drawer_name: worker.name, drawer_id: worker.id, assigned_to: worker.id } as any
                        : o
                ));
            }

            toast({ type: 'success', title: 'Drawer Assigned', description: res.data?.message || 'Drawer assigned successfully' });
            loadData(true);
        } catch (e: any) {
            console.error(e);
            toast({ type: 'error', title: 'Assignment Failed', description: e?.response?.data?.message || 'Could not assign drawer' });
        } finally { setAssigning(false); }
    };

    if (!canAccess) {
        return (
            <AnimatedPage>
                <div className="text-center py-12">
                    <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
                    <h2 className="text-lg font-semibold text-slate-900">Access Restricted</h2>
                    <p className="text-sm text-slate-500">Only checkers can access team assignment.</p>
                </div>
            </AnimatedPage>
        );
    }

    /* ── Duration formatter ── */
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

    /* ── Stats buckets ── */
    const inDraw = orders.filter(o => ['QUEUED_DRAW', 'IN_DRAW'].includes(o.workflow_state));
    const inCheck = orders.filter(o => ['QUEUED_CHECK', 'IN_CHECK'].includes(o.workflow_state));
    const unassigned = orders.filter(o => !(o as any).drawer_id && !(o as any).drawer_name);

    /* ── Drawer cell renderer ── */
    const DrawerCell = ({ order }: { order: Order }) => {
        const name = (order as any).drawer_name || order.assignedUser?.name || null;
        const isDone = (order as any).drawer_done === 'yes';
        const duration = fmtDuration((order as any).dassign_time || null, (order as any).drawer_date || null);

        if (isDone && name) {
            return (
                <td className="px-3 py-2">
                    <div className="flex flex-col cursor-default opacity-80" title="Drawer completed — cannot reassign">
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
                </td>
            );
        }

        return (
            <td className="px-3 py-2">
                <button
                    onClick={(e) => openAssignDropdown(e, order.id)}
                    className="flex flex-col group cursor-pointer hover:bg-slate-50 rounded px-1 -mx-1 py-0.5 transition-colors w-full text-left"
                    title={name ? 'Click to change drawer' : 'Assign drawer'}
                >
                    <div className="flex items-center gap-1">
                        {name ? (
                            <>
                                <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[9px] font-bold flex-shrink-0">{name.charAt(0)}</div>
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
            </td>
        );
    };

    /* ── Column config ── */
    const fixedTrailingFields = useMemo(() => new Set([
        'drawer_name', 'checker_name', 'drawer_id', 'checker_id', 'workflow_state', 'status',
    ]), []);

    const defaultPrimaryColumns = useMemo<AssignmentTableColumn[]>(() => [
        { key: 'order_number', label: 'Order #', width: '7.5%' },
        { key: 'VARIANT_no', label: 'Variant', width: '9%' },
        { key: 'address', label: 'Address' },
        { key: 'priority', label: 'Priority', width: '5.5%', headerClassName: 'text-center', cellClassName: 'px-2 py-2 text-center' },
        { key: 'received_at', label: 'Received', width: '7%' },
    ], []);

    const dynamicPrimaryColumns = useMemo<AssignmentTableColumn[]>(() => {
        if (projectColumns.length === 0) return defaultPrimaryColumns;
        const visible = projectColumns
            .filter((c) => c.visible && !fixedTrailingFields.has(c.field))
            .map((c) => ({
                key: c.field,
                label: c.label || c.name || c.field,
                width: c.width ? `${c.width}px` : undefined,
                headerClassName: c.field === 'priority' ? 'text-center' : undefined,
                cellClassName: c.field === 'priority' ? 'px-2 py-2 text-center' : undefined,
            }));
        return visible.length === 0 ? [] : visible;
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
            case 'priority': {
                const p = (order.priority || '').toString().toLowerCase();
                return (
                    <td className={column.cellClassName || 'px-2 py-2 text-center'}>
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${p === 'urgent' ? 'bg-rose-100 text-rose-700'
                            : p === 'high' ? 'bg-amber-100 text-amber-700'
                                : p === 'rush' ? 'bg-purple-100 text-purple-700'
                                    : 'bg-slate-100 text-slate-600'
                            }`}>{order.priority?.toUpperCase() || 'NORMAL'}</span>
                    </td>
                );
            }
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
                        <p className="text-xs text-slate-500">Assign orders to your team drawers and track progress</p>
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

                {/* Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white rounded-xl border border-slate-200/60 p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <AlertTriangle className="w-4 h-4 text-amber-500" />
                            <span className="text-xs text-slate-500">Unassigned</span>
                        </div>
                        <div className="text-2xl font-bold text-amber-600">{unassigned.length}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200/60 p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Pencil className="w-4 h-4 text-blue-500" />
                            <span className="text-xs text-slate-500">In Drawing</span>
                        </div>
                        <div className="text-2xl font-bold text-blue-600">{inDraw.length}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200/60 p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-4 h-4 text-purple-500" />
                            <span className="text-xs text-slate-500">In Checking</span>
                        </div>
                        <div className="text-2xl font-bold text-purple-600">{inCheck.length}</div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200/60 p-4">
                        <div className="flex items-center gap-2 mb-1">
                            <Users className="w-4 h-4 text-slate-500" />
                            <span className="text-xs text-slate-500">Team Size</span>
                        </div>
                        <div className="text-2xl font-bold text-slate-900">{drawers.length}</div>
                    </div>
                </div>

                {/* Priority breakdown */}
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

                {/* Team drawers panel */}
                <div className="bg-white rounded-xl border border-slate-200/60 p-4">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                        <Pencil className="w-4 h-4 text-blue-500" /> Drawers ({drawers.length})
                        <span className="ml-auto text-[10px] font-normal text-slate-400">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1" />Own team highlighted
                        </span>
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                        {drawers.map(d => (
                            <div key={d.id} className={`flex items-center justify-between p-2 rounded-lg ${d.is_own_team ? 'bg-blue-50 border border-blue-100' : 'bg-slate-50'
                                }`}>
                                <div className="flex items-center gap-2 min-w-0">
                                    <div className="relative flex-shrink-0">
                                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold ${d.is_absent ? 'bg-slate-400' : d.is_own_team ? 'bg-blue-600' : 'bg-slate-500'
                                            }`}>
                                            {d.name.charAt(0)}
                                        </div>
                                        {/* Online dot */}
                                        <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${d.is_online ? 'bg-emerald-400' : 'bg-slate-300'
                                            }`} />
                                    </div>
                                    <div className="min-w-0">
                                        <div className="text-xs font-medium text-slate-900 truncate">{d.name}</div>
                                        <div className={`text-[10px] ${d.is_absent ? 'text-red-500' : d.is_online ? 'text-emerald-600' : 'text-slate-400'
                                            }`}>
                                            {d.is_absent ? 'Absent' : d.is_online ? 'Online' : 'Offline'}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right flex-shrink-0 ml-1">
                                    <div className="text-[10px] text-slate-600">WIP: {d.wip_count || 0}/{d.wip_limit || 5}</div>
                                    <div className="text-[10px] text-slate-400">Done: {d.today_completed || 0}</div>
                                </div>
                            </div>
                        ))}
                        {drawers.length === 0 && (
                            <div className="col-span-full text-sm text-slate-400 text-center py-4">No drawers found</div>
                        )}
                    </div>
                </div>

                {/* Unassigned alert */}
                {unassigned.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2 text-xs text-amber-700">
                        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <span><span className="font-semibold">{unassigned.length}</span> order{unassigned.length !== 1 ? 's' : ''} need a drawer assigned</span>
                    </div>
                )}

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
                                    {dynamicPrimaryColumns.map((col) => (
                                        <col key={col.key} style={col.width ? { width: col.width } : undefined} />
                                    ))}
                                    <col style={{ width: '8%' }} />{/* State */}
                                    <col style={{ width: '16%' }} />{/* Drawer */}
                                    <col style={{ width: '9%' }} />{/* Status */}
                                </colgroup>
                                <thead>
                                    <tr className="bg-brand-700 text-white">
                                        {dynamicPrimaryColumns.map((col) => (
                                            <th key={col.key} className={`px-3 py-2 font-semibold ${col.headerClassName || 'text-left'}`}>
                                                {col.label}
                                            </th>
                                        ))}
                                        <th className="px-2 py-2 text-center font-semibold">State</th>
                                        <th className="px-3 py-2 text-left font-semibold">
                                            <div className="flex items-center gap-1"><Pencil className="w-3 h-3" /> Drawer</div>
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
                                                className={`border-b border-slate-100 hover:bg-brand-50/40 transition-colors ${!(o as any).drawer_id && !(o as any).drawer_name ? 'bg-amber-50/30' : ''
                                                    } ${highlightedIds.has(o.id) ? 'new-order-highlight' : ''}`}
                                            >
                                                {dynamicPrimaryColumns.map((col) => (
                                                    <React.Fragment key={`${o.id}-${col.key}`}>
                                                        {renderPrimaryCell(o, col)}
                                                    </React.Fragment>
                                                ))}
                                                {/* State */}
                                                <td className="px-2 py-2 text-center"><StatusBadge status={o.workflow_state} size="sm" /></td>
                                                {/* Drawer — inline assign */}
                                                <DrawerCell order={o} />
                                                {/* Status badge */}
                                                <td className="px-2 py-2 text-center">
                                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${o.workflow_state?.includes('DELIVER') || o.workflow_state?.includes('APPROV') ? 'bg-green-100 text-green-700'
                                                        : o.workflow_state?.includes('HOLD') ? 'bg-red-100 text-red-700'
                                                            : o.workflow_state?.includes('CHECK') ? 'bg-purple-100 text-purple-700'
                                                                : o.workflow_state?.includes('DRAW') ? 'bg-blue-100 text-blue-700'
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
                                    <div className="text-sm font-medium">No orders assigned to you yet</div>
                                    <div className="text-xs mt-1">Orders will appear here once assigned to your checker queue</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Assign Drawer Dropdown (floating) ── */}
            {assignDropdown && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => { setAssignDropdown(null); setAssignSearch(''); }} />
                    <div
                        className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 w-64 max-h-80 flex flex-col overflow-hidden"
                        style={{
                            top: Math.min((assignDropdown.anchorRect?.bottom ?? 200) + 4, window.innerHeight - 330),
                            left: Math.min((assignDropdown.anchorRect?.left ?? 200), window.innerWidth - 280),
                        }}
                    >
                        {/* Dropdown header */}
                        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-xs font-semibold text-slate-700">Assign Drawer</span>
                                <button onClick={() => { setAssignDropdown(null); setAssignSearch(''); }} className="p-0.5 hover:bg-slate-200 rounded">
                                    <X className="w-3 h-3 text-slate-400" />
                                </button>
                            </div>
                            <div className="relative">
                                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                                <input
                                    type="text"
                                    autoFocus
                                    value={assignSearch}
                                    onChange={e => setAssignSearch(e.target.value)}
                                    placeholder="Search drawers..."
                                    className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
                                />
                            </div>
                        </div>
                        {/* Worker list */}
                        <div className="flex-1 overflow-y-auto">
                            {assigning ? (
                                <div className="flex items-center justify-center py-6">
                                    <Loader2 className="w-4 h-4 text-brand-600 animate-spin" />
                                    <span className="ml-2 text-xs text-slate-500">Assigning...</span>
                                </div>
                            ) : assignableDrawers.length === 0 ? (
                                <div className="text-center py-6 text-xs text-slate-400">
                                    No drawers found
                                </div>
                            ) : (
                                <div className="py-1">
                                    {/* Section label when own-team exists */}
                                    {assignableDrawers.some(w => w.is_own_team) && (
                                        <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-blue-50 border-b border-slate-100">
                                            Your Team
                                        </div>
                                    )}
                                    {assignableDrawers.map((w, idx) => {
                                        const prevIsOwn = idx > 0 ? assignableDrawers[idx - 1].is_own_team : true;
                                        const showOtherLabel = !w.is_own_team && prevIsOwn && assignableDrawers.some(d => d.is_own_team);
                                        return (
                                            <React.Fragment key={w.id}>
                                                {showOtherLabel && (
                                                    <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wide bg-slate-50 border-b border-slate-100">
                                                        Other Drawers
                                                    </div>
                                                )}
                                                <button
                                                    onClick={() => handleAssignDrawer(assignDropdown.orderId, w.id)}
                                                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-brand-50 transition-colors text-left"
                                                >
                                                    <div className="relative flex-shrink-0">
                                                        <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-white text-[10px] font-bold ${w.is_absent ? 'bg-slate-400' : w.is_own_team ? 'bg-blue-600' : 'bg-slate-500'
                                                            }`}>{w.name.charAt(0)}</div>
                                                        <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${w.is_online ? 'bg-emerald-400' : 'bg-slate-300'
                                                            }`} />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-xs font-medium text-slate-800 truncate">#{w.id} – {w.name}</div>
                                                        <div className="text-[10px] text-slate-400">
                                                            WIP: {w.wip_count || 0}/{w.wip_limit || 5} · Done: {w.today_completed || 0}
                                                            {w.is_absent && <span className="ml-1 text-red-400">· Absent</span>}
                                                        </div>
                                                    </div>
                                                    {(w.wip_count || 0) >= (w.wip_limit || 5) && (
                                                        <span className="text-[10px] text-rose-500 font-medium">Full</span>
                                                    )}
                                                </button>
                                            </React.Fragment>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}
        </AnimatedPage>
    );
}
