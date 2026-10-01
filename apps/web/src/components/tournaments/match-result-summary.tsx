import type { MatchResultDto } from '@/api/types.ts';

export interface MatchResultSummaryProps {
  readonly result: MatchResultDto;
  readonly slot1Label: string;
  readonly slot2Label: string;
}

/**
 * Read-only view of a completed match result.
 *
 * The result is derived from validated scores and is immutable in this phase:
 * there is no edit affordance, because result correction is a separate workflow
 * that has not been designed. The winner is whatever the stored games say.
 *
 * A group match is a single game, so the headline shows that game's score; a
 * knockout match is best of three, so it shows the games won (`2–0`, `2–1`).
 */
export function MatchResultSummary({ result, slot1Label, slot2Label }: MatchResultSummaryProps) {
  const winnerLabel = result.winnerSlot === 1 ? slot1Label : slot2Label;
  const singleGame = result.games.length === 1 ? result.games[0] : undefined;
  const headline = singleGame
    ? `${String(singleGame.participant1Points)}–${String(singleGame.participant2Points)}`
    : `${String(result.winnerGames)}–${String(result.loserGames)}`;

  return (
    <div className="space-y-3" data-testid="match-result-summary">
      <p className="text-sm font-medium" data-testid="match-result-winner">
        Winner: {winnerLabel} ({headline})
      </p>
      <ul className="space-y-1">
        {result.games.map((game) => {
          const gameWinner = game.winnerSlot === 1 ? slot1Label : slot2Label;
          return (
            <li
              key={game.gameNumber}
              className="text-sm"
              data-testid={`result-game-${game.gameNumber}`}
            >
              Game {game.gameNumber}: {slot1Label} {game.participant1Points} –{' '}
              {game.participant2Points} {slot2Label}
              <span className="text-muted-foreground"> · won by {gameWinner}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
