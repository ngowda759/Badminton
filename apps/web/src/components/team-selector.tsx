import { useApi } from '@/api/context.tsx';
import {
  CollectionSelect,
  type CollectionOption,
  type CompetitorSelectorProps,
} from '@/components/collection-select.tsx';
import { useCollectionOptions } from '@/hooks/use-collection-options.ts';

/**
 * Team dropdown backed by `GET /api/v1/teams`.
 *
 * Walks every page of the collection so a team on any page is selectable, and
 * submits the selected team's id as the field value.
 */
export function TeamSelector(props: CompetitorSelectorProps) {
  const api = useApi();
  const { state, refetch } = useCollectionOptions<CollectionOption>(
    ['teams', 'options'],
    async (params, signal) => {
      const page = await api.teams.list(params, signal);
      return {
        items: page.items.map((team) => ({ id: team.id, label: team.name })),
        nextCursor: page.nextCursor,
      };
    },
  );

  return (
    <CollectionSelect
      {...props}
      placeholder="Select team"
      emptyMessage="No teams available. Create a team first."
      state={state}
      onRetry={refetch}
    />
  );
}
