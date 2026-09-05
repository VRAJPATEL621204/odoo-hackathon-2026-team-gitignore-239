import test from 'node:test';
import assert from 'node:assert/strict';

import { contractForPeriod, overlappingContracts, statusOn, validatePeriod } from './contract.js';

const date = (value) => new Date(`${value}T00:00:00.000Z`);

const running = {
  id: 1,
  status: 'RUNNING',
  startDate: date('2026-01-01'),
  endDate: null,
};

test('a running contract with an open end blocks a later running one', () => {
  const candidate = { id: 2, status: 'RUNNING', startDate: date('2026-06-01'), endDate: null };
  assert.equal(overlappingContracts(candidate, [running]).length, 1);
});

test('a contract starting after another ended does not overlap', () => {
  const ended = { ...running, endDate: date('2026-05-31') };
  const candidate = { id: 2, status: 'RUNNING', startDate: date('2026-06-01'), endDate: null };
  assert.deepEqual(overlappingContracts(candidate, [ended]), []);
});

test('a draft never conflicts and is never conflicted with', () => {
  const draft = { id: 2, status: 'DRAFT', startDate: date('2026-02-01'), endDate: null };
  assert.deepEqual(overlappingContracts(draft, [running]), []);
  const candidate = { id: 3, status: 'RUNNING', startDate: date('2026-02-01'), endDate: null };
  assert.deepEqual(overlappingContracts(candidate, [draft]), []);
});

test('a contract does not conflict with itself when edited', () => {
  const edited = { ...running, startDate: date('2026-01-15') };
  assert.deepEqual(overlappingContracts(edited, [running]), []);
});

test('validatePeriod rejects an end before the start', () => {
  assert.match(validatePeriod(date('2026-03-01'), date('2026-02-01')), /cannot be before/);
  assert.equal(validatePeriod(date('2026-03-01'), date('2026-03-31')), null);
  assert.equal(validatePeriod(date('2026-03-01'), null), null);
});

test('a running contract past its end date reads as expired', () => {
  const ended = { ...running, endDate: date('2026-04-30') };
  assert.equal(statusOn(ended, date('2026-06-01')), 'EXPIRED');
  assert.equal(statusOn(ended, date('2026-04-01')), 'RUNNING');
});

test('a draft stays a draft whatever the date', () => {
  const draft = { status: 'DRAFT', startDate: date('2020-01-01'), endDate: date('2020-12-31') };
  assert.equal(statusOn(draft, date('2026-06-01')), 'DRAFT');
});

test('payroll picks the contract covering the period, most recent first', () => {
  const older = { id: 1, status: 'EXPIRED', startDate: date('2025-07-01'), endDate: date('2025-12-31') };
  const current = { id: 2, status: 'RUNNING', startDate: date('2026-01-01'), endDate: null };
  const picked = contractForPeriod([older, current], date('2026-02-01'), date('2026-02-28'));
  assert.equal(picked.id, 2);
});

test('a period no contract covers returns nothing rather than guessing', () => {
  const future = { id: 1, status: 'RUNNING', startDate: date('2027-01-01'), endDate: null };
  assert.equal(contractForPeriod([future], date('2026-02-01'), date('2026-02-28')), null);
});
