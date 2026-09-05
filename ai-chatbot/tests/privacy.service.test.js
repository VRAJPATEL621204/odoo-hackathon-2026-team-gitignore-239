const test = require('node:test');
const assert = require('node:assert/strict');
const privacy = require('../server/services/privacy.service');

test('redact hides secret-shaped key/value pairs', () => {
  const out = privacy.redact('{"password":"abc123","name":"John"}');
  assert.match(out, /REDACTED/);
  assert.doesNotMatch(out, /abc123/);
});

test('maskSensitiveFields masks identifier fields to last 4 chars', () => {
  const out = privacy.maskSensitiveFields({ bankAccountNumber: '123456789012', name: 'John' });
  assert.equal(out.bankAccountNumber, '****9012');
  assert.equal(out.name, 'John');
});

test('maskSensitiveFields drops credential-shaped fields entirely', () => {
  const out = privacy.maskSensitiveFields({ password: 'secret', apiKey: 'xyz', id: 1 });
  assert.equal(out.password, undefined);
  assert.equal(out.apiKey, undefined);
  assert.equal(out.id, 1);
});

test('isCredentialRequest recognizes password/credential asks', () => {
  assert.equal(privacy.isCredentialRequest('please reset my password'), true);
  assert.equal(privacy.isCredentialRequest("what's my leave balance"), false);
});
