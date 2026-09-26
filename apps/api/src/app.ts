import type { HealthCheck } from '@badminton/domain';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { registerCors } from './plugins/cors.ts';
import { registerErrorHandler } from './plugins/error-handler.ts';
import { healthRoutes } from './routes/health.route.ts';
import { createHealthService } from './services/health.service.ts';

/**
 * Everything the HTTP layer needs from its environment.
 *
 * Passing dependencies in (rather than reading `process.env` or constructing a
 * Prisma client here) is what lets tests build a real Fastify instance with
 * stubbed probes and no running database.
 */
export interface BuildAppOptions {
  readonly checks: readonly HealthCheck[];
  readonly corsOrigins: readonly string[];
  readonly logger?: FastifyServerOptions['logger'];
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
    trustProxy: true,
  });

  registerErrorHandler(app);

  const healthService = createHealthService(options.checks);

  app.register(async (instance) => {
    await registerCors(instance, options.corsOrigins);
    await instance.register(healthRoutes, { healthService });
  });

  return app;
}
