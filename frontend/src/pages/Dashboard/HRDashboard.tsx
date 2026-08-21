import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  Calendar,
  Camera,
  Check,
  Copy,
  Download,
  Edit,
  ExternalLink,
  FileText,
  Mail,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  UserCheck,
  UserX,
  Users,
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { AnimatedPage, Button, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { hrService } from '../../services';
import type { RootState } from '../../store/store';
import type { User, UserDocument, UserLeaveBalance, UserLeaveEntry, UserSalaryIncrement } from '../../types';
import CameraCaptureModal from '../../components/CameraCaptureModal';

const documentTypes = [
  { value: 'copy_of_cnic', label: 'Copy of CNIC' },
  { value: 'two_pics', label: '2 Pics' },
  { value: 'nda', label: 'NDA' },
  { value: 'contract_letter', label: 'Appointment Letter' },
  { value: 'extra', label: 'Extra' },
] as const;

type HrStats = {
  total: number;
  active: number;
  inactive: number;
  absent: number;
  present: number;
};

type DocumentStats = {
  active_total: number;
  complete_required: number;
  incomplete_docs: number;
  no_documents: number;
  uploaded_today: number;
  today_hr_breakdown?: Array<{
    hr_id: number;
    hr_name: string;
    hr_email?: string | null;
    users_count: number;
    documents_count: number;
  }>;
  missing: {
    copy_of_cnic: number;
    two_pics: number;
    nda: number;
    contract_letter: number;
  };
};

type ProjectOption = {
  id: number;
  name: string;
  code?: string | null;
};

type EmployeeAnalytics = {
  summary: {
    total_employees: number;
    active_employees: number;
    new_joined: number;
    left_this_month: number;
    total_inactive: number;
    probation_due: number;
  };
  project_breakdown: Array<{
    project_name: string;
    total_employees: number;
    active_employees: number;
    new_joined: number;
    left_this_month: number;
    total_inactive: number;
  }>;
  probation_alerts: Array<{
    id: number;
    name: string;
    email?: string | null;
    role?: string | null;
    project_name?: string | null;
    machine_id?: string | null;
    joined_at?: string | null;
    days_completed?: number | null;
  }>;
};

type HrUserRow = User & {
  documents_count?: number;
  monthly_completed?: number;
  monthly_avg_minutes?: number | null;
};

type UserDetail = {
  user: User;
  documents: UserDocument[];
  salary_increments: UserSalaryIncrement[];
  leave_balances: UserLeaveBalance[];
  leave_entries: UserLeaveEntry[];
  payroll_ready: boolean;
  leave_balance_ready: boolean;
  leave_entry_ready: boolean;
  performance: {
    today_completed: number;
    month_completed: number;
    month_avg_minutes?: number | null;
    daily_progress: Array<{ date: string; completed: number; avg_minutes?: number | null }>;
    recent_work: Array<{ id: number; order_id: number; project_id: number; stage?: string | null; status: string; completed_at?: string | null; minutes?: number | null }>;
  };
};

export default function HRDashboard() {
  const currentUser = useSelector((state: RootState) => state.auth.user);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users'>('dashboard');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [stats, setStats] = useState<HrStats>({ total: 0, active: 0, inactive: 0, absent: 0, present: 0 });
  const emptyEmployeeAnalytics: EmployeeAnalytics = {
    summary: { total_employees: 0, active_employees: 0, new_joined: 0, left_this_month: 0, total_inactive: 0, probation_due: 0 },
    project_breakdown: [],
    probation_alerts: [],
  };
  const [employeeAnalytics, setEmployeeAnalytics] = useState<EmployeeAnalytics>(emptyEmployeeAnalytics);
  const [documentStats, setDocumentStats] = useState<DocumentStats>({
    active_total: 0,
    complete_required: 0,
    incomplete_docs: 0,
    no_documents: 0,
    uploaded_today: 0,
    today_hr_breakdown: [],
    missing: { copy_of_cnic: 0, two_pics: 0, nda: 0, contract_letter: 0 },
  });
  const [users, setUsers] = useState<HrUserRow[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, per_page: 25, total: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
  const [docStatus, setDocStatus] = useState('all');
  const [projectId, setProjectId] = useState<string>('all');
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [userMonth, setUserMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [documentsReady, setDocumentsReady] = useState(true);
  const [machineIdReady, setMachineIdReady] = useState(true);
  const [selectedUser, setSelectedUser] = useState<HrUserRow | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<UserDetail | null>(null);
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [documentFiles, setDocumentFiles] = useState<Partial<Record<typeof documentTypes[number]['value'], File[]>>>({});
  const [activeCameraType, setActiveCameraType] = useState<{ value: typeof documentTypes[number]['value']; label: string } | null>(null);
  const [editingUser, setEditingUser] = useState<HrUserRow | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    machine_id: '',
    role: 'drawer',
    project_id: '',
    department: 'floor_plan',
    layer: '',
    is_active: true,
    is_absent: false,
    daily_target: '',
    wip_limit: '',
    shift_start: '',
    shift_end: '',
    blood_group: '',
    contact_number: '',
    bank_account_number: '',
    joining_salary: '',
    salary: '',
  });
  const [incrementForm, setIncrementForm] = useState({
    increment_amount: '',
    effective_date: new Date().toISOString().slice(0, 10),
    notes: '',
  });
  const [leaveEntryForm, setLeaveEntryForm] = useState({
    leave_date: new Date().toISOString().slice(0, 10),
    leave_days: '1',
    reason: '',
  });
  const [leaveForm, setLeaveForm] = useState({
    year: String(new Date().getFullYear()),
    annual_allowed: '14',
    leaves_taken: '0',
    notes: '',
  });
  const [uploading, setUploading] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const [savingIncrement, setSavingIncrement] = useState(false);
  const [savingLeaves, setSavingLeaves] = useState(false);
  const [savingLeaveEntry, setSavingLeaveEntry] = useState(false);
  const [deletingDocumentId, setDeletingDocumentId] = useState<number | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ matched: number; preview: Array<Partial<User> & { inactive_days?: number }> } | null>(null);
  const [error, setError] = useState('');

  // Email / Sharing state
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [emailRecipient, setEmailRecipient] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [selectedEmailDocIds, setSelectedEmailDocIds] = useState<number[]>([]);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [copiedEmailText, setCopiedEmailText] = useState(false);
  const [emailSuccessMsg, setEmailSuccessMsg] = useState('');
  const [emailErrorMsg, setEmailErrorMsg] = useState('');

  const loadDashboard = useCallback(async () => {
    try {
      setLoadingDashboard(true);
      const res = await hrService.dashboard({ month, project_id: projectId });
      setStats(res.data.stats);
      setDocumentStats(res.data.document_stats || {
        active_total: 0,
        complete_required: 0,
        incomplete_docs: 0,
        no_documents: 0,
        uploaded_today: 0,
        today_hr_breakdown: [],
        missing: { copy_of_cnic: 0, two_pics: 0, nda: 0, contract_letter: 0 },
      });
      setEmployeeAnalytics(res.data.employee_analytics || emptyEmployeeAnalytics);
      setProjectOptions(res.data.project_options || []);
      setDocumentsReady(res.data.documents_ready);
      setMachineIdReady(res.data.machine_id_ready);
    } catch (e) {
      console.error(e);
      setError('Could not load HR dashboard.');
    } finally {
      setLoadingDashboard(false);
    }
  }, [month, projectId]);

  const loadUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const res = await hrService.users({
        page,
        per_page: 25,
        search,
        status,
        role,
        doc_status: docStatus,
        month: userMonth,
        project_id: projectId,
      });
      setUsers(res.data.data || []);
      setProjectOptions(res.data.project_options || []);
      setPagination({
        current_page: res.data.current_page || 1,
        last_page: res.data.last_page || 1,
        per_page: res.data.per_page || 25,
        total: res.data.total || 0,
      });
      setDocumentsReady(res.data.documents_ready);
      setMachineIdReady(res.data.machine_id_ready);
    } catch (e) {
      console.error(e);
      setError('Could not load users.');
    } finally {
      setLoadingUsers(false);
    }
  }, [page, search, status, role, docStatus, userMonth, projectId]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openDocuments = async (user: HrUserRow) => {
    setSelectedUser(user);
    setSelectedDetail(null);
    setDocumentFiles({});
    setError('');

    try {
      setLoadingDetail(true);
      const res = await hrService.userDetail(user.id, { month: userMonth });
      setSelectedDetail({
        user: res.data.user,
        documents: res.data.documents || [],
        salary_increments: res.data.salary_increments || [],
        leave_balances: res.data.leave_balances || [],
        leave_entries: res.data.leave_entries || [],
        payroll_ready: !!res.data.payroll_ready,
        leave_balance_ready: !!res.data.leave_balance_ready,
        leave_entry_ready: !!res.data.leave_entry_ready,
        performance: res.data.performance,
      });
      setDocuments(res.data.documents || []);
      setDocumentsReady(res.data.documents_ready);
      setMachineIdReady(res.data.machine_id_ready);
      const thisYear = new Date().getFullYear();
      const leaveBalance = (res.data.leave_balances || []).find(item => item.year === thisYear);
      setLeaveForm({
        year: String(thisYear),
        annual_allowed: String(leaveBalance?.annual_allowed ?? 14),
        leaves_taken: String(leaveBalance?.leaves_taken ?? 0),
        notes: leaveBalance?.notes || '',
      });
    } catch (e) {
      console.error(e);
      setDocuments([]);
      setError('Could not load user details.');
    } finally {
      setLoadingDetail(false);
    }
  };

  const openEditUser = (user: HrUserRow) => {
    setEditingUser(user);
    setEditForm({
      name: user.name || '',
      email: user.email || '',
      machine_id: user.machine_id || '',
      role: user.role || 'drawer',
      project_id: user.project_id ? String(user.project_id) : '',
      department: user.department || 'floor_plan',
      layer: user.layer || '',
      is_active: !!user.is_active,
      is_absent: !!user.is_absent,
      daily_target: user.daily_target != null ? String(user.daily_target) : '',
      wip_limit: user.wip_limit != null ? String(user.wip_limit) : '',
      shift_start: user.shift_start || '',
      shift_end: user.shift_end || '',
      blood_group: user.blood_group || '',
      contact_number: user.contact_number || '',
      bank_account_number: user.bank_account_number || '',
      joining_salary: user.joining_salary != null ? String(user.joining_salary) : '',
      salary: user.salary != null ? String(user.salary) : '',
    });
    setError('');
  };

  const saveUser = async () => {
    if (!editingUser) return;

    const payload: Partial<User> = {
      name: editForm.name,
      email: editForm.email,
      machine_id: editForm.machine_id || null,
      role: editForm.role as User['role'],
      project_id: editForm.project_id ? Number(editForm.project_id) : null,
      department: editForm.department,
      layer: editForm.layer || null,
      is_active: editForm.is_active,
      is_absent: editForm.is_absent,
      daily_target: editForm.daily_target === '' ? 0 : Number(editForm.daily_target),
      wip_limit: editForm.wip_limit === '' ? undefined : Number(editForm.wip_limit),
      shift_start: editForm.shift_start || null,
      shift_end: editForm.shift_end || null,
      blood_group: editForm.blood_group || null,
      contact_number: editForm.contact_number || null,
    };
    if (['ceo', 'hr', 'director'].includes(currentUser?.role || '')) {
      payload.bank_account_number = editForm.bank_account_number || null;
      payload.joining_salary = editForm.joining_salary === '' ? null : Number(editForm.joining_salary);
      payload.salary = editForm.salary === '' ? null : Number(editForm.salary);
    }

    try {
      setSavingUser(true);
      setError('');
      await hrService.updateUser(editingUser.id, payload);
      setEditingUser(null);
      await Promise.all([loadDashboard(), loadUsers()]);
    } catch (e: any) {
      console.error(e);
      setError(e.response?.data?.message || 'Could not update user.');
    } finally {
      setSavingUser(false);
    }
  };

  const reloadSelectedUserDetail = async () => {
    if (!selectedUser) return;

    const res = await hrService.userDetail(selectedUser.id, { month: userMonth });
    setSelectedDetail({
      user: res.data.user,
      documents: res.data.documents || [],
      salary_increments: res.data.salary_increments || [],
      leave_balances: res.data.leave_balances || [],
      leave_entries: res.data.leave_entries || [],
      payroll_ready: !!res.data.payroll_ready,
      leave_balance_ready: !!res.data.leave_balance_ready,
      leave_entry_ready: !!res.data.leave_entry_ready,
      performance: res.data.performance,
    });
    setDocuments(res.data.documents || []);
  };

  const addIncrement = async () => {
    if (!selectedUser || !incrementForm.increment_amount || !incrementForm.effective_date) return;

    try {
      setSavingIncrement(true);
      setError('');
      await hrService.addSalaryIncrement(selectedUser.id, {
        increment_amount: Number(incrementForm.increment_amount),
        effective_date: incrementForm.effective_date,
        notes: incrementForm.notes || null,
      });
      setIncrementForm({
        increment_amount: '',
        effective_date: new Date().toISOString().slice(0, 10),
        notes: '',
      });
      await reloadSelectedUserDetail();
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      setError(e.response?.data?.message || 'Could not add salary increment.');
    } finally {
      setSavingIncrement(false);
    }
  };

  const saveLeaveBalance = async () => {
    if (!selectedUser) return;

    try {
      setSavingLeaves(true);
      setError('');
      await hrService.updateLeaveBalance(selectedUser.id, {
        year: Number(leaveForm.year),
        annual_allowed: leaveForm.annual_allowed === '' ? 14 : Number(leaveForm.annual_allowed),
        leaves_taken: leaveForm.leaves_taken === '' ? 0 : Number(leaveForm.leaves_taken),
        notes: leaveForm.notes || null,
      });
      await reloadSelectedUserDetail();
    } catch (e: any) {
      console.error(e);
      setError(e.response?.data?.message || 'Could not update leave balance.');
    } finally {
      setSavingLeaves(false);
    }
  };

  const addLeaveEntry = async () => {
    if (!selectedUser || !leaveEntryForm.leave_date || !leaveEntryForm.reason.trim()) return;

    try {
      setSavingLeaveEntry(true);
      setError('');
      await hrService.addLeaveEntry(selectedUser.id, {
        leave_date: leaveEntryForm.leave_date,
        leave_days: leaveEntryForm.leave_days === '' ? 1 : Number(leaveEntryForm.leave_days),
        reason: leaveEntryForm.reason.trim(),
      });
      setLeaveEntryForm({
        leave_date: new Date().toISOString().slice(0, 10),
        leave_days: '1',
        reason: '',
      });
      await reloadSelectedUserDetail();
    } catch (e: any) {
      console.error(e);
      setError(e.response?.data?.message || 'Could not add leave record.');
    } finally {
      setSavingLeaveEntry(false);
    }
  };

  const uploadDocuments = async () => {
    if (!selectedUser) return;

    const data = new FormData();
    let index = 0;
    Object.entries(documentFiles).forEach(([type, files]) => {
      (files || []).forEach((file) => {
        data.append(`documents[${index}][document_type]`, type);
        data.append(`documents[${index}][file]`, file, file.name);
        index += 1;
      });
    });
    if (index === 0) return;

    try {
      setUploading(true);
      setError('');
      await hrService.uploadDocuments(selectedUser.id, data);
      const res = await hrService.userDetail(selectedUser.id, { month: userMonth });
      setSelectedDetail({
        user: res.data.user,
        documents: res.data.documents || [],
        salary_increments: res.data.salary_increments || [],
        leave_balances: res.data.leave_balances || [],
        leave_entries: res.data.leave_entries || [],
        payroll_ready: !!res.data.payroll_ready,
        leave_balance_ready: !!res.data.leave_balance_ready,
        leave_entry_ready: !!res.data.leave_entry_ready,
        performance: res.data.performance,
      });
      setDocuments(res.data.documents || []);
      setDocumentFiles({});
      await loadUsers();
    } catch (e: any) {
      console.error(e);
      setError(e.response?.data?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const downloadDocument = async (doc: UserDocument) => {
    try {
      const res = await hrService.downloadDocument(doc.id);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = doc.original_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      console.error(e);
      setError('Download failed.');
    }
  };

  const deleteDocument = async (doc: UserDocument) => {
    if (!selectedUser) return;

    const confirmed = window.confirm(`Delete "${doc.original_name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      setDeletingDocumentId(doc.id);
      setError('');
      await hrService.deleteDocument(doc.id);
      const remainingDocuments = documents.filter(item => item.id !== doc.id);
      setDocuments(remainingDocuments);
      setSelectedDetail(prev => prev ? { ...prev, documents: remainingDocuments } : prev);
      await Promise.all([loadDashboard(), loadUsers()]);
    } catch (e: any) {
      console.error(e);
      setError(e.response?.data?.message || 'Delete failed.');
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const openEmailModal = (preselectDocId?: number) => {
    if (!selectedDetail) return;
    const candUser = selectedDetail.user;
    setEmailRecipient(candUser.email || '');
    const defaultSubject = `Benchmark Studio - Offer Letter & NDA Documents - ${candUser.name || 'Candidate'}`;
    setEmailSubject(defaultSubject);
    const defaultBody = `Dear ${candUser.name || 'Candidate'},\n\nWe are pleased to share your Appointment / Offer Letter and Non-Disclosure Agreement (NDA) for Benchmark Studio.\n\nPlease find attached the official documents for your review and records.\n\nIf you have any questions or require any assistance, please feel free to reach out to the HR department.\n\nBest regards,\nHR Department\nBenchmark Studio`;
    setEmailBody(defaultBody);

    if (preselectDocId) {
      setSelectedEmailDocIds([preselectDocId]);
    } else {
      const targetDocs = documents.filter(d => d.document_type === 'nda' || d.document_type === 'contract_letter');
      if (targetDocs.length > 0) {
        setSelectedEmailDocIds(targetDocs.map(d => d.id));
      } else {
        setSelectedEmailDocIds(documents.map(d => d.id));
      }
    }

    setEmailSuccessMsg('');
    setEmailErrorMsg('');
    setCopiedEmailText(false);
    setEmailModalOpen(true);
  };

  const downloadSelectedDocsForMail = async (docIds: number[]) => {
    const docsToDownload = documents.filter(d => docIds.includes(d.id));
    for (let i = 0; i < docsToDownload.length; i++) {
      const doc = docsToDownload[i];
      try {
        const res = await hrService.downloadDocument(doc.id);
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        link.download = doc.original_name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);
        if (i < docsToDownload.length - 1) {
          await new Promise(r => setTimeout(r, 400));
        }
      } catch (e) {
        console.error('Error downloading doc:', e);
      }
    }
  };

  const handleOpenGmail = async () => {
    if (!emailRecipient.trim()) {
      setEmailErrorMsg('Please enter a recipient email address.');
      return;
    }
    setEmailErrorMsg('');
    if (selectedEmailDocIds.length > 0) {
      await downloadSelectedDocsForMail(selectedEmailDocIds);
    }
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(emailRecipient.trim())}&su=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.open(gmailUrl, '_blank');
    setEmailSuccessMsg('Gmail compose window opened! Documents downloaded for instant attachment.');
  };

  const handleOpenOutlook = async () => {
    if (!emailRecipient.trim()) {
      setEmailErrorMsg('Please enter a recipient email address.');
      return;
    }
    setEmailErrorMsg('');
    if (selectedEmailDocIds.length > 0) {
      await downloadSelectedDocsForMail(selectedEmailDocIds);
    }
    const mailtoUrl = `mailto:${encodeURIComponent(emailRecipient.trim())}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;
    window.location.href = mailtoUrl;
    setEmailSuccessMsg('Outlook / Mail client opened! Documents downloaded for instant attachment.');
  };

  const handleDirectServerSend = async () => {
    if (!selectedUser) return;
    if (!emailRecipient.trim()) {
      setEmailErrorMsg('Please enter a recipient email address.');
      return;
    }
    if (selectedEmailDocIds.length === 0) {
      setEmailErrorMsg('Please select at least one document to attach.');
      return;
    }
    try {
      setSendingEmail(true);
      setEmailErrorMsg('');
      setEmailSuccessMsg('');
      const res = await hrService.emailDocuments(selectedUser.id, {
        email: emailRecipient.trim(),
        subject: emailSubject,
        message: emailBody,
        document_ids: selectedEmailDocIds,
      });
      setEmailSuccessMsg(res.data.message || 'Email sent successfully with attachments!');
    } catch (e: any) {
      console.error(e);
      setEmailErrorMsg(e.response?.data?.message || 'Failed to send email. Check SMTP configuration or use the Gmail / Outlook buttons.');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleCopyEmailText = () => {
    const textToCopy = `To: ${emailRecipient}\nSubject: ${emailSubject}\n\n${emailBody}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedEmailText(true);
    setTimeout(() => setCopiedEmailText(false), 2500);
  };

  const previewDeactivate = async () => {
    try {
      setDeactivating(true);
      setError('');
      const res = await hrService.deactivateLongAbsent({ days: 15, dry_run: true });
      setConfirmDeactivate({ matched: res.data.matched, preview: res.data.preview || [] });
    } catch (e: any) {
      console.error(e);
      setError(e.response?.data?.message || 'Could not check absent users.');
    } finally {
      setDeactivating(false);
    }
  };

  const runDeactivate = async () => {
    try {
      setDeactivating(true);
      setError('');
      await hrService.deactivateLongAbsent({ days: 15, dry_run: false });
      setConfirmDeactivate(null);
      setStatus('inactive');
      setPage(1);
      await Promise.all([loadDashboard(), loadUsers()]);
    } catch (e: any) {
      console.error(e);
      setError(e.response?.data?.message || 'Could not deactivate absent users.');
    } finally {
      setDeactivating(false);
    }
  };

  const startResult = pagination.total === 0 ? 0 : ((pagination.current_page - 1) * pagination.per_page) + 1;
  const endResult = Math.min(pagination.current_page * pagination.per_page, pagination.total);
  const documentLabel = useMemo(() => Object.fromEntries(documentTypes.map(type => [type.value, type.label])), []);
  const requiredDocumentCards = [
    { key: 'complete', label: 'Complete Docs', badge: '4/4 Ready', value: documentStats.complete_required, tone: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:border-emerald-300', activeTone: 'bg-emerald-100 text-emerald-900 border-emerald-500 ring-2 ring-emerald-500' },
    { key: 'incomplete', label: 'Partial / Incomplete', badge: '1-3 Uploaded', value: documentStats.incomplete_docs, tone: 'bg-amber-50 text-amber-800 border-amber-200 hover:border-amber-300', activeTone: 'bg-amber-100 text-amber-900 border-amber-500 ring-2 ring-amber-500' },
    { key: 'uploaded_today', label: 'Uploaded Today', badge: 'Today', value: documentStats.uploaded_today, tone: 'bg-teal-50 text-teal-800 border-teal-200 hover:border-teal-300', activeTone: 'bg-teal-100 text-teal-900 border-teal-500 ring-2 ring-teal-500' },
    { key: 'no_docs', label: 'No Docs', badge: '0 Docs', value: documentStats.no_documents, tone: 'bg-rose-50 text-rose-700 border-rose-200 hover:border-rose-300', activeTone: 'bg-rose-100 text-rose-900 border-rose-500 ring-2 ring-rose-500' },
    { key: 'missing_cnic', label: 'CNIC Missing', badge: 'CNIC', value: documentStats.missing.copy_of_cnic, tone: 'bg-orange-50 text-orange-700 border-orange-200 hover:border-orange-300', activeTone: 'bg-orange-100 text-orange-900 border-orange-500 ring-2 ring-orange-500' },
    { key: 'missing_pics', label: 'Pics Missing', badge: '2 Photos', value: documentStats.missing.two_pics, tone: 'bg-sky-50 text-sky-700 border-sky-200 hover:border-sky-300', activeTone: 'bg-sky-100 text-sky-900 border-sky-500 ring-2 ring-sky-500' },
    { key: 'missing_nda', label: 'NDA Missing', badge: 'NDA', value: documentStats.missing.nda, tone: 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:border-indigo-300', activeTone: 'bg-indigo-100 text-indigo-900 border-indigo-500 ring-2 ring-indigo-500' },
    { key: 'missing_contract', label: 'Contract Missing', badge: 'Appointment', value: documentStats.missing.contract_letter, tone: 'bg-purple-50 text-purple-700 border-purple-200 hover:border-purple-300', activeTone: 'bg-purple-100 text-purple-900 border-purple-500 ring-2 ring-purple-500' },
  ];
  const rankedProjectMovement = useMemo(() => (
    employeeAnalytics.project_breakdown
      .map(row => ({
        ...row,
        movement_score: row.new_joined + row.left_this_month,
      }))
      .sort((a, b) => (
        b.movement_score - a.movement_score
        || b.left_this_month - a.left_this_month
        || b.new_joined - a.new_joined
        || a.project_name.localeCompare(b.project_name)
      ))
  ), [employeeAnalytics.project_breakdown]);
  const chartProjectMovement = rankedProjectMovement.slice(0, 8);
  const movementTotals = useMemo(() => {
    const newJoined = employeeAnalytics.summary.new_joined || 0;
    const leftThisMonth = employeeAnalytics.summary.left_this_month || 0;
    return {
      newJoined,
      leftThisMonth,
      totalMovement: newJoined + leftThisMonth,
      activeProjects: rankedProjectMovement.filter(row => row.movement_score > 0).length,
    };
  }, [employeeAnalytics.summary, rankedProjectMovement]);
  const maxMovementScore = Math.max(1, ...chartProjectMovement.map(row => row.movement_score));
  const movementSegments = [
    { label: 'New Joined', value: movementTotals.newJoined, color: '#14b8a6' },
    { label: 'Left This Month', value: movementTotals.leftThisMonth, color: '#f43f5e' },
  ];
  const protectedEditRoles = new Set(['ceo', 'director']);
  const selectedFilesCount = useMemo(
    () => Object.values(documentFiles).reduce((total, files) => total + (files?.length || 0), 0),
    [documentFiles],
  );
  const canViewPayroll = ['ceo', 'hr', 'director'].includes(currentUser?.role || '');
  const currentLeaveBalance = selectedDetail?.leave_balances.find(item => item.year === Number(leaveForm.year))
    || selectedDetail?.leave_balances[0];
  const formatMoney = (value?: number | string | null) => {
    if (value === null || value === undefined || value === '') return '---';
    const amount = Number(value);
    if (Number.isNaN(amount)) return '---';
    return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  return (
    <AnimatedPage>
      <PageHeader title="HR Panel" subtitle="Employee records, documents, and HR movement" />

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {(!documentsReady || !machineIdReady) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          HR database setup is pending. Run `database/sql/create_user_machine_documents.sql` in cPanel/phpMyAdmin.
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`rounded-md px-4 py-2 text-sm font-medium ${activeTab === 'dashboard' ? 'bg-brand-primary text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`rounded-md px-4 py-2 text-sm font-medium ${activeTab === 'users' ? 'bg-brand-primary text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Employee Data
          </button>
        </div>
        <select
          value={projectId}
          onChange={e => { setProjectId(e.target.value); setPage(1); }}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none lg:w-72"
        >
          <option value="all">All Projects</option>
          {projectOptions.map(project => (
            <option key={project.id} value={project.id}>
              {project.name}{project.code ? ` (${project.code})` : ''}
            </option>
          ))}
        </select>
      </div>

      {activeTab === 'dashboard' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              { label: 'Total', value: stats.total, icon: Users, tone: 'bg-slate-100 text-slate-600' },
              { label: 'Active', value: stats.active, icon: UserCheck, tone: 'bg-emerald-50 text-emerald-700' },
              { label: 'Inactive', value: stats.inactive, icon: UserX, tone: 'bg-slate-100 text-slate-600' },
              { label: 'Present', value: stats.present, icon: Activity, tone: 'bg-blue-50 text-blue-700' },
              { label: 'Absent', value: stats.absent, icon: AlertCircle, tone: 'bg-amber-50 text-amber-700' },
            ].map((item) => (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${item.tone}`}>
                  <item.icon className="h-5 w-5" />
                </div>
                <div className="text-2xl font-bold text-slate-900">{item.value}</div>
                <div className="text-xs text-slate-500">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">HR Movement Overview</h2>
                  <p className="text-xs text-slate-500">
                    Overall movement and highest-change projects for the selected month
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <Calendar className="h-4 w-4" />
                  <input
                    type="month"
                    value={month}
                    onChange={e => setMonth(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                  />
                </label>
              </div>
              <div className="p-4">
                {loadingDashboard ? (
                  <div className="flex h-80 items-center justify-center text-sm text-slate-500">Loading employee movement...</div>
                ) : rankedProjectMovement.length === 0 ? (
                  <div className="flex h-80 items-center justify-center text-sm text-slate-500">No employee movement found.</div>
                ) : (
                  <div className="grid gap-4 2xl:grid-cols-[0.34fr_0.66fr]">
                    <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                      <div className="grid items-center gap-4 sm:grid-cols-[132px_1fr] 2xl:grid-cols-1">
                        <div className="relative mx-auto h-32 w-32">
                          <div
                            className="absolute inset-0 rounded-full"
                            style={{
                              background: `conic-gradient(#14b8a6 0 ${movementTotals.totalMovement ? (movementTotals.newJoined / movementTotals.totalMovement) * 100 : 0}%, #f43f5e ${movementTotals.totalMovement ? (movementTotals.newJoined / movementTotals.totalMovement) * 100 : 0}% 100%)`,
                            }}
                          />
                          <div className="absolute inset-3 rounded-full bg-white shadow-inner" />
                          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                            <span className="text-[10px] font-semibold uppercase text-slate-400">Movement</span>
                            <span className="text-2xl font-bold text-slate-950">{movementTotals.totalMovement}</span>
                            <span className="text-xs text-slate-500">{month}</span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase text-slate-500">Total Movement</p>
                              <p className="text-xs text-slate-400">Joined and left this month</p>
                            </div>
                            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm">
                              {movementTotals.activeProjects} projects
                            </span>
                          </div>
                          {movementSegments.map(segment => {
                            const percent = movementTotals.totalMovement
                              ? Math.round((segment.value / movementTotals.totalMovement) * 100)
                              : 0;
                            return (
                              <div key={segment.label} className="rounded-lg bg-white px-3 py-2 shadow-sm">
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex items-center gap-2">
                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                                    <span className="text-xs font-semibold text-slate-700">{segment.label}</span>
                                  </div>
                                  <div className="text-sm font-bold text-slate-950">{segment.value}</div>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: segment.color }} />
                                </div>
                                <div className="mt-1 text-right text-[11px] text-slate-400">{percent}%</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase text-slate-500">Project Ranking</p>
                          <p className="text-xs text-slate-400">Graph view, highest movement first</p>
                        </div>
                        <div className="hidden items-center gap-3 text-[11px] text-slate-500 sm:flex">
                          {movementSegments.map(segment => (
                            <span key={segment.label} className="flex items-center gap-1">
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
                              {segment.label}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        {chartProjectMovement.map((row, index) => {
                          const totalWidth = Math.max(4, (row.movement_score / maxMovementScore) * 100);
                          const leftWidth = row.movement_score ? (row.left_this_month / row.movement_score) * totalWidth : 0;
                          const newWidth = row.movement_score ? (row.new_joined / row.movement_score) * totalWidth : 0;

                          return (
                            <div key={row.project_name} className="grid items-center gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 shadow-sm md:grid-cols-[155px_1fr_52px]">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-500">
                                  {index + 1}
                                </span>
                                <span className="truncate text-sm font-semibold text-slate-900">{row.project_name}</span>
                              </div>
                              <div>
                                <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
                                  <div className="h-full bg-rose-500" style={{ width: `${leftWidth}%` }} />
                                  <div className="h-full bg-teal-500" style={{ width: `${newWidth}%` }} />
                                </div>
                                <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                                  <span><strong className="text-rose-600">{row.left_this_month}</strong> left</span>
                                  <span><strong className="text-teal-700">{row.new_joined}</strong> joined</span>
                                </div>
                              </div>
                              <div className="text-right text-sm font-bold text-slate-900">
                                {row.movement_score}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Probation Completion Alert</h2>
                <p className="text-xs text-slate-500">Employees at 90-93 days are shown</p>
              </div>
              <div className="max-h-80 overflow-y-auto">
                {loadingDashboard ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">Loading alerts...</div>
                ) : employeeAnalytics.probation_alerts.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">No probation alerts today.</div>
                ) : employeeAnalytics.probation_alerts.map(employee => (
                  <div key={employee.id} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{employee.name}</div>
                        <div className="truncate text-xs text-slate-500">{employee.email || '---'}</div>
                      </div>
                      <span className="rounded-full bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">
                        {employee.days_completed ?? 90} days
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <StatusBadge status={employee.role || 'unknown'} />
                      <span>{employee.project_name || 'No Project'}</span>
                      {employee.machine_id && <span>Machine {employee.machine_id}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Project Summary</h2>
              <p className="text-xs text-slate-500">Filtered by selected month and project</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">Project</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Active</th>
                    <th className="px-4 py-3 text-right">New Joined</th>
                    <th className="px-4 py-3 text-right">Left This Month</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rankedProjectMovement.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No project data found.</td></tr>
                  ) : rankedProjectMovement.map(row => (
                    <tr key={row.project_name}>
                      <td className="px-4 py-3 font-medium text-slate-900">{row.project_name}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.total_employees}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{row.active_employees}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-700">{row.new_joined}</td>
                      <td className="px-4 py-3 text-right font-semibold text-rose-700">{row.left_this_month}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Active User Documents</h2>
                <p className="text-xs text-slate-500">
                  Required documents checked for {documentStats.active_total} active users &bull; Click any card for 1-click filter
                </p>
              </div>
              {docStatus !== 'all' && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800 border border-teal-200">
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-600 animate-pulse" />
                    Filter: {requiredDocumentCards.find(c => c.key === docStatus)?.label || docStatus}
                  </span>
                  <button
                    type="button"
                    onClick={() => { setDocStatus('all'); setPage(1); }}
                    className="text-xs font-medium text-slate-500 hover:text-rose-600 hover:underline cursor-pointer"
                  >
                    Clear Filter
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4 xl:grid-cols-8 overflow-visible">
              {requiredDocumentCards.map(item => {
                const isSelected = docStatus === item.key;
                const isTodayCard = item.key === 'uploaded_today';
                return (
                  <div key={item.key} className="relative group overflow-visible">
                    <button
                      type="button"
                      onClick={() => {
                        setDocStatus(curr => (curr === item.key ? 'all' : item.key));
                        setPage(1);
                      }}
                      title={`Click to filter by ${item.label}`}
                      className={`w-full text-left rounded-xl p-3 border transition-all duration-150 cursor-pointer relative flex flex-col justify-between h-full min-h-[96px] ${
                        isSelected
                          ? item.activeTone
                          : `${item.tone} hover:shadow-md hover:scale-[1.02]`
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-2xl font-black tracking-tight">{item.value}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                          isSelected ? 'bg-white/80 text-slate-900 shadow-xs' : 'bg-white/60 text-slate-700'
                        }`}>
                          {item.badge}
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="text-xs font-bold leading-tight">{item.label}</div>
                        <div className="mt-0.5 text-[10px] opacity-75 truncate">
                          {isSelected ? 'Active filter' : (isTodayCard ? 'Hover for HR stats' : 'Click to filter')}
                        </div>
                      </div>
                    </button>

                    {/* HR Hover Breakdown Popover for Uploaded Today */}
                    {isTodayCard && (
                      <div className="hidden group-hover:block absolute left-1/2 -translate-x-1/2 top-full mt-2 z-[60] w-72 bg-slate-900/95 text-white rounded-xl shadow-2xl p-3.5 text-left border border-slate-700 pointer-events-none transition-all duration-200">
                        <div className="flex items-center justify-between border-b border-slate-700/80 pb-2 mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-teal-400 animate-ping" />
                            <span className="text-xs font-bold uppercase tracking-wider text-teal-300">Today's HR Uploads</span>
                          </div>
                          <span className="text-[10px] text-slate-400 font-medium">
                            {documentStats.today_hr_breakdown?.length || 0} HR active
                          </span>
                        </div>
                        {(!documentStats.today_hr_breakdown || documentStats.today_hr_breakdown.length === 0) ? (
                          <div className="text-xs text-slate-400 py-2 text-center">No uploads recorded today yet.</div>
                        ) : (
                          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                            {documentStats.today_hr_breakdown.map(hr => (
                              <div key={hr.hr_id} className="flex items-center justify-between gap-2 text-xs bg-slate-800/90 rounded-lg px-2.5 py-2 border border-slate-700/60 shadow-xs">
                                <div className="min-w-0 flex items-center gap-2">
                                  <div className="h-6 w-6 rounded-full bg-teal-600/40 text-teal-300 flex items-center justify-center font-bold text-[11px] shrink-0 border border-teal-500/40">
                                    {hr.hr_name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-semibold text-slate-100 truncate text-xs">{hr.hr_name}</div>
                                    <div className="text-[10px] text-slate-400 truncate">{hr.users_count} {hr.users_count === 1 ? 'employee' : 'employees'}</div>
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-teal-500/25 text-teal-300 text-[11px] font-bold border border-teal-500/40">
                                    {hr.documents_count} {hr.documents_count === 1 ? 'doc' : 'docs'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="mt-2.5 pt-2 border-t border-slate-700/80 flex items-center justify-between text-[11px] text-slate-400">
                          <span>Total Uploads Today:</span>
                          <span className="font-bold text-teal-300">
                            {documentStats.today_hr_breakdown?.reduce((sum, h) => sum + h.documents_count, 0) || documentStats.uploaded_today} Files
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 xl:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search employees, email, machine ID"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-3 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </div>
            <select
              value={docStatus}
              onChange={e => { setDocStatus(e.target.value); setPage(1); }}
              className={`rounded-lg border px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none ${
                docStatus !== 'all' ? 'border-teal-500 bg-teal-50/70 font-semibold text-teal-900' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <option value="all">All Documents</option>
              <option value="incomplete">Partial / Incomplete Docs (1-3)</option>
              <option value="uploaded_today">Uploaded Today</option>
              <option value="complete">Complete Docs (4/4)</option>
              <option value="no_docs">No Documents (0/4)</option>
              <option value="missing_cnic">CNIC Missing</option>
              <option value="missing_pics">2 Pics Missing</option>
              <option value="missing_nda">NDA Missing</option>
              <option value="missing_contract">Appointment Letter Missing</option>
            </select>
            <select
              value={role}
              onChange={e => { setRole(e.target.value); setPage(1); }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
            >
              <option value="all">All Roles</option>
              <option value="drawer">Drawer</option>
              <option value="checker">Checker</option>
              <option value="filler">Filler</option>
              <option value="qa">QA</option>
              <option value="designer">Designer</option>
              <option value="project_manager">Project Manager</option>
              <option value="operations_manager">Ops Manager</option>
              <option value="director">Director</option>
              <option value="accounts_manager">Accounts</option>
              <option value="hr">HR</option>
            </select>
            <select
              value={projectId}
              onChange={e => { setProjectId(e.target.value); setPage(1); }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
            >
              <option value="all">All Projects</option>
              {projectOptions.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}{project.code ? ` (${project.code})` : ''}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={e => { setStatus(e.target.value); setPage(1); }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
              <option value="absent_15_plus">Absent 15+ Days</option>
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              <Calendar className="h-4 w-4" />
              <input
                type="month"
                value={userMonth}
                onChange={e => { setUserMonth(e.target.value); setPage(1); }}
                className="bg-transparent focus:outline-none"
              />
            </label>
            <Button variant="danger" size="sm" onClick={previewDeactivate} loading={deactivating} icon={<ShieldCheck className="h-4 w-4" />}>
              Inactive 15+ Absent
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Machine ID</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-left">Project</th>
                    <th className="px-4 py-3 text-left">Attendance</th>
                    <th className="px-4 py-3 text-left">Added On</th>
                    <th className="px-4 py-3 text-right">Month Work</th>
                    <th className="px-4 py-3 text-right">Inactive Days</th>
                    <th className="px-4 py-3 text-right">Documents</th>
                    <th className="px-4 py-3 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingUsers ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-500">No employees found.</td></tr>
                  ) : users.map((row) => (
                    <tr key={row.id} onClick={() => openDocuments(row)} className="cursor-pointer hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{row.name}</div>
                        <div className="text-xs text-slate-400">{row.email}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.machine_id || '---'}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.role} /></td>
                      <td className="px-4 py-3 text-slate-600">{row.project?.name || '---'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusBadge status={row.is_active ? 'active' : 'inactive'} />
                          {row.is_absent ? <StatusBadge status="absent" /> : <StatusBadge status="present" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.created_at ? new Date(row.created_at).toLocaleDateString() : '---'}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.monthly_completed || 0}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{row.inactive_days || 0}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="secondary" onClick={(event) => { event.stopPropagation(); openDocuments(row); }} icon={<FileText className="h-4 w-4" />}>
                          Details ({row.documents_count || 0})
                        </Button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {protectedEditRoles.has(row.role) ? (
                          <span className="text-xs text-slate-400">Protected</span>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={(event) => { event.stopPropagation(); openEditUser(row); }} icon={<Edit className="h-4 w-4" />}>
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
            <span className="text-slate-500">Showing {startResult}-{endResult} of {pagination.total}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={pagination.current_page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Prev</Button>
              <span className="text-xs text-slate-600">Page {pagination.current_page} of {pagination.last_page}</span>
              <Button size="sm" variant="secondary" disabled={pagination.current_page >= pagination.last_page} onClick={() => setPage(p => Math.min(pagination.last_page, p + 1))}>Next</Button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={!!selectedUser}
        onClose={() => {
          setSelectedUser(null);
          setSelectedDetail(null);
          setDocumentFiles({});
        }}
        title={selectedUser ? selectedUser.name : 'User Details'}
        subtitle={selectedUser ? `${selectedUser.email} ${selectedUser.machine_id ? `- ${selectedUser.machine_id}` : ''}` : undefined}
        size="full"
      >
        {loadingDetail ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">Loading user details...</div>
        ) : !selectedDetail ? (
          <div className="px-4 py-12 text-center text-sm text-slate-500">No detail available.</div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase text-slate-500">Role</div>
                <div className="mt-2"><StatusBadge status={selectedDetail.user.role} /></div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase text-slate-500">Attendance</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusBadge status={selectedDetail.user.is_active ? 'active' : 'inactive'} />
                  <StatusBadge status={selectedDetail.user.is_absent ? 'absent' : 'present'} />
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase text-slate-500">Absent Days</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{selectedDetail.user.inactive_days ?? 0}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase text-slate-500">Today Done</div>
                <div className="mt-1 text-2xl font-bold text-slate-900">{selectedDetail.performance.today_completed}</div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
              <div className="rounded-lg border border-slate-200">
                <div className="border-b border-slate-100 px-4 py-3">
                  <h3 className="text-sm font-semibold text-slate-900">Complete Details</h3>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
                  {[
                    ['Machine ID', selectedDetail.user.machine_id || '---'],
                    ['Blood Group', selectedDetail.user.blood_group || '---'],
                    ['Contact', selectedDetail.user.contact_number || '---'],
                    ['Project', selectedDetail.user.project?.name || '---'],
                    ['Team', selectedDetail.user.team?.name || '---'],
                    ['Department', selectedDetail.user.department || '---'],
                    ['Country', selectedDetail.user.country || '---'],
                    ['Layer', selectedDetail.user.layer || '---'],
                    ...(canViewPayroll ? [
                      ['Bank Account', selectedDetail.user.bank_account_number || '---'],
                      ['Joining Salary', formatMoney(selectedDetail.user.joining_salary)],
                      ['Current Salary', formatMoney(selectedDetail.user.salary)],
                    ] : []),
                    ['Saved Target', selectedDetail.user.daily_target ? selectedDetail.user.daily_target : 'Not set'],
                    ['Today Done', selectedDetail.performance.today_completed],
                    ['WIP', `${selectedDetail.user.wip_count ?? 0}/${selectedDetail.user.wip_limit ?? 0}`],
                    ['Shift Start', selectedDetail.user.shift_start || '---'],
                    ['Shift End', selectedDetail.user.shift_end || '---'],
                    ['Added On', selectedDetail.user.created_at ? new Date(selectedDetail.user.created_at).toLocaleDateString() : '---'],
                    ['Last Activity', selectedDetail.user.last_activity ? new Date(selectedDetail.user.last_activity).toLocaleString() : '---'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <div className="text-xs uppercase text-slate-400">{label}</div>
                      <div className="mt-1 font-medium text-slate-800">{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Monthly Progress</h3>
                    <p className="text-xs text-slate-500">{userMonth}</p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold text-slate-900">{selectedDetail.performance.month_completed}</div>
                    <div className="text-xs text-slate-500">completed</div>
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Date</th>
                        <th className="px-4 py-3 text-right">Done</th>
                        <th className="px-4 py-3 text-right">Avg Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedDetail.performance.daily_progress.length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-500">No monthly work found.</td></tr>
                      ) : selectedDetail.performance.daily_progress.map(row => (
                        <tr key={row.date}>
                          <td className="px-4 py-3 text-slate-700">{new Date(row.date).toLocaleDateString()}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.completed}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{row.avg_minutes ? `${row.avg_minutes}m` : '---'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
              {canViewPayroll && (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-2 border-b border-slate-100 bg-slate-50/70 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-xs font-semibold uppercase text-slate-900">Salary & Increment</h3>
                      <p className="text-[11px] text-slate-500">Joining salary, current salary, and increment history</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-right">
                      <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5">
                        <div className="text-[10px] font-medium uppercase text-slate-400">Joining</div>
                        <div className="text-xs font-bold text-slate-900">{formatMoney(selectedDetail.user.joining_salary)}</div>
                      </div>
                      <div className="rounded-md border border-emerald-100 bg-emerald-50 px-2.5 py-1.5">
                        <div className="text-[10px] font-medium uppercase text-emerald-600">Current</div>
                        <div className="text-xs font-bold text-emerald-800">{formatMoney(selectedDetail.user.salary)}</div>
                      </div>
                    </div>
                  </div>
                  {!selectedDetail.payroll_ready ? (
                    <div className="px-4 py-6 text-sm text-amber-700">Payroll table is pending. Run migrations first.</div>
                  ) : (
                    <div className="space-y-3 p-3">
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                        <div className="mb-2 text-[11px] font-semibold uppercase text-slate-500">Add Increment</div>
                        <div className="grid gap-2 md:grid-cols-[1fr_1fr]">
                        <label className="text-xs">
                          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Increment Amount</span>
                          <input
                            type="number"
                            min={0}
                            value={incrementForm.increment_amount}
                            onChange={e => setIncrementForm(prev => ({ ...prev, increment_amount: e.target.value }))}
                            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs focus:border-teal-500 focus:bg-white focus:outline-none"
                          />
                        </label>
                        <label className="text-xs">
                          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Effective Date</span>
                          <input
                            type="date"
                            value={incrementForm.effective_date}
                            onChange={e => setIncrementForm(prev => ({ ...prev, effective_date: e.target.value }))}
                            className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs focus:border-teal-500 focus:bg-white focus:outline-none"
                          />
                        </label>
                        </div>
                        <div className="mt-2 flex gap-2">
                          <input
                            value={incrementForm.notes}
                            onChange={e => setIncrementForm(prev => ({ ...prev, notes: e.target.value }))}
                            placeholder="Notes"
                            className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs focus:border-teal-500 focus:outline-none"
                          />
                          <Button size="sm" onClick={addIncrement} loading={savingIncrement} disabled={!incrementForm.increment_amount}>
                            Add Increment
                          </Button>
                        </div>
                      </div>
                      <div className="max-h-36 overflow-y-auto rounded-lg border border-slate-100 bg-white">
                        {selectedDetail.salary_increments.length === 0 ? (
                          <div className="px-3 py-4 text-center text-xs text-slate-500">No increments added.</div>
                        ) : selectedDetail.salary_increments.map(item => (
                          <div key={item.id} className="grid gap-2 border-b border-slate-100 px-3 py-2 text-xs last:border-b-0 md:grid-cols-[1fr_auto]">
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900">
                                +{formatMoney(item.increment_amount)} on {item.effective_date ? new Date(item.effective_date).toLocaleDateString() : '---'}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {formatMoney(item.previous_salary)} to {formatMoney(item.new_salary)}
                              </div>
                              {item.notes && <div className="mt-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] text-slate-500">{item.notes}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-3 py-2.5">
                  <div>
                    <h3 className="text-xs font-semibold uppercase text-slate-900">Annual Leaves</h3>
                    <p className="text-[11px] text-slate-500">Default yearly allowance is 14 leaves</p>
                  </div>
                  <div className="rounded-md border border-teal-100 bg-teal-50 px-2.5 py-1.5 text-right">
                    <div className="text-[10px] font-medium uppercase text-teal-600">Remaining</div>
                    <div className="text-sm font-bold text-teal-800">{currentLeaveBalance?.leaves_remaining ?? 14}</div>
                  </div>
                </div>
                {!selectedDetail.leave_balance_ready ? (
                  <div className="px-4 py-6 text-sm text-amber-700">Leave balance table is pending. Run migrations first.</div>
                ) : (
                  <div className="space-y-3 p-3">
                    {selectedDetail.leave_entry_ready ? (
                      <div className="rounded-lg border border-slate-100 bg-slate-50 p-2.5">
                        <div className="mb-2 text-[11px] font-semibold uppercase text-slate-500">Add Leave Record</div>
                        <div className="grid gap-2 md:grid-cols-[1fr_0.6fr_1.3fr_auto]">
                          <input
                            type="date"
                            value={leaveEntryForm.leave_date}
                            onChange={e => setLeaveEntryForm(prev => ({ ...prev, leave_date: e.target.value }))}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs focus:border-teal-500 focus:outline-none"
                          />
                          <input
                            type="number"
                            min={1}
                            max={14}
                            value={leaveEntryForm.leave_days}
                            onChange={e => setLeaveEntryForm(prev => ({ ...prev, leave_days: e.target.value }))}
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs focus:border-teal-500 focus:outline-none"
                          />
                          <input
                            value={leaveEntryForm.reason}
                            onChange={e => setLeaveEntryForm(prev => ({ ...prev, reason: e.target.value }))}
                            placeholder="Reason"
                            className="rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs focus:border-teal-500 focus:outline-none"
                          />
                          <Button size="sm" onClick={addLeaveEntry} loading={savingLeaveEntry} disabled={!leaveEntryForm.reason.trim()}>
                            Add
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                        Leave record table is pending. Run migrations first.
                      </div>
                    )}

                    <div className="rounded-lg border border-slate-100 p-2.5">
                      <div className="mb-2 text-[11px] font-semibold uppercase text-slate-500">Yearly Balance</div>
                      <div className="grid gap-2 md:grid-cols-3">
                      <label className="text-xs">
                        <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Year</span>
                        <input
                          type="number"
                          value={leaveForm.year}
                          onChange={e => setLeaveForm(prev => ({ ...prev, year: e.target.value }))}
                          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs focus:border-teal-500 focus:bg-white focus:outline-none"
                        />
                      </label>
                      <label className="text-xs">
                        <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Allowed</span>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          value={leaveForm.annual_allowed}
                          onChange={e => setLeaveForm(prev => ({ ...prev, annual_allowed: e.target.value }))}
                          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs focus:border-teal-500 focus:bg-white focus:outline-none"
                        />
                      </label>
                      <label className="text-xs">
                        <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">Taken</span>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          value={leaveForm.leaves_taken}
                          onChange={e => setLeaveForm(prev => ({ ...prev, leaves_taken: e.target.value }))}
                          className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs focus:border-teal-500 focus:bg-white focus:outline-none"
                        />
                      </label>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <input
                          value={leaveForm.notes}
                          onChange={e => setLeaveForm(prev => ({ ...prev, notes: e.target.value }))}
                          placeholder="Notes"
                          className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs focus:border-teal-500 focus:bg-white focus:outline-none"
                        />
                        <Button size="sm" onClick={saveLeaveBalance} loading={savingLeaves}>Save Leaves</Button>
                      </div>
                    </div>
                    <div className="grid gap-1.5">
                      {selectedDetail.leave_balances.length === 0 ? (
                        <div className="rounded-lg border border-slate-100 px-3 py-3 text-center text-xs text-slate-500">No leave balance added.</div>
                      ) : selectedDetail.leave_balances.map(item => (
                        <div key={item.id} className="grid grid-cols-4 items-center rounded-lg border border-slate-100 bg-white px-2.5 py-1.5 text-xs shadow-sm">
                          <div className="font-semibold text-slate-900">{item.year}</div>
                          <div className="text-center text-slate-600">{item.leaves_taken} taken</div>
                          <div className="text-center text-slate-600">{item.annual_allowed} allowed</div>
                          <div className="text-right font-semibold text-emerald-700">{item.leaves_remaining} left</div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-lg border border-slate-100 bg-white">
                      <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase text-slate-500">
                        Leave History
                      </div>
                      <div className="max-h-32 overflow-y-auto">
                        {selectedDetail.leave_entries.length === 0 ? (
                          <div className="px-3 py-4 text-center text-xs text-slate-500">No leave records added.</div>
                        ) : selectedDetail.leave_entries.map(item => (
                          <div key={item.id} className="grid gap-2 border-b border-slate-100 px-3 py-1.5 text-xs last:border-b-0 md:grid-cols-[90px_52px_1fr]">
                            <div className="font-medium text-slate-900">{item.leave_date ? new Date(item.leave_date).toLocaleDateString() : '---'}</div>
                            <div className="text-slate-600">{item.leave_days} day</div>
                            <div className="text-slate-600">{item.reason}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200">
              <div className="border-b border-slate-100 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-900">Recent Completed Work</h3>
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 text-left">Order</th>
                      <th className="px-4 py-3 text-left">Project</th>
                      <th className="px-4 py-3 text-left">Stage</th>
                      <th className="px-4 py-3 text-right">Completed At</th>
                      <th className="px-4 py-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedDetail.performance.recent_work.length === 0 ? (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No recent completed work.</td></tr>
                    ) : selectedDetail.performance.recent_work.map(item => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 text-slate-700">#{item.order_id}</td>
                        <td className="px-4 py-3 text-slate-700">{item.project_id}</td>
                        <td className="px-4 py-3"><StatusBadge status={item.stage || 'unknown'} /></td>
                        <td className="px-4 py-3 text-right text-slate-600">{item.completed_at ? new Date(item.completed_at).toLocaleString() : '---'}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{item.minutes ? `${item.minutes}m` : '---'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {!documentsReady ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Run `database/sql/create_user_machine_documents.sql` before uploading documents.
          </div>
        ) : (
              <div className="rounded-lg border border-slate-200">
                <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Documents</h3>
                    <p className="text-xs text-slate-500">Upload all required files together or add any document later.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={uploadDocuments} disabled={selectedFilesCount === 0} loading={uploading} icon={<Upload className="h-4 w-4" />}>
                      Upload All
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => openEmailModal()}
                      disabled={documents.length === 0}
                      icon={<Mail className="h-4 w-4 text-teal-600" />}
                      className="border-teal-300 text-teal-700 hover:bg-teal-50"
                    >
                      Share / Email Docs
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 border-b border-slate-100 p-4 lg:grid-cols-5">
                  {documentTypes.map(type => (
                    <div key={type.value} className="rounded-lg border border-slate-200 bg-slate-50 p-3 flex flex-col justify-between">
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">{type.label}</div>
                        <input
                          type="file"
                          id={`file-input-${type.value}`}
                          multiple={type.value === 'two_pics' || type.value === 'extra'}
                          accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
                          onChange={e => setDocumentFiles(prev => ({
                            ...prev,
                            [type.value]: Array.from(e.target.files || []),
                          }))}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            document.getElementById(`file-input-${type.value}`)?.click();
                          }}
                          className="w-full text-left rounded border border-dashed border-slate-300 hover:border-teal-500 bg-white p-2 text-[11px] text-slate-600 transition-colors cursor-pointer min-h-[36px] overflow-hidden"
                          title="Browse local files"
                        >
                          {(documentFiles[type.value]?.length || 0) > 0 ? (
                            <span className="font-semibold text-teal-600 block truncate">
                              {documentFiles[type.value]?.map(f => f.name).join(', ')}
                            </span>
                          ) : (
                            <span className="text-slate-400 block">Choose File...</span>
                          )}
                        </button>
                      </div>
                      
                      <div className="flex gap-1.5 mt-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setActiveCameraType({ value: type.value, label: type.label });
                          }}
                          className="flex-1 flex items-center justify-center gap-1 rounded bg-slate-200 hover:bg-slate-300 px-2 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors cursor-pointer"
                        >
                          <Camera className="h-3.5 w-3.5" />
                          Scan
                        </button>
                        {(type.value === 'nda' || type.value === 'contract_letter') && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              window.open(`/hr-panel/generate/${selectedDetail.user.id}/${type.value}`, '_blank');
                            }}
                            className="flex-1 rounded bg-teal-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-teal-700 transition-colors cursor-pointer text-center"
                          >
                            Gen {type.value === 'nda' ? 'NDA' : 'Offer'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div>
              {documents.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">No documents uploaded.</div>
              ) : documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{doc.original_name}</div>
                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                      <span className="font-semibold text-slate-700">{documentLabel[doc.document_type]}</span>
                      {doc.uploaded_at && <span>&bull; {new Date(doc.uploaded_at).toLocaleDateString()}</span>}
                      {doc.uploader?.name && (
                        <span className="inline-flex items-center gap-1 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800 border border-teal-200/60">
                          By: {doc.uploader.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openEmailModal(doc.id)}
                      icon={<Mail className="h-3.5 w-3.5 text-teal-600" />}
                      title="Share / Email this document"
                    >
                      Email
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => deleteDocument(doc)}
                      loading={deletingDocumentId === doc.id}
                      icon={<Trash2 className="h-4 w-4" />}
                    >
                      Delete
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => downloadDocument(doc)} icon={<Download className="h-4 w-4" />}>
                      Download
                    </Button>
                  </div>
                </div>
              ))}
                </div>
            </div>
            )}
            
            <CameraCaptureModal
              open={!!activeCameraType}
              onClose={() => setActiveCameraType(null)}
              documentTypeLabel={activeCameraType?.label || ''}
              documentTypeValue={activeCameraType?.value || ''}
              onSave={(file) => {
                if (activeCameraType) {
                  const isMultiple = activeCameraType.value === 'two_pics' || activeCameraType.value === 'extra';
                  setDocumentFiles(prev => ({
                    ...prev,
                    [activeCameraType.value]: isMultiple 
                      ? [...(prev[activeCameraType.value] || []), file]
                      : [file]
                  }));
                }
              }}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        title="Share Documents via Email"
        size="xl"
      >
        <div className="space-y-4">
          {emailSuccessMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <Check className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>{emailSuccessMsg}</span>
            </div>
          )}

          {emailErrorMsg && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{emailErrorMsg}</span>
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3.5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold uppercase text-slate-500 block">Candidate</span>
              <div className="font-semibold text-slate-900 text-sm">{selectedDetail?.user.name || 'Candidate'}</div>
            </div>
            {selectedDetail?.user.role && (
              <div>
                <span className="text-xs font-semibold uppercase text-slate-500 block">Role</span>
                <StatusBadge status={selectedDetail.user.role} />
              </div>
            )}
            {selectedDetail?.user.machine_id && (
              <div>
                <span className="text-xs font-semibold uppercase text-slate-500 block">Machine ID</span>
                <span className="text-xs font-mono font-medium text-slate-700">{selectedDetail.user.machine_id}</span>
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Candidate Email Address <span className="text-rose-500">*</span>
              </label>
              <input
                type="email"
                value={emailRecipient}
                onChange={e => setEmailRecipient(e.target.value)}
                placeholder="e.g. candidate@example.com"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase text-slate-500">
                Email Subject <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={emailSubject}
                onChange={e => setEmailSubject(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-teal-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase text-slate-500">
                Documents to Attach / Include ({selectedEmailDocIds.length} selected)
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const targetDocs = documents.filter(d => d.document_type === 'nda' || d.document_type === 'contract_letter');
                    setSelectedEmailDocIds(targetDocs.map(d => d.id));
                  }}
                  className="text-[11px] font-medium text-teal-600 hover:text-teal-800 hover:underline cursor-pointer"
                >
                  Select NDA & Offer Only
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedEmailDocIds(documents.map(d => d.id))}
                  className="text-[11px] font-medium text-slate-600 hover:text-slate-800 hover:underline cursor-pointer"
                >
                  Select All
                </button>
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => setSelectedEmailDocIds([])}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-700 hover:underline cursor-pointer"
                >
                  Clear
                </button>
              </div>
            </div>

            {documents.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
                No documents uploaded yet for this candidate.
              </div>
            ) : (
              <div className="space-y-2 max-h-44 overflow-y-auto rounded-lg border border-slate-200 p-2 bg-white">
                {documents.map(doc => {
                  const isChecked = selectedEmailDocIds.includes(doc.id);
                  const isNdaOrOffer = doc.document_type === 'nda' || doc.document_type === 'contract_letter';
                  return (
                    <label
                      key={doc.id}
                      className={`flex items-center justify-between gap-3 rounded-md p-2 text-xs transition-colors cursor-pointer border ${
                        isChecked ? 'bg-teal-50/60 border-teal-200' : 'hover:bg-slate-50 border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelectedEmailDocIds(prev => [...prev, doc.id]);
                            } else {
                              setSelectedEmailDocIds(prev => prev.filter(id => id !== doc.id));
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                        />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 truncate">{doc.original_name}</div>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                            <span className={`inline-block px-1.5 py-0.5 rounded font-semibold text-[10px] ${
                              isNdaOrOffer ? 'bg-teal-100 text-teal-800' : 'bg-slate-100 text-slate-700'
                            }`}>
                              {documentLabel[doc.document_type]}
                            </span>
                            {doc.uploaded_at && <span>{new Date(doc.uploaded_at).toLocaleDateString()}</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          downloadDocument(doc);
                        }}
                        className="p-1 text-slate-400 hover:text-teal-600 rounded hover:bg-white"
                        title="Download file"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold uppercase text-slate-500">
                Message Body
              </label>
              <button
                type="button"
                onClick={handleCopyEmailText}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-teal-600 cursor-pointer"
              >
                {copiedEmailText ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-emerald-600 font-semibold">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Message</span>
                  </>
                )}
              </button>
            </div>
            <textarea
              rows={5}
              value={emailBody}
              onChange={e => setEmailBody(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white p-3 text-xs leading-relaxed focus:border-teal-500 focus:outline-none"
            />
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs font-semibold uppercase text-slate-500 mb-2.5">
              Choose Mailing / Sharing Action:
            </div>
            <div className="grid gap-2.5 sm:grid-cols-3">
              <button
                type="button"
                onClick={handleOpenGmail}
                className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-gradient-to-b from-red-50/50 to-red-100/30 p-3 text-center transition-all hover:border-red-400 hover:shadow-sm cursor-pointer group"
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-red-700">
                  <ExternalLink className="h-4 w-4 text-red-600" />
                  <span>Open in Gmail (Web)</span>
                </div>
                <span className="text-[10px] text-slate-500 leading-tight">
                  Auto-fills recipient & message + downloads PDFs to attach
                </span>
              </button>

              <button
                type="button"
                onClick={handleOpenOutlook}
                className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-sky-200 bg-gradient-to-b from-sky-50/50 to-sky-100/30 p-3 text-center transition-all hover:border-sky-400 hover:shadow-sm cursor-pointer group"
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-sky-700">
                  <Mail className="h-4 w-4 text-sky-600" />
                  <span>Open in Outlook</span>
                </div>
                <span className="text-[10px] text-slate-500 leading-tight">
                  Launches Outlook app with pre-filled fields + downloads PDFs
                </span>
              </button>

              <button
                type="button"
                onClick={handleDirectServerSend}
                disabled={sendingEmail || selectedEmailDocIds.length === 0}
                className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-teal-600 bg-teal-600 p-3 text-center text-white transition-all hover:bg-teal-700 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                <div className="flex items-center gap-1.5 font-semibold text-xs text-white">
                  <Send className="h-4 w-4" />
                  <span>{sendingEmail ? 'Sending...' : 'Direct Send (1-Click)'}</span>
                </div>
                <span className="text-[10px] text-teal-100 leading-tight">
                  Sends directly from server with PDF attachments attached
                </span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={!!editingUser} onClose={() => setEditingUser(null)} title="Edit User" size="lg">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Name</span>
              <input
                value={editForm.name}
                onChange={e => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Email</span>
              <input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm(prev => ({ ...prev, email: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Machine ID</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={editForm.machine_id}
                onChange={e => {
                  const val = e.target.value.replace(/\D/g, '');
                  setEditForm(prev => ({ ...prev, machine_id: val }));
                }}
                placeholder="e.g. 101"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Blood Group</span>
              <input
                value={editForm.blood_group}
                onChange={e => setEditForm(prev => ({ ...prev, blood_group: e.target.value }))}
                placeholder="B+"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Contact Number</span>
              <input
                value={editForm.contact_number}
                onChange={e => setEditForm(prev => ({ ...prev, contact_number: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>
            {canViewPayroll && (
              <>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Bank Account Number</span>
                  <input
                    value={editForm.bank_account_number}
                    onChange={e => setEditForm(prev => ({ ...prev, bank_account_number: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Joining Salary</span>
                  <input
                    type="number"
                    min={0}
                    value={editForm.joining_salary}
                    onChange={e => setEditForm(prev => ({ ...prev, joining_salary: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Current Salary</span>
                  <input
                    type="number"
                    min={0}
                    value={editForm.salary}
                    onChange={e => setEditForm(prev => ({ ...prev, salary: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                  />
                </label>
              </>
            )}
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Role</span>
              <select
                value={editForm.role}
                onChange={e => setEditForm(prev => ({ ...prev, role: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              >
                <option value="drawer">Drawer</option>
                <option value="checker">Checker</option>
                <option value="filler">Filler</option>
                <option value="qa">QA</option>
                <option value="designer">Designer</option>
                <option value="project_manager">Project Manager</option>
                <option value="operations_manager">Ops Manager</option>
                <option value="accounts_manager">Accounts</option>
                <option value="hr">HR</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Project</span>
              <select
                value={editForm.project_id}
                onChange={e => setEditForm(prev => ({ ...prev, project_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              >
                <option value="">No Project</option>
                {projectOptions.map(project => (
                  <option key={project.id} value={project.id}>
                    {project.name}{project.code ? ` (${project.code})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Department</span>
              <select
                value={editForm.department}
                onChange={e => setEditForm(prev => ({ ...prev, department: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              >
                <option value="floor_plan">Floor Plan</option>
                <option value="photos_enhancement">Photos Enhancement</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Layer</span>
              <select
                value={editForm.layer}
                onChange={e => setEditForm(prev => ({ ...prev, layer: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              >
                <option value="">No Layer</option>
                <option value="drawer">Drawer</option>
                <option value="checker">Checker</option>
                <option value="filler">Filler</option>
                <option value="qa">QA</option>
                <option value="designer">Designer</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Daily Target</span>
              <input
                type="number"
                min={0}
                value={editForm.daily_target}
                onChange={e => setEditForm(prev => ({ ...prev, daily_target: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">WIP Limit</span>
              <input
                type="number"
                min={1}
                value={editForm.wip_limit}
                onChange={e => setEditForm(prev => ({ ...prev, wip_limit: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Shift Start</span>
              <input
                type="time"
                value={editForm.shift_start}
                onChange={e => setEditForm(prev => ({ ...prev, shift_start: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Shift End</span>
              <input
                type="time"
                value={editForm.shift_end}
                onChange={e => setEditForm(prev => ({ ...prev, shift_end: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={editForm.is_active}
                onChange={e => setEditForm(prev => ({ ...prev, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              Active
            </label>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={editForm.is_absent}
                onChange={e => setEditForm(prev => ({ ...prev, is_absent: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              Absent
            </label>
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setEditingUser(null)}>Cancel</Button>
            <Button className="flex-1" onClick={saveUser} loading={savingUser}>Save User</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!confirmDeactivate} onClose={() => setConfirmDeactivate(null)} title="Mark Absent Users Inactive?" size="lg">
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This will only update users who are active, absent, and have inactive_days of 15 or more. CEO, Director, and HR accounts are excluded.
          </div>
          <div className="text-sm text-slate-700">
            Matching users: <span className="font-semibold text-slate-900">{confirmDeactivate?.matched || 0}</span>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-200">
            {(confirmDeactivate?.preview || []).length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">No matching users found.</div>
            ) : confirmDeactivate?.preview.map((user) => (
              <div key={user.id} className="flex items-center justify-between border-b border-slate-100 px-4 py-3 last:border-b-0">
                <div>
                  <div className="text-sm font-medium text-slate-900">{user.name}</div>
                  <div className="text-xs text-slate-500">{user.email}</div>
                </div>
                <div className="text-right">
                  <StatusBadge status={user.role || 'unknown'} />
                  <div className="mt-1 text-xs text-slate-500">{user.inactive_days || 0} days</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmDeactivate(null)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={runDeactivate} disabled={!confirmDeactivate?.matched} loading={deactivating}>Mark Inactive</Button>
          </div>
        </div>
      </Modal>
    </AnimatedPage>
  );
}
