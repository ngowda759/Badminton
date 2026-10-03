import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import { CategoryProvider, TournamentProvider } from '@/components/tournaments/context.tsx';
import { StagesPage } from '@/pages/tournaments/stages.tsx';

import {
  createStubApi,
  makeCategory,
  makeMatch,
  makeStage,
  makeTournament,
} from '../../../tests/helpers.tsx';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const STAGE_ONE = '77777777-7777-4777-8777-777777777777';
const STAGE_TWO = '99999999-9999-4999-8999-999999999999';

const TOURNAMENT = makeTournament({ id: TOURNAMENT_ID });
const CATEGORY = makeCategory({ id: CATEGORY_ID, tournamentId: TOURNAMENT_ID });

/**
 * Stage-list removal (TASK-10, G11).
 *
 * The "Remove" control must be offered for an empty stage, disabled for a stage
 * that already has matches, and confirming it must call `DELETE /stages/:id`
 * through the typed client and refetch the list.
 */
function renderPage(api = createStubApi()) {
  render(
    <ApiProvider api={api}>
      <MemoryRouter>
        <TournamentProvider value={{ tournament: TOURNAMENT, refetch: vi.fn() }}>
          <CategoryProvider
            value={{ category: CATEGORY, tournament: TOURNAMENT, refetch: vi.fn() }}
          >
            <StagesPage />
          </CategoryProvider>
        </TournamentProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
  return api;
}

function twoEmptyStages() {
  const api = createStubApi();
  vi.mocked(api.stages.listByCategory).mockResolvedValue([
    makeStage({ id: STAGE_ONE, categoryId: CATEGORY_ID, name: 'Group A', sequence: 1 }),
    makeStage({ id: STAGE_TWO, categoryId: CATEGORY_ID, name: 'Knockout', sequence: 2 }),
  ]);
  return api;
}

describe('StagesPage removal', () => {
  it('offers a Remove control for an empty stage and removes it on confirmation', async () => {
    const user = userEvent.setup();
    const api = twoEmptyStages();
    renderPage(api);

    expect(await screen.findByText('Group A')).toBeInTheDocument();
    const removes = screen.getAllByRole('button', { name: 'Remove' });
    expect(removes).toHaveLength(2);
    expect(removes[0]).toBeEnabled();

    await user.click(removes[0] as HTMLElement);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(api.stages.remove).toHaveBeenCalledWith(STAGE_ONE);
    });
    // The list is refetched after the removal.
    await waitFor(() => {
      expect(vi.mocked(api.stages.listByCategory).mock.calls.length).toBeGreaterThan(1);
    });
  });

  it('disables the Remove control for a stage that already has matches', async () => {
    const api = twoEmptyStages();
    vi.mocked(api.matches.listByStage).mockResolvedValue([makeMatch({ stageId: STAGE_ONE })]);
    renderPage(api);

    expect(await screen.findByText('Group A')).toBeInTheDocument();

    const row = screen.getByText('Group A').closest('tr');
    expect(row).not.toBeNull();
    const remove = within(row as HTMLElement).getByRole('button', { name: 'Remove' });
    await waitFor(() => {
      expect(remove).toBeDisabled();
    });
  });
});
