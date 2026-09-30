import { useState, type SubmitEvent } from 'react';
import { Link } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { StageDto, StageType } from '@/api/types.ts';
import { PageHeader } from '@/components/page-header.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { StatusBadge } from '@/components/status-badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table.tsx';
import { useCategory } from '@/components/tournaments/context.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { humanizeEnum, orDash } from '@/lib/format.ts';
import {
  compactErrors,
  validateOptionalPositiveInteger,
  validatePositiveInteger,
  validateRequired,
  type FieldErrors,
} from '@/lib/form-validation.ts';
import { useTournamentRefresh } from '@/realtime/tournament-refresh.tsx';

/**
 * Stage metadata.
 *
 * A stage is created with its name, type, sequence and optional draw size.
 * Group-stage fixtures are generated as a round-robin from the stage page, and
 * knockout matches are created with the bracket; matches can also still be added
 * manually on the stage page.
 */
export function StagesPage() {
  const api = useApi();
  const { tournament, category } = useCategory();

  const { state, refetch } = useApiQuery<readonly StageDto[]>(['stages', category.id], (signal) =>
    api.stages.listByCategory(category.id, signal),
  );

  useTournamentRefresh(refetch);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stages"
        description="Manage stage metadata; generate group fixtures or a knockout bracket from the stage page."
      />

      <CreateStageCard categoryId={category.id} onCreated={refetch} />

      {state.status === 'loading' ? <LoadingState label="Loading stages…" /> : null}
      {state.status === 'error' ? (
        <ErrorState error={state.error} onRetry={refetch} title="Could not load stages" />
      ) : null}

      {state.status === 'loaded' && state.data.length === 0 ? (
        <EmptyState
          title="No stages have been created"
          description="Create a stage to begin tournament setup for this category."
        />
      ) : null}

      {state.status === 'loaded' && state.data.length > 0 ? (
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sequence</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Draw size</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {state.data.map((stage) => (
                <TableRow key={stage.id}>
                  <TableCell>{stage.sequence}</TableCell>
                  <TableCell className="font-medium">{stage.name}</TableCell>
                  <TableCell>{humanizeEnum(stage.type)}</TableCell>
                  <TableCell>{orDash(stage.drawSize)}</TableCell>
                  <TableCell>
                    <StatusBadge kind="stage" status={stage.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link
                        to={`/tournaments/${tournament.id}/categories/${category.id}/stages/${stage.id}`}
                      >
                        Open
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>
      ) : null}
    </div>
  );
}

function CreateStageCard({
  categoryId,
  onCreated,
}: {
  readonly categoryId: string;
  readonly onCreated: () => void;
}) {
  const api = useApi();
  const [name, setName] = useState('');
  const [type, setType] = useState<StageType>('GROUP');
  const [sequence, setSequence] = useState('1');
  const [drawSize, setDrawSize] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation<unknown>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({
      name: validateRequired(name, 'Name'),
      sequence: validatePositiveInteger(sequence, 'Sequence'),
      drawSize: validateOptionalPositiveInteger(drawSize, 'Draw size'),
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    void mutation.run(async () => {
      await api.stages.create(categoryId, {
        name: name.trim(),
        type,
        sequence: Number(sequence),
        ...(drawSize.trim() ? { drawSize: Number(drawSize) } : {}),
      });
      setName('');
      setSequence('1');
      setDrawSize('');
      onCreated();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create stage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid max-w-3xl gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
          onSubmit={submit}
          noValidate
        >
          <FormField label="Name" required error={errors.name} htmlFor="stage-name">
            {({ id, describedBy }) => (
              <Input
                id={id}
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                aria-invalid={errors.name ? true : undefined}
                value={name}
                maxLength={200}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </FormField>

          <FormField label="Type" required htmlFor="stage-type">
            {({ id }) => (
              <Select
                value={type}
                onValueChange={(value) => {
                  setType(value as StageType);
                }}
              >
                <SelectTrigger id={id} aria-label="Type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GROUP">Group</SelectItem>
                  <SelectItem value="KNOCKOUT">Knockout</SelectItem>
                </SelectContent>
              </Select>
            )}
          </FormField>

          <FormField label="Sequence" required error={errors.sequence} htmlFor="stage-sequence">
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="number"
                min={1}
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                aria-invalid={errors.sequence ? true : undefined}
                value={sequence}
                onChange={(event) => {
                  setSequence(event.target.value);
                }}
              />
            )}
          </FormField>

          <FormField label="Draw size" error={errors.drawSize} htmlFor="stage-draw-size">
            {({ id, describedBy }) => (
              <Input
                id={id}
                type="number"
                min={1}
                {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                aria-invalid={errors.drawSize ? true : undefined}
                value={drawSize}
                onChange={(event) => {
                  setDrawSize(event.target.value);
                }}
              />
            )}
          </FormField>

          <div className="sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={mutation.pending}>
              {mutation.pending ? 'Creating…' : 'Create stage'}
            </Button>
          </div>
        </form>

        {mutation.error ? (
          <ErrorState error={mutation.error} title="Could not create stage" />
        ) : null}
      </CardContent>
    </Card>
  );
}
