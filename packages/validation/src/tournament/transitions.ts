import {
  CATEGORY_STATUSES,
  MATCH_STATUSES,
  STAGE_STATUSES,
  TOURNAMENT_STATUSES,
} from '@badminton/domain';
import { z } from 'zod';

/**
 * Request schemas for the lifecycle transition endpoints.
 *
 * Each schema accepts a single `status` drawn from the aggregate's status
 * enum. Whether that status is *reachable* is a domain rule applied by the
 * application service - validation only guarantees a value the service's
 * command type can accept.
 */

export const tournamentTransitionInputSchema = z.object({
  status: z.enum(TOURNAMENT_STATUSES),
});

export const categoryTransitionInputSchema = z.object({
  status: z.enum(CATEGORY_STATUSES),
});

export const stageTransitionInputSchema = z.object({
  status: z.enum(STAGE_STATUSES),
});

export const matchTransitionInputSchema = z.object({
  status: z.enum(MATCH_STATUSES),
});

export type TournamentTransitionInput = z.input<typeof tournamentTransitionInputSchema>;
export type CategoryTransitionInput = z.input<typeof categoryTransitionInputSchema>;
export type StageTransitionInput = z.input<typeof stageTransitionInputSchema>;
export type MatchTransitionInput = z.input<typeof matchTransitionInputSchema>;
