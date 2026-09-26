import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '@badminton/config';
import { parseCorsOrigins, parseServerEnv, serverEnvSchema } from '@badminton/config';

const VALID_ENV = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
} as const;

describe('server environment validation', () => {
  it('applies documented defaults when optional variables are absent', () => {
    const env = parseServerEnv({ ...VALID_ENV });

    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.CORS_ORIGINS).toBe('');
  });

  it('coerces numeric ports supplied as strings', () => {
    const env = parseServerEnv({ ...VALID_ENV, API_PORT: '8080' });

    expect(env.API_PORT).toBe(8080);
  });

  it('rejects a missing DATABASE_URL', () => {
    const result = serverEnvSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects a DATABASE_URL with a non-postgres scheme', () => {
    const result = serverEnvSchema.safeParse({ DATABASE_URL: 'mysql://localhost:3306/db' });

    expect(result.success).toBe(false);
  });

  it('rejects out-of-range and non-numeric ports', () => {
    expect(serverEnvSchema.safeParse({ ...VALID_ENV, API_PORT: '0' }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...VALID_ENV, API_PORT: '70000' }).success).toBe(false);
    expect(serverEnvSchema.safeParse({ ...VALID_ENV, API_PORT: 'abc' }).success).toBe(false);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(serverEnvSchema.safeParse({ ...VALID_ENV, NODE_ENV: 'staging' }).success).toBe(false);
  });

  it('does not include variable values in the failure message', () => {
    const secret = 'super-secret-password';
    let caught: unknown;

    try {
      parseServerEnv({ DATABASE_URL: `not-a-url://${secret}` });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigurationError);
    expect((caught as Error).message).not.toContain(secret);
    expect((caught as Error).message).toContain('DATABASE_URL');
  });
});

describe('parseCorsOrigins', () => {
  it('returns an empty list for an empty string', () => {
    expect(parseCorsOrigins('')).toEqual([]);
  });

  it('splits, trims and drops empty entries', () => {
    expect(parseCorsOrigins(' http://localhost:5173 , https://example.com ,')).toEqual([
      'http://localhost:5173',
      'https://example.com',
    ]);
  });
});
