import test from 'node:test';
import assert from 'node:assert/strict';
import { validator } from './validate.js';
import { AppError } from './errors.js';
import { formatDateOnly } from './dates.js';

test('validator returns parsed and trimmed values', () => {
  const v = validator({ firstName: '  Aarav  ', wage: '85000', active: true });
  v.string('firstName', { required: true });
  v.number('wage', { required: true, min: 0 });
  v.boolean('active');

  assert.deepEqual(v.result(), { firstName: 'Aarav', wage: 85000, active: true });
});

test('validator collects every field error in one pass', () => {
  const v = validator({ firstName: '', workEmail: 'not-an-email', wage: -5 });
  v.string('firstName', { required: true });
  v.email('workEmail', { required: true });
  v.number('wage', { required: true, min: 0 });

  assert.equal(v.hasErrors, true);
  try {
    v.result();
    assert.fail('expected result() to throw');
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 422);
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.deepEqual(Object.keys(error.fields).sort(), ['firstName', 'wage', 'workEmail']);
  }
});

test('optional fields are absent from the result rather than undefined values', () => {
  const v = validator({ firstName: 'Sara' });
  v.string('firstName', { required: true });
  v.string('phone');

  assert.deepEqual(v.result(), { firstName: 'Sara' });
});

test('email is lowercased so lookups match the stored address', () => {
  const v = validator({ workEmail: '  Aarav@OXP.com ' });
  v.email('workEmail', { required: true });
  assert.equal(v.result().workEmail, 'aarav@oxp.com');
});

test('number enforces integer, min and max', () => {
  const v = validator({ sequence: 1.5, percentage: 150 });
  v.number('sequence', { integer: true });
  v.number('percentage', { max: 100 });

  assert.equal(v.fields.sequence, 'Must be a whole number.');
  assert.equal(v.fields.percentage, 'Must be at most 100.');
});

test('enum rejects values outside the allowed set', () => {
  const allowed = ['DRAFT', 'RUNNING', 'EXPIRED'];
  const ok = validator({ state: 'RUNNING' });
  ok.enum('state', allowed, { required: true });
  assert.equal(ok.result().state, 'RUNNING');

  const bad = validator({ state: 'PENDING' });
  bad.enum('state', allowed, { required: true });
  assert.match(bad.fields.state, /Must be one of/);
});

test('date parses business dates and rejects invalid calendar days', () => {
  const ok = validator({ startDate: '2026-01-01' });
  ok.date('startDate', { required: true });
  assert.equal(formatDateOnly(ok.result().startDate), '2026-01-01');

  const bad = validator({ startDate: '2026-02-30' });
  bad.date('startDate', { required: true });
  assert.equal(bad.fields.startDate, 'Enter a valid date as YYYY-MM-DD.');
});

test('array validates presence and length bounds', () => {
  const v = validator({ employeeIds: [] });
  v.array('employeeIds', { required: true, min: 1 });
  assert.equal(v.fields.employeeIds, 'Provide at least 1 item(s).');
});

test('reject records a cross-field rule failure', () => {
  const v = validator({ startDate: '2026-03-01', endDate: '2026-01-01' });
  const start = v.date('startDate', { required: true });
  const end = v.date('endDate');
  if (start && end && end < start) v.reject('endDate', 'End date must be on or after the start date.');

  assert.equal(v.fields.endDate, 'End date must be on or after the start date.');
});
