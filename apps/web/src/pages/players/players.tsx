import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { PlayerDto } from '@/api/types.ts';
import { useApi } from '@/api/context.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
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
import { useMutation } from '@/hooks/use-mutation.ts';
import { fieldErrors } from '@/lib/errors.ts';
import { formatCalendarDate, orDash } from '@/lib/format.ts';
import {
  compactErrors,
  validateOptionalEmail,
  validateOptionalPhone,
  validateRequired,
  type FieldErrors,
} from '@/lib/form-validation.ts';

/**
 * Player management.
 *
 * The list is server-backed: `GET /api/v1/players` returns persisted players
 * newest first. Creating a player refetches the same list, so a new player
 * appears from server state - never from browser storage.
 */
export function PlayersPage() {
  const api = useApi();
  const collection = useCollection(['players'], (params, signal) =>
    api.players.list(params, signal),
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Players" description="Create players and open their details." />

      <CreatePlayerCard
        onCreated={() => {
          collection.refetch();
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>All players</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PlayerList collection={collection} />
        </CardContent>
      </Card>

      <OpenPlayerByIdCard />
    </div>
  );
}

function PlayerList({ collection }: { readonly collection: CollectionResult<PlayerDto> }) {
  const { state, hasMore, loadingMore, loadMore, loadMoreError, refetch } = collection;

  if (state.status === 'loading') {
    return <LoadingState label="Loading players…" />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} title="Could not load players" onRetry={refetch} />;
  }

  if (state.items.length === 0) {
    return (
      <EmptyState
        title="No players yet"
        description="Create a player to begin building teams and registering entries."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="player-list">
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Player</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.items.map((player) => (
              <TableRow key={player.id}>
                <TableCell className="font-medium">
                  <Link
                    className="text-primary underline-offset-4 hover:underline"
                    to={`/players/${player.id}`}
                  >
                    {player.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {orDash(player.email ?? player.phone)}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatCalendarDate(player.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/players/${player.id}`}>View</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>

      {loadMoreError ? (
        <ErrorState error={loadMoreError} title="Could not load more players" onRetry={loadMore} />
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

function CreatePlayerCard({ onCreated }: { readonly onCreated: () => void }) {
  const api = useApi();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<string | undefined>(undefined);
  const mutation = useMutation<unknown>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({
      name: validateRequired(name, 'Name'),
      email: validateOptionalEmail(email),
      phone: validateOptionalPhone(phone),
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    void mutation.run(async () => {
      const player = await api.players.create({
        name: name.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      setCreated(player.name);
      setName('');
      setEmail('');
      setPhone('');
      onCreated();
    });
  };

  const serverErrors = fieldErrors(mutation.error);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create player</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid max-w-2xl gap-4 sm:grid-cols-3 sm:items-end"
          onSubmit={submit}
          noValidate
        >
          <FormField
            label="Name"
            required
            error={errors.name ?? serverErrors.name}
            htmlFor="player-name"
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                aria-invalid={(errors.name ?? serverErrors.name) ? true : undefined}
                value={name}
                maxLength={200}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            label="Email"
            error={errors.email ?? serverErrors.email}
            htmlFor="player-email"
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="email"
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                aria-invalid={(errors.email ?? serverErrors.email) ? true : undefined}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField
            label="Phone"
            error={errors.phone ?? serverErrors.phone}
            htmlFor="player-phone"
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="tel"
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                aria-invalid={(errors.phone ?? serverErrors.phone) ? true : undefined}
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                }}
              />
            )}
          </FormField>
          <div className="sm:col-span-3">
            <Button type="submit" disabled={mutation.pending}>
              {mutation.pending ? 'Creating…' : 'Create player'}
            </Button>
          </div>
        </form>

        {created ? (
          <Alert>
            <AlertDescription>Created player “{created}”.</AlertDescription>
          </Alert>
        ) : null}
        {mutation.error ? (
          <ErrorState error={mutation.error} title="Could not create player" />
        ) : null}
      </CardContent>
    </Card>
  );
}

function OpenPlayerByIdCard() {
  const navigate = useNavigate();
  const [playerId, setPlayerId] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open player by ID</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const value = playerId.trim();
            if (value.length === 0) {
              setError('Enter a player ID.');
              return;
            }
            setError(undefined);
            void navigate(`/players/${value}`);
          }}
        >
          <label className="sr-only" htmlFor="open-player-id">
            Player ID
          </label>
          <Input
            id="open-player-id"
            value={playerId}
            placeholder="Player UUID"
            onChange={(event) => {
              setPlayerId(event.target.value);
            }}
          />
          <Button type="submit">Open</Button>
        </form>
        {error ? <p className="text-destructive mt-2 text-xs">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
