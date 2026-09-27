import { BrowserRouter } from 'react-router-dom';

import { ApiProvider } from '@/api/context.tsx';
import { AppShell } from '@/components/app-shell.tsx';
import { ErrorBoundary } from '@/components/error-boundary.tsx';
import { RecentProvider } from '@/hooks/use-recent.tsx';
import { AppRoutes } from '@/routes.tsx';

export interface AppProps {
  /** Router basename; tests render the routes inside their own MemoryRouter. */
  readonly basename?: string;
}

/**
 * Application root.
 *
 * Composes the providers (API, recent-items index), the error boundary and the
 * shell around the route tree. Rendering routes here keeps `routes.tsx` free of
 * provider concerns so tests can mount just the routes they need.
 */
export function App({ basename }: AppProps) {
  return (
    <ErrorBoundary>
      <ApiProvider>
        <RecentProvider>
          <BrowserRouter {...(basename ? { basename } : {})}>
            <AppShell>
              <AppRoutes />
            </AppShell>
          </BrowserRouter>
        </RecentProvider>
      </ApiProvider>
    </ErrorBoundary>
  );
}
