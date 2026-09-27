import type { HealthCheck, HealthResponse, ServiceHealth, ServiceName } from '@badminton/domain';

/**
 * Turns a set of dependency probes into the `/health` contract.
 *
 * Business rules live here, not in the route: the route only serialises what
 * this returns and picks the HTTP status.
 */
export interface HealthService {
  getHealth(): Promise<HealthResponse>;
}

/**
 * Dependencies the API is considered unhealthy without.
 *
 * Declared independently of the registered probes so health is driven by what
 * the service *requires*, not by what happens to be wired up. A required
 * dependency with no probe therefore reports degraded rather than healthy.
 */
const REQUIRED_SERVICES: readonly ServiceName[] = ['database'];

export function createHealthService(checks: readonly HealthCheck[]): HealthService {
  return {
    async getHealth(): Promise<HealthResponse> {
      const services = await Promise.all(checks.map((check) => check.check()));
      const byName = new Map(services.map((service) => [service.name, service]));

      // Fail closed. `Array.prototype.every` returns true for an empty array,
      // so testing only the registered probes would report a service with no
      // checks at all as healthy. Requiring REQUIRED_SERVICES instead means a
      // missing probe counts as down.
      const requiredAreUp = REQUIRED_SERVICES.every((name) => byName.get(name)?.status === 'up');
      const allProbesAreUp = services.every((service) => service.status === 'up');

      return {
        status: requiredAreUp && allProbesAreUp ? 'ok' : 'degraded',
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
