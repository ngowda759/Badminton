import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton.tsx';
import { cn } from '@/lib/utils.ts';

export interface LoadingStateProps {
  /** Announced to assistive technology, e.g. "Loading categories…". */
  readonly label: string;
  readonly rows?: number;
  readonly className?: string | undefined;
}

/** Accessible placeholder shown while a server-driven screen loads. */
export function LoadingState({ label, rows = 3, className }: LoadingStateProps) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  readonly description?: string | undefined;
  readonly action?: ReactNode;
}

/** Meaningful placeholder for a list with no records yet. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-12 text-center"
    >
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
