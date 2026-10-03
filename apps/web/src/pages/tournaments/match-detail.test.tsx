import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import { CategoryProvider, TournamentProvider } from '@/components/tournaments/context.tsx';
import { MatchDetailPage } from '@/pages/tournaments/match-detail.tsx';

import {
  createStubApi,
  makeCategory,
  makeMatch,
  makeMatchResult,
  makeStage,
  makeTournament,
} from '../../../tests/helpers.tsx';

const TOURNAMENT_ID = '11111111-1111-4111-8111-111111111111';
const CATEGORY_ID = '22222222-2222-4222-8222-222222222222';
const STAGE_ID = '77777777-7777-4777-8777-777777777777';
const MATCH_ID = '88888888-8888-4888-8888-888888888888';

const TOURNAMENT = makeTournament({ id: TOURNAMENT_ID });
const CATEGORY = makeCategory({ id: CATEGORY_ID, tournamentId: TOURNAMENT_ID });

/**
 * Match-detail result correction.
 *
 * The "Correct result" control must appear for a completed match - group or
 * knockout. Submitting the correction form must call the correction endpoint
 * (never the record endpoint), and the form must be pre-filled from the stored
 * result.
 */
function renderPage(api = createStubApi()) {
  render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[`/matches/${MATCH_ID}`]}>
        <TournamentProvider value={{ tournament: TOURNAMENT, refetch: vi.fn() }}>
          <CategoryProvider
            value={{ category: CATEGORY, tournament: TOURNAMENT, refetch: vi.fn() }}
          >
            <Routes>
              <Route path="/matches/:matchId" element={<MatchDetailPage />} />
            </Routes>
          </CategoryProvider>
        </TournamentProvider>
      </MemoryRouter>
    </ApiProvider>,
  );
  return api;
}

function completedGroupApi() {
  const api = createStubApi();
  vi.mocked(api.matches.get).mockResolvedValue(
    makeMatch({ id: MATCH_ID, stageId: STAGE_ID, status: 'COMPLETED' }),
  );
  vi.mocked(api.stages.get).mockResolvedValue(
    makeStage({ id: STAGE_ID, categoryId: CATEGORY_ID, type: 'GROUP' }),
  );
  vi.mocked(api.matches.getResult).mockResolvedValue(
    makeMatchResult({
      matchId: MATCH_ID,
      games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 15, winnerSlot: 1 }],
      winnerGames: 1,
      loserGames: 0,
    }),
  );
  return api;
}

function completedKnockoutApi() {
  const api = createStubApi();
  vi.mocked(api.matches.get).mockResolvedValue(
    makeMatch({
      id: MATCH_ID,
      stageId: STAGE_ID,
      status: 'COMPLETED',
      roundNumber: 1,
      matchNumber: 1,
    }),
  );
  vi.mocked(api.stages.get).mockResolvedValue(
    makeStage({ id: STAGE_ID, categoryId: CATEGORY_ID, type: 'KNOCKOUT' }),
  );
  vi.mocked(api.matches.getResult).mockResolvedValue(makeMatchResult({ matchId: MATCH_ID }));
  return api;
}

describe('MatchDetailPage result correction', () => {
  it('offers a Correct result control for a completed group match and submits the correction', async () => {
    const user = userEvent.setup();
    const api = completedGroupApi();
    renderPage(api);

    expect(await screen.findByRole('heading', { name: 'Match 1' })).toBeInTheDocument();

    const correctButton = await screen.findByRole('button', { name: 'Correct result' });
    await user.click(correctButton);

    // The destructive action is confirmed before the form is revealed. The
    // dialog's confirm button shares the control's label, so it is scoped to
    // the dialog.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Correct result' }));

    // The correction form is pre-filled from the stored 21-15 result.
    const slot1 = await screen.findByLabelText('Game — Slot 1 points');
    const slot2 = screen.getByLabelText('Game — Slot 2 points');
    expect(slot1).toHaveValue(21);
    expect(slot2).toHaveValue(15);

    await user.clear(slot1);
    await user.type(slot1, '18');
    await user.clear(slot2);
    await user.type(slot2, '21');

    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => {
      expect(api.matches.correctResult).toHaveBeenCalledWith(MATCH_ID, {
        games: [{ gameNumber: 1, participant1Points: 18, participant2Points: 21 }],
      });
    });
    expect(api.matches.recordResult).not.toHaveBeenCalled();
  });

  it('offers a Correct result control for a completed knockout match and submits the correction', async () => {
    const user = userEvent.setup();
    const api = completedKnockoutApi();
    renderPage(api);

    expect(await screen.findByRole('heading', { name: 'Match 1' })).toBeInTheDocument();
    expect(await screen.findByTestId('match-result-summary')).toBeInTheDocument();

    const correctButton = await screen.findByRole('button', { name: 'Correct result' });
    await user.click(correctButton);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Correct result' }));

    // The knockout correction form is revealed (best of three); submitting it
    // calls the correction endpoint, never the record endpoint.
    const game1Slot1 = await screen.findByLabelText('Game 1 — Slot 1 points');
    const game1Slot2 = screen.getByLabelText('Game 1 — Slot 2 points');
    await user.clear(game1Slot1);
    await user.type(game1Slot1, '15');
    await user.clear(game1Slot2);
    await user.type(game1Slot2, '21');
    const game2Slot1 = screen.getByLabelText('Game 2 — Slot 1 points');
    const game2Slot2 = screen.getByLabelText('Game 2 — Slot 2 points');
    await user.clear(game2Slot1);
    await user.type(game2Slot1, '18');
    await user.clear(game2Slot2);
    await user.type(game2Slot2, '21');

    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => {
      expect(api.matches.correctResult).toHaveBeenCalledWith(MATCH_ID, {
        games: [
          { gameNumber: 1, participant1Points: 15, participant2Points: 21 },
          { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
        ],
      });
    });
    expect(api.matches.recordResult).not.toHaveBeenCalled();
  });
});
