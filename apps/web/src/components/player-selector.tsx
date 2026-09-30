import { useApi } from '@/api/context.tsx';
import {
  CollectionSelect,
  type CollectionOption,
  type CompetitorSelectorProps,
} from '@/components/collection-select.tsx';
import { useCollectionOptions } from '@/hooks/use-collection-options.ts';

/**
 * Player dropdown backed by `GET /api/v1/players`.
 *
 * Walks every page of the collection so a player on any page is selectable, and
 * submits the selected player's id as the field value.
 */
export function PlayerSelector(props: CompetitorSelectorProps) {
  const api = useApi();
  const { state, refetch } = useCollectionOptions<CollectionOption>(
    ['players', 'options'],
    async (params, signal) => {
      const page = await api.players.list(params, signal);
      return {
        items: page.items.map((player) => ({ id: player.id, label: player.name })),
        nextCursor: page.nextCursor,
      };
    },
  );

  return (
    <CollectionSelect
      {...props}
      placeholder="Select player"
      emptyMessage="No players available. Create a player first."
      state={state}
      onRetry={refetch}
    />
  );
}
