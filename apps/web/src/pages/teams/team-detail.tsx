import { useState, type SubmitEvent } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { PlayerDto, TeamDto, TeamMemberDto } from '@/api/types.ts';
import { PageHeader } from '@/components/page-header.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { EmptyState, LoadingState } from '@/components/states.tsx';
import { ConfirmDialog } from '@/components/confirm-dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Input } from '@/components/ui/input.tsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table.tsx';
import { useApiQuery } from '@/hooks/use-api-query.ts';
import { useMutation } from '@/hooks/use-mutation.ts';
import { useRecent } from '@/hooks/use-recent.tsx';
import { fieldErrors } from '@/lib/errors.ts';
import { compactErrors, validateRequired, type FieldErrors } from '@/lib/form-validation.ts';

/** Team detail: rename the team and manage its members. */
export function TeamDetailPage() {
  const api = useApi();
  const { teamId = '' } = useParams();
  const { remember } = useRecent();

  const teamQuery = useApiQuery<TeamDto>(['team', teamId], (signal) =>
    api.teams.get(teamId, signal),
  );
  const memberQuery = useApiQuery<readonly TeamMemberDto[]>(['team-members', teamId], (signal) =>
    api.teams.listMembers(teamId, signal),
  );

  if (teamQuery.state.status === 'loading') {
    return <LoadingState label="Loading team…" rows={3} />;
  }
  if (teamQuery.state.status === 'error') {
    return (
      <ErrorState
        error={teamQuery.state.error}
        onRetry={teamQuery.refetch}
        title="Could not load team"
      />
    );
  }

  const team = teamQuery.state.data;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-sm">
        <Link className="hover:text-foreground underline-offset-4 hover:underline" to="/teams">
          Teams
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span className="text-foreground">{team.name}</span>
      </nav>

      <PageHeader title={team.name} description="Team details and members" />

      <Card>
        <CardHeader>
          <CardTitle>Team name</CardTitle>
        </CardHeader>
        <CardContent>
          <RenameTeamForm
            team={team}
            onSaved={(updated) => {
              remember('teams', { id: updated.id, label: updated.name });
              teamQuery.refetch();
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <AddMemberForm teamId={team.id} onAdded={memberQuery.refetch} />

          {memberQuery.state.status === 'loading' ? (
            <LoadingState label="Loading members…" />
          ) : null}
          {memberQuery.state.status === 'error' ? (
            <ErrorState
              error={memberQuery.state.error}
              onRetry={memberQuery.refetch}
              title="Could not load members"
            />
          ) : null}
          {memberQuery.state.status === 'loaded' && memberQuery.state.data.length === 0 ? (
            <EmptyState
              title="No members yet"
              description="Add players to this team. A doubles registration requires exactly two members."
            />
          ) : null}
          {memberQuery.state.status === 'loaded' && memberQuery.state.data.length > 0 ? (
            <MembersTable members={memberQuery.state.data} onRemoved={memberQuery.refetch} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function RenameTeamForm({
  team,
  onSaved,
}: {
  readonly team: TeamDto;
  readonly onSaved: (team: TeamDto) => void;
}) {
  const api = useApi();
  const [name, setName] = useState(team.name);
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation<TeamDto>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({ name: validateRequired(name, 'Team name') });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    void mutation.run(async () => {
      const updated = await api.teams.update(team.id, { name: name.trim() });
      onSaved(updated);
      return updated;
    });
  };

  const serverErrors = fieldErrors(mutation.error);

  return (
    <form className="max-w-xl space-y-4" onSubmit={submit} noValidate>
      <FormField
        label="Team name"
        required
        error={errors.name ?? serverErrors.name}
        htmlFor="rename-team"
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={(errors.name ?? serverErrors.name) ? true : undefined}
            value={name}
            maxLength={200}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </FormField>
      <Button type="submit" disabled={mutation.pending}>
        {mutation.pending ? 'Saving…' : 'Save changes'}
      </Button>
      {mutation.error ? <ErrorState error={mutation.error} title="Could not update team" /> : null}
    </form>
  );
}

function AddMemberForm({
  teamId,
  onAdded,
}: {
  readonly teamId: string;
  readonly onAdded: () => void;
}) {
  const api = useApi();
  const [playerId, setPlayerId] = useState('');
  const [position, setPosition] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mutation = useMutation<unknown>();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = compactErrors({ playerId: validateRequired(playerId, 'Player ID', 64) });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    void mutation.run(async () => {
      await api.teams.addMember(teamId, {
        playerId: playerId.trim(),
        ...(position.trim() ? { position: Number(position) } : {}),
      });
      setPlayerId('');
      setPosition('');
      onAdded();
    });
  };

  return (
    <form
      className="grid max-w-2xl gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
      onSubmit={submit}
      noValidate
    >
      <FormField label="Player ID" required error={errors.playerId} htmlFor="add-member-player">
        {({ id, describedBy }) => (
          <Input
            id={id}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            aria-invalid={errors.playerId ? true : undefined}
            value={playerId}
            onChange={(event) => {
              setPlayerId(event.target.value);
            }}
          />
        )}
      </FormField>
      <FormField
        label="Position (optional)"
        description="Defaults to the next free position."
        htmlFor="add-member-position"
      >
        {({ id, describedBy }) => (
          <Input
            id={id}
            type="number"
            min={1}
            {...(describedBy ? { 'aria-describedby': describedBy } : {})}
            value={position}
            onChange={(event) => {
              setPosition(event.target.value);
            }}
          />
        )}
      </FormField>
      <Button type="submit" disabled={mutation.pending}>
        {mutation.pending ? 'Adding…' : 'Add member'}
      </Button>
      {mutation.error ? (
        <div className="sm:col-span-3">
          <ErrorState error={mutation.error} title="Could not add member" />
        </div>
      ) : null}
    </form>
  );
}

function MembersTable({
  members,
  onRemoved,
}: {
  readonly members: readonly TeamMemberDto[];
  readonly onRemoved: () => void;
}) {
  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Player</TableHead>
            <TableHead>Position</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <MemberRow key={member.id} member={member} onRemoved={onRemoved} />
          ))}
        </TableBody>
      </Table>
    </TableWrapper>
  );
}

function MemberRow({
  member,
  onRemoved,
}: {
  readonly member: TeamMemberDto;
  readonly onRemoved: () => void;
}) {
  const api = useApi();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const mutation = useMutation<unknown>();
  const playerQuery = useApiQuery<PlayerDto>(['player', member.playerId], (signal) =>
    api.players.get(member.playerId, signal),
  );

  const name =
    playerQuery.state.status === 'loaded' ? playerQuery.state.data.name : member.playerId;

  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell>{member.position}</TableCell>
      <TableCell className="text-right">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutation.pending}
          onClick={() => {
            setConfirmOpen(true);
          }}
        >
          Remove
        </Button>
        {mutation.error ? (
          <p className="text-destructive mt-1 text-xs">Could not remove this member.</p>
        ) : null}
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Remove team member?"
          description="This removes the player from the team. It does not delete the player."
          confirmLabel="Remove"
          destructive
          pending={mutation.pending}
          onConfirm={() => {
            setConfirmOpen(false);
            void mutation.run(async () => {
              await api.teams.removeMember(member.teamId, member.playerId);
              onRemoved();
            });
          }}
        />
      </TableCell>
    </TableRow>
  );
}
