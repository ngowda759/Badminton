import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { ConfirmDialog } from '@/components/confirm-dialog.tsx';
import type { StatusKind } from '@/components/status-badge.tsx';
import { transitionActionLabel } from '@/lib/lifecycle.ts';

export interface LifecycleActionsProps {
  readonly kind: StatusKind;
  readonly currentStatus: string;
  readonly nextStatuses: readonly string[];
  /**
   * Performs the transition. Rejections are expected (the API re-validates
   * every transition) and must be caught by the caller to display the error.
   */
  readonly onTransition: (status: string) => Promise<void>;
  readonly pending?: boolean;
  /** Transitions that get a confirmation prompt because they are terminal. */
  readonly confirmStatuses?: readonly string[];
}

/** Transitions whose effects are hard to undo and therefore ask first. */
const DEFAULT_CONFIRM = ['CANCELLED', 'COMPLETED', 'WITHDRAWN', 'DISQUALIFIED'];

/**
 * Renders only the lifecycle transitions reachable from the current status.
 *
 * The list is derived from the shared domain transition tables, and the API
 * still validates every attempt: an option shown here that the server rejects
 * surfaces as an error, never a silent no-op.
 */
export function LifecycleActions({
  kind,
  currentStatus,
  nextStatuses,
  onTransition,
  pending = false,
  confirmStatuses = DEFAULT_CONFIRM,
}: LifecycleActionsProps) {
  const [confirming, setConfirming] = useState<string | undefined>(undefined);

  if (nextStatuses.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-testid="lifecycle-terminal">
        No further lifecycle actions — this record is in a terminal state.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="lifecycle-actions">
      {nextStatuses.map((status) => (
        <Button
          key={status}
          type="button"
          variant={status === 'CANCELLED' ? 'destructive' : 'outline'}
          size="sm"
          disabled={pending}
          onClick={() => {
            if (confirmStatuses.includes(status)) {
              setConfirming(status);
            } else {
              void onTransition(status);
            }
          }}
        >
          {transitionActionLabel(status)}
        </Button>
      ))}

      <ConfirmDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(undefined);
          }
        }}
        title={confirming ? `${transitionActionLabel(confirming)}?` : ''}
        description={
          confirming
            ? `This will move the ${kind} from ${transitionActionLabel(currentStatus)} to ${transitionActionLabel(confirming)}.`
            : undefined
        }
        confirmLabel={confirming ? transitionActionLabel(confirming) : 'Confirm'}
        destructive={confirming === 'CANCELLED' || confirming === 'DISQUALIFIED'}
        pending={pending}
        onConfirm={() => {
          const status = confirming;
          setConfirming(undefined);
          if (status) {
            void onTransition(status);
          }
        }}
      />
    </div>
  );
}
