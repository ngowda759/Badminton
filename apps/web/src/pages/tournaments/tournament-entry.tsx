import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { PageHeader } from '@/components/page-header.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { EmptyState } from '@/components/states.tsx';
import { useRecent } from '@/hooks/use-recent.tsx';

/**
 * Tournament entry point and recent list.
 *
 * Phase 3 exposes no tournament collection endpoint, so this page does not
 * fabricate one: it directs the operator to create a tournament and lists the
 * tournaments this browser has actually received from the API (each opened by
 * id and re-fetched). No fake or hard-coded data is shown.
 */
export function TournamentEntryPage() {
  const { state } = useRecent();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tournaments"
        description="Create a tournament or open one you have recently worked on."
        actions={
          <Button asChild>
            <Link to="/tournaments/new">Create tournament</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Recent tournaments</CardTitle>
        </CardHeader>
        <CardContent>
          {state.tournaments.length === 0 ? (
            <EmptyState
              title="No tournaments yet"
              description="Create the first tournament to begin setting up categories, entries, stages and matches."
              action={
                <Button asChild variant="outline">
                  <Link to="/tournaments/new">Create tournament</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-border divide-y" data-testid="recent-tournaments">
              {state.tournaments.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                    to={`/tournaments/${item.id}`}
                  >
                    {item.label}
                  </Link>
                  <span className="text-muted-foreground truncate text-xs">{item.id}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <OpenByIdCard />
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
