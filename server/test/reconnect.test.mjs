import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaRoom } from '../dist/arena-room.js';
import { TOPICS, encodeJson } from '../dist/protocol.js';

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

const loadout = ['Fire', 'Ice', 'Poison', 'Electric', 'Wind'].map((typeId) => ({
  typeId,
  classLevel: 5,
  talentIndex: null
}));

function joinRequest(mode = 'matchmaking') {
  return encodeJson({
    mode,
    ...(mode === 'multiplayer' ? { lobbyAction: 'create' } : {}),
    ruleset: 'classic',
    rules: {
      useLevelling: false,
      turnLimit: 10,
      randomMode: false,
      randomizeLoadout: false
    },
    loadout
  });
}

function makeCapturedRoom(overrides = {}) {
  const sent = [];
  const logger = { info() {}, debug() {}, warning() {}, error() {} };
  const manager = { logging: { getLogger: () => logger } };
  const transport = {
    send(actorId, topic, payload) {
      sent.push({ actorId, topic, payload: JSON.parse(new TextDecoder().decode(payload)) });
    },
    kick() {}
  };
  const room = new ArenaRoom('arena', manager, transport);
  room.configure({ ...roomOptions, maxActorsPerAddress: 8, ...overrides });
  return { room, sent };
}

function queuePlayers(room, first = 'player-1', second = 'player-2') {
  room.handleJoin('actor-1', actorData(first, 'One'));
  room.handleMessage('actor-1', TOPICS.matchmakingJoin, joinRequest());
  room.handleJoin('actor-2', actorData(second, 'Two'));
  room.handleMessage('actor-2', TOPICS.matchmakingJoin, joinRequest());
  return room.sessions.get(first).matchId;
}

function submitBoard(room, actorId, playerId, requestId) {
  const session = room.sessions.get(playerId);
  const match = room.matches.get(session.matchId);
  const selfIndex = match.players.findIndex((player) => player.playerId === playerId);
  const owner = selfIndex === 0 ? 'player' : 'enemy';
  const dice = match.setup.state.dice.filter((die) => die.ownerId === owner && !die.isDestroyed);
  const payload = {
    turn: match.setup.state.turn,
    requestId,
    dice: dice.map((die, index) => ({
      ownerId: 'player',
      instanceId: die.instanceId,
      typeId: die.typeId,
      gridPosition: { row: index, col: 4 }
    }))
  };
  room.handleMessage(actorId, TOPICS.turnSync, encodeJson(payload));
  return payload;
}

function latestTurn(sent, actorId) {
  return [...sent].reverse().find((entry) => entry.actorId === actorId && entry.topic === TOPICS.turnState)?.payload;
}

test('reconnect restores readiness while both players can still submit', () => {
  const { room, sent } = makeCapturedRoom();
  const matchId = queuePlayers(room);
  assert.ok(matchId);

  const firstRequest = submitBoard(room, 'actor-1', 'player-1', 'request-one-1');
  const firstWaiting = latestTurn(sent, 'actor-2');
  assert.equal(firstWaiting.status, 'waiting');
  assert.equal(firstWaiting.selfReady, false, 'the waiting opponent event must not mark the recipient ready');

  room.handleLeave('actor-2');
  room.handleJoin('actor-3', actorData('player-2', 'Two'));
  const opponentResume = latestTurn(sent, 'actor-3');
  // Resume uses the state topic, not the turn topic.
  const opponentSetup = [...sent].reverse().find((entry) => entry.actorId === 'actor-3' && entry.topic === TOPICS.multiplayerState)?.payload;
  assert.equal(opponentSetup?.status, 'matched');
  assert.equal(opponentSetup?.match?.selfReady, false, 'reconnect must not inherit the other player readiness');
  assert.equal(opponentResume, undefined);

  room.handleLeave('actor-1');
  room.handleJoin('actor-4', actorData('player-1', 'One'));
  const ownSetup = [...sent].reverse().find((entry) => entry.actorId === 'actor-4' && entry.topic === TOPICS.multiplayerState)?.payload;
  assert.equal(ownSetup?.status, 'matched');
  assert.equal(ownSetup?.match?.selfReady, true, 'reconnect must restore the local submitted state');

  submitBoard(room, 'actor-3', 'player-2', 'request-two-1');
  const firstResolved = latestTurn(sent, 'actor-4');
  const secondResolved = latestTurn(sent, 'actor-3');
  assert.equal(firstResolved.status, 'resolved');
  assert.equal(secondResolved.status, 'resolved');
  assert.equal(firstResolved.phase, 'placement');
  assert.equal(secondResolved.phase, 'placement');
  assert.equal(firstResolved.turn, firstRequest.turn + 1);
  assert.equal(secondResolved.requestId, 'request-two-1');
  room.handleDestroy();
});

test('a completed match is retained for a disconnected player and delivered on reconnect', () => {
  const { room, sent } = makeCapturedRoom();
  const matchId = queuePlayers(room);
  const match = room.matches.get(matchId);
  assert.ok(match);

  room.handleLeave('actor-2');
  for (const die of match.setup.state.dice) {
    if (die.ownerId === 'enemy') die.isDestroyed = true;
  }
  room.resolveMatch(match, false);

  assert.ok(room.matches.has(matchId), 'the result must survive while the opponent is disconnected');
  assert.equal(match.phase, 'complete');
  assert.equal(match.resultDelivered.has('player-2'), false);

  room.handleJoin('actor-3', actorData('player-2', 'Two'));
  const restored = [...sent].reverse().find((entry) => (
    entry.actorId === 'actor-3'
    && entry.topic === TOPICS.multiplayerState
    && entry.payload?.status === 'matched'
  ))?.payload;
  assert.equal(restored?.status, 'matched');
  assert.equal(restored?.match?.phase, 'complete');
  assert.equal(restored?.match?.result, 'defeat');
  assert.equal(room.sessions.get('player-2').matchId, null);
  room.handleDestroy();
});

test('a completed result survives the disconnected session grace window', async () => {
  const { room, sent } = makeCapturedRoom({ reconnectGraceMs: 10 });
  const matchId = queuePlayers(room);
  const match = room.matches.get(matchId);
  room.handleLeave('actor-2');
  for (const die of match.setup.state.dice) {
    if (die.ownerId === 'enemy') die.isDestroyed = true;
  }
  room.resolveMatch(match, false);
  await delay(30);

  assert.ok(room.sessions.has('player-2'));
  assert.ok(room.matches.has(matchId));
  room.handleJoin('actor-3', actorData('player-2', 'Two'));
  const restored = [...sent].reverse().find((entry) => (
    entry.actorId === 'actor-3'
    && entry.topic === TOPICS.multiplayerState
    && entry.payload?.status === 'matched'
  ))?.payload;
  assert.equal(restored?.match?.phase, 'complete');
  room.handleDestroy();
});

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

test('limits concurrent actors from one client address', () => {
  const kicked = [];
  const logger = { info() {}, debug() {}, warning() {}, error() {} };
  const manager = { logging: { getLogger: () => logger } };
  const transport = { send() {}, kick(actorId, reason) { kicked.push({ actorId, reason: reason.toString() }); } };
  const room = new ArenaRoom('arena', manager, transport);
  room.configure({ ...roomOptions, maxActorsPerAddress: 2 });
  const data = { ...actorData('player-1'), clientAddress: '198.51.100.7' };

  room.handleJoin('actor-1', data);
  room.handleJoin('actor-2', { ...data, playerId: 'player-2' });
  room.handleJoin('actor-3', { ...data, playerId: 'player-3' });

  assert.equal(room.actorPlayers.size, 2);
  assert.deepEqual(kicked, [{ actorId: 'actor-3', reason: 'address_limit' }]);
  room.handleDestroy();
});

test('a live session cannot be replaced from another address', () => {
  const kicked = [];
  const logger = { info() {}, debug() {}, warning() {}, error() {} };
  const manager = { logging: { getLogger: () => logger } };
  const transport = { send() {}, kick(actorId, reason) { kicked.push({ actorId, reason: reason.toString() }); } };
  const room = new ArenaRoom('arena', manager, transport);
  room.configure({ ...roomOptions, maxActorsPerAddress: 8 });
  const data = { ...actorData('player-1'), clientAddress: '198.51.100.7' };

  room.handleJoin('actor-1', data);
  room.handleJoin('actor-2', { ...data, clientAddress: '203.0.113.9' });
  assert.deepEqual(kicked, [{ actorId: 'actor-2', reason: 'session_address_mismatch' }]);

  room.handleLeave('actor-1');
  room.handleJoin('actor-3', { ...data, clientAddress: '203.0.113.9' });
  assert.equal(room.sessions.get('player-1').actorId, 'actor-3');
  room.handleDestroy();
});

test('cancelling matchmaking removes the queue entry and reports idle', () => {
  const { room, sent } = makeCapturedRoom();
  room.handleJoin('actor-1', actorData('player-1', 'One'));
  room.handleMessage('actor-1', TOPICS.matchmakingJoin, joinRequest());
  assert.equal(room.queue.length, 1);

  room.handleMessage('actor-1', TOPICS.matchmakingCancel, new Uint8Array());
  assert.equal(room.queue.length, 0);
  const state = [...sent].reverse().find((entry) => entry.actorId === 'actor-1' && entry.topic === TOPICS.matchmakingState)?.payload;
  assert.equal(state?.status, 'idle');
  room.handleDestroy();
});

test('leaving an active match forfeits it to the connected opponent', () => {
  const { room, sent } = makeCapturedRoom();
  queuePlayers(room);

  room.handleMessage('actor-1', TOPICS.multiplayerLeave, new Uint8Array());
  const result = latestTurn(sent, 'actor-2');
  assert.equal(result.status, 'resolved');
  assert.equal(result.phase, 'complete');
  assert.equal(result.result, 'victory');
  assert.match(result.message ?? '', /forfeited/);
  assert.equal(room.matches.size, 0);
  room.handleDestroy();
});

test('leaving a lobby closes it and reports idle', () => {
  const { room, sent } = makeCapturedRoom();
  room.handleJoin('actor-1', actorData('player-1', 'One'));
  room.handleMessage('actor-1', TOPICS.multiplayerCreate, joinRequest('multiplayer'));
  assert.equal(room.lobbies.size, 1);

  room.handleMessage('actor-1', TOPICS.multiplayerLeave, new Uint8Array());
  assert.equal(room.lobbies.size, 0);
  const state = [...sent].reverse().find((entry) => entry.actorId === 'actor-1' && entry.topic === TOPICS.multiplayerState)?.payload;
  assert.equal(state?.status, 'idle');
  assert.equal(room.sessions.get('player-1').lobbyCode, null);
  room.handleDestroy();
});
