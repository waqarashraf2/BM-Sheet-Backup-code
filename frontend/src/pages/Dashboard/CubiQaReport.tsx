import { useEffect, useRef, useState } from 'react';
import { Download, Copy, Check, Loader2, Image as ImageIcon } from 'lucide-react';
import { toJpeg, toBlob } from 'html-to-image';
import html2canvas from 'html2canvas';
import { dashboardService } from '../../services';
import type { CubiQaReportResponse } from '../../services';

type CubiQaReportProps = {
  date?: string;
  startDate?: string;
  endDate?: string;
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

export default function CubiQaReport({ date, startDate, endDate }: CubiQaReportProps) {
  const [report, setReport] = useState<CubiQaReportResponse>(emptyReport);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportingJpg, setExportingJpg] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isMounted = true;

    const loadReport = async () => {
      try {
        setLoading(true);
        setError('');
        const params: { date?: string; start_date?: string; end_date?: string } = {};
        if (startDate && endDate) {
          params.start_date = startDate;
          params.end_date = endDate;
        } else if (date) {
          params.date = date;
        }
        const response = await dashboardService.cubiQaReport(params);
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
  }, [date, startDate, endDate]);

  const renderCellWithPercentage = (count: number, totalPlans: number) => {
    if (!count || count <= 0) return '-';
    const pct = totalPlans > 0 ? ((count / totalPlans) * 100).toFixed(1) : '0.0';
    return (
      <div className="flex flex-col items-center justify-center leading-tight">
        <span>{count}</span>
        <span className="text-[9.5px] font-semibold text-slate-700">({pct}%)</span>
      </div>
    );
  };

  const titleDate = (report.selected_date_display || (startDate && endDate && startDate !== endDate ? `${startDate} TO ${endDate}` : date || '')).toUpperCase();

  const handleDownloadJpg = async () => {
    if (!reportRef.current) return;
    try {
      setExportingJpg(true);
      const element = reportRef.current;

      // Primary engine: html-to-image with 3x scale for crystal clear HD rendering (no pixel drop)
      let dataUrl: string;
      try {
        dataUrl = await toJpeg(element, {
          quality: 0.98,
          pixelRatio: 3,
          backgroundColor: '#ffffff',
          cacheBust: true,
          style: {
            margin: '0',
            padding: '16px',
            backgroundColor: '#ffffff',
          },
        });
      } catch (htmlToImgErr) {
        console.warn('html-to-image fallback to html2canvas:', htmlToImgErr);
        const canvas = await html2canvas(element, {
          scale: 3,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });
        dataUrl = canvas.toDataURL('image/jpeg', 0.98);
      }

      const filename = `${titleDate || 'CUBI_QA'}_CUBI_2D_QA_REPORT.jpg`.replace(/\s+/g, '_');
      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export JPG:', err);
      alert('Failed to generate JPG. Please try again.');
    } finally {
      setExportingJpg(false);
    }
  };

  const handleCopyImage = async () => {
    if (!reportRef.current) return;
    try {
      setExportingJpg(true);
      const element = reportRef.current;

      const blob = await toBlob(element, {
        pixelRatio: 3,
        backgroundColor: '#ffffff',
        cacheBust: true,
        style: {
          margin: '0',
          padding: '16px',
          backgroundColor: '#ffffff',
        },
      });

      if (blob && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': blob,
          }),
        ]);
        setCopiedImage(true);
        setTimeout(() => setCopiedImage(false), 2500);
      } else {
        // Fallback to downloading JPG
        await handleDownloadJpg();
      }
    } catch (clipErr) {
      console.error('Clipboard copy failed:', clipErr);
      // Fallback to downloading JPG
      await handleDownloadJpg();
    } finally {
      setExportingJpg(false);
    }
  };

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
    <div className="space-y-3">
      {/* Top Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800">
            <ImageIcon className="h-4 w-4 text-[#2AA7A0]" />
            QA Report Export
          </span>
          <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
            Ultra-HD (No Pixel Drop)
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCopyImage}
            disabled={exportingJpg || report.rows.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
            title="Copy high resolution image to clipboard to paste directly into WhatsApp or Slack"
          >
            {copiedImage ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-emerald-600">Copied to Clipboard!</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5 text-slate-600" />
                <span>Copy Image</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadJpg}
            disabled={exportingJpg || report.rows.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-[#2AA7A0] px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-[#238f89] disabled:opacity-50"
          >
            {exportingJpg ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Generating JPG...</span>
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" />
                <span>Download JPG</span>
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </div>
      )}

      {/* Capture Section with ref */}
      <div
        ref={reportRef}
        data-report-capture="true"
        className="space-y-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm"
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[11px] text-slate-950">
            <thead>
              <tr>
                <th colSpan={7} className="border border-slate-500 bg-neutral-500 px-2 py-1.5 text-center text-base font-black text-black tracking-wide">
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
                  <td className="border border-slate-400 px-2 py-1 text-center font-semibold">{row.total_plans}</td>
                  <td className="border border-slate-400 px-2 py-1 text-center">{renderCellWithPercentage(row.bw, row.total_plans)}</td>
                  <td className="border border-slate-400 px-2 py-1 text-center">{renderCellWithPercentage(row.bugs, row.total_plans)}</td>
                  <td className="border border-slate-400 px-2 py-1 text-center">{renderCellWithPercentage(row.mb, row.total_plans)}</td>
                  <td className="border border-slate-400 px-2 py-1 text-center">{renderCellWithPercentage(row.ok, row.total_plans)}</td>
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
                <td className="border border-slate-500 px-2 py-1 text-center font-bold">{report.totals.total_plans}</td>
                <td className="border border-slate-500 px-2 py-1 text-center">{renderCellWithPercentage(report.totals.bw, report.totals.total_plans)}</td>
                <td className="border border-slate-500 px-2 py-1 text-center">{renderCellWithPercentage(report.totals.bugs, report.totals.total_plans)}</td>
                <td className="border border-slate-500 px-2 py-1 text-center">{renderCellWithPercentage(report.totals.mb, report.totals.total_plans)}</td>
                <td className="border border-slate-500 px-2 py-1 text-center">{renderCellWithPercentage(report.totals.ok, report.totals.total_plans)}</td>
                <td className="border border-slate-500 px-2 py-1" />
              </tr>
              <tr>
                <td className="border border-slate-500 bg-neutral-500 px-2 py-1 text-center font-bold text-black">Percentage</td>
                <td className="border border-slate-400 px-2 py-1 text-center font-bold">{report.percentages.total_plans.toFixed(1)}%</td>
                <td className="border border-slate-400 px-2 py-1 text-center font-bold">{report.percentages.bw.toFixed(1)}%</td>
                <td className="border border-slate-400 px-2 py-1 text-center font-bold">{report.percentages.bugs.toFixed(1)}%</td>
                <td className="border border-slate-400 px-2 py-1 text-center font-bold">{report.percentages.mb.toFixed(1)}%</td>
                <td className="border border-slate-400 px-2 py-1 text-center font-bold">{report.percentages.ok.toFixed(1)}%</td>
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
                <td className="border border-slate-400 px-2 py-1 text-center font-semibold">{report.upload_summary.total_plans}</td>
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
                  <td className="border border-slate-400 px-2 py-1 text-center font-semibold">{qa.count}</td>
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
    </div>
  );
}
