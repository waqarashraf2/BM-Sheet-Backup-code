import React, { useState, useEffect } from 'react';
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
  Inbox
} from 'lucide-react';
import { projectService } from '../../services';

export default function ProjectAction() {
  const { projectId, orderId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [orderInfo, setOrderInfo] = useState<any>(null);
  const [timelineData, setTimelineData] = useState<any>(null);

  // Form State
  const [selectedOption, setSelectedOption] = useState('');
  const [commentText, setCommentText] = useState('');
  const [clientReplyText, setClientReplyText] = useState('');

  // Timeline State from JSON
  const [trackingData, setTrackingData] = useState<any>({});

  const loadData = () => {
    if (!projectId) return;
    
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
  };

  useEffect(() => {
    loadData();
  }, [projectId, orderId]);

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

  const formatHumanDuration = (minutes: number | undefined | null) => {
    if (minutes === undefined || minutes === null) return '-';
    if (minutes < 60) return `${minutes} min`;
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const mins = minutes % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0 && days === 0) parts.push(`${mins}m`);
    return parts.join(' ') || `${minutes}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
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
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">
                {orderInfo?.order_number ? `Order ${orderInfo.order_number}` : `Project #${projectId}`}
              </h1>
              {orderInfo?.workflow_state === 'CLIENT_ISSUE' ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200">
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
            <p className="text-slate-500 text-sm mt-1">
              Project #{projectId} {orderId ? `• Order ID: #${orderId}` : ''}
              {orderInfo?.client_reference && ` • Ref: ${orderInfo.client_reference}`}
              {orderInfo?.address && ` • ${orderInfo.address}`}
            </p>
          </div>
        </div>

        {orderInfo?.workflow_state === 'CLIENT_ISSUE' && (
          <button
            onClick={handleResumeOrder}
            disabled={resuming}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
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

      {/* 📊 Key Timelines & Duration Breakdown Analytics Card */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl p-6 shadow-xl border border-slate-700/60">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-700/80 mb-5 gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-teal-500/20 text-teal-400 rounded-xl border border-teal-500/30">
              <Timer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">Order Milestones & Timeline Dates</h2>
              <p className="text-xs text-slate-400">Exact date & times from orders and client issues tables</p>
            </div>
          </div>

          {orderDueIn && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-xl text-xs font-semibold">
              <Clock className="w-3.5 h-3.5" />
              <span>Due In: {orderDueIn}</span>
            </div>
          )}
        </div>

        {/* 4 Key Milestone Timestamps */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {/* 1. Received Time (Orders table) */}
          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">
              <Inbox className="w-3.5 h-3.5 text-blue-400" />
              1. Received Time
            </div>
            <p className="text-sm font-bold text-white">
              {formatDate(timelineData?.received_at || orderInfo?.received_at)}
            </p>
            <span className="text-[11px] text-blue-400/90 font-medium">Orders Table</span>
          </div>

          {/* 2. Issue Sent Time (Client Issues table) */}
          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              2. Issue Sent (Paused)
            </div>
            <p className="text-sm font-bold text-amber-300">
              {formatDate(timelineData?.issue_time || timelineData?.paused_at || trackingData?.comment_entered_at)}
            </p>
            <span className="text-[11px] text-amber-400/90 font-medium">
              Client Issues Table {selectedOption ? `(${selectedOption})` : ''}
            </span>
          </div>

          {/* 3. Fixed / Resumed Time (Client Issues table) */}
          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              3. Fixed / Resumed Time
            </div>
            <p className="text-sm font-bold text-emerald-300">
              {formatDate(timelineData?.fixed_time || timelineData?.resumed_at || trackingData?.resumed_at)}
            </p>
            <span className="text-[11px] text-emerald-400/90 font-medium">Client Issues Table</span>
          </div>

          {/* 4. Completed / Delivered Time (Orders table) */}
          <div className="bg-slate-800/80 p-4 rounded-xl border border-slate-700">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-semibold uppercase tracking-wider mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-teal-400" />
              4. Delivered Time
            </div>
            <p className="text-sm font-bold text-teal-300">
              {formatDate(timelineData?.completed_at || timelineData?.delivered_at || orderInfo?.delivered_at || orderInfo?.completed_at)}
            </p>
            <span className="text-[11px] text-teal-400/90 font-medium">
              {timelineData?.is_completed ? 'Delivered (Orders Table)' : 'Processing in Queue'}
            </span>
          </div>
        </div>

        {/* ⏱️ Duration Interval Counts */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-slate-700/80">
          <div className="bg-amber-950/20 p-3.5 rounded-xl border border-amber-500/30 flex items-center justify-between">
            <div>
              <span className="text-[11px] text-amber-400 font-medium uppercase tracking-wider block">Issue to Fixed Duration</span>
              <span className="text-lg font-bold text-amber-300">{formatHumanDuration(metrics.client_hold_minutes)}</span>
            </div>
            <Clock className="w-5 h-5 text-amber-400" />
          </div>

          <div className="bg-emerald-950/20 p-3.5 rounded-xl border border-emerald-500/30 flex items-center justify-between">
            <div>
              <span className="text-[11px] text-emerald-400 font-medium uppercase tracking-wider block">Time to Deliver After Resume</span>
              <span className="text-lg font-bold text-emerald-300">{formatHumanDuration(metrics.post_resume_work_minutes)}</span>
            </div>
            <Zap className="w-5 h-5 text-emerald-400" />
          </div>

          <div className="bg-teal-950/20 p-3.5 rounded-xl border border-teal-500/30 flex items-center justify-between">
            <div>
              <span className="text-[11px] text-teal-400 font-medium uppercase tracking-wider block">Net Benchmark Work Time</span>
              <span className="text-lg font-bold text-teal-300">{formatHumanDuration(metrics.net_production_minutes)}</span>
            </div>
            <Timer className="w-5 h-5 text-teal-400" />
          </div>
        </div>
      </div>

      {/* Action Workflow Timeline */}
      <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
        
        {/* Step 1: Initial Comment */}
        <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
          <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-200 text-slate-500 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow sm:h-12 sm:w-12">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-xl shadow border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900 text-lg">Initial Comment (Issue Sent)</h3>
              {hasComment && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">{formatDate(trackingData.comment_entered_at)}</span>}
            </div>
            
            {!hasComment ? (
              <form onSubmit={handleInitialSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Reason Option</label>
                  <select
                    required
                    value={selectedOption}
                    onChange={(e) => setSelectedOption(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  >
                    <option value="">-- Choose an option --</option>
                    <option value="Missing Information">Missing Information</option>
                    <option value="Clarification Needed">Clarification Needed</option>
                    <option value="Wrong Files / Missing Assets">Wrong Files / Missing Assets</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Comment</label>
                  <textarea
                    required
                    rows={3}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Describe the issue with this order..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition font-medium"
                >
                  Submit Comment & Pause Order
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="text-xs font-semibold px-2.5 py-1 bg-amber-50 text-amber-800 rounded inline-block border border-amber-200/60">
                  {selectedOption || trackingData.reason}
                </div>
                <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">{trackingData.comment_text}</p>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Client Reply */}
        {hasComment && (
          <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-blue-100 text-blue-600 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow sm:h-12 sm:w-12">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-xl shadow border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900 text-lg">Client Reply</h3>
                {hasClientReply && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">{formatDate(trackingData.client_replied_at)}</span>}
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
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
                  >
                    Submit Client Reply
                  </button>
                </form>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100">{trackingData.client_reply_text}</p>
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-600 bg-amber-50 px-3 py-2 rounded-lg inline-flex border border-amber-100">
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
            <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-amber-100 text-amber-600 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow sm:h-12 sm:w-12">
              <PlayCircle className="w-5 h-5" />
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-xl shadow border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900 text-lg">Team Started Work</h3>
                {hasStarted && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">{formatDate(trackingData.team_started_at)}</span>}
              </div>
              
              {!hasStarted ? (
                <button
                  onClick={handleStartWork}
                  disabled={saving}
                  className="w-full py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition font-medium"
                >
                  Start Work Now
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs font-medium text-blue-600 bg-blue-50 px-3 py-2 rounded-lg inline-flex border border-blue-100">
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
            <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-green-100 text-green-600 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow sm:h-12 sm:w-12">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-xl shadow border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-900 text-lg">Team Finished</h3>
                {hasFinished && <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">{formatDate(trackingData.team_finished_at)}</span>}
              </div>
              
              {!hasFinished ? (
                <button
                  onClick={handleFinishWork}
                  disabled={saving}
                  className="w-full py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium"
                >
                  Mark as Finished
                </button>
              ) : (
                <div className="flex items-center gap-2 text-xs font-medium text-green-600 bg-green-50 px-3 py-2 rounded-lg inline-flex border border-green-100">
                  <Clock className="w-4 h-4" />
                  Total time taken: {formatHumanDuration(trackingData.time_taken_to_finish_minutes)}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
