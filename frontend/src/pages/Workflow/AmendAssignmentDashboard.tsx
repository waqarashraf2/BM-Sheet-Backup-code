import { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { amendService, projectService, type AmendOrder, type AmenderWorker } from '../../services';
import {
  RotateCcw, Search, UserCheck, CheckCircle2, Clock,
  FileText, AlertCircle, RefreshCw, ChevronLeft, ChevronRight,
  Sparkles
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function AmendAssignmentDashboard() {
  const { user } = useSelector((state: RootState) => state.auth);

  // Projects list
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);

  // Orders and counts
  const [orders, setOrders] = useState<AmendOrder[]>([]);
  const [counts, setCounts] = useState({ total: 0, pending: 0, in_progress: 0, delivered: 0 });
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, per_page: 25, total: 0 });

  // Amenders for assignment modal
  const [amenders, setAmenders] = useState<AmenderWorker[]>([]);
  const [assignModalOrder, setAssignModalOrder] = useState<AmendOrder | null>(null);
  const [selectedAmenderId, setSelectedAmenderId] = useState<number | ''>('');
  const [assigningLoading, setAssigningLoading] = useState<boolean>(false);

  // Notes view/edit modal
  const [notesModalOrder, setNotesModalOrder] = useState<AmendOrder | null>(null);
  const [notesDraft, setNotesDraft] = useState<string>('');
  const [savingNotes, setSavingNotes] = useState<boolean>(false);

  // Success toast / message
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Load projects on mount
  useEffect(() => {
    projectService.list()
      .then((res: any) => {
        const raw = res.data?.data || res.data;
        const list = Array.isArray(raw) ? raw : [];
        setProjects(list);
        if (list.length > 0) {
          // If current user is assigned to a specific project, pick that, else pick the first project
          const defaultProject = user?.project_id
            ? list.find((p: any) => p.id === Number(user.project_id)) || list[0]
            : list[0];
          setSelectedProjectId(defaultProject.id);
        }
      })
      .catch((err) => {
        console.error('Failed to load projects:', err);
      });
  }, [user?.project_id]);

  // Load amenders for assignment modal
  useEffect(() => {
    amendService.getWorkers()
      .then((res) => {
        setAmenders(res.data?.data || []);
      })
      .catch((err) => console.error('Failed to load amenders:', err));
  }, []);

  // Fetch orders when project, statusFilter, search, or page changes
  const fetchOrders = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      setLoading(true);
      const res = await amendService.getOrders(selectedProjectId, {
        status: statusFilter,
        search: searchTerm,
        page,
        per_page: 25,
      });

      setOrders(res.data.data || []);
      setCounts(res.data.counts || { total: 0, pending: 0, in_progress: 0, delivered: 0 });
      setPagination(res.data.pagination || { current_page: 1, last_page: 1, per_page: 25, total: 0 });
    } catch (err) {
      console.error('Failed to load amend orders:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId, statusFilter, searchTerm, page]);

  const [syncing, setSyncing] = useState<boolean>(false);

  // Handle Refresh & Sync with client portal
  const handleRefreshAndSync = async () => {
    if (!selectedProjectId) return;
    try {
      setSyncing(true);
      if (selectedProjectId === 15) {
        showToast('Checking Roomio portal for new amendments...');
        try {
          const syncRes = await amendService.syncFromPortal(selectedProjectId);
          const count = syncRes.data?.data?.synced ?? 0;
          if (count > 0) {
            showToast(`Synced ${count} amendment${count > 1 ? 's' : ''} from portal`);
          } else {
            showToast('Amendments are up to date');
          }
        } catch (syncErr: any) {
          console.warn('Portal sync warning:', syncErr);
        }
      }
      await fetchOrders();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Handle Assign Amender
  const handleAssign = async () => {
    if (!selectedProjectId || !assignModalOrder || !selectedAmenderId) return;
    try {
      setAssigningLoading(true);
      const res = await amendService.assign(selectedProjectId, assignModalOrder.order_id, {
        amender_id: Number(selectedAmenderId),
      });
      showToast(res.data.message || 'Assigned successfully');
      setAssignModalOrder(null);
      setSelectedAmenderId('');
      fetchOrders();
    } catch (err: any) {
      console.error('Failed to assign amender:', err);
      showToast(err.response?.data?.message || 'Assignment failed');
    } finally {
      setAssigningLoading(false);
    }
  };

  // Handle Complete / Deliver
  const handleComplete = async (order: AmendOrder) => {
    if (!selectedProjectId) return;
    if (!window.confirm(`Mark amend for order #${order.order_number} as Delivered / Completed?`)) {
      return;
    }

    try {
      const res = await amendService.complete(selectedProjectId, order.order_id);
      showToast(res.data.message || 'Amend marked as delivered');
      fetchOrders();
    } catch (err: any) {
      console.error('Failed to complete amend:', err);
      showToast(err.response?.data?.message || 'Action failed');
    }
  };

  // Handle Save Notes
  const handleSaveNotes = async () => {
    if (!selectedProjectId || !notesModalOrder) return;
    try {
      setSavingNotes(true);
      const res = await amendService.updateNotes(selectedProjectId, notesModalOrder.order_id, notesDraft);
      showToast(res.data.message || 'Notes updated');
      setNotesModalOrder(null);
      fetchOrders();
    } catch (err: any) {
      console.error('Failed to update amend notes:', err);
      showToast(err.response?.data?.message || 'Failed to save notes');
    } finally {
      setSavingNotes(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered':
      case 'done':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            Delivered
          </span>
        );
      case 'in_progress':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-full">
            <Clock className="w-3.5 h-3.5 text-blue-600 animate-spin" />
            In Progress
          </span>
        );
      case 'pending':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
            Pending
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toast Notification */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 right-6 z-50 flex items-center gap-2 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-xl text-sm font-medium border border-slate-700"
          >
            <Sparkles className="w-4 h-4 text-teal-400" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-600 font-bold border border-amber-500/20">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Amend Dashboard</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Manage amendments, track notes, and assign dedicated amenders
              </p>
            </div>
          </div>
        </div>

        {/* Project Selector & Refresh */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={selectedProjectId || ''}
              onChange={(e) => {
                setSelectedProjectId(Number(e.target.value));
                setPage(1);
              }}
              className="pl-3 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl font-medium text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleRefreshAndSync}
            title="Refresh & Sync Portal"
            disabled={loading || syncing}
            className="p-2 text-slate-500 hover:text-teal-600 bg-slate-50 hover:bg-teal-50 border border-slate-200 rounded-xl transition-all"
          >
            <RefreshCw className={`w-4 h-4 ${loading || syncing ? 'animate-spin text-teal-600' : ''}`} />
          </button>
        </div>
      </div>

      {/* Status Filter Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { key: 'all', label: 'Total Amends', count: counts.total, color: 'text-slate-900', bg: 'bg-slate-50', activeBorder: 'border-slate-800' },
          { key: 'pending', label: 'Pending Amends', count: counts.pending, color: 'text-amber-600', bg: 'bg-amber-50/50', activeBorder: 'border-amber-500' },
          { key: 'in_progress', label: 'In Progress', count: counts.in_progress, color: 'text-blue-600', bg: 'bg-blue-50/50', activeBorder: 'border-blue-500' },
          { key: 'delivered', label: 'Delivered', count: counts.delivered, color: 'text-emerald-600', bg: 'bg-emerald-50/50', activeBorder: 'border-emerald-500' },
        ].map((tab) => {
          const isActive = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => {
                setStatusFilter(tab.key);
                setPage(1);
              }}
              className={`p-4 rounded-xl border text-left transition-all duration-200 bg-white ${
                isActive
                  ? `${tab.activeBorder} shadow-sm ring-1 ring-slate-900/5`
                  : 'border-slate-200/80 hover:border-slate-300'
              }`}
            >
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{tab.label}</div>
              <div className={`text-2xl font-bold mt-1 ${tab.color}`}>{tab.count}</div>
            </button>
          );
        })}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200/80">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setPage(1);
                fetchOrders();
              }
            }}
            placeholder="Search order #, worker, client..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
          />
        </div>

        <div className="text-xs text-slate-500 font-medium">
          Showing {orders.length} of {pagination.total} orders
        </div>
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">Order # & Status</th>
                <th className="py-3.5 px-4">Client & Property</th>
                <th className="py-3.5 px-4">Original Team</th>
                <th className="py-3.5 px-4">Amend Notes</th>
                <th className="py-3.5 px-4">Amender</th>
                <th className="py-3.5 px-4">Timestamps</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-teal-600" />
                    Loading amend orders...
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-semibold text-slate-600">No amend orders found</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      No orders matching the selected status filter in this project
                    </p>
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const hasNotes = Boolean(order.amend_notes);
                  return (
                    <tr key={order.order_id} className="hover:bg-slate-50/70 transition-colors">
                      {/* Order # and Status */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="font-bold text-slate-900 tracking-tight">
                          {order.order_number}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          {getStatusBadge(order.amend_status)}
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                            AMEND
                          </span>
                        </div>
                      </td>

                      {/* Client and Property */}
                      <td className="py-3.5 px-4 align-top max-w-[220px]">
                        <div className="font-medium text-slate-800 truncate" title={order.client_name || ''}>
                          {order.client_name || '—'}
                        </div>
                        <div className="text-xs text-slate-500 truncate mt-0.5" title={order.address || ''}>
                          {order.address || '—'}
                        </div>
                        {order.plan_type && (
                          <span className="inline-block mt-1 text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                            {order.plan_type}
                          </span>
                        )}
                      </td>

                      {/* Original Workers */}
                      <td className="py-3.5 px-4 align-top">
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <span className="font-semibold text-slate-400 w-12">Draw:</span>
                            <span className="font-medium text-slate-800">{order.drawer_name || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <span className="font-semibold text-slate-400 w-12">Check:</span>
                            <span className="font-medium text-slate-800">{order.checker_name || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <span className="font-semibold text-slate-400 w-12">QA:</span>
                            <span className="font-medium text-slate-800">{order.qa_name || '—'}</span>
                          </div>
                        </div>
                      </td>

                      {/* Amend Notes */}
                      <td className="py-3.5 px-4 align-top max-w-[240px]">
                        {hasNotes ? (
                          <div>
                            <p className="text-xs text-slate-700 line-clamp-2 italic bg-amber-50/60 p-2 rounded-lg border border-amber-100/60">
                              "{order.amend_notes}"
                            </p>
                            <button
                              onClick={() => {
                                setNotesModalOrder(order);
                                setNotesDraft(order.amend_notes || '');
                              }}
                              className="mt-1 text-[11px] font-medium text-teal-600 hover:text-teal-700 underline"
                            >
                              Edit Notes
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setNotesModalOrder(order);
                              setNotesDraft('');
                            }}
                            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-teal-600 border border-dashed border-slate-300 hover:border-teal-400 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            Add Notes
                          </button>
                        )}
                      </td>

                      {/* Amender */}
                      <td className="py-3.5 px-4 align-top">
                        {order.amender_name ? (
                          <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center font-bold text-[10px]">
                              {order.amender_name.charAt(0)}
                            </div>
                            <span className="font-semibold text-xs text-slate-800">
                              {order.amender_name}
                            </span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">
                            Unassigned
                          </span>
                        )}
                      </td>

                      {/* Timestamps */}
                      <td className="py-3.5 px-4 align-top text-[11px] text-slate-500">
                        {order.amend_completed_at ? (
                          <div>
                            <span className="text-emerald-600 font-semibold">Done:</span>{' '}
                            {new Date(order.amend_completed_at).toLocaleString()}
                          </div>
                        ) : order.amend_assigned_at ? (
                          <div>
                            <span className="text-blue-600 font-semibold">Assigned:</span>{' '}
                            {new Date(order.amend_assigned_at).toLocaleString()}
                          </div>
                        ) : order.received_at ? (
                          <div>
                            <span className="font-semibold">Recv:</span>{' '}
                            {new Date(order.received_at).toLocaleDateString()}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>

                      {/* Action Buttons */}
                      <td className="py-3.5 px-4 align-top text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setAssignModalOrder(order);
                              setSelectedAmenderId(order.amender_id || '');
                            }}
                            className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                          >
                            Assign
                          </button>

                          {order.amend_status !== 'delivered' && order.amend_status !== 'done' && (
                            <button
                              onClick={() => handleComplete(order)}
                              className="px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors shadow-xs"
                            >
                              Deliver
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination.last_page > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-slate-200 bg-slate-50/50">
            <span className="text-xs text-slate-500">
              Page {pagination.current_page} of {pagination.last_page}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={pagination.current_page <= 1}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-slate-600"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pagination.last_page, p + 1))}
                disabled={pagination.current_page >= pagination.last_page}
                className="p-1.5 rounded-lg border border-slate-200 hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed text-slate-600"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Assign Amender Modal */}
      {assignModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center font-bold">
                <UserCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Assign Amender</h3>
                <p className="text-xs text-slate-500">
                  Order #{assignModalOrder.order_number}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Select Amender
                </label>
                <select
                  value={selectedAmenderId}
                  onChange={(e) => setSelectedAmenderId(Number(e.target.value))}
                  className="w-full p-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                >
                  <option value="">-- Choose Amender / Worker --</option>
                  {amenders.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.role.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAssignModalOrder(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAssign}
                  disabled={!selectedAmenderId || assigningLoading}
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-xl transition-colors shadow-xs"
                >
                  {assigningLoading ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Notes Modal */}
      {notesModalOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center font-bold">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">Amend Notes</h3>
                <p className="text-xs text-slate-500">
                  Order #{notesModalOrder.order_number}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Enter Instructions / Notes for this Amend:
                </label>
                <textarea
                  rows={4}
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  placeholder="e.g. Correct kitchen dimensions, add missing door on balcony, change wall color..."
                  className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNotesModalOrder(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-xl transition-colors shadow-xs"
                >
                  {savingNotes ? 'Saving...' : 'Save Notes'}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
