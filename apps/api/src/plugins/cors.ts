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
