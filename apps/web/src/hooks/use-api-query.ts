import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** The four states every server-driven screen renders. */
export type QueryState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly data: T }
  | { readonly status: 'error'; readonly error: unknown };

export interface QueryResult<T> {
  readonly state: QueryState<T>;
  /** Refetches the resource; used after a mutation touches the same data. */
  readonly refetch: () => void;
}

/**
 * Minimal async data hook used across the tournament UI.
 *
 * Deliberately not a server-state framework: it owns one request's
 * loading/loaded/error lifecycle, cancels in-flight work on unmount and
 * refetches on demand. The loader lives in a ref (updated in an effect) so
 * callers may inline an arrow function without retriggering the request;
 * `key` is the contract that says *what* to fetch.
 */
export function useApiQuery<T>(
  key: readonly unknown[],
  loader: (signal: AbortSignal) => Promise<T>,
): QueryResult<T> {
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const keyString = JSON.stringify(key);
  const [reloadToken, setReloadToken] = useState(0);
  const [state, setState] = useState<QueryState<T>>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async (): Promise<void> => {
      try {
        const data = await loaderRef.current(controller.signal);
        if (active) {
          setState({ status: 'loaded', data });
        }
      } catch (error) {
        if (!active) {
          return;
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        setState({ status: 'error', error });
      }
    };

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [keyString, reloadToken]);

  const refetch = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return useMemo(() => ({ state, refetch }), [state, refetch]);
}
