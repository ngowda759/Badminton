import { useState, type ReactNode, type SubmitEvent } from 'react';

import { useApi } from '@/api/context.tsx';
import type { CourtDto, MatchDto } from '@/api/types.ts';
import { ErrorState } from '@/components/error-state.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { compactErrors, validateRequired, type FieldErrors } from '@/lib/form-validation.ts';
import { formatDateTime, orDash } from '@/lib/format.ts';

/**
 * Court assignment and time window for a match.
 *
 * Scheduling is operator-controlled: the panel only lets the operator pick an
 * active court and a start/end pair, and delegates every rule (ownership,
 * inactivity, overlap, lifecycle) to the API. A scheduled match can be cleared
 * while it is still SCHEDULED; a live or completed match is read-only.
 */
export function MatchSchedulePanel({
  match,
  tournamentId,
  onChanged,
}: {
  readonly match: MatchDto;
  readonly tournamentId: string;
  readonly onChanged: () => void;
}) {
  const api = useApi();
  const mutation = useMutation<unknown>();

  const courtQuery = useApiQuery<readonly CourtDto[]>(['courts', tournamentId], (signal) =>
    api.courts.listByTournament(tournamentId, signal),
  );

  const activeCourts =
    courtQuery.state.status === 'loaded'
      ? courtQuery.state.data.filter((court) => court.status === 'ACTIVE')
      : [];

  const allCourts = courtQuery.state.status === 'loaded' ? courtQuery.state.data : [];
  const currentCourt = allCourts.find((court) => court.id === match.courtId);
  const currentCourtLabel = currentCourt
    ? `Court ${String(currentCourt.number)} — ${currentCourt.name}`
    : match.courtId
      ? 'Assigned court'
      : '—';

  const canEdit = match.status === 'SCHEDULED';
  const isScheduled = match.courtId !== null;

  const [courtId, setCourtId] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({
      courtId: validateRequired(courtId, 'Court'),
      start: validateRequired(start, 'Start time'),
      end: validateRequired(end, 'End time'),
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    void mutation.run(async () => {
      await api.matches.schedule(match.id, {
        courtId,
        scheduledStartAt: new Date(start).toISOString(),
        scheduledEndAt: new Date(end).toISOString(),
      });
      setStart('');
      setEnd('');
      onChanged();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Court &amp; schedule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isScheduled ? (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Detail label="Court" value={currentCourtLabel} />
            <Detail label="Status" value={<StatusBadge kind="match" status={match.status} />} />
            <Detail label="Starts" value={orDash(formatDateTime(match.scheduledStartAt))} />
            <Detail label="Ends" value={orDash(formatDateTime(match.scheduledEndAt))} />
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">
            This match has no court or time yet. Assign one to place it on the court board.
          </p>
        )}

        {mutation.error ? (
          <ErrorState error={mutation.error} title="Could not update the schedule" />
        ) : null}

        {!canEdit ? (
          <p className="text-muted-foreground text-sm">
            A match can only be scheduled or cleared while it is scheduled.
          </p>
        ) : (
          <>
            <form
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end"
              onSubmit={submit}
              noValidate
            >
              <FormField label="Court" required error={errors.courtId} htmlFor="schedule-court">
                {({ id, describedBy }) => (
                  <Select value={courtId} onValueChange={setCourtId}>
                    <SelectTrigger id={id} aria-label="Court" aria-describedby={describedBy}>
                      <SelectValue placeholder="Select a court" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeCourts.map((court) => (
                        <SelectItem key={court.id} value={court.id}>
                          Court {court.number} — {court.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>

              <FormField label="Start" required error={errors.start} htmlFor="schedule-start">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                    aria-invalid={errors.start ? true : undefined}
                    value={start}
                    onChange={(event) => {
                      setStart(event.target.value);
                    }}
                  />
                )}
              </FormField>

              <FormField label="End" required error={errors.end} htmlFor="schedule-end">
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    type="datetime-local"
                    {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                    aria-invalid={errors.end ? true : undefined}
                    value={end}
                    onChange={(event) => {
                      setEnd(event.target.value);
                    }}
                  />
                )}
              </FormField>

              <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
                <Button type="submit" disabled={mutation.pending}>
                  {mutation.pending
                    ? 'Saving…'
                    : isScheduled
                      ? 'Update schedule'
                      : 'Schedule match'}
                </Button>
                {isScheduled ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={mutation.pending}
                    onClick={() => {
                      void mutation.run(async () => {
                        await api.matches.unschedule(match.id);
                        onChanged();
                      });
                    }}
                  >
                    Clear schedule
                  </Button>
                ) : null}
              </div>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
