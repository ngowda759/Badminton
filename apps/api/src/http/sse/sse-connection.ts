import type { RealtimeEventPublisher, RealtimeSubscriberSink } from '@badminton/application';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { SSE_HEARTBEAT_FRAME, toSseEventFrame } from './sse-frame.ts';

/**
 * One Server-Sent Events connection.
 *
 * This is a small transport abstraction local to the HTTP layer: it owns an
 * already-hijacked Node `ServerResponse`, the publisher subscription for one
 * tournament, and the heartbeat. Keeping it separate from the route makes the
 * lifecycle testable with a fake response and a deterministic timer, and keeps
 * the route free of the interval, unsubscribe and backpressure bookkeeping.
 *
 * Layering: route -> this adapter -> `RealtimeEventPublisher`. It never touches
 * Prisma, the outbox, a business service or tournament state.
 *
 * Two properties this adapter must guarantee:
 *
 * - **No disconnect-initialization race.** Disconnect detection is registered
 *   before any resource is created, and the closed state is re-checked after
 *   each setup step. A client that goes away at any point - before the handler
 *   runs, while the headers are written, or between subscribing and starting the
 *   heartbeat - always ends with no subscription and no timer. `close` is
 *   idempotent, so a close observed from the request, the response and shutdown
 *   is safe.
 * - **Bounded backpressure.** `send` is synchronous and never awaits the socket,
 *   so a slow client can never block the publisher or the dispatcher. Frames are
 *   buffered up to a byte cap while the socket is full and flushed on `drain`; a
 *   client that exceeds the cap is disconnected, so memory stays bounded and the
 *   other subscribers are unaffected.
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
  warn?(details: unknown, message?: string): void;
}

export interface OpenSseConnectionOptions {
  readonly tournamentId: string;
  readonly publisher: RealtimeEventPublisher;
  /** The raw request; listened to for `close`/abort so an early disconnect is seen. */
  readonly request: IncomingMessage;
  /** The hijacked response; headers are written by this adapter. */
  readonly response: ServerResponse;
  readonly heartbeatIntervalMs: number;
  readonly scheduler?: SseConnectionTimerScheduler;
  readonly logger?: SseConnectionLogger;
  /** Called once when the connection is torn down (for route-level tracking). */
  readonly onCleanup?: () => void;
  /** Overrides the buffered-frame cap; a test seam, otherwise the module default. */
  readonly maxBufferedBytes?: number;
}

export interface SseConnection {
  /** Whether the connection has been torn down (established or not). */
  isClosed(): boolean;
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
 * How many bytes of unwritten frames a backpressured client may accumulate.
 *
 * A client that cannot drain its socket beyond this is disconnected: SSE only
 * signals "something changed", so a stalled client reconnects and refetches REST
 * rather than forcing the server to buffer without bound.
 */
const DEFAULT_MAX_BUFFERED_BYTES = 1_048_576;

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

/**
 * Establishes the SSE stream, subscribes the connection to `tournamentId` and
 * starts the heartbeat. Safe to call on an already-disconnected request: it then
 * establishes nothing and returns a closed connection.
 */
export function openSseConnection(options: OpenSseConnectionOptions): SseConnection {
  const scheduler = options.scheduler ?? defaultScheduler;
  const logger = options.logger;
  const maxBufferedBytes = options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
  const { request, response } = options;

  let closed = false;
  const isClosed = (): boolean => closed;
  let unsubscribe: (() => void) | undefined;
  let timer: SseConnectionTimer | undefined;
  /** Whether the socket last accepted a write (`false` means it is full). */
  let writable = true;
  let buffered: string[] = [];
  let bufferedBytes = 0;

  const detach = (): void => {
    request.off('close', onDisconnect);
    response.off('close', onDisconnect);
    response.off('drain', onDrain);
  };

  const close = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    detach();
    unsubscribe?.();
    unsubscribe = undefined;
    timer?.cancel();
    timer = undefined;
    buffered = [];
    bufferedBytes = 0;
    try {
      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
    } catch (error: unknown) {
      logger?.error(error, 'failed to end SSE response');
    }
    options.onCleanup?.();
  };

  const onDisconnect = (): void => {
    close();
  };

  /** Writes one chunk; returns whether the socket has room for more. */
  const rawWrite = (chunk: string): boolean => {
    try {
      return response.write(chunk);
    } catch (error: unknown) {
      // A broken pipe must never escape into the publisher or the request.
      logger?.error(error, 'failed to write SSE frame');
      close();
      return false;
    }
  };

  const flush = (): void => {
    while (writable && !closed) {
      const chunk = buffered.shift();
      if (chunk === undefined) {
        return;
      }
      bufferedBytes -= Buffer.byteLength(chunk);
      writable = rawWrite(chunk);
    }
  };

  const onDrain = (): void => {
    writable = true;
    flush();
  };

  const write = (chunk: string): void => {
    if (closed) {
      return;
    }
    if (response.destroyed) {
      close();
      return;
    }
    if (writable) {
      writable = rawWrite(chunk);
      return;
    }
    // The socket is full: buffer up to the cap, never blocking the publisher.
    buffered.push(chunk);
    bufferedBytes += Buffer.byteLength(chunk);
    if (bufferedBytes > maxBufferedBytes) {
      logger?.warn?.(
        { bufferedBytes },
        'disconnecting a slow SSE client that exceeded the buffered-frame limit',
      );
      close();
    }
  };

  // Register disconnect detection before creating anything, so no window exists
  // in which a disconnect neither prevents setup nor tears it down.
  request.on('close', onDisconnect);
  response.on('close', onDisconnect);
  response.on('drain', onDrain);

  if (request.destroyed || response.destroyed) {
    close();
    return { isClosed, close };
  }

  try {
    response.writeHead(200, SSE_RESPONSE_HEADERS);
    response.write(SSE_OPEN_FRAME);
  } catch (error: unknown) {
    logger?.error(error, 'failed to start SSE response');
    close();
    return { isClosed, close };
  }

  const sink: RealtimeSubscriberSink = {
    send(event) {
      write(toSseEventFrame(event));
    },
  };

  unsubscribe = options.publisher.subscribe(options.tournamentId, sink);
  if (isClosed()) {
    // A disconnect arrived during setup; undo the subscription we just created
    // (the earlier `close` could not have seen it) and stay closed.
    unsubscribe();
    unsubscribe = undefined;
    return { isClosed, close };
  }

  timer = scheduler.setInterval(() => {
    write(SSE_HEARTBEAT_FRAME);
  }, options.heartbeatIntervalMs);

  if (isClosed()) {
    // A disconnect arrived while starting the heartbeat; drop it.
    timer.cancel();
    timer = undefined;
    return { isClosed, close };
  }

  return { isClosed, close };
}
