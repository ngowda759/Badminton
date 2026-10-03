import { createRealtimeEventService, createTournamentStageService } from '@badminton/application';
import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedCategory, seedMatch, seedStage, seedTournament } from './fixtures.ts';

/**
 * Guarded stage removal (TASK-10, parity gap G11).
 *
 * Mirrors V1's `removeGroup`: an empty stage can be removed, a stage that still
 * has matches is refused (the `matches.stageId` Restrict FK is the final
 * boundary) and the last stage of a category is never removed.
 */

let repos: FakeRepositories;
let stages: ReturnType<typeof createTournamentStageService>;

beforeEach(() => {
  repos = createFakeRepositories();
  stages = createTournamentStageService(
    repos.client,
    repos.unitOfWork,
    createRealtimeEventService(),
  );
});

async function categoryWithStages(
  count: number,
): Promise<{ categoryId: string; stageIds: string[] }> {
  const tournamentId = await seedTournament(repos.client);
  const categoryId = await seedCategory(repos.client, { tournamentId });
  const stageIds: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    stageIds.push(await seedStage(repos.client, categoryId, { sequence: index }));
  }
  return { categoryId, stageIds };
}

describe('TournamentStageService.remove', () => {
  it('deletes an empty stage that is not the last one', async () => {
    const { categoryId, stageIds } = await categoryWithStages(2);
    const [first, second] = stageIds as [string, string];

    await stages.remove(first);

    const remaining = await stages.listByCategory(categoryId);
    expect(remaining.map((stage) => stage.id)).toEqual([second]);
    await expect(stages.getById(first)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to remove a stage that still has a match and leaves it in place', async () => {
    const { categoryId, stageIds } = await categoryWithStages(2);
    const [first] = stageIds as [string, string];
    await seedMatch(repos.client, first);

    await expect(stages.remove(first)).rejects.toBeInstanceOf(ConflictError);

    const remaining = await stages.listByCategory(categoryId);
    expect(remaining.map((stage) => stage.id)).toContain(first);
  });

  it('refuses to remove the last stage of a category', async () => {
    const { categoryId, stageIds } = await categoryWithStages(1);
    const [only] = stageIds as [string];

    await expect(stages.remove(only)).rejects.toBeInstanceOf(BusinessRuleViolationError);

    const remaining = await stages.listByCategory(categoryId);
    expect(remaining.map((stage) => stage.id)).toEqual([only]);
  });

  it('raises NotFoundError for an unknown id', async () => {
    await expect(stages.remove('missing')).rejects.toBeInstanceOf(NotFoundError);
  });
});
