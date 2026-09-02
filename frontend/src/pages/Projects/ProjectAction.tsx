import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, CheckCircle, Clock, PlayCircle, MessageSquare } from 'lucide-react';
import { projectService } from '../../services';

export default function ProjectAction() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form State
  const [selectedOption, setSelectedOption] = useState('');
  const [commentText, setCommentText] = useState('');
  const [clientReplyText, setClientReplyText] = useState('');

  // Timeline State from JSON
  const [trackingData, setTrackingData] = useState<any>({});

  useEffect(() => {
    if (!projectId) return;
    
    projectService.getProjectActionLog(Number(projectId))
      .then((res) => {
        if (res.data.data) {
          setSelectedOption(res.data.data.reason || '');
          // Now the tracking fields are flat on the record
          setTrackingData(res.data.data);
          setCommentText(res.data.data.comment_text || '');
          setClientReplyText(res.data.data.client_reply_text || '');
        }
      })
      .catch((err) => {
        console.error('Failed to load action log', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId]);

  const saveTrackingData = async (newTrackingData: any, newReason: string = selectedOption) => {
    if (!projectId) return;
    setSaving(true);
    try {
      await projectService.saveProjectActionLog({
        project_id: Number(projectId),
        reason: newReason,
        ...newTrackingData // Spread flat properties instead of tracking_data: {}
      });
      setTrackingData(newTrackingData);
      alert('Action logged successfully');
    } catch (error) {
      console.error('Failed to save action log', error);
      alert('Failed to save action log');
    } finally {
      setSaving(false);
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

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleString();
  };

  const formatDiff = (minutes: number | undefined) => {
    if (minutes === undefined) return '';
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}h ${m}m`;
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

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Project Timeline</h1>
            <p className="text-slate-500 text-sm mt-1">Track actions and responses for Project #{projectId}</p>
          </div>
        </div>
      </div>

      <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-300 before:to-transparent">
        
        {/* Step 1: Initial Comment */}
        <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
          <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-slate-200 text-slate-500 shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow sm:h-12 sm:w-12">
            <MessageSquare className="w-5 h-5" />
          </div>
          <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-white p-5 rounded-xl shadow border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-slate-900 text-lg">Initial Comment</h3>
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
                    <option value="option1">Missing Information</option>
                    <option value="option2">Clarification Needed</option>
                    <option value="option3">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Comment</label>
                  <textarea
                    required
                    rows={3}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={saving}
                  className="w-full py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition font-medium"
                >
                  Submit Comment
                </button>
              </form>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Reason: <span className="font-normal text-slate-600">{selectedOption}</span></p>
                <p className="text-sm font-medium text-slate-700">Comment: <span className="font-normal text-slate-600">{trackingData.comment_text}</span></p>
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
                  <textarea
                    required
                    rows={3}
                    value={clientReplyText}
                    onChange={(e) => setClientReplyText(e.target.value)}
                    placeholder="Enter client's reply..."
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                  />
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
                    Waited {formatDiff(trackingData.comment_to_reply_diff_minutes)} for reply
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
                  Started {formatDiff(trackingData.reply_to_start_diff_minutes)} after client reply
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
                  Total time taken: {formatDiff(trackingData.time_taken_to_finish_minutes)}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
