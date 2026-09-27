import { Link } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { DashboardMatchDto, TournamentDashboardDto } from '@/api/types.ts';
import { ErrorState } from '@/components/error-state.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent } from '@/components/ui/card.tsx';
import { useTournament } from '@/components/tournaments/context.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { formatDateTime } from '@/lib/format.ts';

/**
 * Court board: the operational view of each active court.
 *
 * Read-only with respect to scoring - the match lifecycle and scoring workflow
 * stays authoritative. Each court shows its live match (if any) or its next
 * scheduled match; a court with neither is idle. Refresh is manual: Phase 7
 * does not implement realtime.
 */
export function CourtBoardPage() {
  const api = useApi();
  const { tournament } = useTournament();

  const { state, refetch } = useApiQuery<TournamentDashboardDto>(
    ['dashboard', tournament.id],
    (signal) => api.dashboard.get(tournament.id, signal),
  );

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link className="hover:text-foreground underline-offset-4 hover:underline" to="../..">
          {tournament.name}
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-foreground">Court board</span>
      </nav>

      <PageHeader
        title="Court board"
        description="Live and next matches by court. Refresh to pick up the latest changes."
        actions={
          <>
            <Button variant="outline" onClick={refetch}>
              Refresh
            </Button>
            <Button asChild variant="outline">
              <Link to={`/tournaments/${tournament.id}/courts/manage`}>Manage courts</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to={`/tournaments/${tournament.id}/dashboard`}>Dashboard</Link>
            </Button>
          </>
        }
      />

      {state.status === 'loading' ? <LoadingState label="Loading court board…" rows={4} /> : null}
      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} title="Could not load the court board" />
      ) : null}

      {state.status === 'loaded' ? (
        <CourtBoard data={state.data} tournamentId={tournament.id} />
      ) : null}
    </div>
  );
}

function CourtBoard({
  data,
  tournamentId,
}: {
  readonly data: TournamentDashboardDto;
  readonly tournamentId: string;
}) {
  const byCourt = new Map<string, DashboardMatchDto>();
  for (const match of data.liveMatches) {
    if (match.courtId && !byCourt.has(match.courtId)) {
      byCourt.set(match.courtId, match);
    }
  }
  for (const match of data.upcomingMatches) {
    if (match.courtId && !byCourt.has(match.courtId)) {
      byCourt.set(match.courtId, match);
    }
  }

  if (data.courts.length === 0) {
    return (
      <EmptyState
        title="No courts have been added"
        description="Add courts before the board can show live and upcoming matches."
        action={
          <Button asChild variant="outline">
            <Link to={`/tournaments/${tournamentId}/courts/manage`}>Manage courts</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {data.courts.map((court) => {
        const match = byCourt.get(court.courtId);
        return (
          <Card key={court.courtId}>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">Court {court.number}</p>
                  <p className="text-muted-foreground text-xs">{court.name}</p>
                </div>
                <CourtStateLabel busy={court.busy} hasMatch={Boolean(match)} />
              </div>

              {match ? (
                <MatchCard match={match} />
              ) : (
                <p className="text-muted-foreground text-sm">Idle — no match assigned.</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function CourtStateLabel({
  busy,
  hasMatch,
}: {
  readonly busy: boolean;
  readonly hasMatch: boolean;
}) {
  if (busy) {
    return <StatusBadge kind="match" status="IN_PROGRESS" />;
  }
  if (hasMatch) {
    return <span className="text-muted-foreground text-xs font-medium uppercase">Next</span>;
  }
  return <span className="text-muted-foreground text-xs font-medium uppercase">Idle</span>;
}

function MatchCard({ match }: { readonly match: DashboardMatchDto }) {
  const [slot1, slot2] = match.participants;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{slot1?.name ?? 'TBD'}</span>
        <span className="text-muted-foreground text-xs">vs</span>
        <span className="text-sm font-medium">{slot2?.name ?? 'TBD'}</span>
      </div>
      <p className="text-muted-foreground text-xs">
        {match.categoryName} · {match.stageName}
      </p>
      {match.scheduledStartAt ? (
        <p className="text-xs">{formatDateTime(match.scheduledStartAt)}</p>
      ) : null}
    </div>
  );
}
