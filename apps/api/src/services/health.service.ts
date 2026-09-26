import type { HealthCheck, HealthResponse, ServiceHealth } from '@badminton/domain';

/**
 * Turns a set of dependency probes into the `/health` contract.
 *
 * Business rules live here, not in the route: the route only serialises what
 * this returns and picks the HTTP status.
 */
export interface HealthService {
  getHealth(): Promise<HealthResponse>;
}

export function createHealthService(checks: readonly HealthCheck[]): HealthService {
  return {
    async getHealth(): Promise<HealthResponse> {
      const services = await Promise.all(checks.map((check) => check.check()));

      return {
        status: services.every((service) => service.status === 'up') ? 'ok' : 'degraded',
        database: toDatabaseStatus(services),
      };
    },
  };
}

/**
 * Projects probe results onto the single `database` field of the contract.
 *
 * Indexing by name rather than scanning keeps this total as more dependencies
 * are added in later phases. A probe that did not run at all (no database check
 * registered) is reported as `disconnected` rather than assumed healthy.
 */
function toDatabaseStatus(services: readonly ServiceHealth[]): HealthResponse['database'] {
  const byName = new Map(services.map((service) => [service.name, service]));
  return byName.get('database')?.status === 'up' ? 'connected' : 'disconnected';
}
