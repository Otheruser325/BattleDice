import assert from 'node:assert/strict';
import test from 'node:test';
import { GUEST_COOKIE_NAME, GuestIdentityService } from '../dist/identity.js';

const secret = 'test-secret-that-is-at-least-32-bytes';

test('creates a stable signed guest identity', () => {
  const service = new GuestIdentityService(secret, 3600, false);
  const identity = service.create('Duelist', 1_000);
  const token = service.encode(identity);
  const verified = service.verify(token, 1_001);
  assert.ok(verified);
  assert.equal(verified.playerId, identity.playerId);
  assert.equal(verified.playerName, 'Duelist');
  assert.equal(service.verify(token, 1_001).playerId, identity.playerId);
});

test('creates a random fallback name when none is supplied', () => {
  const service = new GuestIdentityService(secret, 3600, false);
  const identity = service.create('', 1_000);
  assert.match(identity.playerName, /^Duelist-[0-9A-F]{4}$/);
});

test('renames an identity without changing its player ID', () => {
  const service = new GuestIdentityService(secret, 3600, false);
  const identity = service.create('First', 1_000);
  const renamed = service.rename(identity, 'Second', 1_100);
  assert.ok(renamed);
  assert.equal(renamed.playerId, identity.playerId);
  assert.equal(renamed.playerName, 'Second');
  assert.equal(service.rename(identity, 'bad\nname', 1_100), null);
});

test('rejects tampered identity claims', () => {
  const service = new GuestIdentityService(secret, 3600, false);
  const token = service.encode(service.create('Duelist', 1_000));
  const parts = token.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  claims.name = 'Impostor';
  parts[1] = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  assert.equal(service.verify(parts.join('.'), 1_001), null);
});

test('rejects expired identities', () => {
  const service = new GuestIdentityService(secret, 3600, false);
  const token = service.encode(service.create('Duelist', 1_000));
  assert.equal(service.verify(token, 4_600), null);
});

test('reads only the guest cookie and applies environment-appropriate flags', () => {
  const development = new GuestIdentityService(secret, 3600, false);
  const identity = development.create('Duelist', 1_000);
  const token = development.encode(identity);
  assert.equal(development.readCookie(`theme=dark; ${GUEST_COOKIE_NAME}=${token}; other=1`), token);
  assert.equal(development.readCookie('theme=dark'), null);
  const localCookie = development.cookie(identity, 1_000);
  assert.match(localCookie, new RegExp(`^${GUEST_COOKIE_NAME}=`));
  assert.match(localCookie, /HttpOnly/);
  assert.match(localCookie, /SameSite=Lax/);
  assert.doesNotMatch(localCookie, /Secure/);

  const production = new GuestIdentityService(secret, 3600, true);
  const productionCookie = production.cookie(identity, 1_000);
  assert.match(productionCookie, /SameSite=None/);
  assert.match(productionCookie, /Secure/);
  assert.match(productionCookie, /Path=\/api/);
});
