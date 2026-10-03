import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import { CategoryProvider, TournamentProvider } from '@/components/tournaments/context.tsx';
import { StageDetailPage } from '@/pages/tournaments/stage-detail.tsx';

import {
  createStubApi,
  makeCategory,
  makeEntry,
  makeMatch,
  makeStage,
  makeTournament,
} from '../../../tests/helpers.tsx';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const STAGE_ID = '77777777-7777-4777-8777-777777777777';

const TOURNAMENT = makeTournament({ id: TOURNAMENT_ID });
const CATEGORY = makeCategory({ id: CATEGORY_ID, tournamentId: TOURNAMENT_ID });

/**
 * Stage-detail fixture regeneration.
 *
 * A GROUP stage that already has matches offers a "Regenerate fixtures" control;
 * a GROUP stage with no matches (the one-shot setup) and a KNOCKOUT stage do
 * not. Confirming the control must call the regeneration endpoint through the
 * typed client (never the generate endpoint) and refetch the matches.
 */
function renderPage(api = createStubApi()) {
  render(
    <ApiProvider api={api}>
      <MemoryRouter
        initialEntries={[
          `/tournaments/${TOURNAMENT_ID}/categories/${CATEGORY_ID}/stages/${STAGE_ID}`,
        ]}
      >
        <TournamentProvider value={{ tournament: TOURNAMENT, refetch: vi.fn() }}>
          <CategoryProvider
            value={{ category: CATEGORY, tournament: TOURNAMENT, refetch: vi.fn() }}
          >
            <Routes>
              <Route
                path="/tournaments/:tournamentId/categories/:categoryId/stages/:stageId"
                element={<StageDetailPage />}
              />
            </Routes>
          </CategoryProvider>
        </TournamentProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
  return api;
}

function groupApiWithMatches() {
  const api = createStubApi();
  vi.mocked(api.stages.get).mockResolvedValue(
    makeStage({ id: STAGE_ID, categoryId: CATEGORY_ID, type: 'GROUP', status: 'ACTIVE' }),
  );
  vi.mocked(api.matches.listByStage).mockResolvedValue([
    makeMatch({ id: '88888888-8888-4888-8888-888888888888', stageId: STAGE_ID }),
  ]);
  vi.mocked(api.entries.listByCategory).mockResolvedValue([
    makeEntry({
      id: '66666666-6666-4666-8666-666666666666',
      categoryId: CATEGORY_ID,
      status: 'CONFIRMED',
    }),
    makeEntry({
      id: '66666666-6666-4666-8666-666666666667',
      categoryId: CATEGORY_ID,
      status: 'CONFIRMED',
    }),
  ]);
  return api;
}

describe('StageDetailPage fixture regeneration', () => {
  it('offers Regenerate fixtures for a GROUP stage with matches and calls the regeneration endpoint', async () => {
    const user = userEvent.setup();
    const api = groupApiWithMatches();
    renderPage(api);

    // Wait for the stage to load and its matches to render.
    expect(await screen.findByRole('heading', { name: 'Group A' })).toBeInTheDocument();
    await waitFor(() => {
      expect(api.matches.listByStage).toHaveBeenCalled();
    });

    const trigger = await screen.findByRole('button', { name: 'Regenerate fixtures' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog');
    // The confirmation warns that recorded results are discarded.
    expect(within(dialog).getByText(/discards the current matches/i)).toBeInTheDocument();

    // Pick two entries in the dialog's ordering.
    const checkboxes = within(dialog).getAllByRole('checkbox');
    expect(checkboxes.length).toBeGreaterThanOrEqual(2);
    const first = checkboxes[0];
    const second = checkboxes[1];
    if (!first || !second) {
      throw new Error('Expected at least two entry checkboxes.');
    }
    await user.click(first);
    await user.click(second);

    const callsBefore = vi.mocked(api.matches.listByStage).mock.calls.length;
    await user.click(within(dialog).getByRole('button', { name: 'Regenerate fixtures' }));

    await waitFor(() => {
      expect(api.stages.regenerateFixtures).toHaveBeenCalledWith(STAGE_ID, {
        entryIds: ['66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666667'],
      });
    });
    // It never falls back to the one-shot generate endpoint.
    expect(api.stages.generateFixtures).not.toHaveBeenCalled();
    // Confirming refetches the match list.
    await waitFor(() => {
      expect(vi.mocked(api.matches.listByStage).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('does not offer Regenerate fixtures for a GROUP stage with no matches', async () => {
    const api = createStubApi();
    vi.mocked(api.stages.get).mockResolvedValue(
      makeStage({ id: STAGE_ID, categoryId: CATEGORY_ID, type: 'GROUP' }),
    );
    vi.mocked(api.matches.listByStage).mockResolvedValue([]);
    vi.mocked(api.entries.listByCategory).mockResolvedValue([
      makeEntry({
        id: '66666666-6666-4666-8666-666666666666',
        categoryId: CATEGORY_ID,
        status: 'CONFIRMED',
      }),
      makeEntry({
        id: '66666666-6666-4666-8666-666666666667',
        categoryId: CATEGORY_ID,
        status: 'CONFIRMED',
      }),
    ]);
    renderPage(api);

    expect(await screen.findByRole('heading', { name: 'Group A' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Generate fixtures' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate fixtures' })).not.toBeInTheDocument();
  });

  it('does not offer Regenerate fixtures for a KNOCKOUT stage', async () => {
    const api = createStubApi();
    vi.mocked(api.stages.get).mockResolvedValue(
      makeStage({ id: STAGE_ID, categoryId: CATEGORY_ID, type: 'KNOCKOUT' }),
    );
    vi.mocked(api.matches.listByStage).mockResolvedValue([
      makeMatch({ id: '88888888-8888-4888-8888-888888888888', stageId: STAGE_ID }),
    ]);
    renderPage(api);

    expect(await screen.findByRole('heading', { name: 'Group A' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Regenerate fixtures' })).not.toBeInTheDocument();
  });
});
