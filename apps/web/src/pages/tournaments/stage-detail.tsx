import { useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { MatchDto, StageDto } from '@/api/types.ts';
import { PageHeader } from '@/components/page-header.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
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
  const mutation = useMutation<unknown>();

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
  const base = `/tournaments/${tournament.id}/categories/${category.id}/stages/${stage.id}`;

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
          <CreateMatchForm stageId={stage.id} onCreated={matchQuery.refetch} />

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
              description="Create a match to assign participants."
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
                    <TableHead>Status</TableHead>
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
                        <StatusBadge kind="match" status={match.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="outline" size="sm">
                          <Link to={`${base}/matches/${match.id}`}>Open</Link>
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
    </div>
  );
}

function EditStageForm({
  stage,
  onSaved,
}: {
  readonly stage: StageDto;
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
      drawSize: validateOptionalPositiveInteger(drawSize, 'Draw size'),
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    void mutation.run(async () => {
      await api.stages.update(stage.id, {
        name: name.trim(),
        sequence: Number(sequence),
        drawSize: drawSize.trim() ? Number(drawSize) : null,
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
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={errors.drawSize ? true : undefined}
            value={drawSize}
            onChange={(event) => {
              setDrawSize(event.target.value);
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
