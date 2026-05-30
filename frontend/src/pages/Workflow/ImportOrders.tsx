import { useEffect, useState, useRef } from 'react';
import { useSelector } from 'react-redux';

import { orderImportService, projectService } from '../../services';
import { AnimatedPage, PageHeader, StatusBadge, Button, DataTable, Modal, useToast } from '../../components/ui';
import { Upload, FileSpreadsheet, Server, RefreshCw, CheckCircle, XCircle, Save, Trash2, Pencil, Search, AlertTriangle } from 'lucide-react';
import type { RootState } from '../../store/store';

type ImportedOrder = {
  order_id: number;
  order_number: string;
  address: string | null;
  client_name: string | null;
  import_source: string | null;
  import_log_id: number | null;
  created_at: string;
  updated_at: string;
};

type ImportedOrdersPagination = {
  total: number;
  per_page: number;
  current_page: number;
  last_page: number;
};

export default function ImportOrders() {
  const { toast } = useToast();
  const user = useSelector((state: RootState) => state.auth.user);
  const isDirector = user?.role === 'director';
  const isQA = user?.role === 'qa';
  const normalizeHeaderValue = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item).trim())
        .filter(Boolean);
    }
    if (typeof value === 'string') {
      return value
        .split(/[,\r\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    if (value && typeof value === 'object') {
      const nestedHeaders = (value as { headers?: unknown }).headers;
      return normalizeHeaderValue(nestedHeaders);
    }
    return [];
  };
  const headerArrayToText = (value: unknown): string => normalizeHeaderValue(value).join(',');
  const headerTextToArray = (value: string): string[] => normalizeHeaderValue(value);

  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [importResult, setImportResult] = useState<any>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvText, setCsvText] = useState('');
  const [defaultCsvHeader, setDefaultCsvHeader] = useState('');
  const [headerDraft, setHeaderDraft] = useState('');
  const [headerLoading, setHeaderLoading] = useState(false);
  const [savingHeader, setSavingHeader] = useState(false);
  const [deletingHeader, setDeletingHeader] = useState(false);
  const [importedOrders, setImportedOrders] = useState<ImportedOrder[]>([]);
  const [importedOrdersLoading, setImportedOrdersLoading] = useState(false);
  const [importedOrderPage, setImportedOrderPage] = useState(1);
  const [importedOrderSearchDraft, setImportedOrderSearchDraft] = useState('');
  const [importedOrderSearch, setImportedOrderSearch] = useState('');
  const [importedOrdersPagination, setImportedOrdersPagination] = useState<ImportedOrdersPagination>({
    total: 0,
    per_page: 50,
    current_page: 1,
    last_page: 1,
  });
  const [editingOrder, setEditingOrder] = useState<ImportedOrder | null>(null);
  const [editOrderForm, setEditOrderForm] = useState({
    order_number: '',
    address: '',
    client_name: '',
  });
  const [savingImportedOrder, setSavingImportedOrder] = useState(false);
  const [deletingImportedOrderId, setDeletingImportedOrderId] = useState<number | null>(null);
  const [deleteOrderTarget, setDeleteOrderTarget] = useState<ImportedOrder | null>(null);

  useEffect(() => {
    projectService.list().then(res => {
      const d = res.data?.data || res.data;
      const list = Array.isArray(d) ? d : [];
      const filteredProjects = isQA && user?.project_id
        ? list.filter((project: any) => project.id === user.project_id)
        : list;
      setProjects(filteredProjects);
      if (filteredProjects.length > 0) {
        setSelectedProject(filteredProjects[0].id);
      } else {
        setSelectedProject(null);
      }
    }).catch(() => {});
  }, [isQA, user?.project_id]);

  useEffect(() => {
    if (selectedProject) loadData();
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setImportedOrders([]);
      setImportedOrdersPagination({
        total: 0,
        per_page: 50,
        current_page: 1,
        last_page: 1,
      });
      return;
    }

    loadImportedOrders(selectedProject, importedOrderPage, importedOrderSearch);
  }, [selectedProject, importedOrderPage, importedOrderSearch]);

  useEffect(() => {
    if (selectedProject) {
      loadProjectHeaders(selectedProject);
    } else {
      setDefaultCsvHeader('');
      setCsvText('');
    }
  }, [selectedProject]);

  useEffect(() => {
    setImportedOrderPage(1);
    setImportedOrderSearchDraft('');
    setImportedOrderSearch('');
  }, [selectedProject]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setImportedOrderPage(1);
      setImportedOrderSearch(importedOrderSearchDraft.trim());
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [importedOrderSearchDraft]);

  const loadData = async () => {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const [sourcesRes, historyRes] = await Promise.all([
        orderImportService.sources(selectedProject).catch(() => ({ data: { data: [] } })),
        orderImportService.importHistory(selectedProject).catch(() => ({ data: { data: [] } })),
      ]);
      setSources(sourcesRes.data?.data || sourcesRes.data || []);
      setHistory(historyRes.data?.data || historyRes.data || []);
    } catch (_) {}
    finally { setLoading(false); }
  };

  const loadProjectHeaders = async (projectId: number) => {
    try {
      setHeaderLoading(true);
      const res = await orderImportService.getProjectCsvHeaders(projectId);
      const savedHeaders = headerArrayToText(res.data?.data?.headers ?? res.data?.headers ?? '');
      setDefaultCsvHeader(savedHeaders);
      setHeaderDraft(savedHeaders);
      setCsvText(savedHeaders);
    } catch (error) {
      console.error(error);
      setDefaultCsvHeader('');
      setHeaderDraft('');
      setCsvText('');
    } finally {
      setHeaderLoading(false);
    }
  };

  const loadImportedOrders = async (
    projectId = selectedProject,
    page = importedOrderPage,
    search = importedOrderSearch
  ) => {
    if (!projectId) return;

    try {
      setImportedOrdersLoading(true);
      const res = await orderImportService.importedOrders(projectId, {
        page,
        per_page: 50,
        search: search || undefined,
      });
      const nextOrders = res.data?.data || [];
      const nextPagination = res.data?.pagination || {
        total: nextOrders.length,
        per_page: 50,
        current_page: page,
        last_page: 1,
      };

      setImportedOrders(nextOrders);
      setImportedOrdersPagination(nextPagination);

      if (nextPagination.last_page > 0 && nextPagination.current_page !== page) {
        setImportedOrderPage(nextPagination.current_page);
      }
    } catch (error) {
      console.error(error);
      setImportedOrders([]);
      setImportedOrdersPagination({
        total: 0,
        per_page: 50,
        current_page: 1,
        last_page: 1,
      });
      toast({
        title: 'Imported orders failed',
        description: 'Could not load imported orders for this project.',
        type: 'error',
      });
    } finally {
      setImportedOrdersLoading(false);
    }
  };

  const handleFile = async (file: File) => {
    if (!selectedProject || !file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      setUploading(true); setImportResult(null);
      const res = await orderImportService.importCsv(selectedProject, formData);
      setImportResult(res.data);
      loadData();
      loadImportedOrders(selectedProject, 1, importedOrderSearch);
    } catch (e: any) {
      setImportResult({ error: e.response?.data?.message || 'Import failed.' });
    } finally { setUploading(false); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleSync = async (sourceId: number) => {
    try {
      setSyncing(sourceId);
      await orderImportService.syncFromApi(sourceId);
      loadData();
      loadImportedOrders();
    } catch (e) { console.error(e); }
    finally { setSyncing(null); }
  };

  const handleSaveHeaders = async () => {
    const safeHeaderDraft = headerTextToArray(headerDraft);
    if (!selectedProject || !isDirector || safeHeaderDraft.length === 0) return;

    try {
      setSavingHeader(true);
      const payload = safeHeaderDraft;
      const res = defaultCsvHeader
        ? await orderImportService.updateProjectCsvHeaders(selectedProject, payload)
        : await orderImportService.saveProjectCsvHeaders(selectedProject, payload);

      const savedHeaders = headerArrayToText(res.data?.data?.headers ?? res.data?.headers ?? payload);
      setDefaultCsvHeader(savedHeaders);
      setHeaderDraft(savedHeaders);
      setCsvText(savedHeaders);
      toast({
        title: 'CSV headers saved',
        description: res.data?.message || 'Default CSV headers were saved for this project.',
        type: 'success',
      });
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Save failed',
        description: e?.response?.data?.message || 'Could not save CSV headers.',
        type: 'error',
      });
    } finally {
      setSavingHeader(false);
    }
  };

  const handleDeleteHeaders = async () => {
    if (!selectedProject || !isDirector || !defaultCsvHeader) return;

    try {
      setDeletingHeader(true);
      const res = await orderImportService.deleteProjectCsvHeaders(selectedProject);
      setDefaultCsvHeader('');
      setHeaderDraft('');
      setCsvText('');
      toast({
        title: 'CSV headers removed',
        description: res.data?.message || 'Default CSV headers were deleted for this project.',
        type: 'success',
      });
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Delete failed',
        description: e?.response?.data?.message || 'Could not delete CSV headers.',
        type: 'error',
      });
    } finally {
      setDeletingHeader(false);
    }
  };

  const openEditModal = (order: ImportedOrder) => {
    setEditingOrder(order);
    setEditOrderForm({
      order_number: order.order_number || '',
      address: order.address || '',
      client_name: order.client_name || '',
    });
  };

  const handleUpdateImportedOrder = async () => {
    if (!selectedProject || !editingOrder) return;

    try {
      setSavingImportedOrder(true);
      const res = await orderImportService.updateImportedOrder(selectedProject, editingOrder.order_id, {
        order_number: editOrderForm.order_number.trim(),
        address: editOrderForm.address.trim() || null,
        client_name: editOrderForm.client_name.trim() || null,
      });
      const updatedOrder = res.data?.data;

      setImportedOrders((prev) => prev.map((order) => (
        order.order_id === editingOrder.order_id
          ? { ...order, ...updatedOrder }
          : order
      )));
      setEditingOrder(null);
      toast({
        title: 'Imported order updated',
        description: res.data?.message || 'The imported order was updated successfully.',
        type: 'success',
      });
      loadImportedOrders();
    } catch (e: any) {
      console.error(e);
      const validationErrors = e?.response?.data?.errors;
      const firstValidationMessage = validationErrors
        ? Object.values(validationErrors)[0]
        : null;
      toast({
        title: 'Update failed',
        description: Array.isArray(firstValidationMessage)
          ? firstValidationMessage[0]
          : e?.response?.data?.message || 'Could not update the imported order.',
        type: 'error',
      });
    } finally {
      setSavingImportedOrder(false);
    }
  };

  const handleDeleteImportedOrder = async () => {
    if (!selectedProject || !deleteOrderTarget) return;

    const targetPage = importedOrders.length === 1 && importedOrderPage > 1
      ? importedOrderPage - 1
      : importedOrderPage;

    try {
      setDeletingImportedOrderId(deleteOrderTarget.order_id);
      const res = await orderImportService.deleteImportedOrder(selectedProject, deleteOrderTarget.order_id);
      setDeleteOrderTarget(null);
      toast({
        title: 'Imported order deleted',
        description: res.data?.message || 'The imported order was deleted successfully.',
        type: 'success',
      });
      if (targetPage !== importedOrderPage) {
        setImportedOrderPage(targetPage);
      } else {
        loadImportedOrders(selectedProject, targetPage, importedOrderSearch);
      }
      loadData();
    } catch (e: any) {
      console.error(e);
      toast({
        title: 'Delete failed',
        description: e?.response?.data?.message || 'Could not delete the imported order.',
        type: 'error',
      });
    } finally {
      setDeletingImportedOrderId(null);
    }
  };

  return (
    <AnimatedPage>
      <PageHeader
        title="Import Orders"
        subtitle="Upload CSV files or sync from API sources"
        badge={selectedProject ? (
          <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
            {defaultCsvHeader ? 'Default header ready' : 'No default header'}
          </span>
        ) : undefined}
      />

      {/* Project selector */}
      {projects.length > 1 && (
        <div className="mb-6">
          <label htmlFor="project-select" className="sr-only">Select Project</label>
          <select id="project-select" value={selectedProject || ''} onChange={e => setSelectedProject(Number(e.target.value))} className="select text-sm" title="Select project for import">
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      {/* ✅ CSV TEXT INPUT (PASTE HERE) */}
<div className="bg-white rounded-xl border border-slate-200/60 p-6 mb-6">
  <div className="mb-4 flex items-start justify-between gap-3">
    <div>
      <h3 className="text-sm font-semibold text-slate-900">
        Paste CSV Data
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {headerLoading
          ? 'Loading project CSV headers...'
          : defaultCsvHeader
            ? 'Saved project CSV headers are loaded by default in this box.'
            : 'No saved CSV headers for this project yet.'}
      </p>
    </div>
    {isDirector && <div className="text-xs text-slate-500">You can add, update, or delete the project header in the box below.</div>}
  </div>

  {isDirector && (
    <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Project Import Header</h4>
          <p className="mt-1 text-xs text-slate-500">
            Add or update the default header for this project here. It will automatically appear in the import text area below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            icon={Save}
            loading={savingHeader}
            disabled={!selectedProject || headerTextToArray(headerDraft).length === 0}
            onClick={handleSaveHeaders}
          >
            Save Header
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            loading={deletingHeader}
            disabled={!selectedProject || !defaultCsvHeader}
            onClick={handleDeleteHeaders}
          >
            Delete Header
          </Button>
        </div>
      </div>

      <textarea
        value={headerDraft}
        onChange={(e) => setHeaderDraft(e.target.value)}
        rows={5}
        placeholder="Add your project CSV header here..."
        className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900"
      />
    </div>
  )}

  <textarea
    value={csvText}
    onChange={(e) => setCsvText(e.target.value)}
    rows={8}
    placeholder="Paste CSV here..."
    className="w-full border border-slate-200 rounded-lg p-3 text-sm"
  />
  {!isDirector && defaultCsvHeader && (
    <p className="mt-2 text-xs text-slate-500">
      Default headers are prefilled for this project. Only director can change them.
    </p>
  )}

  <Button
    className="mt-3"
    loading={uploading}
    onClick={async () => {
      if (!selectedProject || !csvText) return;

      try {
        setUploading(true);
        setImportResult(null);

        const res = await orderImportService.importCsvText(selectedProject, {
          csv_text: csvText
        });

        setImportResult(res.data);
        loadData();
        loadImportedOrders(selectedProject, 1, importedOrderSearch);
        setCsvText(defaultCsvHeader);
      } catch (e: any) {
        setImportResult({
          error: e.response?.data?.message || 'Import failed'
        });
      } finally {
        setUploading(false);
      }
    }}
  >
    Import from Text
  </Button>
</div>
        {/* CSV Upload */}
        <div className="bg-white rounded-xl border border-slate-200/60 p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-slate-400" /> CSV Upload
          </h3>
          <div
            onDragOver={e => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
              dragActive ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <Upload className={`w-8 h-8 mx-auto mb-3 ${dragActive ? 'text-slate-900' : 'text-slate-300'}`} />
            <p className="text-sm text-slate-500">
              {uploading ? 'Uploading...' : 'Drop CSV file here or click to browse'}
            </p>
            <p className="text-xs text-slate-400 mt-1">Supports .csv files</p>
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} aria-label="Upload CSV file" title="Upload CSV file" />
        </div>

        {/* API Sources */}
        <div className="bg-white rounded-xl border border-slate-200/60 p-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Server className="w-4 h-4 text-slate-400" /> API Sources
          </h3>
          {sources.length > 0 ? (
            <div className="space-y-2">
              {sources.filter((s: any) => s.type === 'api').map((source: any) => (
                <div key={source.id} className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
                  <div>
                    <div className="text-sm font-medium text-slate-900">{source.name}</div>
                    <div className="text-xs text-slate-400">{source.url || 'Configured'}</div>
                  </div>
                  <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => handleSync(source.id)} loading={syncing === source.id}>
                    Sync
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Server className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No API sources configured.</p>
            </div>
          )}
        </div>
      </div>

      {/* Import Result */}
      {importResult && (
        <div className={`rounded-xl border p-4 mb-6 ${importResult.error ? 'bg-rose-50 border-rose-200' : 'bg-brand-50 border-brand-200'}`}>
          {importResult.error ? (
            <div className="flex items-center gap-2 text-sm text-rose-700">
              <XCircle className="w-4 h-4" /> {importResult.error}
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-brand-700 mb-2">
                <CheckCircle className="w-4 h-4" /> Import Complete
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div className="bg-white/60 rounded-lg p-2 text-center">
                  <div className="font-bold text-slate-900">{importResult.total_rows || 0}</div>
                  <div className="text-xs text-slate-500">Total Rows</div>
                </div>
                <div className="bg-white/60 rounded-lg p-2 text-center">
                  <div className="font-bold text-brand-600">{importResult.imported || 0}</div>
                  <div className="text-xs text-slate-500">Imported</div>
                </div>
                <div className="bg-white/60 rounded-lg p-2 text-center">
                  <div className="font-bold text-amber-600">{importResult.skipped || 0}</div>
                  <div className="text-xs text-slate-500">Skipped</div>
                </div>
              </div>
              {importResult.errors?.length > 0 && (
                <div className="mt-3 text-xs text-rose-600">
                  {importResult.errors.map((err: any, i: number) => (
                    <div key={i}>Row {err.row}: {err.message}</div>
                  ))}
                </div>
              )}
            </div>
            
          )}
        </div>
        
      )}

      <div className="mb-6">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Imported Orders</h3>
            <p className="text-xs text-slate-500">
              Manage imported orders with server pagination at 50 orders per page.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={importedOrderSearchDraft}
                onChange={(e) => setImportedOrderSearchDraft(e.target.value)}
                placeholder="Search order, address, client..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900"
              />
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={() => loadImportedOrders()}
              loading={importedOrdersLoading}
            >
              Refresh
            </Button>
          </div>
        </div>

        <DataTable
          pageSize={50}
          keyField="order_id"
          data={importedOrders}
          loading={importedOrdersLoading}
          columns={[
            {
              key: 'order_number',
              label: 'Order Number',
              sortable: true,
              render: (order) => <span className="font-medium text-slate-900">{order.order_number}</span>,
            },
            {
              key: 'client_name',
              label: 'Client',
              render: (order) => <span className="text-sm text-slate-600">{order.client_name || '-'}</span>,
            },
            {
              key: 'address',
              label: 'Address',
              render: (order) => (
                <span className="block max-w-xs truncate text-sm text-slate-600" title={order.address || '-'}>
                  {order.address || '-'}
                </span>
              ),
            },
            {
              key: 'import_source',
              label: 'Source',
              render: (order) => (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
                  {order.import_source || 'manual'}
                </span>
              ),
            },
            {
              key: 'updated_at',
              label: 'Updated',
              sortable: true,
              render: (order) => <span className="text-sm text-slate-500">{new Date(order.updated_at).toLocaleString()}</span>,
            },
            {
              key: 'actions',
              label: 'Actions',
              align: 'right',
              render: (order) => (
                <div className="flex items-center justify-end gap-2">
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={Pencil}
                    onClick={(e) => {
                      e.stopPropagation();
                      openEditModal(order);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="danger"
                    icon={Trash2}
                    loading={deletingImportedOrderId === order.order_id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteOrderTarget(order);
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
          emptyIcon={FileSpreadsheet}
          emptyTitle="No imported orders"
          emptyDescription={importedOrderSearch
            ? 'No imported orders matched your search.'
            : 'Imported orders will appear here after CSV or API imports.'}
        />

        <div className="mt-3 flex flex-col gap-3 rounded-xl border border-slate-200/70 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Showing page <span className="font-semibold text-slate-700">{importedOrdersPagination.current_page}</span> of{' '}
            <span className="font-semibold text-slate-700">{Math.max(importedOrdersPagination.last_page, 1)}</span>
            {' '}with <span className="font-semibold text-slate-700">{importedOrdersPagination.total}</span> total imported orders.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setImportedOrderPage((prev) => Math.max(1, prev - 1))}
              disabled={importedOrdersLoading || importedOrdersPagination.current_page <= 1}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setImportedOrderPage((prev) => Math.min(importedOrdersPagination.last_page, prev + 1))}
              disabled={
                importedOrdersLoading
                || importedOrdersPagination.current_page >= importedOrdersPagination.last_page
              }
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      {/* History */}
      <h3 className="text-sm font-semibold text-slate-900 mb-3">Import History</h3>
      <DataTable
        pageSize={10000}
        data={history} loading={loading}
        columns={[
          { key: 'created_at', label: 'Date', sortable: true, render: (h) => <span className="text-sm text-slate-500">{new Date(h.created_at).toLocaleString()}</span> },
          { key: 'source_type', label: 'Source', render: (h) => (
            <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded capitalize">{h.source_type || 'csv'}</span>
          )},
          { key: 'status', label: 'Status', render: (h) => <StatusBadge status={h.status || 'completed'} size="xs" /> },
          { key: 'total_rows', label: 'Total', render: (h) => <span className="font-medium text-slate-900">{h.total_rows || 0}</span> },
          { key: 'imported_count', label: 'Imported', render: (h) => <span className="text-brand-600 font-medium">{h.imported_count || 0}</span> },
          { key: 'skipped_count', label: 'Skipped', render: (h) => <span className="text-amber-600">{h.skipped_count || 0}</span> },
        ]}
        emptyIcon={FileSpreadsheet}
        emptyTitle="No import history"
        emptyDescription="Import your first batch of orders."
      />

      <Modal
        open={!!editingOrder}
        onClose={() => !savingImportedOrder && setEditingOrder(null)}
        title={editingOrder ? `Edit ${editingOrder.order_number}` : 'Edit Imported Order'}
        subtitle="Update the imported order details for this project."
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setEditingOrder(null)} disabled={savingImportedOrder}>
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Save}
              loading={savingImportedOrder}
              disabled={!editOrderForm.order_number.trim()}
              onClick={handleUpdateImportedOrder}
            >
              Update Order
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="edit-order-number" className="mb-1 block text-sm font-medium text-slate-700">
              Order Number
            </label>
            <input
              id="edit-order-number"
              type="text"
              value={editOrderForm.order_number}
              onChange={(e) => setEditOrderForm((prev) => ({ ...prev, order_number: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="edit-client-name" className="mb-1 block text-sm font-medium text-slate-700">
              Client Name
            </label>
            <input
              id="edit-client-name"
              type="text"
              value={editOrderForm.client_name}
              onChange={(e) => setEditOrderForm((prev) => ({ ...prev, client_name: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div>
            <label htmlFor="edit-address" className="mb-1 block text-sm font-medium text-slate-700">
              Address
            </label>
            <textarea
              id="edit-address"
              value={editOrderForm.address}
              onChange={(e) => setEditOrderForm((prev) => ({ ...prev, address: e.target.value }))}
              rows={4}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
        </div>
      </Modal>

      <Modal
        open={!!deleteOrderTarget}
        onClose={() => deletingImportedOrderId == null && setDeleteOrderTarget(null)}
        title="Delete Imported Order?"
        subtitle={deleteOrderTarget
          ? `This will permanently remove ${deleteOrderTarget.order_number} from imported orders.`
          : 'This action cannot be undone.'}
        size="sm"
        variant="danger"
        icon={AlertTriangle}
        footer={(
          <>
            <Button
              variant="ghost"
              onClick={() => setDeleteOrderTarget(null)}
              disabled={deletingImportedOrderId != null}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              icon={Trash2}
              loading={deletingImportedOrderId != null}
              onClick={handleDeleteImportedOrder}
            >
              Delete Order
            </Button>
          </>
        )}
      >
        <p className="text-sm text-slate-600">
          Delete this imported order only if you are sure it should no longer remain in the project import list.
        </p>
      </Modal>

    </AnimatedPage>
  );
}
