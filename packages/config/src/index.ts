import { resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { ConfigurationError } from './errors.ts';
import { serverEnvSchema, type ServerEnv } from './schema.ts';

export * from './errors.ts';
export * from './schema.ts';

let cachedServerEnv: ServerEnv | undefined;

/**
 * Loads `.env.local` (machine overrides) then `.env` into `process.env`.
 *
 * Values already present in `process.env` always win, which keeps CI-provided
 * and container-provided configuration authoritative.
 */
export function loadEnvironmentFiles(cwd: string = process.cwd()): void {
  loadDotenv({
    path: [resolve(cwd, '.env.local'), resolve(cwd, '.env')],
    quiet: true,
  });
}

/**
 * Reads, validates and caches server-side configuration.
 *
 * The thrown `ConfigurationError` lists variable names and constraint
 * violations only - never their values.
 */
export function getServerEnv(cwd?: string): ServerEnv {
  if (cachedServerEnv) {
    return cachedServerEnv;
  }

  loadEnvironmentFiles(cwd);

  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new ConfigurationError(`Invalid server configuration: ${result.error.message}`);
  }

  cachedServerEnv = result.data;
  return cachedServerEnv;
}

/** Clears the memoised server configuration. Intended for tests only. */
export function resetServerEnvCache(): void {
  cachedServerEnv = undefined;
}
