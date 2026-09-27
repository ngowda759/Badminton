import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadEnvironmentFiles } from '@badminton/config';

/**
 * `.env` discovery for `@badminton/config`.
 *
 * npm runs workspace scripts with the workspace directory as `cwd`, so the API
 * starts in `apps/api` while `.env` lives at the repository root. These tests
 * pin the upward search that bridges the two; without it `npm run dev` fails to
 * start the API from a clean checkout.
 */

describe('loadEnvironmentFiles', () => {
  let scratch: string | undefined;

  afterEach(() => {
    if (scratch) {
      rmSync(scratch, { recursive: true, force: true });
      scratch = undefined;
    }
    delete process.env.BADMINTON_ENV_LOADER_PROBE;
  });

  function createFakeRepo(envContents: string): { root: string; nested: string } {
    const root = mkdtempSync(join(tmpdir(), 'badminton-env-loader-'));
    mkdirSync(join(root, '.git'));
    const nested = join(root, 'apps', 'api');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(root, '.env'), envContents);
    scratch = root;
    return { root, nested };
  }

  it('finds .env at the repository root from a nested workspace directory', () => {
    const { nested } = createFakeRepo(`BADMINTON_ENV_LOADER_PROBE=from-root\n`);

    loadEnvironmentFiles(nested);

    expect(process.env.BADMINTON_ENV_LOADER_PROBE).toBe('from-root');
  });

  it('reads .env from the current directory when that is the repository root', () => {
    const { root } = createFakeRepo(`BADMINTON_ENV_LOADER_PROBE=from-root\n`);

    loadEnvironmentFiles(root);

    expect(process.env.BADMINTON_ENV_LOADER_PROBE).toBe('from-root');
  });

  it('leaves a value already present in the environment untouched', () => {
    const { nested } = createFakeRepo(`BADMINTON_ENV_LOADER_PROBE=from-file\n`);
    process.env.BADMINTON_ENV_LOADER_PROBE = 'from-environment';

    loadEnvironmentFiles(nested);

    // CI- and container-provided configuration stays authoritative.
    expect(process.env.BADMINTON_ENV_LOADER_PROBE).toBe('from-environment');
  });

  it('does nothing harmful when no .env file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'badminton-env-loader-'));
    scratch = root;

    expect(() => {
      loadEnvironmentFiles(root);
    }).not.toThrow();
    expect(process.env.BADMINTON_ENV_LOADER_PROBE).toBeUndefined();
  });
});
