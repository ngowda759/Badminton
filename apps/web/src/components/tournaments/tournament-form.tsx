import { useState, type SubmitEvent } from 'react';

import type { TournamentDto } from '@/api/types.ts';
import { FormField } from '@/components/form-field.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { useMutation } from '@/hooks/use-mutation.ts';
import { fieldErrors, toDisplayMessage } from '@/lib/errors.ts';
import {
  compactErrors,
  validateDateRange,
  validateRequired,
  type FieldErrors,
} from '@/lib/form-validation.ts';

/** Calendar-date input value (`YYYY-MM-DD`) from an ISO timestamp. */
function toDateInput(value: string | undefined): string {
  if (!value) {
    return '';
  }
  return value.slice(0, 10);
}

export interface TournamentFormValues {
  readonly name: string;
  readonly description: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly location: string;
  readonly timezone: string;
}

export function emptyTournamentForm(): TournamentFormValues {
  return { name: '', description: '', startDate: '', endDate: '', location: '', timezone: 'UTC' };
}

export function tournamentToForm(tournament: TournamentDto): TournamentFormValues {
  return {
    name: tournament.name,
    description: tournament.description ?? '',
    startDate: toDateInput(tournament.startDate),
    endDate: toDateInput(tournament.endDate),
    location: tournament.location ?? '',
    timezone: tournament.timezone,
  };
}

function validate(values: TournamentFormValues): FieldErrors {
  const dateErrors = validateDateRange(values.startDate, values.endDate);
  return compactErrors({
    name: validateRequired(values.name, 'Name'),
    description:
      values.description.trim().length > 2000
        ? 'Description must be 2000 characters or fewer.'
        : undefined,
    location:
      values.location.trim().length > 200 ? 'Location must be 200 characters or fewer.' : undefined,
    timezone: validateRequired(values.timezone, 'Timezone', 64),
    startDate: dateErrors.startDate,
    endDate: dateErrors.endDate,
  });
}

export interface TournamentFormProps {
  readonly initialValues: TournamentFormValues;
  readonly submitLabel: string;
  /** Timezone is fixed after creation (the PATCH contract has no timezone). */
  readonly timezoneEditable: boolean;
  readonly onSubmit: (values: TournamentFormValues) => Promise<unknown>;
  readonly onCancel: () => void;
}

/**
 * Create/edit tournament form.
 *
 * Client validation gives immediate feedback; the API stays authoritative and
 * its field-level errors are merged over the local ones. Values are preserved
 * on failure and the submit button is disabled while a request is pending.
 */
export function TournamentForm({
  initialValues,
  submitLabel,
  timezoneEditable,
  onSubmit,
  onCancel,
}: TournamentFormProps) {
  const [values, setValues] = useState<TournamentFormValues>(initialValues);
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const mutation = useMutation<unknown>();

  const serverErrors = fieldErrors(mutation.error);
  const allErrors: FieldErrors = { ...localErrors, ...serverErrors };

  const update = <K extends keyof TournamentFormValues>(
    key: K,
    value: TournamentFormValues[K],
  ): void => {
    setValues((current) => ({ ...current, [key]: value }));
    setLocalErrors((current) => {
      if (!(key in current)) {
        return current;
      }
      return Object.fromEntries(Object.entries(current).filter(([name]) => name !== key));
    });
  };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const errors = validate(values);
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    void mutation.run(() => onSubmit(values));
  };

  return (
    <form className="max-w-xl space-y-5" onSubmit={handleSubmit} noValidate>
      {mutation.error ? (
        <Alert variant="destructive">
          <AlertDescription>{toDisplayMessage(mutation.error)}</AlertDescription>
        </Alert>
      ) : null}

      <FormField label="Name" required error={allErrors.name} htmlFor="tournament-name">
        {({ id, describedBy }) => (
          <Input
            id={id}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={allErrors.name ? true : undefined}
            value={values.name}
            maxLength={200}
            onChange={(event) => {
              update('name', event.target.value);
            }}
          />
        )}
      </FormField>

      <FormField label="Description" error={allErrors.description} htmlFor="tournament-description">
        {({ id, describedBy }) => (
          <Textarea
            id={id}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            value={values.description}
            maxLength={2000}
            onChange={(event) => {
              update('description', event.target.value);
            }}
          />
        )}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          label="Start date"
          required
          error={allErrors.startDate}
          htmlFor="tournament-start"
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="date"
              {...(describedBy ? { 'aria-describedby': describedBy } : {})}
              aria-invalid={allErrors.startDate ? true : undefined}
              value={values.startDate}
              onChange={(event) => {
                update('startDate', event.target.value);
              }}
            />
          )}
        </FormField>

        <FormField label="End date" required error={allErrors.endDate} htmlFor="tournament-end">
          {({ id, describedBy }) => (
            <Input
              id={id}
              type="date"
              {...(describedBy ? { 'aria-describedby': describedBy } : {})}
              aria-invalid={allErrors.endDate ? true : undefined}
              value={values.endDate}
              onChange={(event) => {
                update('endDate', event.target.value);
              }}
            />
          )}
        </FormField>
      </div>

      <FormField label="Location" error={allErrors.location} htmlFor="tournament-location">
        {({ id, describedBy }) => (
          <Input
            id={id}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            value={values.location}
            maxLength={200}
            onChange={(event) => {
              update('location', event.target.value);
            }}
          />
        )}
      </FormField>

      <FormField
        label="Timezone"
        required
        error={allErrors.timezone}
        description="IANA timezone name, for example Asia/Kolkata or UTC."
        htmlFor="tournament-timezone"
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={allErrors.timezone ? true : undefined}
            value={values.timezone}
            disabled={!timezoneEditable}
            onChange={(event) => {
              update('timezone', event.target.value);
            }}
          />
        )}
      </FormField>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={mutation.pending}>
          {mutation.pending ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" variant="outline" disabled={mutation.pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
