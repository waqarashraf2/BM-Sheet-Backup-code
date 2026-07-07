import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock, CheckSquare, ChevronDown, ChevronUp, Eye, Loader2, Palette, Pencil,
  Search, TimerReset,
} from 'lucide-react';
import { dashboardService } from '../../services';
import type { TimeWiseCountData, TimeWiseCountSummary } from '../../types';

interface ProjectOption {
  id: number;
  code: string;
  name: string;
  country?: string;
  timezone?: string;
}

interface TimeWiseCountViewProps {
  projects: ProjectOption[];
  dashboard: 'operations' | 'project-manager';
}

const roleMeta: Record<TimeWiseCountSummary['role'], {
  label: string;
  icon: typeof Pencil;
  bg: string;
  text: string;
  badge: string;
  border: string;
  panel: string;
}> = {
  drawer: {
    label: 'Drawers',
    icon: Pencil,
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    badge: 'bg-blue-50 text-blue-700',
    border: 'border-blue-200',
    panel: 'bg-blue-50/70',
  },
  designer: {
    label: 'Designers',
    icon: Palette,
    bg: 'bg-pink-50',
    text: 'text-pink-700',
    badge: 'bg-pink-50 text-pink-700',
    border: 'border-pink-200',
    panel: 'bg-pink-50/70',
  },
  checker: {
    label: 'Checkers',
    icon: CheckSquare,
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    badge: 'bg-violet-50 text-violet-700',
    border: 'border-violet-200',
    panel: 'bg-violet-50/70',
  },
  qa: {
    label: 'QA',
    icon: Eye,
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    badge: 'bg-emerald-50 text-emerald-700',
    border: 'border-emerald-200',
    panel: 'bg-emerald-50/70',
  },
  filler: {
    label: 'Fillers',
    icon: CheckSquare,
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    badge: 'bg-orange-50 text-orange-700',
    border: 'border-orange-200',
    panel: 'bg-orange-50/70',
  },
};

const teamRoleDisplay = {
  drawer: { title: 'Drawers', memberKey: 'drawers', tone: 'teal' },
  designer: { title: 'Designers', memberKey: 'designers', tone: 'pink' },
  checker: { title: 'Checkers', memberKey: 'checkers', tone: 'violet' },
  qa: { title: 'QA', memberKey: 'qas', tone: 'emerald' },
  filler: { title: 'Fillers', memberKey: 'fillers', tone: 'orange' },
} as const;

function projectTeamRoleKeys(project: { workflow_type?: string; team_statuses?: any[] }) {
  const hasDesigners = project.workflow_type === 'PH_2_LAYER'
    || (project.team_statuses || []).some((team) => Array.isArray(team.designers) && team.designers.length > 0);
  const base = hasDesigners ? ['designer', 'qa'] : ['drawer', 'checker', 'qa'];
  const hasFillers = (project.team_statuses || []).some((team) => Array.isArray(team.fillers) && team.fillers.length > 0);

  return hasFillers ? [...base, 'filler'] : base;
}

function roleSectionTone(tone: string) {
  if (tone === 'pink') return 'border-pink-100 bg-pink-50 text-pink-700';
  if (tone === 'violet') return 'border-violet-100 bg-violet-50 text-violet-700';
  if (tone === 'emerald') return 'border-emerald-100 bg-emerald-50 text-emerald-700';
  if (tone === 'orange') return 'border-orange-100 bg-orange-50 text-orange-700';
  return 'border-teal-100 bg-teal-50 text-teal-700';
}

const DEFAULT_PROJECT_TIMEZONE = 'Asia/Karachi';
const RECEIVED_DATE_PROJECT_IDS = new Set([22, 23, 25, 26, 52]);

function resolveProjectTimezone(project?: ProjectOption | null) {
  const timezone = String(project?.timezone || '').trim();
  if (!timezone) return DEFAULT_PROJECT_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_PROJECT_TIMEZONE;
  }
}

function toDateTimeInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return value.year + '-' + value.month + '-' + value.day + 'T' + value.hour + ':' + value.minute;
}

function projectTimezoneRange(timezone: string) {
  const now = new Date();
  const endAt = toDateTimeInTimezone(now, timezone);

  return {
    startAt: endAt.slice(0, 10) + 'T00:00',
    endAt,
  };
}

function apiDateTime(value: string) {
  return value.replace('T', ' ');
}

function fullDayRange(date: string) {
  return {
    startAt: date + 'T00:00',
    endAt: date + 'T23:59',
  };
}

function normalizeReport(payload: Partial<TimeWiseCountData> | null | undefined): TimeWiseCountData {
  const summary = Array.isArray(payload?.summary) ? payload.summary : [];
  const workers = Array.isArray(payload?.workers)
    ? payload.workers.map((worker) => ({
      ...worker,
      projects: Array.isArray(worker?.projects) ? worker.projects : [],
    }))
    : [];
  const teamStatuses = Array.isArray(payload?.team_statuses) ? payload.team_statuses : [];
  const projectStatuses = Array.isArray(payload?.project_statuses)
    ? payload.project_statuses.map((project) => ({
      ...project,
      team_statuses: Array.isArray(project?.team_statuses) ? project.team_statuses : [],
    }))
    : [];

  return {
    start_at: payload?.start_at || '',
    end_at: payload?.end_at || '',
    timezone: payload?.timezone || 'Asia/Karachi',
    projects: Array.isArray(payload?.projects) ? payload.projects : [],
    summary,
    workers,
    project_statuses: projectStatuses,
    team_statuses: teamStatuses,
    totals: {
      done: Number(payload?.totals?.done ?? summary.reduce((total, item) => total + Number(item?.done || 0), 0)),
      wip: Number(payload?.totals?.wip ?? summary.reduce((total, item) => total + Number(item?.wip || 0), 0)),
      image_count: Number(payload?.totals?.image_count ?? summary.reduce((total, item) => total + Number(item?.image_count || 0), 0)),
      received: Number(payload?.totals?.received ?? teamStatuses.reduce((total, item) => total + Number(item?.received || 0), 0)),
      pending: Number(payload?.totals?.pending ?? teamStatuses.reduce((total, item) => total + Number(item?.pending || 0), 0)),
      delayed: Number(payload?.totals?.delayed ?? teamStatuses.reduce((total, item) => total + Number(item?.delayed || 0), 0)),
    },
  };
}

export default function TimeWiseCountView({ projects = [], dashboard }: TimeWiseCountViewProps) {
  const initialRange = projectTimezoneRange(DEFAULT_PROJECT_TIMEZONE);
  const [startAt, setStartAt] = useState(initialRange.startAt);
  const [endAt, setEndAt] = useState(initialRange.endAt);
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<TimeWiseCountData | null>(null);
  const [statusData, setStatusData] = useState<TimeWiseCountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [openStatusProjectId, setOpenStatusProjectId] = useState<number | null>(null);
  const [openStatusTeamKey, setOpenStatusTeamKey] = useState<string | null>(null);
  const selectedProject = useMemo(
    () => (projects || []).find((project) => String(project.id) === projectId) || null,
    [projectId, projects]
  );
  const selectedTimezone = resolveProjectTimezone(selectedProject);
  const usesReceivedDate = selectedProject ? RECEIVED_DATE_PROJECT_IDS.has(Number(selectedProject.id)) : false;

  useEffect(() => {
    const nextRange = projectTimezoneRange(selectedTimezone);
    const resolvedRange = usesReceivedDate
      ? fullDayRange(nextRange.startAt.slice(0, 10))
      : nextRange;
    setStartAt(resolvedRange.startAt);
    setEndAt(resolvedRange.endAt);
    setData(null);
    setStatusData(null);
    setOpenStatusProjectId(null);
    setOpenStatusTeamKey(null);
  }, [selectedTimezone, usesReceivedDate]);

  useEffect(() => {
    setData(null);
    setStatusData(null);
    setError('');
    setStatusError('');
    setOpenStatusProjectId(null);
    setOpenStatusTeamKey(null);
  }, [projectId]);

  const generateReport = async () => {
    if (!startAt || !endAt) {
      setError(usesReceivedDate ? 'Select a date.' : 'Select both start and end date-time values.');
      return;
    }
    if (new Date(startAt) > new Date(endAt)) {
      setError('Start date-time must be before the end date-time.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const requestRange = usesReceivedDate
        ? fullDayRange(startAt.slice(0, 10))
        : { startAt, endAt };
      const response = await dashboardService.timeWiseCounts(
        dashboard,
        {
          start_at: apiDateTime(requestRange.startAt),
          end_at: apiDateTime(requestRange.endAt),
          ...(projectId ? { project_id: Number(projectId) } : {}),
        }
      );

      const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
      if (typeof response.data === 'string' || contentType.includes('text/html')) {
        throw new Error('The dashboard API is not reaching Laravel.');
      }

      setData(normalizeReport(response.data));
    } catch (requestError: any) {
      setData(null);
      setError(
        requestError?.response?.data?.message
        || requestError?.message
        || 'Unable to generate the time-wise report.'
      );
    } finally {
      setLoading(false);
    }
  };

  const fetchTeamStatus = async () => {
    if (!startAt || !endAt) {
      setStatusError(usesReceivedDate ? 'Select a date.' : 'Select both start and end date-time values.');
      return;
    }
    if (new Date(startAt) > new Date(endAt)) {
      setStatusError('Start date-time must be before the end date-time.');
      return;
    }

    try {
      setStatusLoading(true);
      setStatusError('');
      const requestRange = usesReceivedDate
        ? fullDayRange(startAt.slice(0, 10))
        : { startAt, endAt };
      const response = await dashboardService.timeWiseCounts(
        dashboard,
        {
          start_at: apiDateTime(requestRange.startAt),
          end_at: apiDateTime(requestRange.endAt),
          ...(projectId ? { project_id: Number(projectId) } : {}),
          status_only: 1,
        }
      );

      const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
      if (typeof response.data === 'string' || contentType.includes('text/html')) {
        throw new Error('The dashboard API is not reaching Laravel.');
      }

      const normalized = normalizeReport(response.data);
      setStatusData(normalized);
      setOpenStatusProjectId(normalized.project_statuses?.[0]?.project_id ?? null);
      setOpenStatusTeamKey(null);
    } catch (requestError: any) {
      setStatusData(null);
      setStatusError(
        requestError?.response?.data?.message
        || requestError?.message
        || 'Unable to generate the team status report.'
      );
    } finally {
      setStatusLoading(false);
    }
  };

  const filteredWorkers = (data?.workers || []).filter((worker) => {
    const meta = roleMeta[worker.role];
    const searchValue = search.trim().toLowerCase();

    return String(worker.worker_name || '').toLowerCase().includes(searchValue)
    || String(meta?.label || worker.role || '').toLowerCase().includes(searchValue)
    || (worker.projects || []).some((project) =>
      String(project.project_name || '').toLowerCase().includes(searchValue)
    )
  });

  const visibleRoles = (data?.summary || []).filter((item) => {
    const hasFloorPlan = data?.projects?.some((project) => project.workflow_type !== 'PH_2_LAYER');
    const hasPhotos = data?.projects?.some((project) => project.workflow_type === 'PH_2_LAYER');

    if (item.role === 'designer') return hasPhotos || item.workers > 0;
    if (item.role === 'drawer' || item.role === 'checker') return hasFloorPlan || item.workers > 0;
    return true;
  });
  const projectStatuses = (statusData?.project_statuses || []).filter((project) => (
    !projectId || String(project.project_id) === projectId
  ));

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
        <div className="flex items-start gap-3 mb-5">
          <div className="p-2.5 rounded-xl bg-brand-50 text-brand-700">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Time-wise production count</h3>
            <p className="text-xs text-slate-500 mt-1">
              {usesReceivedDate
                ? 'Designer and QA counts use the selected received date for this project.'
                : "Done counts use each layer's completion time. WIP shows current incomplete assigned work."}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
          {usesReceivedDate ? (
            <label className="block sm:col-span-2">
              <span className="block text-xs font-medium text-slate-600 mb-1.5">Date</span>
              <input
                type="date"
                value={startAt.slice(0, 10)}
                onChange={(event) => {
                  const nextRange = fullDayRange(event.target.value);
                  setStartAt(nextRange.startAt);
                  setEndAt(nextRange.endAt);
                }}
                className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          ) : (
            <>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1.5">From date & time</span>
                <input
                  type="datetime-local"
                  value={startAt}
                  onChange={(event) => setStartAt(event.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1.5">To date & time</span>
                <input
                  type="datetime-local"
                  value={endAt}
                  onChange={(event) => setEndAt(event.target.value)}
                  className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              </label>
            </>
          )}
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1.5">Project</span>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            >
              <option value="">All managed projects</option>
              {(projects || []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} - {project.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="button"
              onClick={generateReport}
              disabled={loading}
              className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TimerReset className="h-4 w-4" />}
              {loading ? 'Generating...' : 'Generate result'}
            </button>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={fetchTeamStatus}
              disabled={statusLoading}
              className="w-full h-10 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {statusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
              {statusLoading ? 'Fetching...' : 'Fetch team status'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}
        {statusError && (
          <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {statusError}
          </div>
        )}
      </div>

      {statusData && (
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-4">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Project status report</h4>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Separate OM/PM report for assigned projects. Project rows follow the project status layout and selected date-time range.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                <span className="rounded-md bg-slate-50 px-2 py-1 text-slate-700 ring-1 ring-slate-100">
                  {statusData.totals.received || 0} received
                </span>
                <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 ring-1 ring-emerald-100">
                  {statusData.totals.done || 0} done
                </span>
                <span className="rounded-md bg-amber-50 px-2 py-1 text-amber-700 ring-1 ring-amber-100">
                  {statusData.totals.pending || 0} pending
                </span>
              </div>
            </div>
            {projectStatuses.length === 0 ? (
              <div className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
                No project status found for this date-time range.
              </div>
            ) : (
              <div className="overflow-x-auto custom-scrollbar">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr className="border-y border-slate-100 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                      <th className="px-3 py-2 font-semibold">Project</th>
                      <th className="px-3 py-2 text-right font-semibold">Received</th>
                      <th className="px-3 py-2 text-right font-semibold">Pending</th>
                      <th className="px-3 py-2 text-right font-semibold">Delayed Pend.</th>
                      <th className="px-3 py-2 text-right font-semibold">Completed</th>
                      <th className="px-3 py-2 text-right font-semibold">Delayed Done</th>
                      <th className="px-3 py-2 text-right font-semibold">Staff</th>
                      <th className="px-3 py-2 text-right font-semibold">Online</th>
                      <th className="px-3 py-2 text-right font-semibold">Present</th>
                      <th className="px-3 py-2 text-right font-semibold">Absent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectStatuses.map((project) => {
                      const isOpen = openStatusProjectId === project.project_id;
                      const teamRoleKeys = projectTeamRoleKeys(project);
                      const report = project.project_operations_report ?? project.project_3_operations_report;
                      const hourly = report?.hourly_done || [];
                      const pendingDates = (report?.last_10_days_pending || [])
                        .filter((item) => item.date !== report?.previous_pending_summary?.date && Number(item.pending_orders || 0) > 0);
                      const previousPending = Number(report?.previous_pending_summary?.pending_orders || 0) > 0
                        ? report?.previous_pending_summary
                        : null;
                      const maxDone = Math.max(1, ...hourly.map((item) => Number(item.done_orders || 0)));
                      const unassignedSummary = [
                        ['D', Number(project.team_summary?.unassigned_drawers || 0)],
                        ['Des', Number(project.team_summary?.unassigned_designers || 0)],
                        ['C', Number(project.team_summary?.unassigned_checkers || 0)],
                        ['QA', Number(project.team_summary?.unassigned_qas || 0)],
                        ['F', Number(project.team_summary?.unassigned_fillers || 0)],
                      ].filter(([, count]) => Number(count) > 0);

                      return (
                        <Fragment key={project.project_id}>
                          <tr key={project.project_id} className="border-b border-slate-50 hover:bg-slate-50/60">
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => setOpenStatusProjectId(isOpen ? null : project.project_id)}
                                className="inline-flex items-center gap-2 font-semibold text-slate-800"
                              >
                                {isOpen ? <ChevronUp className="h-3.5 w-3.5 text-brand-600" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                                {project.project_name}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-700">{project.received_orders}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-amber-700">{project.pending_orders}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-600">{project.delayed_pending_orders}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">{project.done_orders}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-600">{project.delayed_done_orders}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-600">{project.total_staff}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-teal-700">{project.online_staff}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-600">{project.present_staff}</td>
                            <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-500">{project.absent_staff}</td>
                          </tr>
                          {isOpen && (
                            <tr key={`${project.project_id}-detail`}>
                              <td colSpan={10} className="bg-slate-50/60 px-4 py-4">
                                {report && (
                                  <div className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
                                    <div className="flex flex-col gap-1 border-b border-slate-100 bg-slate-50/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                      <div>
                                        <h5 className="text-sm font-bold text-slate-900">{report.project_name || project.project_name} 24 Hours Report</h5>
                                        <p className="text-[11px] text-slate-500">Done orders by selected-date completed/delivered time, previous-date summary, and last 10 days active pending.</p>
                                      </div>
                                      {report.generated_at && (
                                        <span className="text-[10px] font-medium text-slate-400">Updated {report.generated_at}</span>
                                      )}
                                    </div>
                                    <div className="grid gap-4 p-4 lg:grid-cols-2">
                                      <div>
                                        <div className="mb-2 flex items-center justify-between">
                                          <h6 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Done by time</h6>
                                          <span className="rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-[#0f766e] ring-1 ring-teal-100">
                                            24 hr
                                          </span>
                                        </div>
                                        <div className="grid gap-x-5 gap-y-1.5 sm:grid-cols-2">
                                          {hourly.length > 0 ? hourly.map((item) => (
                                            <div key={`${item.start_at}-${item.end_at}`} className="grid grid-cols-[88px_1fr_38px] items-center gap-2 text-[11px]">
                                              <span className="font-medium text-slate-500">{item.label}</span>
                                              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                                                <div className="h-full rounded-full bg-[#2AA7A0]" style={{ width: `${Math.max(4, (Number(item.done_orders || 0) / maxDone) * 100)}%` }} />
                                              </div>
                                              <span className="text-right font-bold text-slate-700">{Number(item.done_orders || 0)}</span>
                                            </div>
                                          )) : (
                                            <div className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-400">No done orders in last 24 hours.</div>
                                          )}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="mb-2 flex items-center justify-between">
                                          <h6 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Pending by date</h6>
                                          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-100">
                                            Last 10 days
                                          </span>
                                        </div>
                                        {previousPending && (
                                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs">
                                            <span className="font-semibold text-slate-700">{previousPending.day_label || 'Previous'}</span>
                                            <div className="flex flex-wrap items-center gap-1.5">
                                              <span className="rounded-md bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-slate-100">
                                                Received {Number(previousPending.total_orders || 0)}
                                              </span>
                                              <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100">
                                                Pending {Number(previousPending.pending_orders || 0)}
                                              </span>
                                              <span className="rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-[#0f766e] ring-1 ring-teal-100">
                                                Done {Number(previousPending.done_orders || 0)}
                                              </span>
                                              {Number(previousPending.delayed_orders || 0) > 0 && (
                                                <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100">
                                                  Delay {Number(previousPending.delayed_orders || 0)}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                        <div className="space-y-1.5">
                                          {pendingDates.length > 0 ? pendingDates.map((item) => (
                                            <div key={item.date || item.day_label} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2 text-xs">
                                              <span className="font-semibold text-slate-700">{item.day_label}</span>
                                              <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="rounded-md bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-slate-100">
                                                  Received {Number(item.total_orders || 0)}
                                                </span>
                                                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100">
                                                  Pending {Number(item.pending_orders || 0)}
                                                </span>
                                                <span className="rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-[#0f766e] ring-1 ring-teal-100">
                                                  Done {Number(item.done_orders || 0)}
                                                </span>
                                                {Number(item.delayed_orders || 0) > 0 && (
                                                  <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-100">
                                                    Delay {Number(item.delayed_orders || 0)}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          )) : (
                                            <div className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-400">No active pending orders in the last 10 days.</div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                <div className="rounded-xl border border-slate-200 bg-white">
                                  <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                                    <h5 className="text-sm font-bold text-slate-900">{project.project_name} Team Status</h5>
                                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                      <span className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-800">
                                        Total Teams {Number(project.team_summary?.total_teams || 0)}
                                      </span>
                                      <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 font-bold text-emerald-700">
                                        Online Teams {Number(project.team_summary?.online_teams || 0)}
                                      </span>
                                      <span className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 font-bold text-slate-600">
                                        Offline Teams {Number(project.team_summary?.offline_teams || 0)}
                                      </span>
                                      <span className="rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-1 font-bold text-amber-700">
                                        Unassigned {Number(project.team_summary?.unassigned || 0)}
                                        {unassignedSummary.length > 0 && (
                                          <span className="ml-1 text-[10px] font-semibold text-amber-600">
                                            {unassignedSummary.map(([label, count]) => `${label} ${count}`).join(' / ')}
                                          </span>
                                        )}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="min-w-full text-xs">
                                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-400">
                                        <tr>
                                          <th className="px-3 py-2 text-left">Team</th>
                                          <th className="px-3 py-2 text-left">Status</th>
                                          <th className="px-3 py-2 text-right">Received</th>
                                          <th className="px-3 py-2 text-right">Done</th>
                                          <th className="px-3 py-2 text-right">Pending</th>
                                          <th className="px-3 py-2 text-right">Delayed</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {project.team_statuses.map((team) => {
                                          const teamKey = `${project.project_id}-${team.team_id ?? 'unassigned'}`;
                                          const isTeamOpen = openStatusTeamKey === teamKey;

                                          return (
                                            <Fragment key={teamKey}>
                                              <tr className="border-t border-slate-50">
                                                <td className="px-3 py-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => setOpenStatusTeamKey(isTeamOpen ? null : teamKey)}
                                                    className="inline-flex items-center gap-2 font-semibold text-slate-700 hover:text-brand-700"
                                                  >
                                                    {isTeamOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                                    {team.team_name}
                                                  </button>
                                                </td>
                                                <td className="px-3 py-2">
                                                  {team.team_id ? (
                                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${team.is_online ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                      {team.is_online ? 'Online' : 'Offline'}
                                                    </span>
                                                  ) : (
                                                    <span className="text-[10px] font-semibold text-slate-400">-</span>
                                                  )}
                                                </td>
                                                <td className="px-3 py-2 text-right font-semibold text-slate-700">{team.received}</td>
                                                <td className="px-3 py-2 text-right font-semibold text-emerald-700">{team.done}</td>
                                                <td className="px-3 py-2 text-right font-semibold text-amber-700">{team.pending}</td>
                                                <td className="px-3 py-2 text-right font-semibold text-rose-600">{team.delayed}</td>
                                              </tr>
                                              {isTeamOpen && (
                                                <tr className="border-t border-slate-100 bg-slate-50/60">
                                                  <td colSpan={6} className="px-3 py-3">
                                                    <div className="grid gap-3 lg:grid-cols-2">
                                                      {teamRoleKeys.map((roleKey) => {
                                                        const roleDisplay = teamRoleDisplay[roleKey as keyof typeof teamRoleDisplay];
                                                        const people = Array.isArray((team as any)[roleDisplay.memberKey])
                                                          ? (team as any)[roleDisplay.memberKey]
                                                          : [];

                                                        return (
                                                        <div key={roleKey} className="rounded-lg border border-slate-200 bg-white">
                                                          <div className={`flex items-center justify-between border-b px-3 py-2 text-[11px] font-bold uppercase tracking-wide ${roleSectionTone(roleDisplay.tone)}`}>
                                                            <span>{roleDisplay.title} - {people.length}</span>
                                                            <span>
                                                              {people.reduce((total: number, person: any) => total + Number(person.total_done || 0), 0)} done
                                                            </span>
                                                          </div>
                                                          {people.length === 0 ? (
                                                            <div className="px-3 py-4 text-center text-[11px] font-medium text-slate-400">No members found</div>
                                                          ) : (
                                                            <div className="divide-y divide-slate-100">
                                                              {people.map((person: any) => (
                                                                <div key={`${roleKey}-${person.id}`} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2 text-[11px]">
                                                                  <div className="min-w-0">
                                                                    <div className="truncate font-semibold text-slate-700">{person.name}</div>
                                                                    <div className={person.is_online ? 'text-emerald-600' : 'text-slate-400'}>
                                                                      {person.is_online ? 'Online' : 'Offline'}
                                                                    </div>
                                                                  </div>
                                                                  <span className="rounded-md bg-slate-50 px-2 py-1 font-semibold text-slate-600">
                                                                    {Number(person.total_assigned || 0)} assign
                                                                  </span>
                                                                  <span className="rounded-md bg-emerald-50 px-2 py-1 font-bold text-emerald-700">
                                                                    {Number(person.total_done || 0)} done
                                                                  </span>
                                                                  <span className="rounded-md bg-slate-50 px-2 py-1 font-semibold text-slate-500">
                                                                    {Number(person.selected_wip ?? person.wip ?? 0)} wip
                                                                  </span>
                                                                </div>
                                                              ))}
                                                            </div>
                                                          )}
                                                        </div>
                                                        );
                                                      })}
                                                    </div>
                                                  </td>
                                                </tr>
                                              )}
                                            </Fragment>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {data && (
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Production breakdown</h3>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {data.projects.length === 1 ? data.projects[0].name : `${data.projects.length} projects`}
                </p>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span className="rounded-md bg-emerald-50 px-2 py-1 font-semibold text-emerald-700">
                  {data.totals.done} done
                </span>
                <span className="rounded-md bg-amber-50 px-2 py-1 font-semibold text-amber-700">
                  {data.totals.wip} WIP
                </span>
                <span className="text-slate-400">{data.workers.length} staff</span>
              </div>
            </div>
            <div className="relative sm:w-60">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search staff or project"
                className="h-8 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-[11px] text-slate-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
            </div>
          </div>

          {filteredWorkers.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">No production counts found</p>
              <p className="mt-1 text-xs text-slate-400">Try another date-time range, project, or search.</p>
            </div>
          ) : (
            <div className="overflow-x-auto p-3 custom-scrollbar">
              <div
                className="grid min-w-max gap-3"
                style={{ gridTemplateColumns: `repeat(${Math.max(visibleRoles.length, 1)}, minmax(270px, 1fr))` }}
              >
                {visibleRoles.map((item) => {
                  const meta = roleMeta[item.role];
                  if (!meta) return null;
                  const Icon = meta.icon;
                  const roleImageCount = Number(item.image_count || 0);
                  const showImageCount = roleImageCount > 0 && (item.role === 'designer' || item.role === 'qa');
                  const roleWorkers = filteredWorkers
                    .filter((worker) => worker.role === item.role)
                    .sort((a, b) => b.done - a.done || b.wip - a.wip || a.worker_name.localeCompare(b.worker_name));

                  return (
                    <section
                      key={item.role}
                      className={`flex min-w-[270px] flex-col overflow-hidden rounded-xl border ${meta.border} ${meta.panel}`}
                    >
                      <div className="border-b border-black/[0.05] px-3.5 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Icon className={`h-4 w-4 ${meta.text}`} />
                            <h4 className={`text-[13px] font-bold ${meta.text}`}>{meta.label}</h4>
                            <span className="text-[10px] font-medium text-slate-400">{item.workers} staff</span>
                            {showImageCount && (
                              <span className="rounded-md bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-black/[0.04]">
                                {roleImageCount} raw images
                              </span>
                            )}
                          </div>
                          <span className={`text-lg font-bold leading-none ${meta.text}`}>{item.done}</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide">
                          <span className="text-slate-400">Staff member</span>
                          <div className="flex w-[86px] justify-between">
                            <span className="text-emerald-600">Done</span>
                            <span className="text-amber-600">WIP</span>
                          </div>
                        </div>
                      </div>

                      <div className="h-[560px] overflow-y-auto px-2 py-1.5 custom-scrollbar">
                        {roleWorkers.length === 0 ? (
                          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-slate-400">
                            No matching staff activity
                          </div>
                        ) : (
                          roleWorkers.map((worker) => {
                            const projectNames = (worker.projects || [])
                              .map((project) => project.project_name)
                              .join(', ');

                            return (
                              <div
                                key={`${worker.role}-${worker.worker_id}`}
                                title={projectNames || undefined}
                                className="group flex min-h-8 items-center justify-between gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-white/70"
                              >
                                <div className="min-w-0">
                                  <div className={`truncate text-[12px] font-medium ${meta.text}`}>
                                    {worker.worker_name || 'Unknown'}
                                  </div>
                                  {Number(worker.image_count || 0) > 0 && (
                                    <div className="mt-0.5 text-[9px] font-semibold text-slate-500">
                                      {Number(worker.image_count || 0)} raw images
                                    </div>
                                  )}
                                  {data.projects.length > 1 && projectNames && (
                                    <div className="mt-0.5 truncate text-[9px] text-slate-400">{projectNames}</div>
                                  )}
                                </div>
                                <div className="flex w-[86px] shrink-0 items-center justify-between text-[11px] font-semibold tabular-nums">
                                  <span className="min-w-8 text-right text-emerald-700">{worker.done}</span>
                                  <span className="min-w-8 text-right text-amber-700">{worker.wip}</span>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div className="flex items-center justify-between border-t border-black/[0.05] px-3.5 py-2 text-[10px] font-semibold">
                        <span className="text-slate-500">{roleWorkers.length} shown</span>
                        <span className="text-amber-700">
                          {showImageCount ? `${roleImageCount} raw images / ` : ''}{item.wip} total WIP
                        </span>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
