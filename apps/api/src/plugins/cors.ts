import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

/**
 * Registers CORS with an explicit allowlist.
 *
 * The allowed origins come from `CORS_ORIGINS`; when the list is empty CORS is
 * disabled entirely (`origin: false`) rather than falling back to a wildcard,
 * so a misconfigured deployment fails closed.
 */
export async function registerCors(
  app: FastifyInstance,
  allowedOrigins: readonly string[],
): Promise<void> {
  await app.register(cors, {
    origin: allowedOrigins.length > 0 ? [...allowedOrigins] : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: false,
  });
}

/** The slice of `http.ServerResponse` this header helper needs. */
export interface CorsHeaderTarget {
  setHeader(name: string, value: string): void;
  getHeader(name: string): number | string | readonly string[] | undefined;
}

/**
 * Adds the approved CORS headers to a response that Fastify will not finalise.
 *
 * `reply.hijack()` hands the raw socket to the SSE adapter before Fastify's
 * `onSend` phase, so the `@fastify/cors` hook never runs for a stream and the
 * response carries no `Access-Control-Allow-Origin`. A browser applies CORS to
 * `EventSource` exactly as it does to `fetch`, so without these headers a
 * cross-origin realtime stream is blocked even though the same API's normal
 * requests succeed. Only explicitly allowed origins are reflected; anything else
 * is left untouched. Normal, non-hijacked requests are unaffected and keep being
 * handled entirely by `@fastify/cors`.
 */
export function applyHijackedCorsHeaders(
  response: CorsHeaderTarget,
  origin: string | undefined,
  allowedOrigins: readonly string[],
): void {
  if (!origin || !allowedOrigins.includes(origin)) {
    return;
  }
  const vary = response.getHeader('Vary');
  const varyValue = Array.isArray(vary) ? vary.join(', ') : typeof vary === 'string' ? vary : '';
  if (!varyValue.split(',').some((entry) => entry.trim() === 'Origin')) {
    response.setHeader('Vary', varyValue.length > 0 ? `${varyValue}, Origin` : 'Origin');
  }
  response.setHeader('Access-Control-Allow-Origin', origin);
}
