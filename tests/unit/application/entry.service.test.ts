import { createRealtimeEventService, createTournamentEntryService } from '@badminton/application';
import {
  BusinessRuleViolationError,
  ConflictError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from '@badminton/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { createFakeRepositories, type FakeRepositories } from './fake-repositories.ts';
import { seedCategory, seedPlayer, seedTeamWithMembers, seedTournament } from './fixtures.ts';

/**
 * Tournament entry service unit tests.
 *
 * The registration matrix is the heart of Phase 2.2: exactly one competitor,
 * format compatibility, team size, duplicate registration and the
 * player-in-two-teams invariant, plus the entry lifecycle.
 */

let repos: FakeRepositories;
let service: ReturnType<typeof createTournamentEntryService>;

beforeEach(() => {
  repos = createFakeRepositories();
  service = createTournamentEntryService(
    repos.client,
    repos.unitOfWork,
    createRealtimeEventService(),
  );
});

async function openSingles(): Promise<string> {
  const tournamentId = await seedTournament(repos.client, { status: 'REGISTRATION_OPEN' });
  return seedCategory(repos.client, {
    tournamentId,
    format: 'SINGLES',
    status: 'OPEN',
  });
}

async function openDoubles(): Promise<string> {
  const tournamentId = await seedTournament(repos.client, {
    name: 'Doubles Open',
    status: 'REGISTRATION_OPEN',
  });
  return seedCategory(repos.client, {
    tournamentId,
    name: "Men's Doubles",
    code: 'MD',
    format: 'DOUBLES',
    status: 'OPEN',
  });
}

describe('TournamentEntryService.register - competitor shape', () => {
  it('rejects neither competitor', async () => {
    const categoryId = await openSingles();
    await expect(service.register({ categoryId })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects both competitors', async () => {
    const categoryId = await openSingles();
    const playerId = await seedPlayer(repos.client);
    const { teamId } = await seedTeamWithMembers(repos.client, {});
    await expect(service.register({ categoryId, playerId, teamId })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('TournamentEntryService.register - format compatibility', () => {
  it('registers a player into a singles category', async () => {
    const categoryId = await openSingles();
    const playerId = await seedPlayer(repos.client);
    const entry = await service.register({ categoryId, playerId });
    expect(entry.playerId).toBe(playerId);
    expect(entry.teamId).toBeNull();
    expect(entry.status).toBe('PENDING');
  });

  it('rejects a team into a singles category', async () => {
    const categoryId = await openSingles();
    const { teamId } = await seedTeamWithMembers(repos.client, {});
    await expect(service.register({ categoryId, teamId })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects a player into a doubles category', async () => {
    const categoryId = await openDoubles();
    const playerId = await seedPlayer(repos.client);
    await expect(service.register({ categoryId, playerId })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('registers a complete team into a doubles category', async () => {
    const categoryId = await openDoubles();
    const { teamId } = await seedTeamWithMembers(repos.client, { memberCount: 2 });
    const entry = await service.register({ categoryId, teamId });
    expect(entry.teamId).toBe(teamId);
    expect(entry.playerId).toBeNull();
  });

  it('rejects a one-member team into a doubles category', async () => {
    const categoryId = await openDoubles();
    const { teamId } = await seedTeamWithMembers(repos.client, { memberCount: 1 });
    await expect(service.register({ categoryId, teamId })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects a three-member team into a doubles category', async () => {
    const categoryId = await openDoubles();
    const { teamId } = await seedTeamWithMembers(repos.client, { memberCount: 3 });
    await expect(service.register({ categoryId, teamId })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });
});

describe('TournamentEntryService.register - lifecycle gating', () => {
  it('rejects registration when the category is not OPEN', async () => {
    const tournamentId = await seedTournament(repos.client, { status: 'REGISTRATION_OPEN' });
    const categoryId = await seedCategory(repos.client, {
      tournamentId,
      status: 'DRAFT',
    });
    const playerId = await seedPlayer(repos.client);
    await expect(service.register({ categoryId, playerId })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects registration when the tournament is not REGISTRATION_OPEN', async () => {
    const tournamentId = await seedTournament(repos.client, { status: 'DRAFT' });
    const categoryId = await seedCategory(repos.client, { tournamentId, status: 'OPEN' });
    const playerId = await seedPlayer(repos.client);
    await expect(service.register({ categoryId, playerId })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });

  it('rejects a missing category', async () => {
    const playerId = await seedPlayer(repos.client);
    await expect(service.register({ categoryId: 'missing', playerId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('TournamentEntryService.register - duplicates and seeds', () => {
  it('rejects a duplicate singles registration', async () => {
    const categoryId = await openSingles();
    const playerId = await seedPlayer(repos.client);
    await service.register({ categoryId, playerId });
    await expect(service.register({ categoryId, playerId })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a duplicate doubles registration', async () => {
    const categoryId = await openDoubles();
    const { teamId } = await seedTeamWithMembers(repos.client, {});
    await service.register({ categoryId, teamId });
    await expect(service.register({ categoryId, teamId })).rejects.toBeInstanceOf(ConflictError);
  });

  it('accepts a positive seed', async () => {
    const categoryId = await openSingles();
    const playerId = await seedPlayer(repos.client);
    const entry = await service.register({ categoryId, playerId, seed: 1 });
    expect(entry.seed).toBe(1);
  });

  it('rejects a non-positive seed', async () => {
    const categoryId = await openSingles();
    const playerId = await seedPlayer(repos.client);
    await expect(service.register({ categoryId, playerId, seed: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('TournamentEntryService.register - player in two teams per category', () => {
  it('rejects a player appearing in a second team of the same category', async () => {
    const categoryId = await openDoubles();
    const shared = await seedPlayer(repos.client, 'Shared');
    const partnerOne = await seedPlayer(repos.client, 'Partner One');
    const partnerTwo = await seedPlayer(repos.client, 'Partner Two');

    const teamOne = await repos.client.teams.create({ name: 'Team One' });
    await repos.client.teamMembers.create({ teamId: teamOne.id, playerId: shared, position: 1 });
    await repos.client.teamMembers.create({
      teamId: teamOne.id,
      playerId: partnerOne,
      position: 2,
    });

    const teamTwo = await repos.client.teams.create({ name: 'Team Two' });
    await repos.client.teamMembers.create({ teamId: teamTwo.id, playerId: shared, position: 1 });
    await repos.client.teamMembers.create({
      teamId: teamTwo.id,
      playerId: partnerTwo,
      position: 2,
    });

    await service.register({ categoryId, teamId: teamOne.id });
    await expect(service.register({ categoryId, teamId: teamTwo.id })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('allows the same player in teams of different categories', async () => {
    const firstCategory = await openDoubles();
    const first = await repos.client.categories.findById(firstCategory);
    if (!first) {
      throw new Error('Expected the seeded category to exist.');
    }
    const secondCategory = await seedCategory(repos.client, {
      tournamentId: first.tournamentId,
      name: 'Mixed Doubles',
      code: 'XD',
      format: 'DOUBLES',
      status: 'OPEN',
    });

    const shared = await seedPlayer(repos.client, 'Shared');
    const partnerOne = await seedPlayer(repos.client, 'Partner One');
    const partnerTwo = await seedPlayer(repos.client, 'Partner Two');

    const teamOne = await repos.client.teams.create({ name: 'Team One' });
    await repos.client.teamMembers.create({ teamId: teamOne.id, playerId: shared, position: 1 });
    await repos.client.teamMembers.create({
      teamId: teamOne.id,
      playerId: partnerOne,
      position: 2,
    });

    const teamTwo = await repos.client.teams.create({ name: 'Team Two' });
    await repos.client.teamMembers.create({ teamId: teamTwo.id, playerId: shared, position: 1 });
    await repos.client.teamMembers.create({
      teamId: teamTwo.id,
      playerId: partnerTwo,
      position: 2,
    });

    await service.register({ categoryId: firstCategory, teamId: teamOne.id });
    const second = await service.register({ categoryId: secondCategory, teamId: teamTwo.id });
    expect(second.teamId).toBe(teamTwo.id);
  });
});

describe('TournamentEntryService lifecycle', () => {
  async function registeredEntry(): Promise<string> {
    const categoryId = await openSingles();
    const playerId = await seedPlayer(repos.client);
    const entry = await service.register({ categoryId, playerId });
    return entry.id;
  }

  it('confirms a pending entry', async () => {
    const entry = await service.confirm(await registeredEntry());
    expect(entry.status).toBe('CONFIRMED');
  });

  it('withdraws a pending entry', async () => {
    const entry = await service.withdraw(await registeredEntry());
    expect(entry.status).toBe('WITHDRAWN');
  });

  it('disqualifies a confirmed entry', async () => {
    const id = await registeredEntry();
    await service.confirm(id);
    const entry = await service.disqualify(id);
    expect(entry.status).toBe('DISQUALIFIED');
  });

  it('rejects a transition out of a terminal state', async () => {
    const id = await registeredEntry();
    await service.withdraw(id);
    await expect(service.confirm(id)).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('sets and clears the seed while pending', async () => {
    const id = await registeredEntry();
    expect((await service.update(id, { seed: 3 })).seed).toBe(3);
    expect((await service.update(id, { seed: null })).seed).toBeNull();
  });

  it('refuses to edit a withdrawn entry', async () => {
    const id = await registeredEntry();
    await service.withdraw(id);
    await expect(service.update(id, { seed: 1 })).rejects.toBeInstanceOf(
      BusinessRuleViolationError,
    );
  });
});
