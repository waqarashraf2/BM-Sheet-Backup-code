import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { dashboardService } from '../../services';
import type { CubiQaReportResponse } from '../../services';

type CubiQaReportProps = {
  date: string;
};

const emptyReport: CubiQaReportResponse = {
  success: true,
  project_id: 16,
  selected_date: '',
  selected_date_display: '',
  start_time: '',
  end_time: '',
  rows: [],
  totals: { total_plans: 0, bw: 0, bugs: 0, mb: 0, ok: 0 },
  percentages: { total_plans: 0, bw: 0, bugs: 0, mb: 0, ok: 0 },
  upload_summary: { date: '', total_plans: 0, upload: 0, pending: 0 },
  qa_counts: [],
};

export default function CubiQaReport({ date }: CubiQaReportProps) {
  const [report, setReport] = useState<CubiQaReportResponse>(emptyReport);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    const loadReport = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await dashboardService.cubiQaReport({ date });
        if (!isMounted) return;
        setReport(response.data);
      } catch (err) {
        console.error('Cubi QA Report Error:', err);
        if (isMounted) {
          setError('Unable to load Cubi QA report.');
          setReport(emptyReport);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadReport();

    return () => {
      isMounted = false;
    };
  }, [date]);

  const formatCount = (value: number) => (value > 0 ? value : '-');
  const titleDate = (report.selected_date_display || date).toUpperCase();

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-center gap-2 text-xs font-semibold text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin text-[#2AA7A0]" />
          Loading Cubi QA report
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      {error && (
        <div className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-[11px] text-slate-950">
          <thead>
            <tr>
              <th colSpan={7} className="border border-slate-500 bg-neutral-500 px-2 py-1 text-center text-base font-black text-black">
                {titleDate} CUBI 2D QA
              </th>
            </tr>
            <tr className="bg-neutral-400 text-[11px] font-bold">
              <th className="border border-slate-500 px-2 py-1 text-left">Checker Names</th>
              <th className="border border-slate-500 px-2 py-1 text-center">Total Plans</th>
              <th className="border border-slate-500 px-2 py-1 text-center">BW</th>
              <th className="border border-slate-500 px-2 py-1 text-center">Bugs</th>
              <th className="border border-slate-500 px-2 py-1 text-center">MB</th>
              <th className="border border-slate-500 px-2 py-1 text-center">OK</th>
              <th className="border border-slate-500 px-2 py-1 text-center">Mistakes Remarks</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.length > 0 ? report.rows.map((row) => (
              <tr key={row.checker_name} className="align-top">
                <td className="border border-slate-400 px-2 py-1 font-medium">{row.checker_name}</td>
                <td className="border border-slate-400 px-2 py-1 text-center">{row.total_plans}</td>
                <td className="border border-slate-400 px-2 py-1 text-center">{formatCount(row.bw)}</td>
                <td className="border border-slate-400 px-2 py-1 text-center">{formatCount(row.bugs)}</td>
                <td className="border border-slate-400 px-2 py-1 text-center">{formatCount(row.mb)}</td>
                <td className="border border-slate-400 px-2 py-1 text-center">{formatCount(row.ok)}</td>
                <td className="border border-slate-400 px-2 py-1 text-center">{row.mistakes_remarks || '-'}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={7} className="border border-slate-400 px-2 py-8 text-center text-xs text-slate-500">
                  No QA submissions found for this date.
                </td>
              </tr>
            )}
            <tr className="bg-neutral-500 font-bold">
              <td className="border border-slate-500 px-2 py-1 text-center text-black">Total</td>
              <td className="border border-slate-500 px-2 py-1 text-center">{report.totals.total_plans}</td>
              <td className="border border-slate-500 px-2 py-1 text-center">{report.totals.bw}</td>
              <td className="border border-slate-500 px-2 py-1 text-center">{report.totals.bugs}</td>
              <td className="border border-slate-500 px-2 py-1 text-center">{report.totals.mb}</td>
              <td className="border border-slate-500 px-2 py-1 text-center">{report.totals.ok}</td>
              <td className="border border-slate-500 px-2 py-1" />
            </tr>
            <tr>
              <td className="border border-slate-500 bg-neutral-500 px-2 py-1 text-center font-bold text-black">Percentage</td>
              <td className="border border-slate-400 px-2 py-1 text-center">{report.percentages.total_plans.toFixed(1)}</td>
              <td className="border border-slate-400 px-2 py-1 text-center">{report.percentages.bw.toFixed(1)}</td>
              <td className="border border-slate-400 px-2 py-1 text-center">{report.percentages.bugs.toFixed(1)}</td>
              <td className="border border-slate-400 px-2 py-1 text-center">{report.percentages.mb.toFixed(1)}</td>
              <td className="border border-slate-400 px-2 py-1 text-center">{report.percentages.ok.toFixed(1)}</td>
              <td className="border border-slate-400 px-2 py-1" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(320px,520px)_minmax(240px,360px)]">
        <table className="w-full border-collapse text-[11px] text-slate-950">
          <thead>
            <tr className="bg-neutral-400 font-bold">
              <th className="border border-slate-500 px-2 py-1 text-center">Date</th>
              <th className="border border-slate-500 px-2 py-1 text-center">Total Plans</th>
              <th className="border border-slate-500 px-2 py-1 text-center">Upload</th>
              <th className="border border-slate-500 px-2 py-1 text-center">Pending</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-slate-400 px-2 py-1 text-center">{report.upload_summary.date || '-'}</td>
              <td className="border border-slate-400 px-2 py-1 text-center">{report.upload_summary.total_plans}</td>
              <td className="border border-slate-400 px-2 py-1 text-center">{report.upload_summary.upload}</td>
              <td className="border border-slate-400 px-2 py-1 text-center">{report.upload_summary.pending}</td>
            </tr>
          </tbody>
        </table>

        <table className="w-full border-collapse text-[11px] text-slate-950">
          <thead>
            <tr className="bg-neutral-400 font-bold">
              <th className="border border-slate-500 px-2 py-1 text-center">QA Names</th>
              <th className="border border-slate-500 px-2 py-1 text-center">Counts</th>
            </tr>
          </thead>
          <tbody>
            {report.qa_counts.length > 0 ? report.qa_counts.map((qa) => (
              <tr key={qa.name}>
                <td className="border border-slate-400 px-2 py-1 text-center">{qa.name}</td>
                <td className="border border-slate-400 px-2 py-1 text-center">{qa.count}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={2} className="border border-slate-400 px-2 py-3 text-center text-slate-500">No QA counts.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
