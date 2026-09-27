import { useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { EntryDto, MatchDto, MatchParticipantDto } from '@/api/types.ts';
import { PageHeader } from '@/components/page-header.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useCategory } from '@/components/tournaments/context.tsx';
import { LifecycleActions } from '@/components/tournaments/lifecycle-actions.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { orDash } from '@/lib/format.ts';
import { matchNextStatuses } from '@/lib/lifecycle.ts';
import {
  compactErrors,
  validateOptionalPositiveInteger,
  validatePositiveInteger,
  type FieldErrors,
} from '@/lib/form-validation.ts';

/**
 * Match detail: metadata, lifecycle and manual participant assignment.
 *
 * Only two slots exist (1 and 2). No scoring, winner selection or automatic
 * advancement is performed or displayed.
 */
export function MatchDetailPage() {
  const api = useApi();
  const { tournament, category } = useCategory();
  const { matchId = '' } = useParams();

  const matchQuery = useApiQuery<MatchDto>(['match', matchId], (signal) =>
    api.matches.get(matchId, signal),
  );
  const participantQuery = useApiQuery<readonly MatchParticipantDto[]>(
    ['match-participants', matchId],
    (signal) => api.matches.listParticipants(matchId, signal),
  );
  const mutation = useMutation<unknown>();

  if (matchQuery.state.status === 'loading') {
    return <LoadingState label="Loading match…" rows={3} />;
  }
  if (matchQuery.state.status === 'error') {
    return (
      <ErrorState
        error={matchQuery.state.error}
        onRetry={matchQuery.refetch}
        title="Could not load match"
      />
    );
  }

  const match = matchQuery.state.data;
  const stagesHref = `/tournaments/${tournament.id}/categories/${category.id}/stages/${match.stageId}`;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link className="hover:text-foreground underline-offset-4 hover:underline" to={stagesHref}>
          Stage
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-foreground">Match {match.sequence}</span>
      </nav>

      <PageHeader
        title={`Match ${match.sequence}`}
        description={`Round ${orDash(match.roundNumber)} · Match number ${orDash(match.matchNumber)}`}
        actions={<StatusBadge kind="match" status={match.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {mutation.error ? <ErrorState error={mutation.error} title="Transition failed" /> : null}
          <LifecycleActions
            kind="match"
            currentStatus={match.status}
            nextStatuses={matchNextStatuses(match.status)}
            pending={mutation.pending}
            onTransition={async (status) => {
              await mutation.run(async () => {
                await api.matches.transition(match.id, status);
                matchQuery.refetch();
              });
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Edit match</CardTitle>
        </CardHeader>
        <CardContent>
          <EditMatchForm match={match} onSaved={matchQuery.refetch} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Participants</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {participantQuery.state.status === 'loading' ? (
            <LoadingState label="Loading participants…" />
          ) : null}
          {participantQuery.state.status === 'error' ? (
            <ErrorState
              error={participantQuery.state.error}
              onRetry={participantQuery.refetch}
              title="Could not load participants"
            />
          ) : null}
          {participantQuery.state.status === 'loaded' ? (
            <ParticipantSlots
              match={match}
              participants={participantQuery.state.data}
              categoryId={category.id}
              onChanged={participantQuery.refetch}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function EditMatchForm({
  match,
  onSaved,
}: {
  readonly match: MatchDto;
  readonly onSaved: () => void;
}) {
  const api = useApi();
  const [sequence, setSequence] = useState(String(match.sequence));
  const [roundNumber, setRoundNumber] = useState(
    match.roundNumber === null ? '' : String(match.roundNumber),
  );
  const [matchNumber, setMatchNumber] = useState(
    match.matchNumber === null ? '' : String(match.matchNumber),
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation<unknown>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({
      sequence: validatePositiveInteger(sequence, 'Sequence'),
      roundNumber: validateOptionalPositiveInteger(roundNumber, 'Round number'),
      matchNumber: validateOptionalPositiveInteger(matchNumber, 'Match number'),
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    void mutation.run(async () => {
      await api.matches.update(match.id, {
        sequence: Number(sequence),
        roundNumber: roundNumber.trim() ? Number(roundNumber) : null,
        matchNumber: matchNumber.trim() ? Number(matchNumber) : null,
      });
      onSaved();
    });
  };

  return (
    <form className="grid max-w-3xl gap-4 sm:grid-cols-3 sm:items-end" onSubmit={submit} noValidate>
      <FormField label="Sequence" error={errors.sequence} htmlFor="edit-match-sequence">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="number"
            min={1}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={errors.sequence ? true : undefined}
            value={sequence}
            onChange={(event) => {
              setSequence(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField label="Round number" error={errors.roundNumber} htmlFor="edit-match-round">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="number"
            min={1}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={errors.roundNumber ? true : undefined}
            value={roundNumber}
            onChange={(event) => {
              setRoundNumber(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField label="Match number" error={errors.matchNumber} htmlFor="edit-match-number">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="number"
            min={1}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={errors.matchNumber ? true : undefined}
            value={matchNumber}
            onChange={(event) => {
              setMatchNumber(event.target.value);
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
          <ErrorState error={mutation.error} title="Could not update match" />
        </div>
      ) : null}
    </form>
  );
}

function ParticipantSlots({
  match,
  participants,
  categoryId,
  onChanged,
}: {
  readonly match: MatchDto;
  readonly participants: readonly MatchParticipantDto[];
  readonly categoryId: string;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const entriesQuery = useApiQuery<readonly EntryDto[]>(['entries', categoryId], (signal) =>
    api.entries.listByCategory(categoryId, signal),
  );
  const [slot1Entry, setSlot1Entry] = useState('');
  const [slot2Entry, setSlot2Entry] = useState('');
  const mutation = useMutation<unknown>();

  const slot1 = participants.find((participant) => participant.slot === 1);
  const slot2 = participants.find((participant) => participant.slot === 2);

  const labelFor = (entryId: string): string => {
    if (entriesQuery.state.status !== 'loaded') {
      return entryId;
    }
    const entry = entriesQuery.state.data.find((candidate) => candidate.id === entryId);
    if (!entry) {
      return entryId;
    }
    return entry.playerId
      ? `Player entry ${entry.playerId.slice(0, 8)}…`
      : `Team entry ${entry.teamId?.slice(0, 8) ?? ''}…`;
  };

  const assign = (slot: 1 | 2, entryId: string): void => {
    const value = entryId.trim();
    if (value.length === 0) {
      return;
    }
    void mutation.run(async () => {
      await api.matches.addParticipant(match.id, { entryId: value, slot });
      if (slot === 1) {
        setSlot1Entry('');
      } else {
        setSlot2Entry('');
      }
      onChanged();
    });
  };

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border p-3">
          <dt className="text-muted-foreground text-xs uppercase">Slot 1</dt>
          <dd className="mt-1 text-sm">
            {slot1 ? labelFor(slot1.entryId) : <span className="text-muted-foreground">Empty</span>}
          </dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="text-muted-foreground text-xs uppercase">Slot 2</dt>
          <dd className="mt-1 text-sm">
            {slot2 ? labelFor(slot2.entryId) : <span className="text-muted-foreground">Empty</span>}
          </dd>
        </div>
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            assign(1, slot1Entry);
          }}
        >
          <FormField label="Slot 1 entry ID" htmlFor="slot-1-entry" className="flex-1">
            {({ id }) => (
              <Input
                id={id}
                value={slot1Entry}
                disabled={Boolean(slot1)}
                placeholder={slot1 ? 'Slot filled' : 'Entry UUID'}
                onChange={(event) => {
                  setSlot1Entry(event.target.value);
                }}
              />
            )}
          </FormField>
          <Button type="submit" disabled={mutation.pending || Boolean(slot1)}>
            Assign
          </Button>
        </form>

        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            assign(2, slot2Entry);
          }}
        >
          <FormField label="Slot 2 entry ID" htmlFor="slot-2-entry" className="flex-1">
            {({ id }) => (
              <Input
                id={id}
                value={slot2Entry}
                disabled={Boolean(slot2)}
                placeholder={slot2 ? 'Slot filled' : 'Entry UUID'}
                onChange={(event) => {
                  setSlot2Entry(event.target.value);
                }}
              />
            )}
          </FormField>
          <Button type="submit" disabled={mutation.pending || Boolean(slot2)}>
            Assign
          </Button>
        </form>
      </div>

      {mutation.error ? (
        <ErrorState error={mutation.error} title="Could not assign participant" />
      ) : null}
      <p className="text-muted-foreground text-xs">
        Only entries from this category that are still active can take a slot; the API enforces
        this.
      </p>
    </div>
  );
}
