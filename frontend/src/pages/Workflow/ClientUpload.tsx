import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { workflowService } from '../../services';
import { AnimatedPage, PageHeader, Button, StatusBadge } from '../../components/ui';
import { ArrowLeft, UploadCloud, Send, Loader2, Image as ImageIcon } from 'lucide-react';
import type { ClientPortalUploadStatus } from '../../services';
import type { Order } from '../../types';
import type { RootState } from '../../store/store';

type UploadOrderInfo = {
    jobOrderId: string;
    clientPortalId: string;
    projectId: string;
    orderNumber: string;
    variantNo: string;
    displayOrder: string;
    clientName: string;
    customerParentCompany: string;
    clientReference: string;
};

const ORDER_NUMBER_ASSET_PROJECT_IDS = [22, 23, 25, 26];
const MAX_CLIENT_PORTAL_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;
const ENABLE_PROJECT_26_DIRECT_UPLOAD = true;

function resolveOrderInfo(order: Order | null | undefined): UploadOrderInfo {
    const raw = (order || {}) as Order & Record<string, unknown>;
    const metadata = (raw.metadata || {}) as Record<string, unknown>;
    const clientReference = String(raw.client_reference || metadata.client_reference || '').trim();
    const clientPortalId = String(raw.client_portal_id || metadata.client_portal_id || '').trim();
    const jobOrderId = String(
        clientReference
        || clientPortalId
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
    const variantNo = String(
        raw.VARIANT_no
        || raw.variant_no
        || raw.variant
        || raw.variant_number
        || metadata.VARIANT_no
        || metadata.variant_no
        || metadata.variant
        || metadata.variant_number
        || ''
    ).trim();
    const clientName = String(raw.client_name || metadata.client_name || '').trim();
    const customerParentCompany = String(
        raw.CustomerParentCompany
        || raw.customer_parent_company
        || raw.parent_company
        || metadata.customer_parent_company
        || metadata.CustomerParentCompany
        || ((metadata.raw_api_response || {}) as Record<string, unknown>).CustomerParentCompany
        || ''
    ).trim();

    return {
        jobOrderId,
        clientPortalId,
        projectId: raw.project_id ? String(raw.project_id) : '',
        orderNumber,
        variantNo,
        displayOrder: jobOrderId || orderNumber,
        clientName,
        customerParentCompany,
        clientReference,
    };
}

function fileNameContainsOrderReference(fileName: string, orderReference: string): boolean {
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const escaped = orderReference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(baseName);
}

function formatFileSize(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
        return `${Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10} GB`;
    }

    return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function formatElapsedTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

function formatUploadSpeed(bytes: number, progress: number, elapsedSeconds: number): string {
    if (!bytes || !progress || !elapsedSeconds) return 'Calculating...';
    const uploadedBytes = bytes * (progress / 100);
    const mbPerSecond = uploadedBytes / elapsedSeconds / (1024 * 1024);
    if (mbPerSecond >= 1) return `${mbPerSecond.toFixed(2)} MB/s`;
    return `${(mbPerSecond * 1024).toFixed(0)} KB/s`;
}

export default function ClientUpload() {
    const navigate = useNavigate();
    const user = useSelector((state: RootState) => state.auth.user);
    const { orderId } = useParams<{ orderId: string }>();
    const [searchParams] = useSearchParams();
    const [status, setStatus] = useState<ClientPortalUploadStatus | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [orderInfo, setOrderInfo] = useState<UploadOrderInfo | null>(null);
    const [busy, setBusy] = useState<'status' | 'upload' | 'submit' | null>('status');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadElapsedSeconds, setUploadElapsedSeconds] = useState(0);
    const [uploadMode, setUploadMode] = useState<'direct' | 'server' | null>(null);
    const [reuploadCompleted, setReuploadCompleted] = useState(false);

    const numericOrderId = Number(orderId);
    const orderIdValid = Number.isFinite(numericOrderId) && numericOrderId > 0;
    const queryJobOrderId = (searchParams.get('jobOrderId') || '').trim();
    const queryProjectId = (searchParams.get('projectId') || '').trim();
    const queryOrderNumber = (searchParams.get('orderNumber') || '').trim();
    const queryDisplayOrder = (searchParams.get('displayOrder') || '').trim();
    const queryClientName = (searchParams.get('clientName') || '').trim();
    const queryCustomerParentCompany = (
        searchParams.get('CustomerParentCompany')
        || searchParams.get('customerParentCompany')
        || searchParams.get('customer_parent_company')
        || ''
    ).trim();
    const queryClientReference = (searchParams.get('clientReference') || '').trim();
    const forceReupload = searchParams.get('reupload') === '1';
    const requestedProjectId = Number(queryProjectId || 0) || undefined;

    useEffect(() => {
        if (!orderIdValid) return;

        let active = true;
        setBusy('status');
        setError('');

        workflowService.getClientPortalUploadStatus(numericOrderId, requestedProjectId)
            .then((statusResponse) => {
                if (!active) return;
                setStatus(statusResponse.data);
                setReuploadCompleted(false);

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
    }, [numericOrderId, orderIdValid, queryJobOrderId, requestedProjectId]);

    useEffect(() => {
        if (busy !== 'upload') return;

        const startedAt = Date.now();
        setUploadElapsedSeconds(0);
        const intervalId = window.setInterval(() => {
            setUploadElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        }, 1000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [busy]);

    const orderLookup = useMemo(() => String(status?.job_order_id || status?.order_number || queryJobOrderId || orderInfo?.jobOrderId || '').trim(), [orderInfo, queryJobOrderId, status]);
    const imageLookup = useMemo(() => {
        const projectId = Number(status?.project_id || queryProjectId || orderInfo?.projectId || 0);
        const orderNumber = String(status?.order_number || queryOrderNumber || orderInfo?.orderNumber || '').trim();

        if (ORDER_NUMBER_ASSET_PROJECT_IDS.includes(projectId) && orderNumber) {
            return orderNumber;
        }

        return orderLookup;
    }, [orderInfo, orderLookup, queryOrderNumber, queryProjectId, status]);
    const uploadedFileNames = useMemo(() => Array.isArray(status?.file_names) ? status.file_names : [], [status]);
    const displayClientName = useMemo(
        () => String(status?.client_name || queryClientName || orderInfo?.clientName || '').trim(),
        [orderInfo, queryClientName, status]
    );
    const displayCustomerParentCompany = useMemo(
        () => String(
            status?.CustomerParentCompany
            || status?.customer_parent_company
            || queryCustomerParentCompany
            || orderInfo?.customerParentCompany
            || ''
        ).trim(),
        [orderInfo, queryCustomerParentCompany, status]
    );
    const displayClientPortalId = useMemo(
        () => String(status?.client_portal_id || orderInfo?.clientPortalId || '').trim(),
        [orderInfo, status]
    );
    const displayVariantNo = useMemo(
        () => String(status?.VARIANT_no || status?.variant_no || orderInfo?.variantNo || '').trim(),
        [orderInfo, status]
    );
    const displayClientPortalJobId = useMemo(
        () => String(status?.client_portal_job_id || '').trim(),
        [status]
    );
    const canUpload = !!orderLookup && status?.can_upload !== false;
    const currentProjectId = Number(status?.project_id || queryProjectId || orderInfo?.projectId || 0);
    const shouldUseDirectFespUpload = ENABLE_PROJECT_26_DIRECT_UPLOAD && currentProjectId === 26;
    const canSubmitRole = ['operations_manager', 'project_manager', 'qa'].includes(user?.role || '');
    const canSubmitClientPortal = !!status?.uploaded && (!status?.submitted || (forceReupload && reuploadCompleted));
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
        if (displayClientName) params.set('clientName', displayClientName);
        if (displayCustomerParentCompany) params.set('CustomerParentCompany', displayCustomerParentCompany);
        if (clientReference) params.set('clientReference', clientReference);
        if (orderLookup) params.set('clientOrderNumber', orderLookup);
        return params.toString();
    }, [displayClientName, displayCustomerParentCompany, orderInfo, orderLookup, queryClientReference, queryDisplayOrder, queryOrderNumber, queryProjectId, status]);

    const invalidFiles = useMemo(() => {
        if (!status || !orderLookup) return [];
        return files.filter((file) => !fileNameContainsOrderReference(file.name, orderLookup));
    }, [files, orderLookup, status]);
    const oversizedFiles = useMemo(
        () => files.filter((file) => file.size > MAX_CLIENT_PORTAL_UPLOAD_BYTES),
        [files],
    );
    const project26FileError = useMemo(() => {
        if (!shouldUseDirectFespUpload || files.length === 0) return '';
        if (files.length !== 1) return 'Project 26 upload expects one final ZIP file.';
        if (!files[0].name.toLowerCase().endsWith('.zip')) return 'Project 26 upload expects a .zip file.';
        return '';
    }, [files, shouldUseDirectFespUpload]);

    const uploadFiles = async () => {
        if (!orderIdValid || !files.length || invalidFiles.length || oversizedFiles.length || project26FileError || busy) return;
        setBusy('upload');
        setMessage('');
        setError('');
        setUploadProgress(0);
        setUploadElapsedSeconds(0);
        setUploadMode(shouldUseDirectFespUpload ? 'direct' : 'server');

        try {
            let response;
            if (shouldUseDirectFespUpload) {
                try {
                    const prepared = await workflowService.prepareDirectClientPortalUpload(
                        numericOrderId,
                        files[0],
                        orderLookup,
                        { forceReupload, projectId: requestedProjectId }
                    );

                    if (!prepared.data.direct_upload || !prepared.data.upload_url) {
                        response = {
                            data: {
                                message: prepared.data.message,
                                status: prepared.data.status,
                                upload_id: prepared.data.upload_id,
                            },
                        };
                    } else {
                        const directResponse = await workflowService.uploadFileToClientPortalUrl(
                            prepared.data.upload_url,
                            files[0],
                            prepared.data.headers,
                            setUploadProgress
                        );
                        response = await workflowService.confirmDirectClientPortalUpload(
                            numericOrderId,
                            prepared.data.upload_id,
                            {
                                httpStatus: directResponse.status,
                                response: typeof directResponse.data === 'string' ? directResponse.data : '',
                                projectId: requestedProjectId,
                            }
                        );
                    }
                } catch (directError: any) {
                    console.warn('Direct client portal upload unavailable, falling back to server upload:', directError);
                    setUploadMode('server');
                    setUploadProgress(0);
                    response = await workflowService.uploadToClientPortal(
                        numericOrderId,
                        files,
                        orderLookup,
                        setUploadProgress,
                        { forceReupload, projectId: requestedProjectId }
                    );
                }
            } else {
                response = await workflowService.uploadToClientPortal(
                    numericOrderId,
                    files,
                    orderLookup,
                    setUploadProgress,
                    { forceReupload, projectId: requestedProjectId }
                );
            }
            setStatus(response.data.status);
            setReuploadCompleted(forceReupload);
            setMessage(response.data.message || 'Files uploaded successfully.');
        } catch (e: any) {
            const statusCode = e.response?.status;
            const serverMessage = e.response?.data?.message || e.response?.data?.errors?.files?.[0];
            const fileSizeMessage = e.response?.data?.errors
                ? Object.entries(e.response.data.errors as Record<string, string[]>)
                    .find(([field]) => field.startsWith('files.'))?.[1]?.[0]
                : '';
            const responseText = typeof e.response?.data === 'string' ? e.response.data : '';
            const statusDetail = statusCode ? `HTTP ${statusCode}` : (e.code || '');
            setError(
                statusCode === 404 || statusCode === 405
                    ? 'Upload route is not available on the backend server yet. Please deploy the latest backend routes and clear the Laravel route cache.'
                    : fileSizeMessage || serverMessage || responseText || (statusDetail ? `Upload failed (${statusDetail}).` : 'Upload failed.')
            );
        } finally {
            setBusy(null);
            setUploadProgress(0);
            setUploadMode(null);
        }
    };

    const submitOrder = async () => {
        if (!orderIdValid || busy) return;
        setBusy('submit');
        setMessage('');
        setError('');

        try {
            const response = await workflowService.submitClientPortalOrder(numericOrderId, requestedProjectId);
            setStatus(response.data.status);
            setReuploadCompleted(false);
            setMessage(response.data.message || 'Order submitted successfully.');
        } catch (e: any) {
            setError(e.response?.data?.message || 'Submit failed.');
        } finally {
            setBusy(null);
        }
    };

    const selectFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
        setFiles(Array.from(event.target.files || []));
        setReuploadCompleted(false);
        setUploadElapsedSeconds(0);
        setUploadMode(null);
    };

    const openImageLinks = () => {
        if (!imageLookup) return;
        navigate(`/order-assets/${encodeURIComponent(imageLookup)}${imageLinkParams ? `?${imageLinkParams}` : ''}`);
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
                                <div>Client Name: {displayClientName || 'Not available'}</div>
                                <div>Customer Parent Company: {displayCustomerParentCompany || 'Not available'}</div>
                                <div>Client Portal ID: {displayClientPortalId || 'Not available'}</div>
                                <div>Upload Order Reference: {orderLookup || 'Not available'}</div>
                                <div>Client Portal Job ID: {displayClientPortalJobId || 'Not available'}</div>
                                {displayVariantNo && displayVariantNo !== displayClientPortalJobId && (
                                    <div>Client Order ID: {displayVariantNo}</div>
                                )}
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

                        {oversizedFiles.length > 0 && (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                                <div className="font-semibold text-rose-800 mb-2">File size too large</div>
                                <div>Each file must be 5 GB or less.</div>
                                <div className="mt-2 text-rose-700">
                                    {oversizedFiles.map((file) => `${file.name} (${formatFileSize(file.size)})`).join(', ')}
                                </div>
                            </div>
                        )}

                        {project26FileError && (
                            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                                {project26FileError}
                            </div>
                        )}

                        {busy === 'upload' && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex items-center justify-between text-xs font-medium text-slate-600">
                                    <span>{uploadMode === 'direct' ? 'Uploading direct to client portal' : (uploadProgress < 100 ? 'Uploading to server' : 'Uploading to client portal')}</span>
                                    <span>{uploadProgress}% · {formatElapsedTime(uploadElapsedSeconds)}</span>
                                </div>
                                <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
                                    <div
                                        className="h-full rounded-full bg-teal-500 transition-all"
                                        style={{ width: `${uploadProgress}%` }}
                                    />
                                </div>
                                <p className="mt-2 text-xs text-slate-500">
                                    Upload time: {formatElapsedTime(uploadElapsedSeconds)} · Speed: {formatUploadSpeed(files[0]?.size || 0, uploadProgress, uploadElapsedSeconds)}
                                </p>
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
                                disabled={!files.length || !!invalidFiles.length || !!oversizedFiles.length || !!project26FileError || !canUpload || busy !== null}
                            >
                                {forceReupload ? 'Reupload Files' : 'Upload Files'}
                            </Button>
                            {canSubmitRole && (
                                <Button
                                    size="sm"
                                    icon={<Send className="h-4 w-4" />}
                                    onClick={submitOrder}
                                    loading={busy === 'submit'}
                                    disabled={!canSubmitClientPortal || busy !== null}
                                >
                                    {forceReupload ? 'Submit Again' : 'Submit Order'}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </AnimatedPage>
    );
}
