import type { RealtimeEventPublisher } from '@badminton/application';
import { tournamentIdParamSchema } from '@badminton/validation';
import type { FastifyPluginCallback, FastifyReply } from 'fastify';

import type { ApiRealtime } from '../api-realtime.ts';
import { validate } from '../request.ts';
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

    const response = hijackForSse(reply);

    // Attach the disconnect listeners before opening so both sides of the socket
    // are covered; `detach` removes them once cleanup runs so no handler lingers.
    const rawConnection = openSseConnection({
      tournamentId,
      publisher,
      response,
      heartbeatIntervalMs: options.heartbeatIntervalMs,
      // A hijacked request can already be closed by the time we run.
      isRequestClosed: () => request.raw.destroyed || response.destroyed,
      ...(options.scheduler ? { scheduler: options.scheduler } : {}),
      logger: {
        error: (details: unknown, message?: string) => {
          request.log.error(details, message);
        },
      },
    });

    const connection: SseConnection = {
      close: () => {
        rawConnection.close();
        detach();
        connections.delete(connection);
      },
    };

    const detach = (): void => {
      request.raw.off('close', onClose);
      response.off('close', onClose);
    };
    const onClose = (): void => {
      connection.close();
    };

    connections.add(connection);
    request.raw.on('close', onClose);
    response.on('close', onClose);
  });
};

/**
 * Detaches the response from Fastify so the stream can outlive the normal
 * request lifecycle and be written to directly.
 */
function hijackForSse(reply: FastifyReply): FastifyReply['raw'] {
  const response = reply.raw;
  reply.hijack();
  return response;
}
