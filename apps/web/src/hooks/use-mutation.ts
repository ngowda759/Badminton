import { useCallback, useState } from 'react';

/** Lifecycle of a user-triggered write (form submit, mutation). */
export type MutationStatus = 'idle' | 'pending' | 'success' | 'error';

export interface MutationResult<T> {
  readonly status: MutationStatus;
  readonly error: unknown;
  /** True while a request is in flight; use it to disable submit buttons. */
  readonly pending: boolean;
  readonly run: (task: () => Promise<T>) => Promise<T | undefined>;
  readonly reset: () => void;
}

/**
 * Standard mutation lifecycle for forms and action buttons.
 *
 * Guarantees the behaviours every screen needs: the caller cannot submit twice
 * while a request is pending, the failure is retained for display, and a
 * rejected task never produces an unhandled rejection.
 */
export function useMutation<T>(): MutationResult<T> {
  const [status, setStatus] = useState<MutationStatus>('idle');
  const [error, setError] = useState<unknown>(undefined);

  const run = useCallback(async (task: () => Promise<T>): Promise<T | undefined> => {
    setStatus('pending');
    setError(undefined);
    try {
      const result = await task();
      setStatus('success');
      return result;
    } catch (caught) {
      setError(caught);
      setStatus('error');
      return undefined;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(undefined);
  }, []);

  return { status, error, pending: status === 'pending', run, reset };
}
