import { Link } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type {
  DashboardCategoryProgressDto,
  DashboardMatchDto,
  TournamentDashboardDto,
} from '@/api/types.ts';
import { ErrorState } from '@/components/error-state.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { useTournament } from '@/components/tournaments/context.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { formatCalendarDate, formatDateTime, orDash } from '@/lib/format.ts';

/**
 * Tournament operational dashboard.
 *
 * One aggregated read: the server returns the summary, courts and bounded
 * match slices together, so the client never fans out per match. Refresh is
 * manual - Phase 7 deliberately has no polling or realtime.
 */
export function TournamentDashboardPage() {
  const api = useApi();
  const { tournament } = useTournament();

  const { state, refetch } = useApiQuery<TournamentDashboardDto>(
    ['dashboard', tournament.id],
    (signal) => api.dashboard.get(tournament.id, signal),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={tournament.name}
        description={`${formatCalendarDate(tournament.startDate)} – ${formatCalendarDate(tournament.endDate)} · ${orDash(tournament.location)}`}
        actions={
          <>
            <Button variant="outline" onClick={refetch}>
              Refresh
            </Button>
            <Button asChild variant="outline">
              <Link to={`/tournaments/${tournament.id}/courts`}>Court board</Link>
            </Button>
          </>
        }
      />

      {state.status === 'loading' ? <LoadingState label="Loading dashboard…" rows={5} /> : null}
      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} title="Could not load the dashboard" />
      ) : null}

      {state.status === 'loaded' ? (
        <DashboardContent data={state.data} tournamentId={tournament.id} />
      ) : null}
    </div>
  );
}

function DashboardContent({
  data,
  tournamentId,
}: {
  readonly data: TournamentDashboardDto;
  readonly tournamentId: string;
}) {
  const { summary } = data;
  const cards = [
    { label: 'Entries', value: summary.totalEntries },
    { label: 'Matches', value: summary.totalMatches },
    { label: 'Completed', value: summary.completedMatches },
    { label: 'Live', value: summary.inProgressMatches },
    { label: 'Scheduled', value: summary.scheduledMatches },
    { label: 'Unscheduled', value: summary.unscheduledMatches },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="tournament" status={data.tournament.status} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardContent>
              <p className="text-muted-foreground text-xs uppercase">{card.label}</p>
              <p className="mt-1 text-2xl font-semibold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <MatchList
          title="Live matches"
          matches={data.liveMatches}
          emptyText="No match is in progress."
          tournamentId={tournamentId}
        />
        <MatchList
          title="Upcoming"
          matches={data.upcomingMatches}
          emptyText="No upcoming scheduled matches."
          tournamentId={tournamentId}
        />
        <MatchList
          title="Recent results"
          matches={data.recentResults}
          emptyText="No results have been recorded yet."
          tournamentId={tournamentId}
        />
        <MatchList
          title="Needs scheduling"
          matches={data.unscheduledMatches}
          emptyText="Every match has a court and time."
          tournamentId={tournamentId}
        />
      </div>

      <CategoryProgress categories={data.categories} />
    </div>
  );
}

function MatchList({
  title,
  matches,
  emptyText,
  tournamentId,
}: {
  readonly title: string;
  readonly matches: readonly DashboardMatchDto[];
  readonly emptyText: string;
  readonly tournamentId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {matches.length === 0 ? <p className="text-muted-foreground text-sm">{emptyText}</p> : null}
        <ul className="space-y-3">
          {matches.map((match) => (
            <li key={match.matchId} className="space-y-1 border-b pb-3 last:border-b-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm">
                  {match.participants.map((part) => part.name ?? 'TBD').join(' vs ')}
                </span>
                <StatusBadge kind="match" status={match.status} />
              </div>
              <p className="text-muted-foreground text-xs">
                {match.categoryName} · {match.stageName}
                {match.courtNumber !== null ? ` · Court ${String(match.courtNumber)}` : ''}
                {match.scheduledStartAt ? ` · ${formatDateTime(match.scheduledStartAt)}` : ''}
              </p>
              <Link
                className="text-xs underline-offset-4 hover:underline"
                to={`/tournaments/${tournamentId}/categories/${match.categoryId}/matches/${match.matchId}`}
              >
                Open match
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function CategoryProgress({
  categories,
}: {
  readonly categories: readonly DashboardCategoryProgressDto[];
}) {
  if (categories.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Category progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {categories.map((category) => (
          <div key={category.categoryId} className="space-y-1">
            <p className="text-sm font-medium">
              {category.name}{' '}
              <span className="text-muted-foreground font-normal">
                ({category.completedMatches} / {category.totalMatches})
              </span>
            </p>
            <ul className="space-y-1">
              {category.stages.map((stage) => (
                <li key={stage.stageId} className="text-muted-foreground text-xs">
                  {stage.name} ({stage.type}) — {stage.completedMatches} / {stage.totalMatches}{' '}
                  completed
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
