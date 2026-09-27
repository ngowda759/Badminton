import { Navigate, Route, Routes } from 'react-router-dom';

import { NotFoundPage } from '@/pages/not-found.tsx';
import { StatusPage } from '@/pages/status.tsx';
import { PlayerDetailPage } from '@/pages/players/player-detail.tsx';
import { PlayersPage } from '@/pages/players/players.tsx';
import { TeamDetailPage } from '@/pages/teams/team-detail.tsx';
import { TeamsPage } from '@/pages/teams/teams.tsx';
import { CategoriesPage } from '@/pages/tournaments/categories.tsx';
import { CategoryDetailPage } from '@/pages/tournaments/category-detail.tsx';
import { CategoryLayout } from '@/pages/tournaments/category-layout.tsx';
import { CourtBoardPage } from '@/pages/tournaments/court-board.tsx';
import { CourtsManagePage } from '@/pages/tournaments/courts-manage.tsx';
import { CreateCategoryPage } from '@/pages/tournaments/create-category.tsx';
import { CreateTournamentPage } from '@/pages/tournaments/create-tournament.tsx';
import { TournamentDashboardPage } from '@/pages/tournaments/dashboard.tsx';
import { EditTournamentPage } from '@/pages/tournaments/edit-tournament.tsx';
import { EntriesPage } from '@/pages/tournaments/entries.tsx';
import { MatchDetailPage } from '@/pages/tournaments/match-detail.tsx';
import { StageDetailPage } from '@/pages/tournaments/stage-detail.tsx';
import { StagesPage } from '@/pages/tournaments/stages.tsx';
import { TournamentLayout } from '@/pages/tournaments/tournament-layout.tsx';
import { TournamentDetailsPage } from '@/pages/tournaments/tournament-details.tsx';
import { TournamentEntryPage } from '@/pages/tournaments/tournament-entry.tsx';

/**
 * Route tree for the tournament setup UI.
 *
 * The structure is tournament-centric: global players and teams are reachable
 * from the sidebar, and within a tournament the nested routes keep the operator
 * in context (tournament → category → stage → match).
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/tournaments" replace />} />

      <Route path="/tournaments" element={<TournamentEntryPage />} />
      <Route path="/tournaments/new" element={<CreateTournamentPage />} />

      <Route path="/tournaments/:tournamentId" element={<TournamentLayout />}>
        <Route index element={<TournamentDetailsPage />} />
        <Route path="dashboard" element={<TournamentDashboardPage />} />
        <Route path="courts" element={<CourtBoardPage />} />
        <Route path="courts/manage" element={<CourtsManagePage />} />
        <Route path="edit" element={<EditTournamentPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="categories/new" element={<CreateCategoryPage />} />
        <Route path="players" element={<PlayersPage />} />
        <Route path="teams" element={<TeamsPage />} />

        <Route path="categories/:categoryId" element={<CategoryLayout />}>
          <Route index element={<CategoryDetailPage />} />
          <Route path="entries" element={<EntriesPage />} />
          <Route path="stages" element={<StagesPage />} />
          <Route path="stages/:stageId" element={<StageDetailPage />} />
          <Route path="matches/:matchId" element={<MatchDetailPage />} />
        </Route>
      </Route>

      <Route path="/players" element={<PlayersPage />} />
      <Route path="/players/:playerId" element={<PlayerDetailPage />} />

      <Route path="/teams" element={<TeamsPage />} />
      <Route path="/teams/:teamId" element={<TeamDetailPage />} />

      <Route path="/status" element={<StatusPage />} />

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
