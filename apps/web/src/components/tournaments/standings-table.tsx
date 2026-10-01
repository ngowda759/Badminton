import type { StandingRowDto } from '@/api/types.ts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table.tsx';

export interface StandingsTableProps {
  readonly rows: readonly StandingRowDto[];
  /** Resolves a competitor (player or team) name from an entry id. */
  readonly nameFor: (entryId: string) => string;
}

/**
 * Read-only group standings, matching the original tournament table:
 * `Pos · Competitor · P · W · L · Pts · PF · PA · Diff`.
 *
 * Every column is derived from completed matches; the points column is the
 * league total (win = 2, group loss = 0) and `Diff` is points scored minus
 * points conceded.
 */
export function StandingsTable({ rows, nameFor }: StandingsTableProps) {
  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pos</TableHead>
            <TableHead>Competitor</TableHead>
            <TableHead className="text-right">P</TableHead>
            <TableHead className="text-right">W</TableHead>
            <TableHead className="text-right">L</TableHead>
            <TableHead className="text-right">Pts</TableHead>
            <TableHead className="text-right">PF</TableHead>
            <TableHead className="text-right">PA</TableHead>
            <TableHead className="text-right">Diff</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.entryId}>
              <TableCell>{row.position}</TableCell>
              <TableCell className="font-medium">{nameFor(row.entryId)}</TableCell>
              <TableCell className="text-right">{row.played}</TableCell>
              <TableCell className="text-right">{row.won}</TableCell>
              <TableCell className="text-right">{row.lost}</TableCell>
              <TableCell className="text-right font-medium">{row.points}</TableCell>
              <TableCell className="text-right">{row.pointsFor}</TableCell>
              <TableCell className="text-right">{row.pointsAgainst}</TableCell>
              <TableCell className="text-right">{row.pointDifference}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrapper>
  );
}
