import {
  BusinessRuleViolationError,
  ConflictError,
  DEFAULT_KNOCKOUT_ROUND_RULES,
  determineKnockoutOutcome,
  determineMatchOutcome,
  isMatchCorrectable,
  knockoutMatchRule,
  NotFoundError,
  scoreGroupMatch,
  scoreKnockoutMatch,
  type Match,
  type MatchGame,
  type MatchKind,
  type MatchResult,
  type MatchScoringRule,
  type TournamentStage,
} from '@badminton/domain';

import { REALTIME_AGGREGATES, REALTIME_EVENTS } from '../realtime/event-types.ts';
import type { RealtimeEventService } from '../realtime/event.service.ts';
import type { RepositoryClient } from '../repositories/index.ts';
import type { UnitOfWork } from '../repositories/unit-of-work.ts';
import type { RecordMatchResultCommand } from './commands.ts';
import type { KnockoutProgressionService } from './knockout-progression.service.ts';
import { resolveMatchTournamentId } from './resolve-tournament.ts';

/**
 * Match result and scoring service.
 *
 * Recording a result is the only multi-row write in Phase 5 and is therefore
 * transactional: the match is validated, exactly two participants are required,
 * the games are scored by the domain rules, the result is persisted and the
 * match is moved to `COMPLETED` - all inside one unit of work, so a failure
 * leaves no partial result.
 *
 * The match's **stage type** decides the scoring format: a GROUP match is a
 * single game and a KNOCKOUT match is best of three. The stage is read inside
 * the transaction, so a GROUP result can never be recorded as a best-of-three
 * set (and vice versa), and the stored result is exactly what the table it
 * feeds expects.
 *
 * For a KNOCKOUT match the same unit of work also propagates the winner into the
 * next round (Phase 6), so the result, the recorded winner and the bracket
 * progression commit atomically or not at all.
 *
 * The same transaction also records the realtime outbox events: the result and
 * the completion (`MATCH_RESULT_RECORDED` + `MATCH_COMPLETED`), plus the
 * existing `KNOCKOUT_MATCH_POPULATED` when progression fills a next-round slot.
 * So a committed result always has its notifications and a rolled-back result
 * has none.
 *
 * The service depends only on repository ports and the pure domain rules; it
 * knows nothing about HTTP or React.
 */
export interface MatchResultService {
  recordResult(matchId: string, command: RecordMatchResultCommand): Promise<MatchResult>;
  /**
   * Re-scores a completed **group** match, replacing its stored games and
   * winner in one transaction so a mistyped score can be corrected. Standings
   * and qualification are derived from the stored games, so they correct
   * automatically. A knockout match - which would require re-deriving the
   * bracket - is rejected; see `isMatchCorrectable`.
   */
  correctResult(matchId: string, command: RecordMatchResultCommand): Promise<MatchResult>;
  /** The stored result of a completed match, or `undefined` if it is not complete. */
  getResult(matchId: string): Promise<MatchResult | undefined>;
}

export function createMatchResultService(
  client: RepositoryClient,
  unitOfWork: UnitOfWork,
  events: RealtimeEventService,
  progression?: KnockoutProgressionService,
): MatchResultService {
  return {
    async recordResult(matchId, command): Promise<MatchResult> {
      return unitOfWork.runInTransaction(async (tx) => {
        const match = await tx.matches.findById(matchId);
        if (!match) {
          throw new NotFoundError('Match', matchId);
        }

        // Lifecycle: only an in-progress match may receive a result. A
        // completed match is immutable (so a concurrent second completion is a
        // conflict) and a cancelled or scheduled match cannot be scored.
        if (match.status === 'COMPLETED') {
          throw new ConflictError('This match is already completed.');
        }
        if (match.status !== 'IN_PROGRESS') {
          throw new BusinessRuleViolationError(
            'The match must be in progress before a result can be recorded.',
          );
        }

        // The stage type decides the format: a group match is a single game,
        // a knockout match is played under its snapshotted per-round rule (or
        // the stage's configured rule when it has none). Scoring validity is a
        // pure domain concern, so it is checked here before anything is written.
        const stage = await tx.stages.findById(match.stageId);
        if (!stage) {
          throw new NotFoundError('Stage', match.stageId);
        }
        const matchKind: MatchKind = stage.type === 'GROUP' ? 'GROUP' : 'KNOCKOUT';
        const rule = resolveKnockoutRule(stage, match);
        const games =
          stage.type === 'GROUP'
            ? scoreGroupMatch(command.games)
            : scoreKnockoutMatch(command.games, rule);

        const participants = await tx.matchParticipants.listByMatch(matchId);
        const slot1 = participants.find((participant) => participant.slot === 1);
        const slot2 = participants.find((participant) => participant.slot === 2);
        if (!slot1 || !slot2) {
          throw new BusinessRuleViolationError(
            'A match must have exactly two participants before it can be scored.',
          );
        }

        const savedGames = await tx.matchGames.createMany(
          games.map((game) => ({ matchId, ...game })),
        );

        const outcome =
          matchKind === 'GROUP'
            ? determineMatchOutcome(games, 'GROUP')
            : determineKnockoutOutcome(games, rule);
        const winnerEntryId = outcome.winnerSlot === 1 ? slot1.entryId : slot2.entryId;
        const loserEntryId = outcome.winnerSlot === 1 ? slot2.entryId : slot1.entryId;

        const completed = await tx.matches.complete(matchId, winnerEntryId);

        const tournamentId = await resolveMatchTournamentId(tx, match);

        // Two distinct externally-observable changes, recorded together: the
        // games are now stored (`MATCH_RESULT_RECORDED`) and the match has
        // reached its terminal state (`MATCH_COMPLETED`). There is deliberately
        // no per-game event - the dashboard refetches authoritative state.
        await events.record(tx, {
          tournamentId,
          eventType: REALTIME_EVENTS.MATCH_RESULT_RECORDED,
          aggregateType: REALTIME_AGGREGATES.MATCH,
          aggregateId: matchId,
        });
        await events.record(tx, {
          tournamentId,
          eventType: REALTIME_EVENTS.MATCH_COMPLETED,
          aggregateType: REALTIME_AGGREGATES.MATCH,
          aggregateId: matchId,
        });

        // Knockout progression runs inside the same unit of work (and sees the
        // completed match) so the result and the next-round slot cannot diverge.
        // The final has no successor - `progress` returns false.
        if (progression) {
          const populated = await progression.progress(tx, matchId, winnerEntryId);
          if (populated) {
            await events.record(tx, {
              tournamentId,
              eventType: REALTIME_EVENTS.KNOCKOUT_MATCH_POPULATED,
              aggregateType: REALTIME_AGGREGATES.MATCH,
              aggregateId: matchId,
            });
          }
        }

        return toResult(completed, winnerEntryId, loserEntryId, savedGames, matchKind, rule);
      });
    },

    async correctResult(matchId, command): Promise<MatchResult> {
      // A correction replaces the stored games and the derived winner of a
      // completed group match in one unit of work, so a mistyped score is fixed
      // atomically: a failure leaves the original result, games and winner
      // untouched. Standings and qualification are derived from the stored
      // games, so they correct automatically once this commits.
      return unitOfWork.runInTransaction(async (tx) => {
        const match = await tx.matches.findById(matchId);
        if (!match) {
          throw new NotFoundError('Match', matchId);
        }

        // The stage type decides both the format and whether a correction is
        // allowed, read inside the transaction so the correction and
        // `recordResult` can never disagree.
        const stage = await tx.stages.findById(match.stageId);
        if (!stage) {
          throw new NotFoundError('Stage', match.stageId);
        }

        // Only a completed **group** match may be corrected. A knockout match
        // feeds a bracket and would require re-deriving it (clearing the
        // next-round slot and un-completing downstream matches), which is a
        // separate workflow; a non-completed match has no result. The stage
        // type is the discriminator - a group fixture carries a round-robin
        // `roundNumber`, so the bracket-position fields cannot be used.
        if (!isMatchCorrectable(match, stage)) {
          throw new BusinessRuleViolationError(
            'Only a completed group match result can be corrected.',
          );
        }

        // A group match is a single game, scored by the group validator
        // (21 target, 30 ceiling).
        const matchKind: MatchKind = stage.type === 'GROUP' ? 'GROUP' : 'KNOCKOUT';
        const rule = resolveKnockoutRule(stage, match);
        const games =
          stage.type === 'GROUP'
            ? scoreGroupMatch(command.games)
            : scoreKnockoutMatch(command.games, rule);

        const participants = await tx.matchParticipants.listByMatch(matchId);
        const slot1 = participants.find((participant) => participant.slot === 1);
        const slot2 = participants.find((participant) => participant.slot === 2);
        if (!slot1 || !slot2) {
          throw new BusinessRuleViolationError(
            'A match must have exactly two participants before it can be scored.',
          );
        }

        // Replace the stored games, then reset the match (winner cleared, back
        // to IN_PROGRESS) and re-complete it with the newly derived winner.
        await tx.matchGames.deleteByMatch(matchId);
        const savedGames = await tx.matchGames.createMany(
          games.map((game) => ({ matchId, ...game })),
        );

        const outcome =
          matchKind === 'GROUP'
            ? determineMatchOutcome(games, 'GROUP')
            : determineKnockoutOutcome(games, rule);
        const winnerEntryId = outcome.winnerSlot === 1 ? slot1.entryId : slot2.entryId;
        const loserEntryId = outcome.winnerSlot === 1 ? slot2.entryId : slot1.entryId;

        await tx.matches.clearResult(matchId);
        const completed = await tx.matches.complete(matchId, winnerEntryId);

        const tournamentId = await resolveMatchTournamentId(tx, match);

        // The authoritative result changed, so the same two events
        // `recordResult` emits are recorded here, in the same transaction.
        // There is deliberately no knockout progression: this path is group-only.
        await events.record(tx, {
          tournamentId,
          eventType: REALTIME_EVENTS.MATCH_RESULT_RECORDED,
          aggregateType: REALTIME_AGGREGATES.MATCH,
          aggregateId: matchId,
        });
        await events.record(tx, {
          tournamentId,
          eventType: REALTIME_EVENTS.MATCH_COMPLETED,
          aggregateType: REALTIME_AGGREGATES.MATCH,
          aggregateId: matchId,
        });

        return toResult(completed, winnerEntryId, loserEntryId, savedGames, matchKind, rule);
      });
    },

    async getResult(matchId): Promise<MatchResult | undefined> {
      const match = await client.matches.findById(matchId);
      if (!match) {
        throw new NotFoundError('Match', matchId);
      }
      if (match.status !== 'COMPLETED') {
        return undefined;
      }

      const [participants, games, stage] = await Promise.all([
        client.matchParticipants.listByMatch(matchId),
        client.matchGames.listByMatch(matchId),
        client.stages.findById(match.stageId),
      ]);
      const slot1 = participants.find((participant) => participant.slot === 1);
      const slot2 = participants.find((participant) => participant.slot === 2);
      if (!slot1 || !slot2 || !match.winnerEntryId) {
        throw new BusinessRuleViolationError(
          'A completed match must have two participants and a recorded winner.',
        );
      }

      const matchKind: MatchKind = stage?.type === 'GROUP' ? 'GROUP' : 'KNOCKOUT';
      const loserEntryId = match.winnerEntryId === slot1.entryId ? slot2.entryId : slot1.entryId;
      const rule = resolveKnockoutRule(stage, match);
      return toResult(match, match.winnerEntryId, loserEntryId, games, matchKind, rule);
    },
  };
}

/**
 * The scoring rule a knockout match is read/scored under.
 *
 * The match's own snapshot wins (it was frozen when the bracket was generated),
 * so an existing match keeps the rules it was created under even if the stage is
 * later edited. A match with no snapshot - a knockout match created outside a
 * generated bracket, or a legacy row - falls back to the stage's configured rule
 * for its bracket position, and finally to the domain defaults.
 */
function resolveKnockoutRule(stage: TournamentStage | undefined, match: Match): MatchScoringRule {
  if (match.knockoutFormat && match.knockoutPointsPerGame !== null) {
    return { format: match.knockoutFormat, pointsPerGame: match.knockoutPointsPerGame };
  }
  if (stage && stage.drawSize !== null && match.roundNumber !== null) {
    return knockoutMatchRule(stage.knockoutRules, stage.drawSize, match.roundNumber);
  }
  return { format: 'best_of_3', pointsPerGame: DEFAULT_KNOCKOUT_ROUND_RULES.qf.pointsPerGame };
}

function toResult(
  match: Match,
  winnerEntryId: string,
  loserEntryId: string,
  games: readonly MatchGame[],
  kind: MatchKind,
  rule: MatchScoringRule,
): MatchResult {
  const outcome =
    kind === 'GROUP'
      ? determineMatchOutcome(games, 'GROUP')
      : determineKnockoutOutcome(games, rule);
  return {
    matchId: match.id,
    winnerSlot: outcome.winnerSlot,
    winnerEntryId,
    loserEntryId,
    winnerGames: outcome.winnerGames,
    loserGames: outcome.loserGames,
    games,
  };
}
