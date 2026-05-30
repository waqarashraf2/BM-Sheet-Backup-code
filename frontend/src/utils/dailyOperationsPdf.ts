/**
 * Daily Operations PDF Export
 * Generates a branded PDF report with Benchmark theme colors
 * Libraries (jspdf + jspdf-autotable) are dynamically imported on first use
 * to avoid ~300KB from the main bundle.
 */
import type { DailyOperationsData, DailyOperationsProject } from '../types';

// Lazily-resolved modules
let jsPDFModule: typeof import('jspdf') | null = null;
let autoTableModule: typeof import('jspdf-autotable') | null = null;

async function loadPdfLibs() {
  if (!jsPDFModule || !autoTableModule) {
    [jsPDFModule, autoTableModule] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
  }
  return { jsPDF: jsPDFModule.default, autoTable: autoTableModule.default };
}

// Re-export type for addRoundedRect helper
type jsPDF = import('jspdf').jsPDF;

// ─── Theme Colors ─────────────────────────────────────
const TEAL    = [42, 167, 160] as const;   // #2AA7A0
const TEAL_DK = [35, 139, 133] as const;   // #238B85
const ORANGE  = [196, 92, 38]  as const;   // #C45C26
const SLATE_900 = [15, 23, 42]  as const;
const SLATE_700 = [51, 65, 85]  as const;
const SLATE_500 = [100, 116, 139] as const;
const SLATE_200 = [226, 232, 240] as const;
const WHITE   = [255, 255, 255] as const;
const BLUE    = [37, 99, 235]   as const;
const AMBER   = [217, 119, 6]   as const;
const ROSE    = [225, 29, 72]   as const;

const LAYER_LABELS: Record<string, string> = {
  DRAW: 'Drawer',
  CHECK: 'Checker',
  DESIGN: 'Designer',
  QA: 'QA',
};

// ─── Helpers ──────────────────────────────────────────
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function addRoundedRect(
  doc: jsPDF, x: number, y: number, w: number, h: number,
  r: number, fillColor: readonly [number, number, number]
) {
  doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
  doc.roundedRect(x, y, w, h, r, r, 'F');
}

// ─── Main Export Function ─────────────────────────────
export async function exportDailyOperationsPdf(
  data: DailyOperationsData,
  filteredProjects: DailyOperationsProject[],
  dateRange: { start: string; end: string }
) {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 12;
  let y = margin;

  // ── Page background ──
  const drawPageBg = () => {
    // Subtle header band
    doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
    doc.rect(0, 0, pageW, 3, 'F');
    // Bottom accent line
    doc.setFillColor(ORANGE[0], ORANGE[1], ORANGE[2]);
    doc.rect(0, pageH - 2, pageW, 2, 'F');
  };

  drawPageBg();

  // ── Header ──────────────────────────────────────────
  // Brand bar
  addRoundedRect(doc, margin, y, pageW - margin * 2, 22, 3, TEAL);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
  doc.text('BENCHMARK', margin + 6, y + 9);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Enterprise Management System', margin + 6, y + 15);

  // Right side: date
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Daily Operations Report', pageW - margin - 6, y + 9, { align: 'right' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(formatDateRange(dateRange.start, dateRange.end), pageW - margin - 6, y + 15, { align: 'right' });
  y += 28;

  // ── Summary Cards ───────────────────────────────────
  const cardW = (pageW - margin * 2 - 4 * 4) / 5;
  const cardH = 18;
  const cards = [
    { label: 'Projects', value: String(data.totals.projects), color: SLATE_700 },
    { label: 'Received', value: String(data.totals.received), color: BLUE },
    { label: 'Delivered', value: String(data.totals.delivered), color: TEAL },
    { label: 'Pending', value: String(data.totals.pending), color: AMBER },
    { label: 'Work Items', value: String(data.totals.total_work_items), color: TEAL_DK },
  ];

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);

  const sameDay = s.toDateString() === e.toDateString();

  if (sameDay) {
    return formatDate(start);
  }

  return `${s.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })} → ${e.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })}`;
}

  cards.forEach((card, i) => {
    const cx = margin + i * (cardW + 4);
    // Card background
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(cx, y, cardW, cardH, 2, 2, 'F');
    // Left accent bar
    doc.setFillColor(card.color[0], card.color[1], card.color[2]);
    doc.rect(cx, y + 2, 1.5, cardH - 4, 'F');
    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(card.color[0], card.color[1], card.color[2]);
    doc.text(card.value, cx + cardW / 2, y + 9, { align: 'center' });
    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    doc.text(card.label, cx + cardW / 2, y + 15, { align: 'center' });
  });
  y += cardH + 6;

  // ── Projects Table ──────────────────────────────────
  const tableHeaders = [
    'Project', 'Country', 'Department', 'Received', 'Delivered', 'Pending',
    'Layers Breakdown', 'Workers', 'QA Compliance'
  ];

  const tableBody = filteredProjects.map((p) => {
    const layerSummary = Object.entries(p.layers)
      .map(([s, l]) => `${LAYER_LABELS[s] || s}: ${l.total}`)
      .join('\n');
    const workerCount = Object.values(p.layers)
      .reduce((sum, l) => sum + l.workers.length, 0);
    const dept = p.department === 'floor_plan' ? 'Floor Plan' : 'Photos Enhancement';
    return [
      `${p.code}\n${p.name}`,
      p.country,
      dept,
      String(p.received),
      String(p.delivered),
      String(p.pending),
      layerSummary || 'No work',
      String(workerCount),
      `${p.qa_checklist.compliance_rate}%`,
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [tableHeaders],
    body: tableBody,
    theme: 'grid',
    margin: { left: margin, right: margin },
    styles: {
      fontSize: 7,
      cellPadding: 2,
      lineColor: [...SLATE_200] as [number, number, number],
      lineWidth: 0.25,
      textColor: [...SLATE_700] as [number, number, number],
      valign: 'middle',
    },
    headStyles: {
      fillColor: [...TEAL] as [number, number, number],
      textColor: [...WHITE] as [number, number, number],
      fontStyle: 'bold',
      fontSize: 7.5,
      halign: 'center',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 42, fontStyle: 'bold' },
      1: { halign: 'center', cellWidth: 22 },
      2: { halign: 'center', cellWidth: 28 },
      3: { halign: 'center', cellWidth: 18, textColor: [...BLUE] as [number, number, number], fontStyle: 'bold' },
      4: { halign: 'center', cellWidth: 18, textColor: [...TEAL] as [number, number, number], fontStyle: 'bold' },
      5: { halign: 'center', cellWidth: 18, textColor: [...AMBER] as [number, number, number], fontStyle: 'bold' },
      6: { cellWidth: 55 },
      7: { halign: 'center', cellWidth: 18 },
      8: { halign: 'center', cellWidth: 25, fontStyle: 'bold' },
    },
    didParseCell: (data) => {
      // Color QA compliance cells based on value
      if (data.section === 'body' && data.column.index === 8) {
        const val = parseFloat(data.cell.raw as string);
        if (val >= 95) {
          data.cell.styles.textColor = [...TEAL] as [number, number, number];
        } else if (val >= 80) {
          data.cell.styles.textColor = [...AMBER] as [number, number, number];
        } else {
          data.cell.styles.textColor = [...ROSE] as [number, number, number];
        }
      }
    },
    didDrawPage: () => {
      drawPageBg();
    },
  });

  // ── Per-Project Worker Details (new page) ───────────
  filteredProjects.forEach((project) => {
    const layers = Object.entries(project.layers).filter(([, l]) => l.total > 0);
    if (layers.length === 0) return;

    doc.addPage('landscape');
    drawPageBg();
    let py = margin;

    // Project header bar
    addRoundedRect(doc, margin, py, pageW - margin * 2, 14, 2, TEAL);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(WHITE[0], WHITE[1], WHITE[2]);
    doc.text(`${project.code} — ${project.name}`, margin + 5, py + 6);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(
      `${project.country} | ${project.department === 'floor_plan' ? 'Floor Plan' : 'Photos Enhancement'} | ${formatDateRange(dateRange.start, dateRange.end)}`,
      margin + 5, py + 11
    );

    // Stats badges on right
    const statsText = `Received: ${project.received}   Delivered: ${project.delivered}   Pending: ${project.pending}`;
    doc.setFontSize(8);
    doc.text(statsText, pageW - margin - 5, py + 8, { align: 'right' });
    py += 20;

    // Layer tables side-by-side or stacked
    const layerW = layers.length <= 3
      ? (pageW - margin * 2 - (layers.length - 1) * 4) / layers.length
      : (pageW - margin * 2 - 4) / 2;

    const LAYER_COLORS: Record<string, readonly [number, number, number]> = {
      DRAW: BLUE,
      CHECK: AMBER,
      DESIGN: TEAL_DK,
      QA: TEAL,
    };

    layers.forEach(([stage, layer], idx) => {
      const col = layers.length <= 3 ? idx : idx % 2;
      const row = layers.length <= 3 ? 0 : Math.floor(idx / 2);
      const lx = margin + col * (layerW + 4);
      const ly = py + row * 50;

      const headerColor = LAYER_COLORS[stage] || TEAL;

      // Layer label
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(headerColor[0], headerColor[1], headerColor[2]);
      doc.text(`${LAYER_LABELS[stage] || stage} — ${layer.total} orders`, lx, ly);

      if (layer.workers.length > 0) {
        const workerRows = layer.workers.map(w => [
          w.name,
          String(w.completed),
          w.has_more ? 'Yes' : '',
        ]);

        autoTable(doc, {
          startY: ly + 2,
          head: [['Worker Name', 'Completed', 'More']],
          body: workerRows,
          theme: 'grid',
          margin: { left: lx, right: pageW - lx - layerW },
          tableWidth: layerW,
          styles: {
            fontSize: 7,
            cellPadding: 1.5,
            lineColor: [...SLATE_200] as [number, number, number],
            lineWidth: 0.2,
            textColor: [...SLATE_700] as [number, number, number],
          },
          headStyles: {
            fillColor: [...headerColor] as [number, number, number],
            textColor: [...WHITE] as [number, number, number],
            fontStyle: 'bold',
            fontSize: 7,
            halign: 'center',
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
          columnStyles: {
            0: { cellWidth: layerW * 0.5 },
            1: { halign: 'center', cellWidth: layerW * 0.3, fontStyle: 'bold', textColor: [...headerColor] as [number, number, number] },
            2: { halign: 'center', cellWidth: layerW * 0.2 },
          },
        });
      }
    });

    // QA Checklist box at the bottom of status area
    const qaY = pageH - 35;
    addRoundedRect(doc, margin, qaY, pageW - margin * 2, 20, 2, [248, 250, 252] as unknown as readonly [number, number, number]);
    doc.setFillColor(TEAL[0], TEAL[1], TEAL[2]);
    doc.rect(margin, qaY, 1.5, 20, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(SLATE_900[0], SLATE_900[1], SLATE_900[2]);
    doc.text('QA Checklist Compliance', margin + 6, qaY + 6);

    const qaItems = [
      { label: 'Orders QA\'d', value: project.qa_checklist.total_orders, color: SLATE_700 },
      { label: 'Checklist Items', value: project.qa_checklist.total_items, color: SLATE_700 },
      { label: 'Completed', value: project.qa_checklist.completed_items, color: TEAL },
      { label: 'Mistakes', value: project.qa_checklist.mistake_count, color: ROSE },
      {
        label: 'Compliance',
        value: `${project.qa_checklist.compliance_rate}%`,
        color: project.qa_checklist.compliance_rate >= 95 ? TEAL
          : project.qa_checklist.compliance_rate >= 80 ? AMBER : ROSE,
      },
    ];

    const qaBoxW = (pageW - margin * 2 - 10) / 5;
    qaItems.forEach((item, i) => {
      const qx = margin + 5 + i * qaBoxW;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(item.color[0], item.color[1], item.color[2]);
      doc.text(String(item.value), qx + qaBoxW / 2, qaY + 12, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
      doc.text(item.label, qx + qaBoxW / 2, qaY + 17, { align: 'center' });
    });
  });

  // ── Footer on every page ────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(SLATE_500[0], SLATE_500[1], SLATE_500[2]);
    doc.text(
      `Benchmark Daily Operations — ${formatDateRange(dateRange.start, dateRange.end)}`,
      margin,
      pageH - 5
    );
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageW - margin,
      pageH - 5,
      { align: 'right' }
    );
    // Generated timestamp
    doc.text(
      `Generated: ${new Date().toLocaleString()}`,
      pageW / 2,
      pageH - 5,
      { align: 'center' }
    );
  }

  // ── Save ────────────────────────────────────────────
  doc.save(
  `Benchmark_Daily_Operations_${dateRange.start}_to_${dateRange.end}.pdf`
);
}
