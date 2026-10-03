import {
  createCourtService,
  createGroupFixtureService,
  createKnockoutBracketService,
  createKnockoutCorrectionService,
  createKnockoutProgressionService,
  createMatchResultService,
  createMatchService,
  createPlayerService,
  createRealtimeEventService,
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
  seedCourt,
  seedKnockoutStage,
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
    tournaments: createTournamentService(
      repos.client,
      counter.unitOfWork,
      createRealtimeEventService(),
    ),
    categories: createTournamentCategoryService(
      repos.client,
      counter.unitOfWork,
      createRealtimeEventService(),
    ),
    players: createPlayerService(repos.client),
    teams: createTeamService(repos.client, counter.unitOfWork),
    entries: createTournamentEntryService(
      repos.client,
      counter.unitOfWork,
      createRealtimeEventService(),
    ),
    stages: createTournamentStageService(
      repos.client,
      counter.unitOfWork,
      createRealtimeEventService(),
    ),
    matches: createMatchService(repos.client, counter.unitOfWork, createRealtimeEventService()),
    courts: createCourtService(repos.client, counter.unitOfWork, createRealtimeEventService()),
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
        categories.create(tournamentId, { name: 'Womens Singles', code: 'WS', format: 'SINGLES' }),
      ),
    ).toBe(0);
    expect(await transactionsUsed(() => categories.update(categoryId, { name: 'Open' }))).toBe(0);

    expect(await transactionsUsed(() => players.create({ name: 'New Player' }))).toBe(0);
    expect(await transactionsUsed(() => players.update(playerId, { name: 'Updated' }))).toBe(0);

    expect(await transactionsUsed(() => teams.update(teamId, { name: 'Renamed Team' }))).toBe(0);

    expect(
      await transactionsUsed(() =>
        stages.create(categoryId, { name: 'Knockout', type: 'KNOCKOUT', sequence: 5 }),
      ),
    ).toBe(0);
    expect(await transactionsUsed(() => stages.update(stageId, { name: 'Group A' }))).toBe(0);

    expect(await transactionsUsed(() => matches.update(matchId, { roundNumber: 1 }))).toBe(0);
  });

  it('updates an entry seed without a transaction', async () => {
    const { entries } = services();
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const playerId = await seedPlayer(repos.client);
    const entry = await entries.register({ categoryId, playerId });

    expect(await transactionsUsed(() => entries.update(entry.id, { seed: 3 }))).toBe(0);
  });

  it('removes an empty stage without a transaction', async () => {
    const { stages } = services();
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const first = await seedStage(repos.client, categoryId, { sequence: 1 });
    await seedStage(repos.client, categoryId, { sequence: 2 });

    expect(await transactionsUsed(() => stages.remove(first))).toBe(0);
  });

  it('removes a court without a transaction', async () => {
    const { courts } = services();
    const tournamentId = await seedTournament(repos.client);
    const first = await seedCourt(repos.client, tournamentId, { number: 1 });
    await seedCourt(repos.client, tournamentId, { number: 2 });

    // The `matches.courtId` Restrict FK is the concurrency boundary, so the
    // guard and the single delete do not need a service transaction.
    expect(await transactionsUsed(() => courts.remove(first))).toBe(0);
  });

  it('keeps the court create/update/transition boundaries unchanged', async () => {
    const { courts } = services();
    const tournamentId = await seedTournament(repos.client);
    const courtId = await seedCourt(repos.client, tournamentId);

    // Each court mutation owns a single write plus its outbox event, so each
    // opens exactly one transaction - unchanged by the removal work.
    expect(
      await transactionsUsed(() => courts.create(tournamentId, { number: 2, name: 'Court 2' })),
    ).toBe(1);
    expect(await transactionsUsed(() => courts.update(courtId, { name: 'Centre' }))).toBe(1);
    expect(
      await transactionsUsed(() => courts.transitionStatus(courtId, { status: 'INACTIVE' })),
    ).toBe(1);
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

  it('wraps group-fixture generation and regeneration in exactly one transaction', async () => {
    const { entries } = services();
    const fixtures = createGroupFixtureService(counter.unitOfWork);
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const playerId = await seedPlayer(repos.client, `Player ${String(index + 1)}`);
      const entry = await entries.register({ categoryId, playerId });
      entryIds.push(entry.id);
    }

    expect(await transactionsUsed(() => fixtures.generate(stageId, { entryIds }))).toBe(1);

    // Regeneration replaces the whole fixture set and opens exactly one
    // transaction; the reference generation boundary is unchanged.
    expect(await transactionsUsed(() => fixtures.regenerate(stageId, { entryIds }))).toBe(1);
  });

  it('wraps knockout bracket generation in a single transaction', async () => {
    const { entries, stages } = services();
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const playerA = await seedPlayer(repos.client, 'A');
    const playerB = await seedPlayer(repos.client, 'B');
    const entryA = await entries.register({ categoryId, playerId: playerA });
    const entryB = await entries.register({ categoryId, playerId: playerB });
    await stages.transitionStatus(stageId, { status: 'ACTIVE' });

    const knockout = createKnockoutBracketService(repos.client, counter.unitOfWork);
    expect(
      await transactionsUsed(() =>
        knockout.generateBracket(stageId, { entryIds: [entryA.id, entryB.id] }),
      ),
    ).toBe(1);

    // A read of the bracket opens no transaction.
    expect(await transactionsUsed(() => knockout.getBracket(stageId))).toBe(0);
  });

  it('wraps a result correction in exactly one transaction, like recording a result', async () => {
    const { matches } = services();
    const results = createMatchResultService(
      repos.client,
      counter.unitOfWork,
      createRealtimeEventService(),
    );

    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    const playerA = await seedPlayer(repos.client, 'A');
    const playerB = await seedPlayer(repos.client, 'B');
    const entryA = await repos.client.entries.create({
      categoryId,
      playerId: playerA,
      teamId: null,
      seed: null,
      status: 'CONFIRMED',
    });
    const entryB = await repos.client.entries.create({
      categoryId,
      playerId: playerB,
      teamId: null,
      seed: null,
      status: 'CONFIRMED',
    });
    await matches.addParticipant(matchId, { entryId: entryA.id, slot: 1 });
    await matches.addParticipant(matchId, { entryId: entryB.id, slot: 2 });
    await matches.transitionStatus(matchId, { status: 'IN_PROGRESS' });

    // Recording a result is the reference atomic operation.
    const recordGames = [{ gameNumber: 1, participant1Points: 21, participant2Points: 15 }];
    expect(
      await transactionsUsed(() => results.recordResult(matchId, { games: recordGames })),
    ).toBe(1);

    // A correction opens exactly one transaction as well.
    const correctedGames = [{ gameNumber: 1, participant1Points: 18, participant2Points: 21 }];
    expect(
      await transactionsUsed(() => results.correctResult(matchId, { games: correctedGames })),
    ).toBe(1);
  });

  it('wraps a knockout correction (with bracket re-derivation) in exactly one transaction', async () => {
    const events = createRealtimeEventService();
    const results = createMatchResultService(
      repos.client,
      counter.unitOfWork,
      events,
      createKnockoutProgressionService(),
      createKnockoutCorrectionService(events),
    );
    const knockout = createKnockoutBracketService(repos.client, counter.unitOfWork);
    const matches = createMatchService(repos.client, counter.unitOfWork, events);

    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const entryIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const playerId = await seedPlayer(repos.client, `Player ${String(index + 1)}`);
      const entry = await repos.client.entries.create({
        categoryId,
        playerId,
        teamId: null,
        seed: null,
        status: 'CONFIRMED',
      });
      entryIds.push(entry.id);
    }
    const bracket = await knockout.generateBracket(stageId, { entryIds });
    await repos.client.stages.updateStatus(stageId, 'ACTIVE');
    const semi1 = bracket.rounds[0]?.matches[0]?.matchId ?? '';
    await matches.transitionStatus(semi1, { status: 'IN_PROGRESS' });
    await results.recordResult(semi1, {
      games: [
        { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
        { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
      ],
    });

    // A knockout correction re-derives the bracket, but still opens exactly one
    // transaction (the reference `recordResult` is unchanged).
    expect(
      await transactionsUsed(() =>
        results.correctResult(semi1, {
          games: [
            { gameNumber: 1, participant1Points: 15, participant2Points: 21 },
            { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
          ],
        }),
      ),
    ).toBe(1);
  });
});
