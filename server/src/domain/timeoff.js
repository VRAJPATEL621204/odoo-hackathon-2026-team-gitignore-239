import { eachDateInRange, rangesOverlap } from '../lib/dates.js';

/**
 * Time off rules.
 *
 * Pure: no Prisma, no Express. The two things worth getting right are here —
 * how long a request actually is, and how much balance is left — and both are
 * derived rather than stored, so a corrected request cannot leave a stale
 * balance behind it.
 */

/** Monday to Friday, used when an employee has no working schedule. */
const DEFAULT_WORKING_WEEKDAYS = [0, 1, 2, 3, 4];

/** The schedule's weekday numbering: 0 = Monday, matching domain/schedule.js. */
function scheduleWeekday(date) {
  // JavaScript numbers Sunday as 0; shifting shifts Monday to 0.
  return (date.getUTCDay() + 6) % 7;
}

/**
 * The weekdays an employee is expected to work.
 *
 * Falls back to a Monday-to-Friday week when there is no schedule, because
 * counting Saturday and Sunday as leave would charge somebody for days they
 * were never going to work.
 */
export function workingWeekdays(scheduleDays) {
  if (!scheduleDays || scheduleDays.length === 0) return DEFAULT_WORKING_WEEKDAYS;
  return [...new Set(scheduleDays.map((day) => day.dayOfWeek))];
}

/** Working days in an inclusive range, skipping days the employee does not work. */
export function workingDaysBetween(startDate, endDate, scheduleDays) {
  const working = new Set(workingWeekdays(scheduleDays));
  return eachDateInRange(startDate, endDate).filter((date) => working.has(scheduleWeekday(date)))
    .length;
}

/**
 * Hours a schedule expects across a range, for a type measured in hours.
 *
 * Comp off is taken in hours, so its duration is the hours the employee would
 * otherwise have worked on those days, not a count of days.
 */
export function workingHoursBetween(startDate, endDate, scheduleDays) {
  if (!scheduleDays || scheduleDays.length === 0) {
    // Without a schedule an 8-hour day is the only defensible assumption.
    return workingDaysBetween(startDate, endDate, scheduleDays) * 8;
  }

  const minutesByWeekday = new Map();
  for (const day of scheduleDays) {
    const minutes = Math.max(0, day.endMinutes - day.startMinutes - (day.breakMinutes ?? 0));
    minutesByWeekday.set(day.dayOfWeek, (minutesByWeekday.get(day.dayOfWeek) ?? 0) + minutes);
  }

  const total = eachDateInRange(startDate, endDate).reduce(
    (sum, date) => sum + (minutesByWeekday.get(scheduleWeekday(date)) ?? 0),
    0
  );
  return Math.round((total / 60) * 100) / 100;
}

/**
 * How long a request is, in the unit of its type.
 *
 * Derived rather than typed so two requests over the same dates can never be
 * charged differently.
 */
export function requestDuration({ unit, startDate, endDate, scheduleDays }) {
  return unit === 'HOURS'
    ? workingHoursBetween(startDate, endDate, scheduleDays)
    : workingDaysBetween(startDate, endDate, scheduleDays);
}

/**
 * Balance of one allocation: what was granted, what approved requests consumed,
 * and what is left.
 *
 * Only approved requests count. A request awaiting approval is reported
 * separately as `pending`, because somebody deciding on it needs to see what is
 * already committed against the same balance.
 */
export function allocationBalance(allocation, requests = []) {
  const linked = requests.filter((request) => request.allocationId === allocation.id);

  const taken = linked
    .filter((request) => request.status === 'APPROVED')
    .reduce((total, request) => total + Number(request.duration), 0);

  const pending = linked
    .filter((request) => request.status === 'TO_APPROVE')
    .reduce((total, request) => total + Number(request.duration), 0);

  const amount = Number(allocation.amount);
  return {
    allocated: round2(amount),
    taken: round2(taken),
    pending: round2(pending),
    remaining: round2(amount - taken),
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** True when the allocation is usable on the given date. */
export function allocationCoversDate(allocation, date) {
  if (allocation.validFrom && date.getTime() < allocation.validFrom.getTime()) return false;
  if (allocation.validTo && date.getTime() > allocation.validTo.getTime()) return false;
  return true;
}

/**
 * Picks the allocation a request should draw on.
 *
 * Only approved allocations of the same type, covering the request's dates,
 * with enough left to cover it. The one expiring soonest is used first, so a
 * balance that is about to lapse is spent before an open-ended one.
 */
export function chooseAllocation({ request, allocations, requests }) {
  const usable = allocations
    .filter(
      (allocation) =>
        allocation.typeId === request.typeId &&
        allocation.employeeId === request.employeeId &&
        allocation.status === 'APPROVED' &&
        allocationCoversDate(allocation, request.startDate) &&
        allocationCoversDate(allocation, request.endDate)
    )
    .map((allocation) => ({ allocation, balance: allocationBalance(allocation, requests) }))
    .filter(({ balance }) => balance.remaining >= Number(request.duration));

  if (usable.length === 0) return null;

  usable.sort((a, b) => {
    const aEnd = a.allocation.validTo ? a.allocation.validTo.getTime() : Infinity;
    const bEnd = b.allocation.validTo ? b.allocation.validTo.getTime() : Infinity;
    return aEnd - bEnd;
  });

  return usable[0].allocation;
}

/**
 * Approved requests of the same employee that clash with this one.
 *
 * Two approved leaves over the same day would mean the employee is on leave
 * twice, and payroll would deduct the day twice.
 */
export function overlappingRequests(request, existing = []) {
  return existing.filter(
    (other) =>
      other.id !== request.id &&
      other.employeeId === request.employeeId &&
      other.status === 'APPROVED' &&
      rangesOverlap(request.startDate, request.endDate, other.startDate, other.endDate)
  );
}

/** Returns a message when the request's own dates are inconsistent. */
export function validateDates(startDate, endDate) {
  if (endDate.getTime() < startDate.getTime()) {
    return 'The end date cannot be before the start date.';
  }
  return null;
}

/**
 * The statuses a request may move to from where it is.
 *
 * Kept as data so the API and the UI agree on which buttons do anything, and a
 * cancelled or refused request cannot be quietly re-approved by a stale page.
 */
export const REQUEST_TRANSITIONS = {
  TO_APPROVE: ['APPROVED', 'REFUSED', 'CANCELLED'],
  APPROVED: ['REFUSED', 'CANCELLED'],
  // A refused or cancelled request can be approved after all: an approver who
  // changes their mind should not have to reopen it first. Approval re-runs the
  // balance and overlap checks either way, so nothing is skipped by the
  // shortcut.
  REFUSED: ['TO_APPROVE', 'APPROVED'],
  CANCELLED: ['TO_APPROVE', 'APPROVED'],
};

export const ALLOCATION_TRANSITIONS = {
  TO_APPROVE: ['APPROVED', 'REFUSED'],
  APPROVED: ['REFUSED'],
  REFUSED: ['TO_APPROVE'],
  CANCELLED: ['TO_APPROVE'],
};

export function canTransition(transitions, from, to) {
  return (transitions[from] ?? []).includes(to);
}
