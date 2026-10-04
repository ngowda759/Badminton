import { NotFoundError } from '@badminton/domain';

import type { RepositoryClient } from '../repositories/index.ts';
import type { TournamentBackup } from './tournament-backup.ts';

/**
 * Tournament backup export.
 *
 * A pure read assembled from the existing per-tournament repository reads - the
 * tournament, its categories, stages, courts, entries, matches, match
 * participants and match games - each issued once for the whole tournament, so
 * a tournament with hundreds of matches still issues a handful of queries and
 * never a per-match fan-out. It opens no transaction and records no realtime
 * event: nothing changes, so there is nothing to notify.
 *
 * The route maps the returned value through a DTO (never a raw domain model)
 * and returns it in the standard `{ data }` envelope.
 */
export interface TournamentBackupService {
  export(tournamentId: string): Promise<TournamentBackup>;
}

export function createTournamentBackupService(client: RepositoryClient): TournamentBackupService {
  return {
    async export(tournamentId): Promise<TournamentBackup> {
      const tournament = await client.tournaments.findById(tournamentId);
      if (!tournament) {
        throw new NotFoundError('Tournament', tournamentId);
      }

      const [categories, stages, courts, entries, matches] = await Promise.all([
        client.categories.listByTournament(tournamentId),
        client.stages.listByTournament(tournamentId),
        client.courts.listByTournament(tournamentId),
        client.entries.listByTournament(tournamentId),
        client.matches.listByTournament(tournamentId),
      ]);

      const matchIds = matches.map((match) => match.id);
      const [participants, games] = await Promise.all([
        client.matchParticipants.listByMatchIds(matchIds),
        client.matchGames.listByMatchIds(matchIds),
      ]);

      return { tournament, categories, stages, courts, entries, matches, participants, games };
    },
  };
}
