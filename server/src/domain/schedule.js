/**
 * Working schedule arithmetic.
 *
 * Pure: the totals a schedule shows are computed from its lines here, never
 * typed in and never stored, so the summary cannot drift from the pattern.
 */

/** Monday first, matching how a weekly pattern is read. */
export const WEEKDAYS = [
  { value: 0, label: 'Monday', short: 'Mon' },
  { value: 1, label: 'Tuesday', short: 'Tue' },
  { value: 2, label: 'Wednesday', short: 'Wed' },
  { value: 3, label: 'Thursday', short: 'Thu' },
  { value: 4, label: 'Friday', short: 'Fri' },
  { value: 5, label: 'Saturday', short: 'Sat' },
  { value: 6, label: 'Sunday', short: 'Sun' },
];

export function weekdayLabel(value) {
  return WEEKDAYS.find((day) => day.value === value)?.label ?? 'Unknown';
}

/**
 * Worked hours for one line: the span from start to end, less the break.
 *
 * Rounded to two decimals so 7.5 and 8.25 stay exact rather than showing a
 * long binary tail.
 */
export function dayHours(day) {
  const minutes = day.endMinutes - day.startMinutes - (day.breakMinutes ?? 0);
  return Math.round(Math.max(0, minutes) / 0.6) / 100;
}

export function weeklyHours(days = []) {
  return Math.round(days.reduce((total, day) => total + dayHours(day) * 100, 0)) / 100;
}

/** Distinct weekdays covered, so a split shift counts as one day, not two. */
export function daysPerWeek(days = []) {
  return new Set(days.map((day) => day.dayOfWeek)).size;
}

/** Everything the list and form show about a schedule's totals. */
export function scheduleSummary(days = []) {
  return { daysPerWeek: daysPerWeek(days), hoursPerWeek: weeklyHours(days) };
}

/**
 * Validates one line. Returns a message, or null when the line is usable.
 *
 * A day that ends before it starts, or whose break swallows the whole day,
 * would silently contribute zero hours and make the weekly total wrong in a
 * way nobody would notice.
 */
export function validateDay(day) {
  if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
    return 'Choose a day of the week.';
  }
  if (day.startMinutes === null || day.endMinutes === null) return 'Enter a start and end time.';
  if (day.endMinutes <= day.startMinutes) return 'The end time must be after the start time.';
  if ((day.breakMinutes ?? 0) < 0) return 'The break cannot be negative.';
  if ((day.breakMinutes ?? 0) >= day.endMinutes - day.startMinutes) {
    return 'The break is longer than the working day.';
  }
  return null;
}
