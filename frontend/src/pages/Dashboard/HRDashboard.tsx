import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, Calendar, Download, FileText, Search, Upload, UserCheck, UserX, Users } from 'lucide-react';
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

type ProgressRow = {
  user_id: number;
  name?: string | null;
  email?: string | null;
  machine_id?: string | null;
  role?: string | null;
  completed: number;
  avg_minutes?: number | null;
};

export default function HRDashboard() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users'>('dashboard');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [stats, setStats] = useState<HrStats>({ total: 0, active: 0, inactive: 0, absent: 0, present: 0 });
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, per_page: 25, total: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [documentsReady, setDocumentsReady] = useState(true);
  const [machineIdReady, setMachineIdReady] = useState(true);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [documents, setDocuments] = useState<UserDocument[]>([]);
  const [documentType, setDocumentType] = useState<typeof documentTypes[number]['value']>('copy_of_cnic');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(async () => {
    try {
      setLoadingDashboard(true);
      const res = await hrService.dashboard({ month });
      setStats(res.data.stats);
      setProgress(res.data.monthly_progress || []);
      setDocumentsReady(res.data.documents_ready);
      setMachineIdReady(res.data.machine_id_ready);
    } catch (e) {
      console.error(e);
      setError('Could not load HR dashboard.');
    } finally {
      setLoadingDashboard(false);
    }
  }, [month]);

  const loadUsers = useCallback(async () => {
    try {
      setLoadingUsers(true);
      const res = await hrService.users({ page, per_page: 25, search, status });
      setUsers(res.data.data || []);
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
  }, [page, search, status]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const openDocuments = async (user: User) => {
    setSelectedUser(user);
    setSelectedFile(null);
    setError('');

    try {
      const res = await hrService.documents(user.id);
      setDocuments(res.data.data || []);
      setDocumentsReady(res.data.documents_ready);
    } catch (e) {
      console.error(e);
      setDocuments([]);
      setError('Could not load documents.');
    }
  };

  const uploadDocument = async () => {
    if (!selectedUser || !selectedFile) return;

    const data = new FormData();
    data.append('document_type', documentType);
    data.append('file', selectedFile);

    try {
      setUploading(true);
      setError('');
      await hrService.uploadDocument(selectedUser.id, data);
      const res = await hrService.documents(selectedUser.id);
      setDocuments(res.data.data || []);
      setSelectedFile(null);
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

  const startResult = pagination.total === 0 ? 0 : ((pagination.current_page - 1) * pagination.per_page) + 1;
  const endResult = Math.min(pagination.current_page * pagination.per_page, pagination.total);
  const documentLabel = useMemo(() => Object.fromEntries(documentTypes.map(type => [type.value, type.label])), []);

  return (
    <AnimatedPage>
      <PageHeader title="HR" subtitle="Staff records, documents, and monthly progress" />

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

      <div className="mb-5 inline-flex rounded-lg border border-slate-200 bg-white p-1">
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
                <p className="text-xs text-slate-500">Top completed work items</p>
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
          <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 lg:flex-row">
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
              value={status}
              onChange={e => { setStatus(e.target.value); setPage(1); }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="present">Present</option>
              <option value="absent">Absent</option>
            </select>
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
                    <th className="px-4 py-3 text-right">Documents</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingUsers ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">No users found.</td></tr>
                  ) : users.map((row: User & { documents_count?: number }) => (
                    <tr key={row.id}>
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
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="secondary" onClick={() => openDocuments(row)} icon={<FileText className="h-4 w-4" />}>
                          {row.documents_count || 0}
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

      <Modal open={!!selectedUser} onClose={() => setSelectedUser(null)} title={selectedUser ? `${selectedUser.name} Documents` : 'Documents'} size="lg">
        {!documentsReady ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Run `database/sql/create_user_machine_documents.sql` before uploading documents.
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <select
                value={documentType}
                onChange={e => setDocumentType(e.target.value as typeof documentType)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-teal-500 focus:bg-white focus:outline-none"
              >
                {documentTypes.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
              <input
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,.doc,.docx"
                onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              />
              <Button onClick={uploadDocument} disabled={!selectedFile} loading={uploading} icon={<Upload className="h-4 w-4" />}>
                Upload
              </Button>
            </div>

            <div className="rounded-lg border border-slate-200">
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
      </Modal>
    </AnimatedPage>
  );
}
