import { createContext, useContext, type ReactNode } from 'react';

import type { CategoryDto, TournamentDto } from '@/api/types.ts';

export interface TournamentResource {
  readonly tournament: TournamentDto;
  readonly refetch: () => void;
}

const TournamentContext = createContext<TournamentResource | undefined>(undefined);

export function TournamentProvider({
  value,
  children,
}: {
  readonly value: TournamentResource;
  readonly children: ReactNode;
}) {
  return <TournamentContext.Provider value={value}>{children}</TournamentContext.Provider>;
}

/** Reads the tournament loaded by the enclosing layout. */
export function useTournament(): TournamentResource {
  const value = useContext(TournamentContext);
  if (!value) {
    throw new Error('useTournament must be used within a tournament route.');
  }
  return value;
}

export interface CategoryResource {
  readonly category: CategoryDto;
  readonly tournament: TournamentDto;
  readonly refetch: () => void;
}

const CategoryContext = createContext<CategoryResource | undefined>(undefined);

export function CategoryProvider({
  value,
  children,
}: {
  readonly value: CategoryResource;
  readonly children: ReactNode;
}) {
  return <CategoryContext.Provider value={value}>{children}</CategoryContext.Provider>;
}

/** Reads the category loaded by the enclosing category layout. */
export function useCategory(): CategoryResource {
  const value = useContext(CategoryContext);
  if (!value) {
    throw new Error('useCategory must be used within a category route.');
  }
  return value;
}
