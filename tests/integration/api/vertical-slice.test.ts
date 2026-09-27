import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../../apps/api/src/app.ts';
import { createApiServices } from '../../../apps/api/src/composition/api-services.ts';
import { createRepositoryClient, createPrismaUnitOfWork } from '@badminton/infrastructure';

import { openTestDatabase, resetTournamentData } from '../database/harness.ts';

/**
 * Vertical-slice API integration tests against **real PostgreSQL**.
 *
 * These exercise the complete path - HTTP -> Fastify -> route validation ->
 * application service -> repository port -> Prisma -> PostgreSQL - so the
 * route layer is proven against the real schema, indexes and constraint
 * translation, not just fakes. Only the flows whose value is end-to-end are
 * duplicated here; `routes.test.ts` covers the remaining HTTP contract.
 *
 * Uses a dedicated `<database>_api_test` database (a sibling of the schema and
 * application suites' databases) so the three can run in parallel without
 * resetting each other's rows. Skipped when no database is reachable; required
 * under CI.
 */

const database = await openTestDatabase('_api_test');

afterAll(async () => {
  await database?.disconnect();
});

describe.skipIf(!database)('API against PostgreSQL', () => {
  if (!database) {
    throw new Error('PostgreSQL is required for the API integration tests.');
  }

  const prisma = database.prisma;
  const client = createRepositoryClient(prisma);
  const unitOfWork = createPrismaUnitOfWork(prisma);
  const services = createApiServices(client, unitOfWork);

  let app: FastifyInstance;

  beforeEach(async () => {
    await resetTournamentData(prisma);
    app = buildApp({ checks: [], corsOrigins: [], services });
    await app.ready();
  });

  async function createPlayerThroughApi(name: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/players',
      payload: { name },
    });
    expect(response.statusCode).toBe(201);
    return response.json<{ data: { id: string } }>().data.id;
  }

  it('drives tournament setup, registration and participant assignment end to end', async () => {
    const tournament = await app.inject({
      method: 'POST',
      url: '/api/v1/tournaments',
      payload: {
        name: 'End to End Open',
        startDate: '2027-01-10',
        endDate: '2027-01-12',
        timezone: 'Asia/Kolkata',
      },
    });
    expect(tournament.statusCode).toBe(201);
    const tournamentId = tournament.json<{ data: { id: string } }>().data.id;

    const openRegistration = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/transition`,
      payload: { status: 'REGISTRATION_OPEN' },
    });
    expect(openRegistration.statusCode).toBe(200);

    const category = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/categories`,
      payload: { name: 'Mens Singles', code: 'ms', format: 'SINGLES' },
    });
    expect(category.statusCode).toBe(201);
    const categoryId = category.json<{ data: { id: string; code: string } }>().data.id;
    expect(category.json<{ data: { code: string } }>().data.code).toBe('MS');

    await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/transition`,
      payload: { status: 'OPEN' },
    });

    const playerOne = await createPlayerThroughApi('Registration One');
    const playerTwo = await createPlayerThroughApi('Registration Two');

    const entryOne = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/entries`,
      payload: { playerId: playerOne, seed: 1 },
    });
    expect(entryOne.statusCode).toBe(201);
    const entryOneId = entryOne.json<{ data: { id: string } }>().data.id;

    const entryTwo = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/entries`,
      payload: { playerId: playerTwo, seed: 2 },
    });
    expect(entryTwo.statusCode).toBe(201);
    const entryTwoId = entryTwo.json<{ data: { id: string } }>().data.id;

    const stage = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/stages`,
      payload: { name: 'Group', type: 'GROUP', sequence: 1 },
    });
    expect(stage.statusCode).toBe(201);
    const stageId = stage.json<{ data: { id: string } }>().data.id;

    const match = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stageId}/matches`,
      payload: { sequence: 1 },
    });
    expect(match.statusCode).toBe(201);
    const matchId = match.json<{ data: { id: string } }>().data.id;

    const slotOne = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/participants`,
      payload: { entryId: entryOneId, slot: 1 },
    });
    expect(slotOne.statusCode).toBe(201);

    const slotTwo = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/participants`,
      payload: { entryId: entryTwoId, slot: 2 },
    });
    expect(slotTwo.statusCode).toBe(201);

    const participants = await app.inject({
      method: 'GET',
      url: `/api/v1/matches/${matchId}/participants`,
    });
    expect(participants.statusCode).toBe(200);
    expect(participants.json<{ data: unknown[] }>().data).toHaveLength(2);

    // Confirm the rows really landed in PostgreSQL, not just in memory.
    expect(await prisma.tournamentEntry.count({ where: { categoryId } })).toBe(2);
    expect(await prisma.matchParticipant.count({ where: { matchId } })).toBe(2);
  });

  it('surfaces a database unique violation as a 409 conflict', async () => {
    await createPlayerThroughApi('Unique Email');

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/players',
      payload: { name: 'Unique Email', email: 'unique@example.com' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/players',
      payload: { name: 'Duplicate Email', email: 'UNIQUE@example.com' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { code: string } }>().error.code).toBe('CONFLICT');
  });

  it('maps a duplicate category code enforced by the database to 409', async () => {
    const tournament = await services.tournaments.create({
      name: 'Category Conflict',
      startDate: new Date('2027-02-01T00:00:00.000Z'),
      endDate: new Date('2027-02-02T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await services.categories.create(tournament.id, {
      name: 'Singles',
      code: 'MS',
      format: 'SINGLES',
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournament.id}/categories`,
      payload: { name: 'Other Singles', code: 'ms', format: 'SINGLES' },
    });

    expect(response.statusCode).toBe(409);
  });

  it('returns 404 for a well-formed but absent tournament', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/tournaments/11111111-1111-4111-8111-111111111111',
    });
    expect(response.statusCode).toBe(404);
  });

  async function startedGroupMatch(): Promise<{
    matchId: string;
    stageId: string;
    entryOne: string;
    entryTwo: string;
  }> {
    const tournament = await services.tournaments.create({
      name: 'Scoring Slice',
      startDate: new Date('2027-04-01T00:00:00.000Z'),
      endDate: new Date('2027-04-02T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    const category = await services.categories.create(tournament.id, {
      name: 'Mens Singles',
      code: 'MS',
      format: 'SINGLES',
    });
    await services.categories.transitionStatus(category.id, { status: 'OPEN' });
    const stage = await services.stages.create(category.id, {
      name: 'Group',
      type: 'GROUP',
      sequence: 1,
    });
    const match = await services.matches.create(stage.id, { sequence: 1 });
    const one = await services.players.create({ name: 'Slice One' });
    const two = await services.players.create({ name: 'Slice Two' });
    const entryOne = await services.entries.register({ categoryId: category.id, playerId: one.id });
    const entryTwo = await services.entries.register({ categoryId: category.id, playerId: two.id });
    await services.matches.addParticipant(match.id, { entryId: entryOne.id, slot: 1 });
    await services.matches.addParticipant(match.id, { entryId: entryTwo.id, slot: 2 });
    await services.matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });
    return { matchId: match.id, stageId: stage.id, entryOne: entryOne.id, entryTwo: entryTwo.id };
  }

  const twoZero = [
    { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
    { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
  ];

  it('records a result and reflects it in the standings end to end', async () => {
    const { matchId, stageId, entryOne } = await startedGroupMatch();

    const recorded = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: { games: twoZero },
    });
    expect(recorded.statusCode).toBe(201);
    expect(recorded.json<{ data: { winnerEntryId: string } }>().data.winnerEntryId).toBe(entryOne);

    // The result really landed in PostgreSQL.
    expect(await prisma.matchGame.count({ where: { matchId } })).toBe(2);
    const stored = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(stored.status).toBe('COMPLETED');
    expect(stored.winnerEntryId).toBe(entryOne);

    const standings = await app.inject({
      method: 'GET',
      url: `/api/v1/stages/${stageId}/standings`,
    });
    expect(standings.statusCode).toBe(200);
    const leader = standings
      .json<{ data: { entryId: string; position: number; won: number }[] }>()
      .data.find((row) => row.entryId === entryOne);
    expect(leader).toMatchObject({ position: 1, won: 1 });
  });

  it('rolls back a failed completion so no partial result remains', async () => {
    const { matchId } = await startedGroupMatch();

    // An invalid score is rejected before any transaction opens; nothing is
    // written and the match keeps its state.
    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: {
        games: [
          { gameNumber: 1, participant1Points: 21, participant2Points: 20 },
          { gameNumber: 2, participant1Points: 21, participant2Points: 15 },
        ],
      },
    });
    expect(invalid.statusCode).toBe(422);

    expect(await prisma.matchGame.count({ where: { matchId } })).toBe(0);
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe('IN_PROGRESS');
    expect(match.winnerEntryId).toBeNull();
  });

  it('rolls back a mid-transaction write so no partial result remains', async () => {
    const { matchId } = await startedGroupMatch();

    // Force a failure *inside* the unit of work: a pre-existing game 1 makes the
    // service's insert violate the real unique(matchId, gameNumber) constraint,
    // so the transaction aborts after it has already opened.
    await prisma.matchGame.create({
      data: {
        matchId,
        gameNumber: 1,
        participant1Points: 21,
        participant2Points: 10,
        winnerSlot: 1,
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${matchId}/result`,
      payload: { games: twoZero },
    });
    expect(response.statusCode).toBe(409);

    // The match is untouched and only the pre-existing game survives.
    expect(await prisma.matchGame.count({ where: { matchId } })).toBe(1);
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(match.status).toBe('IN_PROGRESS');
    expect(match.winnerEntryId).toBeNull();
  });

  it('rejects a conflicting concurrent completion without duplicating games', async () => {
    const { matchId } = await startedGroupMatch();

    // Two operators complete the same match at once. Exactly one may win; the
    // loser must fail as a conflict, and the games must not be duplicated.
    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/matches/${matchId}/result`,
        payload: { games: twoZero },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/matches/${matchId}/result`,
        payload: { games: twoZero },
      }),
    ]);

    const statuses = [first.statusCode, second.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await prisma.matchGame.count({ where: { matchId } })).toBe(2);

    const stored = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect(stored.status).toBe('COMPLETED');
  });

  it('persists a lifecycle transition and rejects the next invalid one', async () => {
    const tournament = await app.inject({
      method: 'POST',
      url: '/api/v1/tournaments',
      payload: {
        name: 'Lifecycle Slice',
        startDate: '2027-03-01',
        endDate: '2027-03-03',
        timezone: 'Asia/Kolkata',
      },
    });
    const tournamentId = tournament.json<{ data: { id: string } }>().data.id;

    const open = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/transition`,
      payload: { status: 'REGISTRATION_OPEN' },
    });
    expect(open.statusCode).toBe(200);

    const invalid = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/transition`,
      payload: { status: 'COMPLETED' },
    });
    expect(invalid.statusCode).toBe(409);

    // The stored row reflects the successful transition only.
    const stored = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    expect(stored.status).toBe('REGISTRATION_OPEN');
  });

  it('drives a full knockout bracket from setup to champion', async () => {
    const tournament = await app.inject({
      method: 'POST',
      url: '/api/v1/tournaments',
      payload: {
        name: 'Knockout Slice',
        startDate: '2027-05-01',
        endDate: '2027-05-03',
        timezone: 'Asia/Kolkata',
      },
    });
    const tournamentId = tournament.json<{ data: { id: string } }>().data.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/transition`,
      payload: { status: 'REGISTRATION_OPEN' },
    });

    const category = await app.inject({
      method: 'POST',
      url: `/api/v1/tournaments/${tournamentId}/categories`,
      payload: { name: 'Mens Singles', code: 'MS', format: 'SINGLES' },
    });
    const categoryId = category.json<{ data: { id: string } }>().data.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/transition`,
      payload: { status: 'OPEN' },
    });

    const entryIds: string[] = [];
    for (let index = 1; index <= 4; index += 1) {
      const playerId = await createPlayerThroughApi(`Knockout Player ${String(index)}`);
      const entry = await app.inject({
        method: 'POST',
        url: `/api/v1/categories/${categoryId}/entries`,
        payload: { playerId },
      });
      expect(entry.statusCode).toBe(201);
      entryIds.push(entry.json<{ data: { id: string } }>().data.id);
    }

    const stage = await app.inject({
      method: 'POST',
      url: `/api/v1/categories/${categoryId}/stages`,
      payload: { name: 'Knockout', type: 'KNOCKOUT', sequence: 1 },
    });
    expect(stage.statusCode).toBe(201);
    const stageId = stage.json<{ data: { id: string } }>().data.id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stageId}/transition`,
      payload: { status: 'ACTIVE' },
    });

    // Generate the 4-entry bracket in the caller-supplied order.
    const generated = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stageId}/bracket`,
      payload: { entryIds },
    });
    expect(generated.statusCode).toBe(201);

    type BracketResponse = {
      readonly data: {
        readonly bracketSize: number;
        readonly complete: boolean;
        readonly status: string;
        readonly rounds: readonly {
          readonly roundNumber: number;
          readonly matches: readonly {
            readonly matchId: string;
            readonly matchNumber: number;
            readonly participant1: { readonly entryId: string | null };
            readonly participant2: { readonly entryId: string | null };
            readonly winnerEntryId: string | null;
          }[];
        }[];
      };
    };

    const read = async (): Promise<BracketResponse['data']> => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/stages/${stageId}/bracket`,
      });
      expect(response.statusCode).toBe(200);
      return response.json<BracketResponse>().data;
    };

    const first = await read();
    expect(first.bracketSize).toBe(4);
    expect(first.rounds.map((round) => round.matches.length)).toEqual([2, 1]);
    const semi1 = first.rounds[0]?.matches[0];
    const semi2 = first.rounds[0]?.matches[1];
    expect(semi1?.participant1.entryId).toBe(entryIds[0]);
    expect(semi1?.participant2.entryId).toBe(entryIds[1]);
    expect(semi2?.participant1.entryId).toBe(entryIds[2]);
    expect(semi2?.participant2.entryId).toBe(entryIds[3]);
    // The final starts unresolved - no placeholder ids.
    expect(first.rounds[1]?.matches[0]?.participant1.entryId).toBeNull();
    expect(first.rounds[1]?.matches[0]?.participant2.entryId).toBeNull();

    // A later-round match cannot start before its slots are filled.
    const premature = await app.inject({
      method: 'POST',
      url: `/api/v1/matches/${first.rounds[1]?.matches[0]?.matchId ?? ''}/transition`,
      payload: { status: 'IN_PROGRESS' },
    });
    expect(premature.statusCode).toBe(422);

    const play = async (matchId: string): Promise<string> => {
      const start = await app.inject({
        method: 'POST',
        url: `/api/v1/matches/${matchId}/transition`,
        payload: { status: 'IN_PROGRESS' },
      });
      expect(start.statusCode).toBe(200);
      const result = await app.inject({
        method: 'POST',
        url: `/api/v1/matches/${matchId}/result`,
        payload: { games: twoZero },
      });
      expect(result.statusCode).toBe(201);
      return result.json<{ data: { winnerEntryId: string } }>().data.winnerEntryId;
    };

    const semi1Winner = await play(semi1?.matchId ?? '');
    const afterSemi1 = await read();
    expect(afterSemi1.rounds[1]?.matches[0]?.participant1.entryId).toBe(semi1Winner);
    expect(afterSemi1.rounds[1]?.matches[0]?.participant2.entryId).toBeNull();
    // Stage stays active until the final is decided.
    expect(afterSemi1.status).toBe('ACTIVE');

    const semi2Winner = await play(semi2?.matchId ?? '');
    const beforeFinal = await read();
    const final = beforeFinal.rounds[1]?.matches[0];
    expect(final?.participant1.entryId).toBe(semi1Winner);
    expect(final?.participant2.entryId).toBe(semi2Winner);

    const champion = await play(final?.matchId ?? '');
    expect([semi1Winner, semi2Winner]).toContain(champion);

    const completed = await read();
    expect(completed.complete).toBe(true);
    expect(completed.status).toBe('COMPLETED');

    // The progression is persisted, not just reported.
    const finalRow = await prisma.match.findUniqueOrThrow({ where: { id: final?.matchId ?? '' } });
    expect(finalRow.status).toBe('COMPLETED');
    expect(finalRow.winnerEntryId).toBe(champion);
    expect(await prisma.matchGame.count({ where: { matchId: final?.matchId ?? '' } })).toBe(2);
  });

  it('rejects an unsupported bracket size against the real database', async () => {
    const tournament = await services.tournaments.create({
      name: 'Bracket Size Slice',
      startDate: new Date('2027-06-01T00:00:00.000Z'),
      endDate: new Date('2027-06-02T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    const category = await services.categories.create(tournament.id, {
      name: 'Mens Singles',
      code: 'MS',
      format: 'SINGLES',
    });
    await services.categories.transitionStatus(category.id, { status: 'OPEN' });
    const stage = await services.stages.create(category.id, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
    });
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const player = await services.players.create({ name: `Size ${String(index)}` });
      const entry = await services.entries.register({
        categoryId: category.id,
        playerId: player.id,
      });
      ids.push(entry.id);
    }

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stage.id}/bracket`,
      payload: { entryIds: ids },
    });
    expect(response.statusCode).toBe(422);
    expect(await prisma.match.count({ where: { stageId: stage.id } })).toBe(0);
  });

  it('rejects a withdrawn entry and a duplicate bracket generation', async () => {
    const tournament = await services.tournaments.create({
      name: 'Bracket Guard Slice',
      startDate: new Date('2027-07-01T00:00:00.000Z'),
      endDate: new Date('2027-07-02T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    const category = await services.categories.create(tournament.id, {
      name: 'Mens Singles',
      code: 'MS',
      format: 'SINGLES',
    });
    await services.categories.transitionStatus(category.id, { status: 'OPEN' });
    const stage = await services.stages.create(category.id, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
    });
    const one = await services.players.create({ name: 'Guard One' });
    const two = await services.players.create({ name: 'Guard Two' });
    const three = await services.players.create({ name: 'Guard Three' });
    const entryOne = await services.entries.register({ categoryId: category.id, playerId: one.id });
    const entryTwo = await services.entries.register({ categoryId: category.id, playerId: two.id });
    const entryThree = await services.entries.register({
      categoryId: category.id,
      playerId: three.id,
    });
    await services.entries.withdraw(entryTwo.id);

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stage.id}/bracket`,
      payload: { entryIds: [entryOne.id, entryTwo.id] },
    });
    expect(rejected.statusCode).toBe(422);
    expect(await prisma.match.count({ where: { stageId: stage.id } })).toBe(0);

    // A valid bracket then rejects a second generation as a conflict.
    const valid = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stage.id}/bracket`,
      payload: { entryIds: [entryOne.id, entryThree.id] },
    });
    expect(valid.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/v1/stages/${stage.id}/bracket`,
      payload: { entryIds: [entryOne.id, entryThree.id] },
    });
    expect(duplicate.statusCode).toBe(409);
  });

  it('keeps a knockout result and its progression atomic under concurrency', async () => {
    const tournament = await services.tournaments.create({
      name: 'Bracket Concurrency',
      startDate: new Date('2027-08-01T00:00:00.000Z'),
      endDate: new Date('2027-08-02T00:00:00.000Z'),
      timezone: 'Asia/Kolkata',
    });
    await services.tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
    const category = await services.categories.create(tournament.id, {
      name: 'Mens Singles',
      code: 'MS',
      format: 'SINGLES',
    });
    await services.categories.transitionStatus(category.id, { status: 'OPEN' });
    const stage = await services.stages.create(category.id, {
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
    });
    const ids: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const player = await services.players.create({ name: `Concurrent ${String(index)}` });
      const entry = await services.entries.register({
        categoryId: category.id,
        playerId: player.id,
      });
      ids.push(entry.id);
    }
    const bracket = await services.knockout.generateBracket(stage.id, { entryIds: ids });
    const semi1 = bracket.rounds[0]?.matches[0]?.matchId ?? '';
    const finalMatchId = bracket.rounds[1]?.matches[0]?.matchId ?? '';
    await services.matches.transitionStatus(semi1, { status: 'IN_PROGRESS' });

    const [first, second] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/api/v1/matches/${semi1}/result`,
        payload: { games: twoZero },
      }),
      app.inject({
        method: 'POST',
        url: `/api/v1/matches/${semi1}/result`,
        payload: { games: twoZero },
      }),
    ]);

    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    expect(await prisma.matchGame.count({ where: { matchId: semi1 } })).toBe(2);
    // The winner reached the final exactly once - no duplicate slot rows.
    const finalSlots = await prisma.matchParticipant.findMany({
      where: { matchId: finalMatchId },
    });
    expect(finalSlots).toHaveLength(1);
    expect(finalSlots[0]?.slot).toBe(1);
  });
});
