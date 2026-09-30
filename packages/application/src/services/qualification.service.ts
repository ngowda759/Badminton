import {
  buildBracketSeed,
  BusinessRuleViolationError,
  NotFoundError,
  type BracketSize,
  type SeededGroup,
  type SeededPairing,
  type StandingRow,
  type TournamentStage,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import { computeStageStandings } from './standings-compute.ts';
import type { GroupQualifiers, QualifiedCompetitor, QualificationView } from './qualification.ts';

/**
 * Group-stage qualification service.
 *
 * Qualification is **derived**, never stored: the qualifiers of a KNOCKOUT
 * stage are the top `qualifiersPerGroup` competitors of every GROUP stage that
 * precedes it in the same category, in standing order. The configured count
 * lives on the GROUP stage (`TournamentStage.qualifiersPerGroup`), so no
 * separate qualification model is introduced.
 *
 * The service reads standings through the shared `computeStageStandings`, so the
 * table it qualifies from is exactly the table the standings screen shows - a
 * withdrawn entry is excluded and a partially-played group is visible. It
 * **refuses** to qualify while any feeder group has an incomplete match, so a
 * competitor can never advance on stale standings.
 *
 * `resolve` takes a repository client so the bracket generator can call it with
 * its *transactional* client and generate from qualifiers atomically.
 */

/** A qualification result ready for bracket generation. */
export interface ResolvedQualification {
  readonly knockoutStageId: string;
  readonly knockoutStageName: string;
  readonly qualifiersPerGroup: number | null;
  readonly groups: readonly GroupQualifiers[];
  readonly seeds: readonly string[];
  readonly pairings: readonly SeededPairing[];
  readonly bracketSize: BracketSize | null;
  readonly byeCount: number;
  readonly qualifierCount: number;
  /** True when every feeder group is configured, complete and has enough qualifiers. */
  readonly ready: boolean;
  /** Human-readable reason qualification is not ready, or `null`. */
  readonly blockedReason: string | null;
  readonly standingsByGroup: ReadonlyMap<string, readonly StandingRow[]>;
}

export interface QualificationService {
  /** Full derived qualification view for a KNOCKOUT stage (for the API/UI). */
  getView(knockoutStageId: string): Promise<QualificationView>;
  /** The resolved qualification (pairings and shape) for bracket generation. */
  resolve(client: RepositoryClient, knockoutStageId: string): Promise<ResolvedQualification>;
}

export function createQualificationService(client: RepositoryClient): QualificationService {
  return {
    async getView(knockoutStageId): Promise<QualificationView> {
      const resolved = await resolveQualification(client, knockoutStageId);
      const existing = await client.matches.listByStage(knockoutStageId);
      return toView(resolved, existing.length > 0);
    },
    async resolve(tx, knockoutStageId): Promise<ResolvedQualification> {
      return resolveQualification(tx, knockoutStageId);
    },
  };
}

/**
 * The KNOCKOUT stage the qualifiers feed and its feeder GROUP stages.
 *
 * A feeder group is any GROUP stage of the same category with a lower sequence
 * than the knockout; they are returned in sequence order so the draw is
 * deterministic.
 */
async function loadFeederGroups(
  client: RepositoryClient,
  knockout: TournamentStage,
): Promise<readonly TournamentStage[]> {
  const stages = await client.stages.listByCategory(knockout.categoryId);
  return stages
    .filter((stage) => stage.type === 'GROUP' && stage.sequence < knockout.sequence)
    .sort((left, right) => left.sequence - right.sequence);
}

async function resolveQualification(
  client: RepositoryClient,
  knockoutStageId: string,
): Promise<ResolvedQualification> {
  const knockout = await client.stages.findById(knockoutStageId);
  if (!knockout) {
    throw new NotFoundError('Stage', knockoutStageId);
  }
  if (knockout.type !== 'KNOCKOUT') {
    throw new BusinessRuleViolationError('Qualification is only available for a KNOCKOUT stage.');
  }

  const feederGroups = await loadFeederGroups(client, knockout);
  const standingsByGroup = new Map<string, readonly StandingRow[]>();
  const groups: GroupQualifiers[] = [];
  const seededGroups: SeededGroup[] = [];

  let pendingMatches = 0;
  let missingConfig = false;
  let configuredPerGroup: number | null = null;

  for (const group of feederGroups) {
    const standings = await computeStageStandings(client, group.id);
    standingsByGroup.set(group.id, standings.rows);
    pendingMatches += standings.pendingMatches;

    // A group is defined by who plays in it: select from the entries that
    // appear in this stage's matches, not every active entry of the category.
    // The table may list more (Phase 5 shows the whole category), but a member
    // of a sibling group can never qualify from here.
    const members = standings.rows.filter((row) =>
      standings.participantEntryIds.includes(row.entryId),
    );

    const perGroup = group.qualifiersPerGroup;
    if (perGroup === null) {
      missingConfig = true;
      groups.push(toGroupQualifiers(group, members, 0, standings));
      continue;
    }
    if (configuredPerGroup === null) {
      configuredPerGroup = perGroup;
    }

    // A group smaller than the configured count qualifies everyone it has.
    const qualifyingCount = Math.min(perGroup, members.length);
    const qualifiers: QualifiedCompetitor[] = members
      .slice(0, qualifyingCount)
      .map((row) => ({ entryId: row.entryId, position: row.position }));

    groups.push(toGroupQualifiers(group, members, qualifyingCount, standings));
    seededGroups.push({ groupId: group.id, entryIds: qualifiers.map((row) => row.entryId) });
  }

  const seed = safeSeed(seededGroups);
  const qualifierCount = seed?.seeds.length ?? 0;

  const blockedReason = qualificationBlockedReason({
    feederGroupCount: feederGroups.length,
    missingConfig,
    pendingMatches,
    qualifierCount,
  });

  return {
    knockoutStageId,
    knockoutStageName: knockout.name,
    qualifiersPerGroup: configuredPerGroup,
    groups,
    seeds: seed?.seeds ?? [],
    pairings: seed?.pairings ?? [],
    bracketSize: seed?.bracketSize ?? null,
    byeCount: seed?.byeCount ?? 0,
    qualifierCount,
    ready: blockedReason === null,
    blockedReason,
    standingsByGroup,
  };
}

interface BlockedReasonInput {
  readonly feederGroupCount: number;
  readonly missingConfig: boolean;
  readonly pendingMatches: number;
  readonly qualifierCount: number;
}

/** The first reason qualification cannot run, or `null` when it can. */
function qualificationBlockedReason(input: BlockedReasonInput): string | null {
  if (input.feederGroupCount === 0) {
    return 'No group stage feeds this knockout stage.';
  }
  if (input.missingConfig) {
    return 'Set how many competitors qualify from each group.';
  }
  if (input.pendingMatches > 0) {
    return 'Every group match must be completed before qualifiers can be determined.';
  }
  if (input.qualifierCount < 2) {
    return 'At least two competitors must qualify to build a knockout bracket.';
  }
  return null;
}

/** Seeds the qualifiers, returning `undefined` when there are too few or too many. */
function safeSeed(groups: readonly SeededGroup[]): ReturnType<typeof buildBracketSeed> | undefined {
  const count = groups.reduce((total, group) => total + group.entryIds.length, 0);
  if (count < 2 || count > 128) {
    return undefined;
  }
  return buildBracketSeed(groups);
}

function toGroupQualifiers(
  group: TournamentStage,
  standings: readonly StandingRow[],
  qualifyingCount: number,
  summary: { readonly totalMatches: number; readonly completedMatches: number },
): GroupQualifiers {
  return {
    groupId: group.id,
    groupName: group.name,
    sequence: group.sequence,
    qualifyingCount,
    competitorCount: standings.length,
    qualifiers: standings
      .slice(0, qualifyingCount)
      .map((row) => ({ entryId: row.entryId, position: row.position })),
    complete: summary.completedMatches === summary.totalMatches,
    totalMatches: summary.totalMatches,
    completedMatches: summary.completedMatches,
  };
}

function toView(resolved: ResolvedQualification, bracketGenerated: boolean): QualificationView {
  const standingsByGroup: Record<string, readonly StandingRow[]> = {};
  for (const [groupId, rows] of resolved.standingsByGroup) {
    standingsByGroup[groupId] = rows;
  }

  return {
    knockoutStageId: resolved.knockoutStageId,
    knockoutStageName: resolved.knockoutStageName,
    qualifiersPerGroup: resolved.qualifiersPerGroup,
    groups: resolved.groups,
    seeds: resolved.seeds,
    qualifierCount: resolved.qualifierCount,
    bracketSize: resolved.bracketSize ?? 0,
    byeCount: resolved.byeCount,
    ready: resolved.ready,
    blockedReason: resolved.blockedReason,
    bracketGenerated,
    standingsByGroup,
  };
}
