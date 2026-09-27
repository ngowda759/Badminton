import type { ApiServices } from '../../../apps/api/src/http/api-services.ts';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app.ts';
import { createTestApi, type TestApi } from './harness.ts';

/**
 * HTTP route tests for the `/api/v1` REST surface.
 *
 * These run through the real Fastify stack (routing, Zod validation, the
 * central error mapper, response envelopes) with the real application services
 * over in-memory repositories. They assert the *HTTP contract* - status codes,
 * envelopes, error shape and that validation happens at the boundary - rather
 * than re-testing the domain rules, which have their own suites.
 *
 * A companion suite (`tests/integration/api/vertical-slice.test.ts`) covers the
 * HTTP-to-PostgreSQL path for selected flows.
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

async function createTournament(name = 'Autumn Open'): Promise<string> {
  const tournament = await api.services.tournaments.create({
    name,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-03T00:00:00.000Z'),
    timezone: 'Asia/Kolkata',
  });
  return tournament.id;
}

async function registrationOpenTournament(name = 'Autumn Open'): Promise<string> {
  const id = await createTournament(name);
  await api.services.tournaments.transitionStatus(id, { status: 'REGISTRATION_OPEN' });
  return id;
}

async function openCategory(
  tournamentId: string,
  format: 'SINGLES' | 'DOUBLES' = 'SINGLES',
  code = 'MS',
): Promise<string> {
  const category = await api.services.categories.create(tournamentId, {
    name: `Category ${code}`,
    code,
    format,
  });
  await api.services.categories.transitionStatus(category.id, { status: 'OPEN' });
  return category.id;
}

interface StandingRowResponse {
  readonly entryId: string;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly points: number;
  readonly gameDifference: number;
  readonly pointDifference: number;
}

async function registerPlayer(categoryId: string, name: string): Promise<{ id: string }> {
  const player = await api.services.players.create({ name });
  return api.services.entries.register({ categoryId, playerId: player.id });
}

/**
 * Registers two fresh competitors, plays them in a new match inside `stageId`
 * and completes a 2-0 result. Returns the winning and losing entry ids.
 */
async function completeGroupMatch(
  categoryId: string,
  stageId: string,
  label: string,
): Promise<{ winner: string; loser: string }> {
  const match = await api.services.matches.create(stageId, {
    sequence: await nextMatchSequence(stageId),
  });
  const winner = await registerPlayer(categoryId, `Winner ${label}`);
  const loser = await registerPlayer(categoryId, `Loser ${label}`);
  await api.services.matches.addParticipant(match.id, { entryId: winner.id, slot: 1 });
  await api.services.matches.addParticipant(match.id, { entryId: loser.id, slot: 2 });
  await api.services.matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });
  await api.services.matchResults.recordResult(match.id, {
    games: [
      { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
      { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
    ],
  });
  return { winner: winner.id, loser: loser.id };
}

async function nextMatchSequence(stageId: string): Promise<number> {
  const existing = await api.services.matches.listByStage(stageId);
  return existing.length + 1;
}

describe('/api/v1 tournaments', () => {
  it('creates a tournament and returns 201 with the data envelope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tournaments',
      payload: {
        name: 'Spring Cup',
        startDate: '2027-03-01',
        endDate: '2027-03-03',
        timezone: 'Asia/Kolkata',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { name: string; status: string } }>();
    expect(body.data.name).toBe('Spring Cup');
    expect(body.data.status).toBe('DRAFT');
  });

  it('rejects an invalid body with 400 and field paths', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tournaments',
      payload: {
        name: '',
        startDate: '2027-03-01',
        endDate: '2027-03-03',
        timezone: 'Asia/Kolkata',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details?.some((issue) => issue.path.startsWith('name'))).toBe(true);
  });

  it('rejects an invalid timezone with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tournaments',
      payload: {
        name: 'Bad TZ',
        startDate: '2027-03-01',
        endDate: '2027-03-03',
        timezone: 'IST',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-UUID id with 400 before calling the service', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/tournaments/not-a-uuid' });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tournaments/11111111-1111-4111-8111-111111111111',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('updates a tournament and returns 200', async () => {
    const id = await createTournament();
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tournaments/${id}`,
      payload: { name: 'Renamed Cup' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { name: string } }>().data.name).toBe('Renamed Cup');
  });

  it('transitions a tournament lifecycle and returns 200', async () => {
    const id = await createTournament();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${id}/transition`,
      payload: { status: 'REGISTRATION_OPEN' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { status: string } }>().data.status).toBe('REGISTRATION_OPEN');
  });

  it('maps an invalid lifecycle transition to 409', async () => {
    const id = await createTournament();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${id}/transition`,
      payload: { status: 'COMPLETED' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejects an unknown transition status with 400', async () => {
    const id = await createTournament();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${id}/transition`,
      payload: { status: 'NOT_A_STATUS' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('maps a duplicate live name to 409', async () => {
    await createTournament('Duplicate');
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tournaments',
      payload: {
        name: 'Duplicate',
        startDate: '2026-10-01',
        endDate: '2026-10-03',
        timezone: 'Asia/Kolkata',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('CONFLICT');
  });
});

describe('/api/v1 tournament categories', () => {
  it('creates a category and normalizes its code', async () => {
    const tournamentId = await createTournament();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/categories`,
      payload: { name: 'Mens Singles', code: ' ms ', format: 'SINGLES' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { code: string } }>().data.code).toBe('MS');
  });

  it('rejects an invalid category body with 400', async () => {
    const tournamentId = await createTournament();
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/categories`,
      payload: { name: 'Bad', code: 'too-long-code', format: 'SINGLES' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('maps a duplicate category code to 409', async () => {
    const tournamentId = await createTournament();
    await openCategory(tournamentId, 'SINGLES', 'MS');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/categories`,
      payload: { name: 'Another', code: 'MS', format: 'SINGLES' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('lists categories under a tournament', async () => {
    const tournamentId = await createTournament();
    await openCategory(tournamentId, 'SINGLES', 'MS');
    await openCategory(tournamentId, 'DOUBLES', 'MD');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tournaments/${tournamentId}/categories`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('reads and transitions a category', async () => {
    const tournamentId = await createTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');

    const read = await app.inject({ method: 'GET', url: `/api/v1/categories/${categoryId}` });
    expect(read.statusCode).toBe(200);

    const transition = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/transition`,
      payload: { status: 'CLOSED' },
    });
    expect(transition.statusCode).toBe(200);
    expect(transition.json<{ data: { status: string } }>().data.status).toBe('CLOSED');
  });
});

describe('/api/v1 players', () => {
  it('creates a player and returns 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/players',
      payload: { name: 'Asha', email: 'Asha@Example.com' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { email: string } }>().data.email).toBe('asha@example.com');
  });

  it('rejects a malformed email with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/players',
      payload: { name: 'Asha', email: 'not-an-email' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('maps a duplicate email to 409', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/players',
      payload: { name: 'A', email: 'dup@example.com' },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/players',
      payload: { name: 'B', email: 'DUP@example.com' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('reads a created player', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/players',
      payload: { name: 'Asha' },
    });
    const id = created.json<{ data: { id: string } }>().data.id;

    const response = await app.inject({ method: 'GET', url: `/api/v1/players/${id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { name: string } }>().data.name).toBe('Asha');
  });
});

describe('/api/v1 teams and members', () => {
  async function createPlayer(name: string): Promise<string> {
    const player = await api.services.players.create({ name });
    return player.id;
  }

  it('creates a team with members', async () => {
    const first = await createPlayer('A');
    const second = await createPlayer('B');

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      payload: { name: 'Pair', memberPlayerIds: [first, second] },
    });

    expect(response.statusCode).toBe(201);
    const teamId = response.json<{ data: { id: string } }>().data.id;

    const members = await app.inject({ method: 'GET', url: `/api/v1/teams/${teamId}/members` });
    expect(members.json<{ data: unknown[] }>().data).toHaveLength(2);
  });

  it('adds a member and maps a duplicate to 409', async () => {
    const player = await createPlayer('Solo');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      payload: { name: 'Solo Team' },
    });
    const teamId = created.json<{ data: { id: string } }>().data.id;

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/members`,
      payload: { playerId: player },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/members`,
      payload: { playerId: player },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('rejects an unknown member player with 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      payload: { name: 'Solo Team' },
    });
    const teamId = created.json<{ data: { id: string } }>().data.id;

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/members`,
      payload: { playerId: '11111111-1111-4111-8111-111111111111' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('removes a member and returns 204', async () => {
    const player = await createPlayer('Solo');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/teams',
      payload: { name: 'Solo Team', memberPlayerIds: [player] },
    });
    const teamId = created.json<{ data: { id: string } }>().data.id;

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/teams/${teamId}/members/${player}`,
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
  });

  it('rejects an invalid path parameter on member removal', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/teams/not-a-uuid/members/also-bad',
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('/api/v1 entries', () => {
  async function createPlayer(name: string): Promise<string> {
    const player = await api.services.players.create({ name });
    return player.id;
  }

  it('registers a singles entry and returns 201', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const playerId = await createPlayer('Solo');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/entries`,
      payload: { playerId },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { playerId: string; status: string } }>();
    expect(body.data.playerId).toBe(playerId);
    expect(body.data.status).toBe('PENDING');
  });

  it('rejects registration into a non-open category with 422', async () => {
    const tournamentId = await registrationOpenTournament();
    const category = await api.services.categories.create(tournamentId, {
      name: 'Closed',
      code: 'CL',
      format: 'SINGLES',
    });
    const playerId = await createPlayer('Solo');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${category.id}/entries`,
      payload: { playerId },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('maps a duplicate registration to 409', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const playerId = await createPlayer('Solo');

    await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/entries`,
      payload: { playerId },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/entries`,
      payload: { playerId },
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects a request with neither competitor with 400', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/entries`,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('lists entries for a category and reads one', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const playerId = await createPlayer('Solo');
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/entries`,
      payload: { playerId },
    });
    const entryId = created.json<{ data: { id: string } }>().data.id;

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/categories/${categoryId}/entries`,
    });
    expect(list.json<{ data: unknown[] }>().data).toHaveLength(1);

    const read = await app.inject({ method: 'GET', url: `/api/v1/entries/${entryId}` });
    expect(read.statusCode).toBe(200);
  });

  it('confirms and withdraws an entry; a withdrawn entry cannot be confirmed', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const playerId = await createPlayer('Solo');
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/entries`,
      payload: { playerId },
    });
    const entryId = created.json<{ data: { id: string } }>().data.id;

    const confirm = await app.inject({
      method: 'POST',
      url: `/api/v1/entries/${entryId}/confirm`,
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json<{ data: { status: string } }>().data.status).toBe('CONFIRMED');

    const withdraw = await app.inject({
      method: 'POST',
      url: `/api/v1/entries/${entryId}/withdraw`,
    });
    expect(withdraw.statusCode).toBe(200);

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/entries/${entryId}/confirm`,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<ErrorBody>().error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejects a non-positive seed with 400', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const playerId = await createPlayer('Solo');
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/entries`,
      payload: { playerId },
    });
    const entryId = created.json<{ data: { id: string } }>().data.id;

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/entries/${entryId}`,
      payload: { seed: 0 },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('/api/v1 stages and matches', () => {
  async function setupOpenCategory(): Promise<string> {
    const tournamentId = await registrationOpenTournament();
    return openCategory(tournamentId, 'SINGLES', 'MS');
  }

  it('creates a stage and maps a duplicate sequence to 409', async () => {
    const categoryId = await setupOpenCategory();

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/stages`,
      payload: { name: 'Group', type: 'GROUP', sequence: 1 },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/stages`,
      payload: { name: 'Knockout', type: 'KNOCKOUT', sequence: 1 },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('rejects a stage for an unknown category with 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/categories/11111111-1111-4111-8111-111111111111/stages',
      payload: { name: 'Group', type: 'GROUP', sequence: 1 },
    });

    expect(response.statusCode).toBe(404);
  });

  it('reads, updates and transitions a stage', async () => {
    const categoryId = await setupOpenCategory();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/stages`,
      payload: { name: 'Group', type: 'GROUP', sequence: 1 },
    });
    const stageId = created.json<{ data: { id: string } }>().data.id;

    const read = await app.inject({ method: 'GET', url: `/api/v1/stages/${stageId}` });
    expect(read.statusCode).toBe(200);

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/stages/${stageId}`,
      payload: { name: 'Group Stage' },
    });
    expect(update.statusCode).toBe(200);

    const transition = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stageId}/transition`,
      payload: { status: 'ACTIVE' },
    });
    expect(transition.statusCode).toBe(200);
  });

  it('creates a match and maps a duplicate sequence to 409', async () => {
    const categoryId = await setupOpenCategory();
    const stage = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/stages`,
      payload: { name: 'Group', type: 'GROUP', sequence: 1 },
    });
    const stageId = stage.json<{ data: { id: string } }>().data.id;

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stageId}/matches`,
      payload: { sequence: 1 },
    });
    expect(first.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stageId}/matches`,
      payload: { sequence: 1 },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('rejects a match for an unknown stage with 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/stages/11111111-1111-4111-8111-111111111111/matches',
      payload: { sequence: 1 },
    });

    expect(response.statusCode).toBe(404);
  });

  it('transitions a match lifecycle and maps an invalid one to 409', async () => {
    const categoryId = await setupOpenCategory();
    const stage = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/stages`,
      payload: { name: 'Group', type: 'GROUP', sequence: 1 },
    });
    const stageId = stage.json<{ data: { id: string } }>().data.id;
    const match = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stageId}/matches`,
      payload: { sequence: 1 },
    });
    const matchId = match.json<{ data: { id: string } }>().data.id;

    const start = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/transition`,
      payload: { status: 'IN_PROGRESS' },
    });
    expect(start.statusCode).toBe(200);

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/transition`,
      payload: { status: 'SCHEDULED' },
    });
    expect(invalid.statusCode).toBe(409);
  });
});

describe('/api/v1 match participants', () => {
  async function setupMatch(): Promise<{
    matchId: string;
    entryOne: string;
    entryTwo: string;
    foreignEntry: string;
  }> {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const otherCategoryId = await openCategory(tournamentId, 'SINGLES', 'WS');

    const stage = await api.services.stages.create(categoryId, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });
    const match = await api.services.matches.create(stage.id, { sequence: 1 });

    const p1 = await api.services.players.create({ name: 'P1' });
    const p2 = await api.services.players.create({ name: 'P2' });
    const p3 = await api.services.players.create({ name: 'P3' });

    const entryOne = await api.services.entries.register({ categoryId, playerId: p1.id });
    const entryTwo = await api.services.entries.register({ categoryId, playerId: p2.id });
    const foreignEntry = await api.services.entries.register({
      categoryId: otherCategoryId,
      playerId: p3.id,
    });

    return {
      matchId: match.id,
      entryOne: entryOne.id,
      entryTwo: entryTwo.id,
      foreignEntry: foreignEntry.id,
    };
  }

  it('adds a participant and lists participants', async () => {
    const { matchId, entryOne } = await setupMatch();

    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/participants`,
      payload: { entryId: entryOne, slot: 1 },
    });
    expect(created.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: `/api/v1/matches/${matchId}/participants`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ data: unknown[] }>().data).toHaveLength(1);
  });

  it('rejects an invalid slot with 400', async () => {
    const { matchId, entryOne } = await setupMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/participants`,
      payload: { entryId: entryOne, slot: 3 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('maps a duplicate slot to 409', async () => {
    const { matchId, entryOne, entryTwo } = await setupMatch();

    await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/participants`,
      payload: { entryId: entryOne, slot: 1 },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/participants`,
      payload: { entryId: entryTwo, slot: 1 },
    });

    expect(response.statusCode).toBe(409);
  });

  it('maps a duplicate entry to 409', async () => {
    const { matchId, entryOne } = await setupMatch();

    await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/participants`,
      payload: { entryId: entryOne, slot: 1 },
    });
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/participants`,
      payload: { entryId: entryOne, slot: 2 },
    });

    expect(response.statusCode).toBe(409);
  });

  it('rejects an entry from another category with 400', async () => {
    const { matchId, foreignEntry } = await setupMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/participants`,
      payload: { entryId: foreignEntry, slot: 1 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a withdrawn entry with 400', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stage = await api.services.stages.create(categoryId, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });
    const match = await api.services.matches.create(stage.id, { sequence: 1 });
    const player = await api.services.players.create({ name: 'Gone' });
    const entry = await api.services.entries.register({ categoryId, playerId: player.id });
    await api.services.entries.withdraw(entry.id);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/participants`,
      payload: { entryId: entry.id, slot: 1 },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('/api/v1 match results', () => {
  interface MatchSetup {
    readonly matchId: string;
    readonly stageId: string;
    readonly entryOne: string;
    readonly entryTwo: string;
  }

  /** An IN_PROGRESS match with slots 1 and 2 occupied by two category entries. */
  async function startedMatch(): Promise<MatchSetup> {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stage = await api.services.stages.create(categoryId, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });
    const match = await api.services.matches.create(stage.id, { sequence: 1 });

    const p1 = await api.services.players.create({ name: 'P1' });
    const p2 = await api.services.players.create({ name: 'P2' });
    const entryOne = await api.services.entries.register({ categoryId, playerId: p1.id });
    const entryTwo = await api.services.entries.register({ categoryId, playerId: p2.id });

    await api.services.matches.addParticipant(match.id, { entryId: entryOne.id, slot: 1 });
    await api.services.matches.addParticipant(match.id, { entryId: entryTwo.id, slot: 2 });
    await api.services.matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });

    return { matchId: match.id, stageId: stage.id, entryOne: entryOne.id, entryTwo: entryTwo.id };
  }

  const twoZero = [
    { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
    { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
  ];

  it('records a valid 2-0 result and returns 201', async () => {
    const { matchId, entryOne } = await startedMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: { games: twoZero },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { winnerEntryId: string; winnerGames: number } }>();
    expect(body.data.winnerEntryId).toBe(entryOne);
    expect(body.data.winnerGames).toBe(2);
  });

  it('records a valid 2-1 result', async () => {
    const { matchId } = await startedMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: {
        games: [
          { gameNumber: 1, participant1Points: 21, participant2Points: 18 },
          { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
          { gameNumber: 3, participant1Points: 19, participant2Points: 21 },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { winnerSlot: number } }>().data.winnerSlot).toBe(2);
  });

  it('reads the result of a completed match', async () => {
    const { matchId } = await startedMatch();
    await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: { games: twoZero },
    });

    const response = await app.inject({ method: 'GET', url: `/api/v1/matches/${matchId}/result` });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: { games: unknown[] } }>().data.games).toHaveLength(2);
  });

  it('rejects an invalid game score with 422 and leaks nothing', async () => {
    const { matchId } = await startedMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: {
        games: [
          { gameNumber: 1, participant1Points: 21, participant2Points: 20 },
          { gameNumber: 2, participant1Points: 21, participant2Points: 15 },
        ],
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.code).toBe('BUSINESS_RULE_VIOLATION');
    expect(response.body).not.toContain('SQL');
  });

  it('rejects a score above 30 with 400 at the validation boundary', async () => {
    const { matchId } = await startedMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: {
        games: [
          { gameNumber: 1, participant1Points: 31, participant2Points: 29 },
          { gameNumber: 2, participant1Points: 21, participant2Points: 15 },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a single-game result with 422', async () => {
    const { matchId } = await startedMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: { games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 15 }] },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects a third game after a 2-0 result with 422', async () => {
    const { matchId } = await startedMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: {
        games: [...twoZero, { gameNumber: 3, participant1Points: 21, participant2Points: 15 }],
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects scoring a match with missing participants with 422', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stage = await api.services.stages.create(categoryId, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });
    const match = await api.services.matches.create(stage.id, { sequence: 1 });
    const player = await api.services.players.create({ name: 'Only' });
    const entry = await api.services.entries.register({ categoryId, playerId: player.id });
    await api.services.matches.addParticipant(match.id, { entryId: entry.id, slot: 1 });
    await api.services.matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/result`,
      payload: { games: twoZero },
    });

    expect(response.statusCode).toBe(422);
  });

  it('maps a second result for a completed match to 409', async () => {
    const { matchId } = await startedMatch();
    await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: { games: twoZero },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: { games: twoZero },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>().error.code).toBe('CONFLICT');
  });

  it('rejects scoring a scheduled match with 422', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stage = await api.services.stages.create(categoryId, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });
    const match = await api.services.matches.create(stage.id, { sequence: 1 });
    const p1 = await api.services.players.create({ name: 'P1' });
    const p2 = await api.services.players.create({ name: 'P2' });
    const e1 = await api.services.entries.register({ categoryId, playerId: p1.id });
    const e2 = await api.services.entries.register({ categoryId, playerId: p2.id });
    await api.services.matches.addParticipant(match.id, { entryId: e1.id, slot: 1 });
    await api.services.matches.addParticipant(match.id, { entryId: e2.id, slot: 2 });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${match.id}/result`,
      payload: { games: twoZero },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects scoring a cancelled match with 422', async () => {
    const { matchId } = await startedMatch();
    await api.services.matches.transitionStatus(matchId, { status: 'CANCELLED' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: { games: twoZero },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects completing through the transition endpoint with 422', async () => {
    const { matchId } = await startedMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/transition`,
      payload: { status: 'COMPLETED' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('rejects an invalid result body with 400', async () => {
    const { matchId } = await startedMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: { games: [] },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a non-UUID match id with 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/matches/not-a-uuid/result',
      payload: { games: twoZero },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('/api/v1 stage standings', () => {
  it('returns an empty-ish table before any match is completed', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stage = await api.services.stages.create(categoryId, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });
    const p1 = await api.services.players.create({ name: 'P1' });
    const p2 = await api.services.players.create({ name: 'P2' });
    await api.services.entries.register({ categoryId, playerId: p1.id });
    await api.services.entries.register({ categoryId, playerId: p2.id });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${stage.id}/standings`,
    });

    expect(response.statusCode).toBe(200);
    const rows = response.json<{ data: { played: number }[] }>().data;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.played === 0)).toBe(true);
  });

  it('derives the table from a completed match', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stage = await api.services.stages.create(categoryId, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });
    const match = await api.services.matches.create(stage.id, { sequence: 1 });
    const p1 = await api.services.players.create({ name: 'P1' });
    const p2 = await api.services.players.create({ name: 'P2' });
    const e1 = await api.services.entries.register({ categoryId, playerId: p1.id });
    const e2 = await api.services.entries.register({ categoryId, playerId: p2.id });
    await api.services.matches.addParticipant(match.id, { entryId: e1.id, slot: 1 });
    await api.services.matches.addParticipant(match.id, { entryId: e2.id, slot: 2 });
    await api.services.matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });
    await api.services.matchResults.recordResult(match.id, {
      games: [
        { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
        { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
      ],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${stage.id}/standings`,
    });

    expect(response.statusCode).toBe(200);
    const rows = response.json<{
      data: { entryId: string; position: number; played: number; won: number; points: number }[];
    }>().data;
    const leader = rows.find((row) => row.entryId === e1.id);
    expect(leader).toMatchObject({ position: 1, played: 1, won: 1, points: 2 });
  });

  it('isolates standings to the requested stage across the category', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');

    const stageA = await api.services.stages.create(categoryId, {
      name: 'Group A',
      type: 'GROUP',
      sequence: 1,
    });
    const stageB = await api.services.stages.create(categoryId, {
      name: 'Group B',
      type: 'GROUP',
      sequence: 2,
    });
    const knockout = await api.services.stages.create(categoryId, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 3,
      drawSize: 4,
    });

    const playedA = await completeGroupMatch(categoryId, stageA.id, 'A');
    const playedB = await completeGroupMatch(categoryId, stageB.id, 'B');
    await completeGroupMatch(categoryId, knockout.id, 'C');

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${stageA.id}/standings`,
    });
    expect(response.statusCode).toBe(200);
    const rows = response.json<{ data: StandingRowResponse[] }>().data;
    const byEntry = new Map(rows.map((row) => [row.entryId, row]));

    // Only Stage A's completed match contributes; Stage B and the knockout
    // match are invisible here.
    expect(byEntry.get(playedA.winner)).toMatchObject({ played: 1, won: 1, points: 2 });
    expect(byEntry.get(playedA.loser)).toMatchObject({ played: 1, lost: 1, points: 1 });
    expect(byEntry.get(playedB.winner)).toMatchObject({ played: 0, won: 0, points: 0 });
    expect(byEntry.get(playedB.loser)).toMatchObject({ played: 0, lost: 0, points: 0 });
    expect(rows.reduce((sum, row) => sum + row.played, 0)).toBe(2);
  });

  it('keeps two GROUP stages in the same category isolated', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stageA = await api.services.stages.create(categoryId, {
      name: 'Group A',
      type: 'GROUP',
      sequence: 1,
    });
    const stageB = await api.services.stages.create(categoryId, {
      name: 'Group B',
      type: 'GROUP',
      sequence: 2,
    });

    const playedA = await completeGroupMatch(categoryId, stageA.id, 'A');
    const playedB = await completeGroupMatch(categoryId, stageB.id, 'B');

    const rowsA = (
      await app.inject({ method: 'GET', url: `/api/v1/stages/${stageA.id}/standings` })
    ).json<{ data: StandingRowResponse[] }>().data;
    const rowsB = (
      await app.inject({ method: 'GET', url: `/api/v1/stages/${stageB.id}/standings` })
    ).json<{ data: StandingRowResponse[] }>().data;

    expect(rowsA.find((row) => row.entryId === playedA.winner)).toMatchObject({
      played: 1,
      won: 1,
    });
    expect(rowsA.find((row) => row.entryId === playedB.winner)).toMatchObject({
      played: 0,
      won: 0,
    });
    expect(rowsB.find((row) => row.entryId === playedB.winner)).toMatchObject({
      played: 1,
      won: 1,
    });
    expect(rowsB.find((row) => row.entryId === playedA.winner)).toMatchObject({
      played: 0,
      won: 0,
    });
  });

  it('lists only active entries: withdrawn and disqualified are excluded', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stage = await api.services.stages.create(categoryId, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });

    // Registration starts PENDING; confirm a couple and terminate others.
    const confirmed = await registerPlayer(categoryId, 'Confirmed');
    const pending = await registerPlayer(categoryId, 'Pending');
    await api.services.entries.confirm(confirmed.id);
    const withdrawn = await registerPlayer(categoryId, 'Withdrawn');
    await api.services.entries.withdraw(withdrawn.id);
    const disqualified = await registerPlayer(categoryId, 'Disqualified');
    await api.services.entries.disqualify(disqualified.id);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${stage.id}/standings`,
    });
    expect(response.statusCode).toBe(200);
    const ids = response.json<{ data: { entryId: string }[] }>().data.map((row) => row.entryId);

    expect(ids).toContain(confirmed.id);
    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(withdrawn.id);
    expect(ids).not.toContain(disqualified.id);
  });

  it('excludes a withdrawn entry even after it played a completed match', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stage = await api.services.stages.create(categoryId, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });

    const played = await completeGroupMatch(categoryId, stage.id, 'A');
    await api.services.entries.withdraw(played.loser);

    const rows = (
      await app.inject({ method: 'GET', url: `/api/v1/stages/${stage.id}/standings` })
    ).json<{ data: { entryId: string }[] }>().data;

    expect(rows.map((row) => row.entryId)).toEqual([played.winner]);
  });

  it('rejects standings for a non-group stage with 422', async () => {
    const tournamentId = await registrationOpenTournament();
    const categoryId = await openCategory(tournamentId, 'SINGLES', 'MS');
    const stage = await api.services.stages.create(categoryId, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      drawSize: 4,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${stage.id}/standings`,
    });

    expect(response.statusCode).toBe(422);
  });

  it('maps an unknown stage to 404', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/stages/11111111-1111-4111-8111-111111111111/standings',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('API envelope and error conventions', () => {
  it('keeps /health working', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', database: 'connected' });
  });

  it('returns a structured 404 for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/unknown' });
    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('handles malformed JSON through the central error handler', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/players',
      headers: { 'content-type': 'application/json' },
      payload: '{ not json',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBeDefined();
  });

  it('serves JSON with an application/json content type', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tournaments/11111111-1111-4111-8111-111111111111',
    });
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('does not expose internals when a service throws unexpectedly', async () => {
    const base = createTestApi();
    // A service that fails the way an unexpected infrastructure error would.
    const services: ApiServices = {
      ...base.services,
      tournaments: {
        ...base.services.tournaments,
        getById: () =>
          Promise.reject(new Error('postgresql://user:hunter2@internal-host:5432/prod')),
      },
    };
    const failingApp = buildApp({ checks: [], corsOrigins: [], services });

    const response = await failingApp.inject({
      method: 'GET',
      url: '/api/v1/tournaments/11111111-1111-4111-8111-111111111111',
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('hunter2');
    expect(response.body).not.toContain('internal-host');
    expect(response.body).not.toContain('postgresql://');
    await failingApp.close();
  });
});
