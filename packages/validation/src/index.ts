/**
 * Shared Zod schemas and request-validation helpers.
 *
 * Phase 1 covers health plus the generic `parseRequest` pattern. Phase 2.2 adds
 * the tournament application input schemas used at the application boundary.
 */
export type { ValidationFailure, ValidationIssue } from './failure.ts';
export { parseRequest, toValidationFailure, type ParseResult } from './parse.ts';
export { healthResponseSchema, parseHealthResponse } from './health.ts';

export {
  categoryIdParamSchema,
  courtIdParamSchema,
  idParamSchema,
  matchIdParamSchema,
  mergeParams,
  playerIdParamSchema,
  stageIdParamSchema,
  teamMemberParamSchema,
  tournamentIdParamSchema,
} from './params.ts';

export {
  categoryTransitionInputSchema,
  matchTransitionInputSchema,
  stageTransitionInputSchema,
  tournamentTransitionInputSchema,
  type CategoryTransitionInput,
  type MatchTransitionInput,
  type StageTransitionInput,
  type TournamentTransitionInput,
} from './tournament/transitions.ts';

export {
  courtNameSchema,
  courtTransitionInputSchema,
  createCourtInputSchema,
  scheduleMatchInputSchema,
  scheduledInstantSchema,
  updateCourtInputSchema,
  type CourtTransitionInput,
  type CreateCourtInput,
  type ScheduleMatchInput,
  type UpdateCourtInput,
} from './tournament/courts.ts';

export {
  calendarDateSchema,
  nameSchema,
  optionalTextSchema,
  timezoneSchema,
} from './tournament/common.ts';
export {
  addMatchParticipantInputSchema,
  addTeamMemberInputSchema,
  categoryCodeSchema,
  createCategoryInputSchema,
  createMatchInputSchema,
  createPlayerInputSchema,
  createStageInputSchema,
  createTeamInputSchema,
  createTournamentInputSchema,
  generateKnockoutBracketInputSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  registerTournamentEntryInputSchema,
  recordMatchGameInputSchema,
  recordMatchResultInputSchema,
  registerEntryBodySchema,
  removeTeamMemberInputSchema,
  updateCategoryInputSchema,
  updateMatchInputSchema,
  updatePlayerInputSchema,
  updateStageInputSchema,
  updateTeamInputSchema,
  updateTournamentEntryInputSchema,
  updateTournamentInputSchema,
  type AddMatchParticipantInput,
  type AddTeamMemberInput,
  type CreateCategoryInput,
  type CreateMatchInput,
  type CreatePlayerInput,
  type CreateStageInput,
  type CreateTeamInput,
  type CreateTournamentInput,
  type GenerateKnockoutBracketInput,
  type RecordMatchGameInput,
  type RecordMatchResultInput,
  type RegisterTournamentEntryInput,
  type RemoveTeamMemberInput,
  type UpdateCategoryInput,
  type UpdateMatchInput,
  type UpdatePlayerInput,
  type UpdateStageInput,
  type UpdateTeamInput,
  type UpdateTournamentEntryInput,
  type UpdateTournamentInput,
} from './tournament/inputs.ts';
