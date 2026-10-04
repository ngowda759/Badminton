import { createGroupFixtureService } from '@badminton/application';
import {
  BusinessRuleViolationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import {
  seedCategory,
  seedKnockoutStage,
  seedPlayer,
  seedStage,
  seedTeamWithMembers,
  seedTournament,
} from './fixtures.ts';

/**
 * Group-stage fixture regeneration.
 *
 * The service runs against the real code and the in-memory repositories (not
 * spies): regeneration replaces the whole fixture set with a freshly generated
 * round-robin in one transaction and rejects the guarded cases exactly as
 * generation does.
 */

let repos: FakeRepositories;
let fixtures: ReturnType<typeof createGroupFixtureService>;

beforeEach(() => {
  repos = createFakeRepositories();
  fixtures = createGroupFixtureService(repos.unitOfWork);
});

async function singlesCategory(): Promise<string> {
  const tournamentId = await seedTournament(repos.client);
  return seedCategory(repos.client, { tournamentId, format: 'SINGLES' });
}

async function playerEntry(
  categoryId: string,
  name: string,
  status: 'PENDING' | 'CONFIRMED' | 'WITHDRAWN' | 'DISQUALIFIED' = 'CONFIRMED',
): Promise<string> {
  const playerId = await seedPlayer(repos.client, name);
  const entry = await repos.client.entries.create({
    categoryId,
    playerId,
    teamId: null,
    seed: null,
    status,
  });
  return entry.id;
}

async function playerEntries(categoryId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await playerEntry(categoryId, `Player ${String(index + 1)}`));
  }
  return ids;
}

describe('GroupFixtureService.regenerate', () => {
  it('replaces the stage fixture set with a fresh round-robin for the new ordering', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 4);

    const first = await fixtures.generate(stageId, { entryIds });
    const oldIds = first.matches.map((match) => match.matchId);

    // Regenerate with the same four entries in a different order.
    const reordered = [entryIds[3] ?? '', entryIds[2] ?? '', entryIds[1] ?? '', entryIds[0] ?? ''];
    const result = await fixtures.regenerate(stageId, { entryIds: reordered });

    expect(result.matchCount).toBe(6);
    expect(result.competitorCount).toBe(4);
    expect(result.stageId).toBe(stageId);

    // Every old match id is gone and the set is exactly the new one.
    const stored = await repos.client.matches.listByStage(stageId);
    expect(stored).toHaveLength(6);
    const storedIds = stored.map((match) => match.id);
    for (const oldId of oldIds) {
      expect(storedIds).not.toContain(oldId);
    }
    for (const match of result.matches) {
      expect(storedIds).toContain(match.matchId);
      expect(match.participant1.entryId).not.toBe('');
      expect(match.participant2.entryId).not.toBe('');
      expect(reordered).toContain(match.participant1.entryId);
      expect(reordered).toContain(match.participant2.entryId);
      expect(match.participant1.entryId).not.toBe(match.participant2.entryId);
    }
  });

  it('rejects regenerating a stage with no fixtures', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 2);

    await expect(fixtures.regenerate(stageId, { entryIds })).rejects.toBeInstanceOf(ConflictError);
    const stored = await repos.client.matches.listByStage(stageId);
    expect(stored).toHaveLength(0);
  });

  it('rejects a completed stage', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 2);
    await fixtures.generate(stageId, { entryIds });
    await repos.client.stages.updateStatus(stageId, 'COMPLETED');

    await expect(fixtures.regenerate(stageId, { entryIds })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
    // The original fixtures are untouched.
    const stored = await repos.client.matches.listByStage(stageId);
    expect(stored).toHaveLength(1);
  });

  it('rejects a knockout stage', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 2);

    await expect(fixtures.regenerate(stageId, { entryIds })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects a missing stage', async () => {
    const categoryId = await singlesCategory();
    const entryIds = await playerEntries(categoryId, 2);

    await expect(
      fixtures.regenerate('11111111-1111-4111-8111-111111111111', { entryIds }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects fewer than two entries', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 2);
    await fixtures.generate(stageId, { entryIds });

    const [only] = entryIds;
    await expect(fixtures.regenerate(stageId, { entryIds: [only ?? ''] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a duplicated entry', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 2);
    await fixtures.generate(stageId, { entryIds });

    const first = entryIds[0] ?? '';
    await expect(fixtures.regenerate(stageId, { entryIds: [first, first] })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('rejects a withdrawn entry', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 2);
    await fixtures.generate(stageId, { entryIds });

    const active = await playerEntry(categoryId, 'Active');
    const withdrawn = await playerEntry(categoryId, 'Withdrawn', 'WITHDRAWN');
    await expect(
      fixtures.regenerate(stageId, { entryIds: [active, withdrawn] }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('rejects a foreign-category entry', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 2);
    await fixtures.generate(stageId, { entryIds });

    const otherTournament = await seedTournament(repos.client);
    const otherCategory = await seedCategory(repos.client, { tournamentId: otherTournament });
    const foreign = await playerEntry(otherCategory, 'Foreign');
    await expect(
      fixtures.regenerate(stageId, { entryIds: [entryIds[0] ?? '', foreign] }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('replaces a doubles round-robin from team entries', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, {
      tournamentId,
      format: 'DOUBLES',
    });
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds: string[] = [];
    for (const name of ['Team AB', 'Team CD', 'Team EF']) {
      const { teamId } = await seedTeamWithMembers(repos.client, { name, memberCount: 2 });
      const entry = await repos.client.entries.create({
        categoryId,
        playerId: null,
        teamId,
        seed: null,
        status: 'CONFIRMED',
      });
      entryIds.push(entry.id);
    }

    await fixtures.generate(stageId, { entryIds });
    const reordered = [entryIds[2] ?? '', entryIds[0] ?? '', entryIds[1] ?? ''];
    const result = await fixtures.regenerate(stageId, { entryIds: reordered });

    expect(result.matchCount).toBe(3);
    for (const match of result.matches) {
      expect(reordered).toContain(match.participant1.entryId);
      expect(reordered).toContain(match.participant2.entryId);
    }
  });

  it('runs the whole replace inside one transaction', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 4);
    await fixtures.generate(stageId, { entryIds });

    let transactions = 0;
    const counting = {
      async runInTransaction<T>(work: (client: typeof repos.client) => Promise<T>): Promise<T> {
        transactions += 1;
        return repos.unitOfWork.runInTransaction(work);
      },
    };
    fixtures = createGroupFixtureService(counting);

    await fixtures.regenerate(stageId, { entryIds });
    expect(transactions).toBe(1);
  });
});
