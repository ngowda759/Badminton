import type {
  CategoryFormat,
  CategoryGender,
  CategoryStatus,
  EntryStatus,
  MatchSlot,
  MatchStatus,
  StageStatus,
  StageType,
  TournamentStatus,
} from '@badminton/domain';

/**
 * Persistence-neutral write payloads for the repository ports.
 *
 * They are deliberately expressed in domain terms (dates, statuses, nullable
 * owners) so that no Prisma type leaks into the application layer. The
 * infrastructure adapter maps them onto Prisma `create`/`update` inputs.
 */

export interface CreateTournamentData {
  readonly name: string;
  readonly description: string | null;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly location: string | null;
  readonly timezone: string;
  readonly status: TournamentStatus;
}

export interface UpdateTournamentData {
  readonly name?: string;
  readonly description?: string | null;
  readonly startDate?: Date;
  readonly endDate?: Date;
  readonly location?: string | null;
}

export interface CreateCategoryData {
  readonly tournamentId: string;
  readonly name: string;
  readonly code: string;
  readonly format: CategoryFormat;
  readonly gender: CategoryGender | null;
  readonly status: CategoryStatus;
}

export interface UpdateCategoryData {
  readonly name?: string;
  readonly format?: CategoryFormat;
  readonly gender?: CategoryGender | null;
}

export interface CreatePlayerData {
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
}

export interface UpdatePlayerData {
  readonly name?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
}

export interface CreateTeamData {
  readonly name: string;
}

export interface UpdateTeamData {
  readonly name?: string;
}

export interface CreateTeamMemberData {
  readonly teamId: string;
  readonly playerId: string;
  readonly position: number;
}

export interface CreateEntryData {
  readonly categoryId: string;
  readonly playerId: string | null;
  readonly teamId: string | null;
  readonly seed: number | null;
  readonly status: EntryStatus;
}

export interface CreateStageData {
  readonly categoryId: string;
  readonly name: string;
  readonly type: StageType;
  readonly sequence: number;
  readonly drawSize: number | null;
  readonly status: StageStatus;
}

export interface UpdateStageData {
  readonly name?: string;
  readonly sequence?: number;
  readonly drawSize?: number | null;
}

export interface CreateMatchData {
  readonly stageId: string;
  readonly sequence: number;
  readonly roundNumber: number | null;
  readonly matchNumber: number | null;
  readonly status: MatchStatus;
}

export interface UpdateMatchData {
  readonly sequence?: number;
  readonly roundNumber?: number | null;
  readonly matchNumber?: number | null;
}

export interface CreateMatchParticipantData {
  readonly matchId: string;
  readonly entryId: string;
  readonly slot: MatchSlot;
}
