/**
 * Formats the ISO strings the API returns for display.
 *
 * Calendar dates (`startDate`) are stored as UTC midnight, so formatting them
 * in UTC avoids showing the previous day to a viewer west of Greenwich. Audit
 * timestamps are shown as local date-time.
 */

/** Formats a `YYYY-MM-DD` or ISO date-only value without timezone drift. */
export function formatCalendarDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Formats a full ISO timestamp in the viewer's local timezone. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Renders an absent value consistently across tables and detail views. */
export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  return String(value);
}

/** Title-cases a SCREAMING_SNAKE enum for display. */
export function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
