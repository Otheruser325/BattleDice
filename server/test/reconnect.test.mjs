import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaRoom } from '../dist/arena-room.js';

const roomOptions = {
  maxActors: 16,
  maxQueue: 8,
  maxLobbies: 8,
  maxMatches: 8,
  queueTtlMs: 60_000,
  lobbyTtlMs: 60_000,
  matchTtlMs: 60_000,
  reconnectGraceMs: 25,
  actionLimit: 100,
  actionWindowMs: 60_000,
  lobbyJoinLimit: 100,
  lobbyJoinWindowMs: 60_000
};

function makeRoom(reconnectGraceMs = roomOptions.reconnectGraceMs) {
  const logger = {
    info() {},
    debug() {},
    warning() {},
    error() {}
  };
  const manager = {
    logging: {
      getLogger: () => logger
    }
  };
  const transport = {
    send() {},
    kick() {}
  };
  const room = new ArenaRoom('arena', manager, transport);
  room.configure({ ...roomOptions, reconnectGraceMs });
  return room;
}

function actorData(playerId, playerName = 'Player') {
  return {
    playerId,
    playerName,
    ticketId: `ticket-${playerId}`
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('a disconnected session stays resumable during the reconnect grace window', () => {
  const room = makeRoom();
  room.handleJoin('actor-1', actorData('player-1'));
  room.handleLeave('actor-1');

  assert.ok(room.sessions.has('player-1'));
  assert.equal(room.sessions.get('player-1').actorId, 'actor-1');

  room.handleJoin('actor-2', actorData('player-1'));
  assert.equal(room.sessions.get('player-1').actorId, 'actor-2');
  assert.equal(room.actorCount, 1);
  room.handleDestroy();
});

test('an abandoned session is removed after the reconnect grace window', async () => {
  const room = makeRoom(10);
  room.handleJoin('actor-1', actorData('player-1'));
  room.handleLeave('actor-1');

  await delay(40);
  assert.equal(room.sessions.has('player-1'), false);
  room.handleDestroy();
});
