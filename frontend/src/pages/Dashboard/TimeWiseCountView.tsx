import { useState } from 'react';
import {
  CalendarClock, CheckSquare, Eye, Loader2, Palette, Pencil,
  Search, TimerReset,
} from 'lucide-react';
import { dashboardService } from '../../services';
import type { TimeWiseCountData, TimeWiseCountSummary } from '../../types';

interface ProjectOption {
  id: number;
  code: string;
  name: string;
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
}> = {
  drawer: {
    label: 'Drawers',
    icon: Pencil,
    bg: 'bg-blue-50',
    text: 'text-blue-700',
    badge: 'bg-blue-50 text-blue-700',
  },
  designer: {
    label: 'Designers',
    icon: Palette,
    bg: 'bg-pink-50',
    text: 'text-pink-700',
    badge: 'bg-pink-50 text-pink-700',
  },
  checker: {
    label: 'Checkers',
    icon: CheckSquare,
    bg: 'bg-violet-50',
    text: 'text-violet-700',
    badge: 'bg-violet-50 text-violet-700',
  },
  qa: {
    label: 'QA',
    icon: Eye,
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    badge: 'bg-emerald-50 text-emerald-700',
  },
};

function toDateTimeLocal(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function apiDateTime(value: string) {
  return value.replace('T', ' ');
}

function normalizeReport(payload: Partial<TimeWiseCountData> | null | undefined): TimeWiseCountData {
  const summary = Array.isArray(payload?.summary) ? payload.summary : [];
  const workers = Array.isArray(payload?.workers)
    ? payload.workers.map((worker) => ({
      ...worker,
      projects: Array.isArray(worker?.projects) ? worker.projects : [],
    }))
    : [];

  return {
    start_at: payload?.start_at || '',
    end_at: payload?.end_at || '',
    timezone: payload?.timezone || 'Asia/Karachi',
    projects: Array.isArray(payload?.projects) ? payload.projects : [],
    summary,
    workers,
    totals: {
      done: Number(payload?.totals?.done ?? summary.reduce((total, item) => total + Number(item?.done || 0), 0)),
      wip: Number(payload?.totals?.wip ?? summary.reduce((total, item) => total + Number(item?.wip || 0), 0)),
    },
  };
}

export default function TimeWiseCountView({ projects = [], dashboard }: TimeWiseCountViewProps) {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [startAt, setStartAt] = useState(toDateTimeLocal(todayStart));
  const [endAt, setEndAt] = useState(toDateTimeLocal(now));
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<TimeWiseCountData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateReport = async () => {
    if (!startAt || !endAt) {
      setError('Select both start and end date-time values.');
      return;
    }
    if (new Date(startAt) > new Date(endAt)) {
      setError('Start date-time must be before the end date-time.');
      return;
    }

    try {
      setLoading(true);
      setError('');
      const response = await dashboardService.timeWiseCounts(
        dashboard,
        {
          start_at: apiDateTime(startAt),
          end_at: apiDateTime(endAt),
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

  const filteredWorkers = (data?.workers || []).filter((worker) => {
    const meta = roleMeta[worker.role];
    const searchValue = search.trim().toLowerCase();

    return String(worker.worker_name || '').toLowerCase().includes(searchValue)
    || String(meta?.label || worker.role || '').toLowerCase().includes(searchValue)
    || (worker.projects || []).some((project) =>
      String(project.project_name || '').toLowerCase().includes(searchValue)
    )
  });

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
              Done counts use each layer's completion time. WIP shows current incomplete assigned work.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
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
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {error}
          </div>
        )}
      </div>

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {(data.summary || []).map((item) => {
              const meta = roleMeta[item.role];
              if (!meta) return null;
              const Icon = meta.icon;
              return (
                <div key={item.role} className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2.5">
                      <div className={`p-2 rounded-lg ${meta.bg}`}>
                        <Icon className={`h-4 w-4 ${meta.text}`} />
                      </div>
                      <span className="text-sm font-semibold text-slate-900">{meta.label}</span>
                    </div>
                    <span className="text-[11px] font-medium text-slate-400">{item.workers} staff</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-emerald-50 p-3">
                      <div className="text-xl font-bold text-emerald-700">{item.done}</div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">Done</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 p-3">
                      <div className="text-xl font-bold text-amber-700">{item.wip}</div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">Current WIP</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Staff breakdown</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {data.totals.done} done in range, {data.totals.wip} current WIP
                </p>
              </div>
              <div className="relative sm:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search staff or project"
                  className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
                />
              </div>
            </div>

            {filteredWorkers.length === 0 ? (
              <div className="px-5 py-14 text-center">
                <CalendarClock className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-600">No production counts found</p>
                <p className="mt-1 text-xs text-slate-400">Try another date-time range or project.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-slate-50/80">
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3">Staff</th>
                      <th className="px-5 py-3">Role</th>
                      <th className="px-5 py-3">Projects</th>
                      <th className="px-5 py-3 text-center">Done</th>
                      <th className="px-5 py-3 text-center">WIP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredWorkers.map((worker) => {
                      const meta = roleMeta[worker.role];
                      if (!meta) return null;
                      return (
                        <tr key={`${worker.role}-${worker.worker_id}`} className="text-sm hover:bg-slate-50/60">
                          <td className="px-5 py-3.5 font-medium text-slate-900">{worker.worker_name}</td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.badge}`}>
                              {meta.label.replace(/s$/, '')}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-xs text-slate-500">
                            {(worker.projects || []).map((project) => project.project_name).join(', ') || 'No project details'}
                          </td>
                          <td className="px-5 py-3.5 text-center font-bold text-emerald-700">{worker.done}</td>
                          <td className="px-5 py-3.5 text-center font-bold text-amber-700">{worker.wip}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
