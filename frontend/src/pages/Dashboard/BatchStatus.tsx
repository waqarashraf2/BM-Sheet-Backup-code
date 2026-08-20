import { useEffect, useRef, useState } from 'react';
import { Download, Copy, Check, Loader2, RotateCw } from 'lucide-react';
import { toJpeg, toBlob } from 'html-to-image';
import html2canvas from 'html2canvas';
import { dashboardService } from '../../services';
import CubiQaReport from './CubiQaReport';

/* ---------------------- Types ---------------------- */

type Batch = {
  batch_no: string;
  received_time: string;
  remaining_time: string; // already "min - max" from API OR single
  plans: number;
  done: number;
  pending: number;
  fixing: number;
};

type Summary = {
  total_batches: number;
  total_plans: number;
  total_done: number;
  total_pending: number;
  total_drawing: number;
  total_untouched: number;
  total_fixing: number;
};

type PlansRemaining = {
  hour: number;
  plans: number;
};

type Hourly = {
  label: string;
  orders: number;
};

type QaWorker = {
  name: string;
  done_count: number;
  wip_count: number;
  total_count: number;
};

type BatchStatusResponse = {
  success: boolean;
  total_orders?: {
    plans: number;
    done: number;
    pending: number;
    drawing_process: number;
    untouched_orders: number;
    sent_to_fixing: number;
  };
  batches?: Batch[];
  plans_remaining?: PlansRemaining[];
  hourly_counts?: Hourly[];
  qa_summary?: {
    total_orders: number;
    total_done: number;
    total_wip: number;
    workers: QaWorker[];
  } | null;
  untouched_min?: Batch;
  fixed_min?: Batch;
};

/* ---------------------- Component ---------------------- */

export default function BatchStatus() {
  const [data, setData] = useState<Batch[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [plansRemaining, setPlansRemaining] = useState<PlansRemaining[]>([]);
  const [hourlyCounts, setHourlyCounts] = useState<Hourly[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingJpg, setExportingJpg] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);
  const batchCardRef = useRef<HTMLDivElement>(null);

  const getTodayInputValue = () => {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());

    const year = parts.find((part) => part.type === 'year')?.value ?? '';
    const month = parts.find((part) => part.type === 'month')?.value ?? '';
    const day = parts.find((part) => part.type === 'day')?.value ?? '';

    return `${year}-${month}-${day}`;
  };

  const [selectedDate, setSelectedDate] = useState<string>(getTodayInputValue());
  const [rawResponse, setRawResponse] = useState<BatchStatusResponse | null>(null);
  const [showCubiQaReport, setShowCubiQaReport] = useState(false);

  /* ---------------------- Fetch Data ---------------------- */

  const fetchData = async (date?: string) => {
    try {
      setLoading(true);

      const res = await dashboardService.batchStatus({
        project_id: 16,
        date,
      });

      const resp: BatchStatusResponse = res.data;

      setRawResponse(resp);

      const totalPlans = resp.total_orders?.plans || 0;
      const totalDone = resp.total_orders?.done || 0;
      const totalPending = resp.total_orders?.pending || 0;
      const totalDrawing = resp.total_orders?.drawing_process || 0;
      const totalUntouched = resp.total_orders?.untouched_orders || 0;
      const totalFixing = resp.total_orders?.sent_to_fixing || 0;

      setData(resp.batches || []);
      setSummary({
        total_batches: resp.batches?.length || 0,
        total_plans: totalPlans,
        total_done: totalDone,
        total_pending: totalPending,
        total_drawing: totalDrawing,
        total_untouched: totalUntouched,
        total_fixing: totalFixing,
      });

      setPlansRemaining(resp.plans_remaining || []);
      setHourlyCounts(resp.hourly_counts || []);
    } catch (err) {
      console.error('Batch Status Error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(selectedDate);
  }, []);

  /* ---------------------- FORMAT REPORT ---------------------- */

  const formatDate = (dateValue?: string) => {
    if (dateValue) {
      const [year, month, day] = dateValue.split('-');

      if (year && month && day) {
        return `${day}-${month}-${year}`;
      }
    }

    const d = new Date();
    return `${d.getDate().toString().padStart(2, '0')}-${(d.getMonth() + 1)
      .toString()
      .padStart(2, '0')}-${d.getFullYear()}`;
  };

  const generateReportText = () => {
    if (!data.length && !hourlyCounts.length && !plansRemaining.length) return '';

    let text = '';

    text += `Cubi 2D\n`;
    text += `${formatDate(selectedDate)}\n\n`;

    data.forEach((batch) => {
      text += `Batch ${batch.batch_no}\n`;
      text += `Received Time: ${batch.received_time}\n`;

      // avoid duplicate like "8h - 8h"
      let remaining = batch.remaining_time;
      if (remaining && remaining.includes('-')) {
        const [min, max] = remaining.split('-').map((s) => s.trim());
        if (min === max) remaining = min;
      }

      text += `Remaining Time: ${remaining}\n`;
      text += `Plans: ${batch.plans}\n`;
      text += `Done: ${batch.done}\n`;

      if (batch.pending > 0) {
        text += `Pending: ${batch.pending}\n`;
      }

      if (batch.fixing > 0) {
        text += `Sent to Fixing: ${batch.fixing}\n`;
      }

      text += `\n`;
    });

    // TOTALS
    text += `Total Orders:\n`;
    text += `Plans: ${summary?.total_plans || 0}\n`;
    text += `Done: ${summary?.total_done || 0}\n`;
    text += `Pending: ${summary?.total_pending || 0}\n\n`;

    text += `Drawing Process : ${rawResponse?.total_orders?.drawing_process || 0}\n`;
    text += `Untouched Orders : ${rawResponse?.total_orders?.untouched_orders || 0}\n`;
    text += `Sent to Fixing : ${summary?.total_fixing || 0}\n\n`;

    // Plans Remaining
    if (plansRemaining.length) {
      text += `Plans Remaining Time\n\n`;
      plansRemaining.forEach((p) => {
        text += `${p.plans} Plans : ${p.hour}h\n`;
      });
      text += `\n`;
    }

    // Hourly Counts
    if (hourlyCounts.length) {
      text += `Hourly Counts\n\n`;
      hourlyCounts.forEach((h) => {
        text += `${h.label} - ${h.orders} Orders\n`;
      });
      text += `\n`;
    }

    const untouchedTopRemaining = rawResponse?.untouched_min?.remaining_time;

    // Top Plans
    if (untouchedTopRemaining) {
      text += `Untouched Top plan\n`;
      text += `Least Remaining Time: ${untouchedTopRemaining}\n\n`;
    }

    if (rawResponse?.fixed_min?.remaining_time) {
      text += `Fixed Order Top plan\n`;
      text += `Least Remaining Time: ${rawResponse.fixed_min.remaining_time}\n`;
    }

    return text;
  };

  /* ---------------------- COPY & EXPORT ---------------------- */

  const copyText = () => {
    const text = generateReportText();
    navigator.clipboard.writeText(text);
    alert('Copied Correct Format ✅');
  };

  const handleDownloadJpg = async () => {
    if (!batchCardRef.current) return;
    try {
      setExportingJpg(true);
      const element = batchCardRef.current;

      let dataUrl: string;
      try {
        dataUrl = await toJpeg(element, {
          quality: 0.98,
          pixelRatio: 3, // Ultra-HD 3x sharp scale (no pixel drop)
          backgroundColor: '#ffffff',
          cacheBust: true,
          style: {
            margin: '0',
            backgroundColor: '#ffffff',
          },
        });
      } catch (err) {
        console.warn('html-to-image fallback to html2canvas:', err);
        const canvas = await html2canvas(element, {
          scale: 3,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });
        dataUrl = canvas.toDataURL('image/jpeg', 0.98);
      }

      const filename = `Cubi_2D_Batch_Status_${formatDate(selectedDate)}.jpg`.replace(/\s+/g, '_');
      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Failed to export batch status JPG:', err);
      alert('Failed to generate JPG. Please try again.');
    } finally {
      setExportingJpg(false);
    }
  };

  const handleCopyImage = async () => {
    if (!batchCardRef.current) return;
    try {
      setExportingJpg(true);
      const element = batchCardRef.current;

      const blob = await toBlob(element, {
        pixelRatio: 3,
        backgroundColor: '#ffffff',
        cacheBust: true,
        style: {
          margin: '0',
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
        await handleDownloadJpg();
      }
    } catch (clipErr) {
      console.error('Clipboard copy failed:', clipErr);
      await handleDownloadJpg();
    } finally {
      setExportingJpg(false);
    }
  };

  /* ---------------------- UI ---------------------- */

  const displayDate = formatDate(selectedDate);
  const totalOrders = rawResponse?.total_orders;
  const qaSummary = rawResponse?.qa_summary;
  const qaWorkers = qaSummary?.workers ?? [];
  const maxHourlyOrders = Math.max(1, ...hourlyCounts.map((item) => Number(item.orders || 0)));
  const hasStatusData = data.length > 0 || hourlyCounts.length > 0 || plansRemaining.length > 0 || Boolean(totalOrders);

  const untouchedTopRemaining = rawResponse?.untouched_min?.remaining_time || '-';
  const topPlans = [
    { label: 'Untouched Top Remaining', value: untouchedTopRemaining },
    { label: 'Fixed Top Remaining', value: rawResponse?.fixed_min?.remaining_time ?? '-' },
  ];

  const normalizeRemainingTime = (value?: string) => {
    if (!value) return '-';
    if (!value.includes('-')) return value;

    const [min, max] = value.split('-').map((part) => part.trim());
    return min === max ? min : value;
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5">
      <div className="mx-auto max-w-7xl space-y-4">
        {/* The Full Batch Status Card */}
        <div
          ref={batchCardRef}
          data-report-capture="true"
          className="rounded-xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
            <div className="shrink-0">
              <h1 className="text-sm font-bold text-slate-950">Cubi 2D Status</h1>
              <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                Batch status for {displayDate}
              </p>
            </div>

            {qaWorkers.length > 0 && (
              <div className="min-w-[260px] flex-1 rounded-lg border border-violet-100 bg-violet-50/40 px-3 py-2">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-violet-700">QA Orders</span>
                  <span className="rounded-md bg-white px-2 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-100">
                    Total QA {qaSummary?.total_done ?? 0}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {qaWorkers.map((worker) => (
                    <span
                      key={`batch-qa-${worker.name}`}
                      className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-violet-100"
                    >
                      <span className="max-w-[120px] truncate text-slate-900">{worker.name}</span>
                      <span className="rounded bg-amber-50 px-1 text-amber-700">WIP {worker.wip_count}</span>
                      <span className="rounded bg-emerald-50 px-1 text-emerald-700">Done {worker.done_count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={selectedDate}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 outline-none transition focus:border-[#2AA7A0] focus:ring-2 focus:ring-[#2AA7A0]/15"
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    fetchData(e.target.value);
                  }}
                />

                <button
                  type="button"
                  onClick={() => setShowCubiQaReport((value) => !value)}
                  className={`h-8 rounded-lg px-3 text-xs font-semibold shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/25 ${
                    showCubiQaReport
                      ? 'bg-slate-900 text-white hover:bg-slate-800'
                      : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  Cubi QA Report
                </button>

                <button
                  type="button"
                  onClick={copyText}
                  className="h-8 rounded-lg bg-[#2AA7A0] px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#238f89] focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/25"
                >
                  Copy Report
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyImage}
                  disabled={exportingJpg || loading}
                  className="h-8 rounded-lg bg-white ring-1 ring-slate-200 px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/25 flex items-center gap-1.5 disabled:opacity-50"
                  title="Copy screenshot to clipboard for WhatsApp/Slack"
                >
                  {copiedImage ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-emerald-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-slate-600" />
                      <span>Copy Screenshot</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleDownloadJpg}
                  disabled={exportingJpg || loading}
                  className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/25 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {exportingJpg ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#2AA7A0]" />
                      <span>Generating JPG...</span>
                    </>
                  ) : (
                    <>
                      <Download className="h-3.5 w-3.5" />
                      <span>Download JPG</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => fetchData(selectedDate)}
                  disabled={loading}
                  className="h-8 rounded-lg bg-white ring-1 ring-slate-200 px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/25 flex items-center gap-1.5 disabled:opacity-50"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-4 py-2.5">
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">Plans {summary?.total_plans ?? totalOrders?.plans ?? 0}</span>
            {qaSummary && (
              <span className="rounded-md bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">In QA {qaSummary.total_wip ?? 0}</span>
            )}
            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Done {summary?.total_done ?? totalOrders?.done ?? 0}</span>
            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Pending {summary?.total_pending ?? totalOrders?.pending ?? 0}</span>
            <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Drawing Process {summary?.total_drawing ?? totalOrders?.drawing_process ?? 0}</span>
            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Fixing {summary?.total_fixing ?? totalOrders?.sent_to_fixing ?? 0}</span>
            <span className="rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700">Untouched {summary?.total_untouched ?? totalOrders?.untouched_orders ?? 0}</span>
            {topPlans.map((item) => (
              <span
                key={`batch-top-${item.label}`}
                className="rounded-md bg-[#2AA7A0]/10 px-2 py-0.5 text-[10px] font-semibold text-[#0f766e] ring-1 ring-[#2AA7A0]/20"
              >
                {item.label}: {item.value}
              </span>
            ))}
          </div>

          {showCubiQaReport && (
            <div className="border-b border-slate-200 bg-slate-50 p-4">
              <CubiQaReport date={selectedDate} />
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[#2AA7A0]" />
            </div>
          ) : hasStatusData ? (
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Plans Remaining Time</h2>
                    <span className="text-[10px] font-semibold text-slate-400">{plansRemaining.length} slots</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {plansRemaining.length > 0 ? plansRemaining.map((item) => (
                      <span key={`plans-${item.hour}-${item.plans}`} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                        <span className="text-slate-950">{item.plans}</span>
                        <span>plans</span>
                        <span className="text-slate-400">:</span>
                        <span className="text-[#0f766e]">{item.hour}h</span>
                      </span>
                    )) : (
                      <div className="py-3 text-xs text-slate-400">No remaining-time buckets.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-3 xl:col-span-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Hourly Counts</h2>
                  </div>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-2 md:grid-cols-2">
                    {hourlyCounts.length > 0 ? hourlyCounts.map((item) => {
                      const orders = Number(item.orders || 0);

                      return (
                        <div key={`hourly-${item.label}`} className="grid grid-cols-[92px_1fr_42px] items-center gap-2 text-[11px]">
                          <span className="font-medium text-slate-600">{item.label}</span>
                          <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <span
                              className="block h-full rounded-full bg-[#2AA7A0]"
                              style={{ width: `${Math.max(orders > 0 ? 8 : 0, Math.round((orders / maxHourlyOrders) * 100))}%` }}
                            />
                          </span>
                          <span className={`text-right font-bold tabular-nums ${orders > 0 ? 'text-slate-800' : 'text-slate-300'}`}>{orders}</span>
                        </div>
                      );
                    }) : (
                      <div className="py-3 text-xs text-slate-400">No hourly counts.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs md:text-sm">
                  <thead className="bg-slate-50">
                    <tr className="border-b border-slate-100">
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500">Batch</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Received</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Remaining</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Plans</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Done</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Pending</th>
                      <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Fixing</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 bg-white">
                    {data.length > 0 ? data.map((batch) => (
                      <tr key={`batch-${batch.batch_no}`} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2 font-semibold text-slate-900">Batch {batch.batch_no}</td>
                        <td className="px-3 py-2 text-center text-slate-600">{batch.received_time ?? '-'}</td>
                        <td className="px-3 py-2 text-center text-slate-600">{normalizeRemainingTime(batch.remaining_time)}</td>
                        <td className="px-3 py-2 text-center font-semibold text-slate-700">{batch.plans ?? 0}</td>
                        <td className="px-3 py-2 text-center font-semibold text-emerald-700">{batch.done ?? 0}</td>
                        <td className="px-3 py-2 text-center font-semibold text-amber-700">{batch.pending ?? 0}</td>
                        <td className="px-3 py-2 text-center font-semibold text-rose-700">{batch.fixing ?? 0}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-xs text-slate-400">
                          No batch received for this date.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="px-4 py-12 text-center text-xs md:text-sm text-slate-400">
              No batch status data available.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
