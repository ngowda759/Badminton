import type { ApiStatus } from './health.ts';

/** Logical service name, used as the key of the `ServiceHealth` map. */
export type ServiceName = 'database';

/**
 * Outcome of probing a single downstream dependency.
 *
 * `latencyMs` is optional because a probe that fails before any round trip
 * completes has no meaningful duration to report.
 */
export interface ServiceHealth {
  readonly name: ServiceName;
  readonly status: 'up' | 'down';
  readonly latencyMs?: number;
}

/** Machine-readable failure reasons, safe to expose to clients. */
export type HealthCheckFailureReason = 'timeout' | 'unreachable';

/**
 * A dependency probe. Implementations live in infrastructure packages so that
 * services never import a driver directly.
 */
export interface HealthCheck {
  readonly name: ServiceName;
  check(): Promise<ServiceHealth>;
}

/**
 * Aggregate health of the API and everything it depends on.
 *
 * `status` is `ok` only when every dependency is up.
 */
export interface SystemHealth {
  readonly status: ApiStatus;
  readonly services: readonly ServiceHealth[];
}
