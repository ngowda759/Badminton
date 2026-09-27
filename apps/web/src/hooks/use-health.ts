import { useEffect, useState } from 'react';

import type { HealthClient, HealthResult } from '../lib/health-client.ts';

/** What the UI renders before the first health response arrives. */
export type HealthState =
  { readonly status: 'loading' } | { readonly status: 'loaded'; readonly result: HealthResult };

export interface HealthStateOptions {
  /** Poll interval in milliseconds; `0` disables polling. */
  readonly pollIntervalMs?: number;
}

/**
 * Subscribes a component to API health.
 *
 * All fetching lives in the injected `HealthClient`; this hook only manages
 * React state, cancellation and polling, keeping the presentational components
 * free of business logic.
 */
export function useHealth(client: HealthClient, options: HealthStateOptions = {}): HealthState {
  const pollIntervalMs = options.pollIntervalMs ?? 0;
  const [state, setState] = useState<HealthState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const load = async (): Promise<void> => {
      const result = await client.fetchHealth(controller.signal);
      if (active) {
        setState({ status: 'loaded', result });
      }
    };

    void load();

    if (pollIntervalMs <= 0) {
      return () => {
        active = false;
        controller.abort();
      };
    }

    const timer = setInterval(() => void load(), pollIntervalMs);

    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [client, pollIntervalMs]);

  return state;
}
