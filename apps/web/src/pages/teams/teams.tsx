import { useState, type SubmitEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { EmptyState } from '@/components/states.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useMutation } from '@/hooks/use-mutation.ts';
import { useRecent } from '@/hooks/use-recent.tsx';
import { fieldErrors } from '@/lib/errors.ts';
import { compactErrors, validateRequired, type FieldErrors } from '@/lib/form-validation.ts';

/**
 * Team management.
 *
 * Phase 3 exposes no team collection endpoint, so the page offers creation and
 * a list of recently created/opened teams (re-fetched by id). Membership is
 * managed on the team detail page; the doubles "exactly two members" rule is
 * enforced at registration, not in this generic editor.
 */
export function TeamsPage() {
  const { state } = useRecent();

  return (
    <div className="space-y-6">
      <PageHeader title="Teams" description="Create teams and manage their members." />

      <CreateTeamCard />

      <Card>
        <CardHeader>
          <CardTitle>Recent teams</CardTitle>
        </CardHeader>
        <CardContent>
          {state.teams.length === 0 ? (
            <EmptyState
              title="No teams yet"
              description="Create a team to register it in a doubles category."
            />
          ) : (
            <ul className="divide-border divide-y" data-testid="recent-teams">
              {state.teams.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                    to={`/teams/${item.id}`}
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

      <OpenTeamByIdCard />
    </div>
  );
}

function CreateTeamCard() {
  const api = useApi();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>(['']);
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation<unknown>();
  const { remember } = useRecent();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({ name: validateRequired(name, 'Team name') });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const cleanMembers = memberIds.map((id) => id.trim()).filter((id) => id.length > 0);

    void mutation.run(async () => {
      const team = await api.teams.create({
        name: name.trim(),
        ...(cleanMembers.length > 0 ? { memberPlayerIds: cleanMembers } : {}),
      });
      remember('teams', { id: team.id, label: team.name });
      void navigate(`/teams/${team.id}`);
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
