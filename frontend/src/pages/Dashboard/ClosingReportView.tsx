import React, { useEffect, useMemo, useState } from 'react';
import { CalendarDays, RefreshCw, Save, Search } from 'lucide-react';
import { dashboardService } from '../../services';
import type { ClosingReportData, ClosingReportProjectRow } from '../../types';

const today = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

type ClosingReportViewProps = {
  canEditRemarks?: boolean;
};

const departmentLabel = (department: string) => {
  if (department === 'floor_plan') return 'Floor Plan';
  if (department === 'photos_enhancement') return 'Photos Enhancement';
  return department.replace(/_/g, ' ');
};

export default function ClosingReportView({ canEditRemarks = true }: ClosingReportViewProps) {
  const [reportDate, setReportDate] = useState(today());
  const [countryFilter, setCountryFilter] = useState('');
  const [data, setData] = useState<ClosingReportData | null>(null);
  const [remarks, setRemarks] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const loadReport = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await dashboardService.closingReport({
        date: reportDate,
        ...(countryFilter ? { country: countryFilter } : {}),
      });
      setData(response.data);
      const nextRemarks: Record<number, string> = {};
      response.data.countries.forEach((country) => {
        country.projects.forEach((project) => {
          nextRemarks[project.project_id] = project.remarks || '';
        });
      });
      setRemarks(nextRemarks);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to load closing report.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate, countryFilter]);

  const countryOptions = useMemo(() => {
    if (!data) return [];
    return data.countries.map((item) => item.country).sort();
  }, [data]);

  const reportSections = useMemo(() => {
    if (!data) return [];

    return data.countries.flatMap((country) => {
      const groups = country.projects.reduce<Record<string, ClosingReportProjectRow[]>>((carry, project) => {
        const key = project.department || 'unknown';
        carry[key] = carry[key] || [];
        carry[key].push(project);
        return carry;
      }, {});

      return Object.entries(groups).map(([department, projects]) => ({
        key: `${country.country}-${department}`,
        country: country.country,
        department,
        title: `${country.country} ${departmentLabel(department)} Closing Report`,
        total_orders: projects.reduce((sum, project) => sum + project.total_orders, 0),
        uploaded_orders: projects.reduce((sum, project) => sum + project.uploaded_orders, 0),
        pending_orders: projects.reduce((sum, project) => sum + project.pending_orders, 0),
        projects,
      }));
    });
  }, [data]);

  const saveRemark = async (project: ClosingReportProjectRow) => {
    try {
      setSavingId(project.project_id);
      setError('');
      await dashboardService.saveClosingReportRemark({
        date: data?.date || reportDate,
        country: project.country,
        project_id: project.project_id,
        remarks: remarks[project.project_id] || '',
      });
      await loadReport();
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to save remarks.');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1">
          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase">Projects</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{data?.totals.project_count ?? 0}</div>
          </div>
          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase">Total Orders</div>
            <div className="mt-1 text-2xl font-bold text-blue-600">{data?.totals.total_orders ?? 0}</div>
          </div>
          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase">Uploaded</div>
            <div className="mt-1 text-2xl font-bold text-emerald-600">{data?.totals.uploaded_orders ?? 0}</div>
          </div>
          <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
            <div className="text-xs font-semibold text-slate-500 uppercase">Pending</div>
            <div className="mt-1 text-2xl font-bold text-amber-600">{data?.totals.pending_orders ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Closing Report</h3>
            <p className="text-xs text-slate-500 mt-0.5">Country-wise received, uploaded, pending, and remarks.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="relative">
              <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="date"
                value={reportDate}
                onChange={(event) => setReportDate(event.target.value)}
                className="w-full sm:w-44 pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
              />
            </label>
            <label className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <select
                value={countryFilter}
                onChange={(event) => setCountryFilter(event.target.value)}
                className="w-full sm:w-44 pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none bg-white"
              >
                <option value="">All Countries</option>
                {countryOptions.map((country) => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </label>
            <button
              onClick={loadReport}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {error && <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

        <div className="mt-4 overflow-x-auto border border-slate-100 rounded-lg">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="bg-slate-100 text-xs text-slate-600 uppercase">
                <th className="px-3 py-3 text-left">Project Name</th>
                <th className="px-3 py-3 text-left">Country</th>
                <th className="px-3 py-3 text-center">Total Orders</th>
                <th className="px-3 py-3 text-center">Uploaded Orders</th>
                <th className="px-3 py-3 text-center">Pending</th>
                <th className="px-3 py-3 text-left">Remarks</th>
                {canEditRemarks && <th className="px-3 py-3 text-center">Save</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && (
                <tr>
                  <td colSpan={canEditRemarks ? 7 : 6} className="px-3 py-8 text-center text-slate-500">Loading closing report...</td>
                </tr>
              )}
              {!loading && reportSections.map((section) => (
                <React.Fragment key={section.key}>
                  <tr className="bg-slate-50">
                    <td className="px-3 py-2 font-semibold text-slate-900">{section.title}</td>
                    <td className="px-3 py-2 text-slate-500">{section.projects.length} projects</td>
                    <td className="px-3 py-2 text-center font-semibold text-blue-600">{section.total_orders}</td>
                    <td className="px-3 py-2 text-center font-semibold text-emerald-600">{section.uploaded_orders}</td>
                    <td className="px-3 py-2 text-center font-semibold text-amber-600">{section.pending_orders}</td>
                    <td className="px-3 py-2 text-slate-400">{departmentLabel(section.department)} total</td>
                    {canEditRemarks && <td className="px-3 py-2" />}
                  </tr>
                  {section.projects.map((project) => (
                    <tr key={project.project_id} className="hover:bg-slate-50/70">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{project.project_name}</div>
                        <div className="text-xs text-slate-400">{project.project_code}</div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{project.country}</td>
                      <td className="px-3 py-2 text-center font-semibold text-slate-900">{project.total_orders}</td>
                      <td className="px-3 py-2 text-center font-semibold text-emerald-600">{project.uploaded_orders}</td>
                      <td className="px-3 py-2 text-center font-semibold text-amber-600">{project.pending_orders}</td>
                      <td className="px-3 py-2">
                        {canEditRemarks ? (
                          <textarea
                            value={remarks[project.project_id] ?? ''}
                            onChange={(event) => setRemarks((current) => ({ ...current, [project.project_id]: event.target.value }))}
                            rows={2}
                            maxLength={2000}
                            placeholder="Add remarks"
                            className="w-full min-w-[260px] resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                          />
                        ) : (
                          <div className="min-w-[260px] text-sm text-slate-700">
                            {project.remarks?.trim() || '---'}
                          </div>
                        )}
                      </td>
                      {canEditRemarks && (
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => saveRemark(project)}
                            disabled={savingId === project.project_id}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60"
                            title="Save remarks"
                          >
                            <Save className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {!loading && reportSections.length === 0 && (
                <tr>
                  <td colSpan={canEditRemarks ? 7 : 6} className="px-3 py-8 text-center text-slate-500">No closing report data found for this date.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
