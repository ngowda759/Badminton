import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { config as loadDotenv } from 'dotenv';

import { ConfigurationError } from './errors.ts';
import { serverEnvSchema, type ServerEnv } from './schema.ts';

export * from './errors.ts';
export * from './schema.ts';

let cachedServerEnv: ServerEnv | undefined;

/**
 * Walks up from `startDir` looking for the repository root (the directory
 * holding `.git`).
 *
 * npm runs workspace scripts with the workspace directory as `cwd`, so the API
 * starts in `apps/api` and would otherwise look for `.env` there instead of at
 * the repo root where it lives. Resolving upward keeps `npm run dev` working
 * from either location.
 */
function findRepoRoot(startDir: string): string | undefined {
  let current = resolve(startDir);

  for (;;) {
    if (existsSync(resolve(current, '.git'))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

/**
 * Loads `.env.local` (machine overrides) then `.env` into `process.env`.
 *
 * Files are read from the repository root and from `cwd`; the closer file wins
 * because dotenv keeps the first value it sets for a key. Values already present
 * in `process.env` always win, which keeps CI-provided and container-provided
 * configuration authoritative.
 */
export function loadEnvironmentFiles(cwd: string = process.cwd()): void {
  const repoRoot = findRepoRoot(cwd);

  const candidates = [resolve(cwd, '.env.local'), resolve(cwd, '.env')];
  if (repoRoot && repoRoot !== resolve(cwd)) {
    candidates.push(resolve(repoRoot, '.env.local'), resolve(repoRoot, '.env'));
  }

  loadDotenv({ path: candidates, quiet: true });
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
