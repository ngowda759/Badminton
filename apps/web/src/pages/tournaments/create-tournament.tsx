import { useNavigate, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/page-header.tsx';
import { useApi } from '@/api/context.tsx';
import { TournamentForm } from '@/components/tournaments/tournament-form.tsx';

/** Create-tournament page. On success the operator lands on the new tournament. */
export function CreateTournamentPage() {
  const api = useApi();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create tournament"
        description="New tournaments start as Draft; open registration from the details page."
      />
      <TournamentForm
        initialValues={{
          name: '',
          description: '',
          startDate: '',
          endDate: '',
          location: '',
          timezone: 'UTC',
        }}
        submitLabel="Create tournament"
        timezoneEditable
        onCancel={() => {
          const returnTo = params.get('returnTo');
          void navigate(returnTo ?? '/tournaments');
        }}
        onSubmit={async (values) => {
          const tournament = await api.tournaments.create({
            name: values.name.trim(),
            startDate: values.startDate,
            endDate: values.endDate,
            timezone: values.timezone.trim(),
            ...(values.description.trim() ? { description: values.description.trim() } : {}),
            ...(values.location.trim() ? { location: values.location.trim() } : {}),
          });
          void navigate(`/tournaments/${tournament.id}`);
        }}
      />
    </div>
  );
}
