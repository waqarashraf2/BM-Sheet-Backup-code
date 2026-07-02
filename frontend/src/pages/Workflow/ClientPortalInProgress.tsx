import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw, UploadCloud } from 'lucide-react';
import { workflowService } from '../../services';
import type { ClientPortalInProgressOrder, ClientPortalProjectOption } from '../../services';
import { AnimatedPage, Button, PageHeader, StatusBadge } from '../../components/ui';

function valueOrDash(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized || '-';
}

export default function ClientPortalInProgress() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<ClientPortalInProgressOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [portalWarning, setPortalWarning] = useState('');
  const [mode, setMode] = useState<'InProgress' | 'Failed'>('InProgress');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [projectOptions, setProjectOptions] = useState<ClientPortalProjectOption[]>([]);

  const loadOrders = useCallback(async (quiet = false) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError('');

    try {
      const response = await workflowService.getClientPortalInProgressOrders({
        status: mode,
        project_id: selectedProjectId,
      });
      setOrders(response.data.orders || []);
      setProjectOptions(response.data.meta?.project_options || []);
      setPortalWarning(response.data.meta?.client_portal_error || '');
    } catch (e: any) {
      setError(e.response?.data?.message || 'Failed to load client portal in-progress orders.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mode, selectedProjectId]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  const counts = useMemo(() => {
    const inProgress = orders.filter((order) => String(order.client_portal_job_status || '').toLowerCase().includes('progress')).length;
    const failed = orders.filter((order) => String(order.client_portal_job_status || '').toLowerCase().includes('fail')).length;
    const uploaded = orders.filter((order) => String(order.client_portal_job_status || order.local_upload_status || '').toLowerCase().includes('upload')).length;

    return { total: orders.length, inProgress, failed, uploaded };
  }, [orders]);

  const openReupload = (order: ClientPortalInProgressOrder) => {
    if (!order.order_id || !order.project_id || order.can_reupload === false) return;

    const params = new URLSearchParams();
    params.set('projectId', String(order.project_id));
    params.set('reupload', '1');
    if (order.job_order_id) params.set('jobOrderId', order.job_order_id);
    if (order.order_number) params.set('orderNumber', order.order_number);
    if (order.order_number || order.job_order_id) params.set('displayOrder', order.order_number || order.job_order_id || '');
    if (order.client_name) params.set('clientName', order.client_name);
    if (order.customer_parent_company) params.set('CustomerParentCompany', order.customer_parent_company);
    if (order.client_reference) params.set('clientReference', order.client_reference);

    navigate(`/client-upload/${order.order_id}?${params.toString()}`);
  };

  return (
    <AnimatedPage>
      <PageHeader
        title={mode === 'Failed' ? 'Client Portal Failed Orders' : 'Client Portal In Progress'}
        subtitle="PH 2 layer client-portal status for enabled projects"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedProjectId ?? ''}
              onChange={(event) => setSelectedProjectId(event.target.value ? Number(event.target.value) : null)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            >
              <option value="">All Projects</option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>{project.label}</option>
              ))}
            </select>
            <Button
              size="sm"
              variant={mode === 'InProgress' ? 'primary' : 'secondary'}
              onClick={() => setMode('InProgress')}
            >
              In Progress
            </Button>
            <Button
              size="sm"
              variant={mode === 'Failed' ? 'danger' : 'secondary'}
              onClick={() => setMode('Failed')}
            >
              Failed Orders
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<RefreshCw className="h-4 w-4" />}
              loading={refreshing}
              onClick={() => loadOrders(true)}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-5">
        <div className="bg-white rounded-lg ring-1 ring-black/[0.04] p-4">
          <div className="text-xs text-slate-500">Total</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{counts.total}</div>
        </div>
        <div className="bg-white rounded-lg ring-1 ring-black/[0.04] p-4">
          <div className="text-xs text-slate-500">In Progress</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{counts.inProgress}</div>
        </div>
        <div className="bg-white rounded-lg ring-1 ring-black/[0.04] p-4">
          <div className="text-xs text-slate-500">Failed</div>
          <div className="mt-1 text-2xl font-bold text-rose-600">{counts.failed}</div>
        </div>
        <div className="bg-white rounded-lg ring-1 ring-black/[0.04] p-4">
          <div className="text-xs text-slate-500">Uploaded</div>
          <div className="mt-1 text-2xl font-bold text-sky-600">{counts.uploaded}</div>
        </div>
      </div>

      {portalWarning && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex gap-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{portalWarning}</span>
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg ring-1 ring-black/[0.04] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr className="text-left text-xs font-semibold text-slate-500 uppercase">
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">QA</th>
                <th className="px-4 py-3">Portal Status</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3">Local Upload</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">Loading orders...</td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    No {mode === 'Failed' ? 'failed' : 'in-progress'} client portal orders found.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={`${order.project_id || 'external'}-${order.order_id || order.client_portal_job_id || order.order_number}`} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {order.project_id ? `#${order.project_id}` : 'Not matched'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{valueOrDash(order.order_number || order.job_order_id)}</div>
                      <div className="text-xs text-slate-500">{valueOrDash(order.client_reference)}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-700">{valueOrDash(order.client_name)}</div>
                      <div className="text-xs text-slate-500">{valueOrDash(order.customer_parent_company)}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{valueOrDash(order.qa_name || order.qa_id)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.client_portal_job_status || 'InProgress'} />
                    </td>
                    <td className="px-4 py-3 max-w-md text-xs leading-relaxed text-slate-600">
                      {valueOrDash(order.client_portal_reason)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={order.local_upload_status || 'not_uploaded'} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        {order.can_reupload === false || !order.order_id || !order.project_id ? (
                          <span className="text-xs text-slate-400">Match local order first</span>
                        ) : (
                          <Button
                            size="sm"
                            icon={<UploadCloud className="h-4 w-4" />}
                            onClick={() => openReupload(order)}
                          >
                            Reupload
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AnimatedPage>
  );
}
