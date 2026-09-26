import { HealthPanel } from '@/components/health-panel.tsx';
import { env } from '@/config/env.ts';
import { createHealthClient } from '@/lib/health-client.ts';

/** Composed once at module scope so polling does not recreate the client. */
const healthClient = createHealthClient({ baseUrl: env.VITE_API_BASE_URL });

/** Poll interval for the foundation status panel. */
const POLL_INTERVAL_MS = 10_000;

/**
 * Application shell.
 *
 * Phase 1 renders only enough to prove the stack is wired together. No
 * tournament UI exists yet - those screens arrive in later phases.
 */
export function App() {
  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg text-sm font-bold"
            >
              B
            </span>
            <div className="leading-tight">
              <h1 className="text-base font-semibold sm:text-lg">Badminton Tournament Manager</h1>
              <p className="text-muted-foreground text-xs sm:text-sm">Badminton V2</p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-6 px-4 py-12 sm:px-6">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Foundation is running.
          </h2>
          <p className="text-muted-foreground max-w-prose text-sm sm:text-base">
            Phase 1 establishes the monorepo, API and database foundations. Tournament features are
            intentionally not part of this phase.
          </p>
        </div>

        <HealthPanel client={healthClient} pollIntervalMs={POLL_INTERVAL_MS} />
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-5xl px-4 py-4 text-xs sm:px-6">
          Phase 1 · Foundation
        </div>
      </footer>
    </div>
  );
}
