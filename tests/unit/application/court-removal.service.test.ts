import { createCourtService, createRealtimeEventService } from '@badminton/application';
import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedCategory, seedCourt, seedMatch, seedStage, seedTournament } from './fixtures.ts';

/**
 * Guarded court removal (TASK-11, parity gap G11).
 *
 * Mirrors V1's `removeCourt`: a court with no matches can be removed, a court
 * that still has a match is refused (the `matches.courtId` Restrict FK is the
 * final boundary) and the tournament's last court is never removed. A
 * deactivated court with no matches remains removable.
 */

let repos: FakeRepositories;
let courts: ReturnType<typeof createCourtService>;

beforeEach(() => {
  repos = createFakeRepositories();
  courts = createCourtService(repos.client, repos.unitOfWork, createRealtimeEventService());
});

async function tournamentWithCourts(
  count: number,
): Promise<{ tournamentId: string; courtIds: string[] }> {
  const tournamentId = await seedTournament(repos.client);
  const courtIds: string[] = [];
  for (let index = 1; index <= count; index += 1) {
    courtIds.push(await seedCourt(repos.client, tournamentId, { number: index }));
  }
  return { tournamentId, courtIds };
}

/** A match scheduled on `courtId`, so the court is occupied. */
async function occupyCourt(tournamentId: string, courtId: string): Promise<string> {
  const categoryId = await seedCategory(repos.client, { tournamentId });
  const stageId = await seedStage(repos.client, categoryId);
  const matchId = await seedMatch(repos.client, stageId);
  await repos.client.matches.schedule(matchId, {
    courtId,
    scheduledStartAt: new Date('2026-10-05T10:00:00.000Z'),
    scheduledEndAt: new Date('2026-10-05T10:30:00.000Z'),
  });
  return matchId;
}

describe('CourtService.remove', () => {
  it('deletes a court that has no matches', async () => {
    const { tournamentId, courtIds } = await tournamentWithCourts(2);
    const [first, second] = courtIds as [string, string];

    await courts.remove(first);

    const remaining = await courts.listByTournament(tournamentId);
    expect(remaining.map((court) => court.id)).toEqual([second]);
    await expect(courts.getById(first)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to remove a court that has a match and leaves it in place', async () => {
    const { tournamentId, courtIds } = await tournamentWithCourts(2);
    const [first] = courtIds as [string, string];
    await occupyCourt(tournamentId, first);

    await expect(courts.remove(first)).rejects.toBeInstanceOf(ConflictError);

    const remaining = await courts.listByTournament(tournamentId);
    expect(remaining.map((court) => court.id)).toContain(first);
  });

  it('refuses to remove the last court of a tournament', async () => {
    const { tournamentId, courtIds } = await tournamentWithCourts(1);
    const [only] = courtIds as [string];

    await expect(courts.remove(only)).rejects.toBeInstanceOf(BusinessRuleViolationError);

    const remaining = await courts.listByTournament(tournamentId);
    expect(remaining.map((court) => court.id)).toEqual([only]);
  });

  it('raises NotFoundError for an unknown id', async () => {
    await expect(courts.remove('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('removes a deactivated court that has no matches', async () => {
    const { tournamentId, courtIds } = await tournamentWithCourts(2);
    const [first, second] = courtIds as [string, string];
    await courts.transitionStatus(first, { status: 'INACTIVE' });

    await courts.remove(first);

    const remaining = await courts.listByTournament(tournamentId);
    expect(remaining.map((court) => court.id)).toEqual([second]);
  });
});
