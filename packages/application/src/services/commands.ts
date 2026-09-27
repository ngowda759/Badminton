import type {
  CategoryFormat,
  CategoryGender,
  CategoryStatus,
  MatchSlot,
  MatchStatus,
  StageStatus,
  StageType,
  TournamentStatus,
} from '@badminton/domain';

/**
 * Application command types.
 *
 * A service accepts an already shape-validated command. The Zod schemas in
 * `@badminton/validation` produce values compatible with these types at the API
 * boundary; tests construct them directly. Cross-record rules are applied by
 * the services, not here.
 */

export interface CreateTournamentCommand {
  readonly name: string;
  readonly description?: string | null;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly location?: string | null;
  readonly timezone: string;
}

export interface UpdateTournamentCommand {
  readonly name?: string;
  readonly description?: string | null;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly location?: string | null;
}

export interface CreateCategoryCommand {
  readonly name: string;
  readonly code: string;
  readonly format: CategoryFormat;
  readonly gender?: CategoryGender | null;
}

export interface UpdateCategoryCommand {
  readonly name?: string;
  readonly format?: CategoryFormat;
  readonly gender?: CategoryGender | null;
}

export interface CreatePlayerCommand {
  readonly name: string;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export interface UpdatePlayerCommand {
  readonly name?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export interface CreateTeamCommand {
  readonly name: string;
  readonly memberPlayerIds?: readonly string[];
}

export interface AddTeamMemberCommand {
  readonly playerId: string;
  readonly position?: number;
}

export interface RegisterEntryCommand {
  readonly categoryId: string;
  readonly playerId?: string;
  readonly teamId?: string;
  readonly seed?: number;
}

export interface UpdateEntryCommand {
  readonly seed?: number | null;
}

export interface CreateStageCommand {
  readonly name: string;
  readonly type: StageType;
  readonly sequence: number;
  readonly drawSize?: number;
}

export interface UpdateStageCommand {
  readonly name?: string;
  readonly sequence?: number;
  readonly drawSize?: number | null;
}

export interface CreateMatchCommand {
  readonly sequence: number;
  readonly roundNumber?: number;
  readonly matchNumber?: number;
}

export interface UpdateMatchCommand {
  readonly sequence?: number;
  readonly roundNumber?: number | null;
  readonly matchNumber?: number | null;
}

export interface AddMatchParticipantCommand {
  readonly entryId: string;
  readonly slot: MatchSlot;
}

/**
 * Status transitions accepted by the lifecycle endpoints.
 *
 * Cancellation is modelled explicitly rather than by assigning an arbitrary
 * enum value, so a caller cannot silently move an aggregate to any status.
 */
export interface TransitionTournamentStatusCommand {
  readonly status: TournamentStatus;
}

export interface TransitionCategoryStatusCommand {
  readonly status: CategoryStatus;
}

export interface TransitionStageStatusCommand {
  readonly status: StageStatus;
}

export interface TransitionMatchStatusCommand {
  readonly status: MatchStatus;
}
