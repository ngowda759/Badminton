import { useState, type SubmitEvent } from 'react';

import { useApi } from '@/api/context.tsx';
import type { MatchResultDto } from '@/api/types.ts';
import { ErrorState } from '@/components/error-state.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useMutation } from '@/hooks/use-mutation.ts';
import { analyseDraftResult, MAX_GAMES_PER_MATCH, type DraftGame } from '@/lib/scoring.ts';

const EMPTY_GAME: DraftGame = { participant1Points: '', participant2Points: '' };

export interface MatchScoringProps {
  readonly matchId: string;
  readonly slot1Label: string;
  readonly slot2Label: string;
  readonly onCompleted: () => void;
}

/**
 * Score entry for an in-progress match.
 *
 * Points are entered per participant slot; the winner is always derived from
 * the scores, never chosen. Illegal or incomplete results are flagged
 * immediately, but the API re-validates through the real domain rules and stays
 * authoritative - this form never decides a result.
 */
export function MatchScoring({ matchId, slot1Label, slot2Label, onCompleted }: MatchScoringProps) {
  const api = useApi();
  const [games, setGames] = useState<readonly DraftGame[]>([{ ...EMPTY_GAME }, { ...EMPTY_GAME }]);
  const mutation = useMutation<MatchResultDto>();

  const analysis = analyseDraftResult(games);

  const setPoints = (index: number, field: keyof DraftGame, value: string): void => {
    setGames((current) =>
      current.map((game, position) => (position === index ? { ...game, [field]: value } : game)),
    );
  };

  const addGame = (): void => {
    if (games.length < MAX_GAMES_PER_MATCH) {
      setGames((current) => [...current, { ...EMPTY_GAME }]);
    }
  };

  const removeGame = (index: number): void => {
    if (games.length > 2) {
      setGames((current) => current.filter((_, position) => position !== index));
    }
  };

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!analysis.valid) {
      return;
    }
    void mutation.run(async () => {
      const result = await api.matches.recordResult(matchId, {
        games: games.map((game, index) => ({
          gameNumber: index + 1,
          participant1Points: Number(game.participant1Points),
          participant2Points: Number(game.participant2Points),
        })),
      });
      onCompleted();
      return result;
    });
  };

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      {games.map((game, index) => {
        const gameAnalysis = analysis.games[index];
        const winnerLabel =
          gameAnalysis?.winnerSlot === 1
            ? slot1Label
            : gameAnalysis?.winnerSlot === 2
              ? slot2Label
              : undefined;
        return (
          <fieldset key={index} className="rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">Game {index + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label={`Game ${index + 1} — ${slot1Label} points`}
                htmlFor={`game-${index + 1}-slot-1`}
                error={gameAnalysis?.error}
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={30}
                    {...(describedBy ? { 'aria-describedby': describedBy } : {})}
                    aria-invalid={gameAnalysis?.error ? true : undefined}
                    value={game.participant1Points}
                    onChange={(event) => {
                      setPoints(index, 'participant1Points', event.target.value);
                    }}
                  />
                )}
              </FormField>
              <FormField
                label={`Game ${index + 1} — ${slot2Label} points`}
                htmlFor={`game-${index + 1}-slot-2`}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={30}
                    value={game.participant2Points}
                    onChange={(event) => {
                      setPoints(index, 'participant2Points', event.target.value);
                    }}
                  />
                )}
              </FormField>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs" data-testid={`game-${index + 1}-winner`}>
                {winnerLabel ? `Game winner: ${winnerLabel}` : 'Game winner: —'}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={games.length <= 2}
                onClick={() => {
                  removeGame(index);
                }}
              >
                Remove game {index + 1}
              </Button>
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={games.length >= MAX_GAMES_PER_MATCH}
          onClick={addGame}
        >
          Add game
        </Button>
        <Button type="submit" disabled={!analysis.valid || mutation.pending}>
          {mutation.pending ? 'Saving…' : 'Save & complete result'}
        </Button>
      </div>

      {analysis.matchError ? (
        <p className="text-destructive text-sm" role="alert" data-testid="match-score-error">
          {analysis.matchError}
        </p>
      ) : null}
      {analysis.valid ? (
        <p className="text-sm font-medium" data-testid="match-winner">
          Match winner: {analysis.winnerSlot === 1 ? slot1Label : slot2Label}
        </p>
      ) : null}
      {mutation.error ? <ErrorState error={mutation.error} title="Could not save result" /> : null}
    </form>
  );
}
