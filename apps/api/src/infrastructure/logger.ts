import type { FastifyServerOptions } from 'fastify';

/**
 * Keys scrubbed from every log record.
 *
 * Defence in depth: the connection string is never handed to the logger in the
 * first place, but redaction guarantees that a future `log.info({ config })`
 * cannot leak credentials.
 */
const REDACT_PATHS = [
  'DATABASE_URL',
  'databaseUrl',
  'connectionString',
  'password',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

/**
 * Builds the Fastify logger option from validated configuration.
 *
 * `enabled: false` is used by tests so they can inject the app without
 * emitting log noise.
 */
export function createLoggerOptions(options: {
  readonly level: string;
  readonly enabled: boolean;
}): FastifyServerOptions['logger'] {
  if (!options.enabled) {
    return false;
  }

  return {
    level: options.level,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
}
