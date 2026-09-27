import { createMatchService, createTournamentStageService } from '@badminton/application';
import {
  BusinessRuleViolationError,
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedCategory, seedMatch, seedPlayer, seedStage, seedTournament } from './fixtures.ts';

/**
 * Stage and match service unit tests.
 *
 * Covers sequence uniqueness and positivity, lifecycle transitions, participant
 * slot rules and cross-category eligibility.
 */

let repos: FakeRepositories;
let stages: ReturnType<typeof createTournamentStageService>;
let matches: ReturnType<typeof createMatchService>;

beforeEach(() => {
  repos = createFakeRepositories();
  stages = createTournamentStageService(repos.client);
  matches = createMatchService(repos.client, repos.unitOfWork);
});

async function singlesCategory(): Promise<string> {
  const tournamentId = await seedTournament(repos.client);
  return seedCategory(repos.client, { tournamentId, format: 'SINGLES' });
}

async function singlesEntry(categoryId: string): Promise<string> {
  const playerId = await seedPlayer(repos.client);
  const entry = await repos.client.entries.create({
    categoryId,
    playerId,
    teamId: null,
    seed: null,
    status: 'PENDING',
  });
  return entry.id;
}

describe('TournamentStageService.create', () => {
  it('creates a stage with a positive sequence', async () => {
    const categoryId = await singlesCategory();
    const stage = await stages.create(categoryId, {
      name: 'Group Stage',
      type: 'GROUP',
      sequence: 1,
    });
    expect(stage.sequence).toBe(1);
    expect(stage.status).toBe('PENDING');
  });

  it('rejects a missing category', async () => {
    await expect(
      stages.create('missing', { name: 'S', type: 'GROUP', sequence: 1 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a non-positive sequence', async () => {
    const categoryId = await singlesCategory();
    await expect(
      stages.create(categoryId, { name: 'S', type: 'GROUP', sequence: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a duplicate sequence within a category', async () => {
    const categoryId = await singlesCategory();
    await stages.create(categoryId, { name: 'A', type: 'GROUP', sequence: 1 });
    await expect(
      stages.create(categoryId, { name: 'B', type: 'KNOCKOUT', sequence: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a non-positive draw size', async () => {
    const categoryId = await singlesCategory();
    await expect(
      stages.create(categoryId, { name: 'S', type: 'KNOCKOUT', sequence: 1, drawSize: -4 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('TournamentStageService.transitionStatus', () => {
  it('activates and completes a stage', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    await stages.transitionStatus(stageId, { status: 'ACTIVE' });
    const completed = await stages.transitionStatus(stageId, { status: 'COMPLETED' });
    expect(completed.status).toBe('COMPLETED');
  });

  it('rejects completing a pending stage', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    await expect(stages.transitionStatus(stageId, { status: 'COMPLETED' })).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
  });

  it('refuses to complete an ACTIVE knockout stage while the final is unresolved', async () => {
    const categoryId = await singlesCategory();
    const stage = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      drawSize: 4,
      status: 'ACTIVE',
    });
    await repos.client.matches.create({
      stageId: stage.id,
      sequence: 3,
      roundNumber: 2,
      matchNumber: 1,
      status: 'SCHEDULED',
    });

    await expect(stages.transitionStatus(stage.id, { status: 'COMPLETED' })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('refuses to complete a knockout stage that has no bracket', async () => {
    const categoryId = await singlesCategory();
    const stage = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      drawSize: null,
      status: 'ACTIVE',
    });

    await expect(stages.transitionStatus(stage.id, { status: 'COMPLETED' })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('completes a knockout stage once its final match is completed', async () => {
    const categoryId = await singlesCategory();
    const stage = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      drawSize: 2,
      status: 'ACTIVE',
    });
    await repos.client.matches.create({
      stageId: stage.id,
      sequence: 1,
      roundNumber: 1,
      matchNumber: 1,
      status: 'COMPLETED',
    });

    const completed = await stages.transitionStatus(stage.id, { status: 'COMPLETED' });
    expect(completed.status).toBe('COMPLETED');
  });
});

describe('TournamentStageService.drawSize immutability', () => {
  async function knockoutStage(drawSize: number | null): Promise<string> {
    const categoryId = await singlesCategory();
    const stage = await repos.client.stages.create({
      categoryId,
      name: 'Knockout',
      type: 'KNOCKOUT',
      sequence: 1,
      drawSize,
      status: 'ACTIVE',
    });
    return stage.id;
  }

  it('allows changing the draw size before a bracket exists', async () => {
    const stageId = await knockoutStage(null);
    const updated = await stages.update(stageId, { drawSize: 8 });
    expect(updated.drawSize).toBe(8);
  });

  it('refuses to change the draw size once a bracket has been generated', async () => {
    const stageId = await knockoutStage(4);
    await repos.client.matches.create({
      stageId,
      sequence: 1,
      roundNumber: 1,
      matchNumber: 1,
      status: 'SCHEDULED',
    });

    await expect(stages.update(stageId, { drawSize: 8 })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('allows re-sending the current draw size after generation', async () => {
    const stageId = await knockoutStage(4);
    await repos.client.matches.create({
      stageId,
      sequence: 1,
      roundNumber: 1,
      matchNumber: 1,
      status: 'SCHEDULED',
    });

    const updated = await stages.update(stageId, { drawSize: 4, name: 'Renamed' });
    expect(updated.drawSize).toBe(4);
    expect(updated.name).toBe('Renamed');
  });
});

describe('MatchService.create', () => {
  it('creates a scheduled match with unique sequence', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const match = await matches.create(stageId, { sequence: 1, roundNumber: 1, matchNumber: 1 });
    expect(match.status).toBe('SCHEDULED');
    expect(match.roundNumber).toBe(1);
  });

  it('rejects a duplicate sequence within a stage', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    await matches.create(stageId, { sequence: 1 });
    await expect(matches.create(stageId, { sequence: 1 })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a non-positive round number', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    await expect(matches.create(stageId, { sequence: 1, roundNumber: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a missing stage', async () => {
    await expect(matches.create('missing', { sequence: 1 })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('MatchService.addParticipant', () => {
  it('assigns slot 1 and slot 2', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    const first = await singlesEntry(categoryId);
    const second = await singlesEntry(categoryId);

    await matches.addParticipant(matchId, { entryId: first, slot: 1 });
    const participant = await matches.addParticipant(matchId, { entryId: second, slot: 2 });
    expect(participant.slot).toBe(2);
  });

  it('rejects reusing an occupied slot', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    const first = await singlesEntry(categoryId);
    const second = await singlesEntry(categoryId);

    await matches.addParticipant(matchId, { entryId: first, slot: 1 });
    await expect(
      matches.addParticipant(matchId, { entryId: second, slot: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects the same entry in both slots', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    const entryId = await singlesEntry(categoryId);

    await matches.addParticipant(matchId, { entryId, slot: 1 });
    await expect(matches.addParticipant(matchId, { entryId, slot: 2 })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('rejects an entry from another category', async () => {
    const categoryId = await singlesCategory();
    const otherCategory = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    const foreign = await singlesEntry(otherCategory);

    await expect(
      matches.addParticipant(matchId, { entryId: foreign, slot: 1 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a withdrawn entry', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    const entryId = await singlesEntry(categoryId);
    await repos.client.entries.updateStatus(entryId, 'WITHDRAWN');

    await expect(matches.addParticipant(matchId, { entryId, slot: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('MatchService.transitionStatus', () => {
  it('starts a scheduled match', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);

    const started = await matches.transitionStatus(matchId, { status: 'IN_PROGRESS' });
    expect(started.status).toBe('IN_PROGRESS');
  });

  it('does not allow completing a match through the status endpoint', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    await matches.transitionStatus(matchId, { status: 'IN_PROGRESS' });

    // Completion is a scored operation: only a validated result may move a
    // match to COMPLETED, so the bare transition is rejected.
    await expect(matches.transitionStatus(matchId, { status: 'COMPLETED' })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects starting a cancelled match', async () => {
    const categoryId = await singlesCategory();
    const stageId = await seedStage(repos.client, categoryId);
    const matchId = await seedMatch(repos.client, stageId);
    await matches.transitionStatus(matchId, { status: 'CANCELLED' });
    await expect(
      matches.transitionStatus(matchId, { status: 'IN_PROGRESS' }),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });
});
