import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils.ts';

import type { RealtimeConnectionStatus } from './realtime-types.ts';
import {
  useTournamentRealtime,
  type UseTournamentRealtimeOptions,
} from './use-tournament-realtime.ts';

/**
 * Tournament-scoped authoritative-refresh bus (Phase 8.5).
 *
 * The Phase 8.4 realtime hook turns the SSE stream into a "something changed"
 * signal. This module turns that signal into the only thing allowed to update
 * the UI: an invalidation of the REST query that owns the data.
 *
 * It is deliberately not a store. It holds no tournament state, never inspects
 * an event payload and never merges an event into a read model. An event and a
 * reconnect after a possible missed event both resolve to the same action -
 * "refetch REST" - so the REST response stays the single source of truth and the
 * client never needs to understand the domain event catalogue.
 */

/** Registers a query for refresh notifications; returns an unsubscribe. */
export type TournamentRefreshSubscribe = (listener: () => void) => () => void;

/**
 * The refresh bus alone. Kept in its own context so its identity is stable for
 * the life of the subscription: a connection-status change must never
 * re-subscribe every registered query.
 */
const RefreshBusContext = createContext<TournamentRefreshSubscribe>(() => () => undefined);

/** The live connection state, read only by the optional status indicator. */
const RealtimeStatusContext = createContext<RealtimeConnectionStatus | null>(null);

/**
 * How long a realtime burst is coalesced before the registered queries refetch.
 *
 * One user action can emit several events (recording a result emits
 * `MATCH_RESULT_RECORDED` + `MATCH_COMPLETED` and often `KNOCKOUT_MATCH_POPULATED`
 * in the same committed transaction, delivered as several SSE frames). Without
 * coalescing each frame would start its own REST request for the same data. This
 * window collapses that burst into one authoritative refetch. It is small enough
 * to be imperceptible and bounds latency to at most this delay even under a
 * sustained stream, because the timer is not reset by later events.
 */
export const DEFAULT_REFRESH_COALESCE_MS = 60;

export interface TournamentRealtimeProviderProps {
  readonly tournamentId: string;
  readonly children: ReactNode;
  /** Test seam; defaults to a native browser `EventSource`. */
  readonly eventSourceFactory?: UseTournamentRealtimeOptions['eventSourceFactory'];
  /** Coalescing window (ms); defaults to {@link DEFAULT_REFRESH_COALESCE_MS}. */
  readonly refreshCoalesceMs?: number;
}

/**
 * Provides one tournament's realtime refresh bus and connection state.
 *
 * This is the single `useTournamentRealtime` consumer for the whole tournament
 * subtree, so exactly one `EventSource` is opened per open tournament no matter
 * how many screens register a query. It owns the two refresh triggers and
 * nothing else: a delivered event, and a reconnect after a connection was lost.
 *
 * Reconnect is treated exactly like an event because Phase 8.2 does not replay.
 * Events that occurred while the browser was offline are recovered by refetching
 * authoritative REST state, never by reconstructing them from the stream.
 */
export function TournamentRealtimeProvider({
  tournamentId,
  children,
  eventSourceFactory,
  refreshCoalesceMs = DEFAULT_REFRESH_COALESCE_MS,
}: TournamentRealtimeProviderProps) {
  const listeners = useRef(new Set<() => void>());
  const coalesceRef = useRef(refreshCoalesceMs);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    coalesceRef.current = refreshCoalesceMs;
  }, [refreshCoalesceMs]);

  const notify = useCallback((): void => {
    // Iterate a copy so a listener that unsubscribes during notification cannot
    // mutate the set mid-iteration.
    for (const listener of [...listeners.current]) {
      listener();
    }
  }, []);

  const scheduleRefresh = useCallback((): void => {
    // One pending flush absorbs the whole burst; a later event while a flush is
    // pending does not extend the window, so the refetch is never postponed
    // indefinitely. Already-scheduled work is not duplicated.
    if (timer.current !== undefined) {
      return;
    }
    timer.current = setTimeout(() => {
      timer.current = undefined;
      notify();
    }, coalesceRef.current);
  }, [notify]);

  // The pending flush is cancellable, so unmounting with an event in flight
  // leaves no timer behind and cannot refetch after the screen is gone.
  useEffect(() => {
    return () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
        timer.current = undefined;
      }
    };
  }, []);

  const connectedOnce = useRef(false);
  const scheduleRefreshRef = useRef(scheduleRefresh);
  useEffect(() => {
    scheduleRefreshRef.current = scheduleRefresh;
  }, [scheduleRefresh]);

  const handleStatus = useCallback((status: RealtimeConnectionStatus): void => {
    if (status !== 'CONNECTED') {
      return;
    }
    // The client reports every transition synchronously, so a drop between two
    // CONNECTED statuses is always observed here - even when React collapses the
    // intervening `RECONNECTING` into the same render (which a real browser
    // does). The first CONNECTED is the initial subscription; the screen already
    // has its authoritative REST data from the initial load, so forcing a second
    // request here would only duplicate it. A later CONNECTED follows a
    // RECONNECTING/DISCONNECTED, where events may have been missed, so it must
    // trigger an authoritative refresh.
    if (connectedOnce.current) {
      scheduleRefreshRef.current();
    }
    connectedOnce.current = true;
  }, []);

  const realtime = useTournamentRealtime(tournamentId, {
    onEvent: scheduleRefresh,
    onStatus: handleStatus,
    ...(eventSourceFactory ? { eventSourceFactory } : {}),
  });

  const subscribe = useCallback<TournamentRefreshSubscribe>((listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return (
    <RefreshBusContext.Provider value={subscribe}>
      <RealtimeStatusContext.Provider value={realtime.status}>
        {children}
      </RealtimeStatusContext.Provider>
    </RefreshBusContext.Provider>
  );
}

/**
 * Registers a REST query for realtime refresh.
 *
 * Call it with the `refetch` of the query that owns a screen's authoritative
 * data; every realtime event for the tournament (and every reconnect) then
 * refetches it. Outside a tournament subtree the bus is inert and this is a
 * no-op, so a shared component can be rendered in isolation.
 *
 * The listener is stable and reads the latest `refetch` from a ref, so a
 * rerender that produces a new inline callback never re-subscribes, and React
 * Strict Mode's double effect invocation simply subscribes and unsubscribes once.
 */
export function useTournamentRefresh(refetch: () => void): void {
  const subscribe = useContext(RefreshBusContext);
  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  useEffect(() => {
    return subscribe(() => {
      refetchRef.current();
    });
  }, [subscribe]);
}

const STATUS_PRESENTATION: Readonly<
  Record<RealtimeConnectionStatus, { readonly label: string; readonly tone: string }>
> = {
  CONNECTING: { label: 'Connecting…', tone: 'bg-warning' },
  CONNECTED: { label: 'Live', tone: 'bg-success' },
  RECONNECTING: { label: 'Reconnecting…', tone: 'bg-warning' },
  DISCONNECTED: { label: 'Offline', tone: 'bg-muted-foreground' },
};

/**
 * A subtle realtime connection hint.
 *
 * Purely informational: it renders nothing outside a tournament stream, and the
 * page never blocks or shows an error because the stream is unavailable - REST
 * stays authoritative and manual refresh keeps working.
 */
export function RealtimeStatusIndicator() {
  const status = useContext(RealtimeStatusContext);
  if (status === null) {
    return null;
  }
  const { label, tone } = STATUS_PRESENTATION[status];
  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-1.5 text-xs"
      data-testid="realtime-status"
      data-status={status}
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', tone)} />
      {label}
    </span>
  );
}
