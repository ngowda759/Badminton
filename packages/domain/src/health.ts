/**
 * Liveness of the API process itself.
 *
 * `ok` means the process is serving requests. It says nothing about
 * downstream dependencies - see `DatabaseStatus` for that.
 */
export const API_STATUSES = ['ok', 'degraded'] as const;
export type ApiStatus = (typeof API_STATUSES)[number];

/** Reachability of the primary datastore as observed by the API. */
export const DATABASE_STATUSES = ['connected', 'disconnected'] as const;
export type DatabaseStatus = (typeof DATABASE_STATUSES)[number];

/**
 * Payload returned by `GET /health`.
 *
 * Deliberately minimal: it must never carry connection strings, credentials,
 * driver error text or filesystem paths.
 */
export interface HealthResponse {
  readonly status: ApiStatus;
  readonly database: DatabaseStatus;
}
