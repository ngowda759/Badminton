import {
  BusinessRuleViolationError,
  InvalidStateTransitionError,
  isAllowedTransition,
  isDateRangeValid,
  isValidIanaTimezone,
  NotFoundError,
  normalizeWhitespace,
  TOURNAMENT_TRANSITIONS,
  ValidationError,
  type Tournament,
  type TournamentStatus,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type {
  CreateTournamentCommand,
  TransitionTournamentStatusCommand,
  UpdateTournamentCommand,
} from './commands.ts';

/**
 * Tournament aggregate service.
 *
 * Owns tournament creation, guarded edits and the lifecycle state machine. All
 * persistence goes through the `TournamentRepository` port; the service never
 * imports Prisma.
 */
export interface TournamentService {
  create(command: CreateTournamentCommand): Promise<Tournament>;
  update(id: string, command: UpdateTournamentCommand): Promise<Tournament>;
  transitionStatus(id: string, command: TransitionTournamentStatusCommand): Promise<Tournament>;
  getById(id: string): Promise<Tournament>;
}

export function createTournamentService(unitOfWork: UnitOfWork): TournamentService {
  return {
    async create(command: CreateTournamentCommand): Promise<Tournament> {
      const name = requireName(command.name);

      if (!isValidIanaTimezone(command.timezone)) {
        throw new ValidationError(
          'Timezone must be a valid IANA timezone name (for example Asia/Kolkata).',
          'timezone',
        );
      }

      assertDateRange(command.startDate, command.endDate);

      // New tournaments always start as DRAFT. Registration is opened by an
      // explicit lifecycle transition, never at creation.
      return unitOfWork.runInTransaction(async (client) => {
        return client.tournaments.create({
          name,
          description: normalizeOptionalText(command.description),
          startDate: command.startDate,
          endDate: command.endDate,
          location: normalizeOptionalText(command.location),
          timezone: command.timezone.trim(),
          status: 'DRAFT',
        });
      });
    },

    async update(id: string, command: UpdateTournamentCommand): Promise<Tournament> {
      return unitOfWork.runInTransaction(async (client) => {
        const current = await requireTournament(client, id);
        assertEditable(current);

        const startDate = command.startDate ?? current.startDate;
        const endDate = command.endDate ?? current.endDate;
        assertDateRange(startDate, endDate);

        const data: {
          name?: string;
          description?: string | null;
          startDate?: Date;
          endDate?: Date;
          location?: string | null;
        } = {};

        if (command.name !== undefined) {
          data.name = requireName(command.name);
        }
        if (command.description !== undefined) {
          data.description = normalizeOptionalText(command.description);
        }
        if (command.startDate !== undefined) {
          data.startDate = command.startDate;
        }
        if (command.endDate !== undefined) {
          data.endDate = command.endDate;
        }
        if (command.location !== undefined) {
          data.location = normalizeOptionalText(command.location);
        }

        return client.tournaments.update(id, data);
      });
    },

    async transitionStatus(
      id: string,
      command: TransitionTournamentStatusCommand,
    ): Promise<Tournament> {
      return unitOfWork.runInTransaction(async (client) => {
        const current = await requireTournament(client, id);
        const from: TournamentStatus = current.status;
        const to = command.status;

        if (!isAllowedTransition(TOURNAMENT_TRANSITIONS, from, to)) {
          throw new InvalidStateTransitionError('Tournament', from, to);
        }

        return client.tournaments.updateStatus(id, to);
      });
    },

    async getById(id: string): Promise<Tournament> {
      return unitOfWork.runInTransaction(async (client) => requireTournament(client, id));
    },
  };
}

async function requireTournament(client: RepositoryClient, id: string): Promise<Tournament> {
  const tournament = await client.tournaments.findById(id);
  if (!tournament) {
    throw new NotFoundError('Tournament', id);
  }
  return tournament;
}

function requireName(value: string): string {
  const name = normalizeWhitespace(value);
  if (name.length === 0) {
    throw new ValidationError('Tournament name must not be empty.', 'name');
  }
  return name;
}

function assertDateRange(startDate: Date, endDate: Date): void {
  if (!isDateRangeValid(startDate, endDate)) {
    throw new ValidationError('endDate must be on or after startDate.', 'endDate');
  }
}

/** Terminal tournaments are read-only. */
function assertEditable(current: Tournament): void {
  if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
    throw new BusinessRuleViolationError(
      `A ${current.status.toLowerCase()} tournament cannot be edited.`,
    );
  }
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
