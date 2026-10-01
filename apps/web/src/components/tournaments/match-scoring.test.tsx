import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/client.ts';
import { MatchScoring } from '@/components/tournaments/match-scoring.tsx';

import { createStubApi, renderWithProviders } from '../../../tests/helpers.tsx';

const MATCH_ID = '88888888-8888-4888-8888-888888888888';

function renderScoring(
  api = createStubApi(),
  matchKind: 'GROUP' | 'KNOCKOUT' = 'KNOCKOUT',
  rule?: { readonly format: 'best_of_3' | 'single_game'; readonly pointsPerGame: number },
) {
  const onCompleted = vi.fn();
  renderWithProviders(
    <MatchScoring
      matchId={MATCH_ID}
      slot1Label="Alice"
      slot2Label="Bob"
      matchKind={matchKind}
      {...(rule ? { rule } : {})}
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

  it('plays a knockout match under the round rule and shows the target', async () => {
    const user = userEvent.setup();
    const { api } = renderScoring(createStubApi(), 'KNOCKOUT', {
      format: 'best_of_3',
      pointsPerGame: 15,
    });

    expect(screen.getByTestId('knockout-rule-hint')).toHaveTextContent(
      'Best of 3 to 15 points, win by 2 clear points.',
    );

    // 11 is below the semi-final target of 15.
    await user.type(screen.getByLabelText('Game 1 — Alice points'), '11');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '5');
    expect(await screen.findByTestId('match-score-error')).toHaveTextContent(
      'the winning side must reach 15 points',
    );

    await user.clear(screen.getByLabelText('Game 1 — Alice points'));
    await user.type(screen.getByLabelText('Game 1 — Alice points'), '15');
    await user.type(screen.getByLabelText('Game 2 — Alice points'), '15');
    await user.type(screen.getByLabelText('Game 2 — Bob points'), '9');

    expect(await screen.findByTestId('match-winner')).toHaveTextContent('Match winner: Alice');
    await user.click(screen.getByRole('button', { name: 'Save & complete result' }));

    await waitFor(() => {
      expect(api.matches.recordResult).toHaveBeenCalledWith(MATCH_ID, {
        games: [
          { gameNumber: 1, participant1Points: 15, participant2Points: 5 },
          { gameNumber: 2, participant1Points: 15, participant2Points: 9 },
        ],
      });
    });
  });

  it('accepts a deciding game past 30 at the round target (no ceiling)', async () => {
    const user = userEvent.setup();
    renderScoring(createStubApi(), 'KNOCKOUT', { format: 'best_of_3', pointsPerGame: 21 });

    await user.type(screen.getByLabelText('Game 1 — Alice points'), '31');
    await user.type(screen.getByLabelText('Game 1 — Bob points'), '29');
    await user.type(screen.getByLabelText('Game 2 — Alice points'), '21');
    await user.type(screen.getByLabelText('Game 2 — Bob points'), '18');

    expect(await screen.findByTestId('match-winner')).toHaveTextContent('Match winner: Alice');
    expect(screen.queryByTestId('match-score-error')).not.toBeInTheDocument();
  });

  it('renders a straight-set knockout match as a single game', async () => {
    const user = userEvent.setup();
    renderScoring(createStubApi(), 'KNOCKOUT', { format: 'single_game', pointsPerGame: 21 });

    expect(screen.getByTestId('knockout-rule-hint')).toHaveTextContent(
      'Straight set to 21 points, win by 2 clear points.',
    );
    expect(screen.queryByLabelText('Game 2 — Alice points')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add game' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Game — Alice points'), '21');
    await user.type(screen.getByLabelText('Game — Bob points'), '17');
    expect(await screen.findByTestId('match-winner')).toHaveTextContent('Match winner: Alice');
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

  it('pre-fills a correction and submits through the correction endpoint', async () => {
    const user = userEvent.setup();
    const api = createStubApi();
    const onCompleted = vi.fn();
    renderWithProviders(
      <MatchScoring
        matchId={MATCH_ID}
        slot1Label="Alice"
        slot2Label="Bob"
        matchKind="GROUP"
        correct
        initialGames={[{ participant1Points: 21, participant2Points: 15 }]}
        onCompleted={onCompleted}
      />,
      { api },
    );

    // The stored score is pre-filled, and the button reads as a correction.
    const slot1 = screen.getByLabelText('Game — Alice points');
    const slot2 = screen.getByLabelText('Game — Bob points');
    expect(slot1).toHaveValue(21);
    expect(slot2).toHaveValue(15);

    await user.clear(slot2);
    await user.type(slot2, '19');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));

    await waitFor(() => {
      expect(api.matches.correctResult).toHaveBeenCalledWith(MATCH_ID, {
        games: [{ gameNumber: 1, participant1Points: 21, participant2Points: 19 }],
      });
    });
    expect(api.matches.recordResult).not.toHaveBeenCalled();
    expect(onCompleted).toHaveBeenCalled();
  });
});
