const test = require('node:test');
const assert = require('node:assert/strict');
const { detectIntent, HIGH_CONFIDENCE } = require('../server/services/intent.service');

test('hardcoded trigger match resolves without any network/LLM call', async () => {
  const result = await detectIntent('How many leaves do I have?', null);
  assert.equal(result.actionId, 'LEAVE.get_leave_balance');
  assert.equal(result.confidence, HIGH_CONFIDENCE);
  assert.equal(result.source, 'trigger');
});

test('unrelated free text does not match any hardcoded trigger', async () => {
  const config = require('../config/config');
  const original = config.aiEnabled;
  config.aiEnabled = false; // force LLM stage to short-circuit deterministically
  try {
    const result = await detectIntent('tell me a fun fact about space', null);
    assert.equal(result.actionId, null);
  } finally {
    config.aiEnabled = original;
  }
});
