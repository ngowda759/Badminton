import type { HealthCheck, HealthResponse, ServiceHealth } from '@badminton/domain';
import { healthResponseSchema } from '@badminton/validation';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/api/src/app.ts';

/**
 * Integration tests for `GET /health`.
 *
 * `buildApp` is the application factory: it returns a fully wired Fastify
 * instance without binding a socket, so these tests run through the real
 * routing, error-handler and serialisation stack via `app.inject()` with no
 * server or database process required.
 */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function stubCheck(status: 'up' | 'down'): HealthCheck {
  return {
    name: 'database',
    check: () => Promise.resolve<ServiceHealth>({ name: 'database', status }),
  };
}

function createTestApp(checks: readonly HealthCheck[]): FastifyInstance {
  app = buildApp({ checks, corsOrigins: [] });
  return app;
}

describe('GET /health', () => {
  it('returns 200 with a healthy payload when the database is reachable', async () => {
    const response = await createTestApp([stubCheck('up')]).inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<HealthResponse>()).toEqual({ status: 'ok', database: 'connected' });
  });

  it('returns 503 with a degraded payload when the database is unreachable', async () => {
    const response = await createTestApp([stubCheck('down')]).inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json<HealthResponse>()).toEqual({
      status: 'degraded',
      database: 'disconnected',
    });
  });

  // Regression: with no probes registered the service used to answer
  // `{ status: 'ok', database: 'disconnected' }` with HTTP 200, because
  // `Array.prototype.every` is true for an empty array. Status and body must
  // agree, and the route must surface 503.
  it('returns 503, not 200, when no database check is registered', async () => {
    const response = await createTestApp([]).inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json<HealthResponse>()).toEqual({
      status: 'degraded',
      database: 'disconnected',
    });
  });

  it('satisfies the shared contract consumed by the web client', async () => {
    const response = await createTestApp([stubCheck('up')]).inject({
      method: 'GET',
      url: '/health',
    });

    expect(healthResponseSchema.safeParse(response.json()).success).toBe(true);
  });

  it('advertises itself as JSON', async () => {
    const response = await createTestApp([stubCheck('up')]).inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.headers['content-type']).toContain('application/json');
  });

  it('exposes only status and database fields', async () => {
    const response = await createTestApp([stubCheck('up')]).inject({
      method: 'GET',
      url: '/health',
    });

    expect(Object.keys(response.json<HealthResponse>()).sort()).toEqual(['database', 'status']);
  });

  it('does not leak connection details when the probe throws', async () => {
    const throwing: HealthCheck = {
      name: 'database',
      check: () =>
        Promise.reject(new Error('postgresql://user:hunter2@internal-host:5432/prod refused')),
    };

    // The probe is responsible for translating its own failures; this asserts
    // the API's error envelope stays clean when one does not.
    const response = await createTestApp([throwing]).inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(500);
    const body = response.body;
    expect(body).not.toContain('hunter2');
    expect(body).not.toContain('internal-host');
    expect(body).not.toContain('postgresql://');
    expect(body).not.toContain('at '); // no stack frames
  });

  it('returns a structured 404 for unknown routes', async () => {
    const response = await createTestApp([stubCheck('up')]).inject({
      method: 'GET',
      url: '/does-not-exist',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('rejects an unsupported method on /health with 404', async () => {
    const response = await createTestApp([stubCheck('up')]).inject({
      method: 'POST',
      url: '/health',
    });

    expect(response.statusCode).toBe(404);
  });
});
