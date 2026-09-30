import { BusinessRuleViolationError } from './errors.ts';

/**
 * Pure group-stage qualification.
 *
 * A knockout stage is fed by the qualifiers of a GROUP stage: the top
 * `qualifiersPerGroup` competitors of each group, in standing order. This module
 * is the single source of truth for that selection - it knows nothing about
 * entries, Prisma or HTTP, and it deliberately takes an already-computed
 * standings table rather than recomputing it.
 *
 * Selection is derived entirely from configuration (`qualifiersPerGroup`) and
 * the standings the caller supplies, so no tournament size is hard-coded: a
 * group smaller than the configured count simply qualifies all of its
 * competitors.
 *
 * A selection is only valid once every required group match has been completed.
 * The caller passes `pendingMatchCount` (the number of group matches that are
 * not yet `COMPLETED`); a non-zero count is a business-rule violation, because
 * advancing a competitor from an unfinished group would use stale standings.
 */

/** One competitor's final placing in a group, already ordered by the standings rules. */
export interface QualificationStanding {
  readonly entryId: string;
  /** 1-based position under the documented standings tie-break order. */
  readonly position: number;
}

/** How many competitors advance from each group. */
export interface QualificationConfig {
  readonly qualifiersPerGroup: number;
}

/** The qualifiers of one group, in standing order. */
export interface GroupQualification {
  readonly groupId: string;
  readonly entryIds: readonly string[];
}

/** The complete qualification result for a category. */
export interface QualificationResult {
  readonly groups: readonly GroupQualification[];
  /** Every qualifier across every group, in group order. */
  readonly qualifierCount: number;
}

/**
 * Validates the configuration itself.
 *
 * The per-group count must be a positive whole number. The count is deliberately
 * *not* compared against a group size here - a small group qualifies everyone it
 * has, and the caller applies that clamp when selecting.
 */
export function validateQualificationConfig(config: QualificationConfig): void {
  const per = config.qualifiersPerGroup;
  if (!Number.isInteger(per) || per < 1) {
    throw new BusinessRuleViolationError('Qualifiers per group must be a positive whole number.');
  }
}

/**
 * Selects the qualifiers from each group.
 *
 * `standingsByGroup` maps a group id to its ordered standings (already sorted by
 * the standings rules). Every group contributes its top `qualifiersPerGroup`
 * competitors; a group with fewer competitors contributes all of them. An empty
 * group contributes nothing.
 *
 * `pendingMatchCount` is the number of the stage's matches that are not yet
 * completed. A non-zero count is rejected: qualification must not run against a
 * partially-played group, otherwise a competitor could advance on stale
 * standings or an unfinished table.
 */
export function selectQualifiers(
  config: QualificationConfig,
  standingsByGroup: ReadonlyMap<string, readonly QualificationStanding[]>,
  pendingMatchCount: number,
): QualificationResult {
  validateQualificationConfig(config);

  if (!Number.isInteger(pendingMatchCount) || pendingMatchCount < 0) {
    throw new BusinessRuleViolationError('Pending match count must not be negative.');
  }
  if (pendingMatchCount > 0) {
    throw new BusinessRuleViolationError(
      'Every group match must be completed before qualifiers can be determined.',
    );
  }

  const groups: GroupQualification[] = [];
  let qualifierCount = 0;

  for (const [groupId, standings] of standingsByGroup) {
    const ordered = [...standings].sort((left, right) => left.position - right.position);
    const entryIds = ordered
      .slice(0, config.qualifiersPerGroup)
      .map((standing) => standing.entryId);
    groups.push({ groupId, entryIds });
    qualifierCount += entryIds.length;
  }

  return { groups, qualifierCount };
}

/**
 * Flattens a qualification result into the bracket seed order.
 *
 * The order is the group order, each group contributing its qualifiers in
 * standing order. A knockout bracket generator that pairs consecutive entries
 * (1 vs 2, 3 vs 4, ...) therefore pairs each group's winner with the same
 * group's runner-up when the caller has not applied a cross-seed draw - callers
 * that want cross-seeding apply it before generating the bracket.
 */
export function flattenQualifiers(result: QualificationResult): readonly string[] {
  return result.groups.flatMap((group) => group.entryIds);
}
