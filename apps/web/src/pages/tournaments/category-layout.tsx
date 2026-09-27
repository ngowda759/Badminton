import { NavLink, Outlet, useParams } from 'react-router-dom';

import { useApi } from '@/api/context.tsx';
import type { CategoryDto } from '@/api/types.ts';
import { ErrorState } from '@/components/error-state.tsx';
import { LoadingState } from '@/components/states.tsx';
import { FormatBadge, StatusBadge } from '@/components/status-badge.tsx';
import { CategoryProvider, useTournament } from '@/components/tournaments/context.tsx';
import { cn } from '@/lib/utils.ts';
import { useApiQuery } from '@/hooks/use-api-query.ts';

/**
 * Loads one category and provides it to its nested routes.
 *
 * The category is fetched once and shared by the details, entries, stages and
 * match pages so navigating between them does not repeat the request.
 */
export function CategoryLayout() {
  const api = useApi();
  const { tournament } = useTournament();
  const { categoryId = '' } = useParams();

  const { state, refetch } = useApiQuery<CategoryDto>(['category', categoryId], (signal) =>
    api.categories.get(categoryId, signal),
  );

  if (state.status === 'loading') {
    return <LoadingState label="Loading category…" rows={4} />;
  }

  if (state.status === 'error') {
    return <ErrorState error={state.error} onRetry={refetch} title="Could not load category" />;
  }

  const category = state.data;
  const base = `/tournaments/${tournament.id}/categories/${category.id}`;
  const tabs = [
    { to: base, label: 'Details', end: true },
    { to: `${base}/entries`, label: 'Entries', end: false },
    { to: `${base}/stages`, label: 'Stages', end: false },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold tracking-tight">{category.name}</h1>
        <span className="text-muted-foreground text-sm">{category.code}</span>
        <FormatBadge format={category.format} />
        <StatusBadge kind="category" status={category.status} />
      </div>

      <nav aria-label="Category sections" className="border-b">
        <ul className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-block border-b-2 px-3 py-2 text-sm font-medium focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                    isActive
                      ? 'border-primary text-foreground'
                      : 'text-muted-foreground hover:text-foreground border-transparent',
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <CategoryProvider value={{ category, tournament, refetch }}>
        <Outlet />
      </CategoryProvider>
    </div>
  );
}
