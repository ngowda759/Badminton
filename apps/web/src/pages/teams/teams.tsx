import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { TeamListItemDto } from '@/api/types.ts';
import { useApi } from '@/api/context.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { FormField } from '@/components/form-field.tsx';
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
import { useMutation } from '@/hooks/use-mutation.ts';
import { fieldErrors } from '@/lib/errors.ts';
import { formatCalendarDate } from '@/lib/format.ts';
import { compactErrors, validateRequired, type FieldErrors } from '@/lib/form-validation.ts';

/**
 * Team management.
 *
 * The list is server-backed: `GET /api/v1/teams` returns persisted teams name
 * ascending with a member count (one grouped read, no per-team query). Creating
 * a team refetches the same list so the new team appears from server state.
 * Membership is managed on the team detail page; the doubles "exactly two
 * members" rule is enforced at registration, not in this generic editor.
 */
export function TeamsPage() {
  const api = useApi();
  const collection = useCollection(['teams'], (params, signal) => api.teams.list(params, signal));

  return (
    <div className="space-y-6">
      <PageHeader title="Teams" description="Create teams and manage their members." />

      <CreateTeamCard
        onCreated={() => {
          collection.refetch();
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>All teams</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TeamList collection={collection} />
        </CardContent>
      </Card>

      <OpenTeamByIdCard />
    </div>
  );
}

function TeamList({ collection }: { readonly collection: CollectionResult<TeamListItemDto> }) {
  const { state, hasMore, loadingMore, loadMore, loadMoreError, refetch } = collection;

  if (state.status === 'loading') {
    return <LoadingState label="Loading teams…" />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} title="Could not load teams" onRetry={refetch} />;
  }

  if (state.items.length === 0) {
    return (
      <EmptyState
        title="No teams yet"
        description="Create a team to register it in a doubles category."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="team-list">
      <TableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.items.map((team) => (
              <TableRow key={team.id}>
                <TableCell className="font-medium">
                  <Link
                    className="text-primary underline-offset-4 hover:underline"
                    to={`/teams/${team.id}`}
                  >
                    {team.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{team.memberCount}</TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {formatCalendarDate(team.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/teams/${team.id}`}>View</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableWrapper>

      {loadMoreError ? (
        <ErrorState error={loadMoreError} title="Could not load more teams" onRetry={loadMore} />
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

function CreateTeamCard({ onCreated }: { readonly onCreated: () => void }) {
  const api = useApi();
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>(['']);
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation<unknown>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({ name: validateRequired(name, 'Team name') });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const cleanMembers = memberIds.map((id) => id.trim()).filter((id) => id.length > 0);

    void mutation.run(async () => {
      await api.teams.create({
        name: name.trim(),
        ...(cleanMembers.length > 0 ? { memberPlayerIds: cleanMembers } : {}),
      });
      setName('');
      setMemberIds(['']);
      onCreated();
    });
  };

  const serverErrors = fieldErrors(mutation.error);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create team</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="max-w-2xl space-y-4" onSubmit={submit} noValidate>
          <FormField
            label="Team name"
            required
            error={errors.name ?? serverErrors.name}
            htmlFor="team-name"
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

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Initial members (optional)</legend>
            <p className="text-muted-foreground text-xs">
              Add player IDs. Members can also be managed after the team is created.
            </p>
            {memberIds.map((memberId, index) => (
              <div key={index} className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`member-${index}`}>
                  Player ID {index + 1}
                </label>
                <Input
                  id={`member-${index}`}
                  value={memberId}
                  placeholder="Player UUID"
                  onChange={(event) => {
                    setMemberIds((current) =>
                      current.map((value, position) =>
                        position === index ? event.target.value : value,
                      ),
                    );
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setMemberIds((current) => current.filter((_, position) => position !== index));
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setMemberIds((current) => [...current, '']);
              }}
            >
              Add member
            </Button>
          </fieldset>

          <Button type="submit" disabled={mutation.pending}>
            {mutation.pending ? 'Creating…' : 'Create team'}
          </Button>
        </form>

        {mutation.error ? (
          <ErrorState error={mutation.error} title="Could not create team" />
        ) : null}
      </CardContent>
    </Card>
  );
}

function OpenTeamByIdCard() {
  const navigate = useNavigate();
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Open team by ID</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            const value = teamId.trim();
            if (value.length === 0) {
              setError('Enter a team ID.');
              return;
            }
            setError(undefined);
            void navigate(`/teams/${value}`);
          }}
        >
          <label className="sr-only" htmlFor="open-team-id">
            Team ID
          </label>
          <Input
            id="open-team-id"
            value={teamId}
            placeholder="Team UUID"
            onChange={(event) => {
              setTeamId(event.target.value);
            }}
          />
          <Button type="submit">Open</Button>
        </form>
        {error ? <p className="text-destructive mt-2 text-xs">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
