import assert from 'node:assert/strict';
import test from 'node:test';
import { createCombatSetup, resolveCombat } from '../dist/combat/engine.js';

const rules = { useLevelling: false, turnLimit: 10, randomMode: false };

function definition(typeId, overrides = {}) {
  return {
    typeId,
    title: typeId,
    attack: 10,
    health: 100,
    range: 6,
    targetingMode: 'Nearest',
    rarity: 'Common',
    accent: '#ffffff',
    skills: [],
    ...overrides
  };
}

function setup(playerDefinitions, enemyDefinitions, extraDefinitions = [], setupRules = rules) {
  const definitions = new Map([...playerDefinitions, ...enemyDefinitions, ...extraDefinitions].map((entry) => [entry.typeId, entry]));
  const catalog = { get: (typeId) => definitions.get(typeId) };
  const combat = createCombatSetup(
    playerDefinitions.map((entry) => ({ typeId: entry.typeId, classLevel: entry.classLevel ?? 1, talentIndex: null })),
    enemyDefinitions.map((entry) => ({ typeId: entry.typeId, classLevel: entry.classLevel ?? 1, talentIndex: null })),
    catalog,
    setupRules
  );
  const playerPositions = [
    { row: 1, col: 4 },
    { row: 0, col: 4 }
  ];
  const enemyPositions = [{ row: 1, col: 0 }];
  const playerDice = combat.state.dice.filter((die) => die.ownerId === 'player');
  const enemyDice = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  playerDice.forEach((die, index) => {
    die.pips = 1;
    die.zone = 'board';
    die.gridPosition = playerPositions[index] ?? { row: 0, col: 0 };
  });
  enemyDice.forEach((die, index) => {
    die.pips = 1;
    die.zone = 'board';
    die.gridPosition = enemyPositions[index] ?? { row: 0, col: 4 };
  });
  return { combat, catalog };
}

function resolve(combat, catalog, resolveRules = rules) {
  return resolveCombat(combat.state, combat.definitions, resolveRules, 'parity-seed', catalog);
}

test('on-damaged skills fire through shields and apply status', () => {
  const player = definition('Attacker');
  const enemy = definition('Plated', {
    attack: 1,
    skills: [{
      type: 'OnDamaged',
      title: 'Heavy Plating',
      description: '',
      modifiers: { shield: 20, statusEffect: 'slow', statusDuration: 2 }
    }]
  });
  const { combat, catalog } = setup([player], [enemy]);
  combat.state.dice.find((die) => die.ownerId === 'enemy').shieldHp = 100;
  const resolution = resolve(combat, catalog);
  const target = resolution.state.dice.find((die) => die.typeId === 'Plated');
  assert.ok(resolution.events.some((event) => event.kind === 'status'));
  assert.ok(resolution.events.some((event) => event.kind === 'shield'));
  assert.ok(target.shieldHp >= 20);
});

test('on-death damage and on-kill state persist in the authoritative result', () => {
  const player = definition('Executioner', {
    attack: 500,
    skills: [{
      type: 'OnKill',
      title: 'Aftermath',
      description: '',
      modifiers: { onKillDamage: 7, grantAttacksToAlly: 1 }
    }]
  });
  const enemy = definition('Fragile', {
    health: 10,
    skills: [{
      type: 'OnDeath',
      title: 'Last Rattle',
      description: '',
      modifiers: { deathDamage: 5 }
    }]
  });
  const { combat, catalog } = setup([player], [enemy]);
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.ownerId === 'player');
  assert.equal(survivor.currentHealth, 95);
  assert.equal(survivor.mana.onKillDamage, 7);
  assert.equal(survivor.attacksRemaining, 0);
  assert.ok(resolution.events.some((event) => event.kind === 'defeat'));
});

test('combat-start mana gain, foe gain, and steal update active charges', () => {
  const player = definition('Channeler', {
    skills: [
      {
        type: 'CombatStart',
        title: 'Charge',
        description: '',
        modifiers: { manaGain: 2, allyManaGain: 1, foeManaGain: 1, manaSteal: 1 }
      },
      { type: 'Active', title: 'Shift', description: '', manaNeeded: 5, modifiers: {} }
    ]
  });
  const enemy = definition('Target', {
    attack: 1,
    skills: [{ type: 'Active', title: 'Bolt', description: '', manaNeeded: 5, modifiers: {} }]
  });
  const { combat, catalog } = setup([player], [enemy]);
  combat.state.dice.find((die) => die.ownerId === 'enemy').mana['Bolt:0'] = 3;
  const resolution = resolve(combat, catalog);
  const caster = resolution.state.dice.find((die) => die.typeId === 'Channeler');
  assert.equal(caster.mana['Shift:0'], 4);
});

test('attack grants never target their own source', () => {
  const executioner = definition('Executioner', {
    attack: 500,
    skills: [{
      type: 'OnKill',
      title: 'Spoils',
      description: '',
      modifiers: { grantAttacksToAlly: 1 }
    }]
  });
  const ally = definition('Ally', { attack: 1 });
  const fragile = definition('Fragile', { health: 10 });
  const { combat, catalog } = setup([executioner, ally], [fragile]);
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('grants 1 attack to Ally')
  )));
  assert.ok(!resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('grants 1 attack to Executioner')
  )));
});

test('combat-start grants in a second CombatStart skill still fire', () => {
  const light = definition('Light', {
    attack: 1,
    skills: [
      {
        type: 'CombatStart',
        title: 'Radiant Rally',
        description: '',
        modifiers: { allyExtraAttacks: 1 }
      },
      {
        type: 'CombatStart',
        title: "Heaven's Gift",
        description: '',
        modifiers: { grantAttacksToAlly: 1 }
      }
    ]
  });
  const ally = definition('Ally', { attack: 1 });
  const enemy = definition('Enemy', { attack: 1 });
  const { combat, catalog } = setup([light, ally], [enemy]);
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('grants 1 attack to Ally')
  )));
});

test('non-combat-start attack grants do not leak into combat start', () => {
  const executioner = definition('Executioner', {
    attack: 100,
    skills: [{
      type: 'OnKill',
      title: 'Backlash',
      description: '',
      modifiers: { grantAttacksToFoe: 1 }
    }]
  });
  const durable = definition('Durable', { health: 1_000, attack: 1 });
  const { combat, catalog } = setup([executioner], [durable]);
  const resolution = resolve(combat, catalog);

  assert.ok(!resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('grants 1 attack')
  )));
});

test('heal-on-attack targets a damaged ally instead of an enemy', () => {
  const healer = definition('Healer', {
    attack: 10,
    skills: [{
      type: 'Passive',
      title: 'Druidic Essence',
      description: '',
      modifiers: { healOnAttack: true, skillTargeting: 'Weakest' }
    }]
  });
  const ally = definition('Wounded', { health: 100 });
  const enemy = definition('Raider', { attack: 1 });
  const { combat, catalog } = setup([healer, ally], [enemy]);
  const wounded = combat.state.dice.find((die) => die.typeId === 'Wounded');
  wounded.currentHealth = 50;
  const resolution = resolve(combat, catalog);
  const healed = resolution.state.dice.find((die) => die.typeId === 'Wounded');
  assert.ok(healed.currentHealth > 50);
  assert.ok(resolution.events.some((event) => event.kind === 'attack' && event.text.includes('heals')));
});

test('transform active fires its on-transformed damage hook', () => {
  const player = definition('Shapeshifter', {
    attack: 1,
    skills: [{
      type: 'Active',
      title: 'Shift',
      description: '',
      manaNeeded: 1,
      modifiers: { transformToNextForm: true, consumeAttack: false }
    }],
    transformStats: [{
      title: 'Beast',
      attack: 5,
      health: 100,
      recoveryRate: 0,
      skills: [{
        type: 'OnTransformed',
        title: 'Maul',
        description: '',
        modifiers: { transformAttackDamage: 25 }
      }]
    }]
  });
  const enemy = definition('Dummy', { attack: 1, health: 100 });
  const { combat, catalog } = setup([player], [enemy]);
  combat.state.dice.find((die) => die.ownerId === 'player').mana['Shift:0'] = 1;
  const resolution = resolve(combat, catalog);
  const target = resolution.state.dice.find((die) => die.ownerId === 'enemy');
  assert.ok(target.currentHealth < 100);
  assert.ok(resolution.events.some((event) => event.text.includes('transforms into Beast')));
});

test('attack grants honor the granting skill targeting mode', () => {
  const executioner = definition('Executioner', {
    attack: 500,
    skills: [{
      type: 'OnKill',
      title: 'Spoils',
      description: '',
      modifiers: { grantAttacksToAlly: 1, skillTargeting: 'Strongest' }
    }]
  });
  const strong = definition('Strong', { attack: 1, health: 200 });
  const weak = definition('Weak', { attack: 1, health: 200 });
  const fragile = definition('Fragile', { attack: 1, health: 10 });
  const { combat, catalog } = setup([executioner, strong, weak], [fragile]);
  combat.state.dice.find((die) => die.typeId === 'Weak').currentHealth = 20;
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('grants 1 attack to Strong')
  )));
  assert.ok(!resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('grants 1 attack to Weak')
  )));
});

test('same-type passive skills contribute to the same trigger', () => {
  const twin = definition('TwinPassive', {
    attack: 10,
    health: 1_000,
    skills: [
      { type: 'Passive', title: 'Foe Gift', description: '', modifiers: { grantAttacksToFoe: 1 } },
      { type: 'Passive', title: 'Ally Gift', description: '', modifiers: { grantAttacksToAlly: 1 } }
    ]
  });
  const ally = definition('Ally', { attack: 1, health: 1_000 });
  const enemy = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([twin, ally], [enemy]);
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('grants 1 attack to Ally')
  )));
});

test('locked trigger skills stay inactive below their class requirement', () => {
  const executioner = definition('LockedExecutioner', {
    attack: 500,
    skills: [{
      type: 'OnKill',
      title: 'Locked Spoils',
      description: '',
      modifiers: { onKillDamage: 7, unlockAtClass: 6 }
    }]
  });
  const fragile = definition('Fragile', { health: 10, attack: 1 });
  const { combat, catalog } = setup([executioner], [fragile]);
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.ownerId === 'player');

  assert.equal(survivor.mana.onKillDamage, undefined);
});

test('locked active slots stay unavailable below their class requirement', () => {
  const caster = definition('LockedCaster', {
    attack: 1,
    health: 1_000,
    skills: [
      {
        type: 'Active',
        title: 'Waiting',
        description: '',
        manaNeeded: 2,
        modifiers: {}
      },
      {
        type: 'Active',
        title: 'Locked',
        description: '',
        manaNeeded: 1,
        modifiers: { activeDamage: 1, unlockAtClass: 6 }
      }
    ]
  });
  const target = definition('Dummy', { health: 1_000, attack: 1 });
  const { combat, catalog } = setup([caster], [target]);
  combat.state.dice.find((die) => die.typeId === 'LockedCaster').mana['Locked:1'] = 1;
  const resolution = resolve(combat, catalog);

  assert.ok(!resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('uses Locked')
  )));
});

test('meteor uses its plus pattern for damage and lava', () => {
  const meteor = definition('Meteor', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Active',
      title: 'Bomb',
      description: '',
      manaNeeded: 1,
      modifiers: {
        hasMeteor: true,
        meteorDamage: 120,
        lavaDamage: 50,
        meteorCount: 1,
        statusDuration: 3,
        lavaPoolPattern: [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
      }
    }]
  });
  const first = definition('First', { attack: 1, health: 1_000 });
  const second = definition('Second', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([meteor], [first, second]);
  combat.state.dice.find((die) => die.typeId === 'Meteor').mana['Bomb:0'] = 1;
  const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  enemies[0].gridPosition = { row: 2, col: 2 };
  enemies[1].gridPosition = { row: 2, col: 3 };
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.state.dice.find((die) => die.typeId === 'First').currentHealth < 1_000);
  assert.ok(resolution.state.dice.find((die) => die.typeId === 'Second').currentHealth < 1_000);
  assert.equal(resolution.state.lavaPools.length, 5);
});

test('random meteor orientation is tile-based and still lays patterned lava', () => {
  const meteor = definition('Meteor', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Active',
      title: 'Bomb',
      description: '',
      manaNeeded: 1,
      modifiers: {
        hasMeteor: true,
        meteorDamage: 120,
        lavaDamage: 50,
        meteorCount: 1,
        meteorRandomOrientation: true,
        statusDuration: 3,
        lavaPoolPattern: [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
      }
    }]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([meteor], [target]);
  combat.state.dice.find((die) => die.typeId === 'Meteor').mana['Bomb:0'] = 1;
  combat.state.dice.find((die) => die.typeId === 'Target').gridPosition = { row: 2, col: 2 };
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.state.lavaPools.length >= 3);
  assert.ok(resolution.state.lavaPools.every((pool) => pool.damage === 50));
});

test('active status effects use activeSkillTargeting', () => {
  const controller = definition('Controller', {
    attack: 1,
    skills: [{
      type: 'Active',
      title: 'Slow',
      description: '',
      manaNeeded: 1,
      modifiers: { statusEffect: 'slow', statusDuration: 1, activeSkillTargeting: 'Weakest' }
    }]
  });
  const sturdy = definition('Sturdy', { attack: 1, health: 100 });
  const frail = definition('Frail', { attack: 1, health: 40 });
  const middle = definition('Middle', { attack: 1, health: 70 });
  const { combat, catalog } = setup([controller], [sturdy, frail, middle]);
  combat.state.dice.find((die) => die.typeId === 'Controller').mana['Slow:0'] = 1;
  const frailDie = combat.state.dice.find((die) => die.typeId === 'Frail');
  const resolution = resolve(combat, catalog);
  const statusEvent = resolution.events.find((event) => event.kind === 'status' && event.text.includes('slow'));

  assert.ok(statusEvent);
  assert.equal(statusEvent.targetId, frailDie.instanceId);
});

test('splash damage requires the hasSplash flag', () => {
  const run = (hasSplash) => {
    const player = definition('Splasher', {
      attack: 1,
      health: 1_000,
      skills: [{
        type: 'Passive',
        title: 'Splash',
        description: '',
        modifiers: { splashDamage: 40, ...(hasSplash ? { hasSplash: true } : {}) }
      }]
    });
    const target = definition('Target', { attack: 1, health: 1_000 });
    const bystander = definition('Bystander', { attack: 1, health: 1_000 });
    const { combat, catalog } = setup([player], [target, bystander]);
    const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
    enemies[0].gridPosition = { row: 2, col: 2 };
    enemies[1].gridPosition = { row: 2, col: 3 };
    const resolution = resolve(combat, catalog);
    return resolution.state.dice
      .filter((die) => die.ownerId === 'enemy')
      .reduce((total, die) => total + die.currentHealth, 0);
  };

  assert.ok(run(false) >= 1_999);
  assert.ok(run(true) <= 1_962);
});

test('chain damage requires the hasChain flag', () => {
  const run = (hasChain) => {
    const player = definition('Chainer', {
      attack: 1,
      health: 1_000,
      skills: [{
        type: 'Passive',
        title: 'Chain',
        description: '',
        modifiers: { chainDamage: 40, chainRange: 2, ...(hasChain ? { hasChain: true } : {}) }
      }]
    });
    const target = definition('Target', { attack: 1, health: 1_000 });
    const bystander = definition('Bystander', { attack: 1, health: 1_000 });
    const { combat, catalog } = setup([player], [target, bystander]);
    const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
    enemies[0].gridPosition = { row: 2, col: 2 };
    enemies[1].gridPosition = { row: 2, col: 4 };
    const resolution = resolve(combat, catalog);
    return resolution.state.dice
      .filter((die) => die.ownerId === 'enemy')
      .reduce((total, die) => total + die.currentHealth, 0);
  };

  assert.ok(run(false) >= 1_999);
  assert.ok(run(true) <= 1_962);
});

test('meteor metadata without hasMeteor does not fire', () => {
  const meteor = definition('Meteor', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Active',
      title: 'Bomb',
      description: '',
      manaNeeded: 1,
      modifiers: {
        meteorDamage: 120,
        meteorCount: 1,
        statusDuration: 3,
        lavaPoolPattern: [[0, 0]]
      }
    }]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([meteor], [target]);
  combat.state.dice.find((die) => die.typeId === 'Meteor').mana['Bomb:0'] = 1;
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'Target');
  assert.equal(survivor.currentHealth, 1_000);
  assert.equal(resolution.state.lavaPools.length, 0);
});

test('permanent growth requires the hasGrowth flag', () => {
  const run = (hasGrowth) => {
    const grower = definition('Grower', {
      attack: 1,
      health: 1_000,
      skills: [{
        type: 'CombatEnd',
        title: 'Grow',
        description: '',
        modifiers: { growthDelta: 1, ...(hasGrowth ? { hasGrowth: true } : {}) }
      }]
    });
    const target = definition('Target', { attack: 1, health: 1_000 });
    const { combat, catalog } = setup([grower], [target]);
    const resolution = resolve(combat, catalog);
    return resolution.state.dice.find((die) => die.typeId === 'Grower').growth;
  };

  assert.equal(run(false), 0);
  assert.equal(run(true), 1);
});

test('infiltrators teleport adjacent to the furthest foe and strike first', () => {
  const assassin = definition('Assassin', {
    attack: 10,
    health: 1_000,
    range: 1,
    skills: [{
      type: 'CombatStart',
      title: 'Backline Breach',
      description: '',
      modifiers: { isInfiltrator: true, teleportRange: -1, strikeFirst: true }
    }]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([assassin], [target]);
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'Target');

  assert.ok(resolution.events.some((event) => event.text.includes('infiltrates')));
  assert.ok(survivor.currentHealth < 1_000);
});

test('Mighty Roar teleports, executes Furious Claw, and stuns when no target is in range', () => {
  const leon = definition('Leon', {
    attack: 40,
    health: 1_000,
    range: 1,
    skills: [
      {
        type: 'Passive',
        title: 'Furious Claw',
        description: '',
        modifiers: { attackCountIncrease: 1, criticalChanceIncrease: 0.2, skillRangeThreshold: 2 }
      },
      {
        type: 'Passive',
        title: 'Mighty Roar',
        description: '',
        modifiers: { statusEffect: 'stun', stunDuration: 2, teleportSkillFireIndex: 0 }
      }
    ]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([leon], [target]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const enemy = combat.state.dice.find((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 2, col: 4 };
  enemy.gridPosition = { row: 2, col: 2 };
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'Target');

  assert.ok(resolution.events.some((event) => event.text.includes('roars')));
  assert.ok(survivor.currentHealth < 1_000);
  assert.ok(survivor.stunTurns > 0);
});

test('beam attacks strike the perpendicular line through the target', () => {
  const beam = definition('Beam', {
    attack: 5,
    health: 1_000,
    range: 6,
    skills: [{
      type: 'Passive',
      title: 'Perpendicular Beam',
      description: '',
      modifiers: { hasBeam: true, beamDamage: 20 }
    }]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const line = definition('Line', { attack: 1, health: 1_000 });
  const offLine = definition('OffLine', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([beam], [target, line, offLine]);
  const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  enemies[0].gridPosition = { row: 2, col: 2 };
  enemies[1].gridPosition = { row: 1, col: 2 };
  enemies[2].gridPosition = { row: 0, col: 4 };
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.events.some((event) => event.text.includes('fires a beam')));
  assert.ok(resolution.state.dice.find((die) => die.typeId === 'Target').currentHealth < 1_000);
  assert.ok(resolution.state.dice.find((die) => die.typeId === 'Line').currentHealth < 1_000);
  assert.equal(resolution.state.dice.find((die) => die.typeId === 'OffLine').currentHealth, 1_000);
});

test('charged spear pierces foes behind the primary target', () => {
  const spear = definition('Spear', {
    attack: 1,
    health: 1_000,
    range: 2,
    skills: [{
      type: 'Active',
      title: 'Charged Spear',
      description: '',
      manaNeeded: 1,
      modifiers: { activeDamage: 10, pierceBehindDamage: 20, pierceBehindRange: 2 }
    }]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const behind = definition('Behind', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([spear], [target, behind]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  player.gridPosition = { row: 2, col: 4 };
  player.mana['Charged Spear:0'] = 1;
  const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  enemies[0].gridPosition = { row: 2, col: 0 };
  enemies[1].gridPosition = { row: 2, col: 1 };
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.state.dice.find((die) => die.typeId === 'Target').currentHealth < 1_000);
  assert.ok(resolution.state.dice.find((die) => die.typeId === 'Behind').currentHealth < 1_000);
});

test('summoned dice use their placement pattern and rolled pips', () => {
  const summoner = definition('Summoner', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Active',
      title: 'Rise From Hell',
      description: '',
      manaNeeded: 1,
      modifiers: {
        summonType: 'Minion',
        summonCount: 1,
        summonPattern: [[0, -1]],
        allowSummonedDieToRoll: true
      }
    }]
  });
  const minion = definition('Minion', { attack: 1, health: 10 });
  const target = definition('Target', { attack: 1, health: 1 });
  const { combat, catalog } = setup([summoner], [target], [minion]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  player.gridPosition = { row: 2, col: 4 };
  player.mana['Rise From Hell:0'] = 1;
  const resolution = resolve(combat, catalog);
  const summoned = resolution.state.dice.find((die) => die.typeId === 'Minion');

  assert.ok(summoned);
  assert.deepEqual(summoned.gridPosition, { row: 2, col: 3 });
  assert.ok(summoned.pips >= 1 && summoned.pips <= 6);
});

test('soul dice capture defeated allies and gain their stat boost', () => {
  const soul = definition('Soul', {
    attack: 1,
    health: 100,
    skills: [{
      type: 'Passive',
      title: 'Soul Harvest',
      description: '',
      modifiers: { canConjureSouls: true, conjureType: 'ally', noMaxSouls: true, soulBoostPercent: 0.2 }
    }]
  });
  const ally = definition('Ally', { attack: 1, health: 1 });
  const killer = definition('Killer', {
    attack: 100,
    health: 1_000,
    range: 6,
    targetingMode: 'Weakest',
    skills: [{
      type: 'CombatStart',
      title: 'Ambush',
      description: '',
      modifiers: { strikeFirst: true }
    }]
  });
  const { combat, catalog } = setup([soul, ally], [killer]);
  const playerDice = combat.state.dice.filter((die) => die.ownerId === 'player');
  playerDice[0].gridPosition = { row: 2, col: 4 };
  playerDice[1].gridPosition = { row: 2, col: 3 };
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'Soul');

  assert.equal(survivor.mana.souls, 1);
  assert.equal(survivor.maxHealth, 120);
});


test('plague converts a defeated enemy into a scaled allied die', () => {
  const zombie = definition('Zombie', {
    attack: 500,
    skills: [{
      type: 'OnKill',
      title: 'Zombie Pandemic',
      description: '',
      modifiers: { hasPlague: true, plaguedDieType: 'Zombie', plaguedDieHealth: 0.3, plaguedDieAttack: 0.6 }
    }]
  });
  const fragile = definition('Fragile', { health: 10, attack: 1 });
  const { combat, catalog } = setup([zombie], [fragile]);
  const fragileInstance = combat.state.dice.find((die) => die.ownerId === 'enemy');
  fragileInstance.pips = 5;
  const resolution = resolve(combat, catalog);
  const raised = resolution.state.dice.find((die) => die.instanceId.includes('plague'));
  assert.ok(raised);
  assert.equal(raised.typeId, 'Zombie');
  assert.equal(raised.ownerId, 'player');
  assert.equal(raised.maxHealth, 3);
  assert.equal(raised.currentHealth, 3);
  assert.deepEqual(raised.gridPosition, { row: 1, col: 0 });
  assert.equal(raised.pips, 5);
  assert.ok(resolution.events.some((event) => event.kind === 'summon'));
});

test('on-death nuclear strike damages the opposite origin once', () => {
  const nuclear = definition('Nuclear', {
    health: 100,
    attack: 24,
    skills: [{
      type: 'OnDeath',
      title: 'Nuclear Missile',
      description: '',
      modifiers: { hasNuclear: true, nuclearDamage: 600, nuclearArea: '3x3' }
    }]
  });
  const brute = definition('Brute', { health: 1_000, attack: 999 });
  const { combat, catalog } = setup([nuclear], [brute]);
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'Brute');
  assert.equal(survivor.currentHealth, 376);
  assert.ok(resolution.events.some((event) => event.text.includes('nuclear strike')));
});

test('class scaling applies to nuclear damage and plague summons', () => {
  const levelRules = { ...rules, useLevelling: true };
  const nuclear = definition('Nuclear', {
    classLevel: 2,
    health: 100,
    attack: 1,
    skills: [{
      type: 'OnDeath',
      title: 'Nuclear Missile',
      description: '',
      modifiers: { hasNuclear: true, nuclearDamage: 600, nuclearArea: '3x3' }
    }]
  });
  const brute = definition('Brute', { health: 1_000, attack: 999 });
  const nuclearSetup = setup([nuclear], [brute], [], levelRules);
  const nuclearResolution = resolve(nuclearSetup.combat, nuclearSetup.catalog, levelRules);
  const survivor = nuclearResolution.state.dice.find((die) => die.typeId === 'Brute');
  assert.equal(survivor.currentHealth, 339);

  const zombie = definition('Zombie', {
    classLevel: 2,
    attack: 500,
    skills: [{
      type: 'OnKill',
      title: 'Zombie Pandemic',
      description: '',
      modifiers: { hasPlague: true, plaguedDieType: 'Zombie', plaguedDieHealth: 0.3, plaguedDieAttack: 0.6 }
    }]
  });
  const fragile = definition('Fragile', { health: 10, attack: 1 });
  const plagueSetup = setup([zombie], [fragile], [], levelRules);
  const plagueResolution = resolve(plagueSetup.combat, plagueSetup.catalog, levelRules);
  const raised = plagueResolution.state.dice.find((die) => die.instanceId.includes('plague'));
  assert.ok(raised);
  assert.equal(plagueSetup.combat.definitions.get(raised.instanceId).attack, 330);
});

test('revenge requires hasRevenge and can trigger from a passive threshold', () => {
  const striker = definition('Striker', { attack: 60, health: 1_000 });
  const makeBasilisk = (hasRevenge) => definition('Basilisk', {
    attack: 1,
    health: 100,
    skills: [{
      type: 'Passive',
      title: 'Rapacious Revenge',
      description: '',
      modifiers: {
        ...(hasRevenge ? { hasRevenge: true } : {}),
        revengeThresholdRate: 0.8,
        revengeHits: 1,
        revengeDamage: 7
      }
    }]
  });
  const withFlag = setup([striker], [makeBasilisk(true)]);
  const flaggedResolution = resolve(withFlag.combat, withFlag.catalog);
  const flaggedSurvivor = flaggedResolution.state.dice.find((die) => die.typeId === 'Striker');
  assert.equal(flaggedSurvivor.currentHealth, 992);
  assert.ok(flaggedResolution.events.some((event) => event.text.includes('Revenge')));

  const withoutFlag = setup([striker], [makeBasilisk(false)]);
  const unflaggedResolution = resolve(withoutFlag.combat, withoutFlag.catalog);
  const unflaggedSurvivor = unflaggedResolution.state.dice.find((die) => die.typeId === 'Striker');
  assert.equal(unflaggedSurvivor.currentHealth, 999);
});

test('locked trigger metadata cannot leak nuclear strikes', () => {
  const nuclear = definition('LockedNuclear', {
    health: 100,
    attack: 24,
    skills: [{
      type: 'OnDeath',
      title: 'Locked Missile',
      description: '',
      modifiers: { hasNuclear: true, nuclearDamage: 600, unlockAtClass: 6 }
    }]
  });
  const brute = definition('Brute', { health: 1_000, attack: 999 });
  const { combat, catalog } = setup([nuclear], [brute]);
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'Brute');
  assert.equal(survivor.currentHealth, 976);
});

test('revive requires hasRevive instead of reviveChance alone', () => {
  const striker = definition('Striker', { attack: 500, health: 1_000 });
  const skull = definition('Skull', {
    health: 10,
    skills: [{
      type: 'OnDeath',
      title: 'Last Rattle',
      description: '',
      modifiers: { reviveChance: 1, maxRevives: 5 }
    }]
  });
  const { combat, catalog } = setup([striker], [skull]);
  const skullInstance = combat.state.dice.find((die) => die.ownerId === 'enemy');
  const resolution = resolve(combat, catalog);

  assert.equal(resolution.state.dice.find((die) => die.instanceId === skullInstance.instanceId).isDestroyed, true);
  assert.equal(resolution.events.filter((event) => event.kind === 'revive').length, 0);
});

test('revive health and attack scale on every successful revival', () => {
  const striker = definition('Striker', { attack: 500, health: 1_000 });
  const reviver = definition('Reviver', {
    attack: 10,
    health: 100,
    skills: [{
      type: 'OnDeath',
      title: 'Come Back',
      description: '',
      modifiers: {
        hasRevive: true,
        reviveChance: 1,
        maxRevives: 2,
        reviveHealth: 0.5,
        reviveAttack: 0.8
      }
    }]
  });
  const { combat, catalog } = setup([striker], [reviver]);
  combat.state.dice.find((die) => die.ownerId === 'player').pips = 3;
  const reviverInstance = combat.state.dice.find((die) => die.ownerId === 'enemy');
  const resolution = resolve(combat, catalog);
  const revived = resolution.state.dice.find((die) => die.instanceId === reviverInstance.instanceId);
  const revivedDefinition = combat.definitions.get(reviverInstance.instanceId);

  assert.equal(resolution.events.filter((event) => event.kind === 'revive').length, 2);
  assert.equal(revived.maxHealth, 25);
  assert.equal(revivedDefinition.health, 25);
  assert.equal(revivedDefinition.attack, 6);
});
