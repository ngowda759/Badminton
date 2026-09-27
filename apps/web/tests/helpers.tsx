import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi, type Mock } from 'vitest';

import { ApiProvider } from '@/api/context.tsx';
import type { BadmintonApi } from '@/api/services.ts';
import type {
  CategoryDto,
  EntryDto,
  MatchDto,
  MatchParticipantDto,
  PlayerDto,
  StageDto,
  TeamDto,
  TeamMemberDto,
  TournamentDto,
} from '@/api/types.ts';
import { RecentProvider } from '@/hooks/use-recent.tsx';

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

export function makeTeam(overrides: Partial<TeamDto> = {}): TeamDto {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Smash Masters',
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
    createdAt: ISO,
    updatedAt: ISO,
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
      update: vi.fn(() => Promise.resolve(makePlayer())),
    },
    teams: {
      create: vi.fn(() => Promise.resolve(makeTeam())),
      get: vi.fn(() => Promise.resolve(makeTeam())),
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
    },
    matches: {
      listByStage: vi.fn(() => Promise.resolve([] as readonly MatchDto[])),
      create: vi.fn(() => Promise.resolve(makeMatch())),
      get: vi.fn(() => Promise.resolve(makeMatch())),
      update: vi.fn(() => Promise.resolve(makeMatch())),
      transition: vi.fn(() => Promise.resolve(makeMatch())),
      listParticipants: vi.fn(() => Promise.resolve([] as readonly MatchParticipantDto[])),
      addParticipant: vi.fn(() => Promise.resolve(makeParticipant())),
    },
  };
}

export interface RenderWithProvidersOptions {
  readonly route?: string;
  readonly api?: BadmintonApi;
}

/** Renders a tree with the API, recent-items and router providers attached. */
export function renderWithProviders(
  ui: ReactNode,
  options: RenderWithProvidersOptions = {},
): RenderResult {
  const api = options.api ?? createStubApi();
  return render(
    <ApiProvider api={api}>
      <RecentProvider>
        <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
      </RecentProvider>
    </ApiProvider>,
  );
}

export { vi };
