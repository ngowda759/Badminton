import {
  createMatchService,
  createPlayerService,
  createTeamService,
  createTournamentCategoryService,
  createTournamentEntryService,
  createTournamentService,
  createTournamentStageService,
  type RepositoryClient,
  type UnitOfWork,
} from '@badminton/application';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import {
  seedCategory,
  seedMatch,
  seedPlayer,
  seedStage,
  seedTeamWithMembers,
  seedTournament,
} from './fixtures.ts';

/**
 * Transaction-boundary tests.
 *
 * They assert the hardening rule: read-only and single-write service methods use
 * the plain repository client, while operations that must observe or update more
 * than one row atomically run inside exactly one `runInTransaction`. The fake
 * unit of work is wrapped in a counter, so the service's real dependency is
 * exercised - only the number of transactions it opens is observed.
 */

interface CountingUnitOfWork {
  readonly unitOfWork: UnitOfWork;
  transactions(): number;
}

function counting(repos: FakeRepositories): CountingUnitOfWork {
  let count = 0;
  return {
    unitOfWork: {
      async runInTransaction<T>(work: (client: RepositoryClient) => Promise<T>): Promise<T> {
        count += 1;
        return repos.unitOfWork.runInTransaction(work);
      },
    },
    transactions: () => count,
  };
}

let repos: FakeRepositories;
let counter: CountingUnitOfWork;

beforeEach(() => {
  repos = createFakeRepositories();
  counter = counting(repos);
});

function services() {
  return {
    tournaments: createTournamentService(repos.client),
    categories: createTournamentCategoryService(repos.client),
    players: createPlayerService(repos.client),
    teams: createTeamService(repos.client, counter.unitOfWork),
    entries: createTournamentEntryService(repos.client, counter.unitOfWork),
    stages: createTournamentStageService(repos.client),
    matches: createMatchService(repos.client, counter.unitOfWork),
  };
}

/** Runs `operation`, returning how many transactions it opened. */
async function transactionsUsed(operation: () => Promise<unknown>): Promise<number> {
  const before = counter.transactions();
  await operation();
  return counter.transactions() - before;
}

describe('read-only operations do not open an interactive transaction', () => {
  it('runs the read operations without a transaction', async () => {
    const { tournaments, categories, players, teams, entries, stages, matches } = services();

    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const playerId = await seedPlayer(repos.client);
    const { teamId } = await seedTeamWithMembers(repos.client, {});
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    await entries.register({ categoryId, playerId });

    const before = counter.transactions();

    await tournaments.getById(tournamentId);
    await categories.getById(categoryId);
    await categories.listByTournament(tournamentId);
    await players.getById(playerId);
    await teams.getById(teamId);
    await teams.listMembers(teamId);
    await entries.listByCategory(categoryId);
    await stages.getById(stageId);
    await stages.listByCategory(categoryId);
    await matches.getById(matchId);
    await matches.listByStage(stageId);
    await matches.listParticipants(matchId);

    expect(counter.transactions()).toBe(before);
  });

  it('runs a not-found read without a transaction', async () => {
    const { entries } = services();
    const before = counter.transactions();
    await expect(entries.getById('missing')).rejects.toBeDefined();
    expect(counter.transactions()).toBe(before);
  });
});

describe('single-write operations do not open an interactive transaction', () => {
  it('creates and updates each aggregate without a transaction', async () => {
    const { tournaments, categories, players, teams, stages, matches } = services();

    const tournamentId = await seedTournament(repos.client, { status: 'DRAFT' });
    const categoryId = await seedCategory(repos.client, { tournamentId, status: 'DRAFT' });
    const playerId = await seedPlayer(repos.client);
    const { teamId } = await seedTeamWithMembers(repos.client, {});
    const stageId = await seedStage(repos.client, categoryId, { status: 'PENDING' });
    const matchId = await seedMatch(repos.client, stageId);

    expect(
      await transactionsUsed(() =>
        tournaments.create({
          name: 'Boundary Open',
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          endDate: new Date('2026-10-03T00:00:00.000Z'),
          timezone: 'Asia/Kolkata',
        }),
      ),
    ).toBe(0);
    expect(
      await transactionsUsed(() => tournaments.update(tournamentId, { name: 'Renamed' })),
    ).toBe(0);
    expect(
      await transactionsUsed(() =>
        tournaments.transitionStatus(tournamentId, { status: 'REGISTRATION_OPEN' }),
      ),
    ).toBe(0);

    expect(
      await transactionsUsed(() =>
        categories.create(tournamentId, { name: 'Womens Singles', code: 'WS', format: 'SINGLES' }),
      ),
    ).toBe(0);
    expect(await transactionsUsed(() => categories.update(categoryId, { name: 'Open' }))).toBe(0);
    expect(
      await transactionsUsed(() => categories.transitionStatus(categoryId, { status: 'OPEN' })),
    ).toBe(0);

    expect(await transactionsUsed(() => players.create({ name: 'New Player' }))).toBe(0);
    expect(await transactionsUsed(() => players.update(playerId, { name: 'Updated' }))).toBe(0);

    expect(await transactionsUsed(() => teams.update(teamId, { name: 'Renamed Team' }))).toBe(0);

    expect(
      await transactionsUsed(() =>
        stages.create(categoryId, { name: 'Knockout', type: 'KNOCKOUT', sequence: 5 }),
      ),
    ).toBe(0);
    expect(await transactionsUsed(() => stages.update(stageId, { name: 'Group A' }))).toBe(0);
    expect(
      await transactionsUsed(() => stages.transitionStatus(stageId, { status: 'ACTIVE' })),
    ).toBe(0);

    expect(await transactionsUsed(() => matches.update(matchId, { roundNumber: 1 }))).toBe(0);
    expect(
      await transactionsUsed(() => matches.transitionStatus(matchId, { status: 'IN_PROGRESS' })),
    ).toBe(0);
  });

  it('updates an entry seed without a transaction', async () => {
    const { entries } = services();
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const playerId = await seedPlayer(repos.client);
    const entry = await entries.register({ categoryId, playerId });

    expect(await transactionsUsed(() => entries.update(entry.id, { seed: 3 }))).toBe(0);
  });
});

describe('atomic operations open exactly one transaction', () => {
  it('wraps each multi-write operation in a single transaction', async () => {
    const { teams, entries, matches } = services();

    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const playerA = await seedPlayer(repos.client, 'A');
    const playerB = await seedPlayer(repos.client, 'B');

    expect(
      await transactionsUsed(() =>
        teams.create({ name: 'Pair', memberPlayerIds: [playerA, playerB] }),
      ),
    ).toBe(1);

    const { teamId } = await seedTeamWithMembers(repos.client, { name: 'Seeded Pair' });
    const extra = await seedPlayer(repos.client, 'C');
    expect(await transactionsUsed(() => teams.addMember(teamId, { playerId: extra }))).toBe(1);
    expect(await transactionsUsed(() => teams.removeMember(teamId, extra))).toBe(1);

    expect(await transactionsUsed(() => entries.register({ categoryId, playerId: playerA }))).toBe(
      1,
    );

    const singlesCategory = await seedCategory(repos.client, {
      tournamentId,
      name: 'Womens Singles',
      code: 'WS',
    });
    const singles = await entries.register({ categoryId: singlesCategory, playerId: playerB });
    expect(await transactionsUsed(() => entries.withdraw(singles.id))).toBe(1);

    const stageId = await seedStage(repos.client, categoryId);
    expect(await transactionsUsed(() => matches.create(stageId, { sequence: 9 }))).toBe(1);

    const doublesCategory = await seedCategory(repos.client, {
      tournamentId,
      name: 'Mixed Doubles',
      code: 'XD',
      format: 'DOUBLES',
    });
    const doublesStage = await seedStage(repos.client, doublesCategory, { sequence: 2 });
    const doublesMatch = await seedMatch(repos.client, doublesStage, 2);
    const { teamId: doublesTeam } = await seedTeamWithMembers(repos.client, { name: 'D Pair' });
    const doublesEntry = await entries.register({
      categoryId: doublesCategory,
      teamId: doublesTeam,
    });

    expect(
      await transactionsUsed(() =>
        matches.addParticipant(doublesMatch, { entryId: doublesEntry.id, slot: 1 }),
      ),
    ).toBe(1);
  });
});
