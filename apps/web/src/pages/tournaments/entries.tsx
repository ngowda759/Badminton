import { useState, type SubmitEvent } from 'react';

import { useApi } from '@/api/context.tsx';
import type { CategoryDto, EntryDto, RegisterEntryInput } from '@/api/types.ts';
import { ErrorState } from '@/components/error-state.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { ConfirmDialog } from '@/components/confirm-dialog.tsx';
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
import { useCategory } from '@/components/tournaments/context.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useCompetitorNames } from '@/hooks/use-competitor-names.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { formatCalendarDate } from '@/lib/format.ts';
import { toDisplayMessage } from '@/lib/errors.ts';
import { entryNextStatuses, transitionActionLabel } from '@/lib/lifecycle.ts';

/**
 * Category entries: list, registration and lifecycle.
 *
 * Singles categories take a player id, doubles categories take a team id. The
 * backend stays authoritative for membership, team size, duplicates and
 * category compatibility; failures are displayed rather than pre-empted.
 */
export function EntriesPage() {
  const api = useApi();
  const { category, tournament } = useCategory();

  const { state, refetch } = useApiQuery<readonly EntryDto[]>(['entries', category.id], (signal) =>
    api.entries.listByCategory(category.id, signal),
  );

  const entries = state.status === 'loaded' ? state.data : [];
  const { playerNames, teamNames } = useCompetitorNames(
    entries.map((entry) => entry.playerId).filter((id): id is string => id !== null),
    entries.map((entry) => entry.teamId).filter((id): id is string => id !== null),
  );

  const registrationOpen = category.status === 'OPEN' && tournament.status === 'REGISTRATION_OPEN';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Entries"
        description={
          category.format === 'SINGLES'
            ? 'Players registered in this singles category.'
            : 'Teams registered in this doubles category.'
        }
      />

      {!registrationOpen ? (
        <Alert variant="warning">
          <AlertDescription>
            Registration is closed. The category must be Open and the tournament must be
            Registration open before a new entry can be registered.
          </AlertDescription>
        </Alert>
      ) : null}

      <RegisterEntryCard category={category} disabled={!registrationOpen} onRegistered={refetch} />

      {state.status === 'loading' ? <LoadingState label="Loading entries…" /> : null}
      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} title="Could not load entries" />
      ) : null}

      {state.status === 'loaded' && state.data.length === 0 ? (
        <EmptyState
          title="No entries registered"
          description={
            category.format === 'SINGLES'
              ? 'Register a player to add the first entry.'
              : 'Register a team to add the first entry.'
          }
        />
      ) : null}

      {state.status === 'loaded' && state.data.length > 0 ? (
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Competitor</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Seed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  playerName={entry.playerId ? playerNames[entry.playerId] : undefined}
                  teamName={entry.teamId ? teamNames[entry.teamId] : undefined}
                  onChanged={refetch}
                />
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      ) : null}
    </div>
  );
}

interface EntryRowProps {
  readonly entry: EntryDto;
  readonly playerName: string | undefined;
  readonly teamName: string | undefined;
  readonly onChanged: () => void;
}

function EntryRow({ entry, playerName, teamName, onChanged }: EntryRowProps) {
  const api = useApi();
  const mutation = useMutation<unknown>();
  const [confirm, setConfirm] = useState<'WITHDRAWN' | 'DISQUALIFIED' | undefined>(undefined);
  const [seed, setSeed] = useState(entry.seed === null ? '' : String(entry.seed));

  const competitor =
    entry.playerId !== null
      ? (playerName ?? '…')
      : entry.teamId !== null
        ? (teamName ?? '…')
        : 'Unknown';

  const active = entry.status === 'PENDING' || entry.status === 'CONFIRMED';
  const nextStatuses = entryNextStatuses(entry.status);

  const run = (task: () => Promise<unknown>): void => {
    void mutation.run(async () => {
      await task();
      onChanged();
    });
  };

  const perform = (status: string): void => {
    if (status === 'WITHDRAWN') {
      run(() => api.entries.withdraw(entry.id));
    } else if (status === 'DISQUALIFIED') {
      run(() => api.entries.disqualify(entry.id));
    } else if (status === 'CONFIRMED') {
      run(() => api.entries.confirm(entry.id));
    }
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{competitor}</TableCell>
      <TableCell>{entry.playerId !== null ? 'Singles (player)' : 'Doubles (team)'}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <label className="sr-only" htmlFor={`seed-${entry.id}`}>
            Seed
          </label>
          <Input
            id={`seed-${entry.id}`}
            type="number"
            min={1}
            className="h-8 w-20"
            value={seed}
            disabled={!active || mutation.pending}
            onChange={(event) => {
              setSeed(event.target.value);
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!active || mutation.pending}
            onClick={() => {
              run(() =>
                api.entries.update(entry.id, {
                  seed: seed.trim() === '' ? null : Number(seed),
                }),
              );
            }}
          >
            Save
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <StatusBadge kind="entry" status={entry.status} />
      </TableCell>
      <TableCell>{formatCalendarDate(entry.registeredAt)}</TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-1">
          {nextStatuses.map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={
                status === 'WITHDRAWN'
                  ? 'outline'
                  : status === 'DISQUALIFIED'
                    ? 'destructive'
                    : 'default'
              }
              disabled={mutation.pending}
              onClick={() => {
                if (status === 'WITHDRAWN' || status === 'DISQUALIFIED') {
                  setConfirm(status);
                } else {
                  perform(status);
                }
              }}
            >
              {transitionActionLabel(status)}
            </Button>
          ))}
        </div>
        {mutation.error ? (
          <p className="text-destructive mt-1 text-xs">{toDisplayMessage(mutation.error)}</p>
        ) : null}

        <ConfirmDialog
          open={confirm !== undefined}
          onOpenChange={(open) => {
            if (!open) {
              setConfirm(undefined);
            }
          }}
          title={confirm ? `${transitionActionLabel(confirm)} entry?` : ''}
          description={
            confirm === 'WITHDRAWN'
              ? 'This will remove the competitor from active registration.'
              : confirm === 'DISQUALIFIED'
                ? 'This permanently disqualifies the competitor from the category.'
                : undefined
          }
          confirmLabel={confirm ? transitionActionLabel(confirm) : 'Confirm'}
          destructive={confirm === 'DISQUALIFIED'}
          pending={mutation.pending}
          onConfirm={() => {
            const status = confirm;
            setConfirm(undefined);
            if (status) {
              perform(status);
            }
          }}
        />
      </TableCell>
    </TableRow>
  );
}

interface RegisterEntryCardProps {
  readonly category: CategoryDto;
  readonly disabled: boolean;
  readonly onRegistered: () => void;
}

/** Registers a new entry; the competitor kind is fixed by the category format. */
function RegisterEntryCard({ category, disabled, onRegistered }: RegisterEntryCardProps) {
  const api = useApi();
  const [competitorId, setCompetitorId] = useState('');
  const [seed, setSeed] = useState('');
  const mutation = useMutation<unknown>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const id = competitorId.trim();
    if (id.length === 0) {
      return;
    }
    const payload: RegisterEntryInput =
      category.format === 'SINGLES'
        ? { playerId: id, ...(seed.trim() ? { seed: Number(seed) } : {}) }
        : { teamId: id, ...(seed.trim() ? { seed: Number(seed) } : {}) };

    void mutation.run(async () => {
      await api.entries.register(category.id, payload);
      setCompetitorId('');
      setSeed('');
      onRegistered();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register entry</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid max-w-2xl gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          onSubmit={submit}
        >
          <FormField
            label={category.format === 'SINGLES' ? 'Player ID' : 'Team ID'}
            required
            htmlFor="entry-competitor"
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                value={competitorId}
                disabled={disabled}
                onChange={(event) => {
                  setCompetitorId(event.target.value);
                }}
              />
            )}
          </FormField>

          <FormField label="Seed" htmlFor="entry-seed">
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="number"
                min={1}
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                value={seed}
                disabled={disabled}
                onChange={(event) => {
                  setSeed(event.target.value);
                }}
              />
            )}
          </FormField>

          <Button type="submit" disabled={disabled || mutation.pending}>
            {mutation.pending ? 'Registering…' : 'Register'}
          </Button>
        </form>

        {mutation.error ? <ErrorState error={mutation.error} title="Registration failed" /> : null}
      </CardContent>
    </Card>
  );
}
