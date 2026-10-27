import { getSeasonFromMonth, givenMoveIn } from './privacy';
import type { StoredMoveInFields } from './privacy';
import type { MoveInGiven, Season } from './types';

/**
 * What the review routes store for the optional "When did you move in?" question.
 *
 * The form asks for a month and a year. Only the season of the month is stored, never the
 * month itself. `reviews.move_in_season` and `move_in_year` are NOT NULL (migration 0001), so
 * a part the reviewer skipped still needs a value there; `move_in_given` (migration 0034)
 * records which parts were given, and public pages show only those (`givenMoveIn`).
 *
 * The placeholder for a skipped part is what the submit route has always stored, winter and
 * the current year, so anything that reads the two columns without `move_in_given` sees
 * exactly what it saw before.
 */
export interface MoveInToStore {
  season: Season;
  year: number;
  given: MoveInGiven;
}

const PLACEHOLDER_SEASON: Season = 'winter';
const EARLIEST_MOVE_IN_YEAR = 1900;
const SEASONS: readonly Season[] = ['winter', 'spring', 'summer', 'fall'];

function asSeason(raw: unknown): Season | null {
  const season = typeof raw === 'string' ? raw.toLowerCase() : '';
  return (SEASONS as readonly string[]).includes(season) ? (season as Season) : null;
}

/** A move-in month from a form field or JSON body: an integer 1-12, or null when absent or malformed. */
export function parseMoveInMonth(raw: unknown): number | null {
  const month = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && /^\s*\d{1,2}\s*$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

/**
 * A move-in year from a form field or JSON body, or null when absent or malformed. Up to next
 * year, because the form lists years by the reviewer's clock, which can be past New Year
 * before the server's is.
 */
export function parseMoveInYear(raw: unknown, now: Date): number | null {
  const year = typeof raw === 'number'
    ? raw
    : typeof raw === 'string' && /^\s*\d{4}\s*$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(year) && year >= EARLIEST_MOVE_IN_YEAR && year <= now.getUTCFullYear() + 1
    ? year
    : null;
}

function toStore(month: number | null, year: number | null, now: Date): MoveInToStore {
  const season = (month !== null ? getSeasonFromMonth(month) : PLACEHOLDER_SEASON) as Season;
  if (year === null) {
    // A season without a year is not a date and is never shown.
    return { season, year: now.getUTCFullYear(), given: 'none' };
  }
  return { season, year, given: month !== null ? 'season_and_year' : 'year_only' };
}

/** The move-in to store for a new review, from the raw month and year the form sent. */
export function moveInFromAnswer(monthRaw: unknown, yearRaw: unknown, now: Date): MoveInToStore {
  return toStore(parseMoveInMonth(monthRaw), parseMoveInYear(yearRaw, now), now);
}

/**
 * The move-in to store when a reviewer edits their review, or null to leave it as stored.
 *
 * A body without either key leaves the move-in alone. The edit form shows the stored year
 * but cannot show the stored season as a month, so a blank month means "season not changed",
 * not "month skipped": with the stored year nothing changes, and with a new year a season the
 * reviewer gave is kept. A review written before migration 0034 (`move_in_given` NULL) gets
 * the new year only, because its season may be the old winter placeholder and carrying it
 * over would invent a date. Clearing the year stores the move-in as skipped.
 */
export function moveInFromEdit(
  body: unknown,
  stored: StoredMoveInFields,
  now: Date,
): MoveInToStore | null {
  if (!body || typeof body !== 'object') return null;
  const fields = body as Record<string, unknown>;
  const hasMonth = Object.prototype.hasOwnProperty.call(fields, 'move_in_month');
  const hasYear = Object.prototype.hasOwnProperty.call(fields, 'move_in_year');
  if (!hasMonth && !hasYear) return null;

  const storedYearRaw = givenMoveIn(stored).year;
  const storedYear = storedYearRaw !== null && Number.isFinite(Number(storedYearRaw))
    ? Number(storedYearRaw)
    : null;
  const month = hasMonth ? parseMoveInMonth(fields.move_in_month) : null;
  const year = hasYear ? parseMoveInYear(fields.move_in_year, now) : storedYear;

  if (month === null && year === storedYear) return null;
  if (month === null && year !== null && stored.move_in_given === 'season_and_year') {
    const season = asSeason(stored.move_in_season);
    if (season) return { season, year, given: 'season_and_year' };
  }
  return toStore(month, year, now);
}
