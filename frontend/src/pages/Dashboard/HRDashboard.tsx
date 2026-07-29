import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, Calendar, Download, Edit, FileText, Search, ShieldCheck, Trash2, Upload, UserCheck, UserX, Users } from 'lucide-react';
import { useSelector } from 'react-redux';
import { AnimatedPage, Button, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { hrService } from '../../services';
import type { RootState } from '../../store/store';
import type { User, UserDocument, UserLeaveBalance, UserSalaryIncrement } from '../../types';

const documentTypes = [
  { value: 'copy_of_cnic', label: 'Copy of CNIC' },
  { value: 'two_pics', label: '2 Pics' },
  { value: 'nda', label: 'NDA' },
  { value: 'contract_letter', label: 'Contract Letter' },
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
  no_documents: number;
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
  payroll_ready: boolean;
  leave_balance_ready: boolean;
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
    no_documents: 0,
    missing: { copy_of_cnic: 0, two_pics: 0, nda: 0, contract_letter: 0 },
  });
  const [users, setUsers] = useState<HrUserRow[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, per_page: 25, total: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [role, setRole] = useState('all');
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
    salary: '',
  });
  const [incrementForm, setIncrementForm] = useState({
    increment_amount: '',
    effective_date: new Date().toISOString().slice(0, 10),
    notes: '',
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
  const [deletingDocumentId, setDeletingDocumentId] = useState<number | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ matched: number; preview: Array<Partial<User> & { inactive_days?: number }> } | null>(null);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    try {
      setLoadingDashboard(true);
      const res = await hrService.dashboard({ month, project_id: projectId });
      setStats(res.data.stats);
      setDocumentStats(res.data.document_stats || {
        active_total: 0,
        complete_required: 0,
        no_documents: 0,
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
      const res = await hrService.users({ page, per_page: 25, search, status, role, month: userMonth, project_id: projectId });
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
  }, [page, search, status, role, userMonth, projectId]);

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
        payroll_ready: !!res.data.payroll_ready,
        leave_balance_ready: !!res.data.leave_balance_ready,
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
      payroll_ready: !!res.data.payroll_ready,
      leave_balance_ready: !!res.data.leave_balance_ready,
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
        payroll_ready: !!res.data.payroll_ready,
        leave_balance_ready: !!res.data.leave_balance_ready,
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
    { label: 'Complete Docs', value: documentStats.complete_required, tone: 'bg-emerald-50 text-emerald-700' },
    { label: 'No Docs', value: documentStats.no_documents, tone: 'bg-rose-50 text-rose-700' },
    { label: 'CNIC Missing', value: documentStats.missing.copy_of_cnic, tone: 'bg-amber-50 text-amber-700' },
    { label: 'Pics Missing', value: documentStats.missing.two_pics, tone: 'bg-sky-50 text-sky-700' },
    { label: 'NDA Missing', value: documentStats.missing.nda, tone: 'bg-indigo-50 text-indigo-700' },
    { label: 'Contract Missing', value: documentStats.missing.contract_letter, tone: 'bg-purple-50 text-purple-700' },
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
                <p className="text-xs text-slate-500">Only employees at 90-92 days are shown</p>
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
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Active User Documents</h2>
              <p className="text-xs text-slate-500">
                Required documents checked for {documentStats.active_total} active users
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
              {requiredDocumentCards.map(item => (
                <div key={item.label} className={`rounded-lg px-3 py-3 ${item.tone}`}>
                  <div className="text-2xl font-bold">{item.value}</div>
                  <div className="mt-1 text-xs font-medium">{item.label}</div>
                </div>
              ))}
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
                    <th className="px-4 py-3 text-right">Avg Time</th>
                    <th className="px-4 py-3 text-right">Inactive Days</th>
                    <th className="px-4 py-3 text-right">Documents</th>
                    <th className="px-4 py-3 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingUsers ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-slate-500">No employees found.</td></tr>
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
                      <td className="px-4 py-3 text-right text-slate-600">{row.monthly_avg_minutes ? `${row.monthly_avg_minutes}m` : '---'}</td>
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

            <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
              {canViewPayroll && (
                <div className="rounded-lg border border-slate-200">
                  <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Salary & Increment</h3>
                      <p className="text-xs text-slate-500">Current salary and increment history</p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-slate-900">{formatMoney(selectedDetail.user.salary)}</div>
                      <div className="text-xs text-slate-500">current salary</div>
                    </div>
                  </div>
                  {!selectedDetail.payroll_ready ? (
                    <div className="px-4 py-6 text-sm text-amber-700">Payroll table is pending. Run migrations first.</div>
                  ) : (
                    <div className="space-y-4 p-4">
                      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
                        <label className="text-sm">
                          <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Increment Amount</span>
                          <input
                            type="number"
                            min={0}
                            value={incrementForm.increment_amount}
                            onChange={e => setIncrementForm(prev => ({ ...prev, increment_amount: e.target.value }))}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                          />
                        </label>
                        <label className="text-sm">
                          <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Effective Date</span>
                          <input
                            type="date"
                            value={incrementForm.effective_date}
                            onChange={e => setIncrementForm(prev => ({ ...prev, effective_date: e.target.value }))}
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                          />
                        </label>
                      </div>
                      <div className="flex gap-3">
                        <input
                          value={incrementForm.notes}
                          onChange={e => setIncrementForm(prev => ({ ...prev, notes: e.target.value }))}
                          placeholder="Notes"
                          className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                        />
                        <Button onClick={addIncrement} loading={savingIncrement} disabled={!incrementForm.increment_amount}>
                          Add Increment
                        </Button>
                      </div>
                      <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-100">
                        {selectedDetail.salary_increments.length === 0 ? (
                          <div className="px-4 py-6 text-center text-sm text-slate-500">No increments added.</div>
                        ) : selectedDetail.salary_increments.map(item => (
                          <div key={item.id} className="grid gap-2 border-b border-slate-100 px-4 py-3 text-sm last:border-b-0 md:grid-cols-[1fr_auto]">
                            <div>
                              <div className="font-semibold text-slate-900">
                                +{formatMoney(item.increment_amount)} on {item.effective_date ? new Date(item.effective_date).toLocaleDateString() : '---'}
                              </div>
                              <div className="text-xs text-slate-500">
                                {formatMoney(item.previous_salary)} to {formatMoney(item.new_salary)}
                              </div>
                              {item.notes && <div className="mt-1 text-xs text-slate-500">{item.notes}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Annual Leaves</h3>
                    <p className="text-xs text-slate-500">Default yearly allowance is 14 leaves</p>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-slate-900">{currentLeaveBalance?.leaves_remaining ?? 14}</div>
                    <div className="text-xs text-slate-500">remaining</div>
                  </div>
                </div>
                {!selectedDetail.leave_balance_ready ? (
                  <div className="px-4 py-6 text-sm text-amber-700">Leave balance table is pending. Run migrations first.</div>
                ) : (
                  <div className="space-y-4 p-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Year</span>
                        <input
                          type="number"
                          value={leaveForm.year}
                          onChange={e => setLeaveForm(prev => ({ ...prev, year: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Allowed</span>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          value={leaveForm.annual_allowed}
                          onChange={e => setLeaveForm(prev => ({ ...prev, annual_allowed: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="mb-1 block text-xs font-semibold uppercase text-slate-500">Taken</span>
                        <input
                          type="number"
                          min={0}
                          max={60}
                          value={leaveForm.leaves_taken}
                          onChange={e => setLeaveForm(prev => ({ ...prev, leaves_taken: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                        />
                      </label>
                    </div>
                    <div className="flex gap-3">
                      <input
                        value={leaveForm.notes}
                        onChange={e => setLeaveForm(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="Notes"
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
                      />
                      <Button onClick={saveLeaveBalance} loading={savingLeaves}>Save Leaves</Button>
                    </div>
                    <div className="grid gap-2">
                      {selectedDetail.leave_balances.length === 0 ? (
                        <div className="rounded-lg border border-slate-100 px-4 py-4 text-center text-sm text-slate-500">No leave balance added.</div>
                      ) : selectedDetail.leave_balances.map(item => (
                        <div key={item.id} className="grid grid-cols-4 items-center rounded-lg border border-slate-100 px-3 py-2 text-sm">
                          <div className="font-semibold text-slate-900">{item.year}</div>
                          <div className="text-center text-slate-600">{item.leaves_taken} taken</div>
                          <div className="text-center text-slate-600">{item.annual_allowed} allowed</div>
                          <div className="text-right font-semibold text-emerald-700">{item.leaves_remaining} left</div>
                        </div>
                      ))}
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
                  <Button onClick={uploadDocuments} disabled={selectedFilesCount === 0} loading={uploading} icon={<Upload className="h-4 w-4" />}>
                    Upload All
                  </Button>
                </div>

                <div className="grid gap-3 border-b border-slate-100 p-4 lg:grid-cols-5">
                  {documentTypes.map(type => (
                    <label key={type.value} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 text-xs font-semibold uppercase text-slate-500">{type.label}</div>
                      <input
                        type="file"
                        multiple={type.value === 'two_pics' || type.value === 'extra'}
                        accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
                        onChange={e => setDocumentFiles(prev => ({
                          ...prev,
                          [type.value]: Array.from(e.target.files || []),
                        }))}
                        className="w-full text-xs text-slate-600"
                      />
                      <div className="mt-2 text-xs text-slate-400">
                        {(documentFiles[type.value]?.length || 0) > 0 ? `${documentFiles[type.value]?.length} selected` : 'No file selected'}
                      </div>
                    </label>
                  ))}
                </div>

                <div>
              {documents.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">No documents uploaded.</div>
              ) : documents.map(doc => (
                <div key={doc.id} className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">{doc.original_name}</div>
                    <div className="text-xs text-slate-500">
                      {documentLabel[doc.document_type]} {doc.uploaded_at ? `- ${new Date(doc.uploaded_at).toLocaleDateString()}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
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
          </div>
        )}
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
                value={editForm.machine_id}
                onChange={e => setEditForm(prev => ({ ...prev, machine_id: e.target.value }))}
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
