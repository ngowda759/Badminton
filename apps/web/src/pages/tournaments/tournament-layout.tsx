import { Link, Outlet, useParams } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { TournamentDto } from '@/api/types.ts';
import { ErrorState } from '@/components/error-state.tsx';
import { LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { TournamentProvider } from '@/components/tournaments/context.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';

/**
 * Loads one tournament and keeps it available to every nested route.
 *
 * The tournament is fetched once here rather than by each child page, so
 * navigating between details, categories, stages and matches does not refetch
 * it repeatedly.
 */
export function TournamentLayout() {
  const api = useApi();
  const { tournamentId = '' } = useParams();

  const { state, refetch } = useApiQuery<TournamentDto>(['tournament', tournamentId], (signal) =>
    api.tournaments.get(tournamentId, signal),
  );

  if (state.status === 'loading') {
    return <LoadingState label="Loading tournament…" rows={4} />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} onRetry={refetch} title="Could not load tournament" />;
  }

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link
          className="hover:text-foreground underline-offset-4 hover:underline"
          to="/tournaments"
        >
          Tournaments
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-foreground">{state.data.name}</span>
      </nav>
      <div className="flex items-center gap-2">
        <StatusBadge kind="tournament" status={state.data.status} />
      </div>
      <TournamentProvider value={{ tournament: state.data, refetch }}>
        <Outlet />
      </TournamentProvider>
    </div>
  );
}
