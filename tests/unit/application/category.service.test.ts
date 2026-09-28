import {
  createRealtimeEventService,
  createTournamentCategoryService,
} from '@badminton/application';
import {
  BusinessRuleViolationError,
  InvalidStateTransitionError,
  ValidationError,
} from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedCategory, seedPlayer, seedTournament } from './fixtures.ts';

/**
 * Category service unit tests.
 *
 * Covers code normalization, name rules, the DRAFT default, the format freeze
 * once entries exist and the category lifecycle.
 */

let repos: FakeRepositories;
let service: ReturnType<typeof createTournamentCategoryService>;

beforeEach(() => {
  repos = createFakeRepositories();
  service = createTournamentCategoryService(
    repos.client,
    repos.unitOfWork,
    createRealtimeEventService(),
  );
});

describe('TournamentCategoryService.create', () => {
  it('normalizes the code to upper case and trims it', async () => {
    const tournamentId = await seedTournament(repos.client);
    const category = await service.create(tournamentId, {
      name: "Men's Singles",
      code: ' ms ',
      format: 'SINGLES',
    });
    expect(category.code).toBe('MS');
    expect(category.status).toBe('DRAFT');
  });

  it('removes internal whitespace from the code', async () => {
    const tournamentId = await seedTournament(repos.client);
    const category = await service.create(tournamentId, {
      name: 'Mixed Doubles',
      code: 'x d',
      format: 'DOUBLES',
    });
    expect(category.code).toBe('XD');
  });

  it('rejects a code that is invalid after normalization', async () => {
    const tournamentId = await seedTournament(repos.client);
    await expect(
      service.create(tournamentId, { name: 'Bad', code: 'TOO-LONG-CODE', format: 'SINGLES' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a blank name', async () => {
    const tournamentId = await seedTournament(repos.client);
    await expect(
      service.create(tournamentId, { name: '  ', code: 'MS', format: 'SINGLES' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a missing tournament', async () => {
    await expect(
      service.create('missing-tournament', { name: 'A', code: 'A', format: 'SINGLES' }),
    ).rejects.toThrow(/not found/i);
  });

  it('rejects a duplicate code within the tournament', async () => {
    const tournamentId = await seedTournament(repos.client);
    await service.create(tournamentId, { name: 'One', code: 'MS', format: 'SINGLES' });
    await expect(
      service.create(tournamentId, { name: 'Two', code: 'ms', format: 'SINGLES' }),
    ).rejects.toThrow(/already exists/i);
  });
});

describe('TournamentCategoryService.update', () => {
  it('freezes format once entries exist', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    const playerId = await seedPlayer(repos.client);
    await repos.client.entries.create({
      categoryId,
      playerId,
      teamId: null,
      seed: null,
      status: 'PENDING',
    });

    await expect(service.update(categoryId, { format: 'DOUBLES' })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('allows a format change when no entries exist', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId, format: 'SINGLES' });
    const updated = await service.update(categoryId, { format: 'DOUBLES' });
    expect(updated.format).toBe('DOUBLES');
  });

  it('refuses to edit a cancelled category', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId });
    await service.transitionStatus(categoryId, { status: 'CANCELLED' });
    await expect(service.update(categoryId, { name: 'X' })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });
});

describe('TournamentCategoryService.transitionStatus', () => {
  it('follows the forward lifecycle', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId, status: 'DRAFT' });
    const opened = await service.transitionStatus(categoryId, { status: 'OPEN' });
    expect(opened.status).toBe('OPEN');
    const closed = await service.transitionStatus(categoryId, { status: 'CLOSED' });
    expect(closed.status).toBe('CLOSED');
  });

  it('rejects a jump from DRAFT to COMPLETED', async () => {
    const tournamentId = await seedTournament(repos.client);
    const categoryId = await seedCategory(repos.client, { tournamentId, status: 'DRAFT' });
    await expect(
      service.transitionStatus(categoryId, { status: 'COMPLETED' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});
