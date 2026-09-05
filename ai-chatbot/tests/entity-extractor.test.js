const test = require('node:test');
const assert = require('node:assert/strict');
const { extractCommonEntities } = require('../ai/intents/entity-extractor');

test('extracts an ISO date range', () => {
  const { startDate, endDate } = extractCommonEntities('Apply leave from 2026-09-15 to 2026-09-17');
  assert.equal(startDate, '2026-09-15');
  assert.equal(endDate, '2026-09-17');
});

test('extracts a month-name date range', () => {
  const { startDate, endDate } = extractCommonEntities('Apply leave from September 15 to September 17');
  assert.match(startDate, /-09-15$/);
  assert.match(endDate, /-09-17$/);
});

test('extracts relative period phrases', () => {
  assert.equal(extractCommonEntities('what was my salary last month').period, 'previous_month');
  assert.equal(extractCommonEntities('show this month attendance').period, 'current_month');
});
