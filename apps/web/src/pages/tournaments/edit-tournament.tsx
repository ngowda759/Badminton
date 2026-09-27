import { useNavigate } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import { PageHeader } from '@/components/page-header.tsx';
import { useTournament } from '@/components/tournaments/context.tsx';
import { TournamentForm, tournamentToForm } from '@/components/tournaments/tournament-form.tsx';
import { useRecent } from '@/hooks/use-recent.tsx';

/**
 * Edit-tournament page.
 *
 * Only fields the PATCH contract accepts are submitted; `timezone` has no
 * update endpoint and is therefore shown read-only, and lifecycle status has
 * its own dedicated actions rather than living inside this form.
 */
export function EditTournamentPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { tournament, refetch } = useTournament();
  const { remember } = useRecent();

  return (
    <div className="space-y-6">
      <PageHeader title="Edit tournament" description="Update the tournament's setup details." />
      <TournamentForm
        initialValues={tournamentToForm(tournament)}
        submitLabel="Save changes"
        timezoneEditable={false}
        onCancel={() => void navigate(`/tournaments/${tournament.id}`)}
        onSubmit={async (values) => {
          const updated = await api.tournaments.update(tournament.id, {
            name: values.name.trim(),
            description: values.description.trim(),
            location: values.location.trim(),
            startDate: values.startDate,
            endDate: values.endDate,
          });
          remember('tournaments', { id: updated.id, label: updated.name });
          refetch();
          void navigate(`/tournaments/${tournament.id}`);
        }}
      />
    </div>
  );
}
