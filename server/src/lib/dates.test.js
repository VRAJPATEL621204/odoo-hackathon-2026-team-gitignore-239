import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateOnly,
  formatDateOnly,
  dayOfWeek,
  addDays,
  daysBetweenInclusive,
  eachDateInRange,
  rangesOverlap,
  monthRange,
  clampRange,
  minutesToTimeLabel,
  timeLabelToMinutes,
} from './dates.js';

test('parseDateOnly pins the date to UTC midnight regardless of machine timezone', () => {
  const date = parseDateOnly('2026-01-31');
  assert.equal(date.toISOString(), '2026-01-31T00:00:00.000Z');
  assert.equal(formatDateOnly(date), '2026-01-31');
});

test('parseDateOnly rejects malformed and impossible dates', () => {
  assert.equal(parseDateOnly('2026-02-30'), null, 'February never has 30 days');
  assert.equal(parseDateOnly('2026-13-01'), null);
  assert.equal(parseDateOnly('31-01-2026'), null);
  assert.equal(parseDateOnly(''), null);
  assert.equal(parseDateOnly(null), null);
});

test('parseDateOnly accepts leap days in leap years only', () => {
  assert.ok(parseDateOnly('2028-02-29'));
  assert.equal(parseDateOnly('2026-02-29'), null);
});

test('dayOfWeek reports UTC weekdays', () => {
  assert.equal(dayOfWeek(parseDateOnly('2026-09-07')), 1, 'Monday');
  assert.equal(dayOfWeek(parseDateOnly('2026-09-12')), 6, 'Saturday');
  assert.equal(dayOfWeek(parseDateOnly('2026-09-13')), 0, 'Sunday');
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(formatDateOnly(addDays(parseDateOnly('2026-01-31'), 1)), '2026-02-01');
  assert.equal(formatDateOnly(addDays(parseDateOnly('2026-12-31'), 1)), '2027-01-01');
  assert.equal(formatDateOnly(addDays(parseDateOnly('2026-03-01'), -1)), '2026-02-28');
});

test('daysBetweenInclusive counts both end dates', () => {
  assert.equal(daysBetweenInclusive(parseDateOnly('2026-09-12'), parseDateOnly('2026-09-14')), 3);
  assert.equal(daysBetweenInclusive(parseDateOnly('2026-09-12'), parseDateOnly('2026-09-12')), 1);
});

test('eachDateInRange walks the range and returns nothing when inverted', () => {
  const dates = eachDateInRange(parseDateOnly('2026-09-12'), parseDateOnly('2026-09-14'));
  assert.deepEqual(dates.map(formatDateOnly), ['2026-09-12', '2026-09-13', '2026-09-14']);
  assert.deepEqual(eachDateInRange(parseDateOnly('2026-09-14'), parseDateOnly('2026-09-12')), []);
});

test('eachDateInRange spans a full month including its last day', () => {
  const { start, end } = monthRange(parseDateOnly('2026-02-15'));
  assert.equal(formatDateOnly(start), '2026-02-01');
  assert.equal(formatDateOnly(end), '2026-02-28');
  assert.equal(eachDateInRange(start, end).length, 28);
});

test('rangesOverlap treats a null end date as open ended', () => {
  const jan = [parseDateOnly('2026-01-01'), parseDateOnly('2026-01-31')];
  const feb = [parseDateOnly('2026-02-01'), parseDateOnly('2026-02-28')];

  assert.equal(rangesOverlap(jan[0], jan[1], feb[0], feb[1]), false);
  assert.equal(rangesOverlap(jan[0], null, feb[0], feb[1]), true, 'open contract covers February');
  assert.equal(rangesOverlap(jan[0], jan[1], jan[1], feb[1]), true, 'touching on one day overlaps');
});

test('clampRange returns the shared portion or null', () => {
  const clamped = clampRange(
    parseDateOnly('2026-01-25'),
    parseDateOnly('2026-02-05'),
    parseDateOnly('2026-02-01'),
    parseDateOnly('2026-02-28')
  );
  assert.equal(formatDateOnly(clamped.start), '2026-02-01');
  assert.equal(formatDateOnly(clamped.end), '2026-02-05');

  assert.equal(
    clampRange(
      parseDateOnly('2026-01-01'),
      parseDateOnly('2026-01-10'),
      parseDateOnly('2026-02-01'),
      parseDateOnly('2026-02-28')
    ),
    null
  );
});

test('minute and time-label conversion round trips', () => {
  assert.equal(minutesToTimeLabel(540), '09:00');
  assert.equal(minutesToTimeLabel(1080), '18:00');
  assert.equal(timeLabelToMinutes('09:00'), 540);
  assert.equal(timeLabelToMinutes('18:00'), 1080);
  assert.equal(timeLabelToMinutes('24:00'), 1440);
});

test('timeLabelToMinutes rejects invalid clock values', () => {
  assert.equal(timeLabelToMinutes('9:60'), null);
  assert.equal(timeLabelToMinutes('25:00'), null);
  assert.equal(timeLabelToMinutes('nine'), null);
  assert.equal(timeLabelToMinutes(540), null);
});
