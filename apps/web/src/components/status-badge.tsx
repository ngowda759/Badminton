import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge.tsx';

/** Visual tone shared by every status badge in the application. */
export type StatusBadgeVariant = 'success' | 'warning' | 'destructive' | 'secondary' | 'muted';

interface Presentation {
  readonly label: string;
  readonly variant: StatusBadgeVariant;
}

/**
 * One presentation table for every aggregate status.
 *
 * Kept in a single map so a status never means different things on different
 * pages: `OPEN` is always "success", a terminal `CANCELLED` is always
 * destructive, and so on. Unknown values fall back to the raw string rather
 * than guessing.
 */
const TOURNAMENT: Readonly<Record<string, Presentation>> = {
  DRAFT: { label: 'Draft', variant: 'muted' },
  REGISTRATION_OPEN: { label: 'Registration open', variant: 'success' },
  REGISTRATION_CLOSED: { label: 'Registration closed', variant: 'warning' },
  IN_PROGRESS: { label: 'In progress', variant: 'secondary' },
  COMPLETED: { label: 'Completed', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

const CATEGORY: Readonly<Record<string, Presentation>> = {
  DRAFT: { label: 'Draft', variant: 'muted' },
  OPEN: { label: 'Open', variant: 'success' },
  CLOSED: { label: 'Closed', variant: 'warning' },
  COMPLETED: { label: 'Completed', variant: 'success' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

const ENTRY: Readonly<Record<string, Presentation>> = {
  PENDING: { label: 'Pending', variant: 'warning' },
  CONFIRMED: { label: 'Confirmed', variant: 'success' },
  WITHDRAWN: { label: 'Withdrawn', variant: 'muted' },
  DISQUALIFIED: { label: 'Disqualified', variant: 'destructive' },
};

const STAGE: Readonly<Record<string, Presentation>> = {
  PENDING: { label: 'Pending', variant: 'muted' },
  ACTIVE: { label: 'Active', variant: 'success' },
  COMPLETED: { label: 'Completed', variant: 'secondary' },
};

const MATCH: Readonly<Record<string, Presentation>> = {
  SCHEDULED: { label: 'Scheduled', variant: 'muted' },
  IN_PROGRESS: { label: 'In progress', variant: 'success' },
  COMPLETED: { label: 'Completed', variant: 'secondary' },
  CANCELLED: { label: 'Cancelled', variant: 'destructive' },
};

const PRESENTATIONS: Readonly<Record<string, Readonly<Record<string, Presentation>>>> = {
  tournament: TOURNAMENT,
  category: CATEGORY,
  entry: ENTRY,
  stage: STAGE,
  match: MATCH,
};

export type StatusKind = keyof typeof PRESENTATIONS;

export function presentStatus(kind: StatusKind, status: string): Presentation {
  return PRESENTATIONS[kind]?.[status] ?? { label: status, variant: 'muted' };
}

export interface StatusBadgeProps {
  readonly kind: StatusKind;
  readonly status: string;
  readonly className?: string;
}

/** Renders a domain status as a labelled, colour-coded badge. */
export function StatusBadge({ kind, status, className }: StatusBadgeProps) {
  const presentation = presentStatus(kind, status);
  return (
    <Badge variant={presentation.variant} className={className}>
      {presentation.label}
    </Badge>
  );
}

/** Badge for a category format, independent of lifecycle. */
export function FormatBadge({ format }: { readonly format: string }): ReactNode {
  return <Badge variant="outline">{format === 'SINGLES' ? 'Singles' : 'Doubles'}</Badge>;
}
