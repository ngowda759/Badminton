import type { StandingRow } from '@badminton/domain';

/**
 * Read models returned by the qualification service.
 *
 * Qualification is a derived view over group standings, not a stored table:
 * the top `qualifiersPerGroup` competitors of each group, in standing order.
 * The shape is deliberately close to the group-fixture and bracket read models
 * so the REST API and the UI treat them uniformly.
 */

/** One qualified competitor with its final group placing. */
export interface QualifiedCompetitor {
  readonly entryId: string;
  /** 1-based position within the group's standings. */
  readonly position: number;
}

/** The qualifiers of one group. */
export interface GroupQualifiers {
  readonly groupId: string;
  readonly groupName: string;
  /** 1-based stage sequence of the group within its category. */
  readonly sequence: number;
  /** How many competitors this group qualifies (clamped to its size). */
  readonly qualifyingCount: number;
  /** Number of competitors in the group (active entries). */
  readonly competitorCount: number;
  readonly qualifiers: readonly QualifiedCompetitor[];
  /** True once every match of the group is completed. */
  readonly complete: boolean;
  readonly totalMatches: number;
  readonly completedMatches: number;
}

/** The complete qualification view of a category's group stage. */
export interface QualificationView {
  /** The KNOCKOUT stage the qualifiers feed, or `null` when there is none. */
  readonly knockoutStageId: string | null;
  readonly knockoutStageName: string | null;
  /** Configured qualifiers per group, or `null` when unset. */
  readonly qualifiersPerGroup: number | null;
  /** Every group that contributes qualifiers, in stage-sequence order. */
  readonly groups: readonly GroupQualifiers[];
  /** Every qualifier across every group, in bracket seed order. */
  readonly seeds: readonly string[];
  /** Total number of qualifiers. */
  readonly qualifierCount: number;
  /** Smallest supported bracket size that holds every qualifier, or 0. */
  readonly bracketSize: number;
  /** Bracket size minus the qualifier count (each bye advances a seed). */
  readonly byeCount: number;
  /** True when every group match is completed and at least two qualify. */
  readonly ready: boolean;
  /** Human-readable reason qualification is not ready, or `null`. */
  readonly blockedReason: string | null;
  /** True once the knockout stage already has a generated bracket. */
  readonly bracketGenerated: boolean;
  /** Per-group standings, keyed by group id (for the UI table). */
  readonly standingsByGroup: Readonly<Record<string, readonly StandingRow[]>>;
}
