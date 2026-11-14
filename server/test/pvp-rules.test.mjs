import assert from 'node:assert/strict';
import test from 'node:test';
import { diceCatalog } from '../dist/combat/catalog.js';
import {
  PVP_RANDOM_MODIFIERS,
  createRandomPvpLoadout,
  isPvPTypeIdAllowed,
  normalizePvpLoadout,
  normalizePvpRules
} from '../dist/pvp-rules.js';

test('PvP rejects boss and exclusive dice while accepting the standard pool', () => {
  assert.equal(isPvPTypeIdAllowed('Fire'), true);
  assert.equal(diceCatalog.isExclusive('Basilisk'), true);
  assert.equal(isPvPTypeIdAllowed('Basilisk'), false);
  assert.equal(isPvPTypeIdAllowed('Imp'), false);
});

test('PvP discards client progression unless the server randomises the loadout', () => {
  assert.deepEqual(
    normalizePvpLoadout([{ typeId: 'Fire', classLevel: 15, talentIndex: 3 }]),
    [{ typeId: 'Fire', classLevel: 1, talentIndex: null }]
  );
  assert.deepEqual(
    normalizePvpRules({ useLevelling: true, turnLimit: 10, randomMode: false }),
    { useLevelling: false, turnLimit: 10, randomMode: false, randomizeLoadout: false }
  );
  assert.deepEqual(
    normalizePvpRules({ useLevelling: false, turnLimit: 10, randomMode: true, randomizeLoadout: true }),
    { useLevelling: true, turnLimit: 10, randomMode: true, randomizeLoadout: true }
  );
});

test('PvP random-mode roster matches the PvE modifier set', () => {
  assert.deepEqual(
    [...PVP_RANDOM_MODIFIERS].sort(),
    ['Classic', 'Combanity', 'DiceCard', 'Duality', 'Necromancy'].sort()
  );
});

test('server-created PvP loadouts use five unique legal dice and class levels', () => {
  const loadout = createRandomPvpLoadout(true);
  assert.equal(loadout.length, 5);
  assert.equal(new Set(loadout.map((entry) => entry.typeId)).size, 5);
  assert.ok(loadout.every((entry) => isPvPTypeIdAllowed(entry.typeId)));
  assert.ok(loadout.every((entry) => entry.classLevel >= 1 && entry.classLevel <= 15));
  assert.ok(loadout.every((entry) => entry.talentIndex === null));
});
