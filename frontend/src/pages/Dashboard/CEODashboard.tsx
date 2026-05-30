import { useState, useEffect, useCallback, useMemo, Component, type ReactNode, type ErrorInfo } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/store';
import { dashboardService } from '../../services';
import { useSmartPolling } from '../../hooks/useSmartPolling';
import type { MasterDashboard } from '../../types';
import { AnimatedPage, PageHeader, StatCard, CEODashboardSkeleton } from '../../components/ui';
import {
  Users, Package, TrendingUp, AlertTriangle, Layers, Globe, ChevronRight, ChevronDown,
  Calendar, LayoutDashboard, Clock, Target, Activity, UsersRound, UserX, DollarSign,
  ShieldAlert, Timer, BarChart3, Zap, Award, TrendingDown, AlertCircle, CheckCircle2,
  Gauge
} from 'lucide-react';
import DailyOperationsView from './DailyOperationsView';
import ProjectsView from './ProjectsView';

const COLORS = ['#2AA7A0', '#C45C26', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];

type TabType = 'overview' | 'daily-operations' | 'project-stats';

class Safe extends Component<{ id: string; children: ReactNode }, { err: string | null }> {
  state: { err: string | null } = { err: null };
  static getDerivedStateFromError(e: Error) { return { err: e?.message || String(e) }; }
  componentDidCatch(e: Error, info: ErrorInfo) { console.error(`[CEODashboard:${this.props.id}]`, e, info); }
  render() {
    if (this.state.err) return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 my-2 text-xs text-rose-700">
        <strong>Section &quot;{this.props.id}&quot; error:</strong> {this.state.err}
      </div>
    );
    return this.props.children;
  }
}

const S = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};
const N = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const Fmt = (v: number): string => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
};
const Currency = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
};

export default function CEODashboard() {
  const { user } = useSelector((state: RootState) => state.auth);
  const [activeTab, setActiveTab] = useState<TabType>('project-stats');
  const [data, setData] = useState<MasterDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);
  const [expandedDept, setExpandedDept] = useState<string | null>(null);
  const [showAllTeams, setShowAllTeams] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await dashboardService.master();
      setData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);
  useSmartPolling({ scope: 'all', interval: 60_000, onDataChanged: loadData });

  const tabs = [
    { id: 'project-stats' as TabType, label: 'Project Stats', icon: BarChart3 },
    { id: 'overview' as TabType, label: 'Overview', icon: LayoutDashboard },
    { id: 'daily-operations' as TabType, label: 'Daily Operations', icon: Calendar },
  ];

  if (loading && activeTab === 'overview') return <AnimatedPage><CEODashboardSkeleton /></AnimatedPage>;
  if (!data && activeTab === 'overview') return <div className="text-center py-20 text-slate-500">Failed to load dashboard data.</div>;

  const org = data?.org_totals;
  const rawEfficiency = org && N(org.orders_received_month) > 0
    ? Math.round((N(org.orders_delivered_month) / N(org.orders_received_month)) * 100) : 0;
  const efficiency = Math.min(rawEfficiency, 100);

  return (
    <AnimatedPage>
      <PageHeader
        title={user?.role === 'director' ? 'Director Dashboard' : 'CEO Dashboard'}
        subtitle="Organization overview across all countries and departments"
        badge={
          <span className="flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 px-3 py-1.5 rounded-full ring-1 ring-brand-200">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" /> Live
          </span>
        }
      />

      <div className="flex items-center gap-1 mb-6 p-1 bg-slate-100 rounded-xl w-fit">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} disabled={loading && activeTab !== tab.id}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            <tab.icon className="w-4 h-4" />{tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'daily-operations' ? (
        <DailyOperationsView />
      ) : activeTab === 'project-stats' ? (
        <ProjectsView />
      ) : org && data && (
        <>

          {/* ALERTS */}
          <Safe id="Alerts">
            {Array.isArray(data.alerts) && data.alerts.length > 0 && (
              <div className="space-y-2 mb-6">
                {data.alerts.map((alert, i) => (
                  <div key={i} className={`flex items-center gap-3 p-3.5 rounded-xl border ${alert.type === 'critical' ? 'bg-rose-50 border-rose-200 text-rose-800' : alert.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                    {alert.type === 'critical' ? <ShieldAlert className="h-5 w-5 flex-shrink-0" /> : alert.type === 'warning' ? <AlertTriangle className="h-5 w-5 flex-shrink-0" /> : <AlertCircle className="h-5 w-5 flex-shrink-0" />}
                    <span className="text-sm font-medium">{alert.message}</span>
                  </div>
                ))}
              </div>
            )}
          </Safe>

          {/* PRIMARY KPI CARDS */}
          <Safe id="KPI">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-4">
              <StatCard label="Active Staff" value={N(org.active_staff)} subtitle={`of ${N(org.total_staff)}`} icon={Users} color="blue" />
              <StatCard label="Absentees" value={N(org.absentees)} icon={AlertTriangle} color={N(org.absentees) > 0 ? 'rose' : 'slate'} />
              <StatCard label="Received Today" value={N(org.orders_received_today)} icon={Package} color="blue" />
              <StatCard label="Delivered Today" value={N(org.orders_delivered_today)} icon={TrendingUp} color="green" />
              <StatCard label="Total Pending" value={N(org.total_pending)} icon={Layers} color={N(org.total_pending) > 20 ? 'amber' : 'slate'} />
              <StatCard label="SLA Breaches" value={N(org.sla_breaches)} icon={ShieldAlert} color={N(org.sla_breaches) > 0 ? 'rose' : 'green'} />
              <StatCard label="Rejections Today" value={N(data.rejections?.rejected_today)} icon={TrendingDown} color={N(data.rejections?.rejected_today) > 0 ? 'amber' : 'slate'} />
              <StatCard label="Efficiency" value={`${efficiency}%`} subtitle={rawEfficiency > 100 ? 'Clearing backlog' : 'This month'} icon={TrendingUp} color="brand" />
            </div>
          </Safe>

          {/* FINANCIAL + TURNAROUND + QUALITY */}
          <Safe id="Financial">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <DollarSign className="h-4 w-4 text-emerald-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Revenue &amp; Billing</h3>
                </div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">This Month</span>
                    <span className="text-lg font-bold text-emerald-700">{Currency(N(data.financial?.revenue_this_month))}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">Total Approved</span>
                    <span className="text-sm font-semibold text-slate-900">{Currency(N(data.financial?.revenue_approved))}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">Sent/Collected</span>
                    <span className="text-sm font-semibold text-brand-600">{Currency(N(data.financial?.revenue_sent))}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-slate-500">Pipeline (Draft/Prepared)</span>
                    <span className="text-sm font-semibold text-amber-600">{Currency(N(data.financial?.revenue_pipeline))}</span>
                  </div>
                  <div className="border-t border-slate-100 pt-2 flex justify-between text-xs text-slate-500">
                    <span>{N(data.financial?.invoices_sent)} sent</span>
                    <span>{N(data.financial?.invoices_pending)} pending</span>
                    <span>{N(data.financial?.total_invoices)} total</span>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Timer className="h-4 w-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Turnaround Time</h3>
                </div>
                <div className="text-center mb-4">
                  <div className="text-3xl font-bold text-blue-700">{N(data.turnaround?.avg_hours)}h</div>
                  <div className="text-xs text-slate-500 mt-1">Avg received &rarr; delivered (this month)</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-green-50 rounded-lg p-2.5 text-center">
                    <div className="text-lg font-bold text-green-700">{N(data.turnaround?.min_hours)}h</div>
                    <div className="text-[10px] text-green-600">Fastest</div>
                  </div>
                  <div className="bg-rose-50 rounded-lg p-2.5 text-center">
                    <div className="text-lg font-bold text-rose-700">{N(data.turnaround?.max_hours)}h</div>
                    <div className="text-[10px] text-rose-600">Slowest</div>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 text-center mt-2">Based on {Fmt(N(data.turnaround?.sample_size))} orders</div>
              </div>

              <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 className="h-4 w-4 text-brand-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Quality &amp; Rejections</h3>
                </div>
                <div className="text-center mb-3">
                  <div className={`text-3xl font-bold ${N(data.quality?.qa_compliance_rate) >= 90 ? 'text-brand-700' : N(data.quality?.qa_compliance_rate) >= 70 ? 'text-amber-700' : 'text-rose-700'}`}>
                    {N(data.quality?.qa_compliance_rate)}%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">QA Compliance Rate (this month)</div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs"><span className="text-slate-500">Rework Rate</span><span className={`font-semibold ${N(data.rejections?.rework_rate) > 10 ? 'text-rose-600' : 'text-slate-700'}`}>{N(data.rejections?.rework_rate)}%</span></div>
                  <div className="flex justify-between text-xs"><span className="text-slate-500">Rejected This Week</span><span className="font-semibold text-slate-700">{N(data.rejections?.rejected_week)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-slate-500">Rejected This Month</span><span className="font-semibold text-slate-700">{N(data.rejections?.rejected_month)}</span></div>
                  <div className="flex justify-between text-xs"><span className="text-slate-500">Currently In Rejection</span><span className={`font-semibold ${N(data.rejections?.active_rejections) > 0 ? 'text-amber-600' : 'text-slate-600'}`}>{N(data.rejections?.active_rejections)}</span></div>
                </div>
              </div>
            </div>
          </Safe>

          {/* BACKLOG AGING + UTILIZATION + CAPACITY */}
          <Safe id="Operational">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="h-4 w-4 text-amber-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Backlog Aging</h3>
                </div>
                <div className="space-y-3">
                  {[
                    { label: '< 24 hours', value: N(data.backlog_aging?.age_0_24h), color: 'bg-green-500', tc: 'text-green-700' },
                    { label: '1-3 days', value: N(data.backlog_aging?.age_1_3d), color: 'bg-amber-500', tc: 'text-amber-700' },
                    { label: '3-7 days', value: N(data.backlog_aging?.age_3_7d), color: 'bg-orange-500', tc: 'text-orange-700' },
                    { label: '7+ days', value: N(data.backlog_aging?.age_7_plus), color: 'bg-rose-500', tc: 'text-rose-700' },
                  ].map(b => {
                    const total = N(data.backlog_aging?.age_0_24h) + N(data.backlog_aging?.age_1_3d) + N(data.backlog_aging?.age_3_7d) + N(data.backlog_aging?.age_7_plus);
                    const pct = total > 0 ? (b.value / total) * 100 : 0;
                    return (<div key={b.label}><div className="flex justify-between text-xs mb-1"><span className="text-slate-600">{b.label}</span><span className={`font-semibold ${b.tc}`}>{b.value}</span></div><div className="w-full bg-slate-100 rounded-full h-2"><div className={`${b.color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} /></div></div>);
                  })}
                </div>
              </div>

              <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Gauge className="h-4 w-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Staff Utilization</h3>
                </div>
                <div className="text-center mb-4">
                  <div className={`text-3xl font-bold ${N(data.utilization?.utilization_rate) >= 70 ? 'text-brand-700' : N(data.utilization?.utilization_rate) >= 40 ? 'text-amber-700' : 'text-rose-700'}`}>
                    {N(data.utilization?.utilization_rate)}%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">of available staff with active work</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-brand-50 rounded-lg p-3 text-center"><div className="text-xl font-bold text-brand-700">{N(data.utilization?.staff_with_wip)}</div><div className="text-[10px] text-brand-600">Working</div></div>
                  <div className="bg-slate-50 rounded-lg p-3 text-center"><div className="text-xl font-bold text-slate-700">{N(data.utilization?.total_available) - N(data.utilization?.staff_with_wip)}</div><div className="text-[10px] text-slate-500">Idle</div></div>
                </div>
              </div>

              <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="h-4 w-4 text-violet-600" />
                  <h3 className="text-sm font-semibold text-slate-900">Capacity vs Demand</h3>
                </div>
                <div className="text-center mb-4">
                  <div className={`text-3xl font-bold ${N(data.capacity_demand?.capacity_ratio) > 100 ? 'text-rose-700' : 'text-brand-700'}`}>
                    {N(data.capacity_demand?.capacity_ratio)}%
                  </div>
                  <div className="text-xs text-slate-500 mt-1">{N(data.capacity_demand?.capacity_ratio) > 100 ? 'Demand exceeds capacity!' : 'Within capacity'}</div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs"><span className="text-slate-500">Daily Capacity</span><span className="font-semibold text-brand-700">{Fmt(N(data.capacity_demand?.daily_capacity))} orders</span></div>
                  <div className="flex justify-between text-xs"><span className="text-slate-500">Received Today</span><span className="font-semibold text-blue-700">{N(data.capacity_demand?.today_received)} orders</span></div>
                  <div className="w-full bg-slate-100 rounded-full h-3 mt-2"><div className={`h-3 rounded-full transition-all ${N(data.capacity_demand?.capacity_ratio) > 100 ? 'bg-rose-500' : 'bg-brand-500'}`} style={{ width: `${Math.min(N(data.capacity_demand?.capacity_ratio), 100)}%` }} /></div>
                </div>
              </div>
            </div>
          </Safe>

          {N(org.inactive_flagged) > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 flex items-center gap-3">
              <UserX className="h-5 w-5 text-amber-600 flex-shrink-0" />
              <div><span className="text-sm font-medium text-amber-800">{N(org.inactive_flagged)} staff flagged as inactive</span><span className="text-xs text-amber-600 ml-2">(15+ days without activity)</span></div>
            </div>
          )}

          {/* OVERTIME & PRODUCTIVITY */}
          <Safe id="Overtime">
            <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <div><h3 className="text-sm font-semibold text-slate-900 mb-1">Overtime &amp; Productivity Analysis</h3><p className="text-xs text-slate-500">{N(org.standard_shift_hours) || 9}-hour standard shift</p></div>
                <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-slate-400" /><span className="text-xs text-slate-500">Updated live</span></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-brand-50 rounded-xl p-4 ring-1 ring-brand-100"><div className="flex items-center gap-2 mb-2"><Target className="h-4 w-4 text-brand-600" /><span className="text-xs font-medium text-brand-700">Target Hit Rate</span></div><div className="text-2xl font-bold text-brand-700">{N(org.target_hit_rate)}%</div><div className="text-xs text-brand-600 mt-1">{N(org.staff_achieved_target)} of {N(org.staff_with_targets)} staff</div></div>
                <div className="bg-amber-50 rounded-xl p-4 ring-1 ring-amber-100"><div className="flex items-center gap-2 mb-2"><Clock className="h-4 w-4 text-amber-600" /><span className="text-xs font-medium text-amber-700">Overtime Workers</span></div><div className="text-2xl font-bold text-amber-700">{N(org.staff_with_overtime)}</div><div className="text-xs text-amber-600 mt-1">Exceeding 120% of target</div></div>
                <div className="bg-rose-50 rounded-xl p-4 ring-1 ring-rose-100"><div className="flex items-center gap-2 mb-2"><AlertTriangle className="h-4 w-4 text-rose-600" /><span className="text-xs font-medium text-rose-700">Under Target</span></div><div className="text-2xl font-bold text-rose-700">{N(org.staff_under_target)}</div><div className="text-xs text-rose-600 mt-1">Below 80% of target</div></div>
                <div className="bg-blue-50 rounded-xl p-4 ring-1 ring-blue-100"><div className="flex items-center gap-2 mb-2"><Activity className="h-4 w-4 text-blue-600" /><span className="text-xs font-medium text-blue-700">Shift Duration</span></div><div className="text-2xl font-bold text-blue-700">{N(org.standard_shift_hours) || 9}h</div><div className="text-xs text-blue-600 mt-1">Standard working hours</div></div>
              </div>
            </div>
          </Safe>

          {/* CHARTS + 7-DAY TREND */}
          <Safe id="Charts"><ChartsSection data={data} /></Safe>

          {/* COUNTRY COMPARISON */}
          <Safe id="CountryCompare">
            {Array.isArray(data.country_comparison) && data.country_comparison.length > 0 && (
              <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
                <h3 className="text-sm font-semibold text-slate-900 mb-4">Country Performance Comparison</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {data.country_comparison.map((c) => (
                    <div key={S(c.country)} className="bg-slate-50 rounded-xl p-4">
                      <div className="text-sm font-semibold text-slate-900 mb-3">{S(c.country)}</div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs"><span className="text-slate-500">Efficiency</span><span className={`font-bold ${N(c.efficiency) >= 80 ? 'text-brand-600' : N(c.efficiency) >= 50 ? 'text-amber-600' : 'text-rose-600'}`}>{N(c.efficiency)}%</span></div>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">Staff Utilization</span><span className="font-semibold text-blue-600">{N(c.staff_utilization)}%</span></div>
                        <div className="flex justify-between text-xs"><span className="text-slate-500">Pending/Staff</span><span className={`font-semibold ${N(c.pending_per_staff) > 5 ? 'text-rose-600' : 'text-slate-700'}`}>{N(c.pending_per_staff)}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Safe>

          {/* TOP / BOTTOM PERFORMERS */}
          <Safe id="Performers">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {Array.isArray(data.top_performers) && data.top_performers.length > 0 && (
                <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                  <div className="flex items-center gap-2 mb-4"><Award className="h-4 w-4 text-brand-600" /><h3 className="text-sm font-semibold text-slate-900">Top Performers Today</h3></div>
                  <div className="space-y-2">
                    {data.top_performers.map((p, i) => (
                      <div key={N(p.id)} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50">
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i === 0 ? 'bg-yellow-100 text-yellow-700' : i === 1 ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-700'}`}>{i + 1}</span>
                          <div><div className="text-sm font-medium text-slate-900">{S(p.name)}</div><div className="text-[10px] text-slate-400 capitalize">{S(p.role)}</div></div>
                        </div>
                        <div className="text-right"><div className="text-sm font-bold text-brand-600">{N(p.completed)}</div><div className="text-[10px] text-slate-400">{N(p.avg_minutes)}m avg</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Array.isArray(data.bottom_performers) && data.bottom_performers.length > 0 && (
                <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
                  <div className="flex items-center gap-2 mb-4"><TrendingDown className="h-4 w-4 text-rose-500" /><h3 className="text-sm font-semibold text-slate-900">Needs Attention Today</h3></div>
                  <div className="space-y-2">
                    {data.bottom_performers.map((p, i) => (
                      <div key={N(p.id)} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50">
                        <div className="flex items-center gap-3">
                          <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-rose-100 text-rose-600">{i + 1}</span>
                          <div><div className="text-sm font-medium text-slate-900">{S(p.name)}</div><div className="text-[10px] text-slate-400 capitalize">{S(p.role)}</div></div>
                        </div>
                        <div className="text-right"><div className="text-sm font-bold text-rose-600">{N(p.completed)}</div><div className="text-[10px] text-slate-400">{N(p.avg_minutes)}m avg</div></div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Safe>

          {/* PERIOD SUMMARY */}
          <Safe id="PeriodSummary">
            <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
              <h3 className="text-sm font-semibold text-slate-900 mb-5">Period Summary</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div><div className="text-xs text-slate-500 mb-1">This Week Received</div><div className="text-xl font-bold text-slate-900">{N(org.orders_received_week)}</div></div>
                <div><div className="text-xs text-slate-500 mb-1">This Week Delivered</div><div className="text-xl font-bold text-brand-600">{N(org.orders_delivered_week)}</div></div>
                <div><div className="text-xs text-slate-500 mb-1">This Month Received</div><div className="text-xl font-bold text-slate-900">{N(org.orders_received_month)}</div></div>
                <div><div className="text-xs text-slate-500 mb-1">This Month Delivered</div><div className="text-xl font-bold text-brand-600">{N(org.orders_delivered_month)}</div></div>
              </div>
            </div>
          </Safe>

          {/* TEAM-WISE OUTPUT */}
          <Safe id="Teams">
            {Array.isArray(data.teams) && data.teams.length > 0 && (
              <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
                <div className="flex items-center justify-between mb-4"><div><h3 className="text-sm font-semibold text-slate-900 mb-1">Team-wise Output</h3><p className="text-xs text-slate-500">Performance by team &middot; Today</p></div><UsersRound className="h-4 w-4 text-slate-400" /></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 font-medium text-slate-600">Team</th>
                      <th className="text-left py-2 px-3 font-medium text-slate-600">Project</th>
                      <th className="text-left py-2 px-3 font-medium text-slate-600">Country</th>
                      <th className="text-center py-2 px-3 font-medium text-slate-600">Staff</th>
                      <th className="text-center py-2 px-3 font-medium text-slate-600">Active</th>
                      <th className="text-center py-2 px-3 font-medium text-slate-600">Delivered</th>
                      <th className="text-center py-2 px-3 font-medium text-slate-600">Pending</th>
                      <th className="text-center py-2 px-3 font-medium text-slate-600">Efficiency</th>
                    </tr></thead>
                    <tbody>
                      {data.teams.slice(0, showAllTeams ? data.teams.length : 10).map((team) => (
                        <tr key={S(team.id)} className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="py-2.5 px-3 font-medium text-slate-900">{S(team.name)}</td>
                          <td className="py-2.5 px-3"><span className="font-medium text-slate-700">{S(team.project_code)}</span><span className="text-xs text-slate-400 ml-1">{S(team.project_name)}</span></td>
                          <td className="py-2.5 px-3 text-slate-600">{S(team.country)}</td>
                          <td className="py-2.5 px-3 text-center text-slate-600">{N(team.staff_count)}</td>
                          <td className="py-2.5 px-3 text-center"><span className={N(team.active_staff) === N(team.staff_count) ? 'text-brand-600 font-medium' : 'text-amber-600'}>{N(team.active_staff)}</span></td>
                          <td className="py-2.5 px-3 text-center"><span className="font-semibold text-brand-600">{N(team.delivered_today)}</span></td>
                          <td className="py-2.5 px-3 text-center"><span className={N(team.pending) > 10 ? 'text-amber-600 font-medium' : 'text-slate-600'}>{N(team.pending)}</span></td>
                          <td className="py-2.5 px-3 text-center"><span className={`px-2 py-0.5 rounded text-xs font-medium ${N(team.efficiency) >= 3 ? 'bg-brand-50 text-brand-700' : N(team.efficiency) >= 1 ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{N(team.efficiency)}/staff</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.teams.length > 10 && (<div className="text-center mt-3"><button onClick={() => setShowAllTeams(!showAllTeams)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">{showAllTeams ? 'Show top 10 only' : `Show all ${data.teams.length} teams`}</button></div>)}
                </div>
              </div>
            )}
          </Safe>

          {/* COUNTRY BREAKDOWN */}
          <Safe id="Countries">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Country Breakdown</h3>
              <div className="space-y-2">
                {(Array.isArray(data.countries) ? data.countries : []).map((country) => (
                  <div key={S(country.country)} className="bg-white rounded-xl ring-1 ring-black/[0.04] overflow-hidden">
                    <button onClick={() => setExpandedCountry(expandedCountry === country.country ? null : country.country)} className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-all duration-150 text-left group">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-teal-50 flex items-center justify-center"><Globe className="h-4 w-4 text-teal-600" strokeWidth={2} /></div>
                        <div><div className="text-sm font-semibold text-slate-900">{S(country.country)}</div><div className="text-xs text-slate-500">{N(country.project_count)} projects &middot; {N(country.active_staff)}/{N(country.total_staff)} staff</div></div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="hidden sm:flex items-center gap-3 text-xs">
                          <span className="text-blue-600 font-medium">{N(country.received_today)} in</span>
                          <span className="text-brand-600 font-medium">{N(country.delivered_today)} out</span>
                          {N(country.total_pending) > 0 && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded font-medium ring-1 ring-amber-200">{N(country.total_pending)} pending</span>}
                        </div>
                        {expandedCountry === country.country ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                      </div>
                    </button>
                    {expandedCountry === country.country && (
                      <div className="border-t border-slate-100 px-4 pb-4">
                        {(Array.isArray(country.departments) ? country.departments : []).map((dept) => (
                          <div key={S(dept.department)} className="mt-3">
                            <button onClick={() => setExpandedDept(expandedDept === `${country.country}-${dept.department}` ? null : `${country.country}-${dept.department}`)} className="w-full flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 transition-all duration-150 group">
                              <div className="flex items-center gap-2">
                                <Layers className="h-4 w-4 text-slate-400" strokeWidth={2} />
                                <span className="text-sm font-medium text-slate-700">{S(dept.department) === 'floor_plan' ? 'Floor Plan' : 'Photos Enhancement'}</span>
                                <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{N(dept.project_count)} projects</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs">
                                {N(dept.sla_breaches) > 0 && <span className="text-rose-600 font-medium flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />{N(dept.sla_breaches)} SLA</span>}
                                <span className="text-slate-600 font-medium">{N(dept.pending)} pending</span>
                                {expandedDept === `${country.country}-${dept.department}` ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                              </div>
                            </button>
                            {expandedDept === `${country.country}-${dept.department}` && (
                              <div className="ml-6 mt-2 space-y-1.5">
                                {(Array.isArray(dept.projects) ? dept.projects : []).map((proj) => (
                                  <div key={S(proj.id)} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-50 ring-1 ring-slate-100 text-xs hover:ring-slate-200 transition-all duration-150">
                                    <div><span className="font-semibold text-slate-900">{S(proj.code)}</span><span className="text-slate-500 ml-2">{S(proj.name)}</span></div>
                                    <div className="flex items-center gap-4 text-xs">
                                      <span className="text-amber-600 font-medium">{N(proj.pending)} pending</span>
                                      <span className="text-brand-600 font-medium">{N(proj.delivered_today)} delivered</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </Safe>
        </>
      )}
    </AnimatedPage>
  );
}

/* Charts component */
function ChartsSection({ data }: { data: MasterDashboard }) {
  const [chartsLib, setChartsLib] = useState<any>(null);
  useEffect(() => { import('recharts').then(mod => setChartsLib(mod)).catch(() => setChartsLib(null)); }, []);

  const countryChartData = useMemo(() => (Array.isArray(data?.countries) ? data.countries : []).map((c) => ({ name: S(c.country), received: N(c.received_today), delivered: N(c.delivered_today), pending: N(c.total_pending), staff: N(c.active_staff) })), [data]);
  const pendingByCountry = useMemo(() => (Array.isArray(data?.countries) ? data.countries : []).map((c, i) => ({ name: S(c.country), value: N(c.total_pending), fill: COLORS[i % COLORS.length] })).filter(c => c.value > 0), [data]);
  const trend7d = useMemo(() => Array.isArray(data?.trend_7d) ? data.trend_7d : [], [data]);

  if (!chartsLib) return <div className="text-center py-8 text-slate-400 text-sm">Loading charts...</div>;
  const { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip: ReTooltip, PieChart, Pie, Cell, LineChart, Line, Legend } = chartsLib;

  return (
    <>
      {trend7d.length > 0 && (
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
          <div className="mb-4"><h3 className="text-sm font-semibold text-slate-900 mb-1">7-Day Trend</h3><p className="text-xs text-slate-500">Received vs delivered vs rejected &mdash; last 7 days</p></div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend7d}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f4" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 13, fill: '#78716c', fontWeight: 500 }} axisLine={false} tickLine={false} dy={10} />
              <YAxis tick={{ fontSize: 13, fill: '#78716c' }} axisLine={false} tickLine={false} dx={-10} />
              <ReTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e7e5e4', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: '12px' }} />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Line type="monotone" dataKey="received" name="Received" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="delivered" name="Delivered" stroke="#2AA7A0" strokeWidth={2.5} dot={{ r: 4 }} />
              <Line type="monotone" dataKey="rejected" name="Rejected" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3 bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
          <div className="mb-4"><h3 className="text-sm font-semibold text-slate-900 mb-1">Orders by Country</h3><p className="text-xs text-slate-500">Pending vs delivered breakdown</p></div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={countryChartData} barCategoryGap="35%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f4" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 13, fill: '#78716c', fontWeight: 500 }} axisLine={false} tickLine={false} dy={10} />
              <YAxis tick={{ fontSize: 13, fill: '#78716c' }} axisLine={false} tickLine={false} dx={-10} />
              <ReTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e7e5e4', fontSize: '13px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', padding: '12px' }} cursor={{ fill: '#fafaf9', radius: 8 }} />
              <Bar dataKey="pending" name="Pending" fill="#C45C26" radius={[4, 4, 0, 0]} />
              <Bar dataKey="delivered" name="Delivered" fill="#2AA7A0" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="lg:col-span-2 bg-white rounded-xl ring-1 ring-black/[0.04] p-5">
          <div className="mb-4"><h3 className="text-sm font-semibold text-slate-900 mb-1">Pending Distribution</h3><p className="text-xs text-slate-500">By country</p></div>
          {pendingByCountry.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart><Pie data={pendingByCountry} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" strokeWidth={2} stroke="#fff">{pendingByCountry.map((_e: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><ReTooltip contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '13px' }} /></PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 justify-center mt-3">{pendingByCountry.map((c, i) => <div key={i} className="flex items-center gap-2 text-xs text-slate-600"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c.fill }} /><span className="font-medium">{S(c.name)}:</span> {N(c.value)}</div>)}</div>
            </>
          ) : <div className="flex items-center justify-center h-48 text-sm text-slate-400">No pending orders</div>}
        </div>
      </div>
    </>
  );
}
