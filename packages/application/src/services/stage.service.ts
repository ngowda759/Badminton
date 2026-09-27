import {
  ConflictError,
  InvalidStateTransitionError,
  isAllowedTransition,
  NotFoundError,
  normalizeWhitespace,
  STAGE_TRANSITIONS,
  ValidationError,
  type StageStatus,
  type TournamentStage,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type {
  CreateStageCommand,
  TransitionStageStatusCommand,
  UpdateStageCommand,
} from './commands.ts';

/**
 * Tournament stage service.
 *
 * A stage always belongs to a category and owns a unique 1-based sequence
 * within it. Creating a stage does not generate matches or draws - those are
 * later phases; a missing match is a valid, expected state. Every operation here
 * is a read or a single write, so no interactive transaction is opened.
 */
export interface TournamentStageService {
  create(categoryId: string, command: CreateStageCommand): Promise<TournamentStage>;
  update(id: string, command: UpdateStageCommand): Promise<TournamentStage>;
  transitionStatus(id: string, command: TransitionStageStatusCommand): Promise<TournamentStage>;
  getById(id: string): Promise<TournamentStage>;
  listByCategory(categoryId: string): Promise<readonly TournamentStage[]>;
}

export function createTournamentStageService(client: RepositoryClient): TournamentStageService {
  return {
    async create(categoryId: string, command: CreateStageCommand): Promise<TournamentStage> {
      const name = requireName(command.name);
      assertPositive(command.sequence, 'sequence');

      if (command.drawSize !== undefined) {
        assertPositive(command.drawSize, 'drawSize');
      }

      const category = await client.categories.findById(categoryId);
      if (!category) {
        throw new NotFoundError('Category', categoryId);
      }

      const stages = await client.stages.listByCategory(categoryId);
      if (stages.some((stage) => stage.sequence === command.sequence)) {
        throw new ConflictError('Another stage already occupies this sequence.');
      }

      return client.stages.create({
        categoryId,
        name,
        type: command.type,
        sequence: command.sequence,
        drawSize: command.drawSize ?? null,
        status: 'PENDING',
      });
    },

    async update(id: string, command: UpdateStageCommand): Promise<TournamentStage> {
      const current = await requireStage(client, id);

      if (current.status === 'COMPLETED') {
        throw new ValidationError('A completed stage cannot be edited.', 'status');
      }

      const data: {
        name?: string;
        sequence?: number;
        drawSize?: number | null;
      } = {};

      if (command.sequence !== undefined) {
        assertPositive(command.sequence, 'sequence');
        if (current.status === 'ACTIVE') {
          throw new ValidationError('An active stage cannot be reordered.', 'sequence');
        }

        const stages = await client.stages.listByCategory(current.categoryId);
        if (stages.some((stage) => stage.sequence === command.sequence && stage.id !== id)) {
          throw new ConflictError('Another stage already occupies this sequence.');
        }
        data.sequence = command.sequence;
      }

      if (command.drawSize !== undefined && command.drawSize !== null) {
        assertPositive(command.drawSize, 'drawSize');
      }

      if (command.name !== undefined) {
        data.name = requireName(command.name);
      }
      if (command.drawSize !== undefined) {
        data.drawSize = command.drawSize;
      }

      return client.stages.update(id, data);
    },

    async transitionStatus(
      id: string,
      command: TransitionStageStatusCommand,
    ): Promise<TournamentStage> {
      const current = await requireStage(client, id);
      const from: StageStatus = current.status;
      const to = command.status;

      if (!isAllowedTransition(STAGE_TRANSITIONS, from, to)) {
        throw new InvalidStateTransitionError('Stage', from, to);
      }

      return client.stages.updateStatus(id, to);
    },

    async getById(id: string): Promise<TournamentStage> {
      return requireStage(client, id);
    },

    async listByCategory(categoryId: string): Promise<readonly TournamentStage[]> {
      return client.stages.listByCategory(categoryId);
    },
  };
}

async function requireStage(client: RepositoryClient, id: string): Promise<TournamentStage> {
  const stage = await client.stages.findById(id);
  if (!stage) {
    throw new NotFoundError('Stage', id);
  }
  return stage;
}

function requireName(value: string): string {
  const name = normalizeWhitespace(value);
  if (name.length === 0) {
    throw new ValidationError('Stage name must not be empty.', 'name');
  }
  return name;
}

function assertPositive(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive whole number.`, field);
  }
}
