import type { HealthResponse } from '@badminton/domain';
import { parseHealthResponse } from '@badminton/validation';

/** Outcome of asking the API for its health. */
export type HealthResult =
  | { readonly kind: 'ok'; readonly health: HealthResponse }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'invalid' };

export interface HealthClient {
  fetchHealth(signal?: AbortSignal): Promise<HealthResult>;
}

export interface HealthClientOptions {
  readonly baseUrl: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

/**
 * HTTP client for `GET /health`.
 *
 * Normalises every failure mode - network error, non-JSON body, unexpected
 * shape - into a `HealthResult` so React components never see exceptions and
 * never need to interpret raw responses. A `503` is a valid answer here, not an
 * error: it carries the same payload as a `200` and tells the UI the API is up
 * while the database is not.
 */
export function createHealthClient(options: HealthClientOptions): HealthClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL('/health', options.baseUrl).toString();

  return {
    async fetchHealth(signal?: AbortSignal): Promise<HealthResult> {
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          ...(signal ? { signal } : {}),
        });

        if (response.status !== 200 && response.status !== 503) {
          return { kind: 'unreachable' };
        }

        const payload: unknown = await response.json();
        const health = parseHealthResponse(payload);

        return health ? { kind: 'ok', health } : { kind: 'invalid' };
      } catch {
        return { kind: 'unreachable' };
      }
    },
  };
}
