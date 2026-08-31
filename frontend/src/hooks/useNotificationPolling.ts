import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../store/store';
import { fetchUnreadCount } from '../store/slices/notificationSlice';

const POLL_INTERVAL = 90_000; // 90 seconds
const MAX_CONSECUTIVE_ERRORS = 3;

export function useNotificationPolling() {
  const dispatch = useDispatch<AppDispatch>();
  const isAuthenticated = useSelector((s: RootState) => !!s.auth.token);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorCountRef = useRef(0);

  useEffect(() => {
    if (!isAuthenticated) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      errorCountRef.current = 0;
      return;
    }

    const poll = async () => {
      // Don't poll if document is not visible
      if (document.hidden) return;

      try {
        await dispatch(fetchUnreadCount()).unwrap();
        errorCountRef.current = 0; // Reset on success
      } catch {
        errorCountRef.current += 1;
        // Stop polling after repeated failures to prevent redirect loops
        if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS && intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };

    // Fetch immediately on mount
    poll();

    // Poll every 90s
    intervalRef.current = setInterval(poll, POLL_INTERVAL);

    // Resume immediately when user focuses back on tab
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        poll();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAuthenticated, dispatch]);
}
