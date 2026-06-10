import { useEffect, useRef, useCallback } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store/store';
import { workflowService } from '../services';

const DEFAULT_INTERVAL = 30_000; // 30 seconds
const ERROR_BACKOFF_MULTIPLIER = 2;
const MAX_INTERVAL = 60_000; // Max 60s on repeated errors
const MAX_CONSECUTIVE_ERRORS = 5;

interface SmartPollingOptions {
  /** Project IDs to monitor. Empty = auto-detect from user role */
  projectIds?: number[];
  /** What to check: 'orders' | 'users' | 'all' */
  scope?: 'orders' | 'users' | 'all';
  /** Polling interval in ms (default 10s) */
  interval?: number;
  /** Callback fired when data has changed */
  onDataChanged: () => void;
  /** Whether polling is enabled (default true) */
  enabled?: boolean;
}

/**
 * Smart Polling hook — polls a lightweight endpoint every N seconds.
 * Only triggers a full data reload when the backend hash changes,
 * meaning data has actually been modified.
 *
 * Features:
 * - Page Visibility API: pauses when tab is hidden
 * - Error backoff: doubles interval on consecutive errors
 * - Auto-recovery: resets interval on success
 * - Lightweight: single hash comparison per poll (~1ms server time)
 */
export function useSmartPolling({
  projectIds = [],
  scope = 'orders',
  interval = DEFAULT_INTERVAL,
  onDataChanged,
  enabled = true,
}: SmartPollingOptions) {
  const isAuthenticated = useSelector((s: RootState) => !!s.auth.token);
  const hashRef = useRef<string>('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorCountRef = useRef(0);
  const currentIntervalRef = useRef(interval);
  const isVisibleRef = useRef(!document.hidden);
  const isPollingRef = useRef(false);
  const onDataChangedRef = useRef(onDataChanged);

  // Keep callback ref up to date without re-creating interval
  useEffect(() => {
    onDataChangedRef.current = onDataChanged;
  }, [onDataChanged]);

  const poll = useCallback(async () => {
    // Skip if tab hidden or not authenticated
    if (!isVisibleRef.current || !isAuthenticated || isPollingRef.current) return;

    isPollingRef.current = true;

    try {
      const { data } = await workflowService.checkUpdates({
        project_ids: projectIds.length > 0 ? projectIds : undefined,
        scope,
        last_hash: hashRef.current,
      });

      // Reset error state on success
      if (errorCountRef.current > 0) {
        errorCountRef.current = 0;
        currentIntervalRef.current = interval;
        // Restart with normal interval
        restartInterval();
      }

      if (data.changed && hashRef.current !== '') {
        // Data has changed — trigger reload
        onDataChangedRef.current();
      }

      // Always store latest hash
      hashRef.current = data.hash;
    } catch {
      errorCountRef.current += 1;
      if (errorCountRef.current >= MAX_CONSECUTIVE_ERRORS) {
        // Stop polling after too many failures
        stopInterval();
        console.warn('[SmartPolling] Stopped after repeated failures');
        return;
      }
      // Backoff
      currentIntervalRef.current = Math.min(
        interval * Math.pow(ERROR_BACKOFF_MULTIPLIER, errorCountRef.current),
        MAX_INTERVAL
      );
      restartInterval();
    } finally {
      isPollingRef.current = false;
    }
  }, [isAuthenticated, projectIds.join(','), scope, interval]);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const restartInterval = useCallback(() => {
    stopInterval();
    intervalRef.current = setInterval(poll, currentIntervalRef.current);
  }, [poll, stopInterval]);

  useEffect(() => {
    if (!enabled || !isAuthenticated) {
      stopInterval();
      hashRef.current = '';
      errorCountRef.current = 0;
      return;
    }

    // Reset hash when dependencies change (so first poll doesn't trigger false change)
    hashRef.current = '';
    currentIntervalRef.current = interval;

    // Initial poll (gets baseline hash)
    poll();

    // Start interval
    intervalRef.current = setInterval(poll, interval);

    // Page Visibility handling — pause when hidden, resume when visible
    const handleVisibility = () => {
      isVisibleRef.current = !document.hidden;
      if (document.hidden) {
        stopInterval();
      } else {
        // Immediate poll on tab focus, then restart interval
        poll();
        intervalRef.current = setInterval(poll, currentIntervalRef.current);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [enabled, isAuthenticated, poll, interval, stopInterval]);

  // Manual trigger to force a poll (e.g., after user makes a change)
  const forcePoll = useCallback(() => {
    hashRef.current = ''; // Reset so next poll always captures fresh hash
    poll();
  }, [poll]);

  return { forcePoll };
}
