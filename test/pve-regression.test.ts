import assert from 'node:assert/strict';
import test from 'node:test';
import { applyClassProgression } from '../src/systems/ClassProgression';
import { executeRevengeSkillEffects } from '../src/systems/CombatSkills';
import { resolvePlagueSpawn } from '../src/systems/Plague';
import type { DiceDefinition, DiceInstanceState } from '../src/types/game';

const zombie: DiceDefinition = {
  typeId: 'Zombie',
  title: 'Zombie Dice',
  attack: 500,
  health: 840,
  range: 3,
  footprint: 1,
  targetingMode: 'Nearest',
  rarity: 'Epic',
  accent: '#7d927f',
  skills: [{
    type: 'OnKill',
    title: 'Zombie Pandemic',
    description: '',
    modifiers: {
      hasPlague: true,
      plaguedDieType: 'Zombie',
      plaguedDieHealth: 0.3,
      plaguedDieAttack: 0.6
    }
  }]
};

test('PvE plague keeps the defeated tile and rolled pips while class-scaling attack', () => {
  const spawn = resolvePlagueSpawn({
    baseDefinition: zombie,
    classLevel: 2,
    healthRate: 0.3,
    attackRate: 0.6,
    defeatedMaxHealth: 10,
    defeatedPips: 5,
    defeatedPosition: { row: 3, col: 2 },
    footprint: 1,
    gridSize: 5,
    isAvailable: () => true
  });

  assert.ok(spawn);
  assert.deepEqual(spawn.position, { row: 3, col: 2 });
  assert.equal(spawn.pips, 5);
  assert.equal(spawn.maxHealth, 3);
  assert.equal(spawn.definition.attack, 330);
});

test('PvE revenge requires hasRevenge and uses the passive threshold', () => {
  const basilisk: DiceDefinition = {
    typeId: 'Basilisk',
    title: 'Basilisk Dice',
    attack: 40,
    health: 100,
    range: 4,
    targetingMode: 'Weakest',
    rarity: 'Mythic',
    accent: '#6abf69',
    skills: [{
      type: 'Passive',
      title: 'Rapacious Revenge',
      description: '',
      modifiers: {
        hasRevenge: true,
        revengeThresholdRate: 0.8,
        revengeHits: 2,
        revengeDamage: 7
      }
    }]
  };
  const die: DiceInstanceState = {
    instanceId: 'pve-basilisk',
    typeId: 'Basilisk',
    ownerId: 'enemy',
    zone: 'board',
    maxHealth: 100,
    currentHealth: 40,
    isDestroyed: false,
    hasFinishedAttacking: false,
    attacksRemaining: 1
  };

  const flagged = executeRevengeSkillEffects(die, basilisk, 1, 100, 40);
  assert.equal(flagged.revenge?.hits, 2);
  assert.equal(flagged.revenge?.damage, 7);
  assert.equal(flagged.revenge?.mode, 'Weakest');

  const unflagged = executeRevengeSkillEffects(die, {
    ...basilisk,
    skills: [{
      ...basilisk.skills[0],
      modifiers: {
        revengeThresholdRate: 0.8,
        revengeHits: 2,
        revengeDamage: 7
      }
    }]
  }, 1, 100, 40);
  assert.equal(unflagged.revenge, undefined);
});

test('PvE nuclear damage follows class scaling', () => {
  const nuclear: DiceDefinition = {
    typeId: 'Nuclear',
    title: 'Nuclear Dice',
    attack: 24,
    health: 700,
    range: 4,
    targetingMode: 'Furthest',
    rarity: 'Legendary',
    accent: '#e60026',
    skills: [{
      type: 'OnDeath',
      title: 'Nuclear Missile',
      description: '',
      modifiers: {
        hasNuclear: true,
        nuclearDamage: 600,
        nuclearArea: '3x3'
      }
    }]
  };

  assert.equal(applyClassProgression(nuclear, 2).skills[0]?.modifiers?.nuclearDamage, 660);
});
