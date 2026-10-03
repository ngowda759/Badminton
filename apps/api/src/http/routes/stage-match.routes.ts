import type {
  GroupFixtureService,
  KnockoutBracketService,
  MatchResultService,
  MatchService,
  QualificationService,
  StandingsService,
  TournamentStageService,
} from '@badminton/application';
import {
  addMatchParticipantInputSchema,
  categoryIdParamSchema,
  createMatchInputSchema,
  createStageInputSchema,
  generateGroupFixturesInputSchema,
  generateKnockoutBracketInputSchema,
  idParamSchema,
  matchIdParamSchema,
  matchTransitionInputSchema,
  recordMatchResultInputSchema,
  stageIdParamSchema,
  stageTransitionInputSchema,
  updateMatchInputSchema,
  updateStageInputSchema,
} from '@badminton/validation';
import type { FastifyPluginCallback } from 'fastify';

import { compact, validate } from '../request.ts';
import { data } from '../response.ts';

export interface StageMatchRoutesOptions {
  readonly stages: TournamentStageService;
  readonly matches: MatchService;
  readonly matchResults: MatchResultService;
  readonly standings: StandingsService;
  readonly qualification: QualificationService;
  readonly knockout: KnockoutBracketService;
  readonly groupFixtures: GroupFixtureService;
}

/**
 * Stage and match resources.
 *
 * Stages are nested under their category and matches under their stage, because
 * each requires its parent id. No draw generation or scoring happens here; the
 * handlers validate, delegate and serialise.
 */
export const stageMatchRoutes: FastifyPluginCallback<StageMatchRoutesOptions> = (app, options) => {
  const { stages, matches, matchResults, standings, qualification, knockout, groupFixtures } =
    options;

  app.get('/categories/:categoryId/stages', async (request) => {
    const { categoryId } = validate(categoryIdParamSchema, request.params);
    return data(await stages.listByCategory(categoryId));
  });

  app.post('/categories/:categoryId/stages', async (request, reply) => {
    const { categoryId } = validate(categoryIdParamSchema, request.params);
    const body = validate(createStageInputSchema, request.body);
    const stage = await stages.create(categoryId, compact(body));
    return reply.status(201).send(data(stage));
  });

  app.get('/stages/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await stages.getById(id));
  });

  app.patch('/stages/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(updateStageInputSchema, request.body);
    return data(await stages.update(id, compact(body)));
  });

  app.post('/stages/:id/transition', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(stageTransitionInputSchema, request.body);
    return data(await stages.transitionStatus(id, body));
  });

  // Removing a stage is a guarded, single-row delete: the service refuses a
  // stage that still has matches (409) and the last stage of a category (422).
  // The `matches.stageId` Restrict FK stays the final boundary.
  app.delete('/stages/:id', async (request, reply) => {
    const { id } = validate(idParamSchema, request.params);
    await stages.remove(id);
    return reply.status(204).send();
  });

  app.get('/stages/:stageId/matches', async (request) => {
    const { stageId } = validate(stageIdParamSchema, request.params);
    return data(await matches.listByStage(stageId));
  });

  app.post('/stages/:stageId/matches', async (request, reply) => {
    const { stageId } = validate(stageIdParamSchema, request.params);
    const body = validate(createMatchInputSchema, request.body);
    const match = await matches.create(stageId, compact(body));
    return reply.status(201).send(data(match));
  });

  app.get('/matches/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await matches.getById(id));
  });

  app.patch('/matches/:id', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(updateMatchInputSchema, request.body);
    return data(await matches.update(id, compact(body)));
  });

  app.post('/matches/:id/transition', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(matchTransitionInputSchema, request.body);
    return data(await matches.transitionStatus(id, body));
  });

  app.get('/matches/:matchId/participants', async (request) => {
    const { matchId } = validate(matchIdParamSchema, request.params);
    return data(await matches.listParticipants(matchId));
  });

  app.post('/matches/:matchId/participants', async (request, reply) => {
    const { matchId } = validate(matchIdParamSchema, request.params);
    const body = validate(addMatchParticipantInputSchema, request.body);
    const participant = await matches.addParticipant(matchId, body);
    return reply.status(201).send(data(participant));
  });

  // Recording a result both persists the games and completes the match in one
  // transaction, so it replaces the direct COMPLETED transition.
  app.post('/matches/:id/result', async (request, reply) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(recordMatchResultInputSchema, request.body);
    const result = await matchResults.recordResult(id, body);
    return reply.status(201).send(data(result));
  });

  app.get('/matches/:id/result', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    // A match that has not been completed has no result yet; `null` keeps the
    // `{ data }` envelope intact instead of dropping the property.
    return data((await matchResults.getResult(id)) ?? null);
  });

  // Correcting a completed group match replaces its stored games and winner in
  // one transaction, so a mistyped score is fixed without touching the
  // database. A knockout match is rejected (its bracket would need
  // re-deriving), so this reuses the existing result input schema.
  app.post('/matches/:id/result/correction', async (request, reply) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(recordMatchResultInputSchema, request.body);
    const result = await matchResults.correctResult(id, body);
    return reply.status(201).send(data(result));
  });

  app.get('/stages/:id/standings', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await standings.getStageStandings(id));
  });

  // Group-stage fixtures. Generation is a single transactional application call
  // that writes the whole round-robin; the route only validates the request
  // shape and serialises the result. Retrieval reuses `GET /stages/:id/matches`.
  app.post('/stages/:id/fixtures', async (request, reply) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(generateGroupFixturesInputSchema, request.body);
    const fixtures = await groupFixtures.generate(id, body);
    return reply.status(201).send(data(fixtures));
  });

  // Guarded fixture regeneration. The service replaces the whole fixture set of
  // a non-completed GROUP stage that already has fixtures; it replaces, it does
  // not create (409) and it refuses a COMPLETED stage (422). The route only
  // validates the request shape and serialises the result.
  app.post('/stages/:id/fixtures/regenerate', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(generateGroupFixturesInputSchema, request.body);
    const fixtures = await groupFixtures.regenerate(id, body);
    return data(fixtures);
  });

  // Knockout bracket. Generation is a single transactional application call;
  // the route only validates the request shape and serialises the result.
  app.post('/stages/:id/bracket', async (request, reply) => {
    const { id } = validate(idParamSchema, request.params);
    const body = validate(generateKnockoutBracketInputSchema, request.body);
    const bracket = await knockout.generateBracket(id, compact(body));
    return reply.status(201).send(data(bracket));
  });

  // Generate the bracket directly from the feeder group stage's qualifiers: the
  // service reads the standings, seeds the qualifiers (cross-seed / snake-fold)
  // and writes the bracket in one transaction. Rejected while any required group
  // match is incomplete, so stale standings never feed a bracket.
  app.post('/stages/:id/bracket/generate', async (request, reply) => {
    const { id } = validate(idParamSchema, request.params);
    const bracket = await knockout.generateFromQualifiers(id);
    return reply.status(201).send(data(bracket));
  });

  app.get('/stages/:id/bracket', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await knockout.getBracket(id));
  });

  // Qualification is a derived view of the group standings: the top N of each
  // group, the resulting bracket size and the bye count. Read-only; it never
  // advances anything and never mutates state.
  app.get('/stages/:id/qualification', async (request) => {
    const { id } = validate(idParamSchema, request.params);
    return data(await qualification.getView(id));
  });
};
