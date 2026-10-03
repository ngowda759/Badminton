import {
  ACTIVE_ENTRY_STATUSES,
  BusinessRuleViolationError,
  ConflictError,
  NotFoundError,
  roundRobinRounds,
  ValidationError,
  type Match,
  type MatchParticipant,
  type TournamentEntry,
  type TournamentStage,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { GenerateGroupFixturesCommand } from './commands.ts';
import type { GroupFixtureMatch, GroupFixtures } from './group-fixtures.ts';

/**
 * Group-stage fixture service.
 *
 * Generates a complete round-robin for a GROUP stage: every supplied entry plays
 * every other supplied entry exactly once, so a group of `n` entries produces
 * exactly `n * (n - 1) / 2` matches. Fixtures are stored in the existing
 * `matches`/`match_participants` tables (no new table): each match carries a
 * stage-unique `sequence`, the round-robin `roundNumber` and both participant
 * slots filled. This mirrors the knockout bracket's storage so retrieval,
 * scoring, standings, scheduling and the dashboard all keep working unchanged.
 *
 * Participant ordering is **caller-controlled**: the supplied `entryIds` are
 * scheduled in order. There is no seeding, ranking or draw algorithm, matching
 * the existing bracket behaviour.
 */
export interface GroupFixtureService {
  /** Creates every round-robin match and fills both slots. Transactional. */
  generate(stageId: string, command: GenerateGroupFixturesCommand): Promise<GroupFixtures>;
  /**
   * Replaces a GROUP stage's whole fixture set with a freshly generated
   * round-robin. Transactional.
   *
   * Regeneration is the guarded operator action V1 exposed
   * (`regeneratePlan`/`regenerateFixtures`): a group whose membership or
   * ordering was mis-entered can be rebuilt without deleting the stage. It is
   * allowed only for a non-`COMPLETED` GROUP stage that already has fixtures -
   * a completed stage's results are the group's outcome and `STAGE_TRANSITIONS`
   * makes `COMPLETED` terminal, and regeneration replaces rather than creates.
   * The recorded results are discarded (the whole fixture set is replaced),
   * matching V1's simpler rebuild and the existing `generate` semantics.
   */
  regenerate(stageId: string, command: GenerateGroupFixturesCommand): Promise<GroupFixtures>;
}

export function createGroupFixtureService(unitOfWork: UnitOfWork): GroupFixtureService {
  return {
    async generate(stageId, command): Promise<GroupFixtures> {
      // Generation reads several records and writes many rows, so the whole
      // operation runs in one unit of work: a partial fixture set is never left
      // behind. The stage-unique index on `sequence` is the database's final
      // guard against a concurrent duplicate generation.
      return unitOfWork.runInTransaction(async (tx) => {
        const stage = await requireGroupStage(tx, stageId);

        const existing = await tx.matches.listByStage(stageId);
        if (existing.length > 0) {
          throw new ConflictError('This stage already has fixtures.');
        }

        const validated = await validateStageEntries(tx, stage, command.entryIds);
        await writeRoundRobin(tx, stageId, validated);

        return buildGroupFixtures(await loadStageMatches(tx, stageId), {
          stageId,
          stageName: stage.name,
          status: stage.status,
          competitorCount: validated.length,
        });
      });
    },

    async regenerate(stageId, command): Promise<GroupFixtures> {
      // The replace and the fresh insert must be atomic: a failure after the
      // delete leaves the original fixtures (and their results) intact rather
      // than a half-emptied group.
      return unitOfWork.runInTransaction(async (tx) => {
        const stage = await requireGroupStage(tx, stageId);

        const existing = await tx.matches.listByStage(stageId);
        if (existing.length === 0) {
          throw new ConflictError('This stage has no fixtures to regenerate.');
        }

        const validated = await validateStageEntries(tx, stage, command.entryIds);

        // The `match_participants`/`match_games` onDelete: Cascade removes each
        // old match's participants and recorded games with its row.
        for (const match of existing) {
          await tx.matches.remove(match.id);
        }
        await writeRoundRobin(tx, stageId, validated);

        return buildGroupFixtures(await loadStageMatches(tx, stageId), {
          stageId,
          stageName: stage.name,
          status: stage.status,
          competitorCount: validated.length,
        });
      });
    },
  };
}

/** Loads a stage, rejecting a missing stage or one that cannot hold fixtures. */
async function requireGroupStage(
  client: RepositoryClient,
  stageId: string,
): Promise<TournamentStage> {
  const stage = await client.stages.findById(stageId);
  if (!stage) {
    throw new NotFoundError('Stage', stageId);
  }
  if (stage.type !== 'GROUP') {
    throw new BusinessRuleViolationError('Fixtures can only be generated for a GROUP stage.');
  }
  if (stage.status === 'COMPLETED') {
    throw new BusinessRuleViolationError('A completed stage cannot accept new fixtures.');
  }
  return stage;
}

/** Loads the stage's category entries and validates the caller's ordering. */
async function validateStageEntries(
  client: RepositoryClient,
  stage: TournamentStage,
  entryIds: readonly string[],
): Promise<readonly string[]> {
  const categoryEntries = await client.entries.listByCategory(stage.categoryId);
  const byId = new Map(categoryEntries.map((entry) => [entry.id, entry]));
  return validateEntries(entryIds, byId, stage.categoryId);
}

/**
 * Writes the fresh round-robin for `validated`, filling both slots of every
 * match. Ordering is caller-controlled; a bye is never emitted as a match.
 */
async function writeRoundRobin(
  client: RepositoryClient,
  stageId: string,
  validated: readonly string[],
): Promise<void> {
  const rounds = roundRobinRounds(validated);

  // Create the matches in generation order, so `sequence` is a stable,
  // contiguous 1..M ordering and the round-robin round is preserved for a
  // round-based presentation. Both slots are always filled.
  let sequence = 0;
  for (const round of rounds) {
    for (const [first, second] of round.pairings) {
      sequence += 1;
      const match = await client.matches.create({
        stageId,
        sequence,
        roundNumber: round.roundNumber,
        matchNumber: sequence,
        status: 'SCHEDULED',
      });
      await client.matchParticipants.create({ matchId: match.id, entryId: first, slot: 1 });
      await client.matchParticipants.create({ matchId: match.id, entryId: second, slot: 2 });
    }
  }
}

interface StageFixtureInfo {
  readonly stageId: string;
  readonly stageName: string;
  readonly status: GroupFixtures['status'];
  readonly competitorCount: number;
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
 * CONFIRMED - never withdrawn or disqualified) and be unique. At least two are
 * required: a round-robin needs someone to play.
 */
function validateEntries(
  entryIds: readonly string[],
  byId: ReadonlyMap<string, TournamentEntry>,
  categoryId: string,
): readonly string[] {
  if (entryIds.length < 2) {
    throw new ValidationError('A round-robin needs at least two entries.', 'entryIds');
  }

  const seen = new Set<string>();
  for (const entryId of entryIds) {
    if (seen.has(entryId)) {
      throw new ConflictError('The same entry cannot appear twice in a round-robin.');
    }
    seen.add(entryId);

    const entry = byId.get(entryId);
    if (!entry) {
      // Not in this category at all - indistinguishable from a foreign entry.
      throw new BusinessRuleViolationError(
        'Every fixture entry must belong to the stage category.',
      );
    }
    if (entry.categoryId !== categoryId) {
      throw new BusinessRuleViolationError(
        'Every fixture entry must belong to the stage category.',
      );
    }
    if (!ACTIVE_ENTRY_STATUSES.includes(entry.status)) {
      throw new BusinessRuleViolationError(
        `Entry status ${entry.status} is not eligible for fixtures.`,
      );
    }
  }

  return entryIds;
}

/** Groups flat matches into the fixture read model, ordered by sequence. */
function buildGroupFixtures(
  rows: readonly { readonly match: Match; readonly participants: readonly MatchParticipant[] }[],
  info: StageFixtureInfo,
): GroupFixtures {
  const matches = [...rows]
    .sort((left, right) => left.match.sequence - right.match.sequence)
    .map(toGroupFixtureMatch);

  return {
    stageId: info.stageId,
    stageName: info.stageName,
    status: info.status,
    competitorCount: info.competitorCount,
    matchCount: matches.length,
    matches,
  };
}

function toGroupFixtureMatch(row: {
  readonly match: Match;
  readonly participants: readonly MatchParticipant[];
}): GroupFixtureMatch {
  const slot1 = row.participants.find((participant) => participant.slot === 1);
  const slot2 = row.participants.find((participant) => participant.slot === 2);
  return {
    matchId: row.match.id,
    sequence: row.match.sequence,
    roundNumber: row.match.roundNumber ?? 0,
    status: row.match.status,
    participant1: { slot: 1, entryId: slot1?.entryId ?? '' },
    participant2: { slot: 2, entryId: slot2?.entryId ?? '' },
  };
}
