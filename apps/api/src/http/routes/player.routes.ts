import type { PlayerService } from '@badminton/application';
import {
  createPlayerInputSchema,
  idParamSchema,
  updatePlayerInputSchema,
} from '@badminton/validation';
import type { FastifyPluginCallback } from 'fastify';

import { compact, validate } from '../request.ts';
import { data } from '../response.ts';

export interface PlayerRoutesOptions {
  readonly players: PlayerService;
}

/**
 * Player resources under `/api/v1/players`.
 *
 * Email/phone normalization and duplicate detection live in the player service
 * (and the database indexes behind it); the route only validates shape and
 * delegates.
 */
export const playerRoutes: FastifyPluginCallback<PlayerRoutesOptions> = (app, options) => {
  const { players } = options;

  app.post('/players', async (request, reply) => {
    const body = validate(createPlayerInputSchema, request.body);
    const player = await players.create(compact(body));
    return reply.status(201).send(data(player));
  });

  app.get('/players/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await players.getById(id));
  });

  app.patch('/players/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(updatePlayerInputSchema, request.body);
    return data(await players.update(id, compact(body)));
  });
};
