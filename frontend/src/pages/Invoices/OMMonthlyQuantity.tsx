import { useEffect, useState } from 'react';
import { invoiceService, projectService } from '../../services';
import type { InvoiceMonthlyQuantity } from '../../types';
import { AnimatedPage, PageHeader, Button } from '../../components/ui';
import { Lock, RefreshCw, Calendar, BarChart3, CheckCircle2, FileText } from 'lucide-react';

const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const now = new Date();

export default function OMMonthlyQuantity() {

    // ── Filters ────────────────────────────────────────────────────
    const [projects, setProjects] = useState<any[]>([]);
    const [qtyProjectId, setQtyProjectId] = useState('');
    const [qtyYear, setQtyYear] = useState(String(now.getFullYear()));

    // ── Data ───────────────────────────────────────────────────────
    const [monthlyData, setMonthlyData] = useState<InvoiceMonthlyQuantity[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState('');
    const [savingMonths, setSavingMonths] = useState<Set<number>>(new Set());
    const [localEdits, setLocalEdits] = useState<Record<number, { manual_qty_total: string; manual_notes: string }>>({});

    // ── Load OM's assigned projects on mount ───────────────────────
    useEffect(() => {
        projectService.list()
            .then(res => {
                const d = res.data?.data || res.data;
                setProjects(Array.isArray(d) ? d : []);
            })
            .catch(() => { });
    }, []);

    // ── Load monthly data whenever project or year changes ─────────
    useEffect(() => {
        loadMonthlyData();
    }, [qtyProjectId, qtyYear]);

    const loadMonthlyData = async () => {
        if (!qtyProjectId || !qtyYear) return;
        setLoading(true);
        setLoadError('');
        try {
            const projectIdNum = Number(qtyProjectId);
            const yearNum = Number(qtyYear);

            // Step 1: get any already-stored records
            const res = await invoiceService.listMonthlyQuantities(projectIdNum, yearNum);
            let records: InvoiceMonthlyQuantity[] = res.data?.months || [];

            // Step 2: for past/current months with no stored record, call GET which
            // auto-creates the record by counting delivered orders from project table.
            const existing = new Set(records.map(r => r.month));
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth() + 1;
            const maxMonth =
                yearNum < currentYear ? 12 :
                    yearNum === currentYear ? currentMonth : 0;

            if (maxMonth > 0) {
                const missing = Array.from({ length: maxMonth }, (_, i) => i + 1)
                    .filter(m => !existing.has(m));

                if (missing.length > 0) {
                    const results = await Promise.allSettled(
                        missing.map(m =>
                            invoiceService.getMonthlyQuantity(projectIdNum, yearNum, m)
                                .then(r => r.data?.monthly_quantity || null)
                        )
                    );
                    const newRecords = results
                        .filter((r): r is PromiseFulfilledResult<InvoiceMonthlyQuantity> =>
                            r.status === 'fulfilled' && r.value !== null)
                        .map(r => r.value);
                    records = [...records, ...newRecords].sort((a, b) => a.month - b.month);
                }
            }

            setMonthlyData(records);
            const edits: Record<number, { manual_qty_total: string; manual_notes: string }> = {};
            records.forEach(r => {
                edits[r.month] = {
                    manual_qty_total: r.manual_qty_total != null ? String(r.manual_qty_total) : '',
                    manual_notes: r.manual_notes || '',
                };
            });
            setLocalEdits(edits);
        } catch (e: any) {
            console.error(e);
            setLoadError(e?.response?.data?.message || 'Failed to load monthly data. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const saveRow = async (month: number) => {
        if (!qtyProjectId || !qtyYear) return;
        const edit = localEdits[month] ?? { manual_qty_total: '0', manual_notes: '' };
        setSavingMonths(prev => new Set(prev).add(month));
        try {
            const res = await invoiceService.storeManualQuantity({
                project_id: Number(qtyProjectId),
                month,
                year: Number(qtyYear),
                manual_qty_total: Number(edit.manual_qty_total) || 0,
                manual_notes: edit.manual_notes || undefined,
            });
            const updated: InvoiceMonthlyQuantity = res.data?.monthly_quantity;
            if (updated) {
                setMonthlyData(prev => {
                    const idx = prev.findIndex(r => r.month === month);
                    if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n; }
                    return [...prev, updated].sort((a, b) => a.month - b.month);
                });
                setLocalEdits(prev => ({
                    ...prev,
                    [month]: {
                        manual_qty_total: updated.manual_qty_total != null ? String(updated.manual_qty_total) : '',
                        manual_notes: updated.manual_notes || '',
                    },
                }));
            }
        } catch (e) {
            console.error(e);
        } finally {
            setSavingMonths(prev => { const s = new Set(prev); s.delete(month); return s; });
        }
    };

    const selectedProject = projects.find((p: any) => String(p.id) === qtyProjectId);

    // ── Summary stats for header cards ────────────────────────────
    const savedCount = monthlyData.filter(r => r.manual_qty_total != null).length;
    const lockedCount = monthlyData.filter(r => r.is_quantity_locked).length;
    const totalSystemQty = monthlyData.reduce((s, r) => s + (r.system_qty_delivered ?? 0), 0);
    const totalManualQty = monthlyData.reduce((s, r) => s + (r.manual_qty_total ?? 0), 0);

    return (
        <AnimatedPage>
            <PageHeader
                title="Monthly Quantities"
                subtitle={`Enter your manual delivery quantities per month${selectedProject ? ` — ${selectedProject.name}` : ''}`}
                actions={
                    qtyProjectId ? (
                        <Button variant="secondary" size="sm" onClick={loadMonthlyData} loading={loading}>
                            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh
                        </Button>
                    ) : undefined
                }
            />

            {/* ── Filters ─────────────────────────────────────────────── */}
            <div className="bg-white rounded-xl border border-slate-200/60 p-4 mb-5">
                <div className="flex items-end gap-4 flex-wrap">
                    <div className="flex flex-col gap-1.5 min-w-64">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Your Project</label>
                        <select
                            value={qtyProjectId}
                            onChange={e => setQtyProjectId(e.target.value)}
                            className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        >
                            <option value="">Select project...</option>
                            {projects.map((p: any) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Year</label>
                        <input
                            type="number" value={qtyYear}
                            onChange={e => setQtyYear(e.target.value)}
                            min={2020} max={2100}
                            className="w-28 px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        />
                    </div>
                </div>
            </div>

            {/* ── Empty state ──────────────────────────────────────────── */}
            {!qtyProjectId && (
                <div className="bg-white rounded-xl border border-slate-200/60 p-16 flex flex-col items-center justify-center text-center">
                    <Calendar className="w-12 h-12 text-slate-200 mb-4" />
                    <p className="text-base font-medium text-slate-400">Select a project to view monthly quantities</p>
                    <p className="text-sm text-slate-300 mt-1">System-generated delivery counts and your manual quantities will appear here</p>
                </div>
            )}

            {/* ── Loading ───────────────────────────────────────────────── */}
            {qtyProjectId && loading && (
                <div className="bg-white rounded-xl border border-slate-200/60 p-16 flex flex-col items-center justify-center">
                    <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin mb-3" />
                    <p className="text-sm text-slate-400">Loading delivery data from orders table...</p>
                </div>
            )}

            {/* ── Error state ──────────────────────────────────────────── */}
            {qtyProjectId && !loading && loadError && (
                <div className="bg-white rounded-xl border border-rose-200 p-8 flex flex-col items-center justify-center text-center">
                    <p className="text-sm font-medium text-rose-600 mb-2">{loadError}</p>
                    <Button variant="secondary" size="sm" onClick={loadMonthlyData}>
                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Try Again
                    </Button>
                </div>
            )}

            {/* ── Stats + Table ────────────────────────────────────────── */}
            {qtyProjectId && !loading && !loadError && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center">
                                    <BarChart3 className="w-4.5 h-4.5 text-blue-600" />
                                </div>
                                <div>
                                    <div className="text-xl font-bold text-slate-900">{totalSystemQty}</div>
                                    <div className="text-xs text-slate-500">Total Delivered (System)</div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center">
                                    <CheckCircle2 className="w-4.5 h-4.5 text-teal-600" />
                                </div>
                                <div>
                                    <div className="text-xl font-bold text-slate-900">{totalManualQty}</div>
                                    <div className="text-xs text-slate-500">Total Manual Qty</div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                                    <FileText className="w-4.5 h-4.5 text-emerald-600" />
                                </div>
                                <div>
                                    <div className="text-xl font-bold text-slate-900">{savedCount}</div>
                                    <div className="text-xs text-slate-500">Months with Manual Qty</div>
                                </div>
                            </div>
                        </div>
                        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center">
                                    <Lock className="w-4.5 h-4.5 text-rose-500" />
                                </div>
                                <div>
                                    <div className="text-xl font-bold text-slate-900">{lockedCount}</div>
                                    <div className="text-xs text-slate-500">Locked Months</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Main table ──────────────────────────────────────── */}
                    <div className="bg-white rounded-xl border border-slate-200/60 overflow-hidden">
                        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h3 className="text-sm font-semibold text-slate-900">
                                    {selectedProject?.name} — {qtyYear}
                                </h3>
                                <p className="text-xs text-slate-400 mt-0.5">
                                    <span className="text-blue-500 font-medium">System Qty</span> = auto-counted from delivered orders (read-only) &nbsp;·&nbsp;
                                    Enter <span className="text-teal-600 font-medium">Manual Qty</span> for each month and click Save
                                </p>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 border-b border-slate-100">
                                    <tr>
                                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-36">Month</th>
                                        <th className="px-5 py-3 text-center text-xs font-semibold text-blue-500 uppercase tracking-wide w-52">
                                            System Qty
                                            <span className="block normal-case font-normal text-slate-400 text-[10px]">from delivered orders</span>
                                        </th>
                                        <th className="px-5 py-3 text-center text-xs font-semibold text-teal-600 uppercase tracking-wide w-44">
                                            My Manual Qty
                                        </th>
                                        <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                                        <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Status</th>
                                        <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                                        const record = monthlyData.find(r => r.month === month);
                                        const edit = localEdits[month] ?? { manual_qty_total: '', manual_notes: '' };
                                        const isLocked = record?.is_quantity_locked ?? false;
                                        const isSaving = savingMonths.has(month);
                                        const isFuture = Number(qtyYear) === now.getFullYear() && month > now.getMonth() + 1;
                                        const byType = (record?.system_qty_breakdown as any)?.by_workflow_type as Record<string, number> | undefined;
                                        const typeEntries = byType ? Object.entries(byType).filter(([, v]) => v > 0) : [];

                                        return (
                                            <tr
                                                key={month}
                                                className={`transition-colors ${isLocked ? 'bg-rose-50/30' : isFuture ? 'opacity-40' : 'hover:bg-slate-50/50'}`}
                                            >
                                                {/* Month */}
                                                <td className="px-5 py-3.5">
                                                    <div className="flex items-center gap-2">
                                                        <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0">
                                                            {MONTH_SHORT[month - 1]}
                                                        </span>
                                                        <span className="font-medium text-slate-700">{MONTHS[month - 1]}</span>
                                                    </div>
                                                </td>

                                                {/* System qty — read-only, from orders table */}
                                                <td className="px-5 py-3.5 text-center">
                                                    <div className="flex flex-col items-center gap-1">
                                                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold ${record?.system_qty_delivered != null
                                                            ? 'bg-blue-50 text-blue-700 border border-blue-100'
                                                            : 'bg-slate-100 text-slate-400'
                                                            }`}>
                                                            {record?.system_qty_delivered ?? '—'}
                                                        </span>
                                                        {/* Breakdown by workflow type */}
                                                        {typeEntries.length > 0 && (
                                                            <div className="flex flex-wrap gap-0.5 justify-center max-w-44">
                                                                {typeEntries.map(([type, count]) => (
                                                                    <span key={type} className="text-[10px] bg-blue-50 text-blue-400 rounded px-1.5 py-0.5 capitalize">
                                                                        {type}: {count}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* Manual qty — OM editable */}
                                                <td className="px-5 py-3.5 text-center">
                                                    {isLocked ? (
                                                        <span className="text-sm font-bold text-slate-500">
                                                            {record?.manual_qty_total ?? '—'}
                                                        </span>
                                                    ) : (
                                                        <input
                                                            type="number" min="0"
                                                            disabled={isFuture}
                                                            value={edit.manual_qty_total}
                                                            onChange={e => setLocalEdits(prev => ({
                                                                ...prev,
                                                                [month]: { ...edit, manual_qty_total: e.target.value },
                                                            }))}
                                                            placeholder="0"
                                                            className="w-28 px-3 py-1.5 text-sm border border-slate-200 rounded-lg text-center bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-400"
                                                        />
                                                    )}
                                                </td>

                                                {/* Notes */}
                                                <td className="px-5 py-3.5">
                                                    {isLocked ? (
                                                        <span className="text-xs text-slate-400 italic">{record?.manual_notes || '—'}</span>
                                                    ) : (
                                                        <input
                                                            type="text"
                                                            disabled={isFuture}
                                                            value={edit.manual_notes}
                                                            onChange={e => setLocalEdits(prev => ({
                                                                ...prev,
                                                                [month]: { ...edit, manual_notes: e.target.value },
                                                            }))}
                                                            placeholder="Optional notes..."
                                                            className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 disabled:bg-slate-50 disabled:text-slate-400"
                                                        />
                                                    )}
                                                </td>

                                                {/* Status badge */}
                                                <td className="px-5 py-3.5 text-center">
                                                    {isLocked ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-100">
                                                            <Lock className="w-3 h-3" />Locked
                                                        </span>
                                                    ) : record?.invoice ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
                                                            <FileText className="w-3 h-3" />Invoiced
                                                        </span>
                                                    ) : record?.manual_qty_total != null ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-50 text-teal-600 border border-teal-100">
                                                            <CheckCircle2 className="w-3 h-3" />Saved
                                                        </span>
                                                    ) : isFuture ? (
                                                        <span className="text-xs text-slate-300">Future</span>
                                                    ) : (
                                                        <span className="text-xs text-slate-300">—</span>
                                                    )}
                                                </td>

                                                {/* Save action */}
                                                <td className="px-5 py-3.5 text-right">
                                                    {!isLocked && !isFuture && (
                                                        <Button
                                                            size="xs"
                                                            loading={isSaving}
                                                            disabled={edit.manual_qty_total === ''}
                                                            onClick={() => saveRow(month)}
                                                        >
                                                            Save
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Footer note */}
                        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center gap-2">
                            <Lock className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                            <p className="text-xs text-slate-400">
                                Locked months are finalized by the Director/CEO and cannot be edited. Contact them to unlock.
                            </p>
                        </div>
                    </div>
                </>
            )}
        </AnimatedPage>
    );
}
