import {
  createKnockoutBracketService,
  createKnockoutCorrectionService,
  createKnockoutProgressionService,
  createMatchResultService,
  createMatchService,
  createRealtimeEventService,
  createStandingsService,
  type Bracket,
  type RepositoryClient,
  type UnitOfWork,
} from '@badminton/application';
import { BusinessRuleViolationError, NotFoundError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedCategory, seedMatch, seedPlayer, seedStage, seedTournament } from './fixtures.ts';

/**
 * Result-correction service unit tests.
 *
 * These exercise the real application service over the in-memory port
 * implementation: replacing a completed match's games and winner, rejecting a
 * non-completed match, re-deriving the bracket after a knockout correction, and
 * the transaction boundary that leaves the original result untouched when a
 * write fails.
 */

let repos: FakeRepositories;
let matches: ReturnType<typeof createMatchService>;
let results: ReturnType<typeof createMatchResultService>;
let standings: ReturnType<typeof createStandingsService>;

beforeEach(() => {
  repos = createFakeRepositories();
  const events = createRealtimeEventService();
  matches = createMatchService(repos.client, repos.unitOfWork, events);
  results = createMatchResultService(
    repos.client,
    repos.unitOfWork,
    events,
    createKnockoutProgressionService(),
    createKnockoutCorrectionService(events),
  );
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

/** A completed GROUP match with two participants and a recorded result. */
async function completedGroupMatch(
  categoryId: string,
): Promise<{ matchId: string; stageId: string; slot1: string; slot2: string }> {
  const stageId = await seedStage(repos.client, categoryId);
  // A real group fixture carries a round-robin `roundNumber`/`matchNumber`, so
  // the predicate must read the stage type, never those fields.
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
  await results.recordResult(match.id, { games: oneGame });
  return { matchId: match.id, stageId, slot1, slot2 };
}

const oneGame = [{ gameNumber: 1, participant1Points: 21, participant2Points: 15 }];

/** The id of the bracket match at `round`/`matchNumber`. */
function matchIdIn(bracket: Bracket, round: number, matchNumber: number): string {
  const found = bracket.rounds
    .find((row) => row.roundNumber === round)
    ?.matches.find((row) => row.matchNumber === matchNumber);
  if (!found) {
    throw new Error(`no match at round ${String(round)} number ${String(matchNumber)}`);
  }
  return found.matchId;
}

/** The entry currently occupying `slot` of a match. */
async function slotOf(matchId: string, slot: 1 | 2): Promise<string | undefined> {
  const participants = await repos.client.matchParticipants.listByMatch(matchId);
  return participants.find((participant) => participant.slot === slot)?.entryId;
}

describe('MatchResultService.correctResult (group stage)', () => {
  it('replaces the stored games, recomputes the winner and returns the new result', async () => {
    const categoryId = await singlesCategory();
    const { matchId, slot1, slot2 } = await completedGroupMatch(categoryId);

    const corrected = await results.correctResult(matchId, {
      games: [{ gameNumber: 1, participant1Points: 18, participant2Points: 21 }],
    });

    expect(corrected.winnerSlot).toBe(2);
    expect(corrected.winnerEntryId).toBe(slot2);
    expect(corrected.loserEntryId).toBe(slot1);
    expect(corrected.games).toHaveLength(1);
    expect(corrected.games[0]?.participant1Points).toBe(18);
    expect(corrected.games[0]?.participant2Points).toBe(21);

    // The stored games are exactly the corrected set (no leftovers).
    const stored = await repos.client.matchGames.listByMatch(matchId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.participant2Points).toBe(21);

    const match = await repos.client.matches.findById(matchId);
    expect(match?.status).toBe('COMPLETED');
    expect(match?.winnerEntryId).toBe(slot2);
  });

  it('reflects the corrected score in the group standings', async () => {
    const categoryId = await singlesCategory();
    const { matchId, stageId, slot1, slot2 } = await completedGroupMatch(categoryId);

    // Original: slot1 wins 21-15 → slot1 +6 difference, slot2 -6.
    const before = await standings.getStageStandings(stageId);
    expect(before.find((row) => row.entryId === slot1)).toMatchObject({
      points: 2,
      pointsFor: 21,
      pointsAgainst: 15,
      pointDifference: 6,
    });

    await results.correctResult(matchId, {
      games: [{ gameNumber: 1, participant1Points: 18, participant2Points: 21 }],
    });

    const after = await standings.getStageStandings(stageId);
    const winner = after.find((row) => row.entryId === slot2);
    const loser = after.find((row) => row.entryId === slot1);
    expect(winner).toMatchObject({
      position: 1,
      played: 1,
      won: 1,
      points: 2,
      pointsFor: 21,
      pointsAgainst: 18,
      pointDifference: 3,
    });
    expect(loser).toMatchObject({ played: 1, won: 0, points: 0, pointDifference: -3 });
  });

  it('accepts a completed knockout match, returns the new result and re-fills the next round', async () => {
    const categoryId = await singlesCategory();
    // A 4-entry bracket so the corrected semifinal feeds a final.
    const stage = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 2,
      drawSize: null,
      qualifiersPerGroup: null,
      knockoutRules: null,
      status: 'PENDING',
    });
    const entryIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      entryIds.push(await entryIn(categoryId, `Player ${String(index + 1)}`));
    }
    const knockout = createKnockoutBracketService(repos.client, repos.unitOfWork);
    const bracket = await knockout.generateBracket(stage.id, { entryIds });
    await repos.client.stages.updateStatus(stage.id, 'ACTIVE');

    const semi1 = matchIdIn(bracket, 1, 1);
    const finalId = matchIdIn(bracket, 2, 1);
    await matches.transitionStatus(semi1, { status: 'IN_PROGRESS' });
    const first = await results.recordResult(semi1, {
      games: [
        { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
        { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
      ],
    });

    // The old winner advanced into the final's slot 1.
    expect(await slotOf(finalId, 1)).toBe(first.winnerEntryId);

    // Correct the semifinal so the other competitor wins.
    const corrected = await results.correctResult(semi1, {
      games: [
        { gameNumber: 1, participant1Points: 15, participant2Points: 21 },
        { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
      ],
    });

    // The corrected match returns the new result and stays COMPLETED...
    expect(corrected.matchId).toBe(semi1);
    expect(corrected.winnerEntryId).not.toBe(first.winnerEntryId);
    expect((await repos.client.matches.findById(semi1))?.status).toBe('COMPLETED');

    // ...and the old winner is gone from the next round's slot, which now holds
    // the new winner.
    expect(await slotOf(finalId, 1)).toBe(corrected.winnerEntryId);
    expect(await slotOf(finalId, 1)).not.toBe(first.winnerEntryId);
  });

  it('rejects a non-completed match with a business-rule violation', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    const slot1 = await entryIn(categoryId, 'Player A');
    const slot2 = await entryIn(categoryId, 'Player B');
    await matches.addParticipant(matchId, { entryId: slot1, slot: 1 });
    await matches.addParticipant(matchId, { entryId: slot2, slot: 2 });

    await expect(results.correctResult(matchId, { games: oneGame })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('raises NotFoundError for an unknown match id', async () => {
    await expect(
      results.correctResult('00000000-0000-5000-8000-000000000000', { games: oneGame }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects an illegal group score (31-29) with a business-rule violation', async () => {
    const categoryId = await singlesCategory();
    const { matchId } = await completedGroupMatch(categoryId);

    await expect(
      results.correctResult(matchId, {
        games: [{ gameNumber: 1, participant1Points: 31, participant2Points: 29 }],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);

    // The original result survives the rejected correction.
    const stored = await repos.client.matchGames.listByMatch(matchId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.participant1Points).toBe(21);
  });

  it('leaves the original result, games and winner unchanged when a write fails mid-correction', async () => {
    const categoryId = await singlesCategory();
    const { matchId, slot1 } = await completedGroupMatch(categoryId);

    // The transaction writes the replacement games and resets the match before
    // it re-completes; a failure on the final match write must roll all of that
    // back. A repository failure is the only way to exercise the rollback, so
    // `matches.complete` is fault-injected while the real transaction, writes
    // and rollback path run unchanged.
    const failingUnitOfWork: UnitOfWork = {
      runInTransaction: (work) =>
        repos.unitOfWork.runInTransaction((tx) =>
          work({
            ...tx,
            matches: {
              ...tx.matches,
              complete: () => Promise.reject(new Error('simulated write failure')),
            },
          } satisfies RepositoryClient),
        ),
    };
    const failingResults = createMatchResultService(
      repos.client,
      failingUnitOfWork,
      createRealtimeEventService(),
    );

    await expect(
      failingResults.correctResult(matchId, {
        games: [{ gameNumber: 1, participant1Points: 18, participant2Points: 21 }],
      }),
    ).rejects.toThrow('simulated write failure');

    const match = await repos.client.matches.findById(matchId);
    expect(match?.status).toBe('COMPLETED');
    expect(match?.winnerEntryId).toBe(slot1);
    const stored = await repos.client.matchGames.listByMatch(matchId);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.participant1Points).toBe(21);
    expect(stored[0]?.participant2Points).toBe(15);
  });
});
