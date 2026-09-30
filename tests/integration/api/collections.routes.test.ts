import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApi, type TestApi } from './harness.ts';

/**
 * Collection endpoint tests: `GET /api/v1/tournaments`, `/players`, `/teams`.
 *
 * These run through the real Fastify stack and the real application services
 * over in-memory repositories, so they assert the HTTP contract of the list
 * endpoints: the response envelope, the list DTOs (and that no internal field
 * leaks), cursor pagination, deterministic ordering and boundary validation.
 */

interface ListBody<T> {
  readonly data: {
    readonly items: readonly T[];
    readonly nextCursor: string | null;
  };
}

interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly details?: readonly { readonly path: string; readonly message: string }[];
  };
}

let api: TestApi;
let app: FastifyInstance;

beforeEach(() => {
  api = createTestApi();
  app = api.app;
});

afterEach(async () => {
  await app.close();
});

async function createTournament(name: string): Promise<string> {
  const tournament = await api.services.tournaments.create({
    name,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-03T00:00:00.000Z'),
    timezone: 'Asia/Kolkata',
    location: 'Bengaluru',
  });
  return tournament.id;
}

async function createPlayer(name: string): Promise<string> {
  const player = await api.services.players.create({ name });
  return player.id;
}

describe('GET /api/v1/tournaments', () => {
  it('returns an empty page when no tournaments exist', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/tournaments' });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody<unknown>>();
    expect(body.data.items).toEqual([]);
    expect(body.data.nextCursor).toBeNull();
  });

  it('returns persisted tournaments with the list DTO fields', async () => {
    const id = await createTournament('Winter Cup');

    const response = await app.inject({ method: 'GET', url: '/api/v1/tournaments' });

    expect(response.statusCode).toBe(200);
    const body = response.json<ListBody<Record<string, unknown>>>();
    expect(body.data.items).toHaveLength(1);
    const item = body.data.items[0] as Record<string, unknown>;
    expect(item).toMatchObject({
      id,
      name: 'Winter Cup',
      status: 'DRAFT',
      location: 'Bengaluru',
      timezone: 'Asia/Kolkata',
    });
    expect(item.startDate).toBe('2026-10-01T00:00:00.000Z');
    expect(item.endDate).toBe('2026-10-03T00:00:00.000Z');
    expect(typeof item.createdAt).toBe('string');
    expect(typeof item.updatedAt).toBe('string');
  });

  it('makes a newly created tournament visible in the list (create → list)', async () => {
    const id = await createTournament('Winter Cup');

    const response = await app.inject({ method: 'GET', url: '/api/v1/tournaments' });

    expect(response.json<ListBody<{ id: string }>>().data.items.map((item) => item.id)).toContain(
      id,
    );
  });

  it('exposes exactly the documented fields and no database-internal ones', async () => {
    await createTournament('Winter Cup');

    const response = await app.inject({ method: 'GET', url: '/api/v1/tournaments' });
    const item = response.json<ListBody<Record<string, unknown>>>().data.items[0] as Record<
      string,
      unknown
    >;

    expect(Object.keys(item).sort()).toEqual(
      [
        'createdAt',
        'description',
        'endDate',
        'id',
        'location',
        'name',
        'startDate',
        'status',
        'timezone',
        'updatedAt',
      ].sort(),
    );
  });

  it('paginates with an opaque cursor and stops at the last page', async () => {
    const created = [
      await createTournament('One'),
      await createTournament('Two'),
      await createTournament('Three'),
    ];

    const first = await app.inject({ method: 'GET', url: '/api/v1/tournaments?limit=2' });
    const firstBody = first.json<ListBody<{ id: string }>>();
    expect(firstBody.data.items).toHaveLength(2);
    expect(firstBody.data.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/tournaments?limit=2&cursor=${firstBody.data.nextCursor ?? ''}`,
    });
    const secondBody = second.json<ListBody<{ id: string }>>();
    expect(secondBody.data.items).toHaveLength(1);
    expect(secondBody.data.nextCursor).toBeNull();

    const seen = [...firstBody.data.items, ...secondBody.data.items].map((item) => item.id);
    expect(new Set(seen)).toEqual(new Set(created));
    expect(seen).toHaveLength(created.length);
  });

  it('orders deterministically (createdAt descending, id as tiebreaker)', async () => {
    const created = [
      await createTournament('One'),
      await createTournament('Two'),
      await createTournament('Three'),
    ];

    const response = await app.inject({ method: 'GET', url: '/api/v1/tournaments' });
    const items = response.json<ListBody<{ id: string }>>().data.items;
    const expected = [...created].sort((left, right) => right.localeCompare(left));

    expect(items.map((item) => item.id)).toEqual(expected);
  });

  it('rejects a limit of zero, an over-large limit and a non-numeric limit with 400', async () => {
    for (const url of [
      '/api/v1/tournaments?limit=0',
      '/api/v1/tournaments?limit=101',
      '/api/v1/tournaments?limit=abc',
    ]) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects a non-UUID cursor with 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tournaments?cursor=not-a-uuid',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/players', () => {
  it('returns an empty page when no players exist', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/players' });

    expect(response.statusCode).toBe(200);
    expect(response.json<ListBody<unknown>>().data.items).toEqual([]);
  });

  it('returns persisted players newest first with a deterministic id tiebreaker', async () => {
    const created = [
      await createPlayer('Zoe'),
      await createPlayer('Alice'),
      await createPlayer('Mia'),
    ];

    const response = await app.inject({ method: 'GET', url: '/api/v1/players' });

    const items = response.json<ListBody<{ id: string }>>().data.items;
    const expected = [...created].sort((a, b) => b.localeCompare(a));
    expect(items.map((item) => item.id)).toEqual(expected);
  });

  it('makes a newly created player visible in the list (create → list)', async () => {
    const id = await createPlayer('Fresh Face');

    const response = await app.inject({ method: 'GET', url: '/api/v1/players' });

    expect(response.json<ListBody<{ id: string }>>().data.items.map((item) => item.id)).toContain(
      id,
    );
  });

  it('exposes exactly the documented fields and no database-internal ones', async () => {
    await createPlayer('Alice');

    const response = await app.inject({ method: 'GET', url: '/api/v1/players' });
    const item = response.json<ListBody<Record<string, unknown>>>().data.items[0] as Record<
      string,
      unknown
    >;

    expect(Object.keys(item).sort()).toEqual(
      ['createdAt', 'email', 'id', 'name', 'phone', 'updatedAt'].sort(),
    );
  });

  it('paginates players with a cursor', async () => {
    const created = [
      await createPlayer('Alice'),
      await createPlayer('Bob'),
      await createPlayer('Cara'),
    ];

    const first = await app.inject({ method: 'GET', url: '/api/v1/players?limit=2' });
    const firstBody = first.json<ListBody<{ id: string }>>();
    expect(firstBody.data.items).toHaveLength(2);
    expect(firstBody.data.nextCursor).not.toBeNull();

    const second = await app.inject({
      method: 'GET',
      url: `/api/v1/players?limit=2&cursor=${firstBody.data.nextCursor ?? ''}`,
    });
    const secondBody = second.json<ListBody<{ id: string }>>();
    expect(secondBody.data.items).toHaveLength(1);
    expect(secondBody.data.nextCursor).toBeNull();

    const seen = [...firstBody.data.items, ...secondBody.data.items].map((item) => item.id);
    expect(new Set(seen)).toEqual(new Set(created));
  });
});

describe('GET /api/v1/teams', () => {
  it('returns an empty page when no teams exist', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/teams' });

    expect(response.statusCode).toBe(200);
    expect(response.json<ListBody<unknown>>().data.items).toEqual([]);
  });

  it('returns persisted teams with a member count', async () => {
    const first = await createPlayer('Alice');
    const second = await createPlayer('Bob');
    const smash = await api.services.teams.create({
      name: 'Smash Masters',
      memberPlayerIds: [first, second],
    });
    const ninjas = await api.services.teams.create({ name: 'Net Ninjas' });

    const response = await app.inject({ method: 'GET', url: '/api/v1/teams' });

    const items = response.json<ListBody<{ id: string; memberCount: number }>>().data.items;
    const expected = [smash.id, ninjas.id].sort((a, b) => b.localeCompare(a));
    expect(items.map((item) => item.id)).toEqual(expected);

    const memberCounts = new Map(items.map((item) => [item.id, item.memberCount]));
    expect(memberCounts.get(smash.id)).toBe(2);
    expect(memberCounts.get(ninjas.id)).toBe(0);
  });

  it('makes a newly created team visible in the list (create → list)', async () => {
    const team = await api.services.teams.create({ name: 'Fresh Squad' });

    const response = await app.inject({ method: 'GET', url: '/api/v1/teams' });

    expect(response.json<ListBody<{ id: string }>>().data.items.map((item) => item.id)).toContain(
      team.id,
    );
  });

  it('exposes exactly the documented fields and no database-internal ones', async () => {
    await api.services.teams.create({ name: 'Smash Masters' });

    const response = await app.inject({ method: 'GET', url: '/api/v1/teams' });
    const item = response.json<ListBody<Record<string, unknown>>>().data.items[0] as Record<
      string,
      unknown
    >;

    expect(Object.keys(item).sort()).toEqual(
      ['createdAt', 'id', 'memberCount', 'name', 'updatedAt'].sort(),
    );
  });
});
