import {
  createKnockoutBracketService,
  createMatchResultService,
  createMatchService,
  createKnockoutProgressionService,
  createStandingsService,
} from '@badminton/application';
import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import {
  seedCategory,
  seedKnockoutStage,
  seedPlayer,
  seedStage,
  seedTournament,
} from './fixtures.ts';

/**
 * Knockout bracket and progression service tests.
 *
 * The services run against the real code and the in-memory repos (not spies):
 * bracket generation validates entries and creates the whole structure, and
 * progression moves winners through the rounds transactionally and idempotently.
 */

let repos: FakeRepositories;
let matches: ReturnType<typeof createMatchService>;
let results: ReturnType<typeof createMatchResultService>;
let knockout: ReturnType<typeof createKnockoutBracketService>;
let progression: ReturnType<typeof createKnockoutProgressionService>;

beforeEach(() => {
  repos = createFakeRepositories();
  progression = createKnockoutProgressionService();
  matches = createMatchService(repos.client, repos.unitOfWork);
  results = createMatchResultService(repos.client, repos.unitOfWork, progression);
  knockout = createKnockoutBracketService(repos.client, repos.unitOfWork);
});

const twoZero = [
  { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
  { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
];

async function singlesCategory(format: 'SINGLES' | 'DOUBLES' = 'SINGLES'): Promise<string> {
  const tournamentId = await seedTournament(repos.client);
  return seedCategory(repos.client, { tournamentId, format });
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

async function entries(categoryId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await entryIn(categoryId, `Player ${String(index + 1)}`));
  }
  return ids;
}

/** Narrows an optional array element, failing fast in tests. */
function defined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error('Expected a defined value.');
  }
  return value;
}

/** Starts a bracket match once both slots are filled and returns its id. */
async function start(matchId: string): Promise<void> {
  await matches.transitionStatus(matchId, { status: 'IN_PROGRESS' });
}

describe('KnockoutBracketService.generateBracket', () => {
  it('generates a 2-entry bracket with a single final', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const [first, second] = await entries(categoryId, 2);

    const bracket = await knockout.generateBracket(stageId, {
      entryIds: [defined(first), defined(second)],
    });

    expect(bracket.bracketSize).toBe(2);
    expect(bracket.roundCount).toBe(1);
    expect(bracket.rounds).toHaveLength(1);
    expect(bracket.rounds[0]?.name).toBe('Final');
    expect(bracket.rounds[0]?.matches).toHaveLength(1);
    const final = bracket.rounds[0]?.matches[0];
    expect(final?.participant1.entryId).toBe(first);
    expect(final?.participant2.entryId).toBe(second);
    expect(final?.status).toBe('SCHEDULED');
  });

  it('generates a 4-entry bracket and pairs entries in the supplied order', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const [a, b, c, d] = await entries(categoryId, 4);

    const bracket = await knockout.generateBracket(stageId, {
      entryIds: [defined(a), defined(b), defined(c), defined(d)],
    });

    expect(bracket.bracketSize).toBe(4);
    expect(bracket.roundCount).toBe(2);
    expect(bracket.rounds.map((round) => round.name)).toEqual(['Semifinals', 'Final']);

    const [semi1, semi2] = bracket.rounds[0]?.matches ?? [];
    expect(semi1?.participant1.entryId).toBe(a);
    expect(semi1?.participant2.entryId).toBe(b);
    expect(semi2?.participant1.entryId).toBe(c);
    expect(semi2?.participant2.entryId).toBe(d);

    // The final starts with both slots unresolved - no placeholder entries.
    const final = bracket.rounds[1]?.matches[0];
    expect(final?.participant1.entryId).toBeNull();
    expect(final?.participant2.entryId).toBeNull();
  });

  it('generates an 8-entry bracket with the correct round shape', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const ids = await entries(categoryId, 8);

    const bracket = await knockout.generateBracket(stageId, { entryIds: ids });

    expect(bracket.bracketSize).toBe(8);
    expect(bracket.rounds.map((round) => round.matches.length)).toEqual([4, 2, 1]);
    expect(bracket.rounds.map((round) => round.name)).toEqual([
      'Quarterfinals',
      'Semifinals',
      'Final',
    ]);
  });

  it('records the bracket size on the stage', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const ids = await entries(categoryId, 4);

    await knockout.generateBracket(stageId, { entryIds: ids });

    const stage = await repos.client.stages.findById(stageId);
    expect(stage?.drawSize).toBe(4);
  });

  it('rejects an unsupported bracket size', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const ids = await entries(categoryId, 3);

    await expect(knockout.generateBracket(stageId, { entryIds: ids })).rejects.toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects duplicate entry ids', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const [a, b] = await entries(categoryId, 2);

    await expect(
      knockout.generateBracket(stageId, {
        entryIds: [defined(a), defined(a), defined(b), defined(b)],
      }),
    ).rejects.toThrow(ConflictError);
  });

  it('rejects an entry from another category', async () => {
    const categoryId = await singlesCategory();
    const otherCategoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const own = await entries(categoryId, 1);
    const foreign = await entries(otherCategoryId, 1);

    await expect(
      knockout.generateBracket(stageId, { entryIds: [defined(own[0]), defined(foreign[0])] }),
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('rejects a withdrawn entry', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const [a, b] = await entries(categoryId, 2);
    await repos.client.entries.updateStatus(defined(a), 'WITHDRAWN');

    await expect(
      knockout.generateBracket(stageId, { entryIds: [defined(a), defined(b)] }),
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('rejects a disqualified entry', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const [a, b] = await entries(categoryId, 2);
    await repos.client.entries.updateStatus(defined(b), 'DISQUALIFIED');

    await expect(
      knockout.generateBracket(stageId, { entryIds: [defined(a), defined(b)] }),
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('rejects a bracket that has already been generated', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const ids = await entries(categoryId, 2);
    await knockout.generateBracket(stageId, { entryIds: ids });

    await expect(knockout.generateBracket(stageId, { entryIds: ids })).rejects.toThrow(
      ConflictError,
    );
  });

  it('rejects a GROUP stage', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const ids = await entries(categoryId, 2);

    await expect(knockout.generateBracket(stageId, { entryIds: ids })).rejects.toThrow(
      BusinessRuleViolationError,
    );
  });

  it('rejects a missing stage', async () => {
    const categoryId = await singlesCategory();
    const ids = await entries(categoryId, 2);
    await expect(
      knockout.generateBracket('00000000-0000-4000-8000-000000000000', { entryIds: ids }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('KnockoutProgressionService.progress', () => {
  async function generatedBracket(size: 2 | 4 | 8): Promise<{
    stageId: string;
    categoryId: string;
    entryIds: string[];
    bracket: Awaited<ReturnType<typeof knockout.generateBracket>>;
  }> {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const entryIds = await entries(categoryId, size);
    const bracket = await knockout.generateBracket(stageId, { entryIds });
    return { stageId, categoryId, entryIds, bracket };
  }

  function matchIdAt(
    bracket: Awaited<ReturnType<typeof knockout.generateBracket>>,
    round: number,
    match: number,
  ): string {
    const found = bracket.rounds
      .find((row) => row.roundNumber === round)
      ?.matches.find((row) => row.matchNumber === match);
    if (!found) {
      throw new Error(`no match at round ${String(round)} number ${String(match)}`);
    }
    return found.matchId;
  }

  it('advances a semifinal winner into the final, in the correct slot', async () => {
    const { bracket } = await generatedBracket(4);
    const semi1 = matchIdAt(bracket, 1, 1);
    await start(semi1);
    const result = await results.recordResult(semi1, { games: twoZero });

    const finalMatchId = matchIdAt(bracket, 2, 1);
    const slots = await repos.client.matchParticipants.listByMatch(finalMatchId);
    expect(slots.find((slot) => slot.slot === 1)?.entryId).toBe(result.winnerEntryId);
    expect(slots.find((slot) => slot.slot === 2)).toBeUndefined();
  });

  it('fills the final only once both semifinals are decided', async () => {
    const { bracket, entryIds } = await generatedBracket(4);
    const semi1 = matchIdAt(bracket, 1, 1);
    const semi2 = matchIdAt(bracket, 1, 2);

    await start(semi1);
    const first = await results.recordResult(semi1, { games: twoZero });
    // The final cannot start yet: slot 2 is still empty.
    const finalMatchId = matchIdAt(bracket, 2, 1);
    await expect(start(finalMatchId)).rejects.toThrow(BusinessRuleViolationError);

    await start(semi2);
    const second = await results.recordResult(semi2, { games: twoZero });

    const finalSlots = await repos.client.matchParticipants.listByMatch(finalMatchId);
    expect(finalSlots.find((slot) => slot.slot === 1)?.entryId).toBe(first.winnerEntryId);
    expect(finalSlots.find((slot) => slot.slot === 2)?.entryId).toBe(second.winnerEntryId);

    // Winner of the final is one of the semifinal winners, never a newcomer.
    await start(finalMatchId);
    const final = await results.recordResult(finalMatchId, { games: twoZero });
    expect(entryIds).toContain(final.winnerEntryId);
  });

  it('maps quarterfinal winners onto the right semifinal slots', async () => {
    const { bracket, stageId } = await generatedBracket(8);
    const qfIds = [1, 2, 3, 4].map((number) => matchIdAt(bracket, 1, number));
    const winners: string[] = [];
    for (const qf of qfIds) {
      await start(qf);
      const result = await results.recordResult(qf, { games: twoZero });
      winners.push(result.winnerEntryId);
    }

    const bracketAfter = await knockout.getBracket(stageId);
    const semi1 = bracketAfter.rounds
      .find((row) => row.roundNumber === 2)
      ?.matches.find((row) => row.matchNumber === 1);
    const semi2 = bracketAfter.rounds
      .find((row) => row.roundNumber === 2)
      ?.matches.find((row) => row.matchNumber === 2);
    expect(semi1?.participant1.entryId).toBe(winners[0]);
    expect(semi1?.participant2.entryId).toBe(winners[1]);
    expect(semi2?.participant1.entryId).toBe(winners[2]);
    expect(semi2?.participant2.entryId).toBe(winners[3]);
  });

  it('is idempotent: replaying the same result does not double-progress', async () => {
    const { bracket } = await generatedBracket(4);
    const semi1 = matchIdAt(bracket, 1, 1);
    await start(semi1);
    const result = await results.recordResult(semi1, { games: twoZero });

    const finalMatchId = matchIdAt(bracket, 2, 1);
    // Directly re-running progression for the same winner is a no-op.
    const progressed = await progression.progress(repos.client, semi1, result.winnerEntryId);
    expect(progressed).toBe(false);

    const slots = await repos.client.matchParticipants.listByMatch(finalMatchId);
    expect(slots.filter((slot) => slot.slot === 1)).toHaveLength(1);
    expect(slots.find((slot) => slot.slot === 1)?.entryId).toBe(result.winnerEntryId);
  });

  it('rejects conflicting progression into an occupied slot', async () => {
    const { bracket, categoryId } = await generatedBracket(4);
    const semi1 = matchIdAt(bracket, 1, 1);
    await start(semi1);
    const result = await results.recordResult(semi1, { games: twoZero });

    // Plant a different entry in the destination slot, then re-run progression.
    const impostor = await entryIn(categoryId, 'Impostor');
    const finalMatchId = matchIdAt(bracket, 2, 1);
    await repos.client.matchParticipants.upsertSlot(finalMatchId, 1, impostor);

    await expect(progression.progress(repos.client, semi1, result.winnerEntryId)).rejects.toThrow(
      ConflictError,
    );
  });

  it('rejects progression for an incomplete match', async () => {
    const { bracket } = await generatedBracket(4);
    const semi1 = matchIdAt(bracket, 1, 1);
    await start(semi1);
    const participants = await repos.client.matchParticipants.listByMatch(semi1);
    const someone = participants[0]?.entryId ?? '';

    await expect(progression.progress(repos.client, semi1, someone)).rejects.toThrow(
      BusinessRuleViolationError,
    );
  });

  it('does nothing for the final winner (the champion)', async () => {
    const { bracket } = await generatedBracket(2);
    const finalMatchId = matchIdAt(bracket, 1, 1);
    await start(finalMatchId);
    const result = await results.recordResult(finalMatchId, { games: twoZero });

    const progressed = await progression.progress(repos.client, finalMatchId, result.winnerEntryId);
    expect(progressed).toBe(false);
  });

  it('does not change participant slots of a completed match', async () => {
    const { bracket } = await generatedBracket(4);
    const semi1 = matchIdAt(bracket, 1, 1);
    await start(semi1);
    const before = await repos.client.matchParticipants.listByMatch(semi1);
    await results.recordResult(semi1, { games: twoZero });
    const after = await repos.client.matchParticipants.listByMatch(semi1);

    expect(after.map((slot) => slot.entryId).sort()).toEqual(
      before.map((slot) => slot.entryId).sort(),
    );
  });
});

describe('knockout stage completion', () => {
  async function generatedBracket(size: 2 | 4): Promise<{
    stageId: string;
    bracket: Awaited<ReturnType<typeof knockout.generateBracket>>;
  }> {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId, { status: 'ACTIVE' });
    const entryIds = await entries(categoryId, size);
    const bracket = await knockout.generateBracket(stageId, { entryIds });
    return { stageId, bracket };
  }

  function matchIdAt(
    bracket: Awaited<ReturnType<typeof knockout.generateBracket>>,
    round: number,
    match: number,
  ): string {
    const found = bracket.rounds
      .find((row) => row.roundNumber === round)
      ?.matches.find((row) => row.matchNumber === match);
    if (!found) {
      throw new Error('missing match');
    }
    return found.matchId;
  }

  it('keeps the stage ACTIVE until the final is completed', async () => {
    const { stageId, bracket } = await generatedBracket(4);
    const semi1 = matchIdAt(bracket, 1, 1);
    await start(semi1);
    await results.recordResult(semi1, { games: twoZero });

    const stage = await knockout.getBracket(stageId);
    expect(stage.status).toBe('ACTIVE');
    expect(stage.complete).toBe(false);
  });

  it('completes the stage when the final is decided', async () => {
    const { stageId, bracket } = await generatedBracket(2);
    const finalMatchId = matchIdAt(bracket, 1, 1);
    await start(finalMatchId);
    await results.recordResult(finalMatchId, { games: twoZero });

    const stage = await knockout.getBracket(stageId);
    expect(stage.status).toBe('COMPLETED');
    expect(stage.complete).toBe(true);

    const persisted = await repos.client.stages.findById(stageId);
    expect(persisted?.status).toBe('COMPLETED');
  });
});

describe('knockout match eligibility', () => {
  async function generatedBracket(): Promise<{
    bracket: Awaited<ReturnType<typeof knockout.generateBracket>>;
  }> {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const entryIds = await entries(categoryId, 4);
    const bracket = await knockout.generateBracket(stageId, { entryIds });
    return { bracket };
  }

  it('allows starting a match whose two slots are filled', async () => {
    const { bracket } = await generatedBracket();
    const semi1 = bracket.rounds[0]?.matches[0]?.matchId ?? '';
    const started = await matches.transitionStatus(semi1, { status: 'IN_PROGRESS' });
    expect(started.status).toBe('IN_PROGRESS');
  });

  it('refuses to start a match with an unresolved slot', async () => {
    const { bracket } = await generatedBracket();
    const finalMatchId = bracket.rounds[1]?.matches[0]?.matchId ?? '';
    await expect(matches.transitionStatus(finalMatchId, { status: 'IN_PROGRESS' })).rejects.toThrow(
      BusinessRuleViolationError,
    );
  });

  it('refuses to start a knockout match after a participant is withdrawn', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const entryIds = await entries(categoryId, 2);
    const bracket = await knockout.generateBracket(stageId, { entryIds });
    const finalMatchId = bracket.rounds[0]?.matches[0]?.matchId ?? '';
    await repos.client.entries.updateStatus(defined(entryIds[0]), 'WITHDRAWN');

    await expect(matches.transitionStatus(finalMatchId, { status: 'IN_PROGRESS' })).rejects.toThrow(
      BusinessRuleViolationError,
    );
  });
});

describe('knockout does not disturb group standings', () => {
  it('leaves group standings untouched by a knockout stage in the same category', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId, format: 'SINGLES' });
    const groupStageId = await seedStage(repos.client, categoryId);
    const knockoutStageId = await seedKnockoutStage(repos.client, categoryId, { sequence: 2 });
    const ids = await entries(categoryId, 2);
    await knockout.generateBracket(knockoutStageId, { entryIds: ids });

    const standings = createStandingsService(repos.client);
    // Group standings show only the group stage's completed matches: the
    // knockout stage's matches are invisible, so nothing has been played.
    const rows = await standings.getStageStandings(groupStageId);
    expect(rows.every((row) => row.played === 0)).toBe(true);
  });
});
