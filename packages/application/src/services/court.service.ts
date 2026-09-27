import {
  ConflictError,
  InvalidStateTransitionError,
  isAllowedTransition,
  COURT_TRANSITIONS,
  normalizeWhitespace,
  NotFoundError,
  ValidationError,
  type Court,
  type CourtStatus,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type {
  CreateCourtCommand,
  TransitionCourtStatusCommand,
  UpdateCourtCommand,
} from './commands.ts';

/**
 * Court service.
 *
 * A court belongs to one tournament and is unique by number within it. Court
 * numbers are operator-facing and scoped per tournament, so two tournaments may
 * both have a "Court 1". The service owns the court rules; scheduling decisions
 * live in `MatchSchedulingService`.
 */
export interface CourtService {
  create(tournamentId: string, command: CreateCourtCommand): Promise<Court>;
  update(id: string, command: UpdateCourtCommand): Promise<Court>;
  transitionStatus(id: string, command: TransitionCourtStatusCommand): Promise<Court>;
  getById(id: string): Promise<Court>;
  listByTournament(tournamentId: string): Promise<readonly Court[]>;
}

export function createCourtService(client: RepositoryClient): CourtService {
  return {
    async create(tournamentId: string, command: CreateCourtCommand): Promise<Court> {
      assertPositive(command.number, 'number');
      const name = requireName(command.name, 'name');

      const tournament = await client.tournaments.findById(tournamentId);
      if (!tournament) {
        throw new NotFoundError('Tournament', tournamentId);
      }

      // Friendly pre-check; the unique index is the final authority under race.
      const courts = await client.courts.listByTournament(tournamentId);
      if (courts.some((court) => court.number === command.number)) {
        throw new ConflictError('A court with this number already exists in this tournament.');
      }

      return client.courts.create({
        tournamentId,
        number: command.number,
        name,
        status: 'ACTIVE',
      });
    },

    async update(id: string, command: UpdateCourtCommand): Promise<Court> {
      const current = await requireCourt(client, id);

      const data: { number?: number; name?: string } = {};

      if (command.number !== undefined) {
        assertPositive(command.number, 'number');
        const courts = await client.courts.listByTournament(current.tournamentId);
        if (courts.some((court) => court.number === command.number && court.id !== id)) {
          throw new ConflictError('A court with this number already exists in this tournament.');
        }
        data.number = command.number;
      }

      if (command.name !== undefined) {
        data.name = requireName(command.name, 'name');
      }

      return client.courts.update(id, data);
    },

    async transitionStatus(id: string, command: TransitionCourtStatusCommand): Promise<Court> {
      const current = await requireCourt(client, id);
      const to: CourtStatus = command.status;
      if (current.status === to) {
        return current;
      }
      if (!isAllowedTransition(COURT_TRANSITIONS, current.status, to)) {
        throw new InvalidStateTransitionError('Court', current.status, to);
      }
      return client.courts.updateStatus(id, to);
    },

    async getById(id: string): Promise<Court> {
      return requireCourt(client, id);
    },

    async listByTournament(tournamentId: string): Promise<readonly Court[]> {
      const tournament = await client.tournaments.findById(tournamentId);
      if (!tournament) {
        throw new NotFoundError('Tournament', tournamentId);
      }
      return client.courts.listByTournament(tournamentId);
    },
  };
}

async function requireCourt(client: RepositoryClient, id: string): Promise<Court> {
  const court = await client.courts.findById(id);
  if (!court) {
    throw new NotFoundError('Court', id);
  }
  return court;
}

function requireName(value: string, field: string): string {
  const name = normalizeWhitespace(value);
  if (name.length === 0) {
    throw new ValidationError('Court name must not be empty.', field);
  }
  return name;
}

function assertPositive(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive whole number.`, field);
  }
}
