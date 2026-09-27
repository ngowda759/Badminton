import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { CourtDto } from '@/api/types.ts';
import { ErrorState } from '@/components/error-state.tsx';
import { FormField } from '@/components/form-field.tsx';
import { PageHeader } from '@/components/page-header.tsx';
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
import { useTournament } from '@/components/tournaments/context.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import {
  compactErrors,
  validatePositiveInteger,
  validateRequired,
  type FieldErrors,
} from '@/lib/form-validation.ts';

/**
 * Court management for one tournament.
 *
 * Courts are operator-facing venues, unique by number within their tournament.
 * Activating/deactivating a court does not delete historical schedules: an
 * inactive court simply cannot receive new matches.
 */
export function CourtsManagePage() {
  const api = useApi();
  const { tournament } = useTournament();

  const { state, refetch } = useApiQuery<readonly CourtDto[]>(['courts', tournament.id], (signal) =>
    api.courts.listByTournament(tournament.id, signal),
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
        <span className="text-foreground">Courts</span>
      </nav>

      <PageHeader
        title="Courts"
        description="Add the courts used by this tournament and toggle their availability."
        actions={
          <Button asChild variant="outline">
            <Link to={`/tournaments/${tournament.id}/courts`}>Court board</Link>
          </Button>
        }
      />

      <CreateCourtCard tournamentId={tournament.id} onCreated={refetch} />

      {state.status === 'loading' ? <LoadingState label="Loading courts…" /> : null}
      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} title="Could not load courts" />
      ) : null}

      {state.status === 'loaded' && state.data.length === 0 ? (
        <EmptyState
          title="No courts have been added"
          description="Create a court to begin scheduling matches."
        />
      ) : null}

      {state.status === 'loaded' && state.data.length > 0 ? (
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data.map((court) => (
                <TableRow key={court.id}>
                  <TableCell>{court.number}</TableCell>
                  <TableCell className="font-medium">{court.name}</TableCell>
                  <TableCell>
                    <StatusBadge kind="court" status={court.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <CourtRowActions court={court} onChanged={refetch} />
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

function CourtRowActions({
  court,
  onChanged,
}: {
  readonly court: CourtDto;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const mutation = useMutation<unknown>();
  const nextStatus = court.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={mutation.pending}
        onClick={() => {
          void mutation.run(async () => {
            await api.courts.transition(court.id, nextStatus);
            onChanged();
          });
        }}
      >
        {court.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
      </Button>
      {mutation.error ? <ErrorState error={mutation.error} title="Could not update court" /> : null}
    </div>
  );
}

function CreateCourtCard({
  tournamentId,
  onCreated,
}: {
  readonly tournamentId: string;
  readonly onCreated: () => void;
}) {
  const api = useApi();
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation<unknown>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({
      number: validatePositiveInteger(number, 'Court number'),
      name: validateRequired(name, 'Name'),
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    void mutation.run(async () => {
      await api.courts.create(tournamentId, { number: Number(number), name: name.trim() });
      setNumber('');
      setName('');
      onCreated();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add court</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid max-w-3xl gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end"
          onSubmit={submit}
          noValidate
        >
          <FormField label="Number" required error={errors.number} htmlFor="court-number">
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="number"
                min={1}
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                aria-invalid={errors.number ? true : undefined}
                value={number}
                onChange={(event) => {
                  setNumber(event.target.value);
                }}
              />
            )}
          </FormField>

          <FormField label="Name" required error={errors.name} htmlFor="court-name">
            {({ id, describedBy }) => (
              <Input
                id={id}
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                aria-invalid={errors.name ? true : undefined}
                value={name}
                maxLength={200}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </FormField>

          <div>
            <Button type="submit" disabled={mutation.pending}>
              {mutation.pending ? 'Adding…' : 'Add court'}
            </Button>
          </div>
        </form>

        {mutation.error ? (
          <ErrorState error={mutation.error} title="Could not create court" />
        ) : null}
      </CardContent>
    </Card>
  );
}
