import type { ReactNode } from 'react';

import { useApi } from '@/api/context.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { CategoryForm } from '@/components/tournaments/category-form.tsx';
import { useCategory } from '@/components/tournaments/context.tsx';
import { LifecycleActions } from '@/components/tournaments/lifecycle-actions.tsx';
import { useMutation } from '@/hooks/use-mutation.ts';
import { categoryNextStatuses } from '@/lib/lifecycle.ts';
import { humanizeEnum, orDash } from '@/lib/format.ts';

/** Category details: attributes, lifecycle and inline editing. */
export function CategoryDetailPage() {
  const api = useApi();
  const { category, refetch } = useCategory();
  const mutation = useMutation<unknown>();

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Detail label="Name" value={category.name} />
              <Detail label="Code" value={category.code} />
              <Detail label="Format" value={humanizeEnum(category.format)} />
              <Detail
                label="Gender"
                value={category.gender ? humanizeEnum(category.gender) : orDash(null)}
              />
              <Detail
                label="Status"
                value={<StatusBadge kind="category" status={category.status} />}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              A category must be Open, and its tournament registration open, before entries can be
              registered.
            </p>
            {mutation.error ? (
              <ErrorState error={mutation.error} title="Transition failed" />
            ) : null}
            <LifecycleActions
              kind="category"
              currentStatus={category.status}
              nextStatuses={categoryNextStatuses(category.status)}
              pending={mutation.pending}
              onTransition={async (status) => {
                await mutation.run(async () => {
                  await api.categories.transition(category.id, status);
                  refetch();
                });
              }}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Edit category</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4 text-sm">
            Format can only change while no entries exist; the API rejects the change otherwise.
          </p>
          <CategoryForm
            initialValues={{
              name: category.name,
              code: category.code,
              format: category.format,
              gender: category.gender ?? '',
            }}
            submitLabel="Save changes"
            codeEditable={false}
            onCancel={() => undefined}
            onSubmit={async (values) => {
              await api.categories.update(category.id, {
                name: values.name.trim(),
                format: values.format,
                gender: values.gender === '' ? null : values.gender,
              });
              refetch();
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { readonly label: string; readonly value: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase">{label}</dt>
      <dd className="mt-1">{value}</dd>
    </div>
  );
}
