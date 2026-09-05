import test from 'node:test';
import assert from 'node:assert/strict';
import { round2, toMoney, formatMoney } from './money.js';

test('round2 rounds to two decimals', () => {
  assert.equal(round2(2.344), 2.34);
  assert.equal(round2(2.345), 2.35);
  assert.equal(round2(50000), 50000);
  assert.equal(round2(0), 0);
});

test('round2 rounds negatives away from zero, not towards positive infinity', () => {
  // Math.round(-2.345 * 100) is -234, which would under-deduct every payslip.
  assert.equal(round2(-2.345), -2.35);
  assert.equal(round2(-2.344), -2.34);
  assert.equal(round2(-3000), -3000);
});

test('round2 handles binary floating point representation', () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(1.005), 1.01);
});

test('round2 rejects non-finite input instead of producing NaN amounts', () => {
  assert.throws(() => round2(Number.NaN), TypeError);
  assert.throws(() => round2(Number.POSITIVE_INFINITY), TypeError);
});

test('toMoney converts Decimal-like values and passes null through', () => {
  assert.equal(toMoney(null), null);
  assert.equal(toMoney(undefined), null);
  assert.equal(toMoney(1234.5), 1234.5);
  // Prisma Decimal exposes toString/valueOf; Number() uses them.
  assert.equal(toMoney({ toString: () => '85000.00', valueOf: () => 85000 }), 85000);
});

test('formatMoney renders two decimals and an em dash for missing values', () => {
  assert.equal(formatMoney(null), '—');
  assert.ok(formatMoney(50000).endsWith('.00'));
});
