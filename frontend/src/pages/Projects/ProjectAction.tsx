import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Loader2, 
  CheckCircle, 
  Clock, 
  PlayCircle, 
  MessageSquare, 
  Play,
  Timer,
  CheckCircle2,
  Zap,
  Inbox,
  Calendar,
  Search,
  RefreshCw,
  Layers,
  ExternalLink,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { projectService } from '../../services';

export default function ProjectAction() {
  const { projectId, orderId } = useParams();
  const navigate = useNavigate();

  // Active Tab: 'single' (Order Action & Timeline) | 'monthly' (All Paused Orders Log)
  const [activeTab, setActiveTab] = useState<'single' | 'monthly'>('single');

  // -------------------------------------------------------------
  // Single Order State
  // -------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [orderInfo, setOrderInfo] = useState<any>(null);
  const [timelineData, setTimelineData] = useState<any>(null);

  // Form State
  const [selectedOption, setSelectedOption] = useState('');
  const [commentText, setCommentText] = useState('');
  const [clientReplyText, setClientReplyText] = useState('');
  const [trackingData, setTrackingData] = useState<any>({});

  // -------------------------------------------------------------
  // Monthly All Paused Orders State
  // -------------------------------------------------------------
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  });
  const [monthlySearch, setMonthlySearch] = useState('');
  const [monthlyStatusFilter, setMonthlyStatusFilter] = useState<'all' | 'waiting' | 'in_progress' | 'finished'>('all');
  const [monthlyIssues, setMonthlyIssues] = useState<any[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyPage, setMonthlyPage] = useState(1);
  const [monthlyLastPage, setMonthlyLastPage] = useState(1);
  const [monthlyTotal, setMonthlyTotal] = useState(0);
  const [monthlyStats, setMonthlyStats] = useState({
    total: 0,
    waiting: 0,
    in_progress: 0,
    finished: 0
  });

  const loadData = useCallback(() => {
    if (!projectId) return;
    setLoading(true);
    projectService.getProjectActionLog(Number(projectId), orderId ? Number(orderId) : undefined)
      .then((res) => {
        if (res.data.data) {
          setSelectedOption(res.data.data.reason || '');
          setTrackingData(res.data.data);
          setCommentText(res.data.data.comment_text || '');
          setClientReplyText(res.data.data.client_reply_text || '');
        }
        if (res.data.order) {
          setOrderInfo(res.data.order);
        }
        if (res.data.timeline) {
          setTimelineData(res.data.timeline);
        }
      })
      .catch((err) => {
        console.error('Failed to load action log', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId, orderId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Load Monthly Paused Orders
  const loadMonthlyOrders = useCallback(async () => {
    setMonthlyLoading(true);
    try {
      const res = await projectService.getClientIssuesDashboard({
        project_id: projectId ? Number(projectId) : undefined,
        month: selectedMonth,
        search: monthlySearch.trim() || undefined,
        status: monthlyStatusFilter,
        page: monthlyPage
      });

      setMonthlyIssues(res.data?.data || []);
      setMonthlyTotal(res.data?.total || 0);
      setMonthlyLastPage(res.data?.last_page || 1);
      if (res.data?.stats) {
        setMonthlyStats(res.data.stats);
      }
    } catch (err) {
      console.error('Failed to load monthly paused orders', err);
    } finally {
      setMonthlyLoading(false);
    }
  }, [projectId, selectedMonth, monthlySearch, monthlyStatusFilter, monthlyPage]);

  useEffect(() => {
    if (activeTab === 'monthly') {
      loadMonthlyOrders();
    }
  }, [activeTab, loadMonthlyOrders]);

  const saveTrackingData = async (newTrackingData: any, newReason: string = selectedOption) => {
    if (!projectId) return;
    setSaving(true);
    try {
      const payload: any = {
        project_id: Number(projectId),
        order_id: Number(orderId || 0),
        reason: newReason,
        ...newTrackingData
      };
      const res = await projectService.saveProjectActionLog(payload);
      setTrackingData(newTrackingData);
      if (res.data.order) {
        setOrderInfo(res.data.order);
      }
      if (res.data.timeline) {
        setTimelineData(res.data.timeline);
      }
      alert('Action logged successfully. Order paused for client issue.');
      loadData();
    } catch (error: any) {
      console.error('Failed to save action log', error);
      const serverMsg = error?.response?.data?.message || error?.message || 'Failed to save action log';
      alert(serverMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleResumeOrder = async () => {
    if (!projectId || !orderId) return;
    setResuming(true);
    try {
      const res = await projectService.resumeClientIssue(Number(projectId), Number(orderId));
      if (res.data.order) {
        setOrderInfo(res.data.order);
      }
      if (res.data.timeline) {
        setTimelineData(res.data.timeline);
      }
      alert('Order successfully resumed back to workflow.');
      loadData();
    } catch (err: any) {
      console.error('Failed to resume order', err);
      const serverMsg = err?.response?.data?.message || err?.message || 'Failed to resume order';
      alert(serverMsg);
    } finally {
      setResuming(false);
    }
  };

  const handleInitialSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    saveTrackingData({
      ...trackingData,
      comment_text: commentText,
      comment_entered_at: now
    });
  };

  const handleClientReply = (e: React.FormEvent) => {
    e.preventDefault();
    const now = new Date().toISOString();
    let diffMinutes = 0;
    if (trackingData.comment_entered_at) {
      const start = new Date(trackingData.comment_entered_at).getTime();
      const end = new Date(now).getTime();
      diffMinutes = Math.round((end - start) / 60000);
    }
    
    saveTrackingData({
      ...trackingData,
      client_reply_text: clientReplyText,
      client_replied_at: now,
      comment_to_reply_diff_minutes: diffMinutes
    });
  };

  const handleStartWork = () => {
    const now = new Date().toISOString();
    let diffMinutes = 0;
    if (trackingData.client_replied_at) {
      const start = new Date(trackingData.client_replied_at).getTime();
      const end = new Date(now).getTime();
      diffMinutes = Math.round((end - start) / 60000);
    }

    saveTrackingData({
      ...trackingData,
      team_started_at: now,
      reply_to_start_diff_minutes: diffMinutes
    });
  };

  const handleFinishWork = () => {
    const now = new Date().toISOString();
    let diffMinutes = 0;
    if (trackingData.team_started_at) {
      const start = new Date(trackingData.team_started_at).getTime();
      const end = new Date(now).getTime();
      diffMinutes = Math.round((end - start) / 60000);
    }

    saveTrackingData({
      ...trackingData,
      team_finished_at: now,
      time_taken_to_finish_minutes: diffMinutes
    });
  };

  const formatDate = (dateString: string | undefined | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatShortDate = (dateString: string | undefined | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatHumanDuration = (minutes: number | undefined | null) => {
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

  if (loading && activeTab === 'single') {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
      </div>
    );
  }

  const hasComment = !!trackingData.comment_entered_at;
  const hasClientReply = !!trackingData.client_replied_at;
  const hasStarted = !!trackingData.team_started_at;
  const hasFinished = !!trackingData.team_finished_at;

  const metrics = timelineData?.metrics || {};
  const orderDueIn = orderInfo?.due_in || timelineData?.due_in;

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      
      {/* ── Top Header with Benchmark Suite Theme ── */}
      <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200/60"
            title="Go Back"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                {orderInfo?.order_number ? `Order ${orderInfo.order_number}` : `Project #${projectId}`}
              </h1>
              {orderInfo?.workflow_state === 'CLIENT_ISSUE' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                  Paused (Client Issue)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Active Workflow
                </span>
              )}
            </div>
            <p className="text-slate-500 text-xs sm:text-sm mt-1">
              Project #{projectId} {orderId ? `• Order ID: #${orderId}` : ''}
              {orderInfo?.client_reference && ` • Ref: ${orderInfo.client_reference}`}
              {orderInfo?.address && ` • ${orderInfo.address}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {orderInfo?.workflow_state === 'CLIENT_ISSUE' && (
            <button
              onClick={handleResumeOrder}
              disabled={resuming}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
            >
              {resuming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4 fill-white" />
              )}
              Resume Order to Workflow
            </button>
          )}
        </div>
      </div>

      {/* ── Main Tab Navigation Bar ── */}
      <div className="flex items-center gap-2 bg-slate-100/90 p-1.5 rounded-xl border border-slate-200/80">
        <button
          onClick={() => setActiveTab('single')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'single'
              ? 'bg-white text-brand-700 shadow-sm border border-slate-200/60'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
          }`}
        >
          <Timer className="w-4 h-4 text-brand-600" />
          <span>Current Order Action & Timeline</span>
        </button>

        <button
          onClick={() => setActiveTab('monthly')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'monthly'
              ? 'bg-white text-brand-700 shadow-sm border border-slate-200/60'
              : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
          }`}
        >
          <Layers className="w-4 h-4 text-brand-600" />
          <span>All Paused Orders (Monthly View)</span>
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* TAB 1: CURRENT ORDER ACTION & TIMELINE                    */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === 'single' && (
        <div className="space-y-6">
          
          {/* 📊 Key Timelines & Duration Breakdown Card (Benchmark Portal Theme) */}
          <div className="bg-white rounded-2xl p-6 shadow-xs border border-slate-200/90">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 mb-5 gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-brand-50 text-brand-700 rounded-xl border border-brand-100">
                  <Timer className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Order Milestones & Timeline Dates</h2>
                  <p className="text-xs text-slate-500">Exact date & times from orders and client issues tables</p>
                </div>
              </div>

              {orderDueIn && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-xl text-xs font-semibold">
                  <Clock className="w-3.5 h-3.5 text-blue-600" />
                  <span>Due In: {orderDueIn}</span>
                </div>
              )}
            </div>

            {/* 4 Key Milestone Timestamps */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              
              {/* 1. Received Time */}
              <div className="bg-slate-50/80 p-4 rounded-xl border border-slate-200">
                <div className="flex items-center gap-1.5 text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">
                  <Inbox className="w-4 h-4 text-blue-600" />
                  1. Received Time
                </div>
                <p className="text-sm font-bold text-slate-900">
                  {formatDate(timelineData?.received_at || orderInfo?.received_at)}
                </p>
                <span className="text-[11px] text-blue-700 font-medium">Orders Table</span>
              </div>

              {/* 2. Issue Sent Time (Paused) */}
              <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200">
                <div className="flex items-center gap-1.5 text-amber-800 text-xs font-bold uppercase tracking-wider mb-1">
                  <Clock className="w-4 h-4 text-amber-600" />
                  2. Issue Sent (Paused)
                </div>
                <p className="text-sm font-bold text-amber-900">
                  {formatDate(timelineData?.issue_time || timelineData?.paused_at || trackingData?.comment_entered_at)}
                </p>
                <span className="text-[11px] text-amber-700 font-medium">
                  Client Issues Table {selectedOption ? `(${selectedOption})` : ''}
                </span>
              </div>

              {/* 3. Fixed / Resumed Time */}
              <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-200">
                <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-bold uppercase tracking-wider mb-1">
                  <Play className="w-4 h-4 text-emerald-600" />
                  3. Fixed / Resumed Time
                </div>
                <p className="text-sm font-bold text-emerald-900">
                  {formatDate(timelineData?.fixed_time || timelineData?.resumed_at || trackingData?.resumed_at)}
                </p>
                <span className="text-[11px] text-emerald-700 font-medium">Client Issues Table</span>
              </div>

              {/* 4. Completed / Delivered Time */}
              <div className="bg-teal-50/50 p-4 rounded-xl border border-teal-200">
                <div className="flex items-center gap-1.5 text-teal-800 text-xs font-bold uppercase tracking-wider mb-1">
                  <CheckCircle2 className="w-4 h-4 text-teal-600" />
                  4. Delivered Time
                </div>
                <p className="text-sm font-bold text-teal-900">
                  {formatDate(timelineData?.completed_at || timelineData?.delivered_at || orderInfo?.delivered_at || orderInfo?.completed_at)}
                </p>
                <span className="text-[11px] text-teal-700 font-medium">
                  {timelineData?.is_completed ? 'Delivered (Orders Table)' : 'Processing in Queue'}
                </span>
              </div>
            </div>

            {/* ⏱️ Duration Interval Counts */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-4 border-t border-slate-100">
              
              <div className="bg-amber-50/70 p-3.5 rounded-xl border border-amber-200 flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-amber-800 font-bold uppercase tracking-wider block">
                    Issue to Fixed Duration
                  </span>
                  <span className="text-lg font-bold text-amber-900">
                    {formatHumanDuration(metrics.client_hold_minutes)}
                  </span>
                  <span className="text-[10px] text-amber-700 block">Total Client Hold Time</span>
                </div>
                <Clock className="w-5 h-5 text-amber-600" />
              </div>

              <div className="bg-emerald-50/70 p-3.5 rounded-xl border border-emerald-200 flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-emerald-800 font-bold uppercase tracking-wider block">
                    Time to Deliver After Resume
                  </span>
                  <span className="text-lg font-bold text-emerald-900">
                    {formatHumanDuration(metrics.post_resume_work_minutes)}
                  </span>
                  <span className="text-[10px] text-emerald-700 block">Post-Resume Team Time</span>
                </div>
                <Zap className="w-5 h-5 text-emerald-600" />
              </div>

              <div className="bg-brand-50/70 p-3.5 rounded-xl border border-brand-200 flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-brand-800 font-bold uppercase tracking-wider block">
                    Net Benchmark Work Time
                  </span>
                  <span className="text-lg font-bold text-brand-900">
                    {formatHumanDuration(metrics.net_production_minutes)}
                  </span>
                  <span className="text-[10px] text-brand-700 block">Total minus Client Delay</span>
                </div>
                <Timer className="w-5 h-5 text-brand-600" />
              </div>

            </div>
          </div>

          {/* Action Workflow Timeline Steps */}
          <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-slate-200 before:via-brand-200 before:to-slate-200">
            
            {/* Step 1: Initial Comment */}
            <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
              <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-white bg-amber-500 text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm sm:h-12 sm:w-12">
                <MessageSquare className="w-5 h-5" />
              </div>
              <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-2xl shadow-xs border border-slate-200">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-slate-900 text-base">Initial Comment (Issue Sent)</h3>
                  {hasComment && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{formatDate(trackingData.comment_entered_at)}</span>}
                </div>
                
                {!hasComment ? (
                  <form onSubmit={handleInitialSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Reason Option</label>
                      <select
                        required
                        value={selectedOption}
                        onChange={(e) => setSelectedOption(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                      >
                        <option value="">-- Choose an option --</option>
                        <option value="Missing Information">Missing Information</option>
                        <option value="Clarification Needed">Clarification Needed</option>
                        <option value="Wrong Files / Missing Assets">Wrong Files / Missing Assets</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Comment</label>
                      <textarea
                        required
                        rows={3}
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Describe the issue with this order..."
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={saving}
                      className="w-full py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl transition font-semibold text-sm shadow-xs"
                    >
                      {saving ? 'Saving...' : 'Submit Comment & Pause Order'}
                    </button>
                  </form>
                ) : (
                  <div className="space-y-3">
                    <div className="text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-800 rounded-lg inline-block border border-amber-200">
                      {selectedOption || trackingData.reason}
                    </div>
                    <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">{trackingData.comment_text}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Step 2: Client Reply */}
            {hasComment && (
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-white bg-blue-600 text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm sm:h-12 sm:w-12">
                  <MessageSquare className="w-5 h-5" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-2xl shadow-xs border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-slate-900 text-base">Client Reply</h3>
                    {hasClientReply && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{formatDate(trackingData.client_replied_at)}</span>}
                  </div>
                  
                  {!hasClientReply ? (
                    <form onSubmit={handleClientReply} className="space-y-4">
                      <div>
                        <textarea
                          required
                          rows={3}
                          value={clientReplyText}
                          onChange={(e) => setClientReplyText(e.target.value)}
                          placeholder="Enter client's reply..."
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition font-semibold text-sm shadow-xs"
                      >
                        {saving ? 'Saving...' : 'Submit Client Reply'}
                      </button>
                    </form>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-xl border border-slate-100">{trackingData.client_reply_text}</p>
                      <div className="flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg inline-flex border border-amber-200">
                        <Clock className="w-4 h-4" />
                        Waited {formatHumanDuration(trackingData.comment_to_reply_diff_minutes)} for reply
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Team Started */}
            {hasClientReply && (
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-white bg-amber-500 text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm sm:h-12 sm:w-12">
                  <PlayCircle className="w-5 h-5" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-2xl shadow-xs border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-slate-900 text-base">Team Started Work</h3>
                    {hasStarted && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{formatDate(trackingData.team_started_at)}</span>}
                  </div>
                  
                  {!hasStarted ? (
                    <button
                      onClick={handleStartWork}
                      disabled={saving}
                      className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl transition font-semibold text-sm shadow-xs"
                    >
                      Start Work Now
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-xs font-medium text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg inline-flex border border-blue-200">
                      <Clock className="w-4 h-4" />
                      Started {formatHumanDuration(trackingData.reply_to_start_diff_minutes)} after client reply
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 4: Team Finished */}
            {hasStarted && (
              <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
                <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-white bg-emerald-600 text-white shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm sm:h-12 sm:w-12">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-2xl shadow-xs border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-slate-900 text-base">Team Finished</h3>
                    {hasFinished && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">{formatDate(trackingData.team_finished_at)}</span>}
                  </div>
                  
                  {!hasFinished ? (
                    <button
                      onClick={handleFinishWork}
                      disabled={saving}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition font-semibold text-sm shadow-xs"
                    >
                      Mark as Finished
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg inline-flex border border-emerald-200">
                      <Clock className="w-4 h-4" />
                      Total time taken: {formatHumanDuration(trackingData.time_taken_to_finish_minutes)}
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* TAB 2: ALL PAUSED ORDERS (MONTHLY VIEW)                   */}
      {/* ══════════════════════════════════════════════════════════ */}
      {activeTab === 'monthly' && (
        <div className="space-y-6">
          
          {/* Controls Bar: Month Picker, Status Filters & Search */}
          <div className="bg-white p-5 rounded-2xl shadow-xs border border-slate-200/90 space-y-4">
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              
              <div className="flex items-center gap-3 flex-wrap">
                {/* Month Picker */}
                <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <Calendar className="w-4 h-4 text-brand-600" />
                  <span className="text-xs font-semibold text-slate-700">Month:</span>
                  <input
                    type="month"
                    value={selectedMonth}
                    onChange={(e) => {
                      setSelectedMonth(e.target.value);
                      setMonthlyPage(1);
                    }}
                    className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none cursor-pointer"
                  />
                </div>

                {/* Status Filter Tabs */}
                <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                  {[
                    { key: 'all', label: 'All', count: monthlyStats.total },
                    { key: 'waiting', label: 'Waiting/Hold', count: monthlyStats.waiting },
                    { key: 'in_progress', label: 'Resumed', count: monthlyStats.in_progress },
                    { key: 'finished', label: 'Delivered', count: monthlyStats.finished },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      onClick={() => {
                        setMonthlyStatusFilter(tab.key as any);
                        setMonthlyPage(1);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        monthlyStatusFilter === tab.key
                          ? 'bg-white text-brand-700 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label} <span className="opacity-75">({tab.count})</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative flex-1 sm:w-64">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search reason or text..."
                    value={monthlySearch}
                    onChange={(e) => setMonthlySearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        setMonthlyPage(1);
                        loadMonthlyOrders();
                      }
                    }}
                    className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  />
                </div>

                <button
                  onClick={() => loadMonthlyOrders()}
                  disabled={monthlyLoading}
                  className="p-2 bg-slate-50 hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-200 transition-colors"
                  title="Refresh List"
                >
                  <RefreshCw className={`w-4 h-4 ${monthlyLoading ? 'animate-spin text-brand-600' : ''}`} />
                </button>
              </div>

            </div>

            {/* KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">Total Paused</span>
                <span className="text-xl font-bold text-slate-900">{monthlyStats.total}</span>
              </div>
              <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200">
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider block">Waiting on Client</span>
                <span className="text-xl font-bold text-amber-900">{monthlyStats.waiting}</span>
              </div>
              <div className="p-3.5 bg-blue-50 rounded-xl border border-blue-200">
                <span className="text-[11px] font-bold text-blue-700 uppercase tracking-wider block">Resumed / Working</span>
                <span className="text-xl font-bold text-blue-900">{monthlyStats.in_progress}</span>
              </div>
              <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-200">
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider block">Delivered / Done</span>
                <span className="text-xl font-bold text-emerald-900">{monthlyStats.finished}</span>
              </div>
            </div>

          </div>

          {/* 📋 Monthly Paused Orders Table */}
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200/90 overflow-hidden">
            
            {monthlyLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-brand-600 animate-spin" />
                <span className="ml-2 text-sm text-slate-500">Loading month's paused orders...</span>
              </div>
            ) : monthlyIssues.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Inbox className="w-12 h-12 text-slate-300 mb-2" />
                <div className="text-sm font-semibold text-slate-700">No paused orders found for this month</div>
                <div className="text-xs text-slate-500 mt-1">Try selecting a different month or clearing filters.</div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-3 py-3">Order & Ref</th>
                      <th className="px-3 py-3">Project / Address</th>
                      <th className="px-2.5 py-3 text-center">Status</th>
                      <th className="px-2.5 py-3">1. Received</th>
                      <th className="px-2.5 py-3">Due In</th>
                      <th className="px-2.5 py-3 text-amber-800">2. Paused</th>
                      <th className="px-2.5 py-3 text-emerald-800">3. Resumed</th>
                      <th className="px-2.5 py-3 text-teal-800">4. Delivered</th>
                      <th className="px-2.5 py-3 text-amber-800 bg-amber-50/50">Hold Time</th>
                      <th className="px-2.5 py-3 text-emerald-800 bg-emerald-50/50">After Resume</th>
                      <th className="px-2.5 py-3 text-brand-800 bg-brand-50/50">Net Work</th>
                      <th className="px-2.5 py-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthlyIssues.map((item) => {
                      const itemMetrics = item.metrics || item.timeline?.metrics || {};
                      const isDelivered = item.is_delivered;

                      return (
                        <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                          
                          {/* Order Number & Ref */}
                          <td className="px-3 py-3 font-semibold text-slate-900 whitespace-nowrap">
                            <div className="font-bold text-brand-700">{item.order_number}</div>
                            {item.client_reference && item.client_reference !== '-' && (
                              <div className="text-[10px] text-slate-500">Ref: {item.client_reference}</div>
                            )}
                          </td>

                          {/* Project & Address */}
                          <td className="px-3 py-3 max-w-[200px]">
                            <div className="font-semibold text-slate-800 truncate">{item.project_name}</div>
                            <div className="text-[10px] text-slate-500 truncate" title={item.address}>{item.address || '-'}</div>
                          </td>

                          {/* Workflow / Delivery Status */}
                          <td className="px-2.5 py-3 text-center whitespace-nowrap">
                            {isDelivered ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3" />
                                Delivered
                              </span>
                            ) : item.resumed_at ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                                <Play className="w-3 h-3" />
                                In Production
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                Paused
                              </span>
                            )}
                          </td>

                          {/* 1. Received Time */}
                          <td className="px-2.5 py-3 text-slate-600 whitespace-nowrap font-medium">
                            {formatShortDate(item.received_at)}
                          </td>

                          {/* Due In */}
                          <td className="px-2.5 py-3 text-slate-600 whitespace-nowrap">
                            {item.due_in || '-'}
                          </td>

                          {/* 2. Paused Time */}
                          <td className="px-2.5 py-3 text-amber-900 whitespace-nowrap font-medium">
                            {formatShortDate(item.paused_at || item.comment_entered_at)}
                            <div className="text-[10px] text-amber-700 truncate max-w-[100px]" title={item.reason}>{item.reason}</div>
                          </td>

                          {/* 3. Resumed Time */}
                          <td className="px-2.5 py-3 text-emerald-900 whitespace-nowrap font-medium">
                            {formatShortDate(item.resumed_at)}
                          </td>

                          {/* 4. Delivered Time */}
                          <td className="px-2.5 py-3 text-teal-900 whitespace-nowrap font-medium">
                            {formatShortDate(item.delivered_at || (isDelivered ? item.updated_at : null))}
                          </td>

                          {/* Hold Duration */}
                          <td className="px-2.5 py-3 text-amber-900 bg-amber-50/40 whitespace-nowrap font-bold">
                            {formatHumanDuration(itemMetrics.client_hold_minutes ?? item.pause_to_resume_diff_minutes)}
                          </td>

                          {/* After Resume Duration */}
                          <td className="px-2.5 py-3 text-emerald-900 bg-emerald-50/40 whitespace-nowrap font-bold">
                            {formatHumanDuration(itemMetrics.post_resume_work_minutes)}
                          </td>

                          {/* Net Work Duration */}
                          <td className="px-2.5 py-3 text-brand-900 bg-brand-50/40 whitespace-nowrap font-bold">
                            {formatHumanDuration(itemMetrics.net_production_minutes)}
                          </td>

                          {/* Action Button */}
                          <td className="px-2.5 py-3 text-center whitespace-nowrap">
                            <button
                              onClick={() => {
                                navigate(`/project-action/${item.project_id}/${item.order_id}`);
                                setActiveTab('single');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 transition-colors shadow-xs"
                            >
                              <span>View</span>
                              <ExternalLink className="w-3 h-3" />
                            </button>
                          </td>

                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination */}
            {monthlyLastPage > 1 && (
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Showing page {monthlyPage} of {monthlyLastPage} ({monthlyTotal} total records)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setMonthlyPage(prev => Math.max(1, prev - 1))}
                    disabled={monthlyPage <= 1 || monthlyLoading}
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-50 hover:bg-slate-100 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-xs font-bold text-slate-700">{monthlyPage}</span>
                  <button
                    onClick={() => setMonthlyPage(prev => Math.min(monthlyLastPage, prev + 1))}
                    disabled={monthlyPage >= monthlyLastPage || monthlyLoading}
                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:opacity-50 hover:bg-slate-100 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

          </div>

        </div>
      )}

    </div>
  );
}
