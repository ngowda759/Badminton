import { parseCorsOrigins, type ServerEnv } from '@badminton/config';
import type { FastifyServerOptions } from 'fastify';

import { createLoggerOptions } from '../infrastructure/logger.ts';

/**
 * Runtime configuration for the API process.
 *
 * Built once at startup from validated environment variables and passed down
 * explicitly, so no module has to reach into `process.env`.
 */
export interface ApiConfig {
  readonly port: number;
  readonly corsOrigins: readonly string[];
  readonly logger: FastifyServerOptions['logger'];
  readonly databaseUrl: string;
  /**
   * Whether to trust `X-Forwarded-*` headers.
   *
   * Defaults to false: those headers are client-controlled unless a reverse
   * proxy that overwrites them is known to be in front of the API. Only enable
   * this where such a proxy exists, since trusting them blindly lets a client
   * forge its own IP and protocol.
   */
  readonly trustProxy: boolean;
}

export function createApiConfig(env: ServerEnv): ApiConfig {
  return {
    port: env.API_PORT,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    logger: createLoggerOptions({ level: env.LOG_LEVEL, enabled: true }),
    databaseUrl: env.DATABASE_URL,
    trustProxy: env.TRUST_PROXY,
  };
}
