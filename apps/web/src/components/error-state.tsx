import { AlertTriangle, RotateCcw } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { toDisplayMessage } from '@/lib/errors.ts';

export interface ErrorStateProps {
  readonly error: unknown;
  /** Called when the user retries; the retry button is hidden without it. */
  readonly onRetry?: () => void;
  readonly title?: string | undefined;
}

/**
 * Displays a failed request safely.
 *
 * Only the message from `ApiError` (or a generic phrase) is shown - never a
 * status line, SQL text or stack trace.
 */
export function ErrorState({ error, onRetry, title = 'Something went wrong' }: ErrorStateProps) {
  const message = toDisplayMessage(error) || 'The request failed.';

  return (
    <Alert variant="destructive" data-testid="error-state">
      <AlertTriangle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            <RotateCcw />
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
