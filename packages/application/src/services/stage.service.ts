import {
  BusinessRuleViolationError,
  ConflictError,
  InvalidStateTransitionError,
  isAllowedTransition,
  isBracketFinalMatch,
  isSupportedBracketSize,
  normalizeKnockoutRules,
  NotFoundError,
  normalizeWhitespace,
  STAGE_TRANSITIONS,
  ValidationError,
  validateKnockoutRule,
  type Match,
  type MatchScoringRule,
  type StageStatus,
  type StageType,
  type TournamentStage,
} from '@badminton/domain';

import { REALTIME_AGGREGATES, REALTIME_EVENTS } from '../realtime/event-types.ts';
import type { RealtimeEventService } from '../realtime/event.service.ts';
import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type {
  CreateStageCommand,
  TransitionStageStatusCommand,
  UpdateStageCommand,
} from './commands.ts';
import { resolveStageTournamentId } from './resolve-tournament.ts';

/**
 * Tournament stage service.
 *
 * A stage always belongs to a category and owns a unique 1-based sequence
 * within it. Creating a stage does not generate matches or draws - those are
 * later phases; a missing match is a valid, expected state.
 *
 * A lifecycle transition is a stage-level state change the dashboard surfaces,
 * so it writes its `STAGE_STATUS_CHANGED` outbox event in the same transaction.
 * Creation and field edits stay plain single writes.
 */
export interface TournamentStageService {
  create(categoryId: string, command: CreateStageCommand): Promise<TournamentStage>;
  update(id: string, command: UpdateStageCommand): Promise<TournamentStage>;
  transitionStatus(id: string, command: TransitionStageStatusCommand): Promise<TournamentStage>;
  getById(id: string): Promise<TournamentStage>;
  listByCategory(categoryId: string): Promise<readonly TournamentStage[]>;
}

export function createTournamentStageService(
  client: RepositoryClient,
  unitOfWork: UnitOfWork,
  events: RealtimeEventService,
): TournamentStageService {
  return {
    async create(categoryId: string, command: CreateStageCommand): Promise<TournamentStage> {
      const name = requireName(command.name);
      assertPositive(command.sequence, 'sequence');

      if (command.drawSize !== undefined) {
        assertPositive(command.drawSize, 'drawSize');
      }
      if (command.qualifiersPerGroup !== undefined) {
        assertPositive(command.qualifiersPerGroup, 'qualifiersPerGroup');
      }
      const knockoutRules = resolveCreateKnockoutRules(command.type, command.knockoutRules);

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
        qualifiersPerGroup: command.qualifiersPerGroup ?? null,
        knockoutRules,
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
        qualifiersPerGroup?: number | null;
        knockoutRules?: Readonly<Record<string, MatchScoringRule>> | null;
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
      if (command.qualifiersPerGroup !== undefined && command.qualifiersPerGroup !== null) {
        assertPositive(command.qualifiersPerGroup, 'qualifiersPerGroup');
      }

      if (command.drawSize !== undefined) {
        await assertDrawSizeMutable(client, current, command.drawSize);
      }

      if (command.knockoutRules !== undefined) {
        await assertKnockoutRulesMutable(client, current);
        data.knockoutRules = resolveUpdateKnockoutRules(current.type, command.knockoutRules);
      }

      if (command.name !== undefined) {
        data.name = requireName(command.name);
      }
      if (command.drawSize !== undefined) {
        data.drawSize = command.drawSize;
      }
      if (command.qualifiersPerGroup !== undefined) {
        data.qualifiersPerGroup = command.qualifiersPerGroup;
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

      // A KNOCKOUT stage is complete only once its final match is decided. The
      // bracket structure lives in the existing matches table, so completion is
      // derived from the final rather than from any stored flag. GROUP stages
      // keep their Phase 5 lifecycle unchanged.
      if (to === 'COMPLETED' && current.type === 'KNOCKOUT') {
        await assertKnockoutFinalDecided(client, current);
      }

      return unitOfWork.runInTransaction(async (tx) => {
        const tournamentId = await resolveStageTournamentId(tx, id);
        const updated = await tx.stages.updateStatus(id, to);

        await events.record(tx, {
          tournamentId,
          eventType: REALTIME_EVENTS.STAGE_STATUS_CHANGED,
          aggregateType: REALTIME_AGGREGATES.STAGE,
          aggregateId: id,
        });

        return updated;
      });
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

/**
 * Guards `ACTIVE → COMPLETED` for a KNOCKOUT stage.
 *
 * The stage is complete only when the bracket's final match is `COMPLETED`.
 * Completion is derived from the existing matches (round number, match number)
 * rather than from a stored flag, so this cannot drift from the bracket. A
 * stage with no generated bracket, or whose final is unresolved, is rejected
 * with a business-rule error.
 */
async function assertKnockoutFinalDecided(
  client: RepositoryClient,
  stage: TournamentStage,
): Promise<void> {
  const matches = await client.matches.listByStage(stage.id);
  const final = findFinalMatch(matches, stage.drawSize);

  if (!final) {
    throw new BusinessRuleViolationError(
      'A knockout stage cannot be completed before its final match is decided.',
    );
  }
  if (final.status !== 'COMPLETED') {
    throw new BusinessRuleViolationError(
      'A knockout stage cannot be completed until its final match is completed.',
    );
  }
}

/** The bracket final match, or `undefined` when there is no (supported) bracket. */
function findFinalMatch(matches: readonly Match[], drawSize: number | null): Match | undefined {
  if (drawSize === null || !isSupportedBracketSize(drawSize)) {
    return undefined;
  }
  return matches.find(
    (match) =>
      match.roundNumber !== null &&
      match.matchNumber !== null &&
      isBracketFinalMatch(drawSize, match.roundNumber, match.matchNumber),
  );
}

/**
 * Keeps the authoritative bracket size immutable once a bracket exists.
 *
 * A generated bracket is detected from the stage's existing matches - there is
 * deliberately no "generated" flag or extra table. Before generation `drawSize`
 * may be configured as before; afterwards any *change* is rejected. Re-sending
 * the current value (including `null` when there is no bracket) is a harmless
 * no-op so an edit form that round-trips the field keeps working.
 */
async function assertDrawSizeMutable(
  client: RepositoryClient,
  stage: TournamentStage,
  next: number | null,
): Promise<void> {
  if (stage.type !== 'KNOCKOUT') {
    return;
  }
  if (next === stage.drawSize) {
    return;
  }

  const matches = await client.matches.listByStage(stage.id);
  if (matches.length > 0) {
    throw new BusinessRuleViolationError(
      'The bracket size cannot change once a knockout bracket has been generated.',
    );
  }
}

/**
 * Validates and normalizes a knockout rule set supplied on create.
 *
 * A rule set is only meaningful on a KNOCKOUT stage: a GROUP stage stores none,
 * so a stray value is dropped rather than persisted. Every round's rule is
 * validated (unknown format / out-of-range target rejected) and normalized
 * against the defaults, so the stored catalogue is always complete.
 */
function resolveCreateKnockoutRules(
  type: StageType,
  rules: Readonly<Record<string, MatchScoringRule>> | undefined,
): Readonly<Record<string, MatchScoringRule>> | null {
  if (rules === undefined || type !== 'KNOCKOUT') {
    return null;
  }
  return requireValidKnockoutRules(rules);
}

/** As `resolveCreateKnockoutRules`, but `null` clears the catalogue on update. */
function resolveUpdateKnockoutRules(
  type: StageType,
  rules: Readonly<Record<string, MatchScoringRule>> | null,
): Readonly<Record<string, MatchScoringRule>> | null {
  if (rules === null || type !== 'KNOCKOUT') {
    return null;
  }
  return requireValidKnockoutRules(rules);
}

/**
 * Rejects a malformed rule before it is stored, then normalizes the catalogue.
 *
 * Only the keys the caller actually supplied are validated: an omitted round is
 * filled from the defaults, which is exactly V1's `normalizeKnockoutRules`.
 */
function requireValidKnockoutRules(
  rules: Readonly<Record<string, MatchScoringRule>>,
): Readonly<Record<string, MatchScoringRule>> {
  for (const [roundKey, rule] of Object.entries(rules)) {
    const error = validateKnockoutRule(rule);
    if (error) {
      throw new ValidationError(`${roundKey}: ${error}`, 'knockoutRules');
    }
  }
  return normalizeKnockoutRules(rules);
}

/**
 * Keeps the per-round knockout configuration immutable once the knockout has
 * started.
 *
 * Mirrors V1's `knockoutRulesLocked`: the rules may be edited freely during the
 * group stage and before the bracket is generated, but the moment any knockout
 * match exists the configuration is locked, so a live or completed match can
 * never be re-interpreted.
 */
async function assertKnockoutRulesMutable(
  client: RepositoryClient,
  stage: TournamentStage,
): Promise<void> {
  if (stage.type !== 'KNOCKOUT') {
    return;
  }
  const matches = await client.matches.listByStage(stage.id);
  if (matches.length > 0) {
    throw new BusinessRuleViolationError(
      'Knockout scoring is locked because the knockout stage has started.',
    );
  }
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
