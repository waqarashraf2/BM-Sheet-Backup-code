import React, { useState, useEffect } from 'react';
import { dashboardService, projectService } from '../../services';
import { useSmartPolling } from '../../hooks/useSmartPolling';
import type { DashboardTeamPerformance, OpsDashboardData, OpsProjectItem } from '../../types';
import { AnimatedPage, PageHeader, StatCard, StatusBadge, OpsManagerDashboardSkeleton } from '../../components/ui';
import { Users, AlertTriangle, Package, TrendingUp, ChevronRight, ChevronDown, Pencil, CheckSquare, Eye, Palette, Calendar, Shield, LayoutDashboard, Briefcase, UserCheck, Search, Target, Timer, Info, Plus, Trash2, X, CalendarClock } from 'lucide-react';
import DailyOperationsView from './DailyOperationsView';
import TimeWiseCountView from './TimeWiseCountView';

type OMTab = 'overview' | 'projects' | 'teams' | 'staff' | 'daily-operations' | 'time-wise';

export default function OperationsManagerDashboard() {
  const [data, setData] = useState<OpsDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedProject, setExpandedProject] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<OMTab>('overview');
  const [staffSearch, setStaffSearch] = useState('');
  const [staffRoleFilter, setStaffRoleFilter] = useState<string>('all');
  const [expandedStaff, setExpandedStaff] = useState<number | null>(null);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState('');
  const [selectedTeamProjectId, setSelectedTeamProjectId] = useState<number | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamError, setTeamError] = useState('');
  const [showEditTeam, setShowEditTeam] = useState(false);
  const [editingTeam, setEditingTeam] = useState<DashboardTeamPerformance | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [updatingTeam, setUpdatingTeam] = useState(false);

  const loadData = async () => {
    try {
      const res = await dashboardService.operations();
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

  const handleCreateTeam = async () => {
    const projectId = selectedTeamProjectId;
    if (!projectId || !newTeamName.trim()) return;

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
    const projectId = team.project_id;
    if (!projectId) {
      setTeamError('Team project is missing. Refresh the dashboard and try again.');
      return;
    }
    const staffCount = team.staff_count ?? 0;
    if (staffCount > 0) {
      setTeamError('Only empty teams can be deleted. Move members first.');
      return;
    }
    if (!window.confirm(`Delete team ${team.name}?`)) return;

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

    const projectId = editingTeam.project_id;
    if (!projectId) {
      setTeamError('Team project is missing. Refresh the dashboard and try again.');
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

  /* ── Smart Polling: only reload when data actually changes ── */
  useSmartPolling({
    scope: 'all',
    interval: 45_000, // Changed from 10_000 to 45_000 (45 seconds)
    onDataChanged: loadData,
  });

  const roleIcons: Record<string, any> = {
    drawer: Pencil,
    checker: CheckSquare,
    qa: Eye,
    designer: Palette,
  };

  const roleColorClasses: Record<string, { bg: string; icon: string }> = {
    drawer: { bg: 'bg-blue-50', icon: 'text-blue-600' },
    checker: { bg: 'bg-violet-50', icon: 'text-violet-600' },
    qa: { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
    designer: { bg: 'bg-pink-50', icon: 'text-pink-600' },
  };

  const workflowLabels: Record<string, string> = {
    FP_3_LAYER: 'Floor Plan (3-Layer)',
    PH_2_LAYER: 'Photos (2-Layer)',
  };

  const tabs = [
    { id: 'overview' as OMTab, label: 'Overview', icon: LayoutDashboard },
    { id: 'projects' as OMTab, label: 'Projects', icon: Briefcase },
    { id: 'teams' as OMTab, label: 'Teams', icon: Shield },
    { id: 'staff' as OMTab, label: 'Staff Report', icon: Users },
    { id: 'daily-operations' as OMTab, label: 'Daily Operations', icon: Calendar },
    { id: 'time-wise' as OMTab, label: 'Time-wise Count', icon: CalendarClock },
  ];

  if (loading) return (
    <AnimatedPage>
      <OpsManagerDashboardSkeleton />
    </AnimatedPage>
  );

  if (!data) return <div className="text-center py-20 text-slate-500">Failed to load dashboard.</div>;

  // Dynamic roles from backend role_stats (fixes hardcoded role list issue)
  const activeRoles = Object.keys(data.role_stats || {});
  const teams = data.team_performance || [];

  const getTeamRoleCount = (team: DashboardTeamPerformance, role: 'drawer' | 'checker' | 'qa' | 'designer') => {
    if (role === 'drawer') return team.drawer_count ?? team.users?.filter((u) => u.role === 'drawer').length ?? 0;
    if (role === 'checker') return team.checker_count ?? team.users?.filter((u) => u.role === 'checker').length ?? 0;
    if (role === 'qa') return team.qa_count ?? team.users?.filter((u) => u.role === 'qa').length ?? 0;
    return team.designer_count ?? team.users?.filter((u) => u.role === 'designer').length ?? 0;
  };

  return (
    <AnimatedPage>
      <div>
        <div className="min-w-0">
          <PageHeader
            title="Operations Dashboard"
            subtitle="Team performance and queue management"
            badge={
              <span className="flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 px-2.5 py-1 rounded-full">
                <span className="live-dot" /> Live
              </span>
            }
          />

          {/* Top Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Active Staff" value={data.total_active_staff ?? 0} icon={Users} color="brand" />
            <StatCard label="Absent" value={data.total_absent ?? 0} icon={AlertTriangle} color={(data.total_absent ?? 0) > 0 ? 'rose' : 'slate'} />
            <StatCard label="Pending Orders" value={data.total_pending ?? 0} icon={Package} color="amber" />
            <StatCard label="Delivered Today" value={data.total_delivered_today ?? 0} icon={TrendingUp} color="green" />
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 mb-6 p-1 bg-slate-100 rounded-xl w-full overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex shrink-0 items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Daily Operations Tab */}
          {activeTab === 'daily-operations' && (
            <DailyOperationsView />
          )}

          {activeTab === 'time-wise' && (
            <TimeWiseCountView
              dashboard="operations"
              projects={(data.projects || []).map((item) => item.project)}
            />
          )}

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <>
              {/* Role-wise Statistics — dynamic roles from backend */}
              {data.role_stats && activeRoles.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <Users className="h-4 w-4 text-slate-400" /> Role-wise Statistics
                  </h3>
                  <div className={`grid gap-4 ${activeRoles.length <= 2 ? 'grid-cols-2' : activeRoles.length === 3 ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-4'}`}>
                    {activeRoles.map((role) => {
                      const stats = data.role_stats?.[role];
                      if (!stats) return null;
                      const Icon = roleIcons[role] || Users;
                      const colors = roleColorClasses[role] || { bg: 'bg-slate-50', icon: 'text-slate-600' };
                      return (
                        <div key={role} className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4">
                          <div className="flex items-center gap-2 mb-3">
                            <div className={`p-2 rounded-lg ${colors.bg}`}>
                              <Icon className={`h-4 w-4 ${colors.icon}`} />
                            </div>
                            <span className="text-sm font-semibold text-slate-900 capitalize">{role}s</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-center">
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-lg font-bold text-brand-600">{stats.today_completed}</div>
                              <div className="text-[10px] text-slate-500 uppercase">Done</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-lg font-bold text-amber-600">{stats.total_wip}</div>
                              <div className="text-[10px] text-slate-500 uppercase">WIP</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-lg font-bold text-teal-600">{stats.active}</div>
                              <div className="text-[10px] text-slate-500 uppercase">Active</div>
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2">
                              <div className="text-lg font-bold text-rose-600">{stats.absent}</div>
                              <div className="text-[10px] text-slate-500 uppercase">Absent</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Date-wise Statistics */}
              {data.date_stats && data.date_stats.length > 0 && (
                <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
                  <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-slate-400" /> Last 7 Days Performance
                  </h3>

                  {/* Summary Chart */}
                  <div className="grid grid-cols-7 gap-2 mb-4">
                    {data.date_stats.map((day) => {
                      const maxVal = Math.max(...data.date_stats!.map(d => Math.max(d.received, d.delivered)));
                      const receivedHeight = maxVal > 0 ? (day.received / maxVal) * 60 : 0;
                      const deliveredHeight = maxVal > 0 ? (day.delivered / maxVal) * 60 : 0;
                      return (
                        <div key={day.date} className="text-center">
                          <div className="flex items-end justify-center gap-1 h-16 mb-1">
                            <div
                              className="w-3 bg-blue-200 rounded-t"
                              style={{ height: `${receivedHeight}px` }}
                              title={`Received: ${day.received}`}
                            />
                            <div
                              className="w-3 bg-brand-400 rounded-t"
                              style={{ height: `${deliveredHeight}px` }}
                              title={`Delivered: ${day.delivered}`}
                            />
                          </div>
                          <div className="text-xs font-medium text-slate-600">{day.label}</div>
                          <div className="text-[10px] text-slate-400">{day.date.slice(5)}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Role breakdown — dynamic roles */}
                  <div className="border-t border-slate-100 pt-4">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Completions by Role</div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-slate-500">
                            <th className="text-left py-1 pr-4">Role</th>
                            {data.date_stats.map(day => (
                              <th key={day.date} className="text-center px-2 py-1">{day.label}</th>
                            ))}
                            <th className="text-center px-2 py-1 font-bold">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeRoles.map(role => {
                            const total = data.date_stats!.reduce((sum, d) => sum + ((d.by_role || {})[role] || 0), 0);
                            return (
                              <tr key={role} className="border-t border-slate-50">
                                <td className="py-2 pr-4 font-medium text-slate-700 capitalize">{role}</td>
                                {data.date_stats!.map(day => (
                                  <td key={day.date} className="text-center px-2 py-2 text-slate-600">
                                    {(day.by_role || {})[role] || 0}
                                  </td>
                                ))}
                                <td className="text-center px-2 py-2 font-bold text-slate-900">{total}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <div className="w-3 h-3 bg-blue-200 rounded" /> Received
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <div className="w-3 h-3 bg-brand-400 rounded" /> Delivered
                    </div>
                  </div>
                </div>
              )}

              {/* Project Managers Visibility */}
              {data.project_managers && data.project_managers.length > 0 && (
                <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <UserCheck className="h-4 w-4 text-slate-400" /> Project Managers
                  </h3>
                  <div className="space-y-3">
                    {data.project_managers.map((pm) => (
                      <div key={pm.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                        <div>
                          <span className="text-sm font-medium text-slate-900">{pm.name}</span>
                          <span className="text-xs text-slate-400 ml-2">{pm.email}</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          {pm.projects.map((p) => (
                            <span key={p.id} className="text-xs px-2 py-0.5 bg-brand-50 text-brand-700 rounded-full font-medium">
                              {p.code}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Team Performance */}
              {data.team_performance && data.team_performance.length > 0 && (
                <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-slate-400" /> Team Performance
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-slate-500 uppercase tracking-wider">
                          <th className="text-left py-2 pr-3">Team</th>
                          <th className="text-left py-2 px-3">Project</th>
                          <th className="text-left py-2 px-3">QA Lead</th>
                          <th className="text-center py-2 px-3">Staff</th>
                          <th className="text-center py-2 px-3">Active</th>
                          <th className="text-center py-2 px-3">Pending</th>
                          <th className="text-center py-2 px-3">Delivered</th>
                          <th className="text-center py-2 px-3">Done</th>
                          <th className="text-center py-2 px-3">Eff.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.team_performance.map((team) => (
                          <tr key={team.id} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="py-2.5 pr-3 font-medium text-slate-700">{team.name}</td>
                            <td className="py-2.5 px-3 text-slate-500">{team.project_code}</td>
                            <td className="py-2.5 px-3 text-slate-500">{team.qa_lead}</td>
                            <td className="py-2.5 px-3 text-center text-slate-600">{team.staff_count}</td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="text-teal-600 font-medium">{team.active_staff}</span>
                              {(team.absent_staff ?? 0) > 0 && <span className="text-rose-500 text-xs ml-1">({team.absent_staff ?? 0} off)</span>}
                            </td>
                            <td className="py-2.5 px-3 text-center text-amber-600 font-medium">{team.pending}</td>
                            <td className="py-2.5 px-3 text-center text-brand-600 font-semibold">{team.delivered_today}</td>
                            <td className="py-2.5 px-3 text-center text-slate-700 font-medium">{team.today_completed}</td>
                            <td className="py-2.5 px-3 text-center">
                              <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${(team.efficiency ?? 0) >= 5 ? 'bg-brand-50 text-brand-700' :
                                (team.efficiency ?? 0) >= 2 ? 'bg-amber-50 text-amber-700' :
                                  'bg-slate-100 text-slate-500'
                                }`}>{team.efficiency}/person</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* QA Summary */}
              {data.qa_summary && (
                <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                    <Eye className="h-4 w-4 text-emerald-500" /> QA Summary
                  </h3>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <div className="bg-slate-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-slate-700">{data.qa_summary.total_qa_staff ?? 0}</div>
                      <div className="text-[10px] text-slate-500 uppercase">QA Staff</div>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-emerald-600">{data.qa_summary.qa_with_uploads ?? 0}</div>
                      <div className="text-[10px] text-slate-500 uppercase">With Uploads</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-blue-600">{data.qa_summary.total_qa_done ?? 0}</div>
                      <div className="text-[10px] text-slate-500 uppercase">QA Done</div>
                    </div>
                    <div className="bg-violet-50 rounded-lg p-3 text-center">
                      <div className="text-lg font-bold text-violet-600">{data.qa_summary.qa_members?.length ?? 0}</div>
                      <div className="text-[10px] text-slate-500 uppercase">Members</div>
                    </div>
                  </div>

                  {(data.qa_summary.qa_members?.length ?? 0) > 0 && (
                    <div className="overflow-x-auto border border-slate-100 rounded-lg">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50/80 text-xs text-slate-500 uppercase">
                            <th className="px-3 py-2 text-left">QA Name</th>
                            <th className="px-3 py-2 text-center">Done</th>
                            <th className="px-3 py-2 text-center">WIP</th>
                            <th className="px-3 py-2 text-center">Uploads</th>
                            <th className="px-3 py-2 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.qa_summary.qa_members?.map((qa) => (
                            <tr key={qa.id}>
                              <td className="px-3 py-2">
                                <div className="font-medium text-slate-900">{qa.name}</div>
                                {qa.email && <div className="text-xs text-slate-400">{qa.email}</div>}
                              </td>
                              <td className="px-3 py-2 text-center font-semibold text-emerald-600">{qa.done_count ?? 0}</td>
                              <td className="px-3 py-2 text-center font-semibold text-indigo-600">{qa.wip_count ?? 0}</td>
                              <td className="px-3 py-2 text-center">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${(qa.has_uploads ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}`}>
                                  {qa.has_uploads ? 'Yes' : 'No'}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-center">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${(qa.is_active ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500')}`}>
                                  {qa.is_active ? 'Active' : 'Inactive'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Projects Tab */}
          {activeTab === 'projects' && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Projects</h3>
              {(data.projects || []).map((item) => {
                const proj = item.project;
                const projId = proj.id;
                const stages = item.queue_health?.stages || {};
                const stageEntries = Object.entries(stages);
                return (
                  <div key={projId} className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
                    <button
                      onClick={() => setExpandedProject(expandedProject === projId ? null : projId)}
                      className="w-full p-4 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{proj.name}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {proj.code} &middot; {workflowLabels[proj.workflow_type] || proj.workflow_type}
                            {(proj as any).queue_name && <span> &middot; Queue: <span className="text-slate-600 font-medium">{(proj as any).queue_name}</span></span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-3 text-xs">
                            <span className="text-teal-600 font-medium">{item.active_staff ?? 0}/{item.total_staff ?? 0} staff</span>
                            <span className="text-amber-600 font-medium">{item.pending ?? 0} pending</span>
                            <span className="text-brand-600 font-medium">{item.delivered_today ?? 0} delivered</span>
                          </div>
                          {expandedProject === projId ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                        </div>
                      </div>

                      {/* Queue stages always visible */}
                      {stageEntries.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3" onClick={e => e.stopPropagation()}>
                          {stageEntries.map(([stage, count]) => (
                            <span key={stage} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${stage.includes('QUEUED') ? 'bg-amber-50 text-amber-700' :
                              stage.includes('IN_PROGRESS') || stage.includes('DRAWING') || stage.includes('CHECKING') || stage.includes('QA_REVIEW') ? 'bg-blue-50 text-blue-700' :
                                stage.includes('REJECTED') ? 'bg-rose-50 text-rose-700' :
                                  stage.includes('DELIVERED') ? 'bg-emerald-50 text-emerald-700' :
                                    stage === 'RECEIVED' ? 'bg-slate-100 text-slate-600' :
                                      'bg-slate-50 text-slate-500'
                              }`}>
                              {stage.replace(/_/g, ' ')}
                              <span className="bg-white/60 px-1 rounded-full">{count as number}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </button>

                    {expandedProject === projId && item.queue_health && (
                      <div className="border-t border-slate-100 p-4 space-y-4">
                        {stageEntries.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Queue by Stage</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                              {stageEntries.map(([stage, count]) => (
                                <div key={stage} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
                                  <StatusBadge status={stage} size="xs" />
                                  <span className="text-sm font-semibold text-slate-700">{count as number}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {item.queue_health.staffing && item.queue_health.staffing.length > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Staff</h4>
                            <div className="space-y-1.5">
                              {item.queue_health.staffing.map((s: NonNullable<OpsProjectItem['queue_health']>['staffing'][number]) => (
                                <div key={s.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg text-sm">
                                  <div className="flex items-center gap-2">
                                    <span className={`w-2 h-2 rounded-full ${s.is_absent ? 'bg-rose-500' : s.is_online ? 'bg-green-500' : 'bg-amber-500'}`} />
                                    <span className="font-medium text-slate-700">{s.name}</span>
                                    <span className="text-xs text-slate-400 capitalize">{s.role}</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-xs text-slate-500">
                                    <span>WIP: {s.wip_count}</span>
                                    <span className="text-brand-600 font-medium">Done: {s.today_completed}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Teams Tab */}
          {activeTab === 'teams' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setShowCreateTeam(true);
                    setTeamError('');
                    setNewTeamName('');
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors shadow-sm"
                >
                  <Plus className="h-4 w-4" /> Add Team
                </button>
              </div>

              {showCreateTeam && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreateTeam(false)}>
                  <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between p-5 border-b">
                      <h3 className="text-lg font-semibold text-slate-900">Create New Team</h3>
                      <button onClick={() => setShowCreateTeam(false)} className="p-1 rounded-lg hover:bg-slate-100" title="Close">
                        <X className="h-5 w-5 text-slate-400" />
                      </button>
                    </div>
                    <div className="p-5 space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Project</label>
                        <select
                          value={selectedTeamProjectId ?? ''}
                          onChange={(e) => setSelectedTeamProjectId(Number(e.target.value) || null)}
                          className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 outline-none"
                        >
                          <option value="">Select Project</option>
                          {(data.projects || []).map((item) => (
                            <option key={item.project.id} value={item.project.id}>
                              {item.project.code} - {item.project.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1.5">Team Name</label>
                        <input
                          type="text"
                          value={newTeamName}
                          onChange={e => setNewTeamName(e.target.value)}
                          placeholder="e.g. Team Alpha"
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
                      <button onClick={() => setShowEditTeam(false)} className="p-1 rounded-lg hover:bg-slate-100" title="Close">
                        <X className="h-5 w-5 text-slate-400" />
                      </button>
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

              {teams.map((team) => {
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
                const staffCount = team.staff_count ?? (drawerMembers.length + checkerMembers.length + qaMembers.length + members.filter((member) => member.role === 'designer').length);
                const activeStaff = team.active_staff ?? members.filter((m) => m.is_active !== false && !m.is_absent).length;
                const drawDone = team.drawer_total_done ?? team.raw_done ?? 0;
                const checkerDone = team.checker_total_done ?? team.check_done ?? 0;
                const qaDone = team.qa_total_done ?? team.qa_done ?? 0;
                const deliveredCount = team.delivered ?? team.total_delivered_orders ?? team.delivered_today ?? 0;
                const drawerNamesFromString = (team.drawer_names || '').split(',').map((n) => n.trim()).filter(Boolean);
                const checkerNamesFromString = (team.checker_names || '').split(',').map((n) => n.trim()).filter(Boolean);
                const qaNamesFromString = (team.qa_names || '').split(',').map((n) => n.trim()).filter(Boolean);

                return (
                  <div key={team.id} className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{team.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {(team.project_code || 'Project')} · {team.is_active === false ? 'Inactive' : 'Active'}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-slate-600">{activeStaff}/{staffCount} active</span>
                        <button
                          onClick={() => openEditTeamModal(team)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                          title="Edit team"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteTeam(team)}
                          disabled={staffCount > 0}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title={staffCount > 0 ? 'Only empty teams can be deleted' : 'Delete team'}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-3">
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-lg font-bold text-slate-700">{getTeamRoleCount(team, 'drawer')}</div>
                        <div className="text-[10px] text-slate-500 uppercase">Drawer</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-lg font-bold text-slate-700">{getTeamRoleCount(team, 'checker')}</div>
                        <div className="text-[10px] text-slate-500 uppercase">Checker</div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-3 text-center">
                        <div className="text-lg font-bold text-slate-700">{getTeamRoleCount(team, 'qa')}</div>
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

                    {members.length > 0 && (
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

              {teams.length === 0 && (
                <div className="text-center py-12 text-slate-500">No teams found.</div>
              )}
            </div>
          )}

          {/* Staff Tab */}
          {activeTab === 'staff' && (() => {
            const workers = data.workers || [];
            const searchLower = staffSearch.toLowerCase();
            const filteredWorkers = workers.filter(w => {
              if (staffRoleFilter !== 'all' && w.role !== staffRoleFilter) return false;
              if (searchLower && !w.name.toLowerCase().includes(searchLower) && !w.email.toLowerCase().includes(searchLower)) return false;
              return true;
            });
            const roleColors: Record<string, { bg: string; text: string }> = {
              drawer: { bg: 'bg-blue-50', text: 'text-blue-700' },
              checker: { bg: 'bg-violet-50', text: 'text-violet-700' },
              qa: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
              designer: { bg: 'bg-pink-50', text: 'text-pink-700' },
            };
            return (
              <>
                {/* Role Filter Pills + Search */}
                <div className="flex flex-col sm:flex-row gap-3 mb-4">
                  <div className="flex flex-wrap gap-2 flex-1">
                    <button
                      onClick={() => setStaffRoleFilter('all')}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${staffRoleFilter === 'all' ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                    >
                      All ({workers.length})
                    </button>
                    {activeRoles.map((role) => {
                      const RIcon = roleIcons[role] || Users;
                      const colors = roleColors[role] || { bg: 'bg-slate-100', text: 'text-slate-700' };
                      const count = workers.filter(w => w.role === role).length;
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
                {data.role_stats && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    {(staffRoleFilter === 'all' ? activeRoles : [staffRoleFilter]).map((role) => {
                      const stats = data.role_stats?.[role];
                      if (!stats) return null;
                      const RIcon = roleIcons[role] || Users;
                      const colors = roleColors[role] || { bg: 'bg-slate-50', text: 'text-slate-700' };
                      return (
                        <div key={role} className={`rounded-xl p-4 ${colors.bg} ring-1 ring-black/[0.04]`}>
                          <div className="flex items-center gap-2 mb-3">
                            <RIcon className={`h-4 w-4 ${colors.text}`} />
                            <span className={`text-sm font-semibold ${colors.text}`}>{role.charAt(0).toUpperCase() + role.slice(1)}s</span>
                            <span className="ml-auto text-lg font-bold text-slate-900">{stats.total_staff}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="text-slate-500">Online</span>
                              <div className="font-semibold text-emerald-600">{stats.active}</div>
                            </div>
                            <div>
                              <span className="text-slate-500">Absent</span>
                              <div className="font-semibold text-red-500">{stats.absent}</div>
                            </div>
                            <div>
                              <span className="text-slate-500">Done Today</span>
                              <div className="font-semibold text-emerald-600">{stats.today_completed}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Staff Report Table */}
                {workers.length > 0 && (
                  <div className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden mb-6">
                    <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                      <Users className="h-4 w-4 text-slate-400" />
                      <h3 className="text-sm font-semibold text-slate-900">
                        {staffRoleFilter === 'all' ? 'All Staff' : `${staffRoleFilter.charAt(0).toUpperCase() + staffRoleFilter.slice(1)}s`}
                      </h3>
                      <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{filteredWorkers.length}</span>
                      <span className="text-xs text-slate-400 ml-1">Click a row to expand details</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50/80 text-xs text-slate-500 uppercase">
                            <th className="px-3 py-3 text-left w-6"></th>
                            <th className="px-3 py-3 text-left">Name</th>
                            <th className="px-3 py-3 text-left">Role</th>
                            <th className="px-3 py-3 text-left">Team</th>
                            <th className="px-3 py-3 text-center">Status</th>
                            <th className="px-3 py-3 text-center" title="Total orders currently assigned">Assigned</th>
                            <th className="px-3 py-3 text-center" title="Assigned but not yet started">Pending</th>
                            <th className="px-3 py-3 text-center" title="Currently working on">WIP</th>
                            <th className="px-3 py-3 text-center" title="Completed today">Done Today</th>
                            <th className="px-3 py-3 text-center" title="Completed this week">Week</th>
                            <th className="px-3 py-3 text-center" title="Completed this month">Month</th>
                            <th className="px-3 py-3 text-center" title="Daily target progress">Target</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {filteredWorkers.map((w) => {
                            const RoleIcon = roleIcons[w.role] || Users;
                            const colors = roleColors[w.role] || { bg: 'bg-slate-50', text: 'text-slate-700' };
                            const isExpanded = expandedStaff === w.id;
                            const targetPct = (w.daily_target ?? 0) > 0 ? Math.round((w.today_completed / w.daily_target!) * 100) : null;
                            return (
                              <React.Fragment key={w.id}>
                                <tr
                                  onClick={() => setExpandedStaff(isExpanded ? null : w.id)}
                                  className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                                >
                                  <td className="pl-3 py-3">
                                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />}
                                  </td>
                                  <td className="px-3 py-3">
                                    <div className="flex items-center gap-2">
                                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${w.is_absent ? 'bg-rose-500' : w.is_online ? 'bg-green-500' : 'bg-amber-500'}`} />
                                      <span className="font-medium text-slate-900">{w.name}</span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-3">
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${colors.bg} ${colors.text}`}>
                                      <RoleIcon className="h-3 w-3" />
                                      {w.role}
                                    </span>
                                  </td>
                                  <td className="px-3 py-3">
                                    <span className="text-xs text-slate-600">{w.team_name || '—'}</span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    {w.is_absent ? (
                                      <span className="inline-flex items-center gap-1 text-xs text-red-600">
                                        <AlertTriangle className="h-3 w-3" /> Absent
                                      </span>
                                    ) : w.is_online ? (
                                      <span className="text-xs text-green-600 font-medium">Online</span>
                                    ) : (
                                      <span className="text-xs text-amber-500">Offline</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span className={`text-sm font-bold ${(w.assigned_work ?? 0) > 0 ? 'text-blue-600' : 'text-slate-300'}`}>{w.assigned_work ?? 0}</span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span className={`text-sm font-bold ${(w.pending_work ?? 0) > 0 ? 'text-amber-600' : 'text-slate-300'}`}>{w.pending_work ?? 0}</span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span className={`text-sm font-bold ${w.wip_count > 0 ? 'text-indigo-600' : 'text-slate-300'}`}>{w.wip_count}</span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span className={`text-sm font-bold ${w.today_completed > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>{w.today_completed}</span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span className={`text-sm font-semibold ${(w.completed_week ?? 0) > 0 ? 'text-violet-600' : 'text-slate-300'}`}>{w.completed_week ?? 0}</span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    <span className={`text-sm font-semibold ${(w.completed_month ?? 0) > 0 ? 'text-teal-600' : 'text-slate-300'}`}>{w.completed_month ?? 0}</span>
                                  </td>
                                  <td className="px-3 py-3 text-center">
                                    {(w.daily_target ?? 0) > 0 ? (
                                      <div className="flex flex-col items-center gap-0.5">
                                        <span className={`text-xs font-bold ${targetPct !== null && targetPct >= 100 ? 'text-emerald-600' : targetPct !== null && targetPct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                                          {w.today_completed}/{w.daily_target}
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
                                              <span className="text-sm font-bold text-blue-600">{w.assigned_work ?? 0}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs text-slate-500">Pending</span>
                                              <span className="text-sm font-bold text-amber-600">{w.pending_work ?? 0}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs text-slate-500">In Progress</span>
                                              <span className="text-sm font-bold text-indigo-600">{w.wip_count}</span>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Completions */}
                                        <div className="bg-white rounded-lg p-3 ring-1 ring-black/[0.04]">
                                          <div className="text-[10px] text-slate-500 uppercase font-semibold mb-2">Completions</div>
                                          <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs text-slate-500">Today</span>
                                              <span className="text-sm font-bold text-emerald-600">{w.today_completed}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs text-slate-500">This Week</span>
                                              <span className="text-sm font-bold text-violet-600">{w.completed_week ?? 0}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs text-slate-500">This Month</span>
                                              <span className="text-sm font-bold text-teal-600">{w.completed_month ?? 0}</span>
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
                                            {(w.avg_completion_minutes ?? 0) > 0 ? `${w.avg_completion_minutes} min` : '—'}
                                          </div>
                                          <div className="text-[10px] text-slate-400 mt-0.5">per order</div>
                                        </div>

                                        {/* Daily Target */}
                                        <div className="bg-white rounded-lg p-3 ring-1 ring-black/[0.04]">
                                          <div className="flex items-center gap-1.5 mb-2">
                                            <Target className="h-3.5 w-3.5 text-amber-500" />
                                            <div className="text-[10px] text-slate-500 uppercase font-semibold">Daily Target</div>
                                          </div>
                                          {(w.daily_target ?? 0) > 0 ? (
                                            <>
                                              <div className="text-lg font-bold text-slate-900">{w.today_completed} <span className="text-slate-400 text-sm font-normal">/ {w.daily_target}</span></div>
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

                                        {/* Info */}
                                        <div className="bg-white rounded-lg p-3 ring-1 ring-black/[0.04]">
                                          <div className="flex items-center gap-1.5 mb-2">
                                            <Info className="h-3.5 w-3.5 text-slate-400" />
                                            <div className="text-[10px] text-slate-500 uppercase font-semibold">Info</div>
                                          </div>
                                          <div className="text-xs text-slate-600 truncate" title={w.email}>{w.email}</div>
                                          <div className="text-xs text-slate-400 mt-1">Project: {w.project_name || '—'}</div>
                                          <div className="text-xs text-slate-400 mt-0.5">Team: {w.team_name || '—'}</div>
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
                    {filteredWorkers.length === 0 && (
                      <div className="text-center py-8 text-slate-500">
                        {staffSearch ? `No staff found matching "${staffSearch}"` : 'No staff members found.'}
                      </div>
                    )}
                  </div>
                )}

                {/* Absentees */}
                {(data.absentees?.length ?? 0) > 0 && (
                  <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                    <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-rose-400" /> Absent Staff
                      <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-medium">{data.absentees!.length}</span>
                    </h3>
                    <div className="space-y-2">
                      {data.absentees!.map((a) => (
                        <div key={a.id} className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg text-sm">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-rose-400" />
                            <span className="font-medium text-slate-700">{a.name}</span>
                            <span className="text-xs text-slate-400 capitalize">{a.role}</span>
                          </div>
                          {a.project_name && (
                            <span className="text-xs text-slate-400">{a.project_name}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </AnimatedPage>
  );
}
