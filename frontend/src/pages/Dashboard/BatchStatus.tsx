import { useEffect, useState } from 'react';
import { dashboardService } from '../../services';

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
  const getTodayInputValue = () => {
    const d = new Date();
    return `${d.getFullYear()}-${(d.getMonth() + 1)
      .toString()
      .padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
  };

  const [selectedDate, setSelectedDate] = useState<string>(getTodayInputValue());
  const [rawResponse, setRawResponse] = useState<BatchStatusResponse | null>(null);

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
      const totalFixing = resp.total_orders?.sent_to_fixing || 0;

      setData(resp.batches || []);
      setSummary({
        total_batches: resp.batches?.length || 0,
        total_plans: totalPlans,
        total_done: totalDone,
        total_pending: totalPending,
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
    if (!data.length) return '';

    let text = '';

    text += `Cubi 2D\n`;
    text += `${formatDate(selectedDate)}\n\n`;

    data.forEach((batch) => {
      text += `Batch ${batch.batch_no}\n`;
      text += `Received Time: ${batch.received_time}\n`;

      // 🔥 FIX: avoid duplicate like "8h - 8h"
      let remaining = batch.remaining_time;
      if (remaining && remaining.includes('-')) {
        const [min, max] = remaining.split('-').map(s => s.trim());
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
  text += `${p.plans} Plans : ${p.hour}h\n`; // just hours
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

    // Top Plans
    if (rawResponse?.untouched_min?.remaining_time) {
      text += `Untouched Top plan\n`;
      text += `Least Remaining Time: ${rawResponse.untouched_min.remaining_time}\n\n`;
    }

    if (rawResponse?.fixed_min?.remaining_time) {
      text += `Fixed Order Top plan\n`;
      text += `Least Remaining Time: ${rawResponse.fixed_min.remaining_time}\n`;
    }

    return text;
  };

  /* ---------------------- COPY ---------------------- */

  const copyText = () => {
    const text = generateReportText();
    navigator.clipboard.writeText(text);
    alert('Copied Correct Format ✅');
  };

  /* ---------------------- UI ---------------------- */

  const displayDate = formatDate(selectedDate);

  return (
    <div className="max-w-md mx-auto bg-gray-50 min-h-screen p-4 space-y-4 font-sans">
      <div className="text-center mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Cubi 2D</h1>
        <p className="text-sm text-slate-500">{displayDate}</p>

        <div className="flex justify-between mt-3 gap-2">
          <input
            type="date"
            value={selectedDate}
            className="border px-3 py-2 rounded text-sm w-full bg-white"
            onChange={(e) => {
              setSelectedDate(e.target.value);
              fetchData(e.target.value);
            }}
          />

          <button
            onClick={copyText}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm"
          >
            Copy Report
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-500">Loading...</div>
      ) : (
        <pre className="bg-black text-green-400 p-4 rounded text-xs whitespace-pre-wrap">
          {generateReportText()}
        </pre>
      )}
    </div>
  );
}
