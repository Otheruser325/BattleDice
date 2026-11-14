import assert from 'node:assert/strict';
import test from 'node:test';
import { getClientAddress } from '../dist/rate-limit.js';

function request(remoteAddress, forwardedFor) {
  return {
    socket: { remoteAddress },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor }
  };
}

test('trusted proxy parsing uses the rightmost forwarded address', () => {
  assert.equal(
    getClientAddress(request('127.0.0.1', '203.0.113.9, 198.51.100.7'), true),
    '198.51.100.7'
  );
});

test('trusted proxy parsing skips invalid trailing entries', () => {
  assert.equal(
    getClientAddress(request('::ffff:127.0.0.1', '203.0.113.9, 198.51.100.7, unknown'), true),
    '198.51.100.7'
  );
});

test('trusted proxy parsing falls back to the socket address without a usable header', () => {
  assert.equal(getClientAddress(request('127.0.0.1'), true), '127.0.0.1');
  assert.equal(getClientAddress(request('127.0.0.1', 'unknown'), true), '127.0.0.1');
  assert.equal(getClientAddress(request('127.0.0.1', '203.0.113.9'), false), '127.0.0.1');
});
