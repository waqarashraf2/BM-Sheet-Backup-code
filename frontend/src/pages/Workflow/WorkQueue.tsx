import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { workflowService, projectService } from '../../services';
import type { Order } from '../../types';
import { AnimatedPage, PageHeader, StatusBadge, Button, DataTable, FilterBar } from '../../components/ui';
import { Package, RefreshCw } from 'lucide-react';

export default function WorkQueue() {
  const { user } = useSelector((state: RootState) => state.auth);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState<string>('all');
  const [selectedPriority, setSelectedPriority] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);

  const isManager = ['ceo', 'director', 'operations_manager', 'project_manager'].includes(user?.role || '');
  const isWorker = ['drawer', 'checker', 'filler', 'qa', 'designer'].includes(user?.role || '');

  /* ── Countdown tick (every 30s) ── */
  const [, setCountdownTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setCountdownTick(t => t + 1), 30_000);
    return () => clearInterval(iv);
  }, []);

  /** Parse due_in → ms remaining */
  const parseDueIn = (raw: string | null | undefined, receivedAt?: string | null): number | null => {
    const getPkNow = () => {
      const pkStr = new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' });
      return new Date(pkStr).getTime();
    };
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
  };

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

  useEffect(() => {
    if (isManager) {
      projectService.list().then(res => {
        const d = res.data?.data || res.data;
        const list = Array.isArray(d) ? d : [];
        setProjects(list);
        if (list.length > 0) setSelectedProject(list[0].id);
      }).catch(() => {});
    } else if (user?.project_id) {
      setSelectedProject(user.project_id);
    }
  }, [user]);

  useEffect(() => {
    if (isWorker) {
      loadOrders();
    } else if (selectedProject) {
      loadOrders();
    }
  }, [selectedProject, selectedState, selectedPriority]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      if (isWorker) {
        // Workers use /workflow/my-queue — returns only their assigned orders
        const res = await workflowService.getQueue();
        const d = res.data?.orders || (res.data as any)?.data || res.data;
        let list = Array.isArray(d) ? d : [];
        // Client-side filtering for workers
        if (selectedState !== 'all') list = list.filter(o => o.workflow_state === selectedState);
        if (selectedPriority !== 'all') list = list.filter(o => o.priority === selectedPriority);
        setOrders(list);
      } else {
        // Managers use /workflow/{projectId}/orders — returns all project orders
        if (!selectedProject) return;
        const params: any = {};
        if (selectedState !== 'all') params.state = selectedState;
        if (selectedPriority !== 'all') params.priority = selectedPriority;
        const res = await workflowService.projectOrders(selectedProject, params);
        const d = res.data?.data || res.data;
        setOrders(Array.isArray(d) ? d : []);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  if (!selectedProject && !isManager && !isWorker) {
    return (
      <AnimatedPage>
        <PageHeader title="Work Queue" subtitle="View project orders and workflow states" />
        <div className="bg-white rounded-xl border border-slate-200/60 p-12 text-center">
          <Package className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">No project assigned to your account.</p>
        </div>
      </AnimatedPage>
    );
  }

  // State summary
  const stateCounts: Record<string, number> = {};
  orders.forEach(o => { stateCounts[o.workflow_state] = (stateCounts[o.workflow_state] || 0) + 1; });

  const filtered = orders.filter(o =>
    !searchTerm || o.order_number?.toLowerCase().includes(searchTerm.toLowerCase()) || o.client_reference?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AnimatedPage>
      <PageHeader title="Work Queue" subtitle="Orders and workflow state tracking"
        actions={<Button variant="secondary" icon={RefreshCw} onClick={loadOrders}>Refresh</Button>}
      />

      {/* State summary bar */}
      <div className="bg-white rounded-xl border border-slate-200/60 p-3 mb-6 overflow-x-auto">
        <div className="flex items-center gap-2 min-w-max">
          <button onClick={() => setSelectedState('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selectedState === 'all' ? 'bg-[#2AA7A0] text-white' : 'hover:bg-slate-100 text-slate-600'}`}>
            All ({orders.length})
          </button>
          {Object.entries(stateCounts).sort(([a], [b]) => a.localeCompare(b)).map(([state, count]) => (
            <button key={state} onClick={() => setSelectedState(selectedState === state ? 'all' : state)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${selectedState === state ? 'bg-[#2AA7A0] text-white' : 'hover:bg-slate-100 text-slate-600'}`}>
              {state.replace(/_/g, ' ')} ({count})
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <FilterBar searchValue={searchTerm} onSearchChange={setSearchTerm} searchPlaceholder="Search orders..."
        filters={<>
          {isManager && projects.length > 1 && (
            <select value={selectedProject || ''} onChange={e => setSelectedProject(Number(e.target.value))} aria-label="Select project" className="select text-sm">
              {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          <select value={selectedPriority} onChange={e => setSelectedPriority(e.target.value)} aria-label="Filter by priority" className="select text-sm">
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option><option value="high">High</option>
            <option value="normal">Normal</option><option value="low">Low</option>
          </select>
        </>}
      />

      {/* Orders table */}
      <div className="mt-4">
        <DataTable
          pageSize={10000}
          data={[...filtered].sort((a, b) => {
            const pw: Record<string, number> = { rush: 0, urgent: 0, high: 1, normal: 2, low: 3 };
            return (pw[a.priority] ?? 2) - (pw[b.priority] ?? 2);
          })} loading={loading}
          columns={[
            { key: 'order_number', label: 'Order #', sortable: true, render: (_o) => (
              <div>
                <div className="font-semibold text-slate-400">••••••</div>
              </div>
            )},
            { key: 'address', label: 'Address', render: (_o) => (
              <div className="text-xs text-slate-400">••••••</div>
            )},
            { key: 'priority', label: 'Priority', render: (o) => <StatusBadge status={o.priority} size="xs" /> },
            { key: 'workflow_state', label: 'State', render: (o) => <StatusBadge status={o.workflow_state} /> },
            { key: 'recheck', label: 'Rechecks', sortable: true, render: (o) => (
              o.recheck_count > 0 ? <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded">{o.recheck_count}</span> : <span className="text-slate-300">0</span>
            )},
            { key: 'hold', label: 'Hold', render: (o) => o.is_on_hold ? <StatusBadge status="on_hold" size="xs" /> : null },
            { key: 'due_in', label: 'Due In', render: (o) => {
              if (o.workflow_state?.includes('COMPLETE') || o.workflow_state?.includes('DELIVER')) return <span className="text-xs text-slate-400">—</span>;
              const ms = parseDueIn((o as any).due_in, o.received_at);
              if (ms === null) return <span className="text-xs text-slate-400">—</span>;
              const { label, overdue, hrs } = fmtCountdown(ms);
              const cls = overdue ? 'text-red-600 bg-red-50' : hrs < 1 ? 'text-orange-600 bg-orange-50' : hrs < 4 ? 'text-yellow-600 bg-yellow-50' : 'text-green-600 bg-green-50';
              return <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${cls}`}>{label}</span>;
            }},
          ]}
          emptyIcon={Package}
          emptyTitle="No orders found"
          emptyDescription="No orders match the current filters."
        />
      </div>
    </AnimatedPage>
  );
}
