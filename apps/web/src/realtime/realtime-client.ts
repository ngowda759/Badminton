import {
  parseRealtimeEvent,
  type RealtimeConnectionStatus,
  type RealtimeEvent,
} from './realtime-types.ts';

/**
 * Browser realtime client for one tournament.
 *
 * The client owns exactly one native `EventSource` per instance, scoped to
 * `/api/v1/tournaments/:tournamentId/events`, and reports the connection
 * lifecycle and each parsed event to its consumers. It is a *signal* source
 * only: it never fetches dashboard data, mutates state, calls a REST endpoint
 * or decides which query to invalidate - that is Phase 8.5's job.
 *
 * It is deliberately framework-free (no React import) so the lifecycle can be
 * unit-tested against a fake `EventSource` without a DOM. The React binding
 * lives in `use-tournament-realtime.ts`.
 *
 * Responsibilities and guarantees:
 *
 * - **At most one connection.** `start()` is a no-op while a source exists, so a
 *   double effect invocation (React Strict Mode) can never open two sockets.
 * - **Safe reconnect state.** The native `EventSource` retries on its own; the
 *   client only mirrors that: an error while the source is not `CLOSED` is a
 *   temporary loss (`RECONNECTING`), a `CLOSED` source is a real
 *   `DISCONNECTED`. No custom reconnect loop exists, so no extra connections
 *   are ever created.
 * - **Clean disposal.** `stop()` detaches the handlers *before* closing the
 *   source, so no callback fires after disposal, and it is idempotent.
 * - **Malformed events never crash.** A frame whose `data` is not valid JSON or
 *   is missing envelope fields is dropped and the connection stays open.
 * - **No replay.** Phase 8.2 does not replay; the client does not ask for
 *   `Last-Event-ID` and does not reconstruct missed state. A reconnect is a
 *   signal for a consumer to refetch REST.
 */

/** The native `EventSource` readyState value meaning the connection is closed. */
const EVENT_SOURCE_CLOSED = 2;

/**
 * The subset of `EventSource` the client depends on.
 *
 * Declaring it keeps the client testable with a fake and documents exactly what
 * the browser API must provide.
 */
export interface RealtimeEventSource {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

/** Creates the underlying connection; injectable so tests need no real socket. */
export type EventSourceFactory = (url: string) => RealtimeEventSource;

export interface TournamentRealtimeClientOptions {
  /** Fully-built SSE URL for one tournament (see {@link buildTournamentEventsUrl}). */
  readonly url: string;
  /** Called on every connection-state transition. */
  readonly onStatus?: (status: RealtimeConnectionStatus) => void;
  /** Called for each well-formed event; malformed frames are never delivered. */
  readonly onEvent?: (event: RealtimeEvent) => void;
  /** Test seam; defaults to a native browser `EventSource`. */
  readonly eventSourceFactory?: EventSourceFactory;
}

export interface TournamentRealtimeClient {
  /** The current connection state; starts `DISCONNECTED` until `start()`. */
  getStatus(): RealtimeConnectionStatus;
  /** Opens the connection if one is not already open; idempotent. */
  start(): void;
  /** Closes the connection and stops all callbacks; idempotent. */
  stop(): void;
}

/**
 * Builds the tournament-scoped SSE URL.
 *
 * The tournament id is path-encoded so an id can never break out of its
 * segment or point the connection at another resource.
 */
export function buildTournamentEventsUrl(baseUrl: string, tournamentId: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/api/v1/tournaments/${encodeURIComponent(tournamentId)}/events`;
}

/** Constructs a native `EventSource`; only ever called in the browser. */
function createBrowserEventSource(url: string): RealtimeEventSource {
  return new EventSource(url);
}

/**
 * Creates a tournament realtime client. The connection is not opened until
 * {@link TournamentRealtimeClient.start} is called.
 */
export function createTournamentRealtimeClient(
  options: TournamentRealtimeClientOptions,
): TournamentRealtimeClient {
  const factory = options.eventSourceFactory ?? createBrowserEventSource;
  let status: RealtimeConnectionStatus = 'DISCONNECTED';
  let source: RealtimeEventSource | undefined;
  let stopped = false;

  const setStatus = (next: RealtimeConnectionStatus): void => {
    if (status === next) {
      return;
    }
    status = next;
    options.onStatus?.(next);
  };

  /** Detaches handlers first so no callback can fire after disposal. */
  const detach = (): void => {
    const current = source;
    if (!current) {
      return;
    }
    source = undefined;
    current.onopen = null;
    current.onerror = null;
    current.onmessage = null;
    current.close();
  };

  const start = (): void => {
    // `source` guards against a second connection; `stopped` against starting a
    // client that was already disposed.
    if (stopped || source) {
      return;
    }

    setStatus('CONNECTING');

    let created: RealtimeEventSource;
    try {
      created = factory(options.url);
    } catch {
      // A failed construction (for example an invalid URL) must not crash the
      // caller; report an intentional disconnect and stop.
      setStatus('DISCONNECTED');
      return;
    }

    source = created;

    created.onopen = (): void => {
      if (stopped || source !== created) {
        return;
      }
      setStatus('CONNECTED');
    };

    created.onerror = (): void => {
      if (stopped || source !== created) {
        return;
      }
      // The browser retries automatically while the source is not CLOSED; a
      // CLOSED readyState means it has given up, which is a real disconnect.
      setStatus(created.readyState === EVENT_SOURCE_CLOSED ? 'DISCONNECTED' : 'RECONNECTING');
    };

    created.onmessage = (message: MessageEvent): void => {
      if (stopped || source !== created) {
        return;
      }
      if (typeof message.data !== 'string') {
        return;
      }
      const event = parseRealtimeEvent(message.data);
      if (event) {
        options.onEvent?.(event);
      }
    };
  };

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    detach();
    setStatus('DISCONNECTED');
  };

  return {
    getStatus: () => status,
    start,
    stop,
  };
}
