import { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { invoiceService, projectService } from '../../services';
import type { Invoice, InvoiceItem, InvoiceStatus, InvoiceMonthlyQuantity } from '../../types';
import { AnimatedPage, PageHeader, StatusBadge, Modal, Button, DataTable, FilterBar } from '../../components/ui';
import { FileText, Plus, Eye, ChevronRight, DollarSign, TrendingUp, Printer, Pencil, Trash2, Lock, RefreshCw, Calendar, BarChart3, Zap, CheckCircle2 } from 'lucide-react';

// ─── Static BM Studios constants ────────────────────────────────────
const BM = {
  name: 'BM Studios Ltd.',
  address: 'B-101 Glamour Heights, Waris Road, Lahore, Pakistan',
  pkPhone: '+92-42-7520160 / +92-300-8495008',
  ukPhone: '+44(0)2070978788',
  usPhone: '+1-631-485-4948',
  bank: {
    method: 'AUD Bank Transfer',
    holder: 'BM STUDIOS LTD',
    bsb: '774-001',
    account: '205042726',
    address: '36-38 Gipps Street Collingwood 3066 Australia',
  },
  approvals: [
    { role: 'Prepared By', name: 'M. Kashif Mian' },
    { role: 'Verified By', name: 'M. Ali Mian' },
    { role: 'Approved By', name: 'M. Omer' },
  ],
  footer: 'This is an electronic invoice and does not require signature',
};

const INVOICE_FLOW: InvoiceStatus[] = ['draft', 'prepared', 'approved', 'issued', 'sent'];

const STATUS_ACTIONS: Record<string, { next: InvoiceStatus; label: string; roles: string[] }> = {
  draft: { next: 'prepared', label: 'Mark Prepared', roles: ['ceo', 'director', 'operations_manager', 'accounts_manager'] },
  prepared: { next: 'approved', label: 'Approve', roles: ['ceo', 'director'] },
  approved: { next: 'issued', label: 'Issue', roles: ['ceo', 'director'] },
  issued: { next: 'sent', label: 'Mark Sent', roles: ['ceo', 'director'] },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const now = new Date();

// ─── Empty line item ────────────────────────────────────────────────
const emptyItem = (): InvoiceItem => ({ description: '', quantity: 1, unit_price: 0, total: 0 });

// ─── Helpers ────────────────────────────────────────────────────────
function recalcItem(item: InvoiceItem): InvoiceItem {
  return { ...item, total: Math.round(item.quantity * item.unit_price * 100) / 100 };
}
function sumItems(items: InvoiceItem[]): number {
  return Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
}
function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ════════════════════════════════════════════════════════════════════
// BM INVOICE PRINT TEMPLATE  (matches the official BM Studios design)
// All styles are inline so the print window renders correctly.
// ════════════════════════════════════════════════════════════════════
const S = {
  page: { fontFamily: 'Arial, sans-serif', fontSize: 12, color: '#1e293b', background: '#fff', padding: '28px 36px', minWidth: 640 } as React.CSSProperties,
  // header
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 } as React.CSSProperties,
  logoBlock: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
  billingLbl: { fontWeight: 700, fontSize: 13, marginTop: 6 },
  billingTxt: { fontSize: 11, lineHeight: '1.6', color: '#374151' },
  siTitle: { fontWeight: 700, fontSize: 15, textAlign: 'right' as const, marginBottom: 6 },
  siTable: { borderCollapse: 'collapse' as const, marginLeft: 'auto' },
  siTh: { border: '1px solid #64748b', padding: '4px 18px', fontWeight: 700, fontSize: 11, textAlign: 'center' as const, background: '#f1f5f9' },
  siTd: { border: '1px solid #64748b', padding: '4px 18px', fontSize: 11, textAlign: 'center' as const, minWidth: 100 },
  divider: { border: 'none', borderTop: '1px solid #94a3b8', margin: '10px 0' },
  // client fields
  fieldRow: { display: 'flex', alignItems: 'flex-end', gap: 6, marginBottom: 7 } as React.CSSProperties,
  fieldLabel: { fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' as const, minWidth: 100 },
  fieldVal: { flex: 1, borderBottom: '1px solid #64748b', fontSize: 12, paddingBottom: 1, minHeight: 18 },
  // items table
  tbl: { borderCollapse: 'collapse' as const, width: '100%', marginTop: 12 },
  tblTh: { border: '1px solid #64748b', padding: '6px 10px', fontWeight: 700, fontSize: 11, textAlign: 'center' as const, background: '#f1f5f9' },
  tblTd: { border: '1px solid #94a3b8', padding: '4px 10px', fontSize: 11 },
  tblTdC: { border: '1px solid #94a3b8', padding: '4px 10px', fontSize: 11, textAlign: 'center' as const },
  tblTdR: { border: '1px solid #94a3b8', padding: '4px 10px', fontSize: 11, textAlign: 'right' as const },
  totalTh: { border: '1px solid #64748b', padding: '6px 10px', fontWeight: 700, fontSize: 12, textAlign: 'right' as const },
  totalTd: { border: '1px solid #64748b', padding: '6px 10px', fontWeight: 700, fontSize: 12, textAlign: 'right' as const, minWidth: 90 },
  // payment
  paySection: { marginTop: 18 },
  payHeading: { fontWeight: 700, fontSize: 12, textDecoration: 'underline', marginBottom: 8 },
  payGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px', fontSize: 11 } as React.CSSProperties,
  payLabel: { fontWeight: 700, color: '#374151' },
  payVal: { color: '#1e293b' },
  // signatures
  sigRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, marginTop: 24 } as React.CSSProperties,
  sigBlock: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 4 },
  sigName: { fontWeight: 700, fontSize: 12, textAlign: 'center' as const },
  sigLine: { width: '100%', borderBottom: '1px solid #64748b', marginTop: 28 },
  sigRole: { fontSize: 11, color: '#64748b', textAlign: 'center' as const, marginTop: 4 },
  // footer
  footer: { textAlign: 'center' as const, fontSize: 11, fontStyle: 'italic', color: '#64748b', marginTop: 18, paddingTop: 10, borderTop: '1px solid #e2e8f0' },
};

// BM logo SVG inline (so it works in print window)
function InvoiceLogo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width="36" height="36" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="4" y="4" width="10" height="40" rx="1" fill="#C45C26" />
        <path d="M18 4L18 24L38 4H18Z" fill="#2AA7A0" />
        <path d="M18 24L18 44L38 44L18 24Z" fill="#2AA7A0" />
      </svg>
      <span style={{ fontWeight: 700, fontSize: 16, color: '#2AA7A0', letterSpacing: 1 }}>BenchMark</span>
    </div>
  );
}

function InvoiceTemplate({ inv }: { inv: Invoice }) {
  const items: InvoiceItem[] = inv.invoice_items?.length ? inv.invoice_items : [];
  const total = sumItems(items);
  const billingPeriod = inv.billing_period || `${MONTHS[(Number(inv.month) || 1) - 1]} ${inv.year}`;
  const invoiceDate = inv.date
    ? new Date(inv.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    : new Date(inv.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  // Pad rows to at least 14 for a full-page look
  const MIN_ROWS = 14;
  const rows: (InvoiceItem | null)[] = [...items];
  while (rows.length < MIN_ROWS) rows.push(null);

  return (
    <div style={S.page}>
      {/* ── Header ── */}
      <div style={S.headerRow}>
        {/* Left: logo + billing office */}
        <div style={S.logoBlock}>
          <InvoiceLogo />
          <div style={S.billingLbl}>Billing office</div>
          <div style={S.billingTxt}>
            B-101 Glamour Heights, Waris Road, Lahore Pakistan.<br />
            Tel:{BM.pkPhone}<br />
            UK: {BM.ukPhone}<br />
            US: {BM.usPhone}
          </div>
        </div>
        {/* Right: Sales Invoice + date/# box */}
        <div>
          <div style={S.siTitle}>Sales Invoice</div>
          <table style={S.siTable}>
            <thead>
              <tr>
                <th style={S.siTh}>DATE</th>
                <th style={S.siTh}>INVOICE #</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={S.siTd}>{invoiceDate}</td>
                <td style={S.siTd}>{inv.invoice_number}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <hr style={S.divider} />

      {/* ── Client fields ── */}
      <div>
        <div style={S.fieldRow}>
          <span style={S.fieldLabel}>Name:</span>
          <span style={S.fieldVal}>{inv.client_name || ''}</span>
        </div>
        <div style={S.fieldRow}>
          <span style={S.fieldLabel}>Phone/Email:</span>
          <span style={S.fieldVal}>{inv.client_phone_email || ''}</span>
        </div>
        <div style={S.fieldRow}>
          <span style={S.fieldLabel}>ATTN:</span>
          <span style={S.fieldVal}>{inv.attn || ''}</span>
        </div>
        <div style={S.fieldRow}>
          <span style={S.fieldLabel}>Billing Period:</span>
          <span style={S.fieldVal}>{billingPeriod}</span>
        </div>
      </div>

      {/* ── Line items table ── */}
      <table style={S.tbl}>
        <thead>
          <tr>
            <th style={{ ...S.tblTh, width: 80 }}>QUANTITY</th>
            <th style={S.tblTh}>DESCRIPTION</th>
            <th style={{ ...S.tblTh, width: 110 }}>UNIT PRICE</th>
            <th style={{ ...S.tblTh, width: 110 }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, i) => (
            <tr key={i} style={{ height: 26 }}>
              <td style={S.tblTdC}>{item && item.quantity > 0 ? item.quantity : ''}</td>
              <td style={S.tblTd}>{item ? item.description : ''}</td>
              <td style={S.tblTdR}>{item && item.unit_price > 0 ? `$${fmt(item.unit_price)}` : ''}</td>
              <td style={S.tblTdR}>{item && item.total > 0 ? `$${fmt(item.total)}` : ''}</td>
            </tr>
          ))}
          {/* Total row */}
          <tr>
            <td colSpan={3} style={S.totalTh}>TOTAL</td>
            <td style={S.totalTd}>{total > 0 ? `$${fmt(total)}` : ''}</td>
          </tr>
        </tbody>
      </table>

      {/* ── Payment section ── */}
      <div style={S.paySection}>
        <div style={S.payHeading}>
          Payment via AUD BANK Transfer with following bank instructions.
        </div>
        <div style={S.payGrid}>
          <div>
            <div style={S.payLabel}>Account holder</div>
            <div style={S.payVal}>{BM.bank.holder}</div>
          </div>
          <div>
            <div style={S.payLabel}>BSB code</div>
            <div style={S.payVal}>{BM.bank.bsb}</div>
          </div>
          <div>
            <div style={S.payLabel}>Account number</div>
            <div style={S.payVal}>{BM.bank.account}</div>
          </div>
          <div>
            <div style={S.payLabel}>Bank's address</div>
            <div style={S.payVal}>{BM.bank.address}</div>
          </div>
        </div>
      </div>

      {/* ── Signatures ── */}
      <div style={S.sigRow}>
        {BM.approvals.map(({ role, name }) => (
          <div key={role} style={S.sigBlock}>
            <div style={S.sigName}>{name}</div>
            <div style={S.sigLine} />
            <div style={S.sigRole}>{role}</div>
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={S.footer}>"{BM.footer}"</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════════
export default function InvoiceManagement() {
  const { user } = useSelector((state: RootState) => state.auth);

  // list state
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // modals
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<Invoice | null>(null);
  const [showEdit, setShowEdit] = useState<Invoice | null>(null);
  const [showPrint, setShowPrint] = useState<Invoice | null>(null);

  // create form
  const [projects, setProjects] = useState<any[]>([]);
  const [formData, setFormData] = useState({
    project_id: '', month: String(now.getMonth() + 1), year: String(now.getFullYear()),
    date: now.toISOString().slice(0, 10),
    attn: '', client_name: '', client_phone_email: '', billing_period: '',
  });
  const [createItems, setCreateItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // edit form (line items + header)
  const [editItems, setEditItems] = useState<InvoiceItem[]>([]);
  const [editHeader, setEditHeader] = useState({ date: '', attn: '', client_name: '', client_phone_email: '', billing_period: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  const printRef = useRef<HTMLDivElement>(null);

  // ─── Monthly Quantities Tab State ─────────────────────────────
  const isOM = user?.role === 'operations_manager';
  const [activeTab, setActiveTab] = useState<'invoices' | 'quantities'>(
    user?.role === 'operations_manager' ? 'quantities' : 'invoices'
  );
  const [qtyProjectId, setQtyProjectId] = useState('');
  const [qtyYear, setQtyYear] = useState(String(now.getFullYear()));
  const [monthlyData, setMonthlyData] = useState<InvoiceMonthlyQuantity[]>([]);
  const [qtyLoading, setQtyLoading] = useState(false);
  const [savingMonths, setSavingMonths] = useState<Set<number>>(new Set());
  const [computingMonths, setComputingMonths] = useState<Set<number>>(new Set());
  const [localEdits, setLocalEdits] = useState<Record<number, { manual_qty_total: string; manual_notes: string }>>({});
  // Create form quantity reference
  const [createQtyRef, setCreateQtyRef] = useState<InvoiceMonthlyQuantity | null>(null);
  const [createQtyLoading, setCreateQtyLoading] = useState(false);

  // Auto-generate invoice state
  const [generatingMonths, setGeneratingMonths] = useState<Set<number>>(new Set());
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generateResult, setGenerateResult] = useState<{ success: number; failed: number } | null>(null);

  useEffect(() => { loadInvoices(); }, [selectedStatus]);

  // Pre-load projects on mount (for both create form + monthly qty tab)
  useEffect(() => {
    projectService.list()
      .then(res => { const d = res.data?.data || res.data; setProjects(Array.isArray(d) ? d : []); })
      .catch(() => { });
  }, []);

  // Load monthly data when project/year changes in Monthly Quantities tab
  useEffect(() => { loadMonthlyData(); }, [qtyProjectId, qtyYear]);

  // Load quantity reference in create form when project/month/year changes
  useEffect(() => {
    if (!formData.project_id || !formData.month || !formData.year || !showCreate) {
      setCreateQtyRef(null);
      return;
    }
    let cancelled = false;
    setCreateQtyLoading(true);
    invoiceService.getMonthlyQuantity(Number(formData.project_id), Number(formData.year), Number(formData.month))
      .then(res => { if (!cancelled) setCreateQtyRef(res.data?.monthly_quantity || null); })
      .catch(() => { if (!cancelled) setCreateQtyRef(null); })
      .finally(() => { if (!cancelled) setCreateQtyLoading(false); });
    return () => { cancelled = true; };
  }, [formData.project_id, formData.month, formData.year, showCreate]);

  const loadInvoices = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (selectedStatus !== 'all') params.status = selectedStatus;
      const res = await invoiceService.list(params);
      const list = res.data?.data || res.data;
      setInvoices(Array.isArray(list) ? list : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleTransition = async (id: number, toStatus: InvoiceStatus) => {
    try {
      await invoiceService.transition(id, toStatus);
      loadInvoices();
      if (showDetail?.id === id) setShowDetail(null);
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this draft invoice?')) return;
    try { await invoiceService.delete(id); loadInvoices(); if (showDetail?.id === id) setShowDetail(null); }
    catch (e) { console.error(e); }
  };

  const openCreate = async () => {
    setFormData({ project_id: '', month: String(now.getMonth() + 1), year: String(now.getFullYear()), date: now.toISOString().slice(0, 10), attn: '', client_name: '', client_phone_email: '', billing_period: '' });
    setCreateItems([emptyItem()]);
    setFormError('');
    try { const res = await projectService.list(); const d = res.data?.data || res.data; setProjects(Array.isArray(d) ? d : []); } catch (_) { }
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!formData.project_id) { setFormError('Project is required.'); return; }
    const validItems = createItems.filter(i => i.description.trim());
    try {
      setSaving(true); setFormError('');
      await invoiceService.create({
        project_id: Number(formData.project_id), month: formData.month, year: formData.year,
        date: formData.date, attn: formData.attn, client_name: formData.client_name,
        client_phone_email: formData.client_phone_email, billing_period: formData.billing_period,
        invoice_items: validItems.length ? validItems : undefined,
      });
      setShowCreate(false); loadInvoices();
    } catch (e: any) { setFormError(e.response?.data?.message || 'Failed to create.'); }
    finally { setSaving(false); }
  };

  const openEdit = (inv: Invoice) => {
    setEditHeader({ date: inv.date?.slice(0, 10) || '', attn: inv.attn || '', client_name: inv.client_name || '', client_phone_email: inv.client_phone_email || '', billing_period: inv.billing_period || '' });
    setEditItems(inv.invoice_items?.length ? inv.invoice_items.map(i => ({ ...i })) : [emptyItem()]);
    setEditError('');
    setShowEdit(inv);
  };

  const handleEdit = async () => {
    if (!showEdit) return;
    const validItems = editItems.filter(i => i.description.trim()).map(recalcItem);
    try {
      setEditSaving(true); setEditError('');
      const res = await invoiceService.update(showEdit.id, { ...editHeader, invoice_items: validItems.length ? validItems : undefined });
      const updated = res.data?.invoice;
      if (updated) { setInvoices(prev => prev.map(inv => inv.id === updated.id ? updated : inv)); }
      setShowEdit(null);
    } catch (e: any) { setEditError(e.response?.data?.message || 'Failed to save.'); }
    finally { setEditSaving(false); }
  };

  const handlePrint = () => {
    const el = printRef.current;
    if (!el) return;
    const win = window.open('', '_blank', 'width=820,height=1000');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>${showPrint?.invoice_number || 'Invoice'}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:#fff}
        @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{margin:10mm}}
      </style></head><body>${el.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 300);
  };

  // Item row helpers for create form
  const setCreateItem = (i: number, field: keyof InvoiceItem, value: string | number) => {
    setCreateItems(prev => prev.map((item, idx) => idx === i ? recalcItem({ ...item, [field]: Number(value) || (field === 'description' ? value : 0) }) : item));
  };
  const addCreateItem = () => setCreateItems(prev => [...prev, emptyItem()]);
  const removeCreateItem = (i: number) => setCreateItems(prev => prev.filter((_, idx) => idx !== i));

  // Item row helpers for edit form
  const setEditItem = (i: number, field: keyof InvoiceItem, value: string | number) => {
    setEditItems(prev => prev.map((item, idx) => idx === i ? recalcItem({ ...item, [field]: field === 'description' ? value : (Number(value) || 0) }) : item));
  };
  const addEditItem = () => setEditItems(prev => [...prev, emptyItem()]);
  const removeEditItem = (i: number) => setEditItems(prev => prev.filter((_, idx) => idx !== i));

  // ─── Monthly Quantities Functions ─────────────────────────────
  const loadMonthlyData = async () => {
    if (!qtyProjectId || !qtyYear) return;
    setQtyLoading(true);
    try {
      const res = await invoiceService.listMonthlyQuantities(Number(qtyProjectId), Number(qtyYear));
      let records: InvoiceMonthlyQuantity[] = res.data?.months || [];

      // Auto-create system qty records for past/current months that don't exist yet.
      // Backend computes them from the orders table on first GET.
      const existingMonths = new Set(records.map(r => r.month));
      const yearNum = Number(qtyYear);
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const maxMonth = yearNum < currentYear ? 12 : yearNum === currentYear ? currentMonth : 0;

      if (maxMonth > 0) {
        const missingMonths = Array.from({ length: maxMonth }, (_, i) => i + 1)
          .filter(m => !existingMonths.has(m));
        if (missingMonths.length > 0) {
          const fetched = await Promise.all(
            missingMonths.map(m =>
              invoiceService.getMonthlyQuantity(Number(qtyProjectId), yearNum, m)
                .then(r => r.data?.monthly_quantity || null)
                .catch(() => null)
            )
          );
          const newRecords = fetched.filter((r): r is InvoiceMonthlyQuantity => r !== null);
          records = [...records, ...newRecords].sort((a, b) => a.month - b.month);
        }
      }

      setMonthlyData(records);
      const edits: Record<number, { manual_qty_total: string; manual_notes: string }> = {};
      records.forEach((r: InvoiceMonthlyQuantity) => {
        edits[r.month] = {
          manual_qty_total: r.manual_qty_total != null ? String(r.manual_qty_total) : '',
          manual_notes: r.manual_notes || '',
        };
      });
      setLocalEdits(edits);
    } catch (e) { console.error(e); }
    finally { setQtyLoading(false); }
  };

  const saveQuantityRow = async (month: number) => {
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
    } catch (e) { console.error(e); }
    finally { setSavingMonths(prev => { const s = new Set(prev); s.delete(month); return s; }); }
  };

  const computeSystemQty = async (month: number) => {
    if (!qtyProjectId || !qtyYear) return;
    setComputingMonths(prev => new Set(prev).add(month));
    try {
      const res = await invoiceService.computeMonthlyQuantity(Number(qtyProjectId), Number(qtyYear), month);
      const updated: InvoiceMonthlyQuantity = res.data?.monthly_quantity;
      if (updated) {
        setMonthlyData(prev => {
          const idx = prev.findIndex(r => r.month === month);
          if (idx >= 0) { const n = [...prev]; n[idx] = updated; return n; }
          return [...prev, updated].sort((a, b) => a.month - b.month);
        });
      }
    } catch (e) { console.error(e); }
    finally { setComputingMonths(prev => { const s = new Set(prev); s.delete(month); return s; }); }
  };

  // ─── Auto-generate invoice from monthly quantity ──────────────
  const generateInvoiceForMonth = async (month: number) => {
    if (!qtyProjectId || !qtyYear) return;
    const record = monthlyData.find(r => r.month === month);
    if (!record) return;
    const projectName = projects.find((p: any) => String(p.id) === qtyProjectId)?.name || 'Project';
    const monthName = MONTHS[month - 1];
    const qty = record.manual_qty_total ?? record.system_qty_delivered ?? 0;
    const res = await invoiceService.create({
      project_id: Number(qtyProjectId),
      month: String(month),
      year: qtyYear,
      date: new Date().toISOString().slice(0, 10),
      billing_period: `${monthName} ${qtyYear}`,
      invoice_items: [{
        description: `${projectName} – Services Delivered (${monthName} ${qtyYear})`,
        quantity: Number(qty),
        unit_price: 0,
        total: 0,
      }],
    });
    const created = res.data?.invoice;
    if (created) {
      setMonthlyData(prev => prev.map(r =>
        r.month === month
          ? { ...r, invoice: { id: created.id, invoice_number: created.invoice_number, status: created.status } }
          : r
      ));
    }
    return created;
  };

  const handleGenerateInvoice = async (month: number) => {
    setGeneratingMonths(prev => new Set(prev).add(month));
    try { await generateInvoiceForMonth(month); }
    catch (e) { console.error(e); }
    finally { setGeneratingMonths(prev => { const s = new Set(prev); s.delete(month); return s; }); }
  };

  const handleGenerateAllInvoices = async () => {
    const readyMonths = monthlyData.filter(r => r.manual_qty_total != null && !r.invoice);
    if (readyMonths.length === 0) return;
    if (!confirm(`Generate ${readyMonths.length} draft invoice(s)? Unit prices will be $0 — the Director can edit and set the prices.`)) return;
    setGeneratingAll(true);
    setGenerateResult(null);
    let succeeded = 0; let errored = 0;
    for (const record of readyMonths) {
      setGeneratingMonths(prev => new Set(prev).add(record.month));
      try { await generateInvoiceForMonth(record.month); succeeded++; }
      catch { errored++; }
      finally { setGeneratingMonths(prev => { const s = new Set(prev); s.delete(record.month); return s; }); }
    }
    setGeneratingAll(false);
    setGenerateResult({ success: succeeded, failed: errored });
  };

  const canCreate = ['ceo', 'director', 'operations_manager', 'accounts_manager'].includes(user?.role || '');
  const canViewInvoices = ['ceo', 'director', 'accounts_manager', 'operations_manager'].includes(user?.role || '');
  const canViewQuantities = ['ceo', 'director', 'operations_manager'].includes(user?.role || '');
  const filtered = invoices.filter(inv => !searchTerm || inv.invoice_number?.toLowerCase().includes(searchTerm.toLowerCase()));
  const totalAmount = filtered.reduce((s, inv) => s + (Number(inv.total_amount) || 0), 0);

  return (
    <AnimatedPage>
      <PageHeader
        title="Invoices"
        subtitle="Manage invoices and monthly delivery quantities"
        actions={canCreate && activeTab === 'invoices' ? <Button onClick={openCreate} icon={Plus}>New Invoice</Button> : undefined}
      />

      {/* ── Tab Bar ───────────────────────────────────────────── */}
      <div className="flex border-b border-slate-200 mb-6">
        {canViewInvoices && (
          <button
            onClick={() => setActiveTab('invoices')}
            className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'invoices' ? 'border-[#2AA7A0] text-[#2AA7A0]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <FileText className="w-4 h-4" />Invoices
          </button>
        )}
        {canViewQuantities && (
          <button
            onClick={() => setActiveTab('quantities')}
            className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === 'quantities' ? 'border-[#2AA7A0] text-[#2AA7A0]' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            <BarChart3 className="w-4 h-4" />Monthly Quantities
          </button>
        )}
      </div>

      {/* ── INVOICES TAB ─────────────────────────────────────────── */}
      {activeTab === 'invoices' && canViewInvoices && (
        <>
          {/* Pipeline */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 mb-6">
            <div className="flex items-center justify-between">
              {INVOICE_FLOW.map((status, i) => {
                const count = invoices.filter(inv => inv.status === status).length;
                const active = selectedStatus === status;
                return (
                  <div key={status} className="flex items-center">
                    <button onClick={() => setSelectedStatus(active ? 'all' : status)}
                      className={`flex flex-col items-center px-4 py-2 rounded-lg transition-all ${active ? 'bg-[#2AA7A0] text-white' : 'hover:bg-slate-50'}`}>
                      <span className={`text-[11px] uppercase font-medium tracking-wide ${active ? 'text-slate-300' : 'text-slate-400'}`}>{status}</span>
                      <span className={`text-xl font-bold mt-0.5 ${active ? 'text-white' : 'text-slate-900'}`}>{count}</span>
                    </button>
                    {i < INVOICE_FLOW.length - 1 && <ChevronRight className="h-4 w-4 text-slate-300 mx-1" />}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center"><FileText className="w-5 h-5 text-slate-600" /></div>
              <div><div className="text-2xl font-bold text-slate-900">{filtered.length}</div><div className="text-xs text-slate-500">Total Invoices</div></div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center"><DollarSign className="w-5 h-5 text-brand-600" /></div>
              <div><div className="text-2xl font-bold text-slate-900">${fmt(totalAmount)}</div><div className="text-xs text-slate-500">Total Amount</div></div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center"><TrendingUp className="w-5 h-5 text-blue-600" /></div>
              <div><div className="text-sm font-semibold text-slate-900 capitalize">{selectedStatus === 'all' ? 'All Statuses' : selectedStatus}</div><div className="text-xs text-slate-500">Current Filter</div></div>
            </div>
          </div>

          {/* Filter */}
          <FilterBar searchValue={searchTerm} onSearchChange={setSearchTerm} searchPlaceholder="Search invoices..."
            filters={<select value={selectedStatus} onChange={e => setSelectedStatus(e.target.value)} aria-label="Filter by status" className="select text-sm">
              <option value="all">All Status</option>
              {INVOICE_FLOW.map(s => <option key={s} value={s}>{s}</option>)}
            </select>}
          />

          {/* Table */}
          <div className="mt-4">
            <DataTable
              data={filtered}
              loading={loading}
              columns={[
                { key: 'invoice_number', label: 'Invoice #', sortable: true, render: (inv) => <span className="font-semibold text-slate-900">{inv.invoice_number}</span> },
                { key: 'status', label: 'Status', render: (inv) => <StatusBadge status={inv.status} /> },
                { key: 'total_amount', label: 'Amount', sortable: true, render: (inv) => <span className="font-medium">${fmt(Number(inv.total_amount) || 0)}</span> },
                { key: 'month', label: 'Period', render: (inv) => <span className="text-slate-500">{inv.billing_period || `${MONTHS[(Number(inv.month) || 1) - 1]} ${inv.year}`}</span> },
                { key: 'project', label: 'Project', render: (inv) => <span className="text-slate-500">{inv.project?.name || '—'}</span> },
                {
                  key: 'actions', label: '', render: (inv) => {
                    const action = STATUS_ACTIONS[inv.status];
                    const canAct = action && action.roles.includes(user?.role || '');
                    return (
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button variant="ghost" size="xs" onClick={() => setShowDetail(inv)} title="View"><Eye className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="xs" onClick={() => { setShowPrint(inv); }} title="Print"><Printer className="w-3.5 h-3.5" /></Button>
                        {inv.status === 'draft' && canCreate && <Button variant="ghost" size="xs" onClick={() => openEdit(inv)} title="Edit"><Pencil className="w-3.5 h-3.5" /></Button>}
                        {canAct && <Button size="xs" onClick={() => handleTransition(inv.id, action.next)}>{action.label}</Button>}
                        {inv.status === 'draft' && canCreate && <Button variant="danger" size="xs" onClick={() => handleDelete(inv.id)} title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>}
                      </div>
                    );
                  }
                },
              ]}
              emptyIcon={FileText}
              emptyTitle="No invoices found"
              emptyDescription="Create your first invoice to get started."
            />
          </div>
        </>
      )}

      {/* ── MONTHLY QUANTITIES TAB ────────────────────────────── */}
      {activeTab === 'quantities' && canViewQuantities && (
        <div className="space-y-5">
          {/* Project + Year selectors */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4">
            <div className="flex items-end gap-4 flex-wrap">
              <div className="flex flex-col gap-1.5 min-w-60">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Project</label>
                <select value={qtyProjectId} onChange={e => setQtyProjectId(e.target.value)}
                  className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
                  <option value="">Select project...</option>
                  {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Year</label>
                <input type="number" value={qtyYear} onChange={e => setQtyYear(e.target.value)} min={2020} max={2100}
                  className="w-28 px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
              </div>
              {qtyProjectId && (
                <Button variant="secondary" size="xs" onClick={loadMonthlyData} loading={qtyLoading}>
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Refresh
                </Button>
              )}
              {qtyProjectId && canCreate && !qtyLoading && monthlyData.some(r => r.manual_qty_total != null && !r.invoice) && (
                <Button size="xs" onClick={handleGenerateAllInvoices} loading={generatingAll}>
                  <Zap className="w-3.5 h-3.5 mr-1.5" />Auto Generate Drafts
                </Button>
              )}
            </div>
          </div>

          {!qtyProjectId ? (
            <div className="bg-white rounded-xl border border-slate-200/60 p-12 flex flex-col items-center justify-center text-center">
              <Calendar className="w-10 h-10 text-slate-300 mb-3" />
              <p className="text-sm text-slate-400">Select a project to view and manage monthly delivery quantities</p>
            </div>
          ) : qtyLoading ? (
            <div className="bg-white rounded-xl border border-slate-200/60 p-12 flex items-center justify-center">
              <p className="text-sm text-slate-400">Loading monthly data...</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200/60 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="text-sm font-semibold text-slate-900">
                  {projects.find((p: any) => String(p.id) === qtyProjectId)?.name || 'Project'} — {qtyYear}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  <span className="text-blue-500 font-medium">System Qty</span> is auto-counted from delivered orders in the orders table (read-only). Enter your <span className="text-teal-600 font-medium">Manual Qty</span> for invoicing.
                </p>
              </div>
              {generateResult && (
                <div className="px-5 py-2.5 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-sm text-emerald-700 font-medium">{generateResult.success} draft invoice{generateResult.success !== 1 ? 's' : ''} created.</span>
                  {generateResult.failed > 0 && <span className="text-sm text-rose-500 ml-1">{generateResult.failed} failed.</span>}
                  <span className="text-sm text-slate-500 ml-1">Go to the <strong>Invoices</strong> tab — edit each draft to set unit prices.</span>
                  <button onClick={() => setGenerateResult(null)} className="ml-auto text-emerald-400 hover:text-emerald-600 text-xl leading-none">×</button>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-20">Month</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-48">
                        System Qty <span className="normal-case font-normal text-slate-400">(Delivered)</span>
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-40">Manual Qty</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
                      <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-24">Status</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
                      const record = monthlyData.find(r => r.month === month);
                      const edit = localEdits[month] ?? { manual_qty_total: '', manual_notes: '' };
                      const isLocked = record?.is_quantity_locked ?? false;
                      const isSaving = savingMonths.has(month);
                      const isComputing = computingMonths.has(month);
                      const isGenerating = generatingMonths.has(month);
                      return (
                        <tr key={month} className={`hover:bg-slate-50/40 transition-colors ${isLocked ? 'opacity-75' : ''}`}>
                          <td className="px-4 py-3 font-semibold text-slate-700">{MONTHS[month - 1]}</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${record?.system_qty_delivered != null ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                                {record?.system_qty_delivered != null ? record.system_qty_delivered : '—'}
                              </span>
                              {/* Workflow-type breakdown from orders table */}
                              {record?.system_qty_breakdown && (() => {
                                const byType = (record.system_qty_breakdown as any)?.by_workflow_type;
                                const entries = byType ? Object.entries(byType as Record<string, number>).filter(([, v]) => v > 0) : [];
                                return entries.length > 0 ? (
                                  <div className="flex flex-wrap gap-0.5 justify-center max-w-36">
                                    {entries.map(([type, count]) => (
                                      <span key={type} className="text-[10px] bg-blue-50/80 text-blue-500 rounded px-1.5 py-0.5 capitalize whitespace-nowrap">
                                        {type}: {count}
                                      </span>
                                    ))}
                                  </div>
                                ) : null;
                              })()}
                              {!isOM && (
                                <button onClick={() => computeSystemQty(month)} disabled={isComputing}
                                  title="Recompute system qty from orders"
                                  className="text-slate-300 hover:text-[#2AA7A0] transition-colors disabled:opacity-40 p-0.5">
                                  <RefreshCw className={`w-3.5 h-3.5 ${isComputing ? 'animate-spin' : ''}`} />
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="number" min="0" disabled={isLocked}
                              value={edit.manual_qty_total}
                              onChange={e => setLocalEdits(prev => ({ ...prev, [month]: { ...edit, manual_qty_total: e.target.value } }))}
                              className={`w-24 px-2.5 py-1.5 text-sm border rounded-lg text-center transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 ${isLocked ? 'bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white'}`}
                              placeholder="0"
                            />
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="text" disabled={isLocked}
                              value={edit.manual_notes}
                              onChange={e => setLocalEdits(prev => ({ ...prev, [month]: { ...edit, manual_notes: e.target.value } }))}
                              className={`w-full px-2.5 py-1.5 text-sm border rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 ${isLocked ? 'bg-slate-50 border-slate-100 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white'}`}
                              placeholder="Optional notes..."
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            {isLocked ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-600">
                                <Lock className="w-3 h-3" />Locked
                              </span>
                            ) : record?.invoice ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-600">
                                <FileText className="w-3 h-3" />Invoiced
                              </span>
                            ) : record?.manual_qty_total != null ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-600">
                                Saved
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {!isLocked && (
                                <Button size="xs" loading={isSaving}
                                  disabled={edit.manual_qty_total === ''}
                                  onClick={() => saveQuantityRow(month)}>
                                  Save
                                </Button>
                              )}
                              {canCreate && record?.manual_qty_total != null && !record?.invoice && (
                                <Button size="xs" variant="secondary" loading={isGenerating} onClick={() => handleGenerateInvoice(month)}>
                                  <FileText className="w-3 h-3 mr-1" />Invoice
                                </Button>
                              )}
                              {record?.invoice && (
                                <span title={`Invoice: ${record.invoice.invoice_number}`} className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium bg-emerald-50 px-2 py-0.5 rounded-full truncate max-w-28">
                                  <FileText className="w-3 h-3 shrink-0" />{record.invoice.invoice_number}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── CREATE MODAL ─────────────────────────────────────────── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Invoice" subtitle="New invoices start in Draft status" size="lg">
        {formError && <div className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-lg text-sm text-rose-600">{formError}</div>}
        <div className="space-y-4">
          {/* Row 1: project + period */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Project <span className="text-rose-500">*</span></label>
              <select value={formData.project_id} onChange={e => setFormData({ ...formData, project_id: e.target.value })} aria-label="Select project" className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
                <option value="">Select project...</option>
                {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {/* Monthly quantity reference */}
            {formData.project_id && (
              <div className="col-span-3">
                <div className={`flex items-center gap-5 px-3 py-2.5 rounded-lg border text-sm ${createQtyLoading ? 'bg-slate-50 border-slate-100' : 'bg-blue-50/50 border-blue-100'}`}>
                  <span className="text-xs font-medium text-slate-500 shrink-0">Delivery Quantities</span>
                  {createQtyLoading ? (
                    <span className="text-xs text-slate-400">Loading...</span>
                  ) : createQtyRef ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">System delivered:</span>
                        <span className="text-xs font-bold text-blue-700">{createQtyRef.system_qty_delivered ?? '—'}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">OM manual qty:</span>
                        <span className={`text-xs font-bold ${createQtyRef.manual_qty_total != null ? 'text-teal-700' : 'text-slate-400'}`}>
                          {createQtyRef.manual_qty_total ?? 'Not set'}
                        </span>
                      </div>
                      {createQtyRef.is_quantity_locked && (
                        <span className="flex items-center gap-1 text-xs text-rose-500 font-medium">
                          <Lock className="w-3 h-3" />Locked
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-slate-400">No quantity data for selected period</span>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Month</label>
              <select value={formData.month} onChange={e => setFormData({ ...formData, month: e.target.value })} aria-label="Invoice month" className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{MONTHS[i]}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Year</label>
              <input type="number" value={formData.year} onChange={e => setFormData({ ...formData, year: e.target.value })} className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Date</label>
              <input type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
            </div>
          </div>
          {/* Row 2: header fields */}
          <div className="grid grid-cols-2 gap-3">
            <FieldInput label="ATTN" value={formData.attn} onChange={v => setFormData({ ...formData, attn: v })} />
            <FieldInput label="Client Name" value={formData.client_name} onChange={v => setFormData({ ...formData, client_name: v })} />
            <FieldInput label="Phone / Email" value={formData.client_phone_email} onChange={v => setFormData({ ...formData, client_phone_email: v })} />
            <FieldInput label="Billing Period" value={formData.billing_period} onChange={v => setFormData({ ...formData, billing_period: v })} placeholder="e.g. May 2026" />
          </div>
          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Line Items</span>
              <Button variant="ghost" size="xs" onClick={addCreateItem}>+ Add Row</Button>
            </div>
            <ItemTable items={createItems} onChange={setCreateItem} onRemove={removeCreateItem} />
            <div className="flex justify-end mt-2">
              <span className="text-sm font-semibold text-slate-700">Total: <span className="text-[#2AA7A0]">${fmt(sumItems(createItems))}</span></span>
            </div>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button className="flex-1" onClick={handleCreate} loading={saving}>Create Draft</Button>
        </div>
      </Modal>

      {/* ── EDIT MODAL ───────────────────────────────────────────── */}
      <Modal open={!!showEdit} onClose={() => setShowEdit(null)} title="Edit Invoice" subtitle="Editing draft — header & line items" size="lg">
        {editError && <div className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-lg text-sm text-rose-600">{editError}</div>}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-slate-700">Date</label>
              <input type="date" value={editHeader.date} onChange={e => setEditHeader({ ...editHeader, date: e.target.value })} className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
            </div>
            <FieldInput label="Billing Period" value={editHeader.billing_period} onChange={v => setEditHeader({ ...editHeader, billing_period: v })} placeholder="e.g. May 2026" />
            <FieldInput label="ATTN" value={editHeader.attn} onChange={v => setEditHeader({ ...editHeader, attn: v })} />
            <FieldInput label="Client Name" value={editHeader.client_name} onChange={v => setEditHeader({ ...editHeader, client_name: v })} />
            <div className="col-span-2">
              <FieldInput label="Phone / Email" value={editHeader.client_phone_email} onChange={v => setEditHeader({ ...editHeader, client_phone_email: v })} />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">Line Items</span>
              <Button variant="ghost" size="xs" onClick={addEditItem}>+ Add Row</Button>
            </div>
            <ItemTable items={editItems} onChange={setEditItem} onRemove={removeEditItem} />
            <div className="flex justify-end mt-2">
              <span className="text-sm font-semibold text-slate-700">Total: <span className="text-[#2AA7A0]">${fmt(sumItems(editItems))}</span></span>
            </div>
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setShowEdit(null)}>Cancel</Button>
          <Button className="flex-1" onClick={handleEdit} loading={editSaving}>Save Changes</Button>
        </div>
      </Modal>

      {/* ── DETAIL MODAL ─────────────────────────────────────────── */}
      <Modal open={!!showDetail} onClose={() => setShowDetail(null)} title="Invoice Details" size="md">
        {showDetail && (
          <>
            <div className="flex items-center gap-1 mb-5">
              {INVOICE_FLOW.map((s, i) => {
                const idx = INVOICE_FLOW.indexOf(showDetail.status as InvoiceStatus);
                const isDone = i <= idx;
                const isCurr = s === showDetail.status;
                return (
                  <div key={s} className="flex-1 flex flex-col items-center">
                    <div className={`w-full h-1.5 rounded-full ${isDone ? 'bg-[#2AA7A0]' : 'bg-slate-200'}`} />
                    <span className={`text-[11px] mt-1 ${isCurr ? 'font-bold text-slate-900' : 'text-slate-400'}`}>{s}</span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-2.5">
              {[
                { label: 'Invoice #', value: showDetail.invoice_number },
                { label: 'Date', value: showDetail.date ? new Date(showDetail.date).toLocaleDateString('en-GB') : '—' },
                { label: 'Status', value: showDetail.status },
                { label: 'ATTN', value: showDetail.attn || '—' },
                { label: 'Client', value: showDetail.client_name || '—' },
                { label: 'Phone / Email', value: showDetail.client_phone_email || '—' },
                { label: 'Billing Period', value: showDetail.billing_period || `${MONTHS[(Number(showDetail.month) || 1) - 1]} ${showDetail.year}` },
                { label: 'Amount', value: `$${fmt(Number(showDetail.total_amount) || 0)}` },
                { label: 'Project', value: showDetail.project?.name || '—' },
                { label: 'Approved By', value: showDetail.approvedBy?.name || '—' },
                { label: 'Issued By', value: showDetail.issuedBy?.name || '—' },
                { label: 'Sent At', value: showDetail.sent_at ? new Date(showDetail.sent_at).toLocaleString() : '—' },
                { label: 'Created', value: new Date(showDetail.created_at).toLocaleString() },
              ].map((item, i) => (
                <div key={i} className="flex justify-between items-center py-1.5 border-b border-slate-100 last:border-0">
                  <span className="text-sm text-slate-500">{item.label}</span>
                  <span className="text-sm font-medium text-slate-900 capitalize">{item.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setShowDetail(null)}>Close</Button>
              <Button variant="ghost" className="flex-1" onClick={() => { setShowPrint(showDetail); setShowDetail(null); }}><Printer className="w-4 h-4 mr-1" />Print</Button>
              {(() => {
                const action = STATUS_ACTIONS[showDetail.status];
                if (!action || !action.roles.includes(user?.role || '')) return null;
                return <Button className="flex-1" onClick={() => handleTransition(showDetail.id, action.next)}>{action.label}</Button>;
              })()}
            </div>
          </>
        )}
      </Modal>

      {/* ── PRINT MODAL ──────────────────────────────────────────── */}
      <Modal open={!!showPrint} onClose={() => setShowPrint(null)} title="Invoice Preview" size="xl">
        {showPrint && (
          <>
            <div ref={printRef} className="border border-slate-200 rounded overflow-auto bg-white shadow-sm">
              <InvoiceTemplate inv={showPrint} />
            </div>
            <div className="mt-4 flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowPrint(null)}>Close</Button>
              <Button onClick={handlePrint}><Printer className="w-4 h-4 mr-1.5" />Print / Save PDF</Button>
            </div>
          </>
        )}
      </Modal>
    </AnimatedPage>
  );
}

// ─── Shared sub-components ───────────────────────────────────────────
function FieldInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="px-3 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
    </div>
  );
}

function ItemTable({ items, onChange, onRemove }: {
  items: InvoiceItem[];
  onChange: (i: number, field: keyof InvoiceItem, value: string | number) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden text-sm">
      <table className="w-full">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-slate-600 w-20">Qty</th>
            <th className="px-3 py-2 text-left font-medium text-slate-600">Description</th>
            <th className="px-3 py-2 text-right font-medium text-slate-600 w-28">Unit Price</th>
            <th className="px-3 py-2 text-right font-medium text-slate-600 w-24">Total</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="px-2 py-1">
                <input type="number" min="0" value={item.quantity} onChange={e => onChange(i, 'quantity', e.target.value)}
                  className="w-full px-2 py-1 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500" />
              </td>
              <td className="px-2 py-1">
                <input type="text" value={item.description} onChange={e => onChange(i, 'description', e.target.value)} placeholder="Service description"
                  className="w-full px-2 py-1 border border-slate-200 rounded text-sm focus:outline-none focus:border-teal-500" />
              </td>
              <td className="px-2 py-1">
                <input type="number" min="0" step="0.01" value={item.unit_price} onChange={e => onChange(i, 'unit_price', e.target.value)}
                  className="w-full px-2 py-1 border border-slate-200 rounded text-sm text-right focus:outline-none focus:border-teal-500" />
              </td>
              <td className="px-3 py-1 text-right text-slate-700 font-medium">${fmt(item.total)}</td>
              <td className="px-1 py-1">
                {items.length > 1 && (
                  <button onClick={() => onRemove(i)} className="text-slate-400 hover:text-rose-500 transition-colors p-1">✕</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


