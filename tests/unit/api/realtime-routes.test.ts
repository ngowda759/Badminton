import { createRealtimeEventPublisher } from '@badminton/application';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { realtimeRoutes } from '../../../apps/api/src/http/routes/realtime.routes.ts';

/**
 * Phase 8.6 route regression test.
 *
 * `openSseConnection` may close *synchronously during setup* when the client is
 * already gone (the request is destroyed before the handler runs). Its
 * `onCleanup` callback then fires while the route is still evaluating the
 * `const connection = openSseConnection(...)` initializer. The route must not
 * touch an uninitialised binding: before the Phase 8.6 fix this threw a
 * temporal-dead-zone `ReferenceError`, which the error handler turned into a
 * 500 for a client that had simply disconnected.
 *
 * The handler is captured from a minimal fake Fastify surface and invoked with
 * a destroyed raw request, exercising exactly the setup-time-close path without
 * needing to race a real socket.
 */

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';

type RouteHandler = (request: unknown, reply: unknown) => unknown;

/** Captures the registered route handler from the plugin. */
function captureRouteHandler(): RouteHandler {
  let handler: RouteHandler | undefined;
  const fakeApp = {
    addHook: () => undefined,
    get: (_path: string, registered: RouteHandler) => {
      handler = registered;
    },
  };
  realtimeRoutes(
    fakeApp as never,
    {
      realtime: { publisher: createRealtimeEventPublisher() },
      heartbeatIntervalMs: 1000,
      corsOrigins: [],
    },
    () => undefined,
  );
  if (!handler) {
    throw new Error('realtime route was not registered');
  }
  return handler;
}

/** A stand-in raw response that supports the header helper and writes. */
class FakeRawResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  headers: Record<string, string> = {};
  written = 0;

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name];
  }

  writeHead(): this {
    return this;
  }

  write(): boolean {
    this.written += 1;
    return true;
  }

  end(): void {
    this.writableEnded = true;
  }
}

describe('realtime route setup-time disconnect', () => {
  it('does not throw when the client is already gone before the handler runs', () => {
    const handler = captureRouteHandler();
    const raw = new FakeRawResponse();
    // The transport sees a request that has already been destroyed and closes
    // synchronously, firing `onCleanup` during the route's own setup.
    const rawRequest = new EventEmitter() as EventEmitter & { destroyed: boolean };
    rawRequest.destroyed = true;

    const infos: string[] = [];
    const reply = {
      hijack: () => undefined,
      raw,
      status: () => reply,
      send: () => undefined,
    };
    const request = {
      params: { tournamentId: TOURNAMENT_ID },
      headers: {},
      raw: rawRequest,
      log: {
        info: (_details: unknown, message?: string) => {
          infos.push(message ?? '');
        },
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
      },
    };

    expect(() => handler(request, reply)).not.toThrow();
    // Cleanup ran exactly once for the setup-time close.
    expect(infos).toContain('SSE connection closed');
    expect(infos).not.toContain('SSE connection opened');
  });
});
