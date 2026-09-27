import type { HealthResult } from '../lib/health-client.ts';

/** Visual tone of a status row, independent of the underlying domain values. */
export type StatusTone = 'ok' | 'warn' | 'error' | 'pending';

export interface StatusPresentation {
  readonly label: string;
  readonly tone: StatusTone;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  error: 'bg-destructive',
  pending: 'bg-muted-foreground',
};

const TONE_TEXT_CLASSES: Record<StatusTone, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-destructive',
  pending: 'text-muted-foreground',
};

/** Maps a health result onto the API row of the status list. */
export function presentApiStatus(result: HealthResult | undefined): StatusPresentation {
  if (!result) {
    return { label: 'Checking…', tone: 'pending' };
  }

  switch (result.kind) {
    case 'ok':
      return { label: 'Connected', tone: 'ok' };
    case 'invalid':
      return { label: 'Unexpected response', tone: 'warn' };
    case 'unreachable':
      return { label: 'Unreachable', tone: 'error' };
  }
}

/**
 * Maps a health result onto the database row.
 *
 * Reported as unknown until the API answers, because the browser cannot observe
 * PostgreSQL directly - the status always comes from the API.
 */
export function presentDatabaseStatus(result: HealthResult | undefined): StatusPresentation {
  if (!result) {
    return { label: 'Checking…', tone: 'pending' };
  }

  if (result.kind !== 'ok') {
    return { label: 'Unknown', tone: 'warn' };
  }

  return result.health.database === 'connected'
    ? { label: 'Connected', tone: 'ok' }
    : { label: 'Disconnected', tone: 'error' };
}

export function toneDotClass(tone: StatusTone): string {
  return TONE_CLASSES[tone];
}

export function toneTextClass(tone: StatusTone): string {
  return TONE_TEXT_CLASSES[tone];
}
