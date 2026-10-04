import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApi, type TestApi } from './harness.ts';

/**
 * HTTP contract for the tournament backup export and reset endpoints.
 *
 * These run through the real Fastify stack with the real application services
 * over in-memory repositories, so they assert the HTTP contract - status codes,
 * the `{ data }` envelope, the backup shape and the reset effect - plus the
 * service rules, without a database.
 */

interface BackupBody {
  readonly data: {
    readonly tournament: { readonly id: string };
    readonly categories: readonly { readonly id: string }[];
    readonly stages: readonly { readonly id: string }[];
    readonly courts: readonly { readonly id: string }[];
    readonly entries: readonly { readonly id: string }[];
    readonly matches: readonly { readonly id: string; readonly status: string }[];
    readonly participants: readonly { readonly matchId: string }[];
    readonly games: readonly { readonly matchId: string }[];
  };
}

interface ResetBody {
  readonly data: {
    readonly tournamentId: string;
    readonly matchesReset: number;
    readonly stagesReopened: number;
  };
}

interface MatchesBody {
  readonly data: readonly {
    readonly id: string;
    readonly status: string;
    readonly winnerEntryId: string | null;
  }[];
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

interface Fixture {
  readonly tournamentId: string;
  readonly categoryId: string;
  readonly stageId: string;
  readonly matchId: string;
}

/** A registration-open tournament with a played (completed) GROUP match. */
async function seedPlayedMatch(): Promise<Fixture> {
  const tournament = await api.services.tournaments.create({
    name: `Backup Open ${Math.random()}`,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-03T00:00:00.000Z'),
    timezone: 'Asia/Kolkata',
  });
  await api.services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });

  const category = await api.services.categories.create(tournament.id, {
    name: 'Men Singles',
    code: 'MS',
    format: 'SINGLES',
  });
  await api.services.categories.transitionStatus(category.id, { status: 'OPEN' });

  const stage = await api.services.stages.create(category.id, {
    name: 'Group A',
    type: 'GROUP',
    sequence: 1,
  });
  await api.services.stages.transitionStatus(stage.id, { status: 'ACTIVE' });

  const match = await api.services.matches.create(stage.id, { sequence: 1 });
  const playerA = await api.services.players.create({ name: 'Alice' });
  const playerB = await api.services.players.create({ name: 'Bob' });
  const entryA = await api.services.entries.register({
    categoryId: category.id,
    playerId: playerA.id,
  });
  const entryB = await api.services.entries.register({
    categoryId: category.id,
    playerId: playerB.id,
  });
  await api.services.matches.addParticipant(match.id, { entryId: entryA.id, slot: 1 });
  await api.services.matches.addParticipant(match.id, { entryId: entryB.id, slot: 2 });
  await api.services.matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });
  await api.services.matchResults.recordResult(match.id, {
    games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 15 }],
  });

  return {
    tournamentId: tournament.id,
    categoryId: category.id,
    stageId: stage.id,
    matchId: match.id,
  };
}

describe('GET /api/v1/tournaments/:id/export', () => {
  it('returns the whole tournament in the data envelope', async () => {
    const fixture = await seedPlayedMatch();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/tournaments/${fixture.tournamentId}/export`,
    });

    expect(response.statusCode).toBe(200);
    const body: BackupBody = response.json();
    expect(body.data.tournament.id).toBe(fixture.tournamentId);
    expect(body.data.categories.map((row) => row.id)).toEqual([fixture.categoryId]);
    expect(body.data.stages.map((row) => row.id)).toEqual([fixture.stageId]);
    expect(body.data.entries).toHaveLength(2);
    expect(body.data.matches.map((row) => row.id)).toEqual([fixture.matchId]);
    expect(body.data.participants).toHaveLength(2);
    expect(body.data.games).toHaveLength(1);
    expect(body.data.games[0]?.matchId).toBe(fixture.matchId);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tournaments/00000000-0000-4000-8000-000000000000/export',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('POST /api/v1/tournaments/:id/reset', () => {
  it('returns the reset summary and returns every match to SCHEDULED with no winner', async () => {
    const fixture = await seedPlayedMatch();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${fixture.tournamentId}/reset`,
    });

    expect(response.statusCode).toBe(200);
    const body: ResetBody = response.json();
    expect(body.data).toEqual({
      tournamentId: fixture.tournamentId,
      matchesReset: 1,
      stagesReopened: 1,
    });

    const matches = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${fixture.stageId}/matches`,
    });
    expect(matches.statusCode).toBe(200);
    const matchesBody: MatchesBody = matches.json();
    const rows = matchesBody.data;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('SCHEDULED');
    expect(rows[0]?.winnerEntryId).toBeNull();
  });

  it('returns 409 for a COMPLETED tournament', async () => {
    const fixture = await seedPlayedMatch();
    await api.services.tournaments.transitionStatus(fixture.tournamentId, {
      status: 'REGISTRATION_CLOSED',
    });
    await api.services.tournaments.transitionStatus(fixture.tournamentId, {
      status: 'IN_PROGRESS',
    });
    await api.services.tournaments.transitionStatus(fixture.tournamentId, { status: 'COMPLETED' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${fixture.tournamentId}/reset`,
    });
    expect(response.statusCode).toBe(409);
  });

  it('returns 404 for an unknown id', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/tournaments/00000000-0000-4000-8000-000000000000/reset',
    });
    expect(response.statusCode).toBe(404);
  });
});
