import assert from 'node:assert/strict';
import test from 'node:test';
import { diceCatalog } from '../dist/combat/catalog.js';
import {
  applyBoard,
  autoPlaceBoard,
  createCombatSetup,
  getPipMap,
  rollPips,
  resolveCombat,
  toClientState
} from '../dist/combat/engine.js';

const loadout = ['Fire', 'Ice', 'Poison', 'Electric', 'Wind'].map((typeId) => ({
  typeId,
  classLevel: 5,
  talentIndex: null
}));

const rules = { useLevelling: true, turnLimit: 10, randomMode: false };
const seed = 'test-combat-seed';

function makeSetup() {
  const setup = createCombatSetup(loadout, loadout, diceCatalog, rules);
  rollPips(setup.state, seed, 1);
  autoPlaceBoard(setup.state, setup.definitions, 'player', seed, 1);
  autoPlaceBoard(setup.state, setup.definitions, 'enemy', seed, 1);
  return setup;
}

test('auto-placement uses valid non-overlapping positions for every die', () => {
  const setup = makeSetup();
  for (const ownerId of ['player', 'enemy']) {
    const dice = setup.state.dice.filter((die) => die.ownerId === ownerId && !die.isDestroyed);
    assert.equal(dice.length, 5);
    assert.ok(dice.every((die) => die.zone === 'board'));
    assert.equal(new Set(dice.map((die) => `${die.gridPosition.row}:${die.gridPosition.col}`)).size, 5);
  }
});

test('server combat resolves deterministically and returns survivors to hand', () => {
  const first = makeSetup();
  const second = makeSetup();
  const left = resolveCombat(first.state, first.definitions, rules, seed, diceCatalog);
  const right = resolveCombat(second.state, second.definitions, rules, seed, diceCatalog);

  assert.deepEqual(left.state, right.state);
  assert.deepEqual(left.events, right.events);
  assert.equal(left.state.turn, 2);
  assert.ok(left.events.length > 0);
  assert.ok(left.state.dice.filter((die) => !die.isDestroyed).every((die) => (
    die.zone === 'hand' && die.gridPosition === undefined
  )));
});

test('rejected boards do not mutate the authoritative state', () => {
  const setup = makeSetup();
  const before = structuredClone(setup.state);
  const submissions = setup.state.dice
    .filter((die) => die.ownerId === 'player' && !die.isDestroyed)
    .map((die) => ({
      instanceId: die.instanceId,
      typeId: die.typeId,
      row: die.gridPosition?.row ?? 0,
      col: die.gridPosition?.col ?? 0
    }));
  const last = submissions[submissions.length - 1];
  last.row = 99;

  assert.equal(
    applyBoard(setup.state, setup.definitions, 'player', submissions),
    'Board contains an invalid position.'
  );
  assert.deepEqual(setup.state, before);
});

test('placement snapshots redact the opponent board and pips', () => {
  const setup = makeSetup();
  const own = toClientState(setup.state, setup.definitions, 'player', false);
  assert.equal(own.dice.length, 5);
  assert.ok(own.dice.every((die) => die.ownerId === 'player'));
  assert.deepEqual(Object.keys(getPipMap(setup.state, 'player', false)).sort(), own.dice.map((die) => die.instanceId).sort());

  const enemy = toClientState(setup.state, setup.definitions, 'enemy', false);
  assert.equal(enemy.dice.length, 5);
  assert.ok(enemy.dice.every((die) => die.ownerId === 'player'));
});

test('server attack records precede their damage records', () => {
  const setup = makeSetup();
  const resolution = resolveCombat(setup.state, setup.definitions, rules, seed, diceCatalog);
  const firstAttack = resolution.events.findIndex((event) => event.kind === 'attack');
  const firstDamage = resolution.events.findIndex((event) => event.kind === 'damage');
  assert.ok(firstAttack >= 0);
  assert.ok(firstDamage >= 0);
  assert.ok(firstAttack < firstDamage);
});

test('server combat eventually declares a winner or draw within the turn limit', () => {
  const setup = makeSetup();
  const setupRules = { ...rules, turnLimit: 10 };
  let state = setup.state;
  let result;
  for (let turn = 0; turn < 11; turn += 1) {
    rollPips(state, seed, state.turn);
    autoPlaceBoard(state, setup.definitions, 'player', seed, state.turn);
    autoPlaceBoard(state, setup.definitions, 'enemy', seed, state.turn);
    const resolution = resolveCombat(state, setup.definitions, setupRules, seed, diceCatalog);
    state = resolution.state;
    if (resolution.result) {
      result = resolution.result;
      break;
    }
  }
  assert.ok(result === 'victory' || result === 'defeat' || result === 'draw');
});
