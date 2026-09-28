import type { RealtimeEvent } from '@badminton/domain';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApi, type TestApi } from './harness.ts';

/**
 * HTTP/SSE integration tests for `GET /api/v1/tournaments/:tournamentId/events`.
 *
 * These bind a real socket (a hijacked SSE stream cannot be driven through
 * `app.inject`) and read the wire bytes a browser's `EventSource` would see, so
 * headers, framing, tournament scoping, heartbeat and disconnect cleanup are
 * proven end to end through the real Fastify stack and the real Phase 8.1
 * publisher. Heartbeats use a short injected interval rather than waiting the
 * production default.
 */

let api: TestApi;
let app: FastifyInstance;

beforeEach(async () => {
  api = createTestApi({ realtimeHeartbeatIntervalMs: 25 });
  app = api.app;
  await app.listen({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  await app.close();
});

/** A live SSE connection driven over a real socket. */
interface SseClient {
  readonly status: number;
  readonly headers: Headers;
  /** Everything received so far. */
  text(): string;
  /** Resolves once `predicate` holds for the accumulated text. */
  waitForText(predicate: (text: string) => boolean, timeoutMs?: number): Promise<void>;
  /** Disconnects the client. */
  close(): Promise<void>;
}

function baseUrl(): string {
  const address = app.server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

async function connectSse(
  tournamentId: string,
  headers: Record<string, string> = {},
): Promise<SseClient> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl()}/api/v1/tournaments/${tournamentId}/events`, {
    signal: controller.signal,
    headers,
  });

  let text = '';
  const decoder = new TextDecoder();
  const body = response.body as ReadableStream<Uint8Array> | null;
  const reader = body?.getReader();
  const readLoop = (async () => {
    if (!reader) {
      return;
    }
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        text += decoder.decode(value, { stream: true });
      }
    } catch {
      // Aborting the fetch rejects the pending read; that is the expected close.
    }
  })();

  return {
    status: response.status,
    headers: response.headers,
    text: () => text,
    async waitForText(predicate, timeoutMs = 2_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (predicate(text)) {
          return;
        }
        await delay(5);
      }
      throw new Error(`SSE text did not satisfy the predicate in time: ${JSON.stringify(text)}`);
    },
    async close() {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
      await readLoop;
    },
  };
}

/** Waits until `predicate` returns true, or throws after `timeoutMs`. */
async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }
  throw new Error('condition was not met in time');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function eventFor(tournamentId: string, id: string): RealtimeEvent {
  return {
    id,
    tournamentId,
    eventType: 'MATCH_COMPLETED',
    aggregateType: 'MATCH',
    aggregateId: randomUUID(),
    occurredAt: new Date('2026-09-27T10:00:00.000Z'),
    payload: null,
    publishedAt: null,
  };
}

const TOURNAMENT_A = randomUUID();
const TOURNAMENT_B = randomUUID();

describe('GET /api/v1/tournaments/:tournamentId/events', () => {
  it('establishes an SSE response with the correct headers and stays open', async () => {
    const client = await connectSse(TOURNAMENT_A);

    expect(client.status).toBe(200);
    expect(client.headers.get('content-type')).toBe('text/event-stream');
    expect(client.headers.get('cache-control')).toBe('no-cache');
    expect(client.headers.get('connection')).toBe('keep-alive');

    await client.waitForText((text) => text.includes(': connected'));
    // Still open after the opening frame.
    expect(client.text().endsWith('\n\n')).toBe(true);
    expect(api.realtime.publisher.tournaments()).toContain(TOURNAMENT_A);

    await client.close();
  });

  it('delivers a published event with id, event and JSON data framing', async () => {
    const client = await connectSse(TOURNAMENT_A);
    await client.waitForText((text) => text.includes(': connected'));

    await api.realtime.publisher.publish(
      eventFor(TOURNAMENT_A, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    );

    await client.waitForText((text) => text.includes('event: MATCH_COMPLETED'));
    const text = client.text();
    expect(text).toContain('id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    const dataLine = text
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice('data: '.length);
    expect(dataLine).toBeDefined();
    expect(JSON.parse(dataLine ?? '')).toMatchObject({
      event: 'MATCH_COMPLETED',
      tournamentId: TOURNAMENT_A,
    });

    await client.close();
  });

  it('delivers multiple events on the same connection', async () => {
    const client = await connectSse(TOURNAMENT_A);
    await client.waitForText((text) => text.includes(': connected'));

    await api.realtime.publisher.publish(
      eventFor(TOURNAMENT_A, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    );
    await api.realtime.publisher.publish(
      eventFor(TOURNAMENT_A, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    );

    await client.waitForText(
      (text) =>
        text.includes('id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') &&
        text.includes('id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
    );

    await client.close();
  });

  it('isolates tournaments: A receives its event, B receives nothing', async () => {
    const clientA = await connectSse(TOURNAMENT_A);
    const clientB = await connectSse(TOURNAMENT_B);
    await clientA.waitForText((text) => text.includes(': connected'));
    await clientB.waitForText((text) => text.includes(': connected'));

    await api.realtime.publisher.publish(
      eventFor(TOURNAMENT_A, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    );

    await clientA.waitForText((text) => text.includes('event: MATCH_COMPLETED'));
    // Give B a chance to (wrongly) receive it before asserting.
    await delay(50);
    expect(clientB.text()).not.toContain('MATCH_COMPLETED');

    await clientA.close();
    await clientB.close();
  });

  it('emits heartbeat comment frames using the configured interval', async () => {
    const client = await connectSse(TOURNAMENT_A);

    await client.waitForText((text) => text.includes(': heartbeat'));
    expect(client.text()).toContain(': heartbeat');

    await client.close();
  });

  it('cleans up on disconnect: subscriber removed and no events after close', async () => {
    const client = await connectSse(TOURNAMENT_A);
    await client.waitForText((text) => text.includes(': connected'));
    expect(api.realtime.publisher.tournaments()).toContain(TOURNAMENT_A);

    await client.close();
    await waitUntil(() => !api.realtime.publisher.tournaments().includes(TOURNAMENT_A));

    const textAtClose = client.text();
    await api.realtime.publisher.publish(
      eventFor(TOURNAMENT_A, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
    );
    await delay(50);
    expect(client.text()).toBe(textAtClose);
    expect(client.text()).not.toContain('cccccccc-cccc-cccc-cccc-cccccccccccc');
  });

  it('isolates a broken subscriber: another subscriber still receives and the app survives', async () => {
    const healthy = await connectSse(TOURNAMENT_A);
    await healthy.waitForText((text) => text.includes(': connected'));

    // A failing sink alongside the live SSE connection, as a broken write would be.
    api.realtime.publisher.subscribe(TOURNAMENT_A, {
      send: () => {
        throw new Error('connection reset by peer');
      },
    });

    await api.realtime.publisher.publish(
      eventFor(TOURNAMENT_A, 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    );

    await healthy.waitForText((text) => text.includes('event: MATCH_COMPLETED'));

    // The dispatcher/publisher still operates and REST still works.
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(api.realtime.publisher.tournaments()).toContain(TOURNAMENT_A);

    await healthy.close();
  });

  it('rejects a malformed tournament id with the standard 400 envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tournaments/not-a-uuid/events',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  it('accepts Last-Event-ID without triggering replay', async () => {
    const client = await connectSse(TOURNAMENT_A, { 'Last-Event-ID': 'some-earlier-event-id' });
    expect(client.status).toBe(200);

    await client.waitForText((text) => text.includes(': connected'));
    // No replayed event frame is fabricated from the header.
    await delay(50);
    expect(client.text()).not.toContain('event: MATCH_COMPLETED');

    await client.close();
  });

  it('closes live streams during server shutdown without hanging', async () => {
    const client = await connectSse(TOURNAMENT_A);
    await client.waitForText((text) => text.includes(': connected'));

    // A live hijacked stream must not make app.close() hang.
    await expect(app.close()).resolves.toBeUndefined();
    expect(api.realtime.publisher.tournaments()).not.toContain(TOURNAMENT_A);
    await client.close();
  });

  it('does not leak a subscriber when the client aborts during setup', async () => {
    // Abort immediately, racing the handler's setup; the adapter must end with
    // no subscription and no heartbeat, whatever the timing.
    const controller = new AbortController();
    const pending = fetch(`${baseUrl()}/api/v1/tournaments/${TOURNAMENT_A}/events`, {
      signal: controller.signal,
    });
    controller.abort();
    await pending.catch(() => undefined);

    await waitUntil(() => !api.realtime.publisher.tournaments().includes(TOURNAMENT_A));
    expect(api.realtime.publisher.tournaments()).toEqual([]);
  });

  it('does not deliver to an aborted connection and keeps serving others', async () => {
    const survivor = await connectSse(TOURNAMENT_A);
    await survivor.waitForText((text) => text.includes(': connected'));

    const controller = new AbortController();
    const early = await fetch(`${baseUrl()}/api/v1/tournaments/${TOURNAMENT_A}/events`, {
      signal: controller.signal,
    });
    const earlyReader = (early.body as ReadableStream<Uint8Array>).getReader();
    await earlyReader.read();
    controller.abort();
    await earlyReader.cancel().catch(() => undefined);

    await api.realtime.publisher.publish(
      eventFor(TOURNAMENT_A, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'),
    );

    // The live subscriber still receives; the aborted one is gone from the registry.
    await survivor.waitForText((text) => text.includes('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'));
    expect(api.realtime.publisher.tournaments()).toContain(TOURNAMENT_A);

    await survivor.close();
  });
});
