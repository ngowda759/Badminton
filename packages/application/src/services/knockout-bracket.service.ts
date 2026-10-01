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
  knockoutMatchRule,
  NotFoundError,
  ValidationError,
  type Match,
  type MatchParticipant,
  type MatchSlot,
  type TournamentEntry,
  type TournamentStage,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { GenerateKnockoutBracketCommand, KnockoutPairingInput } from './commands.ts';
import type { Bracket, BracketMatch, BracketParticipant, BracketRound } from './knockout.ts';
import type { QualificationService } from './qualification.service.ts';

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
 * The draw comes from one of two sources: caller-controlled `entryIds` (paired
 * in order into round 1, no seeding) or, via `generateFromQualifiers`, the
 * seeded qualifiers of the feeder GROUP stages (`buildBracketSeed`), which may
 * include byes.
 */
export interface KnockoutBracketService {
  /** Creates every bracket match and fills the first round. Transactional. */
  generateBracket(stageId: string, command: GenerateKnockoutBracketCommand): Promise<Bracket>;
  /** Generates the bracket from a stage's configured group qualifiers. Transactional. */
  generateFromQualifiers(stageId: string): Promise<Bracket>;
  /** Reads the bracket; completes an ACTIVE stage once its final is decided. */
  getBracket(stageId: string): Promise<Bracket>;
}

export function createKnockoutBracketService(
  client: RepositoryClient,
  unitOfWork: UnitOfWork,
  qualification?: QualificationService,
): KnockoutBracketService {
  return {
    async generateBracket(stageId, command): Promise<Bracket> {
      const pairings = resolvePairings(command);

      // Generation reads several records and writes many rows, so the whole
      // operation runs in one unit of work: a partial bracket is never left
      // behind. The unique indexes are the database's final guard.
      return unitOfWork.runInTransaction(async (tx) => {
        const stage = await requireKnockoutStage(tx, stageId);
        await assertNoExistingBracket(tx, stageId);

        const categoryEntries = await tx.entries.listByCategory(stage.categoryId);
        const byId = new Map(categoryEntries.map((entry) => [entry.id, entry]));

        const size = pairings.length * 2;
        if (!isSupportedBracketSize(size)) {
          throw new BusinessRuleViolationError(
            `Bracket size ${size} is not supported; use a power of two from 2 to 128.`,
          );
        }

        // Every real (non-bye) participant must be an active entry of the stage
        // category, and no entry may appear twice across the whole bracket.
        const allEntryIds = pairings.flatMap((pairing) =>
          pairing.second === null ? [pairing.first] : [pairing.first, pairing.second],
        );
        validateEntries(allEntryIds, byId, stage.categoryId);

        return writeBracket(tx, stage, size, pairings);
      });
    },

    async generateFromQualifiers(stageId): Promise<Bracket> {
      if (!qualification) {
        throw new BusinessRuleViolationError('Qualification is not available in this composition.');
      }

      // The whole operation - reading the feeder groups' standings, seeding and
      // writing the bracket - runs in one unit of work, so a bracket is never
      // generated from a partially-observed group stage and a failure leaves no
      // partial bracket.
      return unitOfWork.runInTransaction(async (tx) => {
        const stage = await requireKnockoutStage(tx, stageId);
        await assertNoExistingBracket(tx, stageId);

        const resolved = await qualification.resolve(tx, stageId);
        if (!resolved.ready) {
          throw new BusinessRuleViolationError(
            resolved.blockedReason ?? 'The knockout stage is not ready to be generated.',
          );
        }

        const categoryEntries = await tx.entries.listByCategory(stage.categoryId);
        const byId = new Map(categoryEntries.map((entry) => [entry.id, entry]));
        const size = resolved.bracketSize;
        if (size === null || !isSupportedBracketSize(size)) {
          throw new BusinessRuleViolationError('The qualification produced an unsupported size.');
        }

        validateEntries(resolved.seeds, byId, stage.categoryId);
        return writeBracket(tx, stage, size, resolved.pairings);
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

/** Loads and validates a KNOCKOUT stage that may accept a bracket. */
async function requireKnockoutStage(
  client: RepositoryClient,
  stageId: string,
): Promise<TournamentStage> {
  const stage = await client.stages.findById(stageId);
  if (!stage) {
    throw new NotFoundError('Stage', stageId);
  }
  if (stage.type !== 'KNOCKOUT') {
    throw new BusinessRuleViolationError('A bracket can only be generated for a KNOCKOUT stage.');
  }
  if (stage.status === 'COMPLETED') {
    throw new BusinessRuleViolationError('A completed stage cannot accept a new bracket.');
  }
  return stage;
}

/** A bracket is generated once; a second generation is a conflict. */
async function assertNoExistingBracket(client: RepositoryClient, stageId: string): Promise<void> {
  const existing = await client.matches.listByStage(stageId);
  if (existing.length > 0) {
    throw new ConflictError('This stage already has a bracket.');
  }
}

/** Resolves the draw from the command: either explicit pairings or an entry order. */
function resolvePairings(command: GenerateKnockoutBracketCommand): readonly KnockoutPairingInput[] {
  const hasEntryIds = command.entryIds !== undefined;
  const hasPairings = command.pairings !== undefined;

  if (hasEntryIds === hasPairings) {
    throw new ValidationError('Provide either entryIds or pairings, but not both.');
  }

  if (command.pairings !== undefined) {
    if (command.pairings.length === 0) {
      throw new BusinessRuleViolationError('A bracket needs at least one first-round pairing.');
    }
    return command.pairings;
  }

  const entryIds = command.entryIds ?? [];
  if (entryIds.length < 2 || entryIds.length % 2 !== 0) {
    throw new BusinessRuleViolationError(
      'A bracket needs an even number of at least two entries; use pairings for byes.',
    );
  }
  const pairings: KnockoutPairingInput[] = [];
  for (let index = 0; index < entryIds.length; index += 2) {
    pairings.push({
      first: entryIds[index] as string,
      second: entryIds[index + 1] as string,
    });
  }
  return pairings;
}

/**
 * Writes the whole bracket for a validated stage and records its draw size.
 *
 * Round 1 is filled from the pairings; a bye (a pairing with no `second`) leaves
 * slot 2 empty and **immediately advances** its competitor into the next round's
 * slot, so no fake match is created and no manual step is needed to move a bye
 * through. Later rounds keep their slots empty until progression fills them.
 *
 * Runs on the caller's transactional client, so the stage update, every match
 * and every participant commit or roll back together.
 */
async function writeBracket(
  tx: RepositoryClient,
  stage: TournamentStage,
  size: number,
  pairings: readonly KnockoutPairingInput[],
): Promise<Bracket> {
  const roundCount = calculateRoundCount(size);

  // Record the authoritative bracket size on the stage: progression and
  // completion derive the final round from it, so it must not be left to the
  // value (if any) supplied when the stage was created.
  await tx.stages.update(stage.id, { drawSize: size });

  const roundOneMatches: { matchId: string; matchNumber: number; pairing: KnockoutPairingInput }[] =
    [];

  for (let roundNumber = 1; roundNumber <= roundCount; roundNumber += 1) {
    const matchesInRound = calculateMatchesInRound(size, roundNumber);
    const sequences = Array.from({ length: matchesInRound }, (_unused, index) =>
      calculateSequence(size, roundNumber, index + 1),
    );
    // Snapshot the round's scoring rule onto every match it creates, so a later
    // stage edit can never rewrite a live or completed match (V1's `match.scoring`).
    const rule = knockoutMatchRule(stage.knockoutRules, size, roundNumber);
    const created = await tx.matches.createMany(
      sequences.map((sequence, index) => ({
        stageId: stage.id,
        sequence,
        roundNumber,
        matchNumber: index + 1,
        status: 'SCHEDULED' as const,
        knockoutFormat: rule.format,
        knockoutPointsPerGame: rule.pointsPerGame,
      })),
    );

    if (roundNumber === 1) {
      for (let index = 0; index < created.length; index += 1) {
        const match = created[index];
        const pairing = pairings[index];
        if (match && pairing) {
          roundOneMatches.push({
            matchId: match.id,
            matchNumber: match.matchNumber ?? index + 1,
            pairing,
          });
        }
      }
    }
  }

  // Fill round 1, then advance every bye into round 2.
  const roundOneParticipants: { matchId: string; entryId: string; slot: MatchSlot }[] = [];
  const byeAdvancements: { fromMatchNumber: number; entryId: string }[] = [];

  for (const { matchId, matchNumber, pairing } of roundOneMatches) {
    roundOneParticipants.push({ matchId, entryId: pairing.first, slot: 1 });
    if (pairing.second === null) {
      byeAdvancements.push({ fromMatchNumber: matchNumber, entryId: pairing.first });
    } else {
      roundOneParticipants.push({ matchId, entryId: pairing.second, slot: 2 });
    }
  }
  await tx.matchParticipants.createMany(roundOneParticipants);

  if (byeAdvancements.length > 0) {
    const allMatches = await tx.matches.listByStage(stage.id);
    const byKey = new Map(
      allMatches.map((match) => [`${match.roundNumber}:${match.matchNumber}`, match]),
    );
    const fill: { matchId: string; entryId: string; slot: MatchSlot }[] = [];

    for (const { fromMatchNumber, entryId } of byeAdvancements) {
      const destination = destinationSlot(fromMatchNumber);
      const target = byKey.get(`${destination.roundNumber}:${destination.matchNumber}`);
      if (target) {
        fill.push({ matchId: target.id, entryId, slot: destination.slot });
      }
    }
    await tx.matchParticipants.createMany(fill);
  }

  return buildBracket(await loadStageMatches(tx, stage.id), {
    stageId: stage.id,
    stageName: stage.name,
    status: stage.status,
    bracketSize: size,
  });
}

/** Where a round-1 match's winner (or bye) goes in round 2. */
function destinationSlot(matchNumber: number): {
  readonly roundNumber: number;
  readonly matchNumber: number;
  readonly slot: MatchSlot;
} {
  const roundTwoMatchNumber = Math.ceil(matchNumber / 2);
  const slot: MatchSlot = matchNumber % 2 === 1 ? 1 : 2;
  return { roundNumber: 2, matchNumber: roundTwoMatchNumber, slot };
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
