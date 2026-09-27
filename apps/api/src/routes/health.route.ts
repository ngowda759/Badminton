import type { HealthResponse } from '@badminton/domain';
import type { FastifyPluginCallback } from 'fastify';

import type { HealthService } from '../services/health.service.ts';

/** HTTP status rules for `/health`. */
export const HEALTHY_STATUS_CODE = 200;
export const DEGRADED_STATUS_CODE = 503;

const healthResponseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'database'],
  properties: {
    status: { type: 'string', enum: ['ok', 'degraded'] },
    database: { type: 'string', enum: ['connected', 'disconnected'] },
  },
} as const;

export interface HealthRoutesOptions {
  readonly healthService: HealthService;
}

/**
 * `GET /health` - liveness of the API plus reachability of PostgreSQL.
 *
 * The handler holds no business logic: it delegates to the health service and
 * maps the result onto an HTTP status. `200` means everything is up; `503`
 * means the process is alive but a dependency is not, which is what uptime
 * monitors and load balancers need in order to stop routing traffic.
 */
export const healthRoutes: FastifyPluginCallback<HealthRoutesOptions> = (app, options) => {
  const { healthService } = options;

  app.get(
    '/health',
    {
      schema: {
        tags: ['system'],
        summary: 'API and database health',
        response: { 200: healthResponseJsonSchema, 503: healthResponseJsonSchema },
      },
    },
    async (_request, reply) => {
      const health: HealthResponse = await healthService.getHealth();
      const statusCode = health.status === 'ok' ? HEALTHY_STATUS_CODE : DEGRADED_STATUS_CODE;

      return reply.status(statusCode).send(health);
    },
  );
};
