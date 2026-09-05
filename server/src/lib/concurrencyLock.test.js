import assert from 'node:assert/strict';
import test from 'node:test';

import { createConcurrencyLock } from './concurrencyLock.js';

test('only one operation can hold a key at a time', () => {
  const lock = createConcurrencyLock();
  const release = lock.acquire('user:1');

  assert.equal(typeof release, 'function');
  assert.equal(lock.isActive('user:1'), true);
  assert.equal(lock.acquire('user:1'), null);
  assert.equal(typeof lock.acquire('user:2'), 'function');
});

test('releasing a key allows the next operation to start', () => {
  const lock = createConcurrencyLock();
  const release = lock.acquire('user:1');

  release();
  assert.equal(lock.isActive('user:1'), false);
  assert.equal(typeof lock.acquire('user:1'), 'function');
  release();
  release();
});