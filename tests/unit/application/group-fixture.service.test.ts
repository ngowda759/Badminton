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
 * Group-stage fixture generation.
 *
 * The service runs against the real code and the in-memory repositories (not
 * spies): generation validates the entries, writes the whole round-robin in one
 * transaction and returns the persisted fixtures.
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

async function doublesCategory(): Promise<string> {
  const tournamentId = await seedTournament(repos.client);
  return seedCategory(repos.client, { tournamentId, format: 'DOUBLES' });
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

async function teamEntry(categoryId: string, name: string): Promise<string> {
  const { teamId } = await seedTeamWithMembers(repos.client, { name, memberCount: 2 });
  const entry = await repos.client.entries.create({
    categoryId,
    playerId: null,
    teamId,
    seed: null,
    status: 'CONFIRMED',
  });
  return entry.id;
}

describe('GroupFixtureService.generate', () => {
  it('creates a complete round-robin for a singles group', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 4);

    const result = await fixtures.generate(stageId, { entryIds });

    expect(result.matchCount).toBe(6);
    expect(result.competitorCount).toBe(4);
    expect(result.stageId).toBe(stageId);
    expect(result.matches).toHaveLength(6);

    // Persisted, not just returned.
    const stored = await repos.client.matches.listByStage(stageId);
    expect(stored).toHaveLength(6);
  });

  it('fills both participant slots of every match with the supplied entries', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 5);

    const result = await fixtures.generate(stageId, { entryIds });
    expect(result.matchCount).toBe(10);

    const seen = new Set<string>();
    for (const match of result.matches) {
      expect(match.participant1.entryId).not.toBe('');
      expect(match.participant2.entryId).not.toBe('');
      expect(entryIds).toContain(match.participant1.entryId);
      expect(entryIds).toContain(match.participant2.entryId);
      expect(match.participant1.entryId).not.toBe(match.participant2.entryId);
      const key = [match.participant1.entryId, match.participant2.entryId].sort().join('|');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // Every pair appears exactly once.
    expect(seen.size).toBe((5 * 4) / 2);
  });

  it('produces a valid round-robin for every supported group size', async () => {
    for (const size of [2, 3, 4, 5, 6]) {
      repos = createFakeRepositories();
      fixtures = createGroupFixtureService(repos.unitOfWork);
      const categoryId = await singlesCategory();
      const stageId = await seedStage(repos.client, categoryId);
      const entryIds = await playerEntries(categoryId, size);

      const result = await fixtures.generate(stageId, { entryIds });
      expect(result.matchCount).toBe((size * (size - 1)) / 2);

      const played = new Map<string, number>();
      for (const match of result.matches) {
        played.set(match.participant1.entryId, (played.get(match.participant1.entryId) ?? 0) + 1);
        played.set(match.participant2.entryId, (played.get(match.participant2.entryId) ?? 0) + 1);
      }
      for (const entryId of entryIds) {
        expect(played.get(entryId)).toBe(size - 1);
      }
    }
  });

  it('schedules doubles teams (team entries) the same way', async () => {
    const categoryId = await doublesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = [
      await teamEntry(categoryId, 'Team AB'),
      await teamEntry(categoryId, 'Team CD'),
      await teamEntry(categoryId, 'Team EF'),
    ];

    const result = await fixtures.generate(stageId, { entryIds });
    expect(result.matchCount).toBe(3);
    for (const match of result.matches) {
      expect(entryIds).toContain(match.participant1.entryId);
      expect(entryIds).toContain(match.participant2.entryId);
    }
  });

  it('numbers matches 1..M in generation order', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 4);

    const result = await fixtures.generate(stageId, { entryIds });
    expect(result.matches.map((match) => match.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.matches.every((match) => match.status === 'SCHEDULED')).toBe(true);
  });

  it('rejects generating fixtures twice (no duplicate fixtures)', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 3);

    await fixtures.generate(stageId, { entryIds });
    await expect(fixtures.generate(stageId, { entryIds })).rejects.toBeInstanceOf(ConflictError);

    const stored = await repos.client.matches.listByStage(stageId);
    expect(stored).toHaveLength(3);
  });

  it('rejects fewer than two entries', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 1);

    await expect(fixtures.generate(stageId, { entryIds })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a duplicated entry', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const [entryId] = await playerEntries(categoryId, 1);
    if (entryId === undefined) {
      throw new Error('Expected an entry.');
    }

    await expect(
      fixtures.generate(stageId, { entryIds: [entryId, entryId] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects entries from another category', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 2);

    const otherTournament = await seedTournament(repos.client);
    const otherCategory = await seedCategory(repos.client, { tournamentId: otherTournament });
    const foreign = await playerEntry(otherCategory, 'Foreign');

    await expect(
      fixtures.generate(stageId, { entryIds: [entryIds[0] ?? '', foreign] }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('rejects a withdrawn entry', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const active = await playerEntry(categoryId, 'Active');
    const withdrawn = await playerEntry(categoryId, 'Withdrawn', 'WITHDRAWN');

    await expect(
      fixtures.generate(stageId, { entryIds: [active, withdrawn] }),
    ).rejects.toBeInstanceOf(BusinessRuleViolationError);
  });

  it('rejects a knockout stage', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedKnockoutStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 2);

    await expect(fixtures.generate(stageId, { entryIds })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects a completed stage', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId, { status: 'COMPLETED' });
    const entryIds = await playerEntries(categoryId, 2);

    await expect(fixtures.generate(stageId, { entryIds })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects a missing stage', async () => {
    const categoryId = await singlesCategory();
    const entryIds = await playerEntries(categoryId, 2);

    await expect(
      fixtures.generate('11111111-1111-4111-8111-111111111111', { entryIds }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('writes the whole round-robin inside one transaction', async () => {
    let transactions = 0;
    const counting = {
      async runInTransaction<T>(work: (client: typeof repos.client) => Promise<T>): Promise<T> {
        transactions += 1;
        return repos.unitOfWork.runInTransaction(work);
      },
    };
    fixtures = createGroupFixtureService(counting);

    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const entryIds = await playerEntries(categoryId, 4);

    await fixtures.generate(stageId, { entryIds });
    expect(transactions).toBe(1);
  });
});
