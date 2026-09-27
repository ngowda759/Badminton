import {
  ACTIVE_ENTRY_STATUSES,
  ConflictError,
  InvalidStateTransitionError,
  isAllowedTransition,
  MATCH_SLOTS,
  MATCH_TRANSITIONS,
  NotFoundError,
  ValidationError,
  type Match,
  type MatchParticipant,
  type MatchStatus,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type {
  AddMatchParticipantCommand,
  CreateMatchCommand,
  TransitionMatchStatusCommand,
  UpdateMatchCommand,
} from './commands.ts';

/**
 * Match service.
 *
 * A match belongs to a stage and owns a unique 1-based sequence within it.
 * Participant assignment is manual in this phase: two entries, one per slot,
 * with the same category as the match's stage. No scoring, no winner/loser
 * logic, no draw generation.
 *
 * The `sequence`, `roundNumber` and `matchNumber` fields are ordinal; the last
 * two are optional because group matches have no round and numbering is only a
 * display aid.
 */
export interface MatchService {
  create(stageId: string, command: CreateMatchCommand): Promise<Match>;
  update(id: string, command: UpdateMatchCommand): Promise<Match>;
  transitionStatus(id: string, command: TransitionMatchStatusCommand): Promise<Match>;
  getById(id: string): Promise<Match>;
  listByStage(stageId: string): Promise<readonly Match[]>;
  addParticipant(matchId: string, command: AddMatchParticipantCommand): Promise<MatchParticipant>;
  listParticipants(matchId: string): Promise<readonly MatchParticipant[]>;
}

export function createMatchService(client: RepositoryClient, unitOfWork: UnitOfWork): MatchService {
  return {
    async create(stageId: string, command: CreateMatchCommand): Promise<Match> {
      assertPositive(command.sequence, 'sequence');
      assertOptionalPositive(command.roundNumber, 'roundNumber');
      assertOptionalPositive(command.matchNumber, 'matchNumber');

      // Read (stage, sequence list) then insert: kept atomic so the sequence
      // pre-check reflects the state the insert is applied to.
      return unitOfWork.runInTransaction(async (tx) => {
        const stage = await tx.stages.findById(stageId);
        if (!stage) {
          throw new NotFoundError('Stage', stageId);
        }

        const matches = await tx.matches.listByStage(stageId);
        if (matches.some((match) => match.sequence === command.sequence)) {
          throw new ConflictError('Another match already occupies this sequence.');
        }

        return tx.matches.create({
          stageId,
          sequence: command.sequence,
          roundNumber: command.roundNumber ?? null,
          matchNumber: command.matchNumber ?? null,
          status: 'SCHEDULED',
        });
      });
    },

    async update(id: string, command: UpdateMatchCommand): Promise<Match> {
      const current = await requireMatch(client, id);

      if (current.status === 'COMPLETED' || current.status === 'CANCELLED') {
        throw new ValidationError('A completed or cancelled match cannot be edited.', 'status');
      }

      const data: {
        sequence?: number;
        roundNumber?: number | null;
        matchNumber?: number | null;
      } = {};

      if (command.sequence !== undefined) {
        assertPositive(command.sequence, 'sequence');
        if (current.status === 'IN_PROGRESS') {
          throw new ValidationError('An in-progress match cannot be reordered.', 'sequence');
        }
        const matches = await client.matches.listByStage(current.stageId);
        if (matches.some((match) => match.sequence === command.sequence && match.id !== id)) {
          throw new ConflictError('Another match already occupies this sequence.');
        }
        data.sequence = command.sequence;
      }

      assertOptionalPositive(command.roundNumber, 'roundNumber');
      assertOptionalPositive(command.matchNumber, 'matchNumber');

      if (command.roundNumber !== undefined) {
        data.roundNumber = command.roundNumber;
      }
      if (command.matchNumber !== undefined) {
        data.matchNumber = command.matchNumber;
      }

      return client.matches.update(id, data);
    },

    async transitionStatus(id: string, command: TransitionMatchStatusCommand): Promise<Match> {
      const current = await requireMatch(client, id);
      const from: MatchStatus = current.status;
      const to = command.status;

      if (!isAllowedTransition(MATCH_TRANSITIONS, from, to)) {
        throw new InvalidStateTransitionError('Match', from, to);
      }

      return client.matches.updateStatus(id, to);
    },

    async getById(id: string): Promise<Match> {
      return requireMatch(client, id);
    },

    async listByStage(stageId: string): Promise<readonly Match[]> {
      return client.matches.listByStage(stageId);
    },

    async addParticipant(
      matchId: string,
      command: AddMatchParticipantCommand,
    ): Promise<MatchParticipant> {
      if (!MATCH_SLOTS.includes(command.slot)) {
        throw new ValidationError('Slot must be either 1 or 2.', 'slot');
      }

      // Participant assignment evaluates the match, entry and stage, then
      // inserts. One transaction keeps the slot/eligibility checks consistent
      // with the insert; the compound unique indexes remain authoritative.
      return unitOfWork.runInTransaction(async (tx) => {
        const match = await requireMatch(tx, matchId);

        if (match.status === 'COMPLETED' || match.status === 'CANCELLED') {
          throw new ValidationError(
            'Participants cannot be added to a completed or cancelled match.',
            'status',
          );
        }

        const entry = await tx.entries.findById(command.entryId);
        if (!entry) {
          throw new NotFoundError('Entry', command.entryId);
        }

        const stage = await tx.stages.findById(match.stageId);
        if (!stage) {
          throw new NotFoundError('Stage', match.stageId);
        }

        if (entry.categoryId !== stage.categoryId) {
          throw new ValidationError(
            'The entry belongs to a different category than the match.',
            'entryId',
          );
        }

        // Eligibility: a withdrawn or disqualified entry cannot take a slot.
        if (!ACTIVE_ENTRY_STATUSES.includes(entry.status)) {
          throw new ValidationError('This entry is not eligible to participate.', 'entryId');
        }

        const existingSlot = await tx.matchParticipants.findSlot(matchId, command.slot);
        if (existingSlot) {
          throw new ConflictError('This slot is already occupied.');
        }

        const existingEntry = await tx.matchParticipants.findEntry(matchId, command.entryId);
        if (existingEntry) {
          throw new ConflictError('This entry is already a participant in this match.');
        }

        return tx.matchParticipants.create({
          matchId,
          entryId: command.entryId,
          slot: command.slot,
        });
      });
    },

    async listParticipants(matchId: string): Promise<readonly MatchParticipant[]> {
      await requireMatch(client, matchId);
      return client.matchParticipants.listByMatch(matchId);
    },
  };
}

async function requireMatch(client: RepositoryClient, id: string): Promise<Match> {
  const match = await client.matches.findById(id);
  if (!match) {
    throw new NotFoundError('Match', id);
  }
  return match;
}

function assertPositive(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive whole number.`, field);
  }
}

function assertOptionalPositive(value: number | null | undefined, field: string): void {
  if (value === null || value === undefined) {
    return;
  }
  assertPositive(value, field);
}
