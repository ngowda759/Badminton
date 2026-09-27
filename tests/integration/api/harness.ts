import type { HealthCheck, ServiceHealth } from '@badminton/domain';
import type { FastifyInstance } from 'fastify';

import { buildApp } from '../../../apps/api/src/app.ts';
import { createApiServices } from '../../../apps/api/src/composition/api-services.ts';
import type { ApiServices } from '../../../apps/api/src/http/api-services.ts';
import { createFakeRepositories } from '../../unit/application/fake-repositories.ts';

/**
 * Shared wiring for the HTTP route tests.
 *
 * The app is built with the real Fastify composition and the *real* application
 * services, but over the in-memory fake repositories instead of Prisma. That
 * exercises everything the HTTP layer owns - routing, Zod validation, error
 * mapping, response envelopes - plus the actual service rules, while remaining
 * fast and database-free. The vertical-slice suite separately proves the same
 * stack against real PostgreSQL.
 */

/** A database probe that always reports up, so `/health` is deterministic. */
export function stubHealthCheck(): HealthCheck {
  return {
    name: 'database',
    check: () => Promise.resolve<ServiceHealth>({ name: 'database', status: 'up' }),
  };
}

export interface TestApi {
  readonly app: FastifyInstance;
  readonly services: ApiServices;
}

/** Builds a Fastify app whose `/api/v1` services run over fake repositories. */
export function createTestApi(): TestApi {
  const fakes = createFakeRepositories();
  const services = createApiServices(fakes.client, fakes.unitOfWork);
  const app = buildApp({ checks: [stubHealthCheck()], corsOrigins: [], services });
  return { app, services };
}
