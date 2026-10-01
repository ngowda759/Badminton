import {
  createMatchResultService,
  createMatchService,
  createRealtimeEventService,
  createStandingsService,
} from '@badminton/application';
import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import {
  seedCategory,
  seedKnockoutStage,
  seedMatch,
  seedPlayer,
  seedStage,
  seedTournament,
} from './fixtures.ts';

/**
 * Match result and standings service unit tests.
 *
 * These exercise the application layer against the real service code and the
 * in-memory port implementation (not spies): scoring validation, lifecycle
 * rules, winner derivation, transactional rollback and derived standings.
 */

let repos: FakeRepositories;
let matches: ReturnType<typeof createMatchService>;
let results: ReturnType<typeof createMatchResultService>;
let standings: ReturnType<typeof createStandingsService>;

beforeEach(() => {
  repos = createFakeRepositories();
  matches = createMatchService(repos.client, repos.unitOfWork, createRealtimeEventService());
  results = createMatchResultService(repos.client, repos.unitOfWork, createRealtimeEventService());
  standings = createStandingsService(repos.client);
});

async function singlesCategory(): Promise<string> {
  const tournamentId = await seedTournament(repos.client);
  return seedCategory(repos.client, { tournamentId, format: 'SINGLES' });
}

async function entryIn(categoryId: string, name: string): Promise<string> {
  const playerId = await seedPlayer(repos.client, name);
  const entry = await repos.client.entries.create({
    categoryId,
    playerId,
    teamId: null,
    seed: null,
    status: 'CONFIRMED',
  });
  return entry.id;
}

/** A scheduled match with two participants, started (IN_PROGRESS). */
async function startedMatch(
  categoryId: string,
): Promise<{ matchId: string; slot1: string; slot2: string }> {
  const stageId = await seedStage(repos.client, categoryId);
  return matchInStage(categoryId, stageId);
}

/** A started GROUP match with two participants inside an existing stage. */
async function matchInStage(
  categoryId: string,
  stageId: string,
): Promise<{ matchId: string; slot1: string; slot2: string }> {
  const matchId = await seedMatch(repos.client, stageId);
  const slot1 = await entryIn(categoryId, 'Player A');
  const slot2 = await entryIn(categoryId, 'Player B');
  await matches.addParticipant(matchId, { entryId: slot1, slot: 1 });
  await matches.addParticipant(matchId, { entryId: slot2, slot: 2 });
  await matches.transitionStatus(matchId, { status: 'IN_PROGRESS' });
  return { matchId, slot1, slot2 };
}

/** A started KNOCKOUT match with two participants inside an existing stage. */
async function knockoutMatchInStage(
  categoryId: string,
  stageId: string,
): Promise<{ matchId: string; slot1: string; slot2: string }> {
  const matchId = await seedMatch(repos.client, stageId);
  const slot1 = await entryIn(categoryId, 'Player A');
  const slot2 = await entryIn(categoryId, 'Player B');
  await matches.addParticipant(matchId, { entryId: slot1, slot: 1 });
  await matches.addParticipant(matchId, { entryId: slot2, slot: 2 });
  await matches.transitionStatus(matchId, { status: 'IN_PROGRESS' });
  return { matchId, slot1, slot2 };
}

/** Completes a fresh 2-0 group match in `stageId` and returns the two entry ids. */
async function resultInStage(
  categoryId: string,
  stageId: string,
): Promise<{ slot1: string; slot2: string }> {
  const { matchId, slot1, slot2 } = await matchInStage(categoryId, stageId);
  await results.recordResult(matchId, { games: oneGame });
  return { slot1, slot2 };
}

/** A single game, as a GROUP match stores it. */
const oneGame = [{ gameNumber: 1, participant1Points: 21, participant2Points: 15 }];

const twoZero = [
  { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
  { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
];

describe('MatchResultService.recordResult (group stage)', () => {
  it('records a single-game group result and completes the match', async () => {
    const categoryId = await singlesCategory();
    const { matchId, slot1 } = await startedMatch(categoryId);

    const result = await results.recordResult(matchId, { games: oneGame });

    expect(result.winnerSlot).toBe(1);
    expect(result.winnerEntryId).toBe(slot1);
    expect(result.winnerGames).toBe(1);
    expect(result.loserGames).toBe(0);
    expect(result.games).toHaveLength(1);

    const match = await repos.client.matches.findById(matchId);
    expect(match?.status).toBe('COMPLETED');
    expect(match?.winnerEntryId).toBe(slot1);
    expect(await repos.client.matchGames.listByMatch(matchId)).toHaveLength(1);
  });

  it('rejects a best-of-three result for a group match', async () => {
    const categoryId = await singlesCategory();
    const { matchId } = await startedMatch(categoryId);

    await expect(results.recordResult(matchId, { games: twoZero })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
    const match = await repos.client.matches.findById(matchId);
    expect(match?.status).toBe('IN_PROGRESS');
    expect(await repos.client.matchGames.listByMatch(matchId)).toHaveLength(0);
  });

  it('rejects a group game that is not won to 21 with a two-point lead', async () => {
    const categoryId = await singlesCategory();
    const { matchId } = await startedMatch(categoryId);

    await expect(
      results.recordResult(matchId, {
        games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 20 }],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('rejects a group game beyond the 30-point ceiling', async () => {
    const categoryId = await singlesCategory();
    const { matchId } = await startedMatch(categoryId);

    await expect(
      results.recordResult(matchId, {
        games: [{ gameNumber: 1, participant1Points: 31, participant2Points: 29 }],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('accepts a group game at the ceiling', async () => {
    const categoryId = await singlesCategory();
    const { matchId } = await startedMatch(categoryId);

    const result = await results.recordResult(matchId, {
      games: [{ gameNumber: 1, participant1Points: 30, participant2Points: 29 }],
    });
    expect(result.winnerSlot).toBe(1);
    expect(result.winnerGames).toBe(1);
  });
});

describe('MatchResultService.recordResult (knockout stage)', () => {
  it('records a valid 2-0 result and completes the match', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const { matchId, slot1 } = await knockoutMatchInStage(categoryId, stageId);

    const result = await results.recordResult(matchId, { games: twoZero });

    expect(result.winnerSlot).toBe(1);
    expect(result.winnerEntryId).toBe(slot1);
    expect(result.winnerGames).toBe(2);
    expect(result.loserGames).toBe(0);
    expect(result.games).toHaveLength(2);

    const match = await repos.client.matches.findById(matchId);
    expect(match?.status).toBe('COMPLETED');
    expect(match?.winnerEntryId).toBe(slot1);
    expect(await repos.client.matchGames.listByMatch(matchId)).toHaveLength(2);
  });

  it('records a valid 2-1 result', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const { matchId, slot2 } = await knockoutMatchInStage(categoryId, stageId);

    const result = await results.recordResult(matchId, {
      games: [
        { gameNumber: 1, participant1Points: 21, participant2Points: 18 },
        { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
        { gameNumber: 3, participant1Points: 19, participant2Points: 21 },
      ],
    });

    expect(result.winnerSlot).toBe(2);
    expect(result.winnerEntryId).toBe(slot2);
    expect(result.winnerGames).toBe(2);
    expect(result.loserGames).toBe(1);
  });

  it('rejects a single-game result as incomplete', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const { matchId } = await knockoutMatchInStage(categoryId, stageId);
    await expect(results.recordResult(matchId, { games: oneGame })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects a third game after a 2-0 result', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const { matchId } = await knockoutMatchInStage(categoryId, stageId);
    await expect(
      results.recordResult(matchId, {
        games: [...twoZero, { gameNumber: 3, participant1Points: 21, participant2Points: 15 }],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('accepts a deciding game past 30 at the round target (no ceiling)', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const { matchId } = await knockoutMatchInStage(categoryId, stageId);

    const result = await results.recordResult(matchId, {
      games: [
        { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
        { gameNumber: 2, participant1Points: 15, participant2Points: 21 },
        { gameNumber: 3, participant1Points: 31, participant2Points: 29 },
      ],
    });
    expect(result.winnerSlot).toBe(1);
    expect(result.winnerGames).toBe(2);
  });

  it('records a straight-set knockout result from the snapshotted rule', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const match = await repos.client.matches.create({
      stageId,
      sequence: 1,
      roundNumber: 1,
      matchNumber: 1,
      status: 'SCHEDULED',
      knockoutFormat: 'single_game',
      knockoutPointsPerGame: 11,
    });
    const slot1 = await entryIn(categoryId, 'Player A');
    const slot2 = await entryIn(categoryId, 'Player B');
    await matches.addParticipant(match.id, { entryId: slot1, slot: 1 });
    await matches.addParticipant(match.id, { entryId: slot2, slot: 2 });
    await matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });

    const result = await results.recordResult(match.id, {
      games: [{ gameNumber: 1, participant1Points: 11, participant2Points: 5 }],
    });
    expect(result.winnerSlot).toBe(1);
    expect(result.winnerGames).toBe(1);
    expect(result.loserGames).toBe(0);
  });

  it('applies the round target when the stage configures one', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId, {
      knockoutRules: { qf: { format: 'best_of_3', pointsPerGame: 15 } },
    });
    const match = await repos.client.matches.create({
      stageId,
      sequence: 1,
      roundNumber: 1,
      matchNumber: 1,
      status: 'SCHEDULED',
    });
    const slot1 = await entryIn(categoryId, 'Player A');
    const slot2 = await entryIn(categoryId, 'Player B');
    await matches.addParticipant(match.id, { entryId: slot1, slot: 1 });
    await matches.addParticipant(match.id, { entryId: slot2, slot: 2 });
    await matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });

    // A 15-13 game is a legal quarter-final under the configured 15 target.
    const result = await results.recordResult(match.id, {
      games: [
        { gameNumber: 1, participant1Points: 15, participant2Points: 13 },
        { gameNumber: 2, participant1Points: 15, participant2Points: 12 },
      ],
    });
    expect(result.winnerSlot).toBe(1);
  });
});

describe('MatchResultService.recordResult (lifecycle)', () => {
  it('rejects an invalid game score without persisting anything', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const { matchId } = await knockoutMatchInStage(categoryId, stageId);

    await expect(
      results.recordResult(matchId, {
        games: [
          { gameNumber: 1, participant1Points: 21, participant2Points: 20 },
          { gameNumber: 2, participant1Points: 21, participant2Points: 15 },
        ],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);

    const match = await repos.client.matches.findById(matchId);
    expect(match?.status).toBe('IN_PROGRESS');
    expect(await repos.client.matchGames.listByMatch(matchId)).toHaveLength(0);
  });

  it('rejects a knockout game won by a single point at the target (no ceiling)', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const { matchId } = await knockoutMatchInStage(categoryId, stageId);

    await expect(
      results.recordResult(matchId, {
        games: [
          { gameNumber: 1, participant1Points: 30, participant2Points: 29 },
          { gameNumber: 2, participant1Points: 21, participant2Points: 15 },
        ],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('rejects scoring a match with fewer than two participants', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    const only = await entryIn(categoryId, 'Solo');
    await matches.addParticipant(matchId, { entryId: only, slot: 1 });
    await matches.transitionStatus(matchId, { status: 'IN_PROGRESS' });

    await expect(results.recordResult(matchId, { games: oneGame })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects scoring a scheduled match that has not started', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    await matches.addParticipant(matchId, { entryId: await entryIn(categoryId, 'A'), slot: 1 });
    await matches.addParticipant(matchId, { entryId: await entryIn(categoryId, 'B'), slot: 2 });

    await expect(results.recordResult(matchId, { games: oneGame })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects scoring a cancelled match', async () => {
    const categoryId = await singlesCategory();
    const { matchId } = await startedMatch(categoryId);
    await matches.transitionStatus(matchId, { status: 'CANCELLED' });

    await expect(results.recordResult(matchId, { games: oneGame })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rolls the whole completion back when persisting a game fails', async () => {
    const categoryId = await singlesCategory();
    const { matchId } = await startedMatch(categoryId);

    // Pre-insert game 1 directly so the service's createMany violates the real
    // unique(matchId, gameNumber) rule: the write fails mid-transaction and the
    // match must remain untouched.
    await repos.client.matchGames.createMany([
      { matchId, gameNumber: 1, participant1Points: 21, participant2Points: 10, winnerSlot: 1 },
    ]);

    await expect(results.recordResult(matchId, { games: oneGame })).rejects.toThrow();

    const match = await repos.client.matches.findById(matchId);
    expect(match?.status).toBe('IN_PROGRESS');
    expect(match?.winnerEntryId).toBeNull();
    // Only the pre-existing game survives; none of the submitted games landed.
    expect(await repos.client.matchGames.listByMatch(matchId)).toHaveLength(1);
  });

  it('rejects a second result for a completed match as a conflict', async () => {
    const categoryId = await singlesCategory();
    const { matchId } = await startedMatch(categoryId);
    await results.recordResult(matchId, { games: oneGame });

    await expect(results.recordResult(matchId, { games: oneGame })).rejects.toBeInstanceOf(
      ConflictError,
    );
    // The original result is untouched.
    expect(await repos.client.matchGames.listByMatch(matchId)).toHaveLength(1);
  });
});

describe('MatchResultService.getResult', () => {
  it('returns undefined for a match that is not completed', async () => {
    const categoryId = await singlesCategory();
    const { matchId } = await startedMatch(categoryId);
    expect(await results.getResult(matchId)).toBeUndefined();
  });

  it('returns the stored single-game result of a completed group match', async () => {
    const categoryId = await singlesCategory();
    const { matchId, slot1 } = await startedMatch(categoryId);
    await results.recordResult(matchId, { games: oneGame });

    const result = await results.getResult(matchId);
    expect(result?.winnerEntryId).toBe(slot1);
    expect(result?.winnerGames).toBe(1);
    expect(result?.games).toHaveLength(1);
  });

  it('returns the stored best-of-three result of a completed knockout match', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const { matchId, slot1 } = await knockoutMatchInStage(categoryId, stageId);
    await results.recordResult(matchId, { games: twoZero });

    const result = await results.getResult(matchId);
    expect(result?.winnerEntryId).toBe(slot1);
    expect(result?.winnerGames).toBe(2);
    expect(result?.games).toHaveLength(2);
  });

  it('throws when the match does not exist', async () => {
    await expect(results.getResult('00000000-0000-5000-8000-000000000000')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('StandingsService.getStageStandings', () => {
  it('lists all category entries on zero before any match is completed', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    await entryIn(categoryId, 'Player A');
    await entryIn(categoryId, 'Player B');

    const rows = await standings.getStageStandings(stageId);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.played === 0)).toBe(true);
  });

  it('reflects a completed result in the table', async () => {
    const categoryId = await singlesCategory();
    const { matchId, slot1 } = await startedMatch(categoryId);
    const [stage] = await repos.client.stages.listByCategory(categoryId);
    await results.recordResult(matchId, { games: oneGame });

    const rows = await standings.getStageStandings(stage?.id ?? '');
    const leader = rows.find((row) => row.entryId === slot1);
    expect(leader).toMatchObject({
      position: 1,
      played: 1,
      won: 1,
      lost: 0,
      points: 2,
      pointsFor: 21,
      pointsAgainst: 15,
      pointDifference: 6,
    });
  });

  it('ignores completed matches from other stages in the same category', async () => {
    const categoryId = await singlesCategory();
    const stageA = await seedStage(repos.client, categoryId, { sequence: 1 });
    const stageB = await seedStage(repos.client, categoryId, { sequence: 2 });
    const knockout = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 3,
      drawSize: 4,
      qualifiersPerGroup: null,
      status: 'PENDING',
    });

    const playedA = await resultInStage(categoryId, stageA);
    const playedB = await resultInStage(categoryId, stageB);
    const knockoutMatch = await knockoutMatchInStage(categoryId, knockout.id);
    await results.recordResult(knockoutMatch.matchId, { games: twoZero });

    const rows = await standings.getStageStandings(stageA);
    const byEntry = new Map(rows.map((row) => [row.entryId, row]));

    // All six active entries of the category appear...
    expect(rows).toHaveLength(6);
    // ...but only Stage A's match counts: its two competitors each played once.
    expect(byEntry.get(playedA.slot1)).toMatchObject({ played: 1, won: 1, points: 2 });
    expect(byEntry.get(playedA.slot2)).toMatchObject({ played: 1, lost: 1, points: 0 });

    // Stage B's completed match and the knockout match contribute nothing.
    expect(byEntry.get(playedB.slot1)).toMatchObject({ played: 0, won: 0, points: 0 });
    expect(byEntry.get(playedB.slot2)).toMatchObject({ played: 0, won: 0, points: 0 });
    const totalPlayed = rows.reduce((sum, row) => sum + row.played, 0);
    expect(totalPlayed).toBe(2);
  });

  it('keeps two GROUP stages in the same category isolated', async () => {
    const categoryId = await singlesCategory();
    const stageA = await seedStage(repos.client, categoryId, { sequence: 1 });
    const stageB = await seedStage(repos.client, categoryId, { sequence: 2 });

    const playedA = await resultInStage(categoryId, stageA);
    const playedB = await resultInStage(categoryId, stageB);

    const rowsA = await standings.getStageStandings(stageA);
    const rowsB = await standings.getStageStandings(stageB);

    const a1 = rowsA.find((row) => row.entryId === playedA.slot1);
    expect(a1).toMatchObject({ played: 1, won: 1, points: 2, pointDifference: 6 });

    const b1 = rowsB.find((row) => row.entryId === playedB.slot1);
    expect(b1).toMatchObject({ played: 1, won: 1, points: 2, pointDifference: 6 });

    // Neither stage reflects the other's match: each only has one played game.
    expect(rowsA.reduce((sum, row) => sum + row.played, 0)).toBe(2);
    expect(rowsB.reduce((sum, row) => sum + row.played, 0)).toBe(2);
  });

  it('shows only active entries and hides withdrawn or disqualified ones', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);

    const confirmed = await entryIn(categoryId, 'Confirmed');
    const pending = await entryIn(categoryId, 'Pending');
    const withdrawn = await entryIn(categoryId, 'Withdrawn');
    await repos.client.entries.updateStatus(withdrawn, 'WITHDRAWN');
    const disqualified = await entryIn(categoryId, 'Disqualified');
    await repos.client.entries.updateStatus(disqualified, 'DISQUALIFIED');

    const rows = await standings.getStageStandings(stageId);
    const ids = rows.map((row) => row.entryId);

    expect(ids).toContain(confirmed);
    expect(ids).toContain(pending);
    expect(ids).not.toContain(withdrawn);
    expect(ids).not.toContain(disqualified);
  });

  it('excludes a withdrawn entry even after it played a completed match', async () => {
    const categoryId = await singlesCategory();
    const { matchId, slot1, slot2 } = await startedMatch(categoryId);
    const [stage] = await repos.client.stages.listByCategory(categoryId);
    await results.recordResult(matchId, { games: oneGame });
    await repos.client.entries.updateStatus(slot2, 'WITHDRAWN');

    const rows = await standings.getStageStandings(stage?.id ?? '');
    expect(rows.map((row) => row.entryId)).toEqual([slot1]);
  });

  it('rejects standings for a non-group stage', async () => {
    const categoryId = await singlesCategory();
    const knockout = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 2,
      drawSize: 4,
      qualifiersPerGroup: null,
      status: 'PENDING',
    });
    await expect(standings.getStageStandings(knockout.id)).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('throws for a missing stage', async () => {
    await expect(
      standings.getStageStandings('00000000-0000-5000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
