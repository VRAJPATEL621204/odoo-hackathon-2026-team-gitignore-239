import test from 'node:test';
import assert from 'node:assert/strict';

import {
  businessDate,
  canCheckOut,
  deriveAttendance,
  expectedHoursOn,
  minutesOfDay,
  minutesSinceCheckIn,
  overtimeHours,
  scheduleWeekday,
  scheduledStartMinutes,
  statusForCheckIn,
  workedHours,
} from './attendance.js';

const IST = 'Asia/Kolkata';

/** 09:00–18:00 with an hour of break, Monday to Friday: 8 hours a day. */
const WEEK = [0, 1, 2, 3, 4].map((dayOfWeek) => ({
  dayOfWeek,
  startMinutes: 540,
  endMinutes: 1080,
  breakMinutes: 60,
}));

// 2026-09-02 is a Wednesday.
const at = (utc) => new Date(utc);

test('the business day is read in the company timezone, not in UTC', () => {
  // 19:00 UTC is already the next day in India.
  assert.equal(businessDate(at('2026-09-02T19:00:00Z'), IST), '2026-09-03');
  assert.equal(businessDate(at('2026-09-02T19:00:00Z'), 'UTC'), '2026-09-02');
});

test('minutes of day are read in the company timezone', () => {
  // 03:35 UTC is 09:05 in India.
  assert.equal(minutesOfDay(at('2026-09-02T03:35:00Z'), IST), 9 * 60 + 5);
});

test('the schedule weekday counts Monday as zero', () => {
  assert.equal(scheduleWeekday(at('2026-09-02T06:00:00Z'), IST), 2); // Wednesday
  assert.equal(scheduleWeekday(at('2026-09-06T06:00:00Z'), IST), 6); // Sunday
});

test('worked hours are the span between check in and check out', () => {
  assert.equal(workedHours(at('2026-09-02T03:35:00Z'), at('2026-09-02T12:40:00Z')), 9.08);
});

test('an open or inverted session has worked no hours', () => {
  assert.equal(workedHours(at('2026-09-02T03:35:00Z'), null), 0);
  assert.equal(workedHours(at('2026-09-02T12:40:00Z'), at('2026-09-02T03:35:00Z')), 0);
});

test('expected hours come from the schedule line for that weekday', () => {
  assert.equal(expectedHoursOn(WEEK, at('2026-09-02T06:00:00Z'), IST), 8);
});

test('a day the schedule does not cover expects nothing', () => {
  // Sunday.
  assert.equal(expectedHoursOn(WEEK, at('2026-09-06T06:00:00Z'), IST), 0);
});

test('no schedule means no expectation, which is not the same as zero', () => {
  assert.equal(expectedHoursOn([], at('2026-09-02T06:00:00Z'), IST), null);
  assert.equal(scheduledStartMinutes([], at('2026-09-02T06:00:00Z'), IST), null);
});

test('a check-in inside the grace period is on time', () => {
  // 09:08 IST, schedule starts 09:00, grace is 10 minutes.
  assert.equal(statusForCheckIn(at('2026-09-02T03:38:00Z'), WEEK, IST), 'PRESENT');
});

test('a check-in past the grace period is late', () => {
  // 09:32 IST.
  assert.equal(statusForCheckIn(at('2026-09-02T04:02:00Z'), WEEK, IST), 'LATE');
});

test('without a schedule nobody is late', () => {
  assert.equal(statusForCheckIn(at('2026-09-02T08:00:00Z'), [], IST), 'PRESENT');
});

test('overtime is the excess over the expected hours', () => {
  assert.equal(overtimeHours(9.08, 8), 1.08);
  assert.equal(overtimeHours(7.5, 8), 0);
  assert.equal(overtimeHours(9, null), 0);
});

test('a finished session derives status, hours and overtime together', () => {
  const result = deriveAttendance({
    checkIn: at('2026-09-02T03:35:00Z'), // 09:05 IST
    checkOut: at('2026-09-02T12:40:00Z'), // 18:10 IST
    scheduleDays: WEEK,
    timezone: IST,
  });
  assert.deepEqual(result, { status: 'PRESENT', workedHours: 9.08, overtimeHours: 1.08 });
});

test('an open session has no hours and no overtime yet', () => {
  const result = deriveAttendance({
    checkIn: at('2026-09-02T03:35:00Z'),
    checkOut: null,
    scheduleDays: WEEK,
    timezone: IST,
  });
  assert.deepEqual(result, { status: 'PRESENT', workedHours: 0, overtimeHours: 0 });
});

test('an absence stays an absence and reports no hours', () => {
  const result = deriveAttendance({
    checkIn: at('2026-09-02T03:35:00Z'),
    checkOut: at('2026-09-02T12:40:00Z'),
    scheduleDays: WEEK,
    timezone: IST,
    status: 'ABSENT',
  });
  assert.deepEqual(result, { status: 'ABSENT', workedHours: 0, overtimeHours: 0 });
});

test('a record with no check-in is an absence', () => {
  const result = deriveAttendance({ checkIn: null, checkOut: null, scheduleDays: WEEK, timezone: IST });
  assert.equal(result.status, 'ABSENT');
});

test('minutes since check-in is the plain elapsed time, never negative', () => {
  assert.equal(minutesSinceCheckIn(at('2026-09-02T13:07:00Z'), at('2026-09-02T13:37:00Z')), 30);
  assert.equal(minutesSinceCheckIn(at('2026-09-02T13:07:00Z'), at('2026-09-02T14:07:00Z')), 60);
  // Clock skew or a stale read must never produce a negative wait.
  assert.equal(minutesSinceCheckIn(at('2026-09-02T13:07:00Z'), at('2026-09-02T13:00:00Z')), 0);
  assert.equal(minutesSinceCheckIn(null, at('2026-09-02T13:07:00Z')), 0);
});

test('check-out is refused before an hour has passed and allowed from exactly an hour', () => {
  const checkIn = at('2026-09-02T13:07:00Z'); // 7:07 PM IST
  assert.equal(canCheckOut(checkIn, at('2026-09-02T13:37:00Z')), false); // 30 min
  assert.equal(canCheckOut(checkIn, at('2026-09-02T14:06:00Z')), false); // 59 min
  assert.equal(canCheckOut(checkIn, at('2026-09-02T14:07:00Z')), true); // exactly 60 min
  assert.equal(canCheckOut(checkIn, at('2026-09-02T15:07:00Z')), true); // 2 hours
});

test('the minimum checkout wait is configurable rather than fixed at 60', () => {
  const checkIn = at('2026-09-02T13:07:00Z');
  assert.equal(canCheckOut(checkIn, at('2026-09-02T13:22:00Z'), 15), true); // 15 min, 15-min minimum
  assert.equal(canCheckOut(checkIn, at('2026-09-02T13:21:00Z'), 15), false); // 14 min, 15-min minimum
});
