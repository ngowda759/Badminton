/**
 * Cross-process realtime wake-up port.
 *
 * A durable outbox row is the source of truth; this port only says "something
 * was inserted, drain now" so a second API process does not have to wait for its
 * next poll. The Phase 8 implementation backs it with PostgreSQL
 * `LISTEN`/`NOTIFY`, but the application depends only on this shape so the
 * dispatcher stays testable without a database.
 *
 * A wake-up is best effort: a lost signal costs latency, never correctness.
 */
export interface RealtimeEventNotifier {
  /**
   * Starts listening; `handler` is invoked with the tournament id of each
   * inserted event. A transport failure is reported through the optional
   * `onError` and must not reject.
   */
  listen(handler: (tournamentId: string) => void): Promise<void>;
  /** Stops listening and releases the dedicated connection. */
  close(): Promise<void>;
}

/** The PostgreSQL NOTIFY channel the outbox trigger publishes on. */
export const REALTIME_NOTIFY_CHANNEL = 'realtime_events';
