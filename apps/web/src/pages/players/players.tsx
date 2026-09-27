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
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { useMutation } from '@/hooks/use-mutation.ts';
import { useRecent } from '@/hooks/use-recent.tsx';
import { fieldErrors } from '@/lib/errors.ts';
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
 * Phase 3 exposes no player collection or search endpoint, so the page does not
 * invent one: it offers creation and a list of recently created/opened players
 * (each re-fetched by id). No fake data is displayed.
 */
export function PlayersPage() {
  const { state } = useRecent();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Players"
        description="Create players and open the ones you have recently worked with."
      />

      <CreatePlayerCard />

      <Card>
        <CardHeader>
          <CardTitle>Recent players</CardTitle>
        </CardHeader>
        <CardContent>
          {state.players.length === 0 ? (
            <EmptyState
              title="No players yet"
              description="Create a player to begin building teams and registering entries."
            />
          ) : (
            <ul className="divide-border divide-y" data-testid="recent-players">
              {state.players.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    className="text-primary text-sm font-medium underline-offset-4 hover:underline"
                    to={`/players/${item.id}`}
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

      <OpenPlayerByIdCard />
    </div>
  );
}

function CreatePlayerCard() {
  const api = useApi();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<string | undefined>(undefined);
  const mutation = useMutation<unknown>();
  const { remember } = useRecent();

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
      remember('players', { id: player.id, label: player.name });
      setCreated(player.name);
      setName('');
      setEmail('');
      setPhone('');
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
