import type { ReactNode } from 'react';
import { useId } from 'react';

import { Label } from '@/components/ui/label.tsx';
import { cn } from '@/lib/utils.ts';

export interface FormFieldProps {
  readonly label: string;
  readonly htmlFor?: string | undefined;
  readonly required?: boolean;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly className?: string | undefined;
  readonly children: (props: { readonly id: string; readonly describedBy?: string }) => ReactNode;
}

/**
 * Associates a label, hint and error message with a form control.
 *
 * The control is supplied as a render prop so it receives matching `id` and
 * `aria-describedby` values; this is what keeps every field labelled and its
 * server-side error announced, without each form re-inventing the wiring.
 */
export function FormField({
  label,
  htmlFor,
  required = false,
  description,
  error,
  className,
  children,
}: FormFieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-destructive ml-0.5">
            *
          </span>
        ) : null}
      </Label>
      {children(describedBy ? { id, describedBy } : { id })}
      {description ? (
        <p id={descriptionId} className="text-muted-foreground text-xs">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
