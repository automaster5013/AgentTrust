import test from 'node:test';
import assert from 'node:assert/strict';
import {containerUserArgs} from '../packages/receipts/container-user.js';

test('Windows evidence containers retain the image default user', () => {
  assert.deepEqual(containerUserArgs({}), []);
  assert.deepEqual(containerUserArgs({getuid: () => 1000}), []);
});

test('Unix evidence containers preserve numeric host ownership and reject invalid identities', () => {
  assert.deepEqual(containerUserArgs({getuid: () => 1001, getgid: () => 1002}), ['--user', '1001:1002']);
  for (const uid of [-1, NaN, '1000', Infinity]) {
    assert.throws(() => containerUserArgs({getuid: () => uid, getgid: () => 1000}), /Invalid host user identity/);
  }
  assert.throws(() => containerUserArgs({getuid: () => 1000, getgid: () => -1}), /Invalid host user identity/);
});
