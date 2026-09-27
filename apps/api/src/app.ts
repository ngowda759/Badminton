import type { HealthCheck } from '@badminton/domain';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { API_V1_PREFIX, createApiV1Routes } from './http/routes/index.ts';
import type { ApiServices } from './http/api-services.ts';
import { registerCors } from './plugins/cors.ts';
import { registerErrorHandler } from './plugins/error-handler.ts';
import { healthRoutes } from './routes/health.route.ts';
import { createHealthService } from './services/health.service.ts';

/**
 * Everything the HTTP layer needs from its environment.
 *
 * Passing dependencies in (rather than reading `process.env` or constructing a
 * Prisma client here) is what lets tests build a real Fastify instance with
 * stubbed probes and fake services and no running database.
 */
export interface BuildAppOptions {
  readonly checks: readonly HealthCheck[];
  readonly corsOrigins: readonly string[];
  /**
   * Application services exposed under `/api/v1`. Optional so the Phase 1
   * health-only composition (and its tests) keeps working unchanged.
   */
  readonly services?: ApiServices;
  readonly logger?: FastifyServerOptions['logger'];
  /**
   * Whether to trust `X-Forwarded-*` headers. Defaults to `false` so that a
   * misconfigured deployment fails closed rather than honouring client-supplied
   * proxy headers.
   */
  readonly trustProxy?: boolean;
}

/**
 * Application factory: creates a fully wired Fastify instance.
 *
 * Calling this does not bind a socket - `server.ts` owns `listen` and the
 * shutdown sequence.
 */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: options.trustProxy ?? false,
  });

  registerErrorHandler(app);

  const healthService = createHealthService(options.checks);

  app.register(async (instance) => {
    await registerCors(instance, options.corsOrigins);
    await instance.register(healthRoutes, { healthService });

    if (options.services) {
      await instance.register(createApiV1Routes(options.services), { prefix: API_V1_PREFIX });
    }
  });

  return app;
}
