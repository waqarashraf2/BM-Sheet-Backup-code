import { useState, useEffect, useCallback } from 'react';
import { liveQAService } from '../../services';
import { AnimatedPage, PageHeader } from '../../components/ui';
import LiveQAChecklistModal from '../../components/LiveQAChecklistModal';
import {
    ShieldCheck, Search, AlertTriangle, CheckCircle, BarChart3,
    Loader2, FileSearch, ClipboardList, RefreshCw, X, Calendar,
    TrendingUp, FolderKanban, Eye, Clock, Filter, FileText,
} from 'lucide-react';
import { motion } from 'framer-motion';

/* =================================================================
 * ROLE CONFIGURATION - edit this one block to change who can access
 * Internal QA in the future. No other changes needed.
 * ================================================================= */
export const INTERNAL_QA_CONFIG = {
    accessRoles: ['ceo', 'director', 'live_qa', 'operations_manager'] as string[],
    reviewerRoles: ['live_qa'] as string[],
    reportOnlyRoles: ['ceo', 'director', 'operations_manager'] as string[],
} as const;

export function canAccessInternalQA(role: string | undefined): boolean {
    return !!role && INTERNAL_QA_CONFIG.accessRoles.includes(role);
}
export function canReviewInternalQA(role: string | undefined): boolean {
    return !!role && INTERNAL_QA_CONFIG.reviewerRoles.includes(role);
}

/* ================================================================= */

type ActiveTab = 'orders' | 'project-report' | 'all-projects-report';
type StatusFilter = 'all' | 'pending' | 'complete';

interface InternalQaOrder {
    order_number: string;
    address?: string;
    client_name?: string;
    drawer_name?: string;
    checker_name?: string;
    qa_name?: string;
    final_upload_date?: string;
    received_at?: string;
    updated_at?: string;
    internal_qa_reviewed_items?: number;
    internal_qa_total_items?: number;
    internal_qa_review_complete?: boolean;
    project_id?: number;
    project_name?: string;
}

interface ProjectReportRow {
    report_key?: string;
    project_id: number;
    project_name: string;
    client_name?: string;
    source_project_name?: string;
    country?: string;
    total_received_orders: number;
    total_orders: number;
    orders_count?: number;
    mistake_orders: number;
    total_mistakes: number;
}

interface AllProjectsReport {
    success: boolean;
    projects: ProjectReportRow[];
    summary: {
        total_projects: number;
        total_received_orders: number;
        total_orders: number;
        grand_mistake_orders: number;
        total_mistakes: number;
    };
}

interface DetailReportRow {
    order_number: string;
    client_name?: string;
    first_order_date?: string;
    drawer_name?: string;
    checker_name?: string;
    qa_name?: string;
    total_mistakes: number;
    [key: string]: any;
}

interface DetailReport {
    report_columns: string[];
    report_rows: DetailReportRow[];
    order_comments: Array<{ order_id: string; text_value: string; checklist_item: string }>;
    checklist_items: string[];
    summary: { total_orders: number; total_mistakes: number };
}

function calcEfficiency(totalOrders: number, mistakeOrders: number): number {
    if (!totalOrders || totalOrders <= 0) return 100;
    return Math.round((Math.max(0, totalOrders - mistakeOrders) / totalOrders) * 100);
}

function EfficiencyBadge({ pct }: { pct: number }) {
    const cls =
        pct >= 95 ? 'bg-green-100 text-green-700' :
            pct >= 85 ? 'bg-yellow-100 text-yellow-700' :
                pct >= 70 ? 'bg-orange-100 text-orange-700' :
                    'bg-red-100 text-red-700';
    return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${cls}`}>
            <TrendingUp className="h-3 w-3" />{pct}%
        </span>
    );
}

function MiniStat({ label, value, color }: { label: string; value: number; color: string }) {
    return (
        <div className={`flex flex-col items-center justify-center rounded-xl px-5 py-3 ring-1 ${color}`}>
            <div className="text-2xl font-extrabold">{value}</div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mt-0.5 opacity-80">{label}</div>
        </div>
    );
}

/* ================================================================= */

const CLIENT_CODE_PROJECT_IDS = [9, 14, 46];

export default function InternalQADashboard() {
    const [activeTab, setActiveTab] = useState<ActiveTab>('orders');

    /* -- Project list -- */
    const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
    const [selectedProject, setSelectedProject] = useState<number>(0);

    /* -- Orders state -- */
    const [orders, setOrders] = useState<InternalQaOrder[]>([]);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [search, setSearch] = useState('');
    const today = new Date().toISOString().slice(0, 10);
    const [dateFrom, setDateFrom] = useState(today);
    const [dateTo, setDateTo] = useState(today);
    const [fromDateTime, setFromDateTime] = useState('');
    const [toDateTime, setToDateTime] = useState('');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

    /* -- Review modal -- */
    const [reviewModal, setReviewModal] = useState<{ open: boolean; orderNumber: string }>({
        open: false,
        orderNumber: '',
    });

    /* -- All Projects Report -- */
    const [report, setReport] = useState<AllProjectsReport | null>(null);
    const [reportLoading, setReportLoading] = useState(false);
    const [reportDateFrom, setReportDateFrom] = useState(today);
    const [reportDateTo, setReportDateTo] = useState(today);
    const [reportFromDateTime, setReportFromDateTime] = useState('');
    const [reportToDateTime, setReportToDateTime] = useState('');
    const [reportLayer, setReportLayer] = useState<'FP_3_LAYER' | 'PH_2_LAYER'>('FP_3_LAYER');
    const [reportExporting, setReportExporting] = useState<'csv' | 'pdf' | null>(null);

    /* -- Project Detail Report -- */
    const [detailProject, setDetailProject] = useState<number>(0);
    const [detailDateFrom, setDetailDateFrom] = useState(today);
    const [detailDateTo, setDetailDateTo] = useState(today);
    const [detailFromDateTime, setDetailFromDateTime] = useState('');
    const [detailToDateTime, setDetailToDateTime] = useState('');
    const [detailReport, setDetailReport] = useState<DetailReport | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    /* -- Load projects -- */
    useEffect(() => {
        import('../../services').then(({ projectService }) => {
            projectService.list({ per_page: 100 } as any)
                .then((res: any) => {
                    const data: any[] = res.data?.data || res.data || [];
                    const mapped = data.map((p: any) => ({ id: p.id, name: p.name }));
                    setProjects(mapped);
                    if (!selectedProject && mapped.length > 0) {
                        const metro = mapped.find((p: any) => p.id === 13);
                        setSelectedProject(metro ? 13 : mapped[0].id);
                    }
                })
                .catch(() => { });
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /* -- Fetch orders -- */
    const fetchOrders = useCallback(async () => {
        if (!selectedProject) return;
        setOrdersLoading(true);
        try {
            const params: Record<string, any> = { per_page: 500 };
            if (search) params.search = search;
            if (dateFrom) params.date_from = dateFrom;
            if (dateTo) params.date_to = dateTo;
            if (fromDateTime) params.from_datetime = fromDateTime;
            if (toDateTime) params.to_datetime = toDateTime;
            const res = await liveQAService.getInternalQaOrders(selectedProject, params);
            setOrders(res.data.data || []);
        } catch {
            setOrders([]);
        } finally {
            setOrdersLoading(false);
        }
    }, [selectedProject, search, dateFrom, dateTo, fromDateTime, toDateTime]);

    useEffect(() => {
        if (activeTab === 'orders') fetchOrders();
    }, [fetchOrders, activeTab]);

    /* -- Fetch report -- */
    const fetchReport = useCallback(async () => {
        setReportLoading(true);
        try {
            const params: Record<string, string> = { layer: reportLayer };
            if (reportDateFrom) params.date_from = reportDateFrom;
            if (reportDateTo) params.date_to = reportDateTo;
            if (reportFromDateTime) params.from_datetime = reportFromDateTime;
            if (reportToDateTime) params.to_datetime = reportToDateTime;
            const res = await liveQAService.getInternalQaAllProjectsReport(params);
            setReport(res.data);
        } catch {
            setReport(null);
        } finally {
            setReportLoading(false);
        }
    }, [reportDateFrom, reportDateTo, reportFromDateTime, reportToDateTime, reportLayer]);

    useEffect(() => {
        if (activeTab === 'all-projects-report') fetchReport();
    }, [fetchReport, activeTab]);

    /* -- Fetch detail report (per-project) -- */
    const fetchDetailReport = useCallback(async () => {
        if (!detailProject) return;
        setDetailLoading(true);
        try {
            const params: Record<string, any> = {};
            if (detailDateFrom) params.date_from = detailDateFrom;
            if (detailDateTo) params.date_to = detailDateTo;
            if (detailFromDateTime) params.from_datetime = detailFromDateTime;
            if (detailToDateTime) params.to_datetime = detailToDateTime;
            const res = await liveQAService.getInternalQaMistakeSummary(detailProject, params);
            setDetailReport(res.data as unknown as DetailReport);
        } catch {
            setDetailReport(null);
        } finally {
            setDetailLoading(false);
        }
    }, [detailProject, detailDateFrom, detailDateTo, detailFromDateTime, detailToDateTime]);

    useEffect(() => {
        if (activeTab === 'project-report') fetchDetailReport();
    }, [fetchDetailReport, activeTab]);

    /* -- Derived counts -- */
    const totalCount = orders.length;
    const completeCount = orders.filter(o => o.internal_qa_review_complete).length;
    const pendingCount = totalCount - completeCount;

    const filteredOrders = orders.filter(o => {
        if (statusFilter === 'complete') return Boolean(o.internal_qa_review_complete);
        if (statusFilter === 'pending') return !o.internal_qa_review_complete;
        return true;
    });
    const showOrderClientName = CLIENT_CODE_PROJECT_IDS.includes(selectedProject);

    /* -- Handlers -- */
    const clearFilters = () => {
        setSearch(''); setDateFrom(''); setDateTo('');
        setFromDateTime(''); setToDateTime('');
    };

    const handleRefresh = () => {
        if (activeTab === 'orders') fetchOrders();
        else if (activeTab === 'project-report') fetchDetailReport();
        else fetchReport();
    };

    const getProjectDisplayName = (project: ProjectReportRow): string =>
        (project.client_name || project.project_name || `Project ${project.project_id}`).trim();

    const getCountryGroups = (projectRows: ProjectReportRow[] = []) => {
        const groups = new Map<string, ProjectReportRow[]>();
        projectRows.forEach((project) => {
            const country = (project.country || 'Unassigned Country').trim() || 'Unassigned Country';
            if (!groups.has(country)) groups.set(country, []);
            groups.get(country)!.push(project);
        });

        return Array.from(groups.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([country, projects]) => ({
                country,
                projects: projects.slice().sort((a, b) => getProjectDisplayName(a).localeCompare(getProjectDisplayName(b))),
            }));
    };

    /* -- CSV export: detail report -- */
    const downloadDetailCsv = () => {
        if (!detailReport?.report_rows?.length) return;
        const checklistCols = detailReport.checklist_items || [];
        const commentMap: Record<string, string[]> = {};
        (detailReport.order_comments || []).forEach((c: any) => {
            if (c.text_value && c.order_id) {
                if (!commentMap[c.order_id]) commentMap[c.order_id] = [];
                commentMap[c.order_id].push(c.text_value);
            }
        });
        const headers = ['Date', 'Address', 'Drawer', 'Checker', 'QA Person', ...checklistCols, 'QA Comments'];
        const csvRows = detailReport.report_rows.map(r => {
            const date = r.first_order_date ? String(r.first_order_date).substring(0, 10) : '-';
            const cols = checklistCols.map(col => (r[col] == null || r[col] === 0) ? 'OK' : 'NOT OK');
            const comments = (commentMap[r.order_number] || []).join('; ') || '-';
            return [date, r.client_name || '-', r.drawer_name || '-', r.checker_name || '-', r.qa_name || '-', ...cols, comments];
        });
        const csv = [headers, ...csvRows].map(row => row.map((c: string) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const projName = projects.find(p => p.id === detailProject)?.name || 'project';
        a.download = 'internal_qa_detail_' + projName.replace(/[^a-zA-Z0-9]/g, '_') + '_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    /* -- CSV export: all-projects report -- */
    const downloadReportCsv = () => {
        if (!report?.projects?.length) return;
        setReportExporting('csv');
        const countryGroups = getCountryGroups(report.projects);
        const rows = [
            ['Country', 'Project', 'Delivered Orders', 'QA Orders', 'Mistake Orders', 'Efficiency (%)', 'Mistake (%)'],
            ...countryGroups.flatMap(({ country, projects }) => {
                const countryReceived = projects.reduce((s, p) => s + p.total_received_orders, 0);
                const countryOrders = projects.reduce((s, p) => s + p.total_orders, 0);
                const countryMistakeOrders = projects.reduce((s, p) => s + p.mistake_orders, 0);
                const countryRows = projects.map(p => {
                    const eff = calcEfficiency(p.total_orders, p.mistake_orders);
                    const mistPct = p.total_orders > 0 ? Math.round((p.mistake_orders / p.total_orders) * 100) : 0;
                    return [
                        country,
                        getProjectDisplayName(p),
                        String(p.total_received_orders),
                        String(p.total_orders),
                        String(p.mistake_orders),
                        String(eff),
                        String(mistPct),
                    ];
                });
                return [
                    ...countryRows,
                    [country, 'COUNTRY TOTAL', String(countryReceived), String(countryOrders), String(countryMistakeOrders), String(calcEfficiency(countryOrders, countryMistakeOrders)), ''],
                ];
            }),
            ['ALL COUNTRIES', 'GRAND TOTAL', String(report.summary?.total_received_orders ?? 0), String(report.summary?.total_orders ?? 0), String(report.summary?.grand_mistake_orders ?? 0), String(calcEfficiency(report.summary?.total_orders ?? 0, report.summary?.grand_mistake_orders ?? 0)), ''],
        ];
        const csv = rows.map(r => r.map(c => '"' + c.replace(/"/g, '""') + '"').join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'internal_qa_all_projects_' + reportLayer + '_' + new Date().toISOString().slice(0, 10) + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        setReportExporting(null);
    };

    const downloadReportPdf = async () => {
        if (!report?.projects?.length) return;
        setReportExporting('pdf');
        try {
            const { default: jsPDF } = await import('jspdf');
            const { default: autoTable } = await import('jspdf-autotable');
            const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
            const countryGroups = getCountryGroups(report.projects);

            doc.setFontSize(14);
            doc.text('Internal QA All Projects Report', 40, 36);
            doc.setFontSize(9);
            doc.text(
                `Layer: ${reportLayer === 'FP_3_LAYER' ? 'FP 3 Layer' : 'PH 2 Layer'} | Date: ${reportDateFrom || '-'} to ${reportDateTo || '-'}`,
                40,
                52
            );

            const body: any[] = countryGroups.flatMap(({ country, projects }) => {
                const countryReceived = projects.reduce((s, p) => s + p.total_received_orders, 0);
                const countryOrders = projects.reduce((s, p) => s + p.total_orders, 0);
                const countryMistakeOrders = projects.reduce((s, p) => s + p.mistake_orders, 0);
                return [
                    [{ content: country, colSpan: 6, styles: { fillColor: [51, 65, 85], textColor: 255, fontStyle: 'bold' } }],
                    ...projects.map((p) => {
                        const eff = calcEfficiency(p.total_orders, p.mistake_orders);
                        const mistPct = p.total_orders > 0 ? Math.round((p.mistake_orders / p.total_orders) * 100) : 0;
                        return [
                            getProjectDisplayName(p),
                            String(p.total_received_orders),
                            String(p.total_orders),
                            String(p.mistake_orders),
                            `${eff}%`,
                            `${mistPct}%`,
                        ];
                    }),
                    [
                        { content: 'COUNTRY TOTAL', styles: { fontStyle: 'bold' } },
                        String(countryReceived),
                        String(countryOrders),
                        String(countryMistakeOrders),
                        `${calcEfficiency(countryOrders, countryMistakeOrders)}%`,
                        '',
                    ],
                ];
            });

            body.push([
                { content: 'GRAND TOTAL', styles: { fontStyle: 'bold' } },
                String(report.summary?.total_received_orders ?? 0),
                String(report.summary?.total_orders ?? 0),
                String(report.summary?.grand_mistake_orders ?? 0),
                `${calcEfficiency(report.summary?.total_orders ?? 0, report.summary?.grand_mistake_orders ?? 0)}%`,
                '',
            ]);

            autoTable(doc, {
                head: [['Project', 'Delivered', 'QA Orders', 'Mistake Orders', 'Efficiency', 'Mistake %']],
                body,
                startY: 68,
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 4, overflow: 'linebreak' },
                headStyles: { fillColor: [37, 99, 235], textColor: 255 },
                columnStyles: {
                    0: { cellWidth: 170 },
                },
            });

            doc.save('internal_qa_all_countries_' + reportLayer + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
        } finally {
            setReportExporting(null);
        }
    };

    /* ================================================================= */
    return (
        <AnimatedPage>
            {/* -- Header -- */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-5 gap-3">
                <PageHeader
                    title="Internal QA Dashboard"
                    subtitle="Post-delivery quality audit - internal review"
                    badge={
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-brand-50 text-brand-700 rounded-full ring-1 ring-brand-200">
                            <ShieldCheck className="h-3.5 w-3.5" /> Internal QA
                        </span>
                    }
                />
                <button
                    onClick={handleRefresh}
                    title="Refresh"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                >
                    <RefreshCw className="h-4 w-4" />
                </button>
            </div>

            {/* -- Tab Bar -- */}
            <div className="flex flex-wrap items-center gap-2 mb-5 border-b border-slate-100 pb-3">
                <button
                    onClick={() => setActiveTab('orders')}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'orders'
                        ? 'bg-brand-700 text-white shadow-sm ring-1 ring-brand-800'
                        : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                        }`}
                >
                    <ClipboardList className="h-4 w-4" /> Orders Review
                </button>
                <button
                    onClick={() => setActiveTab('project-report')}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'project-report'
                        ? 'bg-brand-700 text-white shadow-sm ring-1 ring-brand-800'
                        : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                        }`}
                >
                    <FileSearch className="h-4 w-4" /> Project Detail Report
                </button>
                <button
                    onClick={() => setActiveTab('all-projects-report')}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-all ${activeTab === 'all-projects-report'
                        ? 'bg-brand-700 text-white shadow-sm ring-1 ring-brand-800'
                        : 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                        }`}
                >
                    <BarChart3 className="h-4 w-4" /> All Projects Report
                </button>
            </div>

            {/* TAB 1 - ORDERS REVIEW */}
            {activeTab === 'orders' && (
                <div className="space-y-4">

                    {/* Project selector + status filters */}
                    <div className="flex flex-wrap items-center gap-2">
                        <select
                            value={String(selectedProject)}
                            onChange={e => setSelectedProject(Number(e.target.value))}
                            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 min-w-[200px]"
                        >
                            <option value="0">Select Project</option>
                            {projects.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>

                        <div className="h-5 w-px bg-slate-200" />

                        <button
                            onClick={() => setStatusFilter('all')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${statusFilter === 'all' ? 'bg-brand-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                        >
                            All ({totalCount})
                        </button>
                        <button
                            onClick={() => setStatusFilter('pending')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${statusFilter === 'pending' ? 'bg-amber-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                        >
                            Pending ({pendingCount})
                        </button>
                        <button
                            onClick={() => setStatusFilter('complete')}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${statusFilter === 'complete' ? 'bg-green-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                        >
                            Done ({completeCount})
                        </button>
                    </div>

                    {/* Summary stat bar */}
                    {selectedProject > 0 && !ordersLoading && orders.length > 0 && (
                        <div className="flex flex-wrap gap-3">
                            <MiniStat label="Total Delivered" value={totalCount} color="bg-brand-50 text-brand-700 ring-brand-200" />
                            <MiniStat label="Pending Review" value={pendingCount} color="bg-amber-50 text-amber-700 ring-amber-200" />
                            <MiniStat label="Reviewed" value={completeCount} color="bg-green-50 text-green-700 ring-green-200" />
                        </div>
                    )}

                    {/* Filters + table card */}
                    <div className="bg-white rounded-xl ring-1 ring-black/[0.04] shadow-sm overflow-hidden">

                        {/* Filter toolbar */}
                        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
                            <div className="relative min-w-[200px] max-w-xs flex-1">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <input
                                    type="text"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && fetchOrders()}
                                    placeholder="Search order, address, worker..."
                                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400"
                                />
                            </div>

                            <div className="flex items-center gap-1">
                                <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                                <input
                                    type="date" value={dateFrom}
                                    onChange={e => setDateFrom(e.target.value)}
                                    className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                                    title="Date From"
                                />
                                <span className="text-slate-300">-</span>
                                <input
                                    type="date" value={dateTo}
                                    onChange={e => setDateTo(e.target.value)}
                                    className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                                    title="Date To"
                                />
                            </div>

                            <input type="datetime-local" value={fromDateTime} onChange={e => setFromDateTime(e.target.value)}
                                className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="From DateTime" />
                            <input type="datetime-local" value={toDateTime} onChange={e => setToDateTime(e.target.value)}
                                className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="To DateTime" />

                            <button onClick={fetchOrders}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
                                <Search className="h-3.5 w-3.5" /> Search
                            </button>
                            <button onClick={clearFilters}
                                className="inline-flex items-center gap-1 px-3 py-2 text-xs text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                                <X className="h-3.5 w-3.5" /> Clear
                            </button>

                            {statusFilter !== 'all' && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold bg-brand-100 text-brand-700 rounded-full">
                                    <Filter className="h-3 w-3" /> Showing: {statusFilter}
                                </span>
                            )}
                        </div>

                        {/* Table body */}
                        {ordersLoading ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                <Loader2 className="h-7 w-7 animate-spin text-brand-500" />
                                <span className="text-sm text-slate-500">Loading orders...</span>
                            </div>
                        ) : !selectedProject ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <FolderKanban className="h-12 w-12 mb-3 text-slate-200" />
                                <p className="text-sm font-medium">Select a project to view orders</p>
                            </div>
                        ) : filteredOrders.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <FileSearch className="h-12 w-12 mb-3 text-slate-200" />
                                <p className="text-sm font-medium">
                                    {orders.length === 0 ? 'No delivered orders found' : 'No orders match the current filter'}
                                </p>
                                <p className="text-xs mt-1">
                                    {orders.length === 0 ? 'Adjust your date filter or try another project' : 'Try changing the status filter above'}
                                </p>
                            </div>
                        ) : (
                            <>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="bg-brand-700 text-white">
                                                <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Order #</th>
                                                {showOrderClientName && (
                                                    <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Client</th>
                                                )}
                                                <th className="px-3 py-2.5 text-left font-semibold text-xs">Address</th>
                                                <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Drawer</th>
                                                <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Checker</th>
                                                <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">QA Person</th>
                                                <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">
                                                    <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> Delivered</span>
                                                </th>
                                                <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Review Progress</th>
                                                <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredOrders.map((order, i) => {
                                                const reviewed = Number(order.internal_qa_reviewed_items || 0);
                                                const total = Number(order.internal_qa_total_items || 0);
                                                const complete = Boolean(order.internal_qa_review_complete);
                                                const inProgress = !complete && reviewed > 0;
                                                const deliveredDate = order.final_upload_date || order.updated_at?.substring(0, 10) || '-';

                                                return (
                                                    <motion.tr
                                                        key={order.order_number}
                                                        initial={{ opacity: 0, y: 4 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        transition={{ delay: Math.min(i * 0.015, 0.4) }}
                                                        className={`border-b border-slate-100 transition-colors ${complete
                                                            ? 'bg-green-50/30 hover:bg-green-50/60'
                                                            : inProgress
                                                                ? 'bg-amber-50/30 hover:bg-amber-50/60'
                                                                : i % 2 === 0
                                                                    ? 'bg-white hover:bg-brand-50/20'
                                                                    : 'bg-slate-50/40 hover:bg-brand-50/20'
                                                            }`}
                                                    >
                                                        <td className="px-3 py-2.5 whitespace-nowrap">
                                                            <span className="text-xs font-bold text-slate-800">{order.order_number}</span>
                                                        </td>
                                                        {showOrderClientName && (
                                                            <td className="px-3 py-2.5 whitespace-nowrap">
                                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                                                                    {order.client_name || '-'}
                                                                </span>
                                                            </td>
                                                        )}
                                                        <td className="px-3 py-2.5 max-w-[200px]">
                                                            <span className="text-xs text-slate-600 line-clamp-1" title={order.address || ''}>
                                                                {order.address || '-'}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            {order.drawer_name ? (
                                                                <div className="inline-flex items-center gap-1.5 justify-center">
                                                                    <div className="w-5 h-5 rounded-full bg-brand-600 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                                                                        {order.drawer_name.charAt(0).toUpperCase()}
                                                                    </div>
                                                                    <span className="text-xs text-slate-700 font-medium whitespace-nowrap">{order.drawer_name}</span>
                                                                </div>
                                                            ) : <span className="text-xs text-slate-400 italic">-</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            {order.checker_name ? (
                                                                <div className="inline-flex items-center gap-1.5 justify-center">
                                                                    <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                                                                        {order.checker_name.charAt(0).toUpperCase()}
                                                                    </div>
                                                                    <span className="text-xs text-slate-700 font-medium whitespace-nowrap">{order.checker_name}</span>
                                                                </div>
                                                            ) : <span className="text-xs text-slate-400 italic">-</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            {order.qa_name ? (
                                                                <div className="inline-flex items-center gap-1.5 justify-center">
                                                                    <div className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center text-[9px] font-bold shrink-0">
                                                                        {order.qa_name.charAt(0).toUpperCase()}
                                                                    </div>
                                                                    <span className="text-xs text-slate-700 font-medium whitespace-nowrap">{order.qa_name}</span>
                                                                </div>
                                                            ) : <span className="text-xs text-slate-400 italic">-</span>}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                                            <span className="text-xs text-slate-500">{deliveredDate}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            {complete ? (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700">
                                                                    <CheckCircle className="h-3 w-3" /> {reviewed}/{total || reviewed}
                                                                </span>
                                                            ) : inProgress ? (
                                                                <div className="flex flex-col items-center gap-0.5">
                                                                    <span className="text-[10px] font-bold text-amber-600">{reviewed}/{total}</span>
                                                                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                                        <div
                                                                            className="h-full bg-amber-400 rounded-full"
                                                                            style={{ width: `${total > 0 ? Math.round((reviewed / total) * 100) : 0}%` }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <span className="text-xs font-semibold text-slate-600">
                                                                    {total > 0 ? `${reviewed}/${total}` : '0/0'}
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-center">
                                                            <button
                                                                onClick={() => setReviewModal({ open: true, orderNumber: String(order.order_number) })}
                                                                className={`inline-flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all ${complete
                                                                    ? 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm'
                                                                    : inProgress
                                                                        ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
                                                                        : 'bg-violet-600 text-white hover:bg-violet-700 shadow-sm'
                                                                    }`}
                                                            >
                                                                {complete ? (
                                                                    <><CheckCircle className="h-3 w-3" /> Re-review</>
                                                                ) : inProgress ? (
                                                                    <><Eye className="h-3 w-3" /> Continue</>
                                                                ) : (
                                                                    <><Eye className="h-3 w-3" /> Start Review</>
                                                                )}
                                                            </button>
                                                        </td>
                                                    </motion.tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/30">
                                    <span className="text-xs text-slate-500">Showing {filteredOrders.length} of {totalCount} orders</span>
                                    <span className="text-xs text-slate-400">{completeCount} reviewed &bull; {pendingCount} pending</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* TAB 2 - PROJECT DETAIL REPORT */}
            {activeTab === 'project-report' && (
                <div className="space-y-4">
                    <div className="bg-white rounded-xl ring-1 ring-black/[0.04] shadow-sm overflow-hidden">
                        {/* Filters */}
                        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
                            <select value={String(detailProject)} onChange={e => setDetailProject(Number(e.target.value))}
                                className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 min-w-[200px]">
                                <option value="0">Select Project</option>
                                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <div className="flex items-center gap-1">
                                <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                                <input type="date" value={detailDateFrom} onChange={e => setDetailDateFrom(e.target.value)}
                                    className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="Date From" />
                                <span className="text-slate-300">-</span>
                                <input type="date" value={detailDateTo} onChange={e => setDetailDateTo(e.target.value)}
                                    className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="Date To" />
                            </div>
                            <input type="datetime-local" value={detailFromDateTime} onChange={e => setDetailFromDateTime(e.target.value)}
                                className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="From DateTime" />
                            <input type="datetime-local" value={detailToDateTime} onChange={e => setDetailToDateTime(e.target.value)}
                                className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="To DateTime" />
                            <button onClick={fetchDetailReport}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
                                <Search className="h-3.5 w-3.5" /> Apply
                            </button>
                            <button onClick={() => { setDetailDateFrom(''); setDetailDateTo(''); setDetailFromDateTime(''); setDetailToDateTime(''); }}
                                className="inline-flex items-center gap-1 px-3 py-2 text-xs text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                                <X className="h-3.5 w-3.5" /> Clear
                            </button>
                            {(detailReport?.report_rows?.length ?? 0) > 0 && (
                                <button onClick={downloadDetailCsv}
                                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                    Export CSV
                                </button>
                            )}
                        </div>

                        {/* Summary stats */}
                        {detailReport && !detailLoading && (
                            <div className="flex flex-wrap gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/30">
                                <MiniStat label="Orders Reviewed" value={detailReport.summary?.total_orders ?? 0} color="bg-brand-50 text-brand-700 ring-brand-200" />
                                <MiniStat label="Total Mistakes" value={detailReport.summary?.total_mistakes ?? 0} color="bg-rose-50 text-rose-700 ring-rose-200" />
                            </div>
                        )}

                        {/* Table */}
                        {detailLoading ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                <Loader2 className="h-7 w-7 animate-spin text-brand-500" />
                                <span className="text-sm text-slate-500">Loading detail report...</span>
                            </div>
                        ) : !detailProject ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <FolderKanban className="h-12 w-12 mb-3 text-slate-200" />
                                <p className="text-sm font-medium">Select a project to view the detail report</p>
                            </div>
                        ) : !detailReport || (detailReport.report_rows?.length ?? 0) === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <FileSearch className="h-12 w-12 mb-3 text-slate-200" />
                                <p className="text-sm font-medium">No reviewed orders found for the selected period</p>
                                <p className="text-xs mt-1">Select a date range and click Apply</p>
                            </div>
                        ) : (() => {
                            const checklistCols = detailReport.checklist_items || [];
                            const commentMap: Record<string, string[]> = {};
                            (detailReport.order_comments || []).forEach((c: any) => {
                                if (c.text_value && c.order_id) {
                                    if (!commentMap[c.order_id]) commentMap[c.order_id] = [];
                                    commentMap[c.order_id].push(c.text_value);
                                }
                            });
                            return (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm border-collapse">
                                        <thead>
                                            <tr className="bg-brand-700 text-white">
                                                <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">Date</th>
                                                <th className="px-3 py-2.5 text-left font-semibold text-xs">Address</th>
                                                <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Drawer</th>
                                                <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Checker</th>
                                                <th className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">QA Person</th>
                                                {checklistCols.map(col => (
                                                    <th key={col} className="px-3 py-2.5 text-center font-semibold text-xs whitespace-nowrap">{col}</th>
                                                ))}
                                                <th className="px-3 py-2.5 text-left font-semibold text-xs whitespace-nowrap">QA Comments</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {detailReport.report_rows.map((row, i) => {
                                                const date = row.first_order_date ? String(row.first_order_date).substring(0, 10) : '-';
                                                const comments = (commentMap[row.order_number] || []).join(' | ');
                                                const hasMistake = row.total_mistakes > 0;
                                                return (
                                                    <motion.tr
                                                        key={row.order_number || i}
                                                        initial={{ opacity: 0 }}
                                                        animate={{ opacity: 1 }}
                                                        transition={{ delay: Math.min(i * 0.01, 0.3) }}
                                                        className={`border-b border-slate-100 ${hasMistake ? 'bg-red-50/30 hover:bg-red-50/60' : i % 2 === 0 ? 'bg-white hover:bg-brand-50/10' : 'bg-slate-50/30 hover:bg-brand-50/10'}`}
                                                    >
                                                        <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{date}</td>
                                                        <td className="px-3 py-2 max-w-[180px]">
                                                            <span className="text-xs text-slate-700 line-clamp-1" title={row.client_name || ''}>
                                                                {row.client_name || '-'}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-center text-xs text-slate-700 whitespace-nowrap">{row.drawer_name || '-'}</td>
                                                        <td className="px-3 py-2 text-center text-xs text-slate-700 whitespace-nowrap">{row.checker_name || '-'}</td>
                                                        <td className="px-3 py-2 text-center text-xs text-slate-700 whitespace-nowrap">{row.qa_name || '-'}</td>
                                                        {checklistCols.map(col => {
                                                            const val = row[col];
                                                            const isOk = val == null || val === 0;
                                                            return (
                                                                <td key={col} className="px-3 py-2 text-center">
                                                                    {isOk
                                                                        ? <span className="text-[10px] font-semibold text-green-600">OK</span>
                                                                        : <span className="text-[10px] font-bold text-red-600">NOT OK</span>
                                                                    }
                                                                </td>
                                                            );
                                                        })}
                                                        <td className="px-3 py-2 max-w-[220px]">
                                                            {comments
                                                                ? <span className="text-xs text-amber-700 font-medium">{comments}</span>
                                                                : <span className="text-xs text-slate-300">-</span>
                                                            }
                                                        </td>
                                                    </motion.tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                    <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-100 bg-slate-50/30">
                                        <span className="text-xs text-slate-500">{detailReport.report_rows.length} orders reviewed</span>
                                        <span className="text-xs text-slate-400">{detailReport.summary?.total_mistakes ?? 0} total mistakes</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* TAB 3 - ALL PROJECTS REPORT */}
            {activeTab === 'all-projects-report' && (
                <div className="space-y-4">
                    <div className="bg-white rounded-xl ring-1 ring-black/[0.04] shadow-sm overflow-hidden">

                        {/* Report filter toolbar */}
                        <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider shrink-0">Filter:</span>
                            {/* Layer selector */}
                            <div className="flex rounded-lg overflow-hidden border border-slate-200 shrink-0">
                                <button
                                    onClick={() => setReportLayer('FP_3_LAYER')}
                                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${reportLayer === 'FP_3_LAYER' ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                                >
                                    FP 3 Layer
                                </button>
                                <button
                                    onClick={() => setReportLayer('PH_2_LAYER')}
                                    className={`px-3 py-1.5 text-xs font-semibold transition-colors border-l border-slate-200 ${reportLayer === 'PH_2_LAYER' ? 'bg-brand-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                                >
                                    PH 2 Layer
                                </button>
                            </div>
                            <div className="flex items-center gap-1">
                                <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                                <input type="date" value={reportDateFrom} onChange={e => setReportDateFrom(e.target.value)}
                                    className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="Date From" />
                                <span className="text-slate-300">-</span>
                                <input type="date" value={reportDateTo} onChange={e => setReportDateTo(e.target.value)}
                                    className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="Date To" />
                            </div>
                            <input type="datetime-local" value={reportFromDateTime} onChange={e => setReportFromDateTime(e.target.value)}
                                className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="From DateTime" />
                            <input type="datetime-local" value={reportToDateTime} onChange={e => setReportToDateTime(e.target.value)}
                                className="px-2 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500/20" title="To DateTime" />
                            <button onClick={fetchReport}
                                className="px-4 py-2 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
                                Apply
                            </button>
                            <button onClick={() => { setReportDateFrom(''); setReportDateTo(''); setReportFromDateTime(''); setReportToDateTime(''); }}
                                className="inline-flex items-center gap-1 px-3 py-2 text-xs text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors">
                                <X className="h-3.5 w-3.5" /> Clear
                            </button>
                            {report?.projects?.length ? (
                                <div className="ml-auto flex items-center gap-2">
                                    <button
                                        onClick={downloadReportCsv}
                                        disabled={reportExporting !== null}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <FileText className="h-3.5 w-3.5" /> {reportExporting === 'csv' ? 'Exporting...' : 'CSV'}
                                    </button>
                                    <button
                                        onClick={downloadReportPdf}
                                        disabled={reportExporting !== null}
                                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-rose-600 text-white rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <FileText className="h-3.5 w-3.5" /> {reportExporting === 'pdf' ? 'Exporting...' : 'PDF'}
                                    </button>
                                </div>
                            ) : null}
                        </div>

                        {/* Report body */}
                        {reportLoading ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3">
                                <Loader2 className="h-7 w-7 animate-spin text-brand-500" />
                                <span className="text-sm text-slate-500">Loading report...</span>
                            </div>
                        ) : !report ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <BarChart3 className="h-12 w-12 mb-3 text-slate-200" />
                                <p className="text-sm font-medium">No report data yet</p>
                                <p className="text-xs mt-1">Select a date range and click Apply</p>
                                <p className="text-xs mt-0.5 text-brand-500 font-medium">Layer: {reportLayer === 'FP_3_LAYER' ? 'FP 3 Layer' : 'PH 2 Layer'}</p>
                            </div>
                        ) : (
                            <div className="p-4 space-y-5">
                                {/* Summary cards */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    <div className="bg-brand-50 rounded-xl p-3 text-center ring-1 ring-brand-200">
                                        <div className="text-3xl font-extrabold text-brand-700">{report.summary?.total_received_orders ?? 0}</div>
                                        <div className="text-[10px] text-brand-600 font-semibold uppercase mt-1">Total Received</div>
                                    </div>
                                    <div className="bg-sky-50 rounded-xl p-3 text-center ring-1 ring-sky-200">
                                        <div className="text-3xl font-extrabold text-sky-700">{report.summary?.total_orders ?? 0}</div>
                                        <div className="text-[10px] text-sky-600 font-semibold uppercase mt-1">Total QA Orders</div>
                                    </div>
                                    <div className="bg-rose-50 rounded-xl p-3 text-center ring-1 ring-rose-200">
                                        <div className="text-3xl font-extrabold text-rose-700">{report.summary?.grand_mistake_orders ?? 0}</div>
                                        <div className="text-[10px] text-rose-600 font-semibold uppercase mt-1">Mistake Orders</div>
                                    </div>
                                    <div className="bg-green-50 rounded-xl p-3 text-center ring-1 ring-green-200">
                                        <div className="text-3xl font-extrabold text-green-700">
                                            {calcEfficiency(report.summary?.total_orders ?? 0, report.summary?.grand_mistake_orders ?? 0)}%
                                        </div>
                                        <div className="text-[10px] text-green-600 font-semibold uppercase mt-1">Overall Efficiency</div>
                                    </div>
                                </div>

                                {/* Country grouped project tables */}
                                {Array.isArray(report.projects) && report.projects.length > 0 ? (() => {
                                    const groups = getCountryGroups(report.projects);
                                    return (
                                        <div className="space-y-5">
                                            {groups.map(({ country, projects: projs }) => {
                                                const grpOrders = projs.reduce((s, p) => s + p.total_orders, 0);
                                                const grpReceived = projs.reduce((s, p) => s + p.total_received_orders, 0);
                                                const grpMistakes = projs.reduce((s, p) => s + p.mistake_orders, 0);
                                                const grpEff = calcEfficiency(grpOrders, grpMistakes);
                                                const grpMistPct = grpOrders > 0 ? Math.round((grpMistakes / grpOrders) * 100) : 0;
                                                return (
                                                    <div key={country} className="rounded-lg border border-slate-200 overflow-hidden">
                                                        <div className="bg-slate-700 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2">
                                                            <span className="text-xs font-bold uppercase tracking-wider">{country}</span>
                                                            <span className="text-xs text-slate-300">{projs.length} projects | {grpReceived} delivered | {grpOrders} QA orders</span>
                                                        </div>
                                                        <div className="overflow-x-auto">
                                                            <table className="w-full text-sm">
                                                                <thead>
                                                                    <tr className="bg-brand-700 text-white">
                                                                        <th className="px-4 py-2.5 text-left font-semibold text-xs">
                                                                            <span className="inline-flex items-center gap-1"><FolderKanban className="h-3.5 w-3.5" /> Project / Client</span>
                                                                        </th>
                                                                        <th className="px-4 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Total Received</th>
                                                                        <th className="px-4 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Total QA Orders</th>
                                                                        <th className="px-4 py-2.5 text-center font-semibold text-xs whitespace-nowrap">No# Mistakes</th>
                                                                        <th className="px-4 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Efficiency %</th>
                                                                        <th className="px-4 py-2.5 text-center font-semibold text-xs whitespace-nowrap">Mistake %</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {projs.map((proj, i) => {
                                                                        const eff = calcEfficiency(proj.total_orders, proj.mistake_orders);
                                                                        const mistPct = proj.total_orders > 0 ? Math.round((proj.mistake_orders / proj.total_orders) * 100) : 0;
                                                                        return (
                                                                            <motion.tr key={proj.report_key || `${proj.project_id}:${getProjectDisplayName(proj)}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                                                                                transition={{ delay: Math.min(i * 0.02, 0.4) }}
                                                                                className={`border-b border-slate-100 hover:bg-brand-50/20 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                                                                                <td className="px-4 py-2.5 font-semibold text-slate-800 text-xs">{getProjectDisplayName(proj)}</td>
                                                                                <td className="px-4 py-2.5 text-center text-xs text-slate-500">{proj.total_received_orders}</td>
                                                                                <td className="px-4 py-2.5 text-center font-bold text-brand-700 text-xs">{proj.total_orders}</td>
                                                                                <td className="px-4 py-2.5 text-center text-xs">
                                                                                    <span className={`font-bold ${proj.mistake_orders > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                                                                                        {proj.mistake_orders}
                                                                                    </span>
                                                                                </td>
                                                                                <td className="px-4 py-2.5 text-center"><EfficiencyBadge pct={eff} /></td>
                                                                                <td className="px-4 py-2.5 text-center text-xs">
                                                                                    <span className={`font-bold ${mistPct > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{mistPct}%</span>
                                                                                </td>
                                                                            </motion.tr>
                                                                        );
                                                                    })}
                                                                </tbody>
                                                                <tfoot>
                                                                    <tr className="bg-brand-800/80 text-white">
                                                                        <td className="px-4 py-2 font-bold text-xs">COUNTRY TOTAL</td>
                                                                        <td className="px-4 py-2 text-center text-xs text-slate-300">{grpReceived}</td>
                                                                        <td className="px-4 py-2 text-center font-extrabold text-brand-200 text-xs">{grpOrders}</td>
                                                                        <td className="px-4 py-2 text-center font-extrabold text-rose-300 text-xs">{grpMistakes}</td>
                                                                        <td className="px-4 py-2 text-center font-extrabold text-green-300 text-xs">{grpEff}%</td>
                                                                        <td className="px-4 py-2 text-center font-extrabold text-amber-300 text-xs">{grpMistPct}%</td>
                                                                    </tr>
                                                                </tfoot>
                                                            </table>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })() : (
                                    <div className="flex flex-col items-center py-10 text-slate-400">
                                        <AlertTriangle className="h-10 w-10 mb-2 text-slate-200" />
                                        <p className="text-sm">No project data for the selected period</p>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Review Modal */}
            {reviewModal.open && (
                <LiveQAChecklistModal
                    open={reviewModal.open}
                    onClose={() => setReviewModal({ open: false, orderNumber: '' })}
                    projectId={selectedProject}
                    orderNumber={reviewModal.orderNumber}
                    layer="internal_qa"
                    isInternalQa={true}
                    onSaved={() => {
                        setReviewModal({ open: false, orderNumber: '' });
                        fetchOrders();
                    }}
                />
            )}
        </AnimatedPage>
    );
}
