import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { columnService, workflowService } from '../../services';
import { AnimatedPage, PageHeader, Button, StatusBadge } from '../../components/ui';
import { ArrowLeft, ExternalLink, Download, Image as ImageIcon, RefreshCw, Play, Pause, Square, RotateCcw, Trash2, Folder } from 'lucide-react';

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

type DownloadStatus = 'ready' | 'downloading' | 'paused' | 'stopped' | 'completed' | 'failed';

type QueueStatus = 'pending' | 'downloading' | 'completed' | 'failed';

type DownloadLog = {
    id: number;
    type: 'info' | 'success' | 'warning' | 'error';
    message: string;
    time: string;
};

type ImageProgress = {
    percent: number;
    loadedBytes: number;
    totalBytes: number;
};

type AssetChunk = {
    index: number;
    offset: number;
    limit: number;
    size: number;
    name: string;
    links: OrderAssetLink[];
};

type FailedImage = {
    link: OrderAssetLink;
    absoluteIndex: number;
    fileName: string;
    folderIndex: number;
    folderName: string;
    error: string;
};

type ZipDownloadState = {
    status: DownloadStatus;
    completed: number;
    total: number;
    failed: number;
    percent: number;
    currentPercent: number;
    currentLoadedBytes: number;
    currentTotalBytes: number;
    totalDownloadedBytes: number;
    startedAt: number | null;
    finishedAt: number | null;
    elapsedMs: number;
    estimatedRemainingMs: number | null;
    currentChunk: number;
    totalChunks: number;
    message: string;
    currentFileInfo: string;
    fallbackAvailable: boolean;
    queue: QueueStatus[];
    failedImages: FailedImage[];
};

const BROWSER_PREVIEW_EXTENSIONS = [
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.gif',
    '.bmp',
    '.tif',
    '.tiff',
    '.svg',
];
const DEFAULT_ZIP_CHUNK_SIZE = 100;
const LARGE_RAW_PROJECT_ZIP_CHUNK_SIZE = 5;
const MAX_ZIP_CHUNK_SIZE = 100;
const ZIP_CHUNK_SIZE_OPTIONS = [5, 10, 20, 50, 100];
const IMAGE_DOWNLOAD_RETRIES = 3;
const IMAGE_DOWNLOAD_RETRY_DELAY_MS = 550;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 180000;
const ORDER_INFO_FIELD_ALIASES: Record<string, string[]> = {
    order_number: ['order_number'],
    client_name: ['client_name'],
    client_reference: ['client_reference', 'client_ref'],
    client_order_number: ['client_order_number', 'clint_order_number', 'client_order_no'],
};

function canPreviewInBrowser(name: string, url: string): boolean {
    const lowerName = name.toLowerCase();
    const lowerUrl = url.toLowerCase();

    return BROWSER_PREVIEW_EXTENSIONS.some((ext) => lowerName.endsWith(ext) || lowerUrl.includes(ext));
}

function getLinkKey(link: OrderAssetLink): string {
    return `${link.source_table}-${link.id}`;
}

function zipSafeFileName(name: string, fallback: string): string {
    const cleaned = (name || fallback).trim().replace(/[\\/:*?"<>|]/g, '_');
    return cleaned || fallback;
}

function downloadBlob(blob: Blob, fileName: string) {
    const blobUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(blobUrl);
}

function downloadDirectLink(url: string, fileName: string) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }

    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(ms: number | null): string {
    if (!Number.isFinite(ms ?? NaN) || !ms || ms <= 0) return '0s';
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function formatClockTime(timestamp: number | null): string {
    if (!timestamp) return '--';
    return new Date(timestamp).toLocaleTimeString();
}

function estimateRemainingMs(startedAt: number, processedUnits: number, totalUnits: number): number | null {
    if (!startedAt || processedUnits <= 0 || totalUnits <= 0 || processedUnits >= totalUnits) return null;
    const elapsedMs = Date.now() - startedAt;
    const averageMsPerUnit = elapsedMs / processedUnits;
    return Math.max(0, Math.round((totalUnits - processedUnits) * averageMsPerUnit));
}

function normalizeChunkSize(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_ZIP_CHUNK_SIZE;
    return Math.min(MAX_ZIP_CHUNK_SIZE, Math.max(1, Math.floor(value)));
}

function createCrc32Table(): Uint32Array {
    const table = new Uint32Array(256);

    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }

    return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;

    for (let index = 0; index < bytes.length; index += 1) {
        crc = CRC32_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }

    return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number) {
    view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number) {
    view.setUint32(offset, value >>> 0, true);
}

function getZipDateParts(date = new Date()) {
    const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();

    return { dosTime, dosDate };
}

function createZipBlob(files: Array<{ name: string; data: Uint8Array }>): Blob {
    const encoder = new TextEncoder();
    const parts: Array<Uint8Array> = [];
    const centralParts: Uint8Array[] = [];
    let offset = 0;
    const { dosTime, dosDate } = getZipDateParts();

    files.forEach((file) => {
        const nameBytes = encoder.encode(file.name);
        const checksum = crc32(file.data);
        const localHeader = new Uint8Array(30 + nameBytes.length);
        const localView = new DataView(localHeader.buffer);

        writeUint32(localView, 0, 0x04034b50);
        writeUint16(localView, 4, 20);
        writeUint16(localView, 6, 0x0800);
        writeUint16(localView, 8, 0);
        writeUint16(localView, 10, dosTime);
        writeUint16(localView, 12, dosDate);
        writeUint32(localView, 14, checksum);
        writeUint32(localView, 18, file.data.length);
        writeUint32(localView, 22, file.data.length);
        writeUint16(localView, 26, nameBytes.length);
        writeUint16(localView, 28, 0);
        localHeader.set(nameBytes, 30);

        parts.push(localHeader, file.data);

        const centralHeader = new Uint8Array(46 + nameBytes.length);
        const centralView = new DataView(centralHeader.buffer);
        writeUint32(centralView, 0, 0x02014b50);
        writeUint16(centralView, 4, 20);
        writeUint16(centralView, 6, 20);
        writeUint16(centralView, 8, 0x0800);
        writeUint16(centralView, 10, 0);
        writeUint16(centralView, 12, dosTime);
        writeUint16(centralView, 14, dosDate);
        writeUint32(centralView, 16, checksum);
        writeUint32(centralView, 20, file.data.length);
        writeUint32(centralView, 24, file.data.length);
        writeUint16(centralView, 28, nameBytes.length);
        writeUint16(centralView, 30, 0);
        writeUint16(centralView, 32, 0);
        writeUint16(centralView, 34, 0);
        writeUint16(centralView, 36, 0);
        writeUint32(centralView, 38, 0);
        writeUint32(centralView, 42, offset);
        centralHeader.set(nameBytes, 46);
        centralParts.push(centralHeader);

        offset += localHeader.length + file.data.length;
    });

    const centralOffset = offset;
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const endHeader = new Uint8Array(22);
    const endView = new DataView(endHeader.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 4, 0);
    writeUint16(endView, 6, 0);
    writeUint16(endView, 8, files.length);
    writeUint16(endView, 10, files.length);
    writeUint32(endView, 12, centralSize);
    writeUint32(endView, 16, centralOffset);
    writeUint16(endView, 20, 0);

    const blobParts = [...parts, ...centralParts, endHeader].map((part) => (
        part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) as ArrayBuffer
    ));

    return new Blob(blobParts, { type: 'application/zip' });
}

function makeUniqueZipFileName(fileName: string, usedFileNames: Map<string, number>): string {
    const currentCount = usedFileNames.get(fileName) ?? 0;
    usedFileNames.set(fileName, currentCount + 1);

    if (currentCount === 0) return fileName;

    const dotIndex = fileName.lastIndexOf('.');
    const suffix = `_${currentCount + 1}`;

    if (dotIndex > 0) {
        return `${fileName.slice(0, dotIndex)}${suffix}${fileName.slice(dotIndex)}`;
    }

    return `${fileName}${suffix}`;
}

function createInitialZipState(): ZipDownloadState {
    return {
        status: 'ready',
        completed: 0,
        total: 0,
        failed: 0,
        percent: 0,
        currentPercent: 0,
        currentLoadedBytes: 0,
        currentTotalBytes: 0,
        totalDownloadedBytes: 0,
        startedAt: null,
        finishedAt: null,
        elapsedMs: 0,
        estimatedRemainingMs: null,
        currentChunk: 0,
        totalChunks: 0,
        message: '',
        currentFileInfo: 'Waiting to start...',
        fallbackAvailable: false,
        queue: [],
        failedImages: [],
    };
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
    const [showAllPreviews, setShowAllPreviews] = useState(false);
    const parsedProjectIdForDefaults = Number(projectIdFromQuery);
    const defaultChunkSize = parsedProjectIdForDefaults === 26
        ? LARGE_RAW_PROJECT_ZIP_CHUNK_SIZE
        : DEFAULT_ZIP_CHUNK_SIZE;
    const [chunkSize, setChunkSize] = useState(() => normalizeChunkSize(defaultChunkSize));
    const [zipDownload, setZipDownload] = useState<ZipDownloadState>(() => createInitialZipState());
    const [downloadLogs, setDownloadLogs] = useState<DownloadLog[]>([]);
    const stopDownloadRef = useRef(false);
    const pauseDownloadRef = useRef(false);
    const logIdRef = useRef(0);
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
            setShowAllPreviews(false);
        } catch (primaryError) {
            try {
                const fallback = await workflowService.orderImageLinks(jobOrderId, requestedProjectId);
                setData(fallback.data);
                setBrokenImageIds({});
                setPreviewedImageKeys({});
                setShowAllPreviews(false);
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
        setChunkSize(normalizeChunkSize(defaultChunkSize));
        setZipDownload(createInitialZipState());
        setDownloadLogs([]);
    }, [defaultChunkSize, jobOrderId]);

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

    const imageLinks = sortedLinks;

    const chunkSummary = useMemo<AssetChunk[]>(() => {
        const safeChunkSize = normalizeChunkSize(chunkSize);
        const chunks: AssetChunk[] = [];

        for (let offset = 0; offset < imageLinks.length; offset += safeChunkSize) {
            const chunkLinks = imageLinks.slice(offset, offset + safeChunkSize);
            chunks.push({
                index: chunks.length,
                offset,
                limit: safeChunkSize,
                size: chunkLinks.length,
                name: `Folder_${chunks.length + 1}`,
                links: chunkLinks,
            });
        }

        return chunks;
    }, [chunkSize, imageLinks]);

    const addDownloadLog = (message: string, type: DownloadLog['type'] = 'info') => {
        const now = new Date();
        logIdRef.current += 1;
        setDownloadLogs((current) => [
            ...current.slice(-79),
            {
                id: logIdRef.current,
                type,
                message,
                time: now.toLocaleTimeString(),
            },
        ]);
    };

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
        if (Number(projectIdFromQuery) === 26 || !canPreviewInBrowser(name, url)) {
            downloadDirectLink(url, name || 'image');
            return;
        }

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

    const directDownloadImageLinks = async () => {
        if (!imageLinks.length) return;

        stopDownloadRef.current = false;
        const directStartedAt = Date.now();
        setZipDownload({
            status: 'downloading',
            completed: 0,
            total: imageLinks.length,
            failed: 0,
            percent: 0,
            currentPercent: 0,
            currentLoadedBytes: 0,
            currentTotalBytes: 0,
            totalDownloadedBytes: 0,
            startedAt: directStartedAt,
            finishedAt: null,
            elapsedMs: 0,
            estimatedRemainingMs: null,
            currentChunk: 0,
            totalChunks: imageLinks.length,
            message: 'Starting direct browser downloads one by one...',
            currentFileInfo: 'Starting direct downloads...',
            fallbackAvailable: false,
            queue: imageLinks.map(() => 'pending'),
            failedImages: [],
        });
        addDownloadLog(`Starting ${imageLinks.length} direct downloads`, 'info');

        for (let index = 0; index < imageLinks.length; index += 1) {
            if (stopDownloadRef.current) break;

            const link = imageLinks[index];
            downloadDirectLink(link.url, zipSafeFileName(link.name, `image-${index + 1}`));

            const completed = index + 1;
            setZipDownload({
                status: 'downloading',
                completed,
                total: imageLinks.length,
                failed: 0,
                percent: Math.round((completed / imageLinks.length) * 100),
                currentPercent: 100,
                currentLoadedBytes: 0,
                currentTotalBytes: 0,
                totalDownloadedBytes: 0,
                startedAt: directStartedAt,
                ...timingPatch(directStartedAt, completed, imageLinks.length),
                currentChunk: completed,
                totalChunks: imageLinks.length,
                message: `Started ${completed} of ${imageLinks.length} direct downloads`,
                currentFileInfo: link.name || `image-${completed}`,
                fallbackAvailable: false,
                queue: imageLinks.map((_, queueIndex) => queueIndex < completed ? 'completed' : 'pending'),
                failedImages: [],
            });

            await new Promise((resolve) => window.setTimeout(resolve, 350));
        }

        setZipDownload((current) => ({
            ...current,
            status: stopDownloadRef.current ? 'stopped' : 'completed',
            message: stopDownloadRef.current ? 'Direct downloads stopped' : 'Direct downloads started',
            currentFileInfo: stopDownloadRef.current ? 'Stopped' : 'Download requests completed',
            ...timingPatch(directStartedAt, current.completed, imageLinks.length, Date.now()),
        }));
    };

    const stopBatchDownload = () => {
        if (!['downloading', 'paused'].includes(zipDownload.status)) return;
        stopDownloadRef.current = true;
        pauseDownloadRef.current = false;
        setZipDownload((current) => ({
            ...current,
            status: 'stopped',
            message: 'Stopping after the current ZIP part finishes...',
            currentFileInfo: 'Stop requested',
        }));
        addDownloadLog('Stop requested. Current ZIP request will finish safely first.', 'warning');
    };

    const pauseBatchDownload = () => {
        if (zipDownload.status === 'downloading') {
            pauseDownloadRef.current = true;
            setZipDownload((current) => ({
                ...current,
                status: 'paused',
                message: 'Paused. The downloader will wait before the next ZIP part.',
                currentFileInfo: 'Paused between ZIP parts',
            }));
            addDownloadLog('Download paused between ZIP parts', 'warning');
            return;
        }

        if (zipDownload.status === 'paused') {
            pauseDownloadRef.current = false;
            setZipDownload((current) => ({
                ...current,
                status: 'downloading',
                message: 'Resuming download queue...',
            }));
            addDownloadLog('Download resumed', 'info');
        }
    };

    const waitWhilePaused = async () => {
        while (pauseDownloadRef.current && !stopDownloadRef.current) {
            await new Promise((resolve) => window.setTimeout(resolve, 400));
        }
    };

    const timingPatch = (startedAt: number | null, processedUnits: number, totalUnits: number, finishedAt?: number) => {
        const now = finishedAt ?? Date.now();
        return {
            elapsedMs: startedAt ? now - startedAt : 0,
            estimatedRemainingMs: finishedAt || !startedAt ? null : estimateRemainingMs(startedAt, processedUnits, totalUnits),
            finishedAt: finishedAt ?? null,
        };
    };

    const fetchImageBytes = async (
        link: OrderAssetLink,
        onProgress: (progress: ImageProgress) => void,
    ): Promise<Uint8Array> => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);

        let response: Response;

        try {
            response = await fetch(link.url, { mode: 'cors', signal: controller.signal });
        } catch (fetchError) {
            window.clearTimeout(timeoutId);
            if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
                throw new Error(`Timed out after ${Math.round(IMAGE_DOWNLOAD_TIMEOUT_MS / 1000)}s`);
            }
            throw fetchError;
        }

        if (!response.ok) {
            window.clearTimeout(timeoutId);
            throw new Error(`HTTP ${response.status}`);
        }

        const totalBytes = Number(response.headers.get('content-length') || 0);

        if (!response.body) {
            try {
                const buffer = await response.arrayBuffer();
                onProgress({
                    percent: 99,
                    loadedBytes: buffer.byteLength,
                    totalBytes: buffer.byteLength,
                });
                return new Uint8Array(buffer);
            } finally {
                window.clearTimeout(timeoutId);
            }
        }

        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;

        while (true) {
            let done = false;
            let value: Uint8Array | undefined;

            try {
                const result = await reader.read();
                done = result.done;
                value = result.value;
            } catch (readError) {
                window.clearTimeout(timeoutId);
                if (readError instanceof DOMException && readError.name === 'AbortError') {
                    throw new Error(`Timed out after ${Math.round(IMAGE_DOWNLOAD_TIMEOUT_MS / 1000)}s`);
                }
                throw readError;
            }

            if (done) break;

            if (stopDownloadRef.current) {
                window.clearTimeout(timeoutId);
                throw new Error('Stopped by user');
            }

            if (value) {
                chunks.push(value);
                receivedBytes += value.length;
                if (totalBytes > 0) {
                    onProgress({
                        percent: Math.min(99, Math.round((receivedBytes / totalBytes) * 100)),
                        loadedBytes: receivedBytes,
                        totalBytes,
                    });
                } else {
                    onProgress({
                        percent: Math.min(95, Math.max(1, Math.round(receivedBytes / (1024 * 1024)))),
                        loadedBytes: receivedBytes,
                        totalBytes: 0,
                    });
                }
            }
        }

        window.clearTimeout(timeoutId);

        const output = new Uint8Array(receivedBytes);
        let offset = 0;
        chunks.forEach((chunk) => {
            output.set(chunk, offset);
            offset += chunk.length;
        });

        return output;
    };

    const fetchImageBytesWithRetry = async (
        link: OrderAssetLink,
        fileName: string,
        onProgress: (progress: ImageProgress) => void,
    ): Promise<Uint8Array> => {
        let lastError: unknown;

        for (let attempt = 1; attempt <= IMAGE_DOWNLOAD_RETRIES; attempt += 1) {
            try {
                return await fetchImageBytes(link, onProgress);
            } catch (imageError) {
                lastError = imageError;
                if (stopDownloadRef.current || attempt === IMAGE_DOWNLOAD_RETRIES) break;
                addDownloadLog(`Retry ${attempt}/${IMAGE_DOWNLOAD_RETRIES - 1} for ${fileName}`, 'warning');
                await new Promise((resolve) => window.setTimeout(resolve, IMAGE_DOWNLOAD_RETRY_DELAY_MS * attempt));
            }
        }

        throw lastError instanceof Error ? lastError : new Error('Download failed');
    };

    const buildRetryChunks = (retryImages: FailedImage[]): AssetChunk[] => {
        const retryMap = new Map<number, FailedImage[]>();
        retryImages.forEach((image) => {
            const current = retryMap.get(image.folderIndex) ?? [];
            current.push(image);
            retryMap.set(image.folderIndex, current);
        });

        return Array.from(retryMap.entries()).map(([folderIndex, images]) => ({
            index: folderIndex,
            offset: images[0]?.absoluteIndex ?? 0,
            limit: images.length,
            size: images.length,
            name: `${images[0]?.folderName || `Folder_${folderIndex + 1}`}_Retry`,
            links: images.map((image) => image.link),
        }));
    };

    const downloadAllImages = async (retryImages?: FailedImage[]) => {
        if (!imageLinks.length || zipDownload.status === 'downloading') return;

        const chunksToDownload = retryImages?.length ? buildRetryChunks(retryImages) : chunkSummary;
        const totalChunks = chunksToDownload.length;
        const totalImagesToDownload = chunksToDownload.reduce((sum, chunk) => sum + chunk.links.length, 0);
        const zipBaseName = zipSafeFileName(orderNumberFromQuery || displayOrder || jobOrderId || 'order-images', 'order-images');

        if (!totalChunks) return;

        if (!retryImages?.length) {
            const breakdown = chunkSummary
                .slice(0, 12)
                .map((chunk) => `${chunk.name}: ${chunk.size} files`)
                .join('\n');
            const moreText = chunkSummary.length > 12
                ? `\n... and ${chunkSummary.length - 12} more folders`
                : '';
            const confirmMessage = [
                `Total: ${imageLinks.length} files`,
                `Files per folder: ${chunkSize}`,
                `Folders needed: ${chunkSummary.length}`,
                '',
                'Folder breakdown:',
                `${breakdown}${moreText}`,
                '',
                'Continue with download?',
            ].join('\n');

            if (!window.confirm(confirmMessage)) {
                addDownloadLog('Download cancelled before starting', 'warning');
                return;
            }
        }

        stopDownloadRef.current = false;
        pauseDownloadRef.current = false;
        const startedAt = Date.now();
        setZipDownload({
            status: 'downloading',
            completed: 0,
            total: totalImagesToDownload,
            failed: 0,
            percent: 0,
            currentPercent: 0,
            currentLoadedBytes: 0,
            currentTotalBytes: 0,
            totalDownloadedBytes: 0,
            startedAt,
            finishedAt: null,
            elapsedMs: 0,
            estimatedRemainingMs: null,
            currentChunk: 0,
            totalChunks,
            message: retryImages?.length
                ? `Retrying ${retryImages.length} failed image${retryImages.length === 1 ? '' : 's'}...`
                : `Preparing ZIP part 1 of ${totalChunks}...`,
            currentFileInfo: 'Preparing download queue...',
            fallbackAvailable: false,
            queue: chunkSummary.map((chunk) => chunksToDownload.some((item) => item.index === chunk.index) ? 'pending' : 'completed'),
            failedImages: [],
        });
        addDownloadLog(`Download started: ${totalImagesToDownload} image${totalImagesToDownload === 1 ? '' : 's'} in ${totalChunks} folder ZIP${totalChunks === 1 ? '' : 's'}`, 'info');

        try {
            let completedFiles = 0;
            let totalDownloadedBytes = 0;
            const failedImages: FailedImage[] = [];

            for (let queueIndex = 0; queueIndex < chunksToDownload.length; queueIndex += 1) {
                await waitWhilePaused();
                if (stopDownloadRef.current) break;

                const chunk = chunksToDownload[queueIndex];
                const processedFilesAtChunkStart = completedFiles + failedImages.length;
                const chunkStartPercent = Math.round((processedFilesAtChunkStart / totalImagesToDownload) * 100);

                setZipDownload({
                    status: 'downloading',
                    completed: completedFiles,
                    total: totalImagesToDownload,
                    failed: failedImages.length,
                    percent: chunkStartPercent,
                    currentPercent: 0,
                    currentLoadedBytes: 0,
                    currentTotalBytes: 0,
                    totalDownloadedBytes,
                    startedAt,
                    ...timingPatch(startedAt, completedFiles + failedImages.length, totalImagesToDownload),
                    currentChunk: queueIndex + 1,
                    totalChunks,
                    message: `Preparing ${chunk.name} (${queueIndex + 1} of ${totalChunks})...`,
                    currentFileInfo: `${chunk.name}: ${chunk.size} files`,
                    fallbackAvailable: false,
                    queue: chunkSummary.map((queueChunk) => {
                        const activeChunkIndex = chunksToDownload.findIndex((item) => item.index === queueChunk.index);
                        if (activeChunkIndex === -1) return 'completed';
                        if (activeChunkIndex < queueIndex) return failedImages.some((failed) => failed.folderIndex === queueChunk.index) ? 'failed' : 'completed';
                        if (activeChunkIndex === queueIndex) return 'downloading';
                        return 'pending';
                    }),
                    failedImages,
                });
                addDownloadLog(`Starting ${chunk.name} with ${chunk.size} files`, 'info');

                const zipFiles: Array<{ name: string; data: Uint8Array }> = [];
                const usedFileNames = new Map<string, number>();
                let successfulInChunk = 0;
                let failedInChunk = 0;

                for (let fileIndex = 0; fileIndex < chunk.links.length; fileIndex += 1) {
                    await waitWhilePaused();
                    if (stopDownloadRef.current) break;

                    const link = chunk.links[fileIndex];
                    const absoluteIndex = chunk.offset + fileIndex;
                    const safeName = zipSafeFileName(link.name, `image-${absoluteIndex + 1}`);
                    const uniqueFileName = makeUniqueZipFileName(safeName, usedFileNames);

                    addDownloadLog(`${chunk.name}: Downloading file ${fileIndex + 1}/${chunk.links.length} - ${safeName}`, 'info');
                    setZipDownload((current) => ({
                        ...current,
                        currentPercent: 0,
                        currentLoadedBytes: 0,
                        currentTotalBytes: 0,
                        ...timingPatch(startedAt, completedFiles + failedImages.length, totalImagesToDownload),
                        currentFileInfo: `${chunk.name}: ${fileIndex + 1}/${chunk.links.length} - ${safeName}`,
                    }));

                    try {
                        const bytes = await fetchImageBytesWithRetry(link, safeName, (fileProgress) => {
                            const processedFiles = completedFiles + failedImages.length;
                            const processedUnits = processedFiles + (fileProgress.percent / 100);
                            const weightedPercent = Math.round(
                                (processedUnits / totalImagesToDownload) * 100
                            );

                            setZipDownload((current) => ({
                                ...current,
                                status: pauseDownloadRef.current ? 'paused' : 'downloading',
                                completed: completedFiles,
                                failed: failedImages.length,
                                percent: Math.max(chunkStartPercent, weightedPercent),
                                currentPercent: fileProgress.percent,
                                currentLoadedBytes: fileProgress.loadedBytes,
                                currentTotalBytes: fileProgress.totalBytes,
                                totalDownloadedBytes: totalDownloadedBytes + fileProgress.loadedBytes,
                                ...timingPatch(startedAt, processedUnits, totalImagesToDownload),
                                message: `Downloading ${chunk.name} (${queueIndex + 1} of ${totalChunks})...`,
                                currentFileInfo: `${chunk.name}: ${fileIndex + 1}/${chunk.links.length} - ${safeName}`,
                            }));
                        });

                        zipFiles.push({ name: uniqueFileName, data: bytes });
                        completedFiles += 1;
                        totalDownloadedBytes += bytes.byteLength;
                        successfulInChunk += 1;
                        setZipDownload((current) => ({
                            ...current,
                            completed: completedFiles,
                            failed: failedImages.length,
                            percent: totalImagesToDownload ? Math.round(((completedFiles + failedImages.length) / totalImagesToDownload) * 100) : 0,
                            currentPercent: 100,
                            currentLoadedBytes: bytes.byteLength,
                            currentTotalBytes: bytes.byteLength,
                            totalDownloadedBytes,
                            ...timingPatch(startedAt, completedFiles + failedImages.length, totalImagesToDownload),
                            currentFileInfo: `${chunk.name}: completed ${fileIndex + 1}/${chunk.links.length} - ${safeName}`,
                        }));
                        addDownloadLog(`${chunk.name}: Successfully downloaded ${uniqueFileName}`, 'success');
                    } catch (imageError) {
                        const errorMessage = imageError instanceof Error ? imageError.message : 'Unknown error';
                        failedImages.push({
                            link,
                            absoluteIndex,
                            fileName: safeName,
                            folderIndex: chunk.index,
                            folderName: chunk.name,
                            error: errorMessage,
                        });
                        failedInChunk += 1;
                        setZipDownload((current) => ({
                            ...current,
                            failed: failedImages.length,
                            percent: totalImagesToDownload ? Math.round(((completedFiles + failedImages.length) / totalImagesToDownload) * 100) : current.percent,
                            currentPercent: 0,
                            currentLoadedBytes: 0,
                            currentTotalBytes: 0,
                            totalDownloadedBytes,
                            ...timingPatch(startedAt, completedFiles + failedImages.length, totalImagesToDownload),
                            currentFileInfo: `${chunk.name}: failed ${fileIndex + 1}/${chunk.links.length} - ${safeName}`,
                        }));
                        addDownloadLog(`${chunk.name}: Failed ${safeName}: ${errorMessage}`, 'error');
                    }

                    setZipDownload((current) => ({
                        ...current,
                        completed: completedFiles,
                        failed: failedImages.length,
                        percent: totalImagesToDownload ? Math.round(((completedFiles + failedImages.length) / totalImagesToDownload) * 100) : 0,
                        totalDownloadedBytes,
                        ...timingPatch(startedAt, completedFiles + failedImages.length, totalImagesToDownload),
                    }));
                }

                if (zipFiles.length > 0 && !stopDownloadRef.current) {
                    setZipDownload((current) => ({
                        ...current,
                        currentPercent: 0,
                        currentLoadedBytes: 0,
                        currentTotalBytes: 0,
                        totalDownloadedBytes,
                        ...timingPatch(startedAt, completedFiles + failedImages.length, totalImagesToDownload),
                        currentFileInfo: `Creating ZIP: ${chunk.name} (${zipFiles.length} files)`,
                        message: `Creating ${chunk.name} ZIP...`,
                    }));
                    const zipBlob = createZipBlob(zipFiles);
                    const zipFileName = `${zipBaseName}-images-${chunk.name}_${successfulInChunk}of${chunk.links.length}_files.zip`;
                    downloadBlob(zipBlob, zipFileName);
                    addDownloadLog(`${chunk.name}: ZIP created with ${successfulInChunk}/${chunk.links.length} files`, successfulInChunk > 0 ? 'success' : 'warning');
                } else if (!stopDownloadRef.current) {
                    addDownloadLog(`${chunk.name}: No files downloaded successfully`, 'warning');
                }

                setZipDownload({
                    status: stopDownloadRef.current ? 'stopped' : pauseDownloadRef.current ? 'paused' : 'downloading',
                    completed: completedFiles,
                    total: totalImagesToDownload,
                    failed: failedImages.length,
                    percent: totalImagesToDownload ? Math.round(((completedFiles + failedImages.length) / totalImagesToDownload) * 100) : 0,
                    currentPercent: 100,
                    currentLoadedBytes: 0,
                    currentTotalBytes: 0,
                    totalDownloadedBytes,
                    startedAt,
                    ...timingPatch(startedAt, completedFiles + failedImages.length, totalImagesToDownload),
                    currentChunk: queueIndex + 1,
                    totalChunks,
                    message: `${chunk.name} finished`,
                    currentFileInfo: `${successfulInChunk}/${chunk.links.length} downloaded, ${failedInChunk} failed`,
                    fallbackAvailable: failedImages.length > 0,
                    queue: chunkSummary.map((queueChunk) => {
                        const activeChunkIndex = chunksToDownload.findIndex((item) => item.index === queueChunk.index);
                        if (activeChunkIndex === -1) return 'completed';
                        if (failedImages.some((failed) => failed.folderIndex === queueChunk.index)) return 'failed';
                        if (activeChunkIndex <= queueIndex) return 'completed';
                        return 'pending';
                    }),
                    failedImages,
                });

                if (queueIndex < totalChunks - 1) {
                    await new Promise((resolve) => window.setTimeout(resolve, 700));
                }
            }

            const finalStatus: DownloadStatus = stopDownloadRef.current
                ? 'stopped'
                : failedImages.length > 0
                    ? 'failed'
                    : 'completed';
            const failedFileCount = failedImages.length;
            const finishedAt = Date.now();
            setZipDownload({
                status: finalStatus,
                completed: completedFiles,
                total: totalImagesToDownload,
                failed: failedFileCount,
                percent: totalImagesToDownload ? Math.round(((completedFiles + failedFileCount) / totalImagesToDownload) * 100) : 0,
                currentPercent: finalStatus === 'completed' ? 100 : 0,
                currentLoadedBytes: 0,
                currentTotalBytes: 0,
                totalDownloadedBytes,
                startedAt,
                ...timingPatch(startedAt, completedFiles + failedFileCount, totalImagesToDownload, finishedAt),
                currentChunk: totalChunks,
                totalChunks,
                message: finalStatus === 'completed'
                    ? `Download completed: ${completedFiles}/${totalImagesToDownload} files`
                    : finalStatus === 'stopped'
                        ? `Stopped: ${completedFiles}/${totalImagesToDownload} files downloaded`
                        : `Completed with ${failedFileCount} failed files`,
                currentFileInfo: finalStatus === 'completed'
                    ? 'Download complete'
                    : failedImages.length > 0
                        ? `${failedImages.length} image${failedImages.length === 1 ? '' : 's'} failed`
                        : 'Download stopped',
                fallbackAvailable: failedImages.length > 0,
                queue: chunkSummary.map((chunk) => {
                    if (failedImages.some((failed) => failed.folderIndex === chunk.index)) return 'failed';
                    if (chunksToDownload.some((item) => item.index === chunk.index) || finalStatus === 'completed') return 'completed';
                    return 'pending';
                }),
                failedImages,
            });

            if (finalStatus === 'completed') {
                addDownloadLog(`Download completed successfully: ${completedFiles}/${totalImagesToDownload} files`, 'success');
            } else if (finalStatus === 'failed') {
                addDownloadLog(`Download finished with failures: ${completedFiles}/${totalImagesToDownload} files downloaded`, 'error');
            }
        } catch (zipError) {
            console.error('ZIP download failed:', zipError);
            setZipDownload({
                status: 'failed',
                completed: 0,
                total: imageLinks.length,
                failed: imageLinks.length,
                percent: 0,
                currentPercent: 0,
                currentLoadedBytes: 0,
                currentTotalBytes: 0,
                totalDownloadedBytes: 0,
                startedAt,
                ...timingPatch(startedAt, 0, imageLinks.length, Date.now()),
                currentChunk: 0,
                totalChunks,
                message: 'ZIP download failed. You can still use direct downloads for the original image links.',
                currentFileInfo: 'ZIP download failed',
                fallbackAvailable: true,
                queue: chunksToDownload.map(() => 'failed'),
                failedImages: imageLinks.map((link, index) => ({
                    link,
                    absoluteIndex: index,
                    fileName: zipSafeFileName(link.name, `image-${index + 1}`),
                    folderIndex: Math.floor(index / Math.max(1, chunkSize)),
                    folderName: `Folder_${Math.floor(index / Math.max(1, chunkSize)) + 1}`,
                    error: zipError instanceof Error ? zipError.message : 'Unknown error',
                })),
            });
            addDownloadLog('Image download failed. Direct link fallback is available.', 'error');
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
                        {imageLinks.length > 0 && (
                            <>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={<ImageIcon className="w-4 h-4" />}
                                    onClick={() => setShowAllPreviews((value) => !value)}
                                >
                                    {showAllPreviews ? 'Hide Images' : 'Show Images'}
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={<Download className="w-4 h-4" />}
                                    onClick={() => void downloadAllImages()}
                                    disabled={zipDownload.status === 'downloading' || zipDownload.status === 'paused'}
                                >
                                    Download All
                                </Button>
                            </>
                        )}
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

            {imageLinks.length > 0 && (
                <div className="bg-white rounded-xl ring-1 ring-black/[0.05] p-4 md:p-5 mb-5">
                    <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">
                        <div>
                            <div className="text-sm font-semibold text-slate-900">Professional Image Batch Downloader</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                                Files are downloaded as ZIP folders using the same image links shown below.
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="text-xs font-medium text-slate-600" htmlFor="asset-chunk-size">Files per folder</label>
                            <select
                                id="asset-chunk-size"
                                value={chunkSize}
                                disabled={zipDownload.status === 'downloading' || zipDownload.status === 'paused'}
                                onChange={(event) => setChunkSize(normalizeChunkSize(Number(event.target.value)))}
                                className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                            >
                                {ZIP_CHUNK_SIZE_OPTIONS.map((option) => (
                                    <option key={option} value={option}>{option}</option>
                                ))}
                            </select>
                            <Button
                                variant="primary"
                                size="sm"
                                icon={<Play className="w-4 h-4" />}
                                onClick={() => void downloadAllImages()}
                                disabled={zipDownload.status === 'downloading' || zipDownload.status === 'paused'}
                            >
                                Start Auto Download
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                icon={zipDownload.status === 'paused' ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                                onClick={pauseBatchDownload}
                                disabled={zipDownload.status !== 'downloading' && zipDownload.status !== 'paused'}
                            >
                                {zipDownload.status === 'paused' ? 'Resume' : 'Pause'}
                            </Button>
                            <Button
                                variant="danger"
                                size="sm"
                                icon={<Square className="w-4 h-4" />}
                                onClick={stopBatchDownload}
                                disabled={zipDownload.status !== 'downloading' && zipDownload.status !== 'paused'}
                            >
                                Stop
                            </Button>
                            {zipDownload.failedImages.length > 0 && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    icon={<RotateCcw className="w-4 h-4" />}
                                    onClick={() => void downloadAllImages(zipDownload.failedImages)}
                                    disabled={zipDownload.status === 'downloading' || zipDownload.status === 'paused'}
                                >
                                    Retry Failed
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Total Files</div>
                            <div className="text-xl font-semibold text-slate-900">{imageLinks.length}</div>
                        </div>
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Folders Needed</div>
                            <div className="text-xl font-semibold text-slate-900">{chunkSummary.length}</div>
                        </div>
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Downloaded</div>
                            <div className="text-xl font-semibold text-emerald-700">{zipDownload.completed}</div>
                        </div>
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Failed</div>
                            <div className="text-xl font-semibold text-rose-700">{zipDownload.failed}</div>
                        </div>
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Status</div>
                            <div className="text-sm font-semibold text-slate-900 capitalize">{zipDownload.status}</div>
                        </div>
                    </div>

                    <div className="mt-4 rounded-lg border border-slate-100 p-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                            <div>
                                <div className="text-sm font-semibold text-slate-900">Overall Progress</div>
                                <div className="text-xs text-slate-500 mt-0.5">
                                    {zipDownload.message || `${chunkSummary.length} ZIP folder${chunkSummary.length === 1 ? '' : 's'} ready`}
                                </div>
                            </div>
                            <div className="text-sm font-semibold text-slate-700">{zipDownload.percent}%</div>
                        </div>
                        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-300 ${zipDownload.status === 'failed' ? 'bg-rose-500' : 'bg-brand-500'}`}
                                style={{ width: `${Math.max(zipDownload.percent > 0 ? 3 : 0, zipDownload.percent)}%` }}
                            />
                        </div>
                        <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500">
                            <span>
                                {zipDownload.completed + zipDownload.failed} / {zipDownload.total || imageLinks.length} images processed
                                {zipDownload.failed > 0 ? ` (${zipDownload.failed} failed)` : ''}
                            </span>
                            <span>Current: {zipDownload.currentChunk || 0} / {zipDownload.totalChunks || chunkSummary.length}</span>
                        </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 lg:grid-cols-5 gap-3">
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Data Downloaded</div>
                            <div className="text-sm font-semibold text-slate-900">{formatBytes(zipDownload.totalDownloadedBytes)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Elapsed Time</div>
                            <div className="text-sm font-semibold text-slate-900">{formatDuration(zipDownload.elapsedMs)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Estimated Left</div>
                            <div className="text-sm font-semibold text-slate-900">
                                {zipDownload.status === 'downloading' || zipDownload.status === 'paused'
                                    ? formatDuration(zipDownload.estimatedRemainingMs)
                                    : '0s'}
                            </div>
                        </div>
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Estimated Finish</div>
                            <div className="text-sm font-semibold text-slate-900">
                                {zipDownload.startedAt && zipDownload.estimatedRemainingMs
                                    ? formatClockTime(Date.now() + zipDownload.estimatedRemainingMs)
                                    : '--'}
                            </div>
                        </div>
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="text-xs text-slate-500">Completed At</div>
                            <div className="text-sm font-semibold text-slate-900">{formatClockTime(zipDownload.finishedAt)}</div>
                        </div>
                    </div>

                    {zipDownload.total > 0 && (
                        <div className="mt-3 rounded-lg border border-slate-100 p-3">
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <div>
                                    <div className="text-sm font-semibold text-slate-900">Current Download</div>
                                    <div className="text-xs text-slate-500 mt-0.5">{zipDownload.currentFileInfo}</div>
                                    {(zipDownload.currentLoadedBytes > 0 || zipDownload.currentTotalBytes > 0) && (
                                        <div className="text-[11px] text-slate-400 mt-0.5">
                                            {formatBytes(zipDownload.currentLoadedBytes)}
                                            {zipDownload.currentTotalBytes > 0 ? ` / ${formatBytes(zipDownload.currentTotalBytes)}` : ' received'}
                                        </div>
                                    )}
                                </div>
                                <div className="text-sm font-semibold text-slate-700">{zipDownload.currentPercent}%</div>
                            </div>
                            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                    className="h-full rounded-full bg-cyan-500 transition-all duration-300"
                                    style={{ width: `${Math.max(zipDownload.currentPercent > 0 ? 3 : 0, zipDownload.currentPercent)}%` }}
                                />
                            </div>
                        </div>
                    )}

                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] gap-4">
                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="flex items-center gap-2 mb-3">
                                <Folder className="w-4 h-4 text-slate-500" />
                                <div className="text-sm font-semibold text-slate-900">Download Queue</div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-56 overflow-y-auto pr-1">
                                {chunkSummary.map((chunk, index) => {
                                    const status = zipDownload.queue[index] || 'pending';
                                    const statusClass = status === 'completed'
                                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                        : status === 'failed'
                                            ? 'border-rose-200 bg-rose-50 text-rose-800'
                                            : status === 'downloading'
                                                ? 'border-cyan-200 bg-cyan-50 text-cyan-800'
                                                : 'border-slate-100 bg-slate-50 text-slate-600';

                                    return (
                                        <div key={chunk.name} className={`rounded-lg border px-3 py-2 ${statusClass}`}>
                                            <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-semibold">{chunk.name}</span>
                                                <span className="text-[11px] capitalize">{status}</span>
                                            </div>
                                            <div className="text-[11px] mt-1 opacity-80">{chunk.size} files</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="rounded-lg border border-slate-100 p-3">
                            <div className="flex items-center justify-between gap-2 mb-3">
                                <div className="text-sm font-semibold text-slate-900">Download Log</div>
                                <button
                                    type="button"
                                    onClick={() => setDownloadLogs([])}
                                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Clear
                                </button>
                            </div>
                            <div className="h-56 overflow-y-auto rounded-lg bg-slate-50 p-2 text-xs">
                                {downloadLogs.length === 0 ? (
                                    <div className="text-slate-500">Waiting to start...</div>
                                ) : downloadLogs.map((log) => (
                                    <div
                                        key={log.id}
                                        className={
                                            log.type === 'error'
                                                ? 'text-rose-700 mb-1'
                                                : log.type === 'warning'
                                                    ? 'text-amber-700 mb-1'
                                                    : log.type === 'success'
                                                        ? 'text-emerald-700 mb-1'
                                                        : 'text-slate-600 mb-1'
                                        }
                                    >
                                        <span className="text-slate-400">[{log.time}]</span> {log.message}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {zipDownload.fallbackAvailable && (
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void directDownloadImageLinks()}
                                className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                            >
                                <Download className="w-3.5 h-3.5" />
                                Download Links One by One
                            </button>
                            <span className="text-xs text-slate-500">
                                Failed images can be retried with tracking. Direct downloads use the original links.
                            </span>
                        </div>
                    )}
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
                                portalStatus.failed
                                        ? 'failed'
                                    : portalStatus.checked && portalStatus.job_status === 'Completed'
                                        ? 'done'
                                        : portalStatus.checked
                                            ? 'done'
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
                                    const shouldLoadPreview = showAllPreviews || !!previewedImageKeys[linkKey];
                                    const canPreview = canPreviewInBrowser(link.name, link.url);

                                    return (
                                        <div key={linkKey} className="bg-white rounded-xl ring-1 ring-black/[0.05] overflow-hidden">
                                            <div className="relative h-52 bg-slate-100 flex items-center justify-center overflow-hidden">
                                                <img
                                                    src={link.url}
                                                    alt={link.name}
                                                    className={canPreview && shouldLoadPreview && !broken
                                                        ? 'w-full h-full object-cover'
                                                        : 'absolute inset-0 w-full h-full object-cover opacity-[0.01]'
                                                    }
                                                    loading="eager"
                                                    data-asset-image-url={link.url}
                                                    onError={() => setBrokenImageIds((prev) => ({ ...prev, [link.id]: true }))}
                                                />
                                                {!canPreview ? (
                                                    <div className="px-4 text-center">
                                                        <ImageIcon className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                                                        <div className="text-sm font-medium text-slate-600">Raw image file</div>
                                                        <div className="text-xs text-slate-500 mt-1">Open or download to view</div>
                                                    </div>
                                                ) : broken ? (
                                                    <div className="text-slate-500 text-sm">Preview unavailable</div>
                                                ) : shouldLoadPreview ? (
                                                    null
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
                                    .filter((link) => !imageLinks.includes(link))
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
