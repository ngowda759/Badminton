import {
  BusinessRuleViolationError,
  ConflictError,
  NotFoundError,
  normalizeWhitespace,
  ValidationError,
  type Team,
  type TeamMember,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { AddTeamMemberCommand, CreateTeamCommand } from './commands.ts';

/**
 * Team service.
 *
 * Teams are globally reusable rosters: they carry no tournament or category id.
 * Membership is mutable, but a player may appear at most once in a team. The
 * format-specific "a doubles team has exactly two members" rule is applied by
 * the registration service when the team is entered into a doubles category -
 * see `TournamentEntryService`.
 */
export interface TeamService {
  create(command: CreateTeamCommand): Promise<Team>;
  update(id: string, command: { name: string }): Promise<Team>;
  getById(id: string): Promise<Team>;
  listMembers(teamId: string): Promise<readonly TeamMember[]>;
  addMember(teamId: string, command: AddTeamMemberCommand): Promise<TeamMember>;
  removeMember(teamId: string, playerId: string): Promise<void>;
}

export function createTeamService(client: RepositoryClient, unitOfWork: UnitOfWork): TeamService {
  return {
    async create(command: CreateTeamCommand): Promise<Team> {
      const name = requireName(command.name);
      const playerIds = command.memberPlayerIds ?? [];

      if (new Set(playerIds).size !== playerIds.length) {
        throw new ValidationError(
          'A team cannot contain the same player twice.',
          'memberPlayerIds',
        );
      }

      // The team row and its member rows must commit together: if any member
      // insert fails the team must not remain partially created.
      return unitOfWork.runInTransaction(async (tx) => {
        for (const playerId of playerIds) {
          const player = await tx.players.findById(playerId);
          if (!player) {
            throw new NotFoundError('Player', playerId);
          }
        }

        const team = await tx.teams.create({ name });
        for (const [index, playerId] of playerIds.entries()) {
          await tx.teamMembers.create({ teamId: team.id, playerId, position: index + 1 });
        }
        return team;
      });
    },

    async update(id: string, command: { name: string }): Promise<Team> {
      const name = requireName(command.name);
      await requireTeam(client, id);
      return client.teams.update(id, { name });
    },

    async getById(id: string): Promise<Team> {
      return requireTeam(client, id);
    },

    async listMembers(teamId: string): Promise<readonly TeamMember[]> {
      await requireTeam(client, teamId);
      return client.teamMembers.listByTeam(teamId);
    },

    async addMember(teamId: string, command: AddTeamMemberCommand): Promise<TeamMember> {
      // Read (members) then write (insert): the read and write are kept in one
      // transaction so a concurrent membership change cannot leave the derived
      // position inconsistent.
      return unitOfWork.runInTransaction(async (tx) => {
        await requireTeam(tx, teamId);

        const player = await tx.players.findById(command.playerId);
        if (!player) {
          throw new NotFoundError('Player', command.playerId);
        }

        const existing = await tx.teamMembers.findMembership(teamId, command.playerId);
        if (existing) {
          throw new ConflictError('This player is already a member of the team.');
        }

        const members = await tx.teamMembers.listByTeam(teamId);
        const position = command.position ?? nextPosition(members);

        if (members.some((member) => member.position === position)) {
          throw new ConflictError('Another team member already occupies this position.');
        }

        return tx.teamMembers.create({ teamId, playerId: command.playerId, position });
      });
    },

    async removeMember(teamId: string, playerId: string): Promise<void> {
      await unitOfWork.runInTransaction(async (tx) => {
        await requireTeam(tx, teamId);

        const existing = await tx.teamMembers.findMembership(teamId, playerId);
        if (!existing) {
          throw new NotFoundError('Team member', playerId);
        }

        await tx.teamMembers.remove(teamId, playerId);
      });
    },
  };
}

/** Next free 1-based position, or 1 when the team is empty. */
export function nextPosition(members: readonly TeamMember[]): number {
  return members.reduce((max, member) => Math.max(max, member.position), 0) + 1;
}

/**
 * Enforces invariant 18 for a rostered team at the point it is used: a team
 * used in a doubles entry must contain exactly two members. Kept here so both
 * the team and registration services share one implementation.
 */
export function assertDoublesTeamComplete(members: readonly TeamMember[]): void {
  if (members.length !== 2) {
    throw new BusinessRuleViolationError('A doubles team must contain exactly two members.');
  }
}

async function requireTeam(client: RepositoryClient, id: string): Promise<Team> {
  const team = await client.teams.findById(id);
  if (!team) {
    throw new NotFoundError('Team', id);
  }
  return team;
}

function requireName(value: string): string {
  const name = normalizeWhitespace(value);
  if (name.length === 0) {
    throw new ValidationError('Team name must not be empty.', 'name');
  }
  return name;
}
