import { useState } from 'react';

import { useApi } from '@/api/context.tsx';
import { ConfirmDialog } from '@/components/confirm-dialog.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { useTournament } from '@/components/tournaments/context.tsx';
import { useMutation } from '@/hooks/use-mutation.ts';
import { backupFilename, downloadJson } from '@/lib/download.ts';

/**
 * Tournament backup and danger-zone cards.
 *
 * Two operator controls over the whole tournament:
 *
 * - **Backup** downloads the JSON returned by `GET /tournaments/:id/export`, so
 *   a mis-created or abandoned tournament can be snapshotted before a
 *   destructive change.
 * - **Danger zone** resets the tournament via `POST /tournaments/:id/reset`,
 *   behind a confirmation dialog, and refetches the tournament so its new
 *   state is shown. A completed or cancelled tournament cannot be reset, so the
 *   control is disabled for it.
 *
 * Both calls go through the typed client; no component builds a `fetch`.
 */
export function TournamentBackupCard() {
  const api = useApi();
  const { tournament, refetch } = useTournament();
  const exportMutation = useMutation<unknown>();
  const resetMutation = useMutation<unknown>();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const terminal = tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED';

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Download a JSON backup of this tournament, including its categories, stages, courts,
            entries and every match.
          </p>
          {exportMutation.error ? (
            <ErrorState error={exportMutation.error} title="Backup failed" />
          ) : null}
          <Button
            type="button"
            variant="outline"
            disabled={exportMutation.pending}
            onClick={() => {
              void exportMutation.run(async () => {
                const backup = await api.tournaments.export(tournament.id);
                downloadJson(backupFilename(tournament.name), backup);
              });
            }}
          >
            {exportMutation.pending ? 'Preparing…' : 'Export backup'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            Reset clears every recorded result and schedule and reopens every stage, keeping the
            tournament setup. A completed or cancelled tournament cannot be reset.
          </p>
          {resetMutation.error ? (
            <ErrorState error={resetMutation.error} title="Reset failed" />
          ) : null}
          <Button
            type="button"
            variant="destructive"
            disabled={terminal || resetMutation.pending}
            onClick={() => {
              setConfirmOpen(true);
            }}
          >
            Reset tournament
          </Button>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Reset tournament?"
        description="This clears every match result and schedule and reopens every stage. The tournament setup is kept. This cannot be undone."
        confirmLabel="Reset tournament"
        destructive
        pending={resetMutation.pending}
        onConfirm={() => {
          void resetMutation.run(async () => {
            await api.tournaments.reset(tournament.id);
            setConfirmOpen(false);
            refetch();
          });
        }}
      />
    </div>
  );
}
