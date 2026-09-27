import {
  BusinessRuleViolationError,
  ConflictError,
  ENTRY_TRANSITIONS,
  InvalidStateTransitionError,
  isAllowedTransition,
  NotFoundError,
  ValidationError,
  type EntryStatus,
  type TournamentEntry,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { RegisterEntryCommand, UpdateEntryCommand } from './commands.ts';

/**
 * Tournament entry (registration) service - the keystone of the domain.
 *
 * Registration verifies, in order:
 *
 *   category exists -> category belongs to its tournament -> category is OPEN
 *   -> tournament permits registration -> competitor kind matches the category
 *   format -> no duplicate registration -> create entry
 *
 * The exactly-one-owner rule is also enforced structurally by the database; the
 * format/team-size/player-in-two-teams rules are cross-table and live here.
 */
export interface TournamentEntryService {
  register(command: RegisterEntryCommand): Promise<TournamentEntry>;
  withdraw(id: string): Promise<TournamentEntry>;
  confirm(id: string): Promise<TournamentEntry>;
  disqualify(id: string): Promise<TournamentEntry>;
  update(id: string, command: UpdateEntryCommand): Promise<TournamentEntry>;
  getById(id: string): Promise<TournamentEntry>;
  listByCategory(categoryId: string): Promise<readonly TournamentEntry[]>;
}

export function createTournamentEntryService(unitOfWork: UnitOfWork): TournamentEntryService {
  return {
    async register(command: RegisterEntryCommand): Promise<TournamentEntry> {
      const competitor = resolveCompetitor(command);

      if (command.seed !== undefined && command.seed <= 0) {
        throw new ValidationError('Seed must be a positive number.', 'seed');
      }

      return unitOfWork.runInTransaction(async (client) => {
        const category = await client.categories.findById(command.categoryId);
        if (!category) {
          throw new NotFoundError('Category', command.categoryId);
        }

        const tournament = await client.tournaments.findById(category.tournamentId);
        if (!tournament) {
          throw new NotFoundError('Tournament', category.tournamentId);
        }

        if (category.status !== 'OPEN') {
          throw new BusinessRuleViolationError(
            `Category is not open for registration (current status ${category.status}).`,
          );
        }

        if (tournament.status !== 'REGISTRATION_OPEN') {
          throw new BusinessRuleViolationError(
            `Tournament is not accepting registrations (current status ${tournament.status}).`,
          );
        }

        const entry =
          competitor.kind === 'player'
            ? await buildSinglesEntry(client, command, competitor.playerId, category.format)
            : await buildDoublesEntry(client, command, competitor.teamId, category.format);

        return client.entries.create(entry);
      });
    },

    async withdraw(id: string): Promise<TournamentEntry> {
      return transitionEntry(unitOfWork, id, 'WITHDRAWN');
    },

    async confirm(id: string): Promise<TournamentEntry> {
      return transitionEntry(unitOfWork, id, 'CONFIRMED');
    },

    async disqualify(id: string): Promise<TournamentEntry> {
      return transitionEntry(unitOfWork, id, 'DISQUALIFIED');
    },

    async update(id: string, command: UpdateEntryCommand): Promise<TournamentEntry> {
      return unitOfWork.runInTransaction(async (client) => {
        const current = await requireEntry(client, id);

        if (current.status === 'WITHDRAWN' || current.status === 'DISQUALIFIED') {
          throw new BusinessRuleViolationError(
            `A ${current.status.toLowerCase()} entry cannot be edited.`,
          );
        }

        if (command.seed === undefined) {
          return current;
        }

        if (command.seed !== null && command.seed <= 0) {
          throw new ValidationError('Seed must be a positive number.', 'seed');
        }

        return client.entries.updateSeed(id, command.seed);
      });
    },

    async getById(id: string): Promise<TournamentEntry> {
      return unitOfWork.runInTransaction(async (client) => requireEntry(client, id));
    },

    async listByCategory(categoryId: string): Promise<readonly TournamentEntry[]> {
      return unitOfWork.runInTransaction(async (client) =>
        client.entries.listByCategory(categoryId),
      );
    },
  };
}

interface EntryCreate {
  readonly categoryId: string;
  readonly playerId: string | null;
  readonly teamId: string | null;
  readonly seed: number | null;
  readonly status: EntryStatus;
}

type Competitor =
  | { readonly kind: 'player'; readonly playerId: string }
  | { readonly kind: 'team'; readonly teamId: string };

/**
 * Resolves exactly one competitor from the command, rejecting neither/both.
 * Returning a discriminated union lets the builders receive a definite id
 * without a type assertion.
 */
function resolveCompetitor(command: RegisterEntryCommand): Competitor {
  const playerId = command.playerId ?? null;
  const teamId = command.teamId ?? null;

  if ((playerId === null) === (teamId === null)) {
    throw new ValidationError(
      'An entry must reference exactly one competitor: a player or a team.',
      playerId === null ? 'playerId' : 'teamId',
    );
  }

  if (playerId !== null) {
    return { kind: 'player', playerId };
  }
  if (teamId !== null) {
    return { kind: 'team', teamId };
  }
  // Unreachable: the guard above guarantees exactly one non-null owner.
  throw new ValidationError(
    'An entry must reference exactly one competitor: a player or a team.',
    'playerId',
  );
}

/** Builds a singles entry, rejecting a mismatch with the category format. */
async function buildSinglesEntry(
  client: RepositoryClient,
  command: RegisterEntryCommand,
  playerId: string,
  format: 'SINGLES' | 'DOUBLES',
): Promise<EntryCreate> {
  if (format !== 'SINGLES') {
    throw new BusinessRuleViolationError(
      'A team must be supplied for a doubles category, not a player.',
    );
  }

  const player = await client.players.findById(playerId);
  if (!player) {
    throw new NotFoundError('Player', playerId);
  }

  const duplicate = await client.entries.findByCategoryAndPlayer(command.categoryId, playerId);
  if (duplicate) {
    throw new ConflictError('This player is already registered in this category.');
  }

  return {
    categoryId: command.categoryId,
    playerId,
    teamId: null,
    seed: command.seed ?? null,
    status: 'PENDING',
  };
}

/** Builds a doubles entry, validating the team and the format-specific rules. */
async function buildDoublesEntry(
  client: RepositoryClient,
  command: RegisterEntryCommand,
  teamId: string,
  format: 'SINGLES' | 'DOUBLES',
): Promise<EntryCreate> {
  if (format !== 'DOUBLES') {
    throw new BusinessRuleViolationError(
      'A player must be supplied for a singles category, not a team.',
    );
  }

  const team = await client.teams.findById(teamId);
  if (!team) {
    throw new NotFoundError('Team', teamId);
  }

  const members = await client.teamMembers.listByTeam(teamId);
  if (members.length !== 2) {
    throw new BusinessRuleViolationError('A doubles team must contain exactly two members.');
  }

  const duplicate = await client.entries.findByCategoryAndTeam(command.categoryId, teamId);
  if (duplicate) {
    throw new ConflictError('This team is already registered in this category.');
  }

  // Invariant 17: a player may not appear in more than one active team in the
  // same category.
  for (const member of members) {
    const competing = await client.entries.findCompetingTeamEntry(
      command.categoryId,
      member.playerId,
      teamId,
    );
    if (competing) {
      throw new ConflictError(
        'One of the team members is already registered in another team in this category.',
      );
    }
  }

  return {
    categoryId: command.categoryId,
    playerId: null,
    teamId,
    seed: command.seed ?? null,
    status: 'PENDING',
  };
}

async function transitionEntry(
  unitOfWork: UnitOfWork,
  id: string,
  to: EntryStatus,
): Promise<TournamentEntry> {
  return unitOfWork.runInTransaction(async (client) => {
    const current = await requireEntry(client, id);
    const from: EntryStatus = current.status;

    if (!isAllowedTransition(ENTRY_TRANSITIONS, from, to)) {
      throw new InvalidStateTransitionError('Entry', from, to);
    }

    return client.entries.updateStatus(id, to);
  });
}

async function requireEntry(client: RepositoryClient, id: string): Promise<TournamentEntry> {
  const entry = await client.entries.findById(id);
  if (!entry) {
    throw new NotFoundError('Entry', id);
  }
  return entry;
}
