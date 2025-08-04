/**
 * Wager Polling Hook - Phase 1 Deliverable
 * Event-scoped polling for wager updates with cursor pagination
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { prophetXAPI, WagerHistory } from '@/services/prophetx-api';

interface UseWagerPollingOptions {
  eventId?: string;
  marketId?: string;
  enabled?: boolean;
  pollInterval?: number; // milliseconds
  maxRetries?: number;
}

interface WagerPollingState {
  wagers: WagerHistory[];
  isLoading: boolean;
  error: string | null;
  lastSyncedAt: string | null;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => void;
}

export function useWagerPolling(options: UseWagerPollingOptions = {}): WagerPollingState {
  const {
    eventId,
    marketId,
    enabled = true,
    pollInterval = 10000, // 10 seconds
    maxRetries = 3
  } = options;

  const [wagers, setWagers] = useState<WagerHistory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);

  const intervalRef = useRef<NodeJS.Timeout>();
  const retryCountRef = useRef(0);

  const fetchWagers = useCallback(async (cursor?: string, append = false) => {
    if (!enabled) return;

    if (!append) {
      setIsLoading(true);
    }
    setError(null);

    try {
      // ProphetX API requires date range - default to last 7 days
      const now = Math.floor(Date.now() / 1000);
      const sevenDaysAgo = now - (7 * 24 * 60 * 60);
      
      const params: any = {
        limit: 50,
        next_cursor: cursor,
        from: sevenDaysAgo,
        to: now
      };

      if (eventId) params.event_id = eventId;
      if (marketId) params.market_id = marketId;

      const result = await prophetXAPI.getMyWagers(params);

      if (append) {
        setWagers(prev => [...prev, ...result.wagers]);
      } else {
        setWagers(result.wagers);
      }

      setNextCursor(result.next_cursor);
      setHasMore(!!result.next_cursor);
      setLastSyncedAt(result.last_synced_at);
      retryCountRef.current = 0; // Reset retry count on success

      console.log(`📊 Fetched ${result.wagers.length} wagers${eventId ? ` for event ${eventId}` : ''}`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch wagers';
      setError(errorMessage);
      console.error('❌ Wager polling error:', err);

      // Exponential backoff retry
      retryCountRef.current++;
      if (retryCountRef.current < maxRetries) {
        const retryDelay = Math.pow(2, retryCountRef.current) * 1000;
        console.log(`⏳ Retrying in ${retryDelay}ms... (${retryCountRef.current}/${maxRetries})`);
        setTimeout(() => fetchWagers(cursor, append), retryDelay);
      }
    } finally {
      if (!append) {
        setIsLoading(false);
      }
    }
  }, [enabled, eventId, marketId, maxRetries]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !nextCursor || isLoading) return;
    await fetchWagers(nextCursor, true);
  }, [hasMore, nextCursor, isLoading, fetchWagers]);

  const refresh = useCallback(async () => {
    setNextCursor(undefined);
    setHasMore(true);
    await fetchWagers();
  }, [fetchWagers]);

  const clear = useCallback(() => {
    setWagers([]);
    setError(null);
    setLastSyncedAt(null);
    setNextCursor(undefined);
    setHasMore(true);
    retryCountRef.current = 0;
  }, []);

  // Start/stop polling
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
      return;
    }

    // Initial fetch
    fetchWagers();

    // Setup polling
    intervalRef.current = setInterval(() => {
      fetchWagers();
    }, pollInterval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = undefined;
      }
    };
  }, [enabled, pollInterval, fetchWagers]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return {
    wagers,
    isLoading,
    error,
    lastSyncedAt,
    hasMore,
    loadMore,
    refresh,
    clear
  };
}