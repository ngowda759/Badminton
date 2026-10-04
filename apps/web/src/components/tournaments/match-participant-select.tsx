import { useState } from 'react';

import type { EntryStatus } from '@badminton/domain';
import type { EntryDto } from '@/api/types.ts';
import { FormField } from '@/components/form-field.tsx';
import { Button } from '@/components/ui/button.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';

/**
 * Entry statuses that may still take a match slot. Mirrors the server's
 * participant eligibility rule (`ACTIVE_ENTRY_STATUSES`): a withdrawn or
 * disqualified entry is never offered. The API stays authoritative.
 */
const ELIGIBLE_ENTRY_STATUSES: readonly EntryStatus[] = ['PENDING', 'CONFIRMED'];

export interface MatchParticipantSelectProps {
  readonly slot: 1 | 2;
  /** The category's entries; only the eligible ones are offered. */
  readonly entries: readonly EntryDto[];
  /** Resolves a competitor name for an entry id. */
  readonly nameFor: (entryId: string) => string;
  /** Entry id already occupying this slot, or null/undefined while empty. */
  readonly assignedEntryId?: string | null | undefined;
  /** Entry ids already placed in the match (the other slot) and so unavailable. */
  readonly excludedEntryIds?: readonly string[];
  /** Assigns the chosen entry; the parent submits it through the typed client. */
  readonly onAssign: (entryId: string, slot: 1 | 2) => void | Promise<void>;
  /** True while a request is in flight; the control is disabled. */
  readonly pending?: boolean;
  /** A knockout slot is bracket-controlled and exposes no assignment control. */
  readonly readOnly?: boolean;
}

/**
 * A single match slot's participant control.
 *
 * The operator chooses a competitor from a server-backed dropdown over the
 * category's active entries instead of pasting a raw entry UUID, so the internal
 * identity model never reaches the UI. The entry already occupying the other
 * slot and any withdrawn or disqualified entry are not offered. The server's
 * eligibility, uniqueness and occupancy rules remain authoritative; this control
 * only narrows the choice.
 */
export function MatchParticipantSelect({
  slot,
  entries,
  nameFor,
  assignedEntryId,
  excludedEntryIds = [],
  onAssign,
  pending = false,
  readOnly = false,
}: MatchParticipantSelectProps) {
  const [selected, setSelected] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const isFilled = assignedEntryId !== undefined && assignedEntryId !== null;
  const assignedName = isFilled ? nameFor(assignedEntryId) : null;
  const excluded = new Set(excludedEntryIds);
  const options = entries.filter(
    (entry) => ELIGIBLE_ENTRY_STATUSES.includes(entry.status) && !excluded.has(entry.id),
  );

  const disabled = readOnly || isFilled || pending || submitting;

  const confirm = (): void => {
    if (selected === '' || disabled) {
      return;
    }
    const entryId = selected;
    setSubmitting(true);
    void Promise.resolve(onAssign(entryId, slot)).finally(() => {
      setSubmitting(false);
      setSelected('');
    });
  };

  return (
    <FormField label={`Slot ${slot} participant`} htmlFor={`match-slot-${String(slot)}`}>
      {({ id, describedBy }) => (
        <div className="flex items-end gap-2">
          <Select
            value={isFilled ? assignedEntryId : selected}
            onValueChange={setSelected}
            disabled={disabled}
          >
            <SelectTrigger
              id={id}
              aria-label={`Slot ${slot} participant`}
              {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            >
              <SelectValue placeholder={readOnly ? 'TBD' : 'Select participant'}>
                {isFilled ? assignedName : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {nameFor(entry.id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {readOnly || isFilled ? null : (
            <Button type="button" onClick={confirm} disabled={disabled || selected === ''}>
              Assign
            </Button>
          )}
        </div>
      )}
    </FormField>
  );
}
