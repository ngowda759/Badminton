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
  /** Set once the match is completed; the winning entry. */
  readonly winnerEntryId: string | null;
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

/** A single game of a completed match as returned by the result endpoint. */
export interface MatchGameDto {
  readonly gameNumber: number;
  readonly participant1Points: number;
  readonly participant2Points: number;
  readonly winnerSlot: MatchSlot;
}

/** A recorded match result, including the resolved winner entry. */
export interface MatchResultDto {
  readonly matchId: string;
  readonly winnerSlot: MatchSlot;
  readonly winnerGames: number;
  readonly loserGames: number;
  readonly winnerEntryId: string;
  readonly loserEntryId: string;
  readonly games: readonly MatchGameDto[];
}

/** One derived line of a group standings table. */
export interface StandingRowDto {
  readonly entryId: string;
  readonly played: number;
  readonly won: number;
  readonly lost: number;
  readonly points: number;
  readonly gamesWon: number;
  readonly gamesLost: number;
  readonly gameDifference: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly pointDifference: number;
  readonly position: number;
}

/** One participant slot of a knockout match; `entryId` is null until filled. */
export interface BracketParticipantDto {
  readonly slot: MatchSlot;
  readonly entryId: string | null;
}

/** One match in a knockout bracket. */
export interface BracketMatchDto {
  readonly matchId: string;
  readonly matchNumber: number;
  readonly sequence: number;
  readonly status: MatchStatus;
  readonly participant1: BracketParticipantDto;
  readonly participant2: BracketParticipantDto;
  readonly winnerEntryId: string | null;
}

/** One round of a knockout bracket. */
export interface BracketRoundDto {
  readonly roundNumber: number;
  readonly name: string;
  readonly matches: readonly BracketMatchDto[];
}

/** The full bracket returned by `GET /stages/:id/bracket`. */
export interface BracketDto {
  readonly stageId: string;
  readonly stageName: string;
  readonly status: StageStatus;
  readonly bracketSize: number;
  readonly roundCount: number;
  readonly rounds: readonly BracketRoundDto[];
  readonly complete: boolean;
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

export interface RecordMatchGameInput {
  readonly gameNumber: number;
  readonly participant1Points: number;
  readonly participant2Points: number;
}

export interface RecordMatchResultInput {
  readonly games: readonly RecordMatchGameInput[];
}

/** Generates a knockout bracket from a caller-supplied entry ordering. */
export interface GenerateKnockoutBracketInput {
  readonly entryIds: readonly string[];
}
