import { useState, useEffect, useCallback } from 'react';
import { X, CheckCircle, RotateCcw, AlertTriangle, Loader2, Clock, Flag, HelpCircle, FileText, MessageSquare, Paperclip, ExternalLink, Play, Pause } from 'lucide-react';
import { workflowService } from '../services';
import type { Order, WorkItem } from '../types';
import { REJECTION_CODES } from '../types';
import { getLatestStageArea } from '../utils/workItemArea';

interface CheckerWorkFormProps {
  order: Order;
  onComplete: () => void;
  onClose: () => void;
}

interface OrderDetails {
  supervisor_notes: string | null;
  attachments: Array<{ name: string; url: string; type: string }>;
  help_requests: any[];
  issue_flags: any[];
  current_time_seconds: number;
  timer_running: boolean;
  work_items?: WorkItem[];
}

export default function CheckerWorkForm({ order, onComplete, onClose }: CheckerWorkFormProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCode, setRejectCode] = useState('');

  // Timer state
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [activeTab, setActiveTab] = useState<'form' | 'notes' | 'attachments' | 'history'>('form');

  // Flag/Help modals
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [flagType, setFlagType] = useState('');
  const [flagDescription, setFlagDescription] = useState('');
  const [flagSeverity, setFlagSeverity] = useState('medium');
  const [helpQuestion, setHelpQuestion] = useState('');

  // Drawer's entered values (from order metadata)
  const drawerData = (order.metadata || {}) as Record<string, string>;
  const initialAreaValue = String(drawerData.enter_area ?? drawerData.area ?? '');

  // Checker verification state
  const [verifyData, setVerifyData] = useState({
    template: '---',
    address: '---',
    wall_thickness: '---',
    structure: '---',
    door: '---',
    window: '---',
    label_dimension: '---',
    final_files: '---',
    plan_rotation: '---',
    area: '---',
    north: '---',
    site_plan: '---',
  });

  // Drawer mistake box
  const [mistakeBox, setMistakeBox] = useState('');
  const [editableArea, setEditableArea] = useState(initialAreaValue);

  // Load order details
  const loadOrderDetails = useCallback(async () => {
    try {
      const res = await workflowService.orderFullDetails(order.id);
      setOrderDetails(res.data);
      setElapsedSeconds(Math.max(0, Math.floor(res.data.current_time_seconds)));
      setTimerRunning(res.data.timer_running);

      const drawerArea = getLatestStageArea(res.data.work_items ?? res.data.order?.work_items, 'DRAW');
      if (drawerArea) {
        setEditableArea(drawerArea);
      }
    } catch (e) {
      console.error('Failed to load order details:', e);
    }
  }, [order.id]);

  useEffect(() => {
    loadOrderDetails();
  }, [loadOrderDetails]);

  // Timer tick
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (timerRunning) {
      interval = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [timerRunning]);

  const formatTime = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleToggleTimer = async () => {
    try {
      if (timerRunning) {
        await workflowService.stopTimer(order.id);
        setTimerRunning(false);
      } else {
        await workflowService.startTimer(order.id);
        setTimerRunning(true);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to toggle timer');
    }
  };

  const handleVerifyChange = (field: string, value: string) => {
    setVerifyData(prev => ({ ...prev, [field]: value }));
  };

  const handleCheckerDone = async () => {
    // Validation: Check if all verification fields are checked (allow some flexibility)
    const requiredFields = [
      { key: 'template', label: 'Template' },
      { key: 'address', label: 'Address' },
    ];

    const uncheckedRequired = requiredFields.filter(field => {
      const value = verifyData[field.key as keyof typeof verifyData];
      return !value || value === '---';
    });

    if (uncheckedRequired.length > 0) {
      setError(`Please verify essential fields: ${uncheckedRequired.map(f => f.label).join(', ')}`);
      return;
    }

    // Check if any field has issues
    const hasWrong = Object.values(verifyData).some(v => v === 'Wrong' || v === 'Missing');

    if (hasWrong && !mistakeBox.trim()) {
      setError('Please document drawer mistakes in the Mistake Box');
      return;
    }

    // Warn about unverified optional fields but allow submission
    const optionalFields = [
      { key: 'wall_thickness', label: 'Wall Thickness' },
      { key: 'structure', label: 'Structure' },
      { key: 'door', label: 'Door' },
      { key: 'window', label: 'Window' },
      { key: 'label_dimension', label: 'Label / Dimension' },
      { key: 'final_files', label: 'Final Files' },
      { key: 'plan_rotation', label: 'Plan Rotation' },
      { key: 'area', label: 'Area' },
      { key: 'north', label: 'North' },
      { key: 'site_plan', label: 'Site Plan' },
    ];

    const unverifiedOptional = optionalFields.filter(field => {
      const value = verifyData[field.key as keyof typeof verifyData];
      return !value || value === '---';
    });

    if (unverifiedOptional.length > 0) {
      const proceed = window.confirm(
        `Some fields are not verified: ${unverifiedOptional.map(f => f.label).join(', ')}. Do you want to proceed with submission?`
      );
      if (!proceed) return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const comment = mistakeBox
        ? `Checker Notes: ${mistakeBox}${editableArea.trim() ? `\nArea: ${editableArea.trim()}` : ''}`
        : `Checked and approved${editableArea.trim() ? `\nArea: ${editableArea.trim()}` : ''}`;
      await workflowService.submitWork(order.id, comment);
      onComplete();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to submit. Please try again.');
      // Allow retry on error - don't disable the form permanently
      console.error('Submission error:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReSend = async () => {
    if (!rejectReason || !rejectCode) {
      setError('Please provide rejection reason and code');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await workflowService.rejectOrder(order.id, rejectReason, rejectCode);
      setShowRejectModal(false);
      onComplete();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to reject order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFlagIssue = async () => {
    if (!flagType || !flagDescription) {
      setError('Please fill in all flag details');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await workflowService.flagIssue(order.id, flagType, flagDescription, flagSeverity);
      setSuccess('Issue flagged successfully');
      setShowFlagModal(false);
      setFlagType('');
      setFlagDescription('');
      loadOrderDetails();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to flag issue');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestHelp = async () => {
    if (!helpQuestion) {
      setError('Please enter your question');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await workflowService.requestHelp(order.id, helpQuestion);
      setSuccess('Help request submitted');
      setShowHelpModal(false);
      setHelpQuestion('');
      loadOrderDetails();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to submit help request');
    } finally {
      setSubmitting(false);
    }
  };

  const projectName = order.project?.name || 'Project';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden animate-fade-in my-4">
        {/* Header */}
        <div className="bg-brand-500 px-6 py-4 text-white">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 hover:bg-brand-600 rounded-lg transition-colors"
            title="Close"
            aria-label="Close form"
          >
            <X className="h-5 w-5" />
          </button>
          <div className="flex items-center justify-between pr-10">
            <div>
              <h2 className="text-lg font-bold">Check Order - {projectName}</h2>
              <p className="text-brand-100 text-sm mt-1">Order: {order.order_number}</p>
            </div>
            {/* Timer Display */}
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${timerRunning ? 'bg-brand-600' : 'bg-brand-700'}`}>
                <Clock className="h-4 w-4" />
                <span className="font-mono font-semibold text-lg">{formatTime(elapsedSeconds)}</span>
              </div>
              <button
                onClick={handleToggleTimer}
                className={`p-2 rounded-lg transition-colors ${timerRunning ? 'bg-amber-500 hover:bg-amber-600' : 'bg-white/20 hover:bg-white/30'}`}
                title={timerRunning ? 'Pause timer' : 'Start timer'}
              >
                {timerRunning ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>

        {/* Warning Banner */}
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <p className="text-sm font-medium text-amber-800">
            "Check the instructions carefully otherwise you will be responsible".
          </p>
        </div>

        {/* Action Buttons Row */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-200 bg-slate-50">
          <button
            onClick={() => setShowFlagModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
          >
            <Flag className="h-4 w-4" />
            Flag Issue
          </button>
          <button
            onClick={() => setShowHelpModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <HelpCircle className="h-4 w-4" />
            Request Help
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6 bg-white">
          <button
            onClick={() => setActiveTab('form')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'form' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <FileText className="h-4 w-4 inline mr-1.5" />
            Verification
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'notes' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <MessageSquare className="h-4 w-4 inline mr-1.5" />
            Notes
          </button>
          <button
            onClick={() => setActiveTab('attachments')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'attachments' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <Paperclip className="h-4 w-4 inline mr-1.5" />
            Files
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-brand-500 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <Clock className="h-4 w-4 inline mr-1.5" />
            History
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[calc(90vh-320px)] overflow-y-auto">
          {/* Success Message */}
          {success && (
            <div className="mb-4 p-3 bg-brand-50 border border-brand-200 rounded-lg text-sm text-brand-700">
              {success}
            </div>
          )}

          {/* Notes Tab */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-amber-800 mb-2">Supervisor Instructions</h3>
                <p className="text-sm text-amber-700 whitespace-pre-wrap">
                  {orderDetails?.supervisor_notes || 'No special instructions for this order.'}
                </p>
              </div>

              {orderDetails?.help_requests && orderDetails.help_requests.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Help Requests</h3>
                  <div className="space-y-2">
                    {orderDetails.help_requests.map((hr: any) => (
                      <div key={hr.id} className={`p-3 rounded-lg border ${hr.status === 'answered' ? 'bg-brand-50 border-brand-200' : 'bg-slate-50 border-slate-200'}`}>
                        <p className="text-sm text-slate-700"><strong>Q:</strong> {hr.question}</p>
                        {hr.response && <p className="text-sm text-brand-700 mt-1"><strong>A:</strong> {hr.response}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Attachments Tab */}
          {activeTab === 'attachments' && (
            <div>
              {orderDetails?.attachments && orderDetails.attachments.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {orderDetails.attachments.map((file, i) => (
                    <a
                      key={i}
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <div className="w-10 h-10 bg-brand-100 rounded-lg flex items-center justify-center">
                        <Paperclip className="h-5 w-5 text-brand-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                        <p className="text-xs text-slate-400">{file.type}</p>
                      </div>
                      <ExternalLink className="h-4 w-4 text-slate-400" />
                    </a>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <Paperclip className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No attachments for this order</p>
                </div>
              )}
            </div>
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            <div>
              {order.work_items && order.work_items.length > 0 ? (
                <div className="space-y-2">
                  {order.work_items.map((wi: any) => (
                    <div key={wi.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{wi.stage}</p>
                        <p className="text-xs text-slate-400">{wi.status}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">{wi.assigned_user?.name || 'Unassigned'}</p>
                        {wi.completed_at && <p className="text-xs text-slate-400">{new Date(wi.completed_at).toLocaleDateString()}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-400">
                  <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No work history yet</p>
                </div>
              )}
            </div>
          )}

          {/* Verification Form Tab */}
          {activeTab === 'form' && (
            <div className="space-y-2">
              {/* Project Type - Read Only */}
              <div className="flex items-center bg-slate-100 rounded-lg">
                <div className="w-44 px-4 py-3 text-sm font-semibold text-slate-700 text-right flex-shrink-0">
                  Project Type:
                </div>
                <div className="flex-1 px-4 py-3 text-sm text-slate-600">
                  {projectName}
                </div>
              </div>

              {/* Verification Rows - Drawer Value + Checker Verify */}
              <VerifyRow
                label="Template"
                drawerValue={drawerData.template || 'Not specified'}
                verifyValue={verifyData.template}
                onChange={(v) => handleVerifyChange('template', v)}
              />
              <VerifyRow
                label="Address"
                drawerValue={drawerData.address || order.client_reference || 'Yes'}
                verifyValue={verifyData.address}
                onChange={(v) => handleVerifyChange('address', v)}
              />
              <VerifyRow
                label="Wall Thickness"
                drawerValue={drawerData.wall_thickness || 'Yes'}
                verifyValue={verifyData.wall_thickness}
                onChange={(v) => handleVerifyChange('wall_thickness', v)}
              />
              <VerifyRow
                label="Structure"
                drawerValue={drawerData.structure || 'Yes'}
                verifyValue={verifyData.structure}
                onChange={(v) => handleVerifyChange('structure', v)}
              />
              <VerifyRow
                label="Door"
                drawerValue={drawerData.door || 'Yes'}
                verifyValue={verifyData.door}
                onChange={(v) => handleVerifyChange('door', v)}
              />
              <VerifyRow
                label="Window"
                drawerValue={drawerData.window || 'Yes'}
                verifyValue={verifyData.window}
                onChange={(v) => handleVerifyChange('window', v)}
              />
              <VerifyRow
                label="Label / Dimension"
                drawerValue={drawerData.label_dimension || 'Yes'}
                verifyValue={verifyData.label_dimension}
                onChange={(v) => handleVerifyChange('label_dimension', v)}
              />
              <VerifyRow
                label="Final Files"
                drawerValue={drawerData.final_files || 'Yes'}
                verifyValue={verifyData.final_files}
                onChange={(v) => handleVerifyChange('final_files', v)}
              />
              <VerifyRow
                label="Plan Rotation"
                drawerValue={drawerData.plan_rotation || 'Yes'}
                verifyValue={verifyData.plan_rotation}
                onChange={(v) => handleVerifyChange('plan_rotation', v)}
              />
              <VerifyRow
                label="Area"
                drawerValue={drawerData.area || 'Yes'}
                verifyValue={verifyData.area}
                onChange={(v) => handleVerifyChange('area', v)}
              />

              {/* Drawer Entered Area - Read Only */}
              <div className="flex items-center bg-slate-50 rounded-lg">
                <div className="w-44 px-4 py-3 text-sm font-semibold text-slate-700 text-right flex-shrink-0">
                  Drawer Entered Area:
                </div>
                <div className="flex-1 px-4 py-3">
                  <input
                    type="text"
                    value={editableArea}
                    onChange={e => setEditableArea(e.target.value)}
                    title="Edit area value"
                    placeholder="Please write area with its unit"
                    className="px-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 w-full focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>
              </div>

              <VerifyRow
                label="North"
                drawerValue={drawerData.north || 'Yes'}
                verifyValue={verifyData.north}
                onChange={(v) => handleVerifyChange('north', v)}
              />
              <VerifyRow
                label="Site Plan"
                drawerValue={drawerData.site_plan || 'Yes'}
                verifyValue={verifyData.site_plan}
                onChange={(v) => handleVerifyChange('site_plan', v)}
              />

              {/* Drawer Mistake Box */}
              <div className="flex items-start bg-rose-50 rounded-lg border border-rose-200 mt-4">
                <div className="w-44 px-4 py-3 text-sm font-semibold text-rose-700 text-right flex-shrink-0">
                  Drawer Mistake Box:
                </div>
                <div className="flex-1 px-4 py-3">
                  <textarea
                    value={mistakeBox}
                    onChange={e => setMistakeBox(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 border border-rose-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-200"
                    placeholder="Document any drawer mistakes here..."
                  />
                </div>
              </div>

              {/* Link */}
              <div className="flex items-center bg-slate-50 rounded-lg">
                <div className="w-44 px-4 py-3 text-sm font-semibold text-slate-700 text-right flex-shrink-0">
                  Link:
                </div>
                <div className="flex-1 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={drawerData.link || 'Y'}
                      disabled
                      title="Drawer link value"
                      className="flex-1 px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-600"
                    />
                    {typeof drawerData.link === 'string' && drawerData.link.startsWith('http') && (
                      <a
                        href={drawerData.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="Open link"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              <p className="text-sm text-rose-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        {activeTab === 'form' && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-center gap-4">
            <button
              onClick={handleCheckerDone}
              disabled={submitting}
              className="px-8 py-3 bg-brand-500 hover:bg-brand-600 text-white font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <CheckCircle className="h-5 w-5" />
              )}
              Checker Done
            </button>
            <button
              onClick={() => setShowRejectModal(true)}
              disabled={submitting}
              className="px-6 py-3 text-rose-600 hover:bg-rose-50 font-semibold rounded-xl transition-colors flex items-center gap-2"
            >
              <RotateCcw className="h-5 w-5" />
              Re-Send
            </button>
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowRejectModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Re-Send to Drawer</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Rejection Code</label>
                <select
                  value={rejectCode}
                  onChange={e => setRejectCode(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  title="Select rejection code"
                >
                  <option value="">Select code...</option>
                  {REJECTION_CODES.map(c => (
                    <option key={c} value={c}>{c.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason</label>
                <textarea
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none"
                  rows={3}
                  placeholder="Describe what needs to be fixed..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowRejectModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleReSend}
                disabled={submitting || !rejectCode || !rejectReason}
                className="px-4 py-2 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                {submitting ? 'Sending...' : 'Re-Send to Drawer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flag Issue Modal */}
      {showFlagModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowFlagModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Flag an Issue</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Issue Type</label>
                <select
                  value={flagType}
                  onChange={e => setFlagType(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  title="Select issue type"
                >
                  <option value="">Select type...</option>
                  <option value="quality">Quality</option>
                  <option value="missing_info">Missing Info</option>
                  <option value="wrong_specs">Wrong Specs</option>
                  <option value="unclear_instructions">Unclear Instructions</option>
                  <option value="file_issue">File Issue</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Severity</label>
                <select
                  value={flagSeverity}
                  onChange={e => setFlagSeverity(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  title="Select severity"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={flagDescription}
                  onChange={e => setFlagDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none"
                  rows={3}
                  placeholder="Describe the issue..."
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowFlagModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleFlagIssue}
                disabled={submitting || !flagType || !flagDescription}
                className="px-4 py-2 text-sm font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Flag Issue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Request Help Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => setShowHelpModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Request Help</h3>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Your Question</label>
              <textarea
                value={helpQuestion}
                onChange={e => setHelpQuestion(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm resize-none"
                rows={4}
                placeholder="What do you need help with?"
              />
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestHelp}
                disabled={submitting || !helpQuestion}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Send Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Verification Row Component
function VerifyRow({
  label,
  drawerValue,
  verifyValue,
  onChange
}: {
  label: string;
  drawerValue: string;
  verifyValue: string;
  onChange: (v: string) => void;
}) {
  const VERIFY_OPTIONS = ['---', 'OK', 'Wrong', 'Missing', 'N/A'];

  return (
    <div className="flex items-center bg-slate-50 rounded-lg">
      <div className="w-44 px-4 py-3 text-sm font-semibold text-slate-700 text-right flex-shrink-0">
        {label}:
      </div>
      <div className="flex-1 px-4 py-2 flex items-center gap-4">
        <span className="text-sm text-brand-600 font-medium min-w-[80px]">{drawerValue}</span>
        <select
          value={verifyValue}
          onChange={e => onChange(e.target.value)}
          className={`px-3 py-2 border rounded-lg text-sm min-w-[100px] ${verifyValue === 'Wrong' || verifyValue === 'Missing'
            ? 'border-rose-300 bg-rose-50 text-rose-700'
            : verifyValue === 'OK'
              ? 'border-brand-300 bg-brand-50 text-brand-700'
              : 'border-slate-300 bg-white'
            }`}
          title={`Verify ${label}`}
        >
          {VERIFY_OPTIONS.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
