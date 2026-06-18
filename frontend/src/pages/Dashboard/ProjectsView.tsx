import React, { useState, useEffect, useMemo } from 'react';
import apiClient from '../../services/api';
import { StatCard } from '../../components/ui';
import { Users, UserCheck, UserX, Package, ChevronDown, ChevronUp, Loader2, Activity } from 'lucide-react';

/* ================= TYPES ================= */

interface ProjectStats {
    project_id: number;
    project_code?: string;
    project_name: string;
    effective_project_count?: number;
    raw_project_count?: number;
    received_orders_today: number;
    completed_orders_today: number;
    received_done_orders?: number;
    done_orders_today?: number;
    done_orders?: number;
    untouched_orders: number;
    pending_orders: number;
    delayed_pending_orders?: number;
    delayed_done_orders?: number;
    delayed_orders?: number;
    total_staff: number;
    present_staff: number;
    absent_staff: number;
    online_staff?: number;
    online_users?: OnlineUser[];
    client_name_counts?: ClientNameCount[];
    batch_count?: number;
}

interface OnlineUser {
    id: number;
    name: string;
    email?: string;
    role?: string;
    project_id?: number;
    team_id?: number | null;
    is_active?: boolean;
    is_absent?: boolean;
    is_online?: boolean;
    last_activity?: string | null;
    wip_count?: number;
    today_completed?: number;
    daily_target?: number;
}

interface ClientNameCount {
    project_id: number;
    code?: string | null;
    client_name: string;
    code_client_name?: string;
    orders_count: number;
}

interface CountryStats {
    country: string;
    project_count?: number;
    projects_count?: number;
    received_orders_today?: number;
    received_done_orders?: number;
    done_orders?: number;
    pending_orders?: number;
    delayed_pending_orders?: number;
    delayed_done_orders?: number;
    delayed_orders?: number;
    untouched_orders?: number;
    total_staff?: number;
    present_staff?: number;
    absent_staff?: number;
    online_staff?: number;
    online_users?: OnlineUser[];
    projects?: ProjectStats[];
}

interface ProjectStatsResponse {
    success: boolean;
    selected_date?: string;
    start_date?: string;
    end_date?: string;
    date_filter_type?: 'single_date' | 'date_range' | 'start_to_today';
    selected_role?: string;
    totals: {
        received_orders_today?: number;
        received_done_orders?: number;
        done_orders?: number;
        delayed_pending_orders?: number;
        delayed_done_orders?: number;
        delayed_orders?: number;
        total_staff: number;
        present_staff: number;
        absent_staff: number;
        online_staff?: number;
    };
    online_users?: OnlineUser[];
    projects: ProjectStats[];
    countries?: CountryStats[];
    selected_project_breakdown?: ProjectBreakdownResponse;
    project_detail?: Partial<ProjectStats> | null;
}

interface Worker {
    name: string;
    done_count: number;
}

interface AssignmentWorkerLike {
    name: string;
    done_count?: number;
    today_completed?: number;
    wip_count?: number;
}

interface RoleBreakdown {
    role: string;
    label: string;
    total_today_received_done?: number;
    today_received_done: Worker[];
    total_today_done_all?: number;
    today_done_all: Worker[];
}

interface TeamWorkerStat {
    id?: number | null;
    name: string;
    role?: string;
    team_id?: number;
    team_name?: string;
    is_guest?: boolean;
    home_team_name?: string;
    total_done?: number;
    total_done_selected_date?: number;
    wip?: number;
    last_activity?: string | null;
    is_online?: boolean;
}

interface TeamBreakdown {
    team_id: number;
    team_name: string;
    selected_date?: string;
    start_date?: string;
    end_date?: string;
    date_filter_type?: 'single_date' | 'date_range' | 'start_to_today';
    selected_role?: string;
    drawer_done?: number;
    checker_done?: number;
    qa_done?: number;
    total_completed_orders?: number;
    completed_orders_selected_date?: number;
    total_role_done?: number;
    total_done?: number;
    total_done_selected_date?: number;
    drawers?: TeamWorkerStat[];
    checkers?: TeamWorkerStat[];
    qas?: TeamWorkerStat[];
}

interface ProjectBreakdownResponse {
    project_id: number;
    project_name: string;
    selected_date?: string;
    start_date?: string;
    end_date?: string;
    date_filter_type?: 'single_date' | 'date_range' | 'start_to_today';
    selected_role?: string;
    total_received_done_orders?: number;
    total_done_orders?: number;
    roles: RoleBreakdown[];
    teams?: TeamBreakdown[];
}

interface ProjectTeamUser {
    id: number;
    name: string;
    role?: string;
    team_id?: number;
    is_active?: boolean;
    is_absent?: boolean;
}

interface ProjectTeam {
    id: number;
    name: string;
    drawer_count?: number;
    checker_count?: number;
    is_active?: boolean;
    users?: ProjectTeamUser[];
}

type TeamDetailTab = 'teams' | 'teams-online' | 'teams-offline' | 'unassigned' | 'batch';

interface BatchStatusItem {
    batch_no: string | number;
    batch_label?: string;
    received_time?: string;
    remaining_time?: string;
    plans?: number;
    done?: number;
    pending?: number;
    fixing?: number;
}

interface BatchPlansRemaining {
    hour: number;
    plans: number;
}

interface BatchHourlyCount {
    label: string;
    orders: number;
}

interface BatchStatusResponse {
    success: boolean;
    total_orders?: {
        plans?: number;
        done?: number;
        pending?: number;
        drawing_process?: number;
        untouched_orders?: number;
        sent_to_fixing?: number;
    };
    batches?: BatchStatusItem[];
    plans_remaining?: BatchPlansRemaining[];
    hourly_counts?: BatchHourlyCount[];
    untouched_min?: BatchStatusItem;
    fixed_min?: BatchStatusItem;
}

type RoleCompletionEntry = {
    total_staff?: number;
    active?: number;
    today_completed?: number;
};

/* ================= COMPONENT ================= */

const ProjectsView: React.FC = () => {
    const teamBreakdownProjectId = 16;
    const specialClientProjectIds = [14, 9, 46];

    const roleLabelMap: Record<string, string> = {
        drawer: 'Drawer',
        checker: 'Checker',
        filler: 'Filler',
        designer: 'Designer',
        qa: 'QA'
    };

    const toRoleBreakdownFromWorkers = (
        source: {
            workers?: Record<string, AssignmentWorkerLike[] | undefined>;
            role_completions?: Record<string, RoleCompletionEntry | undefined>;
            project?: { id?: number; name?: string };
        },
        fallbackProjectId: number,
        fallbackProjectName: string,
        filters: {
            selectedDate: string;
            startDate: string | null;
            endDate: string;
            dateFilterType: 'single_date' | 'date_range' | 'start_to_today';
        }
    ): ProjectBreakdownResponse | null => {
        const workersByRole = source.workers || {};
        const roleCompletions = source.role_completions || {};
        const roleNames = Object.keys(workersByRole);

        if (roleNames.length === 0) return null;

        const roles: RoleBreakdown[] = roleNames.map((roleName) => {
            const workerList = workersByRole[roleName] || [];
            const normalizedWorkers: Worker[] = workerList.map((worker) => ({
                name: worker.name,
                done_count: Number(worker.done_count ?? worker.today_completed ?? 0),
            }));
            const completion = roleCompletions[roleName];
            const totalDone = Number(
                completion?.today_completed
                ?? normalizedWorkers.reduce((sum, worker) => sum + (worker.done_count || 0), 0)
            );

            return {
                role: roleName,
                label: roleLabelMap[roleName] || roleName,
                total_today_received_done: totalDone,
                today_received_done: normalizedWorkers,
                total_today_done_all: totalDone,
                today_done_all: normalizedWorkers,
            };
        });

        return {
            project_id: Number(source.project?.id ?? fallbackProjectId),
            project_name: source.project?.name || fallbackProjectName,
            selected_date: filters.dateFilterType === 'single_date' ? filters.selectedDate : undefined,
            start_date: filters.dateFilterType !== 'single_date' ? (filters.startDate || undefined) : undefined,
            end_date: filters.dateFilterType !== 'single_date' ? filters.endDate : undefined,
            date_filter_type: filters.dateFilterType,
            selected_role: undefined,
            total_received_done_orders: roles.reduce((sum, role) => sum + (role.total_today_received_done || 0), 0),
            total_done_orders: roles.reduce((sum, role) => sum + (role.total_today_done_all || 0), 0),
            roles,
        };
    };

    const [data, setData] = useState<ProjectStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [totals, setTotals] = useState<ProjectStatsResponse['totals'] | null>(null);
    const [countries, setCountries] = useState<CountryStats[]>([]);

    // Date state management - locked to date range mode for compact UI
    const today = new Date().toISOString().split('T')[0];

    const [selectedDate] = useState(today);
    const [startDate, setStartDate] = useState<string | null>(null);
    const [endDate, setEndDate] = useState(today);
    const [dateFilterType] = useState<'single_date' | 'date_range' | 'start_to_today'>('date_range');

    /* inline breakdown state */
    const [selectedProject, setSelectedProject] = useState<ProjectStats | null>(null);
    const [breakdown, setBreakdown] = useState<ProjectBreakdownResponse | null>(null);
    const [loadingBreakdown, setLoadingBreakdown] = useState(false);
    const [projectTeams, setProjectTeams] = useState<ProjectTeam[]>([]);
    const [batchStatus, setBatchStatus] = useState<BatchStatusResponse | null>(null);
    const [loadingProjectTeams, setLoadingProjectTeams] = useState(false);
    const [loadingBatchStatus, setLoadingBatchStatus] = useState(false);
    const [teamDetailTab, setTeamDetailTab] = useState<TeamDetailTab>('teams');

    const [activeTab] = useState<'received' | 'done'>('received');
    const [expandedTeam, setExpandedTeam] = useState<number | null>(null);

    /* ================= FETCH MAIN ================= */

    useEffect(() => {
        const fetch = async () => {
            try {
                setLoading(true);

                // Build params based on filter type
                const params: Record<string, string> = { summary_only: '1' };

                if (dateFilterType === 'single_date') {
                    params.date = selectedDate;
                } else if (dateFilterType === 'date_range') {
                    if (startDate) params.start_date = startDate;
                    params.end_date = endDate;
                } else if (dateFilterType === 'start_to_today') {
                    if (startDate) params.start_date = startDate;
                    // end_date defaults to today on backend, but we can specify it
                }

                const res = await apiClient.get<ProjectStatsResponse>(
                    '/dashboard/project-stats',
                    { params }
                );

                if (res.data.success) {
                    setData(res.data.projects);
                    setTotals(res.data.totals);
                    setCountries(Array.isArray(res.data.countries) ? res.data.countries : []);
                }

            } catch {
                setData([]);
                setTotals(null);
                setCountries([]);
            } finally {
                setLoading(false);
            }
        };

        fetch();
    }, [selectedDate, startDate, endDate, dateFilterType]);

    /* ================= INLINE BREAKDOWN ================= */

    const toggleProjectBreakdown = async (project: ProjectStats) => {
        if (selectedProject?.project_id === project.project_id) {
            setSelectedProject(null);
            setBreakdown(null);
            setLoadingBreakdown(false);
            setProjectTeams([]);
            setLoadingProjectTeams(false);
            setBatchStatus(null);
            setLoadingBatchStatus(false);
            setTeamDetailTab('teams');
            setExpandedTeam(null);
            return;
        }

        try {
            setSelectedProject(project);
            setBreakdown(null);
            setLoadingBreakdown(true);
            setProjectTeams([]);
            setLoadingProjectTeams(false);
            setBatchStatus(null);
            setLoadingBatchStatus(false);
            setTeamDetailTab('teams');
            setExpandedTeam(null);

            // Build params based on filter type, including project_id
            const params: Record<string, string> = {
                project_id: project.project_id.toString(),
                detail_only: '1',
            };

            if (dateFilterType === 'single_date') {
                params.date = selectedDate;
            } else if (dateFilterType === 'date_range') {
                if (startDate) params.start_date = startDate;
                params.end_date = endDate;
            } else if (dateFilterType === 'start_to_today') {
                if (startDate) params.start_date = startDate;
            }

            const statsRes = await apiClient.get('/dashboard/project-stats', { params });

            if (statsRes.data.success) {
                const apiData = statsRes.data as {
                    selected_project_breakdown?: ProjectBreakdownResponse | null;
                    project_detail?: Partial<ProjectStats> | null;
                    workers?: Record<string, AssignmentWorkerLike[] | undefined>;
                    role_completions?: Record<string, RoleCompletionEntry | undefined>;
                    project?: { id?: number; name?: string };
                };

                if (apiData.project_detail) {
                    const hydratedProject = { ...project, ...apiData.project_detail };
                    setSelectedProject(hydratedProject);
                    setData((currentProjects) => currentProjects.map((item) => (
                        item.project_id === project.project_id ? { ...item, ...apiData.project_detail } : item
                    )));
                }

                const breakdownFromResponse = apiData.selected_project_breakdown;

                if (breakdownFromResponse && Array.isArray(breakdownFromResponse.roles) && breakdownFromResponse.roles.length > 0) {
                    setBreakdown(breakdownFromResponse);
                } else {
                    const fallbackBreakdown = toRoleBreakdownFromWorkers(
                        apiData,
                        project.project_id,
                        project.project_name,
                        { selectedDate, startDate, endDate, dateFilterType }
                    );
                    setBreakdown(fallbackBreakdown);
                }
            }

        } catch (err) {
            console.error(err);
            setBreakdown(null);
            setProjectTeams([]);
            setLoadingProjectTeams(false);
            setBatchStatus(null);
        } finally {
            setLoadingBreakdown(false);
            setLoadingBatchStatus(false);
        }
    };

    useEffect(() => {
        setSelectedProject(null);
        setBreakdown(null);
        setProjectTeams([]);
        setLoadingProjectTeams(false);
        setBatchStatus(null);
        setTeamDetailTab('teams');
        setExpandedTeam(null);
    }, [selectedDate, startDate, endDate, dateFilterType]);

    const loadProjectTeamsIfNeeded = async (projectId: number) => {
        if (projectId !== teamBreakdownProjectId || loadingProjectTeams || projectTeams.length > 0) return;

        try {
            setLoadingProjectTeams(true);
            const response = await apiClient.get<{ data?: ProjectTeam[] }>(`/projects/${projectId}/teams`);
            setProjectTeams(Array.isArray(response.data?.data) ? response.data.data : []);
        } catch (err) {
            console.error(err);
            setProjectTeams([]);
        } finally {
            setLoadingProjectTeams(false);
        }
    };

    const loadBatchStatusIfNeeded = async (projectId: number) => {
        if (projectId !== teamBreakdownProjectId || loadingBatchStatus || batchStatus) return;

        try {
            setLoadingBatchStatus(true);
            const response = await apiClient.get<BatchStatusResponse>('/dashboard/batch-status', {
                params: { project_id: projectId, date: endDate || selectedDate }
            });
            setBatchStatus(response.data);
            const batchCount = Array.isArray(response.data?.batches) ? response.data.batches.length : 0;
            setSelectedProject((currentProject) => (
                currentProject?.project_id === projectId
                    ? { ...currentProject, batch_count: batchCount }
                    : currentProject
            ));
            setData((currentProjects) => currentProjects.map((item) => (
                item.project_id === projectId ? { ...item, batch_count: batchCount } : item
            )));
        } catch (err) {
            console.error(err);
            setBatchStatus(null);
        } finally {
            setLoadingBatchStatus(false);
        }
    };

    const handleTeamDetailTabClick = (tab: TeamDetailTab) => {
        setTeamDetailTab(tab);

        if (!selectedProject || selectedProject.project_id !== teamBreakdownProjectId) return;

        if (tab === 'batch') {
            void loadBatchStatusIfNeeded(selectedProject.project_id);
            return;
        }

        void loadProjectTeamsIfNeeded(selectedProject.project_id);

        if (tab === 'unassigned' && unassignedTeam) {
            setExpandedTeam(Number(unassignedTeam.team_id));
        }
    };

    const visibleRoles = useMemo(() => {
        if (!Array.isArray(breakdown?.roles)) return [];

        const orderedRoles = ['drawer', 'checker', 'filler', 'designer', 'qa'];
        return breakdown.roles
            .slice()
            .sort((a, b) => {
                const aIndex = orderedRoles.indexOf(a.role);
                const bIndex = orderedRoles.indexOf(b.role);

                if (aIndex === -1 && bIndex === -1) return 0;
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;

                return aIndex - bIndex;
            });
    }, [breakdown]);

    const allTeams = useMemo(() => {
        if (selectedProject?.project_id !== teamBreakdownProjectId) return [];

        // Build a map of breakdown teams by team_id for quick lookup
        const breakdownMap = new Map<number, TeamBreakdown>();
        if (Array.isArray(breakdown?.teams)) {
            for (const team of breakdown.teams) {
                const teamName = (team.team_name || '').trim().toLowerCase();
                if (Number(team.team_id) !== 0 && teamName !== 'unassigned team') {
                    breakdownMap.set(Number(team.team_id), team);
                }
            }
        }

        let teams: TeamBreakdown[];
        const configuredWorkerHome = new Map<string, { team_id: number; team_name: string }>();
        projectTeams.forEach((team) => {
            (team.users ?? []).forEach((user) => {
                configuredWorkerHome.set(`id:${user.id}`, { team_id: team.id, team_name: team.name });
                configuredWorkerHome.set(`name:${user.name.trim().toLowerCase()}`, { team_id: team.id, team_name: team.name });
            });
        });

        const makeWorkers = (ptUsers: ProjectTeamUser[] | undefined, roleFilter: string, displayTeamId: number, displayTeamName: string): TeamWorkerStat[] =>
            (ptUsers ?? [])
                .filter((u) => (u.role || '').toLowerCase() === roleFilter)
                .map((u) => ({
                    id: u.id,
                    name: u.name,
                    team_id: displayTeamId,
                    team_name: displayTeamName,
                    is_guest: false,
                    total_done: 0,
                    total_done_selected_date: 0,
                    wip: 0,
                }));

        const getWorkerHome = (worker: TeamWorkerStat) => {
            if (worker.id != null) {
                const byId = configuredWorkerHome.get(`id:${worker.id}`);
                if (byId) return byId;
            }
            return configuredWorkerHome.get(`name:${worker.name.trim().toLowerCase()}`) ?? null;
        };

        const normalizeWorkerForDisplayedTeam = (worker: TeamWorkerStat, displayTeamId: number, forceGuest = false): TeamWorkerStat => {
            const homeTeamId = worker.team_id == null ? null : Number(worker.team_id);
            const configuredHome = getWorkerHome(worker);
            const resolvedHomeTeamId = configuredHome?.team_id ?? homeTeamId;
            const resolvedHomeTeamName = configuredHome?.team_name ?? worker.team_name;
            const isGuest = forceGuest || (resolvedHomeTeamId != null && resolvedHomeTeamId !== Number(displayTeamId));

            return {
                ...worker,
                is_guest: Boolean(worker.is_guest || isGuest),
                home_team_name: isGuest ? resolvedHomeTeamName : worker.home_team_name,
            };
        };

        const mergeWorkers = (bdWorkers: TeamWorkerStat[] | undefined, ptUsers: ProjectTeamUser[] | undefined, roleFilter: string, displayTeamId: number, displayTeamName: string): TeamWorkerStat[] => {
            const configuredRoleUsers = (ptUsers ?? []).filter((u) => (u.role || '').toLowerCase() === roleFilter);
            const configuredRoleIds = new Set(configuredRoleUsers.map((u) => u.id));
            const configuredRoleNames = new Set(configuredRoleUsers.map((u) => u.name.trim().toLowerCase()));
            const existing = new Set((bdWorkers ?? []).map((w) => w.id));
            const extra = configuredRoleUsers
                .filter((u) => !existing.has(u.id))
                .map((u) => ({
                    id: u.id,
                    name: u.name,
                    team_id: displayTeamId,
                    team_name: displayTeamName,
                    is_guest: false,
                    total_done: 0,
                    total_done_selected_date: 0,
                    wip: 0,
                }));
            return [
                ...(bdWorkers ?? []).map((worker) => {
                    const belongsToDisplayedTeam = worker.id != null
                        ? configuredRoleIds.has(worker.id)
                        : configuredRoleNames.has(worker.name.trim().toLowerCase());
                    const forceGuest = Array.isArray(ptUsers) && !belongsToDisplayedTeam;
                    return normalizeWorkerForDisplayedTeam(worker, displayTeamId, forceGuest);
                }),
                ...extra,
            ];
        };

        if (projectTeams.length > 0) {
            // Merge: use breakdown data where available, fill zeros for the rest
            teams = projectTeams.map((pt) => {
                const bd = breakdownMap.get(pt.id);
                if (bd) {
                    // Supplement breakdown workers with any missing team members
                    return {
                        ...bd,
                        drawers: mergeWorkers(bd.drawers, pt.users, 'drawer', pt.id, pt.name),
                        checkers: mergeWorkers(bd.checkers, pt.users, 'checker', pt.id, pt.name),
                        qas: mergeWorkers(bd.qas, pt.users, 'qa', pt.id, pt.name),
                    };
                }
                return {
                    team_id: pt.id,
                    team_name: pt.name,
                    drawer_done: 0,
                    checker_done: 0,
                    qa_done: 0,
                    total_done: 0,
                    total_done_selected_date: 0,
                    drawers: makeWorkers(pt.users, 'drawer', pt.id, pt.name),
                    checkers: makeWorkers(pt.users, 'checker', pt.id, pt.name),
                    qas: makeWorkers(pt.users, 'qa', pt.id, pt.name),
                } as TeamBreakdown;
            });
        } else {
            teams = Array.from(breakdownMap.values()).map((team) => ({
                ...team,
                drawers: (team.drawers ?? []).map((worker) => normalizeWorkerForDisplayedTeam(worker, Number(team.team_id))),
                checkers: (team.checkers ?? []).map((worker) => normalizeWorkerForDisplayedTeam(worker, Number(team.team_id))),
                qas: (team.qas ?? []).map((worker) => normalizeWorkerForDisplayedTeam(worker, Number(team.team_id))),
            }));
        }

        return teams.sort((a, b) =>
            Number(b.total_done_selected_date ?? b.total_done ?? 0) -
            Number(a.total_done_selected_date ?? a.total_done ?? 0)
        );
    }, [breakdown, projectTeams, selectedProject?.project_id, teamBreakdownProjectId]);

    const visibleTeams = useMemo(() => {
        return allTeams.filter((team) => {
            const drawerDone = Number(team.drawer_done ?? 0);
            const checkerDone = Number(team.checker_done ?? 0);
            const qaDone = Number(team.qa_done ?? 0);
            const roleDone = Number(team.total_done_selected_date ?? team.total_done ?? team.total_role_done ?? 0);
            return drawerDone + checkerDone + qaDone + roleDone > 0;
        });
    }, [allTeams]);

    const unassignedTeam = useMemo(() => {
        if (selectedProject?.project_id !== teamBreakdownProjectId || !Array.isArray(breakdown?.teams)) return null;

        return breakdown.teams.find((team) => {
            const teamName = (team.team_name || '').trim().toLowerCase();
            return Number(team.team_id) === 0 || teamName === 'unassigned team';
        }) ?? null;
    }, [breakdown, selectedProject?.project_id]);

    const onlineTeamIds = useMemo(() => new Set(
        (selectedProject?.online_users ?? [])
            .filter((user) => {
                const role = (user.role || '').toLowerCase();
                return ['drawer', 'checker'].includes(role) && Boolean(user.team_id) && (user.is_online ?? user.is_active ?? true);
            })
            .map((user) => Number(user.team_id))
    ), [selectedProject?.online_users]);

    const teamSummary = useMemo(() => {
        const onlineProductionTeamIds = onlineTeamIds;

        const teamsWithUsers = projectTeams.length > 0
            ? projectTeams.filter((team) => Number(team.drawer_count ?? 0) + Number(team.checker_count ?? 0) > 0)
            : allTeams.filter((team) => (team.drawers?.length ?? 0) + (team.checkers?.length ?? 0) > 0);
        const configuredTeamIds = new Set((projectTeams.length > 0 ? projectTeams : allTeams).map((team) => Number('id' in team ? team.id : team.team_id)));
        const activeTeams = Array.from(onlineProductionTeamIds).filter((teamId) => configuredTeamIds.has(teamId)).length;
        const teamsWithUsersCount = teamsWithUsers.length || (projectTeams.length || allTeams.length);

        return {
            totalTeams: projectTeams.length || allTeams.length,
            activeTeams,
            inactiveTeams: Math.max(teamsWithUsersCount - activeTeams, 0),
            unassignedDrawers: unassignedTeam?.drawers?.length ?? 0,
            unassignedCheckers: unassignedTeam?.checkers?.length ?? 0,
        };
    }, [projectTeams, onlineTeamIds, unassignedTeam, allTeams]);

    const getProjectOnlineUsers = (project: ProjectStats) => (
        Array.isArray(project.online_users) ? project.online_users : []
    );

    const getOnlineUserForWorker = (
        worker: { id?: number | null; name: string },
        onlineUsers: OnlineUser[]
    ) => {
        const normalizedName = worker.name.trim().toLowerCase();
        return onlineUsers.find((user) => {
            if (worker.id && user.id === worker.id) return true;
            return normalizedName.length > 0 && user.name.trim().toLowerCase() === normalizedName;
        });
    };

    const getOnlineCountForWorkers = (
        workers: Array<{ id?: number | null; name: string; is_online?: boolean }> | undefined,
        onlineUsers: OnlineUser[]
    ) => {
        if (!workers || workers.length === 0) return 0;
        return workers.filter((worker) => worker.is_online || getOnlineUserForWorker(worker, onlineUsers)).length;
    };

    /* ================= UI ================= */

    return (
        <div className="px-0 md:px-6 py-6">
            <style>{`
                ::-webkit-scrollbar {
                    width: 8px;
                    height: 8px;
                }
                ::-webkit-scrollbar-track {
                    background: rgb(241, 245, 249);
                    border-radius: 4px;
                }
                ::-webkit-scrollbar-thumb {
                    background: rgb(42, 167, 160);
                    border-radius: 4px;
                }
                ::-webkit-scrollbar-thumb:hover {
                    background: rgb(34, 138, 129);
                }
                /* Firefox */
                * {
                    scrollbar-color: rgb(42, 167, 160) rgb(241, 245, 249);
                    scrollbar-width: thin;
                }
            `}</style>

            <h1 className="text-xl md:text-2xl font-bold mb-4 px-4 md:px-0">
                Project Statistics
            </h1>

            {/* DATE FILTERS */}
            <div className="mb-6 px-4 md:px-0">
                <div className="bg-white rounded-xl ring-1 ring-black/[0.04] shadow-sm p-4 mb-4">
                    <div className="flex flex-col gap-3 md:gap-4">
                        {/* Date Inputs */}
                        <div className="flex flex-col md:flex-row gap-3">
                            <>
                                <div className="flex flex-col">
                                    <label className="text-xs md:text-sm font-medium text-slate-700 mb-1">Start Date</label>
                                    <input
                                        type="date"
                                        value={startDate || ''}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="px-3 py-2 border border-slate-200 rounded-md text-sm"
                                    />
                                </div>
                                <div className="flex flex-col">
                                    <label className="text-xs md:text-sm font-medium text-slate-700 mb-1">End Date</label>
                                    <input
                                        type="date"
                                        value={endDate}
                                        onChange={(e) => setEndDate(e.target.value)}
                                        className="px-3 py-2 border border-slate-200 rounded-md text-sm"
                                    />
                                </div>
                            </>
                        </div>
                    </div>
                </div>
            </div>

            {/* STATS */}
            {totals && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6 px-4 md:px-0">
                    <StatCard label="Total Staff" value={totals.total_staff} icon={Users} color="blue" />
                    <StatCard label="Online Staff" value={totals.online_staff ?? 0} icon={Activity} color="green" />
                    <StatCard label="Present Staff" value={totals.present_staff} icon={UserCheck} color="green" />
                    <StatCard label="Absent Staff" value={totals.absent_staff} icon={UserX} color="rose" />

                    <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                        <div className="flex items-center gap-2 mb-2">
                            <Package className="h-4 w-4 text-violet-700" />
                            <h3 className="text-xs font-semibold text-violet-900">Project Count (Country-wise)</h3>
                        </div>
                        <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                            {countries.length > 0 ? (
                                countries.map((item) => (
                                    <div key={`received-${item.country}`} className="flex items-center justify-between text-[11px]">
                                        <span className="text-violet-900 truncate">{item.country}</span>
                                        <span className="font-semibold text-violet-800">{item.projects_count ?? item.project_count ?? item.projects?.length ?? 0}</span>
                                    </div>
                                ))
                            ) : (
                                <div className="text-[11px] text-violet-700">No country data</div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* TABLE */}
            <div className="px-4 md:px-0">
                <div className="bg-white rounded-2xl overflow-hidden shadow-sm border border-slate-200/80">
                    <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                        <div>
                            <h2 className="text-sm font-bold text-slate-900 tracking-tight">Project Code</h2>
                            <p className="text-[11px] text-slate-400 mt-0.5">{data.length} active projects</p>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            <span className="text-[11px] font-medium text-slate-400">Live</span>
                        </div>
                    </div>
                    <div className="max-h-[60vh] overflow-auto">
                        <table className="w-full border-collapse">
                            <thead>
                                <tr>
                                    <th rowSpan={2} className="sticky top-0 z-30 px-4 py-2 text-left text-[9px] font-bold text-slate-400 uppercase tracking-widest bg-slate-50 border-b-2 border-slate-200 min-w-[150px] border-r border-slate-100 shadow-sm">
                                        Project
                                    </th>
                                    <th colSpan={5} className="sticky top-0 z-30 px-3 py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-[#2AA7A0] bg-[#f4fbfa] border-b border-[#2AA7A0]/20 shadow-sm">
                                        Orders
                                    </th>
                                    <th colSpan={4} className="sticky top-0 z-30 px-3 py-1.5 text-center text-[9px] font-bold uppercase tracking-widest text-slate-400 bg-slate-50 border-b border-slate-200 border-l border-slate-100 shadow-sm">
                                        Workforce
                                    </th>
                                </tr>
                                <tr className="border-b-2 border-slate-200">
                                    <th className="sticky top-[25px] z-20 px-3 py-2 text-center text-[10px] font-semibold text-slate-500 bg-slate-50 whitespace-nowrap shadow-sm">Received</th>
                                    <th className="sticky top-[25px] z-20 px-3 py-2 text-center text-[10px] font-semibold text-slate-500 bg-slate-50 whitespace-nowrap shadow-sm">Pending</th>
                                    <th className="sticky top-[25px] z-20 px-3 py-2 text-center text-[10px] font-semibold text-slate-500 bg-slate-50 whitespace-nowrap shadow-sm">Delayed Pend.</th>
                                    <th className="sticky top-[25px] z-20 px-3 py-2 text-center text-[10px] font-semibold text-slate-500 bg-slate-50 whitespace-nowrap shadow-sm">Completed</th>
                                    <th className="sticky top-[25px] z-20 px-3 py-2 text-center text-[10px] font-semibold text-slate-500 bg-slate-50 whitespace-nowrap border-r border-slate-100 shadow-sm">Delayed Done</th>
                                    <th className="sticky top-[25px] z-20 px-3 py-2 text-center text-[10px] font-semibold text-slate-400 bg-slate-50 whitespace-nowrap shadow-sm">Total</th>
                                    <th className="sticky top-[25px] z-20 px-3 py-2 text-center text-[10px] font-semibold text-slate-400 bg-slate-50 whitespace-nowrap shadow-sm">Online</th>
                                    <th className="sticky top-[25px] z-20 px-3 py-2 text-center text-[10px] font-semibold text-slate-400 bg-slate-50 whitespace-nowrap shadow-sm">Present</th>
                                    <th className="sticky top-[25px] z-20 px-3 py-2 text-center text-[10px] font-semibold text-slate-400 bg-slate-50 whitespace-nowrap shadow-sm">Absent</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading ? (
                                    <tr>
                                        <td colSpan={10} className="px-4 py-10 text-center text-xs md:text-sm text-slate-400">
                                            Loading projects...
                                        </td>
                                    </tr>
                                ) : data.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="px-4 py-10 text-center text-xs md:text-sm text-slate-400">
                                            No projects found.
                                        </td>
                                    </tr>
                                ) : (
                                    data.map((project) => {
                                        const isOpen = selectedProject?.project_id === project.project_id;
                                        const detailProject = isOpen && selectedProject ? selectedProject : project;
                                        const completedTodayCount = activeTab === 'received'
                                            ? (project.received_done_orders ?? project.completed_orders_today ?? 0)
                                            : (project.done_orders ?? project.done_orders_today ?? project.completed_orders_today ?? 0);
                                        const clientNameCounts = detailProject.client_name_counts ?? [];
                                        const showClientNamesAsProjects =
                                            specialClientProjectIds.includes(project.project_id) && clientNameCounts.length > 0;
                                        const showTeamBreakdown = project.project_id === teamBreakdownProjectId
                                            && (allTeams.length > 0 || Boolean(unassignedTeam) || Boolean(batchStatus) || projectTeams.length > 0);
                                        const roleCardsToRender = showTeamBreakdown ? [] : visibleRoles;
                                        const onlineUsers = getProjectOnlineUsers(detailProject);
                                        const projectOnlineCount = detailProject.online_staff ?? onlineUsers.length;
                                        const teamsForDisplay = teamDetailTab === 'unassigned' && unassignedTeam
                                            ? [unassignedTeam]
                                            : teamDetailTab === 'teams-online'
                                                ? allTeams.filter(t => onlineTeamIds.has(Number(t.team_id)))
                                                : teamDetailTab === 'teams-offline'
                                                    ? allTeams.filter(t => !onlineTeamIds.has(Number(t.team_id)))
                                                    : teamDetailTab === 'teams'
                                                        ? allTeams
                                                        : visibleTeams;
                                        const batchTotals = batchStatus?.total_orders;
                                        const batchCount = batchStatus?.batches?.length ?? detailProject.batch_count ?? 0;
                                        const batchPlansRemaining = batchStatus?.plans_remaining ?? [];
                                        const batchHourlyCounts = batchStatus?.hourly_counts ?? [];
                                        const maxHourlyOrders = Math.max(1, ...batchHourlyCounts.map((item) => Number(item.orders || 0)));
                                        const batchTopPlans = [
                                            { label: 'Untouched Top', value: batchStatus?.untouched_min?.remaining_time },
                                            { label: 'Fixed Top', value: batchStatus?.fixed_min?.remaining_time },
                                        ].filter((item) => item.value);

                                        return (
                                            <React.Fragment key={project.project_id}>
                                                <tr
                                                    onClick={() => toggleProjectBreakdown(project)}
                                                    className={`cursor-pointer transition-colors duration-100 border-b border-slate-100 group ${isOpen ? 'bg-teal-50/30' : 'hover:bg-slate-50/60'}`}
                                                >
                                                    <td className={`px-3 md:px-4 py-3 text-[12px] md:text-[13px] border-r border-slate-100 ${isOpen ? 'border-l-[3px] border-l-[#2AA7A0]' : 'border-l-[3px] border-l-transparent group-hover:border-l-slate-200'}`}>
                                                        <div className="flex items-center gap-2">
                                                            {isOpen ? (
                                                                <ChevronUp className="h-3.5 w-3.5 text-[#2AA7A0] flex-shrink-0" />
                                                            ) : (
                                                                <ChevronDown className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-400 flex-shrink-0" />
                                                            )}
                                                            <span className={`font-semibold ${isOpen ? 'text-[#0f766e]' : 'text-slate-800'}`}>{project.project_name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 md:px-4 py-3 text-center tabular-nums">
                                                        {project.received_orders_today > 0
                                                            ? <span className="text-[12px] md:text-[13px] font-semibold text-slate-700">{project.received_orders_today.toLocaleString()}</span>
                                                            : <span className="text-[13px] text-slate-300 select-none">—</span>}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-3 text-center tabular-nums">
                                                        {project.pending_orders > 0
                                                            ? <span className="text-[12px] md:text-[13px] font-medium text-slate-500">{project.pending_orders.toLocaleString()}</span>
                                                            : <span className="text-[13px] text-slate-300 select-none">—</span>}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-3 text-center tabular-nums">
                                                        {(project.delayed_pending_orders ?? 0) > 0
                                                            ? <span className="inline-flex items-center justify-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] md:text-xs font-bold text-slate-600 ring-1 ring-slate-200">{(project.delayed_pending_orders ?? 0).toLocaleString()}</span>
                                                            : <span className="text-[13px] text-slate-300 select-none">—</span>}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-3 text-center tabular-nums">
                                                        {completedTodayCount > 0
                                                            ? <span className="text-[12px] md:text-[13px] font-semibold text-[#2AA7A0]">{Number(completedTodayCount).toLocaleString()}</span>
                                                            : <span className="text-[13px] text-slate-300 select-none">—</span>}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-3 text-center tabular-nums border-r border-slate-100">
                                                        {(project.delayed_done_orders ?? 0) > 0
                                                            ? <span className="inline-flex items-center justify-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] md:text-xs font-bold text-slate-600 ring-1 ring-slate-200">{(project.delayed_done_orders ?? 0).toLocaleString()}</span>
                                                            : <span className="text-[13px] text-slate-300 select-none">—</span>}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-3 text-center tabular-nums">
                                                        <span className="text-[12px] md:text-[13px] font-medium text-slate-600">{project.total_staff.toLocaleString()}</span>
                                                    </td>
                                                    <td className="px-3 md:px-4 py-3 text-center">
                                                        {projectOnlineCount > 0
                                                            ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#2AA7A0]/10 px-2.5 py-0.5 text-[11px] md:text-xs font-semibold text-[#0f766e] ring-1 ring-[#2AA7A0]/25">
                                                                <span className="h-1.5 w-1.5 rounded-full bg-[#2AA7A0] animate-pulse" />
                                                                {projectOnlineCount}
                                                            </span>
                                                            : <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-slate-200">
                                                                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                                                                0
                                                            </span>}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-3 text-center tabular-nums">
                                                        {project.present_staff > 0
                                                            ? <span className="text-[12px] md:text-[13px] font-medium text-slate-600">{project.present_staff.toLocaleString()}</span>
                                                            : <span className="text-[13px] text-slate-300 select-none">—</span>}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-3 text-center tabular-nums">
                                                        {project.absent_staff > 0
                                                            ? <span className="text-[12px] md:text-[13px] font-semibold text-rose-500">{project.absent_staff.toLocaleString()}</span>
                                                            : <span className="text-[13px] text-slate-300 select-none">—</span>}
                                                    </td>
                                                </tr>

                                                {isOpen && (
                                                    <tr>
                                                        <td colSpan={10} className="px-4 md:px-5 py-4 md:py-5 border-l-[3px] border-l-[#2AA7A0] bg-gradient-to-b from-teal-50/20 to-white border-b border-slate-200">
                                                            {loadingBreakdown ? (
                                                                <div className="flex items-center justify-center py-10">
                                                                    <Loader2 className="h-6 w-6 animate-spin text-[#2AA7A0]" />
                                                                </div>
                                                            ) : (
                                                                <div className="space-y-3">
                                                                    {showClientNamesAsProjects && (
                                                                        <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-cyan-50 overflow-hidden shadow-sm">
                                                                            <div className="flex items-center justify-between px-4 py-3 border-b border-teal-200 bg-gradient-to-r from-teal-600 to-teal-700">
                                                                                <h3 className="text-xs md:text-sm font-bold text-white">
                                                                                    Project Code ({project.project_code ?? project.project_name})
                                                                                </h3>
                                                                                <span className="inline-flex items-center justify-center min-w-[1.75rem] h-6 rounded-full bg-white/90 px-2 text-xs md:text-sm font-semibold text-teal-700 shadow-sm">
                                                                                    {clientNameCounts.length}
                                                                                </span>
                                                                            </div>
                                                                            <div className="px-4 py-3.5 bg-white flex flex-wrap gap-2">
                                                                                {clientNameCounts.length > 0 ? (
                                                                                    clientNameCounts.map((row, idx) => {
                                                                                        const label = (row.code_client_name || [row.code, row.client_name].filter(Boolean).join(' - ') || row.client_name || 'Unknown').trim();
                                                                                        const count = Number(row.orders_count || 0);
                                                                                        return (
                                                                                            <div
                                                                                                key={`project-bubble-${idx}`}
                                                                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-teal-100 to-cyan-100 border border-teal-200 hover:from-teal-200 hover:to-cyan-200 transition-all duration-200 cursor-default group shadow-sm hover:shadow-md"
                                                                                            >
                                                                                                <span className="text-[11px] md:text-xs font-semibold text-teal-800 group-hover:text-teal-900 truncate max-w-xs">
                                                                                                    {label}
                                                                                                </span>
                                                                                                <span className="inline-flex items-center justify-center min-w-[1.25rem] px-1.5 py-0 rounded-full bg-teal-600 text-white text-[10px] md:text-[11px] font-bold shadow-sm">
                                                                                                    {count}
                                                                                                </span>
                                                                                            </div>
                                                                                        );
                                                                                    })
                                                                                ) : (
                                                                                    <div className="w-full py-3 text-center text-xs md:text-sm text-slate-400 italic">
                                                                                        No project codes available
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {showTeamBreakdown && (
                                                                        <div className="space-y-3">
                                                                            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-2.5 py-2">
                                                                                {[
                                                                                    { label: 'Total Teams', value: teamSummary.totalTeams, tab: 'teams' as TeamDetailTab },
                                                                                    { label: 'Online Teams', value: teamSummary.activeTeams, tab: 'teams-online' as TeamDetailTab, status: 'online' },
                                                                                    { label: 'Offline Teams', value: teamSummary.inactiveTeams, tab: 'teams-offline' as TeamDetailTab, status: 'offline' },
                                                                                    {
                                                                                        label: 'Unassigned',
                                                                                        value: teamSummary.unassignedDrawers + teamSummary.unassignedCheckers,
                                                                                        tab: 'unassigned' as TeamDetailTab,
                                                                                        suffix: `D ${teamSummary.unassignedDrawers} / C ${teamSummary.unassignedCheckers}`,
                                                                                    },
                                                                                    {
                                                                                        label: 'Overall Status',
                                                                                        value: batchCount,
                                                                                        tab: 'batch' as TeamDetailTab,
                                                                                        showValue: false,
                                                                                    },
                                                                                ].map((item) => {
                                                                                    const isSelected = teamDetailTab === item.tab;
                                                                                    return (
                                                                                        <button
                                                                                            key={item.label}
                                                                                            type="button"
                                                                                            onClick={() => handleTeamDetailTabClick(item.tab)}
                                                                                            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] md:text-xs font-semibold ring-1 transition ${isSelected ? 'bg-white text-slate-950 ring-slate-300 shadow-sm' : 'bg-transparent text-slate-600 ring-transparent hover:bg-white/70 hover:text-slate-900'}`}
                                                                                        >
                                                                                            {'status' in item && item.status ? (
                                                                                                <span
                                                                                                    className={`h-2 w-2 rounded-full ${item.status === 'online' ? 'bg-emerald-500 ring-2 ring-emerald-100' : 'bg-slate-400 ring-2 ring-slate-200'}`}
                                                                                                />
                                                                                            ) : null}
                                                                                            <span>{item.label}</span>
                                                                                            {item.showValue !== false ? (
                                                                                                <span className={`rounded-md px-1.5 py-0.5 text-[10px] ${isSelected ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>
                                                                                                    {item.value}
                                                                                                </span>
                                                                                            ) : null}
                                                                                            {'suffix' in item && item.suffix ? (
                                                                                                <span className="text-[10px] font-medium text-slate-500">{item.suffix}</span>
                                                                                            ) : null}
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>

                                                                            {teamDetailTab === 'batch' ? (
                                                                                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                                                                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
                                                                                        <div>
                                                                                            <h3 className="text-xs md:text-sm font-semibold text-slate-950">Cubi Status</h3>
                                                                                            <p className="mt-0.5 text-[10px] md:text-[11px] font-medium text-slate-500">
                                                                                                Plans, workflow position, hourly load, and remaining time
                                                                                            </p>
                                                                                        </div>
                                                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                                                            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">Plans {batchTotals?.plans ?? 0}</span>
                                                                                            <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Done {batchTotals?.done ?? 0}</span>
                                                                                            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Pending {batchTotals?.pending ?? 0}</span>
                                                                                            <span className="rounded-md bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700">Draw Orders {batchTotals?.drawing_process ?? 0}</span>
                                                                                            <span className="rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">Fixing {batchTotals?.sent_to_fixing ?? 0}</span>
                                                                                            {batchTopPlans.map((item) => (
                                                                                                <span
                                                                                                    key={`batch-header-${item.label}`}
                                                                                                    className="rounded-md bg-[#2AA7A0]/10 px-2 py-0.5 text-[10px] font-semibold text-[#0f766e] ring-1 ring-[#2AA7A0]/20"
                                                                                                >
                                                                                                    {item.label}: {item.value}
                                                                                                </span>
                                                                                            ))}
                                                                                        </div>
                                                                                    </div>
                                                                                    {loadingBatchStatus ? (
                                                                                        <div className="flex items-center justify-center py-8">
                                                                                            <Loader2 className="h-5 w-5 animate-spin text-[#2AA7A0]" />
                                                                                        </div>
                                                                                    ) : (batchStatus?.batches?.length ?? 0) > 0 ? (
                                                                                        <div className="space-y-3 p-3">
                                                                                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                                                                                                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                                                                                                    <div className="mb-2 flex items-center justify-between gap-2">
                                                                                                        <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Plans Remaining Time</h4>
                                                                                                        <span className="text-[10px] font-semibold text-slate-400">{batchPlansRemaining.length} slots</span>
                                                                                                    </div>
                                                                                                    <div className="flex flex-wrap gap-1.5">
                                                                                                        {batchPlansRemaining.length > 0 ? batchPlansRemaining.map((item) => (
                                                                                                            <span key={`plans-${item.hour}-${item.plans}`} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 ring-1 ring-slate-200">
                                                                                                                <span className="text-slate-950">{item.plans}</span>
                                                                                                                <span>plans</span>
                                                                                                                <span className="text-slate-400">:</span>
                                                                                                                <span className="text-[#0f766e]">{item.hour}h</span>
                                                                                                            </span>
                                                                                                        )) : (
                                                                                                            <div className="py-3 text-xs text-slate-400">No remaining-time buckets.</div>
                                                                                                        )}
                                                                                                    </div>
                                                                                                </div>

                                                                                                <div className="rounded-lg border border-slate-200 bg-white p-3 xl:col-span-2">
                                                                                                    <div className="mb-2 flex items-center justify-between gap-2">
                                                                                                        <h4 className="text-[11px] font-bold uppercase tracking-wide text-slate-700">Hourly Counts</h4>
                                                                                                        {/* <span className="text-[10px] font-semibold text-slate-400">{batchHourlyCounts.reduce((sum, item) => sum + Number(item.orders || 0), 0).toLocaleString()} orders</span> */}
                                                                                                    </div>
                                                                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                                                                                                        {batchHourlyCounts.length > 0 ? batchHourlyCounts.map((item) => {
                                                                                                            const orders = Number(item.orders || 0);
                                                                                                            return (
                                                                                                                <div key={`hourly-${item.label}`} className="grid grid-cols-[92px_1fr_42px] items-center gap-2 text-[11px]">
                                                                                                                    <span className="font-medium text-slate-600">{item.label}</span>
                                                                                                                    <span className="h-2 overflow-hidden rounded-full bg-slate-100">
                                                                                                                        <span
                                                                                                                            className="block h-full rounded-full bg-[#2AA7A0]"
                                                                                                                            style={{ width: `${Math.max(orders > 0 ? 8 : 0, Math.round((orders / maxHourlyOrders) * 100))}%` }}
                                                                                                                        />
                                                                                                                    </span>
                                                                                                                    <span className={`text-right font-bold tabular-nums ${orders > 0 ? 'text-slate-800' : 'text-slate-300'}`}>{orders}</span>
                                                                                                                </div>
                                                                                                            );
                                                                                                        }) : (
                                                                                                            <div className="py-3 text-xs text-slate-400">No hourly counts.</div>
                                                                                                        )}
                                                                                                    </div>
                                                                                                </div>
                                                                                            </div>

                                                                                            <div className="overflow-x-auto rounded-lg border border-slate-200">
                                                                                                <table className="w-full text-xs md:text-sm">
                                                                                                    <thead className="bg-slate-50">
                                                                                                        <tr className="border-b border-slate-100">
                                                                                                            <th className="px-3 py-2 text-left text-[10px] font-semibold text-slate-500">Batch</th>
                                                                                                            <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Received</th>
                                                                                                            <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Remaining</th>
                                                                                                            <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Plans</th>
                                                                                                            <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Done</th>
                                                                                                            <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Pending</th>
                                                                                                            <th className="px-3 py-2 text-center text-[10px] font-semibold text-slate-500">Fixing</th>
                                                                                                        </tr>
                                                                                                    </thead>
                                                                                                    <tbody className="divide-y divide-slate-50 bg-white">
                                                                                                        {batchStatus?.batches?.map((batch) => (
                                                                                                            <tr key={`batch-${batch.batch_no}`} className="hover:bg-slate-50/70">
                                                                                                                <td className="px-3 py-2 font-semibold text-slate-900">{batch.batch_label ?? `Batch ${batch.batch_no}`}</td>
                                                                                                                <td className="px-3 py-2 text-center text-slate-600">{batch.received_time ?? '-'}</td>
                                                                                                                <td className="px-3 py-2 text-center text-slate-600">{batch.remaining_time ?? '-'}</td>
                                                                                                                <td className="px-3 py-2 text-center font-semibold text-slate-700">{batch.plans ?? 0}</td>
                                                                                                                <td className="px-3 py-2 text-center font-semibold text-emerald-700">{batch.done ?? 0}</td>
                                                                                                                <td className="px-3 py-2 text-center font-semibold text-amber-700">{batch.pending ?? 0}</td>
                                                                                                                <td className="px-3 py-2 text-center font-semibold text-rose-700">{batch.fixing ?? 0}</td>
                                                                                                            </tr>
                                                                                                        ))}
                                                                                                    </tbody>
                                                                                                </table>
                                                                                            </div>
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div className="px-3 py-8 text-center text-xs md:text-sm text-slate-400">
                                                                                            No batch status data available.
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            ) : null}

                                                                            {teamDetailTab !== 'batch' && (
                                                                                loadingProjectTeams ? (
                                                                                    <div className="flex items-center justify-center rounded-xl border border-slate-200 bg-white py-8">
                                                                                        <Loader2 className="h-5 w-5 animate-spin text-[#2AA7A0]" />
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="grid grid-cols-1 xl:grid-cols-1 gap-3">
                                                                                        {teamsForDisplay.map((team) => {
                                                                                            const teamDone = Number(team.checker_done ?? 0);
                                                                                            const teamPending = (team.drawers ?? []).reduce((s: number, w) => s + (Number(w.wip) || 0), 0)
                                                                                                + (team.checkers ?? []).reduce((s: number, w) => s + (Number(w.wip) || 0), 0);
                                                                                            const teamAssigned = teamDone + teamPending;
                                                                                            return (
                                                                                                <div key={`team-${team.team_id}`} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                                                                                    <div
                                                                                                        onClick={() => setExpandedTeam(expandedTeam === team.team_id ? null : team.team_id)}
                                                                                                        className="flex items-center border-b border-slate-200 bg-slate-50 px-3 py-2.5 cursor-pointer select-none"
                                                                                                    >
                                                                                                        <div className="min-w-0 flex-1">
                                                                                                            <h3 className="truncate text-xs md:text-sm font-semibold text-slate-900">{team.team_name}</h3>
                                                                                                        </div>
                                                                                                        <div className="flex items-center gap-2 ml-auto">
                                                                                                            <div className="flex items-center gap-1">
                                                                                                                <span style={{ fontSize: '11px', fontWeight: '600', color: '#64748b' }}>{teamAssigned} assigned</span>
                                                                                                                <span style={{ fontSize: '10px', color: '#cbd5e1', padding: '0 2px' }}>·</span>
                                                                                                                <span style={{ fontSize: '11px', fontWeight: '700', color: '#0f766e', background: '#ccfbf1', borderRadius: '4px', padding: '1px 6px' }}>{teamDone} Done</span>
                                                                                                                <span style={{ fontSize: '10px', color: '#cbd5e1', padding: '0 2px' }}>·</span>
                                                                                                                <span style={{ fontSize: '11px', fontWeight: '700', color: teamPending > 0 ? '#b45309' : '#94a3b8', background: teamPending > 0 ? '#fef3c7' : 'transparent', borderRadius: '4px', padding: teamPending > 0 ? '1px 6px' : '0' }}>{teamPending} pend</span>
                                                                                                            </div>
                                                                                                            <svg xmlns="http://www.w3.org/2000/svg" style={{ width: '14px', height: '14px', color: '#94a3b8', transform: expandedTeam === team.team_id ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', flexShrink: 0 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                                                                                <polyline points="9 18 15 12 9 6" />
                                                                                                            </svg>
                                                                                                        </div>
                                                                                                    </div>
                                                                                                    {expandedTeam === team.team_id && (
                                                                                                        <div style={{ borderTop: '1px solid #e2e8f0', display: 'grid', gridTemplateColumns: '1fr 1fr', background: '#f8fafc' }}>
                                                                                                            {/* DRAWERS col */}
                                                                                                            <div style={{ borderRight: '1px solid #e2e8f0', background: '#fff' }}>
                                                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', background: '#f0fdfa', borderBottom: '1px solid #ccfbf1', borderLeft: '3px solid #0d9488' }}>
                                                                                                                    <span style={{ fontSize: '10px', fontWeight: '800', color: '#0d9488', letterSpacing: '0.07em' }}>DRAWERS</span>
                                                                                                                    <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#cbd5e1', flexShrink: 0 }} />
                                                                                                                    <span style={{ fontSize: '10px', color: '#64748b', fontWeight: '500' }}>{(team.drawers || []).length}</span>
                                                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginLeft: 'auto' }}>
                                                                                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '600', color: '#15803d' }}>{'Online '}<span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />{getOnlineCountForWorkers(team.drawers, onlineUsers)}</span>
                                                                                                                        <span style={{ fontSize: '10px', color: '#cbd5e1' }}>·</span>
                                                                                                                        <span style={{ fontSize: '10px', fontWeight: '600', color: '#0f766e' }}>{Number(team.drawer_done ?? 0)} done</span>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                                <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                                                                                                                    {(team.drawers || []).length > 0 ? (team.drawers || []).map((w, wi) => {
                                                                                                                        const isOn = !!(w.is_online || getOnlineUserForWorker(w, onlineUsers));
                                                                                                                        const dn = Number(w.total_done_selected_date ?? w.total_done ?? 0);
                                                                                                                        const wip = Number(w.wip ?? 0);
                                                                                                                        const assigned = dn + wip;
                                                                                                                        const isGuest = Boolean(w.is_guest);
                                                                                                                        return (
                                                                                                                            <div key={`dr-${team.team_id}-${wi}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: isGuest ? '#faf5ff' : isOn ? '#f0fdfa' : '#fff', borderBottom: '1px solid #f1f5f9' }}>
                                                                                                                                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: isGuest ? '#a855f7' : isOn ? '#10b981' : '#e2e8f0', flexShrink: 0 }} />
                                                                                                                                <span title={isGuest && w.home_team_name ? `Home team: ${w.home_team_name}` : undefined} style={{ fontSize: '11px', fontWeight: '500', color: isGuest ? '#6d28d9' : '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                                                                                    {w.name}{isGuest ? ' (Guest)' : ''}
                                                                                                                                </span>
                                                                                                                                <span style={{ fontSize: '10px', fontWeight: '600', color: '#64748b', whiteSpace: 'nowrap' }}>{assigned} assign</span>
                                                                                                                                <span style={{ fontSize: '11px', fontWeight: '700', color: dn > 0 ? '#0f766e' : '#94a3b8', background: dn > 0 ? '#ccfbf1' : '#f8fafc', borderRadius: '4px', padding: '1px 6px', whiteSpace: 'nowrap' }}>✓{dn}</span>
                                                                                                                                <span style={{ fontSize: '11px', fontWeight: '600', color: wip > 0 ? '#b45309' : '#94a3b8', background: wip > 0 ? '#fef3c7' : '#f8fafc', borderRadius: '4px', padding: '1px 6px', whiteSpace: 'nowrap' }}>{wip} wip</span>
                                                                                                                            </div>
                                                                                                                        );
                                                                                                                    }) : <div style={{ padding: '12px 10px', fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>—</div>}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                            {/* CHECKERS col */}
                                                                                                            <div style={{ background: '#fff' }}>
                                                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', background: '#faf5ff', borderBottom: '1px solid #ede9fe', borderLeft: '3px solid #7c3aed' }}>
                                                                                                                    <span style={{ fontSize: '10px', fontWeight: '800', color: '#7c3aed', letterSpacing: '0.07em' }}>CHECKERS</span>
                                                                                                                    <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#cbd5e1', flexShrink: 0 }} />
                                                                                                                    <span style={{ fontSize: '10px', color: '#64748b', fontWeight: '500' }}>{(team.checkers || []).length}</span>
                                                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px', marginLeft: 'auto' }}>
                                                                                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '600', color: '#15803d' }}>{'Online '}<span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />{getOnlineCountForWorkers(team.checkers, onlineUsers)}</span>
                                                                                                                        <span style={{ fontSize: '10px', color: '#cbd5e1' }}>·</span>
                                                                                                                        <span style={{ fontSize: '10px', fontWeight: '600', color: '#7c3aed' }}>{Number(team.checker_done ?? 0)} done</span>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                                <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                                                                                                                    {(team.checkers || []).length > 0 ? (team.checkers || []).map((w, wi) => {
                                                                                                                        const isOn = !!(w.is_online || getOnlineUserForWorker(w, onlineUsers));
                                                                                                                        const dn = Number(w.total_done_selected_date ?? w.total_done ?? 0);
                                                                                                                        const wip = Number(w.wip ?? 0);
                                                                                                                        return (
                                                                                                                            <div key={`ck-${team.team_id}-${wi}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: isOn ? '#faf5ff' : '#fff', borderBottom: '1px solid #f1f5f9' }}>
                                                                                                                                <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: isOn ? '#10b981' : '#e2e8f0', flexShrink: 0 }} />
                                                                                                                                <span style={{ fontSize: '11px', fontWeight: '500', color: '#1e293b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                                                                                                                                <span style={{ fontSize: '10px', fontWeight: '600', color: '#64748b', whiteSpace: 'nowrap' }}>{dn + wip} assign</span>
                                                                                                                                <span style={{ fontSize: '11px', fontWeight: '700', color: dn > 0 ? '#7c3aed' : '#94a3b8', background: dn > 0 ? '#ede9fe' : '#f8fafc', borderRadius: '4px', padding: '1px 6px', whiteSpace: 'nowrap' }}>✓{dn}</span>
                                                                                                                                <span style={{ fontSize: '11px', fontWeight: '600', color: wip > 0 ? '#b45309' : '#94a3b8', background: wip > 0 ? '#fef3c7' : '#f8fafc', borderRadius: '4px', padding: '1px 6px', whiteSpace: 'nowrap' }}>{wip} wip</span>
                                                                                                                            </div>
                                                                                                                        );
                                                                                                                    }) : <div style={{ padding: '12px 10px', fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>—</div>}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                )
                                                                            )}
                                                                        </div>
                                                                    )}

                                                                    {roleCardsToRender.length > 0 ? (
                                                                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                                                                            {roleCardsToRender.map((role) => {
                                                                                const workers = activeTab === 'received'
                                                                                    ? role.today_received_done
                                                                                    : role.today_done_all;
                                                                                const total = activeTab === 'received'
                                                                                    ? role.total_today_received_done
                                                                                    : role.total_today_done_all;
                                                                                const roleOnlineCount = getOnlineCountForWorkers(workers, onlineUsers);

                                                                                return (
                                                                                    <div key={role.role} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                                                                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 bg-slate-50">
                                                                                            <div>
                                                                                                <h3 className="text-xs md:text-sm font-semibold text-slate-900">{role.label}</h3>
                                                                                                <p className="text-[10px] md:text-[11px] text-slate-500">
                                                                                                    {activeTab === 'received' ? 'Today received done' : 'Today done'}
                                                                                                </p>
                                                                                            </div>
                                                                                            <div className="flex items-center gap-1.5">
                                                                                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] md:text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                                                                                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                                                                                    Online: {roleOnlineCount}
                                                                                                </span>
                                                                                                <span className="inline-flex items-center justify-center min-w-[1.75rem] rounded-md bg-[#2AA7A0]/10 px-2 py-0.5 text-xs md:text-sm font-semibold text-[#2AA7A0]">
                                                                                                    {total}
                                                                                                </span>
                                                                                            </div>
                                                                                        </div>

                                                                                        <div>
                                                                                            {workers.length === 0 ? (
                                                                                                <div className="px-3 py-6 text-center text-xs md:text-sm text-slate-400">
                                                                                                    No data
                                                                                                </div>
                                                                                            ) : (
                                                                                                <table className="w-full text-xs md:text-sm">
                                                                                                    <thead className="bg-white">
                                                                                                        <tr className="border-b border-slate-100">
                                                                                                            <th className="px-3 py-2 text-left text-[9px] md:text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                                                                                                Name
                                                                                                            </th>
                                                                                                            <th className="px-3 py-2 text-center text-[9px] md:text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                                                                                                                Count
                                                                                                            </th>
                                                                                                        </tr>
                                                                                                    </thead>
                                                                                                    <tbody className="divide-y divide-slate-50">
                                                                                                        {workers.map((worker, index) => {
                                                                                                            const isOnline = Boolean(getOnlineUserForWorker(worker, onlineUsers));

                                                                                                            return (
                                                                                                                <tr key={`${role.role}-${worker.name}-${index}`} className="hover:bg-slate-50/70">
                                                                                                                    <td className="px-3 py-1.5 text-[10px] md:text-[11px] text-slate-800">
                                                                                                                        <div className="flex min-w-0 items-center gap-1.5">
                                                                                                                            <span
                                                                                                                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${isOnline ? 'bg-emerald-500 ring-2 ring-emerald-100' : 'bg-slate-300'}`}
                                                                                                                                title={isOnline ? 'Active now' : 'Offline'}
                                                                                                                            />
                                                                                                                            <span className="truncate">{worker.name}</span>
                                                                                                                        </div>
                                                                                                                    </td>
                                                                                                                    <td className="px-3 py-1.5 text-center">
                                                                                                                        <span className="inline-flex items-center justify-center min-w-[1.5rem] rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] md:text-[10px] font-semibold text-slate-700">
                                                                                                                            {worker.done_count}
                                                                                                                        </span>
                                                                                                                    </td>
                                                                                                                </tr>
                                                                                                            );
                                                                                                        })}
                                                                                                    </tbody>
                                                                                                </table>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    ) : (
                                                                        !showClientNamesAsProjects && !showTeamBreakdown && (
                                                                            <div className="py-8 text-center text-xs md:text-sm text-slate-400">
                                                                                No breakdown data available for this project.
                                                                            </div>
                                                                        )
                                                                    )}
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

        </div>
    );
};

export default ProjectsView;
