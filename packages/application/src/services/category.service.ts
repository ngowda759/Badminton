import {
  BusinessRuleViolationError,
  CATEGORY_TRANSITIONS,
  InvalidStateTransitionError,
  isAllowedTransition,
  isValidCategoryCode,
  normalizeCategoryCode,
  normalizeWhitespace,
  NotFoundError,
  ValidationError,
  type CategoryStatus,
  type TournamentCategory,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type {
  CreateCategoryCommand,
  TransitionCategoryStatusCommand,
  UpdateCategoryCommand,
} from './commands.ts';

/**
 * Tournament category service.
 *
 * Owns category creation within a tournament, the code normalization mandate
 * and the rules that freeze `format` once entries exist. A category is always
 * created in `DRAFT`; opening it for registration is an explicit transition.
 */
export interface TournamentCategoryService {
  create(tournamentId: string, command: CreateCategoryCommand): Promise<TournamentCategory>;
  update(id: string, command: UpdateCategoryCommand): Promise<TournamentCategory>;
  transitionStatus(
    id: string,
    command: TransitionCategoryStatusCommand,
  ): Promise<TournamentCategory>;
  getById(id: string): Promise<TournamentCategory>;
  listByTournament(tournamentId: string): Promise<readonly TournamentCategory[]>;
}

export function createTournamentCategoryService(unitOfWork: UnitOfWork): TournamentCategoryService {
  return {
    async create(
      tournamentId: string,
      command: CreateCategoryCommand,
    ): Promise<TournamentCategory> {
      const name = requireName(command.name, 'Category name');
      const code = normalizeCategoryCode(command.code);

      if (!isValidCategoryCode(code)) {
        throw new ValidationError(
          'Category code must be 1-8 characters of A-Z, 0-9 or hyphen.',
          'code',
        );
      }

      return unitOfWork.runInTransaction(async (client) => {
        const tournament = await client.tournaments.findById(tournamentId);
        if (!tournament) {
          throw new NotFoundError('Tournament', tournamentId);
        }

        return client.categories.create({
          tournamentId,
          name,
          code,
          format: command.format,
          gender: command.gender ?? null,
          status: 'DRAFT',
        });
      });
    },

    async update(id: string, command: UpdateCategoryCommand): Promise<TournamentCategory> {
      return unitOfWork.runInTransaction(async (client) => {
        const current = await requireCategory(client, id);
        assertCategoryEditable(current.status);

        const data: {
          name?: string;
          format?: 'SINGLES' | 'DOUBLES';
          gender?: 'MALE' | 'FEMALE' | 'MIXED' | 'OPEN' | null;
        } = {};

        if (command.name !== undefined) {
          data.name = requireName(command.name, 'Category name');
        }

        if (command.format !== undefined && command.format !== current.format) {
          // Changing format once entries exist would invalidate the entry owners
          // (singles entries reference players, doubles entries reference teams).
          const entries = await client.categories.countEntries(id);
          if (entries > 0) {
            throw new BusinessRuleViolationError(
              'Category format cannot be changed once entries exist.',
            );
          }
          data.format = command.format;
        }

        if (command.gender !== undefined) {
          data.gender = command.gender;
        }

        return client.categories.update(id, data);
      });
    },

    async transitionStatus(
      id: string,
      command: TransitionCategoryStatusCommand,
    ): Promise<TournamentCategory> {
      return unitOfWork.runInTransaction(async (client) => {
        const current = await requireCategory(client, id);
        const from: CategoryStatus = current.status;
        const to = command.status;

        if (!isAllowedTransition(CATEGORY_TRANSITIONS, from, to)) {
          throw new InvalidStateTransitionError('Category', from, to);
        }

        return client.categories.updateStatus(id, to);
      });
    },

    async getById(id: string): Promise<TournamentCategory> {
      return unitOfWork.runInTransaction(async (client) => requireCategory(client, id));
    },

    async listByTournament(tournamentId: string): Promise<readonly TournamentCategory[]> {
      return unitOfWork.runInTransaction(async (client) => {
        const tournament = await client.tournaments.findById(tournamentId);
        if (!tournament) {
          throw new NotFoundError('Tournament', tournamentId);
        }
        return client.categories.listByTournament(tournamentId);
      });
    },
  };
}

async function requireCategory(client: RepositoryClient, id: string): Promise<TournamentCategory> {
  const category = await client.categories.findById(id);
  if (!category) {
    throw new NotFoundError('Category', id);
  }
  return category;
}

function requireName(value: string, label: string): string {
  const name = normalizeWhitespace(value);
  if (name.length === 0) {
    throw new ValidationError(`${label} must not be empty.`, 'name');
  }
  return name;
}

function assertCategoryEditable(status: CategoryStatus): void {
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    throw new BusinessRuleViolationError(`A ${status.toLowerCase()} category cannot be edited.`);
  }
}
