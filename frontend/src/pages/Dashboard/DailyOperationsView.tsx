import React, { useState, useEffect, useCallback } from 'react';
import { dashboardService, liveQAService } from '../../services';
import type { DailyOperationsData, DailyOperationsProject } from '../../types';
import { DailyOpsSkeleton } from '../../components/ui';
import {
  Calendar, ChevronDown, ChevronRight, Users, Package,
  TrendingUp, AlertCircle, Layers, ClipboardCheck, RefreshCw, Download,
  FileText, X, Loader2, CheckCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { exportDailyOperationsPdf } from '../../utils/dailyOperationsPdf';

// ─── Mistake Summary Types ────────────────────────────
interface MistakeWorker {
  name: string;
  plan_count: number;
  items: Record<string, number>;
  mistake_total: number;
}
interface MistakeTeam {
  team_id: number;
  team_name: string;
  workers: MistakeWorker[];
}

const LAYER_LABELS: Record<string, string> = {
  DRAW: 'Drawer',
  CHECK: 'Checker',
  DESIGN: 'Designer',
  QA: 'QA',
};

const LAYER_COLORS: Record<string, string> = {
  DRAW: 'bg-blue-50 text-blue-700 border-blue-200',
  CHECK: 'bg-amber-50 text-amber-700 border-amber-200',
  DESIGN: 'bg-brand-50 text-brand-700 border-brand-200',
  QA: 'bg-brand-50 text-brand-700 border-brand-200',
};

export default function DailyOperationsView() {
  const [data, setData] = useState<DailyOperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(
    new Date().toISOString().split('T')[0]
  );
  const [dateTo, setDateTo] = useState(
    new Date().toISOString().split('T')[0]
  );
  // const [dateInput, setDateInput] = useState(new Date().toISOString().split('T')[0]);
  const [expandedProjects, setExpandedProjects] = useState<Set<number>>(new Set());
  const [filterCountry, setFilterCountry] = useState<string>('all');
  const [filterDept, setFilterDept] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'stage' | 'unified'>('stage');

  // ── Checklist Summary Modal state ──
  const [summaryModal, setSummaryModal] = useState<{ open: boolean; projectId: number; projectName: string; layer: string }>({ open: false, projectId: 0, projectName: '', layer: 'drawer' });
  const [summaryTeams, setSummaryTeams] = useState<MistakeTeam[]>([]);
  const [summaryCols, setSummaryCols] = useState<string[]>([]);
  const [summaryTotals, setSummaryTotals] = useState({ total_orders: 0, total_mistakes: 0 });
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryDateFrom, setSummaryDateFrom] = useState('');
  const [summaryDateTo, setSummaryDateTo] = useState('');
  const [summaryWorkerFilter, setSummaryWorkerFilter] = useState('');

  const openChecklistSummary = useCallback((projectId: number, projectName: string, layer: string = 'drawer') => {
    setSummaryModal({ open: true, projectId, projectName, layer });
    setSummaryDateFrom('');
    setSummaryDateTo('');
    setSummaryWorkerFilter('');
    fetchSummary(projectId, layer);
  }, []);

  const fetchSummary = async (projectId: number, layer: string, dateFrom?: string, dateTo?: string, worker?: string) => {
    setSummaryLoading(true);
    try {
      const params: Record<string, any> = {};
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (worker) params.worker = worker;
      const res = await liveQAService.getMistakeSummary(projectId, layer, params);
      setSummaryTeams(res.data.teams || []);
      setSummaryCols(res.data.checklist_items || []);
      setSummaryTotals(res.data.summary || { total_orders: 0, total_mistakes: 0 });
    } catch {
      setSummaryTeams([]);
      setSummaryCols([]);
    } finally {
      setSummaryLoading(false);
    }
  };

  // Debounce date changes to prevent API spam
  // useEffect(() => {
  //   const timer = setTimeout(() => {
  //     setSelectedDate(dateInput);
  //   }, 500);
  //   return () => clearTimeout(timer);
  // }, [dateInput]);

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, viewMode]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await dashboardService.dailyOperations(dateFrom, dateTo, viewMode);
      setData(res.data);
    } catch (e: any) {
      console.error('Failed to load daily operations:', e);
      setError(e.response?.data?.message || 'Failed to load data. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleProject = (projectId: number) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const expandAll = () => {
    if (!data) return;
    setExpandedProjects(new Set((data.projects || []).map(p => p.id)));
  };

  const collapseAll = () => {
    setExpandedProjects(new Set());
  };

  const exportToCSV = () => {
    if (!data) return;

    // Build CSV content
    const headers = ['Project Code', 'Project Name', 'Country', 'Department', 'Received', 'Delivered', 'Pending', 'Layers', 'Workers', 'QA Compliance %'];
    const rows = filteredProjects.map(p => {
      const layerSummary = Object.entries(p.layers || {})
        .map(([stage, layer]) => `${LAYER_LABELS[stage]}:${layer?.total || 0}`)
        .join('; ');
      const workerCount = Object.values(p.layers || {})
        .reduce((sum, layer) => sum + (layer?.workers || []).length, 0);

      return [
        p.code,
        p.name,
        p.country,
        p.department === 'floor_plan' ? 'Floor Plan' : 'Photos Enhancement',
        p.received,
        p.delivered,
        p.pending,
        layerSummary,
        workerCount,
        p.qa_checklist?.compliance_rate ?? 0,
      ];
    });

    const csvContent = [
      `Daily Operations Report - ${formatDate(dateFrom)} → ${formatDate(dateTo)}`,
      '',
      headers.join(','),
      ...rows.map(row => row.join(',')),
      '',
      `Summary:,,,,,,,,,`,
      `Total Projects:,${data.totals?.projects ?? 0},,,,,,,,`,
      `Total Received:,${data.totals?.received ?? 0},,,,,,,,`,
      `Total Delivered:,${data.totals?.delivered ?? 0},,,,,,,,`,
      `Total Pending:,${data.totals?.pending ?? 0},,,,,,,,`,
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `daily-operations-${dateFrom}-to-${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // const changeDate = (days: number) => {
  //   const date = new Date(dateInput);
  //   date.setDate(date.getDate() + days);
  //   const newDate = date.toISOString().split('T')[0];
  //   const today = new Date().toISOString().split('T')[0];
  //   // Don't allow future dates
  //   if (newDate > today) return;
  //   setDateInput(newDate);
  // };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };



const allProjects: DailyOperationsProject[] = React.useMemo(() => {
  let projects: DailyOperationsProject[] = [];

  if (Array.isArray(data?.days)) {
    projects = data.days.flatMap(day =>
      Array.isArray(day.projects) ? day.projects : []
    );
  } else if (Array.isArray(data?.projects)) {
    projects = data.projects;
  }

  // ✅ GROUP BY PROJECT ID
  const grouped: Record<number, DailyOperationsProject> = {};

  projects.forEach((p) => {
    if (!grouped[p.id]) {
      // clone first instance
      grouped[p.id] = JSON.parse(JSON.stringify(p));
    } else {
      const existing = grouped[p.id];

      // ✅ SUM MAIN FIELDS
      existing.received += p.received;
      existing.delivered += p.delivered;
      existing.pending += p.pending;

      // ✅ MERGE LAYERS
      Object.entries(p.layers || {}).forEach(([stage, layer]) => {
        if (!existing.layers[stage]) {
          existing.layers[stage] = layer;
        } else {
          existing.layers[stage].total += layer.total;

          // merge workers
          const workerMap: Record<number, any> = {};

          existing.layers[stage].workers.forEach((w: any) => {
            workerMap[w.id] = { ...w };
          });

          (layer.workers || []).forEach((w: any) => {
            if (!workerMap[w.id]) {
              workerMap[w.id] = { ...w };
            } else {
              workerMap[w.id].completed += w.completed;
            }
          });

          existing.layers[stage].workers = Object.values(workerMap);
        }
      });

      // ✅ MERGE QA CHECKLIST
      if (p.qa_checklist && existing.qa_checklist) {
        existing.qa_checklist.total_orders += p.qa_checklist.total_orders;
        existing.qa_checklist.total_items += p.qa_checklist.total_items;
        existing.qa_checklist.completed_items += p.qa_checklist.completed_items;
        existing.qa_checklist.mistake_count += p.qa_checklist.mistake_count;

        // recompute %
        existing.qa_checklist.compliance_rate =
          existing.qa_checklist.total_items > 0
            ? Math.round(
                (existing.qa_checklist.completed_items /
                  existing.qa_checklist.total_items) *
                  100
              )
            : 0;
      }
    }
  });

  return Object.values(grouped);
}, [data]);

  // Apply filters safely
  const filteredProjects = allProjects.filter(p => {
    if (!p) return false;

    const country = p.country ?? '';
    const dept = p.department ?? '';

    if (filterCountry !== 'all' && country !== filterCountry) return false;
    if (filterDept !== 'all' && dept !== filterDept) return false;

    return true;
  });


  const countries = data ? [...new Set((data.projects || []).map(p => p.country))] : [];
  const departments = data ? [...new Set((data.projects || []).map(p => p.department))] : [];

  if (loading) {
    return <DailyOpsSkeleton />;
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-rose-500" />
        <p className="text-slate-900 font-medium mb-2">Failed to load daily operations</p>
        <p className="text-sm text-slate-500 mb-4">{error}</p>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-[#2AA7A0] text-white rounded-lg hover:bg-[#238B85] transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-16 text-slate-500">
        <AlertCircle className="w-12 h-12 mx-auto mb-4 text-slate-300" />
        <p>No data available</p>
        <button onClick={loadData} className="mt-4 text-sm text-[#2AA7A0] hover:underline">
          Reload
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with date navigation */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-[#2AA7A0]" />
          <h2 className="text-lg font-semibold text-slate-900">Daily Operations</h2>
          <span className="text-sm text-slate-500">
            {formatDate(dateFrom)} → {formatDate(dateTo)}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* <button
            onClick={() => changeDate(-1)}
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
            title="Previous day"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4 text-slate-600" />
          </button> */}
          <label htmlFor="date-picker" className="sr-only">Select date for daily operations</label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
            />

            <span className="text-xs text-slate-400">to</span>

            <input
              type="date"
              value={dateTo}
              min={dateFrom}
              max={new Date().toISOString().split('T')[0]}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg"
            />
          </div>
          {/* <button
            onClick={() => changeDate(1)}
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Next day"
            aria-label="Next day"
            disabled={dateInput >= new Date().toISOString().split('T')[0]}
          >
            <ChevronRight className="w-4 h-4 text-slate-600" />
          </button> */}
          <button
            onClick={loadData}
            className="p-2 rounded-lg hover:bg-slate-100 transition-colors"
            title="Refresh"
            aria-label="Refresh data"
          >
            <RefreshCw className={`w-4 h-4 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers className="w-4 h-4 text-slate-400" />
            <span className="text-xs text-slate-500">Projects</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{data.totals?.projects ?? 0}</div>
          <div className="text-xs text-slate-400 mt-1">Active</div>
        </div>
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-slate-500">Received</span>
          </div>
          <div className="text-2xl font-bold text-blue-600">{data.totals?.received ?? 0}</div>
          <div className="text-xs text-slate-400 mt-1">Orders in</div>
        </div>
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-brand-500" />
            <span className="text-xs text-slate-500">Delivered</span>
          </div>
          <div className="text-2xl font-bold text-brand-600">{data.totals?.delivered ?? 0}</div>
          <div className="text-xs text-slate-400 mt-1">Completed</div>
        </div>
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-slate-500">Pending</span>
          </div>
          <div className="text-2xl font-bold text-amber-600">{data.totals?.pending ?? 0}</div>
          <div className="text-xs text-slate-400 mt-1">In pipeline</div>
        </div>
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-[#2AA7A0]" />
            <span className="text-xs text-slate-500">Work Items</span>
          </div>
          <div className="text-2xl font-bold text-[#2AA7A0]">{data.totals?.total_work_items ?? 0}</div>
          <div className="text-xs text-slate-400 mt-1">Completed</div>
        </div>
      </div>

      {/* Filters and actions */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <label htmlFor="country-filter" className="sr-only">Filter by country</label>
          <select
            id="country-filter"
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            className="text-sm px-3 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#2AA7A0]/20 focus:border-[#2AA7A0]"
            aria-label="Filter projects by country"
          >
            <option value="all">All Countries</option>
            {countries.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label htmlFor="dept-filter" className="sr-only">Filter by department</label>
          <select
            id="dept-filter"
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            className="text-sm px-3 py-1.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-[#2AA7A0]/20 focus:border-[#2AA7A0]"
            aria-label="Filter projects by department"
          >
            <option value="all">All Departments</option>
            {departments.map(d => (
              <option key={d} value={d}>{d === 'floor_plan' ? 'Floor Plan' : 'Photos Enhancement'}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('stage')}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${viewMode === 'stage' ? 'bg-white text-slate-900 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              title="Each stage counted by its own completion time"
            >
              By Stage Time
            </button>
            <button
              onClick={() => setViewMode('unified')}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${viewMode === 'unified' ? 'bg-white text-slate-900 shadow-sm font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              title="All stages counted by QA completion time (same day)"
            >
              By QA Time
            </button>
          </div>
          <button
            onClick={exportToCSV}
            disabled={!data || filteredProjects.length === 0}
            className="flex items-center gap-2 text-xs px-3 py-1.5 bg-[#2AA7A0] text-white rounded-lg hover:bg-[#238B85] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export to CSV"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
          <button
onClick={() => {
  if (!data) return;

  const aggregatedTotals = filteredProjects.reduce(
    (acc, p) => {
      acc.projects += 1;
      acc.received += p.received;
      acc.delivered += p.delivered;
      acc.pending += p.pending;
      acc.total_work_items += Object.values(p.layers || {})
        .reduce((sum, l) => sum + l.total, 0);

      return acc;
    },
    {
      projects: 0,
      received: 0,
      delivered: 0,
      pending: 0,
      total_work_items: 0,
    }
  );

  exportDailyOperationsPdf(
    {
      ...data,
      totals: aggregatedTotals // ✅ THIS LINE FIXES EVERYTHING
    },
    filteredProjects,
    { start: dateFrom, end: dateTo }
  );
}}
            disabled={!data || filteredProjects.length === 0}
            className="flex items-center gap-2 text-xs px-3 py-1.5 bg-[#C45C26] text-white rounded-lg hover:bg-[#A84E20] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Export to PDF"
          >
            <FileText className="w-3.5 h-3.5" />
            Export PDF
          </button>
          <button
            onClick={expandAll}
            className="text-xs px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="text-xs px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Projects list */}
      <div className="space-y-2">
        {filteredProjects.length === 0 ? (
          <div className="text-center py-12 text-slate-500 bg-white rounded-xl ring-1 ring-black/[0.04]">
            No projects match the selected filters
          </div>
        ) : (
          filteredProjects.map(project => (
            <ProjectRow
              key={project.id}
              project={project}
              expanded={expandedProjects.has(project.id)}
              onToggle={() => toggleProject(project.id)}
              onOpenSummary={(layer: string) => openChecklistSummary(project.id, project.name, layer)}
            />
          ))
        )}
      </div>

      {/* ═══ CHECKLIST SUMMARY MODAL ═══ */}
      {summaryModal.open && <ChecklistSummaryModal
        modal={summaryModal}
        teams={summaryTeams}
        cols={summaryCols}
        totals={summaryTotals}
        loading={summaryLoading}
        dateFrom={summaryDateFrom}
        dateTo={summaryDateTo}
        workerFilter={summaryWorkerFilter}
        onDateFromChange={setSummaryDateFrom}
        onDateToChange={setSummaryDateTo}
        onWorkerFilterChange={setSummaryWorkerFilter}
        onApplyFilters={() => fetchSummary(summaryModal.projectId, summaryModal.layer, summaryDateFrom, summaryDateTo, summaryWorkerFilter)}
        onLayerChange={(layer: string) => {
          setSummaryModal(prev => ({ ...prev, layer }));
          fetchSummary(summaryModal.projectId, layer, summaryDateFrom, summaryDateTo, summaryWorkerFilter);
        }}
        onClose={() => setSummaryModal({ open: false, projectId: 0, projectName: '', layer: 'drawer' })}
      />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CHECKLIST SUMMARY MODAL — Full-screen team-grouped pivot
// ═══════════════════════════════════════════════════════════
const LAYER_OPTIONS = [
  { value: 'drawer', label: 'Drawer', color: 'bg-[#2AA7A0]' },
  { value: 'checker', label: 'Checker', color: 'bg-amber-600' },
  { value: 'qa', label: 'QA', color: 'bg-brand-600' },
];

function ChecklistSummaryModal({
  modal, teams, cols, totals, loading,
  dateFrom, dateTo, workerFilter,
  onDateFromChange, onDateToChange, onWorkerFilterChange,
  onApplyFilters, onLayerChange, onClose,
}: {
  modal: { open: boolean; projectId: number; projectName: string; layer: string };
  teams: MistakeTeam[];
  cols: string[];
  totals: { total_orders: number; total_mistakes: number };
  loading: boolean;
  dateFrom: string;
  dateTo: string;
  workerFilter: string;
  onDateFromChange: (v: string) => void;
  onDateToChange: (v: string) => void;
  onWorkerFilterChange: (v: string) => void;
  onApplyFilters: () => void;
  onLayerChange: (layer: string) => void;
  onClose: () => void;
}) {
  const layerLabel = modal.layer === 'drawer' ? 'Drawer' : modal.layer === 'checker' ? 'Checker' : 'QA';

  // Grand totals
  const grandPlanCount = teams.reduce((s, t) => s + (t.workers || []).reduce((ws, w) => ws + w.plan_count, 0), 0);
  const grandTotals: Record<string, number> = {};
  cols.forEach(c => { grandTotals[c] = 0; });
  let grandMistakeTotal = 0;
  teams.forEach(t => (t.workers || []).forEach(w => {
    Object.entries(w.items || {}).forEach(([k, v]) => { grandTotals[k] = (grandTotals[k] || 0) + v; });
    grandMistakeTotal += w.mistake_total;
  }));

  // CSV download
  const downloadCSV = () => {
    const headers = [layerLabel, 'Plan Count', ...cols, 'Mistake Total'];
    const rows: string[][] = [];
    teams.forEach(team => {
      rows.push([team.team_name, '', ...cols.map(() => ''), '']);
      (team.workers || []).forEach(w => {
        rows.push([w.name, String(w.plan_count), ...cols.map(c => String((w.items || {})[c] || 0)), String(w.mistake_total)]);
      });
      const teamPlan = (team.workers || []).reduce((s, w) => s + w.plan_count, 0);
      const teamItems = cols.map(c => String((team.workers || []).reduce((s, w) => s + ((w.items || {})[c] || 0), 0)));
      const teamTotal = (team.workers || []).reduce((s, w) => s + w.mistake_total, 0);
      rows.push([`${team.team_name} TOTAL`, String(teamPlan), ...teamItems, String(teamTotal)]);
    });
    rows.push(['GRAND TOTAL', String(grandPlanCount), ...cols.map(c => String(grandTotals[c] || 0)), String(grandMistakeTotal)]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${c}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${layerLabel}_Checklist_Summary_${modal.projectName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.2 }}
        className="bg-white rounded-2xl shadow-2xl w-[95vw] max-w-7xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-gradient-to-r from-[#2AA7A0]/5 to-transparent">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              F.P. {layerLabel} Checklist Summary
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">{modal.projectName}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 transition-colors" aria-label="Close">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {/* Modal body (scrollable) */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Layer tabs */}
          <div className="flex items-center gap-2">
            {LAYER_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => onLayerChange(opt.value)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${modal.layer === opt.value
                    ? `${opt.color} text-white shadow-sm`
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Filters */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Worker</label>
                <input
                  type="text"
                  value={workerFilter}
                  onChange={e => onWorkerFilterChange(e.target.value)}
                  placeholder="Filter by name..."
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-[#2AA7A0] focus:border-[#2AA7A0]"
                />
              </div>
              <div className="min-w-[130px]">
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Date From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={e => onDateFromChange(e.target.value)}
                  title="Date from"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-[#2AA7A0] focus:border-[#2AA7A0]"
                />
              </div>
              <div className="min-w-[130px]">
                <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Date To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={e => onDateToChange(e.target.value)}
                  title="Date to"
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg focus:ring-1 focus:ring-[#2AA7A0] focus:border-[#2AA7A0]"
                />
              </div>
              <button
                onClick={onApplyFilters}
                className="px-4 py-1.5 text-xs font-semibold bg-[#2AA7A0] text-white rounded-lg hover:bg-[#238B85] transition-colors"
              >
                Apply Filters
              </button>
              <button
                onClick={downloadCSV}
                disabled={teams.length === 0}
                className="px-4 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-1 disabled:opacity-50"
              >
                <FileText className="h-3 w-3" /> Download CSV
              </button>
            </div>
          </div>

          {/* Report subtitle */}
          {(dateFrom || dateTo) && (
            <div className="text-center text-xs text-slate-500 font-medium">
              {modal.projectName} ({layerLabel} Person) QA Report
              {dateFrom && ` From ${dateFrom}`}
              {dateTo && ` To ${dateTo}`}
            </div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#2AA7A0]/10 rounded-lg p-3 text-center ring-1 ring-[#2AA7A0]/20">
              <div className="text-2xl font-bold text-[#2AA7A0]">{totals.total_orders}</div>
              <div className="text-[10px] text-[#238B85] font-semibold uppercase">Orders Reviewed</div>
            </div>
            <div className="bg-rose-50 rounded-lg p-3 text-center ring-1 ring-rose-200">
              <div className="text-2xl font-bold text-rose-700">{totals.total_mistakes}</div>
              <div className="text-[10px] text-rose-600 font-semibold uppercase">Total Mistakes</div>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-[#2AA7A0]" />
            </div>
          ) : teams.length > 0 && cols.length > 0 ? (
            <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-[55vh] overflow-y-auto">
              <table className="w-full text-xs whitespace-nowrap border-collapse">
                {/* Header */}
                <thead className="sticky top-0 z-10">
                  <tr className="bg-slate-700 text-white">
                    <th className="px-3 py-2.5 text-left font-semibold sticky left-0 bg-slate-700 z-20 min-w-[150px] border-r border-slate-600">{layerLabel}</th>
                    <th className="px-3 py-2.5 text-center font-semibold min-w-[70px] border-r border-slate-600">Plan Count</th>
                    {cols.map(item => (
                      <th key={item} className="px-2 py-2.5 text-center font-semibold min-w-[85px] border-r border-slate-600" title={item}>
                        {item}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-center font-semibold min-w-[80px] bg-rose-800">Mistake Total</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => {
                    const teamPlan = (team.workers || []).reduce((s, w) => s + w.plan_count, 0);
                    const teamItems: Record<string, number> = {};
                    cols.forEach(c => { teamItems[c] = (team.workers || []).reduce((s, w) => s + ((w.items || {})[c] || 0), 0); });
                    const teamMistakeTotal = (team.workers || []).reduce((s, w) => s + w.mistake_total, 0);

                    return (
                      <React.Fragment key={team.team_id}>
                        {/* Team header */}
                        <tr className="bg-slate-800">
                          <td colSpan={cols.length + 3} className="px-3 py-2 font-bold text-white text-xs sticky left-0 bg-slate-800 z-[5]">
                            {team.team_name}
                          </td>
                        </tr>
                        {/* Workers */}
                        {(team.workers || []).map((w, wi) => (
                          <tr key={w.name} className={`border-b border-slate-100 hover:bg-[#2AA7A0]/5 ${wi % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}`}>
                            <td className="px-3 py-1.5 font-medium text-slate-700 sticky left-0 bg-inherit z-[5] border-r border-slate-100">
                              {w.name}
                            </td>
                            <td className="px-3 py-1.5 text-center font-semibold text-[#2AA7A0] border-r border-slate-100">
                              {w.plan_count}
                            </td>
                            {cols.map(c => {
                              const val = (w.items || {})[c] || 0;
                              return (
                                <td key={c} className="px-2 py-1.5 text-center border-r border-slate-100">
                                  <span className={`font-semibold ${val === 0 ? 'text-slate-400' : val <= 2 ? 'text-amber-600' : 'text-rose-600 font-bold'
                                    }`}>
                                    {val}
                                  </span>
                                </td>
                              );
                            })}
                            <td className="px-3 py-1.5 text-center">
                              <span className={`inline-flex items-center justify-center min-w-[26px] h-5 rounded text-xs font-bold ${w.mistake_total === 0 ? 'text-slate-400' : 'text-white bg-rose-500 px-1.5'
                                }`}>
                                {w.mistake_total}
                              </span>
                            </td>
                          </tr>
                        ))}
                        {/* Team subtotal */}
                        <tr className="bg-rose-50 border-b-2 border-slate-200">
                          <td className="px-3 py-1.5 font-bold text-slate-700 text-center sticky left-0 bg-rose-50 z-[5] border-r border-slate-200">
                            {team.team_name} TOTAL
                          </td>
                          <td className="px-3 py-1.5 text-center font-bold text-[#238B85] border-r border-slate-200">{teamPlan}</td>
                          {cols.map(c => (
                            <td key={c} className="px-2 py-1.5 text-center font-bold border-r border-slate-200">
                              <span className={teamItems[c] > 0 ? 'text-rose-600' : 'text-slate-400'}>{teamItems[c]}</span>
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-center font-bold text-rose-700">{teamMistakeTotal}</td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
                {/* Grand total footer */}
                <tfoot className="sticky bottom-0 z-10">
                  <tr className="bg-slate-800 text-white font-bold">
                    <td className="px-3 py-2.5 sticky left-0 bg-slate-800 z-20 border-r border-slate-600 text-center">GRAND TOTAL</td>
                    <td className="px-3 py-2.5 text-center border-r border-slate-600">{grandPlanCount}</td>
                    {cols.map(c => (
                      <td key={c} className="px-2 py-2.5 text-center border-r border-slate-600">
                        <span className={grandTotals[c] > 0 ? 'text-rose-300' : 'text-slate-400'}>{grandTotals[c] || 0}</span>
                      </td>
                    ))}
                    <td className="px-3 py-2.5 text-center bg-rose-800">
                      <span className="text-sm">{grandMistakeTotal}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400">
              <CheckCircle className="h-10 w-10 mx-auto mb-2 text-green-400" />
              <p className="text-sm font-medium">No mistakes recorded</p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
function ProjectRow({
  project,
  expanded,
  onToggle,
  onOpenSummary,
}: {
  project: DailyOperationsProject;
  expanded: boolean;
  onToggle: () => void;
  onOpenSummary: (layer: string) => void;
}) {
  const layers = Object.entries(project.layers || {});
  const totalWork = layers.reduce((sum, [, layer]) => sum + (layer?.total || 0), 0);
  const hasWork = totalWork > 0;

  return (
    <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-all duration-150 text-left group"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${hasWork ? 'bg-[#2AA7A0]/10' : 'bg-slate-100'}`}>
            <Layers className={`h-4 w-4 ${hasWork ? 'text-[#2AA7A0]' : 'text-slate-400'}`} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{project.code}</span>
              <span className="text-sm text-slate-500 truncate">{project.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-slate-400">{project.country}</span>
              <span className="text-xs text-slate-300">·</span>
              <span className="text-xs text-slate-400">{project.department === 'floor_plan' ? 'Floor Plan' : 'Photos'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Layer badges */}
          <div className="hidden md:flex items-center gap-2">
            {layers.map(([stage, layer]) => (
              <span
                key={stage}
                className={`text-xs px-2 py-1 rounded-md border ${LAYER_COLORS[stage] || 'bg-slate-50 text-slate-600 border-slate-200'} ${layer.total === 0 ? 'opacity-40' : ''}`}
              >
                {LAYER_LABELS[stage] || stage}: {layer.total}
              </span>
            ))}
          </div>

          {/* Stats */}
          <div className="flex items-center gap-3 text-xs">
            <span className="text-blue-600 font-medium">{project.received} in</span>
            <span className="text-brand-600 font-medium">{project.delivered} out</span>
            {project.pending > 0 && (
              <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded font-medium ring-1 ring-amber-200">
                {project.pending} pending
              </span>
            )}
          </div>

          {expanded ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border-t border-slate-100 overflow-hidden"
          >
            <div className="p-4 space-y-4">
              {/* Layer breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {layers.map(([stage, layer]) => (
                  <div
                    key={stage}
                    className={`rounded-lg p-4 border ${LAYER_COLORS[stage] || 'bg-slate-50 border-slate-200'}`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium">{LAYER_LABELS[stage] || stage}</span>
                      <span className="text-lg font-bold">{layer.total}</span>
                    </div>
                    {(layer.workers || []).length > 0 ? (
                      <div className="space-y-2">
                        {(layer.workers || []).map(worker => (
                          <div key={worker.id} className="flex items-center justify-between text-xs">
                            <span className="truncate">{worker.name}</span>
                            <span className="font-medium">
                              {worker.completed} done{worker.has_more ? '+' : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs opacity-60 text-center py-2">No work today</div>
                    )}
                  </div>
                ))}
              </div>

              {/* QA Checklist compliance */}
              {project.qa_checklist && (
                <div className="bg-slate-50 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <ClipboardCheck className="w-4 h-4 text-[#2AA7A0]" />
                    <span className="text-sm font-medium text-slate-900">QA Checklist Compliance</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
                    <div>
                      <div className="text-lg font-bold text-slate-900">{project.qa_checklist.total_orders}</div>
                      <div className="text-xs text-slate-500">Orders QA'd</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-slate-900">{project.qa_checklist.total_items}</div>
                      <div className="text-xs text-slate-500">Checklist Items</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-brand-600">{project.qa_checklist.completed_items}</div>
                      <div className="text-xs text-slate-500">Completed</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-rose-600">{project.qa_checklist.mistake_count}</div>
                      <div className="text-xs text-slate-500">Mistakes Found</div>
                    </div>
                    <div>
                      <div className={`text-lg font-bold ${project.qa_checklist.compliance_rate >= 95 ? 'text-brand-600' : project.qa_checklist.compliance_rate >= 80 ? 'text-amber-600' : 'text-rose-600'}`}>
                        {project.qa_checklist.compliance_rate}%
                      </div>
                      <div className="text-xs text-slate-500">Compliance</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Checklist Summary Buttons */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenSummary('drawer'); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#2AA7A0] text-white rounded-lg hover:bg-[#238B85] transition-colors"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Drawer Checklist Summary
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenSummary('checker'); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  Checker Checklist Summary
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onOpenSummary('qa'); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
                >
                  <ClipboardCheck className="w-3.5 h-3.5" />
                  QA Checklist Summary
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
