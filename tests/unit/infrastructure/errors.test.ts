import { Prisma } from '@badminton/database';
import { ConflictError, PersistenceError, ValidationError } from '@badminton/domain';
import { toApplicationError, translatePersistenceErrors } from '@badminton/infrastructure';
import { describe, expect, it } from 'vitest';

/**
 * Repository error-translation tests.
 *
 * Verify that known database constraint failures become application errors with
 * safe messages, while application errors pass through untouched.
 */

function knownError(
  code: string,
  options: { meta?: Record<string, unknown>; message?: string } = {},
): Error {
  return new Prisma.PrismaClientKnownRequestError(options.message ?? 'raw driver detail', {
    code,
    clientVersion: '7.10.0',
    ...(options.meta ? { meta: options.meta } : {}),
  });
}

describe('toApplicationError', () => {
  it('maps a known unique constraint to a ConflictError with a safe message', () => {
    const error = toApplicationError(
      knownError('P2002', { meta: { target: ['players_email_key'] } }),
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toMatch(/email/i);
    expect(error.message).not.toMatch(/players_email_key|raw driver detail/);
  });

  it('resolves the constraint name embedded in the driver message', () => {
    const error = toApplicationError(
      knownError('P2002', {
        meta: { target: ['categoryId', 'teamId'] },
        message: 'Unique constraint failed: public.entries_category_team_key',
      }),
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toMatch(/already registered in this category/i);
    expect(error.message).not.toMatch(/entries_category_team_key/);
  });

  it('resolves a schema-qualified constraint name in the target', () => {
    const error = toApplicationError(
      knownError('P2002', { meta: { target: 'public.players_phone_key' } }),
    );
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toMatch(/phone/i);
  });

  it('falls back to a generic conflict for an unknown unique target', () => {
    const error = toApplicationError(knownError('P2002', { meta: { target: ['something_else'] } }));
    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).not.toMatch(/something_else/);
  });

  it('maps a foreign-key violation to a ConflictError', () => {
    expect(toApplicationError(knownError('P2003'))).toBeInstanceOf(ConflictError);
  });

  it('maps a malformed persistence request to a ValidationError', () => {
    const error = toApplicationError(
      new Prisma.PrismaClientValidationError('bad request detail', { clientVersion: '7.10.0' }),
    );
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).not.toMatch(/bad request detail/);
  });

  it('maps an unknown error to a PersistenceError without leaking detail', () => {
    const error = toApplicationError(new Error('connection string postgres://secret'));
    expect(error).toBeInstanceOf(PersistenceError);
    expect(error.message).not.toMatch(/secret|postgres/);
  });
});

describe('translatePersistenceErrors', () => {
  it('returns the operation result on success', async () => {
    await expect(translatePersistenceErrors(() => Promise.resolve(42))).resolves.toBe(42);
  });

  it('passes an application error through unchanged', async () => {
    const original = new ConflictError('domain conflict');
    await expect(translatePersistenceErrors(() => Promise.reject(original))).rejects.toBe(original);
  });

  it('translates a raw persistence failure', async () => {
    await expect(
      translatePersistenceErrors(() =>
        Promise.reject(knownError('P2002', { meta: { target: ['players_email_key'] } })),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
