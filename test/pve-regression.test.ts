import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { applyClassProgression, applyStatModifiers, applyTransformStats, BOSS_CLASS_STAT_MULTIPLIER, CLASS_UP_STAT_MULTIPLIER, getBossClassMultiplier, getClassBenefitValue, getClassScaledSkillDescription, getClassScaledTalentDescription, resolvePoolDamage } from '../src/systems/ClassProgression';
import { DUNGEON_BOSSES, DUNGEON_MINI_BOSSES, DUNGEON_BOSS_BERSERK_SKILL_MULTIPLIER, DUNGEON_CARRYOVER_DICE_CAP, DUNGEON_CARRYOVER_MANA_CAP, DUNGEON_CARRYOVER_STAT_CAP, DUNGEON_CARRYOVER_STACK_CAP, DUNGEON_FIRST_EVENT_KEY, DUNGEON_MAX_CLASS_LEVEL, DUNGEON_MODIFIERS, DUNGEON_REWARD_WAVES, canGrantDungeonCopyAmount, canUseDungeonCards, isLegacyDiceCardMode, getDungeonDifficulty, getDungeonEliteDieSides, getDungeonEliteSkillMultiplier, getDungeonEnemyCriticalChance, getDungeonEventWindow, getDungeonModifier, getDungeonMusicEffects, getDungeonNextWaveTurn, getDungeonStageReward, getDungeonSpeedMultiplier, getDungeonWaveSpec, normalizeDungeonCarryover, normalizeDungeonCopyAmount, pickDungeonCopyTypeId, resolveDungeonCarryoverInstanceIds, resolveDungeonWaveLoadout } from '../src/systems/DungeonEvent';
import { normalizeDungeonRun, saveDungeonRun } from '../src/systems/DungeonStore';
import { getHardDailyEnemyClassLevel, getSeededDailyIndex, getSeededDailyRange, getTopProfileDice } from '../src/systems/DailyChallenges';
import { getDungeonResultTransition } from '../src/systems/DungeonRunFlow';
import { applyDiceTalent, areTalentsSuppressedForChallenge } from '../src/systems/DiceTalents';
import { normalizeDiceCopyCount } from '../src/data/dice';
import { DUNGEON_INTRO_WAVES, getDungeonIntroForWave } from '../src/systems/DungeonIntros';
import { COMBAT_TIME_LIMIT_MS, getCombatTimeSpeedMultiplier } from '../src/systems/CombatPacing';
import { canOfferDiceCards, rollDiceCards } from '../src/systems/DiceCards';
import { applyDungeonCardStats, canShuffleDungeonCards, DUNGEON_CARD_MAX_STACKS, DUNGEON_SLUGFEST_SKILL, canAddDungeonCard, createDungeonCard, createDungeonCardState, ensureDungeonScopeMarks, getDungeonCardDamageMultiplier, getDungeonCardEffects, getDungeonCardKillsRequired, getDungeonCardMaxStacks, getDungeonCardPresentation, getDungeonCardRarityRoll, getDungeonCardShuffleCost, getDungeonCardStackCount, normalizeDungeonCardState, pickDungeonCard, registerDungeonCardKills, removeDungeonCardHealth, resolveDungeonCardHealthAdjustment, resolveDungeonCarryoverAttack, resolveDungeonCarryoverHealth, rollDungeonCardChoices } from '../src/systems/DungeonCards';
import { findAttackTarget, getTerminalBattleOwner } from '../src/systems/BattleState';
import { getCombatDistance } from '../src/systems/CombatRange';
import { getRuntimeSkillMeta, getRuntimeSkillMetaForTrigger } from '../src/systems/DiceSkills';
import { chooseInfiltratorPlacement, clampDamageReduction, collectCombatStartAuras, combineDamageReduction, computeCombatStartBonus, executeActiveSkillEffects, executeRevengeSkillEffects, formatActiveSkillActionLabel, formatCombatSkillLabel, formatRicochetAggregationLabel, getCombatStartManaEffect, getMaxHealthHealAmount, resolveMaxHealthGainCurrentHealth, MAX_DAMAGE_REDUCTION, resolvePlagueSpawn, resolveReviveStats } from '../src/systems/CombatSkills';
import type { DiceDefinition, DiceInstanceState, DicePoolDefinition, DiceSkillDefinition, MatchBattleState } from '../src/types/game';

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

test('PvE plague keeps the defeated tile and rolled pips with a 30% current-health fill', () => {
  const spawn = resolvePlagueSpawn({
    baseDefinition: zombie,
    classLevel: 2,
    healthRate: 0.3,
    attackRate: 0.6,
    defeatedPips: 5,
    defeatedPosition: { row: 3, col: 2 },
    defeatedBoardSide: 'enemy',
    footprint: 1,
    gridSize: 5,
    isAvailable: () => true
  });

  assert.ok(spawn);
  assert.deepEqual(spawn.position, { row: 3, col: 2 });
  assert.equal(spawn.boardSide, 'enemy');
  assert.equal(spawn.pips, 5);
  assert.equal(spawn.maxHealth, 924);
  assert.equal(spawn.currentHealth, 277);
  assert.equal(spawn.definition.health, 924);
  assert.equal(spawn.definition.attack, 330);
});

test('PvE revive keeps full max health while scaling current health and attack', () => {
  const stats = resolveReviveStats({
    maxHealth: 100,
    baseAttack: 10,
    healthRate: 0.5,
    attackRate: 0.8
  });

  assert.deepEqual(stats, { maxHealth: 100, currentHealth: 50, attack: 8 });
});

test('combat skill labels use the source die and formatted trigger type', () => {
  assert.equal(formatCombatSkillLabel('Healing', 'Active'), 'Healing (Active)');
  assert.equal(formatCombatSkillLabel('Healing', 'CombatStart'), 'Healing (Combat Start)');
  assert.equal(formatCombatSkillLabel('Druid', 'CombatEnd'), 'Druid (Combat End)');
  assert.equal(formatCombatSkillLabel('Armor', 'OnDamaged'), 'Armor (On Damaged)');
  assert.equal(formatCombatSkillLabel('Meteor', 'OnKill'), 'Meteor (On Kill)');
  assert.equal(formatCombatSkillLabel('Zombie', 'OnDeath'), 'Zombie (On Death)');
  assert.equal(formatCombatSkillLabel('Time', 'OnTransformed'), 'Time (On Transformed)');
});

test('active skill action labels tolerate missing titles and preserve details', () => {
  assert.equal(
    formatActiveSkillActionLabel('Enemy', 'Druid', "Nature's Wrath", ' (12 damage)'),
    "Enemy Druid uses Nature's Wrath (12 damage)!"
  );
  assert.equal(
    formatActiveSkillActionLabel('Player', 'Shield', undefined, ''),
    'Player Shield uses active skill!'
  );
});

test('Dungeon copy grants round to whole copies before capacity checks', () => {
  assert.equal(canGrantDungeonCopyAmount(5, 5, true), true);
  assert.equal(canGrantDungeonCopyAmount(6, 5, true), false);
  assert.equal(canGrantDungeonCopyAmount(6, 5, false), true);
  assert.equal(canGrantDungeonCopyAmount(7, 5, false), false);
  assert.equal(canGrantDungeonCopyAmount(5.4, 5, true), true);
  assert.equal(canGrantDungeonCopyAmount(5.5, 5.5, true), false);
  assert.equal(canGrantDungeonCopyAmount(5.6, 5.5, true), false);
  assert.equal(canGrantDungeonCopyAmount(1, 0, false), true);
  assert.equal(canGrantDungeonCopyAmount(0.6, 0, false), true);
  assert.equal(canGrantDungeonCopyAmount(0.4, 5, true), false);
  assert.equal(canGrantDungeonCopyAmount(16.667, 17, true), true);
  assert.equal(canGrantDungeonCopyAmount(0, 5, true), false);
  assert.equal(canGrantDungeonCopyAmount(Number.NaN, 5, true), false);

  assert.equal(normalizeDungeonCopyAmount(16.667), 17);
  assert.equal(normalizeDungeonCopyAmount(16.4), 16);
  assert.equal(normalizeDungeonCopyAmount(Number.NaN), 0);
});

test('dice copy storage normalizes fractions to whole copies', () => {
  assert.equal(normalizeDiceCopyCount(16.667), 17);
  assert.equal(normalizeDiceCopyCount(16.4), 16);
  assert.equal(normalizeDiceCopyCount(-4.2), 0);
  assert.equal(normalizeDiceCopyCount(Number.NaN), 0);
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

test('class benefits add configured metadata while damage keeps compound scaling', () => {
  const base: DiceDefinition = {
    typeId: 'BenefitTest',
    title: 'Benefit Test',
    attack: 100,
    health: 100,
    range: 1,
    rarity: 'Common',
    accent: '#ffffff',
    targetingMode: 'Nearest',
    skills: [{
      type: 'Passive',
      title: 'Configured Scaling',
      description: 'Hits for {modifiers.["skillDamage"]}, splashes {splashDamage}, and has {avoidAttackChance} avoidance.',
      modifiers: {
        skillDamage: 100,
        splashDamage: 10,
        avoidAttackChance: 0.1
      },
      classBenefits: {
        skillDamage: [0, 99, 99],
        avoidAttackChance: [0, 0.02, 0.04]
      }
    }]
  };

  const scaled = applyClassProgression(base, 3);
  const skill = scaled.skills[0];
  assert.equal(skill?.modifiers?.skillDamage, 121);
  assert.equal(skill?.modifiers?.splashDamage, 12);
  assert.equal(skill?.modifiers?.avoidAttackChance, 0.14);
  assert.equal(skill?.description, 'Hits for {modifiers.["skillDamage"]}, splashes {splashDamage}, and has {avoidAttackChance} avoidance.');
  assert.equal(getClassScaledSkillDescription(scaled, skill), 'Hits for 121, splashes 12, and has 14% avoidance.');
  assert.equal(getClassScaledSkillDescription(scaled, skill, 1.5), 'Hits for 182, splashes 18, and has 14% avoidance.');

  const capped = applyClassProgression(base, 15);
  assert.equal(capped.skills[0]?.modifiers?.avoidAttackChance, 0.14);
  assert.equal(getClassBenefitValue([0, 0.05], 15), 0.05);
});

test('talent and transform descriptions resolve indexed skill overlays', () => {
  const base: DiceDefinition = {
    typeId: 'Broken',
    title: 'Broken Dice',
    attack: 34,
    health: 500,
    range: 6,
    rarity: 'Uncommon',
    accent: '#c5a880',
    targetingMode: 'Random',
    skills: [{
      type: 'Passive',
      title: 'Fractured Volley',
      description: 'Attacks a random foe in range.'
    }]
  };
  const overlaySkills: DiceSkillDefinition[] = [
    {},
    {
      type: 'Active',
      title: 'Slugfest',
      description: 'Fires {rapidFireCount} shots for {skillDamage} damage each.',
      modifiers: { rapidFireCount: 8, skillDamage: 40 }
    }
  ];
  const talent = {
    title: 'Slugfest',
    description: 'Gains {modifiers[1].title} up to {modifiers[1].rapidFireCount} times for {modifiers[1].modifiers.skillDamage} damage. Also {modifiers.rapidFireCount}.',
    modifiers: { skills: overlaySkills }
  };

  const talentDefinition: DiceDefinition = { ...base, skills: [base.skills[0]!, overlaySkills[1]!] };
  assert.equal(
    getClassScaledTalentDescription(talentDefinition, talent, 1),
    'Gains Slugfest up to 8 times for 40 damage. Also 8.'
  );

  const transformedSkill: DiceSkillDefinition = {
    type: 'Passive',
    title: 'Transformed',
    description: 'Gains {modifiers[0].title}.',
    modifiers: {}
  };
  const transformedDefinition: DiceDefinition = { ...base, skills: [overlaySkills[1]!] };
  assert.equal(
    getClassScaledSkillDescription(transformedDefinition, transformedSkill, 1),
    'Gains Slugfest.'
  );
});

test('class scaling keeps a transform overlay description when the row only patches modifiers', () => {
  const base: DiceDefinition = {
    typeId: 'OverlayDescriptionTest',
    title: 'Overlay Description Test',
    attack: 100,
    health: 100,
    range: 1,
    rarity: 'Common',
    accent: '#ffffff',
    targetingMode: 'Nearest',
    skills: [{
      type: 'Passive',
      title: 'Beam',
      description: 'Deals {beamDamage} damage.',
      modifiers: { beamDamage: 100 }
    }],
    transformStats: [{
      title: 'Transformed',
      skills: [{
        modifiers: { beamDamage: 100, hasBeam: true }
      } as unknown as DiceSkillDefinition]
    }]
  };

  const scaled = applyClassProgression(base, 2);
  assert.equal(scaled.transformStats?.[0]?.skills?.[0]?.description, undefined);

  const transformed = applyTransformStats(scaled, 0);
  const skill = transformed.skills[0];
  assert.equal(skill?.type, 'Passive');
  assert.equal(skill?.title, 'Beam');
  assert.equal(skill?.description, 'Deals {beamDamage} damage.');
  assert.equal(getClassScaledSkillDescription(transformed, skill), 'Deals 110 damage.');
});

test('class benefits follow transform skills and locked descriptions can opt into placeholders', () => {
  const base: DiceDefinition = {
    typeId: 'TransformBenefit',
    title: 'Transform Benefit',
    attack: 10,
    health: 10,
    range: 1,
    rarity: 'Common',
    accent: '#ffffff',
    targetingMode: 'Nearest',
    skills: [{
      type: 'Passive',
      title: 'Base',
      description: 'Base form.',
      modifiers: { statusDuration: 1 },
      classBenefits: { statusDuration: [0, 1, 2] }
    }],
    transformStats: [{
      title: 'Transformed',
      skills: [{
        type: 'Passive',
        title: 'Transformed Skill',
        description: 'Lasts {statusDuration} turns.',
        modifiers: { statusDuration: 1 },
        classBenefits: { statusDuration: [0, 2, 4] }
      }]
    }]
  };

  const scaled = applyClassProgression(base, 2);
  assert.equal(scaled.transformStats?.[0]?.skills?.[0]?.modifiers?.statusDuration, 3);
  assert.equal(scaled.transformStats?.[0]?.skills?.[0]?.description, 'Lasts {statusDuration} turns.');
  assert.equal(getClassScaledSkillDescription(scaled, scaled.transformStats?.[0]?.skills?.[0]), 'Lasts 3 turns.');

  const locked = getClassScaledSkillDescription(base, {
    type: 'Passive',
    title: 'Locked',
    description: 'Has {avoidAttackChance} avoidance.',
    descriptionLocked: true,
    modifiers: { avoidAttackChance: 0.1 }
  });
  assert.equal(locked, 'Has 10% avoidance.');
});

test('Dungeon windows run Tuesday-Wednesday and Saturday-Sunday in UTC', () => {
  const tuesday = getDungeonEventWindow(new Date('2026-11-03T12:00:00.000Z'));
  assert.equal(tuesday.active, true);
  assert.equal(tuesday.label, 'TUE–WED');
  assert.equal(tuesday.eventKey, '2026-11-03');
  assert.equal(tuesday.startsAt, Date.UTC(2026, 10, 3));
  assert.equal(tuesday.endsAt, Date.UTC(2026, 10, 5));
  assert.equal(tuesday.nextStartsAt, Date.UTC(2026, 10, 7));

  const wednesday = getDungeonEventWindow(new Date('2026-11-04T23:59:59.000Z'));
  assert.equal(wednesday.active, true);
  assert.equal(wednesday.eventKey, '2026-11-03');
  assert.equal(wednesday.nextStartsAt, Date.UTC(2026, 10, 7));

  const thursday = getDungeonEventWindow(new Date('2026-11-05T00:00:00.000Z'));
  assert.equal(thursday.active, false);
  assert.equal(thursday.eventKey, '');
  assert.equal(thursday.nextStartsAt, Date.UTC(2026, 10, 7));

  const saturday = getDungeonEventWindow(new Date('2026-11-07T12:00:00.000Z'));
  assert.equal(saturday.active, true);
  assert.equal(saturday.label, 'SAT–SUN');
  assert.equal(saturday.nextStartsAt, Date.UTC(2026, 10, 10));

  const sunday = getDungeonEventWindow(new Date('2026-11-08T12:00:00.000Z'));
  assert.equal(sunday.active, true);
  assert.equal(sunday.eventKey, '2026-11-07');
  assert.equal(sunday.nextStartsAt, Date.UTC(2026, 10, 10));

  const monday = getDungeonEventWindow(new Date('2026-11-09T00:00:00.000Z'));
  assert.equal(monday.active, false);
  assert.equal(monday.nextStartsAt, Date.UTC(2026, 10, 10));
});

test('Dungeon waves add mini-bosses and bounded minion recruitment', () => {
  const expected: Record<number, number[]> = {
    1: [1, 1, 1],
    2: [2, 2, 3],
    3: [2, 2, 2, 5],
    4: [3, 3, 5, 5],
    6: [5, 5, 5, 7, 7],
    7: [6, 6, 7, 7, 9],
    8: [6, 6, 6, 7, 7, 9],
    9: [7, 7, 7, 8, 8, 10]
  };

  for (const [wave, classes] of Object.entries(expected)) {
    assert.deepEqual(getDungeonWaveSpec(Number(wave), '2026-11-03').enemyClasses, classes);
  }

  const wave5 = getDungeonWaveSpec(5, '2026-11-03');
  assert.equal(wave5.boss, null);
  assert.equal(wave5.bossRole, 'mini');
  assert.equal(wave5.bossLevel, 5);
  assert.equal(wave5.bossFootprint, 2);
  assert.ok(wave5.bossMinionType && DUNGEON_MINI_BOSSES.includes(wave5.bossMinionType));
  assert.equal(wave5.bossMinionLevel, 5);
  assert.equal(wave5.bossMinionFootprint, 2);
  assert.deepEqual(wave5.enemyClasses, [5, 4, 4, 6, 6, 6]);

  const wave10 = getDungeonWaveSpec(10, '2026-11-03');
  assert.equal(wave10.bossLevel, 5);
  assert.equal(wave10.bossRole, 'major');
  assert.equal(wave10.bossFootprint, 3);
  assert.equal(wave10.bossMinionType, null);
  assert.ok(wave10.boss && DUNGEON_BOSSES.includes(wave10.boss));
  assert.deepEqual(wave10.enemyClasses.slice(1), [9, 9, 9]);

  const bossLevels = new Map([
    [20, 10],
    [30, 15],
    [40, 20],
    [50, 25]
  ]);
  for (const [wave, level] of bossLevels) {
    const spec = getDungeonWaveSpec(wave, '2026-11-03');
    assert.equal(spec.bossLevel, level);
    assert.equal(spec.bossRole, 'major');
    assert.equal(spec.bossFootprint, 3);
    assert.equal(spec.enemyClasses[0], level);
    assert.ok(spec.enemyClasses.slice(1).every((classLevel) => classLevel <= 15));
  }
  assert.ok(getDungeonWaveSpec(40, '2026-11-03').enemyClasses[0] > 15);
  assert.ok(getDungeonWaveSpec(50, '2026-11-03').enemyClasses[0] > 15);
  for (const wave of [30, 40, 50]) {
    const spec = getDungeonWaveSpec(wave, '2026-11-03');
    assert.equal(spec.bossRole, 'major');
    assert.ok(spec.enemyClasses.slice(1).every((classLevel) => classLevel === DUNGEON_MAX_CLASS_LEVEL));
  }

  for (const wave of [5, 15, 25, 35, 45]) {
    const spec = getDungeonWaveSpec(wave, '2026-11-03');
    assert.equal(spec.boss, null);
    assert.equal(spec.bossRole, 'mini');
    assert.equal(spec.bossFootprint, 2);
    assert.equal(spec.bossLevel, wave);
    assert.ok(spec.bossMinionType && DUNGEON_MINI_BOSSES.includes(spec.bossMinionType));
    assert.equal(spec.bossMinionLevel, wave);
    assert.equal(spec.bossMinionFootprint, 2);
    assert.equal(spec.enemyClasses[0], wave);
    if (wave > 15) assert.ok(spec.enemyClasses[0] > 15);
  }

  for (let wave = 1; wave <= 50; wave++) {
    const spec = getDungeonWaveSpec(wave, '2026-11-03');
    spec.enemyClasses.forEach((classLevel, index) => {
      if (spec.bossRole && index === 0) return;
      assert.ok(classLevel <= 15);
    });
  }
});

test('Dungeon recruitment scales every third stage and each boss encounter', () => {
  const normalCounts: Array<[number, number]> = [[11, 6], [12, 6], [13, 7], [16, 8], [19, 9], [22, 10], [49, 19]];
  for (const [wave, count] of normalCounts) {
    assert.equal(getDungeonWaveSpec(wave, '2026-11-03').enemyClasses.length, count);
  }

  const encounterCounts: Array<[number, number]> = [[5, 6], [10, 4], [15, 9], [20, 8], [25, 14], [30, 12], [35, 18], [40, 17], [45, 22], [50, 17]];
  for (const [wave, count] of encounterCounts) {
    assert.equal(getDungeonWaveSpec(wave, '2026-11-03').enemyClasses.length, count);
  }

  for (let wave = 1; wave <= 50; wave++) {
    const spec = getDungeonWaveSpec(wave, '2026-11-03');
    const footprint = spec.bossFootprint ?? 0;
    const minionCount = spec.enemyClasses.length - (spec.bossRole ? 1 : 0);
    assert.ok(minionCount + footprint * footprint <= 25);
  }
});

test('Dungeon difficulty tiers raise elite criticals and dice sides', () => {
  assert.equal(getDungeonDifficulty(10), 'normal');
  assert.equal(getDungeonDifficulty(11), 'death-wave');
  assert.equal(getDungeonDifficulty(30), 'death-wave');
  assert.equal(getDungeonDifficulty(31), 'boss-berserk');
  assert.equal(getDungeonDifficulty(50), 'boss-berserk');
  assert.equal(getDungeonEnemyCriticalChance(10, false), 0.05);
  assert.equal(getDungeonEnemyCriticalChance(10, true), 0.05);
  assert.equal(getDungeonEnemyCriticalChance(11, false), 0.25);
  assert.equal(getDungeonEnemyCriticalChance(11, true), 0.25);
  assert.equal(getDungeonEnemyCriticalChance(31, false), 0.5);
  assert.equal(getDungeonEnemyCriticalChance(31, true), 0.5);
  assert.equal(getDungeonEliteDieSides(10), 6);
  assert.equal(getDungeonEliteDieSides(11), 12);
  assert.equal(getDungeonEliteDieSides(30), 12);
  assert.equal(getDungeonEliteDieSides(31), 20);
  assert.equal(getDungeonEliteSkillMultiplier(30), 1);
  assert.equal(getDungeonEliteSkillMultiplier(31), DUNGEON_BOSS_BERSERK_SKILL_MULTIPLIER);
});

test('Dungeon rewards are milestone-only and follow the five-wave reward table', () => {
  const rewardTable: Record<number, { currency: number[]; copies: Partial<Record<string, number>> }> = {
    5: { currency: [2_000, 20, 20], copies: { Common: 50, Uncommon: 30 } },
    10: { currency: [5_000, 50, 50], copies: { Common: 200, Uncommon: 150 } },
    15: { currency: [8_000, 80, 80], copies: { Common: 400, Uncommon: 300, Rare: 150, Epic: 30 } },
    20: { currency: [12_000, 120, 120], copies: { Common: 600, Uncommon: 450, Rare: 200, Epic: 50, Legendary: 1 } },
    25: { currency: [16_000, 160, 160], copies: { Common: 800, Uncommon: 600, Rare: 300, Epic: 75, Legendary: 5 } },
    30: { currency: [24_000, 240, 240], copies: { Common: 1_200, Uncommon: 800, Rare: 450, Epic: 125, Legendary: 8 } },
    35: { currency: [30_000, 300, 300], copies: { Common: 1_500, Uncommon: 1_000, Rare: 600, Epic: 150, Legendary: 10 } },
    40: { currency: [38_000, 380, 380], copies: { Common: 2_000, Uncommon: 1_500, Rare: 750, Epic: 200, Legendary: 15 } },
    45: { currency: [45_000, 450, 450], copies: { Common: 2_500, Uncommon: 1_750, Rare: 1_000, Epic: 250, Legendary: 20 } },
    50: { currency: [60_000, 600, 600], copies: { Common: 3_000, Uncommon: 2_000, Rare: 1_500, Epic: 350, Legendary: 25 } }
  };

  assert.deepEqual([...DUNGEON_REWARD_WAVES], Object.keys(rewardTable).map(Number));
  for (let wave = 1; wave <= 50; wave++) {
    const reward = getDungeonStageReward('2026-11-03', wave);
    assert.equal(reward.wave, wave);
    if (wave % 5 !== 0) {
      assert.deepEqual(reward.parts, []);
      continue;
    }
    const table = rewardTable[wave];
    assert.ok(table);
    assert.ok(reward.parts.length >= 2);
    const copyParts = reward.parts.filter((part) => part.kind === 'copies');
    const copyDivisor = copyParts.length > 1 ? copyParts.length : 1;
    const currency = reward.parts.find((part) => part.kind === 'tokens' || part.kind === 'chips' || part.kind === 'diamonds');
    assert.ok(currency);
    const currencyIndex = currency!.kind === 'tokens' ? 0 : currency!.kind === 'chips' ? 1 : 2;
    assert.equal(currency!.amount, table.currency[currencyIndex]!);
    copyParts.forEach((part) => {
      assert.ok(part.rarity);
      const base = table.copies[part.rarity!];
      assert.ok(base);
      assert.equal(part.amount, Math.round(base! / copyDivisor));
    });
    if (wave === 5) {
      assert.deepEqual(reward.parts.map((part) => `${part.kind}:${part.rarity ?? ''}:${part.amount}`), [
        'chips::20',
        'copies:Common:25',
        'copies:Uncommon:15'
      ]);
    }
  }

  assert.deepEqual(
    getDungeonStageReward('2026-11-03', 10),
    getDungeonStageReward('2026-11-03', 10)
  );
  const copy = pickDungeonCopyTypeId('2026-11-03', 10, ['Fire', 'Ice', 'Fire']);
  assert.ok(copy === 'Fire' || copy === 'Ice');
  assert.equal(copy, pickDungeonCopyTypeId('2026-11-03', 10, ['Ice', 'Fire']));
  assert.equal(copy, pickDungeonCopyTypeId('2026-11-03', 10, ['Ice', 'Fire'], 0));
  assert.equal(pickDungeonCopyTypeId('2026-11-03', 10, []), null);
});

test('Dungeon carryover normalization clamps hostile values and later waves require carryover', () => {
  const hostileDie = {
    instanceId: 'player-Hostile-1',
    typeId: 'Fire',
    classLevel: 999,
    currentHealth: 12.5,
    maxHealth: 100.25,
    isDestroyed: false,
    mana: 1e15,
    activeMana: Array.from({ length: 40 }, (_, index) => [`slot:${index}`, 1e15] as [string, number]),
    statuses: {
      poison: { stacks: Array.from({ length: 100 }, () => ({ damage: 3.25, turns: 1e15 })) },
      slow: {
        delta: 1e15,
        turns: 1e15,
        stacks: Array.from({ length: 100 }, () => ({ delta: -1e15, turns: 1e15 }))
      },
      time: Array.from({ length: 100 }, () => ({ effect: 'acceleration' as const, turns: 1e15, sourceInstanceId: 'player-Source-1' })),
      fracture: { rate: 1e15, turns: 1e15 },
      stun: 1e15,
      disorientation: 1e15,
      shield: { hp: 50.5, turns: 1e15 }
    },
    attackCountBuff: { extra: 1e15, turns: 1e15 },
    projectileCountBuff: { count: 1e15, turns: 1e15 },
    manaPausedTurns: 1e15,
    reviveCount: 1e15,
    soulCount: 1e15,
    attack: 12.75,
    growthDelta: -1e15,
    basicAttackDamage: 2.5
  };
  const carryover = normalizeDungeonCarryover({
    turn: 1e15,
    diceCardPicksUsed: 1e15,
    dice: Array.from({ length: 120 }, (_, index) => ({ ...hostileDie, instanceId: `player-Hostile-${index}` }))
  });

  assert.ok(carryover);
  assert.equal(carryover.turn, 1_000_000);
  assert.equal(carryover.diceCardPicksUsed, 9_999);
  assert.equal(carryover.dice.length, DUNGEON_CARRYOVER_DICE_CAP);
  const die = carryover.dice[0]!;
  assert.equal(die.classLevel, DUNGEON_MAX_CLASS_LEVEL);
  assert.equal(die.maxHealth, 100.25);
  assert.equal(die.currentHealth, 12.5);
  assert.equal(die.mana, DUNGEON_CARRYOVER_MANA_CAP);
  assert.equal(die.activeMana.length, 32);
  assert.equal(die.activeMana[0]?.[1], DUNGEON_CARRYOVER_MANA_CAP);
  assert.equal(die.statuses.poison?.stacks.length, DUNGEON_CARRYOVER_STACK_CAP);
  assert.equal(die.statuses.slow?.stacks?.length, DUNGEON_CARRYOVER_STACK_CAP);
  assert.equal(die.statuses.time?.length, DUNGEON_CARRYOVER_STACK_CAP);
  assert.equal(die.statuses.fracture?.rate, 10);
  assert.equal(die.statuses.poison?.stacks[0]?.damage, 3.25);
  assert.equal(die.statuses.shield?.hp, 50.5);
  assert.equal(die.attackCountBuff?.extra, 999);
  assert.equal(die.projectileCountBuff?.count, 999);
  assert.equal(die.manaPausedTurns, 999);
  assert.equal(die.reviveCount, 999);
  assert.equal(die.soulCount, 999);
  assert.equal(die.attack, 12.75);
  assert.equal(die.growthDelta, -1e15);
  assert.equal(die.basicAttackDamage, 2.5);

  const capped = normalizeDungeonCarryover({
    turn: 1,
    dice: [{
      ...hostileDie,
      maxHealth: Number.MAX_VALUE,
      currentHealth: Number.MAX_VALUE,
      attack: Number.MAX_VALUE,
      basicAttackDamage: Number.MAX_VALUE,
      statuses: { shield: { hp: Number.MAX_VALUE, turns: 1 } }
    }]
  });
  assert.ok(capped);
  assert.equal(capped.dice[0]?.maxHealth, DUNGEON_CARRYOVER_STAT_CAP);
  assert.equal(capped.dice[0]?.currentHealth, DUNGEON_CARRYOVER_STAT_CAP);
  assert.equal(capped.dice[0]?.attack, DUNGEON_CARRYOVER_STAT_CAP);
  assert.equal(capped.dice[0]?.basicAttackDamage, DUNGEON_CARRYOVER_STAT_CAP);
  assert.equal(capped.dice[0]?.statuses.shield?.hp, DUNGEON_CARRYOVER_STAT_CAP);

  assert.equal(normalizeDungeonRun({
    eventKey: '2026-11-03',
    wave: 2,
    carryover: null,
    config: { randomMode: false, randomizeLoadout: false, useLevelling: true },
    savedAt: 1
  }), null);
  assert.ok(normalizeDungeonRun({
    eventKey: '2026-11-03',
    wave: 1,
    carryover: null,
    config: { randomMode: false, randomizeLoadout: false, useLevelling: true },
    savedAt: 1
  }));
});

test('Dungeon carryover drops orphaned summon parents', () => {
  const parent = {
    instanceId: 'player-Fire-1',
    typeId: 'Fire',
    classLevel: 1,
    currentHealth: 100,
    maxHealth: 100,
    isDestroyed: false,
    mana: 0,
    activeMana: [] as Array<[string, number]>,
    statuses: {}
  };
  const valid = normalizeDungeonCarryover({
    turn: 1,
    dice: [
      parent,
      { ...parent, instanceId: 'player-Fire-summon', summonedByInstanceId: 'player-Fire-1' }
    ]
  });
  assert.ok(valid);
  assert.equal(valid.dice[1]?.summonedByInstanceId, 'player-Fire-1');

  const orphaned = normalizeDungeonCarryover({
    turn: 1,
    dice: [{ ...parent, instanceId: 'player-Fire-orphan', summonedByInstanceId: 'missing-parent' }]
  });
  assert.ok(orphaned);
  assert.equal(orphaned.dice[0]?.summonedByInstanceId, undefined);

  const selfParented = normalizeDungeonCarryover({
    turn: 1,
    dice: [{ ...parent, instanceId: 'player-Fire-self', summonedByInstanceId: 'player-Fire-self' }]
  });
  assert.ok(selfParented);
  assert.equal(selfParented.dice[0]?.summonedByInstanceId, undefined);
});

test('Dungeon save reports storage failure while retaining the in-memory run', () => {
  const entries = new Map<string, unknown>();
  const scene = {
    registry: {
      set: (key: string, value: unknown) => entries.set(key, value),
      get: (key: string) => entries.get(key),
      remove: (key: string) => entries.delete(key)
    }
  } as unknown as Parameters<typeof saveDungeonRun>[0];
  const saved = saveDungeonRun(scene, {
    eventKey: '2026-11-03',
    wave: 1,
    carryover: null,
    config: { randomMode: false, randomizeLoadout: false, useLevelling: true },
    savedAt: 1
  });
  assert.equal(saved, false);
  assert.ok(entries.has('arena:dungeonRun'));
});

test('Dungeon two-wave save, resume, carryover, and result flow', () => {
  const eventKey = '2026-11-03';
  const firstClear = getDungeonResultTransition('victory', 1);
  assert.equal(firstClear.completed, false);
  assert.equal(firstClear.captureCarryover, true);
  assert.equal(firstClear.persistWave, 2);
  assert.equal(firstClear.nextWave, 2);
  assert.equal(firstClear.clearRun, false);

  const carryover = normalizeDungeonCarryover({
    turn: 3,
    dice: [{
      instanceId: 'player-Fire-1',
      typeId: 'Fire',
      classLevel: 2,
      currentHealth: 77,
      maxHealth: 100,
      isDestroyed: false,
      mana: 4,
      activeMana: [['Flame:0', 2]],
      statuses: { shield: { hp: 5, turns: 2 } },
      growthDelta: 1,
      attack: 22
    }]
  });
  assert.ok(carryover);

  const savedRun = normalizeDungeonRun({
    eventKey,
    wave: firstClear.persistWave!,
    carryover,
    config: { randomMode: true, randomizeLoadout: false, useLevelling: true },
    savedAt: 123
  });
  assert.ok(savedRun);
  assert.equal(savedRun.wave, 2);
  assert.equal(savedRun.carryover?.dice[0]?.currentHealth, 77);
  assert.equal(savedRun.carryover?.dice[0]?.statuses.shield?.turns, 2);
  assert.equal(savedRun.config.randomMode, true);

  const resumedRun = normalizeDungeonRun(savedRun);
  assert.ok(resumedRun);
  assert.equal(resumedRun.wave, 2);
  assert.equal(resumedRun.carryover?.dice[0]?.classLevel, 2);
  assert.equal(resumedRun.carryover?.dice[0]?.attack, 22);
  assert.equal(getDungeonNextWaveTurn(resumedRun.carryover!.turn), 4);

  const secondClear = getDungeonResultTransition('victory', resumedRun.wave);
  assert.equal(secondClear.persistWave, 3);
  assert.equal(secondClear.captureCarryover, true);
  const defeat = getDungeonResultTransition('defeat', resumedRun.wave);
  assert.deepEqual(defeat, {
    completed: false,
    clearedWave: 1,
    rewardWave: null,
    captureCarryover: false,
    persistWave: null,
    nextWave: null,
    clearRun: true
  });
  const completed = getDungeonResultTransition('victory', 50);
  assert.equal(completed.completed, true);
  assert.equal(completed.rewardWave, 50);
  assert.equal(completed.nextWave, null);
  assert.equal(completed.clearRun, true);
});

test('pool damage follows the caster class-up curve and hardens malformed values', () => {
  assert.equal(resolvePoolDamage(50, 1, false), 50);
  assert.equal(resolvePoolDamage(50, 2, false), 55);
  assert.equal(resolvePoolDamage(100, 5, true), 207);
  assert.equal(resolvePoolDamage(50, 50, false), 190);
  assert.equal(resolvePoolDamage(50, Number.NaN, false), 50);
  assert.equal(resolvePoolDamage(Number.NaN, 5, false), 0);
  assert.equal(resolvePoolDamage(undefined, 1, false), 0);
});

test('boss class scaling is not capped at class 15', () => {
  const boss: DiceDefinition = {
    typeId: 'DungeonBossScaling',
    title: 'Dungeon Boss Scaling',
    attack: 1000,
    health: 1000,
    range: 1,
    rarity: 'Mythic',
    accent: '#ffffff',
    targetingMode: 'Nearest',
    isBoss: true,
    skills: []
  };
  const scaledBoss = applyClassProgression(boss, 20);
  const scaledMinion = applyClassProgression({ ...boss, isBoss: false }, 20);
  const scaledEliteMinion = applyClassProgression({ ...boss, isBoss: false }, 20, { uncapped: true });
  assert.equal(scaledBoss.attack, Math.round(1000 * BOSS_CLASS_STAT_MULTIPLIER ** 19));
  assert.equal(scaledMinion.attack, Math.round(1000 * CLASS_UP_STAT_MULTIPLIER ** 14));
  assert.equal(scaledEliteMinion.attack, Math.round(1000 * CLASS_UP_STAT_MULTIPLIER ** 19));
  assert.ok(getBossClassMultiplier(20) > getBossClassMultiplier(15));
});

test('Info popup attack includes card damage multipliers and flat bonuses', () => {
  assert.equal(applyStatModifiers(100, 1, 25, 1.5), 188);
  assert.equal(applyStatModifiers(100, 1, 0, 2), 200);
  assert.equal(applyStatModifiers(Number.NaN, 1, Number.NaN, Number.NaN), 1);
});

test('Dungeon modifiers start with Classic and stay deterministic afterwards', () => {
  assert.equal(getDungeonModifier(DUNGEON_FIRST_EVENT_KEY), 'Classic');
  assert.equal(getDungeonModifier('2026-11-02'), 'Classic');
  const futureKeys = ['2026-11-07', '2026-11-10', '2026-11-14', '2026-11-17', '2026-11-21', '2026-11-24'];
  const picks = futureKeys.map((key) => getDungeonModifier(key));
  picks.forEach((modifier) => assert.ok(DUNGEON_MODIFIERS.includes(modifier)));
  assert.deepEqual(futureKeys.map((key) => getDungeonModifier(key)), picks);
  assert.ok(new Set(picks).size >= 3);
});

test('Dungeon dev override forces active cycles with deterministic refreshed keys', () => {
  const now = new Date('2026-11-04T12:00:00Z');
  const forced = getDungeonEventWindow(now, { forceActive: true });
  assert.equal(forced.active, true);
  assert.equal(forced.eventKey, DUNGEON_FIRST_EVENT_KEY);
  assert.equal(forced.label, 'DEV EVENT');
  assert.equal(forced.endsAt, null);

  const cycled = getDungeonEventWindow(now, { forceActive: true, cycle: 2.9 });
  assert.equal(cycled.active, true);
  assert.equal(cycled.eventKey, `${DUNGEON_FIRST_EVENT_KEY}:dev:2`);
  assert.equal(getDungeonEventWindow(now, { forceActive: true, cycle: 2 }).eventKey, cycled.eventKey);
  assert.ok(DUNGEON_MODIFIERS.includes(getDungeonModifier(cycled.eventKey)));
});

test('Dungeon wave carryover advances the turn and keeps card, growth, and summon state', () => {
  const fountain = { key: 'Fountain of Love:Gold', title: 'Fountain of Love', rarity: 'Gold', kind: 'Fountain of Love' };
  const carryover = normalizeDungeonCarryover({
    turn: 7,
    dice: [{
      instanceId: 'player-Growth-1',
      typeId: 'Growth',
      classLevel: 12,
      currentHealth: 400,
      maxHealth: 720,
      isDestroyed: false,
      mana: 2,
      activeMana: [],
      statuses: {},
      growthDelta: 3,
      basicAttackDamage: 50,
      attackCountBuff: { extra: 2, turns: 3 },
      projectileCountBuff: { count: 2, turns: 4 },
      manaPausedTurns: 2,
      reviveCount: 2,
      soulCount: 4,
      attack: 777,
      transformIndex: 0,
      transformDuration: 2
    }, {
      instanceId: 'player-Growth-necro-1',
      typeId: 'Growth',
      classLevel: 9,
      currentHealth: 0,
      maxHealth: 720,
      isDestroyed: true,
      mana: 0,
      activeMana: [],
      statuses: {}
    }],
    diceCards: [fountain, fountain, { key: 'Mana Potion:Bronze', title: 'Mana Potion', rarity: 'Bronze', kind: 'Mana Potion' }, { key: '', title: '', rarity: 'Gold', kind: 'Mana Potion' }, { key: 'Bad', title: 'Bad', rarity: 'Mythic', kind: 'Mana Potion' }],
    diceCardPicksUsed: 3,
    dungeonCards: {
      cards: [createDungeonCard('Dice Health', 'Common', 'Growth')],
      killsTowardNext: 2,
      cardsPicked: 1,
      pendingDraws: 1,
      shufflesUsed: 1,
      lastShuffleTurn: 7
    }
  });

  assert.ok(carryover);
  assert.equal(getDungeonNextWaveTurn(carryover.turn), 8);
  assert.equal(carryover.dice.length, 2);
  assert.equal(carryover.dice[0]?.growthDelta, 3);
  assert.equal(carryover.dice[0]?.basicAttackDamage, 50);
  assert.deepEqual(carryover.dice[0]?.attackCountBuff, { extra: 2, turns: 3 });
  assert.deepEqual(carryover.dice[0]?.projectileCountBuff, { count: 2, turns: 4 });
  assert.equal(carryover.dice[0]?.manaPausedTurns, 2);
  assert.equal(carryover.dice[0]?.reviveCount, 2);
  assert.equal(carryover.dice[0]?.soulCount, 4);
  assert.equal(carryover.dice[0]?.attack, 777);
  assert.equal(Object.prototype.hasOwnProperty.call(carryover.dice[0], 'transformIndex'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(carryover.dice[0], 'transformDuration'), false);
  assert.equal(carryover.dice[1]?.typeId, 'Growth');
  assert.equal(carryover.diceCards?.length, 2);
  assert.equal(carryover.diceCardPicksUsed, 3);
  assert.equal(carryover.dungeonCards?.cards.length, 1);
  assert.equal(carryover.dungeonCards?.cardsPicked, 1);
  assert.equal(carryover.dungeonCards?.pendingDraws, 1);
  assert.equal(carryover.dungeonCards?.lastShuffleTurn, 7);
  assert.equal(normalizeDungeonCarryover(null), null);
  assert.equal(normalizeDungeonCarryover({ turn: 1, dice: [] }), null);
});

test('Dungeon carryover keeps permanent transforms and drops timed ones', () => {
  const savedDie = {
    instanceId: 'player-Druid-1',
    typeId: 'Druid',
    currentHealth: 1400,
    maxHealth: 1400,
    isDestroyed: false,
    mana: 0,
    activeMana: [],
    statuses: {}
  };
  const permanent = normalizeDungeonCarryover({ turn: 3, dice: [{ ...savedDie, transformIndex: 0 }] });
  assert.equal(permanent?.dice[0]?.transformIndex, 0);

  const timed = normalizeDungeonCarryover({ turn: 3, dice: [{ ...savedDie, transformIndex: 0, transformDuration: 1 }] });
  assert.equal(Object.prototype.hasOwnProperty.call(timed?.dice[0], 'transformIndex'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(timed?.dice[0], 'transformDuration'), false);
});

test('Dungeon Cards stand down only for the legacy Dice Card random mode', () => {
  assert.equal(canUseDungeonCards('Classic'), true);
  assert.equal(canUseDungeonCards('DiceCard'), false);
  assert.equal(isLegacyDiceCardMode('DiceCard'), true);
  DUNGEON_MODIFIERS.filter((modifier) => modifier !== 'DiceCard').forEach((modifier) => {
    assert.equal(isLegacyDiceCardMode(modifier), false);
    assert.equal(canUseDungeonCards(modifier), true);
  });
});

test('Dungeon Cards use the weighted rarity bands', () => {
  assert.equal(getDungeonCardRarityRoll(() => 0), 'Common');
  assert.equal(getDungeonCardRarityRoll(() => 0.5499), 'Common');
  assert.equal(getDungeonCardRarityRoll(() => 0.55), 'Rare');
  assert.equal(getDungeonCardRarityRoll(() => 0.8499), 'Rare');
  assert.equal(getDungeonCardRarityRoll(() => 0.85), 'Epic');
  assert.equal(getDungeonCardRarityRoll(() => 0.9749), 'Epic');
  assert.equal(getDungeonCardRarityRoll(() => 0.975), 'Legendary');
  assert.equal(getDungeonCardRarityRoll(() => 1), 'Legendary');
});

test('Dungeon Cards stack additively to three copies and body shifters are unique per die type', () => {
  let state = createDungeonCardState();
  state.pendingDraws = 20;
  const health = createDungeonCard('Dice Health', 'Common', 'Fire');
  for (let i = 0; i < DUNGEON_CARD_MAX_STACKS; i++) state = pickDungeonCard(state, health);
  assert.equal(getDungeonCardStackCount(state, health), 3);
  assert.equal(canAddDungeonCard(state, health), false);
  const beforeExtra = state;
  state = pickDungeonCard(state, health);
  assert.equal(state.cards.length, beforeExtra.cards.length);
  assert.equal(getDungeonCardEffects(state, 'Fire').healthBonusRate, 1.5);

  state = pickDungeonCard(state, createDungeonCard('Dice Attack', 'Rare', 'Fire'));
  assert.equal(getDungeonCardEffects(state, 'Fire').attackBonusRate, 0.5);
  assert.equal(getDungeonCardEffects(state, 'Ice').attackBonusRate, 0);

  const body = createDungeonCard('Dice Body Shifter', 'Rare', 'Fire');
  state = pickDungeonCard(state, body);
  assert.equal(getDungeonCardEffects(state, 'Fire').bodySides, 9);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Dice Body Shifter', 'Epic', 'Fire')), false);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Dice Body Shifter', 'Epic', 'Ice')), true);
});

test('Dungeon Card attack stays a single outgoing-damage multiplier', () => {
  let state = createDungeonCardState();
  state.pendingDraws = 10;
  state = pickDungeonCard(state, createDungeonCard('Dice Attack', 'Rare', 'Fire'));
  const effects = getDungeonCardEffects(state, 'Fire');
  assert.equal(effects.attackBonusRate, 0.5);
  assert.equal(getDungeonCardDamageMultiplier(effects), 1.5);
  assert.equal(getDungeonCardDamageMultiplier(undefined), 1);

  const definition: DiceDefinition = {
    typeId: 'Fire',
    title: 'Fire Dice',
    attack: 40,
    health: 1000,
    range: 2,
    targetingMode: 'Nearest',
    rarity: 'Common',
    accent: '#ff8a3d',
    skills: []
  };
  assert.equal(applyDungeonCardStats(definition, effects).attack, 40);
  assert.equal(
    getClassScaledSkillDescription(
      applyDungeonCardStats(definition, effects),
      { type: 'Active', title: 'Blast', description: 'Deals {skillDamage} damage.', modifiers: { skillDamage: 100 } },
      getDungeonCardDamageMultiplier(effects)
    ),
    'Deals 150 damage.'
  );
});

test('Dungeon Card health applies once when a die transforms', () => {
  let state = createDungeonCardState();
  state.pendingDraws = 10;
  state = pickDungeonCard(state, createDungeonCard('Dice Health', 'Legendary', 'Druid'));
  const effects = getDungeonCardEffects(state, 'Druid');
  assert.equal(effects.healthBonusRate, 1.5);

  const base: DiceDefinition = {
    typeId: 'Druid',
    title: 'Druid Dice',
    attack: 36,
    health: 600,
    range: 5,
    targetingMode: 'Nearest',
    rarity: 'Legendary',
    accent: '#6ec97a',
    skills: [],
    transformStats: [{ title: 'Druid Bear', attack: 50, health: 1400, range: 2 }]
  };

  const transformed = applyTransformStats(base, 0);
  assert.equal(transformed.health, 1400);
  const effective = applyDungeonCardStats(transformed, effects);
  assert.equal(effective.health, 3500);
  assert.equal(removeDungeonCardHealth(effective, effects).health, 1400);
  assert.equal(applyDungeonCardStats(removeDungeonCardHealth(effective, effects), effects).health, 3500);
});

test('Dungeon Card health survives an immediate revive without double scaling', () => {
  let state = createDungeonCardState();
  state.pendingDraws = 10;
  state = pickDungeonCard(state, createDungeonCard('Dice Health', 'Legendary', 'Druid'));
  const effects = getDungeonCardEffects(state, 'Druid');

  const base: DiceDefinition = {
    typeId: 'Druid',
    title: 'Druid Dice',
    attack: 36,
    health: 600,
    range: 5,
    targetingMode: 'Nearest',
    rarity: 'Legendary',
    accent: '#6ec97a',
    skills: []
  };
  const beforeDefinition = applyDungeonCardStats(base, effects);
  assert.equal(beforeDefinition.health, 1500);

  const revive = resolveReviveStats({
    maxHealth: beforeDefinition.health,
    baseAttack: beforeDefinition.attack,
    healthRate: 0.5,
    attackRate: 0.8
  });
  const stored = removeDungeonCardHealth({ ...beforeDefinition, attack: revive.attack, health: revive.maxHealth }, effects);
  assert.equal(stored.health, 600);
  assert.equal(stored.attack, 29);
  assert.equal(applyDungeonCardStats(stored, effects).health, 1500);
  assert.equal(revive.currentHealth, 750);
});

test('Dungeon Card health stays single-scaled through soul boosts', () => {
  let state = createDungeonCardState();
  state.pendingDraws = 10;
  state = pickDungeonCard(state, createDungeonCard('Dice Health', 'Legendary', 'Druid'));
  const effects = getDungeonCardEffects(state, 'Druid');

  const base: DiceDefinition = {
    typeId: 'Druid',
    title: 'Druid Dice',
    attack: 36,
    health: 600,
    range: 5,
    targetingMode: 'Nearest',
    rarity: 'Legendary',
    accent: '#6ec97a',
    skills: []
  };
  const totalBoost = 0.3;
  const classMultiplier = 1.2;
  const boostedHealth = Math.round(base.health * (1 + totalBoost) * classMultiplier);
  const boosted: DiceDefinition = {
    ...base,
    attack: Math.round(base.attack * (1 + totalBoost) * classMultiplier),
    health: boostedHealth
  };

  const effectiveMaxHealth = applyDungeonCardStats(boosted, effects).health;
  assert.equal(boostedHealth, 936);
  assert.equal(effectiveMaxHealth, 2340);
  assert.equal(removeDungeonCardHealth({ ...boosted, health: effectiveMaxHealth }, effects).health, boostedHealth);
  assert.equal(applyDungeonCardStats(removeDungeonCardHealth({ ...boosted, health: effectiveMaxHealth }, effects), effects).health, effectiveMaxHealth);

  const previousMaxHealth = 1500;
  const previousCurrentHealth = 900;
  assert.equal(Math.round(effectiveMaxHealth * (previousCurrentHealth / previousMaxHealth)), 1404);
});

test('Dungeon Card health applies once to a plague spawn', () => {
  let state = createDungeonCardState();
  state.pendingDraws = 10;
  state = pickDungeonCard(state, createDungeonCard('Dice Health', 'Legendary', 'Zombie'));
  const effects = getDungeonCardEffects(state, 'Zombie');

  const spawn = resolvePlagueSpawn({
    baseDefinition: zombie,
    classLevel: 2,
    healthRate: 0.3,
    attackRate: 0.6,
    defeatedPips: 5,
    defeatedPosition: { row: 3, col: 2 },
    defeatedBoardSide: 'enemy',
    footprint: 1,
    gridSize: 5,
    isAvailable: () => true
  });
  assert.ok(spawn);
  assert.equal(spawn.definition.health, 924);
  const effective = applyDungeonCardStats(spawn.definition, effects);
  assert.equal(effective.health, 2310);
  assert.equal(Math.round(effective.health * 0.3), 693);
  assert.equal(removeDungeonCardHealth({ ...spawn.definition, health: effective.health }, effects).health, 924);
});

test('Dungeon Card health normalizes uncarded conjures before scaling', () => {
  const adjustment = resolveDungeonCardHealthAdjustment({
    maxHealth: 100,
    currentHealth: 100,
    isDestroyed: false,
    uncardedHealth: 100,
    previousRate: 0.5,
    nextRate: 1
  });
  assert.deepEqual(adjustment, { maxHealth: 200, currentHealth: 200 });

  const damaged = resolveDungeonCardHealthAdjustment({
    maxHealth: 100,
    currentHealth: 50,
    isDestroyed: false,
    uncardedHealth: 100,
    previousRate: 0.5,
    nextRate: 1
  });
  assert.deepEqual(damaged, { maxHealth: 200, currentHealth: 150 });

  const alreadyScaled = resolveDungeonCardHealthAdjustment({
    maxHealth: 150,
    currentHealth: 75,
    isDestroyed: false,
    uncardedHealth: 100,
    previousRate: 0.5,
    nextRate: 1
  });
  assert.deepEqual(alreadyScaled, { maxHealth: 200, currentHealth: 125 });
});

test('Dungeon Card health normalization tolerates malformed saved values', () => {
  assert.deepEqual(resolveDungeonCardHealthAdjustment({
    maxHealth: Number.NaN,
    currentHealth: Number.NaN,
    isDestroyed: false,
    uncardedHealth: 100,
    previousRate: 0.5,
    nextRate: Number.POSITIVE_INFINITY
  }), { maxHealth: 150, currentHealth: 150 });
});

test('Dungeon carryover health repairs collapsed saves and strips legacy card attack bonuses', () => {
  assert.deepEqual(resolveDungeonCarryoverHealth({
    savedMaxHealth: 13,
    savedCurrentHealth: 13,
    isDestroyed: false,
    expectedUncardedHealth: 1823,
    healthBonusRate: 0
  }), { maxHealth: 1823, currentHealth: 1823 });

  assert.deepEqual(resolveDungeonCarryoverHealth({
    savedMaxHealth: 13,
    savedCurrentHealth: 5,
    isDestroyed: false,
    expectedUncardedHealth: 1823,
    healthBonusRate: 0
  }), { maxHealth: 1823, currentHealth: 701 });

  assert.deepEqual(resolveDungeonCarryoverHealth({
    savedMaxHealth: 1823,
    savedCurrentHealth: 13,
    isDestroyed: false,
    expectedUncardedHealth: 1823,
    healthBonusRate: 0
  }), { maxHealth: 1823, currentHealth: 13 });

  assert.deepEqual(resolveDungeonCarryoverHealth({
    savedMaxHealth: 13,
    savedCurrentHealth: 13,
    isDestroyed: false,
    expectedUncardedHealth: 480,
    healthBonusRate: 0.5
  }), { maxHealth: 720, currentHealth: 720 });

  assert.deepEqual(resolveDungeonCarryoverHealth({
    savedMaxHealth: 720,
    savedCurrentHealth: 720,
    isDestroyed: false,
    expectedUncardedHealth: 480,
    healthBonusRate: 0.5
  }), { maxHealth: 720, currentHealth: 720 });

  let state = createDungeonCardState();
  state.pendingDraws = 10;
  state = pickDungeonCard(state, createDungeonCard('Dice Attack', 'Common', 'Drizzle'));
  state = pickDungeonCard(state, createDungeonCard('Dice Attack', 'Rare', 'Drizzle'));
  const effects = getDungeonCardEffects(state, 'Drizzle');
  assert.equal(effects.attackBonusRate, 0.75);
  assert.equal(resolveDungeonCarryoverAttack({ savedAttack: 35, expectedUncardedAttack: 20, attackBonusRate: 0.75 }), 20);
  assert.equal(resolveDungeonCarryoverAttack({ savedAttack: 20, expectedUncardedAttack: 20, attackBonusRate: 0.75 }), 20);
  assert.equal(resolveDungeonCarryoverAttack({ savedAttack: 30, expectedUncardedAttack: 20, attackBonusRate: 0.75 }), 30);
  assert.equal(resolveDungeonCarryoverAttack({ savedAttack: undefined, expectedUncardedAttack: 20, attackBonusRate: 0.75 }), undefined);
  assert.equal(Math.floor(20 * getDungeonCardDamageMultiplier(effects)), 35);
});

test('Dungeon Cards grow the kill requirement after every five picks', () => {
  let state = createDungeonCardState();
  state = registerDungeonCardKills(state, 4);
  assert.equal(state.pendingDraws, 0);
  assert.equal(state.killsTowardNext, 4);
  state = registerDungeonCardKills(state, 1);
  assert.equal(state.pendingDraws, 1);
  assert.equal(state.killsTowardNext, 0);
  assert.equal(getDungeonCardKillsRequired(state), 5);

  state.pendingDraws = 10;
  const kinds = ['Dice Health', 'Dice Attack', 'Dice Regen', 'Dice Armor', 'Dice Attack Count'] as const;
  kinds.forEach((kind) => {
    state = pickDungeonCard(state, createDungeonCard(kind, 'Common', 'Fire'));
  });
  assert.equal(state.cardsPicked, 5);
  assert.equal(state.pendingDraws, 5);
  assert.equal(getDungeonCardKillsRequired(state), 6);
  state = registerDungeonCardKills(state, 5);
  assert.equal(state.pendingDraws, 5);
  assert.equal(state.killsTowardNext, 5);
  state = registerDungeonCardKills(state, 1);
  assert.equal(state.pendingDraws, 6);
  assert.equal(state.killsTowardNext, 0);
});

test('Dungeon Card shuffle pricing is free once per session then scales by five diamonds', () => {
  const state = createDungeonCardState();
  assert.equal(getDungeonCardShuffleCost(state), 0);
  assert.equal(getDungeonCardShuffleCost({ ...state, shufflesUsed: 1 }), 10);
  assert.equal(getDungeonCardShuffleCost({ ...state, shufflesUsed: 2 }), 15);
  assert.equal(getDungeonCardShuffleCost({ ...state, shufflesUsed: 3 }), 20);
  assert.equal(canShuffleDungeonCards(state, 1), true);
  assert.equal(canShuffleDungeonCards({ ...state, lastShuffleTurn: 1 }, 1), false);
  assert.equal(canShuffleDungeonCards({ ...state, lastShuffleTurn: 1 }, 2), true);
});

test('Mutual destruction is never reported as a player victory', () => {
  assert.equal(getTerminalBattleOwner(2, 2), null);
  assert.equal(getTerminalBattleOwner(2, 0), 'player');
  assert.equal(getTerminalBattleOwner(0, 2), 'enemy');
  assert.equal(getTerminalBattleOwner(0, 0), 'mutual');
});

test('Dungeon Card offers exclude mana cards for dice without Active mana skills', () => {
  const state = createDungeonCardState();
  const offers = rollDungeonCardChoices(
    state,
    { typeIds: ['Fire', 'Ice'], activeSkillTypeIds: ['Fire'] },
    20,
    () => 0.6
  );
  assert.ok(offers.length > 0);
  assert.equal(offers.some((card) => card.kind === 'Dice Mana Charge' && card.typeId === 'Ice'), false);
  assert.equal(new Set(offers.map((card) => card.key)).size, offers.length);
});

test('Dungeon exclusive cards enforce type, rarity, and unique rules', () => {
  let state = createDungeonCardState();
  state.pendingDraws = 99;

  const revive = createDungeonCard('Die Revive', 'Legendary', 'Sniper');
  assert.equal(getDungeonCardMaxStacks(revive), 3);
  assert.equal(canAddDungeonCard(state, revive), true);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Die Revive', 'Epic', 'Skull')), false);
  state = pickDungeonCard(state, revive);
  assert.equal(getDungeonCardEffects(state, 'Sniper').extraRevives, 2);

  const gunnedDown = createDungeonCard('Gunned Down', 'Legendary', 'Sniper');
  assert.equal(getDungeonCardMaxStacks(gunnedDown), 1);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Gunned Down', 'Legendary', 'Fire')), false);
  assert.equal(canAddDungeonCard(state, gunnedDown), true);
  state = pickDungeonCard(state, gunnedDown);
  assert.equal(canAddDungeonCard(state, gunnedDown), false);
  const marked = ensureDungeonScopeMarks(state, (() => {
    const values = [0, 0.2, 0.4];
    let index = 0;
    return () => values[index++] ?? 0.6;
  })());
  assert.equal(marked.scopeMarks.length, 3);
  assert.equal(new Set(marked.scopeMarks).size, 3);
  assert.equal(ensureDungeonScopeMarks(marked, () => 0.9), marked);

  const brokenBeyond = createDungeonCard('Broken Beyond', 'Epic', 'Broken');
  assert.equal(canAddDungeonCard(state, createDungeonCard('Broken Beyond', 'Epic', 'Fire')), false);
  state = pickDungeonCard(state, brokenBeyond);
  assert.equal(canAddDungeonCard(state, brokenBeyond), false);
  assert.deepEqual(getDungeonCardEffects(state, 'Broken').grantedSkills, [DUNGEON_SLUGFEST_SKILL]);

  const batteryRare = createDungeonCard('Infinite Cycling', 'Rare', 'Battery');
  state = pickDungeonCard(state, batteryRare);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Infinite Cycling', 'Rare', 'Battery')), false);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Infinite Cycling', 'Legendary', 'Battery')), true);

  const gale = createDungeonCard('Feel The Gale', 'Rare', 'Wind');
  state = pickDungeonCard(state, gale);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Feel The Gale', 'Legendary', 'Wind')), false);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Feel The Gale', 'Rare', 'Fire')), false);

  const timeUp = createDungeonCard("Time's Up", 'Epic', 'Time');
  state = pickDungeonCard(state, timeUp);
  assert.equal(canAddDungeonCard(state, createDungeonCard("Time's Up", 'Legendary', 'Time')), false);
  assert.equal(canAddDungeonCard(state, createDungeonCard("Time's Down", 'Epic', 'Time')), true);

  const timeDown = createDungeonCard("Time's Down", 'Legendary', 'Time');
  state = pickDungeonCard(state, timeDown);
  assert.equal(canAddDungeonCard(state, createDungeonCard("Time's Down", 'Epic', 'Time')), false);
  assert.equal(getDungeonCardEffects(state, 'Time').temporalAccelerationCount, 2);
  assert.equal(getDungeonCardEffects(state, 'Time').temporalDilationCount, 3);
});

 test('Dungeon Card effects expose the new armor and exclusive values', () => {
  const armorValue = (rarity: 'Common' | 'Rare' | 'Epic' | 'Legendary') => {
    const state = pickDungeonCard(createDungeonCardState(), createDungeonCard('Dice Armor', rarity, 'Armor'));
    return getDungeonCardEffects(state, 'Armor').armorReduction;
  };
  assert.equal(armorValue('Common'), 0.2);
  assert.equal(armorValue('Rare'), 0.3);
  assert.equal(armorValue('Epic'), 0.4);
  assert.equal(armorValue('Legendary'), 0.5);

  let state = createDungeonCardState();
  state.pendingDraws = 99;
  state = pickDungeonCard(state, createDungeonCard('Infinite Cycling', 'Legendary', 'Battery'));
  assert.equal(getDungeonCardEffects(state, 'Battery').batteryAllyManaBonus, 2);

  state = pickDungeonCard(state, createDungeonCard('Feel The Gale', 'Legendary', 'Wind'));
  assert.equal(getDungeonCardEffects(state, 'Wind').galeDurationBonus, 2);

  state = pickDungeonCard(state, createDungeonCard('Gunned Down', 'Legendary', 'Sniper'));
  const scope = getDungeonCardEffects(state, 'Sniper');
  assert.equal(scope.scopeShotChance, 0.25);
  assert.equal(scope.scopeDamageMultiplier, 10);
  assert.equal(scope.grantedSkills.find((skill) => skill.title === 'Marked In')?.type, 'Passive');
  assert.equal(scope.grantedSkills.find((skill) => skill.title === 'Scope Stack')?.type, 'OnKill');
  state.scopeStacks = 2;
  assert.equal(getDungeonCardEffects(state, 'Sniper').scopeDamageMultiplier, 14);
  assert.equal(getDungeonCardEffects(state, 'Sniper').scopeDamageBonus, 0.4);
});

test('New dungeon exclusive cards expose their effects and granted skills', () => {
  let state = createDungeonCardState();
  const cardSwarm = createDungeonCard('Card Swarm', 'Common', 'Gamble');
  assert.equal(canAddDungeonCard(state, cardSwarm), true);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Card Swarm', 'Common', 'Fire')), false);
  assert.equal(getDungeonCardMaxStacks(cardSwarm), 1);
  state = pickDungeonCard(state, cardSwarm);
  const swarmEffects = getDungeonCardEffects(state, 'Gamble');
  assert.equal(swarmEffects.cardOrbitCount, 3);
  assert.equal(swarmEffects.cardOrbitDamageRate, 1.5);
  const swarmActive = swarmEffects.grantedSkills.find((skill) => skill.title === 'Card Swarm');
  const pokerFace = swarmEffects.grantedSkills.find((skill) => skill.title === 'Poker Face');
  assert.equal(swarmActive?.type, 'Active');
  assert.equal(swarmActive?.manaNeeded, 9);
  assert.equal(pokerFace?.type, 'Passive');
  const orbitMeta = getRuntimeSkillMeta({
    typeId: 'Gamble',
    title: 'Gamble Dice',
    attack: 14,
    health: 540,
    range: 5,
    targetingMode: 'Nearest',
    rarity: 'Common',
    skills: swarmEffects.grantedSkills
  });
  assert.equal(orbitMeta.hasCardOrbit, true);
  assert.equal(orbitMeta.cardOrbitCount, 3);
  assert.equal(orbitMeta.cardOrbitDamageRate, 1.5);
  assert.equal(orbitMeta.unleashCardOrbit, true);
  assert.equal(canAddDungeonCard(state, createDungeonCard('Card Swarm', 'Legendary', 'Gamble')), false);
  const swarmOffers = rollDungeonCardChoices(createDungeonCardState(), { typeIds: ['Gamble'] }, 20, () => 0.99);
  assert.ok(swarmOffers.filter((card) => card.kind === 'Card Swarm').length <= 1);

  let growthState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Mega Growth', 'Legendary', 'Growth'));
  assert.equal(getDungeonCardEffects(growthState, 'Growth').growthDeltaOverride, 2);
  assert.equal(canAddDungeonCard(growthState, createDungeonCard('Mega Growth', 'Legendary', 'BrokenGrowth')), false);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Mega Growth', 'Legendary', 'Fire')), false);
  let brokenGrowthState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Mega Growth', 'Legendary', 'BrokenGrowth'));
  assert.equal(getDungeonCardEffects(brokenGrowthState, 'BrokenGrowth').growthDeltaOverride, 2);

  let drizzleState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Acid Rain', 'Epic', 'Drizzle'));
  assert.equal(getDungeonCardEffects(drizzleState, 'Drizzle').acidRainTurns, 2);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Acid Rain', 'Epic', 'Fire')), false);

  let transcendenceState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Ascendance', 'Epic', 'Transcendence'));
  assert.equal(getDungeonCardEffects(transcendenceState, 'Transcendence').transformDurationBonus, 1);

  let berserkState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Rampage', 'Legendary', 'Berserk'));
  assert.equal(getDungeonCardEffects(berserkState, 'Berserk').rampageSplashRate, 1);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Rampage', 'Legendary', 'Fire')), false);
});

test('Dungeon card presentation is registered with the card definitions', () => {
  const armor = createDungeonCard('Dice Armor', 'Epic', 'Armor');
  const armorPresentation = getDungeonCardPresentation(armor, 'Armor', 2);
  assert.equal(armorPresentation.title, 'Dice Armor');
  assert.equal(armorPresentation.icon, '🛡️');
  assert.equal(armorPresentation.color, '#d98cff');
  assert.equal(armorPresentation.cardCount, 2);
  assert.equal(armorPresentation.stackLabel, '2 CARDS');
  assert.equal(armorPresentation.unique, false);
  assert.match(armorPresentation.description, /40% damage reduction/);
  assert.match(armorPresentation.tooltip, /2 CARDS/);

  const gunnedDown = createDungeonCard('Gunned Down', 'Legendary', 'Sniper');
  const gunnedPresentation = getDungeonCardPresentation(gunnedDown, 'Sniper', 1);
  assert.equal(gunnedPresentation.cardCount, 1);
  assert.equal(gunnedPresentation.stackLabel, 'UNIQUE • 1 CARD');
  assert.equal(gunnedPresentation.unique, true);
  assert.match(gunnedPresentation.description, /25% chance/);
  assert.match(gunnedPresentation.description, /Marked In/);
  assert.match(gunnedPresentation.description, /Scope Stack/);

  const cardSwarm = createDungeonCard('Card Swarm', 'Legendary', 'Gamble');
  const swarmPresentation = getDungeonCardPresentation(cardSwarm, 'Gamble', 1);
  assert.match(swarmPresentation.description, /6 orbiting cards/);
  assert.match(swarmPresentation.description, /150%/);
  assert.match(swarmPresentation.description, /9 mana/);

  const regen = createDungeonCard('Dice Regen', 'Rare', 'Fire');
  const regenPresentation = getDungeonCardPresentation(regen, 'Fire', 1);
  assert.match(regenPresentation.description, /10% of its max HP/);
  assert.doesNotMatch(regenPresentation.description, /missing HP/);
});

test('Daily class rolls are seeded and hard mode uses the top profile dice', () => {
  const key = '2026-11-10';
  assert.equal(getSeededDailyIndex(key, 'daily-class-mode', 2), getSeededDailyIndex(key, 'daily-class-mode', 2));
  for (let index = 0; index < 100; index += 1) {
    const roll = getSeededDailyIndex(key, `daily-class-${index}`, 15);
    assert.ok(roll >= 0 && roll < 15);
    assert.equal(getSeededDailyRange(key, `daily-class-${index}`, 1, 15), roll + 1);
  }

  const top = getTopProfileDice([
    { typeId: 'Wind', classLevel: 9, unlocked: true },
    { typeId: 'Fire', classLevel: 9, unlocked: true },
    { typeId: 'Lock', classLevel: 15, unlocked: false },
    { typeId: 'Zombie', classLevel: 12, unlocked: true },
    { typeId: 'Ice', classLevel: 4, unlocked: true },
    { typeId: 'Battery', classLevel: 7, unlocked: true },
    { typeId: 'Skull', classLevel: 2, unlocked: true }
  ], 5);
  assert.deepEqual(top.map((entry) => entry.typeId), ['Zombie', 'Fire', 'Wind', 'Battery', 'Ice']);
  assert.deepEqual(top.map((entry) => entry.classLevel), [12, 9, 9, 7, 4]);
  assert.equal(getHardDailyEnemyClassLevel(12), 15);
  assert.equal(getHardDailyEnemyClassLevel(9), 13);
  assert.equal(getHardDailyEnemyClassLevel(14), 15);
  assert.equal(getHardDailyEnemyClassLevel(Number.NaN), 5);
});

test('Dungeon talent suppression is scoped to dungeon runs', () => {
  assert.equal(areTalentsSuppressedForChallenge('dungeon'), true);
  for (const challenge of ['daily', 'deucifer', 'dopamine', 'bossfight', null, undefined]) {
    assert.equal(areTalentsSuppressedForChallenge(challenge), false);
  }
});

test('Combat-end healing scales from max health', () => {
  assert.equal(getMaxHealthHealAmount(1000, 0.1), 100);
  assert.equal(getMaxHealthHealAmount(1000, 0.25), 250);
  assert.equal(getMaxHealthHealAmount(500, 0.05), 25);
  assert.equal(getMaxHealthHealAmount(5, 0.05), 1);
  assert.equal(getMaxHealthHealAmount(0, 0.1), 0);
  assert.equal(getMaxHealthHealAmount(1000, 0), 0);
  assert.equal(getMaxHealthHealAmount(Number.NaN, 0.1), 0);
  assert.equal(getMaxHealthHealAmount(1000, Number.NaN), 0);
});

test('Soul max-health scaling preserves missing health', () => {
  assert.equal(resolveMaxHealthGainCurrentHealth(500, 1000, 1200), 700);
  assert.equal(resolveMaxHealthGainCurrentHealth(1000, 1000, 1200), 1200);
  assert.equal(resolveMaxHealthGainCurrentHealth(100, 1000, 1100), 200);
  assert.equal(resolveMaxHealthGainCurrentHealth(Number.NaN, 1000, 1200), 1200);
});

test('Slugfest uses rapidFireCount to fire eight 60-damage shots', () => {
  const broken: DiceDefinition = {
    ...zombie,
    typeId: 'Broken',
    title: 'Broken Dice',
    attack: 20,
    health: 500,
    skills: [DUNGEON_SLUGFEST_SKILL]
  };
  assert.equal(DUNGEON_SLUGFEST_SKILL.modifiers?.rapidFireCount, 8);
  const brokenCardState = pickDungeonCard(
    createDungeonCardState(),
    createDungeonCard('Broken Beyond', 'Epic', 'Broken')
  );
  const brokenWithCard = applyDungeonCardStats(
    { ...broken, skills: [] },
    getDungeonCardEffects(brokenCardState, 'Broken')
  );
  assert.ok(brokenWithCard.skills.some((skill) => skill.title === 'Slugfest' && skill.manaNeeded === 8));

  const attacker: DiceInstanceState = {
    instanceId: 'slugfest-test',
    typeId: 'Broken',
    ownerId: 'player',
    zone: 'board',
    maxHealth: 500,
    currentHealth: 500,
    isDestroyed: false,
    hasFinishedAttacking: false,
    attacksRemaining: 1
  };
  const result = executeActiveSkillEffects(
    attacker,
    broken,
    1,
    undefined,
    8,
    { key: 'broken-active', title: 'Slugfest', manaNeeded: 8, skillIndex: 0 },
    1
  );
  assert.deepEqual(result.rapidFire, { hits: 8, damage: 60 });
  const noMana = executeActiveSkillEffects(
    attacker,
    broken,
    1,
    undefined,
    7,
    { key: 'broken-active', title: 'Slugfest', manaNeeded: 8, skillIndex: 0 },
    1
  );
  assert.equal(noMana.rapidFire, undefined);
  assert.equal(noMana.needsMana, true);
});

test('Rapid Fire increases active rapid-fire shots and basic attack bursts', () => {
  const rapidFireSkill = {
    ...DUNGEON_SLUGFEST_SKILL,
    modifiers: {
      ...DUNGEON_SLUGFEST_SKILL.modifiers,
      rapidFireIncrease: 2
    }
  };
  const definition: DiceDefinition = {
    ...zombie,
    typeId: 'Broken',
    title: 'Broken Dice',
    attack: 20,
    health: 500,
    skills: [
      rapidFireSkill,
      {
        type: 'Passive',
        title: 'Rapid Fire',
        description: '',
        modifiers: { rapidFireIncrease: 1 }
      }
    ]
  };
  const attacker: DiceInstanceState = {
    instanceId: 'rapid-fire-test',
    typeId: 'Broken',
    ownerId: 'player',
    zone: 'board',
    maxHealth: 500,
    currentHealth: 500,
    isDestroyed: false,
    hasFinishedAttacking: false,
    attacksRemaining: 1
  };
  const result = executeActiveSkillEffects(
    attacker,
    definition,
    1,
    undefined,
    8,
    { key: 'broken-active', title: 'Slugfest', manaNeeded: 8, skillIndex: 0 },
    1
  );
  assert.equal(getRuntimeSkillMeta(definition).rapidFireIncrease, 3);
  assert.deepEqual(result.rapidFire, { hits: 11, damage: 60 });
});

test('Deucifer pip rates resolve from Passive skills only', () => {
  const definition: DiceDefinition = {
    ...zombie,
    typeId: 'Deucifer',
    title: 'Deucifer Dice',
    skills: [
      { type: 'Passive', title: 'Odd Siphon', description: '', modifiers: { oddPipSiphonRate: 0.75 } },
      { type: 'Passive', title: 'Even Siphon', description: '', modifiers: { evenPipSiphonRate: 0.25 } },
      { type: 'Passive', title: 'Even Damage', description: '', modifiers: { evenPipDamageRate: 0.5 } },
      { type: 'Passive', title: 'Odd Damage', description: '', modifiers: { oddPipDamageRate: 0.2 } },
      { type: 'Active', title: 'Ignored Active', description: '', modifiers: { oddPipSiphonRate: 9 } }
    ]
  };
  const meta = getRuntimeSkillMeta(definition);
  assert.equal(meta.oddPipSiphonRate, 0.75);
  assert.equal(meta.evenPipSiphonRate, 0.25);
  assert.equal(meta.evenPipDamageRate, 0.5);
  assert.equal(meta.oddPipDamageRate, 0.2);
});

test('Battery dungeon cards add ally mana to Quick Charge', () => {
  const battery: DiceDefinition = {
    ...zombie,
    typeId: 'Battery',
    title: 'Battery Dice',
    skills: [{
      type: 'CombatStart',
      title: 'Quick Charge',
      description: 'Gives allies mana.',
      modifiers: { allyManaGain: 1 }
    }]
  };
  assert.equal(getCombatStartManaEffect(battery, 1)?.allyGain, 1);
  assert.equal(getCombatStartManaEffect(battery, 1, 2)?.allyGain, 3);
  assert.equal(getCombatStartManaEffect(battery, 1, 0)?.allyGain, 1);
});

test('Dungeon Card state replaces malformed cards and preserves valid progress', () => {
  const state = normalizeDungeonCardState({
    cards: [
      createDungeonCard('Dice Health', 'Common', 'Fire'),
      createDungeonCard('Dice Health', 'Common', 'Fire'),
      createDungeonCard('Dice Health', 'Common', 'Fire'),
      createDungeonCard('Dice Health', 'Common', 'Fire'),
      { kind: 'Dice Body Shifter', rarity: 'Rare', typeId: 'Fire' },
      { kind: 'Dice Body Shifter', rarity: 'Epic', typeId: 'Fire' },
      { kind: 'Unknown', rarity: 'Common', typeId: 'Fire' }
    ],
    cardsPicked: 12,
    killsTowardNext: 99,
    pendingDraws: 2.9,
    shufflesUsed: 4.8
  });
  assert.equal(state.cards.length, 4);
  assert.equal(getDungeonCardStackCount(state, createDungeonCard('Dice Health', 'Common', 'Fire')), 3);
  assert.equal(state.cardsPicked, 12);
  assert.equal(getDungeonCardKillsRequired(state), 7);
  assert.equal(state.killsTowardNext, 6);
  assert.equal(state.pendingDraws, 2);
  assert.equal(state.shufflesUsed, 4);
});

test('Dungeon card offers resume from the persisted pick count after a wave turn jump', () => {
  assert.equal(getDungeonNextWaveTurn(1), 2);
  assert.equal(getDungeonNextWaveTurn(49), 50);
  assert.equal(getDungeonNextWaveTurn(Number.NaN), 2);
  assert.equal(canOfferDiceCards(2, 0), true);
  assert.equal(canOfferDiceCards(2, 1), false);
  assert.equal(canOfferDiceCards(4, 1), true);
  assert.equal(canOfferDiceCards(4, 2), false);

  assert.equal(canOfferDiceCards(2, 0, true), true);
  assert.equal(canOfferDiceCards(4, 1, true), true);
  assert.equal(canOfferDiceCards(8, 3, true), true);
  assert.equal(canOfferDiceCards(10, 4, true), true);
  assert.equal(canOfferDiceCards(10, 5, true), true);
  assert.equal(canOfferDiceCards(12, 5, true), true);
  assert.equal(canOfferDiceCards(12, 6, true), true);
  assert.equal(canOfferDiceCards(14, 6, true), true);
  assert.equal(canOfferDiceCards(11, 5, true), false);
  assert.equal(canOfferDiceCards(12, 5), false);
  assert.equal(canOfferDiceCards(getDungeonNextWaveTurn(7), 3, true), true);
  assert.equal(canOfferDiceCards(getDungeonNextWaveTurn(9), 4, true), true);
  assert.equal(canOfferDiceCards(getDungeonNextWaveTurn(10), 5, true), false);
  assert.equal(canOfferDiceCards(getDungeonNextWaveTurn(10) + 1, 5, true), true);
  assert.equal(canOfferDiceCards(40, 19, true), true);
  assert.equal(canOfferDiceCards(40, 20, true), false);
});

test('Dungeon carryover keeps Duality copies and Necromancy conjures distinct', () => {
  const base = {
    currentHealth: 100,
    maxHealth: 100,
    isDestroyed: false,
    mana: 0,
    activeMana: [] as Array<[string, number]>,
    statuses: {}
  };
  const carryover = normalizeDungeonCarryover({
    turn: 11,
    dice: [
      { ...base, instanceId: 'player-Fire-1', typeId: 'Fire', classLevel: 5, transformIndex: 1, transformDuration: 2, summonedByInstanceId: 'player-Fire-1:dual' },
      { ...base, instanceId: 'player-Fire-1:dual', typeId: 'Fire', classLevel: 5 },
      { ...base, instanceId: 'player-Ice-necro-123-4', typeId: 'Ice', classLevel: 8, summonedByInstanceId: 'player-Ice-necro-owner' }
    ],
    diceCards: [],
    diceCardPicksUsed: 5
  });

  assert.ok(carryover);
  assert.deepEqual(carryover.dice.map((die) => die.instanceId), [
    'player-Fire-1',
    'player-Fire-1:dual',
    'player-Ice-necro-123-4'
  ]);
  assert.deepEqual(carryover.dice.map((die) => die.typeId), ['Fire', 'Fire', 'Ice']);
  assert.equal(carryover.dice[2]?.classLevel, 8);
  assert.equal(Object.prototype.hasOwnProperty.call(carryover.dice[0], 'transformIndex'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(carryover.dice[0], 'transformDuration'), false);
  assert.equal(carryover.dice[0]?.summonedByInstanceId, 'player-Fire-1:dual');
  assert.equal(carryover.dice[2]?.summonedByInstanceId, undefined);
  assert.equal(carryover.diceCardPicksUsed, 5);
});

test('Dungeon carryover replaces malformed health and mana instead of losing the die', () => {
  const carryover = normalizeDungeonCarryover({
    turn: 'bad',
    dice: [{
      instanceId: 'player-Broken-1',
      typeId: 'Broken',
      classLevel: 'bad',
      currentHealth: 'bad',
      maxHealth: Number.NaN,
      isDestroyed: false,
      mana: 'bad',
      activeMana: [['slot', 'bad'], ['kept', 2.9], ['bad', Number.NaN]],
      statuses: null,
      growthDelta: 'bad',
      basicAttackDamage: Number.POSITIVE_INFINITY
    }]
  });

  assert.ok(carryover);
  const die = carryover.dice[0]!;
  assert.equal(carryover.turn, 1);
  assert.equal(die.currentHealth, 1);
  assert.equal(die.maxHealth, 0);
  assert.equal(die.isDestroyed, false);
  assert.equal(die.mana, 0);
  assert.deepEqual(die.activeMana, [['kept', 2]]);
  assert.deepEqual(die.statuses, {});
  assert.equal(die.classLevel, 1);
  assert.equal(die.growthDelta, 0);
  assert.equal(die.basicAttackDamage, 0);

  const clamped = normalizeDungeonCarryover({
    turn: 2,
    dice: [{
      instanceId: 'player-Broken-2',
      typeId: 'Broken',
      classLevel: 2,
      currentHealth: 900,
      maxHealth: 720,
      isDestroyed: false,
      mana: -4,
      activeMana: [],
      statuses: {}
    }]
  });
  assert.ok(clamped);
  assert.equal(clamped.dice[0]?.currentHealth, 720);
  assert.equal(clamped.dice[0]?.mana, 0);
});

test('Dungeon carryover sanitizes nested status effects', () => {
  const carryover = normalizeDungeonCarryover({
    turn: 3,
    dice: [{
      instanceId: 'player-Status-1',
      typeId: 'Status',
      classLevel: 2,
      currentHealth: 100,
      maxHealth: 100,
      isDestroyed: false,
      mana: 0,
      activeMana: [],
      statuses: {
        poison: {
          stacks: [
            { damage: 5.9, turns: 2.2, sourceInstanceId: 'player-Source-1', sourceOwnerId: 'player', sourceTypeId: 'Fire' },
            { damage: 'bad', turns: 1 },
            { damage: 4, turns: 0 }
          ]
        },
        slow: { delta: -2.8, turns: 3.2, stacks: [{ delta: -1.9, turns: 2.8 }, { delta: 'bad', turns: 2 }] },
        time: [
          { effect: 'acceleration', turns: 2.7, sourceInstanceId: 'player-Source-1' },
          { effect: 'bad', turns: 2, sourceInstanceId: 'player-Source-1' },
          { effect: 'dilation', turns: 0, sourceInstanceId: 'player-Source-1' }
        ],
        fracture: { rate: 0.2, turns: 1.9 },
        stun: 2.9,
        disorientation: 1.2,
        shield: { hp: 10.8, turns: 2.2 }
      }
    }]
  });

  assert.ok(carryover);
  assert.deepEqual(carryover.dice[0]?.statuses, {      poison: { stacks: [{ damage: 5.9, turns: 2, sourceInstanceId: 'player-Source-1', sourceOwnerId: 'player', sourceTypeId: 'Fire' }] },

    slow: { delta: -2, turns: 3, stacks: [{ delta: -1, turns: 2 }] },
    time: [{ effect: 'acceleration', turns: 2, sourceInstanceId: 'player-Source-1' }],
    fracture: { rate: 0.2, turns: 1 },
    stun: 2,
    disorientation: 1,      shield: { hp: 10.8, turns: 2 }
  });

  const malformed = normalizeDungeonCarryover({
    turn: 4,
    dice: [{
      instanceId: 'player-Status-2',
      typeId: 'Status',
      currentHealth: 100,
      maxHealth: 100,
      isDestroyed: false,
      mana: 0,
      activeMana: [],
      statuses: {
        poison: { stacks: null },
        slow: { delta: 'bad', turns: 0 },
        time: [{ effect: 'bad', turns: 2, sourceInstanceId: 'player-Source-1' }],
        fracture: { rate: 'bad', turns: 2 },
        stun: 0,
        disorientation: Number.NaN,
        shield: { hp: 'bad', turns: 0 }
      }
    }]
  });
  assert.ok(malformed);
  assert.deepEqual(malformed.dice[0]?.statuses, {});
});

test('Ricochet aggregation labels report totals without a single-target die', () => {
  assert.equal(formatRicochetAggregationLabel('Your', 'Wind Dice', 'attacks', 1234), 'Your Wind Dice attacks for 1,234 total damage!');
  assert.equal(formatRicochetAggregationLabel('Enemy', 'Healing Dice', 'heals', 2500, true), 'Enemy Healing Dice heals for 2,500 total healing (CRITICAL)!');
  assert.equal(formatRicochetAggregationLabel('Your', 'Armor Dice', 'attacks', Number.NaN), 'Your Armor Dice attacks for 0 total damage!');
});

test('Dice Card pool includes Straight Face and Royal Obedience', () => {
  const cards = rollDiceCards(12, 'Bronze', 'player', [], new Map(), new Set(), () => 0.999);
  const titles = cards.map((card) => card.title);
  assert.ok(titles.includes('Straight Face'));
  assert.ok(titles.includes('Royal Obedience'));
  assert.equal(new Set(titles).size, titles.length);
});

test('Dice Card rolls fall back to the nearest available rarity', () => {
  const definitions = new Map();
  const rollAll = (rarity: 'Bronze' | 'Silver' | 'Gold') =>
    rollDiceCards(12, rarity, 'player', [], definitions, new Set(), () => 0.999);
  const bronze = rollAll('Bronze');
  const silver = rollAll('Silver');
  const gold = rollAll('Gold');
  const bronzeKeys = new Set(bronze.map((card) => card.key));
  const silverKeys = new Set(silver.map((card) => card.key));
  const goldKeys = new Set(gold.map((card) => card.key));

  const bronzeFallback = rollDiceCards(3, 'Bronze', 'player', [], definitions, bronzeKeys, () => 0);
  assert.equal(bronzeFallback.length, 3);
  assert.ok(bronzeFallback.every((card) => card.rarity === 'Silver'));

  const goldFallback = rollDiceCards(1, 'Bronze', 'player', [], definitions,
    new Set([...bronzeKeys, ...silverKeys]), () => 0);
  assert.equal(goldFallback[0]?.rarity, 'Gold');

  const silverDown = rollDiceCards(1, 'Silver', 'player', [], definitions, silverKeys, () => 0);
  assert.equal(silverDown[0]?.rarity, 'Bronze');

  const goldDown = rollDiceCards(1, 'Gold', 'player', [], definitions, goldKeys, () => 0);
  assert.equal(goldDown[0]?.rarity, 'Silver');
});

test('Gamble random damage description scales with damage multipliers', () => {
  const gamble: DiceDefinition = {
    typeId: 'Gamble',
    title: 'Gamble Dice',
    attack: 14,
    health: 540,
    range: 5,
    rarity: 'Common',
    accent: '#c57cff',
    targetingMode: 'Nearest',
    skills: [{
      type: 'Passive',
      title: 'Loaded Odds',
      description: 'Deals {damageRange} random damage to a foe.',
      modifiers: { damageRange: [7, 77] }
    }]
  };

  assert.equal(
    getClassScaledSkillDescription(gamble, gamble.skills[0], 1.5),
    'Deals 11–116 random damage to a foe.'
  );
  assert.equal(
    getClassScaledSkillDescription(gamble, gamble.skills[0], 2),
    'Deals 14–154 random damage to a foe.'
  );
});

test('Dungeon intros trigger exactly when Death Wave and Boss Berserk begin', () => {
  assert.equal(getDungeonIntroForWave(10), null);
  assert.equal(getDungeonIntroForWave(12), null);
  assert.equal(getDungeonIntroForWave(30), null);
  assert.equal(getDungeonIntroForWave(32), null);
  assert.equal(getDungeonIntroForWave(50), null);
  assert.equal(getDungeonIntroForWave(Number.NaN), null);

  const death = getDungeonIntroForWave(DUNGEON_INTRO_WAVES.deathWave);
  assert.ok(death);
  assert.equal(death.kind, 'death-wave');
  assert.equal(death.wave, 11);
  assert.equal(death.title, 'DEATH WAVE');
  assert.equal(
    death.body,
    'All enemy dice have their critical chance amped up to 25%.\nBeware of your pathing depths below!'
  );
  assert.deepEqual(death.signs, ['⚠', '⚠']);
  assert.equal(death.sfxKey, 'death_wave');
  assert.equal(getDungeonDifficulty(death.wave), death.kind);

  const boss = getDungeonIntroForWave(DUNGEON_INTRO_WAVES.bossBerserk);
  assert.ok(boss);
  assert.equal(boss.kind, 'boss-berserk');
  assert.equal(boss.wave, 31);
  assert.equal(boss.title, 'BOSS BERSERK');
  assert.equal(
    boss.body,
    'Bosses are significantly stronger and they go completely berserk.\nEnemy dice critical chance bumped to 50%.\nYour faint shall be revealed in your destiny!'
  );
  assert.deepEqual(boss.signs, ['☣', '☣']);
  assert.equal(boss.sfxKey, 'enhanced_death_wave');
  assert.equal(getDungeonDifficulty(boss.wave), boss.kind);
});

test('combat pacing reaches 45s with 2x and 4x thresholds that stack with dungeon waves', () => {
  assert.equal(COMBAT_TIME_LIMIT_MS, 45_000);
  assert.equal(getCombatTimeSpeedMultiplier(45_000), 1);
  assert.equal(getCombatTimeSpeedMultiplier(30_001), 1);
  assert.equal(getCombatTimeSpeedMultiplier(30_000), 2);
  assert.equal(getCombatTimeSpeedMultiplier(15_001), 2);
  assert.equal(getCombatTimeSpeedMultiplier(15_000), 4);
  assert.equal(getCombatTimeSpeedMultiplier(0), 4);

  assert.equal(getDungeonSpeedMultiplier(1), 1);
  assert.equal(getDungeonSpeedMultiplier(11), 2);
  assert.equal(getDungeonSpeedMultiplier(30), 2);
  assert.equal(getDungeonSpeedMultiplier(31), 4);
  assert.equal(getDungeonSpeedMultiplier(50), 4);
  assert.equal(getDungeonSpeedMultiplier(11) * getCombatTimeSpeedMultiplier(15_000), 8);
  assert.equal(getDungeonSpeedMultiplier(31) * getCombatTimeSpeedMultiplier(15_000), 16);
});

test('dungeon music lowers playback speed and pitch for late waves', () => {
  assert.deepEqual(getDungeonMusicEffects(1), { speed: 1, pitch: 0 });
  assert.deepEqual(getDungeonMusicEffects(10), { speed: 1, pitch: 0 });
  assert.deepEqual(getDungeonMusicEffects(11), { speed: 1.25, pitch: 2 });
  assert.deepEqual(getDungeonMusicEffects(30), { speed: 1.25, pitch: 2 });
  assert.deepEqual(getDungeonMusicEffects(31), { speed: 1.5, pitch: 4 });
  assert.deepEqual(getDungeonMusicEffects(50), { speed: 1.5, pitch: 4 });
});

test('Dungeon intro and dice SFX metadata use the requested files', () => {
  const readDice = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as DiceDefinition;
  const diceAudioPath = (key: string) => `public/assets/audio/dice/${key}.ogg`;

  assert.equal(getDungeonIntroForWave(DUNGEON_INTRO_WAVES.deathWave)?.sfxKey, 'death_wave');
  assert.equal(getDungeonIntroForWave(DUNGEON_INTRO_WAVES.bossBerserk)?.sfxKey, 'enhanced_death_wave');
  for (const path of ['assets/audio/death_wave.mp3', 'assets/audio/enhanced_death_wave.mp3']) {
    assert.ok(existsSync(`public/${path}`), `${path} should exist`);
  }

  const sword = readDice('public/gamedata/DiceDefinitions/Sword.dice');
  assert.deepEqual(sword.attackSfx, [
    'dice_sword_attack_01',
    'dice_sword_attack_02',
    'dice_sword_attack_03'
  ]);
  for (const key of sword.attackSfx as string[]) assert.ok(existsSync(diceAudioPath(key)), `${key} should exist`);

  const nuclear = readDice('public/gamedata/DiceDefinitions/Nuclear.dice');
  assert.equal(nuclear.skills[0]?.modifiers?.skillSfx, 'dice_nuclear_skill');
  assert.ok(existsSync(diceAudioPath('dice_nuclear_skill')));

  const reverse = readDice('public/gamedata/DiceDefinitions/Reverse.dice');
  const reverseSfx = reverse.skills[0]?.modifiers?.skillSfx;
  const reverseKeys = Array.isArray(reverseSfx) ? reverseSfx : reverseSfx ? [reverseSfx] : [];
  assert.equal(reverseKeys.length, 7);
  assert.deepEqual(getRuntimeSkillMeta(reverse).skillSfxKey, reverseKeys);
  for (const key of reverseKeys) assert.ok(existsSync(diceAudioPath(key)), `${key} should exist`);

  const lock = readDice('public/gamedata/DiceDefinitions/Lock.dice');
  assert.equal(lock.skills[0]?.modifiers?.skillSfx, 'dice_lock_skill');
  assert.equal(getRuntimeSkillMetaForTrigger(lock, 'CombatStart').skillSfxKey, 'dice_lock_skill');
  assert.ok(existsSync(diceAudioPath('dice_lock_skill')), 'dice_lock_skill should exist');

  const silence = readDice('public/gamedata/DiceDefinitions/Bosses/Silence.dice');
  const silenceDiceLockIndex = silence.skills.findIndex((skill) => skill.modifiers?.hasLock === true && skill.modifiers?.onlyLockGridTiles !== true);
  const silenceGridLockIndex = silence.skills.findIndex((skill) => skill.modifiers?.onlyLockGridTiles === true);
  assert.ok(silenceDiceLockIndex >= 0 && silenceGridLockIndex >= 0);
  assert.equal(silence.skills[silenceDiceLockIndex]?.modifiers?.skillSfx, 'dice_silence_lock');
  assert.equal(silence.skills[silenceGridLockIndex]?.modifiers?.skillSfx, 'dice_silence_grid_lock');
  assert.equal(getRuntimeSkillMetaForTrigger(silence, 'Active', silenceDiceLockIndex).skillSfxKey, 'dice_silence_lock');
  assert.equal(getRuntimeSkillMetaForTrigger(silence, 'Active', silenceGridLockIndex).skillSfxKey, 'dice_silence_grid_lock');
  for (const key of ['dice_silence_lock', 'dice_silence_grid_lock']) {
    assert.ok(existsSync(diceAudioPath(key)), `${key} should exist`);
  }

  for (const typeId of ['Growth', 'BrokenGrowth']) {
    const growth = readDice(`public/gamedata/DiceDefinitions/${typeId}.dice`);
    const growthMeta = getRuntimeSkillMeta(growth, undefined, true);
    assert.deepEqual(growth.skills[0]?.modifiers?.growthSuccessSfx, ['dice_growth_success_01', 'dice_growth_success_02']);
    assert.deepEqual(growth.skills[0]?.modifiers?.growthFailedSfx, ['dice_growth_failed']);
    assert.deepEqual(growthMeta.growthSuccessSfxKey, ['dice_growth_success_01', 'dice_growth_success_02']);
    assert.deepEqual(growthMeta.growthFailedSfxKey, ['dice_growth_failed']);
  }
  for (const key of ['dice_growth_success_01', 'dice_growth_success_02', 'dice_growth_failed']) {
    assert.ok(existsSync(diceAudioPath(key)), `${key} should exist`);
  }

  for (const [path, summonType] of [
    ['public/gamedata/DiceDefinitions/Bosses/Deucifer.dice', 'Imp'],
    ['public/gamedata/DiceDefinitions/Bosses/Magician.dice', 'Wizard']
  ] as const) {
    const summoner = readDice(path);
    const summonSkillIndex = summoner.skills.findIndex((skill) => skill.modifiers?.summonType === summonType);
    const summonSkill = summoner.skills[summonSkillIndex];
    assert.deepEqual(summonSkill?.modifiers?.skillSfx, ['dice_growth_success_01', 'dice_growth_success_02']);
    assert.deepEqual(
      getRuntimeSkillMetaForTrigger(summoner, 'Active', summonSkillIndex).skillSfxKey,
      ['dice_growth_success_01', 'dice_growth_success_02']
    );
  }
});

test('attackSfx metadata lives on dice and transform roots', () => {
  const readDice = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as DiceDefinition;
  const diceAudioPath = (key: string) => `public/assets/audio/dice/${key}.ogg`;
  const rootSfx = [
    ['Solitude', 'dice_solitude_attack'],
    ['Spear', 'dice_spear_skill'],
    ['Drizzle', 'dice_drizzle_attack'],
    ['Druid', 'dice_heal_skill']
  ] as const;

  for (const [typeId, key] of rootSfx) {
    const die = readDice(`public/gamedata/DiceDefinitions/${typeId}.dice`);
    assert.equal(die.attackSfx, key);
    assert.equal((die.skills[0]?.modifiers as Record<string, unknown> | undefined)?.attackSfx, undefined);
    assert.ok(existsSync(diceAudioPath(key)), `${key} should exist`);
  }

  const transcendence = readDice('public/gamedata/DiceDefinitions/Transcendence.dice');
  assert.equal(transcendence.attackSfx, 'dice_transcendence_attack');
  assert.equal(transcendence.transformStats?.[0]?.attackSfx, 'dice_transcendence_t_attack');
  assert.equal(applyTransformStats(transcendence, 0).attackSfx, 'dice_transcendence_t_attack');
  assert.equal((transcendence.skills[0]?.modifiers as Record<string, unknown> | undefined)?.attackSfx, undefined);
  assert.equal((transcendence.transformStats?.[0]?.skills?.[0]?.modifiers as Record<string, unknown> | undefined)?.attackSfx, undefined);

  const death = readDice('public/gamedata/DiceDefinitions/Death.dice');
  assert.equal(death.attackSfx, undefined);
  assert.equal(death.transformStats?.[0]?.attackSfx, 'dice_death_t_attack');
  assert.equal((death.transformStats?.[0]?.skills?.[0]?.modifiers as Record<string, unknown> | undefined)?.attackSfx, undefined);
});

test('Wind uses projectileCountIncrease and skillDuration', () => {
  const wind = JSON.parse(readFileSync('public/gamedata/DiceDefinitions/Wind.dice', 'utf8')) as DiceDefinition;
  const windSkill = wind.skills[0];
  assert.ok(windSkill);
  assert.equal(windSkill.modifiers?.projectileCountIncrease, 1);
  assert.equal(windSkill.modifiers?.skillDuration, 2);
  assert.equal(windSkill.modifiers?.attackCountIncrease, undefined);
  assert.equal(windSkill.description, 'Shoots twice as many attacks for {skillDuration} turns without spending an attack, then cannot gain mana again until the effect ends.');

  const meta = getRuntimeSkillMetaForTrigger(wind, 'Active');
  assert.equal(meta.projectileCountIncrease, 1);
  assert.equal(meta.skillDuration, 2);
  assert.equal(meta.attackCountIncrease, 0);
  assert.equal(
    getClassScaledSkillDescription(wind, windSkill),
    'Shoots twice as many attacks for 2 turns without spending an attack, then cannot gain mana again until the effect ends.'
  );

  const mightyWind = applyDiceTalent(wind, 0, 9);
  const mightyMeta = getRuntimeSkillMetaForTrigger(mightyWind, 'Active');
  assert.equal(mightyMeta.projectileCountIncrease, 2);
  assert.equal(mightyMeta.skillDuration, 2);

  const attacker: DiceInstanceState = {
    instanceId: 'wind-sfx-test',
    typeId: 'Wind',
    ownerId: 'player',
    zone: 'board',
    maxHealth: 480,
    currentHealth: 480,
    isDestroyed: false,
    hasFinishedAttacking: false,
    attacksRemaining: 1
  };
  const result = executeActiveSkillEffects(
    attacker,
    wind,
    1,
    undefined,
    10,
    { key: 'wind-active', title: 'Gale Tempo', manaNeeded: 10, skillIndex: 0 },
    1
  );
  assert.equal(result.projectileCountIncrease, 1);
  assert.equal(result.projectileCountTurns, 2);
  assert.equal(result.attackCountIncrease, undefined);

  const temporaryAttackDefinition: DiceDefinition = {
    ...wind,
    skills: [{
      ...windSkill,
      modifiers: { attackCountIncrease: 1, skillDuration: 2 }
    }]
  };
  const temporaryAttackResult = executeActiveSkillEffects(
    attacker,
    temporaryAttackDefinition,
    1,
    undefined,
    10,
    { key: 'wind-active', title: 'Gale Tempo', manaNeeded: 10, skillIndex: 0 },
    1
  );
  assert.equal(temporaryAttackResult.attackCountIncrease, 1);
  assert.equal(temporaryAttackResult.attackCountTurns, 2);
  assert.equal(temporaryAttackResult.projectileCountIncrease, undefined);
});

test('passive attack and projectile counts stay separate from timed hook increases', () => {
  const passiveOnly: DiceDefinition = {
    ...zombie,
    skills: [{
      type: 'Passive',
      title: 'Standing Army',
      description: '',
      modifiers: {
        attackCount: 2,
        projectileCount: 1,
        attackCountIncrease: 9,
        projectileCountIncrease: 9,
        skillDuration: 5
      }
    }]
  };
  const passiveMeta = getRuntimeSkillMetaForTrigger(passiveOnly, 'Passive');
  assert.equal(passiveMeta.attackCount, 2);
  assert.equal(passiveMeta.projectileCount, 1);
  assert.equal(passiveMeta.attackCountIncrease, 0);
  assert.equal(passiveMeta.projectileCountIncrease, 0);
  assert.equal(passiveMeta.skillDuration, 0);

  const hookOnly: DiceDefinition = {
    ...zombie,
    skills: [{
      type: 'OnDeath',
      title: 'Last Gasp',
      description: '',
      modifiers: { attackCountIncrease: 1, projectileCountIncrease: 2, skillDuration: 2 }
    }]
  };
  const hookMeta = getRuntimeSkillMetaForTrigger(hookOnly, 'OnDeath');
  assert.equal(hookMeta.attackCount, 0);
  assert.equal(hookMeta.projectileCount, 0);
  assert.equal(hookMeta.attackCountIncrease, 1);
  assert.equal(hookMeta.projectileCountIncrease, 2);
  assert.equal(hookMeta.skillDuration, 2);
});

test('pool lingerSfx metadata points at loaded audio', () => {
  const pools = [
    ['Fallout', 'dice_poison_skill'],
    ['Lava', 'dice_fire_skill'],
    ['MagicianLava', 'dice_meteor_skill']
  ] as const;
  for (const [typeId, key] of pools) {
    const pool = JSON.parse(readFileSync(`public/gamedata/PoolDefinitions/${typeId}.pool`, 'utf8')) as DicePoolDefinition;
    assert.equal(pool.lingerSfx, key);
    assert.ok(existsSync(`public/assets/audio/dice/${key}.ogg`), `${key} should exist`);
  }
});

test('Dungeon boss and mini-boss music files are bundled', () => {
  for (const path of ['assets/music/snake_theme.mp3', 'assets/music/magician_theme.mp3']) {
    assert.ok(existsSync(`public/${path}`), `${path} should exist`);
  }
});

test('Time talent locks the upgraded Temporal Dilation description', () => {
  const time = JSON.parse(readFileSync('public/gamedata/DiceDefinitions/Time.dice', 'utf8')) as DiceDefinition;
  const talented = applyDiceTalent(time, 0, 9);
  const dilation = talented.skills.find((skill) => skill.title === 'Temporal Dilation');
  assert.ok(dilation);
  assert.match(getClassScaledSkillDescription(talented, dilation), /lose 2 attack counts instead of the usual 1/);
});

test('talent skill descriptions stay templates and resolve at class-scaled damage', () => {
  const base: DiceDefinition = {
    typeId: 'TalentDescriptionTest',
    title: 'Talent Description Test',
    attack: 100,
    health: 100,
    range: 1,
    rarity: 'Common',
    accent: '#ffffff',
    targetingMode: 'Nearest',
    skills: [{
      type: 'Passive',
      title: 'Spark',
      description: 'Base skill.',
      modifiers: { skillDamage: 100 }
    }],
    talents: [{
      title: 'Test Talent',
      description: 'A test talent.',
      classNeeded: 1,
      modifiers: {
        skills: [{
          description: 'Hits for {skillDamage} damage.',
          modifiers: { skillDamage: 100 }
        }]
      }
    }]
  };

  const talented = applyDiceTalent(base, 0, 3);
  assert.equal(talented.skills[0]?.description, 'Hits for {skillDamage} damage.');
  assert.equal(talented.skills[0]?.descriptionLocked, true);

  const scaled = applyClassProgression(talented, 3);
  assert.equal(scaled.skills[0]?.modifiers?.skillDamage, 121);
  assert.equal(scaled.skills[0]?.description, 'Hits for {skillDamage} damage.');
  assert.equal(getClassScaledSkillDescription(scaled, scaled.skills[0]), 'Hits for 121 damage.');
  assert.equal(getClassScaledSkillDescription(scaled, scaled.skills[0], 1.5), 'Hits for 182 damage.');
});

test('combat-start ally auras can be limited to nearby allies', () => {
  const makeDie = (instanceId: string, row: number, col: number): DiceInstanceState => ({
    instanceId,
    typeId: 'Test',
    ownerId: 'player',
    zone: 'board',
    maxHealth: 100,
    currentHealth: 100,
    isDestroyed: false,
    hasFinishedAttacking: false,
    attacksRemaining: 1,
    gridPosition: { row, col }
  });
  const source = makeDie('light', 2, 2);
  const adjacent = makeDie('adjacent', 2, 3);
  const distant = makeDie('distant', 4, 4);
  const limitedAura = [{
    sourceId: source.instanceId,
    extraAttacks: 1,
    foeExtraAttacks: 0,
    radius: 1,
    sourcePosition: { row: 2, col: 2 },
    sourceFootprint: 1
  }];
  const globalAura = [{ sourceId: source.instanceId, extraAttacks: 1, foeExtraAttacks: 0 }];

  assert.equal(computeCombatStartBonus(adjacent, limitedAura, []), 1);
  assert.equal(computeCombatStartBonus(distant, limitedAura, []), 0);
  assert.equal(computeCombatStartBonus(source, limitedAura, []), 0);
  assert.equal(computeCombatStartBonus(distant, globalAura, []), 1);
});

test('combat-start auras ignore skills still locked by class', () => {
  const die: DiceInstanceState = {
    instanceId: 'light',
    typeId: 'Light',
    ownerId: 'player',
    zone: 'board',
    maxHealth: 100,
    currentHealth: 100,
    isDestroyed: false,
    hasFinishedAttacking: false,
    attacksRemaining: 1,
    gridPosition: { row: 2, col: 2 }
  };
  const definition: DiceDefinition = {
    typeId: 'Light',
    title: 'Light Dice',
    attack: 14,
    health: 500,
    range: 3,
    rarity: 'Rare',
    accent: '#f9e27d',
    targetingMode: 'Nearest',
    skills: [{
      type: 'CombatStart',
      title: 'Radiant Rally',
      description: '',
      modifiers: { allyExtraAttacks: 2, unlockAtClass: 5 }
    }]
  };

  assert.deepEqual(collectCombatStartAuras([die], () => definition, () => 1), []);
  const unlocked = collectCombatStartAuras([die], () => definition, () => 5);
  assert.equal(unlocked[0]?.extraAttacks, 2);
});

test('description placeholders resolve root stats, dice names, and pool damage', () => {
  const soul: DiceDefinition = {
    typeId: 'Soul',
    title: 'Soul Dice',
    attack: 20,
    health: 640,
    range: 6,
    rarity: 'Legendary',
    accent: '#2a5fff',
    targetingMode: 'Nearest',
    skills: []
  };
  const meteor: DiceDefinition = {
    ...soul,
    typeId: 'Meteor',
    title: 'Meteor Dice',
    attack: 18
  };
  const lava: DicePoolDefinition = {
    typeId: 'Lava',
    title: 'Lava',
    damage: 50
  };
  const description = getClassScaledSkillDescription(
    meteor,
    {
      type: 'Active',
      title: 'Test',
      description: '{diceDefinitions[Soul].title} hits for {attack}. Lava deals {poolDefinitions[meteorPoolType].damage}.',
      modifiers: { meteorPoolType: 'Lava' }
    },
    1,
    undefined,
    { diceDefinitions: { Soul: soul }, poolDefinitions: { Lava: lava }, classLevel: 2 }
  );
  assert.equal(description, 'Soul Dice hits for 18. Lava deals 55.');
});

test('radius metadata is exposed by combat-start and mana metas', () => {
  const light: DiceDefinition = {
    typeId: 'Light',
    title: 'Light Dice',
    attack: 14,
    health: 500,
    range: 3,
    rarity: 'Rare',
    accent: '#f9e27d',
    targetingMode: 'Nearest',
    skills: [{
      type: 'CombatStart',
      title: 'Radiant Rally',
      description: '',
      modifiers: { allyExtraAttacks: 1, allyExtraAttacksRadius: 1 }
    }]
  };
  assert.equal(getRuntimeSkillMetaForTrigger(light, 'CombatStart').allyExtraAttacksRadius, 1);

  const battery: DiceDefinition = {
    ...light,
    typeId: 'Battery',
    title: 'Battery Dice',
    skills: [{
      type: 'CombatStart',
      title: 'Quick Charge',
      description: '',
      modifiers: { allyManaGain: 1, manaGainRadius: 2 }
    }]
  };
  assert.equal(getCombatStartManaEffect(battery, 1)?.radius, 2);
});

test('Leon skill audio assets are present', () => {
  assert.ok(existsSync('public/assets/audio/dice/dice_leon_mighty_roar.ogg'));
  assert.ok(existsSync('public/assets/audio/dice/dice_leon_furious_claw.ogg'));
});

test('Dungeon wave starts refresh the loadout for a new run and preserve it for a resume', () => {
  const currentLoadout = [
    { typeId: 'Fire', classLevel: 3, talentIndex: 1 },
    { typeId: 'Water', classLevel: 2, talentIndex: null }
  ];
  const savedLoadout = [
    { typeId: 'Ice', classLevel: 7, talentIndex: 0 },
    { typeId: 'Wind', classLevel: 5, talentIndex: null }
  ];

  assert.deepEqual(resolveDungeonWaveLoadout({
    wave: 1,
    resuming: false,
    currentLoadout,
    savedLoadout
  }), currentLoadout);
  assert.deepEqual(resolveDungeonWaveLoadout({
    wave: 1,
    resuming: true,
    currentLoadout,
    savedLoadout
  }), savedLoadout);
  assert.deepEqual(resolveDungeonWaveLoadout({
    wave: 2,
    resuming: false,
    currentLoadout,
    savedLoadout
  }), savedLoadout);
  assert.equal(resolveDungeonWaveLoadout({
    wave: 1,
    resuming: true,
    currentLoadout,
    savedLoadout: null
  }), null);
});

test('Dungeon resume pins the saved loadout, talent choices, and legal carryover dice', () => {
  const base = {
    currentHealth: 100,
    maxHealth: 100,
    isDestroyed: false,
    mana: 0,
    activeMana: [] as Array<[string, number]>,
    statuses: {}
  };
  const carryover = normalizeDungeonCarryover({
    turn: 7,
    dice: [
      { ...base, instanceId: 'player-Fire-1', typeId: 'Fire', talentIndex: 1 },
      { ...base, instanceId: 'player-Water-2', typeId: 'Fire', talentIndex: 0 },
      { ...base, instanceId: 'player-Fire-1:dual', typeId: 'Fire', talentIndex: null },
      { ...base, instanceId: 'player-Summon-9', typeId: 'Ice', talentIndex: 2, summonedByInstanceId: 'player-Fire-1' },
      { ...base, instanceId: 'player-Ice-necro-1', typeId: 'Ice', talentIndex: null },
      { ...base, instanceId: 'player-Orphan-1', typeId: 'Ice' }
    ]
  });
  assert.ok(carryover);
  assert.equal(carryover.dice[0]?.talentIndex, 1);
  assert.equal(carryover.dice[2]?.talentIndex, null);

  const savedRun = normalizeDungeonRun({
    eventKey: '2026-11-03',
    wave: 2,
    carryover,
    config: { randomMode: true, randomizeLoadout: false, useLevelling: true },
    loadout: [
      { typeId: 'Fire', classLevel: 4, talentIndex: 1 },
      { typeId: 'Water', classLevel: 2, talentIndex: null }
    ],
    savedAt: 1
  });
  assert.ok(savedRun);
  assert.deepEqual(savedRun.loadout, [
    { typeId: 'Fire', classLevel: 4, talentIndex: 1 },
    { typeId: 'Water', classLevel: 2, talentIndex: null }
  ]);

  const initialDice = [
    { instanceId: 'player-Fire-1', typeId: 'Fire' },
    { instanceId: 'player-Water-2', typeId: 'Water' }
  ];
  const allowedInClassic = [...resolveDungeonCarryoverInstanceIds(carryover, initialDice, 'Classic')].sort();
  assert.deepEqual(allowedInClassic, ['player-Fire-1', 'player-Summon-9'].sort());
  const allowedInDuality = resolveDungeonCarryoverInstanceIds(carryover, initialDice, 'Duality');
  assert.equal(allowedInDuality.has('player-Fire-1:dual'), true);
  const allowedInNecromancy = resolveDungeonCarryoverInstanceIds(carryover, initialDice, 'Necromancy');
  assert.equal(allowedInNecromancy.has('player-Ice-necro-1'), true);
  assert.equal(allowedInNecromancy.has('player-Orphan-1'), false);
});

test('targeting and infiltration account for multi-tile footprints', () => {
  const makeDie = (overrides: Partial<DiceInstanceState> & Pick<DiceInstanceState, 'instanceId' | 'typeId' | 'ownerId'>): DiceInstanceState => ({
    zone: 'board',
    maxHealth: 100,
    currentHealth: 100,
    isDestroyed: false,
    hasFinishedAttacking: true,
    attacksRemaining: 0,
    ...overrides
  });
  const footprintFor = (die: DiceInstanceState) => die.instanceId === 'player-Boss-1' || die.instanceId === 'enemy-Boss-1' ? 2 : 1;
  const largeAttacker = makeDie({ instanceId: 'player-Boss-1', typeId: 'Boss', ownerId: 'player', gridPosition: { row: 2, col: 3 } });
  const target = makeDie({ instanceId: 'enemy-Target-1', typeId: 'Target', ownerId: 'enemy', gridPosition: { row: 2, col: 0 } });
  assert.equal(getCombatDistance(largeAttacker, target), 2);
  assert.equal(getCombatDistance(largeAttacker, target, footprintFor), 1);

  const assassinDefinition: DiceDefinition = {
    typeId: 'Assassin',
    title: 'Assassin Dice',
    attack: 10,
    health: 10,
    range: 1,
    footprint: 1,
    targetingMode: 'Nearest',
    rarity: 'Common',
    accent: '#ffffff',
    skills: [{ type: 'Passive', title: 'Infiltrate', description: '', modifiers: { isInfiltrator: true, teleportRange: 9 } }]
  };
  const assassin = makeDie({ instanceId: 'player-Assassin-1', typeId: 'Assassin', ownerId: 'player', gridPosition: { row: 4, col: 4 } });
  const boss = makeDie({ instanceId: 'enemy-Boss-1', typeId: 'Boss', ownerId: 'enemy', gridPosition: { row: 0, col: 0 } });
  const occupied = new Set(['0,0', '0,1', '1,0', '1,1']);
  const placement = chooseInfiltratorPlacement(
    assassin,
    assassinDefinition,
    1,
    [boss],
    occupied,
    5,
    (from, to) => getCombatDistance(from, to, footprintFor),
    footprintFor
  );
  assert.ok(placement);
  const tileKey = `${placement.tile.row},${placement.tile.col}`;
  assert.equal(occupied.has(tileKey), false);
  assert.equal(['0,0', '0,1', '1,0', '1,1'].includes(tileKey), false);
});

test('Nearest targeting measures from the closest footprint cell', () => {
  const makeDie = (overrides: Partial<DiceInstanceState> & Pick<DiceInstanceState, 'instanceId' | 'typeId' | 'ownerId'>): DiceInstanceState => ({
    zone: 'board',
    maxHealth: 100,
    currentHealth: 100,
    isDestroyed: false,
    hasFinishedAttacking: true,
    attacksRemaining: 0,
    ...overrides
  });
  const attackerDefinition: DiceDefinition = {
    typeId: 'Attacker',
    title: 'Attacker',
    attack: 10,
    health: 10,
    range: 1,
    footprint: 1,
    targetingMode: 'Nearest',
    rarity: 'Common',
    accent: '#ffffff',
    skills: []
  };
  const bossDefinition: DiceDefinition = { ...attackerDefinition, typeId: 'Boss', footprint: 2 };
  const normalDefinition: DiceDefinition = { ...attackerDefinition, typeId: 'Normal' };
  const attacker = makeDie({ instanceId: 'player-Attacker-1', typeId: 'Attacker', ownerId: 'player', gridPosition: { row: 0, col: 3 } });
  const boss = makeDie({ instanceId: 'enemy-Boss-1', typeId: 'Boss', ownerId: 'enemy', gridPosition: { row: 1, col: 0 } });
  const decoy = makeDie({ instanceId: 'enemy-Normal-1', typeId: 'Normal', ownerId: 'enemy', gridPosition: { row: 0, col: 2 } });
  const state: MatchBattleState = { turn: 1, combatPhase: 'idle', dice: [attacker, boss, decoy] };
  const definitions = new Map<string, DiceDefinition>([
    [attackerDefinition.typeId, attackerDefinition],
    [bossDefinition.typeId, bossDefinition],
    [normalDefinition.typeId, normalDefinition]
  ]);

  assert.equal(findAttackTarget(state, attacker, definitions)?.instanceId, boss.instanceId);
});

test('damage reduction is capped at 95% for every source', () => {
  assert.equal(MAX_DAMAGE_REDUCTION, 0.95);
  assert.equal(clampDamageReduction(1), 0.95);
  assert.equal(clampDamageReduction(4.2), 0.95);
  assert.equal(clampDamageReduction(0.4), 0.4);
  assert.equal(clampDamageReduction(-1), 0);
  assert.equal(clampDamageReduction(Number.NaN), 0);
});

test('damage reduction compounds multiplicatively across sources', () => {
  assert.equal(combineDamageReduction([]), 0);
  assert.equal(combineDamageReduction([0.5, 0.5]), 0.75);
  assert.ok(Math.abs(combineDamageReduction([0.3, 0.4]) - 0.58) < 1e-9);
  assert.equal(combineDamageReduction([0.95, 0.95]), 0.95);
  assert.equal(combineDamageReduction([Number.NaN, 0.5]), 0.5);
});
