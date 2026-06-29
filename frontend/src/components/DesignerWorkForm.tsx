import { useState, useEffect, useRef } from 'react';
import type { Order } from '../types';
import { workflowService } from '../services';
import { Button, Textarea } from './ui';
import { Palette, Clock, X, Flag, HelpCircle, Send, MessageSquare, History, Image, Sliders, Paintbrush } from 'lucide-react';

interface DesignerWorkFormProps {
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
}

type ImageCountStateKey = 'totalImages' | 'hdrImages' | 'editImages' | 'normalImages' | 'finalImages';
type ImageCountPayloadKey =
  | 'total_raw_files'
  | 'hdr_images_count'
  | 'single_images_count'
  | 'final_images_count'
  | 'edited_images_count';

interface ImageCountFieldConfig {
  stateKey: ImageCountStateKey;
  label: string;
  metadataKeys: string[];
  payloadKey?: ImageCountPayloadKey;
}

const DEFAULT_IMAGE_COUNT_FIELDS: ImageCountFieldConfig[] = [
  { stateKey: 'totalImages', label: 'Total Images', metadataKeys: ['total_images', 'totalImages'] },
  { stateKey: 'hdrImages', label: 'HDR Images', metadataKeys: ['hdr_images', 'hdrImages'] },
  { stateKey: 'editImages', label: 'Edit Images', metadataKeys: ['edit_images', 'editImages'] },
  { stateKey: 'normalImages', label: 'Normal Images', metadataKeys: ['normal_images', 'normalImages', 'normal_final_images', 'normalFinalImages'] },
  { stateKey: 'finalImages', label: 'Final Images', metadataKeys: ['final_images', 'finalImages'] },
];

const PROJECT_IMAGE_COUNT_FIELDS: Record<number, ImageCountFieldConfig[]> = {
  17: [
    { stateKey: 'totalImages', label: 'Total Raw Files', metadataKeys: ['total_raw_files', 'totalImages'], payloadKey: 'total_raw_files' },
    { stateKey: 'hdrImages', label: 'HDR Images', metadataKeys: ['hdr_images_count', 'hdr_images', 'hdrImages'], payloadKey: 'hdr_images_count' },
    { stateKey: 'editImages', label: 'Edited Images', metadataKeys: ['edited_images_count', 'edit_images', 'editImages'], payloadKey: 'edited_images_count' },
    { stateKey: 'normalImages', label: 'Single Images', metadataKeys: ['single_images_count', 'normal_images', 'normalImages', 'normal_final_images', 'normalFinalImages'], payloadKey: 'single_images_count' },
    { stateKey: 'finalImages', label: 'Final Images', metadataKeys: ['final_images_count', 'final_images', 'finalImages'], payloadKey: 'final_images_count' },
  ],
  52: [
    { stateKey: 'totalImages', label: 'Images', metadataKeys: ['total_raw_files', 'images', 'totalImages'], payloadKey: 'total_raw_files' },
    { stateKey: 'hdrImages', label: 'General QA Image', metadataKeys: ['hdr_images_count', 'hdrImages'], payloadKey: 'hdr_images_count' },
    { stateKey: 'normalImages', label: 'Human Edit', metadataKeys: ['single_images_count', 'normalImages'], payloadKey: 'single_images_count' },
    { stateKey: 'finalImages', label: 'GDPR', metadataKeys: ['final_images_count', 'finalImages'], payloadKey: 'final_images_count' },
    { stateKey: 'editImages', label: 'Edited Images', metadataKeys: ['edited_images_count', 'editImages'], payloadKey: 'edited_images_count' },
  ],
};

type ImageCountSyncPayload = {
  project_id: number;
  total_raw_files?: string | null;
  hdr_images_count?: number | null;
  single_images_count?: number | null;
  final_images_count?: number | null;
  edited_images_count?: number | null;
};

export default function DesignerWorkForm({ order, onComplete, onClose }: DesignerWorkFormProps) {
  const [details, setDetails] = useState<OrderDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<'form' | 'notes' | 'history'>('form');
  const [comment, setComment] = useState('');

  // Design fields
  const [enhancementType, setEnhancementType] = useState('standard');
  const [colorCorrection, setColorCorrection] = useState(false);
  const [perspectiveFixed, setPerspectiveFixed] = useState(false);
  const [objectRemoval, setObjectRemoval] = useState(false);
  const [skyReplacement, setSkyReplacement] = useState(false);
  const [virtualStaging, setVirtualStaging] = useState(false);
  const [outputNotes, setOutputNotes] = useState('');

  // PH_2_LAYER image counts
  const isPh2Layer = order.workflow_type === 'PH_2_LAYER';
  const imageCountFields = PROJECT_IMAGE_COUNT_FIELDS[order.project_id] ?? DEFAULT_IMAGE_COUNT_FIELDS;
  const [totalImages, setTotalImages] = useState('');
  const [hdrImages, setHdrImages] = useState('');
  const [editImages, setEditImages] = useState('');
  const [normalImages, setNormalImages] = useState('');
  const [finalImages, setFinalImages] = useState('');

  // Flag/Help
  const [showFlag, setShowFlag] = useState(false);
  const [flagDescription, setFlagDescription] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [helpQuestion, setHelpQuestion] = useState('');

  // Pending hold
  const [showPending, setShowPending] = useState(false);
  const [pendingReason, setPendingReason] = useState('');

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

      const metadata = ((res.data?.order?.metadata || order.metadata || {}) as Record<string, unknown>);
      const detailOrder = (res.data?.order || order) as unknown as Record<string, unknown>;
      const getCount = (keys: string[]) => {
        for (const key of keys) {
          const value = detailOrder[key] ?? metadata[key];
          if (value === null || value === undefined || value === '') continue;
          return String(value);
        }
        return '';
      };

      const countsByState: Record<ImageCountStateKey, string> = {
        totalImages: '',
        hdrImages: '',
        editImages: '',
        normalImages: '',
        finalImages: '',
      };

      imageCountFields.forEach((field) => {
        countsByState[field.stateKey] = getCount(field.metadataKeys);
      });

      setTotalImages(countsByState.totalImages);
      setHdrImages(countsByState.hdrImages);
      setEditImages(countsByState.editImages);
      setNormalImages(countsByState.normalImages);
      setFinalImages(countsByState.finalImages);
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

  const handleSubmitDesign = async () => {
    setSubmitting(true);
    try {
      const tasks = [];
      if (colorCorrection) tasks.push('Color Correction');
      if (perspectiveFixed) tasks.push('Perspective Fix');
      if (objectRemoval) tasks.push('Object Removal');
      if (skyReplacement) tasks.push('Sky Replacement');
      if (virtualStaging) tasks.push('Virtual Staging');

      const imageCountValues: Record<ImageCountStateKey, string> = {
        totalImages,
        hdrImages,
        editImages,
        normalImages,
        finalImages,
      };
      const imageCounts = isPh2Layer && imageCountFields.some((field) => imageCountValues[field.stateKey])
        ? `Images - ${imageCountFields.map((field) => `${field.label}: ${imageCountValues[field.stateKey] || 0}`).join(', ')}`
        : null;

      const summary = [
        `Enhancement: ${enhancementType}`,
        tasks.length > 0 ? `Tasks: ${tasks.join(', ')}` : null,
        imageCounts,
        outputNotes ? `Output notes: ${outputNotes}` : null,
        comment ? `Comments: ${comment}` : null,
      ].filter(Boolean).join('\n');

      await workflowService.submitWork(order.id, summary);

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
        const parsedHdrImages = parseOptionalCount(hdrImages);
        const parsedEditImages = parseOptionalCount(editImages);
        const parsedNormalImages = parseOptionalCount(normalImages);
        const parsedFinalImages = parseOptionalCount(finalImages);

        const parsedByState: Record<ImageCountStateKey, number | null> = {
          totalImages: parsedTotalImages,
          hdrImages: parsedHdrImages,
          editImages: parsedEditImages,
          normalImages: parsedNormalImages,
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
            console.warn('Submit succeeded, but image count sync failed.', syncError);
          }
        }
      }

      onComplete();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleRelease = async () => {
    try {
      await workflowService.reassignToQueue(order.id, 'Released by designer');
      onComplete();
    } catch (e) { console.error(e); }
  };

  const handlePending = async () => {
    if (!pendingReason || pendingReason.length < 10) return;
    setSubmitting(true);
    try {
      await workflowService.holdOrder(order.id, pendingReason);
      onComplete();
    } catch (e) { console.error(e); }
    finally { setSubmitting(false); }
  };

  const handleFlag = async () => {
    if (!flagDescription) return;
    try {
      await workflowService.flagIssue(order.id, 'quality_issue', flagDescription, 'medium');
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

  const formatTime = (raw: number) => {
    const s = Math.max(0, Math.floor(raw));
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m ${s % 60}s` : `${m}m ${s % 60}s`;
  };

  const metadata = (order.metadata || {}) as Record<string, string>;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative ml-auto w-full max-w-2xl bg-white shadow-2xl flex flex-col h-full overflow-hidden animate-slide-in-right">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="p-2 bg-pink-100 rounded-lg">
              <Palette className="h-5 w-5 text-pink-700" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">Design Work</h2>
              <p className="text-xs leading-snug text-slate-500 break-words">{order.order_number} · {metadata.address || order.client_reference || '—'}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
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
          <button
            onClick={handleRelease}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors ml-auto"
          >
            Release to Queue
          </button>
        </div>

        {/* Flag Panel */}
        {showFlag && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-100">
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

        {/* Order Info Bar */}
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
              <span className="text-slate-400">Enhancement</span>
              <div className="font-semibold text-slate-700 mt-0.5">{metadata.enhancement_type || 'Standard'}</div>
            </div>
            <div>
              <span className="text-slate-400">Style</span>
              <div className="font-semibold text-slate-700 mt-0.5">{metadata.style || '—'}</div>
            </div>
          </div>
          {metadata.design_notes && (
            <div className="mt-2 p-2 bg-pink-50 rounded-lg text-xs text-pink-700">
              <span className="font-medium">Design Notes:</span> {metadata.design_notes}
            </div>
          )}
        </div>

        {/* Tab Bar */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-100">
          {[
            { id: 'form' as const, label: 'Design Form', icon: Paintbrush },
            { id: 'notes' as const, label: 'Notes', icon: MessageSquare },
            { id: 'history' as const, label: 'History', icon: History },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${activeTab === tab.id
                ? 'border-pink-500 text-pink-700'
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
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : (
            <>
              {/* Design Form Tab */}
              {activeTab === 'form' && (
                <div className="space-y-5">
                  {/* Enhancement Type */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Enhancement Type</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['standard', 'premium', 'custom'].map(type => (
                        <button
                          key={type}
                          onClick={() => setEnhancementType(type)}
                          className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${enhancementType === type
                            ? 'bg-pink-500 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                            }`}
                        >
                          {type.charAt(0).toUpperCase() + type.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Enhancement Tasks */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Tasks Performed</label>
                    <div className="space-y-2">
                      {[
                        { state: colorCorrection, setter: setColorCorrection, label: 'Color Correction', desc: 'White balance, exposure, saturation adjustments', icon: Sliders },
                        { state: perspectiveFixed, setter: setPerspectiveFixed, label: 'Perspective Correction', desc: 'Vertical/horizontal line corrections', icon: Image },
                        { state: objectRemoval, setter: setObjectRemoval, label: 'Object Removal', desc: 'Removed unwanted objects from scene', icon: X },
                        { state: skyReplacement, setter: setSkyReplacement, label: 'Sky Replacement', desc: 'Replaced sky with enhanced version', icon: Image },
                        { state: virtualStaging, setter: setVirtualStaging, label: 'Virtual Staging', desc: 'Added virtual furniture/elements', icon: Paintbrush },
                      ].map(task => (
                        <button
                          key={task.label}
                          onClick={() => task.setter(!task.state)}
                          className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${task.state
                            ? 'border-pink-200 bg-pink-50/50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}
                        >
                          <div className={`p-1.5 rounded-lg ${task.state ? 'bg-pink-100' : 'bg-slate-100'}`}>
                            <task.icon className={`h-4 w-4 ${task.state ? 'text-pink-600' : 'text-slate-400'}`} />
                          </div>
                          <div>
                            <div className={`text-sm font-medium ${task.state ? 'text-pink-800' : 'text-slate-700'}`}>{task.label}</div>
                            <div className="text-xs text-slate-500">{task.desc}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* PH_2_LAYER Image Counts */}
                  {isPh2Layer && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-2">Image Counts</label>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { stateKey: 'totalImages' as const, value: totalImages, setter: setTotalImages },
                          { stateKey: 'hdrImages' as const, value: hdrImages, setter: setHdrImages },
                          { stateKey: 'editImages' as const, value: editImages, setter: setEditImages },
                          { stateKey: 'normalImages' as const, value: normalImages, setter: setNormalImages },
                          { stateKey: 'finalImages' as const, value: finalImages, setter: setFinalImages },
                        ].filter((stateField) => imageCountFields.some((field) => field.stateKey === stateField.stateKey)).map((stateField) => {
                          const field = imageCountFields.find((item) => item.stateKey === stateField.stateKey)!;

                          return (
                            <div key={field.label}>
                              <label className="block text-xs text-slate-500 mb-1">{field.label}</label>
                              <input
                                type="number"
                                min="0"
                                className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 focus:ring-pink-500 focus:border-pink-500"
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

                  {/* Output Notes */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2">Output Notes</label>
                    <textarea
                      className="w-full text-sm rounded-lg border border-slate-200 px-3 py-2 focus:ring-pink-500 focus:border-pink-500 placeholder:text-slate-400"
                      placeholder="Any notes about the output (format, resolution, special handling)..."
                      value={outputNotes}
                      onChange={e => setOutputNotes(e.target.value)}
                      rows={3}
                    />
                  </div>
                </div>
              )}

              {/* Notes Tab */}
              {activeTab === 'notes' && (
                <Textarea
                  id="designer-notes"
                  label="Designer Notes"
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Add any observations or feedback..."
                  rows={8}
                  showCharCount
                  maxLength={1000}
                  currentLength={comment.length}
                />
              )}

              {/* History Tab */}
              {activeTab === 'history' && details && (
                <div className="space-y-4">
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
                  {(!details.help_requests?.length && !details.issue_flags?.length && !details.supervisor_notes) && (
                    <div className="text-center py-8 text-sm text-slate-400">No history available for this order.</div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Pending panel */}
        {showPending && (
          <div className="px-6 py-4 border-t border-amber-200 bg-amber-50 space-y-3">
            <h4 className="text-sm font-semibold text-amber-800">Move to Pending</h4>
            <Textarea
              id="pending-reason"
              label="Reason"
              required
              value={pendingReason}
              onChange={e => setPendingReason(e.target.value)}
              placeholder="Explain why this needs to be pending (min 10 chars)..."
              rows={3}
              showCharCount
              maxLength={300}
              currentLength={pendingReason.length}
            />
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setShowPending(false)} className="flex-1">Cancel</Button>
              <Button onClick={handlePending} loading={submitting} disabled={!pendingReason || pendingReason.length < 10} className="flex-1 bg-amber-500 hover:bg-amber-600">
                Confirm Pending
              </Button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        {!showPending && (
          <div className="px-6 py-4 border-t border-slate-200 bg-white flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowPending(true)}
              icon={<Clock className="h-4 w-4" />}
            >
              Pending
            </Button>
            <Button
              onClick={handleSubmitDesign}
              loading={submitting}
              icon={<Send className="h-4 w-4" />}
              className="flex-1 bg-pink-600 hover:bg-pink-700 focus-visible:ring-pink-500/30"
            >
              Submit Design
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
