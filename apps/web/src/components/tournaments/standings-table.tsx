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

/** read-only group standings; every column is derived from completed matches. */
export function StandingsTable({ rows, nameFor }: StandingsTableProps) {
  return (
    <TableWrapper>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pos</TableHead>
            <TableHead>Competitor</TableHead>
            <TableHead className="text-right">Played</TableHead>
            <TableHead className="text-right">Won</TableHead>
            <TableHead className="text-right">Lost</TableHead>
            <TableHead className="text-right">Games +/-</TableHead>
            <TableHead className="text-right">Points +/-</TableHead>
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
              <TableCell className="text-right">{row.gameDifference}</TableCell>
              <TableCell className="text-right">{row.pointDifference}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableWrapper>
  );
}
