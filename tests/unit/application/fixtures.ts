import type { RepositoryClient } from '@badminton/application';

/**
 * Fixture helpers for the application-service unit tests.
 *
 * They write through the fake repository client using the same data shapes the
 * services use, so tests describe state in domain terms.
 */

let tournamentCounter = 0;

export async function seedTournament(
  client: RepositoryClient,
  overrides: {
    name?: string;
    status?: 'DRAFT' | 'REGISTRATION_OPEN' | 'IN_PROGRESS' | 'CANCELLED';
  } = {},
): Promise<string> {
  tournamentCounter += 1;
  const tournament = await client.tournaments.create({
    name: overrides.name ?? `Test Open ${tournamentCounter}`,
    description: null,
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: new Date('2026-10-03T00:00:00.000Z'),
    location: null,
    timezone: 'Asia/Kolkata',
    status: overrides.status ?? 'REGISTRATION_OPEN',
  });
  return tournament.id;
}

export async function seedCategory(
  client: RepositoryClient,
  input: {
    tournamentId: string;
    name?: string;
    code?: string;
    format?: 'SINGLES' | 'DOUBLES';
    status?: 'DRAFT' | 'OPEN' | 'CLOSED';
  },
): Promise<string> {
  const category = await client.categories.create({
    tournamentId: input.tournamentId,
    name: input.name ?? "Men's Singles",
    code: input.code ?? 'MS',
    format: input.format ?? 'SINGLES',
    gender: 'MALE',
    status: input.status ?? 'OPEN',
  });
  return category.id;
}

export async function seedPlayer(client: RepositoryClient, name = 'Player A'): Promise<string> {
  const player = await client.players.create({ name, email: null, phone: null });
  return player.id;
}

export async function seedTeamWithMembers(
  client: RepositoryClient,
  input: { name?: string; memberCount?: number },
): Promise<{ teamId: string; playerIds: readonly string[] }> {
  const team = await client.teams.create({ name: input.name ?? 'Team AB' });
  const count = input.memberCount ?? 2;
  const playerIds: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const player = await client.players.create({
      name: `Team Player ${index + 1}`,
      email: null,
      phone: null,
    });
    playerIds.push(player.id);
    await client.teamMembers.create({
      teamId: team.id,
      playerId: player.id,
      position: index + 1,
    });
  }

  return { teamId: team.id, playerIds };
}

export async function seedStage(
  client: RepositoryClient,
  categoryId: string,
  input: { sequence?: number; status?: 'PENDING' | 'ACTIVE' } = {},
): Promise<string> {
  const stage = await client.stages.create({
    categoryId,
    name: 'Group Stage',
    type: 'GROUP',
    sequence: input.sequence ?? 1,
    drawSize: null,
    status: input.status ?? 'PENDING',
  });
  return stage.id;
}

export async function seedMatch(
  client: RepositoryClient,
  stageId: string,
  sequence = 1,
): Promise<string> {
  const match = await client.matches.create({
    stageId,
    sequence,
    roundNumber: null,
    matchNumber: null,
    status: 'SCHEDULED',
  });
  return match.id;
}

/** A KNOCKOUT stage; `drawSize` stays null until a bracket is generated. */
export async function seedKnockoutStage(
  client: RepositoryClient,
  categoryId: string,
  input: { sequence?: number; status?: 'PENDING' | 'ACTIVE' } = {},
): Promise<string> {
  const stage = await client.stages.create({
    categoryId,
    name: 'Knockout',
    type: 'KNOCKOUT',
    sequence: input.sequence ?? 1,
    drawSize: null,
    status: input.status ?? 'PENDING',
  });
  return stage.id;
}

/** A court in a tournament; defaults to court 1, ACTIVE. */
export async function seedCourt(
  client: RepositoryClient,
  tournamentId: string,
  input: { number?: number; name?: string; status?: 'ACTIVE' | 'INACTIVE' } = {},
): Promise<string> {
  const court = await client.courts.create({
    tournamentId,
    number: input.number ?? 1,
    name: input.name ?? `Court ${String(input.number ?? 1)}`,
    status: input.status ?? 'ACTIVE',
  });
  return court.id;
}
