import { createContext, useContext, type ReactNode } from 'react';

import { api, type BadmintonApi } from './index.ts';

/**
 * Provides the API surface to the component tree.
 *
 * Pages consume the API through {@link useApi} instead of importing the module
 * singleton, so tests can render a page against a stubbed API without touching
 * global state or the network.
 */
const ApiContext = createContext<BadmintonApi>(api);

export interface ApiProviderProps {
  readonly api?: BadmintonApi;
  readonly children: ReactNode;
}

export function ApiProvider({ api: value = api, children }: ApiProviderProps) {
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

/** Reads the API from context, defaulting to the application instance. */
export function useApi(): BadmintonApi {
  return useContext(ApiContext);
}
