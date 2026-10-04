import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { useTournament } from '@/components/tournaments/context.tsx';
import { LifecycleActions } from '@/components/tournaments/lifecycle-actions.tsx';
import { TournamentBackupCard } from '@/components/tournaments/tournament-backup.tsx';
import { useMutation } from '@/hooks/use-mutation.ts';
import { tournamentNextStatuses } from '@/lib/lifecycle.ts';
import { formatCalendarDate, orDash } from '@/lib/format.ts';

/** Tournament details: setup summary, lifecycle and navigation to sub-areas. */
export function TournamentDetailsPage() {
  const api = useApi();
  const { tournament, refetch } = useTournament();
  const mutation = useMutation<unknown>();

  const links = [
    { to: 'dashboard', label: 'Dashboard' },
    { to: 'courts', label: 'Court board' },
    { to: 'courts/manage', label: 'Courts' },
    { to: 'categories', label: 'Categories' },
    { to: 'players', label: 'Players' },
    { to: 'teams', label: 'Teams' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={tournament.name}
        description={tournament.description ?? undefined}
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="edit">Edit</Link>
            </Button>
          </>
        }
      />

      {mutation.error ? (
        <ErrorState error={mutation.error} title="Lifecycle change failed" />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Detail label="Start date" value={formatCalendarDate(tournament.startDate)} />
              <Detail label="End date" value={formatCalendarDate(tournament.endDate)} />
              <Detail label="Location" value={orDash(tournament.location)} />
              <Detail label="Timezone" value={tournament.timezone} />
              <Detail
                label="Status"
                value={<StatusBadge kind="tournament" status={tournament.status} />}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Registration is only accepted while the tournament is registration open and the
              category is open.
            </p>
            <LifecycleActions
              kind="tournament"
              currentStatus={tournament.status}
              nextStatuses={tournamentNextStatuses(tournament.status)}
              pending={mutation.pending}
              onTransition={async (status) => {
                await mutation.run(async () => {
                  await api.tournaments.transition(tournament.id, status);
                  refetch();
                });
              }}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Setup</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {links.map((link) => (
              <Button key={link.to} asChild variant="outline" size="sm">
                <Link to={link.to}>{link.label}</Link>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <TournamentBackupCard />
    </div>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
