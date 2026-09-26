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
}

export function createApiConfig(env: ServerEnv): ApiConfig {
  return {
    port: env.API_PORT,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),
    logger: createLoggerOptions({ level: env.LOG_LEVEL, enabled: true }),
    databaseUrl: env.DATABASE_URL,
  };
}
