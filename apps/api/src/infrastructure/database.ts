import { createDatabaseHealthCheck, type DatabaseConnection } from '@badminton/database';
import type { HealthCheck } from '@badminton/domain';

/** Per-attempt budget for the database probe issued by `GET /health`. */
export const DATABASE_HEALTH_TIMEOUT_MS = 2_000;

/**
 * Composes the persistence layer into the checks the API exposes.
 *
 * Kept in `infrastructure` so that the API's service and route layers depend
 * only on the domain `HealthCheck` contract, never on Prisma.
 */
export function createDatabaseHealthChecks(connection: DatabaseConnection): readonly HealthCheck[] {
  return [createDatabaseHealthCheck(connection.probe, { timeoutMs: DATABASE_HEALTH_TIMEOUT_MS })];
}
