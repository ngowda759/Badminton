import type { RealtimeEventPublisher, RealtimeSubscriberSink } from '@badminton/application';
import type { ServerResponse } from 'node:http';

import { SSE_HEARTBEAT_FRAME, toSseEventFrame } from './sse-frame.ts';

/**
 * One Server-Sent Events connection.
 *
 * This is a small transport abstraction local to the HTTP layer: it owns an
 * already-hijacked Node `ServerResponse`, the publisher subscription for one
 * tournament, and the heartbeat. Keeping it separate from the route makes the
 * lifecycle testable with a fake response and a deterministic timer, and keeps
 * the route free of the interval and unsubscribe bookkeeping.
 *
 * Layering: route -> this adapter -> `RealtimeEventPublisher`. It never touches
 * Prisma, the outbox, a business service or tournament state.
 */

/** A timer seam so tests need not wait real time. */
export interface SseConnectionTimerScheduler {
  setInterval(callback: () => void, intervalMs: number): SseConnectionTimer;
}

export interface SseConnectionTimer {
  cancel(): void;
}

/** Logger seam; errors are reported, never thrown out of a stream callback. */
export interface SseConnectionLogger {
  error(details: unknown, message?: string): void;
}

export interface OpenSseConnectionOptions {
  readonly tournamentId: string;
  readonly publisher: RealtimeEventPublisher;
  /** The hijacked response; headers are written by this adapter. */
  readonly response: ServerResponse;
  readonly heartbeatIntervalMs: number;
  /** Whether the client request has already been closed. */
  readonly isRequestClosed: () => boolean;
  readonly scheduler?: SseConnectionTimerScheduler;
  readonly logger?: SseConnectionLogger;
  /** Called once when the connection is torn down (for route-level tracking). */
  readonly onCleanup?: () => void;
}

export interface SseConnection {
  /** Idempotent: unsubscribes, clears the heartbeat and ends the stream once. */
  close(): void;
}

/** SSE response headers; the framing itself is added on top by the event frames. */
const SSE_RESPONSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
} as const;

/** An opening comment; not a business event, so a client dispatches nothing. */
const SSE_OPEN_FRAME = ': connected\n\n';

/**
 * A timer over `setInterval` that is `unref`-ed so a live SSE connection never
 * keeps the process alive on its own.
 */
const defaultScheduler: SseConnectionTimerScheduler = {
  setInterval(callback, intervalMs) {
    const handle = setInterval(callback, intervalMs);
    handle.unref();
    return {
      cancel: () => {
        clearInterval(handle);
      },
    };
  },
};

/** A connection that was never established (e.g. the response was already gone). */
const NOOP_CONNECTION: SseConnection = {
  close: () => {
    // Nothing was established, so there is nothing to tear down.
  },
};

/**
 * Establishes the SSE stream, subscribes the connection to `tournamentId` and
 * starts the heartbeat. Safe to call on a disconnected request: it then
 * establishes nothing and returns a no-op connection.
 */
export function openSseConnection(options: OpenSseConnectionOptions): SseConnection {
  const scheduler = options.scheduler ?? defaultScheduler;

  if (options.isRequestClosed() || options.response.destroyed) {
    return NOOP_CONNECTION;
  }

  let closed = false;
  let unsubscribe: (() => void) | undefined;
  let timer: SseConnectionTimer | undefined;

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    unsubscribe?.();
    unsubscribe = undefined;
    timer?.cancel();
    timer = undefined;
    try {
      if (!options.response.writableEnded && !options.response.destroyed) {
        options.response.end();
      }
    } catch (error: unknown) {
      options.logger?.error(error, 'failed to end SSE response');
    }
    options.onCleanup?.();
  };

  const write = (chunk: string): void => {
    if (closed || options.response.destroyed) {
      // The client is gone; drop the sink so no further writes are attempted.
      close();
      return;
    }
    try {
      options.response.write(chunk);
    } catch (error: unknown) {
      // A broken pipe must never escape into the publisher or the request.
      options.logger?.error(error, 'failed to write SSE frame');
      close();
    }
  };

  try {
    options.response.writeHead(200, SSE_RESPONSE_HEADERS);
    options.response.write(SSE_OPEN_FRAME);
  } catch (error: unknown) {
    options.logger?.error(error, 'failed to start SSE response');
    close();
    return NOOP_CONNECTION;
  }
  const sink: RealtimeSubscriberSink = {
    send(event) {
      write(toSseEventFrame(event));
    },
  };

  unsubscribe = options.publisher.subscribe(options.tournamentId, sink);

  timer = scheduler.setInterval(() => {
    write(SSE_HEARTBEAT_FRAME);
  }, options.heartbeatIntervalMs);

  return { close };
}
