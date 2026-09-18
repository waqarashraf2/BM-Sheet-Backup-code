import { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { workflowService, projectService } from '../../services';
import { useSmartPolling } from '../../hooks/useSmartPolling';
import { useNewOrderHighlight } from '../../hooks/useNewOrderHighlight';
import type { Order, WorkItem } from '../../types';
import { AnimatedPage, PageHeader, StatusBadge, Modal, Button, DataTable } from '../../components/ui';
import { AlertTriangle, RefreshCw, Eye, RotateCcw, Search, CheckCircle, ChevronDown } from 'lucide-react';
import ClockDisplay from '../../components/ClockDisplay';

export default function RejectedOrders() {
  const { user } = useSelector((state: RootState) => state.auth);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState<Order | null>(null);
  const [workHistory, setWorkHistory] = useState<WorkItem[]>([]);
  const [showReassign, setShowReassign] = useState<Order | null>(null);
  const [reassignReason, setReassignReason] = useState('');
  const [reassigning, setReassigning] = useState(false);

  /* ── Searchable Dropdown State ── */
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState('');

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProjectDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /* ── Project timezone ── */
  const selectedProjectData = projects.find((p: any) => p.id === selectedProject);
  const projectTz = selectedProjectData?.timezone || 'Australia/Sydney';

  /* ── Project Time clock ── */

  // CEO should not see reassign actions or access this page
  const isManager = ['director', 'operations_manager'].includes(user?.role || '');

  /* ── Highlight newly arrived rejected orders ── */
  const highlightedIds = useNewOrderHighlight(orders);

  useEffect(() => {
    projectService.list().then(res => {
      const d = res.data?.data || res.data;
      const list = Array.isArray(d) ? d : [];
      setProjects(list);
      if (list.length > 0) setSelectedProject(list[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedProject) loadOrders();
  }, [selectedProject]);

  /* ── Smart Polling: auto-refresh when rejected orders change ── */
  useSmartPolling({
    projectIds: selectedProject ? [selectedProject] : [],
    scope: 'orders',
    interval: 10_000,
    onDataChanged: () => loadOrders(),
    enabled: !!selectedProject,
  });

  const loadOrders = async () => {
    if (!selectedProject) return;
    try {
      setLoading(true);
      const [checkRes, qaRes] = await Promise.all([
        workflowService.projectOrders(selectedProject, { state: 'REJECTED_BY_CHECK' as any }),
        workflowService.projectOrders(selectedProject, { state: 'REJECTED_BY_QA' as any }),
      ]);
      const checkOrders = checkRes.data?.data || checkRes.data || [];
      const qaOrders = qaRes.data?.data || qaRes.data || [];
      setOrders([...(Array.isArray(checkOrders) ? checkOrders : []), ...(Array.isArray(qaOrders) ? qaOrders : [])]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleViewDetail = async (order: Order) => {
    setShowDetail(order);
    try {
      const res = await workflowService.workItemHistory(order.id);
      setWorkHistory(res.data?.work_items || []);
    } catch (_) { setWorkHistory([]); }
  };

  const handleReassign = async () => {
    if (!showReassign || reassignReason.length < 3) return;
    try {
      setReassigning(true);
      await workflowService.reassignOrder(showReassign.id, null, reassignReason, showReassign.project_id);
      setShowReassign(null); setReassignReason('');
      loadOrders();
    } catch (e) { console.error(e); }
    finally { setReassigning(false); }
  };

  // Stats
  const byCheck = orders.filter(o => o.workflow_state === 'REJECTED_BY_CHECK').length;
  const byQA = orders.filter(o => o.workflow_state === 'REJECTED_BY_QA').length;
  const rejCodes: Record<string, number> = {};
  orders.forEach(o => { if (o.rejection_type) rejCodes[o.rejection_type] = (rejCodes[o.rejection_type] || 0) + 1; });

  return (
    <AnimatedPage>
      <PageHeader title="Rejected Orders" subtitle="Orders requiring rework"
        badge={orders.length > 0 ? <span className="text-xs font-medium text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full">{orders.length} rejected</span> : undefined}
        actions={
          <div className="flex items-center gap-4">
            <div className="text-right">
              <ClockDisplay timezone={projectTz} className="text-sm font-semibold text-slate-800 font-mono" />
            </div>
            <Button variant="secondary" icon={RefreshCw} onClick={loadOrders}>Refresh</Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="text-2xl font-bold text-rose-600">{orders.length}</div>
          <div className="text-xs text-slate-500">Total Rejected</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="text-2xl font-bold text-amber-600">{byCheck}</div>
          <div className="text-xs text-slate-500">By Checker</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="text-2xl font-bold text-brand-600">{byQA}</div>
          <div className="text-xs text-slate-500">By QA</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="text-2xl font-bold text-slate-900">{Object.keys(rejCodes).length}</div>
          <div className="text-xs text-slate-500">Rejection Types</div>
        </div>
      </div>

      {/* Project selector */}
      {projects.length > 1 && (
        <div className="mb-4 relative" ref={dropdownRef}>
          <label htmlFor="project-select" className="sr-only">Select Project</label>
          <button
            onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
            className="flex items-center justify-between text-sm min-w-[220px] max-w-sm px-3 py-2 font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors hover:bg-slate-50"
          >
            <span className="truncate">
              {selectedProject
                ? projects.find(p => p.id === selectedProject)?.name || 'Select a Project...'
                : 'Select a Project...'}
            </span>
            <ChevronDown className={`w-4 h-4 ml-2 text-slate-400 flex-shrink-0 transition-transform ${projectDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {projectDropdownOpen && (
            <div className="absolute z-50 mt-1 w-[320px] bg-white border border-slate-200 rounded-xl shadow-lg max-h-[350px] flex flex-col">
              <div className="p-2 border-b border-slate-100 bg-slate-50 rounded-t-xl">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search project by name..."
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-brand-500 shadow-sm"
                  />
                </div>
              </div>
              <div className="overflow-y-auto p-1 flex-1">
                {projects.filter(p => 
                  p.name.toLowerCase().includes(projectSearch.toLowerCase())
                ).length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
                    <Search className="w-5 h-5 text-slate-300" />
                    <span>No projects found</span>
                  </div>
                ) : (
                  projects.filter(p => 
                    p.name.toLowerCase().includes(projectSearch.toLowerCase())
                  ).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedProject(p.id);
                        setProjectDropdownOpen(false);
                        setProjectSearch('');
                      }}
                      className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors flex items-center justify-between group ${
                        selectedProject === p.id
                          ? 'bg-brand-50 text-brand-700 font-bold'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate pr-2">{p.name}</span>
                      {selectedProject === p.id && <CheckCircle className="w-4 h-4 text-brand-600 flex-shrink-0" />}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <DataTable
        pageSize={10000}
        data={orders} loading={loading}
        rowClassName={(o: Order) => highlightedIds.has(o.id) ? 'new-order-highlight' : ''}
        columns={[
          { key: 'order_number', label: 'Order', sortable: true, render: (o) => (
            <div>
              <div className="font-semibold text-slate-900">{o.order_number}</div>
              <div className="text-xs text-slate-400">{o.client_reference}</div>
            </div>
          )},
          { key: 'workflow_state', label: 'Rejected By', render: (o) => <StatusBadge status={o.workflow_state} /> },
          { key: 'rejection_type', label: 'Type', render: (o) => (
            <span className="text-xs font-medium text-rose-600 bg-rose-50 px-2 py-0.5 rounded capitalize">{o.rejection_type || '—'}</span>
          )},
          { key: 'rejection_reason', label: 'Reason', render: (o) => (
            <span className="text-sm text-slate-500 line-clamp-1 max-w-[200px]">{o.rejection_reason || '—'}</span>
          )},
          { key: 'recheck_count', label: 'Rechecks', render: (o) => (
            <span className="font-medium text-slate-900">{o.recheck_count}</span>
          )},
          { key: 'actions', label: '', render: (o) => (
            <div className="flex items-center gap-1 justify-end">
              <Button variant="ghost" size="xs" onClick={() => handleViewDetail(o)}><Eye className="w-3.5 h-3.5" /></Button>
              {isManager && <Button variant="ghost" size="xs" onClick={() => { setShowReassign(o); setReassignReason(''); }}><RotateCcw className="w-3.5 h-3.5" /></Button>}
            </div>
          )},
        ]}
        emptyIcon={AlertTriangle}
        emptyTitle="No rejected orders"
        emptyDescription="All orders are progressing normally."
      />

      {/* Detail Modal */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title={`Order ${showDetail?.order_number}`} size="lg">
        {showDetail && (
          <div className="space-y-4">
            {showDetail.rejection_reason && (
              <div className="bg-rose-50 rounded-lg p-4">
                <div className="text-xs font-semibold text-rose-600 uppercase mb-1">Rejection Reason</div>
                <p className="text-sm text-rose-700">{showDetail.rejection_reason}</p>
                <div className="text-xs text-rose-400 mt-1">Type: {showDetail.rejection_type} &middot; {showDetail.rejected_at ? new Date(showDetail.rejected_at).toLocaleString() : ''}</div>
              </div>
            )}

            <div>
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Work History</h4>
              {workHistory.length > 0 ? (
                <div className="space-y-2">
                  {workHistory.map((wi) => (
                    <div key={wi.id} className="bg-slate-50 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-slate-700">{wi.stage}</div>
                        <div className="text-xs text-slate-400">
                          {wi.assignedUser?.name || 'Unassigned'} &middot; Attempt #{wi.attempt_number}
                        </div>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={wi.status} size="xs" />
                        {wi.rework_reason && <div className="text-xs text-rose-500 mt-1">{wi.rework_reason}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-slate-400">No history available.</p>}
            </div>

            <Button variant="secondary" className="w-full" onClick={() => setShowDetail(null)}>Close</Button>
          </div>
        )}
      </Modal>

      {/* Reassign Modal */}
      <Modal open={!!showReassign} onClose={() => setShowReassign(null)} title="Reassign Order" subtitle="Re-queue this order for auto-assignment" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">Order <strong>{showReassign?.order_number}</strong> will be unassigned and re-queued.</p>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-slate-700">Reason (min 3 chars) <span className="text-rose-500">*</span></label>
            <textarea value={reassignReason} onChange={e => setReassignReason(e.target.value)} className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors resize-none" rows={3} placeholder="Why is this order being reassigned?" />
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowReassign(null)}>Cancel</Button>
          <Button className="flex-1" onClick={handleReassign} loading={reassigning} disabled={reassignReason.length < 3}>Reassign</Button>
        </div>
      </Modal>
    </AnimatedPage>
  );
}
