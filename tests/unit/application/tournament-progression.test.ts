import {
  createGroupFixtureService,
  createKnockoutBracketService,
  createKnockoutProgressionService,
  createMatchResultService,
  createMatchService,
  createQualificationService,
  createRealtimeEventService,
  createStandingsService,
  createTournamentCategoryService,
  createTournamentEntryService,
  createTournamentService,
  createTournamentStageService,
} from '@badminton/application';
import { BusinessRuleViolationError, ConflictError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';

/**
 * End-to-end tournament progression through the application services.
 *
 * This is the TASK-4 acceptance scenario: a tournament is operated from setup
 * to final completion **without any direct fixture/result insertion**. Every
 * step goes through a real application service over the in-memory repository
 * ports, so the test exercises the same code paths the HTTP API uses.
 *
 * The scenario mirrors the original tournament application: two groups of four,
 * the top two of each qualify, the four qualifiers are cross-seeded into a
 * semi-final + final bracket, and the bracket advances itself as results land.
 */

let repos: FakeRepositories;
let tournaments: ReturnType<typeof createTournamentService>;
let categories: ReturnType<typeof createTournamentCategoryService>;
let entries: ReturnType<typeof createTournamentEntryService>;
let matches: ReturnType<typeof createMatchService>;
let results: ReturnType<typeof createMatchResultService>;
let standings: ReturnType<typeof createStandingsService>;
let qualification: ReturnType<typeof createQualificationService>;
let knockout: ReturnType<typeof createKnockoutBracketService>;
let fixtures: ReturnType<typeof createGroupFixtureService>;
let stages: ReturnType<typeof createTournamentStageService>;

const twoZero = [
  { gameNumber: 1, participant1Points: 21, participant2Points: 10 },
  { gameNumber: 2, participant1Points: 21, participant2Points: 12 },
];

beforeEach(() => {
  repos = createFakeRepositories();
  const events = createRealtimeEventService();
  const progression = createKnockoutProgressionService();
  qualification = createQualificationService(repos.client);
  tournaments = createTournamentService(repos.client, repos.unitOfWork, events);
  categories = createTournamentCategoryService(repos.client, repos.unitOfWork, events);
  entries = createTournamentEntryService(repos.client, repos.unitOfWork, events);
  matches = createMatchService(repos.client, repos.unitOfWork, events);
  results = createMatchResultService(repos.client, repos.unitOfWork, events, progression);
  standings = createStandingsService(repos.client);
  knockout = createKnockoutBracketService(repos.client, repos.unitOfWork, qualification);
  fixtures = createGroupFixtureService(repos.unitOfWork);
  stages = createTournamentStageService(repos.client, repos.unitOfWork, events);
});

/** Creates a tournament, an OPEN singles category and `count` confirmed entries. */
async function setupCategory(count: number): Promise<{ categoryId: string; entryIds: string[] }> {
  const tournament = await tournaments.create({
    name: 'Progression Open',
    description: null,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-03T00:00:00.000Z'),
    location: null,
    timezone: 'Asia/Kolkata',
  });
  await tournaments.transitionStatus(tournament.id, { status: 'REGISTRATION_OPEN' });
  const category = await categories.create(tournament.id, {
    name: "Men's Singles",
    code: 'MS',
    format: 'SINGLES',
    gender: 'MALE',
  });
  await categories.transitionStatus(category.id, { status: 'OPEN' });

  const entryIds: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const player = await repos.client.players.create({
      name: `Player ${String(index + 1)}`,
      email: null,
      phone: null,
    });
    const entry = await entries.register({ categoryId: category.id, playerId: player.id });
    await entries.confirm(entry.id);
    entryIds.push(entry.id);
  }
  return { categoryId: category.id, entryIds };
}

async function createGroupStage(
  categoryId: string,
  name: string,
  sequence: number,
  qualifiersPerGroup: number,
): Promise<string> {
  const stage = await stages.create(categoryId, {
    name,
    type: 'GROUP',
    sequence,
    qualifiersPerGroup,
  });
  return stage.id;
}

async function createKnockoutStage(categoryId: string, sequence: number): Promise<string> {
  const stage = await stages.create(categoryId, {
    name: 'Knockout',
    type: 'KNOCKOUT',
    sequence,
  });
  await stages.transitionStatus(stage.id, { status: 'ACTIVE' });
  return stage.id;
}

/** Completes every match of a stage with a 2-0 win for slot 1. */
async function completeAllMatches(stageId: string): Promise<void> {
  const stageMatches = await repos.client.matches.listByStage(stageId);
  for (const match of stageMatches) {
    await matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });
    await results.recordResult(match.id, { games: twoZero });
  }
}

describe('tournament progression end-to-end', () => {
  it('runs setup → groups → fixtures → standings → qualification → knockout → final → completion', async () => {
    const { categoryId, entryIds } = await setupCategory(8);

    // Two groups of four; the top two of each qualify.
    const groupA = await createGroupStage(categoryId, 'Group A', 1, 2);
    const groupB = await createGroupStage(categoryId, 'Group B', 2, 2);
    const knockoutStage = await createKnockoutStage(categoryId, 3);

    const aEntries = entryIds.slice(0, 4);
    const bEntries = entryIds.slice(4, 8);

    const fixturesA = await fixtures.generate(groupA, { entryIds: aEntries });
    const fixturesB = await fixtures.generate(groupB, { entryIds: bEntries });

    // A round-robin of four is exactly six matches.
    expect(fixturesA.matches).toHaveLength(6);
    expect(fixturesB.matches).toHaveLength(6);

    // Fixtures are persisted and retrieved on a fresh read.
    expect(await repos.client.matches.listByStage(groupA)).toHaveLength(6);
    expect(await repos.client.matches.listByStage(groupB)).toHaveLength(6);

    // Qualification is blocked while group matches remain incomplete.
    const pendingView = await qualification.getView(knockoutStage);
    expect(pendingView.ready).toBe(false);
    expect(pendingView.blockedReason).toContain('completed');
    await expect(knockout.generateFromQualifiers(knockoutStage)).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );

    await completeAllMatches(groupA);
    await completeAllMatches(groupB);

    // Standings are derived and complete after every group match. The table
    // lists every active entry of the category (Phase 5 behaviour), but the
    // group's own members are the four who actually played in it.
    const standingsA = await standings.getStageStandings(groupA);
    expect(standingsA).toHaveLength(8);
    const membersA = standingsA.filter((row) => aEntries.includes(row.entryId));
    expect(membersA).toHaveLength(4);
    expect(membersA.every((row) => row.played === 3)).toBe(true);

    // Qualification is now ready and derives four qualifiers (top two of each).
    const view = await qualification.getView(knockoutStage);
    expect(view.ready).toBe(true);
    expect(view.qualifierCount).toBe(4);
    expect(view.bracketSize).toBe(4);
    expect(view.byeCount).toBe(0);
    expect(view.groups.map((group) => group.qualifiers.length)).toEqual([2, 2]);

    // Generate the bracket from the qualifiers - no manual entry ordering.
    const bracket = await knockout.generateFromQualifiers(knockoutStage);
    expect(bracket.bracketSize).toBe(4);
    expect(bracket.rounds.map((round) => round.name)).toEqual(['Semifinals', 'Final']);

    const [semi1, semi2] = bracket.rounds[0]?.matches ?? [];
    expect(semi1?.participant1.entryId).not.toBeNull();
    expect(semi1?.participant2.entryId).not.toBeNull();
    expect(semi2?.participant1.entryId).not.toBeNull();
    expect(semi2?.participant2.entryId).not.toBeNull();

    // A second generation is a conflict - no duplicate bracket.
    await expect(knockout.generateFromQualifiers(knockoutStage)).rejects.toBeInstanceOf(
      ConflictError,
    );

    // Complete the semi-finals; the final populates automatically.
    for (const semi of [semi1, semi2]) {
      if (!semi) {
        throw new Error('Expected both semi-finals to exist.');
      }
      await matches.transitionStatus(semi.matchId, { status: 'IN_PROGRESS' });
      await results.recordResult(semi.matchId, { games: twoZero });
    }

    const afterSemis = await knockout.getBracket(knockoutStage);
    const final = afterSemis.rounds[1]?.matches[0];
    if (!final) {
      throw new Error('Expected the final to exist.');
    }
    expect(final.participant1.entryId).not.toBeNull();
    expect(final.participant2.entryId).not.toBeNull();
    expect(final.participant1.entryId).toBe(semi1?.participant1.entryId);
    expect(final.participant2.entryId).toBe(semi2?.participant1.entryId);

    // Complete the final; the knockout stage can then complete.
    await matches.transitionStatus(final.matchId, { status: 'IN_PROGRESS' });
    await results.recordResult(final.matchId, { games: twoZero });

    const completed = await stages.transitionStatus(knockoutStage, { status: 'COMPLETED' });
    expect(completed.status).toBe('COMPLETED');

    const finished = await knockout.getBracket(knockoutStage);
    expect(finished.status).toBe('COMPLETED');
    expect(finished.rounds[1]?.matches[0]?.status).toBe('COMPLETED');
  });

  it('spreads byes and auto-advances them for an odd qualifier field', async () => {
    const { categoryId, entryIds } = await setupCategory(12);

    // Three groups of four; the top two of each qualify -> six qualifiers.
    const groupA = await createGroupStage(categoryId, 'Group A', 1, 2);
    const groupB = await createGroupStage(categoryId, 'Group B', 2, 2);
    const groupC = await createGroupStage(categoryId, 'Group C', 3, 2);
    const knockoutStage = await createKnockoutStage(categoryId, 4);

    await fixtures.generate(groupA, { entryIds: entryIds.slice(0, 4) });
    await fixtures.generate(groupB, { entryIds: entryIds.slice(4, 8) });
    await fixtures.generate(groupC, { entryIds: entryIds.slice(8, 12) });

    await completeAllMatches(groupA);
    await completeAllMatches(groupB);
    await completeAllMatches(groupC);

    const view = await qualification.getView(knockoutStage);
    expect(view.qualifierCount).toBe(6);
    expect(view.bracketSize).toBe(8);
    expect(view.byeCount).toBe(2);

    const bracket = await knockout.generateFromQualifiers(knockoutStage);
    expect(bracket.bracketSize).toBe(8);
    expect(bracket.rounds.map((round) => round.matches.length)).toEqual([4, 2, 1]);

    // The two byes are already advanced into the semi-finals: each semi has at
    // least one competitor before any match is played, and no bye is a match.
    const semis = bracket.rounds[1]?.matches ?? [];
    const seededIntoSemis = semis.flatMap((semi) =>
      [semi.participant1.entryId, semi.participant2.entryId].filter(
        (entryId): entryId is string => entryId !== null,
      ),
    );
    expect(seededIntoSemis).toHaveLength(2);

    // Every qualifier appears in the bracket exactly once as a round-1 slot;
    // the two bye winners additionally appear once in the semi-finals they
    // advanced into, so no qualifier is lost and none is duplicated within a
    // round.
    const roundOneSlots = (bracket.rounds[0]?.matches ?? []).flatMap((match) =>
      [match.participant1.entryId, match.participant2.entryId].filter(
        (entryId): entryId is string => entryId !== null,
      ),
    );
    expect(roundOneSlots).toHaveLength(6);
    expect(new Set(roundOneSlots).size).toBe(6);
  });

  it('refuses to advance while a single group match is outstanding', async () => {
    const { categoryId, entryIds } = await setupCategory(8);
    const groupA = await createGroupStage(categoryId, 'Group A', 1, 2);
    const groupB = await createGroupStage(categoryId, 'Group B', 2, 2);
    const knockoutStage = await createKnockoutStage(categoryId, 3);

    await fixtures.generate(groupA, { entryIds: entryIds.slice(0, 4) });
    await fixtures.generate(groupB, { entryIds: entryIds.slice(4, 8) });

    await completeAllMatches(groupA);

    // Group B: complete all but one match.
    const bMatches = await repos.client.matches.listByStage(groupB);
    for (const match of bMatches.slice(0, -1)) {
      await matches.transitionStatus(match.id, { status: 'IN_PROGRESS' });
      await results.recordResult(match.id, { games: twoZero });
    }

    const view = await qualification.getView(knockoutStage);
    expect(view.ready).toBe(false);
    await expect(knockout.generateFromQualifiers(knockoutStage)).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('blocks qualification when the group stage has no configured qualifier count', async () => {
    const { categoryId, entryIds } = await setupCategory(4);
    const group = await createGroupStage(categoryId, 'Group A', 1, 2);
    // Clear the configured count through the stage service to represent a stage
    // whose qualification rule has not been set yet.
    await stages.update(group, { qualifiersPerGroup: null });

    const knockoutStage = await createKnockoutStage(categoryId, 2);
    await fixtures.generate(group, { entryIds });
    await completeAllMatches(group);

    const view = await qualification.getView(knockoutStage);
    expect(view.ready).toBe(false);
    expect(view.blockedReason).toContain('qualify');
  });

  it('rejects a bracket generation when no group stage feeds the knockout', async () => {
    const { categoryId } = await setupCategory(4);
    const knockoutStage = await createKnockoutStage(categoryId, 1);

    const view = await qualification.getView(knockoutStage);
    expect(view.ready).toBe(false);
    expect(view.blockedReason).toContain('feeds');
    await expect(knockout.generateFromQualifiers(knockoutStage)).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });
});
