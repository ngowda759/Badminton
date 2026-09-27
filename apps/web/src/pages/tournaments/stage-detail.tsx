import { useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { MatchDto, MatchParticipantDto, StageDto, StandingRowDto } from '@/api/types.ts';
import { PageHeader } from '@/components/page-header.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { BracketSection } from '@/components/tournaments/knockout-bracket.tsx';
import { StandingsTable } from '@/components/tournaments/standings-table.tsx';
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
import { useCategory } from '@/components/tournaments/context.tsx';
import { LifecycleActions } from '@/components/tournaments/lifecycle-actions.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useEntryNames } from '@/hooks/use-entry-names.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { humanizeEnum, orDash } from '@/lib/format.ts';
import { stageNextStatuses } from '@/lib/lifecycle.ts';
import {
  compactErrors,
  validateOptionalPositiveInteger,
  validatePositiveInteger,
  type FieldErrors,
} from '@/lib/form-validation.ts';

/**
 * Stage detail: metadata, lifecycle and its matches.
 *
 * Matches are created manually; there is no draw or bracket generation. Match
 * participants are assigned on the match page.
 */
export function StageDetailPage() {
  const api = useApi();
  const { tournament, category } = useCategory();
  const { stageId = '' } = useParams();

  const stageQuery = useApiQuery<StageDto>(['stage', stageId], (signal) =>
    api.stages.get(stageId, signal),
  );
  const matchQuery = useApiQuery<readonly MatchDto[]>(['matches', stageId], (signal) =>
    api.matches.listByStage(stageId, signal),
  );
  // Include the (eventually-known) stage type in the key so standings are only
  // requested for GROUP stages; other stages have no standings to derive.
  const stageType = stageQuery.state.status === 'loaded' ? stageQuery.state.data.type : 'UNKNOWN';
  const standingsQuery = useApiQuery<readonly StandingRowDto[]>(
    ['standings', stageId, stageType],
    (signal) =>
      stageType === 'GROUP'
        ? api.stages.standings(stageId, signal)
        : Promise.resolve([] as readonly StandingRowDto[]),
  );
  const { nameFor } = useEntryNames(category.id);
  const mutation = useMutation<unknown>();
  // Bumping this token refetches the bracket after a result is recorded.
  const [bracketToken, setBracketToken] = useState(0);

  if (stageQuery.state.status === 'loading') {
    return <LoadingState label="Loading stage…" rows={3} />;
  }
  if (stageQuery.state.status === 'error') {
    return (
      <ErrorState
        error={stageQuery.state.error}
        onRetry={stageQuery.refetch}
        title="Could not load stage"
      />
    );
  }

  const stage = stageQuery.state.data;
  // Matches are siblings of stages under the category route (see routes.tsx),
  // not nested beneath the stage, so the match link omits the stage segment.
  const categoryBase = `/tournaments/${tournament.id}/categories/${category.id}`;
  // A bracket exists once its matches have been generated; the backend then
  // rejects any change to the bracket size, so the field is locked here too.
  const bracketGenerated =
    stage.type === 'KNOCKOUT' &&
    matchQuery.state.status === 'loaded' &&
    matchQuery.state.data.length > 0;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link
          className="hover:text-foreground underline-offset-4 hover:underline"
          to={`/tournaments/${tournament.id}/categories/${category.id}/stages`}
        >
          Stages
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-foreground">{stage.name}</span>
      </nav>

      <PageHeader
        title={stage.name}
        description={`${humanizeEnum(stage.type)} stage · sequence ${stage.sequence}`}
        actions={<StatusBadge kind="stage" status={stage.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Lifecycle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {mutation.error ? <ErrorState error={mutation.error} title="Transition failed" /> : null}
          <LifecycleActions
            kind="stage"
            currentStatus={stage.status}
            nextStatuses={stageNextStatuses(stage.status)}
            pending={mutation.pending}
            onTransition={async (status) => {
              await mutation.run(async () => {
                await api.stages.transition(stage.id, status);
                stageQuery.refetch();
              });
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Edit stage</CardTitle>
        </CardHeader>
        <CardContent>
          <EditStageForm
            stage={stage}
            drawSizeLocked={bracketGenerated}
            onSaved={() => {
              stageQuery.refetch();
              matchQuery.refetch();
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Matches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {stage.type === 'GROUP' ? (
            <CreateMatchForm stageId={stage.id} onCreated={matchQuery.refetch} />
          ) : (
            <p className="text-muted-foreground text-sm">
              Knockout matches are created with the bracket; use the bracket above to view and open
              them.
            </p>
          )}

          {matchQuery.state.status === 'loading' ? <LoadingState label="Loading matches…" /> : null}
          {matchQuery.state.status === 'error' ? (
            <ErrorState
              error={matchQuery.state.error}
              onRetry={matchQuery.refetch}
              title="Could not load matches"
            />
          ) : null}
          {matchQuery.state.status === 'loaded' && matchQuery.state.data.length === 0 ? (
            <EmptyState
              title="No matches yet"
              description={
                stage.type === 'GROUP'
                  ? 'Create a match to assign participants.'
                  : 'Generate the bracket to create the knockout matches.'
              }
            />
          ) : null}
          {matchQuery.state.status === 'loaded' && matchQuery.state.data.length > 0 ? (
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sequence</TableHead>
                    <TableHead>Round</TableHead>
                    <TableHead>Match #</TableHead>
                    <TableHead>Participants</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matchQuery.state.data.map((match) => (
                    <TableRow key={match.id}>
                      <TableCell>{match.sequence}</TableCell>
                      <TableCell>{orDash(match.roundNumber)}</TableCell>
                      <TableCell>{orDash(match.matchNumber)}</TableCell>
                      <TableCell>
                        <MatchParticipantsCell matchId={match.id} nameFor={nameFor} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="match" status={match.status} />
                      </TableCell>
                      <TableCell>
                        <MatchResultCell match={match} nameFor={nameFor} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`${categoryBase}/matches/${match.id}`}>Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          ) : null}
        </CardContent>
      </Card>

      {stage.type === 'KNOCKOUT' ? (
        <Card>
          <CardHeader>
            <CardTitle>Knockout bracket</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <BracketSection
              stageId={stage.id}
              categoryId={category.id}
              matchHref={(matchId) => `${categoryBase}/matches/${matchId}`}
              refreshToken={bracketToken}
              onGenerated={() => {
                setBracketToken((token) => token + 1);
                stageQuery.refetch();
                matchQuery.refetch();
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                Winners advance automatically when a match result is recorded. Unfilled later-round
                slots show as TBD.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setBracketToken((token) => token + 1);
                  matchQuery.refetch();
                }}
              >
                Refresh bracket
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {stage.type === 'GROUP' ? (
        <Card>
          <CardHeader>
            <CardTitle>Standings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {standingsQuery.state.status === 'loading' ? (
              <LoadingState label="Loading standings…" />
            ) : null}
            {standingsQuery.state.status === 'error' ? (
              <ErrorState
                error={standingsQuery.state.error}
                onRetry={standingsQuery.refetch}
                title="Could not load standings"
              />
            ) : null}
            {standingsQuery.state.status === 'loaded' && standingsQuery.state.data.length === 0 ? (
              <EmptyState
                title="No standings yet"
                description="Standings appear once group matches are completed."
              />
            ) : null}
            {standingsQuery.state.status === 'loaded' && standingsQuery.state.data.length > 0 ? (
              <StandingsTable rows={standingsQuery.state.data} nameFor={nameFor} />
            ) : null}
            <p className="text-muted-foreground text-xs">
              Standings are derived from completed matches and cannot be edited. Ties break on match
              wins, then game difference, then point difference, then entry name.
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** Resolves and shows both participant names for a match list row. */
function MatchParticipantsCell({
  matchId,
  nameFor,
}: {
  readonly matchId: string;
  readonly nameFor: (entryId: string) => string;
}) {
  const api = useApi();
  const query = useApiQuery<readonly MatchParticipantDto[]>(
    ['match-participants', matchId],
    (signal) => api.matches.listParticipants(matchId, signal),
  );

  if (query.state.status !== 'loaded') {
    return <span className="text-muted-foreground">—</span>;
  }
  const slot1 = query.state.data.find((participant) => participant.slot === 1);
  const slot2 = query.state.data.find((participant) => participant.slot === 2);
  if (!slot1 && !slot2) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="text-sm">
      {slot1 ? nameFor(slot1.entryId) : '—'} <span className="text-muted-foreground">vs</span>{' '}
      {slot2 ? nameFor(slot2.entryId) : '—'}
    </span>
  );
}

/** Shows the derived winner for a completed match, or a dash otherwise. */
function MatchResultCell({
  match,
  nameFor,
}: {
  readonly match: MatchDto;
  readonly nameFor: (entryId: string) => string;
}) {
  if (match.status !== 'COMPLETED' || !match.winnerEntryId) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span className="text-sm">{nameFor(match.winnerEntryId)}</span>;
}

function EditStageForm({
  stage,
  drawSizeLocked,
  onSaved,
}: {
  readonly stage: StageDto;
  readonly drawSizeLocked: boolean;
  readonly onSaved: () => void;
}) {
  const api = useApi();
  const [name, setName] = useState(stage.name);
  const [sequence, setSequence] = useState(String(stage.sequence));
  const [drawSize, setDrawSize] = useState(stage.drawSize === null ? '' : String(stage.drawSize));
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation<unknown>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({
      sequence: validatePositiveInteger(sequence, 'Sequence'),
      // The bracket size is fixed once the bracket exists, so it is not
      // validated or sent at all in that state.
      drawSize: drawSizeLocked ? undefined : validateOptionalPositiveInteger(drawSize, 'Draw size'),
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    void mutation.run(async () => {
      await api.stages.update(stage.id, {
        name: name.trim(),
        sequence: Number(sequence),
        ...(drawSizeLocked ? {} : { drawSize: drawSize.trim() ? Number(drawSize) : null }),
      });
      onSaved();
    });
  };

  return (
    <form className="grid max-w-3xl gap-4 sm:grid-cols-3 sm:items-end" onSubmit={submit} noValidate>
      <FormField label="Name" htmlFor="edit-stage-name">
        {({ id }) => (
          <Input
            id={id}
            value={name}
            maxLength={200}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField label="Sequence" error={errors.sequence} htmlFor="edit-stage-sequence">
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
      <FormField label="Draw size" error={errors.drawSize} htmlFor="edit-stage-draw-size">
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="number"
            min={1}
            disabled={drawSizeLocked}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={errors.drawSize ? true : undefined}
            value={drawSize}
            onChange={(event) => {
              setDrawSize(event.target.value);
            }}
          />
        )}
      </FormField>
      {drawSizeLocked ? (
        <p className="text-muted-foreground text-xs sm:col-span-3">
          The bracket size is fixed once the bracket has been generated.
        </p>
      ) : null}
      <div className="sm:col-span-3">
        <Button type="submit" disabled={mutation.pending}>
          {mutation.pending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
      {mutation.error ? (
        <div className="sm:col-span-3">
          <ErrorState error={mutation.error} title="Could not update stage" />
        </div>
      ) : null}
    </form>
  );
}

function CreateMatchForm({
  stageId,
  onCreated,
}: {
  readonly stageId: string;
  readonly onCreated: () => void;
}) {
  const api = useApi();
  const [sequence, setSequence] = useState('1');
  const [roundNumber, setRoundNumber] = useState('');
  const [matchNumber, setMatchNumber] = useState('');
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
      await api.matches.create(stageId, {
        sequence: Number(sequence),
        ...(roundNumber.trim() ? { roundNumber: Number(roundNumber) } : {}),
        ...(matchNumber.trim() ? { matchNumber: Number(matchNumber) } : {}),
      });
      setSequence('1');
      setRoundNumber('');
      setMatchNumber('');
      onCreated();
    });
  };

  return (
    <form className="grid max-w-3xl gap-4 sm:grid-cols-4 sm:items-end" onSubmit={submit} noValidate>
      <FormField label="Sequence" required error={errors.sequence} htmlFor="match-sequence">
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
      <FormField label="Round number" error={errors.roundNumber} htmlFor="match-round">
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
      <FormField label="Match number" error={errors.matchNumber} htmlFor="match-number">
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
      <Button type="submit" disabled={mutation.pending}>
        {mutation.pending ? 'Creating…' : 'Create match'}
      </Button>
      {mutation.error ? (
        <div className="sm:col-span-4">
          <ErrorState error={mutation.error} title="Could not create match" />
        </div>
      ) : null}
    </form>
  );
}
