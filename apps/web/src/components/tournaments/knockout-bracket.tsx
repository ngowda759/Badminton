import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { BracketDto, BracketMatchDto, EntryDto } from '@/api/types.ts';
import { ConfirmDialog } from '@/components/confirm-dialog.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { EmptyState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useEntryNames } from '@/hooks/use-entry-names.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { bracketShapeSummary, nextSupportedSizeLabel } from '@/lib/bracket.ts';
import { useTournamentRefresh } from '@/realtime/tournament-refresh.tsx';

/**
 * Knockout bracket setup.
 *
 * The operator picks active entries from the category and orders them; the
 * order is exactly the round-1 pairing (1 vs 2, 3 vs 4, ...). There is no
 * automatic seeding or ranking - the ordering is caller-controlled. Once a
 * bracket exists the setup disappears and the bracket is read-only.
 */
export interface BracketSetupProps {
  readonly stageId: string;
  readonly categoryId: string;
  readonly onGenerated: () => void;
}

export function BracketSetup({ stageId, categoryId, onGenerated }: BracketSetupProps) {
  const api = useApi();
  const { nameFor, entries } = useEntryNames(categoryId);
  const activeEntries = entries.filter(
    (entry) => entry.status === 'PENDING' || entry.status === 'CONFIRMED',
  );

  const [selected, setSelected] = useState<readonly string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const mutation = useMutation<BracketDto>();

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

  const shape = bracketShapeSummary(selected.length);
  const hint = nextSupportedSizeLabel(selected.length);

  const generate = (): void => {
    setConfirming(false);
    void mutation.run(async () => {
      const bracket = await api.stages.generateBracket(stageId, { entryIds: selected });
      onGenerated();
      return bracket;
    });
  };

  return (
    <div className="space-y-4">
      {activeEntries.length === 0 ? (
        <EmptyState
          title="No active entries"
          description="Register and keep entries active before generating a bracket."
        />
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Select active entries and set their order. The order is the bracket pairing: position 1
            vs 2, 3 vs 4, and so on. No seeding or ranking is applied.
          </p>
          <ul className="space-y-2" data-testid="bracket-entry-list">
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

          <div className="space-y-1">
            <p className="text-sm" data-testid="bracket-shape">
              {selected.length === 0
                ? 'Select entries to build a bracket.'
                : `${String(selected.length)} selected${shape ? ` — ${shape}` : ''}.`}
            </p>
            {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
          </div>

          <Button
            type="button"
            disabled={!shape || mutation.pending}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {mutation.pending ? 'Generating…' : 'Generate bracket'}
          </Button>
        </>
      )}

      {mutation.error ? (
        <ErrorState error={mutation.error} title="Could not generate bracket" />
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Generate this bracket?"
        description={`This creates a ${String(selected.length)}-entry single-elimination bracket. The pairing and bracket size cannot be changed afterwards.`}
        confirmLabel="Generate bracket"
        pending={mutation.pending}
        onConfirm={generate}
      />

      <p className="text-muted-foreground text-xs">
        Bracket size must be a power of two from 2 to 128. Participant ordering is
        caller-controlled; no seeding algorithm is applied.
      </p>
    </div>
  );
}

/** Renders a knockout bracket as responsive round columns. */
export interface KnockoutBracketProps {
  readonly bracket: BracketDto;
  readonly nameFor: (entryId: string) => string;
  readonly matchHref: (matchId: string) => string;
}

export function KnockoutBracket({ bracket, nameFor, matchHref }: KnockoutBracketProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]">
      {bracket.rounds.map((round) => (
        <div key={round.roundNumber} className="space-y-3">
          <h4 className="text-sm font-semibold">{round.name}</h4>
          <ul className="space-y-3">
            {round.matches.map((match) => (
              <BracketMatchCard
                key={match.matchId}
                match={match}
                nameFor={nameFor}
                href={matchHref(match.matchId)}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BracketMatchCard({
  match,
  nameFor,
  href,
}: {
  readonly match: BracketMatchDto;
  readonly nameFor: (entryId: string) => string;
  readonly href: string;
}) {
  const label = (entryId: string | null): string => (entryId ? nameFor(entryId) : 'TBD');
  const slotClass = (entryId: string | null): string =>
    entryId ? 'text-sm' : 'text-muted-foreground text-sm italic';

  return (
    <li className="rounded-md border p-3" data-testid={`bracket-match-${match.matchNumber}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">Match {match.matchNumber}</span>
        <StatusBadge kind="match" status={match.status} />
      </div>
      <dl className="mt-2 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <dt className={slotClass(match.participant1.entryId)}>
            {label(match.participant1.entryId)}
          </dt>
          {match.winnerEntryId && match.winnerEntryId === match.participant1.entryId ? (
            <dd className="text-xs font-medium">Winner</dd>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className={slotClass(match.participant2.entryId)}>
            {label(match.participant2.entryId)}
          </dt>
          {match.winnerEntryId && match.winnerEntryId === match.participant2.entryId ? (
            <dd className="text-xs font-medium">Winner</dd>
          ) : null}
        </div>
      </dl>
      <Button asChild variant="outline" size="sm" className="mt-2">
        <Link to={href}>Open match</Link>
      </Button>
    </li>
  );
}

/** Reads the bracket for a KNOCKOUT stage; empty until it has been generated. */
export function BracketSection({
  stageId,
  categoryId,
  matchHref,
  refreshToken,
  onGenerated,
}: {
  readonly stageId: string;
  readonly categoryId: string;
  readonly matchHref: (matchId: string) => string;
  readonly refreshToken: number;
  /** Called after a bracket is generated, so sibling views can refetch. */
  readonly onGenerated?: () => void;
}) {
  const api = useApi();
  const { nameFor } = useEntryNames(categoryId);
  const query = useApiQuery<BracketDto | null>(['bracket', stageId, refreshToken], (signal) =>
    api.stages.getBracket(stageId, signal),
  );

  // A knockout progression event refetches the authoritative bracket over REST;
  // the event never names the slot to fill.
  useTournamentRefresh(query.refetch);

  if (query.state.status === 'loading') {
    return <EmptyState title="Loading bracket…" />;
  }
  if (query.state.status === 'error') {
    return (
      <ErrorState
        error={query.state.error}
        onRetry={query.refetch}
        title="Could not load bracket"
      />
    );
  }
  if (!query.state.data || query.state.data.rounds.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          title="No bracket yet"
          description="Generate the bracket from the active entries below."
        />
        <BracketSetup
          stageId={stageId}
          categoryId={categoryId}
          onGenerated={() => {
            query.refetch();
            onGenerated?.();
          }}
        />
      </div>
    );
  }

  const bracket = query.state.data;
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm" data-testid="bracket-summary">
        {bracket.bracketSize}-entry bracket · {bracket.roundCount}{' '}
        {bracket.roundCount === 1 ? 'round' : 'rounds'}
        {bracket.complete ? ' · champion decided' : ''}
      </p>
      <KnockoutBracket bracket={bracket} nameFor={nameFor} matchHref={matchHref} />
    </div>
  );
}
