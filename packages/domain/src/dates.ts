/**
 * Calendar-date and timezone helpers.
 *
 * Tournament start/end are calendar dates (`DATE`), and the timezone is an
 * IANA zone name. Both concepts are deliberately kept out of the persistence
 * adapter: the same helpers serve validation and the services.
 */

/**
 * True when `timezone` is a timezone the runtime recognises.
 *
 * `Intl.supportedValuesOf('timeZone')` is not used directly because it omits
 * valid aliases and `UTC`; constructing a formatter with the candidate zone is
 * the definitive check and works against the platform's IANA data.
 */
export function isValidIanaTimezone(timezone: string): boolean {
  const candidate = timezone.trim();
  if (candidate.length === 0) {
    return false;
  }

  // Ambiguous abbreviations such as `IST`, `PST` or `GMT` are accepted by
  // `Intl` but are explicitly rejected by the design. Real IANA names are
  // `Area/Location` (`Asia/Kolkata`) or the canonical `UTC`.
  if (candidate !== 'UTC' && !candidate.includes('/')) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

/** Truncates a date to midnight UTC, the representation used for calendar dates. */
export function toCalendarDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** True when `endDate` falls on or after `startDate`, comparing calendar dates. */
export function isDateRangeValid(startDate: Date, endDate: Date): boolean {
  return toCalendarDate(endDate).getTime() >= toCalendarDate(startDate).getTime();
}
