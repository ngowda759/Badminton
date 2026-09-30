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
}

export function createGroupFixtureService(unitOfWork: UnitOfWork): GroupFixtureService {
  return {
    async generate(stageId, command): Promise<GroupFixtures> {
      const entryIds = command.entryIds;

      // Generation reads several records and writes many rows, so the whole
      // operation runs in one unit of work: a partial fixture set is never left
      // behind. The stage-unique index on `sequence` is the database's final
      // guard against a concurrent duplicate generation.
      return unitOfWork.runInTransaction(async (tx) => {
        const stage = await tx.stages.findById(stageId);
        if (!stage) {
          throw new NotFoundError('Stage', stageId);
        }
        if (stage.type !== 'GROUP') {
          throw new BusinessRuleViolationError('Fixtures can only be generated for a GROUP stage.');
        }
        if (stage.status === 'COMPLETED') {
          throw new BusinessRuleViolationError('A completed stage cannot accept new fixtures.');
        }

        const existing = await tx.matches.listByStage(stageId);
        if (existing.length > 0) {
          throw new ConflictError('This stage already has fixtures.');
        }

        const categoryEntries = await tx.entries.listByCategory(stage.categoryId);
        const byId = new Map(categoryEntries.map((entry) => [entry.id, entry]));

        const validated = validateEntries(entryIds, byId, stage.categoryId);
        const rounds = roundRobinRounds(validated);

        // Create the matches in generation order, so `sequence` is a stable,
        // contiguous 1..M ordering and the round-robin round is preserved for a
        // round-based presentation. Both slots are always filled - a bye is
        // never emitted as a match.
        let sequence = 0;
        for (const round of rounds) {
          for (const [first, second] of round.pairings) {
            sequence += 1;
            const match = await tx.matches.create({
              stageId,
              sequence,
              roundNumber: round.roundNumber,
              matchNumber: sequence,
              status: 'SCHEDULED',
            });
            await tx.matchParticipants.create({ matchId: match.id, entryId: first, slot: 1 });
            await tx.matchParticipants.create({ matchId: match.id, entryId: second, slot: 2 });
          }
        }

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
