import { PageHeader } from '@/components/page-header.tsx';
import { HealthPanel } from '@/components/health-panel.tsx';
import { env } from '@/config/env.ts';
import { createHealthClient } from '@/lib/health-client.ts';

/** Composed once at module scope so polling does not recreate the client. */
const healthClient = createHealthClient({ baseUrl: env.VITE_API_BASE_URL });

/** Poll interval for the status panel. */
const POLL_INTERVAL_MS = 10_000;

/**
 * Foundation status screen.
 *
 * Keeps the Phase 1 health view reachable from the shell: `GET /health` is the
 * one endpoint that reports API and PostgreSQL connectivity, and this page is
 * the only place the UI observes it directly.
 */
export function StatusPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Status" />
      <HealthPanel client={healthClient} pollIntervalMs={POLL_INTERVAL_MS} />
    </div>
  );
}
