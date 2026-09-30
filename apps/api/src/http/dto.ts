import type { ListPage, TeamSummary } from '@badminton/application';
import type { Player, Tournament } from '@badminton/domain';

/**
 * Response DTOs for the collection endpoints.
 *
 * The routes map domain aggregates onto these plain shapes instead of returning
 * the aggregate directly, so the list contract is explicit: exactly the fields
 * the UI needs, nothing database-internal, and one place to change if a list
 * gains a field. Dates stay `Date` values; Fastify serializes them to ISO-8601,
 * matching the existing single-resource endpoints.
 */

/** The shared cursor-paginated collection envelope. */
export interface ListResponse<T> {
  readonly items: readonly T[];
  /** Opaque cursor for the next page, or `null` on the last page. */
  readonly nextCursor: string | null;
}

/** One tournament row in `GET /api/v1/tournaments`. */
export interface TournamentListItemDto {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly startDate: Date;
  readonly endDate: Date;
  readonly location: string | null;
  readonly timezone: string;
  readonly status: Tournament['status'];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One player row in `GET /api/v1/players`. */
export interface PlayerListItemDto {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One team row in `GET /api/v1/teams`, including its derived member count. */
export interface TeamListItemDto {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toTournamentListItem(tournament: Tournament): TournamentListItemDto {
  return {
    id: tournament.id,
    name: tournament.name,
    description: tournament.description,
    startDate: tournament.startDate,
    endDate: tournament.endDate,
    location: tournament.location,
    timezone: tournament.timezone,
    status: tournament.status,
    createdAt: tournament.createdAt,
    updatedAt: tournament.updatedAt,
  };
}

export function toPlayerListItem(player: Player): PlayerListItemDto {
  return {
    id: player.id,
    name: player.name,
    email: player.email,
    phone: player.phone,
    createdAt: player.createdAt,
    updatedAt: player.updatedAt,
  };
}

export function toTeamListItem(summary: TeamSummary): TeamListItemDto {
  return {
    id: summary.id,
    name: summary.name,
    memberCount: summary.memberCount,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}

/** Maps a repository page onto the response envelope in one pass. */
export function toListResponse<T, U>(page: ListPage<T>, map: (item: T) => U): ListResponse<U> {
  return { items: page.items.map(map), nextCursor: page.nextCursor };
}
