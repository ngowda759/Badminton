import { Link } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { CategoryDto } from '@/api/types.ts';
import { PageHeader } from '@/components/page-header.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { FormatBadge, StatusBadge } from '@/components/status-badge.tsx';
import { useTournament } from '@/components/tournaments/context.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { humanizeEnum, orDash } from '@/lib/format.ts';
import { useTournamentRefresh } from '@/realtime/tournament-refresh.tsx';

/** Lists a tournament's categories with links into each category. */
export function CategoriesPage() {
  const api = useApi();
  const { tournament } = useTournament();

  const base = `/tournaments/${tournament.id}/categories`;

  const { state, refetch } = useApiQuery<readonly CategoryDto[]>(
    ['categories', tournament.id],
    (signal) => api.categories.listByTournament(tournament.id, signal),
  );

  useTournamentRefresh(refetch);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description={`Categories in ${tournament.name}.`}
        actions={
          <Button asChild>
            <Link to={`${base}/new`}>Create category</Link>
          </Button>
        }
      />

      {state.status === 'loading' ? <LoadingState label="Loading categories…" /> : null}

      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} title="Could not load categories" />
      ) : null}

      {state.status === 'loaded' && state.data.length === 0 ? (
        <EmptyState
          title="No categories yet"
          description="Create the first category to start registering players and teams."
          action={
            <Button asChild variant="outline">
              <Link to={`${base}/new`}>Create category</Link>
            </Button>
          }
        />
      ) : null}

      {state.status === 'loaded' && state.data.length > 0 ? (
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data.map((category) => (
                <TableRow key={category.id}>
                  <TableCell className="font-medium">{category.name}</TableCell>
                  <TableCell>{category.code}</TableCell>
                  <TableCell>
                    <FormatBadge format={category.format} />
                  </TableCell>
                  <TableCell>
                    {category.gender ? humanizeEnum(category.gender) : orDash(null)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge kind="category" status={category.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link to={`${base}/${category.id}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      ) : null}
    </div>
  );
}
