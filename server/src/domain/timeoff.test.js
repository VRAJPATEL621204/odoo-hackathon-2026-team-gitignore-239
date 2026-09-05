import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOCATION_TRANSITIONS,
  REQUEST_TRANSITIONS,
  allocationBalance,
  allocationCoversDate,
  canTransition,
  chooseAllocation,
  overlappingRequests,
  requestDuration,
  validateDates,
  workingDaysBetween,
  workingHoursBetween,
  workingWeekdays,
} from './timeoff.js';

const date = (value) => new Date(`${value}T00:00:00.000Z`);

/** Monday to Friday, 8 hours a day. */
const WEEK = [0, 1, 2, 3, 4].map((dayOfWeek) => ({
  dayOfWeek,
  startMinutes: 540,
  endMinutes: 1080,
  breakMinutes: 60,
}));

test('a range inside one week counts its own days', () => {
  // Saturday 12 September 2026 is a Saturday, so use a Mon–Wed range.
  assert.equal(workingDaysBetween(date('2026-09-07'), date('2026-09-09'), WEEK), 3);
});

test('a weekend inside the range is not charged as leave', () => {
  // Friday to Monday is two working days, not four.
  assert.equal(workingDaysBetween(date('2026-09-11'), date('2026-09-14'), WEEK), 2);
});

test('a single day is one day', () => {
  assert.equal(workingDaysBetween(date('2026-09-07'), date('2026-09-07'), WEEK), 1);
});

test('a range entirely at the weekend is no leave at all', () => {
  assert.equal(workingDaysBetween(date('2026-09-12'), date('2026-09-13'), WEEK), 0);
});

test('without a schedule the week is Monday to Friday', () => {
  assert.deepEqual(workingWeekdays([]), [0, 1, 2, 3, 4]);
  assert.equal(workingDaysBetween(date('2026-09-11'), date('2026-09-14'), []), 2);
});

test('a six-day schedule charges Saturday too', () => {
  const sixDays = [...WEEK, { dayOfWeek: 5, startMinutes: 540, endMinutes: 780, breakMinutes: 0 }];
  assert.equal(workingDaysBetween(date('2026-09-11'), date('2026-09-14'), sixDays), 3);
});

test('hours come from the schedule, not from a day count', () => {
  assert.equal(workingHoursBetween(date('2026-09-07'), date('2026-09-08'), WEEK), 16);
});

test('without a schedule an hour type assumes an eight-hour day', () => {
  assert.equal(workingHoursBetween(date('2026-09-07'), date('2026-09-08'), []), 16);
});

test('duration follows the unit of the type', () => {
  const range = { startDate: date('2026-09-07'), endDate: date('2026-09-08'), scheduleDays: WEEK };
  assert.equal(requestDuration({ unit: 'DAYS', ...range }), 2);
  assert.equal(requestDuration({ unit: 'HOURS', ...range }), 16);
});

const allocation = { id: 1, employeeId: 1, typeId: 1, amount: 20, status: 'APPROVED' };

test('only approved requests reduce the balance', () => {
  const requests = [
    { id: 1, allocationId: 1, status: 'APPROVED', duration: 5 },
    { id: 2, allocationId: 1, status: 'APPROVED', duration: 3 },
    { id: 3, allocationId: 1, status: 'TO_APPROVE', duration: 2 },
    { id: 4, allocationId: 1, status: 'REFUSED', duration: 4 },
  ];
  assert.deepEqual(allocationBalance(allocation, requests), {
    allocated: 20,
    taken: 8,
    pending: 2,
    remaining: 12,
  });
});

test('requests against another allocation do not touch this balance', () => {
  const requests = [{ id: 1, allocationId: 2, status: 'APPROVED', duration: 5 }];
  assert.equal(allocationBalance(allocation, requests).remaining, 20);
});

test('an untouched allocation is entirely remaining', () => {
  assert.deepEqual(allocationBalance(allocation, []), {
    allocated: 20,
    taken: 0,
    pending: 0,
    remaining: 20,
  });
});

test('validity bounds decide whether an allocation covers a date', () => {
  const bounded = { ...allocation, validFrom: date('2026-01-01'), validTo: date('2026-12-31') };
  assert.equal(allocationCoversDate(bounded, date('2026-06-01')), true);
  assert.equal(allocationCoversDate(bounded, date('2025-12-31')), false);
  assert.equal(allocationCoversDate(bounded, date('2027-01-01')), false);
  assert.equal(allocationCoversDate(allocation, date('2030-01-01')), true);
});

test('a request draws on an approved allocation with enough left', () => {
  const request = {
    employeeId: 1,
    typeId: 1,
    duration: 3,
    startDate: date('2026-06-01'),
    endDate: date('2026-06-03'),
  };
  const chosen = chooseAllocation({ request, allocations: [allocation], requests: [] });
  assert.equal(chosen.id, 1);
});

test('an allocation without enough left is not chosen', () => {
  const request = {
    employeeId: 1,
    typeId: 1,
    duration: 15,
    startDate: date('2026-06-01'),
    endDate: date('2026-06-20'),
  };
  const requests = [{ id: 9, allocationId: 1, status: 'APPROVED', duration: 8 }];
  assert.equal(chooseAllocation({ request, allocations: [allocation], requests }), null);
});

test('an allocation awaiting approval creates no balance', () => {
  const pending = { ...allocation, status: 'TO_APPROVE' };
  const request = {
    employeeId: 1,
    typeId: 1,
    duration: 1,
    startDate: date('2026-06-01'),
    endDate: date('2026-06-01'),
  };
  assert.equal(chooseAllocation({ request, allocations: [pending], requests: [] }), null);
});

test('the balance expiring soonest is spent first', () => {
  const expiring = { ...allocation, id: 2, amount: 5, validTo: date('2026-03-31') };
  const request = {
    employeeId: 1,
    typeId: 1,
    duration: 2,
    startDate: date('2026-02-01'),
    endDate: date('2026-02-02'),
  };
  const chosen = chooseAllocation({
    request,
    allocations: [allocation, expiring],
    requests: [],
  });
  assert.equal(chosen.id, 2);
});

test('two approved leaves cannot cover the same day', () => {
  const existing = [
    {
      id: 1,
      employeeId: 1,
      status: 'APPROVED',
      startDate: date('2026-09-07'),
      endDate: date('2026-09-11'),
    },
  ];
  const candidate = {
    id: 2,
    employeeId: 1,
    startDate: date('2026-09-10'),
    endDate: date('2026-09-14'),
  };
  assert.equal(overlappingRequests(candidate, existing).length, 1);
});

test('a refused request never clashes, and neither does another employee', () => {
  const refused = [
    {
      id: 1,
      employeeId: 1,
      status: 'REFUSED',
      startDate: date('2026-09-07'),
      endDate: date('2026-09-11'),
    },
  ];
  const candidate = { id: 2, employeeId: 1, startDate: date('2026-09-10'), endDate: date('2026-09-14') };
  assert.deepEqual(overlappingRequests(candidate, refused), []);

  const other = [{ ...refused[0], status: 'APPROVED', employeeId: 2 }];
  assert.deepEqual(overlappingRequests(candidate, other), []);
});

test('a request does not clash with itself when edited', () => {
  const existing = [
    {
      id: 1,
      employeeId: 1,
      status: 'APPROVED',
      startDate: date('2026-09-07'),
      endDate: date('2026-09-11'),
    },
  ];
  const edited = { id: 1, employeeId: 1, startDate: date('2026-09-08'), endDate: date('2026-09-10') };
  assert.deepEqual(overlappingRequests(edited, existing), []);
});

test('dates are rejected when the end precedes the start', () => {
  assert.match(validateDates(date('2026-09-10'), date('2026-09-01')), /cannot be before/);
  assert.equal(validateDates(date('2026-09-01'), date('2026-09-01')), null);
});

test('the approval flow only allows the moves it defines', () => {
  assert.equal(canTransition(REQUEST_TRANSITIONS, 'TO_APPROVE', 'APPROVED'), true);
  assert.equal(canTransition(REQUEST_TRANSITIONS, 'APPROVED', 'APPROVED'), false);
  // An approver who changes their mind approves directly, without reopening.
  assert.equal(canTransition(REQUEST_TRANSITIONS, 'REFUSED', 'APPROVED'), true);
  assert.equal(canTransition(REQUEST_TRANSITIONS, 'REFUSED', 'TO_APPROVE'), true);
  assert.equal(canTransition(REQUEST_TRANSITIONS, 'CANCELLED', 'APPROVED'), true);
  assert.equal(canTransition(ALLOCATION_TRANSITIONS, 'TO_APPROVE', 'APPROVED'), true);
  assert.equal(canTransition(ALLOCATION_TRANSITIONS, 'APPROVED', 'TO_APPROVE'), false);
});
