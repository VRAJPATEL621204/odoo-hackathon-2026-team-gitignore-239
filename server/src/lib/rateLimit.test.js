import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from './errors.js';
import { createRateLimiter, rateLimit } from './rateLimit.js';

test('allows requests up to the limit and reports remaining capacity', () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });

  const first = limiter.check('10.0.0.1');
  const second = limiter.check('10.0.0.1');
  const third = limiter.check('10.0.0.1');

  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterSeconds > 0, true);
});

test('different IP keys have independent buckets', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });

  assert.equal(limiter.check('10.0.0.1').allowed, true);
  assert.equal(limiter.check('10.0.0.1').allowed, false);
  assert.equal(limiter.check('10.0.0.2').allowed, true);
});

test('a fixed window resets after its configured duration', () => {
  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;

  try {
    const limiter = createRateLimiter({ limit: 1, windowMs: 100 });
    assert.equal(limiter.check('10.0.0.1').allowed, true);
    assert.equal(limiter.check('10.0.0.1').allowed, false);
    now += 101;
    assert.equal(limiter.check('10.0.0.1').allowed, true);
  } finally {
    Date.now = originalNow;
  }
});

test('middleware returns a standard 429 with retry and rate headers', () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
  const middleware = rateLimit({ limiter, action: 'TEST' });
  const headers = new Map();
  const response = { setHeader(name, value) { headers.set(name, value); } };
  const request = { ip: '203.0.113.10', originalUrl: '/api/test' };
  let nextError;
  const next = (error) => { nextError = error; };

  middleware(request, response, next);
  middleware(request, response, next);

  assert.equal(nextError instanceof AppError, true);
  assert.equal(nextError.status, 429);
  assert.equal(nextError.code, 'RATE_LIMIT_EXCEEDED');
  assert.equal(headers.get('Retry-After') > 0, true);
  assert.equal(headers.get('RateLimit-Limit'), 1);
  assert.equal(headers.get('RateLimit-Remaining'), 0);
});