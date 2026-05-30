import React, { useState, useEffect, useMemo } from 'react';
import apiClient from '../../services/api';
import { StatCard } from '../../components/ui';
import { Users, UserCheck, UserX, Package, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

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
    client_name_counts?: ClientNameCount[];
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
    };
    projects: ProjectStats[];
    countries?: CountryStats[];
    selected_project_breakdown?: ProjectBreakdownResponse;
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
    total_done?: number;
    total_done_selected_date?: number;
    wip?: number;
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

type RoleCompletionEntry = {
    total_staff?: number;
    active?: number;
    today_completed?: number;
};

/* ================= COMPONENT ================= */

const ProjectsView: React.FC = () => {
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

    const [activeTab] = useState<'received' | 'done'>('received');

    /* ================= FETCH MAIN ================= */

    useEffect(() => {
        const fetch = async () => {
            try {
                setLoading(true);

                // Build params based on filter type
                const params: Record<string, string> = {};

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
            return;
        }

        try {
            setSelectedProject(project);
            setBreakdown(null);
            setLoadingBreakdown(true);

            // Build params based on filter type, including project_id
            const params: Record<string, string> = {
                project_id: project.project_id.toString()
            };

            if (dateFilterType === 'single_date') {
                params.date = selectedDate;
            } else if (dateFilterType === 'date_range') {
                if (startDate) params.start_date = startDate;
                params.end_date = endDate;
            } else if (dateFilterType === 'start_to_today') {
                if (startDate) params.start_date = startDate;
            }

            const res = await apiClient.get('/dashboard/project-stats', {
                params
            });

            if (res.data.success) {
                const apiData = res.data as {
                    selected_project_breakdown?: ProjectBreakdownResponse | null;
                    workers?: Record<string, AssignmentWorkerLike[] | undefined>;
                    role_completions?: Record<string, RoleCompletionEntry | undefined>;
                    project?: { id?: number; name?: string };
                };

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
        } finally {
            setLoadingBreakdown(false);
        }
    };

    useEffect(() => {
        setSelectedProject(null);
        setBreakdown(null);
    }, [selectedDate, startDate, endDate, dateFilterType]);

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

    const visibleTeams = useMemo(() => {
        if (!Array.isArray(breakdown?.teams)) return [];

        return breakdown.teams
            .filter((team) => {
                const drawerDone = Number(team.drawer_done ?? 0);
                const checkerDone = Number(team.checker_done ?? 0);
                const qaDone = Number(team.qa_done ?? 0);
                const roleDone = Number(team.total_done_selected_date ?? team.total_done ?? team.total_role_done ?? 0);
                return drawerDone + checkerDone + qaDone + roleDone > 0;
            })
            .slice()
            .sort((a, b) => Number(b.total_done_selected_date ?? b.total_done ?? 0) - Number(a.total_done_selected_date ?? a.total_done ?? 0));
    }, [breakdown]);

    const teamRoleGroups: Array<{
        key: 'drawers' | 'checkers' | 'qas';
        label: string;
        doneKey: 'drawer_done' | 'checker_done' | 'qa_done';
        badgeClass: string;
    }> = [
        { key: 'drawers', label: 'Drawer', doneKey: 'drawer_done', badgeClass: 'bg-blue-50 text-blue-700' },
        { key: 'checkers', label: 'Checker', doneKey: 'checker_done', badgeClass: 'bg-violet-50 text-violet-700' },
        { key: 'qas', label: 'QA', doneKey: 'qa_done', badgeClass: 'bg-emerald-50 text-emerald-700' },
    ];

    const renderTeamMembers = (members: TeamWorkerStat[] | undefined, emptyText: string) => {
        if (!members || members.length === 0) {
            return <div className="text-[10px] md:text-[11px] text-slate-400">{emptyText}</div>;
        }

        return (
            <div className="space-y-1.5">
                {members.map((member, index) => {
                    const done = Number(member.total_done_selected_date ?? member.total_done ?? 0);
                    return (
                        <div
                            key={`${member.team_id ?? 'team'}-${member.role ?? 'role'}-${member.id ?? member.name}-${index}`}
                            className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5"
                        >
                            <div className="min-w-0">
                                <div className="truncate text-[10px] md:text-[11px] font-medium text-slate-800">{member.name}</div>
                                <div className="truncate text-[9px] md:text-[10px] text-slate-500">
                                    {member.team_name || 'Team'} · WIP {member.wip ?? 0}
                                </div>
                            </div>
                            <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md bg-white px-1.5 py-0.5 text-[9px] md:text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200">
                                {done}
                            </span>
                        </div>
                    );
                })}
            </div>
        );
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
                <h2 className="text-lg md:text-xl font-semibold mb-4">Project Code</h2>

                <div className="bg-white rounded-xl overflow-hidden ring-1 ring-black/[0.04] shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-slate-100">
                                    <th className="px-3 md:px-4 py-2.5 text-left text-[10px] md:text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider bg-slate-50/80">
                                        Project Name
                                    </th>
                                    <th className="px-3 md:px-4 py-2.5 text-center text-[10px] md:text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider bg-slate-50/80">
                                        Received Today
                                    </th>
                                    <th className="px-3 md:px-4 py-2.5 text-center text-[10px] md:text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider bg-slate-50/80">
                                        Pending Orders
                                    </th>
                                    <th className="px-3 md:px-4 py-2.5 text-center text-[10px] md:text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider bg-slate-50/80">
                                        Delayed Pending
                                    </th>
                                    <th className="px-3 md:px-4 py-2.5 text-center text-[10px] md:text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider bg-slate-50/80">
                                        Completed Today
                                    </th>
                                    <th className="px-3 md:px-4 py-2.5 text-center text-[10px] md:text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider bg-slate-50/80">
                                        Delayed Completed
                                    </th>
                                    <th className="px-3 md:px-4 py-2.5 text-center text-[10px] md:text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider bg-slate-50/80">
                                        Total Staff
                                    </th>
                                    <th className="px-3 md:px-4 py-2.5 text-center text-[10px] md:text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider bg-slate-50/80">
                                        Present Staff
                                    </th>
                                    <th className="px-3 md:px-4 py-2.5 text-center text-[10px] md:text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider bg-slate-50/80">
                                        Absent Staff
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {loading ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-10 text-center text-xs md:text-sm text-slate-400">
                                            Loading projects...
                                        </td>
                                    </tr>
                                ) : data.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-10 text-center text-xs md:text-sm text-slate-400">
                                            No projects found.
                                        </td>
                                    </tr>
                                ) : (
                                    data.map((project) => {
                                        const isOpen = selectedProject?.project_id === project.project_id;
                                        const completedTodayCount = activeTab === 'received'
                                            ? (project.received_done_orders ?? project.completed_orders_today ?? 0)
                                            : (project.done_orders ?? project.done_orders_today ?? project.completed_orders_today ?? 0);
                                        const clientNameCounts = project.client_name_counts ?? [];
                                        const showClientNamesAsProjects =
                                            specialClientProjectIds.includes(project.project_id) && clientNameCounts.length > 0;

                                        return (
                                            <React.Fragment key={project.project_id}>
                                                <tr
                                                    onClick={() => toggleProjectBreakdown(project)}
                                                    className="cursor-pointer hover:bg-slate-50/80 transition-colors"
                                                >
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3 text-[12px] md:text-[13px] text-ink-primary">
                                                        <div className="flex items-center gap-1.5 md:gap-2">
                                                            {isOpen ? (
                                                                <ChevronUp className="h-3.5 w-3.5 md:h-4 md:w-4 text-[#2AA7A0]" />
                                                            ) : (
                                                                <ChevronDown className="h-3.5 w-3.5 md:h-4 md:w-4 text-slate-400" />
                                                            )}
                                                            <span className="font-medium">{project.project_name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3 text-[12px] md:text-[13px] text-center text-ink-primary">
                                                        {project.received_orders_today}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3 text-[12px] md:text-[13px] text-center text-ink-primary">
                                                        {project.pending_orders}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3 text-[12px] md:text-[13px] text-center text-ink-primary">
                                                        {project.delayed_pending_orders ?? 0}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3 text-[12px] md:text-[13px] text-center text-ink-primary">
                                                        {completedTodayCount}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3 text-[12px] md:text-[13px] text-center text-ink-primary">
                                                        {project.delayed_done_orders ?? 0}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3 text-[12px] md:text-[13px] text-center text-ink-primary">
                                                        {project.total_staff}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3 text-[12px] md:text-[13px] text-center text-ink-primary">
                                                        {project.present_staff}
                                                    </td>
                                                    <td className="px-3 md:px-4 py-2.5 md:py-3 text-[12px] md:text-[13px] text-center text-ink-primary">
                                                        {project.absent_staff}
                                                    </td>
                                                </tr>

                                                {isOpen && (
                                                    <tr className="bg-slate-50/70">
                                                        <td colSpan={9} className="px-3 md:px-4 py-3 md:py-4">
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

                                                                    {visibleTeams.length > 0 ? (
                                                                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                                                                            {visibleTeams.map((team) => (
                                                                                <div key={`team-${team.team_id}`} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                                                                    <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 md:flex-row md:items-center md:justify-between">
                                                                                        <div className="min-w-0">
                                                                                            <h3 className="truncate text-xs md:text-sm font-semibold text-slate-900">{team.team_name}</h3>
                                                                                            <p className="text-[10px] md:text-[11px] text-slate-500">Team ID: {team.team_id}</p>
                                                                                        </div>
                                                                                        <div className="flex flex-wrap gap-1.5">
                                                                                            {teamRoleGroups.map((group) => (
                                                                                                <span
                                                                                                    key={`${team.team_id}-${group.doneKey}`}
                                                                                                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] md:text-[11px] font-semibold ${group.badgeClass}`}
                                                                                                >
                                                                                                    {group.label}: {Number(team[group.doneKey] ?? 0)}
                                                                                                </span>
                                                                                            ))}
                                                                                            <span className="inline-flex items-center gap-1 rounded-md bg-[#2AA7A0]/10 px-2 py-0.5 text-[10px] md:text-[11px] font-semibold text-[#2AA7A0]">
                                                                                                Total: {Number(team.total_done_selected_date ?? team.total_done ?? 0)}
                                                                                            </span>
                                                                                        </div>
                                                                                    </div>

                                                                                    <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-3">
                                                                                        {teamRoleGroups.map((group) => (
                                                                                            <div key={`${team.team_id}-${group.key}`} className="rounded-lg border border-slate-100 bg-white p-2.5">
                                                                                                <div className="mb-2 flex items-center justify-between gap-2">
                                                                                                    <span className="text-[10px] md:text-[11px] font-semibold uppercase tracking-wider text-slate-500">{group.label}</span>
                                                                                                    <span className={`inline-flex min-w-[1.5rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[9px] md:text-[10px] font-semibold ${group.badgeClass}`}>
                                                                                                        {Number(team[group.doneKey] ?? 0)}
                                                                                                    </span>
                                                                                                </div>
                                                                                                {renderTeamMembers(team[group.key], `No ${group.label.toLowerCase()} data`)}
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : visibleRoles.length > 0 ? (
                                                                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                                                                            {visibleRoles.map((role) => {
                                                                                const workers = activeTab === 'received'
                                                                                    ? role.today_received_done
                                                                                    : role.today_done_all;
                                                                                const total = activeTab === 'received'
                                                                                    ? role.total_today_received_done
                                                                                    : role.total_today_done_all;

                                                                                return (
                                                                                    <div key={role.role} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                                                                                        <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200 bg-slate-50">
                                                                                            <div>
                                                                                                <h3 className="text-xs md:text-sm font-semibold text-slate-900">{role.label}</h3>
                                                                                                <p className="text-[10px] md:text-[11px] text-slate-500">
                                                                                                    {activeTab === 'received' ? 'Today received done' : 'Today done'}
                                                                                                </p>
                                                                                            </div>
                                                                                            <span className="inline-flex items-center justify-center min-w-[1.75rem] rounded-md bg-[#2AA7A0]/10 px-2 py-0.5 text-xs md:text-sm font-semibold text-[#2AA7A0]">
                                                                                                {total}
                                                                                            </span>
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
                                                                                                        {workers.map((worker, index) => (
                                                                                                            <tr key={`${role.role}-${worker.name}-${index}`} className="hover:bg-slate-50/70">
                                                                                                                <td className="px-3 py-1.5 text-[10px] md:text-[11px] text-slate-800">{worker.name}</td>
                                                                                                                <td className="px-3 py-1.5 text-center">
                                                                                                                    <span className="inline-flex items-center justify-center min-w-[1.5rem] rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] md:text-[10px] font-semibold text-slate-700">
                                                                                                                        {worker.done_count}
                                                                                                                    </span>
                                                                                                                </td>
                                                                                                            </tr>
                                                                                                        ))}
                                                                                                    </tbody>
                                                                                                </table>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    ) : (
                                                                        !showClientNamesAsProjects && (
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
