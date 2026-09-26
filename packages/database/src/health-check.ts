import type { HealthCheck, ServiceHealth } from '@badminton/domain';

import type { DatabaseProbe } from './probe.ts';

export interface DatabaseHealthCheckOptions {
  /** Per-attempt probe budget. A hung database must not hang `/health`. */
  readonly timeoutMs?: number;
  /** Injectable clock so latency assertions in tests are deterministic. */
  readonly now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 2_000;

/**
 * Adapts a `DatabaseProbe` into the domain `HealthCheck` contract.
 *
 * A failed or slow probe yields `status: 'down'`; the underlying error is
 * deliberately discarded so driver messages, SQL and connection details can
 * never reach an HTTP response or a log line.
 */
export function createDatabaseHealthCheck(
  probe: DatabaseProbe,
  options: DatabaseHealthCheckOptions = {},
): HealthCheck {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? ((): number => performance.now());

  return {
    name: 'database',
    async check(): Promise<ServiceHealth> {
      const startedAt = now();

      try {
        await withTimeout(probe.ping(), timeoutMs);
      } catch {
        return { name: 'database', status: 'down' };
      }

      return {
        name: 'database',
        status: 'up',
        latencyMs: Math.max(0, Math.round(now() - startedAt)),
      };
    },
  };
}

/** Rejects with a generic error if `operation` does not settle in time. */
function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('database probe timed out'));
    }, timeoutMs);

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('database probe failed'));
      },
    );
  });
}
