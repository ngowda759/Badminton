import { useState, type SubmitEvent } from 'react';

import type { CategoryDto, CategoryGender, CategoryFormat } from '@/api/types.ts';
import { FormField } from '@/components/form-field.tsx';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import { useMutation } from '@/hooks/use-mutation.ts';
import { fieldErrors, toDisplayMessage } from '@/lib/errors.ts';
import { compactErrors, validateRequired, type FieldErrors } from '@/lib/form-validation.ts';

export interface CategoryFormValues {
  readonly name: string;
  readonly code: string;
  readonly format: CategoryFormat;
  readonly gender: CategoryGender | '';
}

export function emptyCategoryForm(): CategoryFormValues {
  return { name: '', code: '', format: 'SINGLES', gender: '' };
}

export function categoryToForm(category: CategoryDto): CategoryFormValues {
  return {
    name: category.name,
    code: category.code,
    format: category.format,
    gender: category.gender ?? '',
  };
}

/** Normalizes a code for display: trimmed and upper-cased, mirroring the domain. */
export function normalizeCodeInput(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

function validate(values: CategoryFormValues, codeEditable: boolean): FieldErrors {
  return compactErrors({
    name: validateRequired(values.name, 'Name'),
    code: !codeEditable ? undefined : validateCode(values.code),
  });
}

function validateCode(value: string): string | undefined {
  const normalized = normalizeCodeInput(value);
  if (normalized.length === 0) {
    return 'Code is required.';
  }
  if (!/^[A-Z0-9-]{1,8}$/.test(normalized)) {
    return 'Code must be 1-8 characters of A-Z, 0-9 or hyphen.';
  }
  return undefined;
}

export interface CategoryFormProps {
  readonly initialValues: CategoryFormValues;
  readonly submitLabel: string;
  /** The code is immutable after creation (the PATCH contract has no code). */
  readonly codeEditable: boolean;
  readonly onSubmit: (values: CategoryFormValues) => Promise<unknown>;
  readonly onCancel: () => void;
}

/** Create/edit category form with immediate validation and safe error display. */
export function CategoryForm({
  initialValues,
  submitLabel,
  codeEditable,
  onSubmit,
  onCancel,
}: CategoryFormProps) {
  const [values, setValues] = useState<CategoryFormValues>(initialValues);
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const mutation = useMutation<unknown>();

  const allErrors: FieldErrors = { ...localErrors, ...fieldErrors(mutation.error) };

  const handleSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const errors = validate(values, codeEditable);
    setLocalErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    void mutation.run(() => onSubmit(values));
  };

  return (
    <form className="max-w-xl space-y-5" onSubmit={handleSubmit} noValidate>
      {mutation.error ? (
        <Alert variant="destructive">
          <AlertDescription>{toDisplayMessage(mutation.error)}</AlertDescription>
        </Alert>
      ) : null}

      <FormField label="Name" required error={allErrors.name} htmlFor="category-name">
        {({ id, describedBy }) => (
          <Input
            id={id}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={allErrors.name ? true : undefined}
            value={values.name}
            maxLength={200}
            onChange={(event) => {
              setValues((current) => ({ ...current, name: event.target.value }));
            }}
          />
        )}
      </FormField>

      <FormField
        label="Code"
        required
        error={allErrors.code}
        description={codeEditable ? 'Short code such as MS or WD; stored upper-case.' : undefined}
        htmlFor="category-code"
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={allErrors.code ? true : undefined}
            value={values.code}
            maxLength={8}
            disabled={!codeEditable}
            onChange={(event) => {
              setValues((current) => ({
                ...current,
                code: normalizeCodeInput(event.target.value),
              }));
            }}
          />
        )}
      </FormField>

      <FormField label="Format" required htmlFor="category-format">
        {({ id }) => (
          <Select
            value={values.format}
            onValueChange={(value) => {
              setValues((current) => ({ ...current, format: value as CategoryFormat }));
            }}
          >
            <SelectTrigger id={id} aria-label="Format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="SINGLES">Singles</SelectItem>
              <SelectItem value="DOUBLES">Doubles</SelectItem>
            </SelectContent>
          </Select>
        )}
      </FormField>

      <FormField
        label="Gender"
        description="Optional; leave unset for an open category."
        htmlFor="category-gender"
      >
        {({ id }) => (
          <Select
            value={values.gender === '' ? 'NONE' : values.gender}
            onValueChange={(value) => {
              setValues((current) => ({
                ...current,
                gender: value === 'NONE' ? '' : (value as CategoryGender),
              }));
            }}
          >
            <SelectTrigger id={id} aria-label="Gender">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">Not set</SelectItem>
              <SelectItem value="MALE">Male</SelectItem>
              <SelectItem value="FEMALE">Female</SelectItem>
              <SelectItem value="MIXED">Mixed</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
            </SelectContent>
          </Select>
        )}
      </FormField>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={mutation.pending}>
          {mutation.pending ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" variant="outline" disabled={mutation.pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
