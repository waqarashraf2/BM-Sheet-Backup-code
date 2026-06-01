import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store/store';
import { logout } from '../../store/slices/authSlice';
import { resetNotifications } from '../../store/slices/notificationSlice';
import { authService } from '../../services';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, FolderKanban, Users, Receipt, ClipboardList,
  Upload, AlertTriangle, UserPlus, ChevronsLeft, ChevronsRight,
  Command, LogOut, UserCheck, UsersRound, Briefcase, Shield, ScrollText,
  ShieldCheck, BarChart3, ShieldAlert,
} from 'lucide-react';
import BenchmarkLogo from '../ui/BenchmarkLogo';

const NAV = [

  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['ceo', 'director', 'operations_manager', 'project_manager', 'drawer', 'checker', 'filler', 'qa', 'designer', 'accounts_manager', 'live_qa'] },
  { name: 'Projects', href: '/projects', icon: FolderKanban, roles: ['ceo', 'director', 'operations_manager', 'project_manager'] },
  { name: 'Users', href: '/users', icon: Users, roles: ['director', 'operations_manager', 'project_manager'] },
  { name: 'Invoices', href: '/invoices', icon: Receipt, roles: ['ceo', 'director', 'accounts_manager'] },
  { name: 'Monthly Quantities', href: '/monthly-quantities', icon: BarChart3, roles: ['operations_manager', 'ceo', 'director'] },
  { name: 'Import Orders', href: '/import', icon: Upload, roles: ['director', 'operations_manager', 'project_manager', 'qa'] },
  { name: 'OM Assignments', href: '/om-projects', icon: Shield, roles: ['director'] },
  { name: 'PM Assignments', href: '/pm-projects', icon: Briefcase, roles: ['operations_manager'] },
  { name: 'Operational Log', href: '/transfer-log', icon: ScrollText, roles: ['ceo', 'director', 'operations_manager'] },
  { name: 'Assign to QA', href: '/pm-assign', icon: UserCheck, roles: ['director'] },
  { name: 'My Team', href: '/qa-team', icon: UsersRound, roles: ['qa'] },
  { name: 'My Team', href: '/checker-team', icon: UsersRound, roles: ['checker'] },
  { name: 'Assignments', href: '/assign', icon: UserPlus, roles: ['director', 'operations_manager', 'project_manager', 'qa'] },
  { name: 'Live QA', href: '/live-qa', icon: ShieldCheck, roles: ['live_qa', 'director', 'ceo', 'checker', 'qa'] },
  { name: 'Internal QA', href: '/internal-qa', icon: ShieldAlert, roles: ['live_qa', 'ceo', 'director', 'operations_manager'] },
  { name: 'Rejected', href: '/rejected', icon: AlertTriangle, roles: ['director', 'operations_manager', 'project_manager', 'drawer', 'checker', 'filler', 'qa', 'designer'] },
  { name: 'Work Queue', href: '/work', icon: ClipboardList, roles: ['drawer', 'checker', 'filler', 'qa', 'designer'] },
  { name: 'Batch Status', href: '/batch-status', icon: ClipboardList, roles: ['operations_manager', 'project_manager'] },
  { name: 'Column Assignment', href: '/dashboard/assignment-columns', icon: FolderKanban, roles: ['director'] },
];

export default function Sidebar() {
  const location = useLocation();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);
  const [collapsed, setCollapsed] = useState(false);
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes('mac'));
  }, []);

  const handleLogout = async () => {
    try {
      await authService.logout();
    } catch { /* ignore */ }
    dispatch(resetNotifications());
    dispatch(logout());
    navigate('/login');
  };


  const items = NAV.filter((item) => {
    if (!user?.role || !item.roles.includes(user.role)) {
      return false;
    }

    if (item.href === '/live-qa' && (user.role === 'checker' || user.role === 'qa')) {
      return Number(user.project_id) === 16;
    }

    return true;
  });

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 256 }}
      transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
      className="h-screen bg-white flex flex-col shrink-0 relative z-20 shadow-[1px_0_0_0_rgba(0,0,0,0.04),4px_0_16px_-4px_rgba(0,0,0,0.04)]"
    >
      {/* Logo */}
      <div className={`h-16 flex items-center ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
        <div className="flex items-center gap-3 min-w-0">
          <BenchmarkLogo size="sm" />
          <AnimatePresence>
            {!collapsed && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.15 }}
                className="min-w-0"
              >
                <span className="text-[15px] font-bold tracking-tight text-teal-600">
                  BENCHMARK
                </span>
                <span className="block text-[10px] text-slate-400 font-medium -mt-0.5">
                  Enterprise Suite
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Quick Search Hint */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-3 pt-3"
          >
            <button className="w-full flex items-center gap-3 px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-700 transition-colors group">
              <Command className="w-4 h-4" />
              <span className="text-[13px]">Quick actions...</span>
              <kbd className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-tertiary text-ink-tertiary group-hover:bg-white">
                {isMac ? '⌘' : 'Ctrl'}K
              </kbd>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Nav */}
      <nav className={`flex-1 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden custom-scrollbar ${collapsed ? 'px-2' : 'px-3'}`}>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="px-3 mb-2"
            >
              <span className="text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider">
                Navigation
              </span>
            </motion.div>
          )}

        </AnimatePresence>

        {items.map((item, index) => {
          const active = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <motion.div
              key={item.name}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.02 }}
            >
              <Link
                to={item.href}
                title={collapsed ? item.name : undefined}
                className={`
                  group flex items-center gap-3 rounded-lg transition-all duration-150 relative
                  ${collapsed ? 'justify-center p-2.5' : 'px-3 py-2'}
                  ${active
                    ? 'bg-brand-primary text-white shadow-sm'
                    : 'text-ink-secondary hover:text-ink-primary hover:bg-surface-secondary'
                  }
                `}
              >
                {/* Active indicator */}
                {active && !collapsed && (
                  <motion.div
                    layoutId="activeNav"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-white rounded-r-full"
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                )}

                <Icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${active ? 'text-white' : 'text-ink-tertiary group-hover:text-ink-secondary'
                  }`} />

                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-[13px] font-medium whitespace-nowrap"
                    >
                      {item.name}
                    </motion.span>
                  )}
                </AnimatePresence>

                {/* Hover indicator for collapsed */}
                {collapsed && !active && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-ink-primary text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 shadow-lg">
                    {item.name}
                  </div>
                )}
              </Link>
            </motion.div>
          );
        })}
      </nav>

      {/* User + Actions */}
      <div className={`mt-auto pt-3 ${collapsed ? 'p-2' : 'p-3'}`}>
        {/* User Card */}
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-3 px-2 py-2.5 mb-2 rounded-lg hover:bg-surface-secondary transition-colors group"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-hover flex items-center justify-center text-white text-xs font-bold shrink-0 ring-2 ring-brand-primary/20">
                {user?.name?.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-ink-primary truncate">{user?.name}</p>
                <p className="text-[11px] text-ink-tertiary truncate capitalize">{user?.role?.replace('_', ' ')}</p>
              </div>
              <div className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
                <button
                  onClick={handleLogout}
                  className="p-1.5 rounded-md text-ink-tertiary hover:text-ink-secondary hover:bg-surface-tertiary opacity-0 group-hover:opacity-100 transition-all"
                  title="Sign out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Collapsed User Avatar */}
        {collapsed && (
          <div className="flex justify-center mb-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-hover flex items-center justify-center text-white text-xs font-bold ring-2 ring-brand-primary/20">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
          </div>
        )}

        {/* Collapse Toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center gap-2 py-2 text-ink-tertiary hover:text-ink-secondary hover:bg-surface-secondary rounded-lg transition-colors"
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          <AnimatePresence>
            {!collapsed && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs font-medium"
              >
                Collapse
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </motion.aside>
  );
}
