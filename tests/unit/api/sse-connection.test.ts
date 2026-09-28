import { createRealtimeEventPublisher } from '@badminton/application';
import type { RealtimeEvent } from '@badminton/domain';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

import {
  openSseConnection,
  type SseConnectionTimerScheduler,
} from '../../../apps/api/src/http/sse/sse-connection.ts';

/**
 * SSE connection transport tests.
 *
 * Driven with a fake request/response and a manual timer, so the lifecycle,
 * heartbeat cadence, disconnect race and backpressure are deterministic. The
 * publisher is the real Phase 8.1 implementation, so subscription scoping is
 * exercised for real rather than mocked.
 */

const TOURNAMENT_A = '11111111-1111-1111-1111-111111111111';
const TOURNAMENT_B = '22222222-2222-2222-2222-222222222222';

function eventFor(tournamentId: string, id = TOURNAMENT_A): RealtimeEvent {
  return {
    id,
    tournamentId,
    eventType: 'MATCH_COMPLETED',
    aggregateType: 'MATCH',
    aggregateId: '33333333-3333-3333-3333-333333333333',
    occurredAt: new Date('2026-09-27T10:00:00.000Z'),
    payload: null,
    publishedAt: null,
  };
}

/** A minimal event emitter standing in for the raw request and response. */
class FakeEmitter extends EventEmitter {
  destroyed = false;
}

/**
 * A minimal stand-in for the hijacked Node response.
 *
 * `blocked` models a full socket: writes are accepted but report backpressure
 * (`false`) until `recover()` emits `drain`, which is what a slow client looks
 * like from the server.
 */
class FakeResponse extends FakeEmitter {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writableEnded = false;
  failNextWrite = false;
  blocked = false;

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode;
    this.headers = { ...headers };
    return this;
  }

  write(chunk: string): boolean {
    if (this.failNextWrite) {
      throw new Error('EPIPE');
    }
    this.chunks.push(chunk);
    return !this.blocked;
  }

  end(): void {
    this.writableEnded = true;
  }

  /** Simulates the socket draining: `write` accepts again and `drain` fires. */
  recover(): void {
    this.blocked = false;
    this.emit('drain');
  }
}

/** Captures intervals so a test can fire heartbeats without waiting. */
class ManualScheduler {
  private callbacks: Array<() => void> = [];
  intervals: number[] = [];
  cancelled = 0;

  readonly scheduler: SseConnectionTimerScheduler = {
    setInterval: (callback, intervalMs) => {
      this.callbacks.push(callback);
      this.intervals.push(intervalMs);
      return {
        cancel: () => {
          this.cancelled += 1;
          this.callbacks = this.callbacks.filter((entry) => entry !== callback);
        },
      };
    },
  };

  tick(): void {
    for (const callback of [...this.callbacks]) {
      callback();
    }
  }
}

function open(
  options: {
    tournamentId?: string;
    response?: FakeResponse;
    request?: FakeEmitter;
    publisher?: ReturnType<typeof createRealtimeEventPublisher>;
    scheduler?: ManualScheduler;
    maxBufferedBytes?: number;
    logger?: {
      error: (details: unknown, message?: string) => void;
      warn?: (details: unknown, message?: string) => void;
    };
  } = {},
) {
  const response = options.response ?? new FakeResponse();
  const request = options.request ?? new FakeEmitter();
  const publisher = options.publisher ?? createRealtimeEventPublisher();
  const scheduler = options.scheduler ?? new ManualScheduler();
  const connection = openSseConnection({
    tournamentId: options.tournamentId ?? TOURNAMENT_A,
    publisher,
    request: request as unknown as IncomingMessage,
    response: response as unknown as ServerResponse,
    heartbeatIntervalMs: 1234,
    scheduler: scheduler.scheduler,
    ...(options.maxBufferedBytes === undefined
      ? {}
      : { maxBufferedBytes: options.maxBufferedBytes }),
    ...(options.logger ? { logger: options.logger } : {}),
  });
  return { connection, response, request, publisher, scheduler };
}

describe('openSseConnection', () => {
  it('writes the SSE headers and an open frame, then subscribes', () => {
    const { response, publisher, scheduler } = open();

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    expect(response.chunks[0]).toBe(': connected\n\n');
    expect(publisher.tournaments()).toEqual([TOURNAMENT_A]);
    expect(scheduler.intervals).toEqual([1234]);
  });

  it('forwards published events as frames with id, event and JSON data', async () => {
    const { response, publisher } = open();

    await publisher.publish(eventFor(TOURNAMENT_A, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
    await publisher.publish(eventFor(TOURNAMENT_A, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));

    // One open frame plus two event frames.
    const frames = response.chunks.slice(1);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toContain('id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(frames[0]).toContain('event: MATCH_COMPLETED');
    const dataLine = frames[0]?.split('\n').find((line) => line.startsWith('data: ')) ?? '';
    expect(JSON.parse(dataLine.slice('data: '.length))).toMatchObject({
      event: 'MATCH_COMPLETED',
      tournamentId: TOURNAMENT_A,
    });
  });

  it('does not deliver another tournament\u2019s event', async () => {
    const { response, publisher } = open({ tournamentId: TOURNAMENT_B });

    await publisher.publish(eventFor(TOURNAMENT_A));

    expect(response.chunks).toEqual([': connected\n\n']);
  });

  it('emits heartbeat comment frames on the configured interval', () => {
    const { response, scheduler } = open();

    scheduler.tick();
    scheduler.tick();

    expect(response.chunks.slice(1)).toEqual([': heartbeat\n\n', ': heartbeat\n\n']);
  });

  it('unsubscribes and clears the heartbeat on close, safely more than once', async () => {
    const { connection, publisher, scheduler, response } = open();

    connection.close();
    connection.close();

    expect(publisher.tournaments()).toEqual([]);
    expect(scheduler.cancelled).toBe(1);
    expect(response.writableEnded).toBe(true);

    // A closed connection receives nothing further.
    await publisher.publish(eventFor(TOURNAMENT_A));
    expect(response.chunks).toEqual([': connected\n\n']);
  });

  it('isolates a write failure: closes the sink without throwing', async () => {
    const { response, publisher, scheduler } = open();
    response.failNextWrite = true;

    await expect(publisher.publish(eventFor(TOURNAMENT_A))).resolves.toBeUndefined();

    // The broken sink removed itself, so the registry is clean and the timer is gone.
    expect(publisher.tournaments()).toEqual([]);
    expect(scheduler.cancelled).toBe(1);
  });

  it('does not subscribe when the request is already closed', () => {
    const request = new FakeEmitter();
    request.destroyed = true;
    const response = new FakeResponse();
    const { publisher, scheduler } = open({ request, response });

    expect(publisher.tournaments()).toEqual([]);
    expect(response.chunks).toEqual([]);
    expect(scheduler.intervals).toEqual([]);
  });

  // --- Regression: disconnect-initialization race ---------------------------

  it('registers disconnect detection before subscribing, so no window is left', () => {
    const request = new FakeEmitter();
    const response = new FakeResponse();
    // A real Node response has listeners attached before the writes happen; the
    // adapter must have attached its own by the time it first writes.
    const originalWriteHead = response.writeHead.bind(response);
    let requestListenersAtFirstWrite = -1;
    let responseListenersAtFirstWrite = -1;
    response.writeHead = (statusCode, headers) => {
      requestListenersAtFirstWrite = request.listenerCount('close');
      responseListenersAtFirstWrite = response.listenerCount('close');
      return originalWriteHead(statusCode, headers);
    };

    open({ request, response });

    expect(requestListenersAtFirstWrite).toBeGreaterThan(0);
    expect(responseListenersAtFirstWrite).toBeGreaterThan(0);
  });

  it('tears down a subscription created after a disconnect during setup', async () => {
    const publisher = createRealtimeEventPublisher();
    const response = new FakeResponse();
    // Disconnect on the response write of the open frame, i.e. after the
    // adapter has registered its listeners but before it subscribes.
    response.write = (chunk: string) => {
      response.chunks.push(chunk);
      response.emit('close');
      return true;
    };

    const { connection, scheduler } = open({ publisher, response });

    // No leak: the late subscription was undone, the timer never started.
    expect(connection.isClosed()).toBe(true);
    expect(publisher.tournaments()).toEqual([]);
    expect(scheduler.intervals).toEqual([]);

    await publisher.publish(eventFor(TOURNAMENT_A));
    expect(response.chunks).toEqual([': connected\n\n']);
  });

  it('tears down a disconnect that arrives before the handler runs', () => {
    const request = new FakeEmitter();
    const response = new FakeResponse();
    request.destroyed = true;
    response.destroyed = true;

    const { connection, publisher, scheduler } = open({ request, response });

    expect(connection.isClosed()).toBe(true);
    expect(publisher.tournaments()).toEqual([]);
    expect(scheduler.intervals).toEqual([]);
    expect(response.chunks).toEqual([]);
  });

  it('is idempotent when disconnect and close race', () => {
    const { connection, response, request, publisher, scheduler } = open();

    // A request-side disconnect and an explicit close racing must not double-run.
    request.emit('close');
    response.emit('close');
    connection.close();

    expect(connection.isClosed()).toBe(true);
    expect(publisher.tournaments()).toEqual([]);
    expect(scheduler.cancelled).toBe(1);
    expect(response.listenerCount('close')).toBe(0);
    expect(response.listenerCount('drain')).toBe(0);
    expect(request.listenerCount('close')).toBe(0);
  });

  // --- Regression: bounded backpressure -------------------------------------

  it('buffers frames while the socket is full and flushes on drain', async () => {
    const response = new FakeResponse();
    const { publisher } = open({ response });
    response.blocked = true;

    await publisher.publish(eventFor(TOURNAMENT_A, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
    await publisher.publish(eventFor(TOURNAMENT_A, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));

    // Node's first `write` after backpressure still buffers the frame (its
    // `false` return only advises us to stop); the next frame is held back.
    expect(response.chunks).toHaveLength(2);
    expect(response.chunks[1]).toContain('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(publisher.tournaments()).toEqual([TOURNAMENT_A]);

    response.recover();

    expect(response.chunks).toHaveLength(3);
    expect(response.chunks[2]).toContain('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('never blocks the publisher on a slow client', async () => {
    const response = new FakeResponse();
    const { publisher } = open({ response, maxBufferedBytes: 1_000_000 });
    response.blocked = true;

    // Many publishes resolve immediately even though nothing can be written.
    const started = Date.now();
    for (let index = 0; index < 50; index += 1) {
      await publisher.publish(eventFor(TOURNAMENT_A));
    }
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(publisher.tournaments()).toEqual([TOURNAMENT_A]);
  });

  it('disconnects a client that exceeds the buffered-frame cap', async () => {
    const response = new FakeResponse();
    const warnings: unknown[] = [];
    const { publisher, scheduler, connection } = open({
      response,
      maxBufferedBytes: 64,
      logger: { error: () => undefined, warn: (details) => warnings.push(details) },
    });
    response.blocked = true;

    await publisher.publish(eventFor(TOURNAMENT_A, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
    await publisher.publish(eventFor(TOURNAMENT_A, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'));

    // The cap is exceeded, so the slow client is dropped: unsubscribed, timer
    // cleared, stream ended - and the other subscribers are untouched.
    expect(connection.isClosed()).toBe(true);
    expect(publisher.tournaments()).toEqual([]);
    expect(scheduler.cancelled).toBe(1);
    expect(response.writableEnded).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it('drops the buffered frames and unsubscribes when a blocked client disconnects', async () => {
    const response = new FakeResponse();
    const { publisher, connection } = open({ response, maxBufferedBytes: 1_000_000 });
    response.blocked = true;

    await publisher.publish(eventFor(TOURNAMENT_A));
    expect(publisher.tournaments()).toEqual([TOURNAMENT_A]);

    response.emit('close');
    expect(connection.isClosed()).toBe(true);
    expect(publisher.tournaments()).toEqual([]);

    // A late drain must not write after close.
    response.recover();
    expect(response.chunks).toHaveLength(2);
    expect(response.chunks[1]).toContain('MATCH_COMPLETED');
  });
});
