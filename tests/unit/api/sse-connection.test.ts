import { createRealtimeEventPublisher } from '@badminton/application';
import type { RealtimeEvent } from '@badminton/domain';
import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';

import {
  openSseConnection,
  type SseConnectionTimerScheduler,
} from '../../../apps/api/src/http/sse/sse-connection.ts';

/**
 * SSE connection transport tests.
 *
 * Driven with a fake `ServerResponse` and a manual timer, so the lifecycle,
 * heartbeat cadence and failure isolation are deterministic. The publisher is
 * the real Phase 8.1 implementation, so subscription scoping is exercised for
 * real rather than mocked.
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

/** A minimal stand-in for the hijacked Node response. */
class FakeResponse {
  statusCode = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  destroyed = false;
  writableEnded = false;
  failNextWrite = false;
  on(): this {
    return this;
  }
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
    return true;
  }
  end(): void {
    this.writableEnded = true;
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
    publisher?: ReturnType<typeof createRealtimeEventPublisher>;
    scheduler?: ManualScheduler;
    requestClosed?: boolean;
  } = {},
) {
  const response = options.response ?? new FakeResponse();
  const publisher = options.publisher ?? createRealtimeEventPublisher();
  const scheduler = options.scheduler ?? new ManualScheduler();
  const connection = openSseConnection({
    tournamentId: options.tournamentId ?? TOURNAMENT_A,
    publisher,
    response: response as unknown as ServerResponse,
    heartbeatIntervalMs: 1234,
    isRequestClosed: () => options.requestClosed ?? false,
    scheduler: scheduler.scheduler,
  });
  return { connection, response, publisher, scheduler };
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
    const { publisher, response, scheduler } = open({ requestClosed: true });

    expect(publisher.tournaments()).toEqual([]);
    expect(response.chunks).toEqual([]);
    expect(scheduler.intervals).toEqual([]);
  });
});
