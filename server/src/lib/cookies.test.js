import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookies, cookieParser, SESSION_COOKIE } from './cookies.js';

test('parseCookies reads multiple cookies from one header', () => {
  const cookies = parseCookies(`${SESSION_COOKIE}=abc123; theme=light`);
  assert.equal(cookies[SESSION_COOKIE], 'abc123');
  assert.equal(cookies.theme, 'light');
});

test('parseCookies returns an empty object when no header is present', () => {
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});

test('parseCookies decodes percent-escaped values and tolerates broken ones', () => {
  assert.equal(parseCookies('name=a%20b').name, 'a b');
  assert.equal(parseCookies('name=%E0%A4').name, '%E0%A4', 'malformed escape is kept verbatim');
});

test('parseCookies keeps values that contain an equals sign', () => {
  assert.equal(parseCookies('token=aa.bb=cc').token, 'aa.bb=cc');
});

test('cookieParser attaches parsed cookies to the request', () => {
  const req = { headers: { cookie: `${SESSION_COOKIE}=xyz` } };
  let called = false;
  cookieParser(req, {}, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(req.cookies[SESSION_COOKIE], 'xyz');
});
