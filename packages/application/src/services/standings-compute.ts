import {
  ACTIVE_ENTRY_STATUSES,
  BusinessRuleViolationError,
  calculateStandings,
  NotFoundError,
  type MatchParticipant,
  type StandingRow,
  type StandingsMatch,
  type StandingsParticipant,
  type TournamentEntry,
  type TournamentStage,
} from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';

/**
 * Shared group-standings computation.
 *
 * Both the standings endpoint and the qualification service need the same
 * derived table for a GROUP stage, so the derivation lives here once. Standings
 * are never stored: the table is recomputed from the completed matches on every
 * read, so it can never drift from the results.
 *
 * Only active entries of the stage's category appear - a withdrawn or
 * disqualified entry no longer occupies a place - and every active entry appears
 * from zero before it has played.
 */
export interface StageStandings {
  readonly stage: TournamentStage;
  readonly rows: readonly StandingRow[];
  /** Active entries of the stage's category, in no particular order. */
  readonly activeEntryIds: readonly string[];
  /**
   * The subset of active entries that actually appear in this stage's matches.
   *
   * The standings *table* shows every active category entry (Phase 5 behaviour),
   * but a group is defined by who plays in it, so qualification scopes its
   * selection to this set - an entry that only plays in a sibling group is not a
   * member of this group and can never qualify from it.
   */
  readonly participantEntryIds: readonly string[];
  /** Every match of the stage (scheduled, in progress, completed, cancelled). */
  readonly totalMatches: number;
  /** Completed matches only - the ones the table is derived from. */
  readonly completedMatches: number;
  /** Matches that are not yet completed (`totalMatches - completedMatches`). */
  readonly pendingMatches: number;
}

/** Loads the stage, derives its standings and counts its matches. */
export async function computeStageStandings(
  client: RepositoryClient,
  stageId: string,
): Promise<StageStandings> {
  const stage = await client.stages.findById(stageId);
  if (!stage) {
    throw new NotFoundError('Stage', stageId);
  }
  if (stage.type !== 'GROUP') {
    throw new BusinessRuleViolationError('Standings are only available for a GROUP stage.');
  }

  const entries = await client.entries.listByCategory(stage.categoryId);
  const activeEntryIds = entries
    .filter((entry) => ACTIVE_ENTRY_STATUSES.includes(entry.status))
    .map((entry) => entry.id);

  const [stageMatches, completed] = await Promise.all([
    client.matches.listByStage(stageId),
    client.matches.listCompletedByStage(stageId),
  ]);

  // Who plays in this group: every entry that appears in any of its matches.
  const allParticipants = await client.matchParticipants.listByMatchIds(
    stageMatches.map((match) => match.id),
  );
  const participantEntryIds = [...new Set(allParticipants.map((row) => row.entryId))];

  const rows = await buildStandingsRows(client, activeEntryIds, completed, entries);

  return {
    stage,
    rows,
    activeEntryIds,
    participantEntryIds,
    totalMatches: stageMatches.length,
    completedMatches: completed.length,
    pendingMatches: stageMatches.length - completed.length,
  };
}

/**
 * Derives the ordered table from a set of completed matches (batched reads).
 *
 * The name resolver is built from the already-loaded entries plus one batched
 * read each of the referenced players and teams, so the documented name
 * tie-break costs no per-row query.
 */
async function buildStandingsRows(
  client: RepositoryClient,
  activeEntryIds: readonly string[],
  completed: readonly { readonly id: string }[],
  entries: readonly TournamentEntry[],
): Promise<readonly StandingRow[]> {
  const nameOf = await buildNameResolver(client, entries);

  if (completed.length === 0) {
    return calculateStandings(activeEntryIds, [], nameOf);
  }

  const matchIds = completed.map((match) => match.id);
  const [participants, games] = await Promise.all([
    client.matchParticipants.listByMatchIds(matchIds),
    client.matchGames.listByMatchIds(matchIds),
  ]);

  const participantsByMatch = groupBy(participants, (participant) => participant.matchId);
  const gamesByMatch = groupBy(games, (game) => game.matchId);

  const matches: StandingsMatch[] = completed.map((match) => ({
    participants: toStandingsParticipants(participantsByMatch.get(match.id) ?? []),
    games: gamesByMatch.get(match.id) ?? [],
    kind: 'GROUP',
  }));

  // The pure function defensively includes any entry it finds in a match, so
  // drop rows for entries that are no longer active - a completed result must
  // not resurrect a withdrawn competitor in the table.
  const active = new Set(activeEntryIds);
  return calculateStandings(activeEntryIds, matches, nameOf)
    .filter((row) => active.has(row.entryId))
    .map((row, index) => ({ ...row, position: index + 1 }));
}

/**
 * Resolves an entry id to its competitor name for the standings tie-break.
 *
 * A competitor is either a player (singles) or a team (doubles); the entries
 * already say which, so the players and teams are fetched by id in one query
 * each and the map is built without a per-row lookup. Players and teams are
 * disjoint, so the same names can never resolve for both.
 */
async function buildNameResolver(
  client: RepositoryClient,
  entries: readonly TournamentEntry[],
): Promise<(entryId: string) => string> {
  const playerIds = new Set<string>();
  const teamIds = new Set<string>();
  for (const entry of entries) {
    if (entry.playerId) {
      playerIds.add(entry.playerId);
    }
    if (entry.teamId) {
      teamIds.add(entry.teamId);
    }
  }

  const [players, teams] = await Promise.all([
    client.players.listByIds([...playerIds]),
    client.teams.listByIds([...teamIds]),
  ]);
  const playerName = new Map(players.map((player) => [player.id, player.name]));
  const teamName = new Map(teams.map((team) => [team.id, team.name]));

  const byEntry = new Map<string, string>();
  for (const entry of entries) {
    if (entry.playerId) {
      const name = playerName.get(entry.playerId);
      if (name !== undefined) {
        byEntry.set(entry.id, name);
      }
    } else if (entry.teamId) {
      const name = teamName.get(entry.teamId);
      if (name !== undefined) {
        byEntry.set(entry.id, name);
      }
    }
  }

  return (entryId: string): string => byEntry.get(entryId) ?? entryId;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const bucket = grouped.get(groupKey);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(groupKey, [row]);
    }
  }
  return grouped;
}

function toStandingsParticipants(
  rows: readonly MatchParticipant[],
): readonly StandingsParticipant[] {
  return rows.map((row) => ({ entryId: row.entryId, slot: row.slot }));
}
