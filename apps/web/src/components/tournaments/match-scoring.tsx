import { useState, type SubmitEvent } from 'react';

import { useApi } from '@/api/context.tsx';
import type { MatchResultDto } from '@/api/types.ts';
import { ErrorState } from '@/components/error-state.tsx';
import { FormField } from '@/components/form-field.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useMutation } from '@/hooks/use-mutation.ts';
import {
  analyseDraftResult,
  MAX_GAMES_PER_MATCH,
  type DraftGame,
  type KnockoutRule,
  type MatchKind,
} from '@/lib/scoring.ts';

const EMPTY_GAME: DraftGame = { participant1Points: '', participant2Points: '' };

/** The stored score of one game, used to pre-fill a correction. */
export interface InitialGameScore {
  readonly participant1Points: number;
  readonly participant2Points: number;
}

export interface MatchScoringProps {
  readonly matchId: string;
  readonly slot1Label: string;
  readonly slot2Label: string;
  /** A GROUP match is a single game; a KNOCKOUT match is played under `rule`. */
  readonly matchKind: MatchKind;
  /**
   * The knockout match's scoring rule (format and points target). Ignored for a
   * group match, which always uses the single-game 21/30 rule.
   */
  readonly rule?: KnockoutRule;
  /**
   * The stored games to pre-fill, so the same form can correct a completed
   * result. When omitted the form starts empty (recording a new result).
   */
  readonly initialGames?: readonly InitialGameScore[];
  /** Correct a completed result instead of recording a new one. */
  readonly correct?: boolean;
  readonly onCompleted: () => void;
}

/**
 * Score entry for an in-progress or completed match.
 *
 * Points are entered per participant slot; the winner is always derived from
 * the scores, never chosen. A group match shows a single game; a knockout match
 * follows its round's rule - best of three, or a single "straight set" game -
 * and validates each game against the round's points target. Illegal or
 * incomplete results are flagged immediately, but the API re-validates through
 * the real domain rules and stays authoritative - this form never decides a
 * result.
 *
 * The same form records a new result and corrects a completed group result
 * (`correct`), pre-filled from `initialGames`, so the scoring UI is never
 * duplicated.
 */
export function MatchScoring({
  matchId,
  slot1Label,
  slot2Label,
  matchKind,
  rule,
  initialGames,
  correct = false,
  onCompleted,
}: MatchScoringProps) {
  const api = useApi();
  const isGroup = matchKind === 'GROUP';
  const straight = !isGroup && rule?.format === 'single_game';
  const singleGame = isGroup || straight;
  const defaultGameCount = singleGame ? 1 : 2;
  const [games, setGames] = useState<readonly DraftGame[]>(() =>
    buildInitialGames(initialGames, defaultGameCount),
  );
  const mutation = useMutation<MatchResultDto>();

  const analysis = analyseDraftResult(games, matchKind, rule);
  const maxPoints = isGroup ? 30 : (rule?.pointsPerGame ?? 21) + 20;

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
    const minimum = singleGame ? 1 : 2;
    if (games.length > minimum) {
      setGames((current) => current.filter((_, position) => position !== index));
    }
  };

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!analysis.valid) {
      return;
    }
    void mutation.run(async () => {
      const input = {
        games: games.map((game, index) => ({
          gameNumber: index + 1,
          participant1Points: Number(game.participant1Points),
          participant2Points: Number(game.participant2Points),
        })),
      };
      const result = correct
        ? await api.matches.correctResult(matchId, input)
        : await api.matches.recordResult(matchId, input);
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
        const gameLabel = singleGame ? 'Game' : `Game ${index + 1}`;
        return (
          <fieldset key={index} className="rounded-md border p-3">
            <legend className="px-1 text-sm font-medium">{gameLabel}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                label={`${gameLabel} — ${slot1Label} points`}
                htmlFor={`game-${index + 1}-slot-1`}
                error={gameAnalysis?.error}
              >
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={maxPoints}
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
                label={`${gameLabel} — ${slot2Label} points`}
                htmlFor={`game-${index + 1}-slot-2`}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={maxPoints}
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
              {singleGame ? null : (
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
              )}
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        {singleGame ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={games.length >= MAX_GAMES_PER_MATCH}
            onClick={addGame}
          >
            Add game
          </Button>
        )}
        <Button type="submit" disabled={!analysis.valid || mutation.pending}>
          {mutation.pending ? 'Saving…' : correct ? 'Save correction' : 'Save & complete result'}
        </Button>
      </div>

      {rule ? (
        <p className="text-muted-foreground text-xs" data-testid="knockout-rule-hint">
          {straight ? 'Straight set' : 'Best of 3'} to {rule.pointsPerGame} points, win by 2 clear
          points.
        </p>
      ) : null}
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

/**
 * Seeds the draft games from a stored result, falling back to empty games.
 *
 * A correction is pre-filled from the stored games so the operator edits the
 * existing score rather than retyping it; recording a new result passes no
 * `initialGames` and starts empty. The number of fields always matches the
 * match's format, so a straight-set result never shows an empty second game.
 */
function buildInitialGames(
  initial: readonly InitialGameScore[] | undefined,
  count: number,
): readonly DraftGame[] {
  const seeded = initial ?? [];
  return Array.from({ length: count }, (_, index) => {
    const game = seeded[index];
    return game
      ? {
          participant1Points: String(game.participant1Points),
          participant2Points: String(game.participant2Points),
        }
      : { ...EMPTY_GAME };
  });
}
