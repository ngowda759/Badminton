import { healthResponseSchema, parseHealthResponse, parseRequest } from '@badminton/validation';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

describe('healthResponseSchema', () => {
  it('accepts a healthy payload', () => {
    const result = healthResponseSchema.safeParse({ status: 'ok', database: 'connected' });

    expect(result.success).toBe(true);
  });

  it('accepts a degraded payload', () => {
    const result = healthResponseSchema.safeParse({ status: 'degraded', database: 'disconnected' });

    expect(result.success).toBe(true);
  });

  it('rejects unknown status values', () => {
    expect(
      healthResponseSchema.safeParse({ status: 'healthy', database: 'connected' }).success,
    ).toBe(false);
  });

  it('rejects payloads with missing fields', () => {
    expect(healthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });

  it('returns undefined from parseHealthResponse for invalid input', () => {
    expect(parseHealthResponse({ status: 'ok' })).toBeUndefined();
    expect(parseHealthResponse(null)).toBeUndefined();
    expect(parseHealthResponse({ status: 'ok', database: 'connected' })).toEqual({
      status: 'ok',
      database: 'connected',
    });
  });
});

describe('parseRequest', () => {
  const schema = z.object({
    page: z.coerce.number().int().min(1),
    search: z.string().min(1).optional(),
  });

  it('returns typed data on success', () => {
    const result = parseRequest(schema, { page: '2', search: 'shuttle' });

    expect(result).toEqual({ success: true, data: { page: 2, search: 'shuttle' } });
  });

  it('returns a failure with dotted paths instead of throwing', () => {
    const result = parseRequest(schema, { page: 0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failure.issues).toHaveLength(1);
      expect(result.failure.issues[0]?.path).toBe('page');
    }
  });

  it('reports a root path for non-object input', () => {
    const result = parseRequest(schema, 'not-an-object');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failure.issues.every((issue) => issue.path === '(root)')).toBe(true);
    }
  });

  it('collects every issue rather than stopping at the first', () => {
    const result = parseRequest(schema, { page: -1, search: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failure.issues.map((issue) => issue.path).sort()).toEqual(['page', 'search']);
    }
  });
});
