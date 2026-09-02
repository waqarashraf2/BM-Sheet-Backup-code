import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { projectService } from '../../services';
import type { Project } from '../../types';
import { AnimatedPage, PageHeader, StatusBadge, Modal, Button, DataTable, FilterBar, Input, Textarea, Select } from '../../components/ui';
import { FolderKanban, Plus, Edit, Trash2, Users, BarChart3, MapPin } from 'lucide-react';

const emptyForm = {
  name: '', code: '', client_name: '', country: 'all', department: 'floor_plan',
  status: 'active', description: '', workflow_layers: ['drawer', 'checker', 'qa'], timezone: '', action: false,
};

const COUNTRY_TIMEZONES: Record<string, { value: string; label: string }[]> = {
  Australia: [
    { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
    { value: 'Australia/Melbourne', label: 'Melbourne (AEST/AEDT)' },
    { value: 'Australia/Brisbane', label: 'Brisbane (AEST)' },
    { value: 'Australia/Perth', label: 'Perth (AWST)' },
    { value: 'Australia/Adelaide', label: 'Adelaide (ACST/ACDT)' },
    { value: 'Australia/Darwin', label: 'Darwin (ACST)' },
  ],
  UK: [
    { value: 'Etc/GMT', label: 'London GMT+0 (05:00 PKT)' },
    { value: 'Etc/GMT-1', label: 'London GMT+1 (04:00 PKT)' },
  ],
  Canada: [
    { value: 'America/Toronto', label: 'Toronto (EST/EDT)' },
    { value: 'America/Vancouver', label: 'Vancouver (PST/PDT)' },
    { value: 'America/Edmonton', label: 'Edmonton (MST/MDT)' },
    { value: 'America/Winnipeg', label: 'Winnipeg (CST/CDT)' },
    { value: 'America/Halifax', label: 'Halifax (AST/ADT)' },
    { value: 'America/St_Johns', label: "St. John's (NST/NDT)" },
  ],
  USA: [
    { value: 'America/New_York', label: 'New York (EST/EDT)' },
    { value: 'America/Chicago', label: 'Chicago (CST/CDT)' },
    { value: 'America/Denver', label: 'Denver (MST/MDT)' },
    { value: 'America/Los_Angeles', label: 'Los Angeles (PST/PDT)' },
    { value: 'America/Anchorage', label: 'Anchorage (AKST/AKDT)' },
    { value: 'Pacific/Honolulu', label: 'Honolulu (HST)' },
  ],
  Vietnam: [
    { value: 'Asia/Ho_Chi_Minh', label: 'Ho Chi Minh (ICT)' },
  ],
};

const FLAGS: Record<string, string> = { UK: '\u{1F1EC}\u{1F1E7}', Australia: '\u{1F1E6}\u{1F1FA}', Canada: '\u{1F1E8}\u{1F1E6}', USA: '\u{1F1FA}\u{1F1F8}', Vietnam: '\u{1F1FB}\u{1F1F3}' };

export default function ProjectManagement() {
  const { user } = useSelector((state: RootState) => state.auth);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showStats, setShowStats] = useState<Project | null>(null);
  const [showTeams, setShowTeams] = useState<Project | null>(null);
  const [projectStats, setProjectStats] = useState<any>(null);
  const [projectTeams, setProjectTeams] = useState<any[]>([]);

  useEffect(() => { loadProjects(); }, [selectedCountry, selectedDepartment]);

  const loadProjects = async () => {
    try {
      setLoading(true);
      const params: any = {};
      if (selectedCountry !== 'all') params.country = selectedCountry;
      if (selectedDepartment !== 'all') params.department = selectedDepartment;
      if (searchTerm) params.search = searchTerm;
      const res = await projectService.list(params);
      const d = res.data?.data || res.data;
      setProjects(Array.isArray(d) ? d : []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const canManage = ['ceo', 'director'].includes(user?.role || '');

  const openCreate = () => { setEditingProject(null); setFormData(emptyForm); setFormError(''); setShowModal(true); };
  const openEdit = (p: Project) => {
    setEditingProject(p);
    setFormData({ name: p.name, code: p.code, client_name: p.client_name, country: p.country, department: p.department, status: p.status, description: p.description || '', workflow_layers: p.workflow_layers || ['drawer', 'checker', 'qa'], timezone: (p as any).timezone || '', action: !!(p as any).action });
    setFormError(''); setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.code || !formData.client_name) { setFormError('Name, code, and client are required.'); return; }
    try {
      setSaving(true); setFormError('');
      if (editingProject) await projectService.update(editingProject.id, formData as any);
      else await projectService.create(formData as any);
      setShowModal(false); loadProjects();
    } catch (e: any) { setFormError(e.response?.data?.message || 'Failed to save.'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    try { 
      setDeleting(true);
      await projectService.delete(id); 
      setDeleteConfirm(null); 
      loadProjects(); 
    } catch (e) { 
      console.error(e); 
    } finally {
      setDeleting(false);
    }
  };

  const handleViewStats = async (p: Project) => {
    setShowStats(p); setProjectStats(null);
    try { const r = await projectService.statistics(p.id); setProjectStats(r.data); } catch (_) {}
  };

  const handleViewTeams = async (p: Project) => {
    setShowTeams(p); setProjectTeams([]);
    try { const r = await projectService.teams(p.id); const d = r.data?.data || r.data; setProjectTeams(Array.isArray(d) ? d : []); } catch (_) {}
  };

  const filtered = projects.filter(p =>
    !searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase()) || p.code.toLowerCase().includes(searchTerm.toLowerCase()) || p.client_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AnimatedPage>
      <PageHeader title="Projects" subtitle="Manage projects across all regions"
        actions={canManage ? <Button onClick={openCreate} icon={Plus}>New Project</Button> : undefined}
      />

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total', value: projects.length, icon: FolderKanban, bg: 'bg-slate-100', color: 'text-slate-600' },
          { label: 'Active', value: projects.filter(p => p.status === 'active').length, icon: FolderKanban, bg: 'bg-brand-50', color: 'text-brand-600' },
          { label: 'Countries', value: new Set(projects.map(p => p.country)).size, icon: MapPin, bg: 'bg-blue-50', color: 'text-blue-600' },
          { label: 'Teams', value: projects.reduce((s, p) => s + (p.total_teams || 0), 0), icon: Users, bg: 'bg-brand-50', color: 'text-brand-600' },
        ].map((s, i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center`}><s.icon className={`w-5 h-5 ${s.color}`} /></div>
            <div><div className="text-2xl font-bold text-slate-900">{s.value}</div><div className="text-xs text-slate-500">{s.label}</div></div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <FilterBar searchValue={searchTerm} onSearchChange={setSearchTerm} searchPlaceholder="Search projects..."
        filters={<>
          <select value={selectedCountry} onChange={e => setSelectedCountry(e.target.value)} className="text-sm bg-white border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/20 focus:border-[#2AA7A0]/40 text-slate-700 cursor-pointer" aria-label="Filter by country">
            <option value="all">All Countries</option>
            <option value="UK">🇬🇧 UK</option><option value="Australia">🇦🇺 Australia</option>
            <option value="Canada">🇨🇦 Canada</option><option value="USA">🇺🇸 USA</option>
            <option value="Vietnam">🇻🇳 Vietnam</option>
          </select>
          <select value={selectedDepartment} onChange={e => setSelectedDepartment(e.target.value)} className="text-sm bg-white border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/20 focus:border-[#2AA7A0]/40 text-slate-700 cursor-pointer" aria-label="Filter by department">
            <option value="all">All Departments</option>
            <option value="floor_plan">Floor Plan</option><option value="photos_enhancement">Photos Enhancement</option>
          </select>
          <Button variant="secondary" size="sm" onClick={loadProjects}>Search</Button>
        </>}
      />

      {/* Table */}
      <div className="mt-4">
        <DataTable
          data={filtered} loading={loading}
          columns={[
            { key: 'name', label: 'Project', sortable: true, render: (p) => (
              <div>
                <div className="font-semibold text-slate-900">{p.name}</div>
                <div className="text-xs text-slate-400">{p.code} &middot; {p.client_name}</div>
              </div>
            )},
            { key: 'country', label: 'Country', render: (p) => <span>{FLAGS[p.country] || ''} {p.country}</span> },
            { key: 'department', label: 'Department', render: (p) => <span className="text-slate-600 capitalize">{p.department.replace('_', ' ')}</span> },
            { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
            { key: 'orders', label: 'Orders', sortable: true, render: (p) => (
              <div className="text-right">
                <span className="font-semibold text-slate-900">{p.total_orders}</span>
                {p.total_orders > 0 && (
                  <div className="w-20 h-1.5 bg-slate-100 rounded-full mt-1">
                    <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.min((p.completed_orders / p.total_orders) * 100, 100)}%` }} />
                  </div>
                )}
              </div>
            )},
            { key: 'actions', label: '', render: (p) => canManage ? (
              <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="xs" onClick={() => handleViewStats(p)}><BarChart3 className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="xs" onClick={() => handleViewTeams(p)}><Users className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="xs" onClick={() => openEdit(p)}><Edit className="w-3.5 h-3.5" /></Button>
                <Button variant="ghost" size="xs" onClick={() => setDeleteConfirm(p.id)}><Trash2 className="w-3.5 h-3.5 text-rose-500" /></Button>
              </div>
            ) : null },
          ]}
          emptyIcon={FolderKanban}
          emptyTitle="No projects found"
          emptyDescription="Adjust filters or create a new project."
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal 
        open={showModal} 
        onClose={() => setShowModal(false)} 
        title={editingProject ? 'Edit Project' : 'Create New Project'}
        subtitle={editingProject ? 'Update project information' : 'Add a new project to the system'}
        size="lg"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button 
              className="flex-1" 
              onClick={handleSave} 
              loading={saving}
              disabled={!formData.name || !formData.code || !formData.client_name}
            >
              {editingProject ? 'Update Project' : 'Create Project'}
            </Button>
          </>
        }
      >
        {formError && (
          <div className="mb-4 p-4 bg-rose-50 border-l-4 border-rose-400 rounded-lg">
            <p className="text-sm font-medium text-rose-800">{formError}</p>
          </div>
        )}
        <div className="space-y-5">
          <Input
            id="project-name"
            label="Project Name"
            required
            type="text"
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Luxury Apartments London"
            maxLength={100}
            showCharCount
            currentLength={formData.name.length}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              id="project-code"
              label="Project Code"
              required
              type="text"
              value={formData.code}
              onChange={e => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
              placeholder="PRJ-001"
              maxLength={20}
              hint="Unique identifier for this project"
            />
            <Input
              id="client-name"
              label="Client Name"
              required
              type="text"
              value={formData.client_name}
              onChange={e => setFormData({ ...formData, client_name: e.target.value })}
              placeholder="Client or company name"
              maxLength={100}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Select
              id="country"
              label="Country"
              value={formData.country}
              onChange={e => {
                const country = e.target.value;
                const tzList = COUNTRY_TIMEZONES[country] || [];
                // Keep existing timezone if it's valid for the new country; otherwise auto-select
                // if there's only one option, or clear so the user picks explicitly.
                const keepTz = tzList.some(tz => tz.value === formData.timezone);
                const newTimezone = keepTz
                  ? formData.timezone
                  : tzList.length === 1 ? tzList[0].value : '';
                setFormData({ ...formData, country, timezone: newTimezone });
              }}
            >
              <option value="all">All Countries</option>
              <option value="UK">United Kingdom</option>
              <option value="Australia">Australia</option>
              <option value="Canada">Canada</option>
              <option value="USA">United States</option>
              <option value="Vietnam">Vietnam</option>
            </Select>

            <Select
              id="department"
              label="Department"
              value={formData.department}
              onChange={e => setFormData({ ...formData, department: e.target.value })}
            >
              <option value="floor_plan">Floor Plan</option>
              <option value="photos_enhancement">Photos Enhancement</option>
            </Select>

            <Select
              id="status"
              label="Status"
              value={formData.status}
              onChange={e => setFormData({ ...formData, status: e.target.value })}
            >
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </Select>
          </div>

          {formData.country && formData.country !== 'all' && COUNTRY_TIMEZONES[formData.country] && (
            <Select
              id="timezone"
              label="Timezone"
              value={formData.timezone}
              onChange={e => setFormData({ ...formData, timezone: e.target.value })}
            >
              <option value="">Select Timezone</option>
              {COUNTRY_TIMEZONES[formData.country].map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </Select>
          )}

          <Textarea
            id="description"
            label="Description"
            value={formData.description}
            onChange={e => setFormData({ ...formData, description: e.target.value })}
            rows={3}
            placeholder="Optional project description or notes"
            maxLength={500}
            showCharCount
            currentLength={formData.description.length}
          />

          <div className="flex items-center gap-2 mt-4">
            <input
              type="checkbox"
              id="action-checkbox"
              checked={formData.action}
              onChange={e => setFormData({ ...formData, action: e.target.checked })}
              className="w-4 h-4 text-[#2AA7A0] rounded border-slate-300 focus:ring-[#2AA7A0]"
            />
            <label htmlFor="action-checkbox" className="text-sm font-medium text-slate-700 cursor-pointer">
              Enable Action
            </label>
          </div>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal 
        open={!!deleteConfirm} 
        onClose={() => setDeleteConfirm(null)} 
        title="Delete Project?" 
        subtitle="This action cannot be undone"
        variant="danger"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)} className="flex-1">Cancel</Button>
            <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} loading={deleting} className="flex-1">Delete Project</Button>
          </>
        }
      >
        <div className="text-center py-4">
          <div className="mb-4">
            <p className="text-base text-slate-700 font-medium mb-2">
              Are you sure you want to delete <span className="font-bold text-slate-900">{projects.find(p => p.id === deleteConfirm)?.name}</span>?
            </p>
            <p className="text-sm text-slate-600">
              All associated data, teams, and orders will be affected. This action is permanent and cannot be reversed.
            </p>
          </div>
        </div>
      </Modal>

      {/* Stats Modal */}
      <Modal open={!!showStats} onClose={() => { setShowStats(null); setProjectStats(null); }} title={`${showStats?.name} — Statistics`}>
        {projectStats ? (
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(projectStats.data || projectStats).map(([key, value]: [string, any]) => (
              <div key={key} className="bg-slate-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-slate-900">{typeof value === 'number' ? value : JSON.stringify(value)}</div>
                <div className="text-xs text-slate-500 mt-1 capitalize">{key.replace(/_/g, ' ')}</div>
              </div>
            ))}
          </div>
        ) : <div className="text-center py-8 text-slate-400">Loading...</div>}
      </Modal>

      {/* Teams Modal */}
      <Modal open={!!showTeams} onClose={() => { setShowTeams(null); setProjectTeams([]); }} title={`${showTeams?.name} — Teams`}>
        {projectTeams.length > 0 ? (
          <div className="space-y-2">
            {projectTeams.map((t: any, i: number) => (
              <div key={i} className="bg-slate-50 rounded-lg p-4 flex items-center justify-between">
                <span className="font-semibold text-slate-900">{t.name}</span>
                <span className="text-xs text-slate-500">{t.members_count || t.members?.length || 0} members</span>
              </div>
            ))}
          </div>
        ) : <div className="text-center py-8 text-slate-400">No teams found.</div>}
      </Modal>
    </AnimatedPage>
  );
}
