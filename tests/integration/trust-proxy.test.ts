import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../apps/api/src/app.ts';

/**
 * `trustProxy` controls whether `X-Forwarded-*` headers are believed.
 *
 * Those headers are client-controlled unless a reverse proxy that overwrites
 * them sits in front of the API, so the default must be to ignore them: a
 * forged `X-Forwarded-For` would otherwise let a client choose its own
 * apparent IP address.
 *
 * The flag is asserted behaviourally rather than by reading it back, because
 * Fastify does not expose `trustProxy` on `initialConfig`. A throwaway route is
 * registered on the instance so `request.ip` can be observed directly.
 */

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const FORWARDED_FOR = '203.0.113.9';
const LOOPBACK = '127.0.0.1';

function createAppWithIpProbe(trustProxy: boolean): FastifyInstance {
  app = buildApp({ checks: [], corsOrigins: [], trustProxy });
  app.get('/__ip', (request) => ({ ip: request.ip }));
  return app;
}

async function requestIp(trustProxy: boolean): Promise<string> {
  const response = await createAppWithIpProbe(trustProxy).inject({
    method: 'GET',
    url: '/__ip',
    headers: { 'x-forwarded-for': FORWARDED_FOR },
  });

  return response.json<{ ip: string }>().ip;
}

describe('trustProxy', () => {
  it('ignores a forwarded header when trustProxy is disabled', async () => {
    await expect(requestIp(false)).resolves.toBe(LOOPBACK);
  });

  it('honours a forwarded header only when trustProxy is enabled', async () => {
    await expect(requestIp(true)).resolves.toBe(FORWARDED_FOR);
  });

  it('defaults to disabled so the app never trusts forwarded headers implicitly', async () => {
    app = buildApp({ checks: [], corsOrigins: [] });
    app.get('/__ip', (request) => ({ ip: request.ip }));

    const response = await app.inject({
      method: 'GET',
      url: '/__ip',
      headers: { 'x-forwarded-for': FORWARDED_FOR },
    });

    expect(response.json<{ ip: string }>().ip).toBe(LOOPBACK);
  });
});
