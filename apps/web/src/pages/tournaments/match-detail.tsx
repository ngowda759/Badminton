import { useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { MatchDto, MatchParticipantDto, MatchResultDto, StageDto } from '@/api/types.ts';
import { PageHeader } from '@/components/page-header.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useCategory } from '@/components/tournaments/context.tsx';
import { ConfirmDialog } from '@/components/confirm-dialog.tsx';
import { LifecycleActions } from '@/components/tournaments/lifecycle-actions.tsx';
import { MatchResultSummary } from '@/components/tournaments/match-result-summary.tsx';
import { MatchSchedulePanel } from '@/components/tournaments/match-schedule-panel.tsx';
import { MatchScoring, type InitialGameScore } from '@/components/tournaments/match-scoring.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useEntryNames } from '@/hooks/use-entry-names.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { orDash } from '@/lib/format.ts';
import { isResultCorrectable } from '@/lib/correction.ts';
import { resolveKnockoutRule, type KnockoutRule, type MatchKind } from '@/lib/scoring.ts';
import { matchNextStatuses } from '@/lib/lifecycle.ts';
import {
  compactErrors,
  validateOptionalPositiveInteger,
  validatePositiveInteger,
  type FieldErrors,
} from '@/lib/form-validation.ts';
import { useTournamentRefresh } from '@/realtime/tournament-refresh.tsx';

/**
 * Match detail: metadata, lifecycle, participant assignment and scoring.
 *
 * Only two slots exist (1 and 2). Scoring is available once the match is in
 * progress; the winner is always derived from the scores by the API, never
 * chosen here. A completed result can be corrected: for a group match the
 * standings are recalculated, and for a knockout match the bracket is
 * re-derived on the server. Phase 8.5 refetches every query on this screen when
 * a tournament realtime event arrives, so an opponent scoring the same match on
 * another device is reflected without a manual refresh.
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
  const resultQuery = useApiQuery<MatchResultDto | null>(['match-result', matchId], (signal) =>
    api.matches.getResult(matchId, signal),
  );
  const mutation = useMutation<unknown>();

  const refreshMatch = (): void => {
    matchQuery.refetch();
    participantQuery.refetch();
    resultQuery.refetch();
  };
  useTournamentRefresh(refreshMatch);

  const { nameFor } = useEntryNames(category.id);

  // A knockout match's participants are filled by bracket generation and
  // progression, so they are read-only here; a group match stays manually
  // assignable as in Phase 5.
  const matchStageId = matchQuery.state.status === 'loaded' ? matchQuery.state.data.stageId : '';
  const stageQuery = useApiQuery<StageDto | null>(['match-stage', matchStageId], (signal) =>
    matchStageId ? api.stages.get(matchStageId, signal) : Promise.resolve(null),
  );
  const isKnockout =
    stageQuery.state.status === 'loaded' && stageQuery.state.data?.type === 'KNOCKOUT';
  const matchKind: MatchKind = isKnockout ? 'KNOCKOUT' : 'GROUP';
  const stageLoaded = stageQuery.state.status === 'loaded';

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
  const participants =
    participantQuery.state.status === 'loaded' ? participantQuery.state.data : [];
  const slot1 = participants.find((participant) => participant.slot === 1);
  const slot2 = participants.find((participant) => participant.slot === 2);
  const slot1Label = slot1 ? nameFor(slot1.entryId) : 'Slot 1';
  const slot2Label = slot2 ? nameFor(slot2.entryId) : 'Slot 2';

  // The knockout match's rule: its snapshot wins, otherwise the stage's
  // configured per-round rule for its bracket position, otherwise the default.
  const stageData = stageQuery.state.status === 'loaded' ? stageQuery.state.data : null;
  const knockoutRule = isKnockout
    ? resolveKnockoutRule(match, stageData, match.roundNumber)
    : undefined;

  const stagesHref = `/tournaments/${tournament.id}/categories/${category.id}/stages/${match.stageId}`;

  const hasTwoParticipants = Boolean(slot1 && slot2);
  const refreshAll = (): void => {
    matchQuery.refetch();
    resultQuery.refetch();
    // A knockout correction re-derives the bracket (the next-round slot and any
    // reset downstream match), so the participant slots and stage status must
    // be refetched too.
    participantQuery.refetch();
    stageQuery.refetch();
  };

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
            // Completion is deliberately not offered here: a match reaches
            // COMPLETED only by recording a validated result in the scoring
            // form, so the bare transition would always be rejected.
            nextStatuses={matchNextStatuses(match.status).filter(
              (status) => status !== 'COMPLETED',
            )}
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

      <MatchSchedulePanel
        match={match}
        tournamentId={tournament.id}
        onChanged={() => {
          matchQuery.refetch();
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Edit match</CardTitle>
        </CardHeader>
        <CardContent>
          {isKnockout ? (
            <p className="text-muted-foreground text-sm">
              A knockout match's round, number and sequence are fixed by the bracket and cannot be
              edited.
            </p>
          ) : (
            <EditMatchForm match={match} onSaved={matchQuery.refetch} />
          )}
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
              nameFor={nameFor}
              onChanged={participantQuery.refetch}
              readOnly={isKnockout}
            />
          ) : null}
        </CardContent>
      </Card>

      {match.status === 'COMPLETED' ? (
        <Card>
          <CardHeader>
            <CardTitle>Result</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {resultQuery.state.status === 'loading' ? (
              <LoadingState label="Loading result…" />
            ) : null}
            {resultQuery.state.status === 'error' ? (
              <ErrorState
                error={resultQuery.state.error}
                onRetry={resultQuery.refetch}
                title="Could not load result"
              />
            ) : null}
            {resultQuery.state.status === 'loaded' && resultQuery.state.data ? (
              <MatchResultSummary
                result={resultQuery.state.data}
                slot1Label={slot1Label}
                slot2Label={slot2Label}
              />
            ) : null}
            {isKnockout ? (
              <p className="text-muted-foreground text-sm">
                The winner has advanced to the next knockout round. Correcting the result re-derives
                the bracket: the next round is re-seeded and any already-decided downstream match is
                reset.
              </p>
            ) : null}
            {isResultCorrectable(match.status) ? (
              <ResultCorrection
                matchId={match.id}
                matchKind={matchKind}
                slot1Label={slot1Label}
                slot2Label={slot2Label}
                {...(knockoutRule ? { rule: knockoutRule } : {})}
                {...(resultQuery.state.status === 'loaded' && resultQuery.state.data
                  ? { initialGames: resultQuery.state.data.games }
                  : {})}
                onCorrected={refreshAll}
              />
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {match.status === 'IN_PROGRESS' ? (
        <Card>
          <CardHeader>
            <CardTitle>Score match</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!hasTwoParticipants ? (
              <p className="text-muted-foreground text-sm">
                Assign both slots before recording a result.
              </p>
            ) : !stageLoaded ? (
              <LoadingState label="Loading scoring format…" />
            ) : (
              <MatchScoring
                matchId={match.id}
                slot1Label={slot1Label}
                slot2Label={slot2Label}
                matchKind={matchKind}
                {...(knockoutRule ? { rule: knockoutRule } : {})}
                onCompleted={refreshAll}
              />
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * Correction control for a completed match.
 *
 * A recorded result can be corrected when it was mistyped. The action is
 * destructive (it replaces the stored result), so it goes through the existing
 * `ConfirmDialog` before the scoring form is revealed, pre-filled from the
 * stored games. Submitting goes through `MatchScoring` in correction mode, so
 * the score-entry UI and its validation are never duplicated. For a knockout
 * match the correction also re-derives the bracket on the server (the
 * next-round slot and any already-decided downstream match are reset), which
 * the confirmation copy makes explicit.
 */
function ResultCorrection({
  matchId,
  matchKind,
  slot1Label,
  slot2Label,
  rule,
  initialGames,
  onCorrected,
}: {
  readonly matchId: string;
  readonly matchKind: MatchKind;
  readonly slot1Label: string;
  readonly slot2Label: string;
  /** The knockout match's scoring rule; ignored for a group match. */
  readonly rule?: KnockoutRule;
  readonly initialGames?: readonly InitialGameScore[];
  readonly onCorrected: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const isKnockout = matchKind === 'KNOCKOUT';

  if (!editing) {
    return (
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Correct result
        </Button>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Correct this result?"
          description={
            isKnockout
              ? 'The recorded score and winner will be replaced. The bracket is re-derived: the winner advances in the next round and any downstream match that was already decided is reset.'
              : 'The recorded score and winner will be replaced. Group standings and qualification are recalculated from the corrected result.'
          }
          confirmLabel="Correct result"
          destructive
          onConfirm={() => {
            setConfirming(false);
            setEditing(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-sm font-medium">Correct result</p>
      <MatchScoring
        matchId={matchId}
        slot1Label={slot1Label}
        slot2Label={slot2Label}
        matchKind={matchKind}
        {...(rule ? { rule } : {})}
        correct
        {...(initialGames ? { initialGames } : {})}
        onCompleted={onCorrected}
      />
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
  nameFor,
  onChanged,
  readOnly = false,
}: {
  readonly match: MatchDto;
  readonly participants: readonly MatchParticipantDto[];
  readonly nameFor: (entryId: string) => string;
  readonly onChanged: () => void;
  /** Knockout participants are bracket-controlled and cannot be assigned here. */
  readonly readOnly?: boolean;
}) {
  const api = useApi();
  const [slot1Entry, setSlot1Entry] = useState('');
  const [slot2Entry, setSlot2Entry] = useState('');
  const mutation = useMutation<unknown>();

  const slot1 = participants.find((participant) => participant.slot === 1);
  const slot2 = participants.find((participant) => participant.slot === 2);

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
            {slot1 ? (
              nameFor(slot1.entryId)
            ) : (
              <span className="text-muted-foreground italic">{readOnly ? 'TBD' : 'Empty'}</span>
            )}
          </dd>
        </div>
        <div className="rounded-md border p-3">
          <dt className="text-muted-foreground text-xs uppercase">Slot 2</dt>
          <dd className="mt-1 text-sm">
            {slot2 ? (
              nameFor(slot2.entryId)
            ) : (
              <span className="text-muted-foreground italic">{readOnly ? 'TBD' : 'Empty'}</span>
            )}
          </dd>
        </div>
      </dl>

      {readOnly ? (
        <p className="text-muted-foreground text-sm">
          Participants are set by the bracket and advance automatically when results are recorded.
        </p>
      ) : (
        <>
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

          <p className="text-muted-foreground text-xs">
            Only entries from this category that are still active can take a slot; the API enforces
            this.
          </p>
        </>
      )}

      {mutation.error ? (
        <ErrorState error={mutation.error} title="Could not assign participant" />
      ) : null}
    </div>
  );
}
