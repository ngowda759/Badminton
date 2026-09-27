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
});
