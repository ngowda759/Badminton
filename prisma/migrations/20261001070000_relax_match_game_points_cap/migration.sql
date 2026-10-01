-- TASK-7 - relax the match-game point cap for knockout games (V1 parity).
--
-- V1 knockout games are played to the round's target and won by two clear
-- points with **no absolute ceiling** (a 31-29 game is legal at the 30-point
-- target), while a group game keeps V1's 30-point cap. The original
-- `match_games_points_in_range` CHECK (from `add_match_scoring`) hard-capped
-- every game at 30, which rejected a legal knockout game.
--
-- The database stays the final structural boundary, not the rule engine: this
-- replaces the 0..30 cap with the widest range the domain can produce
-- (`MAX_POINTS_PER_GAME` target + `MAX_KNOCKOUT_EXTENSION`), so the row is
-- structurally sane while the round's exact target and the two-point margin
-- remain enforced in `@badminton/domain`. A group game's 30-point cap is still
-- enforced by the domain rule, unchanged.
--
-- Forward-only: the historical migration is not modified and no existing row is
-- affected (every stored value is already inside the wider range).

ALTER TABLE "match_games"
  DROP CONSTRAINT "match_games_points_in_range";

ALTER TABLE "match_games"
  ADD CONSTRAINT "match_games_points_in_range"
    CHECK (
      "participant1Points" BETWEEN 0 AND 198
      AND "participant2Points" BETWEEN 0 AND 198
    );
