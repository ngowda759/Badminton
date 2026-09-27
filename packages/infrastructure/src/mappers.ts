import type {
  PrismaCourt,
  PrismaMatch,
  PrismaMatchGame,
  PrismaMatchParticipant,
  PrismaPlayer,
  PrismaRealtimeEvent,
  PrismaTournament,
  PrismaTournamentCategory,
  PrismaTournamentEntry,
  PrismaTournamentStage,
  PrismaTeam,
  PrismaTeamMember,
} from '@badminton/database';
import {
  PersistenceError,
  RealtimeEventValidationError,
  isRealtimeAggregateType,
  isRealtimeEventType,
  type MatchGame,
} from '@badminton/domain';
import type {
  Court,
  Match,
  MatchParticipant,
  MatchSlot,
  Player,
  RealtimeEvent,
  Team,
  TeamMember,
  Tournament,
  TournamentCategory,
  TournamentEntry,
  TournamentStage,
} from '@badminton/domain';

/**
 * Row-to-domain mappers.
 *
 * Prisma rows are structurally close to the domain types, but mapping through
 * explicit functions keeps Prisma types out of the application layer and gives
 * one place to adapt if the generated client changes.
 */

export function toTournament(row: PrismaTournament): Tournament {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    startDate: row.startDate,
    endDate: row.endDate,
    location: row.location,
    timezone: row.timezone,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTournamentCategory(row: PrismaTournamentCategory): TournamentCategory {
  return {
    id: row.id,
    tournamentId: row.tournamentId,
    name: row.name,
    code: row.code,
    format: row.format,
    gender: row.gender,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toPlayer(row: PrismaPlayer): Player {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTeam(row: PrismaTeam): Team {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTeamMember(row: PrismaTeamMember): TeamMember {
  return {
    id: row.id,
    teamId: row.teamId,
    playerId: row.playerId,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTournamentEntry(row: PrismaTournamentEntry): TournamentEntry {
  return {
    id: row.id,
    categoryId: row.categoryId,
    playerId: row.playerId,
    teamId: row.teamId,
    seed: row.seed,
    status: row.status,
    registeredAt: row.registeredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toTournamentStage(row: PrismaTournamentStage): TournamentStage {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    type: row.type,
    sequence: row.sequence,
    drawSize: row.drawSize,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toMatch(row: PrismaMatch): Match {
  return {
    id: row.id,
    stageId: row.stageId,
    sequence: row.sequence,
    roundNumber: row.roundNumber,
    matchNumber: row.matchNumber,
    status: row.status,
    winnerEntryId: row.winnerEntryId,
    courtId: row.courtId,
    scheduledStartAt: row.scheduledStartAt,
    scheduledEndAt: row.scheduledEndAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toCourt(row: PrismaCourt): Court {
  return {
    id: row.id,
    tournamentId: row.tournamentId,
    number: row.number,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toMatchGame(row: PrismaMatchGame): MatchGame {
  return {
    gameNumber: row.gameNumber,
    participant1Points: row.participant1Points,
    participant2Points: row.participant2Points,
    winnerSlot: toMatchSlot(row.winnerSlot),
  };
}

export function toMatchParticipant(row: PrismaMatchParticipant): MatchParticipant {
  return {
    id: row.id,
    matchId: row.matchId,
    entryId: row.entryId,
    slot: toMatchSlot(row.slot),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Narrows the stored slot; the database `CHECK (slot IN (1,2))` guarantees one of two. */
function toMatchSlot(value: number): MatchSlot {
  if (value === 1 || value === 2) {
    return value;
  }
  throw new PersistenceError();
}

/**
 * Maps an outbox row onto the domain event.
 *
 * The catalogue columns are validated on the way out: a row written outside the
 * domain (or a hand-edited table) fails loudly rather than streaming an unknown
 * event type to a browser. An empty JSON object is normalised back to `null`.
 */
export function toRealtimeEvent(row: PrismaRealtimeEvent): RealtimeEvent {
  if (!isRealtimeEventType(row.eventType)) {
    throw new RealtimeEventValidationError(`Unknown realtime event type: ${row.eventType}`);
  }
  if (!isRealtimeAggregateType(row.aggregateType)) {
    throw new RealtimeEventValidationError(`Unknown realtime aggregate type: ${row.aggregateType}`);
  }

  return {
    id: row.id,
    tournamentId: row.tournamentId,
    eventType: row.eventType,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    occurredAt: row.createdAt,
    payload: toRealtimePayload(row.payload),
    publishedAt: row.publishedAt,
  };
}

function toRealtimePayload(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value);
  return entries.length === 0 ? null : Object.fromEntries(entries);
}
