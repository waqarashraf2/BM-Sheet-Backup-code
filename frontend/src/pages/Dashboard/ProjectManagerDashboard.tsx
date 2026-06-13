import React, { useState, useEffect } from 'react';
import { dashboardService, projectService } from '../../services';
import { useSmartPolling } from '../../hooks/useSmartPolling';

import type { DashboardTeamPerformance, PMDashboardData } from '../../types';
import { AnimatedPage, PageHeader, StatCard, PMDashboardSkeleton } from '../../components/ui';
import {
  Package, TrendingUp, Clock, Users, ChevronDown, ChevronRight,
  Pencil, CheckSquare, Eye, Palette, CircleDot, UserCheck, AlertTriangle, Info,
  Plus, Trash2, X, Timer, Target, Search, CalendarClock,
} from 'lucide-react';
import TimeWiseCountView from './TimeWiseCountView';

export default function ProjectManagerDashboard() {
  const [data, setData] = useState<PMDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState<number | null>(null);
  const [expandedStaff, setExpandedStaff] = useState<number | null>(null);
  const [staffRoleFilter, setStaffRoleFilter] = useState<string>('all');
  const [staffSearch, setStaffSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'projects' | 'staff' | 'teams' | 'time-wise'>('projects');
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [selectedTeamProjectId, setSelectedTeamProjectId] = useState<number | null>(null);
  const [showEditTeam, setShowEditTeam] = useState(false);
  const [editingTeam, setEditingTeam] = useState<DashboardTeamPerformance | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [updatingTeam, setUpdatingTeam] = useState(false);

  const loadData = async () => {
    try {
      const res = await dashboardService.projectManager();
      setData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedTeamProjectId && (data?.projects?.length ?? 0) > 0) {
      setSelectedTeamProjectId(data?.projects?.[0]?.project?.id ?? null);
    }
  }, [data?.projects, selectedTeamProjectId]);



  /* ── Smart Polling: only reload when data actually changes ── */
  useSmartPolling({
    scope: 'all',
    interval: 45_000, // Changed from 10_000 to 45_000 (45 seconds)
    onDataChanged: loadData,
  });

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    const projectId = selectedTeamProjectId;
    if (!projectId) return;
    try {
      setCreatingTeam(true);
      setTeamError('');
      await projectService.createTeam(projectId, newTeamName.trim());
      setNewTeamName('');
      setShowCreateTeam(false);
      loadData();
    } catch (e: any) {
      setTeamError(e?.response?.data?.message || 'Failed to create team');
    } finally {
      setCreatingTeam(false);
    }
  };

  const handleDeleteTeam = async (team: DashboardTeamPerformance) => {
    const projectId = team.project_id ?? selectedTeamProjectId;
    if (!projectId) return;
    const staffCount = team.staff_count ?? 0;
    if (staffCount > 0) {
      setTeamError('Only empty teams can be deleted. Move members first.');
      return;
    }
    if (!confirm('Are you sure you want to delete this team?')) return;
    try {
      await projectService.deleteTeam(projectId, team.id);
      loadData();
    } catch (e: any) {
      setTeamError(e?.response?.data?.message || 'Failed to delete team');
    }
  };

  const openEditTeamModal = (team: DashboardTeamPerformance) => {
    setEditingTeam(team);
    setEditTeamName(team.name || '');
    setTeamError('');
    setShowEditTeam(true);
  };

  const handleUpdateTeam = async () => {
    if (!editingTeam || !editTeamName.trim()) return;

    const projectId = editingTeam.project_id ?? selectedTeamProjectId;
    if (!projectId) {
      setTeamError('Project is required to update team.');
      return;
    }

    try {
      setUpdatingTeam(true);
      setTeamError('');
      await projectService.updateTeam(projectId, editingTeam.id, { name: editTeamName.trim() });
      setShowEditTeam(false);
      setEditingTeam(null);
      setEditTeamName('');
      loadData();
    } catch (e: any) {
      setTeamError(e?.response?.data?.message || 'Failed to update team');
    } finally {
      setUpdatingTeam(false);
    }
  };

  const roleIcons: Record<string, React.ElementType> = {
    drawer: Pencil,
    checker: CheckSquare,
    qa: Eye,
    designer: Palette,
  };

  const roleColors: Record<string, { bg: string; text: string }> = {
    drawer: { bg: 'bg-blue-50', text: 'text-blue-700' },
    checker: { bg: 'bg-violet-50', text: 'text-violet-700' },
    qa: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
    designer: { bg: 'bg-pink-50', text: 'text-pink-700' },
  };

  // Department-based layer labels
  const hasFP = data?.projects?.some(p => p.project.workflow_type !== 'PH_2_LAYER');
  const hasPE = data?.projects?.some(p => p.project.workflow_type === 'PH_2_LAYER');
  const departmentLabel = hasFP && hasPE ? 'Floor Plan + Photos' : hasPE ? 'Photos Enhancement' : 'Floor Plan';
  const departmentLayers = data?.department_roles || [];
  const layerLabel = departmentLayers.length > 0
    ? `${departmentLayers.length} Layers: ${departmentLayers.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(' → ')}`
    : '';

  const stateLabels: Record<string, string> = {
    RECEIVED: 'Received',
    PENDING_QA_REVIEW: 'QA Review',
    QUEUED_DRAW: 'Queue (Draw)',
    IN_DRAW: 'In Drawing',
    SUBMITTED_DRAW: 'Submitted (Draw)',
    QUEUED_CHECK: 'Queue (Check)',
    IN_CHECK: 'In Checking',
    SUBMITTED_CHECK: 'Submitted (Check)',
    QUEUED_QA: 'Queue (QA)',
    IN_QA: 'In QA',
    APPROVED_QA: 'Approved',
    QUEUED_DESIGN: 'Queue (Design)',
    IN_DESIGN: 'In Design',
    SUBMITTED_DESIGN: 'Submitted (Design)',
    DELIVERED: 'Delivered',
    ON_HOLD: 'On Hold',
    CANCELLED: 'Cancelled',
    REJECTED_BY_CHECK: 'Rejected (Check)',
    REJECTED_BY_QA: 'Rejected (QA)',
  };

  if (loading) return (
    <AnimatedPage>
      <PMDashboardSkeleton />
    </AnimatedPage>
  );

  if (!data) return <div className="text-center py-20 text-slate-500">Failed to load dashboard.</div>;

  const filteredStaff = (data.staff_report || []).filter(
    (s) => departmentLayers.length === 0 || departmentLayers.includes(s.role)
  );

  const tabs = [
    { key: 'projects' as const, label: 'My Projects', count: (data.projects || []).length },
    { key: 'staff' as const, label: 'Staff Report', count: filteredStaff.length },
    { key: 'teams' as const, label: 'Teams', count: (data.team_performance || []).length },
    { key: 'time-wise' as const, label: 'Time-wise Count', count: 0, icon: CalendarClock },
  ];

  return (
    <AnimatedPage>
      <div className="min-w-0">
        <PageHeader
          title="Project Manager Dashboard"
          subtitle={data.projects?.length > 0
            ? `${data.projects.length} project${data.projects.length !== 1 ? 's' : ''} · ${departmentLabel} · ${layerLabel}`
            : 'No projects assigned'}
          badge={
            <span className="flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 px-2.5 py-1 rounded-full">
              <span className="live-dot" /> Live
            </span>
          }
        />

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Received Today" value={data.totals?.received_today ?? 0} icon={Package} color="brand" />
          <StatCard label="Pending" value={data.totals?.pending ?? 0} icon={Clock} color="amber" />
          <StatCard label="In Progress" value={data.totals?.in_progress ?? 0} icon={CircleDot} color="blue" />
          <StatCard label="Delivered Today" value={data.totals?.delivered_today ?? 0} icon={TrendingUp} color="green" />
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 bg-slate-100 rounded-xl p-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex min-w-max flex-1 items-center justify-center gap-2 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${activeTab === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
                }`}
            >
              {'icon' in tab && tab.icon && <tab.icon className="h-4 w-4" />}
              {tab.label}
              {tab.count > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.key ? 'bg-brand-50 text-brand-700' : 'bg-slate-200 text-slate-600'
                  }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {activeTab === 'time-wise' && (
          <TimeWiseCountView
            dashboard="project-manager"
            projects={(data.projects || []).map((item) => item.project)}
          />
        )}

        {/* Projects Tab */}
        {activeTab === 'projects' && (
          <div className="space-y-4">
            {(data.projects || []).map((item) => {
              const isExpanded = expandedProject === item.project.id;
              return (
                <div key={item.project.id} className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
                  <button
                    onClick={() => setExpandedProject(isExpanded ? null : item.project.id)}
                    className="w-full px-5 py-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{item.project.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {item.project.code} · {item.project.country} · {item.project.workflow_type === 'FP_3_LAYER' ? 'Floor Plan' : 'Photos'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Pending</div>
                        <div className="text-sm font-bold text-amber-600">{item.pending}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500">In Progress</div>
                        <div className="text-sm font-bold text-blue-600">{item.in_progress}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Delivered</div>
                        <div className="text-sm font-bold text-emerald-600">{item.delivered_today}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500">Staff</div>
                        <div className="text-sm font-bold text-slate-700">{item.active_staff}/{item.total_staff}</div>
                      </div>
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                    </div>
                  </button>

                  {isExpanded && Object.keys(item.queue_stages || {}).length > 0 && (
                    <div className="px-5 pb-4 border-t border-slate-100">
                      <div className="mt-3">
                        <h4 className="text-xs font-semibold text-slate-500 uppercase mb-2">Queue Stages</h4>
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                          {Object.entries(item.queue_stages || {}).map(([state, count]) => (
                            <div key={state} className="bg-slate-50 rounded-lg p-2.5 text-center">
                              <div className="text-lg font-bold text-slate-900">{count}</div>
                              <div className="text-[10px] text-slate-500 uppercase mt-0.5">{stateLabels[state] || state}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {(data.projects || []).length === 0 && (
              <div className="text-center py-12 text-slate-500">No projects assigned to you.</div>
            )}
          </div>
        )}

        {/* Staff Report Tab */}
        {activeTab === 'staff' && (
          <div className="space-y-4">
            {/* Role Filter Pills + Search */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex flex-wrap gap-2 flex-1">
                <button
                  onClick={() => setStaffRoleFilter('all')}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${staffRoleFilter === 'all' ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                >
                  All ({filteredStaff.length})
                </button>
                {departmentLayers.map((role) => {
                  const RIcon = roleIcons[role] || Users;
                  const colors = roleColors[role] || { bg: 'bg-slate-100', text: 'text-slate-700' };
                  const count = filteredStaff.filter(s => s.role === role).length;
                  return (
                    <button
                      key={role}
                      onClick={() => setStaffRoleFilter(role)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${staffRoleFilter === role ? `${colors.bg} ${colors.text} ring-2 ring-offset-1 ring-current shadow-sm` : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                      <RIcon className="h-3 w-3" />
                      {role.charAt(0).toUpperCase() + role.slice(1)}s ({count})
                    </button>
                  );
                })}
              </div>
              <div className="relative w-full sm:w-64 flex-shrink-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={staffSearch}
                  onChange={e => setStaffSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none bg-white"
                />
              </div>
            </div>

            {/* Role Summary Cards */}
            {data.role_summary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(staffRoleFilter === 'all' ? departmentLayers : [staffRoleFilter]).map((role) => {
                  const summary = data.role_summary?.[role];
                  if (!summary) return null;
                  const RIcon = roleIcons[role] || Users;
                  const colors = roleColors[role] || { bg: 'bg-slate-50', text: 'text-slate-700' };
                  return (
                    <div key={role} className={`rounded-xl p-4 ${colors.bg} ring-1 ring-black/[0.04]`}>
                      <div className="flex items-center gap-2 mb-3">
                        <RIcon className={`h-4 w-4 ${colors.text}`} />
                        <span className={`text-sm font-semibold ${colors.text}`}>{role.charAt(0).toUpperCase() + role.slice(1)}s</span>
                        <span className="ml-auto text-lg font-bold text-slate-900">{summary.total}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-slate-500">Online</span>
                          <div className="font-semibold text-emerald-600">{summary.online}</div>
                        </div>
                        <div>
                          <span className="text-slate-500">Absent</span>
                          <div className="font-semibold text-red-500">{summary.absent}</div>
                        </div>
                        <div>
                          <span className="text-slate-500">Assigned</span>
                          <div className="font-semibold text-blue-600">{summary.total_assigned ?? 0}</div>
                        </div>
                        <div>
                          <span className="text-slate-500">Done Today</span>
                          <div className="font-semibold text-emerald-600">{summary.completed_today}</div>
                        </div>
                        <div>
                          <span className="text-slate-500">This Week</span>
                          <div className="font-semibold text-violet-600">{summary.completed_week}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Staff Table */}
            <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-900">
                  {staffRoleFilter === 'all' ? 'All Staff' : `${staffRoleFilter.charAt(0).toUpperCase() + staffRoleFilter.slice(1)}s`}
                </h3>
                <span className="text-xs text-slate-400 ml-1">Click a row to expand details</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50/80">
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase w-6"></th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Name</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Role</th>
                      <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Team</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Status</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase" title="Total orders currently assigned">Assigned</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase" title="Assigned but not yet started">Pending</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase" title="Currently working on">WIP</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase" title="Completed today">Done Today</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase" title="Completed this week">Week</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase" title="Completed this month">Month</th>
                      <th className="px-3 py-3 text-center text-xs font-semibold text-slate-500 uppercase" title="Daily target progress">Target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(data.staff_report || [])
                      .filter((staff) => departmentLayers.length === 0 || departmentLayers.includes(staff.role))
                      .filter((staff) => staffRoleFilter === 'all' || staff.role === staffRoleFilter)
                      .filter((staff) => !staffSearch || staff.name.toLowerCase().includes(staffSearch.toLowerCase()) || staff.email.toLowerCase().includes(staffSearch.toLowerCase()))
                      .map((staff) => {
                        const RoleIcon = roleIcons[staff.role] || Users;
                        const colors = roleColors[staff.role] || { bg: 'bg-slate-50', text: 'text-slate-700' };
                        const isExpanded = expandedStaff === staff.id;
                        const targetPct = staff.daily_target > 0 ? Math.round((staff.completed_today / staff.daily_target) * 100) : null;
                        return (
                          <React.Fragment key={staff.id}>
                            <tr
                              onClick={() => setExpandedStaff(isExpanded ? null : staff.id)}
                              className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                            >
                              <td className="pl-3 py-3">
                                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${staff.is_absent ? 'bg-rose-500' : staff.is_online ? 'bg-green-500' : 'bg-amber-500'}`} />
                                  <span className="text-sm font-medium text-slate-900">{staff.name}</span>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
                                  <RoleIcon className="h-3 w-3" />
                                  {staff.role}
                                </span>
                              </td>
                              <td className="px-3 py-3">
                                <span className="text-xs text-slate-600">{staff.team_name || '—'}</span>
                              </td>
                              <td className="px-3 py-3 text-center">
                                {staff.is_absent ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-red-600">
                                    <AlertTriangle className="h-3 w-3" /> Absent
                                  </span>
                                ) : staff.is_online ? (
                                  <span className="text-xs text-green-600 font-medium">Online</span>
                                ) : (
                                  <span className="text-xs text-amber-500">Offline</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className={`text-sm font-bold ${staff.assigned_work > 0 ? 'text-blue-600' : 'text-slate-300'}`}>{staff.assigned_work}</span>
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className={`text-sm font-bold ${staff.pending_work > 0 ? 'text-amber-600' : 'text-slate-300'}`}>{staff.pending_work}</span>
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className={`text-sm font-bold ${staff.wip_count > 0 ? 'text-indigo-600' : 'text-slate-300'}`}>{staff.wip_count}</span>
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className={`text-sm font-bold ${staff.completed_today > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{staff.completed_today}</span>
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className={`text-sm font-semibold ${(staff.completed_week ?? 0) > 0 ? 'text-violet-600' : 'text-slate-300'}`}>{staff.completed_week ?? 0}</span>
                              </td>
                              <td className="px-3 py-3 text-center">
                                <span className={`text-sm font-semibold ${(staff.completed_month ?? 0) > 0 ? 'text-teal-600' : 'text-slate-300'}`}>{staff.completed_month ?? 0}</span>
                              </td>
                              <td className="px-3 py-3 text-center">
                                {staff.daily_target > 0 ? (
                                  <div className="flex flex-col items-center gap-0.5">
                                    <span className={`text-xs font-bold ${targetPct !== null && targetPct >= 100 ? 'text-emerald-600' : targetPct !== null && targetPct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                                      {staff.completed_today}/{staff.daily_target}
                                    </span>
                                    <div className="w-12 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                      <div
                                        className={`h-full rounded-full transition-all ${targetPct !== null && targetPct >= 100 ? 'bg-emerald-500' : targetPct !== null && targetPct >= 50 ? 'bg-amber-500' : 'bg-red-400'}`}
                                        style={{ width: `${Math.min(targetPct || 0, 100)}%` }}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-xs text-slate-300">—</span>
                                )}
                              </td>
                            </tr>
                            {/* Expanded Detail Row */}
                            {isExpanded && (
                              <tr className="bg-slate-50/60">
                                <td colSpan={12} className="px-6 py-4">
                                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                    {/* Workload Breakdown */}
                                    <div className="bg-white rounded-lg p-3 ring-1 ring-black/[0.04]">
                                      <div className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Workload</div>
                                      <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs text-slate-500">Assigned</span>
                                          <span className="text-sm font-bold text-blue-600">{staff.assigned_work}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs text-slate-500">Pending</span>
                                          <span className="text-sm font-bold text-amber-600">{staff.pending_work}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs text-slate-500">In Progress</span>
                                          <span className="text-sm font-bold text-indigo-600">{staff.wip_count}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Completions */}
                                    <div className="bg-white rounded-lg p-3 ring-1 ring-black/[0.04]">
                                      <div className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Completions</div>
                                      <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs text-slate-500">Today</span>
                                          <span className="text-sm font-bold text-emerald-600">{staff.completed_today}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs text-slate-500">This Week</span>
                                          <span className="text-sm font-bold text-violet-600">{staff.completed_week ?? 0}</span>
                                        </div>
                                        <div className="flex items-center justify-between">
                                          <span className="text-xs text-slate-500">This Month</span>
                                          <span className="text-sm font-bold text-teal-600">{staff.completed_month ?? 0}</span>
                                        </div>
                                      </div>
                                    </div>

                                    {/* Avg Time */}
                                    <div className="bg-white rounded-lg p-3 ring-1 ring-black/[0.04]">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <Timer className="h-3.5 w-3.5 text-blue-500" />
                                        <div className="text-[10px] text-slate-500 uppercase font-semibold">Avg Time</div>
                                      </div>
                                      <div className="text-lg font-bold text-slate-900">
                                        {staff.avg_completion_minutes > 0 ? `${staff.avg_completion_minutes} min` : '—'}
                                      </div>
                                      <div className="text-[10px] text-slate-400 mt-0.5">per order</div>
                                    </div>

                                    {/* Daily Target */}
                                    <div className="bg-white rounded-lg p-3 ring-1 ring-black/[0.04]">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <Target className="h-3.5 w-3.5 text-amber-500" />
                                        <div className="text-[10px] text-slate-500 uppercase font-semibold">Daily Target</div>
                                      </div>
                                      {staff.daily_target > 0 ? (
                                        <>
                                          <div className="text-lg font-bold text-slate-900">{staff.completed_today} <span className="text-slate-400 text-sm font-normal">/ {staff.daily_target}</span></div>
                                          <div className="w-full h-2 bg-slate-100 rounded-full mt-2 overflow-hidden">
                                            <div
                                              className={`h-full rounded-full transition-all ${targetPct !== null && targetPct >= 100 ? 'bg-emerald-500' : targetPct !== null && targetPct >= 50 ? 'bg-amber-500' : 'bg-red-400'}`}
                                              style={{ width: `${Math.min(targetPct || 0, 100)}%` }}
                                            />
                                          </div>
                                          <div className={`text-xs font-semibold mt-1 ${targetPct !== null && targetPct >= 100 ? 'text-emerald-600' : targetPct !== null && targetPct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                                            {targetPct}% achieved
                                          </div>
                                        </>
                                      ) : (
                                        <div className="text-lg font-bold text-slate-300">—</div>
                                      )}
                                    </div>

                                    {/* Contact */}
                                    <div className="bg-white rounded-lg p-3 ring-1 ring-black/[0.04]">
                                      <div className="flex items-center gap-1.5 mb-2">
                                        <Info className="h-3.5 w-3.5 text-slate-400" />
                                        <div className="text-[10px] text-slate-500 uppercase font-semibold">Info</div>
                                      </div>
                                      <div className="text-xs text-slate-600 truncate" title={staff.email}>{staff.email}</div>
                                      <div className="text-xs text-slate-400 mt-1">Project: {staff.project_name}</div>
                                      <div className="text-xs text-slate-400 mt-0.5">Team: {staff.team_name || '—'}</div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                  </tbody>
                </table>
              </div>
              {filteredStaff.filter(s => staffRoleFilter === 'all' || s.role === staffRoleFilter).filter(s => !staffSearch || s.name.toLowerCase().includes(staffSearch.toLowerCase()) || s.email.toLowerCase().includes(staffSearch.toLowerCase())).length === 0 && (
                <div className="text-center py-8 text-slate-500">{staffSearch ? `No staff found matching "${staffSearch}"` : 'No staff members found.'}</div>
              )}
            </div>
          </div>
        )}

        {/* Teams Tab */}
        {activeTab === 'teams' && (
          <div className="space-y-4">
            {/* Add Team Button */}
            <div className="flex justify-end">
              <button
                onClick={() => { setShowCreateTeam(true); setTeamError(''); setNewTeamName(''); }}
                className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shadow-sm"
              >
                <Plus className="h-4 w-4" /> Add Team
              </button>
            </div>

            {/* Create Team Modal */}
            {showCreateTeam && (
              <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateTeam(false)}>
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between p-5 border-b">
                    <h3 className="text-lg font-semibold text-slate-900">Create New Team</h3>
                    <button onClick={() => setShowCreateTeam(false)} className="p-1 rounded-lg hover:bg-slate-100" title="Close"><X className="h-5 w-5 text-slate-400" /></button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Project</label>
                      <select
                        value={selectedTeamProjectId ?? ''}
                        onChange={(e) => setSelectedTeamProjectId(Number(e.target.value) || null)}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none mb-3"
                      >
                        <option value="">Select Project</option>
                        {(data.projects || []).map((item) => (
                          <option key={item.project.id} value={item.project.id}>
                            {item.project.code} - {item.project.name}
                          </option>
                        ))}
                      </select>

                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Team Name</label>
                      <input
                        type="text"
                        value={newTeamName}
                        onChange={e => setNewTeamName(e.target.value)}
                        placeholder="e.g. Team Eight"
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleCreateTeam()}
                      />
                    </div>
                    {teamError && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{teamError}</div>}
                  </div>
                  <div className="flex justify-end gap-3 p-5 border-t bg-slate-50 rounded-b-2xl">
                    <button onClick={() => setShowCreateTeam(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
                    <button
                      onClick={handleCreateTeam}
                      disabled={!selectedTeamProjectId || !newTeamName.trim() || creatingTeam}
                      className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {creatingTeam ? 'Creating...' : 'Create Team'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showEditTeam && editingTeam && (
              <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowEditTeam(false)}>
                <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between p-5 border-b">
                    <h3 className="text-lg font-semibold text-slate-900">Edit Team</h3>
                    <button onClick={() => setShowEditTeam(false)} className="p-1 rounded-lg hover:bg-slate-100" title="Close"><X className="h-5 w-5 text-slate-400" /></button>
                  </div>
                  <div className="p-5 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">Team Name</label>
                      <input
                        type="text"
                        value={editTeamName}
                        onChange={e => setEditTeamName(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                        autoFocus
                        onKeyDown={e => e.key === 'Enter' && handleUpdateTeam()}
                      />
                    </div>
                    {teamError && <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{teamError}</div>}
                  </div>
                  <div className="flex justify-end gap-3 p-5 border-t bg-slate-50 rounded-b-2xl">
                    <button onClick={() => setShowEditTeam(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
                    <button
                      onClick={handleUpdateTeam}
                      disabled={!editTeamName.trim() || updatingTeam}
                      className="px-5 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {updatingTeam ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(data.team_performance || []).map((team) => {
              const members = team.users || [];
              const drawerMembers = (team.drawers && team.drawers.length > 0)
                ? team.drawers
                : members.filter((member) => member.role === 'drawer').map((member) => ({
                  id: member.id,
                  name: member.name,
                  total_done: member.completed_today ?? 0,
                  wip: member.wip_count ?? 0,
                }));
              const checkerMembers = (team.checkers && team.checkers.length > 0)
                ? team.checkers
                : members.filter((member) => member.role === 'checker').map((member) => ({
                  id: member.id,
                  name: member.name,
                  total_done: member.completed_today ?? 0,
                  wip: member.wip_count ?? 0,
                }));
              const qaMembers = (team.qas && team.qas.length > 0)
                ? team.qas
                : members.filter((member) => member.role === 'qa').map((member) => ({
                  id: member.id,
                  name: member.name,
                  total_done: member.completed_today ?? 0,
                  wip: member.wip_count ?? 0,
                }));
              const drawDone = team.drawer_total_done ?? team.raw_done ?? 0;
              const checkerDone = team.checker_total_done ?? team.check_done ?? 0;
              const qaDone = team.qa_total_done ?? team.qa_done ?? 0;
              const deliveredCount = team.delivered ?? team.total_delivered_orders ?? team.delivered_today ?? 0;
              const drawerNamesFromString = (team.drawer_names || '').split(',').map((n) => n.trim()).filter(Boolean);
              const checkerNamesFromString = (team.checker_names || '').split(',').map((n) => n.trim()).filter(Boolean);
              const qaNamesFromString = (team.qa_names || '').split(',').map((n) => n.trim()).filter(Boolean);

              return (
                <div key={team.id} className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{team.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {(team.project_code || 'Project')} · {team.is_active === false ? 'Inactive' : 'Active'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1">
                        <UserCheck className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-medium text-slate-700">{team.active_staff ?? 0}/{team.staff_count ?? team.users?.length ?? 0}</span>
                      </div>
                      <button
                        onClick={() => openEditTeamModal(team)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                        title="Edit team"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteTeam(team)}
                        disabled={(team.staff_count ?? team.users?.length ?? 0) > 0}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={(team.staff_count ?? team.users?.length ?? 0) > 0 ? 'Only empty teams can be deleted' : 'Delete team'}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-3">
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-slate-700">{team.drawer_count ?? team.users?.filter((u) => u.role === 'drawer').length ?? 0}</div>
                      <div className="text-[10px] text-slate-500 uppercase">Drawer</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-slate-700">{team.checker_count ?? team.users?.filter((u) => u.role === 'checker').length ?? 0}</div>
                      <div className="text-[10px] text-slate-500 uppercase">Checker</div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-slate-700">{team.qa_count ?? team.users?.filter((u) => u.role === 'qa').length ?? 0}</div>
                      <div className="text-[10px] text-slate-500 uppercase">QA</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-blue-600">{drawDone}</div>
                      <div className="text-[10px] text-slate-500 uppercase">Draw Done</div>
                    </div>
                    <div className="bg-violet-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-violet-600">{checkerDone}</div>
                      <div className="text-[10px] text-slate-500 uppercase">Check Done</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-emerald-600">{qaDone}</div>
                      <div className="text-[10px] text-slate-500 uppercase">QA Done</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
                    <div className="bg-amber-50 rounded-lg p-3 text-center">
                      <div className="text-base font-bold text-amber-600">{team.pending ?? 0}</div>
                      <div className="text-[10px] text-slate-500 uppercase">Assigned / Pending</div>
                    </div>
                    <div className="bg-teal-50 rounded-lg p-3 text-center">
                      <div className="text-base font-bold text-teal-600">{team.today_completed ?? 0}</div>
                      <div className="text-[10px] text-slate-500 uppercase">Done Today</div>
                    </div>
                    <div className="bg-brand-50 rounded-lg p-3 text-center">
                      <div className="text-base font-bold text-brand-700">{deliveredCount}</div>
                      <div className="text-[10px] text-slate-500 uppercase">Delivered</div>
                    </div>
                  </div>

                  {(members.length ?? 0) > 0 && (
                    <div className="overflow-x-auto border border-slate-100 rounded-lg">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50/80 text-xs text-slate-500 uppercase">
                            <th className="px-3 py-2 text-left">Member</th>
                            <th className="px-3 py-2 text-left">Role</th>
                            <th className="px-3 py-2 text-center">Assigned</th>
                            <th className="px-3 py-2 text-center">Pending</th>
                            <th className="px-3 py-2 text-center">WIP</th>
                            <th className="px-3 py-2 text-center">Done Today</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {members.map((member) => (
                            <tr key={member.id}>
                              <td className="px-3 py-2">
                                <div className="font-medium text-slate-900">{member.name}</div>
                                <div className="text-xs text-slate-400">{member.email}</div>
                              </td>
                              <td className="px-3 py-2 text-slate-700 capitalize">{member.role}</td>
                              <td className="px-3 py-2 text-center text-blue-600 font-semibold">{member.assigned_work ?? 0}</td>
                              <td className="px-3 py-2 text-center text-amber-600 font-semibold">{member.pending_work ?? 0}</td>
                              <td className="px-3 py-2 text-center text-indigo-600 font-semibold">{member.wip_count ?? 0}</td>
                              <td className="px-3 py-2 text-center text-emerald-600 font-semibold">{member.completed_today ?? 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {(drawerMembers.length > 0 || checkerMembers.length > 0 || qaMembers.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                      <div className="bg-blue-50/60 rounded-lg p-3">
                        <div className="text-xs font-semibold text-blue-700 uppercase mb-2">Drawer Panel</div>
                        <div className="space-y-1.5">
                          {drawerMembers.length === 0 && drawerNamesFromString.length === 0 ? (
                            <div className="text-xs text-slate-400">No drawers in this team</div>
                          ) : (drawerMembers.length > 0 ? drawerMembers : drawerNamesFromString.map((name, index) => ({ id: `drawer-${team.id}-${index}`, name, wip: 0, total_done: 0 } as any))).map((member) => (
                            <div key={member.id} className="flex items-center justify-between text-xs bg-white rounded-md px-2.5 py-1.5">
                              <span className="font-medium text-slate-700">{member.name}</span>
                              <span className="text-slate-500">WIP: <span className="font-semibold text-indigo-600">{member.wip ?? 0}</span> · Done: <span className="font-semibold text-emerald-600">{member.total_done ?? 0}</span></span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-violet-50/60 rounded-lg p-3">
                        <div className="text-xs font-semibold text-violet-700 uppercase mb-2">Checker Panel</div>
                        <div className="space-y-1.5">
                          {checkerMembers.length === 0 && checkerNamesFromString.length === 0 ? (
                            <div className="text-xs text-slate-400">No checkers in this team</div>
                          ) : (checkerMembers.length > 0 ? checkerMembers : checkerNamesFromString.map((name, index) => ({ id: `checker-${team.id}-${index}`, name, wip: 0, total_done: 0 } as any))).map((member) => (
                            <div key={member.id} className="flex items-center justify-between text-xs bg-white rounded-md px-2.5 py-1.5">
                              <span className="font-medium text-slate-700">{member.name}</span>
                              <span className="text-slate-500">WIP: <span className="font-semibold text-indigo-600">{member.wip ?? 0}</span> · Done: <span className="font-semibold text-emerald-600">{member.total_done ?? 0}</span></span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-emerald-50/60 rounded-lg p-3">
                        <div className="text-xs font-semibold text-emerald-700 uppercase mb-2">QA Panel</div>
                        <div className="space-y-1.5">
                          {qaMembers.length === 0 && qaNamesFromString.length === 0 ? (
                            <div className="text-xs text-slate-400">No QA in this team</div>
                          ) : (qaMembers.length > 0 ? qaMembers : qaNamesFromString.map((name, index) => ({ id: `qa-${team.id}-${index}`, name, wip: 0, total_done: 0 } as any))).map((member) => (
                            <div key={member.id} className="flex items-center justify-between text-xs bg-white rounded-md px-2.5 py-1.5">
                              <span className="font-medium text-slate-700">{member.name}</span>
                              <span className="text-slate-500">WIP: <span className="font-semibold text-indigo-600">{member.wip ?? 0}</span> · Done: <span className="font-semibold text-emerald-600">{member.total_done ?? 0}</span></span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {(data.team_performance || []).length === 0 && (
              <div className="text-center py-12 text-slate-500">No teams found.</div>
            )}
          </div>
        )}
      </div>
    </AnimatedPage>
  );
}
