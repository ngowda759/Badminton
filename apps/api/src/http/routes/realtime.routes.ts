import type { RealtimeEventPublisher } from '@badminton/application';
import { tournamentIdParamSchema } from '@badminton/validation';
import type { FastifyPluginCallback, FastifyReply } from 'fastify';

import type { ApiRealtime } from '../api-realtime.ts';
import { validate } from '../request.ts';
import { applyHijackedCorsHeaders } from '../../plugins/cors.ts';
import {
  openSseConnection,
  type SseConnection,
  type SseConnectionTimerScheduler,
} from '../sse/sse-connection.ts';

export interface RealtimeRoutesOptions {
  /** The publisher port; absent only in the Phase 1 health-only composition. */
  readonly realtime?: ApiRealtime;
  /** SSE heartbeat interval (ms); read from `REALTIME_HEARTBEAT_INTERVAL_MS`. */
  readonly heartbeatIntervalMs: number;
  /**
   * Browser origins allowed to hold a realtime stream. The stream hijacks the
   * response, so it must carry the CORS headers itself (see
   * `applyHijackedCorsHeaders`).
   */
  readonly corsOrigins: readonly string[];
  /** Timer seam so tests need not wait real time. */
  readonly scheduler?: SseConnectionTimerScheduler;
}

/**
 * Realtime SSE transport.
 *
 * `GET /tournaments/:tournamentId/events` opens a Server-Sent Events stream for
 * one tournament. The route validates the path parameter, hijacks the HTTP
 * response, and hands it to the connection adapter, which subscribes to the
 * Phase 8.1 `RealtimeEventPublisher` and forwards committed events as SSE
 * frames. The handler never reads the outbox, queries Prisma, calls a business
 * service or mutates state: REST stays authoritative and SSE only signals that
 * something changed so a future client can refetch. Tournament isolation comes
 * from the publisher's per-tournament registry, not from another lookup here.
 *
 * Validation runs before the response is hijacked, so a malformed id still gets
 * the repository's normal 400 through the central error handler.
 *
 * `Last-Event-ID` is accepted for client compatibility but is informational: it
 * does not trigger replay. Recovery after a reconnect is a REST refetch, and no
 * event history or replay query exists in Phase 8.2.
 */
export const realtimeRoutes: FastifyPluginCallback<RealtimeRoutesOptions> = (app, options) => {
  const realtime = options.realtime;
  const publisher: RealtimeEventPublisher | undefined = realtime?.publisher;

  // Live connections for this plugin, so shutdown can end them during `preClose`
  // instead of letting `app.close()` wait for a stream that never closes on its
  // own. Routed through `openSseConnection`'s idempotent `close`.
  const connections = new Set<SseConnection>();

  app.addHook('preClose', () => {
    for (const connection of [...connections]) {
      connection.close();
    }
    connections.clear();
  });

  app.get('/tournaments/:tournamentId/events', (request, reply) => {
    const { tournamentId } = validate(tournamentIdParamSchema, request.params);

    if (!publisher) {
      // Realtime is not composed (health-only builds); fail clearly rather than
      // opening a stream that can never receive an event.
      return reply.status(503).send({
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Realtime transport is not available.',
        },
      });
    }

    // Accepted for compatibility only - Phase 8.2 has no replay.
    const lastEventId = request.headers['last-event-id'];
    if (typeof lastEventId === 'string' && lastEventId.length > 0) {
      request.log.debug(
        { lastEventId },
        'Last-Event-ID received; event replay is not implemented, refetch REST state instead',
      );
    }

    const response = hijackForSse(reply, request.headers.origin, options.corsOrigins);

    // `openSseConnection` can close synchronously during setup (a client that is
    // already gone), so its `onCleanup` may run before the assignment below.
    // Hold the connection in a mutable box and register cleanup *before* opening
    // it, so the callback never touches an uninitialised binding and a
    // setup-time close is still removed from the live set.
    const box: { connection?: SseConnection } = {};
    const onCleanup = (): void => {
      if (box.connection) {
        connections.delete(box.connection);
      }
      request.log.info({ tournamentId }, 'SSE connection closed');
    };

    // The adapter registers disconnect detection before it subscribes or starts
    // the heartbeat, so a client that leaves during setup still ends with no
    // subscription and no timer. It reports cleanup here so shutdown can end it.
    const connection = openSseConnection({
      tournamentId,
      publisher,
      request: request.raw,
      response,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      ...(options.scheduler ? { scheduler: options.scheduler } : {}),
      logger: {
        error: (details: unknown, message?: string) => {
          request.log.error(details, message);
        },
        warn: (details: unknown, message?: string) => {
          request.log.warn(details, message);
        },
      },
      onCleanup,
    });

    box.connection = connection;

    // `openSseConnection` may have closed (and thus cleaned up) before returning
    // if the client was already gone; only track a connection that is still live.
    if (!connection.isClosed()) {
      connections.add(connection);
      request.log.info({ tournamentId }, 'SSE connection opened');
    }
  });
};

/**
 * Detaches the response from Fastify so the stream can outlive the normal
 * request lifecycle and be written to directly.
 *
 * Because hijacking skips Fastify's `onSend` phase, `@fastify/cors` never runs
 * for this response; the approved CORS headers are applied here instead so a
 * cross-origin `EventSource` is not blocked.
 */
function hijackForSse(
  reply: FastifyReply,
  origin: string | undefined,
  corsOrigins: readonly string[],
): FastifyReply['raw'] {
  const response = reply.raw;
  reply.hijack();
  applyHijackedCorsHeaders(response, origin, corsOrigins);
  return response;
}
