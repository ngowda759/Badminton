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

  const toggle = (entryId: string): void => {
    setSelected((current) =>
      current.includes(entryId) ? current.filter((id) => id !== entryId) : [...current, entryId],
    );
  };

  const move = (index: number, direction: -1 | 1): void => {
    setSelected((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      const a = next[index];
      const b = next[target];
      if (a === undefined || b === undefined) {
        return current;
      }
      next[index] = b;
      next[target] = a;
      return next;
    });
  };

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
          <ul className="space-y-2" data-testid="group-fixture-entry-list">
            {activeEntries.map((entry: EntryDto) => {
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
        Fixtures are generated once and cannot be regenerated from here; a stage that already has
        matches is rejected. Participant ordering is caller-controlled; no seeding algorithm is
        applied.
      </p>
    </div>
  );
}

/** Matches in a complete round-robin of `count` entries, or 0 below two. */
function groupFixtureMatchCount(count: number): number {
  return count < 2 ? 0 : (count * (count - 1)) / 2;
}
