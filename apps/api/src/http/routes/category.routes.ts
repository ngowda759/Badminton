import type { TournamentCategoryService } from '@badminton/application';
import {
  categoryTransitionInputSchema,
  idParamSchema,
  updateCategoryInputSchema,
} from '@badminton/validation';
import type { FastifyPluginCallback } from 'fastify';

import { compact, validate } from '../request.ts';
import { data } from '../response.ts';

export interface CategoryRoutesOptions {
  readonly categories: TournamentCategoryService;
}

/**
 * Category resources under `/api/v1/categories`.
 *
 * Creation is nested under its tournament (see `tournamentRoutes`); this plugin
 * covers reading, renaming and the lifecycle transition. The rule that freezes
 * `format` once entries exist stays in the category service.
 */
export const categoryRoutes: FastifyPluginCallback<CategoryRoutesOptions> = (app, options) => {
  const { categories } = options;

  app.get('/categories/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await categories.getById(id));
  });

  app.patch('/categories/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(updateCategoryInputSchema, request.body);
    return data(await categories.update(id, compact(body)));
  });

  app.post('/categories/:id/transition', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(categoryTransitionInputSchema, request.body);
    return data(await categories.transitionStatus(id, body));
  });
};
