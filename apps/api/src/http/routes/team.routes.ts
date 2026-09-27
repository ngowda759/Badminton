import type { TeamService } from '@badminton/application';
import {
  addTeamMemberInputSchema,
  createTeamInputSchema,
  idParamSchema,
  teamMemberParamSchema,
  updateTeamInputSchema,
} from '@badminton/validation';
import type { FastifyPluginCallback } from 'fastify';

import { compact, validate } from '../request.ts';
import { data } from '../response.ts';

export interface TeamRoutesOptions {
  readonly teams: TeamService;
}

/**
 * Team resources under `/api/v1/teams`.
 *
 * Membership operations are atomic inside the team service; the routes never
 * open a transaction or compute a member position themselves.
 */
export const teamRoutes: FastifyPluginCallback<TeamRoutesOptions> = (app, options) => {
  const { teams } = options;

  app.post('/teams', async (request, reply) => {
    const body = validate(createTeamInputSchema, request.body);
    const team = await teams.create(compact(body));
    return reply.status(201).send(data(team));
  });

  app.get('/teams/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await teams.getById(id));
  });

  app.patch('/teams/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(updateTeamInputSchema, request.body);
    return data(await teams.update(id, body));
  });

  app.get('/teams/:id/members', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await teams.listMembers(id));
  });

  app.post('/teams/:id/members', async (request, reply) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(addTeamMemberInputSchema, request.body);
    const member = await teams.addMember(id, compact(body));
    return reply.status(201).send(data(member));
  });

  app.delete('/teams/:id/members/:playerId', async (request, reply) => {
    const { id, playerId } = validate(teamMemberParamSchema, request.params);
    await teams.removeMember(id, playerId);
    return reply.status(204).send();
  });
};
