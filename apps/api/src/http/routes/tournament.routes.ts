import type { TournamentCategoryService, TournamentService } from '@badminton/application';
import {
  createCategoryInputSchema,
  createTournamentInputSchema,
  idParamSchema,
  tournamentIdParamSchema,
  tournamentTransitionInputSchema,
  updateTournamentInputSchema,
} from '@badminton/validation';
import type { FastifyPluginCallback } from 'fastify';

import { compact, validate } from '../request.ts';
import { data } from '../response.ts';

export interface TournamentRoutesOptions {
  readonly tournaments: TournamentService;
  readonly categories: TournamentCategoryService;
}

/**
 * Tournament resources under `/api/v1/tournaments`.
 *
 * The category collection is nested here because creating a category requires
 * its owning tournament id. Handlers only validate, delegate to a service and
 * choose a status code; no lifecycle or date rule is evaluated here.
 */
export const tournamentRoutes: FastifyPluginCallback<TournamentRoutesOptions> = (app, options) => {
  const { tournaments, categories } = options;

  app.post('/tournaments', async (request, reply) => {
    const body = validate(createTournamentInputSchema, request.body);
    const tournament = await tournaments.create(compact(body));
    return reply.status(201).send(data(tournament));
  });

  app.get('/tournaments/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await tournaments.getById(id));
  });

  app.patch('/tournaments/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(updateTournamentInputSchema, request.body);
    return data(await tournaments.update(id, compact(body)));
  });

  app.post('/tournaments/:id/transition', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(tournamentTransitionInputSchema, request.body);
    return data(await tournaments.transitionStatus(id, body));
  });

  app.get('/tournaments/:tournamentId/categories', async (request) => {
    const { tournamentId } = validate(tournamentIdParamSchema, request.params);
    return data(await categories.listByTournament(tournamentId));
  });

  app.post('/tournaments/:tournamentId/categories', async (request, reply) => {
    const { tournamentId } = validate(tournamentIdParamSchema, request.params);
    const body = validate(createCategoryInputSchema, request.body);
    const category = await categories.create(tournamentId, compact(body));
    return reply.status(201).send(data(category));
  });
};
