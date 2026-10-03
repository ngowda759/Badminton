import { useState } from 'react';

import { useApi } from '@/api/context.tsx';
import type { EntryDto, GroupFixturesDto } from '@/api/types.ts';
import { ConfirmDialog } from '@/components/confirm-dialog.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { EmptyState } from '@/components/states.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useEntryNames } from '@/hooks/use-entry-names.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { groupFixtureSummary } from '@/lib/fixtures.ts';

/**
 * Group-stage fixture setup.
 *
 * The operator picks active entries from the category and orders them; the
 * order is exactly the round-robin input order. Every selected entry plays every
 * other selected entry exactly once, so `n` entries produce `n * (n - 1) / 2`
 * matches. There is no automatic seeding or ranking - the ordering is
 * caller-controlled. Once fixtures exist the setup disappears and the match list
 * is authoritative.
 */
export interface GroupFixtureSetupProps {
  readonly stageId: string;
  readonly categoryId: string;
  readonly onGenerated: () => void;
}

export function GroupFixtureSetup({ stageId, categoryId, onGenerated }: GroupFixtureSetupProps) {
  const api = useApi();
  const { nameFor, entries } = useEntryNames(categoryId);
  const activeEntries = entries.filter(
    (entry) => entry.status === 'PENDING' || entry.status === 'CONFIRMED',
  );

  const [selected, setSelected] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation<GroupFixturesDto>();

  const summary = groupFixtureSummary(selected.length);
  const canGenerate = selected.length >= 2 && !mutation.pending;

  const generate = (): void => {
    setConfirming(false);
    void mutation.run(async () => {
      const fixtures = await api.stages.generateFixtures(stageId, { entryIds: selected });
      onGenerated();
      return fixtures;
    });
  };

  return (
    <div className="space-y-4">
      {activeEntries.length === 0 ? (
        <EmptyState
          title="No active entries"
          description="Register and keep entries active before generating fixtures."
        />
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Select active entries and set their order. Every selected entry plays every other
            selected entry exactly once. No seeding or ranking is applied.
          </p>
          <EntryOrderPicker
            entries={activeEntries}
            nameFor={nameFor}
            selected={selected}
            onChange={setSelected}
          />

          <p className="text-sm" data-testid="group-fixture-shape">
            {summary}
          </p>

          <Button
            type="button"
            disabled={!canGenerate}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {mutation.pending ? 'Generating…' : 'Generate fixtures'}
          </Button>
        </>
      )}

      {mutation.error ? (
        <ErrorState error={mutation.error} title="Could not generate fixtures" />
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Generate these fixtures?"
        description={`This creates a complete ${String(selected.length)}-entry round-robin (${String(
          groupFixtureMatchCount(selected.length),
        )} matches). Every entry plays every other entry once.`}
        confirmLabel="Generate fixtures"
        pending={mutation.pending}
        onConfirm={generate}
      />

      <p className="text-muted-foreground text-xs">
        Participant ordering is caller-controlled; no seeding algorithm is applied. Once fixtures
        exist the match list is authoritative; a mis-entered ordering can be rebuilt with
        &ldquo;Regenerate fixtures&rdquo;.
      </p>
    </div>
  );
}

export interface GroupFixtureRegenerationProps {
  readonly stageId: string;
  readonly categoryId: string;
  readonly onRegenerated: () => void;
}

/**
 * Guarded group-fixture regeneration.
 *
 * Rendered once a GROUP stage already has fixtures. It reuses the same
 * caller-controlled entry ordering as the setup, but its confirmation makes the
 * destructive consequence explicit: the current matches and any recorded
 * results are discarded and replaced by a fresh round-robin. Only a
 * non-`COMPLETED` stage is regenerable (the API refuses a completed stage).
 */
export function GroupFixtureRegeneration({
  stageId,
  categoryId,
  onRegenerated,
}: GroupFixtureRegenerationProps) {
  const api = useApi();
  const { nameFor, entries } = useEntryNames(categoryId);
  const activeEntries = entries.filter(
    (entry) => entry.status === 'PENDING' || entry.status === 'CONFIRMED',
  );

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const mutation = useMutation<GroupFixturesDto>();

  const canRegenerate = selected.length >= 2 && !mutation.pending;

  const regenerate = (): void => {
    if (!canRegenerate) {
      return;
    }
    void mutation.run(async () => {
      const fixtures = await api.stages.regenerateFixtures(stageId, { entryIds: selected });
      setOpen(false);
      onRegenerated();
      return fixtures;
    });
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        disabled={mutation.pending}
        onClick={() => {
          setOpen(true);
        }}
      >
        Regenerate fixtures
      </Button>
      {mutation.error ? (
        <ErrorState error={mutation.error} title="Could not regenerate fixtures" />
      ) : null}

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Regenerate these fixtures?"
        description="This discards the current matches and any recorded results for this group and replaces them with a fresh round-robin. This cannot be undone."
        confirmLabel="Regenerate fixtures"
        destructive
        pending={mutation.pending}
        onConfirm={regenerate}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Select active entries and set their order for the replacement round-robin. Every
            selected entry plays every other selected entry exactly once.
          </p>
          <EntryOrderPicker
            entries={activeEntries}
            nameFor={nameFor}
            selected={selected}
            onChange={setSelected}
          />
          <p className="text-sm" data-testid="group-fixture-regenerate-shape">
            {groupFixtureSummary(selected.length)}
          </p>
          {!canRegenerate ? (
            <p className="text-muted-foreground text-xs">
              Select at least two active entries to regenerate.
            </p>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}

interface EntryOrderPickerProps {
  readonly entries: readonly EntryDto[];
  readonly nameFor: (entryId: string) => string;
  readonly selected: readonly string[];
  readonly onChange: (selected: readonly string[]) => void;
}

/**
 * The caller-controlled entry checklist shared by generation and regeneration:
 * toggling appends to the ordering, and Up/Down moves an entry within it.
 */
function EntryOrderPicker({ entries, nameFor, selected, onChange }: EntryOrderPickerProps) {
  const toggle = (entryId: string): void => {
    onChange(
      selected.includes(entryId) ? selected.filter((id) => id !== entryId) : [...selected, entryId],
    );
  };

  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= selected.length) {
      return;
    }
    const next = [...selected];
    const a = next[index];
    const b = next[target];
    if (a === undefined || b === undefined) {
      return;
    }
    next[index] = b;
    next[target] = a;
    onChange(next);
  };

  return (
    <ul className="space-y-2" data-testid="group-fixture-entry-list">
      {entries.map((entry: EntryDto) => {
        const position = selected.indexOf(entry.id);
        const isSelected = position !== -1;
        return (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
          >
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => {
                  toggle(entry.id);
                }}
              />
              <span>{nameFor(entry.id)}</span>
              {isSelected ? (
                <span className="text-muted-foreground text-xs">#{position + 1}</span>
              ) : null}
            </label>
            {isSelected ? (
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={position === 0}
                  onClick={() => {
                    move(position, -1);
                  }}
                >
                  Up
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={position === selected.length - 1}
                  onClick={() => {
                    move(position, 1);
                  }}
                >
                  Down
                </Button>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Matches in a complete round-robin of `count` entries, or 0 below two. */
function groupFixtureMatchCount(count: number): number {
  return count < 2 ? 0 : (count * (count - 1)) / 2;
}
