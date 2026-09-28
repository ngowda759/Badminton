import type { RealtimeEventRepository } from '../repositories/index.ts';
import type { RealtimeEventPublisher } from './publisher.ts';

/**
 * Outbox dispatcher.
 *
 * Drains committed, unpublished outbox rows and forwards them to the publisher.
 * It is the only component that reads the outbox for delivery, and it holds no
 * business logic: it never modifies match state, scores, brackets or schedules
 * and never calls an application service.
 *
 * Reliability model:
 *  - An event is stamped `publishedAt` only *after* the publisher accepted it,
 *    so a crash or a failed publication leaves the row pending and it is retried
 *    on the next drain. Delivery is therefore at-least-once; recovery for a
 *    missed event is a REST refetch, not replay semantics.
 *  - `wake()` lets a PostgreSQL `LISTEN`/`NOTIFY` signal trigger an immediate
 *    drain. The NOTIFY is only a latency optimisation - the durable row is the
 *    source of truth, so a lost NOTIFY is recovered by the polling tick.
 *  - A failure never throws out of `drain`/the loop: it is reported through
 *    `onError` so a dispatcher problem cannot crash the API process.
 */
export interface RealtimeDispatcher {
  /** Starts the periodic poll. Idempotent; a second call is a no-op. */
  start(): void;
  /** Stops the poll and awaits the in-flight drain. */
  stop(): Promise<void>;
  /** Requests an immediate drain (used by the NOTIFY wake-up). */
  wake(): void;
  /** Drains once and returns how many events were published. */
  drain(): Promise<number>;
}

export interface RealtimeDispatcherOptions {
  readonly repository: RealtimeEventRepository;
  readonly publisher: RealtimeEventPublisher;
  /** Poll cadence. Configurable rather than hard-coded. */
  readonly pollIntervalMs?: number;
  /** Maximum events read per drain. */
  readonly batchSize?: number;
  /** Reports a drain-level failure; never re-thrown. */
  readonly onError?: (error: unknown) => void;
  /** Timer seam so tests can run the loop deterministically. */
  readonly scheduler?: RealtimeDispatcherScheduler;
}

export interface RealtimeDispatcherScheduler {
  setTimer(callback: () => void, delayMs: number): RealtimeDispatcherTimer;
}

export interface RealtimeDispatcherTimer {
  cancel(): void;
}

const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 100;

/** A scheduler over the Node timers; `unref` keeps the poll from holding the process open. */
const defaultScheduler: RealtimeDispatcherScheduler = {
  setTimer(callback, delayMs) {
    const handle = setTimeout(callback, delayMs);
    handle.unref();
    return {
      cancel: () => {
        clearTimeout(handle);
      },
    };
  },
};

export function createRealtimeDispatcher(options: RealtimeDispatcherOptions): RealtimeDispatcher {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const scheduler = options.scheduler ?? defaultScheduler;

  let running = false;
  let timer: RealtimeDispatcherTimer | undefined;
  let inFlight: Promise<void> | undefined;
  let wakeRequested = false;

  async function runOnce(): Promise<number> {
    const pending = await options.repository.getPendingEvents(batchSize);
    let published = 0;
    for (const event of pending) {
      let delivered = false;
      try {
        await options.publisher.publish(event);
        delivered = true;
      } catch (error: unknown) {
        // The publisher isolates individual sinks; this catch is for a
        // repository/publisher-level failure. The row stays pending.
        options.onError?.(error);
      }
      if (delivered) {
        await options.repository.markPublished(event.id);
        published += 1;
      }
    }
    return published;
  }

  /** Serialises drains so two triggers never publish the same row twice. */
  function drain(): Promise<number> {
    const next = (inFlight ?? Promise.resolve()).then(
      () => runOnce(),
      () => runOnce(),
    );
    inFlight = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function schedule(): void {
    if (!running) {
      return;
    }
    timer = scheduler.setTimer(() => {
      void drain().finally(schedule);
    }, pollIntervalMs);
  }

  return {
    start() {
      if (running) {
        return;
      }
      running = true;
      // Drain once immediately so a restart recovers pending events promptly.
      void drain().finally(schedule);
    },

    async stop() {
      running = false;
      timer?.cancel();
      timer = undefined;
      await inFlight;
    },

    wake() {
      if (!running || wakeRequested) {
        return;
      }
      wakeRequested = true;
      // Cancel the pending tick and drain now; the normal cadence resumes after.
      timer?.cancel();
      void drain().finally(() => {
        wakeRequested = false;
        schedule();
      });
    },

    drain() {
      return drain().catch((error: unknown) => {
        options.onError?.(error);
        return 0;
      });
    },
  };
}
