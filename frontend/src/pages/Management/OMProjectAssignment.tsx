import { useEffect, useState, useCallback } from 'react';
import { omService, projectService } from '../../services';
import type { Project } from '../../types';
import { AnimatedPage, PageHeader, Button } from '../../components/ui';
import { Briefcase, Save, RefreshCw, Check, FolderKanban, Shield, ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import ClockDisplay from '../../components/ClockDisplay';

interface OMUser {
  id: number;
  name: string;
  email: string;
  role: string;
  country: string;
  can_access_amends?: boolean;
  om_projects: { id: number; code: string; name: string; country: string; department: string }[];
}

export default function OMProjectAssignment() {
  const [oms, setOMs] = useState<OMUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignments, setAssignments] = useState<Record<number, number[]>>({});
  const [amendsAccess, setAmendsAccess] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedOM, setExpandedOM] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const projectTz = projects.length > 0 ? (projects[0].timezone || 'Australia/Sydney') : 'Australia/Sydney';

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [omRes, projRes] = await Promise.all([
        omService.list(),
        projectService.list(),
      ]);
      const omList = Array.isArray(omRes.data) ? omRes.data : [];
      const projData = projRes.data?.data || projRes.data;
      const projList = Array.isArray(projData) ? projData : [];

      setOMs(omList);
      setProjects(projList);

      const map: Record<number, number[]> = {};
      const accessMap: Record<number, boolean> = {};
      omList.forEach((om: OMUser) => {
        map[om.id] = (om.om_projects || []).map(p => p.id);
        accessMap[om.id] = Boolean(om.can_access_amends);
      });
      setAssignments(map);
      setAmendsAccess(accessMap);

      if (omList.length > 0 && !expandedOM) {
        setExpandedOM(omList[0].id);
      }
    } catch (e) {
      console.error('Failed to load data', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const toggleProject = (omId: number, projectId: number) => {
    setAssignments(prev => {
      const current = prev[omId] || [];
      const has = current.includes(projectId);
      return {
        ...prev,
        [omId]: has ? current.filter(id => id !== projectId) : [...current, projectId],
      };
    });
  };

  const toggleAmendsAccess = (omId: number) => {
    setAmendsAccess(prev => ({
      ...prev,
      [omId]: !prev[omId],
    }));
  };

  const saveAssignment = async (omId: number) => {
    setSaving(omId);
    try {
      await omService.assignProjects(omId, assignments[omId] || [], amendsAccess[omId]);
      setSuccessMsg(`Permissions and projects saved for ${oms.find(o => o.id === omId)?.name}`);
      setTimeout(() => setSuccessMsg(null), 3000);
      await loadData();
    } catch (e) {
      console.error('Failed to save', e);
    } finally {
      setSaving(null);
    }
  };

  const hasChanges = (omId: number) => {
    const om = oms.find(o => o.id === omId);
    if (!om) return false;
    const originalProjects = (om.om_projects || []).map(p => p.id).sort();
    const currentProjects = (assignments[omId] || []).sort();
    if (originalProjects.length !== currentProjects.length) return true;
    if (originalProjects.some((id, i) => id !== currentProjects[i])) return true;

    const originalAccess = Boolean(om.can_access_amends);
    const currentAccess = Boolean(amendsAccess[omId]);
    return originalAccess !== currentAccess;
  };

  if (loading) {
    return (
      <AnimatedPage>
        <PageHeader title="OM Project Assignment" subtitle="Loading..." />
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-200/60 p-6 animate-pulse">
              <div className="h-5 bg-slate-200 rounded w-1/3 mb-3" />
              <div className="h-4 bg-slate-100 rounded w-1/2" />
            </div>
          ))}
        </div>
      </AnimatedPage>
    );
  }

  return (
    <AnimatedPage>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-1">
        <PageHeader
          title="OM Project & Amends Assignment"
          subtitle="Assign projects and grant all-project Amends Hub access to authorized Operation Managers"
          actions={
            <Button variant="secondary" icon={RefreshCw} onClick={loadData}>
              Refresh
            </Button>
          }
        />
        <div className="text-right mt-2 sm:mt-0 flex-shrink-0">
          <ClockDisplay timezone={projectTz} className="text-sm font-semibold text-slate-800 font-mono" />
        </div>
      </div>

      {successMsg && (
        <div className="mb-4 flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium px-4 py-3 rounded-xl">
          <Check className="w-4 h-4" />
          {successMsg}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-brand-500" />
            <span className="text-xs text-slate-500 font-medium">Operation Managers</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{oms.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="flex items-center gap-2 mb-1">
            <RotateCcw className="w-4 h-4 text-teal-600" />
            <span className="text-xs text-slate-500 font-medium">Amends Permitted OMs</span>
          </div>
          <div className="text-2xl font-bold text-teal-600">
            {oms.filter(o => o.can_access_amends).length}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="flex items-center gap-2 mb-1">
            <FolderKanban className="w-4 h-4 text-teal-500" />
            <span className="text-xs text-slate-500 font-medium">Total Projects</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{projects.length}</div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/60 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Briefcase className="w-4 h-4 text-amber-500" />
            <span className="text-xs text-slate-500 font-medium">Unassigned Projects</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">
            {projects.filter(p => !oms.some(om => (assignments[om.id] || []).includes(p.id))).length}
          </div>
        </div>
      </div>

      {oms.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200/60 p-12 text-center">
          <Shield className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No Operation Managers</h3>
          <p className="text-sm text-slate-500 mb-4">
            Create a user with the "Operation Manager" role first, then come back here to assign projects and amends access.
          </p>
          <Button variant="primary" onClick={() => window.location.href = '/users'}>
            Go to User Management
          </Button>
        </div>
      )}

      {/* OM Cards */}
      <div className="space-y-4">
        {oms.map(om => {
          const isExpanded = expandedOM === om.id;
          const changed = hasChanges(om.id);
          const assignedCount = (assignments[om.id] || []).length;
          const hasAmends = Boolean(amendsAccess[om.id]);

          return (
            <div
              key={om.id}
              className={`bg-white rounded-xl border transition-all ${
                changed ? 'border-amber-300 shadow-amber-100 shadow-md' : 'border-slate-200/60'
              }`}
            >
              <button
                onClick={() => setExpandedOM(isExpanded ? null : om.id)}
                className="w-full flex items-center justify-between p-5 text-left hover:bg-slate-50/50 transition-colors rounded-xl"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-teal-100 text-teal-600 flex items-center justify-center font-bold text-sm">
                    {om.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      {om.name}
                      {hasAmends ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 flex items-center gap-1">
                          <RotateCcw className="w-3 h-3" /> Amends Allowed
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500">
                          Amends Restricted
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">{om.email} · {om.country}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                    assignedCount > 0 ? 'bg-teal-100 text-teal-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {assignedCount} project{assignedCount !== 1 ? 's' : ''}
                  </span>
                  {changed && (
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                      Unsaved
                    </span>
                  )}
                  {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                </div>
              </button>

              {isExpanded && (
                <div className="px-5 pb-5 border-t border-slate-100">
                  {/* Director Toggle: Amends Access */}
                  <div className="pt-4 mb-4">
                    <div className="p-4 rounded-xl bg-teal-50/50 border border-teal-200/70 flex items-center justify-between">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center shrink-0">
                          <RotateCcw className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900">
                            Allow All-Projects Amends Hub Access
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Enable this to let <span className="font-semibold text-slate-800">{om.name}</span> view, supervise, and act on amend orders across all projects.
                          </div>
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
                        <input
                          type="checkbox"
                          checked={hasAmends}
                          onChange={() => toggleAmendsAccess(om.id)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                      </label>
                    </div>
                  </div>

                  {/* Project Selection */}
                  <div className="mb-3">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                      Select assigned projects (multiple allowed)
                    </h4>
                  </div>

                  {projects.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4 text-center">No projects available</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {projects.map(project => {
                        const isAssigned = (assignments[om.id] || []).includes(project.id);
                        const otherOM = oms.find(
                          o => o.id !== om.id && (assignments[o.id] || []).includes(project.id)
                        );
                        const isLockedByOther = !!otherOM && !isAssigned;

                        return (
                          <button
                            key={project.id}
                            onClick={() => !isLockedByOther && toggleProject(om.id, project.id)}
                            disabled={isLockedByOther}
                            title={isLockedByOther ? `Already assigned to ${otherOM.name}` : undefined}
                            className={`relative text-left p-4 rounded-lg border-2 transition-all ${
                              isLockedByOther
                                ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                                : isAssigned
                                  ? 'border-teal-500 bg-teal-50/50 ring-1 ring-teal-200'
                                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className={`absolute top-3 right-3 w-5 h-5 rounded flex items-center justify-center ${
                              isLockedByOther
                                ? 'bg-slate-300 text-white'
                                : isAssigned ? 'bg-teal-500 text-white' : 'border-2 border-slate-300'
                            }`}>
                              {isLockedByOther ? (
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
                              ) : isAssigned ? <Check className="w-3.5 h-3.5" /> : null}
                            </div>

                            <div className="pr-8">
                              <div className="text-sm font-semibold text-slate-900">{project.name}</div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                {project.code} · {project.country}
                              </div>
                              <div className="flex items-center gap-2 mt-2">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                  project.department === 'floor_plan'
                                    ? 'bg-indigo-100 text-indigo-700'
                                    : 'bg-pink-100 text-pink-700'
                                }`}>
                                  {project.department === 'floor_plan' ? 'Floor Plan' : 'Photos'}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                  project.status === 'active'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-slate-100 text-slate-500'
                                }`}>
                                  {project.status}
                                </span>
                              </div>
                              {isLockedByOther && (
                                <div className="text-[10px] text-rose-600 font-medium mt-2">
                                  Assigned to {otherOM.name}
                                </div>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100">
                    <div className="text-xs text-slate-500">
                      {assignedCount} of {projects.length} projects selected · Amends Access: {hasAmends ? 'Enabled' : 'Disabled'}
                    </div>
                    <Button
                      variant="primary"
                      icon={Save}
                      onClick={() => saveAssignment(om.id)}
                      loading={saving === om.id}
                      disabled={!changed}
                    >
                      {changed ? 'Save Changes' : 'No Changes'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AnimatedPage>
  );
}
