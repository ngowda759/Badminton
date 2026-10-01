import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestApi, type TestApi } from './harness.ts';

/**
 * HTTP contract for group qualification and qualifier-driven bracket generation.
 *
 * The real Fastify stack and real services run over the in-memory repositories,
 * so these assert the HTTP surface - status codes, envelopes, error codes - for
 * the TASK-4 progression endpoints. The bracket and qualification rules
 * themselves are covered by the application/domain unit tests.
 */

interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
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

async function openCategory(tournamentId: string): Promise<string> {
  const category = await api.services.categories.create(tournamentId, {
    name: 'Mens Singles',
    code: 'MS',
    format: 'SINGLES',
  });
  await api.services.categories.transitionStatus(category.id, { status: 'OPEN' });
  return category.id;
}

async function registerPlayers(categoryId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const player = await api.services.players.create({ name: `Player ${String(index + 1)}` });
    const entry = await api.services.entries.register({ categoryId, playerId: player.id });
    await api.services.entries.confirm(entry.id);
    ids.push(entry.id);
  }
  return ids;
}

/**
 * Sets up a category with `groupSizes.length` groups, generates a round-robin
 * in each and completes every match so qualification is ready. Returns the
 * knockout stage id.
 */
async function readyKnockout(
  groupSizes: readonly number[],
): Promise<{ categoryId: string; knockoutStageId: string }> {
  const total = groupSizes.reduce((sum, size) => sum + size, 0);
  const tournament = await api.services.tournaments.create({
    name: 'Progression HTTP',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-03T00:00:00.000Z'),
    timezone: 'Asia/Kolkata',
  });
  await api.services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
  const categoryId = await openCategory(tournament.id);
  const entryIds = await registerPlayers(categoryId, total);

  let cursor = 0;
  for (let index = 0; index < groupSizes.length; index += 1) {
    const size = groupSizes[index] ?? 0;
    const groupEntries = entryIds.slice(cursor, cursor + size);
    cursor += size;

    const group = await api.services.stages.create(categoryId, {
      name: `Group ${String.fromCharCode(65 + index)}`,
      type: 'GROUP',
      sequence: index + 1,
      qualifiersPerGroup: 2,
    });
    await api.services.groupFixtures.generate(group.id, { entryIds: groupEntries });

    for (const match of await api.services.matches.listByStage(group.id)) {
      await api.services.matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });
      await api.services.matchResults.recordResult(match.id, {
        games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 11 }],
      });
    }
  }

  const knockoutStage = await api.services.stages.create(categoryId, {
    name: 'Knockout',
    type: 'KNOCKOUT',
    sequence: groupSizes.length + 1,
  });
  await api.services.stages.transitionStatus(knockoutStage.id, { status: 'ACTIVE' });
  return { categoryId, knockoutStageId: knockoutStage.id };
}

describe('/api/v1 stages/:id/qualification', () => {
  it('returns the derived qualification view with the data envelope', async () => {
    const { knockoutStageId } = await readyKnockout([4, 4]);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${knockoutStageId}/qualification`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      data: {
        ready: boolean;
        qualifierCount: number;
        bracketSize: number;
        byeCount: number;
        seeds: readonly string[];
        groups: readonly { groupId: string }[];
      };
    }>();

    expect(body.data.ready).toBe(true);
    expect(body.data.qualifierCount).toBe(4);
    expect(body.data.bracketSize).toBe(4);
    expect(body.data.byeCount).toBe(0);
    expect(body.data.seeds).toHaveLength(4);
    expect(body.data.groups).toHaveLength(2);
  });

  it('reports not-ready while group matches are incomplete', async () => {
    const tournament = await api.services.tournaments.create({
      name: 'Incomplete',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await api.services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    const categoryId = await openCategory(tournament.id);
    const entryIds = await registerPlayers(categoryId, 4);
    const group = await api.services.stages.create(categoryId, {
      name: 'Group A',
      type: 'GROUP',
      sequence: 1,
      qualifiersPerGroup: 2,
    });
    await api.services.groupFixtures.generate(group.id, { entryIds });
    const knockout = await api.services.stages.create(categoryId, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 2,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${knockout.id}/qualification`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ data: { ready: boolean; blockedReason: string | null } }>();
    expect(body.data.ready).toBe(false);
    expect(body.data.blockedReason).toBeTruthy();
  });

  it('maps a GROUP stage id to 422', async () => {
    const { categoryId } = await readyKnockout([4]);
    const group = await api.services.stages.create(categoryId, {
      name: 'Group Z',
      type: 'GROUP',
      sequence: 5,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${group.id}/qualification`,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('returns 404 for a missing stage', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/stages/11111111-1111-4111-8111-111111111111/qualification',
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('/api/v1 stages/:id/bracket/generate', () => {
  it('generates the bracket from the qualifiers and returns 201', async () => {
    const { knockoutStageId } = await readyKnockout([4, 4]);

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${knockoutStageId}/bracket/generate`,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{
      data: {
        bracketSize: number;
        rounds: readonly {
          name: string;
          matches: readonly { participant1: { entryId: string | null } }[];
        }[];
      };
    }>();
    expect(body.data.bracketSize).toBe(4);
    expect(body.data.rounds.map((round) => round.name)).toEqual(['Semifinals', 'Final']);
    // Every semi-final slot is a real qualifier - no placeholder entries.
    for (const semi of body.data.rounds[0]?.matches ?? []) {
      expect(semi.participant1.entryId).not.toBeNull();
    }
  });

  it('returns 422 while the group stage is incomplete', async () => {
    const tournament = await api.services.tournaments.create({
      name: 'Incomplete bracket',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await api.services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    const categoryId = await openCategory(tournament.id);
    const entryIds = await registerPlayers(categoryId, 4);
    const group = await api.services.stages.create(categoryId, {
      name: 'Group A',
      type: 'GROUP',
      sequence: 1,
      qualifiersPerGroup: 2,
    });
    await api.services.groupFixtures.generate(group.id, { entryIds });
    const knockout = await api.services.stages.create(categoryId, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 2,
    });
    await api.services.stages.transitionStatus(knockout.id, { status: 'ACTIVE' });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${knockout.id}/bracket/generate`,
    });

    expect(response.statusCode).toBe(422);
    expect(response.json<ErrorBody>().error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('maps a second generation to 409', async () => {
    const { knockoutStageId } = await readyKnockout([4, 4]);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${knockoutStageId}/bracket/generate`,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${knockoutStageId}/bracket/generate`,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<ErrorBody>().error.code).toBe('CONFLICT');
  });
});

describe('/api/v1 stages/:id/bracket (explicit pairings)', () => {
  it('accepts explicit pairings with a bye and returns 201', async () => {
    const tournament = await api.services.tournaments.create({
      name: 'Bye bracket',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await api.services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    const categoryId = await openCategory(tournament.id);
    const entryIds = await registerPlayers(categoryId, 3);
    const stage = await api.services.stages.create(categoryId, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stage.id}/bracket`,
      payload: {
        pairings: [
          { first: entryIds[0], second: null },
          { first: entryIds[1], second: entryIds[2] },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json<{ data: { bracketSize: number } }>();
    expect(body.data.bracketSize).toBe(4);
  });

  it('rejects supplying both entryIds and pairings with 400', async () => {
    const tournament = await api.services.tournaments.create({
      name: 'Both shapes',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await api.services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    const categoryId = await openCategory(tournament.id);
    const entryIds = await registerPlayers(categoryId, 2);
    const stage = await api.services.stages.create(categoryId, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stage.id}/bracket`,
      payload: {
        entryIds,
        pairings: [{ first: entryIds[0], second: entryIds[1] }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a malformed body with 400', async () => {
    const tournament = await api.services.tournaments.create({
      name: 'Malformed',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await api.services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    const categoryId = await openCategory(tournament.id);
    const stage = await api.services.stages.create(categoryId, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stage.id}/bracket`,
      payload: { pairings: [{ first: 'not-a-uuid', second: null }] },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('/api/v1 stages (qualification config)', () => {
  it('accepts qualifiersPerGroup on stage creation', async () => {
    const tournament = await api.services.tournaments.create({
      name: 'Stage config',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    const category = await api.services.categories.create(tournament.id, {
      name: 'MS',
      code: 'MS',
      format: 'SINGLES',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${category.id}/stages`,
      payload: { name: 'Group A', type: 'GROUP', sequence: 1, qualifiersPerGroup: 2 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ data: { qualifiersPerGroup: number } }>().data.qualifiersPerGroup).toBe(
      2,
    );
  });

  it('rejects a non-positive qualifiersPerGroup with 400', async () => {
    const tournament = await api.services.tournaments.create({
      name: 'Stage config bad',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-03T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    const category = await api.services.categories.create(tournament.id, {
      name: 'MS',
      code: 'MS',
      format: 'SINGLES',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${category.id}/stages`,
      payload: { name: 'Group A', type: 'GROUP', sequence: 1, qualifiersPerGroup: 0 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });
});
