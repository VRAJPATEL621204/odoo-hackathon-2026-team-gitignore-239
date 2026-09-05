/**
 * Attendance arithmetic.
 *
 * Pure: no Prisma, no Express, no clock of its own — "now" is always passed in,
 * which is what makes every rule below testable at a fixed instant.
 *
 * Worked hours, lateness and overtime are all derived. Nothing here is stored
 * that could be computed, so a corrected check-out cannot leave a stale total
 * behind it.
 */

/** A check-in this many minutes past the scheduled start still counts as on time. */
export const LATE_GRACE_MINUTES = 10;

/**
 * The calendar day an instant falls on, in the given timezone, as "YYYY-MM-DD".
 *
 * The server may run anywhere, so the day cannot come from the host clock:
 * 00:30 in Mumbai is still the previous day in UTC, and an attendance record
 * filed under the wrong day would quietly break every report that groups by it.
 * The "en-CA" locale is used because it formats as YYYY-MM-DD.
 */
export function businessDate(instant, timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Minutes from midnight of an instant, read in the given timezone. */
export function minutesOfDay(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(instant);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);
  // Some runtimes render midnight as hour 24; both mean the same instant.
  return (hour % 24) * 60 + minute;
}

/**
 * The weekday of an instant as the schedule numbers them: 0 = Monday.
 *
 * JavaScript numbers Sunday as 0, which would silently shift every schedule
 * lookup by one day.
 */
export function scheduleWeekday(instant, timezone) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    instant
  );
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(label);
}

/** Hours between two instants, rounded to two decimals. Never negative. */
export function workedHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const milliseconds = checkOut.getTime() - checkIn.getTime();
  if (milliseconds <= 0) return 0;
  return Math.round(milliseconds / 36000) / 100;
}

/**
 * The hours a schedule expects on the weekday of `instant`.
 *
 * Returns null when the employee has no schedule, which is different from
 * zero: without a schedule there is nothing to be late for and no overtime
 * threshold, so those rules are skipped rather than applied against zero.
 */
export function expectedHoursOn(scheduleDays, instant, timezone) {
  if (!scheduleDays || scheduleDays.length === 0) return null;

  const weekday = scheduleWeekday(instant, timezone);
  const lines = scheduleDays.filter((day) => day.dayOfWeek === weekday);
  if (lines.length === 0) return 0;

  const minutes = lines.reduce(
    (total, day) => total + Math.max(0, day.endMinutes - day.startMinutes - (day.breakMinutes ?? 0)),
    0
  );
  return Math.round((minutes / 60) * 100) / 100;
}

/** The earliest start the schedule has on that weekday, or null. */
export function scheduledStartMinutes(scheduleDays, instant, timezone) {
  if (!scheduleDays || scheduleDays.length === 0) return null;

  const weekday = scheduleWeekday(instant, timezone);
  const starts = scheduleDays
    .filter((day) => day.dayOfWeek === weekday)
    .map((day) => day.startMinutes);

  return starts.length === 0 ? null : Math.min(...starts);
}

/**
 * PRESENT or LATE for a check-in.
 *
 * An employee with no schedule, or one checking in on a day their schedule does
 * not cover, is present: there is no expected start to be measured against.
 */
export function statusForCheckIn(checkIn, scheduleDays, timezone) {
  if (!checkIn) return 'ABSENT';

  const expectedStart = scheduledStartMinutes(scheduleDays, checkIn, timezone);
  if (expectedStart === null) return 'PRESENT';

  const actual = minutesOfDay(checkIn, timezone);
  return actual > expectedStart + LATE_GRACE_MINUTES ? 'LATE' : 'PRESENT';
}

/** Hours worked beyond what the schedule expected. Zero without a schedule. */
export function overtimeHours(hoursWorked, expected) {
  if (expected === null || expected === undefined) return 0;
  const extra = hoursWorked - expected;
  return extra <= 0 ? 0 : Math.round(extra * 100) / 100;
}

/**
 * Everything derived from one attendance record, in one call.
 *
 * The service writes exactly what this returns, so the rules cannot be applied
 * in one place and forgotten in another.
 */
export function deriveAttendance({ checkIn, checkOut, scheduleDays, timezone, status }) {
  // An absence is a deliberate statement that the employee did not work; it is
  // never overridden by the derivation below.
  if (status === 'ABSENT' || !checkIn) {
    return { status: 'ABSENT', workedHours: 0, overtimeHours: 0 };
  }

  const hours = workedHours(checkIn, checkOut);
  const expected = expectedHoursOn(scheduleDays, checkIn, timezone);

  return {
    status: statusForCheckIn(checkIn, scheduleDays, timezone),
    workedHours: hours,
    // An open session has worked no hours yet, so it has no overtime either.
    overtimeHours: checkOut ? overtimeHours(hours, expected) : 0,
  };
}
