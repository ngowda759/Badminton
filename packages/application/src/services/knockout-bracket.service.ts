import {
  ACTIVE_ENTRY_STATUSES,
  bracketRoundName,
  BusinessRuleViolationError,
  calculateMatchesInRound,
  calculateRoundCount,
  calculateSequence,
  ConflictError,
  isBracketFinalCompleted,
  isSupportedBracketSize,
  NotFoundError,
  ValidationError,
  type Match,
  type MatchParticipant,
  type MatchSlot,
  type TournamentEntry,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { GenerateKnockoutBracketCommand } from './commands.ts';
import type { Bracket, BracketMatch, BracketParticipant, BracketRound } from './knockout.ts';

/**
 * Knockout bracket service.
 *
 * Generates the single-elimination bracket for a KNOCKOUT stage and reads it
 * back in a UI-friendly shape. The bracket is stored in the existing `matches`
 * table (no `Bracket`/`BracketSlot` table): each match carries a `roundNumber`
 * and `matchNumber`, an explicit stage-unique `sequence`, and `MatchParticipant`
 * rows filling slots 1 and 2. Later rounds start with empty slots and are filled
 * by `KnockoutProgressionService` as earlier matches complete.
 *
 * Participant ordering is **caller-controlled**: the supplied `entryIds` are
 * paired in order into round 1. There is no seeding, ranking or draw algorithm.
 */
export interface KnockoutBracketService {
  /** Creates every bracket match and fills the first round. Transactional. */
  generateBracket(stageId: string, command: GenerateKnockoutBracketCommand): Promise<Bracket>;
  /** Reads the bracket; completes an ACTIVE stage once its final is decided. */
  getBracket(stageId: string): Promise<Bracket>;
}

export function createKnockoutBracketService(
  client: RepositoryClient,
  unitOfWork: UnitOfWork,
): KnockoutBracketService {
  return {
    async generateBracket(stageId, command): Promise<Bracket> {
      const entries = command.entryIds;

      // Generation reads several records and writes many rows, so the whole
      // operation runs in one unit of work: a partial bracket is never left
      // behind. The unique indexes are the database's final guard.
      return unitOfWork.runInTransaction(async (tx) => {
        const stage = await tx.stages.findById(stageId);
        if (!stage) {
          throw new NotFoundError('Stage', stageId);
        }
        if (stage.type !== 'KNOCKOUT') {
          throw new BusinessRuleViolationError(
            'A bracket can only be generated for a KNOCKOUT stage.',
          );
        }
        if (stage.status === 'COMPLETED') {
          throw new BusinessRuleViolationError('A completed stage cannot accept a new bracket.');
        }

        const existing = await tx.matches.listByStage(stageId);
        if (existing.length > 0) {
          throw new ConflictError('This stage already has a bracket.');
        }

        const categoryEntries = await tx.entries.listByCategory(stage.categoryId);
        const byId = new Map(categoryEntries.map((entry) => [entry.id, entry]));

        const validated = validateEntries(entries, byId, stage.categoryId);
        const size = validated.length;

        if (!isSupportedBracketSize(size)) {
          throw new BusinessRuleViolationError(
            `Bracket size ${size} is not supported; use a power of two from 2 to 128.`,
          );
        }

        const roundCount = calculateRoundCount(size);

        // Record the authoritative bracket size on the stage: progression and
        // completion derive the final round from it, so it must not be left to
        // the value (if any) supplied when the stage was created.
        await tx.stages.update(stageId, { drawSize: size });

        // Create every match round by round, then fill round 1. Later rounds
        // keep their slots empty until progression fills them.
        for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
          const matchesInRound = calculateMatchesInRound(size, roundNumber);
          for (let matchNumber = 1; matchNumber <= matchesInRound; matchNumber += 1) {
            const match = await tx.matches.create({
              stageId,
              sequence: calculateSequence(size, roundNumber, matchNumber),
              roundNumber,
              matchNumber,
              status: 'SCHEDULED',
            });

            if (roundNumber === 1) {
              const first = validated[2 * (matchNumber - 1)];
              const second = validated[2 * (matchNumber - 1) + 1];
              if (first && second) {
                await tx.matchParticipants.create({ matchId: match.id, entryId: first, slot: 1 });
                await tx.matchParticipants.create({ matchId: match.id, entryId: second, slot: 2 });
              }
            }
          }
        }

        return buildBracket(await loadStageMatches(tx, stageId), {
          stageId,
          stageName: stage.name,
          status: stage.status,
          bracketSize: size,
        });
      });
    },

    async getBracket(stageId): Promise<Bracket> {
      const stage = await client.stages.findById(stageId);
      if (!stage) {
        throw new NotFoundError('Stage', stageId);
      }
      if (stage.type !== 'KNOCKOUT') {
        throw new BusinessRuleViolationError('A bracket is only available for a KNOCKOUT stage.');
      }

      const matches = await loadStageMatches(client, stageId);

      // Keep the stage lifecycle honest: derive completion from the final, and
      // persist it only when the stage is otherwise allowed to complete. No
      // background job and no automatic completion at creation time.
      if (
        stage.status === 'ACTIVE' &&
        stage.drawSize !== null &&
        isStageComplete(matches, stage.drawSize)
      ) {
        await client.stages.updateStatus(stageId, 'COMPLETED');
        return buildBracket(matches, {
          stageId,
          stageName: stage.name,
          status: 'COMPLETED',
          bracketSize: stage.drawSize,
        });
      }

      const bracketSize = stage.drawSize ?? inferBracketSize(matches);
      return buildBracket(matches, {
        stageId,
        stageName: stage.name,
        status: stage.status,
        bracketSize,
      });
    },
  };
}

interface StageBracketInfo {
  readonly stageId: string;
  readonly stageName: string;
  readonly status: Bracket['status'];
  readonly bracketSize: number;
}

/** Loads a stage's matches with participants in one batched read (no N+1). */
async function loadStageMatches(
  client: RepositoryClient,
  stageId: string,
): Promise<
  readonly { readonly match: Match; readonly participants: readonly MatchParticipant[] }[]
> {
  return client.matches.listByStageWithParticipants(stageId);
}

/**
 * Validates the caller's ordering.
 *
 * Every entry must belong to the stage's category, be active (PENDING or
 * CONFIRMED - never withdrawn or disqualified) and be unique. The count itself
 * is validated against the supported sizes by the caller.
 */
function validateEntries(
  entryIds: readonly string[],
  byId: ReadonlyMap<string, TournamentEntry>,
  categoryId: string,
): readonly string[] {
  if (entryIds.length === 0) {
    throw new ValidationError('A bracket needs at least one entry.', 'entryIds');
  }

  const seen = new Set<string>();
  for (const entryId of entryIds) {
    if (seen.has(entryId)) {
      throw new ConflictError('The same entry cannot appear twice in a bracket.');
    }
    seen.add(entryId);

    const entry = byId.get(entryId);
    if (!entry) {
      // Not in this category at all - indistinguishable from a foreign entry.
      throw new BusinessRuleViolationError(
        'Every bracket entry must belong to the stage category.',
      );
    }
    if (entry.categoryId !== categoryId) {
      throw new BusinessRuleViolationError(
        'Every bracket entry must belong to the stage category.',
      );
    }
    if (!ACTIVE_ENTRY_STATUSES.includes(entry.status)) {
      throw new BusinessRuleViolationError(
        `Entry status ${entry.status} is not eligible for a bracket.`,
      );
    }
  }

  return entryIds;
}

/** True once the final (the only match of the last round) is completed. */
function isStageComplete(
  matches: readonly { readonly match: Match }[],
  bracketSize: number,
): boolean {
  if (!isSupportedBracketSize(bracketSize)) {
    return false;
  }
  return matches.some(
    (row) =>
      row.match.roundNumber !== null &&
      row.match.matchNumber !== null &&
      isBracketFinalCompleted(
        bracketSize,
        row.match.roundNumber,
        row.match.matchNumber,
        row.match.status,
      ),
  );
}

/** Best-effort bracket size when the stage has none (e.g. an unseeded stage). */
function inferBracketSize(matches: readonly { readonly match: Match }[]): number {
  const roundOneMatches = matches.filter((row) => row.match.roundNumber === 1).length;
  return roundOneMatches > 0 ? roundOneMatches * 2 : 0;
}

/** Groups flat matches into rounds for the read model. */
function buildBracket(
  rows: readonly { readonly match: Match; readonly participants: readonly MatchParticipant[] }[],
  info: StageBracketInfo,
): Bracket {
  const roundNumbers = [
    ...new Set(
      rows.map((row) => row.match.roundNumber).filter((value): value is number => value !== null),
    ),
  ].sort((left, right) => left - right);

  const rounds: BracketRound[] = roundNumbers.map((roundNumber) => ({
    roundNumber,
    name:
      info.bracketSize > 0
        ? bracketRoundName(info.bracketSize, roundNumber)
        : `Round ${roundNumber}`,
    matches: rows
      .filter((row) => row.match.roundNumber === roundNumber)
      .sort((left, right) => (left.match.matchNumber ?? 0) - (right.match.matchNumber ?? 0))
      .map(toBracketMatch),
  }));

  const finalRound = rounds.at(-1);
  const finalMatch = finalRound?.matches[0];
  const complete = finalMatch?.status === 'COMPLETED';

  return {
    stageId: info.stageId,
    stageName: info.stageName,
    status: info.status,
    bracketSize: info.bracketSize,
    roundCount: rounds.length,
    rounds,
    complete,
  };
}

function toBracketMatch(row: {
  readonly match: Match;
  readonly participants: readonly MatchParticipant[];
}): BracketMatch {
  const slot1 = row.participants.find((participant) => participant.slot === 1);
  const slot2 = row.participants.find((participant) => participant.slot === 2);
  return {
    matchId: row.match.id,
    matchNumber: row.match.matchNumber ?? 0,
    sequence: row.match.sequence,
    status: row.match.status,
    participant1: toParticipant(1, slot1?.entryId),
    participant2: toParticipant(2, slot2?.entryId),
    winnerEntryId: row.match.winnerEntryId,
  };
}

function toParticipant(slot: MatchSlot, entryId: string | undefined): BracketParticipant {
  return { slot, entryId: entryId ?? null };
}
