import { cn } from '@/lib/utils.ts';
import { toneDotClass, toneTextClass, type StatusPresentation } from '@/lib/status-presentation.ts';

export interface StatusRowProps {
  readonly label: string;
  readonly presentation: StatusPresentation;
  /** Stable hook for end-to-end tests. */
  readonly testId: string;
}

/** Presentational row: renders one dependency and its current status. */
export function StatusRow({ label, presentation, testId }: StatusRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="flex items-center gap-2" data-testid={testId}>
        <span
          aria-hidden="true"
          className={cn('size-2 rounded-full', toneDotClass(presentation.tone))}
        />
        <span className={cn('text-sm font-medium', toneTextClass(presentation.tone))}>
          {presentation.label}
        </span>
      </span>
    </div>
  );
}
