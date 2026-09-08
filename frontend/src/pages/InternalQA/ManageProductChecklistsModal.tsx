import React, { useState, useEffect, useMemo } from 'react';
import { liveQAService, type ProductChecklistItem } from '../../services';
import {
  X,
  Plus,
  Pencil,
  Trash2,
  Check,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Search,
  Filter,
} from 'lucide-react';

interface ManageProductChecklistsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projects: Array<{ id: number; name: string }>;
  defaultProjectId?: number;
  onUpdated?: () => void;
}

export const ManageProductChecklistsModal: React.FC<ManageProductChecklistsModalProps> = ({
  isOpen,
  onClose,
  projects,
  defaultProjectId = 0,
  onUpdated,
}) => {
  const [items, setItems] = useState<ProductChecklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<number | 'all'>(
    defaultProjectId > 0 ? defaultProjectId : 'all'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Add Item State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newProjectId, setNewProjectId] = useState<number | ''>(
    defaultProjectId > 0 ? defaultProjectId : ''
  );
  const [newClient, setNewClient] = useState('');
  const [newProduct, setNewProduct] = useState('FP');
  const [newTypeId, setNewTypeId] = useState<number>(1); // 1: drawer, 2: checker, 3: qa

  // Edit Item State
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editProjectId, setEditProjectId] = useState<number | ''>('');
  const [editClient, setEditClient] = useState('');
  const [editProduct, setEditProduct] = useState('FP');
  const [editTypeId, setEditTypeId] = useState<number>(1);

  useEffect(() => {
    if (isOpen) {
      fetchItems();
      if (defaultProjectId > 0) {
        setSelectedProjectFilter(defaultProjectId);
        setNewProjectId(defaultProjectId);
      }
    } else {
      setError(null);
      setSuccessMsg(null);
      setShowAddForm(false);
      setEditingId(null);
    }
  }, [isOpen, defaultProjectId]);

  const fetchItems = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await liveQAService.getChecklists();
      setItems(res.data?.data || []);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load checklist items.');
    } finally {
      setLoading(false);
    }
  };

  // Distinct client names for autocomplete/suggestions
  const clientOptions = useMemo(() => {
    const set = new Set<string>();
    items.forEach((item) => {
      const c = String(item.client || '').trim();
      if (c) set.add(c);
    });
    return Array.from(set);
  }, [items]);

  // Project map for easy lookup
  const projectMap = useMemo(() => {
    const map = new Map<number, string>();
    projects.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [projects]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Filter by Project
      if (selectedProjectFilter !== 'all') {
        const itemPid = item.project_id ? Number(item.project_id) : null;
        if (itemPid !== Number(selectedProjectFilter)) {
          return false;
        }
      }

      // Filter by Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = item.title?.toLowerCase().includes(q);
        const clientMatch = item.client?.toLowerCase().includes(q);
        const productMatch = item.product?.toLowerCase().includes(q);
        return titleMatch || clientMatch || productMatch;
      }

      return true;
    });
  }, [items, selectedProjectFilter, searchQuery]);

  const handleCreate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTitle.trim()) {
      setError('Checklist title is required.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccessMsg(null);

      const payload = {
        title: newTitle.trim(),
        project_id: newProjectId !== '' ? Number(newProjectId) : null,
        client: newClient.trim() || undefined,
        product: newProduct.trim() || 'FP',
        check_list_type_id: newTypeId,
      };

      const res = await liveQAService.createChecklist(payload);
      if (res.data?.data) {
        setItems((prev) => [...prev, res.data.data]);
        setSuccessMsg(`Checklist item "${newTitle}" added with Project ID ${newProjectId || 'Global'}!`);
        setNewTitle('');
        setShowAddForm(false);
        if (onUpdated) onUpdated();
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Error creating checklist item.');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (item: ProductChecklistItem) => {
    setEditingId(item.id);
    setEditTitle(item.title || '');
    setEditProjectId(item.project_id ? Number(item.project_id) : '');
    setEditClient(item.client || '');
    setEditProduct(item.product || 'FP');
    setEditTypeId(item.check_list_type_id || 1);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const handleUpdate = async (id: number) => {
    if (!editTitle.trim()) {
      setError('Checklist title cannot be empty.');
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccessMsg(null);

      const payload = {
        title: editTitle.trim(),
        project_id: editProjectId !== '' ? Number(editProjectId) : null,
        client: editClient.trim() || null,
        product: editProduct.trim() || 'FP',
        check_list_type_id: editTypeId,
      };

      const res = await liveQAService.updateChecklist(id, payload);
      if (res.data?.data) {
        setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...res.data.data } : item)));
        setSuccessMsg(`Checklist item #${id} updated successfully.`);
        setEditingId(null);
        if (onUpdated) onUpdated();
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Error updating checklist item.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: ProductChecklistItem) => {
    if (!window.confirm(`Are you sure you want to deactivate "${item.title}"?`)) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccessMsg(null);

      await liveQAService.deleteChecklist(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setSuccessMsg(`Checklist item "${item.title}" deactivated.`);
      if (onUpdated) onUpdated();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Error deactivating checklist item.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50/50 rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-600 text-white shadow-xs">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  Manage Product Checklists
                </h3>
                <span className="rounded bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700 border border-teal-200">
                  Database Table: product_checklists
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Add, edit, or configure checklist items with assigned Project IDs safely.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="mx-6 mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-3 bg-white">
          <div className="flex flex-wrap items-center gap-2 flex-1">
            {/* Project Filter */}
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1">
              <Filter className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-[11px] font-semibold text-slate-500">Project:</span>
              <select
                value={String(selectedProjectFilter)}
                onChange={(e) => {
                  const val = e.target.value === 'all' ? 'all' : Number(e.target.value);
                  setSelectedProjectFilter(val);
                  if (val !== 'all') {
                    setNewProjectId(val);
                  }
                }}
                className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer"
              >
                <option value="all">All Projects (Global & Assigned)</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (ID: {p.id})
                  </option>
                ))}
              </select>
            </div>

            {/* Search Box */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search checklist title, client..."
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowAddForm((prev) => !prev);
              if (!showAddForm && selectedProjectFilter !== 'all') {
                setNewProjectId(selectedProjectFilter);
              }
            }}
            className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-teal-700 transition"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{showAddForm ? 'Close Add Form' : 'Add New Checklist Item'}</span>
          </button>
        </div>

        {/* Add Item Panel (Collapsible) */}
        {showAddForm && (
          <div className="border-b border-teal-100 bg-teal-50/50 p-4 mx-6 my-3 rounded-lg border">
            <h4 className="text-xs font-bold text-teal-900 mb-2.5 flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5 text-teal-700" />
              <span>Add New Checklist Item with Project ID</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
              {/* Title */}
              <div className="md:col-span-2">
                <label className="text-[10px] font-bold uppercase text-slate-600 block mb-0.5">
                  Checklist Title *
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Wrong Labeling, Missing Elements..."
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-teal-500"
                />
              </div>

              {/* Project ID */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-600 block mb-0.5">
                  Assigned Project *
                </label>
                <select
                  value={newProjectId}
                  onChange={(e) => setNewProjectId(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:border-teal-500"
                >
                  <option value="">No Project (Global)</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (ID: {p.id})
                    </option>
                  ))}
                </select>
              </div>

              {/* Client */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-600 block mb-0.5">
                  Client (Optional)
                </label>
                <input
                  type="text"
                  list="client-suggestions"
                  value={newClient}
                  onChange={(e) => setNewClient(e.target.value)}
                  placeholder="e.g. BR, Code, Focal PB"
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-teal-500"
                />
                <datalist id="client-suggestions">
                  {clientOptions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              {/* Product */}
              <div>
                <label className="text-[10px] font-bold uppercase text-slate-600 block mb-0.5">
                  Product
                </label>
                <input
                  type="text"
                  value={newProduct}
                  onChange={(e) => setNewProduct(e.target.value)}
                  placeholder="FP"
                  className="w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-teal-500"
                />
              </div>

              {/* Type & Submit */}
              <div className="flex items-end gap-1.5">
                <div className="flex-1">
                  <label className="text-[10px] font-bold uppercase text-slate-600 block mb-0.5">
                    Type
                  </label>
                  <select
                    value={newTypeId}
                    onChange={(e) => setNewTypeId(Number(e.target.value))}
                    className="w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-800 outline-none focus:border-teal-500"
                  >
                    <option value={1}>1: Drawer</option>
                    <option value={2}>2: Checker</option>
                    <option value={3}>3: QA</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving || !newTitle.trim()}
                  className="flex items-center gap-1 rounded bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700 transition disabled:opacity-50 h-[30px]"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  <span>Save</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-500">
              <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
              <span className="text-xs">Loading checklist items from database...</span>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 p-6 text-center text-slate-500">
              <ClipboardList className="h-8 w-8 text-slate-300 mb-1" />
              <p className="text-xs font-semibold">No checklist items found for the current filter.</p>
              <p className="text-[11px] text-slate-400">
                Click "+ Add New Checklist Item" above to add one with your desired Project ID.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-700 sticky top-0">
                  <tr>
                    <th className="px-3 py-2.5 w-12 text-center">ID</th>
                    <th className="px-3 py-2.5">Title</th>
                    <th className="px-3 py-2.5 w-44">Assigned Project</th>
                    <th className="px-3 py-2.5 w-28">Client</th>
                    <th className="px-3 py-2.5 w-20 text-center">Type</th>
                    <th className="px-3 py-2.5 w-24 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredItems.map((item) => {
                    const isEditing = editingId === item.id;
                    const pName = item.project_id ? projectMap.get(Number(item.project_id)) : null;

                    if (isEditing) {
                      return (
                        <tr key={item.id} className="bg-amber-50/50">
                          <td className="px-3 py-2 text-center font-bold text-slate-400">
                            #{item.id}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-amber-500"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={editProjectId}
                              onChange={(e) =>
                                setEditProjectId(e.target.value === '' ? '' : Number(e.target.value))
                              }
                              className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 outline-none focus:ring-1 focus:ring-amber-500"
                            >
                              <option value="">No Project (Global)</option>
                              {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name} (ID: {p.id})
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              list="client-suggestions"
                              value={editClient}
                              onChange={(e) => setEditClient(e.target.value)}
                              placeholder="Client"
                              className="w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <select
                              value={editTypeId}
                              onChange={(e) => setEditTypeId(Number(e.target.value))}
                              className="rounded border border-amber-300 bg-white px-1 py-1 text-xs outline-none"
                            >
                              <option value={1}>1: Drawer</option>
                              <option value={2}>2: Checker</option>
                              <option value={3}>3: QA</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={() => handleUpdate(item.id)}
                                disabled={saving}
                                className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                                title="Save changes"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={cancelEdit}
                                disabled={saving}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100"
                                title="Cancel edit"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={item.id} className="hover:bg-slate-50 transition">
                        <td className="px-3 py-2 text-center font-bold text-slate-400">
                          #{item.id}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {item.title}
                        </td>
                        <td className="px-3 py-2">
                          {item.project_id ? (
                            <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 border border-blue-200">
                              {pName || `Project #${item.project_id}`}
                              <span className="text-[9px] font-normal text-blue-500">
                                (ID: {item.project_id})
                              </span>
                            </span>
                          ) : (
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                              Global (All Projects)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-slate-600 font-medium">
                          {item.client ? (
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                              {item.client}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              item.check_list_type_id === 3
                                ? 'bg-purple-50 text-purple-700'
                                : item.check_list_type_id === 2
                                ? 'bg-blue-50 text-blue-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {item.check_list_type_id === 3
                              ? 'QA'
                              : item.check_list_type_id === 2
                              ? 'Checker'
                              : 'Drawer'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEdit(item)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
                              title="Edit item"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(item)}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition"
                              title="Deactivate item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 bg-slate-50 rounded-b-xl">
          <span className="text-xs text-slate-500">
            Total active items shown: <strong>{filteredItems.length}</strong>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition shadow-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ManageProductChecklistsModal;
