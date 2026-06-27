import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store/store';
import { liveQAService, type ProductChecklistItem, type ReviewChecklistItem, type ReviewData, type ReviewSubmissionPayload } from '../services';
import { Modal, Button } from './ui';
import { ShieldCheck, AlertTriangle, Plus, Minus, Loader2, CheckCircle, MessageSquare, Save, ClipboardList, Pencil, Trash2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Projects that show client_name after order_number ──────────────────────
// Add more project IDs here as needed in the future
const CLIENT_ADDRESS_PROJECT_IDS = [45, 42];

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: number;
  orderNumber: string;
  layer: string;
  onSaved?: () => void;
  /** When true, uses the Internal QA endpoints instead of the standard layer endpoints */
  isInternalQa?: boolean;
}

function normalizeReviewItems(rawItems: ReviewChecklistItem[]): ReviewChecklistItem[] {
  return rawItems.map((item) => ({
    ...item,
    text_value: item.text_value || '',
    count_value: Number(item.count_value || 0),
    is_checked: Boolean(item.is_checked || Number(item.count_value || 0) > 0),
  }));
}

function getChecklistMatchKey(item: Partial<ReviewChecklistItem>): string {
  const idPart = String(item.product_checklist_id ?? '').trim();
  if (idPart) return `id:${idPart}`;
  return `title:${String(item.title ?? '').trim().toLowerCase()}`;
}

export default function LiveQAChecklistModal({ open, onClose, projectId, orderNumber, layer, onSaved, isInternalQa = false }: Props) {
  const user = useSelector((state: RootState) => state.auth.user);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checklistsLoading, setChecklistsLoading] = useState(false);
  const [checklistSaving, setChecklistSaving] = useState(false);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [items, setItems] = useState<ReviewChecklistItem[]>([]);
  const [checklists, setChecklists] = useState<ProductChecklistItem[]>([]);
  const [showManageChecklist, setShowManageChecklist] = useState(false);
  const [showAddChecklist, setShowAddChecklist] = useState(false);
  const [newChecklistTitle, setNewChecklistTitle] = useState('');
  const [newChecklistClient, setNewChecklistClient] = useState('');
  const [editingChecklist, setEditingChecklist] = useState<ProductChecklistItem | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const canManageChecklist = ['ceo', 'director', 'checker', 'qa'].includes(user?.role || '');

  const checklistClientOptions = useMemo(() => {
    const options = new Set<string>();
    const orderClient = String(reviewData?.order?.client_name || '').trim();
    if (orderClient) options.add(orderClient);
    checklists.forEach((item) => {
      const client = String(item.client || '').trim();
      if (client) options.add(client);
    });
    return Array.from(options);
  }, [checklists, reviewData?.order?.client_name]);

  const resetChecklistForm = useCallback(() => {
    setShowAddChecklist(false);
    setNewChecklistTitle('');
    setNewChecklistClient(String(reviewData?.order?.client_name || '').trim());
    setEditingChecklist(null);
  }, [reviewData?.order?.client_name]);

  // ─── Fetch review checklist ─────────────────────────────────────────────
  // This fetches the pre-filled checklist for the order with any existing
  // comments (text_value) and mistake counts (count_value)
  const fetchReview = useCallback(async () => {
    if (!open || !orderNumber || !layer) {
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = isInternalQa
        ? await liveQAService.getInternalQaReview(projectId, orderNumber)
        : await liveQAService.getReview(projectId, orderNumber, layer);
      const data = ((res.data as { data?: ReviewData })?.data ?? res.data) as ReviewData;
      const qaItems = normalizeReviewItems(Array.isArray(data?.items) ? data.items : []);

      // For QA, keep the same checklist set as checker for the same order/project,
      // then overlay QA values so QA sees all checklist rows consistently.
      if (!isInternalQa && layer === 'qa') {
        try {
          const checkerRes = await liveQAService.getReview(projectId, orderNumber, 'checker');
          const checkerData = ((checkerRes.data as { data?: ReviewData })?.data ?? checkerRes.data) as ReviewData;
          const checkerItems = normalizeReviewItems(Array.isArray(checkerData?.items) ? checkerData.items : []);

          if (checkerItems.length > 0) {
            const qaByKey = new Map<string, ReviewChecklistItem>();
            qaItems.forEach((item) => {
              qaByKey.set(getChecklistMatchKey(item), item);
            });

            const mergedFromChecker = checkerItems.map((baseItem) => {
              const qaMatch = qaByKey.get(getChecklistMatchKey(baseItem));
              if (!qaMatch) return baseItem;

              return {
                ...baseItem,
                is_checked: qaMatch.is_checked,
                count_value: qaMatch.count_value,
                text_value: qaMatch.text_value,
                review_id: qaMatch.review_id,
                created_by: qaMatch.created_by,
                updated_at: qaMatch.updated_at,
              };
            });

            const checkerKeys = new Set(mergedFromChecker.map((item) => getChecklistMatchKey(item)));
            const qaOnlyItems = qaItems.filter((item) => !checkerKeys.has(getChecklistMatchKey(item)));

            setReviewData(data);
            setItems([...mergedFromChecker, ...qaOnlyItems]);
            return;
          }
        } catch {
          // If checker baseline is unavailable, use QA items directly.
        }
      }

      setReviewData(data);
      setItems(qaItems);
    } catch (err: any) {
      console.error('❌ Error fetching review:', err);
      console.error('❌ Response:', err.response);
      const status = err?.response?.status;
      setError(
        status === 403
          ? 'You do not have access to this Live QA layer/order.'
          : status === 422
            ? 'Order is not ready for Live QA yet.'
            : err.response?.data?.message || 'Failed to load review checklist'
      );
    } finally {
      setLoading(false);
    }
  }, [open, projectId, orderNumber, layer, isInternalQa]);

  useEffect(() => {
    fetchReview();
  }, [fetchReview]);

  const fetchChecklists = useCallback(async () => {
    if (!open || !canManageChecklist) return;

    setChecklistsLoading(true);
    try {
      const res = await liveQAService.getChecklists();
      setChecklists(res.data.data || []);
    } catch {
      setChecklists([]);
    } finally {
      setChecklistsLoading(false);
    }
  }, [canManageChecklist, open]);

  useEffect(() => {
    fetchChecklists();
  }, [fetchChecklists]);

  useEffect(() => {
    if (!newChecklistClient && reviewData?.order?.client_name) {
      setNewChecklistClient(String(reviewData.order.client_name).trim());
    }
  }, [newChecklistClient, reviewData?.order?.client_name]);

  // ─── Update item state ──────────────────────────────────────────────────
  const updateItem = (index: number, field: keyof ReviewChecklistItem, value: any) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  // ─── Toggle mistake flag ────────────────────────────────────────────────
  const toggleMistake = (index: number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const newChecked = !item.is_checked;
      return {
        ...item,
        is_checked: newChecked,
        count_value: newChecked ? Math.max(item.count_value, 1) : 0,
      };
    }));
  };

  // ─── Increment mistake count ────────────────────────────────────────────
  const incrementCount = (index: number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      return { ...item, count_value: item.count_value + 1, is_checked: true };
    }));
  };

  // ─── Decrement mistake count ────────────────────────────────────────────
  const decrementCount = (index: number) => {
    setItems(prev => prev.map((item, i) => {
      if (i !== index) return item;
      const newCount = Math.max(0, item.count_value - 1);
      return { ...item, count_value: newCount, is_checked: newCount > 0 };
    }));
  };

  // ─── Submit review with all inputs ──────────────────────────────────────
  // Payload includes:
  //   - product_checklist_id: which checklist item
  //   - is_checked: mistake flag
  //   - count_value: number of mistakes
  //   - text_value: comment/note about the mistake
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccessMsg('');
    try {
      const payload: ReviewSubmissionPayload = {
        items: items.map(item => ({
          product_checklist_id: item.product_checklist_id,
          is_checked: item.is_checked,
          count_value: item.count_value,
          text_value: item.text_value || '',
        })),
      };

      const res = isInternalQa
        ? await liveQAService.submitInternalQaReview(projectId, orderNumber, payload)
        : await liveQAService.submitReview(projectId, orderNumber, layer, payload);
      setSuccessMsg(res.data.message || 'Review saved successfully');
      onSaved?.();
      setTimeout(() => {
        setSuccessMsg('');
        onClose();
      }, 2000);
    } catch (err: any) {
      console.error('❌ Error submitting review:', err);
      console.error('❌ Response:', err.response);
      const status = err?.response?.status;
      const errorMsg = status === 403
        ? 'You do not have access to this Live QA layer/order.'
        : status === 422
          ? 'Order is not ready for Live QA yet.'
          : err.response?.data?.message || err.message || 'Failed to save review';
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const totalMistakes = items.reduce((sum, item) => sum + item.count_value, 0);
  const itemsWithMistakes = items.filter(item => item.is_checked).length;
  const reviewedItemsCount = items.filter((item) => item.is_checked || item.count_value > 0 || Boolean(item.text_value?.trim())).length;

  const handleAddChecklist = async () => {
    if (!newChecklistTitle.trim()) return;

    setChecklistSaving(true);
    setError('');
    try {
      await liveQAService.createChecklist({
        title: newChecklistTitle.trim(),
        check_list_type_id: 1,
        client: (newChecklistClient || reviewData?.order?.client_name || '').trim(),
      });
      resetChecklistForm();
      await Promise.all([fetchChecklists(), fetchReview()]);
      setSuccessMsg('Checklist item added successfully');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to add checklist item');
    } finally {
      setChecklistSaving(false);
    }
  };

  const handleUpdateChecklist = async () => {
    if (!editingChecklist || !editingChecklist.title.trim()) return;

    setChecklistSaving(true);
    setError('');
    try {
      await liveQAService.updateChecklist(editingChecklist.id, {
        title: editingChecklist.title.trim(),
        client: String(editingChecklist.client || '').trim(),
      });
      setEditingChecklist(null);
      await Promise.all([fetchChecklists(), fetchReview()]);
      setSuccessMsg('Checklist item updated successfully');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to update checklist item');
    } finally {
      setChecklistSaving(false);
    }
  };

  const handleDeleteChecklist = async (id: number) => {
    if (!window.confirm('Deactivate this checklist item?')) return;

    setChecklistSaving(true);
    setError('');
    try {
      await liveQAService.deleteChecklist(id);
      if (editingChecklist?.id === id) {
        setEditingChecklist(null);
      }
      await Promise.all([fetchChecklists(), fetchReview()]);
      setSuccessMsg('Checklist item deactivated successfully');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to deactivate checklist item');
    } finally {
      setChecklistSaving(false);
    }
  };

  const layerLabel = layer === 'drawer' ? 'Drawer' : layer === 'checker' ? 'Checker' : 'QA';
  const layerColor = layer === 'drawer' ? 'blue' : layer === 'checker' ? 'amber' : 'rose';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Live QA Review — ${layerLabel}`}
      subtitle={reviewData?.order ? `Order: ${reviewData.order.order_number}` : undefined}
      size="xl"
      icon={ShieldCheck}
      variant="default"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-500">
              Mistakes: <span className={`font-bold ${totalMistakes > 0 ? 'text-rose-600' : 'text-brand-600'}`}>{totalMistakes}</span>
            </span>
            <span className="text-slate-500">
              Items flagged: <span className="font-semibold text-slate-700">{itemsWithMistakes}/{items.length}</span>
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={handleSave} disabled={saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <Save className="h-4 w-4 mr-1.5" />}
              Save Review
            </Button>
          </div>
        </div>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-brand-500" />
        </div>
      ) : error && !reviewData ? (
        <div className="flex items-center justify-center py-16 text-rose-600">
          <AlertTriangle className="h-5 w-5 mr-2" />
          {error}
        </div>
      ) : (
        <div className="space-y-4">
          {canManageChecklist && (
            <div className="rounded-lg border border-slate-200 bg-slate-50/70">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <ClipboardList className="h-4 w-4 text-slate-500" />
                    Manage Checklist Items
                  </p>
                  <p className="text-xs text-slate-500">Add, update, or deactivate checklist items directly from Live QA.</p>
                </div>
                <div className="flex items-center gap-2">
                  {!showAddChecklist && (
                    <Button size="sm" variant="secondary" onClick={() => setShowAddChecklist(true)} disabled={checklistSaving}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Item
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => setShowManageChecklist((prev) => !prev)}>
                    {showManageChecklist ? 'Hide' : 'Show'}
                  </Button>
                </div>
              </div>

              <AnimatePresence>
                {(showManageChecklist || showAddChecklist) && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="border-t border-slate-200 px-4 py-4"
                  >
                    <div className="space-y-3">
                      {showAddChecklist && (
                        <div className="rounded-lg border border-brand-100 bg-white p-3">
                          <div className="flex flex-col gap-2 md:flex-row">
                            <select
                              value={newChecklistClient}
                              onChange={(e) => setNewChecklistClient(e.target.value)}
                              className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 md:w-52"
                              title="Select client"
                            >
                              <option value="">Select Client</option>
                              {checklistClientOptions.map((client) => (
                                <option key={client} value={client}>{client}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={newChecklistTitle}
                              onChange={(e) => setNewChecklistTitle(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddChecklist()}
                              placeholder="Checklist item title"
                              className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={handleAddChecklist} disabled={checklistSaving || !newChecklistTitle.trim()}>
                                Add
                              </Button>
                              <Button size="sm" variant="secondary" onClick={resetChecklistForm} disabled={checklistSaving}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      {checklistsLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
                        </div>
                      ) : checklists.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                          No checklist items yet.
                        </div>
                      ) : (
                        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                          <div className="max-h-64 overflow-auto">
                            <table className="w-full text-sm">
                              <thead className="sticky top-0 bg-slate-100 text-slate-600">
                                <tr>
                                  <th className="px-3 py-2 text-left text-xs font-semibold">Title</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold">Client</th>
                                  <th className="px-3 py-2 text-left text-xs font-semibold">Product</th>
                                  <th className="px-3 py-2 text-center text-xs font-semibold">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {checklists.map((checklist) => (
                                  <tr key={checklist.id} className="border-t border-slate-100">
                                    <td className="px-3 py-2">
                                      {editingChecklist?.id === checklist.id ? (
                                        <input
                                          type="text"
                                          value={editingChecklist.title}
                                          onChange={(e) => setEditingChecklist({ ...editingChecklist, title: e.target.value })}
                                          onKeyDown={(e) => e.key === 'Enter' && handleUpdateChecklist()}
                                          className="w-full rounded-md border border-brand-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                                        />
                                      ) : (
                                        <span className="font-medium text-slate-800">{checklist.title}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-slate-600">
                                      {editingChecklist?.id === checklist.id ? (
                                        <select
                                          value={editingChecklist.client || ''}
                                          onChange={(e) => setEditingChecklist({ ...editingChecklist, client: e.target.value })}
                                          className="w-full rounded-md border border-brand-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                                          title="Edit client"
                                        >
                                          <option value="">Select Client</option>
                                          {checklistClientOptions.map((client) => (
                                            <option key={client} value={client}>{client}</option>
                                          ))}
                                        </select>
                                      ) : (
                                        String(checklist.client || '')
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-slate-600">{String(checklist.product || '')}</td>
                                    <td className="px-3 py-2">
                                      <div className="flex items-center justify-center gap-1">
                                        {editingChecklist?.id === checklist.id ? (
                                          <>
                                            <button
                                              onClick={handleUpdateChecklist}
                                              disabled={checklistSaving || !editingChecklist.title.trim()}
                                              className="rounded-md p-1.5 text-brand-600 transition-colors hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
                                              title="Save"
                                            >
                                              <CheckCircle className="h-4 w-4" />
                                            </button>
                                            <button
                                              onClick={() => setEditingChecklist(null)}
                                              disabled={checklistSaving}
                                              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
                                              title="Cancel"
                                            >
                                              <X className="h-4 w-4" />
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <button
                                              onClick={() => {
                                                setShowManageChecklist(true);
                                                setEditingChecklist({ ...checklist });
                                              }}
                                              disabled={checklistSaving}
                                              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-brand-50 hover:text-brand-600 disabled:opacity-50"
                                              title="Edit"
                                            >
                                              <Pencil className="h-4 w-4" />
                                            </button>
                                            <button
                                              onClick={() => handleDeleteChecklist(checklist.id)}
                                              disabled={checklistSaving}
                                              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                                              title="Deactivate"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          {/* Order Info Bar */}
          {reviewData?.order && (
            <div className={`bg-${layerColor}-50 border border-${layerColor}-200 rounded-lg p-3`}>
              <div className={`grid grid-cols-2 gap-3 text-sm ${CLIENT_ADDRESS_PROJECT_IDS.includes(projectId) ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
                <div>
                  <span className="text-slate-500 text-xs">Order</span>
                  <p className="font-semibold text-slate-800">{reviewData.order.order_number}</p>
                </div>
                {CLIENT_ADDRESS_PROJECT_IDS.includes(projectId) && (
                  <div>
                    <span className="text-slate-500 text-xs">Client</span>
                    <p className="font-semibold text-slate-800">{reviewData.order.client_name || '—'}</p>
                  </div>
                )}
                <div>
                  <span className="text-slate-500 text-xs">Address</span>
                  <p className="font-medium text-slate-700 whitespace-normal break-words">{reviewData.order.address || '—'}</p>
                </div>
                <div>
                  <span className="text-slate-500 text-xs">Worker ({layerLabel})</span>
                  <p className="font-semibold text-slate-800">{reviewData.worker_name || '—'}</p>
                </div>
                <div>
                  <span className="text-slate-500 text-xs">Status</span>
                  <p className="font-medium text-brand-700">
                    {reviewedItemsCount}/{items.length} reviewed
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error/Success messages */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-2 rounded-lg text-sm flex items-center gap-2"
              >
                <AlertTriangle className="h-4 w-4" /> {error}
              </motion.div>
            )}
            {successMsg && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="bg-brand-50 border border-brand-200 text-brand-700 px-4 py-2 rounded-lg text-sm flex items-center gap-2"
              >
                <CheckCircle className="h-4 w-4" /> {successMsg}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Checklist Items */}
          <div className="space-y-2">
            {items.map((item, index) => (
              <motion.div
                key={item.product_checklist_id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.03 }}
                className={`rounded-lg border p-3 transition-all duration-200 ${item.is_checked
                  ? 'bg-rose-50 border-rose-200 ring-1 ring-rose-200'
                  : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
              >
                <div className="flex items-start gap-3">
                  {/* Mistake Toggle */}
                  <button
                    onClick={() => toggleMistake(index)}
                    className={`mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${item.is_checked
                      ? 'bg-rose-500 border-rose-500 text-white'
                      : 'border-slate-300 hover:border-slate-400'
                      }`}
                  >
                    {item.is_checked && <AlertTriangle className="h-3.5 w-3.5" />}
                  </button>

                  {/* Item Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium ${item.is_checked ? 'text-rose-800' : 'text-slate-700'}`}>
                        {item.title}
                      </span>

                      {/* Count Controls */}
                      <div className="flex items-center gap-1.5 shrink-0 ml-2">
                        <button
                          onClick={() => decrementCount(index)}
                          className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className={`w-8 text-center text-sm font-bold ${item.count_value > 0 ? 'text-rose-600' : 'text-slate-400'
                          }`}>
                          {item.count_value}
                        </span>
                        <button
                          onClick={() => incrementCount(index)}
                          className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-600 transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Comment Input - only show when mistake is checked */}
                    {item.is_checked && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-2"
                      >
                        <div className="relative">
                          <MessageSquare className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                          <input
                            type="text"
                            value={item.text_value}
                            onChange={(e) => updateItem(index, 'text_value', e.target.value)}
                            placeholder="Comment (e.g., Kitchen hobe wrong)"
                            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 placeholder:text-slate-400"
                          />
                        </div>
                      </motion.div>
                    )}

                    {/* Show existing review info */}
                    {item.created_by && item.updated_at && (
                      <p className="text-[11px] text-slate-400 mt-1">
                        Reviewed by {item.created_by} · {new Date(item.updated_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {items.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              <ShieldCheck className="h-10 w-10 mx-auto mb-2 text-slate-300" />
              <p className="text-sm">No checklist items configured.</p>
              <p className="text-xs text-slate-400 mt-1">
                {canManageChecklist ? 'Use Manage Checklist Items above to add one.' : 'Ask a Director, CEO, or Live QA lead to add checklist items.'}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
