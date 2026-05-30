import { useState, useEffect, useCallback } from 'react';
import { dashboardService } from '../../services';
import { useSmartPolling } from '../../hooks/useSmartPolling';
import type { MasterDashboard } from '../../types';
import { AnimatedPage, PageHeader, StatCard, AccountsDashboardSkeleton } from '../../components/ui';
import { DollarSign, Package, TrendingUp, Globe2, Building2, Calendar, ChevronRight, ChevronDown } from 'lucide-react';

export default function AccountsManagerDashboard() {
  const [data, setData] = useState<MasterDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCountry, setExpandedCountry] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await dashboardService.master();
      setData(res.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useSmartPolling({
    scope: 'all',
    interval: 45_000, // Changed from 10_000 to 45_000 (45 seconds)
    onDataChanged: loadData,
  });

  if (loading) return (
    <AnimatedPage>
      <AccountsDashboardSkeleton />
    </AnimatedPage>
  );

  if (!data) return <div className="text-center py-20 text-slate-500">Failed to load dashboard data.</div>;

  const org = data.org_totals;

  if (!org) return <div className="text-center py-20 text-slate-500">Failed to load dashboard data.</div>;

  return (
    <AnimatedPage>
      <div className="min-w-0">
        <PageHeader
          title="Accounts Dashboard"
          subtitle="Delivery tracking and billing overview"
          badge={
            <span className="flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 px-2.5 py-1 rounded-full">
              <DollarSign className="h-3.5 w-3.5" /> Accounts
            </span>
          }
        />

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Delivered (Month)" value={org.orders_delivered_month} icon={TrendingUp} color="green" />
          <StatCard label="Received (Month)" value={org.orders_received_month} icon={Package} color="blue" />
          <StatCard label="Received Today" value={org.orders_received_today} icon={Calendar} color="brand" />
          <StatCard label="Active Projects" value={org.total_projects} icon={Building2} color="slate" />
        </div>

        {/* Billing Summary */}
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-slate-400" /> Month-to-Date Summary
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-emerald-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-emerald-700">{org.orders_delivered_month}</div>
              <div className="text-xs text-emerald-600 mt-1">Total Delivered</div>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-blue-700">{org.orders_received_month}</div>
              <div className="text-xs text-blue-600 mt-1">Total Received</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-amber-700">
                {org.orders_received_month > 0 ? Math.min(100, Math.round((org.orders_delivered_month / org.orders_received_month) * 100)) : 0}%
              </div>
              <div className="text-xs text-amber-600 mt-1">Delivery Rate</div>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-slate-700">{org.total_pending}</div>
              <div className="text-xs text-slate-600 mt-1">Total Pending</div>
            </div>
          </div>
        </div>

        {/* Country Breakdown */}
        <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-5 mb-6">
          <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-slate-400" /> Delivery by Country
          </h3>
          <div className="space-y-3">
            {(data.countries || []).map((country) => {
              const isExpanded = expandedCountry === country.country;
              return (
                <div key={country.country} className="border border-slate-100 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setExpandedCountry(isExpanded ? null : country.country)}
                    className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-slate-100 rounded-lg">
                        <Globe2 className="h-4 w-4 text-slate-600" />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{country.country}</div>
                        <div className="text-xs text-slate-500">{country.project_count} projects · {country.total_staff} staff</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <div className="text-sm font-bold text-emerald-600">{country.delivered_today}</div>
                        <div className="text-[10px] text-slate-400">Delivered Today</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-blue-600">{country.received_today}</div>
                        <div className="text-[10px] text-slate-400">Received Today</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-amber-600">{country.total_pending}</div>
                        <div className="text-[10px] text-slate-400">Pending</div>
                      </div>
                      {isExpanded ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-slate-100">
                      {(country.departments || []).map((dept) => (
                        <div key={dept.department} className="mt-3">
                          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">{dept.department}</div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-slate-500">
                                  <th className="text-left py-1.5 pr-3">Project</th>
                                  <th className="text-center py-1.5 px-3">Delivered</th>
                                  <th className="text-center py-1.5 px-3">Pending</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(dept.projects || []).map((proj) => (
                                  <tr key={proj.id} className="border-t border-slate-50">
                                    <td className="py-2 pr-3">
                                      <span className="font-medium text-slate-700">{proj.code}</span>
                                      <span className="text-xs text-slate-400 ml-1.5">{proj.name}</span>
                                    </td>
                                    <td className="py-2 px-3 text-center font-medium text-emerald-600">{proj.delivered_today}</td>
                                    <td className="py-2 px-3 text-center font-medium text-amber-600">{proj.pending}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {dept.sla_breaches > 0 && (
                              <div className="mt-2 text-xs text-rose-600 font-medium">
                                {dept.sla_breaches} SLA breach{dept.sla_breaches !== 1 ? 'es' : ''} in this department
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Invoice-relevant note */}
        <div className="bg-blue-50 rounded-xl p-4 text-sm text-blue-700 flex items-start gap-3">
          <DollarSign className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Billing Reference</div>
            <p className="text-xs text-blue-600 mt-1">
              Use the Invoice Management page for detailed billing operations. This dashboard provides daily delivery tracking
              for cross-referencing with invoicing.
            </p>
          </div>
        </div>
      </div>
    </AnimatedPage>
  );
}
