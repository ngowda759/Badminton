import type { MatchSlot, MatchStatus, StageStatus } from '@badminton/domain';

/**
 * Read model returned by the group-fixture service.
 *
 * A GROUP stage's fixtures are a flat round-robin; `roundNumber` groups the
 * pairings that can be played simultaneously but is not a bracket. The shape is
 * deliberately close to the knockout `Bracket` read model so the REST API and
 * the UI treat both stages uniformly.
 */

/** One participant slot of a group fixture; both slots are always filled. */
export interface GroupFixtureParticipant {
  readonly slot: MatchSlot;
  readonly entryId: string;
}

/** One group fixture (a single match between two competitors). */
export interface GroupFixtureMatch {
  readonly matchId: string;
  /** Stage-unique ordering, 1-based, in generation order. */
  readonly sequence: number;
  /** Round-robin round the pairing belongs to, 1-based. */
  readonly roundNumber: number;
  readonly status: MatchStatus;
  readonly participant1: GroupFixtureParticipant;
  readonly participant2: GroupFixtureParticipant;
}

/** The complete fixture set of a GROUP stage. */
export interface GroupFixtures {
  readonly stageId: string;
  readonly stageName: string;
  readonly status: StageStatus;
  /** Number of competitors the round-robin was generated for. */
  readonly competitorCount: number;
  /** Number of matches: `competitorCount * (competitorCount - 1) / 2`. */
  readonly matchCount: number;
  readonly matches: readonly GroupFixtureMatch[];
}
