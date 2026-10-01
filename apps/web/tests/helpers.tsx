import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi, type Mock } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import type { BadmintonApi } from '@/api/services.ts';
import type {
  BracketDto,
  BracketMatchDto,
  CategoryDto,
  CourtDto,
  DashboardMatchDto,
  EntryDto,
  GroupFixtureMatchDto,
  GroupFixturesDto,
  MatchDto,
  MatchGameDto,
  MatchParticipantDto,
  MatchResultDto,
  PlayerDto,
  PlayerListItemDto,
  QualificationViewDto,
  StageDto,
  StandingRowDto,
  TeamDto,
  TeamListItemDto,
  TeamMemberDto,
  TournamentDashboardDto,
  TournamentDto,
} from '@/api/types.ts';

/** Fixed timestamps so DTOs are deterministic in tests. */
const ISO = '2026-10-01T00:00:00.000Z';

export function makeTournament(overrides: Partial<TournamentDto> = {}): TournamentDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Autumn Open',
    description: null,
    startDate: ISO,
    endDate: '2026-10-03T00:00:00.000Z',
    location: null,
    timezone: 'UTC',
    status: 'DRAFT',
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<CategoryDto> = {}): CategoryDto {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    tournamentId: '11111111-1111-4111-8111-111111111111',
    name: 'Men Singles',
    code: 'MS',
    format: 'SINGLES',
    gender: null,
    status: 'DRAFT',
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makePlayer(overrides: Partial<PlayerDto> = {}): PlayerDto {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Player A',
    email: null,
    phone: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

/** A player list row; the collection omits `email`/`phone`. */
export function makePlayerListItem(overrides: Partial<PlayerListItemDto> = {}): PlayerListItemDto {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Player A',
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeTeam(overrides: Partial<TeamDto> = {}): TeamDto {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Smash Masters',
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeTeamListItem(overrides: Partial<TeamListItemDto> = {}): TeamListItemDto {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Smash Masters',
    memberCount: 0,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeTeamMember(overrides: Partial<TeamMemberDto> = {}): TeamMemberDto {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    teamId: '44444444-4444-4444-8444-444444444444',
    playerId: '33333333-3333-4333-8333-333333333333',
    position: 1,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeEntry(overrides: Partial<EntryDto> = {}): EntryDto {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    categoryId: '22222222-2222-4222-8222-222222222222',
    playerId: '33333333-3333-4333-8333-333333333333',
    teamId: null,
    seed: null,
    status: 'PENDING',
    registeredAt: ISO,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeStage(overrides: Partial<StageDto> = {}): StageDto {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    categoryId: '22222222-2222-4222-8222-222222222222',
    name: 'Group A',
    type: 'GROUP',
    sequence: 1,
    drawSize: null,
    qualifiersPerGroup: null,
    knockoutRules: null,
    status: 'PENDING',
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeMatch(overrides: Partial<MatchDto> = {}): MatchDto {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    stageId: '77777777-7777-4777-8777-777777777777',
    sequence: 1,
    roundNumber: null,
    matchNumber: null,
    status: 'SCHEDULED',
    winnerEntryId: null,
    knockoutFormat: null,
    knockoutPointsPerGame: null,
    courtId: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeCourt(overrides: Partial<CourtDto> = {}): CourtDto {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    tournamentId: '11111111-1111-4111-8111-111111111111',
    number: 1,
    name: 'Court 1',
    status: 'ACTIVE',
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeDashboardMatch(overrides: Partial<DashboardMatchDto> = {}): DashboardMatchDto {
  return {
    matchId: '88888888-8888-4888-8888-888888888888',
    status: 'SCHEDULED',
    categoryId: '22222222-2222-4222-8222-222222222222',
    categoryName: 'Men Singles',
    stageId: '77777777-7777-4777-8777-777777777777',
    stageName: 'Group A',
    courtId: null,
    courtName: null,
    courtNumber: null,
    scheduledStartAt: null,
    scheduledEndAt: null,
    participants: [
      { entryId: '66666666-6666-4666-8666-666666666666', name: 'Alice', slot: 1 },
      { entryId: '66666666-6666-4666-8666-666666666667', name: 'Bob', slot: 2 },
    ],
    winnerEntryId: null,
    ...overrides,
  };
}

export function makeDashboard(
  overrides: Partial<TournamentDashboardDto> = {},
): TournamentDashboardDto {
  return {
    tournament: makeTournament(),
    summary: {
      totalEntries: 4,
      totalMatches: 6,
      completedMatches: 2,
      inProgressMatches: 1,
      scheduledMatches: 2,
      unscheduledMatches: 1,
    },
    courts: [
      {
        courtId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        number: 1,
        name: 'Court 1',
        status: 'ACTIVE',
        busy: true,
      },
    ],
    liveMatches: [],
    upcomingMatches: [],
    recentResults: [],
    unscheduledMatches: [],
    categories: [],
    ...overrides,
  };
}

export function makeParticipant(overrides: Partial<MatchParticipantDto> = {}): MatchParticipantDto {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    matchId: '88888888-8888-4888-8888-888888888888',
    entryId: '66666666-6666-4666-8666-666666666666',
    slot: 1,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

export function makeMatchGame(overrides: Partial<MatchGameDto> = {}): MatchGameDto {
  return {
    gameNumber: 1,
    participant1Points: 21,
    participant2Points: 15,
    winnerSlot: 1,
    ...overrides,
  };
}

export function makeMatchResult(overrides: Partial<MatchResultDto> = {}): MatchResultDto {
  return {
    matchId: '88888888-8888-4888-8888-888888888888',
    winnerSlot: 1,
    winnerGames: 2,
    loserGames: 0,
    winnerEntryId: '66666666-6666-4666-8666-666666666666',
    loserEntryId: '66666666-6666-4666-8666-666666666667',
    games: [makeMatchGame(), makeMatchGame({ gameNumber: 2 })],
    ...overrides,
  };
}

export function makeStandingRow(overrides: Partial<StandingRowDto> = {}): StandingRowDto {
  return {
    entryId: '66666666-6666-4666-8666-666666666666',
    played: 1,
    won: 1,
    lost: 0,
    points: 2,
    gamesWon: 2,
    gamesLost: 0,
    gameDifference: 2,
    pointsFor: 42,
    pointsAgainst: 33,
    pointDifference: 9,
    position: 1,
    ...overrides,
  };
}

export function makeBracketMatch(overrides: Partial<BracketMatchDto> = {}): BracketMatchDto {
  return {
    matchId: '88888888-8888-4888-8888-888888888888',
    matchNumber: 1,
    sequence: 1,
    status: 'SCHEDULED',
    participant1: { slot: 1, entryId: '66666666-6666-4666-8666-666666666666' },
    participant2: { slot: 2, entryId: '66666666-6666-4666-8666-666666666667' },
    winnerEntryId: null,
    ...overrides,
  };
}

export function makeBracket(overrides: Partial<BracketDto> = {}): BracketDto {
  return {
    stageId: '77777777-7777-4777-8777-777777777777',
    stageName: 'Knockout',
    status: 'PENDING',
    bracketSize: 2,
    roundCount: 1,
    rounds: [{ roundNumber: 1, name: 'Final', matches: [makeBracketMatch()] }],
    complete: false,
    ...overrides,
  };
}

/** A derived qualification view for a KNOCKOUT stage fed by one group. */
export function makeQualification(
  overrides: Partial<QualificationViewDto> = {},
): QualificationViewDto {
  return {
    knockoutStageId: '77777777-7777-4777-8777-777777777777',
    knockoutStageName: 'Knockout',
    qualifiersPerGroup: 2,
    groups: [
      {
        groupId: '66666666-6666-4666-8666-666666666666',
        groupName: 'Group A',
        sequence: 1,
        qualifyingCount: 2,
        competitorCount: 4,
        qualifiers: [
          { entryId: '66666666-6666-4666-8666-666666666666', position: 1 },
          { entryId: '66666666-6666-4666-8666-666666666667', position: 2 },
        ],
        complete: true,
        totalMatches: 6,
        completedMatches: 6,
      },
    ],
    seeds: ['66666666-6666-4666-8666-666666666666', '66666666-6666-4666-8666-666666666667'],
    qualifierCount: 2,
    bracketSize: 2,
    byeCount: 0,
    ready: true,
    blockedReason: null,
    bracketGenerated: false,
    standingsByGroup: {},
    ...overrides,
  };
}

export function makeGroupFixtureMatch(
  overrides: Partial<GroupFixtureMatchDto> = {},
): GroupFixtureMatchDto {
  return {
    matchId: '88888888-8888-4888-8888-888888888888',
    sequence: 1,
    roundNumber: 1,
    status: 'SCHEDULED',
    participant1: { slot: 1, entryId: '66666666-6666-4666-8666-666666666666' },
    participant2: { slot: 2, entryId: '66666666-6666-4666-8666-666666666667' },
    ...overrides,
  };
}

export function makeGroupFixtures(overrides: Partial<GroupFixturesDto> = {}): GroupFixturesDto {
  return {
    stageId: '77777777-7777-4777-8777-777777777777',
    stageName: 'Group A',
    status: 'PENDING',
    competitorCount: 2,
    matchCount: 1,
    matches: [makeGroupFixtureMatch()],
    ...overrides,
  };
}

/**
 * Builds a fully-typed stub API.
 *
 * Every method resolves by default so a page under test does not fail for an
 * endpoint it does not exercise; individual tests override only the calls that
 * matter. This keeps the UI → API client boundary mocked while the components,
 * hooks and validation run for real.
 */
/**
 * Marks every method as a Vitest mock so tests can call `mockResolvedValue`
 * without casting each call site.
 */
type Mocked<T> = {
  readonly [K in keyof T]: T[K] extends (...args: never[]) => infer R
    ? Mock<(...args: never[]) => R>
    : Mocked<T[K]>;
};

export function createStubApi(): Mocked<BadmintonApi> {
  return {
    tournaments: {
      create: vi.fn(() => Promise.resolve(makeTournament())),
      get: vi.fn(() => Promise.resolve(makeTournament())),
      list: vi.fn(() =>
        Promise.resolve({ items: [] as readonly TournamentDto[], nextCursor: null }),
      ),
      update: vi.fn(() => Promise.resolve(makeTournament())),
      transition: vi.fn(() => Promise.resolve(makeTournament())),
    },
    categories: {
      listByTournament: vi.fn(() => Promise.resolve([] as readonly CategoryDto[])),
      create: vi.fn(() => Promise.resolve(makeCategory())),
      get: vi.fn(() => Promise.resolve(makeCategory())),
      update: vi.fn(() => Promise.resolve(makeCategory())),
      transition: vi.fn(() => Promise.resolve(makeCategory())),
    },
    players: {
      create: vi.fn(() => Promise.resolve(makePlayer())),
      get: vi.fn(() => Promise.resolve(makePlayer())),
      list: vi.fn(() =>
        Promise.resolve({ items: [] as readonly PlayerListItemDto[], nextCursor: null }),
      ),
      update: vi.fn(() => Promise.resolve(makePlayer())),
    },
    teams: {
      create: vi.fn(() => Promise.resolve(makeTeam())),
      get: vi.fn(() => Promise.resolve(makeTeam())),
      list: vi.fn(() =>
        Promise.resolve({ items: [] as readonly TeamListItemDto[], nextCursor: null }),
      ),
      update: vi.fn(() => Promise.resolve(makeTeam())),
      listMembers: vi.fn(() => Promise.resolve([] as readonly TeamMemberDto[])),
      addMember: vi.fn(() => Promise.resolve(makeTeamMember())),
      removeMember: vi.fn(() => Promise.resolve(undefined)),
    },
    entries: {
      listByCategory: vi.fn(() => Promise.resolve([] as readonly EntryDto[])),
      register: vi.fn(() => Promise.resolve(makeEntry())),
      get: vi.fn(() => Promise.resolve(makeEntry())),
      update: vi.fn(() => Promise.resolve(makeEntry())),
      confirm: vi.fn(() => Promise.resolve(makeEntry({ status: 'CONFIRMED' }))),
      withdraw: vi.fn(() => Promise.resolve(makeEntry({ status: 'WITHDRAWN' }))),
      disqualify: vi.fn(() => Promise.resolve(makeEntry({ status: 'DISQUALIFIED' }))),
    },
    stages: {
      listByCategory: vi.fn(() => Promise.resolve([] as readonly StageDto[])),
      create: vi.fn(() => Promise.resolve(makeStage())),
      get: vi.fn(() => Promise.resolve(makeStage())),
      update: vi.fn(() => Promise.resolve(makeStage())),
      transition: vi.fn(() => Promise.resolve(makeStage())),
      standings: vi.fn(() => Promise.resolve([] as readonly StandingRowDto[])),
      getBracket: vi.fn(() => Promise.resolve(makeBracket())),
      generateBracket: vi.fn(() => Promise.resolve(makeBracket())),
      generateBracketFromQualifiers: vi.fn(() => Promise.resolve(makeBracket())),
      qualification: vi.fn(() => Promise.resolve(makeQualification())),
      generateFixtures: vi.fn(() => Promise.resolve(makeGroupFixtures())),
    },
    matches: {
      listByStage: vi.fn(() => Promise.resolve([] as readonly MatchDto[])),
      create: vi.fn(() => Promise.resolve(makeMatch())),
      get: vi.fn(() => Promise.resolve(makeMatch())),
      update: vi.fn(() => Promise.resolve(makeMatch())),
      transition: vi.fn(() => Promise.resolve(makeMatch())),
      listParticipants: vi.fn(() => Promise.resolve([] as readonly MatchParticipantDto[])),
      addParticipant: vi.fn(() => Promise.resolve(makeParticipant())),
      recordResult: vi.fn(() => Promise.resolve(makeMatchResult())),
      getResult: vi.fn(() => Promise.resolve(null as MatchResultDto | null)),
      schedule: vi.fn(() => Promise.resolve(makeMatch())),
      unschedule: vi.fn(() => Promise.resolve(makeMatch())),
    },
    courts: {
      listByTournament: vi.fn(() => Promise.resolve([] as readonly CourtDto[])),
      create: vi.fn(() => Promise.resolve(makeCourt())),
      get: vi.fn(() => Promise.resolve(makeCourt())),
      update: vi.fn(() => Promise.resolve(makeCourt())),
      transition: vi.fn(() => Promise.resolve(makeCourt())),
    },
    dashboard: {
      get: vi.fn(() => Promise.resolve(makeDashboard())),
    },
  };
}

export interface RenderWithProvidersOptions {
  readonly route?: string;
  readonly api?: BadmintonApi;
}

/** Renders a tree with the API and router providers attached. */
export function renderWithProviders(
  ui: ReactNode,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const api = options.api ?? createStubApi();
  return render(
    <ApiProvider api={api}>
      <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
    </ApiProvider>,
  );
}

export { vi };
