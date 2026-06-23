import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { columnService, workflowService } from '../../services';
import { AnimatedPage, PageHeader, Button, StatusBadge } from '../../components/ui';
import { ArrowLeft, ExternalLink, Download, Image as ImageIcon, RefreshCw } from 'lucide-react';

type OrderAssetLink = {
    source: string;
    source_table: string;
    project_id: number;
    job_order_id: string;
    id: number;
    name: string;
    url: string;
    link_type: string;
    meta: Record<string, unknown> | null;
};

type OrderAssetLinksResponse = {
    job_order_id: string;
    requested_project_id: number | null;
    matched_project_ids: number[];
    include_external: boolean;
    portal_upload_status?: {
        required: boolean;
        checked: boolean;
        uploaded: boolean;
        failed: boolean;
        job_status: string | null;
        uploaded_count: number;
        message: string;
    } | null;
    count: number;
    links: OrderAssetLink[];
};

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.svg'];
const ORDER_INFO_FIELD_ALIASES: Record<string, string[]> = {
    order_number: ['order_number'],
    client_name: ['client_name'],
    client_reference: ['client_reference', 'client_ref'],
    client_order_number: ['client_order_number', 'clint_order_number', 'client_order_no'],
};

function isImageLike(name: string, url: string): boolean {
    const lowerName = name.toLowerCase();
    const lowerUrl = url.toLowerCase();

    return IMAGE_EXTENSIONS.some((ext) => lowerName.endsWith(ext) || lowerUrl.includes(ext));
}

function isAutoPreviewFloorplan(url: string): boolean {
    try {
        const parsed = new URL(url);
        const pathParts = parsed.pathname.toLowerCase().split('/');
        const fileName = pathParts[pathParts.length - 1] || '';

        return pathParts.includes('floorplansraw') && fileName.startsWith('image_picker_');
    } catch {
        const lowerUrl = url.toLowerCase();
        const fileName = lowerUrl.split('/').pop() || '';

        return lowerUrl.includes('/floorplansraw/') && fileName.startsWith('image_picker_');
    }
}

function getLinkKey(link: OrderAssetLink): string {
    return `${link.source_table}-${link.id}`;
}

export default function OrderAssetLinks() {
    const navigate = useNavigate();
    const { jobOrderId: routeJobOrderId } = useParams<{ jobOrderId: string }>();
    const [searchParams] = useSearchParams();

    const jobOrderId = (routeJobOrderId || searchParams.get('jobOrderId') || '').trim();
    const displayOrder = (searchParams.get('displayOrder') || '').trim();
    const projectIdFromQuery = (searchParams.get('projectId') || '').trim();
    const orderNumberFromQuery = (searchParams.get('orderNumber') || '').trim();
    const clientNameFromQuery = (searchParams.get('clientName') || '').trim();
    const clientReferenceFromQuery = (searchParams.get('clientReference') || '').trim();
    const clientOrderNumberFromQuery = (searchParams.get('clientOrderNumber') || '').trim();

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<OrderAssetLinksResponse | null>(null);
    const [brokenImageIds, setBrokenImageIds] = useState<Record<number, boolean>>({});
    const [previewedImageKeys, setPreviewedImageKeys] = useState<Record<string, boolean>>({});
    const [projectColumns, setProjectColumns] = useState<Array<{ field: string; visible: boolean; label?: string; name?: string }>>([]);

    const loadLinks = async () => {
        if (!jobOrderId) {
            setData(null);
            setError('Missing jobOrderId. Please open this page from Worker Dashboard.');
            return;
        }

        setLoading(true);
        setError(null);
        const parsedProjectId = Number(projectIdFromQuery);
        const requestedProjectId = Number.isFinite(parsedProjectId) && parsedProjectId > 0
            ? parsedProjectId
            : undefined;

        try {
            const primary = await workflowService.orderAssetLinks(jobOrderId, requestedProjectId);
            setData(primary.data);
            setBrokenImageIds({});
            setPreviewedImageKeys({});
        } catch (primaryError) {
            try {
                const fallback = await workflowService.orderImageLinks(jobOrderId, requestedProjectId);
                setData(fallback.data);
                setBrokenImageIds({});
                setPreviewedImageKeys({});
            } catch {
                console.error('Failed to fetch order asset links:', primaryError);
                setData(null);
                setError('Unable to fetch image links for this order right now.');
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadLinks();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jobOrderId]);

    useEffect(() => {
        const projectIdNum = Number(projectIdFromQuery);
        if (!Number.isFinite(projectIdNum) || projectIdNum <= 0) {
            setProjectColumns([]);
            return;
        }

        let cancelled = false;

        columnService.getAllColumns(projectIdNum)
            .then((response) => {
                if (cancelled) return;
                setProjectColumns(response.data?.data ?? []);
            })
            .catch((columnError) => {
                console.error('Failed to load project columns for order assets page:', columnError);
                if (!cancelled) {
                    setProjectColumns([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [projectIdFromQuery]);

    const links = data?.links ?? [];

    const sortedLinks = useMemo(() => {
        return [...links].sort((a, b) => {
            const left = Number.isFinite(a.id) ? a.id : Number.MAX_SAFE_INTEGER;
            const right = Number.isFinite(b.id) ? b.id : Number.MAX_SAFE_INTEGER;
            return left - right;
        });
    }, [links]);

    const imageLinks = useMemo(() => {
        return sortedLinks.filter((link) => isImageLike(link.name, link.url));
    }, [sortedLinks]);

    const autoPreviewImageKey = useMemo(() => {
        const floorplanLink = imageLinks.find((link) => isAutoPreviewFloorplan(link.url));
        return floorplanLink ? getLinkKey(floorplanLink) : null;
    }, [imageLinks]);

    const visibleFieldSet = useMemo(() => {
        const set = new Set<string>();
        projectColumns.filter((col) => col.visible).forEach((col) => set.add(String(col.field || '').toLowerCase()));
        return set;
    }, [projectColumns]);

    const hasSavedColumnConfig = projectColumns.length > 0;
    const shouldShowOrderInfoField = (field: keyof typeof ORDER_INFO_FIELD_ALIASES) => {
        if (!hasSavedColumnConfig) return true;
        return ORDER_INFO_FIELD_ALIASES[field].some((alias) => visibleFieldSet.has(alias.toLowerCase()));
    };

    const downloadFile = async (url: string, name: string) => {
        try {
            const response = await fetch(url, { mode: 'cors' });
            if (!response.ok) {
                throw new Error(`Download failed with status ${response.status}`);
            }

            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = blobUrl;
            anchor.download = name || 'image';
            anchor.style.display = 'none';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(blobUrl);
        } catch (downloadError) {
            console.error('Download failed, falling back to direct link:', downloadError);
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };

    const matchedProjectIds = Array.isArray(data?.matched_project_ids)
        ? data?.matched_project_ids
        : [];
    const portalStatus = data?.portal_upload_status;

    return (
        <AnimatedPage>
            <PageHeader
                title="Order Image Links"
                subtitle="Preview and download project images fetched from linked asset tables"
                actions={
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" size="sm" icon={<ArrowLeft className="w-4 h-4" />} onClick={() => navigate(-1)}>
                            Back
                        </Button>
                        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-4 h-4" />} onClick={() => void loadLinks()} loading={loading}>
                            Refresh
                        </Button>
                    </div>
                }
            />

            <div className="bg-white rounded-xl ring-1 ring-black/[0.05] p-4 md:p-5 mb-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                    <div>
                        <div className="text-slate-500">Lookup Value</div>
                        <div className="font-semibold text-slate-900 break-all">{jobOrderId || '—'}</div>
                    </div>
                    <div>
                        <div className="text-slate-500">Display Order</div>
                        <div className="font-semibold text-slate-900">{displayOrder || '—'}</div>
                    </div>
                    <div>
                        <div className="text-slate-500">Project</div>
                        <div className="font-semibold text-slate-900">{projectIdFromQuery || '—'}</div>
                    </div>
                    <div>
                        <div className="text-slate-500">Total Links</div>
                        <div className="font-semibold text-slate-900">{data?.count ?? 0}</div>
                    </div>
                </div>

                {data && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <StatusBadge status={`matched ${matchedProjectIds.join(', ') || 'none'}`} size="sm" />
                        <StatusBadge status={data.include_external ? 'includes external links' : 'project-table links'} size="sm" />
                    </div>
                )}

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm border-t border-slate-100 pt-4">
                    {shouldShowOrderInfoField('order_number') && (
                        <div>
                            <div className="text-slate-500">Order Number</div>
                            <div className="font-semibold text-slate-900 break-all">{orderNumberFromQuery || '—'}</div>
                        </div>
                    )}
                    {shouldShowOrderInfoField('client_name') && (
                        <div>
                            <div className="text-slate-500">Client Name</div>
                            <div className="font-semibold text-slate-900 break-all">{clientNameFromQuery || '—'}</div>
                        </div>
                    )}
                    {shouldShowOrderInfoField('client_reference') && (
                        <div>
                            <div className="text-slate-500">Order Reference</div>
                            <div className="font-semibold text-slate-900 break-all">{clientReferenceFromQuery || '—'}</div>
                        </div>
                    )}
                    {shouldShowOrderInfoField('client_order_number') && (
                        <div>
                            <div className="text-slate-500">Client Order Number</div>
                            <div className="font-semibold text-slate-900 break-all">{clientOrderNumberFromQuery || displayOrder || '—'}</div>
                        </div>
                    )}
                </div>
            </div>

            {error && (
                <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 mb-5 text-sm">
                    {error}
                </div>
            )}

            {portalStatus?.required && (
                <div className={`rounded-xl border p-4 mb-5 ${
                    portalStatus.uploaded
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : portalStatus.failed
                            ? 'bg-rose-50 border-rose-200 text-rose-800'
                            : portalStatus.checked
                                ? 'bg-amber-50 border-amber-200 text-amber-800'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="text-sm font-semibold">Client Portal File Check</h2>
                            <p className="text-sm mt-1">{portalStatus.message}</p>
                        </div>
                        <StatusBadge
                            status={
                                portalStatus.uploaded
                                    ? 'uploaded'
                                    : portalStatus.failed
                                        ? 'failed'
                                        : portalStatus.checked
                                            ? 'not uploaded'
                                            : 'check unavailable'
                            }
                            size="sm"
                        />
                    </div>
                </div>
            )}

            {!loading && !error && sortedLinks.length === 0 && (
                <div className="bg-white rounded-xl ring-1 ring-black/[0.05] p-10 text-center">
                    <ImageIcon className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                    <h3 className="text-base font-semibold text-slate-800 mb-1">No image links found</h3>
                    <p className="text-sm text-slate-500">This order currently has no linked image assets.</p>
                </div>
            )}

            {!loading && !error && sortedLinks.length > 0 && (
                <div className="space-y-4">
                    {imageLinks.length > 0 && (
                        <div>
                            <h2 className="text-sm font-semibold text-slate-700 mb-3">Image Assets</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                                {imageLinks.map((link) => {
                                    const linkKey = getLinkKey(link);
                                    const broken = !!brokenImageIds[link.id];
                                    const shouldLoadPreview = linkKey === autoPreviewImageKey || !!previewedImageKeys[linkKey];

                                    return (
                                        <div key={linkKey} className="bg-white rounded-xl ring-1 ring-black/[0.05] overflow-hidden">
                                            <div className="h-52 bg-slate-100 flex items-center justify-center">
                                                {broken ? (
                                                    <div className="text-slate-500 text-sm">Preview unavailable</div>
                                                ) : shouldLoadPreview ? (
                                                    <img
                                                        src={link.url}
                                                        alt={link.name}
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                        onError={() => setBrokenImageIds((prev) => ({ ...prev, [link.id]: true }))}
                                                    />
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => setPreviewedImageKeys((prev) => ({ ...prev, [linkKey]: true }))}
                                                        className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-white"
                                                    >
                                                        <ImageIcon className="w-4 h-4" />
                                                        Preview
                                                    </button>
                                                )}
                                            </div>

                                            <div className="p-3">
                                                <div className="text-sm font-semibold text-slate-800 truncate" title={link.name}>{link.name}</div>
                                                <div className="text-xs text-slate-500 mt-1">#{link.id} • Project {link.project_id}</div>
                                                <div className="mt-3 flex items-center gap-2">
                                                    <a
                                                        href={link.url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                                                    >
                                                        <ExternalLink className="w-3.5 h-3.5" />
                                                        Open
                                                    </a>
                                                    <button
                                                        type="button"
                                                        onClick={() => void downloadFile(link.url, link.name)}
                                                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                                                    >
                                                        <Download className="w-3.5 h-3.5" />
                                                        Download
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {sortedLinks.length > imageLinks.length && (
                        <div>
                            <h2 className="text-sm font-semibold text-slate-700 mb-3">Other Asset Links</h2>
                            <div className="bg-white rounded-xl ring-1 ring-black/[0.05] divide-y divide-slate-100 overflow-hidden">
                                {sortedLinks
                                    .filter((link) => !isImageLike(link.name, link.url))
                                    .map((link) => (
                                        <div key={`${link.source_table}-${link.id}`} className="p-3 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-sm font-medium text-slate-800 truncate" title={link.name}>{link.name}</div>
                                                <div className="text-xs text-slate-500">#{link.id} • {link.link_type || 'asset'} • Project {link.project_id}</div>
                                            </div>
                                            <a
                                                href={link.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                                            >
                                                <ExternalLink className="w-3.5 h-3.5" />
                                                Open
                                            </a>
                                        </div>
                                    ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </AnimatedPage>
    );
}
