import { useState } from 'react';

import { useApi } from '@/api/context.tsx';
import type { QualificationViewDto } from '@/api/types.ts';
import { ConfirmDialog } from '@/components/confirm-dialog.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useEntryNames } from '@/hooks/use-entry-names.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { useTournamentRefresh } from '@/realtime/tournament-refresh.tsx';

/**
 * Group qualification view for a KNOCKOUT stage.
 *
 * Qualification is derived, never stored: the panel reads the configured
 * qualifiers of each feeder group, the resulting bracket shape and whether the
 * knockout is ready. The bracket is only generated once every group match is
 * completed, so a competitor can never advance on stale standings. The seed
 * order is the domain's cross-seed of the group placings; the operator does not
 * enter UUIDs.
 */
export interface QualificationPanelProps {
  readonly stageId: string;
  readonly categoryId: string;
  /** True once a bracket already exists; the panel then becomes read-only. */
  readonly bracketGenerated: boolean;
  readonly onGenerated: () => void;
}

export function QualificationPanel({
  stageId,
  categoryId,
  bracketGenerated,
  onGenerated,
}: QualificationPanelProps) {
  const api = useApi();
  const { nameFor } = useEntryNames(categoryId);
  const query = useApiQuery<QualificationViewDto>(['qualification', stageId], (signal) =>
    api.stages.qualification(stageId, signal),
  );
  const mutation = useMutation<unknown>();
  const [confirming, setConfirming] = useState(false);

  useTournamentRefresh(query.refetch);

  if (query.state.status === 'loading') {
    return <LoadingState label="Loading qualification…" />;
  }
  if (query.state.status === 'error') {
    return (
      <ErrorState
        error={query.state.error}
        onRetry={query.refetch}
        title="Could not load qualification"
      />
    );
  }

  const view = query.state.data;
  const hasGroups = view.groups.length > 0;

  if (!hasGroups) {
    return (
      <EmptyState
        title="No group stage feeds this knockout"
        description="Add a GROUP stage before this knockout to derive qualifiers, or generate the bracket manually from the active entries."
      />
    );
  }

  const generate = (): void => {
    setConfirming(false);
    void mutation.run(async () => {
      await api.stages.generateBracketFromQualifiers(stageId);
      onGenerated();
    });
  };

  return (
    <div className="space-y-4">
      {view.qualifiersPerGroup === null ? (
        <p className="text-muted-foreground text-sm" data-testid="qualification-config">
          Set how many competitors qualify from each group (on the group stage) before the knockout
          bracket can be generated.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {view.groups.map((group) => (
          <div key={group.groupId} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold">{group.groupName}</h4>
              <span className="text-muted-foreground text-xs">
                {group.completedMatches}/{group.totalMatches} played
              </span>
            </div>
            {group.qualifiers.length === 0 ? (
              <p className="text-muted-foreground mt-1 text-xs italic">
                No qualifiers configured for this group.
              </p>
            ) : (
              <ol className="mt-2 space-y-1" data-testid={`qualifiers-${group.groupId}`}>
                {group.qualifiers.map((qualifier) => (
                  <li key={qualifier.entryId} className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-5 text-right">
                      {qualifier.position}.
                    </span>
                    <span>{nameFor(qualifier.entryId)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>

      {view.ready ? (
        <p className="text-sm" data-testid="qualification-summary">
          {view.qualifierCount} qualifiers · {view.bracketSize}-entry bracket
          {view.byeCount > 0
            ? ` · ${String(view.byeCount)} bye${view.byeCount === 1 ? '' : 's'}`
            : ''}
        </p>
      ) : (
        <p
          className="text-sm text-amber-700 dark:text-amber-400"
          data-testid="qualification-blocked"
        >
          {view.blockedReason ?? 'Qualification is not ready.'}
        </p>
      )}

      {!bracketGenerated ? (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            disabled={!view.ready || mutation.pending}
            onClick={() => {
              setConfirming(true);
            }}
          >
            {mutation.pending ? 'Generating…' : 'Generate bracket from qualifiers'}
          </Button>
          <p className="text-muted-foreground text-xs">
            Seeds the qualified competitors into the bracket automatically. No UUIDs to enter.
          </p>
        </div>
      ) : null}

      {mutation.error ? (
        <ErrorState error={mutation.error} title="Could not generate bracket" />
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Generate the bracket from group qualifiers?"
        description={`This seeds the ${String(view.qualifierCount)} qualified competitors into a ${String(view.bracketSize)}-entry single-elimination bracket. The bracket cannot be regenerated afterwards.`}
        confirmLabel="Generate bracket"
        pending={mutation.pending}
        onConfirm={generate}
      />
    </div>
  );
}

/** Small card wrapper so the panel slots into the stage detail layout. */
export function QualificationCard(props: QualificationPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Group qualification</CardTitle>
      </CardHeader>
      <CardContent>
        <QualificationPanel {...props} />
      </CardContent>
    </Card>
  );
}
