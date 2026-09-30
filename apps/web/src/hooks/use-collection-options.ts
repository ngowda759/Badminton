import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ListQueryParams, ListResponseDto } from '@/api/types.ts';

/** The three states a selector's option list renders. */
export type CollectionOptionsState<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly items: readonly T[] }
  | { readonly status: 'error'; readonly error: unknown };

export interface CollectionOptionsResult<T> {
  readonly state: CollectionOptionsState<T>;
  /** Reloads every page from the start; used after a mutation or on retry. */
  readonly refetch: () => void;
}

export interface UseCollectionOptionsOptions {
  /** Rows requested per page; bounded so a page request never asks for everything. */
  readonly pageSize?: number;
  /** Safety cap on pages walked; prevents an unbounded walk on a broken cursor. */
  readonly maxPages?: number;
}

/** One page of results, tagged with the key it was loaded for. */
interface OptionsState<T> {
  readonly key: string;
  readonly items: readonly T[];
}

/** A failed load, tagged with the key it was loaded for. */
interface FailureState {
  readonly key: string;
  readonly error: unknown;
}

/**
 * Loads a whole collection for a selector, page by page.
 *
 * The collection endpoints are cursor-paginated, so a selector must not settle
 * for the first page or the operator could not pick a record that sorts onto a
 * later page. This walks `nextCursor` until it is exhausted, issuing one request
 * per page (never one per option, so no N+1), and exposes the merged list. It is
 * read-only and shares `useCollection`'s conventions: the loader lives in a ref,
 * `key` is the contract, in-flight work is aborted on key change/unmount, and
 * loading is derived rather than mirrored.
 */
export function useCollectionOptions<T>(
  key: readonly unknown[],
  loader: (params: ListQueryParams, signal: AbortSignal) => Promise<ListResponseDto<T>>,
  options: UseCollectionOptionsOptions = {},
): CollectionOptionsResult<T> {
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 50;

  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  }, [loader]);

  const keyString = JSON.stringify(key);
  const [reloadToken, setReloadToken] = useState(0);
  const [page, setPage] = useState<OptionsState<T> | undefined>(undefined);
  const [failure, setFailure] = useState<FailureState | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async (): Promise<void> => {
      const items: T[] = [];
      let cursor: string | undefined;
      try {
        for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
          const result = await loaderRef.current(
            cursor === undefined ? { limit: pageSize } : { limit: pageSize, cursor },
            controller.signal,
          );
          items.push(...result.items);
          if (result.nextCursor === null) {
            break;
          }
          cursor = result.nextCursor;
        }
        if (active) {
          setPage({ key: keyString, items });
          setFailure(undefined);
        }
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
  }, [keyString, reloadToken, pageSize, maxPages]);

  const refetch = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const state = useMemo<CollectionOptionsState<T>>(() => {
    if (failure !== undefined && failure.key === keyString) {
      return { status: 'error', error: failure.error };
    }
    if (page !== undefined && page.key === keyString) {
      return { status: 'loaded', items: page.items };
    }
    return { status: 'loading' };
  }, [failure, page, keyString]);

  return useMemo(() => ({ state, refetch }), [state, refetch]);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
