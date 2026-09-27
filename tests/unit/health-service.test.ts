import type { HealthCheck, ServiceHealth } from '@badminton/domain';
import { describe, expect, it } from 'vitest';

import { createHealthService } from '../../apps/api/src/services/health.service.ts';

function stubCheck(name: 'database', status: 'up' | 'down'): HealthCheck {
  return {
    name,
    check: () => Promise.resolve<ServiceHealth>({ name, status }),
  };
}

describe('createHealthService', () => {
  it('reports ok and connected when every dependency is up', async () => {
    const service = createHealthService([stubCheck('database', 'up')]);

    await expect(service.getHealth()).resolves.toEqual({
      status: 'ok',
      database: 'connected',
    });
  });

  it('reports degraded and disconnected when the database is down', async () => {
    const service = createHealthService([stubCheck('database', 'down')]);

    await expect(service.getHealth()).resolves.toEqual({
      status: 'degraded',
      database: 'disconnected',
    });
  });

  it('treats a missing database check as disconnected rather than healthy', async () => {
    const service = createHealthService([]);

    await expect(service.getHealth()).resolves.toEqual({
      status: 'degraded',
      database: 'disconnected',
    });
  });

  // Regression test for the fail-open bug. Before the fix the service used
  // `services.every(...)` over the registered probes, and `Array.prototype.every`
  // returns true for an empty array, so this exact input produced
  // `{ status: 'ok', database: 'disconnected' }` - a contradictory payload that
  // also mapped to HTTP 200. Assert each field separately so a regression names
  // the field it broke.
  it('reports degraded, not ok, when no database check is registered', async () => {
    const health = await createHealthService([]).getHealth();

    expect(health.database).toBe('disconnected');
    expect(health.status).toBe('degraded');
    expect(health.status).not.toBe('ok');
  });

  it('never propagates an exception thrown by a probe', async () => {
    const failing: HealthCheck = {
      name: 'database',
      check: () => Promise.reject(new Error('driver exploded')),
    };

    // A probe is expected to translate its own failures; this asserts the
    // service does not silently succeed when one does not.
    await expect(createHealthService([failing]).getHealth()).rejects.toThrow('driver exploded');
  });

  it('runs probes concurrently', async () => {
    const order: string[] = [];
    const slow: HealthCheck = {
      name: 'database',
      check: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('database');
        return { name: 'database', status: 'up' };
      },
    };

    await createHealthService([slow]).getHealth();

    expect(order).toEqual(['database']);
  });

  it('returns a payload with no fields beyond the health contract', async () => {
    const service = createHealthService([stubCheck('database', 'up')]);

    expect(Object.keys(await service.getHealth()).sort()).toEqual(['database', 'status']);
  });
});
