import test from 'node:test';
import assert from 'node:assert/strict';

import { dayHours, daysPerWeek, scheduleSummary, validateDay, weeklyHours } from './schedule.js';

const nineToSix = { dayOfWeek: 0, startMinutes: 540, endMinutes: 1080, breakMinutes: 60 };

test('a day is its span less the break', () => {
  assert.equal(dayHours(nineToSix), 8);
});

test('a missing break counts as no break', () => {
  assert.equal(dayHours({ dayOfWeek: 0, startMinutes: 540, endMinutes: 1080 }), 9);
});

test('half hours survive the rounding', () => {
  assert.equal(dayHours({ dayOfWeek: 0, startMinutes: 540, endMinutes: 1020, breakMinutes: 30 }), 7.5);
});

test('weekly hours sum the lines', () => {
  const week = [0, 1, 2, 3, 4].map((dayOfWeek) => ({ ...nineToSix, dayOfWeek }));
  assert.deepEqual(scheduleSummary(week), { daysPerWeek: 5, hoursPerWeek: 40 });
});

test('an empty schedule totals zero rather than failing', () => {
  assert.deepEqual(scheduleSummary([]), { daysPerWeek: 0, hoursPerWeek: 0 });
  assert.equal(weeklyHours(), 0);
});

test('a split shift counts as one day', () => {
  const split = [
    { dayOfWeek: 0, startMinutes: 540, endMinutes: 780 },
    { dayOfWeek: 0, startMinutes: 900, endMinutes: 1080 },
  ];
  assert.equal(daysPerWeek(split), 1);
  assert.equal(weeklyHours(split), 7);
});

test('validateDay rejects an end before the start', () => {
  assert.match(validateDay({ dayOfWeek: 0, startMinutes: 1080, endMinutes: 540 }), /after the start/);
});

test('validateDay rejects a break longer than the day', () => {
  assert.match(
    validateDay({ dayOfWeek: 0, startMinutes: 540, endMinutes: 600, breakMinutes: 90 }),
    /longer than the working day/
  );
});

test('validateDay accepts a normal day', () => {
  assert.equal(validateDay(nineToSix), null);
});
