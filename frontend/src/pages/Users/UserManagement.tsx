import { useEffect, useState, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { userService, projectService } from '../../services';
import type { User } from '../../types';
import { AnimatedPage, PageHeader, StatusBadge, Modal, Button, DataTable, FilterBar } from '../../components/ui';
import { Users as UsersIcon, Plus, Edit, Trash2, UserCheck, UserX, Shield, Activity, User as UserIcon, Mail, Lock, ChevronDown, ChevronLeft, ChevronRight, Globe, Building, Layers, UsersRound, Eye, EyeOff } from 'lucide-react';

const emptyForm = { name: '', email: '', machine_id: '', password: '', password_confirmation: '', role: 'drawer', project_id: '', team_id: '', department: 'floor_plan', layer: '' };
// FLAGS kept for future use: country flag emoji map
// const FLAGS: Record<string, string> = { UK: '\u{1F1EC}\u{1F1E7}', Australia: '\u{1F1E6}\u{1F1FA}', Canada: '\u{1F1E8}\u{1F1E6}', USA: '\u{1F1FA}\u{1F1F8}', Vietnam: '\u{1F1FB}\u{1F1F3}' };

export default function UserManagement() {
  const { user: currentUser } = useSelector((state: RootState) => state.auth);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRole, setSelectedRole] = useState('all');
  const [selectedProjectId, setSelectedProjectId] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [pagination, setPagination] = useState({ current_page: 1, last_page: 1, per_page: 25, total: 0 });
  const [stats, setStats] = useState<{ total: number; active: number; managers: number; production: number; by_role?: Record<string, number> }>({ total: 0, active: 0, managers: 0, production: 0, by_role: {} });
  const [filterProjects, setFilterProjects] = useState<{ id: number; name: string }[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [originalStoredPassword, setOriginalStoredPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [formTeams, setFormTeams] = useState<{ id: number; name: string }[]>([]);
  const [loadingTeams, setLoadingTeams] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const searchRef = useRef(searchTerm);
  searchRef.current = searchTerm;

  // Load projects for filter dropdown
  useEffect(() => {
    projectService.list().then(res => {
      const d = res.data?.data || res.data;
      setFilterProjects(Array.isArray(d) ? d : []);
    }).catch(() => { });
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const params: any = { page: currentPage, per_page: perPage };
      if (selectedRole !== 'all') params.role = selectedRole;
      if (selectedProjectId !== 'all') params.project_id = selectedProjectId;
      if (searchRef.current) params.search = searchRef.current;
      const res = await userService.list(params);
      const payload: any = res.data || {};
      const d = payload.data || [];
      setUsers(Array.isArray(d) ? d : []);
      setPagination({
        current_page: payload.current_page || 1,
        last_page: payload.last_page || 1,
        per_page: payload.per_page || perPage,
        total: payload.total || 0,
      });
      setStats(payload.stats || { total: payload.total || 0, active: 0, managers: 0, production: 0, by_role: {} });
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [currentPage, perPage, selectedRole, selectedProjectId]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const canManage = ['ceo', 'director', 'operations_manager', 'project_manager', 'qa'].includes(currentUser?.role || '');

  // Role options filtered by logged-in user's role
  const myRole = currentUser?.role || '';
  const allRoleOptions = [
    { value: 'ceo', label: 'CEO' },
    { value: 'director', label: 'Director' },
    { value: 'operations_manager', label: 'Ops Manager' },
    { value: 'project_manager', label: 'Project Manager' },
    { value: 'accounts_manager', label: 'Accounts' },
    { value: 'hr', label: 'HR' },
    { value: 'live_qa', label: 'Live QA' },
    { value: 'drawer', label: 'Drawer' },
    { value: 'checker', label: 'Checker' },
    { value: 'filler', label: 'File Uploader' },
    { value: 'qa', label: 'QA' },
    { value: 'designer', label: 'Designer' },
  ];
  const hiddenRoles: Record<string, string[]> = {
    ceo: ['ceo', 'project_manager', 'accounts_manager', 'drawer', 'checker', 'filler', 'qa', 'designer'],
    operations_manager: ['ceo', 'director', 'operations_manager', 'accounts_manager'],
    project_manager: ['ceo', 'director', 'operations_manager', 'project_manager', 'accounts_manager', 'hr'],
    hr: ['ceo', 'hr'],
  };
  const rolesToHide = hiddenRoles[myRole] || (myRole === 'director' ? [] : [myRole]);
  const visibleRoleOptions = allRoleOptions.filter(r => !rolesToHide.includes(r.value));

  // Fetch teams when project_id changes in the form
  const loadTeamsForProject = useCallback(async (pid: string) => {
    if (!pid) { setFormTeams([]); return; }
    try {
      setLoadingTeams(true);
      const res = await projectService.teams(Number(pid));
      const t = res.data?.data || res.data;
      setFormTeams(Array.isArray(t) ? t : []);
    } catch (e: any) {
      console.error('[Teams] fetch failed for project', pid, e?.response?.status, e?.response?.data || e?.message);
      setFormTeams([]);
    }
    finally { setLoadingTeams(false); }
  }, []);

  const openCreate = () => {
    setEditingUser(null);
    setOriginalStoredPassword('');
    setFormData(emptyForm);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setFormTeams([]);
    setFormError('');
    setShowModal(true);
  };
  const openEdit = async (u: User) => {
    let userToEdit = u;
    try {
      const res = await userService.get(u.id);
      userToEdit = (res.data?.data || u) as User;
    } catch (e) {
      console.error('[Users] fetch user detail failed', e);
    }
    setEditingUser(userToEdit);
    const storedPassword = userToEdit.plain_password || '';
    setOriginalStoredPassword(storedPassword);
    setFormData({ name: userToEdit.name, email: userToEdit.email, machine_id: userToEdit.machine_id || '', password: storedPassword, password_confirmation: storedPassword, role: userToEdit.role, project_id: userToEdit.project_id ? String(userToEdit.project_id) : '', team_id: userToEdit.team_id ? String(userToEdit.team_id) : '', department: userToEdit.department || 'floor_plan', layer: userToEdit.layer || '' });
    setShowPassword(Boolean(storedPassword));
    setShowConfirmPassword(false);
    if (userToEdit.project_id) loadTeamsForProject(String(userToEdit.project_id));
    else setFormTeams([]);
    setFormError(''); setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.email) { setFormError('Name and email are required.'); return; }
    const passwordChanged = !editingUser || formData.password !== originalStoredPassword;
    if (!editingUser && !formData.password) { setFormError('Password is required.'); return; }
    if (passwordChanged && formData.password && formData.password.length < 8) { setFormError('Password must be at least 8 characters.'); return; }
    if (passwordChanged && formData.password && formData.password !== formData.password_confirmation) { setFormError('Passwords do not match.'); return; }
    try {
      setSaving(true); setFormError('');
      if (editingUser) {
        const d: any = { ...formData };
        if (!d.password || !passwordChanged) { delete d.password; delete d.password_confirmation; }
        await userService.update(editingUser.id, d);
      } else {
        await userService.create(formData as any);
      }
      setShowModal(false); loadUsers();
    } catch (e: any) { setFormError(e.response?.data?.message || 'Failed to save.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try { await userService.delete(id); setDeleteConfirm(null); loadUsers(); } catch (e) { console.error(e); }
  };

  const handleToggleActive = async (u: User) => {
    try { await userService.update(u.id, { is_active: !u.is_active } as any); loadUsers(); } catch (e) { console.error(e); }
  };

  const handleSearch = () => {
    if (currentPage !== 1) setCurrentPage(1);
    else loadUsers();
  };

  const handleRoleChange = (value: string) => {
    setSelectedRole(value);
    setCurrentPage(1);
  };

  const handleProjectChange = (value: string) => {
    setSelectedProjectId(value);
    setCurrentPage(1);
  };

  const startResult = pagination.total === 0 ? 0 : ((pagination.current_page - 1) * pagination.per_page) + 1;
  const endResult = Math.min(pagination.current_page * pagination.per_page, pagination.total);

  return (
    <AnimatedPage>
      <PageHeader title="Users" subtitle="Manage staff members and permissions"
        actions={canManage ? <Button onClick={openCreate} icon={Plus}>Add User</Button> : undefined}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {(myRole === 'ceo' ? [
          { label: 'Total', value: stats.total, icon: UsersIcon, bg: 'bg-slate-100', color: 'text-slate-600' },
          { label: 'Active', value: stats.active, icon: UserCheck, bg: 'bg-brand-50', color: 'text-brand-600' },
          { label: 'Directors', value: stats.by_role?.director || 0, icon: Shield, bg: 'bg-brand-50', color: 'text-brand-600' },
          { label: 'Ops Managers', value: stats.by_role?.operations_manager || 0, icon: Activity, bg: 'bg-blue-50', color: 'text-blue-600' },
        ] : [
          { label: 'Total', value: stats.total, icon: UsersIcon, bg: 'bg-slate-100', color: 'text-slate-600' },
          { label: 'Active', value: stats.active, icon: UserCheck, bg: 'bg-brand-50', color: 'text-brand-600' },
          { label: 'Managers', value: stats.managers, icon: Shield, bg: 'bg-brand-50', color: 'text-brand-600' },
          { label: 'Production', value: stats.production, icon: Activity, bg: 'bg-blue-50', color: 'text-blue-600' },
        ]).map((s, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
            <div><div className="text-2xl font-bold text-slate-900">{s.value}</div><div className="text-xs text-slate-500">{s.label}</div></div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <FilterBar searchValue={searchTerm} onSearchChange={setSearchTerm} onSearchSubmit={handleSearch} searchPlaceholder="Search users..."
        filters={<>
          <select value={selectedRole} onChange={e => handleRoleChange(e.target.value)} aria-label="Filter by role" className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-700 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all appearance-none cursor-pointer pr-8" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
            <option value="all">All Roles</option>
            {visibleRoleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <select value={selectedProjectId} onChange={e => handleProjectChange(e.target.value)} aria-label="Filter by project" className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-700 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all appearance-none cursor-pointer pr-8" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
            <option value="all">All Projects</option>
            {filterProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setCurrentPage(1); }} aria-label="Rows per page" className="px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-700 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all">
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
          <Button variant="secondary" size="sm" onClick={handleSearch}>Search</Button>
        </>}
      />

      {/* Table */}
      <div className="mt-4">
        <DataTable
          data={users} loading={loading} pageSize={perPage}
          columns={[
            {
              key: 'name', label: 'User', sortable: true, render: (u) => (
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-lg bg-[#2AA7A0] flex items-center justify-center text-white font-bold text-sm">{u.name.charAt(0)}</div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${!u.is_active ? 'bg-slate-400' : u.is_online ? 'bg-green-500' : 'bg-amber-500'
                      }`} title={!u.is_active ? 'Inactive' : u.is_online ? 'Online' : 'Offline'} />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 flex items-center gap-2">
                      {u.name}
                      {!u.is_active && <span className="text-[10px] text-rose-500 font-medium bg-rose-50 px-1.5 py-0.5 rounded">Inactive</span>}
                    </div>
                    <div className="text-xs text-slate-400">{u.email}</div>
                  </div>
                </div>
              )
            },
            { key: 'machine_id', label: 'Machine ID', render: (u) => <span className="text-slate-500">{u.machine_id || '---'}</span> },
            { key: 'role', label: 'Role', render: (u) => <StatusBadge status={u.role} /> },
            { key: 'project', label: 'Project', render: (u) => <span className="text-slate-600">{u.project?.name || '—'}</span> },
            { key: 'team', label: 'Team', render: (u) => <span className="text-slate-500">{u.team?.name || '—'}</span> },
            { key: 'department', label: 'Department', render: (u) => <span className="text-slate-500 capitalize">{u.department?.replace('_', ' ') || '—'}</span> },
            {
              key: 'activity', label: 'Last Active', render: (u) => (
                <div>
                  <span className="text-xs text-slate-400">{u.last_activity ? new Date(u.last_activity).toLocaleDateString() : 'Never'}</span>
                  {u.last_activity && (
                    <div className="text-[10px] text-slate-300">{new Date(u.last_activity).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                  )}
                </div>
              )
            },
            {
              key: 'actions', label: '', render: (u) => canManage ? (
                <div className="flex items-center gap-1 justify-end">
                  <Button variant="ghost" size="xs" onClick={() => handleToggleActive(u)} title={u.is_active ? 'Deactivate' : 'Activate'}>
                    {u.is_active ? <UserX className="w-3.5 h-3.5 text-amber-500" /> : <UserCheck className="w-3.5 h-3.5 text-brand-500" />}
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => openEdit(u)}><Edit className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="xs" onClick={() => setDeleteConfirm(u.id)}><Trash2 className="w-3.5 h-3.5 text-rose-500" /></Button>
                </div>
              ) : null
            },
          ]}
          emptyIcon={UsersIcon}
          emptyTitle="No users found"
          emptyDescription="Adjust your filters or add a new user."
        />
        {!loading && pagination.last_page > 1 && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-4 py-3">
            <div className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-700">{startResult}</span>-<span className="font-semibold text-slate-700">{endResult}</span> of <span className="font-semibold text-slate-700">{pagination.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={pagination.current_page <= 1}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium text-slate-600">
                Page {pagination.current_page} of {pagination.last_page}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setCurrentPage(p => Math.min(pagination.last_page, p + 1))} disabled={pagination.current_page >= pagination.last_page}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title={editingUser ? 'Edit User' : 'Add New User'} size="lg">
        {formError && (
          <div className="mb-5 flex items-center gap-3 p-3.5 bg-rose-50 border border-rose-200/60 rounded-xl">
            <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-rose-600" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" /></svg>
            </div>
            <p className="text-sm font-medium text-rose-700">{formError}</p>
          </div>
        )}

        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Full Name <span className="text-rose-400">*</span></label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <UserIcon className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. John Smith"
                className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Email Address <span className="text-rose-400">*</span></label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Mail className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="email"
                value={formData.email}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                placeholder="e.g. john@benchmark.com"
                className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200"
              />
            </div>
          </div>

          {/* Machine ID */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Machine ID</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                <Activity className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="text"
                value={formData.machine_id}
                onChange={e => setFormData({ ...formData, machine_id: e.target.value })}
                placeholder="e.g. BM-PC-001"
                className="w-full pl-10 pr-4 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200"
              />
            </div>
          </div>

          {/* Password Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Password {editingUser ? <span className="text-slate-400 font-normal normal-case">(optional)</span> : <span className="text-rose-400">*</span>}
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  placeholder={editingUser ? 'Leave blank to keep' : 'Min 8 characters'}
                  className="w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Confirm Password</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-4 w-4 text-slate-400" />
                </div>
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.password_confirmation}
                  onChange={e => setFormData({ ...formData, password_confirmation: e.target.value })}
                  placeholder="Re-enter password"
                  className="w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200"
                />
                <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition-colors">
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
            <div className="relative flex justify-center"><span className="bg-white px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Role & Assignment</span></div>
          </div>

          {/* Role / Country */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Role</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Shield className="h-4 w-4 text-slate-400" />
                </div>
                <select
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value })}
                  aria-label="User role"
                  className="w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 appearance-none cursor-pointer"
                >
                  {visibleRoleOptions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Project</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Globe className="h-4 w-4 text-slate-400" />
                </div>
                <select
                  value={formData.project_id}
                  onChange={e => { const v = e.target.value; setFormData({ ...formData, project_id: v, team_id: '' }); loadTeamsForProject(v); }}
                  aria-label="User project"
                  className="w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 appearance-none cursor-pointer"
                >
                  <option value="">Select Project</option>
                  {filterProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </div>
              </div>
            </div>
          </div>

          {/* Team */}
          {formData.project_id && (
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Team</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <UsersRound className="h-4 w-4 text-slate-400" />
                </div>
                <select
                  value={formData.team_id}
                  onChange={e => setFormData({ ...formData, team_id: e.target.value })}
                  aria-label="User team"
                  disabled={loadingTeams}
                  className="w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 appearance-none cursor-pointer disabled:opacity-50"
                >
                  <option value="">{loadingTeams ? 'Loading teams...' : 'Select Team'}</option>
                  {formTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </div>
              </div>
              {formTeams.length === 0 && !loadingTeams && (
                <p className="text-[10px] text-slate-400 mt-1">No teams found for this project. Create teams in PM Dashboard → Teams tab.</p>
              )}
            </div>
          )}

          {/* Department / Layer */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Department</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Building className="h-4 w-4 text-slate-400" />
                </div>
                <select
                  value={formData.department}
                  onChange={e => setFormData({ ...formData, department: e.target.value })}
                  aria-label="User department"
                  className="w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 appearance-none cursor-pointer"
                >
                  <option value="floor_plan">Floor Plan</option>
                  <option value="photos_enhancement">Photos Enhancement</option>
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Layer</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Layers className="h-4 w-4 text-slate-400" />
                </div>
                <select
                  value={formData.layer}
                  onChange={e => setFormData({ ...formData, layer: e.target.value })}
                  aria-label="User layer"
                  className="w-full pl-10 pr-10 py-3 text-sm bg-slate-50 border border-slate-200 rounded-xl text-slate-900 hover:border-slate-300 focus:outline-none focus:bg-white focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all duration-200 appearance-none cursor-pointer"
                >
                  <option value="">None</option>
                  <option value="drawer">Drawer</option>
                  <option value="checker">Checker</option>
                  <option value="filler">Filler</option>
                  <option value="qa">QA</option>
                  <option value="designer">Designer</option>
                </select>
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <ChevronDown className="h-4 w-4 text-slate-400" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-7 flex gap-3 pt-5 border-t border-slate-100">
          <Button variant="secondary" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button className="flex-1" onClick={handleSave} loading={saving}>{editingUser ? 'Save Changes' : 'Create User'}</Button>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete User?" size="sm">
        <div className="text-center py-4">
          <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-3"><Trash2 className="w-7 h-7 text-rose-500" /></div>
          <p className="text-sm text-slate-500">This will permanently remove this user.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button variant="danger" className="flex-1" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
        </div>
      </Modal>
    </AnimatedPage>
  );
}
