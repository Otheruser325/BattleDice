import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeLobbyCode,
  normalizePlayerName,
  parseJoinRequest,
  parseTurnSync
} from '../dist/protocol.js';

const encoder = new TextEncoder();

function payload(value) {
  return encoder.encode(JSON.stringify(value));
}

const loadout = ['Fire', 'Ice', 'Poison', 'Electric', 'Wind'].map((typeId) => ({
  typeId,
  classLevel: 5,
  talentIndex: null
}));

const join = {
  mode: 'matchmaking',
  ruleset: 'classic',
  rules: {
    useLevelling: true,
    turnLimit: 10,
    randomMode: false
  },
  loadout
};

test('accepts a valid matchmaking request', () => {
  const result = parseJoinRequest(payload(join), 'matchmaking');
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.value, 'playerName'), false);
  assert.equal(result.value.rules.turnLimit, 10);
  assert.equal(result.value.loadout.length, 5);
  assert.equal(result.value.loadout[0].classLevel, 5);
});

test('ignores a client-supplied player name', () => {
  const result = parseJoinRequest(payload({ ...join, playerName: 'Impostor' }), 'matchmaking');
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.value, 'playerName'), false);
});

test('rejects malformed player names and duplicate loadout dice', () => {
  assert.equal(normalizePlayerName('bad\nname'), null);
  const result = parseJoinRequest(payload({
    ...join,
    loadout: [loadout[0], loadout[0], loadout[2], loadout[3], loadout[4]]
  }), 'matchmaking');
  assert.equal(result.ok, false);
});

test('rejects missing or malformed rules', () => {
  const missingRules = parseJoinRequest(payload({ ...join, rules: undefined }), 'matchmaking');
  assert.equal(missingRules.ok, false);
  const invalidRules = parseJoinRequest(payload({
    ...join,
    rules: { useLevelling: true, turnLimit: 0, randomMode: false }
  }), 'matchmaking');
  assert.equal(invalidRules.ok, false);
});

test('accepts random mode and loadout randomisation in PvP rules', () => {
  const result = parseJoinRequest(payload({
    ...join,
    rules: { ...join.rules, randomMode: true, randomizeLoadout: true }
  }), 'matchmaking');
  assert.equal(result.ok, true);
  assert.equal(result.value.rules.randomMode, true);
  assert.equal(result.value.rules.randomizeLoadout, true);
});

test('rejects a malformed loadout randomisation flag', () => {
  const result = parseJoinRequest(payload({
    ...join,
    rules: { ...join.rules, randomizeLoadout: 'yes' }
  }), 'matchmaking');
  assert.equal(result.ok, false);
});

test('normalizes only the client lobby alphabet', () => {
  assert.equal(normalizeLobbyCode('ab cdef'), null);
  assert.equal(normalizeLobbyCode('abcd2f'), 'ABCD2F');
  assert.equal(normalizeLobbyCode('ABCD1F'), null);
});

test('rejects duplicate board positions', () => {
  const result = parseTurnSync(payload({
    turn: 1,
    dice: [
      { ownerId: 'player', instanceId: 'a-1', typeId: 'Fire', gridPosition: { row: 0, col: 0 } },
      { ownerId: 'player', instanceId: 'a-2', typeId: 'Ice', gridPosition: { row: 0, col: 0 } }
    ]
  }));
  assert.equal(result.ok, false);
});

test('accepts a valid turn envelope', () => {
  const result = parseTurnSync(payload({
    turn: 1,
    dice: [{ ownerId: 'player', instanceId: 'a-1', typeId: 'Fire', gridPosition: { row: 0, col: 0 } }]
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.dice.length, 1);
  assert.equal(result.value.dice[0].instanceId, 'a-1');
});

test('accepts and echoes a turn request ID while rejecting malformed IDs', () => {
  const accepted = parseTurnSync(payload({
    turn: 1,
    requestId: 'req_abc12345',
    dice: [{ ownerId: 'player', instanceId: 'a-1', typeId: 'Fire', gridPosition: { row: 0, col: 0 } }]
  }));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.requestId, 'req_abc12345');

  for (const requestId of ['short', 'bad id with spaces', 42]) {
    assert.equal(parseTurnSync(payload({
      turn: 1,
      requestId,
      dice: [{ ownerId: 'player', instanceId: 'a-1', typeId: 'Fire', gridPosition: { row: 0, col: 0 } }]
    })).ok, false);
  }
});

test('accepts a Dice Card selection on the turn envelope and rejects malformed keys', () => {
  const accepted = parseTurnSync(payload({
    turn: 2,
    dice: [{ ownerId: 'player', instanceId: 'a-1', typeId: 'Fire', gridPosition: { row: 0, col: 0 } }],
    diceCardKey: 'Spotlight:Gold'
  }));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.value.diceCardKey, 'Spotlight:Gold');

  assert.equal(parseTurnSync(payload({
    turn: 2,
    dice: [{ ownerId: 'player', instanceId: 'a-1', typeId: 'Fire', gridPosition: { row: 0, col: 0 } }],
    diceCardKey: 'bad\nkey'
  })).ok, false);
  assert.equal(parseTurnSync(payload({
    turn: 2,
    dice: [{ ownerId: 'player', instanceId: 'a-1', typeId: 'Fire', gridPosition: { row: 0, col: 0 } }],
    diceCardKey: 42
  })).ok, false);
});

test('rejects turn submissions for the opponent or without an instance id', () => {
  assert.equal(parseTurnSync(payload({
    turn: 1,
    dice: [{ ownerId: 'enemy', instanceId: 'a-1', typeId: 'Fire', gridPosition: { row: 0, col: 0 } }]
  })).ok, false);
  assert.equal(parseTurnSync(payload({
    turn: 1,
    dice: [{ ownerId: 'player', typeId: 'Fire', gridPosition: { row: 0, col: 0 } }]
  })).ok, false);
});
