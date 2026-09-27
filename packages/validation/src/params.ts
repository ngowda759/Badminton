import { z } from 'zod';

/**
 * Path-parameter schemas shared by the REST routes.
 *
 * Route handlers must validate every path parameter before calling an
 * application service, so an arbitrary URL segment can never reach the
 * persistence layer as a malformed identifier. The parameter map is keyed by
 * the placeholder name Fastify gives a route (`:id`, `:categoryId`, ...).
 */
export const idParamSchema = z.object({ id: z.uuid() });
export const tournamentIdParamSchema = z.object({ tournamentId: z.uuid() });
export const categoryIdParamSchema = z.object({ categoryId: z.uuid() });
export const stageIdParamSchema = z.object({ stageId: z.uuid() });
export const matchIdParamSchema = z.object({ matchId: z.uuid() });
export const playerIdParamSchema = z.object({ playerId: z.uuid() });
export const courtIdParamSchema = z.object({ courtId: z.uuid() });

/**
 * Combines two path-parameter schemas so a nested route can validate both of
 * its placeholders (for example `/teams/:id/members/:playerId`).
 */
export function mergeParams<A extends z.ZodRawShape, B extends z.ZodRawShape>(
  left: z.ZodObject<A>,
  right: z.ZodObject<B>,
): z.ZodObject<A & B> {
  return left.extend(right.shape) as z.ZodObject<A & B>;
}

export const teamMemberParamSchema = mergeParams(idParamSchema, playerIdParamSchema);
