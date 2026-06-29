import { useState, useEffect, useRef } from 'react';
import type { Order } from '../types';
import type { WorkItem } from '../types';
import { REJECTION_CODES } from '../types';
import { workflowService } from '../services';
import { Button, Textarea, Select } from './ui';
import { Eye, Clock, X, Flag, HelpCircle, CheckCircle2, Circle, Send, MessageSquare, History } from 'lucide-react';
import { getLatestStageArea } from '../utils/workItemArea';
import QAClientPortalUpload from './QAClientPortalUpload';
import type { ClientPortalUploadStatus } from '../services';

interface QAWorkFormProps {
  order: Order;
  onComplete: () => void;
  onClose: () => void;
}

interface OrderDetails {
  order: Order;
  supervisor_notes: string | null;
  attachments: Array<{ name: string; url: string; type: string }>;
  help_requests: any[];
  issue_flags: any[];
  current_time_seconds: number;
  timer_running: boolean;
  work_items?: WorkItem[];
}

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  checked: boolean;
}

type ImageCountStateKey = 'totalImages' | 'normalImages' | 'hdrImages' | 'editImages' | 'finalImages';
type ImageCountPayloadKey =
  | 'total_raw_files'
  | 'hdr_images_count'
  | 'single_images_count'
  | 'final_images_count'
  | 'edited_images_count';

interface ImageCountFieldConfig {
  stateKey: ImageCountStateKey;
  label: string;
  commentLabels: string[];
  metadataKeys: string[];
  payloadKey?: ImageCountPayloadKey;
}

const DEFAULT_CHECKLIST: ChecklistItem[] = [
  { id: 'dimensions', label: 'Dimensions & Measurements', description: 'All dimensions match source data accurately', checked: false },
  { id: 'format', label: 'File Format & Quality', description: 'Output meets required format, resolution, and quality standards', checked: false },
  { id: 'specifications', label: 'Client Specifications', description: 'Work follows all client-specific requirements and standards', checked: false },
  { id: 'corrections', label: 'Previous Corrections Applied', description: 'All corrections from previous stages have been properly addressed', checked: false },
  { id: 'labeling', label: 'Labeling & Annotations', description: 'All labels, text, and annotations are correct and properly placed', checked: false },
  { id: 'completeness', label: 'Completeness Check', description: 'No missing elements — all required items present', checked: false },
];

const DEFAULT_IMAGE_COUNT_FIELDS: ImageCountFieldConfig[] = [
  { stateKey: 'totalImages', label: 'Total', commentLabels: ['Total'], metadataKeys: ['total_images', 'totalImages'] },
  { stateKey: 'normalImages', label: 'Normal', commentLabels: ['Normal'], metadataKeys: ['normal_images', 'normalImages', 'normal_final_images', 'normalFinalImages'] },
  { stateKey: 'hdrImages', label: 'HDR', commentLabels: ['HDR'], metadataKeys: ['hdr_images', 'hdrImages'] },
  { stateKey: 'editImages', label: 'Edited', commentLabels: ['Edited', 'Edit'], metadataKeys: ['edit_images', 'editImages'] },
  { stateKey: 'finalImages', label: 'Final', commentLabels: ['Final'], metadataKeys: ['final_images', 'finalImages'] },
];

const PROJECT_IMAGE_COUNT_FIELDS: Record<number, ImageCountFieldConfig[]> = {
  17: [
    { stateKey: 'totalImages', label: 'Total', commentLabels: ['Total'], metadataKeys: ['total_raw_files', 'total_images', 'totalImages'], payloadKey: 'total_raw_files' },
    { stateKey: 'normalImages', label: 'Normal', commentLabels: ['Normal'], metadataKeys: ['single_images_count', 'normal_images', 'normalImages', 'normal_final_images', 'normalFinalImages'], payloadKey: 'single_images_count' },
    { stateKey: 'hdrImages', label: 'HDR', commentLabels: ['HDR'], metadataKeys: ['hdr_images_count', 'hdr_images', 'hdrImages'], payloadKey: 'hdr_images_count' },
    { stateKey: 'editImages', label: 'Edited', commentLabels: ['Edited', 'Edit'], metadataKeys: ['edited_images_count', 'edit_images', 'editImages'], payloadKey: 'edited_images_count' },
    { stateKey: 'finalImages', label: 'Final', commentLabels: ['Final'], metadataKeys: ['final_images_count', 'final_images', 'finalImages'], payloadKey: 'final_images_count' },
  ],
  52: [
    { stateKey: 'totalImages', label: 'Images', commentLabels: ['Images', 'Total'], metadataKeys: ['total_raw_files', 'images', 'totalImages'], payloadKey: 'total_raw_files' },
    { stateKey: 'hdrImages', label: 'General QA Image', commentLabels: ['General QA Image', 'HDR'], metadataKeys: ['hdr_images_count', 'hdrImages'], payloadKey: 'hdr_images_count' },
    { stateKey: 'normalImages', label: 'Human Edit', commentLabels: ['Human Edit', 'Normal'], metadataKeys: ['single_images_count', 'normalImages'], payloadKey: 'single_images_count' },
    { stateKey: 'finalImages', label: 'GDPR', commentLabels: ['GDPR', 'Final'], metadataKeys: ['final_images_count', 'finalImages'], payloadKey: 'final_images_count' },
    { stateKey: 'editImages', label: 'Edited Images', commentLabels: ['Edited Images', 'Edited', 'Edit'], metadataKeys: ['edited_images_count', 'editImages'], payloadKey: 'edited_images_count' },
  ],
};

type ImageCountSyncPayload = {
  project_id: number;
  total_raw_files?: string | number | null;
  hdr_images_count?: number | null;
  single_images_count?: number | null;
  final_images_count?: number | null;
  edited_images_count?: number | null;
};

export default function QAWorkForm({ order, onComplete, onClose }: QAWorkFormProps) {
  const metadata = (order.metadata || {}) as Record<string, string>;
  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(DEFAULT_CHECKLIST.map(c => ({ ...c })));
  const [notes, setNotes] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectCode, setRejectCode] = useState('');
  const [routeTo, setRouteTo] = useState('');
  const [activeTab, setActiveTab] = useState<'checklist' | 'notes' | 'history'>('checklist');
  const [showFlag, setShowFlag] = useState(false);
  const [flagType, setFlagType] = useState('quality_issue');
  const [flagDescription, setFlagDescription] = useState('');
  const [flagSeverity, setFlagSeverity] = useState('medium');
  const [showHelp, setShowHelp] = useState(false);
  const [helpQuestion, setHelpQuestion] = useState('');
  const [editableArea, setEditableArea] = useState(String(metadata.enter_area ?? metadata.area ?? ''));
  const [clientPortalStatus, setClientPortalStatus] = useState<ClientPortalUploadStatus | null>(null);

  // PH_2_LAYER image counts
  const isPh2Layer = order.workflow_type === 'PH_2_LAYER';
  const imageCountFields = PROJECT_IMAGE_COUNT_FIELDS[order.project_id] ?? DEFAULT_IMAGE_COUNT_FIELDS;
  const [totalImages, setTotalImages] = useState('');
  const [normalImages, setNormalImages] = useState('');
  const [hdrImages, setHdrImages] = useState('');
  const [editImages, setEditImages] = useState('');
  const [finalImages, setFinalImages] = useState('');

  // Timer
  const [elapsed, setElapsed] = useState(0);
  const [timerRunning, setTimerRunning] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadDetails();
    workflowService.startTimer(order.id).catch(() => { });
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [order.id]);

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  const loadDetails = async () => {
    try {
      const res = await workflowService.orderFullDetails(order.id);
      setDetails(res.data);

      const checkerArea = getLatestStageArea(res.data.work_items ?? res.data.order?.work_items, 'CHECK');
      if (checkerArea) {
        setEditableArea(checkerArea);
      }

      // For PH_2_LAYER, load image counts from designer's work_items comments
      if (isPh2Layer) {
        const workItems = res.data.work_items ?? res.data.order?.work_items ?? [];
        const designerWorkItem = workItems.find((item: any) => item.stage === 'DESIGN');
        const detailOrder = (res.data?.order || order) as unknown as Record<string, unknown>;
        const metadataSource = ((res.data?.order?.metadata || order.metadata || {}) as Record<string, unknown>);
        const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const extractNumber = (comments: string, labels: string[]) => {
          for (const label of labels) {
            const match = comments.match(new RegExp(`${escapeRegExp(label)}:\\s*(\\d+)`, 'i'));
            if (match) return match[1];
          }
          return '';
        };
        const getStoredCount = (keys: string[]) => {
          for (const key of keys) {
            const value = detailOrder[key] ?? metadataSource[key];
            if (value === null || value === undefined || value === '') continue;
            return String(value);
          }
          return '';
        };
        const countsByState: Record<ImageCountStateKey, string> = {
          totalImages: '',
          normalImages: '',
          hdrImages: '',
          editImages: '',
          finalImages: '',
        };

        if (designerWorkItem && designerWorkItem.comments) {
          const comments = designerWorkItem.comments;
          // Parse: "Images — Total: 255, HDR: 200, Edit: 240, Normal: 50, Final: 255"
          imageCountFields.forEach((field) => {
            countsByState[field.stateKey] = extractNumber(comments, field.commentLabels);
          });
        }

        imageCountFields.forEach((field) => {
          if (!countsByState[field.stateKey]) {
            countsByState[field.stateKey] = getStoredCount(field.metadataKeys);
          }
        });

        setTotalImages(countsByState.totalImages);
        setHdrImages(countsByState.hdrImages);
        setEditImages(countsByState.editImages);
        setNormalImages(countsByState.normalImages);
        setFinalImages(countsByState.finalImages);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const toggleTimer = async () => {
    try {
      if (timerRunning) {
        await workflowService.stopTimer(order.id);
      } else {
        await workflowService.startTimer(order.id);
      }
      setTimerRunning(!timerRunning);
    } catch (e) { console.error(e); }
  };

  const visibleChecklist = isPh2Layer ? [] : checklist;
  const allChecked = isPh2Layer ? true : checklist.every(c => c.checked);
  const checkedCount = isPh2Layer ? visibleChecklist.length : checklist.filter(c => c.checked).length;

  const handleApprove = async () => {
    if (!isPh2Layer && !allChecked) return;
    if (isPh2Layer && !(totalImages || normalImages || hdrImages || editImages || finalImages)) return;
    if (clientPortalStatus?.required && !clientPortalStatus.submitted) return;
    setSubmitting(true);
    try {
      const checklistSummary = !isPh2Layer ? checklist.map(c => `✓ ${c.label}`).join('\n') : '';
      const areaSummary = editableArea.trim() ? `\nArea: ${editableArea.trim()}` : '';
      const imageCountValues: Record<ImageCountStateKey, string> = {
        totalImages,
        normalImages,
        hdrImages,
        editImages,
        finalImages,
      };
      const imageCountSummary = isPh2Layer && (totalImages || normalImages || hdrImages || editImages || finalImages)
        ? `\nPhoto Selections - ${imageCountFields.map((field) => `${field.label}: ${imageCountValues[field.stateKey] || 0}`).join(', ')}`
        : '';
      const comment = `QA Approved${checklistSummary ? `\n\nChecklist:\n${checklistSummary}` : ''}${areaSummary}${imageCountSummary}${notes ? `\n\nNotes: ${notes}` : ''}`;
      await workflowService.submitWork(order.id, comment);

      if (isPh2Layer && imageCountFields.some((field) => field.payloadKey)) {
        const parseOptionalCount = (value: string): number | null => {
          const trimmed = value.trim();
          if (trimmed === '') return null;
          if (!/^\d+$/.test(trimmed)) return null;
          return Number(trimmed);
        };
        const getCurrentOrder = (): Record<string, unknown> => (
          (details?.order || order) as unknown as Record<string, unknown>
        );
        const normalizeCurrentString = (value: unknown): string | null => (
          value === null || value === undefined || value === '' ? null : String(value)
        );
        const normalizeCurrentCount = (value: unknown): number | null => {
          if (value === null || value === undefined || value === '') return null;
          const count = Number(value);
          return Number.isFinite(count) ? count : null;
        };

        const parsedTotalImages = parseOptionalCount(totalImages);
        const parsedNormalImages = parseOptionalCount(normalImages);
        const parsedHdrImages = parseOptionalCount(hdrImages);
        const parsedEditImages = parseOptionalCount(editImages);
        const parsedFinalImages = parseOptionalCount(finalImages);

        const parsedByState: Record<ImageCountStateKey, number | null> = {
          totalImages: parsedTotalImages,
          normalImages: parsedNormalImages,
          hdrImages: parsedHdrImages,
          editImages: parsedEditImages,
          finalImages: parsedFinalImages,
        };

        const nextByPayloadKey = imageCountFields.reduce<Record<ImageCountPayloadKey, string | number | null>>((nextValues, field) => {
          if (!field.payloadKey) return nextValues;

          nextValues[field.payloadKey] = field.payloadKey === 'total_raw_files'
            ? (parsedByState[field.stateKey] === null ? null : String(parsedByState[field.stateKey]))
            : parsedByState[field.stateKey];
          return nextValues;
        }, {} as Record<ImageCountPayloadKey, string | number | null>);

        if (order.project_id === 17 && Object.prototype.hasOwnProperty.call(nextByPayloadKey, 'total_raw_files')) {
          const totalRawFiles = parsedTotalImages
            ?? ((parsedNormalImages ?? 0) + (parsedHdrImages ?? 0));
          nextByPayloadKey.total_raw_files = String(totalRawFiles);
        }

        const currentOrder = getCurrentOrder();
        const currentByPayloadKey: Record<ImageCountPayloadKey, string | number | null> = {
          total_raw_files: normalizeCurrentString(currentOrder.total_raw_files),
          hdr_images_count: normalizeCurrentCount(currentOrder.hdr_images_count),
          single_images_count: normalizeCurrentCount(currentOrder.single_images_count),
          final_images_count: normalizeCurrentCount(currentOrder.final_images_count),
          edited_images_count: normalizeCurrentCount(currentOrder.edited_images_count),
        };

        const countPayload = Object.entries(nextByPayloadKey).reduce<ImageCountSyncPayload>((payload, [key, nextValue]) => {
          const payloadKey = key as ImageCountPayloadKey;
          if (currentByPayloadKey[payloadKey] !== nextValue) {
            return {
              ...payload,
              [payloadKey]: nextValue,
            };
          }
          return payload;
        }, { project_id: order.project_id });

        if (Object.keys(countPayload).length > 1) {
          try {
            await workflowService.updateInstruction(order.id, countPayload);
          } catch (syncError) {
            console.warn('QA submit succeeded, but image count sync failed.', syncError);
          }
        }
      }

      onComplete();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleReject = async () => {
    if (!rejectCode || !rejectReason || rejectReason.length < 10) return;
    setSubmitting(true);
    try {
      await workflowService.rejectOrder(order.id, rejectReason, rejectCode, routeTo || undefined);
      onComplete();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleFlag = async () => {
    if (!flagDescription) return;
    try {
      await workflowService.flagIssue(order.id, flagType, flagDescription, flagSeverity);
      setShowFlag(false);
      setFlagDescription('');
    } catch (e) { console.error(e); }
  };

  const handleHelp = async () => {
    if (!helpQuestion) return;
    try {
      await workflowService.requestHelp(order.id, helpQuestion);
      setShowHelp(false);
      setHelpQuestion('');
    } catch (e) { console.error(e); }
  };

  const toggleCheck = (id: string) => {
    setChecklist(prev => prev.map(c => c.id === id ? { ...c, checked: !c.checked } : c));
  };

  const formatTime = (raw: number) => {
    const s = Math.max(0, Math.floor(raw));
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m ${s % 60}s` : `${m}m ${s % 60}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full overflow-hidden animate-slide-in-right">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <Eye className="h-5 w-5 text-emerald-700" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">QA Review</h2>
              <p className="text-xs leading-snug text-slate-500 break-words">{order.order_number} · {metadata.address || order.client_reference || '—'}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Timer */}
            <button
              onClick={toggleTimer}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${timerRunning ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}
            >
              <Clock className="h-3.5 w-3.5" />
              {formatTime(elapsed)}
            </button>
            <button onClick={onClose} title="Close" className="p-1.5 hover:bg-slate-200 rounded-lg transition-colors">
              <X className="h-5 w-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-100">
          <button
            onClick={() => setShowFlag(!showFlag)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
          >
            <Flag className="h-3.5 w-3.5" /> Flag Issue
          </button>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <HelpCircle className="h-3.5 w-3.5" /> Request Help
          </button>
          {!isPh2Layer && (
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-xs text-slate-500">Checklist:</span>
              <span className={`text-xs font-semibold ${allChecked ? 'text-emerald-600' : 'text-amber-600'}`}>
                {checkedCount}/{checklist.length}
              </span>
            </div>
          )}
        </div>

        {/* Flag Panel */}
        {showFlag && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 space-y-2">
            <div className="flex gap-2">
              <Select id="flag-type" value={flagType} onChange={e => setFlagType(e.target.value)} className="text-xs flex-1">
                <option value="quality_issue">Quality Issue</option>
                <option value="missing_data">Missing Data</option>
                <option value="client_specs">Client Spec Issue</option>
              </Select>
              <Select id="flag-sev" value={flagSeverity} onChange={e => setFlagSeverity(e.target.value)} className="text-xs">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </Select>
            </div>
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs rounded-lg border border-amber-200 px-3 py-1.5 focus:ring-amber-500 focus:border-amber-500"
                placeholder="Describe the issue..."
                value={flagDescription}
                onChange={e => setFlagDescription(e.target.value)}
              />
              <Button size="sm" onClick={handleFlag} disabled={!flagDescription}>Submit</Button>
            </div>
          </div>
        )}

        {/* Help Panel */}
        {showHelp && (
          <div className="px-6 py-3 bg-blue-50 border-b border-blue-100">
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs rounded-lg border border-blue-200 px-3 py-1.5 focus:ring-blue-500 focus:border-blue-500"
                placeholder="What do you need help with?"
                value={helpQuestion}
                onChange={e => setHelpQuestion(e.target.value)}
              />
              <Button size="sm" onClick={handleHelp} disabled={!helpQuestion}>Ask</Button>
            </div>
          </div>
        )}

        {/* Order Info */}
        <div className="px-6 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-slate-400">Priority</span>
              <div className={`font-semibold mt-0.5 ${order.priority === 'urgent' ? 'text-red-600' : order.priority === 'high' ? 'text-amber-600' : 'text-slate-700'}`}>
                {order.priority}
              </div>
            </div>
            <div>
              <span className="text-slate-400">Due Date</span>
              <div className="font-semibold text-slate-700 mt-0.5">{order.due_date ? new Date(order.due_date).toLocaleDateString() : '—'}</div>
            </div>
            <div>
              <span className="text-slate-400">Client Ref</span>
              <div className="font-semibold text-slate-700 mt-0.5">{order.client_reference || '—'}</div>
            </div>
            <div>
              <span className="text-slate-400">Rejection Count</span>
              <div className="font-semibold text-slate-700 mt-0.5">{(order as any).rejection_count ?? 0}</div>
            </div>
          </div>
          {order.rejection_reason && (
            <div className="mt-2 p-2 bg-rose-50 rounded-lg text-xs text-rose-700">
              <span className="font-medium">Previous Rejection:</span> {order.rejection_reason}
            </div>
          )}
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-100">
          {[
            { id: 'checklist' as const, label: 'Quality Checklist', icon: CheckCircle2 },
            { id: 'notes' as const, label: 'Notes', icon: MessageSquare },
            { id: 'history' as const, label: 'History', icon: History },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === tab.id
                ? 'border-brand-500 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              {/* Checklist Tab */}
              {activeTab === 'checklist' && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <label htmlFor="qa-area" className="mb-1.5 block text-xs font-semibold text-slate-700">
                      Area
                    </label>
                    <input
                      id="qa-area"
                      type="text"
                      value={editableArea}
                      onChange={e => setEditableArea(e.target.value)}
                      placeholder="Please write area with its unit"
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>
                  {/* PH_2_LAYER Photo Selections */}
                  {isPh2Layer && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <label className="mb-2 block text-xs font-semibold text-slate-700">Photo Selections</label>
                      <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
                        {[
                          { stateKey: 'totalImages' as const, value: totalImages, setter: setTotalImages },
                          { stateKey: 'normalImages' as const, value: normalImages, setter: setNormalImages },
                          { stateKey: 'hdrImages' as const, value: hdrImages, setter: setHdrImages },
                          { stateKey: 'editImages' as const, value: editImages, setter: setEditImages },
                          { stateKey: 'finalImages' as const, value: finalImages, setter: setFinalImages },
                        ].filter((stateField) => imageCountFields.some((field) => field.stateKey === stateField.stateKey)).map((stateField) => {
                          const field = imageCountFields.find((item) => item.stateKey === stateField.stateKey)!;

                          return (
                            <div key={field.label}>
                              <label className="block text-xs text-slate-500 mb-1">{field.label}</label>
                              <input
                                type="number"
                                min="0"
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                                placeholder="0"
                                value={stateField.value}
                                onChange={e => stateField.setter(e.target.value)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <QAClientPortalUpload order={order} onStatusChange={setClientPortalStatus} />

                  {!isPh2Layer && checklist.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => toggleCheck(item.id)}
                      className={`w-full flex items-start gap-3 p-4 rounded-xl border transition-all text-left ${item.checked
                        ? 'border-emerald-200 bg-emerald-50/50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                    >
                      {item.checked ? (
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
                      ) : (
                        <Circle className="h-5 w-5 text-slate-300 mt-0.5 flex-shrink-0" />
                      )}
                      <div>
                        <div className={`text-sm font-medium ${item.checked ? 'text-emerald-800' : 'text-slate-900'}`}>
                          {item.label}
                        </div>
                        <div className={`text-xs mt-0.5 ${item.checked ? 'text-emerald-600' : 'text-slate-500'}`}>
                          {item.description}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Notes Tab */}
              {activeTab === 'notes' && (
                <div className="space-y-4">
                  <Textarea
                    id="qa-notes"
                    label="QA Notes"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Add any observations, special notes, or feedback for the team..."
                    rows={8}
                    showCharCount
                    maxLength={1000}
                    currentLength={notes.length}
                  />
                  {metadata.client_standards && (
                    <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
                      <span className="font-medium">Client Standards:</span> {metadata.client_standards}
                    </div>
                  )}
                </div>
              )}

              {/* History Tab */}
              {activeTab === 'history' && details && (
                <div className="space-y-4">
                  {details.work_items && details.work_items.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Work History</h4>
                      <div className="space-y-2">
                        {details.work_items
                          .filter((item) => item.comments || item.rework_reason || item.rejection_code)
                          .map((item) => (
                            <div key={item.id} className="p-3 bg-slate-50 rounded-lg text-xs">
                              <div className="mb-1 flex flex-wrap items-center gap-2 text-slate-500">
                                <span className="font-semibold text-slate-700">{item.stage}</span>
                                {item.assignedUser?.name && <span>{item.assignedUser.name}</span>}
                                {item.completed_at && <span>{new Date(item.completed_at).toLocaleString()}</span>}
                              </div>
                              {item.comments && (
                                <div className="whitespace-pre-wrap text-slate-700">{item.comments}</div>
                              )}
                              {item.rework_reason && (
                                <div className="mt-1 text-rose-700">Rework: {item.rework_reason}</div>
                              )}
                              {item.rejection_code && (
                                <div className="mt-1 text-rose-700">Code: {item.rejection_code}</div>
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                  {details.help_requests && details.help_requests.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Help Requests</h4>
                      <div className="space-y-2">
                        {details.help_requests.map((hr: any, i: number) => (
                          <div key={i} className="p-3 bg-slate-50 rounded-lg text-xs">
                            <span className="text-slate-700">{hr.question || hr.description || JSON.stringify(hr)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {details.issue_flags && details.issue_flags.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Issue Flags</h4>
                      <div className="space-y-1.5">
                        {details.issue_flags.map((flag: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-xs py-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                            <span className="text-slate-700">{flag.description || JSON.stringify(flag)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {details.supervisor_notes && (
                    <div>
                      <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Supervisor Notes</h4>
                      <div className="p-3 bg-blue-50 rounded-lg text-xs text-blue-700">{details.supervisor_notes}</div>
                    </div>
                  )}
                  {(!details.work_items?.some((item) => item.comments || item.rework_reason || item.rejection_code) && !details.help_requests?.length && !details.issue_flags?.length && !details.supervisor_notes) && (
                    <div className="text-center py-8 text-sm text-slate-400">No history available for this order.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Reject Panel */}
        {showReject && (
          <div className="px-6 py-4 border-t border-rose-200 bg-rose-50 space-y-3">
            <h4 className="text-sm font-semibold text-rose-800">Reject Order</h4>
            <Select
              id="reject-code"
              label="Rejection Code"
              required
              value={rejectCode}
              onChange={e => setRejectCode(e.target.value)}
            >
              <option value="">Select reason code...</option>
              {REJECTION_CODES.map(c => (
                <option key={c} value={c}>{c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>
              ))}
            </Select>
            <Textarea
              id="reject-reason"
              label="Issue Details"
              required
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Describe the issue in detail (minimum 10 characters)..."
              rows={3}
              showCharCount
              maxLength={500}
              currentLength={rejectReason.length}
            />
            <Select
              id="route-to"
              label="Route to"
              value={routeTo}
              onChange={e => setRouteTo(e.target.value)}
              hint="Leave as Auto to route to the previous stage"
            >
              <option value="">Auto (previous stage)</option>
              <option value="draw">Drawing Stage</option>
              <option value="check">Checking Stage</option>
            </Select>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setShowReject(false)} className="flex-1">Cancel</Button>
              <Button
                variant="danger"
                onClick={handleReject}
                loading={submitting}
                disabled={!rejectCode || !rejectReason || rejectReason.length < 10}
                className="flex-1"
              >
                Confirm Reject
              </Button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        {!showReject && (
          <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center gap-3">
            <Button
              variant="danger"
              onClick={() => setShowReject(true)}
              icon={<X className="h-4 w-4" />}
              className="flex-1" >

              Reject
            </Button>
            <Button
              onClick={handleApprove}
              loading={submitting}
              disabled={
                (isPh2Layer ? !(totalImages || normalImages || hdrImages || editImages || finalImages) : !allChecked)
                || (clientPortalStatus?.required === true && !clientPortalStatus.submitted)
              }
              icon={<Send className="h-4 w-4" />}
              className="flex-[2] bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500/30"
            >
              {isPh2Layer ? 'Approve & Deliver' : allChecked ? 'Approve & Deliver' : `Complete Checklist (${checkedCount}/${checklist.length})`}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
