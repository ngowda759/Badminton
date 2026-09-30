import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ListQueryParams, ListResponseDto } from '@/api/types.ts';

/** The four states a server-driven list renders. */
export type CollectionState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly items: readonly T[] }
  | { readonly status: 'error'; readonly error: unknown };

export interface CollectionResult<T> {
  readonly state: CollectionState<T>;
  /** True while the next page is being appended (the list stays visible). */
  readonly loadingMore: boolean;
  /** Set when appending a page failed; the loaded items are kept. */
  readonly loadMoreError: unknown;
  /** True when the server reported another page after this one. */
  readonly hasMore: boolean;
  /** Appends the next page; a no-op without a cursor or while one is in flight. */
  readonly loadMore: () => void;
  /** Reloads from the first page; used after a mutation touches the list. */
  readonly refetch: () => void;
}

export interface UseCollectionOptions {
  /** Rows requested per page; matches the server's default page size. */
  readonly pageSize?: number;
}

/** One page of results, tagged with the key it was loaded for. */
interface PageState<T> {
  readonly key: string;
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/** A failed load, tagged with the key it was loaded for. */
interface ErrorState {
  readonly key: string;
  readonly error: unknown;
}

/**
 * Cursor-paginated collection loader.
 *
 * Reuses the project's `useApiQuery` conventions - one loading/loaded/error
 * lifecycle, `AbortSignal` cancellation and an explicit `key` describing what
 * to fetch - and adds "load more" over the server's `nextCursor`. It is not a
 * server-state framework: the page is owned here and refetched on demand.
 *
 * Loading is derived, never mirrored: the effect only sets state from an async
 * result, and a key with no result yet is reported as `loading`. The loader
 * lives in a ref so an inline arrow function does not retrigger the request;
 * `key` is the contract. In-flight appends are ignored after unmount so a late
 * page never updates a gone component.
 */
export function useCollection<T>(
  key: readonly unknown[],
  loader: (params: ListQueryParams, signal: AbortSignal) => Promise<ListResponseDto<T>>,
  options: UseCollectionOptions = {},
): CollectionResult<T> {
  const pageSize = options.pageSize ?? 20;
  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const keyString = JSON.stringify(key);
  const [reloadToken, setReloadToken] = useState(0);
  const [page, setPage] = useState<PageState<T> | undefined>(undefined);
  const [failure, setFailure] = useState<ErrorState | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(undefined);
  const mountedRef = useRef(true);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadMoreControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    // A refetch supersedes any in-flight append so the two cannot interleave.
    loadMoreControllerRef.current?.abort();
    loadMoreControllerRef.current = null;

    const load = async (): Promise<void> => {
      try {
        const result = await loaderRef.current({ limit: pageSize }, controller.signal);
        if (!active) {
          return;
        }
        setPage({ key: keyString, items: result.items, nextCursor: result.nextCursor });
        setFailure(undefined);
      } catch (caught) {
        if (!active || isAbortError(caught)) {
          return;
        }
        setFailure({ key: keyString, error: caught });
      }
    };

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [keyString, reloadToken, pageSize]);

  const hasMore = page !== undefined && page.key === keyString && page.nextCursor !== null;

  const loadMore = useCallback(() => {
    if (page === undefined || page.key !== keyString || page.nextCursor === null || loadingMore) {
      return;
    }
    const cursor = page.nextCursor;
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;
    setLoadingMore(true);
    setLoadMoreError(undefined);

    void (async () => {
      try {
        const result = await loaderRef.current({ limit: pageSize, cursor }, controller.signal);
        if (!mountedRef.current) {
          return;
        }
        setPage((current) => ({
          key: keyString,
          items: [...(current?.items ?? []), ...result.items],
          nextCursor: result.nextCursor,
        }));
      } catch (caught) {
        if (!mountedRef.current || isAbortError(caught)) {
          return;
        }
        setLoadMoreError(caught);
      } finally {
        if (mountedRef.current) {
          setLoadingMore(false);
        }
      }
    })();
  }, [page, keyString, loadingMore, pageSize]);

  const refetch = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  // Derived, not stored: a key with no result yet (and no failure) is loading.
  const state = useMemo<CollectionState<T>>(() => {
    if (failure !== undefined && failure.key === keyString) {
      return { status: 'error', error: failure.error };
    }
    if (page !== undefined && page.key === keyString) {
      return { status: 'loaded', items: page.items };
    }
    return { status: 'loading' };
  }, [failure, page, keyString]);

  return useMemo(
    () => ({
      state,
      loadingMore,
      loadMoreError,
      hasMore,
      loadMore,
      refetch,
    }),
    [state, loadingMore, loadMoreError, hasMore, loadMore, refetch],
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
