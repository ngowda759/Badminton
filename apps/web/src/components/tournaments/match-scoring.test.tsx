import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client.ts';
import { MatchScoring } from '@/components/tournaments/match-scoring.tsx';

import { createStubApi, renderWithProviders } from '../../../tests/helpers.tsx';

const MATCH_ID = '88888888-8888-4888-8888-888888888888';

function renderScoring(api = createStubApi(), matchKind: 'GROUP' | 'KNOCKOUT' = 'KNOCKOUT') {
  const onCompleted = vi.fn();
  renderWithProviders(
    <MatchScoring
      matchId={MATCH_ID}
      slot1Label="Alice"
      slot2Label="Bob"
      matchKind={matchKind}
      onCompleted={onCompleted}
    />,
    { api },
  );
  return { api, onCompleted };
}

describe('MatchScoring', () => {
  it('derives the game winner from the scores', async () => {
    const user = userEvent.setup();
    renderScoring();

    await user.type(screen.getByLabelText('Game 1 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '18');

    expect(screen.getByTestId('game-1-winner')).toHaveTextContent('Game winner: Alice');
  });

  it('labels score inputs per game and participant', () => {
    renderScoring();
    expect(screen.getByLabelText('Game 1 — Alice points')).toBeInTheDocument();
    expect(screen.getByLabelText('Game 1 — Bob points')).toBeInTheDocument();
    expect(screen.getByLabelText('Game 2 — Alice points')).toBeInTheDocument();
  });

  it('flags an invalid game score immediately', async () => {
    const user = userEvent.setup();
    renderScoring();

    await user.type(screen.getByLabelText('Game 1 — Alice points'), '20');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '18');

    expect(await screen.findByTestId('match-score-error')).toBeInTheDocument();
  });

  it('submits a valid 2-0 result and derives the match winner', async () => {
    const user = userEvent.setup();
    const { api, onCompleted } = renderScoring();

    await user.type(screen.getByLabelText('Game 1 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '15');
    await user.type(screen.getByLabelText('Game 2 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 2 — Bob points'), '18');

    expect(await screen.findByTestId('match-winner')).toHaveTextContent('Match winner: Alice');

    await user.click(screen.getByRole('button', { name: 'Save & complete result' }));

    await waitFor(() => {
      expect(api.matches.recordResult).toHaveBeenCalledWith(MATCH_ID, {
        games: [
          { gameNumber: 1, participant1Points: 21, participant2Points: 15 },
          { gameNumber: 2, participant1Points: 21, participant2Points: 18 },
        ],
      });
    });
    expect(onCompleted).toHaveBeenCalled();
  });

  it('adds a third game and accepts a 2-1 result', async () => {
    const user = userEvent.setup();
    const { api } = renderScoring();

    await user.type(screen.getByLabelText('Game 1 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '18');
    await user.type(screen.getByLabelText('Game 2 — Alice points'), '18');
    await user.type(screen.getByLabelText('Game 2 — Bob points'), '21');

    await user.click(screen.getByRole('button', { name: 'Add game' }));
    await user.type(screen.getByLabelText('Game 3 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 3 — Bob points'), '19');

    await user.click(screen.getByRole('button', { name: 'Save & complete result' }));

    await waitFor(() => {
      expect(api.matches.recordResult).toHaveBeenCalledWith(MATCH_ID, {
        games: [
          { gameNumber: 1, participant1Points: 21, participant2Points: 18 },
          { gameNumber: 2, participant1Points: 18, participant2Points: 21 },
          { gameNumber: 3, participant1Points: 21, participant2Points: 19 },
        ],
      });
    });
  });

  it('submits a single game for a group match and derives the match winner', async () => {
    const user = userEvent.setup();
    const { api, onCompleted } = renderScoring(createStubApi(), 'GROUP');

    // A group match is a single game: one game fieldset, no add/remove.
    expect(screen.queryByLabelText('Game 2 — Alice points')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add game' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Game — Alice points'), '21');
    await user.type(screen.getByLabelText('Game — Bob points'), '15');

    expect(await screen.findByTestId('match-winner')).toHaveTextContent('Match winner: Alice');

    await user.click(screen.getByRole('button', { name: 'Save & complete result' }));

    await waitFor(() => {
      expect(api.matches.recordResult).toHaveBeenCalledWith(MATCH_ID, {
        games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 15 }],
      });
    });
    expect(onCompleted).toHaveBeenCalled();
  });

  it('disables submit and shows no winner for an incomplete result', async () => {
    const user = userEvent.setup();
    renderScoring();

    await user.type(screen.getByLabelText('Game 1 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '15');

    expect(screen.queryByTestId('match-winner')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save & complete result' })).toBeDisabled();
  });

  it('surfaces an API error without leaking internals', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    api.matches.recordResult.mockRejectedValueOnce(
      new ApiError(422, 'BUSINESS_RULE_VIOLATION', 'The match must have exactly two participants.'),
    );
    renderScoring(api);

    await user.type(screen.getByLabelText('Game 1 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '15');
    await user.type(screen.getByLabelText('Game 2 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 2 — Bob points'), '18');
    await user.click(screen.getByRole('button', { name: 'Save & complete result' }));

    expect(
      await screen.findByText('The match must have exactly two participants.'),
    ).toBeInTheDocument();
  });
});
