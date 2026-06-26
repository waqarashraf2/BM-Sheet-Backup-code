import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { workflowService } from '../../services';
import { AnimatedPage, PageHeader, Button, StatusBadge } from '../../components/ui';
import { ArrowLeft, UploadCloud, Send, Loader2, Image as ImageIcon } from 'lucide-react';
import type { ClientPortalUploadStatus } from '../../services';
import type { Order } from '../../types';

type UploadOrderInfo = {
    jobOrderId: string;
    projectId: string;
    orderNumber: string;
    displayOrder: string;
    clientName: string;
    clientReference: string;
};

function resolveOrderInfo(order: Order | null | undefined): UploadOrderInfo {
    const raw = (order || {}) as Order & Record<string, unknown>;
    const metadata = (raw.metadata || {}) as Record<string, unknown>;
    const clientReference = String(raw.client_reference || metadata.client_reference || '').trim();
    const jobOrderId = String(
        clientReference
        || raw.client_portal_id
        || raw.client_order_number
        || raw.clint_order_number
        || raw.client_order_no
        || metadata.client_order_number
        || metadata.clint_order_number
        || metadata.client_order_no
        || raw.order_number
        || ''
    ).trim();
    const orderNumber = String(raw.order_number || '').trim();
    const clientName = String(raw.client_name || metadata.client_name || '').trim();

    return {
        jobOrderId,
        projectId: raw.project_id ? String(raw.project_id) : '',
        orderNumber,
        displayOrder: jobOrderId || orderNumber,
        clientName,
        clientReference,
    };
}

function fileNameContainsOrderReference(fileName: string, orderReference: string): boolean {
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const escaped = orderReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(baseName);
}

export default function ClientUpload() {
    const navigate = useNavigate();
    const { orderId } = useParams<{ orderId: string }>();
    const [searchParams] = useSearchParams();
    const [status, setStatus] = useState<ClientPortalUploadStatus | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [orderInfo, setOrderInfo] = useState<UploadOrderInfo | null>(null);
    const [busy, setBusy] = useState<'status' | 'upload' | 'submit' | null>('status');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [uploadProgress, setUploadProgress] = useState(0);

    const numericOrderId = Number(orderId);
    const orderIdValid = Number.isFinite(numericOrderId) && numericOrderId > 0;
    const queryJobOrderId = (searchParams.get('jobOrderId') || '').trim();
    const queryProjectId = (searchParams.get('projectId') || '').trim();
    const queryOrderNumber = (searchParams.get('orderNumber') || '').trim();
    const queryDisplayOrder = (searchParams.get('displayOrder') || '').trim();
    const queryClientName = (searchParams.get('clientName') || '').trim();
    const queryClientReference = (searchParams.get('clientReference') || '').trim();

    useEffect(() => {
        if (!orderIdValid) return;

        let active = true;
        setBusy('status');
        setError('');

        workflowService.getClientPortalUploadStatus(numericOrderId)
            .then((statusResponse) => {
                if (!active) return;
                setStatus(statusResponse.data);

                if (
                    !statusResponse.data?.job_order_id
                    && !statusResponse.data?.order_number
                    && !queryJobOrderId
                ) {
                    workflowService.orderDetails(numericOrderId)
                        .then((orderResponse) => {
                            if (!active) return;
                            setOrderInfo(resolveOrderInfo(orderResponse.data.order));
                        })
                        .catch(() => {
                            if (!active) return;
                            setOrderInfo(null);
                        });
                }
            })
            .catch((e: any) => {
                if (!active) return;
                setError(e.response?.data?.message || 'Failed to load order upload data.');
            })
            .finally(() => {
                if (!active) return;
                setBusy(null);
            });

        return () => {
            active = false;
        };
    }, [numericOrderId, orderIdValid, queryJobOrderId]);

    const orderLookup = useMemo(() => String(status?.job_order_id || status?.order_number || queryJobOrderId || orderInfo?.jobOrderId || '').trim(), [orderInfo, queryJobOrderId, status]);
    const uploadedFileNames = useMemo(() => Array.isArray(status?.file_names) ? status.file_names : [], [status]);
    const canUpload = !!orderLookup && status?.can_upload !== false;
    const uploadStatusLabel = canUpload && (!status?.status || status.status === 'not_required')
        ? 'not_uploaded'
        : (status?.status || 'not_required');
    const imageLinkParams = useMemo(() => {
        const params = new URLSearchParams();
        const projectId = status?.project_id ? String(status.project_id) : (queryProjectId || orderInfo?.projectId || '');
        const orderNumber = String(status?.order_number || queryOrderNumber || orderInfo?.orderNumber || '').trim();
        const displayOrder = String(status?.order_number || queryDisplayOrder || orderInfo?.displayOrder || orderLookup).trim();
        const clientReference = String(status?.client_reference || queryClientReference || orderInfo?.clientReference || '').trim();
        if (projectId) params.set('projectId', projectId);
        if (displayOrder) params.set('displayOrder', displayOrder);
        if (orderNumber) params.set('orderNumber', orderNumber);
        if (queryClientName || orderInfo?.clientName) params.set('clientName', queryClientName || orderInfo?.clientName || '');
        if (clientReference) params.set('clientReference', clientReference);
        if (orderLookup) params.set('clientOrderNumber', orderLookup);
        return params.toString();
    }, [orderInfo, orderLookup, queryClientName, queryClientReference, queryDisplayOrder, queryOrderNumber, queryProjectId, status]);

    const invalidFiles = useMemo(() => {
        if (!status || !orderLookup) return [];
        return files.filter((file) => !fileNameContainsOrderReference(file.name, orderLookup));
    }, [files, orderLookup, status]);

    const uploadFiles = async () => {
        if (!orderIdValid || !files.length || invalidFiles.length || busy) return;
        setBusy('upload');
        setMessage('');
        setError('');
        setUploadProgress(0);

        try {
            const response = await workflowService.uploadToClientPortal(numericOrderId, files, orderLookup, setUploadProgress);
            setStatus(response.data.status);
            setMessage(response.data.message || 'Files uploaded successfully.');
        } catch (e: any) {
            const statusCode = e.response?.status;
            const serverMessage = e.response?.data?.message || e.response?.data?.errors?.files?.[0];
            setError(
                statusCode === 404 || statusCode === 405
                    ? 'Upload route is not available on the backend server yet. Please deploy the latest backend routes and clear the Laravel route cache.'
                    : serverMessage || 'Upload failed.'
            );
        } finally {
            setBusy(null);
            setUploadProgress(0);
        }
    };

    const submitOrder = async () => {
        if (!orderIdValid || busy) return;
        setBusy('submit');
        setMessage('');
        setError('');

        try {
            const response = await workflowService.submitClientPortalOrder(numericOrderId);
            setStatus(response.data.status);
            setMessage(response.data.message || 'Order submitted successfully.');
        } catch (e: any) {
            setError(e.response?.data?.message || 'Submit failed.');
        } finally {
            setBusy(null);
        }
    };

    const selectFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
        setFiles(Array.from(event.target.files || []));
    };

    const openImageLinks = () => {
        if (!orderLookup) return;
        navigate(`/order-assets/${encodeURIComponent(orderLookup)}${imageLinkParams ? `?${imageLinkParams}` : ''}`);
    };

    return (
        <AnimatedPage>
            <PageHeader
                title="PH 2 Layer Client Upload"
                subtitle="Upload and submit image files for PH_2_LAYER QA orders"
                actions={
                    <Button variant="secondary" size="sm" icon={<ArrowLeft className="h-4 w-4" />} onClick={() => navigate(-1)}>
                        Back
                    </Button>
                }
            />

            <div className="max-w-3xl mx-auto">
                <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
                    <div className="grid gap-4">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <h2 className="text-lg font-semibold text-slate-900">Upload Files</h2>
                                <p className="text-sm text-slate-500">Select image files to upload to the client portal for this PH_2_LAYER order.</p>
                            </div>
                            {busy === 'status' && <Loader2 className="h-5 w-5 text-slate-400 animate-spin" />}
                        </div>

                        {!orderIdValid && (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                                Invalid order ID. Please open this page from the dashboard.
                            </div>
                        )}

                        {error && (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                                {error}
                            </div>
                        )}

                        {message && (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                                {message}
                            </div>
                        )}

                        {status && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-xs text-slate-500 mb-2">Upload Available</div>
                                    <div className="text-sm font-semibold text-slate-900">{canUpload ? 'Yes' : 'No'}</div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-xs text-slate-500 mb-2">Upload Status</div>
                                    <StatusBadge status={uploadStatusLabel} />
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-xs text-slate-500 mb-2">Uploaded Files</div>
                                    <div className="text-sm font-semibold text-slate-900">{uploadedFileNames.length || '0'}</div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                    <div className="text-xs text-slate-500 mb-2">Submitted</div>
                                    <div className="text-sm font-semibold text-slate-900">{status.submitted ? 'Yes' : 'No'}</div>
                                </div>
                            </div>
                        )}
                        {status && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                                <div className="font-semibold text-slate-900 mb-2">Order Reference</div>
                                <div>Internal Order ID #{status.order_id || numericOrderId}</div>
                                <div>Upload Order Reference: {orderLookup || 'Not available'}</div>
                                <div>Client Portal ID: {status.order_number || queryOrderNumber || 'Not available'}</div>
                            </div>
                        )}
                    </div>
                </div>

                <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Files</label>
                            <input
                                type="file"
                                multiple
                                accept="image/*,.zip,application/zip,application/x-zip-compressed"
                                onChange={selectFiles}
                                className="mt-2 block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
                            />
                            {orderLookup && (
                                <p className="mt-2 text-xs text-slate-500">
                                    File names should include <span className="font-semibold text-slate-900">{orderLookup}</span> before the extension.
                                </p>
                            )}
                        </div>

                        {files.length > 0 && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                                <div className="font-semibold text-slate-900 mb-2">Selected files</div>
                                <ul className="list-disc list-inside space-y-1">
                                    {files.map((file) => (
                                        <li key={file.name}>{file.name}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {invalidFiles.length > 0 && (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                                <div className="font-semibold text-rose-800 mb-2">Invalid file names</div>
                                <div>Files must include the expected order reference before extension.</div>
                                <div className="mt-2 text-rose-700">{invalidFiles.map((file) => file.name).join(', ')}</div>
                            </div>
                        )}

                        {busy === 'upload' && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                                    <span>{uploadProgress < 100 ? 'Uploading to server' : 'Uploading to client portal'}</span>
                                    <span>{uploadProgress}%</span>
                                </div>
                                <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-teal-500 transition-all"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                                {uploadProgress >= 100 && (
                                    <p className="mt-2 text-xs text-slate-500">Waiting for client portal response...</p>
                                )}
                            </div>
                        )}

                        <div className="flex flex-wrap gap-3">
                            <Button
                                size="sm"
                                variant="secondary"
                                icon={<ImageIcon className="h-4 w-4" />}
                                onClick={openImageLinks}
                                disabled={!orderLookup || busy === 'status'}
                            >
                                View Images
                            </Button>
                            <Button
                                size="sm"
                                icon={<UploadCloud className="h-4 w-4" />}
                                onClick={uploadFiles}
                                loading={busy === 'upload'}
                                disabled={!files.length || !!invalidFiles.length || !canUpload || busy !== null}
                            >
                                Upload Files
                            </Button>
                            <Button
                                size="sm"
                                icon={<Send className="h-4 w-4" />}
                                onClick={submitOrder}
                                loading={busy === 'submit'}
                                disabled={!status?.uploaded || status?.submitted || busy !== null}
                            >
                                Submit Order
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </AnimatedPage>
    );
}
