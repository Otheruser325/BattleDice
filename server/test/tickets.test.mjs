import assert from 'node:assert/strict';
import test from 'node:test';
import { TicketAuth } from '../dist/auth.js';
import { TicketService } from '../dist/tickets.js';

const secret = 'test-secret-that-is-at-least-32-bytes';
const subject = { playerId: 'p_abcdefghijklmnop', playerName: 'Player One' };

test('issues a verifiable ticket bound to a player ID and name', () => {
  const service = new TicketService(secret, 3600);
  const issued = service.issue(subject, '203.0.113.7', 1_000);
  const claims = service.verify(issued.ticket, 1_001);
  assert.ok(claims);
  assert.equal(claims.sub, subject.playerId);
  assert.equal(claims.name, subject.playerName);
  assert.equal(claims.exp, 4_600);
  assert.equal(claims.ip, '203.0.113.7');
});

test('issues tickets without an IP when none is supplied', () => {
  const service = new TicketService(secret, 3600);
  const issued = service.issue(subject, undefined, 1_000);
  const claims = service.verify(issued.ticket, 1_001);
  assert.ok(claims);
  assert.equal(claims.ip, undefined);
});

test('rejects invalid ticket subjects', () => {
  const service = new TicketService(secret, 3600);
  assert.throws(() => service.issue({ playerId: 'not-a-player', playerName: 'Player' }));
  assert.throws(() => service.issue({ playerId: subject.playerId, playerName: 'bad\nname' }));
});

test('rejects tampered ticket names', () => {
  const service = new TicketService(secret, 3600);
  const issued = service.issue(subject, '203.0.113.7', 1_000);
  const parts = issued.ticket.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  claims.name = 'Impostor';
  parts[1] = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  assert.equal(service.verify(parts.join('.'), 1_001), null);
});

test('rejects tampered signatures', () => {
  const service = new TicketService(secret, 3600);
  const issued = service.issue(subject, '203.0.113.7', 1_000);
  const parts = issued.ticket.split('.');
  const signature = Buffer.from(parts[2], 'base64url');
  signature[signature.length - 1] ^= 1;
  parts[2] = signature.toString('base64url');
  assert.equal(service.verify(parts.join('.'), 1_001), null);
});

test('rejects non-canonical base64url signature encodings', () => {
  const service = new TicketService(secret, 3600);
  const issued = service.issue(subject, '203.0.113.7', 1_000);
  const parts = issued.ticket.split('.');
  const raw = Buffer.from(parts[2], 'base64url');
  const mutated = Buffer.from(raw);
  mutated[mutated.length - 1] ^= 1;
  parts[2] = mutated.toString('base64url');
  assert.equal(service.verify(parts.join('.'), 1_001), null);
});

test('consumes a ticket exactly once', () => {
  const service = new TicketService(secret, 3600);
  const issued = service.issue(subject, undefined, 1_000);
  assert.ok(service.consume(issued.ticket, 1_001));
  assert.equal(service.consume(issued.ticket, 1_001), null);
  const replacement = service.issue(subject, undefined, 1_002);
  assert.ok(service.consume(replacement.ticket, 1_003));
});

test('websocket authentication consumes a ticket exactly once', async () => {
  const service = new TicketService(secret, 3600);
  const auth = new TicketAuth(service, 'arena');
  const issued = service.issue(subject);
  assert.ok(await auth.authenticate(issued.ticket));
  assert.equal(await auth.authenticate(issued.ticket), null);
});

test('rejects expired tickets', () => {
  const service = new TicketService(secret, 60);
  const issued = service.issue(subject, '203.0.113.7', 1_000);
  assert.equal(service.verify(issued.ticket, 1_060), null);
});

test('rejects weak secrets', () => {
  assert.throws(() => new TicketService('too-short', 3600));
});
