import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, Calendar, Download, FileText, Search, ShieldCheck, Upload, UserCheck, UserX, Users } from 'lucide-react';
import { AnimatedPage, Button, Modal, PageHeader, StatusBadge } from '../../components/ui';
import { hrService } from '../../services';
import type { User, UserDocument } from '../../types';

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

type ProjectOption = {
  id: number;
  name: string;
  code?: string | null;
};

type ProgressRow = {
  user_id: number;
  name?: string | null;
  email?: string | null;
  machine_id?: string | null;
  role?: string | null;
  completed: number;
  avg_minutes?: number | null;
};

type HrUserRow = User & {
  documents_count?: number;
  monthly_completed?: number;
  monthly_avg_minutes?: number | null;
};

type UserDetail = {
  user: User;
  documents: UserDocument[];
  performance: {
    today_completed: number;
    month_completed: number;
    month_avg_minutes?: number | null;
    daily_progress: Array<{ date: string; completed: number; avg_minutes?: number | null }>;
    recent_work: Array<{ id: number; order_id: number; project_id: number; stage?: string | null; status: string; completed_at?: string | null; minutes?: number | null }>;
  };
};

export default function HRDashboard() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users'>('dashboard');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [stats, setStats] = useState<HrStats>({ total: 0, active: 0, inactive: 0, absent: 0, present: 0 });
  const [progress, setProgress] = useState<ProgressRow[]>([]);
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
  const [uploading, setUploading] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ matched: number; preview: Array<Partial<User> & { inactive_days?: number }> } | null>(null);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    try {
      setLoadingDashboard(true);
      const res = await hrService.dashboard({ month, project_id: projectId });
      setStats(res.data.stats);
      setProgress(res.data.monthly_progress || []);
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
        performance: res.data.performance,
      });
      setDocuments(res.data.documents || []);
      setDocumentsReady(res.data.documents_ready);
      setMachineIdReady(res.data.machine_id_ready);
    } catch (e) {
      console.error(e);
      setDocuments([]);
      setError('Could not load user details.');
    } finally {
      setLoadingDetail(false);
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
  const selectedFilesCount = useMemo(
    () => Object.values(documentFiles).reduce((total, files) => total + (files?.length || 0), 0),
    [documentFiles],
  );

  return (
    <AnimatedPage>
      <PageHeader title="HR Panel" subtitle="Staff records, documents, and monthly progress" />

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
            Users
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

          <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Monthly Progress</h2>
                <p className="text-xs text-slate-500">Highest completed work items this month</p>
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">User</th>
                    <th className="px-4 py-3 text-left">Machine ID</th>
                    <th className="px-4 py-3 text-left">Role</th>
                    <th className="px-4 py-3 text-right">Completed</th>
                    <th className="px-4 py-3 text-right">Avg Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingDashboard ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
                  ) : progress.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No progress found.</td></tr>
                  ) : progress.map((row) => (
                    <tr key={row.user_id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{row.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-400">{row.email}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.machine_id || '---'}</td>
                      <td className="px-4 py-3"><StatusBadge status={row.role || 'unknown'} /></td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">{row.completed}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{row.avg_minutes ? `${row.avg_minutes}m` : '---'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 xl:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search users, email, machine ID"
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingUsers ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No users found.</td></tr>
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
                    ['Project', selectedDetail.user.project?.name || '---'],
                    ['Team', selectedDetail.user.team?.name || '---'],
                    ['Department', selectedDetail.user.department || '---'],
                    ['Country', selectedDetail.user.country || '---'],
                    ['Layer', selectedDetail.user.layer || '---'],
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
                  <Button size="sm" variant="secondary" onClick={() => downloadDocument(doc)} icon={<Download className="h-4 w-4" />}>
                    Download
                  </Button>
                </div>
              ))}
                </div>
            </div>
            )}
          </div>
        )}
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
