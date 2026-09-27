/**
 * Domain layer: framework-free contracts shared by the API, infrastructure
 * and (where relevant) the UI.
 *
 * Phase 1 exposes health only. Tournament concepts - Tournament, Player, Team,
 * Match, Group, Court, Score, Fixture, Ranking - are intentionally absent and
 * arrive in later phases.
 */
export { API_STATUSES, DATABASE_STATUSES } from './health.ts';
export type { ApiStatus, DatabaseStatus, HealthResponse } from './health.ts';
export type {
  HealthCheck,
  HealthCheckFailureReason,
  ServiceHealth,
  ServiceName,
  SystemHealth,
} from './system-health.ts';
