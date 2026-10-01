import {
  createKnockoutBracketService,
  createKnockoutCorrectionService,
  createKnockoutProgressionService,
  createMatchResultService,
  createMatchService,
  createRealtimeEventService,
  createTournamentStageService,
  type Bracket,
  type RepositoryClient,
  type UnitOfWork,
} from '@badminton/application';
import { BusinessRuleViolationError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedCategory, seedPlayer, seedTournament } from './fixtures.ts';

/**
 * Knockout result-correction (bracket re-derivation) tests.
 *
 * The real application service runs over the in-memory ports: correcting a
 * completed knockout match replaces its result and re-derives the bracket in one
 * transaction - the immediate destination slot is re-filled with the new winner,
 * any downstream match that was already decided is reset (winner and games
 * cleared), and a COMPLETED stage whose final is invalidated reopens to ACTIVE.
 * The cascade runs in ascending round order and stops when a destination already
 * holds the winner that belongs there.
 */

let repos: FakeRepositories;
let matches: ReturnType<typeof createMatchService>;
let results: ReturnType<typeof createMatchResultService>;
let stages: ReturnType<typeof createTournamentStageService>;
let knockout: ReturnType<typeof createKnockoutBracketService>;

beforeEach(() => {
  repos = createFakeRepositories();
  const events = createRealtimeEventService();
  const progression = createKnockoutProgressionService();
  const correction = createKnockoutCorrectionService(events);
  matches = createMatchService(repos.client, repos.unitOfWork, events);
  stages = createTournamentStageService(repos.client, repos.unitOfWork, events);
  results = createMatchResultService(
    repos.client,
    repos.unitOfWork,
    events,
    progression,
    correction,
  );
  knockout = createKnockoutBracketService(repos.client, repos.unitOfWork);
});

const twoZero = [
  { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
  { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
];

async function singlesCategory(): Promise<string> {
  const tournamentId = await seedTournament(repos.client);
  return seedCategory(repos.client, { tournamentId });
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

function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a defined value.');
  }
  return value;
}

/** Generates and activates a bracket of `size`, returning the entry ids. */
async function bracketOf(size: 4 | 8): Promise<{
  categoryId: string;
  stageId: string;
  entryIds: string[];
  bracket: Bracket;
}> {
  const categoryId = await singlesCategory();
  const stage = await repos.client.stages.create({
    categoryId,
    name: 'Knockout',
    type: 'KNOCKOUT',
    sequence: 1,
    drawSize: null,
    qualifiersPerGroup: null,
    knockoutRules: null,
    status: 'PENDING',
  });
  const entryIds: string[] = [];
  for (let index = 0; index < size; index += 1) {
    entryIds.push(await entryIn(categoryId, `Player ${String(index + 1)}`));
  }
  const bracket = await knockout.generateBracket(stage.id, { entryIds });
  await stages.transitionStatus(stage.id, { status: 'ACTIVE' });
  return { categoryId, stageId: stage.id, entryIds, bracket };
}

function matchIdAt(bracket: Bracket, round: number, match: number): string {
  const found = bracket.rounds
    .find((row) => row.roundNumber === round)
    ?.matches.find((row) => row.matchNumber === match);
  if (!found) {
    throw new Error(`no match at round ${String(round)} number ${String(match)}`);
  }
  return found.matchId;
}

/** Plays a bracket match to completion with a 2-0 result. */
async function play(matchId: string): Promise<string> {
  await matches.transitionStatus(matchId, { status: 'IN_PROGRESS' });
  const result = await results.recordResult(matchId, { games: twoZero });
  return result.winnerEntryId;
}

/** Plays the whole bracket so the final is decided and the stage completes. */
async function playOut(stageId: string, bracket: Bracket, size: number): Promise<void> {
  const roundCount = Math.log2(size);
  for (let round = 1; round <= roundCount; round += 1) {
    const matchesInRound = size / 2 ** round;
    for (let number = 1; number <= matchesInRound; number += 1) {
      await play(matchIdAt(bracket, round, number));
    }
  }
  await knockout.getBracket(stageId);
}

async function slotOf(matchId: string, slot: 1 | 2): Promise<string | undefined> {
  const participants = await repos.client.matchParticipants.listByMatch(matchId);
  return participants.find((participant) => participant.slot === slot)?.entryId;
}

describe('KnockoutCorrectionService.reopen', () => {
  it('correcting the final re-derives nothing', async () => {
    const { stageId, bracket } = await bracketOf(4);
    await playOut(stageId, bracket, 4);
    const finalMatchId = matchIdAt(bracket, 2, 1);

    // The final was won by slot 1; correct it so slot 2 wins instead.
    const corrected = await results.correctResult(finalMatchId, {
      games: [
        { gameNumber: 1, participant1Points: 15, participant2Points: 21 },
        { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
      ],
    });

    const final = await repos.client.matches.findById(finalMatchId);
    expect(final?.status).toBe('COMPLETED');
    expect(final?.winnerEntryId).toBe(corrected.winnerEntryId);
    // The stage stays COMPLETED: the final is still decided.
    expect((await repos.client.stages.findById(stageId))?.status).toBe('COMPLETED');
  });

  it('correcting a semifinal re-fills the final and resets/reopens it', async () => {
    const { stageId, bracket } = await bracketOf(4);
    await playOut(stageId, bracket, 4);
    expect((await repos.client.stages.findById(stageId))?.status).toBe('COMPLETED');

    const semi1 = matchIdAt(bracket, 1, 1);
    const finalMatchId = matchIdAt(bracket, 2, 1);
    const semi1Slots = await repos.client.matchParticipants.listByMatch(semi1);
    const slot1Entry = defined(semi1Slots.find((slot) => slot.slot === 1)).entryId;
    const slot2Entry = defined(semi1Slots.find((slot) => slot.slot === 2)).entryId;
    expect(await slotOf(finalMatchId, 1)).toBe(slot1Entry);

    // Correct semifinal 1 so the other competitor wins.
    const corrected = await results.correctResult(semi1, {
      games: [
        { gameNumber: 1, participant1Points: 15, participant2Points: 21 },
        { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
      ],
    });
    expect(corrected.winnerEntryId).toBe(slot2Entry);

    // The semifinal stays COMPLETED with the new winner.
    const semiAfter = await repos.client.matches.findById(semi1);
    expect(semiAfter?.status).toBe('COMPLETED');
    expect(semiAfter?.winnerEntryId).toBe(slot2Entry);

    // The final's slot 1 now holds the new winner.
    expect(await slotOf(finalMatchId, 1)).toBe(slot2Entry);

    // The final was reset: no winner, no games, back to IN_PROGRESS.
    const finalAfter = await repos.client.matches.findById(finalMatchId);
    expect(finalAfter?.status).toBe('IN_PROGRESS');
    expect(finalAfter?.winnerEntryId).toBeNull();
    expect(await repos.client.matchGames.listByMatch(finalMatchId)).toHaveLength(0);

    // A COMPLETED stage whose final is invalidated reopens to ACTIVE.
    expect((await repos.client.stages.findById(stageId))?.status).toBe('ACTIVE');

    // The cascade reuses the existing catalogue: the corrected match's own two
    // events, the destination re-fill, and the stage reopen. No new event type.
    const events = await repos.client.realtimeEvents.getPendingEvents(100);
    expect(events.slice(-4).map((event) => event.eventType)).toEqual([
      'MATCH_RESULT_RECORDED',
      'MATCH_COMPLETED',
      'KNOCKOUT_MATCH_POPULATED',
      'STAGE_STATUS_CHANGED',
    ]);
  });

  it('cascades through two decided rounds in ascending order (8-entry bracket)', async () => {
    const { stageId, bracket } = await bracketOf(8);
    await playOut(stageId, bracket, 8);
    expect((await repos.client.stages.findById(stageId))?.status).toBe('COMPLETED');

    const qf1 = matchIdAt(bracket, 1, 1);
    const sf1 = matchIdAt(bracket, 2, 1);
    const finalMatchId = matchIdAt(bracket, 3, 1);
    const qf1Slots = await repos.client.matchParticipants.listByMatch(qf1);
    const qf1Slot1 = defined(qf1Slots.find((slot) => slot.slot === 1)).entryId;
    const qf1Slot2 = defined(qf1Slots.find((slot) => slot.slot === 2)).entryId;
    const sf1Slot2 = await slotOf(sf1, 2);
    expect(await slotOf(sf1, 1)).toBe(qf1Slot1);
    expect(await slotOf(finalMatchId, 1)).toBe(qf1Slot1);

    // Correct quarterfinal 1 so the other competitor wins.
    await results.correctResult(qf1, {
      games: [
        { gameNumber: 1, participant1Points: 15, participant2Points: 21 },
        { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
      ],
    });

    // Semifinal 1's slot 1 holds the new winner; it was reset (it had been
    // decided) and its other competitor is untouched.
    expect(await slotOf(sf1, 1)).toBe(qf1Slot2);
    expect(await slotOf(sf1, 2)).toBe(sf1Slot2);
    const sf1After = await repos.client.matches.findById(sf1);
    expect(sf1After?.status).toBe('IN_PROGRESS');
    expect(sf1After?.winnerEntryId).toBeNull();
    expect(await repos.client.matchGames.listByMatch(sf1)).toHaveLength(0);

    // The semifinal's old winner was cleared from the final's slot 1, and the
    // final (which had been decided) is reset too.
    expect(await slotOf(finalMatchId, 1)).toBeUndefined();
    const finalAfter = await repos.client.matches.findById(finalMatchId);
    expect(finalAfter?.status).toBe('IN_PROGRESS');
    expect(finalAfter?.winnerEntryId).toBeNull();
    expect(await repos.client.matchGames.listByMatch(finalMatchId)).toHaveLength(0);

    expect((await repos.client.stages.findById(stageId))?.status).toBe('ACTIVE');
  });

  it('is a no-op when the destination already holds the new winner', async () => {
    const { stageId, bracket } = await bracketOf(4);
    await playOut(stageId, bracket, 4);
    const semi1 = matchIdAt(bracket, 1, 1);
    const finalMatchId = matchIdAt(bracket, 2, 1);

    // Re-correct semifinal 1 to the same winner it already has.
    const semi1Slots = await repos.client.matchParticipants.listByMatch(semi1);
    const slot1Entry = defined(semi1Slots.find((slot) => slot.slot === 1)).entryId;
    const finalBefore = await repos.client.matches.findById(finalMatchId);

    const eventsBefore = (await repos.client.realtimeEvents.getPendingEvents(100)).length;
    await results.correctResult(semi1, { games: twoZero });

    // The final is untouched and no bracket event was recorded.
    expect((await repos.client.matches.findById(finalMatchId))?.status).toBe(finalBefore?.status);
    expect((await repos.client.matches.findById(finalMatchId))?.winnerEntryId).toBe(
      finalBefore?.winnerEntryId,
    );
    expect(await slotOf(finalMatchId, 1)).toBe(slot1Entry);
    // Only the corrected match's own two events were recorded.
    const eventsAfter = (await repos.client.realtimeEvents.getPendingEvents(100)).length;
    expect(eventsAfter - eventsBefore).toBe(2);
  });

  it('re-derives nothing when the corrected match has no bracket position', async () => {
    const categoryId = await singlesCategory();
    const stage = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      drawSize: 4,
      qualifiersPerGroup: null,
      knockoutRules: null,
      status: 'ACTIVE',
    });
    // A knockout match created outside a generated bracket: no round/number.
    const match = await repos.client.matches.create({
      stageId: stage.id,
      sequence: 1,
      roundNumber: null,
      matchNumber: null,
      status: 'SCHEDULED',
    });
    const slot1 = await entryIn(categoryId, 'A');
    const slot2 = await entryIn(categoryId, 'B');
    await matches.addParticipant(match.id, { entryId: slot1, slot: 1 });
    await matches.addParticipant(match.id, { entryId: slot2, slot: 2 });
    await matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });
    await results.recordResult(match.id, { games: twoZero });

    const corrected = await results.correctResult(match.id, {
      games: [
        { gameNumber: 1, participant1Points: 15, participant2Points: 21 },
        { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
      ],
    });
    expect(corrected.winnerEntryId).toBe(slot2);
    expect((await repos.client.matches.findById(match.id))?.status).toBe('COMPLETED');
  });

  it('raises a business-rule violation when the destination match is missing', async () => {
    const categoryId = await singlesCategory();
    const stage = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      drawSize: 4,
      qualifiersPerGroup: null,
      knockoutRules: null,
      status: 'ACTIVE',
    });
    // A round-1 match with a draw size recorded, but no round-2 destination.
    const match = await repos.client.matches.create({
      stageId: stage.id,
      sequence: 1,
      roundNumber: 1,
      matchNumber: 1,
      status: 'SCHEDULED',
    });
    const slot1 = await entryIn(categoryId, 'A');
    const slot2 = await entryIn(categoryId, 'B');
    await matches.addParticipant(match.id, { entryId: slot1, slot: 1 });
    await matches.addParticipant(match.id, { entryId: slot2, slot: 2 });
    await matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });
    // Complete directly: progression would fail on the missing round 2 first,
    // but this test targets the correction's own missing-destination guard.
    await repos.client.matches.complete(match.id, slot1);

    await expect(
      results.correctResult(match.id, {
        games: [
          { gameNumber: 1, participant1Points: 15, participant2Points: 21 },
          { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
        ],
      }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);

    // The failed correction rolled back: the original result survives.
    const after = await repos.client.matches.findById(match.id);
    expect(after?.winnerEntryId).toBe(slot1);
  });

  it('opens exactly one transaction for a knockout correction', async () => {
    const { bracket } = await bracketOf(4);
    const semi1 = matchIdAt(bracket, 1, 1);
    await play(semi1);

    let count = 0;
    const counting: UnitOfWork = {
      runInTransaction: <T>(work: (client: RepositoryClient) => Promise<T>): Promise<T> => {
        count += 1;
        return repos.unitOfWork.runInTransaction(work);
      },
    };
    const events = createRealtimeEventService();
    const countingResults = createMatchResultService(
      repos.client,
      counting,
      events,
      createKnockoutProgressionService(),
      createKnockoutCorrectionService(events),
    );

    await countingResults.correctResult(semi1, {
      games: [
        { gameNumber: 1, participant1Points: 15, participant2Points: 21 },
        { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
      ],
    });
    expect(count).toBe(1);
  });
});
