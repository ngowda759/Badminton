import type { CategoryFormat, CategoryGender } from '@badminton/domain';
import type {
  CategoryStatus,
  EntryStatus,
  MatchSlot,
  MatchStatus,
  StageStatus,
  StageType,
  TournamentStatus,
} from '@badminton/domain';

export type { CategoryFormat, CategoryGender, StageType } from '@badminton/domain';

/**
 * Serialized shapes returned by the Phase 3 REST API.
 *
 * These mirror the domain aggregates but describe JSON: calendar dates arrive
 * as ISO-8601 strings, not `Date` instances. The status/format unions are
 * reused from the dependency-free `@badminton/domain` package so the browser
 * shares one vocabulary with the server without importing server internals.
 */

export interface TournamentDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly startDate: string;
  readonly endDate: string;
  readonly location: string | null;
  readonly timezone: string;
  readonly status: TournamentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CategoryDto {
  readonly id: string;
  readonly tournamentId: string;
  readonly name: string;
  readonly code: string;
  readonly format: CategoryFormat;
  readonly gender: CategoryGender | null;
  readonly status: CategoryStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlayerDto {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TeamDto {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TeamMemberDto {
  readonly id: string;
  readonly teamId: string;
  readonly playerId: string;
  readonly position: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EntryDto {
  readonly id: string;
  readonly categoryId: string;
  readonly playerId: string | null;
  readonly teamId: string | null;
  readonly seed: number | null;
  readonly status: EntryStatus;
  readonly registeredAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StageDto {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly type: StageType;
  readonly sequence: number;
  readonly drawSize: number | null;
  readonly status: StageStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MatchDto {
  readonly id: string;
  readonly stageId: string;
  readonly sequence: number;
  readonly roundNumber: number | null;
  readonly matchNumber: number | null;
  readonly status: MatchStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MatchParticipantDto {
  readonly id: string;
  readonly matchId: string;
  readonly entryId: string;
  readonly slot: MatchSlot;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Request payloads                                                    */
/* ------------------------------------------------------------------ */

export interface CreateTournamentInput {
  readonly name: string;
  readonly description?: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly location?: string;
  readonly timezone: string;
}

export interface UpdateTournamentInput {
  readonly name?: string;
  readonly description?: string;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly location?: string;
}

export interface CreateCategoryInput {
  readonly name: string;
  readonly code: string;
  readonly format: CategoryFormat;
  readonly gender?: CategoryGender | null;
}

export interface UpdateCategoryInput {
  readonly name?: string;
  readonly format?: CategoryFormat;
  readonly gender?: CategoryGender | null;
}

export interface CreatePlayerInput {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
}

export interface UpdatePlayerInput {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
}

export interface CreateTeamInput {
  readonly name: string;
  readonly memberPlayerIds?: readonly string[];
}

export interface UpdateTeamInput {
  readonly name: string;
}

export interface AddTeamMemberInput {
  readonly playerId: string;
  readonly position?: number;
}

export interface RegisterEntryInput {
  readonly playerId?: string;
  readonly teamId?: string;
  readonly seed?: number;
}

export interface UpdateEntryInput {
  readonly seed: number | null;
}

export interface CreateStageInput {
  readonly name: string;
  readonly type: StageType;
  readonly sequence: number;
  readonly drawSize?: number;
}

export interface UpdateStageInput {
  readonly name?: string;
  readonly sequence?: number;
  readonly drawSize?: number | null;
}

export interface CreateMatchInput {
  readonly sequence: number;
  readonly roundNumber?: number;
  readonly matchNumber?: number;
}

export interface UpdateMatchInput {
  readonly sequence?: number;
  readonly roundNumber?: number | null;
  readonly matchNumber?: number | null;
}

export interface AddMatchParticipantInput {
  readonly entryId: string;
  readonly slot: MatchSlot;
}
