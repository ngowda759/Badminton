import { useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { PlayerDto } from '@/api/types.ts';
import { PageHeader } from '@/components/page-header.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { LoadingState } from '@/components/states.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
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

/** Player detail with inline editing of name and contact details. */
export function PlayerDetailPage() {
  const api = useApi();
  const { playerId = '' } = useParams();
  const { remember } = useRecent();

  const { state, refetch } = useApiQuery<PlayerDto>(['player', playerId], (signal) =>
    api.players.get(playerId, signal),
  );

  if (state.status === 'loading') {
    return <LoadingState label="Loading player…" rows={3} />;
  }
  if (state.status === 'error') {
    return <ErrorState error={state.error} onRetry={refetch} title="Could not load player" />;
  }

  const player = state.data;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link className="hover:text-foreground underline-offset-4 hover:underline" to="/players">
          Players
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-foreground">{player.name}</span>
      </nav>

      <PageHeader title={player.name} description="Player details" />

      <Card>
        <CardHeader>
          <CardTitle>Edit player</CardTitle>
        </CardHeader>
        <CardContent>
          <EditPlayerForm
            player={player}
            onSaved={(updated) => {
              remember('players', { id: updated.id, label: updated.name });
              refetch();
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function EditPlayerForm({
  player,
  onSaved,
}: {
  readonly player: PlayerDto;
  readonly onSaved: (player: PlayerDto) => void;
}) {
  const api = useApi();
  const [name, setName] = useState(player.name);
  const [email, setEmail] = useState(player.email ?? '');
  const [phone, setPhone] = useState(player.phone ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation<PlayerDto>();

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
      const updated = await api.players.update(player.id, {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      onSaved(updated);
      return updated;
    });
  };

  const serverErrors = fieldErrors(mutation.error);

  return (
    <form className="grid max-w-2xl gap-4 sm:grid-cols-3 sm:items-end" onSubmit={submit} noValidate>
      <FormField
        label="Name"
        required
        error={errors.name ?? serverErrors.name}
        htmlFor="edit-player-name"
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
        htmlFor="edit-player-email"
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
        htmlFor="edit-player-phone"
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
          {mutation.pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
      {mutation.error ? (
        <div className="sm:col-span-3">
          <ErrorState error={mutation.error} title="Could not update player" />
        </div>
      ) : null}
    </form>
  );
}
