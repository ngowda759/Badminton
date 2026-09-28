import { NotFoundError } from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';

/**
 * Resolves the authoritative owning tournament of a stage or a match.
 *
 * Every realtime event must carry the correct `tournamentId`, and the identity
 * is known here - through the stage → category chain - rather than derived from
 * request/session state in the realtime layer. A missing stage or category is a
 * genuine data error, so it raises `NotFoundError` and fails the surrounding
 * transaction rather than recording an unscoped event.
 */
export async function resolveStageTournamentId(
  client: RepositoryClient,
  stageId: string,
): Promise<string> {
  const stage = await client.stages.findById(stageId);
  if (!stage) {
    throw new NotFoundError('Stage', stageId);
  }
  const category = await client.categories.findById(stage.categoryId);
  if (!category) {
    throw new NotFoundError('Category', stage.categoryId);
  }
  return category.tournamentId;
}

/** Resolves the owning tournament of a match through its stage. */
export function resolveMatchTournamentId(
  client: RepositoryClient,
  match: { readonly stageId: string },
): Promise<string> {
  return resolveStageTournamentId(client, match.stageId);
}
