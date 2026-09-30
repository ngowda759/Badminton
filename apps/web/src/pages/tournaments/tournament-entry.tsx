import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { TournamentDto } from '@/api/types.ts';
import { useApi } from '@/api/context.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table.tsx';
import { useCollection, type CollectionResult } from '@/hooks/use-collection.ts';
import { formatCalendarDate, orDash } from '@/lib/format.ts';

/**
 * Tournament entry point and collection list.
 *
 * The list is server-backed: `GET /api/v1/tournaments` returns persisted
 * tournaments newest first, so records survive a browser restart and are
 * visible from any device. The page holds no local index of tournaments.
 */
export function TournamentEntryPage() {
  const api = useApi();
  const collection = useCollection(['tournaments'], (params, signal) =>
    api.tournaments.list(params, signal),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tournaments"
        description="Create a tournament or open one that is already set up."
        actions={
          <Button asChild>
            <Link to="/tournaments/new">Create tournament</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>All tournaments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TournamentList collection={collection} />
        </CardContent>
      </Card>

      <OpenByIdCard />
    </div>
  );
}

function TournamentList({ collection }: { readonly collection: CollectionResult<TournamentDto> }) {
  const { state, hasMore, loadingMore, loadMore, loadMoreError, refetch } = collection;

  if (state.status === 'loading') {
    return <LoadingState label="Loading tournaments…" />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} title="Could not load tournaments" onRetry={refetch} />;
  }

  if (state.items.length === 0) {
    return (
      <EmptyState
        title="No tournaments yet"
        description="Create the first tournament to begin setting up categories, entries, stages and matches."
        action={
          <Button asChild variant="outline">
            <Link to="/tournaments/new">Create tournament</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="tournament-list">
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tournament</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Dates</TableHead>
              <TableHead>Location</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.items.map((tournament) => (
              <TableRow key={tournament.id}>
                <TableCell className="font-medium">
                  <Link
                    className="text-primary underline-offset-4 hover:underline"
                    to={`/tournaments/${tournament.id}`}
                  >
                    {tournament.name}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge kind="tournament" status={tournament.status} />
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatCalendarDate(tournament.startDate)} –{' '}
                  {formatCalendarDate(tournament.endDate)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {orDash(tournament.location)}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/tournaments/${tournament.id}`}>Open</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>

      {loadMoreError ? (
        <ErrorState
          error={loadMoreError}
          title="Could not load more tournaments"
          onRetry={loadMore}
        />
      ) : null}

      {hasMore ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onClick={() => {
              loadMore();
            }}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Lets the operator open a tournament whose id they know. */
function OpenByIdCard() {
  const navigate = useNavigate();
  const [openId, setOpenId] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open by ID</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const value = openId.trim();
            if (value.length === 0) {
              setError('Enter a tournament ID.');
              return;
            }
            setError(undefined);
            void navigate(`/tournaments/${value}`);
          }}
        >
          <label className="sr-only" htmlFor="open-tournament-id">
            Tournament ID
          </label>
          <Input
            id="open-tournament-id"
            value={openId}
            placeholder="Tournament UUID"
            onChange={(event) => {
              setOpenId(event.target.value);
            }}
          />
          <Button type="submit">Open</Button>
        </form>
        {error ? <p className="text-destructive mt-2 text-xs">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
