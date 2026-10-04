import type {
  TournamentBackupService,
  TournamentCategoryService,
  TournamentResetService,
  TournamentService,
} from '@badminton/application';
import {
  createCategoryInputSchema,
  createTournamentInputSchema,
  idParamSchema,
  listQuerySchema,
  tournamentIdParamSchema,
  tournamentTransitionInputSchema,
  updateTournamentInputSchema,
} from '@badminton/validation';
import type { FastifyPluginCallback } from 'fastify';

import { toListResponse, toTournamentBackupDto, toTournamentListItem } from '../dto.ts';
import { compact, normalizeListQuery, validate } from '../request.ts';
import { data } from '../response.ts';

export interface TournamentRoutesOptions {
  readonly tournaments: TournamentService;
  readonly backup: TournamentBackupService;
  readonly reset: TournamentResetService;
  readonly categories: TournamentCategoryService;
}

/**
 * Tournament resources under `/api/v1/tournaments`.
 *
 * The category collection is nested here because creating a category requires
 * its owning tournament id. Handlers only validate, delegate to a service and
 * choose a status code; no lifecycle or date rule is evaluated here.
 *
 * The backup export is a pure read assembled by the service; the guarded reset
 * is a destructive, tournament-scoped operation the service owns. Both are
 * tournament-scoped and permission-free, matching every other endpoint here.
 */
export const tournamentRoutes: FastifyPluginCallback<TournamentRoutesOptions> = (app, options) => {
  const { tournaments, backup, reset, categories } = options;

  app.post('/tournaments', async (request, reply) => {
    const body = validate(createTournamentInputSchema, request.body);
    const tournament = await tournaments.create(compact(body));
    return reply.status(201).send(data(tournament));
  });

  app.get('/tournaments', async (request) => {
    const query = validate(listQuerySchema, request.query);
    const page = await tournaments.list(normalizeListQuery(query));
    return data(toListResponse(page, toTournamentListItem));
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

  // Whole-tournament JSON backup: a pure read assembled by the service, so a
  // mis-created or abandoned tournament can be snapshotted before a destructive
  // change. Read-only; the route only validates the id and serialises the DTO.
  app.get('/tournaments/:id/export', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(toTournamentBackupDto(await backup.export(id)));
  });

  // Guarded reset: clears every match result and schedule and reopens every
  // active/completed stage to PENDING in one transaction. The service refuses a
  // COMPLETED or CANCELLED tournament (409) and an unknown id (404); the route
  // only validates the id and serialises the summary.
  app.post('/tournaments/:id/reset', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await reset.reset(id));
  });
};
