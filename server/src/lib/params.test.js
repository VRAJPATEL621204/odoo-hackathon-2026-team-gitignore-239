import test from 'node:test';
import assert from 'node:assert/strict';

import { readId } from './params.js';
import { parseSearch } from './pagination.js';

test('a numeric id is read as a number', () => {
  assert.equal(readId('42'), 42);
  // Only strings arrive from a URL, so that is all this accepts.
  assert.throws(() => readId(7), { status: 404 });
});

test('a non-numeric id is a 404, not a database error', () => {
  // Passing NaN to Prisma throws a driver error, which surfaces as a 500 with
  // a reference id: a mistyped URL reported as a server fault.
  for (const value of ['abc', 'null', 'undefined', '', '  ', '1abc']) {
    assert.throws(() => readId(value), { status: 404 }, `expected ${JSON.stringify(value)} to 404`);
  }
});

test('ids that cannot identify a record are refused', () => {
  assert.throws(() => readId('0'), { status: 404 });
  assert.throws(() => readId('-1'), { status: 404 });
  assert.throws(() => readId('9.5'), { status: 404 });
  assert.throws(() => readId('1e3'), { status: 404 });
});

test('the 404 names the record type when one is given', () => {
  assert.throws(() => readId('abc', 'Payslip'), /Payslip not found/);
});

test('an empty search is nothing to search for', () => {
  assert.equal(parseSearch({}), null);
  assert.equal(parseSearch({ search: '   ' }), null);
  assert.equal(parseSearch({ search: 42 }), null);
});

test('LIKE wildcards in a search are escaped, not honoured', () => {
  // Unescaped, "%" matches every row and "_" matches any single character, so
  // a search for those characters would return the whole table.
  assert.equal(parseSearch({ search: '%' }), '\\%');
  assert.equal(parseSearch({ search: '_' }), '\\_');
  assert.equal(parseSearch({ search: '50%_off' }), '50\\%\\_off');
});

test('a backslash is escaped before the wildcards, not after', () => {
  // Escaping in the other order would double-escape the escapes.
  assert.equal(parseSearch({ search: '\\%' }), '\\\\\\%');
});

test('ordinary terms pass through untouched and are length capped', () => {
  assert.equal(parseSearch({ search: '  Mehta ' }), 'Mehta');
  assert.equal(parseSearch({ search: 'a'.repeat(200) }).length, 100);
});
