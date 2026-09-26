import { Badge } from '@/components/ui/badge.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card.tsx';
import { StatusRow } from '@/components/status-row.tsx';
import { useHealth } from '@/hooks/use-health.ts';
import type { HealthClient } from '@/lib/health-client.ts';
import { presentApiStatus, presentDatabaseStatus } from '@/lib/status-presentation.ts';

export interface HealthPanelProps {
  readonly client: HealthClient;
  /** Poll interval in milliseconds; `0` fetches once. */
  readonly pollIntervalMs?: number;
}

/**
 * Renders the API/database status reported by `GET /health`.
 *
 * The component is purely presentational: fetching lives in the injected
 * client and status wording lives in `status-presentation`, so this file has no
 * business logic to test in isolation.
 */
export function HealthPanel({ client, pollIntervalMs = 0 }: HealthPanelProps) {
  const state = useHealth(client, { pollIntervalMs });
  const result = state.status === 'loaded' ? state.result : undefined;

  const api = presentApiStatus(result);
  const database = presentDatabaseStatus(result);

  const overall =
    state.status === 'loading'
      ? { label: 'Checking', variant: 'muted' as const }
      : result?.kind === 'ok' && result.health.status === 'ok'
        ? { label: 'All systems operational', variant: 'success' as const }
        : { label: 'Degraded', variant: 'warning' as const };

  return (
    <Card className="w-full max-w-md" data-testid="health-panel">
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>Foundation status</CardTitle>
            <CardDescription>Live health reported by the Fastify API.</CardDescription>
          </div>
          <Badge variant={overall.variant} data-testid="overall-status">
            {overall.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="divide-border divide-y">
          <StatusRow label="API" presentation={api} testId="api-status" />
          <StatusRow label="Database" presentation={database} testId="database-status" />
        </div>
      </CardContent>
    </Card>
  );
}
