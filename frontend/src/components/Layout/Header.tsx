import { useState, useRef, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { logout } from '../../store/slices/authSlice';
import { resetNotifications } from '../../store/slices/notificationSlice';
import { authService } from '../../services';
import { LogOut, Search, Command, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import NotificationBell from '../Notifications/NotificationBell';
import { useNotificationPolling } from '../../hooks/useNotificationPolling';

const PAGES = [
  { name: 'Dashboard', path: '/dashboard', keywords: 'home overview stats' },
  { name: 'Projects', path: '/projects', keywords: 'project manage client' },
  { name: 'Users', path: '/users', keywords: 'user team member staff' },
  { name: 'Invoices', path: '/invoices', keywords: 'invoice billing payment' },
  { name: 'Work Queue', path: '/work', keywords: 'work queue order task' },
  { name: 'Import Orders', path: '/import', keywords: 'import csv upload' },
  { name: 'Assignments', path: '/assign', keywords: 'assign supervisor team' },
  { name: 'Rejected Orders', path: '/rejected', keywords: 'rejected rework quality', roles: ['director','operations_manager','drawer','checker','filler','qa','designer'] },
];

export default function Header() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Start polling for notifications
  useNotificationPolling();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === 'Escape') { setShowSearch(false); setQuery(''); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleLogout = async () => {
    try { await authService.logout(); } catch (_) {}
    finally { dispatch(resetNotifications()); dispatch(logout()); navigate('/login'); }
  };

  const filtered = query
    ? PAGES.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.keywords.includes(query.toLowerCase()))
    : PAGES;

  return (
    <>
      <header className="h-16 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-6 shrink-0 relative z-40">
        {/* Left — Breadcrumb / Search trigger */}
        <button
          onClick={() => { setShowSearch(true); setTimeout(() => inputRef.current?.focus(), 50); }}
          className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-400 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl transition-colors w-64"
        >
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="hidden sm:flex items-center gap-0.5 text-[11px] text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md">
            <Command className="h-3 w-3" />K
          </kbd>
        </button>

        {/* Right */}
        <div className="flex items-center gap-2">
          <NotificationBell />

          <div className="w-px h-6 bg-slate-200 mx-1" />

          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline font-medium">Sign out</span>
          </button>
        </div>
      </header>

      {/* Command palette */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[70] flex items-start justify-center pt-[15vh]"
          >
            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => { setShowSearch(false); setQuery(''); }} />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ duration: 0.15 }}
              className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 overflow-hidden"
            >
              <div className="flex items-center gap-3 px-4 border-b border-slate-100">
                <Search className="h-5 w-5 text-slate-400 shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search pages..."
                  className="flex-1 py-4 text-sm bg-transparent outline-none placeholder:text-slate-400"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && filtered.length > 0) {
                      navigate(filtered[0].path);
                      setShowSearch(false); setQuery('');
                    }
                  }}
                />
                <button onClick={() => { setShowSearch(false); setQuery(''); }} aria-label="Close search" className="p-1 text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto py-2">
                {filtered.map(p => (
                  <button
                    key={p.path}
                    onClick={() => { navigate(p.path); setShowSearch(false); setQuery(''); }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors text-left"
                  >
                    <span className="font-medium">{p.name}</span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="px-4 py-8 text-center text-sm text-slate-400">No results found.</div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
