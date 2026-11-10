import assert from 'node:assert/strict';
import test from 'node:test';
import { applyClassProgression } from '../dist/combat/progression.js';
import { diceCatalog } from '../dist/combat/catalog.js';
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
      modifiers: { shield: 20, statusEffect: 'slow', statusDuration: 2, attackDelta: -1 }
    }]
  });
  const { combat, catalog } = setup([player], [enemy]);
  combat.state.dice.find((die) => die.ownerId === 'enemy').shieldHp = 100;
  combat.state.dice.find((die) => die.ownerId === 'enemy').shieldTurns = 2;
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
      modifiers: { skillDamage: 7, grantAttacksToAlly: 1 }
    }]
  });
  const enemy = definition('Fragile', {
    health: 10,
    skills: [{
      type: 'OnDeath',
      title: 'Last Rattle',
      description: '',
      modifiers: { skillDamage: 5 }
    }]
  });
  const { combat, catalog } = setup([player], [enemy]);
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.ownerId === 'player');
  assert.equal(survivor.currentHealth, 95);
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
        modifiers: { skillDamage: 25 }
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

test('ally attack grants can be limited to nearby allies', () => {
  const executioner = definition('Executioner', {
    attack: 500,
    skills: [{
      type: 'OnKill',
      title: 'Nearby Spoils',
      description: '',
      modifiers: { grantAttacksToAlly: 1, grantAttacksToAllyRadius: 1, skillTargeting: 'Nearest' }
    }]
  });
  const adjacent = definition('Adjacent', { attack: 1, health: 1_000 });
  const distant = definition('Distant', { attack: 1, health: 1_000 });
  const fragile = definition('Fragile', { attack: 1, health: 10 });
  const { combat, catalog } = setup([executioner, adjacent, distant], [fragile]);
  combat.state.dice.find((die) => die.typeId === 'Executioner').gridPosition = { row: 2, col: 2 };
  combat.state.dice.find((die) => die.typeId === 'Adjacent').gridPosition = { row: 2, col: 3 };
  combat.state.dice.find((die) => die.typeId === 'Distant').gridPosition = { row: 0, col: 4 };
  combat.state.dice.find((die) => die.typeId === 'Fragile').gridPosition = { row: 2, col: 0 };
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('grants 1 attack to Adjacent')
  )));
  assert.ok(!resolution.events.some((event) => (
    event.kind === 'skill' && event.text.includes('grants 1 attack to Distant')
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
      modifiers: { skillDamage: 7, unlockAtClass: 6 }
    }]
  });
  const fragile = definition('Fragile', { health: 10, attack: 1 });
  const { combat, catalog } = setup([executioner], [fragile]);
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.ownerId === 'player');

  assert.equal(resolution.events.some((event) => event.kind === 'skill' && event.text.includes('Locked Spoils')), false);
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
        modifiers: { skillDamage: 1, unlockAtClass: 6 }
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
        meteorCount: 1,
        meteorPoolType: 'Lava',
        meteorPoolDuration: 3,
        meteorPoolPattern: [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
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
  assert.equal(resolution.state.pools.length, 5);
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
        meteorCount: 1,
        meteorRandomOrientation: true,
        meteorPoolType: 'Lava',
        meteorPoolDuration: 3,
        meteorPoolPattern: [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]
      }
    }]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([meteor], [target]);
  combat.state.dice.find((die) => die.typeId === 'Meteor').mana['Bomb:0'] = 1;
  combat.state.dice.find((die) => die.typeId === 'Target').gridPosition = { row: 2, col: 2 };
  const resolution = resolve(combat, catalog);

  assert.ok(resolution.state.pools.length >= 3);
  assert.ok(resolution.state.pools.every((pool) => pool.damage === 50));
});

test('active status effects use activeSkillTargeting', () => {
  const controller = definition('Controller', {
    attack: 1,
    skills: [{
      type: 'Active',
      title: 'Slow',
      description: '',
      manaNeeded: 1,
      modifiers: { statusEffect: 'slow', statusDuration: 1, attackDelta: -1, activeSkillTargeting: 'Weakest' }
    }]
  });
  const sturdy = definition('Sturdy', { attack: 1, health: 100 });
  const frail = definition('Frail', { attack: 1, health: 40 });
  const middle = definition('Middle', { attack: 1, health: 70 });
  const { combat, catalog } = setup([controller], [sturdy, frail, middle]);
  combat.state.dice.find((die) => die.typeId === 'Controller').mana['Slow:0'] = 1;
  const frailDie = combat.state.dice.find((die) => die.typeId === 'Frail');
  const resolution = resolve(combat, catalog);
  const statusEvent = resolution.events.find((event) => event.kind === 'status' && event.text.includes('Slow'));

  assert.ok(statusEvent);
  assert.equal(statusEvent.text, 'Controller applies Slow to Frail for 1 turn!');
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
        meteorPoolType: 'Lava',
        meteorPoolDuration: 3,
        meteorPoolPattern: [[0, 0]]
      }
    }]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([meteor], [target]);
  combat.state.dice.find((die) => die.typeId === 'Meteor').mana['Bomb:0'] = 1;
  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'Target');
  assert.equal(survivor.currentHealth, 1_000);
  assert.equal(resolution.state.pools.length, 0);
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
        modifiers: { attackCount: 1, criticalChanceIncrease: 0.2, skillRangeThreshold: 2 }
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
      modifiers: { skillDamage: 10, hasPierce: true, pierceBehindDamage: 20, pierceBehindRange: 2 }
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
  assert.equal(raised.maxHealth, 100);
  assert.equal(raised.currentHealth, 30);
  assert.deepEqual(raised.gridPosition, { row: 1, col: 0 });
  assert.equal(raised.mana.infiltrated, 1);
  assert.equal(combat.definitions.get(raised.instanceId).attack, 300);
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

test('on-death nuclear retriggers after an immediate revive and applies timed counts', () => {
  const nuclear = definition('ReviveNuke', {
    attack: 0,
    health: 10,
    skills: [{
      type: 'OnDeath',
      title: 'Nuclear Revival',
      description: '',
      modifiers: {
        hasNuclear: true,
        nuclearDamage: 1,
        nuclearArea: '1x1',
        hasRevive: true,
        reviveChance: 1,
        maxRevives: 5,
        reviveHealth: 0.5,
        attackCountIncrease: 1,
        projectileCountIncrease: 1,
        skillDuration: 2
      }
    }]
  });
  const tank = definition('Tank', { attack: 1_000, health: 100_000 });
  const { combat, catalog } = setup([tank], [nuclear]);
  const first = resolve(combat, catalog);
  const revived = first.state.dice.find((die) => die.typeId === 'ReviveNuke');
  assert.equal(revived.isDestroyed, false);
  assert.equal(revived.mana.extraAttacks, 1);
  assert.equal(revived.mana.projectileBonus, 1);
  assert.equal(revived.mana.extraAttackTurns, 1);
  assert.equal(revived.mana.projectileBonusTurns, 1);
  assert.equal(first.events.filter((event) => event.text.includes('nuclear strike')).length, 1);

  const tankAfter = first.state.dice.find((die) => die.typeId === 'Tank');
  tankAfter.zone = 'board';
  tankAfter.gridPosition = { row: 1, col: 4 };
  revived.zone = 'board';
  revived.gridPosition = { row: 1, col: 0 };
  const second = resolve(combat, catalog);
  assert.equal(second.events.filter((event) => event.text.includes('nuclear strike')).length, 1);
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
  assert.equal(raised.maxHealth, 110);
  assert.equal(raised.currentHealth, 33);
  assert.equal(raised.mana.infiltrated, 1);
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

  const reviveEvents = resolution.events.filter((event) => event.kind === 'revive');
  assert.equal(reviveEvents.length, 2);
  assert.ok(reviveEvents.every((event) => event.text.includes('50 health')));
  assert.equal(revived.maxHealth, 100);
  assert.equal(revivedDefinition.health, 100);
  assert.equal(revivedDefinition.attack, 6);
});

test('class benefits are data-driven and damage bonuses stay compound', () => {
  const definitionWithBenefits = definition('Benefits', {
    skills: [{
      type: 'Passive',
      title: 'Configured Scaling',
      description: '',
      modifiers: { skillDamage: 100, numAttacksBoosted: 2 },
      classBenefits: {
        skillDamage: [0, 99, 99],
        numAttacksBoosted: [0, 0, 0, 0, 1, 1]
      }
    }]
  });

  const scaled = applyClassProgression(definitionWithBenefits, 5);
  assert.equal(scaled.skills[0].modifiers.skillDamage, 146);
  assert.equal(scaled.skills[0].modifiers.numAttacksBoosted, 3);

  const sniper = applyClassProgression(diceCatalog.get('Sniper'), 15);
  assert.equal(sniper.skills[0].modifiers.distanceDamageBonusRatePerTile, 0.27);
});

test('hasLock gates locking and an invalid lockRange falls back to attack range', () => {
  const lockCount = (modifiers) => {
    const locker = definition('Locker', {
      attack: 1,
      range: 3,
      skills: [{
        type: 'CombatStart',
        title: 'Binding Chain',
        description: '',
        modifiers: { ...modifiers, numLocks: 1, lockSideTargeting: 'foes', lockDuration: 2 }
      }]
    });
    const target = definition('LockTarget', { attack: 1, health: 100 });
    const { combat, catalog } = setup([locker], [target]);
    return Object.keys(resolve(combat, catalog).state.lockedBy).length;
  };

  assert.equal(lockCount({ hasLock: true }), 1);
  assert.equal(lockCount({ hasLock: true, lockRange: 0 }), 1);
  assert.equal(lockCount({ hasLock: true, lockRange: -4 }), 1);
  assert.equal(lockCount({ hasLock: false, lockRange: 6 }), 0);
  assert.equal(lockCount({ lockRange: 6 }), 0);
});

test('meteor pool metadata resolves PoolDefinitions damage and status', () => {
  const meteor = definition('PoolMeteor', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Active',
      title: 'Fallout Bomb',
      description: '',
      manaNeeded: 1,
      modifiers: {
        hasMeteor: true,
        meteorDamage: 1,
        meteorCount: 1,
        meteorPoolType: 'Fallout',
        meteorPoolDuration: 2
      }
    }]
  });
  const target = definition('PoolTarget', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([meteor], [target]);
  combat.state.dice.find((die) => die.typeId === 'PoolMeteor').mana['Fallout Bomb:0'] = 1;

  const first = resolveCombat(combat.state, combat.definitions, rules, 'pool-seed-1', catalog);
  assert.equal(first.state.pools.length, 1);
  assert.equal(first.state.pools[0].typeId, 'Fallout');
  assert.equal(first.state.pools[0].damage, 60);
  const placedTarget = first.state.dice.find((die) => die.typeId === 'PoolTarget');
  const healthBefore = placedTarget.currentHealth;
  placedTarget.zone = 'board';
  placedTarget.gridPosition = { row: first.state.pools[0].row, col: first.state.pools[0].col };

  const second = resolveCombat(first.state, combat.definitions, rules, 'pool-seed-2', catalog);
  const damaged = second.state.dice.find((die) => die.typeId === 'PoolTarget');
  assert.ok(damaged.currentHealth < healthBefore);
  assert.equal(damaged.mana['status:poison'], 1);
  assert.equal(damaged.mana.poisonAmount, 60);
});

test('skillHealing works outside Active skills', () => {
  const healer = definition('Recovery', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'CombatEnd',
      title: 'Mend',
      description: '',
      modifiers: { skillHealing: 20 }
    }]
  });
  const enemy = definition('Sparring', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([healer], [enemy]);
  const damagedHealer = combat.state.dice.find((die) => die.typeId === 'Recovery');
  damagedHealer.currentHealth = 50;

  const resolution = resolve(combat, catalog);
  const healed = resolution.state.dice.find((die) => die.typeId === 'Recovery');
  assert.ok(healed.currentHealth > 50);
});

test('nuclear pool modifiers resolve through PoolDefinitions', () => {
  const bomber = definition('PoolNuclear', {
    attack: 1,
    health: 10,
    skills: [{
      type: 'OnDeath',
      title: 'Fallout Strike',
      description: '',
      modifiers: {
        hasNuclear: true,
        nuclearDamage: 1,
        nuclearArea: '1x1',
        nuclearPool: 'Fallout',
        nuclearPoolLifespan: 2
      }
    }]
  });
  const attacker = definition('NuclearAttacker', { attack: 50, health: 1_000 });
  const { combat, catalog } = setup([attacker], [bomber]);

  const resolution = resolve(combat, catalog);
  assert.equal(resolution.state.pools.length, 1);
  assert.equal(resolution.state.pools[0].typeId, 'Fallout');
  assert.equal(resolution.state.pools[0].damage, 60);
  assert.equal(resolution.state.pools[0].turns, 2);
});


test('failed infiltration keeps Execution Rhythm but cannot strike first', () => {
  const assassin = definition('Assassin', {
    attack: 10,
    health: 1_000,
    range: 1,
    skills: [
      {
        type: 'CombatStart',
        title: 'Backline Breach',
        description: '',
        modifiers: { isInfiltrator: true, teleportRange: -1, strikeFirst: true }
      },
      {
        type: 'Passive',
        title: 'Execution Rhythm',
        description: '',
        modifiers: { numAttacksBoosted: 2, numAttacksDamageMult: 2 }
      }
    ]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const blockerA = definition('BlockerA', { attack: 1, health: 1_000 });
  const blockerB = definition('BlockerB', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([assassin], [target, blockerA, blockerB]);
  const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  enemies[0].gridPosition = { row: 0, col: 4 };
  enemies[1].gridPosition = { row: 1, col: 4 };
  enemies[2].gridPosition = { row: 0, col: 3 };
  const player = combat.state.dice.find((die) => die.typeId === 'Assassin');
  player.gridPosition = { row: 1, col: 4 };

  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'Assassin');
  assert.equal(survivor.mana.infiltrated, undefined);
  assert.equal(survivor.mana.strikeFirst, undefined);
  assert.equal(survivor.boostedAttacks, 2);
});

test('infiltration prioritises the backmost column over configured targeting', () => {
  const assassin = definition('Assassin', {
    attack: 10,
    health: 1_000,
    range: 1,
    targetingMode: 'Nearest',
    skills: [{
      type: 'CombatStart',
      title: 'Backline Breach',
      description: '',
      modifiers: { isInfiltrator: true, teleportRange: -1, strikeFirst: true, skillTargeting: 'Nearest' }
    }]
  });
  const front = definition('Front', { attack: 1, health: 1_000 });
  const back = definition('Back', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([assassin], [front, back]);
  const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  enemies[0].gridPosition = { row: 2, col: 1 };
  enemies[1].gridPosition = { row: 2, col: 4 };
  const player = combat.state.dice.find((die) => die.typeId === 'Assassin');
  player.gridPosition = { row: 2, col: 4 };

  const resolution = resolve(combat, catalog);
  const frontAfter = resolution.state.dice.find((die) => die.typeId === 'Front');
  const backAfter = resolution.state.dice.find((die) => die.typeId === 'Back');
  assert.ok(resolution.events.some((event) => event.text.includes('infiltrates')));
  assert.equal(frontAfter.currentHealth, 1_000);
  assert.ok(backAfter.currentHealth < 1_000);
});


test('heatwave requires hasHeatwave and pulses around the attacker', () => {
  const run = (hasHeatwave) => {
    const solar = definition('HeatSource', {
      attack: 10,
      health: 1_000,
      range: 6,
      skills: [{
        type: 'Passive',
        title: 'Heatwave',
        description: '',
        modifiers: {
          ...(hasHeatwave ? { hasHeatwave: true } : {}),
          heatwaveDamage: 25
        }
      }]
    });
    const target = definition('HeatTarget', { attack: 1, health: 1_000 });
    const nearAttacker = definition('HeatNearAttacker', { attack: 1, health: 1_000 });
    const nearTarget = definition('HeatNearTarget', { attack: 1, health: 1_000 });
    const { combat, catalog } = setup([solar], [target, nearAttacker, nearTarget]);
    const player = combat.state.dice.find((die) => die.typeId === 'HeatSource');
    const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
    player.gridPosition = { row: 2, col: 4 };
    enemies[0].gridPosition = { row: 2, col: 0 };
    enemies[1].gridPosition = { row: 1, col: 0 };
    enemies[2].gridPosition = { row: 2, col: 1 };
    const resolution = resolve(combat, catalog);
    return {
      nearAttacker: resolution.state.dice.find((die) => die.typeId === 'HeatNearAttacker').currentHealth,
      nearTarget: resolution.state.dice.find((die) => die.typeId === 'HeatNearTarget').currentHealth
    };
  };

  assert.deepEqual(run(false), { nearAttacker: 1_000, nearTarget: 1_000 });
  const result = run(true);
  assert.ok(result.nearAttacker < 1_000);
  assert.equal(result.nearTarget, 1_000);
});


test('piercing basic attacks require hasPierce', () => {
  const run = (hasPierce) => {
    const spear = definition('BasicSpear', {
      attack: 10,
      health: 1_000,
      range: 2,
      skills: [{
        type: 'Passive',
        title: 'Piercing Spear',
        description: '',
        modifiers: { pierceBehindRange: 1, ...(hasPierce ? { hasPierce: true } : {}) }
      }]
    });
    const target = definition('BasicTarget', { attack: 1, health: 1_000 });
    const behind = definition('BasicBehind', { attack: 1, health: 1_000 });
    const { combat, catalog } = setup([spear], [target, behind]);
    const player = combat.state.dice.find((die) => die.ownerId === 'player');
    const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
    player.gridPosition = { row: 2, col: 4 };
    enemies[0].gridPosition = { row: 2, col: 0 };
    enemies[1].gridPosition = { row: 2, col: 1 };
    const resolution = resolve(combat, catalog);
    return resolution.state.dice.filter((die) => die.ownerId === 'enemy' && die.currentHealth < 1_000).length;
  };

  assert.equal(run(false), 1);
  assert.equal(run(true), 2);
});

test('splash, chain, and heatwave fall back to the attack stat when payloads are omitted', () => {
  const run = (modifiers) => {
    const attacker = definition('FallbackSource', {
      attack: 10,
      health: 1_000,
      range: 6,
      skills: [{ type: 'Passive', title: 'Fallback', description: '', modifiers }]
    });
    const target = definition('FallbackTarget', { attack: 1, health: 1_000 });
    const neighbor = definition('FallbackNeighbor', { attack: 1, health: 1_000 });
    const { combat, catalog } = setup([attacker], [target, neighbor]);
    const player = combat.state.dice.find((die) => die.ownerId === 'player');
    const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
    player.gridPosition = { row: 2, col: 4 };
    enemies[0].gridPosition = { row: 2, col: 0 };
    enemies[1].gridPosition = { row: 1, col: 0 };
    const resolution = resolve(combat, catalog);
    return resolution.state.dice
      .filter((die) => die.ownerId === 'enemy')
      .reduce((total, die) => total + die.currentHealth, 0);
  };

  assert.ok(run({ hasSplash: true }) <= 1_980);
  assert.ok(run({ hasChain: true, chainRange: 2 }) <= 1_980);
  assert.ok(run({ hasHeatwave: true }) <= 1_980);
});

test('ricochet healing requires hasRicochet and applies ricochetDropOff', () => {
  const run = (hasRicochet, ricochetDropOff) => {
    const healer = definition('RicochetHealer', {
      attack: 20,
      health: 1_000,
      range: 6,
      skills: [{
        type: 'Passive',
        title: 'Druidic Essence',
        description: '',
        modifiers: {
          healOnAttack: true,
          ricochetCount: 1,
          ricochetRange: 2,
          ...(ricochetDropOff === undefined ? {} : { ricochetDropOff }),
          ...(hasRicochet ? { hasRicochet: true } : {})
        }
      }]
    });
    const allyA = definition('RicochetAllyA', { attack: 1, health: 100, range: 1 });
    const allyB = definition('RicochetAllyB', { attack: 1, health: 100, range: 1 });
    const enemy = definition('RicochetEnemy', { attack: 1, health: 1_000, range: 1 });
    const { combat, catalog } = setup([healer, allyA, allyB], [enemy]);
    const playerDice = combat.state.dice.filter((die) => die.ownerId === 'player');
    playerDice[0].gridPosition = { row: 2, col: 4 };
    playerDice[1].gridPosition = { row: 2, col: 3 };
    playerDice[2].gridPosition = { row: 2, col: 2 };
    playerDice[1].currentHealth = 30;
    playerDice[2].currentHealth = 50;
    const resolution = resolve(combat, catalog);
    return resolution.state.dice
      .filter((die) => die.ownerId === 'player')
      .map((die) => die.currentHealth);
  };

  const unflagged = run(false);
  const defaulted = run(true);
  const decayed = run(true, 0);
  assert.equal(unflagged[2], 50);
  assert.ok(defaulted[2] > 50);
  assert.ok(decayed[2] > 50);
  assert.ok(decayed[2] - 50 <= 2);
  assert.ok(decayed[2] < defaulted[2]);
});

test('ricochet damage is available when hasRicochet is enabled', () => {
  const run = (hasRicochet) => {
    const attacker = definition('RicochetAttacker', {
      attack: 20,
      health: 1_000,
      range: 6,
      skills: [{
        type: 'Passive',
        title: 'Ricochet',
        description: '',
        modifiers: {
          ricochetCount: 1,
          ricochetRange: 2,
          ricochetDropOff: 0,
          ...(hasRicochet ? { hasRicochet: true } : {})
        }
      }]
    });
    const target = definition('RicochetTarget', { attack: 1, health: 1_000, range: 1 });
    const bystander = definition('RicochetBystander', { attack: 1, health: 1_000, range: 1 });
    const { combat, catalog } = setup([attacker], [target, bystander]);
    const player = combat.state.dice.find((die) => die.ownerId === 'player');
    const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
    player.gridPosition = { row: 2, col: 4 };
    enemies[0].gridPosition = { row: 2, col: 2 };
    enemies[1].gridPosition = { row: 2, col: 3 };
    const resolution = resolve(combat, catalog);
    return resolution.state.dice.find((die) => die.typeId === 'RicochetBystander').currentHealth;
  };

  assert.equal(run(false), 1_000);
  assert.ok(run(true) < 1_000);
});

test('pool damage ticks once per occupied tile and reports each pool type', () => {
  const target = definition('PoolTarget', { attack: 1, health: 100, footprint: 2 });
  const { combat, catalog } = setup([], [target]);
  const enemy = combat.state.dice.find((die) => die.ownerId === 'enemy');
  enemy.gridPosition = { row: 0, col: 0 };
  const pool = (typeId, title, row, col) => ({
    typeId,
    title,
    row,
    col,
    damage: 5,
    turns: 2,
    ownerId: 'player',
    sourceTypeId: 'Meteor',
    affects: 'foes'
  });
  combat.state.pools = [
    pool('Lava', 'Lava', 0, 0),
    pool('Lava', 'Lava', 0, 1),
    pool('MagicianLava', 'Magician Lava', 1, 0),
    pool('MagicianLava', 'Magician Lava', 1, 1)
  ];

  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'PoolTarget');
  assert.equal(survivor.currentHealth, 80);
  assert.equal(resolution.events.filter((event) => event.text === 'PoolTarget takes 2 ticks of Lava damage!').length, 1);
  assert.equal(resolution.events.filter((event) => event.text === 'PoolTarget takes 2 ticks of Magician Lava damage!').length, 1);
});

test('chain honors chainTargets and prefers the primary target row', () => {
  const run = (chainTargets) => {
    const chainer = definition('ChainSource', {
      attack: 1,
      health: 1_000,
      range: 6,
      skills: [{
        type: 'Passive',
        title: 'Chain',
        description: '',
        modifiers: { hasChain: true, chainDamage: 10, chainRange: 2, chainTargets }
      }]
    });
    const target = definition('ChainTarget', { attack: 1, health: 1_000 });
    const rowMate = definition('ChainRow', { attack: 1, health: 1_000 });
    const diagonal = definition('ChainDiagonal', { attack: 1, health: 1_000 });
    const { combat, catalog } = setup([chainer], [target, rowMate, diagonal]);
    const player = combat.state.dice.find((die) => die.typeId === 'ChainSource');
    const enemies = combat.state.dice.filter((die) => die.ownerId === 'enemy');
    player.gridPosition = { row: 2, col: 4 };
    enemies[0].gridPosition = { row: 2, col: 0 };
    enemies[1].gridPosition = { row: 2, col: 1 };
    enemies[2].gridPosition = { row: 1, col: 1 };
    const resolution = resolve(combat, catalog);
    return {
      rowMate: resolution.state.dice.find((die) => die.typeId === 'ChainRow').currentHealth,
      diagonal: resolution.state.dice.find((die) => die.typeId === 'ChainDiagonal').currentHealth
    };
  };

  const capped = run(1);
  assert.ok(capped.rowMate < 1_000);
  assert.equal(capped.diagonal, 1_000);
  const uncapped = run(-1);
  assert.ok(uncapped.rowMate < 1_000);
  assert.ok(uncapped.diagonal < 1_000);
});

test('active skills that require a target do not fire without one', () => {
  const caster = definition('NoTargetCaster', {
    attack: 1,
    health: 1_000,
    range: 1,
    skills: [{
      type: 'Active',
      title: 'Blast',
      description: '',
      manaNeeded: 1,
      modifiers: { skillDamage: 50 }
    }]
  });
  const target = definition('DistantTarget', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([caster], [target]);
  const player = combat.state.dice.find((die) => die.typeId === 'NoTargetCaster');
  const enemy = combat.state.dice.find((die) => die.typeId === 'DistantTarget');
  player.gridPosition = { row: 4, col: 0 };
  enemy.gridPosition = { row: 0, col: 0 };
  player.mana['Blast:0'] = 1;

  const resolution = resolve(combat, catalog);
  assert.equal(resolution.state.dice.find((die) => die.typeId === 'NoTargetCaster').mana['Blast:0'], 1);
  assert.equal(resolution.events.some((event) => event.kind === 'skill' && event.text.includes('uses Blast')), false);
});

test('projectile count increase fires extra projectiles and pauses mana for skillDuration turns', () => {
  const wind = definition('WindParity', {
    attack: 10,
    health: 1_000,
    range: 6,
    skills: [{
      type: 'Active',
      title: 'Gale Tempo',
      description: '',
      manaNeeded: 1,
      modifiers: {
        projectileCountIncrease: 1,
        skillDuration: 2,
        disableManaGain: true,
        consumeAttack: false
      }
    }]
  });
  const target = definition('WindTarget', { attack: 0, health: 1_000 });
  const { combat, catalog } = setup([wind], [target]);
  combat.state.dice.find((die) => die.typeId === 'WindParity').mana['Gale Tempo:0'] = 1;

  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.typeId === 'WindParity');
  const victim = resolution.state.dice.find((die) => die.typeId === 'WindTarget');

  assert.equal(victim.currentHealth, 980);
  assert.equal(survivor.mana['projectileBonus'], 1);
  assert.equal(survivor.mana['projectileBonusTurns'], 1);
  assert.equal(survivor.mana['manaPausedTurns'], 1);
  assert.equal(survivor.mana['Gale Tempo:0'], 0);
});

test('attack count increase grants immediate and timed extra attacks instead of projectiles', () => {
  const caster = definition('TempoParity', {
    attack: 1,
    health: 1_000,
    range: 6,
    skills: [{
      type: 'Active',
      title: 'Surge',
      description: '',
      manaNeeded: 1,
      modifiers: {
        attackCountIncrease: 2,
        skillDuration: 2,
        disableManaGain: true,
        consumeAttack: false
      }
    }]
  });
  const target = definition('TempoTarget', { attack: 0, health: 10_000 });
  const { combat, catalog } = setup([caster], [target]);
  combat.state.dice.find((die) => die.typeId === 'TempoParity').mana['Surge:0'] = 1;

  const first = resolve(combat, catalog);
  const attacker = first.state.dice.find((die) => die.typeId === 'TempoParity');
  const victim = first.state.dice.find((die) => die.typeId === 'TempoTarget');
  assert.equal(victim.currentHealth, 9_997);
  assert.equal(attacker.mana['extraAttacks'], 2);
  assert.equal(attacker.mana['extraAttackTurns'], 1);
  assert.equal(attacker.mana['projectileBonus'] ?? 0, 0);

  attacker.zone = 'board';
  attacker.gridPosition = { row: 1, col: 4 };
  victim.zone = 'board';
  victim.gridPosition = { row: 1, col: 0 };
  const second = resolve(combat, catalog);
  const nextAttacker = second.state.dice.find((die) => die.typeId === 'TempoParity');
  assert.equal(second.state.dice.find((die) => die.typeId === 'TempoTarget').currentHealth, 9_994);
  assert.equal(nextAttacker.mana['extraAttacks'], 0);
  assert.equal(nextAttacker.mana['extraAttackTurns'], 0);
});

test('passive attack and projectile counts add hits without skillDuration', () => {
  const caster = definition('PassiveCounts', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Passive',
      title: 'Standing Army',
      description: '',
      modifiers: {
        attackCount: 1,
        projectileCount: 1,
        attackCountIncrease: 9,
        projectileCountIncrease: 9,
        skillDuration: 5
      }
    }]
  });
  const target = definition('CountTarget', { attack: 0, health: 10_000 });
  const { combat, catalog } = setup([caster], [target]);
  const resolution = resolve(combat, catalog);
  const victim = resolution.state.dice.find((die) => die.typeId === 'CountTarget');
  assert.equal(victim.currentHealth, 9_996);
});

test('strike-first logs the target and records shield absorption', () => {
  const assassin = definition('StrikeAssassin', {
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
  const target = definition('ShieldedTarget', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([assassin], [target]);
  combat.state.dice.find((die) => die.typeId === 'ShieldedTarget').shieldHp = 25;
  combat.state.dice.find((die) => die.typeId === 'ShieldedTarget').shieldTurns = 2;
  const resolution = resolve(combat, catalog);
  const strike = resolution.events.find((event) => event.text.includes('strikes') && event.text.includes('first'));

  assert.ok(strike);
  assert.ok(strike.text.includes('ShieldedTarget'));
  assert.ok(strike.text.includes('shield absorbed 10 damage'));
});

test('on-transformed maul teleports beside the nearest foe and applies skill damage modifiers', () => {
  const druid = definition('DruidParity', {
    attack: 1,
    health: 1_000,
    range: 1,
    skills: [{
      type: 'Active',
      title: 'Shift',
      description: '',
      manaNeeded: 1,
      modifiers: { transformToNextForm: true, consumeAttack: false, canFireWithNoTargets: true }
    }],
    transformStats: [{
      title: 'Bear',
      attack: 50,
      health: 1_400,
      range: 1,
      recoveryRate: 1,
      skills: [{
        type: 'OnTransformed',
        title: 'Maul',
        description: '',
        modifiers: {
          skillDamage: 250,
          lowHpThresholdRate: 1,
          lowHpDamageBonusRate: 0.5,
          criticalChanceIncrease: -1
        }
      }]
    }]
  });
  const target = definition('MaulTarget', { attack: 1, health: 10_000 });
  const { combat, catalog } = setup([druid], [target]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const enemy = combat.state.dice.find((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 4, col: 4 };
  player.mana['Shift:0'] = 1;
  enemy.gridPosition = { row: 0, col: 0 };
  enemy.currentHealth = 5_000;

  const resolution = resolve(combat, catalog, { ...rules, turnLimit: 0 });
  const transformed = resolution.state.dice.find((die) => die.ownerId === 'player');
  const survivor = resolution.state.dice.find((die) => die.ownerId === 'enemy');

  assert.equal(Math.max(
    Math.abs(transformed.gridPosition.row - survivor.gridPosition.row),
    Math.abs(transformed.gridPosition.col - survivor.gridPosition.col)
  ), 1);
  assert.ok(resolution.events.some((event) => (
    event.kind === 'damage'
    && event.sourceId === transformed.instanceId
    && event.targetId === survivor.instanceId
    && event.amount === 375
  )));
});

test('judgment hammer falls on the weakest living foe after a kill', () => {
  const judgment = definition('JudgeParity', {
    attack: 500,
    health: 1_000,
    range: 6,
    skills: [{
      type: 'OnKill',
      title: 'Hammer',
      description: '',
      modifiers: {
        hasHammer: true,
        hammerDamage: 150,
        hammerRadius: 1,
        canRetriggerSkill: true,
        maxSkillRetriggers: 10
      }
    }]
  });
  const fragile = definition('HammerVictim', { attack: 1, health: 10 });
  const weak = definition('HammerWeak', { attack: 1, health: 300 });
  const neighbor = definition('HammerNeighbor', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([judgment], [fragile, weak, neighbor]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const [fragileDie, weakDie, neighborDie] = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 2, col: 4 };
  fragileDie.gridPosition = { row: 2, col: 0 };
  weakDie.gridPosition = { row: 2, col: 1 };
  neighborDie.gridPosition = { row: 3, col: 1 };

  const resolution = resolve(combat, catalog);
  const weakAfter = resolution.state.dice.find((die) => die.typeId === 'HammerWeak');
  const neighborAfter = resolution.state.dice.find((die) => die.typeId === 'HammerNeighbor');

  assert.equal(resolution.events.filter((event) => event.text.includes('Hammer marks')).length, 1);
  assert.ok(resolution.events.some((event) => event.text.includes('striking HammerNeighbor')));
  assert.ok(weakAfter.currentHealth < 300);
  assert.ok(neighborAfter.currentHealth < 1_000);
});

test('active skill damage applies low-health and distance modifiers', () => {
  const caster = definition('ActiveParity', {
    attack: 1,
    health: 1_000,
    range: 6,
    skills: [{
      type: 'Active',
      title: 'Blast',
      description: '',
      manaNeeded: 1,
      modifiers: {
        skillDamage: 100,
        lowHpThresholdRate: 1,
        lowHpDamageBonusRate: 0.5,
        criticalChanceIncrease: -1
      }
    }]
  });
  const target = definition('ActiveTarget', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([caster], [target]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const enemy = combat.state.dice.find((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 2, col: 4 };
  player.mana['Blast:0'] = 1;
  enemy.gridPosition = { row: 2, col: 0 };
  enemy.currentHealth = 500;

  const resolution = resolve(combat, catalog);
  assert.ok(resolution.events.some((event) => (
    event.kind === 'damage'
    && event.sourceId === player.instanceId
    && event.targetId === enemy.instanceId
    && event.amount === 150
  )));
});

test('timed transformations expire at the end of their configured round', () => {
  const shifter = definition('TimedShifter', {
    attack: 1,
    health: 100,
    range: 1,
    skills: [{
      type: 'Active',
      title: 'Shift',
      description: '',
      manaNeeded: 1,
      modifiers: { transformToNextForm: true, consumeAttack: false }
    }],
    transformStats: [{
      title: 'Beast',
      attack: 50,
      health: 500,
      recoveryRate: 1,
      transformDuration: 1,
      skills: []
    }]
  });
  const target = definition('TimedTarget', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([shifter], [target]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const enemy = combat.state.dice.find((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 2, col: 4 };
  player.mana['Shift:0'] = 1;
  enemy.gridPosition = { row: 2, col: 0 };

  const resolution = resolve(combat, catalog);
  const transformed = resolution.state.dice.find((die) => die.ownerId === 'player');

  assert.ok(resolution.events.some((event) => event.text.includes('transforms into Beast')));
  assert.equal(transformed.transformIndex, undefined);
  assert.equal(transformed.transformTurns, undefined);
  assert.equal(transformed.maxHealth, 100);
  assert.equal(transformed.currentHealth, 100);
});

test('on-kill damage follows the attacker targeting mode', () => {
  const executioner = definition('ModeExecutioner', {
    attack: 50,
    health: 1_000,
    range: 6,
    targetingMode: 'Weakest',
    skills: [{
      type: 'OnKill',
      title: 'Aftermath',
      description: '',
      modifiers: { skillDamage: 4 }
    }]
  });
  const fragile = definition('ModeFragile', { attack: 1, health: 10 });
  const weak = definition('ModeWeak', { attack: 1, health: 500 });
  const strong = definition('ModeStrong', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([executioner], [fragile, weak, strong]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const [fragileDie, weakDie, strongDie] = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 2, col: 4 };
  fragileDie.gridPosition = { row: 2, col: 0 };
  weakDie.gridPosition = { row: 1, col: 4 };
  strongDie.gridPosition = { row: 1, col: 3 };

  const resolution = resolve(combat, catalog);
  const weakAfter = resolution.state.dice.find((die) => die.typeId === 'ModeWeak');
  const strongAfter = resolution.state.dice.find((die) => die.typeId === 'ModeStrong');

  assert.ok(weakAfter.currentHealth < 500);
  assert.equal(strongAfter.currentHealth, 1_000);
});

test('combat-end damage follows the die targeting mode', () => {
  const ender = definition('ModeEnder', {
    attack: 1,
    health: 1_000,
    range: 6,
    targetingMode: 'Strongest',
    skills: [{
      type: 'CombatEnd',
      title: 'Final Strike',
      description: '',
      modifiers: { skillDamage: 4 }
    }]
  });
  const weak = definition('EndWeak', { attack: 1, health: 500 });
  const strong = definition('EndStrong', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([ender], [weak, strong]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const [weakDie, strongDie] = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 2, col: 4 };
  weakDie.gridPosition = { row: 2, col: 0 };
  strongDie.gridPosition = { row: 1, col: 4 };

  const resolution = resolve(combat, catalog);
  const weakAfter = resolution.state.dice.find((die) => die.typeId === 'EndWeak');
  const strongAfter = resolution.state.dice.find((die) => die.typeId === 'EndStrong');

  assert.equal(weakAfter.currentHealth, 500);
  assert.ok(strongAfter.currentHealth < 1_000);
});

test('revenge uses its configured range and targeting mode', () => {
  const attacker = definition('RevengeAttacker', { attack: 60, health: 1_000 });
  const ally = definition('RevengeAlly', { attack: 1, health: 50 });
  const defender = definition('RevengeDefender', {
    attack: 1,
    health: 100,
    range: 1,
    skills: [{
      type: 'OnDamaged',
      title: 'Retaliate',
      description: '',
      modifiers: {
        hasRevenge: true,
        revengeThresholdRate: 0.5,
        revengeRange: 1,
        revengeDamage: 5,
        revengeHits: 1,
        skillTargeting: 'Weakest'
      }
    }]
  });
  const { combat, catalog } = setup([attacker, ally], [defender]);
  const defenderDie = combat.state.dice.find((die) => die.typeId === 'RevengeDefender');
  const allyDie = combat.state.dice.find((die) => die.typeId === 'RevengeAlly');
  defenderDie.stunTurns = 1;
  allyDie.currentHealth = 50;

  const resolution = resolve(combat, catalog);
  const attackerAfter = resolution.state.dice.find((die) => die.typeId === 'RevengeAttacker');
  const allyAfter = resolution.state.dice.find((die) => die.typeId === 'RevengeAlly');

  assert.equal(attackerAfter.currentHealth, 1_000);
  assert.equal(allyAfter.currentHealth, 45);
});

test('judgment hammer falls back to the attacker attack when damage is omitted', () => {
  const judge = definition('FallbackJudge', {
    attack: 500,
    health: 1_000,
    range: 6,
    skills: [{
      type: 'OnKill',
      title: 'Hammer',
      description: '',
      modifiers: { hasHammer: true, hammerRadius: 1 }
    }]
  });
  const fragile = definition('FallbackFragile', { attack: 1, health: 10 });
  const durable = definition('FallbackDurable', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([judge], [fragile, durable]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const [fragileDie, durableDie] = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 2, col: 4 };
  fragileDie.gridPosition = { row: 2, col: 0 };
  durableDie.gridPosition = { row: 2, col: 1 };

  const resolution = resolve(combat, catalog);
  const durableAfter = resolution.state.dice.find((die) => die.typeId === 'FallbackDurable');

  assert.equal(durableAfter.currentHealth, 500);
});

test('judgment hammer does not retrigger when the skill disallows it', () => {
  const judge = definition('RetriggerJudge', {
    attack: 500,
    health: 1_000,
    range: 6,
    skills: [{
      type: 'OnKill',
      title: 'Hammer',
      description: '',
      modifiers: {
        hasHammer: true,
        hammerDamage: 10,
        hammerRadius: 1,
        canRetriggerSkill: false,
        maxSkillRetriggers: 10
      }
    }]
  });
  const first = definition('RetriggerFirst', { attack: 1, health: 10 });
  const second = definition('RetriggerSecond', { attack: 1, health: 10 });
  const durable = definition('RetriggerDurable', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([judge], [first, second, durable]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const [firstDie, secondDie, durableDie] = combat.state.dice.filter((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 2, col: 4 };
  firstDie.gridPosition = { row: 2, col: 0 };
  secondDie.gridPosition = { row: 2, col: 1 };
  durableDie.gridPosition = { row: 2, col: 2 };

  const resolution = resolve(combat, catalog);
  const durableAfter = resolution.state.dice.find((die) => die.typeId === 'RetriggerDurable');
  const hammerEvents = resolution.events.filter((event) => event.text.includes('Hammer marks'));

  assert.equal(durableAfter.currentHealth, 990);
  assert.equal(hammerEvents.length, 1);
});

test('on-kill summon triggers use the combat catalog', () => {
  const summoner = definition('TriggerSummoner', {
    attack: 100,
    health: 1_000,
    range: 6,
    skills: [{
      type: 'OnKill',
      title: 'Rise',
      description: '',
      modifiers: { summonType: 'TriggerMinion', summonCount: 1, summonPattern: [[0, 1]] }
    }]
  });
  const fragile = definition('TriggerFragile', { attack: 1, health: 10 });
  const minion = definition('TriggerMinion', { attack: 1, health: 20 });
  const { combat, catalog } = setup([summoner], [fragile], [minion]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const target = combat.state.dice.find((die) => die.ownerId === 'enemy');
  player.gridPosition = { row: 2, col: 4 };
  target.gridPosition = { row: 2, col: 0 };

  const resolution = resolve(combat, catalog);
  const summoned = resolution.state.dice.find((die) => die.typeId === 'TriggerMinion');

  assert.ok(summoned);
  assert.equal(summoned.ownerId, 'player');
});

test('Druidic Essence heals once per projectile', () => {
  const healer = definition('MultiHeal', {
    attack: 10,
    health: 1_000,
    skills: [{
      type: 'Passive',
      title: 'Druidic Essence',
      description: '',
      modifiers: { healOnAttack: true, projectileCount: 1, skillTargeting: 'Weakest' }
    }]
  });
  const ally = definition('Wounded', { attack: 1, health: 100 });
  const enemy = definition('Raider', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([healer, ally], [enemy]);
  const wounded = combat.state.dice.find((die) => die.typeId === 'Wounded');
  wounded.currentHealth = 10;

  const resolution = resolve(combat, catalog);
  const healed = resolution.state.dice.find((die) => die.typeId === 'Wounded');

  assert.ok(healed.currentHealth >= 30);
  assert.ok(resolution.events.some((event) => (
    event.kind === 'attack' && event.text.includes('heals Wounded 2 times')
  )));
});

test('Furious Claw adds its range-gated strike to a normal attack', () => {
  const run = (targetCol) => {
    const leon = definition('LeonNormal', {
      attack: 40,
      health: 1_000,
      range: 4,
      skills: [{
        type: 'Passive',
        title: 'Furious Claw',
        description: '',
        modifiers: { attackCount: 1, criticalChanceIncrease: 0.2, skillRangeThreshold: 2 }
      }]
    });
    const target = definition('Target', { attack: 1, health: 1_000 });
    const { combat, catalog } = setup([leon], [target]);
    const player = combat.state.dice.find((die) => die.ownerId === 'player');
    const enemy = combat.state.dice.find((die) => die.ownerId === 'enemy');
    player.gridPosition = { row: 2, col: 4 };
    enemy.gridPosition = { row: 2, col: targetCol };
    return resolve(combat, catalog);
  };

  const near = run(1);
  const far = run(2);

  assert.ok(near.events.some((event) => event.text.includes('Furious Claw strikes')));
  assert.equal(far.events.some((event) => event.text.includes('Furious Claw strikes')), false);
});

test('missing-health healing rounds up like PvE', () => {
  const killer = definition('Killer', {
    attack: 10,
    health: 100,
    skills: [{
      type: 'OnKill',
      title: 'Feed',
      description: '',
      modifiers: { missingHealRate: 0.5 }
    }]
  });
  const target = definition('Target', { health: 1 });
  const { combat, catalog } = setup([killer], [target]);
  combat.state.dice.find((die) => die.ownerId === 'player').currentHealth = 99;

  const resolution = resolve(combat, catalog);
  const survivor = resolution.state.dice.find((die) => die.ownerId === 'player');

  assert.equal(survivor.currentHealth, 100);
  assert.ok(resolution.events.some((event) => event.kind === 'heal' && event.amount === 1));
});

test('basic healing chooses the lowest health ratio, not the lowest current health', () => {
  const healer = definition('Healer', {
    attack: 10,
    health: 1_000,
    skills: [{
      type: 'Passive',
      title: 'Druidic Essence',
      description: '',
      modifiers: { healOnAttack: true, skillTargeting: 'Weakest' }
    }]
  });
  const lowHealth = definition('LowHealth', { health: 100 });
  const lowRatio = definition('LowRatio', { health: 200 });
  const enemy = definition('Raider', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([healer, lowHealth, lowRatio], [enemy]);
  const lowHealthDie = combat.state.dice.find((die) => die.typeId === 'LowHealth');
  const lowRatioDie = combat.state.dice.find((die) => die.typeId === 'LowRatio');
  lowHealthDie.currentHealth = 30;
  lowRatioDie.currentHealth = 40;

  const resolution = resolve(combat, catalog);

  assert.equal(resolution.state.dice.find((die) => die.typeId === 'LowHealth').currentHealth, 30);
  assert.equal(resolution.state.dice.find((die) => die.typeId === 'LowRatio').currentHealth, 50);
});

test('untimed on-damaged shields survive the end of the round', () => {
  const plated = definition('Plated', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'OnDamaged',
      title: 'Heavy Plating',
      description: '',
      modifiers: { shield: 20 }
    }]
  });
  const enemy = definition('Raider', { attack: 5, health: 1_000 });
  const { combat, catalog } = setup([plated], [enemy]);

  const resolution = resolve(combat, catalog);
  const target = resolution.state.dice.find((die) => die.typeId === 'Plated');

  assert.equal(target.shieldTurns, 0);
  assert.equal(target.shieldHp, 20);
});

test('typed transform skill rows replace the base skill instead of merging it', () => {
  const shifter = definition('Shifter', {
    attack: 10,
    health: 1_000,
    skills: [
      {
        type: 'Passive',
        title: 'Druidic Essence',
        description: '',
        modifiers: { healOnAttack: true, skillTargeting: 'Weakest' }
      },
      { type: 'Active', title: 'Shift', description: '', manaNeeded: 1, modifiers: { transformToNextForm: true } }
    ],
    transformStats: [{
      title: 'Shifter Form',
      attack: 10,
      health: 1_000,
      skills: [
        { type: 'OnTransformed', title: 'Maul', description: '', modifiers: {} },
        {}
      ]
    }]
  });
  const ally = definition('Wounded', { health: 100 });
  const enemy = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([shifter, ally], [enemy]);
  const player = combat.state.dice.find((die) => die.typeId === 'Shifter');
  const wounded = combat.state.dice.find((die) => die.typeId === 'Wounded');
  player.pips = 1;
  player.mana['Shift:0'] = 1;
  wounded.currentHealth = 50;

  const resolution = resolve(combat, catalog);

  assert.equal(resolution.state.dice.find((die) => die.typeId === 'Target').currentHealth, 990);
  assert.equal(resolution.state.dice.find((die) => die.typeId === 'Wounded').currentHealth, 50);
});

test('target health bonuses are reduced against boss dice like PvE', () => {
  const crusher = definition('Crusher', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Passive',
      title: 'Crush Armor',
      description: '',
      modifiers: { targetCurrentHpBonusRate: 0.12 }
    }]
  });
  const boss = definition('Boss', { attack: 1, health: 1_000, isBoss: true });
  const { combat, catalog } = setup([crusher], [boss]);

  const resolution = resolve(combat, catalog);
  const target = resolution.state.dice.find((die) => die.typeId === 'Boss');

  assert.ok(target.currentHealth >= 930, `expected boss mitigation, got ${target.currentHealth}`);
  assert.ok(target.currentHealth <= 969, `expected boss mitigation, got ${target.currentHealth}`);
});

test('poison stacks sum their damage and expire independently', () => {
  const poisoner = definition('Poisoner', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Active',
      title: 'Toxic Mark',
      description: '',
      manaNeeded: 1,
      modifiers: {
        poisonDamage: 25,
        statusDuration: 3,
        statusEffect: 'poison',
        criticalChanceIncrease: -1
      }
    }]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([poisoner], [target]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const enemy = combat.state.dice.find((die) => die.ownerId === 'enemy');

  const placeForTurn = () => {
    player.zone = 'board';
    player.gridPosition = { row: 1, col: 4 };
    player.pips = 1;
    enemy.zone = 'board';
    enemy.gridPosition = { row: 1, col: 0 };
    enemy.pips = 1;
    player.mana['Toxic Mark:0'] = 1;
    combat.state.turn += 1;
  };

  placeForTurn();
  resolve(combat, catalog);
  assert.equal(enemy.currentHealth, 975);
  assert.equal(enemy.mana['status:poison'], 1);
  assert.equal(enemy.mana.poisonAmount, 25);

  placeForTurn();
  resolve(combat, catalog);
  assert.equal(enemy.currentHealth, 925);
  assert.equal(enemy.mana['status:poison'], 2);
  assert.equal(enemy.mana.poisonAmount, 50);

  placeForTurn();
  resolve(combat, catalog);
  assert.equal(enemy.currentHealth, 850);
  assert.equal(enemy.mana['status:poison'], 2);
  assert.equal(enemy.mana.poisonAmount, 50);
  assert.equal(enemy.poisonStacks.length, 2);
});

test('poison ticks fire on-damaged hooks with the poison source', () => {
  const poisoner = definition('Poisoner', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Active',
      title: 'Toxic Mark',
      description: '',
      manaNeeded: 1,
      modifiers: { poisonDamage: 25, statusDuration: 1, statusEffect: 'poison' }
    }]
  });
  const target = definition('Plated', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'OnDamaged',
      title: 'Heavy Plating',
      description: '',
      modifiers: { shield: 20 }
    }]
  });
  const { combat, catalog } = setup([poisoner], [target]);
  combat.state.dice.find((die) => die.ownerId === 'player').mana['Toxic Mark:0'] = 1;

  const resolution = resolve(combat, catalog);
  const shield = resolution.state.dice.find((die) => die.typeId === 'Plated');

  assert.equal(shield.shieldHp, 20);
});

test('slow stack durations expire independently', () => {
  const freezer = definition('Freezer', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Active',
      title: 'Chill Lock',
      description: '',
      manaNeeded: 1,
      modifiers: { attackDelta: -1, maxStacks: 3, statusDuration: 3, statusEffect: 'slow' }
    }]
  });
  const target = definition('Target', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([freezer], [target]);
  const player = combat.state.dice.find((die) => die.ownerId === 'player');
  const enemy = combat.state.dice.find((die) => die.ownerId === 'enemy');

  const placeForTurn = () => {
    player.zone = 'board';
    player.gridPosition = { row: 1, col: 4 };
    player.pips = 1;
    enemy.zone = 'board';
    enemy.gridPosition = { row: 1, col: 0 };
    enemy.pips = 1;
    player.mana['Chill Lock:0'] = 1;
    combat.state.turn += 1;
  };

  placeForTurn();
  resolve(combat, catalog);
  assert.equal(enemy.attackDelta, -1);

  placeForTurn();
  resolve(combat, catalog);
  assert.equal(enemy.attackDelta, -2);

  placeForTurn();
  resolve(combat, catalog);
  assert.equal(enemy.attackDelta, -2);
  assert.equal(enemy.slowStacks.length, 2);
  assert.equal(enemy.mana['status:slow'], 2);
});

test('active rapid-fire adds passive rapid-fire increase and fires each shot', () => {
  const shooter = definition('SlugfestParity', {
    attack: 1,
    health: 1_000,
    skills: [
      {
        type: 'Passive',
        title: 'Rapid Chamber',
        description: '',
        modifiers: { rapidFireIncrease: 1 }
      },
      {
        type: 'Active',
        title: 'Slugfest',
        description: '',
        manaNeeded: 1,
        modifiers: { rapidFireCount: 3, skillDamage: 10 }
      }
    ]
  });
  const target = definition('SlugfestTarget', { attack: 1, health: 1_000 });
  const { combat, catalog } = setup([shooter], [target]);
  combat.state.dice.find((die) => die.typeId === 'SlugfestParity').mana['Slugfest:0'] = 1;

  const resolution = resolve(combat, catalog);
  const targetAfter = resolution.state.dice.find((die) => die.typeId === 'SlugfestTarget');

  assert.equal(targetAfter.currentHealth, 960);
  assert.ok(resolution.events.some((event) => event.text.includes('fires 4 shots')));
});

test('active instakill bypasses shields on non-boss targets', () => {
  const reaper = definition('ReaperParity', {
    attack: 1,
    health: 1_000,
    skills: [{
      type: 'Active',
      title: 'Reap',
      description: '',
      manaNeeded: 1,
      modifiers: { instakill: true }
    }]
  });
  const target = definition('ReapTarget', { attack: 1, health: 5_000 });
  const { combat, catalog } = setup([reaper], [target]);
  const reaperDie = combat.state.dice.find((die) => die.typeId === 'ReaperParity');
  const targetDie = combat.state.dice.find((die) => die.typeId === 'ReapTarget');
  reaperDie.mana['Reap:0'] = 1;
  targetDie.shieldHp = 100;

  const resolution = resolve(combat, catalog);
  const defeatedTarget = resolution.state.dice.find((die) => die.typeId === 'ReapTarget');

  assert.equal(defeatedTarget.isDestroyed, true);
  assert.equal(defeatedTarget.currentHealth, 0);
  assert.ok(resolution.events.some((event) => event.text.includes('instantly defeats ReapTarget')));
});
