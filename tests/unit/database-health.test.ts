import type { DatabaseProbe } from '@badminton/database';
import { createDatabaseHealthCheck } from '@badminton/database';
import { describe, expect, it, vi } from 'vitest';

function createProbe(ping: () => Promise<void>): DatabaseProbe {
  return { ping };
}

describe('createDatabaseHealthCheck', () => {
  it('reports up with a latency measurement when the probe succeeds', async () => {
    const probe = createProbe(() => Promise.resolve());
    const check = createDatabaseHealthCheck(probe, { now: () => 0 });

    await expect(check.check()).resolves.toEqual({
      name: 'database',
      status: 'up',
      latencyMs: 0,
    });
  });

  it('measures elapsed time with the injected clock', async () => {
    let tick = 100;
    const check = createDatabaseHealthCheck(
      createProbe(() => Promise.resolve()),
      {
        now: () => (tick += 25),
      },
    );

    const result = await check.check();

    expect(result.status).toBe('up');
    expect(result.latencyMs).toBe(25);
  });

  it('reports down when the probe rejects', async () => {
    const probe = createProbe(() => Promise.reject(new Error('connection refused')));
    const check = createDatabaseHealthCheck(probe);

    await expect(check.check()).resolves.toEqual({ name: 'database', status: 'down' });
  });

  it('reports down instead of throwing on a non-Error rejection', async () => {
    // Deliberately rejects with a non-Error to prove the probe is defensive.
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    const probe = createProbe(() => Promise.reject('boom'));
    const check = createDatabaseHealthCheck(probe);

    await expect(check.check()).resolves.toEqual({ name: 'database', status: 'down' });
  });

  it('reports down when the probe exceeds the timeout budget', async () => {
    const probe = createProbe(() => new Promise<void>((resolve) => setTimeout(resolve, 1_000)));
    const check = createDatabaseHealthCheck(probe, { timeoutMs: 5 });

    await expect(check.check()).resolves.toEqual({ name: 'database', status: 'down' });
  });

  it('never surfaces the underlying error message', async () => {
    const probe = createProbe(() =>
      Promise.reject(new Error('postgresql://user:hunter2@internal-host:5432/prod')),
    );
    const check = createDatabaseHealthCheck(probe);

    const result = await check.check();

    expect(JSON.stringify(result)).not.toContain('hunter2');
    expect(JSON.stringify(result)).not.toContain('internal-host');
  });

  it('invokes the probe on every call rather than caching the first result', async () => {
    const ping = vi.fn(() => Promise.resolve());
    const check = createDatabaseHealthCheck(createProbe(ping));

    await check.check();
    await check.check();

    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('exposes the database service name', () => {
    const check = createDatabaseHealthCheck(createProbe(() => Promise.resolve()));

    expect(check.name).toBe('database');
  });
});
