import type { TournamentEntryService } from '@badminton/application';
import {
  categoryIdParamSchema,
  idParamSchema,
  registerEntryBodySchema,
  updateTournamentEntryInputSchema,
} from '@badminton/validation';
import type { FastifyPluginCallback } from 'fastify';

import { compact, validate } from '../request.ts';
import { data } from '../response.ts';

export interface EntryRoutesOptions {
  readonly entries: TournamentEntryService;
}

/**
 * Tournament entry (registration) resources.
 *
 * Registration is nested under its category because the category id is a
 * required input; the competitor XOR, format compatibility, registration-state
 * and player-in-two-teams rules are all enforced by the entry service.
 * Withdrawal and disqualification are explicit lifecycle transitions, per the
 * existing application API.
 */
export const entryRoutes: FastifyPluginCallback<EntryRoutesOptions> = (app, options) => {
  const { entries } = options;

  app.get('/categories/:categoryId/entries', async (request) => {
    const { categoryId } = validate(categoryIdParamSchema, request.params);
    return data(await entries.listByCategory(categoryId));
  });

  app.post('/categories/:categoryId/entries', async (request, reply) => {
    const { categoryId } = validate(categoryIdParamSchema, request.params);
    const body = validate(registerEntryBodySchema, request.body);
    const entry = await entries.register({ categoryId, ...compact(body) });
    return reply.status(201).send(data(entry));
  });

  app.get('/entries/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await entries.getById(id));
  });

  app.patch('/entries/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(updateTournamentEntryInputSchema, request.body);
    return data(await entries.update(id, compact(body)));
  });

  app.post('/entries/:id/confirm', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await entries.confirm(id));
  });

  app.post('/entries/:id/withdraw', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await entries.withdraw(id));
  });

  app.post('/entries/:id/disqualify', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await entries.disqualify(id));
  });
};
