import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApi, type TestApi } from './harness.ts';

/**
 * HTTP route tests for the Phase 7 court, scheduling and dashboard endpoints.
 *
 * As with the other route tests these run through the real Fastify stack and
 * real services over in-memory repositories, asserting the HTTP contract
 * (status codes, envelopes, error shape) rather than re-testing domain rules.
 */

interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
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

let tournamentCounter = 0;

async function createTournament(): Promise<string> {
  tournamentCounter += 1;
  const created = await api.services.tournaments.create({
    name: `Autumn Open ${String(tournamentCounter)}`,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-03T00:00:00.000Z'),
    timezone: 'Asia/Kolkata',
  });
  return created.id;
}

async function scheduledMatch(): Promise<{ tournamentId: string; matchId: string }> {
  const tournamentId = await createTournament();
  const category = await api.services.categories.create(tournamentId, {
    name: 'Mens Singles',
    code: 'MS',
    format: 'SINGLES',
  });
  const stage = await api.services.stages.create(category.id, {
    name: 'Group',
    type: 'GROUP',
    sequence: 1,
  });
  const match = await api.services.matches.create(stage.id, { sequence: 1 });
  return { tournamentId, matchId: match.id };
}

describe('/api/v1 courts', () => {
  it('creates a court and returns 201 with the data envelope', async () => {
    const tournamentId = await createTournament();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/courts`,
      payload: { number: 1, name: 'Centre Court' },
    });

    expect(response.statusCode).toBe(201);
    expect(
      response.json<{ data: { number: number; name: string; status: string } }>().data,
    ).toMatchObject({ number: 1, name: 'Centre Court', status: 'ACTIVE' });
  });

  it('lists courts for a tournament ordered by number', async () => {
    const tournamentId = await createTournament();
    await api.services.courts.create(tournamentId, { number: 2, name: 'Court 2' });
    await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tournaments/${tournamentId}/courts`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { number: number }[] }>();
    expect(body.data.map((court) => court.number)).toEqual([1, 2]);
  });

  it('rejects a duplicate court number with 409', async () => {
    const tournamentId = await createTournament();
    await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/courts`,
      payload: { number: 1, name: 'Court 1 again' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('CONFLICT');
  });

  it('rejects an invalid body with 400', async () => {
    const tournamentId = await createTournament();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/courts`,
      payload: { number: 0, name: '' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for an unknown court', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/courts/11111111-1111-4111-8111-111111111111',
    });
    expect(response.statusCode).toBe(404);
  });

  it('updates and transitions a court', async () => {
    const tournamentId = await createTournament();
    const court = await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/courts/${court.id}`,
      payload: { name: 'Show Court' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json<{ data: { name: string } }>().data.name).toBe('Show Court');

    const transition = await app.inject({
      method: 'POST',
      url: `/api/v1/courts/${court.id}/transition`,
      payload: { status: 'INACTIVE' },
    });
    expect(transition.statusCode).toBe(200);
    expect(transition.json<{ data: { status: string } }>().data.status).toBe('INACTIVE');
  });
});

describe('DELETE /api/v1/courts/:id', () => {
  it('removes a court with no matches and it no longer appears in the list', async () => {
    const tournamentId = await createTournament();
    const removable = await api.services.courts.create(tournamentId, {
      number: 1,
      name: 'Court 1',
    });
    const kept = await api.services.courts.create(tournamentId, { number: 2, name: 'Court 2' });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/courts/${removable.id}`,
    });
    expect(response.statusCode).toBe(204);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/tournaments/${tournamentId}/courts`,
    });
    expect(list.statusCode).toBe(200);
    const body = list.json<{ data: { id: string }[] }>();
    expect(body.data.map((court) => court.id)).toEqual([kept.id]);
  });

  it('returns 409 for a court that has a match', async () => {
    const { tournamentId, matchId } = await scheduledMatch();
    const court = await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });
    await api.services.scheduling.schedule(matchId, {
      courtId: court.id,
      scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/courts/${court.id}`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('CONFLICT');
  });

  it("returns 422 for the tournament's last court", async () => {
    const tournamentId = await createTournament();
    const court = await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/courts/${court.id}`,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('returns 404 for an unknown id', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/courts/11111111-1111-4111-8111-111111111111',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('/api/v1 matches/:id/schedule', () => {
  it('schedules a match and returns 200', async () => {
    const { tournamentId, matchId } = await scheduledMatch();
    const court = await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/schedule`,
      payload: {
        courtId: court.id,
        scheduledStartAt: '2026-10-05T10:00:00.000Z',
        scheduledEndAt: '2026-10-05T10:30:00.000Z',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { courtId: string } }>().data.courtId).toBe(court.id);
  });

  it('rejects an overlapping schedule with 409', async () => {
    const { tournamentId, matchId } = await scheduledMatch();
    const court = await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });
    const match = await api.services.matches.getById(matchId);
    const sibling = await api.services.matches.create(match.stageId, { sequence: 2 });

    await api.services.scheduling.schedule(matchId, {
      courtId: court.id,
      scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${sibling.id}/schedule`,
      payload: {
        courtId: court.id,
        scheduledStartAt: '2026-10-05T10:15:00.000Z',
        scheduledEndAt: '2026-10-05T10:45:00.000Z',
      },
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects a cross-tournament court with 422', async () => {
    const { matchId } = await scheduledMatch();
    const other = await createTournament();
    const foreign = await api.services.courts.create(other, { number: 1, name: 'Foreign' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/schedule`,
      payload: {
        courtId: foreign.id,
        scheduledStartAt: '2026-10-05T10:00:00.000Z',
        scheduledEndAt: '2026-10-05T10:30:00.000Z',
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rejects an invalid interval with 422', async () => {
    const { tournamentId, matchId } = await scheduledMatch();
    const court = await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/schedule`,
      payload: {
        courtId: court.id,
        scheduledStartAt: '2026-10-05T10:30:00.000Z',
        scheduledEndAt: '2026-10-05T10:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a malformed timestamp with 400', async () => {
    const { tournamentId, matchId } = await scheduledMatch();
    const court = await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/schedule`,
      payload: { courtId: court.id, scheduledStartAt: 'tomorrow', scheduledEndAt: 'later' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('unschedules a match via DELETE', async () => {
    const { tournamentId, matchId } = await scheduledMatch();
    const court = await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });
    await api.services.scheduling.schedule(matchId, {
      courtId: court.id,
      scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
      scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/matches/${matchId}/schedule`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { courtId: null } }>().data.courtId).toBeNull();
  });
});

describe('/api/v1 tournaments/:tournamentId/dashboard', () => {
  it('returns an aggregated dashboard', async () => {
    const { tournamentId, matchId } = await scheduledMatch();
    const court = await api.services.courts.create(tournamentId, { number: 1, name: 'Court 1' });
    await api.services.scheduling.schedule(matchId, {
      courtId: court.id,
      scheduledStartAt: new Date('2999-01-01T10:00:00.000Z'),
      scheduledEndAt: new Date('2999-01-01T10:30:00.000Z'),
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tournaments/${tournamentId}/dashboard`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: {
        tournament: { id: string };
        summary: { totalMatches: number };
        courts: unknown[];
        upcomingMatches: unknown[];
      };
    }>();
    expect(body.data.tournament.id).toBe(tournamentId);
    expect(body.data.summary.totalMatches).toBe(1);
    expect(body.data.courts).toHaveLength(1);
    expect(body.data.upcomingMatches).toHaveLength(1);
  });

  it('returns 404 for an unknown tournament', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tournaments/11111111-1111-4111-8111-111111111111/dashboard',
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects a non-UUID tournament id with 400', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tournaments/not-a-uuid/dashboard',
    });
    expect(response.statusCode).toBe(400);
  });
});
