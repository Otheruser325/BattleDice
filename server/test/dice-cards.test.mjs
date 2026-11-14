import assert from 'node:assert/strict';
import test from 'node:test';
import { ArenaRoom } from '../dist/arena-room.js';
import { diceCatalog } from '../dist/combat/catalog.js';
import {
  DICE_CARD_OFFER_TURNS,
  DICE_CARD_RARITY_FALLBACKS,
  DICE_CARD_VALUES,
  applyDiceCardToState,
  canOfferDiceCards,
  getDiceCardFireSupportBonus,
  getDiceCardFountainRate,
  getDiceCardGiantHunterBonus,
  getDiceCardManaPotionGain,
  getDiceCardOffenseMultiplier,
  getDiceCardRarityRoll,
  getDiceCardReduction,
  getDiceCardTypeUpgradeRate,
  getDiceCardMagnitude,
  rollDiceCards
} from '../dist/combat/dice-cards.js';
import { createCombatSetup, resolveCombat, rollPips } from '../dist/combat/engine.js';

const loadout = ['Fire', 'Ice', 'Poison', 'Electric', 'Wind'].map((typeId) => ({
  typeId,
  classLevel: 5,
  talentIndex: null
}));
const rules = { useLevelling: true, turnLimit: 10, randomMode: true, randomModifier: 'DiceCard' };
const seed = 'dice-card-test-seed';
const getDefinition = (typeId) => diceCatalog.get(typeId);
const makeCard = (kind, rarity = 'Gold', typeId) => ({
  key: `${typeId ?? kind}:${rarity}`,
  title: typeId ? `${typeId} Upgrade` : kind,
  rarity,
  kind,
  ...(typeId ? { typeId } : {})
});

function makeSetup() {
  const setup = createCombatSetup(loadout, loadout, diceCatalog, rules);
  rollPips(setup.state, seed, 1);
  return setup;
}

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

function makeRoom() {
  const logger = { info() {}, debug() {}, warning() {}, error() {} };
  const manager = { logging: { getLogger: () => logger } };
  const transport = { send() {}, kick() {} };
  const room = new ArenaRoom('arena', manager, transport);
  room.configure(roomOptions);
  return room;
}

test('Dice Card values and offer turns match the PvE rules', () => {
  assert.deepEqual(DICE_CARD_OFFER_TURNS, [2, 4, 6, 8, 10]);
  assert.deepEqual(DICE_CARD_VALUES.typeUpgradeRate, [0, 0.5, 0.75, 1]);
  assert.deepEqual(DICE_CARD_VALUES.fountainHealRate, [0, 0.1, 0.15, 0.2]);
  assert.deepEqual(DICE_CARD_VALUES.manaPotionGain, [0, 1, 2, 3]);
  assert.deepEqual(DICE_CARD_VALUES.spotlightRate, [0, 0.2, 0.3, 0.4]);
  assert.deepEqual(DICE_CARD_VALUES.giantHunterRate, [0, 0.01, 0.02, 0.03]);
  assert.deepEqual(DICE_CARD_VALUES.investmentDamage, [0, 0.2, 0.3, 0.4]);
  assert.deepEqual(DICE_CARD_VALUES.investmentReduction, [0, 0.1, 0.15, 0.2]);
  assert.deepEqual(DICE_CARD_VALUES.crowdDamage, [0, 0.2, 0.3, 0.4]);
  assert.deepEqual(DICE_CARD_VALUES.crowdReduction, [0, 0.1, 0.15, 0.2]);
  assert.deepEqual(DICE_CARD_VALUES.fireSupportAttacks, [0, 1, 2, 3]);
  assert.deepEqual(DICE_CARD_VALUES.vanguardReduction, [0, 0.2, 0.3, 0.4]);
  assert.deepEqual(DICE_CARD_VALUES.centrelineDamage, [0, 0.2, 0.4, 0.6]);
  assert.deepEqual(DICE_CARD_VALUES.straightFaceRate, [0, 0.2, 0.3, 0.4]);
  assert.deepEqual(DICE_CARD_VALUES.royalObedienceRate, [0, 0.3, 0.45, 0.6]);
  assert.deepEqual(DICE_CARD_RARITY_FALLBACKS, {
    Bronze: ['Bronze', 'Silver', 'Gold'],
    Silver: ['Silver', 'Bronze', 'Gold'],
    Gold: ['Gold', 'Silver', 'Bronze']
  });
  assert.equal(canOfferDiceCards(2, 0), true);
  assert.equal(canOfferDiceCards(2, 1), false);
  assert.equal(canOfferDiceCards(4, 1), true);
  assert.equal(canOfferDiceCards(10, 4), true);
  assert.equal(canOfferDiceCards(12, 5), false);
});

test('Dice Card rarity rolls and magnitudes use the PvE thresholds', () => {
  assert.equal(getDiceCardRarityRoll(() => 0), 'Bronze');
  assert.equal(getDiceCardRarityRoll(() => 0.599), 'Bronze');
  assert.equal(getDiceCardRarityRoll(() => 0.6), 'Silver');
  assert.equal(getDiceCardRarityRoll(() => 0.899), 'Silver');
  assert.equal(getDiceCardRarityRoll(() => 0.9), 'Gold');
  assert.equal(getDiceCardMagnitude('Bronze'), 1);
  assert.equal(getDiceCardMagnitude('Silver'), 2);
  assert.equal(getDiceCardMagnitude('Gold'), 3);
});

test('Dice Card draft pools are unique and include eligible type upgrades', () => {
  const setup = makeSetup();
  const cards = rollDiceCards(12, 'Bronze', 'player', setup.state.dice, getDefinition, new Set(), () => 0.999);
  assert.equal(cards.length, 12);
  assert.equal(new Set(cards.map((card) => card.key)).size, cards.length);
  assert.ok(cards.every((card) => card.rarity === 'Bronze' || card.rarity === 'Silver' || card.rarity === 'Gold'));
  assert.ok(cards.some((card) => card.kind === 'Type Upgrade' && card.typeId === 'Fire'));

  const excluded = new Set(cards.map((card) => card.key));
  const fallback = rollDiceCards(3, 'Bronze', 'player', setup.state.dice, getDefinition, excluded, () => 0);
  assert.ok(fallback.every((card) => !excluded.has(card.key)));
});

test('Type Upgrade and Straight Face rebuild max health like PvE', () => {
  const setup = makeSetup();
  const fire = setup.state.dice.find((die) => die.ownerId === 'player' && die.typeId === 'Fire');
  const ice = setup.state.dice.find((die) => die.ownerId === 'player' && die.typeId === 'Ice');
  assert.ok(fire);
  assert.ok(ice);
  const fireHealth = fire.maxHealth;
  const iceHealth = ice.maxHealth;

  applyDiceCardToState(setup.state, setup.definitions, 'player', makeCard('Type Upgrade', 'Gold', 'Fire'));
  assert.equal(fire.maxHealth, Math.floor(fireHealth * 2));
  assert.equal(fire.currentHealth, fireHealth + (fire.maxHealth - fireHealth));
  assert.equal(ice.maxHealth, iceHealth);

  applyDiceCardToState(setup.state, setup.definitions, 'player', makeCard('Straight Face', 'Gold'));
  const iceDefinition = setup.definitions.get(ice.instanceId);
  const belowLegendary = !['Legendary', 'Mythic'].includes(iceDefinition?.rarity ?? '');
  assert.equal(ice.maxHealth, belowLegendary ? Math.floor(iceHealth * 1.4) : iceHealth);
});

test('Dice Card combat stats apply offense, reduction, support, and Giant Hunter', () => {
  const setup = makeSetup();
  const die = setup.state.dice.find((candidate) => candidate.ownerId === 'player');
  assert.ok(die);
  const definition = setup.definitions.get(die.instanceId);
  die.pips = 3;
  die.gridPosition = { row: 0, col: 0 };
  applyDiceCardToState(setup.state, setup.definitions, 'player', makeCard('Spotlight', 'Gold'));
  applyDiceCardToState(setup.state, setup.definitions, 'player', makeCard('Fire Support', 'Gold'));
  applyDiceCardToState(setup.state, setup.definitions, 'player', makeCard('Vanguard', 'Gold'));
  applyDiceCardToState(setup.state, setup.definitions, 'player', makeCard('Giant Hunter', 'Gold'));
  applyDiceCardToState(setup.state, setup.definitions, 'player', makeCard('Mana Potion', 'Gold'));
  applyDiceCardToState(setup.state, setup.definitions, 'player', makeCard('Fountain of Love', 'Gold'));

  assert.ok(Math.abs(getDiceCardOffenseMultiplier(setup.state, die, definition) - 1.4) < 0.0001);
  assert.ok(Math.abs(getDiceCardReduction(setup.state, die) - 0.4) < 0.0001);
  assert.equal(getDiceCardFireSupportBonus(setup.state, die), 3);
  assert.equal(getDiceCardManaPotionGain(setup.state, 'player'), 3);
  assert.ok(Math.abs(getDiceCardFountainRate(setup.state, 'player') - 0.2) < 0.0001);
  assert.equal(getDiceCardGiantHunterBonus(setup.state, 'player', 1000, 1), 30);
  assert.equal(getDiceCardGiantHunterBonus(setup.state, 'player', 1000, 0.25), 7);
  assert.equal(getDiceCardTypeUpgradeRate(setup.state, die), 0);

  const vanguardDie = { ...die, gridPosition: { row: 0, col: 4 } };
  assert.ok(Math.abs(getDiceCardReduction(setup.state, vanguardDie) - 0.64) < 0.0001);
});

function makeCardCombatSetup(card, pips = 1) {
  const playerDefinition = {
    typeId: 'CardAttacker',
    title: 'CardAttacker',
    attack: 10,
    health: 100,
    range: 6,
    targetingMode: 'Nearest',
    rarity: 'Common',
    skills: [],
    accent: '#ffffff'
  };
  const enemyDefinition = {
    typeId: 'CardTarget',
    title: 'CardTarget',
    attack: 1,
    health: 1_000,
    range: 6,
    targetingMode: 'Nearest',
    rarity: 'Common',
    skills: [],
    accent: '#ffffff'
  };
  const definitions = new Map([
    [playerDefinition.typeId, playerDefinition],
    [enemyDefinition.typeId, enemyDefinition]
  ]);
  const catalog = { get: (typeId) => definitions.get(typeId) };
  const setup = createCombatSetup(
    [{ typeId: playerDefinition.typeId, classLevel: 1, talentIndex: null }],
    [{ typeId: enemyDefinition.typeId, classLevel: 1, talentIndex: null }],
    catalog,
    { ...rules, randomMode: false }
  );
  const player = setup.state.dice.find((die) => die.ownerId === 'player');
  const enemy = setup.state.dice.find((die) => die.ownerId === 'enemy');
  player.zone = 'board';
  player.gridPosition = { row: 0, col: 0 };
  player.pips = pips;
  enemy.zone = 'board';
  enemy.gridPosition = { row: 0, col: 0 };
  enemy.pips = 1;
  if (card) applyDiceCardToState(setup.state, setup.definitions, 'player', card);
  return { setup, catalog, player, enemy };
}

test('PvP combat applies Fire Support attacks and Fountain of Love healing', () => {
  const { setup, catalog, player } = makeCardCombatSetup(makeCard('Fire Support', 'Gold'));
  applyDiceCardToState(setup.state, setup.definitions, 'player', makeCard('Fountain of Love', 'Gold'));
  player.currentHealth = 50;

  const resolution = resolveCombat(setup.state, setup.definitions, { ...rules, randomMode: false }, seed, catalog);
  const playerAttacks = resolution.events.filter((event) => event.kind === 'attack' && event.ownerId === 'player');
  assert.equal(playerAttacks.length, 4);
  assert.ok(resolution.events.some((event) => event.kind === 'heal' && event.text.includes('Fountain of Love')));
  assert.equal(resolution.state.dice.find((die) => die.ownerId === 'player').currentHealth, 69);
});

test('PvP combat applies Spotlight damage to the next attack', () => {
  const { setup, catalog } = makeCardCombatSetup(makeCard('Spotlight', 'Gold'), 3);
  const resolution = resolveCombat(setup.state, setup.definitions, { ...rules, randomMode: false }, seed, catalog);
  const playerAttacks = resolution.events.filter((event) => event.kind === 'attack' && event.ownerId === 'player');
  assert.equal(playerAttacks.length, 3);
  assert.ok(playerAttacks.every((event) => event.amount >= 14));
});

test('PvP draft generation and picks use the authoritative card state', () => {
  const room = makeRoom();
  const setup = makeSetup();
  setup.state.turn = 2;
  const match = {
    id: 'm_card_test',
    players: [
      { playerId: 'p1', actorId: 'a1', name: 'One', loadout, rules },
      { playerId: 'p2', actorId: 'a2', name: 'Two', loadout, rules }
    ],
    rules,
    phase: 'placement',
    setup,
    diceCards: setup.state.diceCards,
    diceCardPicksUsed: 0,
    diceCardOffer: null,
    diceCardPicks: {},
    record: []
  };

  room.maybeOfferDiceCards(match);
  assert.ok(match.diceCardOffer);
  assert.equal(match.diceCardOffer.player.length, 3);
  assert.equal(match.diceCardOffer.enemy.length, 3);
  assert.equal(match.diceCardPicksUsed, 0);

  const selected = match.diceCardOffer.player[1];
  match.diceCardPicks.player = selected.key;
  room.applyDiceCardPicks(match);

  assert.equal(match.diceCardPicksUsed, 1);
  assert.equal(match.diceCardOffer, null);
  assert.equal(match.setup.state.diceCards.player.length, 1);
  assert.equal(match.setup.state.diceCards.enemy.length, 1);
  assert.equal(match.setup.state.diceCards.player[0].key, selected.key);
  assert.ok(match.record.some((line) => line.includes('picked')));
  room.handleDestroy();
});
