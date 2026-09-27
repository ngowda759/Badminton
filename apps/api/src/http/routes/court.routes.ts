import type { CourtService, MatchSchedulingService } from '@badminton/application';
import {
  courtTransitionInputSchema,
  createCourtInputSchema,
  idParamSchema,
  scheduleMatchInputSchema,
  tournamentIdParamSchema,
  updateCourtInputSchema,
} from '@badminton/validation';
import type { FastifyPluginCallback } from 'fastify';

import { compact, validate } from '../request.ts';
import { data } from '../response.ts';

export interface CourtSchedulingRoutesOptions {
  readonly courts: CourtService;
  readonly scheduling: MatchSchedulingService;
}

/**
 * Court management and match scheduling resources.
 *
 * Courts are listed/created under their tournament; the scheduling endpoints
 * attach a court and a time window to a match. Handlers validate, delegate and
 * serialise only - the ownership, status and overlap rules live in the services
 * and ultimately the database constraints.
 */
export const courtSchedulingRoutes: FastifyPluginCallback<CourtSchedulingRoutesOptions> = (
  app,
  options,
) => {
  const { courts, scheduling } = options;

  app.get('/tournaments/:tournamentId/courts', async (request) => {
    const { tournamentId } = validate(tournamentIdParamSchema, request.params);
    return data(await courts.listByTournament(tournamentId));
  });

  app.post('/tournaments/:tournamentId/courts', async (request, reply) => {
    const { tournamentId } = validate(tournamentIdParamSchema, request.params);
    const body = validate(createCourtInputSchema, request.body);
    const court = await courts.create(tournamentId, compact(body));
    return reply.status(201).send(data(court));
  });

  app.get('/courts/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await courts.getById(id));
  });

  app.patch('/courts/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(updateCourtInputSchema, request.body);
    return data(await courts.update(id, compact(body)));
  });

  app.post('/courts/:id/transition', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(courtTransitionInputSchema, request.body);
    return data(await courts.transitionStatus(id, body));
  });

  app.post('/matches/:id/schedule', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(scheduleMatchInputSchema, request.body);
    return data(await scheduling.schedule(id, body));
  });

  app.delete('/matches/:id/schedule', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await scheduling.unschedule(id));
  });
};
