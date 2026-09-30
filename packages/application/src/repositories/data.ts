import type {
  CategoryFormat,
  CategoryGender,
  CategoryStatus,
  CourtStatus,
  EntryStatus,
  MatchGame,
  MatchSlot,
  MatchStatus,
  RealtimeAggregateType,
  RealtimeEventType,
  StageStatus,
  StageType,
  Team,
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
  readonly qualifiersPerGroup: number | null;
  readonly status: StageStatus;
}

export interface UpdateStageData {
  readonly name?: string;
  readonly sequence?: number;
  readonly drawSize?: number | null;
  readonly qualifiersPerGroup?: number | null;
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

/**
 * The full scheduling slice for a match.
 *
 * All three fields are set together: the repository never persists a partial
 * schedule, matching the database `matches_schedule_fields_consistent` CHECK.
 */
export interface MatchScheduleData {
  readonly courtId: string;
  readonly scheduledStartAt: Date;
  readonly scheduledEndAt: Date;
}

export interface CreateCourtData {
  readonly tournamentId: string;
  readonly number: number;
  readonly name: string;
  readonly status: CourtStatus;
}

export interface UpdateCourtData {
  readonly number?: number;
  readonly name?: string;
}

export interface CreateMatchParticipantData {
  readonly matchId: string;
  readonly entryId: string;
  readonly slot: MatchSlot;
}

export interface CreateMatchGameData {
  readonly matchId: string;
  readonly gameNumber: number;
  readonly participant1Points: number;
  readonly participant2Points: number;
  readonly winnerSlot: MatchSlot;
}

/**
 * A normalized list/pagination query.
 *
 * `limit` is the maximum rows for one page; `cursor` resumes strictly after a
 * previously returned row id. The route layer produces this from the validated
 * query string (`@badminton/validation`'s `listQuerySchema`).
 */
export interface ListQuery {
  readonly limit: number;
  readonly cursor?: string;
}

/**
 * A page of a cursor-paginated list read.
 *
 * `items` holds at most the requested `limit` rows; `nextCursor` is the id to
 * resume strictly after, or `null` when this is the last page. The cursor is
 * opaque to the caller - it is the last row's id under the list's deterministic
 * ordering.
 */
export interface ListPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/**
 * A team read together with its derived member count.
 *
 * The count comes from a grouped aggregate in the same read path, so a team
 * list never issues one query per team.
 */
export interface TeamWithMemberCount {
  readonly team: Team;
  readonly memberCount: number;
}

/**
 * Payload for a new outbox event.
 *
 * The repository assigns `id`, `createdAt` and `publishedAt`; the caller
 * supplies only what changed. `payload` is a small, flat map (or absent), never
 * a read model.
 */
export interface CreateRealtimeEventData {
  readonly tournamentId: string;
  readonly eventType: RealtimeEventType;
  readonly aggregateType: RealtimeAggregateType;
  readonly aggregateId: string;
  readonly payload?: Readonly<Record<string, unknown>> | null;
}

/**
 * A game read back together with its owner, for batched reads where the
 * caller must group games by match (standings). The domain `MatchGame` is
 * intentionally owner-less; only reads that span several matches need this.
 */
export interface MatchGameWithMatch extends MatchGame {
  readonly matchId: string;
}
