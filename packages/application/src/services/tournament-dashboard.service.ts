import type {
  Match,
  MatchParticipant,
  TournamentCategory,
  TournamentEntry,
  TournamentStage,
} from '@badminton/domain';
import { NotFoundError } from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type {
  DashboardCategoryProgress,
  DashboardCompetitor,
  DashboardCourt,
  DashboardMatch,
  DashboardStageProgress,
  DashboardSummary,
  TournamentDashboard,
} from './dashboard.ts';

/**
 * Tournament dashboard service.
 *
 * A read-only, derived view: it persists nothing and owns no business rules. It
 * assembles the dashboard from a **bounded** number of batched reads (tournament,
 * categories, entries, stages, matches, courts, participants, players, teams),
 * so a tournament with hundreds of matches still issues a handful of queries and
 * never an N+1 fan-out.
 *
 * Timeline slices are deliberately bounded: recent results and unscheduled
 * matches are capped, so the endpoint never returns unlimited history.
 */
export interface TournamentDashboardService {
  getDashboard(tournamentId: string): Promise<TournamentDashboard>;
}

/** Maximum completed results returned, newest first. */
const RECENT_RESULT_LIMIT = 10;
/** Maximum upcoming scheduled matches returned, soonest first. */
const UPCOMING_MATCH_LIMIT = 20;
/** Maximum unscheduled matches returned, so the attention list stays bounded. */
const UNSCHEDULED_LIMIT = 50;

export function createTournamentDashboardService(
  client: RepositoryClient,
  now: () => Date = () => new Date(),
): TournamentDashboardService {
  return {
    async getDashboard(tournamentId: string): Promise<TournamentDashboard> {
      const tournament = await client.tournaments.findById(tournamentId);
      if (!tournament) {
        throw new NotFoundError('Tournament', tournamentId);
      }

      const [categories, entries, stages, matches, courts] = await Promise.all([
        client.categories.listByTournament(tournamentId),
        client.entries.listByTournament(tournamentId),
        client.stages.listByTournament(tournamentId),
        client.matches.listByTournament(tournamentId),
        client.courts.listByTournament(tournamentId),
      ]);

      const participants = await client.matchParticipants.listByMatchIds(
        matches.map((match) => match.id),
      );
      const names = await resolveCompetitorNames(client, entries);

      const categoryById = new Map(categories.map((category) => [category.id, category]));
      const stageById = new Map(stages.map((stage) => [stage.id, stage]));
      const courtById = new Map(courts.map((court) => [court.id, court]));
      const participantsByMatch = groupBy(participants, (participant) => participant.matchId);

      const toView = (match: Match): DashboardMatch =>
        toDashboardMatch(match, stageById, categoryById, courtById, participantsByMatch, names);

      const currentTime = now().getTime();

      const liveMatches = matches.filter((match) => match.status === 'IN_PROGRESS').map(toView);

      const upcomingMatches = matches
        .filter(
          (match) =>
            match.status === 'SCHEDULED' &&
            match.scheduledStartAt !== null &&
            match.scheduledStartAt.getTime() >= currentTime,
        )
        .sort((left, right) => compareScheduled(left, right, courtById))
        .slice(0, UPCOMING_MATCH_LIMIT)
        .map(toView);

      const recentResults = matches
        .filter((match) => match.status === 'COMPLETED')
        .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
        .slice(0, RECENT_RESULT_LIMIT)
        .map(toView);

      const unscheduledMatches = matches
        .filter((match) => match.status === 'SCHEDULED' && match.courtId === null)
        .slice(0, UNSCHEDULED_LIMIT)
        .map(toView);

      const courtViews: DashboardCourt[] = courts.map((court) => ({
        courtId: court.id,
        number: court.number,
        name: court.name,
        status: court.status,
        busy: liveMatches.some((match) => match.courtId === court.id),
      }));

      return {
        tournament: {
          id: tournament.id,
          name: tournament.name,
          status: tournament.status,
          startDate: tournament.startDate,
          endDate: tournament.endDate,
          location: tournament.location,
          timezone: tournament.timezone,
        },
        summary: buildSummary(entries, matches),
        courts: courtViews,
        liveMatches,
        upcomingMatches,
        recentResults,
        unscheduledMatches,
        categories: buildCategoryProgress(categories, stages, matches),
      };
    },
  };
}

function buildSummary(
  entries: readonly TournamentEntry[],
  matches: readonly Match[],
): DashboardSummary {
  return {
    totalEntries: entries.length,
    totalMatches: matches.length,
    completedMatches: matches.filter((match) => match.status === 'COMPLETED').length,
    inProgressMatches: matches.filter((match) => match.status === 'IN_PROGRESS').length,
    scheduledMatches: matches.filter(
      (match) => match.status === 'SCHEDULED' && match.courtId !== null,
    ).length,
    unscheduledMatches: matches.filter(
      (match) => match.status === 'SCHEDULED' && match.courtId === null,
    ).length,
  };
}

function buildCategoryProgress(
  categories: readonly TournamentCategory[],
  stages: readonly TournamentStage[],
  matches: readonly Match[],
): readonly DashboardCategoryProgress[] {
  const stagesByCategory = groupBy(stages, (stage) => stage.categoryId);
  const matchesByStage = groupBy(matches, (match) => match.stageId);

  return categories.map((category) => {
    const categoryStages = stagesByCategory.get(category.id) ?? [];
    const stageProgress: DashboardStageProgress[] = categoryStages
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map((stage) => {
        const stageMatches = matchesByStage.get(stage.id) ?? [];
        return {
          stageId: stage.id,
          name: stage.name,
          type: stage.type,
          status: stage.status,
          totalMatches: stageMatches.length,
          completedMatches: stageMatches.filter((match) => match.status === 'COMPLETED').length,
        };
      });

    const totalMatches = stageProgress.reduce((sum, stage) => sum + stage.totalMatches, 0);
    const completedMatches = stageProgress.reduce((sum, stage) => sum + stage.completedMatches, 0);

    return {
      categoryId: category.id,
      name: category.name,
      code: category.code,
      totalMatches,
      completedMatches,
      stages: stageProgress,
    };
  });
}

function toDashboardMatch(
  match: Match,
  stageById: ReadonlyMap<string, TournamentStage>,
  categoryById: ReadonlyMap<string, TournamentCategory>,
  courtById: ReadonlyMap<string, { readonly number: number; readonly name: string }>,
  participantsByMatch: ReadonlyMap<string, readonly MatchParticipant[]>,
  names: ReadonlyMap<string, string>,
): DashboardMatch {
  const stage = stageById.get(match.stageId);
  const category = stage ? categoryById.get(stage.categoryId) : undefined;
  const court = match.courtId ? courtById.get(match.courtId) : undefined;

  const participants: DashboardCompetitor[] = (participantsByMatch.get(match.id) ?? [])
    .slice()
    .sort((left, right) => left.slot - right.slot)
    .map((participant) => ({
      entryId: participant.entryId,
      name: names.get(participant.entryId) ?? null,
      slot: participant.slot,
    }));

  return {
    matchId: match.id,
    status: match.status,
    categoryId: category?.id ?? '',
    categoryName: category?.name ?? 'Unknown category',
    stageId: stage?.id ?? '',
    stageName: stage?.name ?? 'Unknown stage',
    courtId: match.courtId,
    courtName: court?.name ?? null,
    courtNumber: court?.number ?? null,
    scheduledStartAt: match.scheduledStartAt,
    scheduledEndAt: match.scheduledEndAt,
    participants,
    winnerEntryId: match.winnerEntryId,
  };
}

/**
 * Resolves entry id → display name using two batched reads.
 *
 * Entries (already loaded for the whole tournament) decide whether a competitor
 * is a player or a team; players and teams are then fetched by id in one query
 * each, so the dashboard resolves every participant without a per-match query.
 */
async function resolveCompetitorNames(
  client: RepositoryClient,
  entries: readonly TournamentEntry[],
): Promise<ReadonlyMap<string, string>> {
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

  const names = new Map<string, string>();
  const playerName = new Map(players.map((player) => [player.id, player.name]));
  const teamName = new Map(teams.map((team) => [team.id, team.name]));

  for (const entry of entries) {
    if (entry.playerId) {
      const name = playerName.get(entry.playerId);
      if (name) {
        names.set(entry.id, name);
      }
    } else if (entry.teamId) {
      const name = teamName.get(entry.teamId);
      if (name) {
        names.set(entry.id, name);
      }
    }
  }

  return names;
}

/** Soonest start first, then lowest court number, for deterministic output. */
function compareScheduled(
  left: Match,
  right: Match,
  courtById: ReadonlyMap<string, { readonly number: number }>,
): number {
  const leftStart = left.scheduledStartAt?.getTime() ?? 0;
  const rightStart = right.scheduledStartAt?.getTime() ?? 0;
  if (leftStart !== rightStart) {
    return leftStart - rightStart;
  }
  const leftNumber = left.courtId ? (courtById.get(left.courtId)?.number ?? 0) : 0;
  const rightNumber = right.courtId ? (courtById.get(right.courtId)?.number ?? 0) : 0;
  return leftNumber - rightNumber;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = groups.get(key(row));
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key(row), [row]);
    }
  }
  return groups;
}
