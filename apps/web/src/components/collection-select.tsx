import { ErrorState } from '@/components/error-state.tsx';
import { FormField } from '@/components/form-field.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import type { CollectionOptionsState } from '@/hooks/use-collection-options.ts';

/** A selectable record: an id submitted to the API and a human label shown. */
export interface CollectionOption {
  readonly id: string;
  readonly label: string;
}

export interface CollectionSelectProps {
  /** Associates the label; defaults to a generated id. */
  readonly htmlFor?: string | undefined;
  readonly label: string;
  readonly required?: boolean;
  readonly placeholder: string;
  /** Shown when the collection loaded but is empty (e.g. "Create a player first."). */
  readonly emptyMessage: string;
  /** Shown above the options when loaded. */
  readonly description?: string | undefined;
  readonly state: CollectionOptionsState<CollectionOption>;
  /** Selected record id, or '' when nothing is selected yet. */
  readonly value: string;
  readonly onValueChange: (id: string) => void;
  readonly onRetry: () => void;
  readonly disabled?: boolean;
}

/**
 * Props for a concrete player/team selector.
 *
 * The wrapping selector owns the collection, its placeholder and its empty
 * message, so callers only supply the label and the selection binding.
 */
export type CompetitorSelectorProps = Omit<
  CollectionSelectProps,
  'state' | 'onRetry' | 'emptyMessage' | 'placeholder'
>;

/**
 * A labelled, server-backed dropdown over a whole collection.
 *
 * Loading, empty and error are handled here so every caller gets the same
 * behaviour: the trigger is disabled while loading or when the surrounding form
 * is disabled, an empty collection shows guidance instead of an empty menu, and
 * a failed load offers a retry. The option value is the record id, but only the
 * label is ever rendered, so ids never become the user-facing value.
 */
export function CollectionSelect({
  htmlFor,
  label,
  required = false,
  placeholder,
  emptyMessage,
  description,
  state,
  value,
  onValueChange,
  onRetry,
  disabled = false,
}: CollectionSelectProps) {
  const isLoading = state.status === 'loading';
  const isEmpty = state.status === 'loaded' && state.items.length === 0;

  return (
    <FormField
      label={label}
      required={required}
      {...(htmlFor ? { htmlFor } : {})}
      {...(description ? { description } : {})}
    >
      {({ id, describedBy }) => (
        <div className="space-y-2">
          <Select
            value={value}
            onValueChange={onValueChange}
            disabled={disabled || isLoading || state.status === 'error' || isEmpty}
          >
            <SelectTrigger
              id={id}
              {...(describedBy ? { 'aria-describedby': describedBy } : {})}
              aria-label={label}
            >
              <SelectValue placeholder={isLoading ? 'Loading…' : placeholder} />
            </SelectTrigger>
            <SelectContent>
              {state.status === 'loaded'
                ? state.items.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))
                : null}
            </SelectContent>
          </Select>

          {isEmpty ? (
            <p className="text-muted-foreground text-xs" data-testid="collection-select-empty">
              {emptyMessage}
            </p>
          ) : null}

          {state.status === 'error' ? (
            <ErrorState error={state.error} onRetry={onRetry} title="Could not load options" />
          ) : null}
        </div>
      )}
    </FormField>
  );
}
