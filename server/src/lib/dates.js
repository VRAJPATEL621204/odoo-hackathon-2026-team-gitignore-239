/**
 * Date helpers for business dates.
 *
 * Contract dates, attendance dates, leave dates and payroll periods are stored
 * as PostgreSQL `date` columns, because a payroll period is a calendar concept
 * rather than an instant. Every helper here works in UTC so a machine in IST
 * and a machine in UTC produce the same day for the same input string. Using
 * local-time constructors would shift "2026-01-31" back to 30 January in any
 * timezone east of Greenwich.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses "YYYY-MM-DD" into a Date pinned to UTC midnight.
 * Returns null for anything that is not a valid calendar date.
 */
export function parseDateOnly(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : toUtcMidnight(value);
  }
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  // Rejects impossible dates that JavaScript would silently roll over,
  // such as 2026-02-30 becoming 2 March.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** Strips the time component, keeping the same calendar day in UTC. */
export function toUtcMidnight(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Formats a Date as "YYYY-MM-DD". */
export function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

/** Day of week in UTC: 0 = Sunday through 6 = Saturday. */
export function dayOfWeek(date) {
  return date.getUTCDay();
}

export function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Whole days from `start` to `end`, inclusive of both ends. */
export function daysBetweenInclusive(start, end) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((end.getTime() - start.getTime()) / millisecondsPerDay) + 1;
}

/**
 * Every calendar date from `start` to `end` inclusive.
 * Returns an empty array when the range is inverted.
 */
export function eachDateInRange(start, end) {
  const dates = [];
  if (start.getTime() > end.getTime()) return dates;
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

/** True when two date ranges share at least one day. An open end means "forever". */
export function rangesOverlap(startA, endA, startB, endB) {
  const aEnd = endA ? endA.getTime() : Infinity;
  const bEnd = endB ? endB.getTime() : Infinity;
  return startA.getTime() <= bEnd && startB.getTime() <= aEnd;
}

/** First and last day of the month containing `date`. */
export function monthRange(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 0)),
  };
}

/** Overlapping portion of two ranges, or null when they do not overlap. */
export function clampRange(start, end, boundStart, boundEnd) {
  const from = start.getTime() > boundStart.getTime() ? start : boundStart;
  const to = end.getTime() < boundEnd.getTime() ? end : boundEnd;
  return from.getTime() > to.getTime() ? null : { start: from, end: to };
}

/** Converts minutes-from-midnight into "HH:MM" for display. */
export function minutesToTimeLabel(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

/** Parses "HH:MM" into minutes from midnight, or null when malformed. */
export function timeLabelToMinutes(label) {
  if (typeof label !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(label);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return total > 1440 ? null : total;
}
