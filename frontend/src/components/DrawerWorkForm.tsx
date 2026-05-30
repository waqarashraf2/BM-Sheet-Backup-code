import { useState, useEffect, useCallback } from 'react';
import { X, Save, AlertTriangle, ExternalLink, Loader2, Play, Flag, HelpCircle, RotateCcw, Clock, FileText, Paperclip, MessageSquare } from 'lucide-react';
import { workflowService } from '../services';
import type { Order } from '../types';

interface DrawerWorkFormProps {
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
}

// Form field options - these would ideally come from project config
const TEMPLATE_OPTIONS = ['---', 'Yes', 'No'];

const WALL_THICKNESS_OPTIONS = ['---', 'Yes', 'No'];

const STRUCTURE_OPTIONS = ['---', 'Yes', 'No'];

const DOOR_OPTIONS = ['---', 'Yes', 'No'];

const WINDOW_OPTIONS = ['---', 'Yes', 'No'];

const LABEL_DIMENSION_OPTIONS = ['---', 'Yes', 'No'];

const FINAL_FILES_OPTIONS = ['---', 'Yes', 'No'];

const PLAN_ROTATION_OPTIONS = ['---', 'Yes', 'No'];

const AREA_OPTIONS = ['---', 'Yes', 'No'];

const NORTH_OPTIONS = ['---', 'Yes', 'No'];

const SITE_PLAN_OPTIONS = ['---', 'Yes', 'No'];

const PENDING_REASONS = [
  '--- Select Reason ---',
  'Missing Client Information',
  'Incomplete Address',
  'Wrong Template',
  'Missing Dimensions',
  'Missing Site Plan',
  'Missing North Direction',
  'Missing Structure Details',
  'Client Instructions Not Clear',
  'Mail Order Not Workable',
  'Need Supervisor Clarification',
  'Need QA/Checker Review',
  'Other Issue'
];

const FLAG_TYPES = ['Yes', 'No'];

export default function DrawerWorkForm({ order, onComplete, onClose }: DrawerWorkFormProps) {
  const [mode, setMode] = useState<'draw' | 'pending'>('draw');
  const [pendingReason, setPendingReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Additional features state
  const [orderDetails, setOrderDetails] = useState<OrderDetails | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showFlagModal, setShowFlagModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [flagType, setFlagType] = useState('');
  const [flagDescription, setFlagDescription] = useState('');
  const [flagSeverity, setFlagSeverity] = useState('medium');
  const [helpQuestion, setHelpQuestion] = useState('');
  const [activeTab, setActiveTab] = useState<'form' | 'notes' | 'attachments' | 'history'>('form');

  // Form fields
  const [formData, setFormData] = useState({
    template: '---',
    address: '',
    wall_thickness: '---',
    structure: '---',
    door: '---',
    window: '---',
    label_dimension: '---',
    final_files: '---',
    plan_rotation: '---',
    area: '---',
    enter_area: '',
    north: '---',
    site_plan: '---',
    link: '',
  });

  // Load order details
  const loadOrderDetails = useCallback(async () => {
    try {
      const res = await workflowService.orderFullDetails(order.id);
      setOrderDetails(res.data);
      setElapsedSeconds(Math.max(0, Math.floor(res.data.current_time_seconds)));
      setTimerRunning(res.data.timer_running);
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

  const handleFieldChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleToggleTimer = async () => {
    try {
      if (!timerRunning) {
        await workflowService.startTimer(order.id);
        setTimerRunning(true);
      }
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to start timer');
    }
  };

  const handleReassignToQueue = async () => {
    if (!confirm('Are you sure you want to release this order back to the queue?')) return;
    setSubmitting(true);
    setError(null);
    try {
      await workflowService.reassignToQueue(order.id, 'Released by worker');
      onComplete();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to release order');
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
      setError(e.response?.data?.message || 'Failed to submit work. Please try again.');
      // Allow retry on error - don't disable the form permanently
      console.error('Submission error:', e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitDraw = async () => {
    // Validation: Check if at least essential fields are filled
    const essentialFields = [
      { key: 'template', label: 'Template' },
      { key: 'address', label: 'Address' },
    ];

    const missingEssential = essentialFields.filter(field => {
      const value = formData[field.key as keyof typeof formData];
      return !value || value === '---' || (typeof value === 'string' && value.trim() === '');
    });

    if (missingEssential.length > 0) {
      setError(`Please fill essential fields: ${missingEssential.map(f => f.label).join(', ')}`);
      return;
    }

    // Warn about missing optional fields but allow submission
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

    const missingOptional = optionalFields.filter(field => {
      const value = formData[field.key as keyof typeof formData];
      return !value || value === '---' || (typeof value === 'string' && value.trim() === '');
    });

    // Additional validation for area
    if (formData.area === 'Yes' && (!formData.enter_area || formData.enter_area.trim() === '')) {
      setError('Please enter the area value when Area is set to Yes');
      return;
    }

    // Show warning for missing optional fields but allow submission
    if (missingOptional.length > 0) {
      const proceed = window.confirm(
        `Some optional fields are not filled: ${missingOptional.map(f => f.label).join(', ')}. Do you want to proceed with submission?`
      );
      if (!proceed) return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // Submit work with form data as comment/metadata
      const comment = `Template: ${formData.template}, Structure: ${formData.structure}, Wall: ${formData.wall_thickness}, Area: ${formData.enter_area || formData.area}`;
      await workflowService.submitWork(order.id, comment);
      onComplete();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to submit work');
      // Allow retry on error - don't disable the form permanently
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitPending = async () => {
    if (!pendingReason || pendingReason === '---') {
      setError('Please select a reason for pending');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // Put order on hold with reason
      await workflowService.holdOrder(order.id, pendingReason);
      onComplete();
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to mark as pending');
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
        <div className="bg-slate-100 px-6 py-4 border-b border-slate-200">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 hover:bg-slate-200 rounded-lg transition-colors"
            title="Close"
            aria-label="Close form"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
          <div className="flex items-center justify-between pr-10">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Project Type - {projectName}</h2>
              <p className="text-sm text-slate-500 mt-1">Order: {order.order_number}</p>
            </div>
            {/* Timer Display */}
            <div className="flex items-center gap-3">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${timerRunning ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600'}`}>
                <Clock className="h-4 w-4" />
                <span className="font-mono font-semibold text-lg">{formatTime(elapsedSeconds)}</span>
              </div>
              <button
                onClick={handleToggleTimer}
                disabled={timerRunning}
                className={`p-2 rounded-lg transition-colors ${timerRunning
                  ? 'bg-slate-300 text-white cursor-not-allowed'
                  : 'bg-brand-500 hover:bg-brand-600 text-white'
                  }`}
                title="Start timer"
              >
                <Play className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Action Buttons Row */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
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
            <button
              onClick={handleReassignToQueue}
              disabled={submitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              <RotateCcw className="h-4 w-4" />
              Release to Queue
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 px-6 bg-white">
          <button
            onClick={() => setActiveTab('form')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'form' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <FileText className="h-4 w-4 inline mr-1.5" />
            Work Form
          </button>
          <button
            onClick={() => setActiveTab('notes')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'notes' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <MessageSquare className="h-4 w-4 inline mr-1.5" />
            Notes
            {orderDetails?.supervisor_notes && <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-600 rounded-full">1</span>}
          </button>
          <button
            onClick={() => setActiveTab('attachments')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'attachments' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <Paperclip className="h-4 w-4 inline mr-1.5" />
            Files
            {orderDetails?.attachments && orderDetails.attachments.length > 0 && <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-100 text-blue-600 rounded-full">{orderDetails.attachments.length}</span>}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'history' ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <Clock className="h-4 w-4 inline mr-1.5" />
            History
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[calc(90vh-280px)] overflow-y-auto">
          {/* Success Message */}
          {success && (
            <div className="mb-4 p-3 bg-brand-50 border border-brand-200 rounded-lg text-sm text-brand-700">
              {success}
            </div>
          )}

          {/* Supervisor Notes Tab */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-amber-800 mb-2">Supervisor Instructions</h3>
                <p className="text-sm text-amber-700 whitespace-pre-wrap">
                  {orderDetails?.supervisor_notes || 'No special instructions for this order.'}
                </p>
              </div>

              {/* Help Requests */}
              {orderDetails?.help_requests && orderDetails.help_requests.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Help Requests</h3>
                  <div className="space-y-2">
                    {orderDetails.help_requests.map((hr: any) => (
                      <div key={hr.id} className={`p-3 rounded-lg border ${hr.status === 'answered' ? 'bg-brand-50 border-brand-200' : 'bg-slate-50 border-slate-200'}`}>
                        <p className="text-sm text-slate-700"><strong>Q:</strong> {hr.question}</p>
                        {hr.response && <p className="text-sm text-brand-700 mt-1"><strong>A:</strong> {hr.response}</p>}
                        <p className="text-xs text-slate-400 mt-1">{hr.status}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Issue Flags */}
              {orderDetails?.issue_flags && orderDetails.issue_flags.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2">Flagged Issues</h3>
                  <div className="space-y-2">
                    {orderDetails.issue_flags.map((flag: any) => (
                      <div key={flag.id} className={`p-3 rounded-lg border ${flag.status === 'resolved' ? 'bg-brand-50 border-brand-200' : 'bg-rose-50 border-rose-200'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${flag.severity === 'high' ? 'bg-rose-200 text-rose-800' : flag.severity === 'medium' ? 'bg-amber-200 text-amber-800' : 'bg-slate-200 text-slate-700'}`}>
                            {flag.severity}
                          </span>
                          <span className="text-sm font-medium text-slate-700">{flag.flag_type.replace('_', ' ')}</span>
                        </div>
                        <p className="text-sm text-slate-600 mt-1">{flag.description}</p>
                        {flag.resolution_notes && <p className="text-sm text-brand-700 mt-1"><strong>Resolution:</strong> {flag.resolution_notes}</p>}
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
                      <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <Paperclip className="h-5 w-5 text-blue-600" />
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

          {/* Work Form Tab */}
          {activeTab === 'form' && (
            <>
              {/* Mode Selection */}
              <div className="bg-slate-50 rounded-xl p-4 mb-6">
                <div className="flex items-center gap-6">
                  <span className="text-sm font-semibold text-[#8B0000]">Choose:</span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === 'draw'}
                      onChange={() => setMode('draw')}
                      className="w-4 h-4 text-[#2AA7A0] focus:ring-[#2AA7A0]"
                    />
                    <span className="text-sm text-slate-700">Draw</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="mode"
                      checked={mode === 'pending'}
                      onChange={() => setMode('pending')}
                      className="w-4 h-4 text-[#2AA7A0] focus:ring-[#2AA7A0]"
                    />
                    <span className="text-sm text-slate-700">Pending</span>
                  </label>
                </div>

                {mode === 'pending' && (
                  <div className="mt-4">
                    <label className="text-sm font-semibold text-[#8B0000]">Reason:</label>
                    <select
                      value={pendingReason}
                      onChange={e => setPendingReason(e.target.value)}
                      className="ml-4 px-3 py-1.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/20"
                      title="Select pending reason"
                    >
                      {PENDING_REASONS.map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                )}

                {mode === 'pending' && pendingReason && pendingReason !== '---' && (
                  <button
                    onClick={handleSubmitPending}
                    disabled={submitting}
                    className="mt-4 px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : 'Pending'}
                  </button>
                )}
              </div>

              {/* Draw Form Fields */}
              {mode === 'draw' && (
                <div className="space-y-3">
                  {/* Template */}
                  <FormRow label="Template">
                    <FormSelect
                      value={formData.template}
                      onChange={v => handleFieldChange('template', v)}
                      options={TEMPLATE_OPTIONS}
                    />
                  </FormRow>

                  {/* Address */}
                  <FormRow label="Address">
                    <input
                      type="text"
                      value={formData.address}
                      onChange={e => handleFieldChange('address', e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/20"
                      placeholder="Property address"
                    />
                  </FormRow>

                  {/* Wall Thickness */}
                  <FormRow label="Wall Thickness">
                    <FormSelect
                      value={formData.wall_thickness}
                      onChange={v => handleFieldChange('wall_thickness', v)}
                      options={WALL_THICKNESS_OPTIONS}
                    />
                  </FormRow>

                  {/* Structure */}
                  <FormRow label="Structure">
                    <FormSelect
                      value={formData.structure}
                      onChange={v => handleFieldChange('structure', v)}
                      options={STRUCTURE_OPTIONS}
                    />
                  </FormRow>

                  {/* Door */}
                  <FormRow label="Door">
                    <FormSelect
                      value={formData.door}
                      onChange={v => handleFieldChange('door', v)}
                      options={DOOR_OPTIONS}
                    />
                  </FormRow>

                  {/* Window */}
                  <FormRow label="Window">
                    <FormSelect
                      value={formData.window}
                      onChange={v => handleFieldChange('window', v)}
                      options={WINDOW_OPTIONS}
                    />
                  </FormRow>

                  {/* Label / Dimension */}
                  <FormRow label="Label / Dimension">
                    <FormSelect
                      value={formData.label_dimension}
                      onChange={v => handleFieldChange('label_dimension', v)}
                      options={LABEL_DIMENSION_OPTIONS}
                    />
                  </FormRow>

                  {/* Final Files */}
                  <FormRow label="Final Files">
                    <FormSelect
                      value={formData.final_files}
                      onChange={v => handleFieldChange('final_files', v)}
                      options={FINAL_FILES_OPTIONS}
                    />
                  </FormRow>

                  {/* Plan Rotation */}
                  <FormRow label="Plan Rotation">
                    <FormSelect
                      value={formData.plan_rotation}
                      onChange={v => handleFieldChange('plan_rotation', v)}
                      options={PLAN_ROTATION_OPTIONS}
                    />
                  </FormRow>

                  {/* Area */}
                  <FormRow label="Area">
                    <FormSelect
                      value={formData.area}
                      onChange={v => handleFieldChange('area', v)}
                      options={AREA_OPTIONS}
                    />
                  </FormRow>

                  {/* Enter Area */}
                  <FormRow label="Enter Area">
                    <input
                      type="text"
                      value={formData.enter_area}
                      onChange={e => handleFieldChange('enter_area', e.target.value)}
                      className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/20"
                      placeholder="please write area with its unit"
                    />
                  </FormRow>

                  {/* North */}
                  <FormRow label="North">
                    <FormSelect
                      value={formData.north}
                      onChange={v => handleFieldChange('north', v)}
                      options={NORTH_OPTIONS}
                    />
                  </FormRow>

                  {/* Site Plan */}
                  <FormRow label="Site Plan">
                    <FormSelect
                      value={formData.site_plan}
                      onChange={v => handleFieldChange('site_plan', v)}
                      options={SITE_PLAN_OPTIONS}
                    />
                  </FormRow>

                  {/* Link */}
                  <FormRow label="Link">
                    <div className="flex-1 flex items-center gap-2">
                      <input
                        type="url"
                        value={formData.link}
                        onChange={e => handleFieldChange('link', e.target.value)}
                        className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/20"
                        placeholder="http://"
                      />
                      {formData.link && (
                        <a
                          href={formData.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 text-[#2AA7A0] hover:bg-[#2AA7A0]/10 rounded-lg"
                          title="Open link"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                  </FormRow>
                </div>
              )}
            </>
          )}

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-500" />
              <p className="text-sm text-rose-700">{error}</p>
            </div>
          )}
        </div>

        {/* Footer - Only show for form tab in draw mode */}
        {activeTab === 'form' && mode === 'draw' && (
          <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
            <button
              onClick={handleSubmitDraw}
              disabled={submitting}
              className="w-full py-3 bg-[#8B0000] hover:bg-[#6B0000] text-white font-semibold rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Save className="h-5 w-5" />
                  Drawer Done
                </>
              )}
            </button>
          </div>
        )}
      </div>

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
                  {FLAG_TYPES.map(t => (
                    <option key={t} value={t}>{t.replace('_', ' ')}</option>
                  ))}
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

// Helper Components
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center bg-slate-50 rounded-lg">
      <div className="w-40 px-4 py-3 text-sm font-semibold text-slate-700 text-right flex-shrink-0">
        {label}:
      </div>
      <div className="flex-1 px-4 py-2">
        {children}
      </div>
    </div>
  );
}

function FormSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/20 bg-white min-w-[120px]"
      title="Select option"
    >
      {options.map(opt => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}