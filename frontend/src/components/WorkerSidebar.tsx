import { useState } from 'react';
import { Users, Search, Clock, AlertTriangle } from 'lucide-react';
import type { User } from '../types';

interface WorkerSidebarProps {
  workers: User[];
  selectedWorker: number | null;
  onSelectWorker: (workerId: number | null) => void;
  loading?: boolean;
}

export default function WorkerSidebar({ workers, selectedWorker, onSelectWorker, loading }: WorkerSidebarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRole, setFilterRole] = useState<string>('all');

  const filteredWorkers = workers.filter(w => {
    const matchesSearch = !searchTerm || 
      w.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesRole = filterRole === 'all' || w.role === filterRole;
    return matchesSearch && matchesRole;
  });

  // Group workers by role
  const roles = ['drawer', 'checker', 'filler', 'qa', 'designer'];
  const workersByRole = roles.reduce((acc, role) => {
    acc[role] = filteredWorkers.filter(w => w.role === role);
    return acc;
  }, {} as Record<string, User[]>);

  // Stats
  const onlineCount = workers.filter(w => !w.is_absent && w.is_active).length;
  const absentCount = workers.filter(w => w.is_absent).length;
  const wipCount = workers.reduce((sum, w) => sum + (w.wip_count || 0), 0);
  const doneToday = workers.reduce((sum, w) => sum + (w.today_completed || 0), 0);

  if (loading) {
    return (
      <div className="bg-white rounded-xl ring-1 ring-black/[0.04] p-4 h-full">
        <div className="space-y-3">
          <div className="h-6 w-32 bg-slate-100 animate-pulse rounded" />
          <div className="h-10 bg-slate-100 animate-pulse rounded" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 bg-slate-100 animate-pulse rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl ring-1 ring-black/[0.04] h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <Users className="h-5 w-5 text-[#2AA7A0]" />
          <h3 className="font-semibold text-slate-900">Team Members</h3>
          <span className="ml-auto text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
            {workers.length}
          </span>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="text-center p-2 bg-green-50 rounded-lg">
            <div className="text-lg font-bold text-green-600">{onlineCount}</div>
            <div className="text-[10px] text-green-600">Online</div>
          </div>
          <div className="text-center p-2 bg-rose-50 rounded-lg">
            <div className="text-lg font-bold text-rose-600">{absentCount}</div>
            <div className="text-[10px] text-rose-600">Absent</div>
          </div>
          <div className="text-center p-2 bg-amber-50 rounded-lg">
            <div className="text-lg font-bold text-amber-600">{wipCount}</div>
            <div className="text-[10px] text-amber-600">WIP</div>
          </div>
          <div className="text-center p-2 bg-blue-50 rounded-lg">
            <div className="text-lg font-bold text-blue-600">{doneToday}</div>
            <div className="text-[10px] text-blue-600">Done</div>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search workers..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 bg-white text-slate-900 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2AA7A0]/20 focus:border-[#2AA7A0]"
          />
        </div>

        {/* Role Filter */}
        <div className="flex gap-1 mt-2 overflow-x-auto pb-1">
          <button
            onClick={() => setFilterRole('all')}
            className={`px-2 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
              filterRole === 'all' ? 'bg-[#2AA7A0] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All
          </button>
          {roles.map(role => (
            <button
              key={role}
              onClick={() => setFilterRole(role)}
              className={`px-2 py-1 text-xs rounded-md whitespace-nowrap capitalize transition-colors ${
                filterRole === role ? 'bg-[#2AA7A0] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {role}s ({workersByRole[role]?.length || 0})
            </button>
          ))}
        </div>
      </div>

      {/* Workers List */}
      <div className="flex-1 overflow-y-auto p-2">
        {filteredWorkers.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <Users className="h-8 w-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm">No workers found</p>
          </div>
        ) : (
          <div className="space-y-1">
            {filteredWorkers.map(worker => (
              <button
                key={worker.id}
                onClick={() => onSelectWorker(selectedWorker === worker.id ? null : worker.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg transition-all text-left ${
                  selectedWorker === worker.id
                    ? 'bg-[#2AA7A0]/10 border border-[#2AA7A0]/30'
                    : 'hover:bg-slate-50 border border-transparent'
                }`}
              >
                {/* Status Indicator */}
                <div className="relative flex-shrink-0">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold ${
                    worker.is_absent ? 'bg-slate-400' : 'bg-[#2AA7A0]'
                  }`}>
                    {worker.name.charAt(0).toUpperCase()}
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                    worker.is_absent ? 'bg-rose-500' : worker.is_online ? 'bg-green-500' : 'bg-amber-500'
                  }`} />
                </div>

                {/* Worker Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-medium text-sm truncate ${worker.is_absent ? 'text-slate-400' : 'text-slate-900'}`}>
                      {worker.name}
                    </span>
                    {worker.is_absent && (
                      <AlertTriangle className="h-3 w-3 text-rose-500 flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="capitalize">{worker.role}</span>
                    <span>·</span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      WIP: {worker.wip_count || 0}
                    </span>
                  </div>
                </div>

                {/* Stats */}
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-semibold text-brand-600">{worker.today_completed || 0}</div>
                  <div className="text-[10px] text-slate-400">done</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Clear Selection */}
      {selectedWorker && (
        <div className="p-3 border-t border-slate-100">
          <button
            onClick={() => onSelectWorker(null)}
            className="w-full py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors"
          >
            Clear Selection
          </button>
        </div>
      )}
    </div>
  );
}
