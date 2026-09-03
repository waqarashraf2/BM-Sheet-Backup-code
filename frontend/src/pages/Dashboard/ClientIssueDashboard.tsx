import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { 
  AlertCircle, 
  Clock, 
  Search, 
  RefreshCw, 
  ExternalLink, 
  CheckCircle2, 
  MessageSquare, 
  Layers, 
  Building2, 
  Send, 
  X, 
  Loader2, 
  Inbox, 
  Play, 
  Zap,
  Filter
} from 'lucide-react';
import { projectService } from '../../services';

export default function ClientIssueDashboard() {
  const [issues, setIssues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'waiting' | 'in_progress' | 'finished' | 'all'>('waiting'); // DEFAULT: only waiting for client
  const [projects, setProjects] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Global KPI statistics
  const [stats, setStats] = useState({
    total: 0,
    waiting: 0,
    in_progress: 0,
    finished: 0,
  });

  // Reply modal state
  const [replyModalIssue, setReplyModalIssue] = useState<any | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [replySuccessMsg, setReplySuccessMsg] = useState('');

  // Fetch projects list (scoped to user's permissions)
  useEffect(() => {
    projectService.list().then(res => {
      const d = res.data?.data || res.data;
      setProjects(Array.isArray(d) ? d : []);
    }).catch(err => {
      console.error('Failed to load projects for filter', err);
    });
  }, []);

  const fetchIssues = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await projectService.getClientIssuesDashboard({
        project_id: selectedProjectId ? Number(selectedProjectId) : undefined,
        search: search.trim() || undefined,
        status: statusFilter,
        page,
      });
      setIssues(res.data.data || []);
      setTotalPages(res.data.last_page || 1);
      setTotalCount(res.data.total || 0);
      if (res.data.stats) {
        setStats(res.data.stats);
      }
    } catch (err) {
      console.error('Failed to fetch client issues dashboard', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [search, selectedProjectId, statusFilter, page]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchIssues();
  };

  const handleOpenReply = (item: any) => {
    setReplyModalIssue(item);
    setReplyText(item.client_reply_text || '');
    setReplySuccessMsg('');
  };

  const handleSubmitReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyModalIssue || !replyText.trim()) return;

    try {
      setSubmittingReply(true);
      await projectService.submitClientReply(
        replyModalIssue.project_id,
        replyModalIssue.order_id,
        replyText.trim()
      );
      setReplySuccessMsg('Your reply has been saved and forwarded to the team!');
      setTimeout(() => {
        setReplyModalIssue(null);
        setReplySuccessMsg('');
        fetchIssues(true);
      }, 1200);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to submit reply. Please try again.');
    } finally {
      setSubmittingReply(false);
    }
  };

  const formatDate = (dateString: string | undefined | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString([], { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const formatDiff = (minutes: number | undefined | null) => {
    if (minutes === undefined || minutes === null) return '-';
    const totalM = Math.round(Number(minutes));
    if (isNaN(totalM)) return '-';
    if (totalM < 60) return `${totalM}m`;
    const days = Math.floor(totalM / (24 * 60));
    const hours = Math.floor((totalM % (24 * 60)) / 60);
    const mins = Math.round(totalM % 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 && days === 0) parts.push(`${mins}m`);
    return parts.join(' ') || `${totalM}m`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 text-amber-600 rounded-xl border border-amber-500/20">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Client Issues Dashboard</h1>
              <p className="text-slate-500 text-sm mt-0.5">
                Orders on hold awaiting client clarification, received times, paused times, and resume tracking
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchIssues(true)}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-medium transition-colors shadow-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* 📊 Interactive KPI Stats Cards (Click to Filter Table) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* 1. Total Paused Issues */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('all');
            setPage(1);
          }}
          className={`p-5 rounded-2xl border text-left transition-all relative overflow-hidden shadow-sm hover:shadow-md ${
            statusFilter === 'all'
              ? 'bg-slate-900 text-white border-slate-900 ring-2 ring-slate-900/20 shadow-md'
              : 'bg-white text-slate-900 border-slate-200/80 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider ${statusFilter === 'all' ? 'text-slate-300' : 'text-slate-500'}`}>
                Total Issues
              </p>
              <p className="text-2xl font-bold mt-1">{stats.total}</p>
            </div>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${statusFilter === 'all' ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-600'}`}>
              <Layers className="w-6 h-6" />
            </div>
          </div>
          {statusFilter === 'all' && (
            <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-300"></span> Active Filter: Showing All
            </div>
          )}
        </button>

        {/* 2. Waiting For Client (DEFAULT) */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('waiting');
            setPage(1);
          }}
          className={`p-5 rounded-2xl border text-left transition-all relative overflow-hidden shadow-sm hover:shadow-md ${
            statusFilter === 'waiting'
              ? 'bg-amber-500 text-white border-amber-500 ring-2 ring-amber-500/30 shadow-md'
              : 'bg-white text-slate-900 border-slate-200/80 hover:border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider ${statusFilter === 'waiting' ? 'text-amber-100' : 'text-amber-600'}`}>
                Waiting For Client
              </p>
              <p className="text-2xl font-bold mt-1">{stats.waiting}</p>
            </div>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${statusFilter === 'waiting' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-600'}`}>
              <Clock className="w-6 h-6" />
            </div>
          </div>
          {statusFilter === 'waiting' && (
            <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-amber-100">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span> Active Filter: Pending Client Reply
            </div>
          )}
        </button>

        {/* 3. Active / Resumed */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('in_progress');
            setPage(1);
          }}
          className={`p-5 rounded-2xl border text-left transition-all relative overflow-hidden shadow-sm hover:shadow-md ${
            statusFilter === 'in_progress'
              ? 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-600/30 shadow-md'
              : 'bg-white text-slate-900 border-slate-200/80 hover:border-blue-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider ${statusFilter === 'in_progress' ? 'text-blue-100' : 'text-blue-600'}`}>
                Active / Resumed
              </p>
              <p className="text-2xl font-bold mt-1">{stats.in_progress}</p>
            </div>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${statusFilter === 'in_progress' ? 'bg-blue-700 text-white' : 'bg-blue-50 text-blue-600'}`}>
              <Zap className="w-6 h-6" />
            </div>
          </div>
          {statusFilter === 'in_progress' && (
            <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-blue-100">
              <span className="w-1.5 h-1.5 rounded-full bg-white"></span> Active Filter: In Progress
            </div>
          )}
        </button>

        {/* 4. Resolved / Finished */}
        <button
          type="button"
          onClick={() => {
            setStatusFilter('finished');
            setPage(1);
          }}
          className={`p-5 rounded-2xl border text-left transition-all relative overflow-hidden shadow-sm hover:shadow-md ${
            statusFilter === 'finished'
              ? 'bg-emerald-600 text-white border-emerald-600 ring-2 ring-emerald-600/30 shadow-md'
              : 'bg-white text-slate-900 border-slate-200/80 hover:border-emerald-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-xs font-semibold uppercase tracking-wider ${statusFilter === 'finished' ? 'text-emerald-100' : 'text-emerald-600'}`}>
                Resolved / Finished
              </p>
              <p className="text-2xl font-bold mt-1">{stats.finished}</p>
            </div>
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${statusFilter === 'finished' ? 'bg-emerald-700 text-white' : 'bg-emerald-50 text-emerald-600'}`}>
              <CheckCircle2 className="w-6 h-6" />
            </div>
          </div>
          {statusFilter === 'finished' && (
            <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-emerald-100">
              <span className="w-1.5 h-1.5 rounded-full bg-white"></span> Active Filter: Resolved
            </div>
          )}
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="mb-6 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto items-center">
          <form onSubmit={handleSearchSubmit} className="relative w-full sm:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search order, ref, or reason..."
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
            />
          </form>

          {projects.length > 1 && (
            <select
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setPage(1);
              }}
              className="w-full sm:w-56 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all shadow-sm"
            >
              <option value="">All Assigned Projects</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Filter Indicator Badge */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 font-medium">Filter view:</span>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold ${
            statusFilter === 'waiting'
              ? 'bg-amber-100 text-amber-800 border border-amber-200'
              : statusFilter === 'in_progress'
              ? 'bg-blue-100 text-blue-800 border border-blue-200'
              : statusFilter === 'finished'
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              : 'bg-slate-100 text-slate-800 border border-slate-200'
          }`}>
            <Filter className="w-3 h-3" />
            {statusFilter === 'waiting' && 'Waiting for Client Reply'}
            {statusFilter === 'in_progress' && 'Active / In Progress'}
            {statusFilter === 'finished' && 'Resolved / Finished'}
            {statusFilter === 'all' && 'All Issues'}
          </span>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                <th className="py-3.5 px-4">Order / Ref</th>
                <th className="py-3.5 px-4">Project</th>
                <th className="py-3.5 px-4">Issue & Reply</th>
                <th className="py-3.5 px-4">Milestone Dates (From Orders & Issues)</th>
                <th className="py-3.5 px-4">Duration Breakdown</th>
                <th className="py-3.5 px-4 text-center">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading && !refreshing ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-brand-600" />
                    Loading client issues...
                  </td>
                </tr>
              ) : issues.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-emerald-500 opacity-60" />
                    {statusFilter === 'waiting' ? 'No issues currently waiting for client reply!' : 'No client issues found matching this filter.'}
                  </td>
                </tr>
              ) : (
                issues.map((item) => {
                  const hasReply = !!item.client_reply_text;
                  const hasResumed = !!item.resumed_at || !!item.timeline?.resumed_at;
                  const hasFinished = !!item.team_finished_at || !!item.timeline?.is_completed;
                  const tl = item.timeline || {};
                  const m = tl.metrics || {};

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Order Info */}
                      <td className="py-4 px-4 align-top">
                        <div className="font-semibold text-slate-900">
                          {item.order_number}
                        </div>
                        {item.client_reference && item.client_reference !== '-' && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            Ref: {item.client_reference}
                          </div>
                        )}
                        {tl.due_in && (
                          <div className="text-[10px] font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200/60 inline-block mt-1">
                            Due In: {tl.due_in}
                          </div>
                        )}
                        {item.address && item.address !== '-' && (
                          <div className="text-[11px] text-slate-400 max-w-xs truncate mt-0.5" title={item.address}>
                            {item.address}
                          </div>
                        )}
                      </td>

                      {/* Project */}
                      <td className="py-4 px-4 align-top">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-100 text-slate-700">
                          <Building2 className="w-3.5 h-3.5 text-slate-400" />
                          {item.project_name}
                        </div>
                      </td>

                      {/* Reason & Client Reply */}
                      <td className="py-4 px-4 align-top max-w-xs">
                        <div className="font-medium text-amber-700 text-xs inline-block bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60 mb-1">
                          {item.reason}
                        </div>
                        {item.comment_text && (
                          <div className="text-xs text-slate-600 line-clamp-2 bg-slate-50/80 p-1.5 rounded border border-slate-100 mb-1.5">
                            {item.comment_text}
                          </div>
                        )}
                        {hasReply ? (
                          <div className="text-xs text-blue-700 bg-blue-50/70 p-1.5 rounded border border-blue-100">
                            <span className="font-semibold block text-[10px] text-blue-800">Reply:</span>
                            <span className="line-clamp-2">{item.client_reply_text}</span>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60 font-medium">
                            <Clock className="w-3 h-3" />
                            Awaiting client reply
                          </span>
                        )}
                      </td>

                      {/* ⏱️ Milestone Dates */}
                      <td className="py-4 px-4 align-top min-w-[200px]">
                        <div className="space-y-1.5 text-xs">
                          {/* 1. Received Time */}
                          <div className="flex items-center gap-1.5 text-slate-600">
                            <Inbox className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                            <span className="text-[11px] text-slate-400">Recv:</span>
                            <span className="font-medium text-slate-800">{formatDate(tl.received_at)}</span>
                          </div>

                          {/* 2. Issue Sent Time */}
                          <div className="flex items-center gap-1.5 text-amber-700">
                            <Clock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span className="text-[11px] text-amber-600/80">Issue:</span>
                            <span className="font-medium">{formatDate(tl.issue_time || tl.paused_at || item.comment_entered_at)}</span>
                          </div>

                          {/* 3. Fixed / Resumed Time */}
                          <div className="flex items-center gap-1.5 text-emerald-700">
                            <Play className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="text-[11px] text-emerald-600/80">Fixed:</span>
                            <span className="font-medium">
                              {tl.fixed_time || tl.resumed_at ? formatDate(tl.fixed_time || tl.resumed_at) : (hasResumed ? formatDate(item.resumed_at) : 'Not Resumed Yet')}
                            </span>
                          </div>

                          {/* 4. Delivered Time (if completed) */}
                          {tl.delivered_at && (
                            <div className="flex items-center gap-1.5 text-teal-700">
                              <CheckCircle2 className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                              <span className="text-[11px] text-teal-600/80">Deliv:</span>
                              <span className="font-medium">{formatDate(tl.delivered_at)}</span>
                            </div>
                          )}
                        </div>
                      </td>

                      {/* 📊 Duration Breakdown (Time Count) */}
                      <td className="py-4 px-4 align-top min-w-[180px]">
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center justify-between text-slate-500">
                            <span className="text-[11px]">Issue to Fixed:</span>
                            <span className="font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200/50">
                              {formatDiff(m.client_hold_minutes ?? item.comment_to_reply_diff_minutes)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-slate-500">
                            <span className="text-[11px]">Net Work Time:</span>
                            <span className="font-semibold text-teal-700 bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200/50">
                              {formatDiff(m.net_production_minutes)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-slate-400 pt-0.5 border-t border-slate-100">
                            <span className="text-[10px]">Total Elapsed:</span>
                            <span className="text-[11px] font-medium text-slate-700">{formatDiff(m.total_elapsed_minutes)}</span>
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 align-top text-center">
                        {hasFinished ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Finished
                          </span>
                        ) : hasResumed ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                            In Progress
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                            Paused
                          </span>
                        )}
                      </td>

                      {/* Action Buttons */}
                      <td className="py-4 px-4 align-top text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            onClick={() => handleOpenReply(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 text-xs font-semibold rounded-lg transition-colors border border-teal-200"
                            title="Reply directly to this issue"
                          >
                            <Send className="w-3 h-3" />
                            {hasReply ? 'Update Reply' : 'Reply'}
                          </button>

                          <Link
                            to={`/project-action/${item.project_id}/${item.order_id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-semibold rounded-lg transition-colors border border-brand-200"
                            title="View full timeline and turnaround breakdown"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Link>
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
        {totalPages > 1 && (
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Page {page} of {totalPages} ({totalCount} total issues)
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1 border border-slate-200 rounded-lg text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-3 py-1 border border-slate-200 rounded-lg text-xs font-medium hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Client Reply Modal */}
      {replyModalIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-100 relative">
            <button
              onClick={() => setReplyModalIssue(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-teal-700 font-semibold mb-1">
              <MessageSquare className="w-5 h-5" />
              <span>Reply to Order Clarification</span>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {replyModalIssue.order_number} &bull; {replyModalIssue.project_name}
            </p>

            {/* Reason & Team Comment Box */}
            <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 mb-4">
              <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-1">
                Reason: {replyModalIssue.reason}
              </div>
              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                {replyModalIssue.comment_text || 'No detailed note provided.'}
              </p>
            </div>

            {replySuccessMsg ? (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center text-emerald-800 font-medium text-sm flex items-center justify-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                {replySuccessMsg}
              </div>
            ) : (
              <form onSubmit={handleSubmitReply} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Your Instructions / Reply <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Provide your clarification, instructions, or answers here..."
                    required
                    className="w-full p-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setReplyModalIssue(null)}
                    className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingReply || !replyText.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors disabled:opacity-50"
                  >
                    {submittingReply ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Submit Reply
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
