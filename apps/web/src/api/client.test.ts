import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from './client.ts';

/** Builds a `Response` for a stub fetch. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch stub that always resolves with the given response. */
function respondingWith(response: Response): typeof fetch {
  const impl: typeof fetch = () => Promise.resolve(response);
  return vi.fn(impl);
}

/** A fetch stub that always rejects with the given error. */
function rejectingWith(error: unknown): typeof fetch {
  const impl: typeof fetch = () => {
    throw error;
  };
  return vi.fn(impl);
}

function clientWith(fetchImpl: typeof fetch) {
  return createApiClient({ baseUrl: 'http://api.test', fetchImpl });
}

describe('createApiClient', () => {
  it('unwraps the data envelope on success', async () => {
    const client = clientWith(
      respondingWith(jsonResponse(200, { data: { id: 'abc', name: 'Autumn Open' } })),
    );

    await expect(client.get('/api/v1/tournaments/abc')).resolves.toEqual({
      id: 'abc',
      name: 'Autumn Open',
    });
  });

  it('sends the configured base URL, method and JSON body', async () => {
    const fetchImpl = respondingWith(jsonResponse(201, { data: { id: 'x' } }));
    const client = clientWith(fetchImpl);

    await client.post('/api/v1/tournaments', { name: 'Open' });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://api.test/api/v1/tournaments');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'Open' }));
  });

  it('returns undefined for a 204 without parsing a body', async () => {
    const client = clientWith(respondingWith(new Response(null, { status: 204 })));

    await expect(client.delete('/api/v1/teams/t/members/p')).resolves.toBeUndefined();
  });

  it('maps the error envelope onto ApiError with code and details', async () => {
    const client = clientWith(
      respondingWith(
        jsonResponse(409, {
          error: { code: 'CONFLICT', message: 'A player with this email address already exists.' },
        }),
      ),
    );

    const error = await client.post('/api/v1/players', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'CONFLICT',
      message: 'A player with this email address already exists.',
    });
  });

  it('keeps field-level validation details', async () => {
    const client = clientWith(
      respondingWith(
        jsonResponse(400, {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed.',
            details: [{ path: 'name', message: 'Name must not be empty.' }],
          },
        }),
      ),
    );

    const error = await client.post('/api/v1/tournaments', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details).toEqual([
      { path: 'name', message: 'Name must not be empty.' },
    ]);
  });

  it('never exposes internal detail for a 500', async () => {
    const client = clientWith(
      respondingWith(
        jsonResponse(500, {
          error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred.' },
        }),
      ),
    );

    const error = (await client
      .get('/api/v1/tournaments/x')
      .catch((caught: unknown) => caught)) as ApiError;
    expect(error.message).toBe('An unexpected error occurred.');
    expect(error.message).not.toMatch(/prisma|sql|stack/i);
  });

  it('normalises a network failure into a safe ApiError', async () => {
    const client = clientWith(rejectingWith(new TypeError('Failed to fetch')));

    const error = (await client
      .get('/api/v1/tournaments/x')
      .catch((caught: unknown) => caught)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.code).toBe('NETWORK_ERROR');
    expect(error.isNetworkError).toBe(true);
  });

  it('rejects a malformed success body', async () => {
    const client = clientWith(respondingWith(new Response('not json', { status: 200 })));

    const error = (await client
      .get('/api/v1/tournaments/x')
      .catch((caught: unknown) => caught)) as ApiError;
    expect(error.code).toBe('INVALID_RESPONSE');
  });
});
