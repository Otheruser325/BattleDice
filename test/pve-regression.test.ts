import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { applyClassProgression, applyStatModifiers, applyTransformStats, BOSS_CLASS_STAT_MULTIPLIER, CLASS_UP_STAT_MULTIPLIER, getBossClassMultiplier, getClassBenefitValue, getClassMultiplier, getClassScaledSkillDescription, getClassScaledTalentDescription, resolvePoolDamage } from '../src/systems/ClassProgression';
import { DUNGEON_BOSSES, DUNGEON_MINI_BOSSES, DUNGEON_BOSS_BERSERK_SKILL_MULTIPLIER, DUNGEON_CARRYOVER_DICE_CAP, DUNGEON_CARRYOVER_MANA_CAP, DUNGEON_CARRYOVER_STAT_CAP, DUNGEON_CARRYOVER_STACK_CAP, DUNGEON_CARRYOVER_TURNS_CAP, DUNGEON_FIRST_EVENT_KEY, DUNGEON_MAX_CLASS_LEVEL, DUNGEON_MODIFIERS, DUNGEON_REWARD_WAVES, canGrantDungeonCopyAmount, canUseDungeonCards, isLegacyDiceCardMode, getDungeonDifficulty, getDungeonEliteDieSides, getDungeonEliteSkillMultiplier, getDungeonEnemyCriticalChance, getDungeonEventWindow, getDungeonModifier, getDungeonMusicEffects, getDungeonNextWaveTurn, getDungeonStageReward, getDungeonSpeedMultiplier, getDungeonWaveSpec, normalizeDungeonCarryover, normalizeDungeonCopyAmount, pickDungeonCopyTypeId, resolveDungeonCarryoverInstanceIds, resolveDungeonWaveLoadout } from '../src/systems/DungeonEvent';
import { getBasicAttackProjectileCount, getExecutionRhythmBoost } from '../src/systems/CombatSkills';
import { DUNGEON_ENEMY_DUPLICATE_COPY_CAP, DUNGEON_ENEMY_DUPLICATE_START_WAVE, createDungeonSeededRng, pickDungeonEnemyTypeIds, rollDungeonSeededInt } from '../src/systems/DungeonEvent';
import { drawDungeonScopeMarks } from '../src/systems/DungeonCards';
import { applyDungeonCardSpendRefund, beginDungeonCardSpend, clearDungeonCardSpend, discardDungeonRunCache, getDungeonCardSpend, getDungeonRun, markDungeonCardSpendDebited, normalizeDungeonRun, resolveDungeonCardSpendRefund, resolveDungeonCardWalletRefund, saveDungeonRun, type DungeonCardSpend } from '../src/systems/DungeonStore';
import { initializeSecureStorage } from '../src/utils/SecureStorage';
import { getDiamonds, setDiamonds } from '../src/data/dice';
import { getHardDailyEnemyClassLevel, getSeededDailyIndex, getSeededDailyRange, getTopProfileDice } from '../src/systems/DailyChallenges';
import { getDungeonQuitRewardWave, getDungeonResultTransition } from '../src/systems/DungeonRunFlow';
import { applyDiceTalent, areTalentsSuppressedForChallenge } from '../src/systems/DiceTalents';
import { normalizeDiceCopyCount } from '../src/data/dice';
import { DUNGEON_INTRO_WAVES, getDungeonIntroForWave } from '../src/systems/DungeonIntros';
import { COMBAT_TIME_LIMIT_MS, getCombatTimeSpeedMultiplier, scaleAnimationDuration } from '../src/systems/CombatPacing';
import { canOfferDiceCards, DICE_CARD_KINDS, DICE_CARD_OFFER_TURNS, DICE_CARD_RARITY_FALLBACKS, DICE_CARD_VALUES, getDiceCardInfo, getDiceCardMagnitude, getDiceCardRuntimeContribution, isDiceCardTypeUpgradeKey, resolveDiceCardMaxHealth, rollDiceCards, type DiceCard } from '../src/systems/DiceCards';
import { formatTurnWaveLabel, getDicePreviewScrollMetrics } from '../src/systems/ArenaHud';
import {
  DICE_CARD_KINDS as SERVER_DICE_CARD_KINDS,
  DICE_CARD_OFFER_TURNS as SERVER_DICE_CARD_OFFER_TURNS,
  DICE_CARD_RARITY_FALLBACKS as SERVER_DICE_CARD_RARITY_FALLBACKS,
  DICE_CARD_VALUES as SERVER_DICE_CARD_VALUES,
  getDiceCardMagnitude as getServerDiceCardMagnitude,
  resolveDiceCardMaxHealth as resolveServerDiceCardMaxHealth
} from '../server/src/combat/dice-cards';
import { applyDungeonCardStats, canShuffleDungeonCards, DUNGEON_CARD_KINDS, DUNGEON_CARD_MAX_STACKS, DUNGEON_MARKED_IN_SKILL, DUNGEON_SLUGFEST_SKILL, canAddDungeonCard, resolveIgnitionDamage, createDungeonCard, createDungeonCardState, dungeonCardsConflict, ensureDungeonScopeMarks, getDungeonCardDamageMultiplier, getDungeonCardDescription, getDungeonCardEffects, getDungeonCardKillsRequired, getDungeonCardMaxStacks, getDungeonCardNonUniqueDrawRarityRoll, getDungeonCardPresentation, getDungeonCardRarityRoll, getDungeonCardRarities, getDungeonCardShuffleCost, getDungeonCardStackCount, getDungeonCardUniqueDrawRarityRoll, isDungeonCardUniqueDraw, normalizeDungeonCardState, pickDungeonCard, registerDungeonCardKills, removeDungeonCardHealth, resolveDungeonCardHealthAdjustment, resolveDungeonCarryoverAttack, resolveDungeonCarryoverHealth, rollDungeonCardChoices } from '../src/systems/DungeonCards';
import { findAttackTarget, getTerminalBattleOwner } from '../src/systems/BattleState';
import { getCombatDistance, getCoveredEnemyColumns, getCoveredEnemyTileCount, getDisplayedRangeCoverage, getFootprintAdjustedRange } from '../src/systems/CombatRange';
import { addScopeStack, getRuntimeSkillMeta, getRuntimeSkillMetaForTrigger, resolveScopeShotDamage } from '../src/systems/DiceSkills';
import { TransformState, type TransformStateHost } from '../src/systems/TransformState';
import { chooseInfiltratorPlacement, clampDamageReduction, collectCombatStartAuras, combineDamageReduction, computeCombatStartBonus, executeActiveSkillEffects, executeRevengeSkillEffects, formatActiveSkillActionLabel, formatCombatAmount, formatCombatHealingActionLabel, formatCombatSkillLabel, formatCombatSkillTypeLabel, formatRicochetAggregationLabel, getCombatStartManaEffect, getMaxHealthHealAmount, resolveCombatEndHealAmount, resolveHealingFeedback, resolveMaxHealthGainCurrentHealth, MAX_DAMAGE_REDUCTION, resolvePlagueSpawn, resolveReviveStats } from '../src/systems/CombatSkills';
import { SecureShuffleBag } from '../src/utils/RandomManager';
import { DICE_STATUS_EFFECT_POOL } from '../src/types/game';
import { StatusEffectStore, type StatusEffectHooks, type StatusEffectTick } from '../src/systems/StatusEffects';
import { BOSSFIGHT_BOSSES, BOSSFIGHT_BOSS_METADATA, BOSSFIGHT_MENU_STATE_KEY, BOSSFIGHT_PROGRESS_KEY, MAX_BOSSFIGHT_LEVEL, getBossMusicKey, getBossfightMenuState, getBossfightProgress, getBossfightRewards, normalizeBossfightProgress, saveBossfightMenuState, type BossMusicBoss } from '../src/systems/BossStore';
import { CHALLENGE_RANDOM_MODIFIERS, CHALLENGE_REWARD_CLAIMS_KEY, CHALLENGE_STATUS_KEY, canChallengeBeMarkedFailed, getChallengeClaimKey, getChallengeEnemyConfig, getChallengeRandomModifier, getChallengeReward, getChallengeStartConfig, getChallengeStatus, getChallengeStatusLabel, getChallengeUIConfig, getDailyChallengeKey, getDailyLoadoutMode, getDailySeededIndex, getDailySeededModifier, getDailySeededRange, getDailyUsesRandomClassUps, isHardDaily } from '../src/systems/ChallengeStore';
import type { DiceDefinition, DiceInstanceState, DicePoolDefinition, DiceSkillDefinition, MatchBattleState } from '../src/types/game';
import './arch-refactor.test';
import './session-stores.test';

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
  assert.equal(formatCombatSkillTypeLabel('Active'), 'Active');
  assert.equal(formatCombatSkillTypeLabel('CombatStart'), 'Combat Start');
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

test('self-targeted healing labels display itself', () => {
  assert.equal(
    formatCombatHealingActionLabel('Active', 'Healing Dice', true),
    'Active heals itself'
  );
  assert.equal(
    formatCombatHealingActionLabel('Active', 'Allied Dice'),
    'Active heals Allied Dice'
  );
  assert.equal(
    formatCombatHealingActionLabel(undefined, 'Druid', true),
    'Heals itself'
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

test('Dungeon carryover retains positive attack-count and per-die buffs for the next wave panel', () => {
  const carryover = normalizeDungeonCarryover({
    turn: 6,
    dice: [{
      instanceId: 'player-Fire-1',
      typeId: 'Fire',
      currentHealth: 80,
      maxHealth: 100,
      isDestroyed: false,
      mana: 3,
      activeMana: [],
      statuses: {
        slow: { delta: 2, turns: 3, stacks: [{ delta: 1, turns: 3 }, { delta: 1, turns: 2 }] }
      },
      attackCountBuff: { extra: 1, turns: 2 },
      basicAttackDamage: 7,
      manaPausedTurns: 2
    }]
  });

  assert.ok(carryover);
  const die = carryover.dice[0]!;
  assert.equal(die.statuses.slow?.delta, 2);
  assert.equal(die.statuses.slow?.stacks?.length, 2);
  assert.equal(die.attackCountBuff?.extra, 1);
  assert.equal(die.basicAttackDamage, 7);
  assert.equal(die.manaPausedTurns, 2);
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

test('Dungeon carryover keeps linked summon children without requiring their parent in the next loadout', () => {
  const carryover = normalizeDungeonCarryover({
    turn: 1,
    dice: [
      {
        instanceId: 'player-Zombie-9',
        typeId: 'Zombie',
        classLevel: 1,
        currentHealth: 100,
        maxHealth: 100,
        isDestroyed: true,
        mana: 0,
        activeMana: [] as Array<[string, number]>,
        statuses: {}
      },
      {
        instanceId: 'player-Zombie-plague-1',
        typeId: 'Zombie',
        classLevel: 1,
        currentHealth: 30,
        maxHealth: 100,
        isDestroyed: false,
        mana: 0,
        activeMana: [] as Array<[string, number]>,
        statuses: {},
        summonedByInstanceId: 'player-Zombie-9'
      }
    ]
  });
  assert.ok(carryover);
  assert.equal(carryover.dice[1]?.summonedByInstanceId, 'player-Zombie-9');
  const allowed = resolveDungeonCarryoverInstanceIds(
    carryover,
    [{ instanceId: 'player-Fire-1', typeId: 'Fire' }],
    'Classic'
  );
  assert.equal(allowed.has('player-Zombie-plague-1'), true);
  assert.equal(allowed.has('player-Zombie-9'), false);
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
  discardDungeonRunCache(scene);
  assert.equal(entries.has('arena:dungeonRun'), false);
});

test('Dungeon Card spend is not cached when its escrow cannot be persisted', () => {
  const entries = new Map<string, unknown>();
  const scene = {
    registry: {
      set: (key: string, value: unknown) => entries.set(key, value),
      get: (key: string) => entries.get(key),
      remove: (key: string) => entries.delete(key)
    }
  } as unknown as Parameters<typeof beginDungeonCardSpend>[0];
  const spend = beginDungeonCardSpend(scene, {
    eventKey: '2026-11-03',
    wave: 4,
    turn: 2,
    cost: 15,
    shufflesUsed: 2
  });
  assert.equal(spend, null);
  assert.equal(entries.has('arena:dungeonCardSpend'), false);
});

test('Dungeon Card escrow debit, run save, refund, and resume reconciliation survive storage failures', async () => {
  await initializeSecureStorage();
  const values = new Map<string, string>();
  let dropWrites = false;
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { if (!dropWrites) values.set(key, String(value)); }
  };
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });

  try {
    const entries = new Map<string, unknown>();
    const scene = {
      registry: {
        set: (key: string, value: unknown) => entries.set(key, value),
        get: (key: string) => entries.get(key),
        remove: (key: string) => entries.delete(key)
      }
    } as unknown as Parameters<typeof beginDungeonCardSpend>[0];
    const eventKey = '2026-11-03';

    // A dropped escrow write must not produce a cached charge.
    dropWrites = true;
    assert.equal(beginDungeonCardSpend(scene, {
      eventKey, wave: 4, turn: 2, cost: 15, shufflesUsed: 2, walletBefore: 100, walletAfter: 85
    }), null);
    assert.equal(entries.has('arena:dungeonCardSpend'), false);

    dropWrites = false;
    const spend = beginDungeonCardSpend(scene, {
      eventKey, wave: 4, turn: 2, cost: 15, shufflesUsed: 2, walletBefore: 100, walletAfter: 85
    });
    assert.ok(spend);
    dropWrites = true;
    assert.equal(markDungeonCardSpendDebited(scene, spend), null);
    assert.notEqual(getDungeonCardSpend(scene)?.debited, true);
    dropWrites = false;
    const debited = markDungeonCardSpendDebited(scene, spend);
    assert.ok(debited);
    assert.equal(debited?.debited, true);

    // A failed run save must not leave a resume proof behind.
    const carryover = normalizeDungeonCarryover({
      turn: 1,
      dice: [{
        instanceId: 'player-Fire-1',
        typeId: 'Fire',
        currentHealth: 10,
        maxHealth: 10,
        isDestroyed: false,
        mana: 0,
        activeMana: [],
        statuses: {}
      }],
      dungeonCards: {
        cards: [], killsTowardNext: 0, cardsPicked: 0, pendingDraws: 0,
        shufflesUsed: 1, lastShuffleTurn: 1
      }
    });
    assert.ok(carryover);
    dropWrites = true;
    assert.equal(saveDungeonRun(scene, {
      eventKey, wave: 2, carryover,
      config: { randomMode: false, randomizeLoadout: false, useLevelling: true },
      savedAt: 1
    }), false);
    discardDungeonRunCache(scene);
    assert.equal(getDungeonRun(scene), null);

    // The escrow is still recoverable from storage and the missing proof refunds it.
    entries.delete('arena:dungeonCardSpend');
    const restoredSpend = getDungeonCardSpend(scene);
    assert.ok(restoredSpend);
    assert.equal(restoredSpend?.debited, true);
    assert.equal(resolveDungeonCardSpendRefund({
      spend: restoredSpend, eventKey, wave: 2, savedShufflesUsed: 0
    }), 15);
    assert.equal(resolveDungeonCardSpendRefund({
      spend: restoredSpend, eventKey, wave: 2, savedShufflesUsed: 1
    }), 15);
    assert.equal(resolveDungeonCardSpendRefund({
      spend: restoredSpend, eventKey, wave: 2, savedShufflesUsed: 2
    }), 0);

    // A failed wallet write keeps the escrow available for a later retry.
    dropWrites = true;
    const failedRefund = applyDungeonCardSpendRefund({
      spend: restoredSpend,
      eventKey,
      wave: 2,
      savedShufflesUsed: 0,
      currentDiamonds: 85,
      persistRefund: (next) => setDiamonds(scene, next)
    });
    assert.deepEqual(failedRefund, { refunded: 0, pending: true, clear: false });
    assert.equal(getDungeonCardSpend(scene)?.debited, true);

    // A verified wallet write settles the refund and only then clears the escrow.
    dropWrites = false;
    let persistedRefund = 0;
    const refund = applyDungeonCardSpendRefund({
      spend: restoredSpend,
      eventKey,
      wave: 2,
      savedShufflesUsed: 0,
      currentDiamonds: 85,
      persistRefund: (next) => {
        persistedRefund = next;
        return setDiamonds(scene, next);
      }
    });
    assert.deepEqual(refund, { refunded: 15, pending: false, clear: true });
    assert.equal(persistedRefund, 100);
    assert.equal(getDiamonds(scene), 100);
    clearDungeonCardSpend(scene);
    assert.equal(getDungeonCardSpend(scene), null);

    // A saved run that already records the shuffle is proof to keep the charge.
    const committedCarryover = normalizeDungeonCarryover({
      turn: 1,
      dice: carryover.dice,
      dungeonCards: {
        cards: [], killsTowardNext: 0, cardsPicked: 0, pendingDraws: 0,
        shufflesUsed: 2, lastShuffleTurn: 2
      }
    });
    assert.ok(committedCarryover);
    assert.equal(saveDungeonRun(scene, {
      eventKey, wave: 2, carryover: committedCarryover,
      config: { randomMode: false, randomizeLoadout: false, useLevelling: true },
      savedAt: 2
    }), true);
    const savedRun = getDungeonRun(scene);
    const savedShuffles = savedRun?.carryover?.dungeonCards?.shufflesUsed;
    assert.equal(savedShuffles, 2);
    assert.equal(resolveDungeonCardSpendRefund({
      spend: restoredSpend,
      eventKey,
      wave: 2,
      savedShufflesUsed: savedShuffles ?? 0
    }), 0);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('Client fixes stay wired through their shared pipelines and turn snapshots', () => {
  const arena = readFileSync('src/scenes/ArenaScene.ts', 'utf8');
  const animation = readFileSync('src/utils/AnimationManager.ts', 'utf8');
  const audio = readFileSync('src/utils/AudioManager.ts', 'utf8');
  const skills = readFileSync('src/systems/CombatSkills.ts', 'utf8');
  const dungeonStore = readFileSync('src/systems/DungeonStore.ts', 'utf8');

  // Arrayed SFX must rotate through one non-repeating bag, not play every file at once.
  assert.ok(audio.includes('SecureShuffleBag<string>'));
  assert.ok(audio.includes('const key = bag.pick(available);'));

  // Phaser effect ownership and pacing stay in AnimationManager.
  assert.ok(animation.includes('hammerQueues'));
  assert.ok(animation.indexOf('scaleAnimationDuration(') >= 0);
  for (const call of [
    'AnimationManager.animateAttackBeam(',
    'AnimationManager.animateMeteorImpact(',
    'AnimationManager.animateNuclearMissile(',
    'AnimationManager.animateJudgmentHammer('
  ]) {
    assert.ok(arena.includes(call), `${call} should remain routed through AnimationManager`);
  }

  // Critical values must use the one formatting pipeline.
  assert.ok(skills.includes('export function formatCombatAmount('));
  assert.ok(arena.includes('formatCombatAmount('));
  assert.ok(!arena.includes('criticalSuffix'));
  assert.ok(arena.includes('this.showHealText(target, healing.total'));
  assert.ok(arena.includes('this.summonedByInstance.set(instanceId, attacker.instanceId);'));

  // Ricochet details report every affected die and never repeat the primary heal.
  assert.ok(arena.includes('Ricochet damages'));
  assert.ok(!arena.includes('Ricochet hit '));
  assert.ok(arena.includes('this.combatActionDetails.push(...ricochet.details);'));
  assert.ok(arena.includes('this.combatActionDetails.push(...healDetails);'));
  assert.ok(arena.includes('if (!isPrimary && healResult.healed > 0)'));

  // A shuffled draft persists its exact offer and the turn it must resume on.
  assert.ok(arena.includes('draftOffer: nextChoices'));
  assert.ok(arena.includes('resumeTurn'));

  // Dungeon escrow writes are verified and refund settlement is shared with tests.
  assert.ok(dungeonStore.includes('writeVerified('));
  assert.ok(dungeonStore.includes('export function applyDungeonCardSpendRefund('));
  assert.ok(arena.includes('applyDungeonCardSpendRefund('));

  // Lobby creation stays async and failed attempts return to the create dialog.
  assert.ok(arena.includes('private async queueArenaMultiplayer('));
  const lobbyStart = arena.indexOf('private async queueArenaMultiplayer(');
  const lobbyEnd = arena.indexOf('private closeMultiplayerLobbyWaitOnFailure(');
  assert.ok(lobbyStart >= 0 && lobbyEnd > lobbyStart);
  const lobby = arena.slice(lobbyStart, lobbyEnd);
  assert.ok(lobby.includes('await this.multiplayer.queue('));
  assert.ok(lobby.includes('this.closeMultiplayerLobbyWaitOnFailure(options);'));
  assert.ok(!arena.includes('START LOCAL PREVIEW'));
  const createStart = arena.indexOf("createButton.on('pointerdown'");
  const createEnd = arena.indexOf('elements.push(createButton, createLabel)', createStart);
  assert.ok(createStart >= 0 && createEnd > createStart);
  const create = arena.slice(createStart, createEnd);
  assert.ok(create.includes('if (!this.multiplayer.configured)'));
  assert.ok(create.indexOf('if (!this.multiplayer.configured)') < create.indexOf('this.openMultiplayerLobbyWaitModal()'));

  // Dungeon checkpoints happen once per completed turn, not on every enemy kill.
  const killStart = arena.indexOf('private recordDungeonCardKill(');
  const killEnd = arena.indexOf('private setupGridDropZones(', killStart);
  assert.ok(killStart >= 0 && killEnd > killStart);
  assert.ok(!arena.slice(killStart, killEnd).includes('persistDungeonRunProgress'));
  assert.ok(arena.includes('const completedTurn = this.gameState.turn;'));
  assert.ok(arena.includes('this.persistDungeonTurnSnapshot(completedTurn);'));
  assert.ok(arena.includes('completedTurn = Math.max(1, this.gameState.turn - 1)'));

  // Restored enemies register their class, attack, and definition like players do.
  const enemyStart = arena.indexOf('private applyDungeonEnemyCarryover(');
  const enemyEnd = arena.indexOf('private applyDungeonStatuses(', enemyStart);
  assert.ok(enemyStart >= 0 && enemyEnd > enemyStart);
  const enemy = arena.slice(enemyStart, enemyEnd);
  assert.ok(enemy.includes('this.instanceDefinitionOverrides.set(die.instanceId'));
  assert.ok(enemy.includes('health: Math.max(1, Math.floor(saved.maxHealth))'));
  assert.ok(enemy.includes('saved.attack !== undefined'));
  assert.ok(enemy.includes('this.enemyClassLevels.set(`${die.typeId}:${die.instanceId}`, savedClassLevel);'));
});

test('Dungeon first-strike attacks inherit projectile and rapid-fire shots', () => {
  assert.equal(getBasicAttackProjectileCount({}), 1);
  assert.equal(getBasicAttackProjectileCount({ timedProjectiles: 3 }), 3);
  assert.equal(getBasicAttackProjectileCount({
    timedProjectiles: 2,
    passiveProjectiles: 1,
    dungeonCardProjectiles: 2,
    rapidFireIncrease: 1
  }), 6);
  assert.equal(getBasicAttackProjectileCount({ timedProjectiles: 0, rapidFireIncrease: -3 }), 1);
  assert.deepEqual(getExecutionRhythmBoost({ remaining: 2, damageMultiplier: 2 }), { multiplier: 2, consume: true });
  assert.deepEqual(getExecutionRhythmBoost({ remaining: 1 }), { multiplier: 2, consume: true });
  assert.deepEqual(getExecutionRhythmBoost({ remaining: 0, damageMultiplier: 5 }), { multiplier: 1, consume: false });
  assert.deepEqual(getExecutionRhythmBoost({ remaining: Number.NaN, damageMultiplier: 5 }), { multiplier: 1, consume: false });
});

test('Dungeon enemy loadouts are seeded per wave and duplicate past wave 20', () => {
  const pool = ['Fire', 'Ice', 'Wind', 'Electric', 'Time', 'Battery'];
  const input = {
    eventKey: '2026-11-03',
    wave: 12,
    count: 5,
    poolTypeIds: pool,
    bossTypeId: null,
    miniBossTypeId: null
  };
  const first = pickDungeonEnemyTypeIds(input);
  assert.deepEqual(pickDungeonEnemyTypeIds(input), first);
  assert.equal(first.length, 5);
  assert.equal(new Set(first).size, first.length);
  assert.equal(first.every((typeId) => pool.includes(typeId)), true);

  const bossWave = pickDungeonEnemyTypeIds({ ...input, wave: 10, count: 4, bossTypeId: 'Magician' });
  assert.equal(bossWave[0], 'Magician');
  assert.equal(bossWave.length, 4);
  assert.equal(new Set(bossWave.slice(1)).size, 3);

  const miniBossWave = pickDungeonEnemyTypeIds({ ...input, wave: 15, count: 4, miniBossTypeId: 'Imp' });
  assert.equal(miniBossWave[0], 'Imp');

  const uniqueWave = pickDungeonEnemyTypeIds({ ...input, wave: DUNGEON_ENEMY_DUPLICATE_START_WAVE, count: 6, poolTypeIds: ['Fire', 'Ice'] });
  assert.equal(uniqueWave.length, 2);
  const duplicateWave = pickDungeonEnemyTypeIds({ ...input, wave: DUNGEON_ENEMY_DUPLICATE_START_WAVE + 1, count: 6, poolTypeIds: ['Fire', 'Ice'] });
  assert.equal(duplicateWave.length, 6);
  assert.equal(new Set(duplicateWave).size, 2);
  const copies = duplicateWave.reduce<Record<string, number>>((counts, typeId) => ({
    ...counts,
    [typeId]: (counts[typeId] ?? 0) + 1
  }), {});
  assert.equal(Object.values(copies).every((count) => count <= DUNGEON_ENEMY_DUPLICATE_COPY_CAP), true);
  assert.deepEqual(pickDungeonEnemyTypeIds({ ...input, wave: DUNGEON_ENEMY_DUPLICATE_START_WAVE + 1, count: 6, poolTypeIds: ['Fire', 'Ice'] }), duplicateWave);
});

test('Dungeon seeded placement and pip rolls replay from the wave seed', () => {
  const placementSeed = '2026-11-03:dungeon-enemy-placement:7:v1';
  const rollSequence = (seed: string) => {
    const rng = createDungeonSeededRng(seed);
    return Array.from({ length: 24 }, () => rollDungeonSeededInt(rng, 0, 4));
  };
  const placements = rollSequence(placementSeed);
  assert.deepEqual(rollSequence(placementSeed), placements);
  assert.equal(placements.every((roll) => Number.isInteger(roll) && roll >= 0 && roll <= 4), true);

  const pipRows = Array.from({ length: 20 }, () => rollDungeonSeededInt(createDungeonSeededRng('2026-11-03:dungeon-enemy-pips:7:1:v1'), 1, 6));
  assert.equal(pipRows.every((roll) => roll >= 1 && roll <= 6), true);
  assert.equal(rollDungeonSeededInt(() => 1, 2, 5), 5);
  assert.equal(rollDungeonSeededInt(() => 0, 2, 5), 2);
  assert.equal(rollDungeonSeededInt(() => Number.NaN, 2, 5), 2);
  assert.equal(rollDungeonSeededInt(() => 0.5, 5, 2), 4);
});

test('Dungeon Card drafts do not offer conflicting unique variants', () => {
  const feelRare = createDungeonCard('Feel The Gale', 'Rare', 'Wind');
  const feelLegendary = createDungeonCard('Feel The Gale', 'Legendary', 'Wind');
  assert.equal(dungeonCardsConflict(feelRare, feelLegendary), true);
  const bodyRare = createDungeonCard('Dice Body Shifter', 'Rare', 'Fire');
  const bodyEpic = createDungeonCard('Dice Body Shifter', 'Epic', 'Fire');
  const bodyIce = createDungeonCard('Dice Body Shifter', 'Epic', 'Ice');
  assert.equal(dungeonCardsConflict(bodyRare, bodyEpic), true);
  assert.equal(dungeonCardsConflict(bodyRare, bodyIce), false);
  assert.equal(dungeonCardsConflict(
    createDungeonCard('Dice Armor', 'Common', 'Fire'),
    createDungeonCard('Dice Armor', 'Rare', 'Fire')
  ), false);

  let state = createDungeonCardState();
  DUNGEON_CARD_KINDS.forEach((kind) => {
    if (kind === 'Feel The Gale' || kind === 'Dice Body Shifter') return;
    getDungeonCardRarities(kind).forEach((rarity) => {
      const card = createDungeonCard(kind, rarity, 'Wind');
      while (canAddDungeonCard(state, card)) state = pickDungeonCard(state, card);
    });
  });
  const choices = rollDungeonCardChoices(
    state,
    { typeIds: ['Wind'], activeSkillTypeIds: ['Wind'] },
    3,
    createDungeonSeededRng('draft-unique-conflict:v1')
  );
  choices.forEach((card, index) => {
    choices.slice(index + 1).forEach((other) => assert.equal(dungeonCardsConflict(card, other), false));
  });
  assert.ok(choices.length <= 2);
});

test('Dungeon Card offers and scope marks replay from the persisted draft seed', () => {
  const state = createDungeonCardState();
  const context = { typeIds: ['Fire', 'Ice', 'Wind'], activeSkillTypeIds: ['Fire'] };
  const offers = rollDungeonCardChoices(state, context, 3, createDungeonSeededRng('dungeon-card-offer:event:4:0:0:v1'));
  const replay = rollDungeonCardChoices(state, context, 3, createDungeonSeededRng('dungeon-card-offer:event:4:0:0:v1'));
  assert.deepEqual(offers.map((card) => card.key), replay.map((card) => card.key));
  assert.equal(offers.length, 3);
  const shuffled = rollDungeonCardChoices(state, context, 3, createDungeonSeededRng('dungeon-card-offer:event:4:0:1:v1'));
  assert.notDeepEqual(offers.map((card) => card.key), shuffled.map((card) => card.key));

  const marks = drawDungeonScopeMarks(3, createDungeonSeededRng('dungeon-scope-marks:event:4:1:0:v1'));
  const markReplay = drawDungeonScopeMarks(3, createDungeonSeededRng('dungeon-scope-marks:event:4:1:0:v1'));
  assert.deepEqual(marks, markReplay);
  assert.equal(new Set(marks).size, 3);
  assert.notDeepEqual(marks, drawDungeonScopeMarks(3, createDungeonSeededRng('dungeon-scope-marks:event:5:1:0:v1')));
});

test('Dungeon Card shuffle spend is refunded when the saved run cannot prove it', () => {
  const spend: DungeonCardSpend = { eventKey: '2026-11-03', wave: 4, turn: 2, cost: 15, shufflesUsed: 2 };
  assert.equal(resolveDungeonCardSpendRefund({ spend, eventKey: '2026-11-03', wave: 4, savedShufflesUsed: 1 }), 15);
  assert.equal(resolveDungeonCardSpendRefund({ spend, eventKey: '2026-11-03', wave: 4, savedShufflesUsed: 2 }), 0);
  assert.equal(resolveDungeonCardSpendRefund({ spend, eventKey: '2026-11-03', wave: 5, savedShufflesUsed: 0 }), 15);
  assert.equal(resolveDungeonCardSpendRefund({ spend, eventKey: '2026-11-03', wave: 5, savedShufflesUsed: 2 }), 0);
  assert.equal(resolveDungeonCardSpendRefund({ spend, eventKey: '2026-11-04', wave: 4, savedShufflesUsed: 2 }), 15);
  assert.equal(resolveDungeonCardSpendRefund({ spend: null, eventKey: '2026-11-03', wave: 4, savedShufflesUsed: 0 }), 0);
  assert.equal(resolveDungeonCardSpendRefund({ spend, eventKey: '2026-11-03', wave: 4, savedShufflesUsed: Number.NaN }), 15);

  const savedCards = normalizeDungeonCardState({ shufflesUsed: 2, lastShuffleTurn: 2 });
  assert.equal(savedCards.shufflesUsed, 2);
  assert.equal(savedCards.lastShuffleTurn, 2);
});

test('Dungeon Card draft offers and the exact resume turn survive a refresh', () => {
  const offer = [
    createDungeonCard('Dice Health', 'Common', 'Fire'),
    createDungeonCard('Dice Attack', 'Rare', 'Ice'),
    createDungeonCard('Dice Armor', 'Epic', 'Wind')
  ];
  const state = normalizeDungeonCardState({
    shufflesUsed: 1,
    lastShuffleTurn: 1,
    draftOffer: offer
  });
  assert.deepEqual(state.draftOffer?.map((card) => card.key), offer.map((card) => card.key));
  assert.equal(canShuffleDungeonCards(state, 1), false);

  const carryover = normalizeDungeonCarryover({
    turn: 1,
    resumeTurn: 1,
    dice: [{
      instanceId: 'player-Fire-1',
      typeId: 'Fire',
      currentHealth: 10,
      maxHealth: 10,
      isDestroyed: false,
      mana: 0,
      activeMana: [],
      statuses: {}
    }],
    dungeonCards: state
  });
  assert.equal(carryover?.resumeTurn, 1);
  assert.equal(canShuffleDungeonCards(carryover!.dungeonCards!, carryover!.resumeTurn!), false);
});

test('Dungeon Card refunds only restore Diamonds that were actually debited', () => {
  const spend: DungeonCardSpend = {
    eventKey: '2026-11-03',
    wave: 4,
    turn: 2,
    cost: 15,
    shufflesUsed: 2,
    walletBefore: 100,
    walletAfter: 85
  };
  assert.equal(resolveDungeonCardWalletRefund(spend, 100), 0);
  assert.equal(resolveDungeonCardWalletRefund(spend, 85), 15);
  assert.equal(resolveDungeonCardWalletRefund(spend, 90), 10);
  assert.equal(resolveDungeonCardWalletRefund({ ...spend, debited: true }, 250), 15);
  assert.equal(resolveDungeonCardWalletRefund({ ...spend, walletBefore: undefined, walletAfter: undefined }, 0), 15);
  assert.equal(resolveDungeonCardWalletRefund(null, 100), 0);
});

test('Arrayed SFX candidates rotate without repeats and keep every file eligible', () => {
  const keys = ['dice_reverse_merge_01', 'dice_reverse_merge_02', 'dice_reverse_merge_03'];
  const bag = new SecureShuffleBag<string>();
  const firstCycle = Array.from({ length: keys.length }, () => bag.pick(keys));
  assert.deepEqual(new Set(firstCycle), new Set(keys));
  assert.equal(new Set(firstCycle).size, keys.length);

  const secondCycle = Array.from({ length: keys.length }, () => bag.pick(keys));
  assert.deepEqual(new Set(secondCycle), new Set(keys));
  assert.notEqual(secondCycle[0], firstCycle[firstCycle.length - 1]);

  const narrowed = ['dice_reverse_merge_01', 'dice_reverse_merge_02'];
  for (let index = 0; index < 12; index++) assert.ok(narrowed.includes(bag.pick(narrowed)!));
  assert.equal(bag.pick([]), undefined);
});

test('Combat log amounts share one critical pipeline', () => {
  assert.equal(formatCombatAmount(1234, false), '1,234');
  assert.equal(formatCombatAmount(1234, true), '1,234 (CRITICAL)');
  assert.equal(formatCombatAmount(1234, false, 'damage'), '1,234 damage');
  assert.equal(formatCombatAmount(1234, true, 'damage'), '1,234 damage (CRITICAL)');
  assert.equal(formatCombatAmount(Number.NaN, true), '0 (CRITICAL)');
  assert.deepEqual(resolveHealingFeedback(1000, 250, 900), { total: 900, applied: 750 });
  assert.deepEqual(resolveHealingFeedback(1000, 1000, 500), { total: 500, applied: 0 });
  assert.deepEqual(resolveHealingFeedback(1000, 250, Number.NaN), { total: 0, applied: 0 });
  assert.equal(scaleAnimationDuration(900, 1), 900);
  assert.equal(scaleAnimationDuration(900, 4), 225);
  assert.equal(scaleAnimationDuration(900, 8), 113);
  assert.equal(scaleAnimationDuration(900, Number.NaN), 900);
  assert.equal(scaleAnimationDuration(0, 4), 1);
});

test('Dungeon run save keeps the fixed loadout and card shuffle state across resume', () => {
  const run = normalizeDungeonRun({
    eventKey: '2026-11-03',
    wave: 3,
    carryover: {
      turn: 4,
      dice: [{
        instanceId: 'player-Fire-1',
        typeId: 'Fire',
        currentHealth: 10,
        maxHealth: 10,
        isDestroyed: false,
        mana: 0,
        activeMana: [],
        statuses: {}
      }],
      dungeonCards: normalizeDungeonCardState({ shufflesUsed: 1, lastShuffleTurn: 4, pendingDraws: 2, cardsPicked: 3 })
    },
    config: { randomMode: true, randomizeLoadout: false, useLevelling: true },
    loadout: [{ typeId: 'Fire', classLevel: 3, talentIndex: null }, { typeId: 'Ice', classLevel: 2, talentIndex: 1 }],
    savedAt: 5
  });
  assert.ok(run);
  assert.deepEqual(run.loadout, [{ typeId: 'Fire', classLevel: 3, talentIndex: null }, { typeId: 'Ice', classLevel: 2, talentIndex: 1 }]);
  assert.equal(run.carryover?.dungeonCards?.shufflesUsed, 1);
  assert.equal(run.carryover?.dungeonCards?.lastShuffleTurn, 4);
  assert.equal(run.carryover?.dungeonCards?.pendingDraws, 2);
  assert.equal(normalizeDungeonRun(run)?.loadout?.length, 2);
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

  assert.equal(getDungeonQuitRewardWave(4), null);
  assert.equal(getDungeonQuitRewardWave(5), 5);
  assert.equal(getDungeonQuitRewardWave(6), null);
  assert.equal(getDungeonQuitRewardWave(10), 10);
  assert.equal(getDungeonQuitRewardWave(50), 50);
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
      attackCountEffectSeen: { positive: true, negative: true },
      growthDelta: 3,
      basicAttackDamage: 50,
      attackCountBuff: { extra: 2, turns: 3 },
      projectileCountBuff: { count: 2, turns: 4 },
      manaPausedTurns: 2,
      reviveCount: 2,
      soulCount: 4,
      scopeStacks: 3,
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
  assert.deepEqual(carryover.dice[0]?.attackCountEffectSeen, { positive: true, negative: true });
  assert.equal(carryover.dice[0]?.basicAttackDamage, 50);
  assert.deepEqual(carryover.dice[0]?.attackCountBuff, { extra: 2, turns: 3 });
  assert.deepEqual(carryover.dice[0]?.projectileCountBuff, { count: 2, turns: 4 });
  assert.equal(carryover.dice[0]?.manaPausedTurns, 2);
  assert.equal(carryover.dice[0]?.reviveCount, 2);
  assert.equal(carryover.dice[0]?.soulCount, 4);
  assert.equal(carryover.dice[0]?.scopeStacks, 3);
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

test('Hibernation is a carryover status and remains in the shared status pool', () => {
  assert.ok(DICE_STATUS_EFFECT_POOL.includes('hibernation'));
  const carryover = normalizeDungeonCarryover({
    turn: 1,
    dice: [{
      instanceId: 'player-Fire-1',
      typeId: 'Fire',
      currentHealth: 10,
      maxHealth: 10,
      isDestroyed: false,
      mana: 0,
      activeMana: [],
      statuses: { hibernation: 2 }
    }]
  });
  assert.ok(carryover);
  assert.equal(carryover.dice[0]?.statuses.hibernation, 2);

  const clamped = normalizeDungeonCarryover({
    turn: 1,
    dice: [{
      instanceId: 'player-Fire-2',
      typeId: 'Fire',
      currentHealth: 10,
      maxHealth: 10,
      isDestroyed: false,
      mana: 0,
      activeMana: [],
      statuses: { hibernation: 1e15 }
    }]
  });
  assert.equal(clamped?.dice[0]?.statuses.hibernation, DUNGEON_CARRYOVER_TURNS_CAP);
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

test('Dice Card max health survives a timed transform expiry', () => {
  const cards: DiceCard[] = [
    { key: 'Fire Upgrade:Silver', title: 'Fire Upgrade', rarity: 'Silver', kind: 'Type Upgrade', typeId: 'Fire' },
    { key: 'Straight Face:Gold', title: 'Straight Face', rarity: 'Gold', kind: 'Straight Face' }
  ];

  assert.equal(resolveDiceCardMaxHealth(100, cards, 'Fire', true), 244);
  assert.equal(resolveDiceCardMaxHealth(100, cards, 'Ice', true), 140);
  assert.equal(resolveDiceCardMaxHealth(100, cards, 'Fire', false), 175);
  assert.equal(resolveDiceCardMaxHealth(Number.NaN, [], 'Fire', true), 1);
});

test('Dice Cards own their presentation copy and runtime values', () => {
  const upgrade = getDiceCardInfo('Fire Upgrade:Gold', (typeId) => `${typeId} Dice`);
  assert.equal(upgrade.title, 'Fire Upgrade');
  assert.equal(upgrade.icon, '⚅');
  assert.match(upgrade.desc, /Fire gets \+100% basic\+skill damage and max HP/);

  const mana = getDiceCardInfo('Mana Potion:Silver');
  assert.match(mana.desc, /\+2 mana/);

  const fountain = getDiceCardInfo('Fountain of Love:Bronze');
  assert.match(fountain.desc, /10% of their max HP/);

  assert.equal(isDiceCardTypeUpgradeKey('Fire Upgrade:Gold'), true);
  assert.equal(isDiceCardTypeUpgradeKey('Fountain of Love:Gold'), false);
  assert.equal(getDiceCardInfo('Unknown:Silver').desc, '');

  const goldFireSupport = getDiceCardRuntimeContribution({ key: 'Fire Support:Gold', title: 'Fire Support', rarity: 'Gold', kind: 'Fire Support' });
  assert.equal(goldFireSupport.fireSupportAttacks, DICE_CARD_VALUES.fireSupportAttacks[3]);

  const goldOdd = getDiceCardRuntimeContribution({ key: 'Odd Investment:Gold', title: 'Odd Investment', rarity: 'Gold', kind: 'Odd Investment' });
  assert.equal(goldOdd.oddInvestmentDamage, DICE_CARD_VALUES.investmentDamage[3]);
  assert.equal(goldOdd.oddInvestmentReduction, DICE_CARD_VALUES.investmentReduction[3]);
  assert.equal(goldOdd.evenInvestmentDamage, 0);

  const upgradeContribution = getDiceCardRuntimeContribution({ key: 'Fire Upgrade:Gold', title: 'Fire Upgrade', rarity: 'Gold', kind: 'Type Upgrade', typeId: 'Fire' });
  assert.equal(upgradeContribution.typeUpgradeRate, DICE_CARD_VALUES.typeUpgradeRate[3]);

  for (const kind of DICE_CARD_KINDS) {
    const contribution = getDiceCardRuntimeContribution({ key: `${kind}:Gold`, title: kind, rarity: 'Gold', kind });
    assert.ok(Object.values(contribution).some((value) => value > 0), `${kind} should expose a runtime value`);
  }
});

test('Arena HUD embeds wave text in the turn label and scrolls past twenty dice', () => {
  assert.equal(formatTurnWaveLabel(3, -1, 4, 20), 'TURN 3 - WAVE 4/20');
  assert.equal(formatTurnWaveLabel(2, 10, 5, 20), 'TURN 2/10 - WAVE 5/20');
  assert.equal(formatTurnWaveLabel(7, -1), 'TURN 7');
  assert.equal(formatTurnWaveLabel(Number.NaN, Number.NaN, Number.NaN, 20), 'TURN 1');

  const twenty = getDicePreviewScrollMetrics(20);
  assert.equal(twenty.maxScroll, 0);
  assert.equal(twenty.viewportHeight, 320);

  const twentyOne = getDicePreviewScrollMetrics(21);
  assert.equal(twentyOne.maxScroll, 16);
  assert.equal(twentyOne.viewportHeight, 320);
  assert.equal(twentyOne.contentHeight, 336);

  assert.equal(getDicePreviewScrollMetrics(45, 999).scrollOffset, 400);
  assert.equal(getDicePreviewScrollMetrics(-3).maxScroll, 0);
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

test('Dungeon Cards bottom-deck shuffled offers and boost every tenth draw', () => {
  assert.equal(isDungeonCardUniqueDraw({ ...createDungeonCardState(), cardsPicked: 8 }), false);
  assert.equal(isDungeonCardUniqueDraw({ ...createDungeonCardState(), cardsPicked: 9 }), true);
  assert.equal(isDungeonCardUniqueDraw({ ...createDungeonCardState(), cardsPicked: 19 }), true);
  assert.equal(getDungeonCardUniqueDrawRarityRoll(() => 0), 'Common');
  assert.equal(getDungeonCardUniqueDrawRarityRoll(() => 0.1999), 'Common');
  assert.equal(getDungeonCardUniqueDrawRarityRoll(() => 0.2), 'Rare');
  assert.equal(getDungeonCardUniqueDrawRarityRoll(() => 0.5999), 'Rare');
  assert.equal(getDungeonCardUniqueDrawRarityRoll(() => 0.6), 'Epic');
  assert.equal(getDungeonCardUniqueDrawRarityRoll(() => 0.8999), 'Epic');
  assert.equal(getDungeonCardUniqueDrawRarityRoll(() => 0.9), 'Legendary');
  assert.equal(getDungeonCardUniqueDrawRarityRoll(() => 1), 'Legendary');
  assert.equal(getDungeonCardNonUniqueDrawRarityRoll(() => 0), 'Rare');
  assert.equal(getDungeonCardNonUniqueDrawRarityRoll(() => 0.5999), 'Rare');
  assert.equal(getDungeonCardNonUniqueDrawRarityRoll(() => 0.6), 'Epic');
  assert.equal(getDungeonCardNonUniqueDrawRarityRoll(() => 0.8999), 'Epic');
  assert.equal(getDungeonCardNonUniqueDrawRarityRoll(() => 0.9), 'Legendary');
  assert.equal(getDungeonCardNonUniqueDrawRarityRoll(() => 1), 'Legendary');

  const state = createDungeonCardState();
  const context = { typeIds: ['Sniper'], activeSkillTypeIds: [] };
  const initial = rollDungeonCardChoices(state, context, 3, createDungeonSeededRng('dungeon-bottom-deck:initial'));
  const bottomDeck = new Set(initial.map((card) => card.key));
  const shuffled = rollDungeonCardChoices(
    state,
    { ...context, bottomDeckKeys: bottomDeck },
    3,
    createDungeonSeededRng('dungeon-bottom-deck:shuffled')
  );
  assert.ok(initial.length > 0);
  assert.equal(shuffled.some((card) => bottomDeck.has(card.key)), false);

  const tenth = rollDungeonCardChoices({ ...state, cardsPicked: 9 }, { typeIds: ['Gamble'], activeSkillTypeIds: [] }, 3, () => 0);
  assert.ok(tenth.length > 0);
  assert.ok(tenth.some((card) => getDungeonCardMaxStacks(card) === 1));

  const commonUnique = rollDungeonCardChoices(
    { ...state, cardsPicked: 9 },
    { typeIds: ['Gamble'], activeSkillTypeIds: [] },
    1,
    () => 0
  );
  assert.equal(commonUnique[0]?.kind, 'Card Swarm');
  assert.equal(commonUnique[0]?.rarity, 'Common');
  assert.equal(getDungeonCardMaxStacks(commonUnique[0]!), 1);

  const commonFallback = rollDungeonCardChoices(
    { ...state, cardsPicked: 9 },
    { typeIds: ['Sniper'], activeSkillTypeIds: [] },
    1,
    () => 0
  );
  assert.equal(commonFallback[0]?.rarity, 'Rare');
  assert.notEqual(getDungeonCardMaxStacks(commonFallback[0]!), 1);

  const ownedBodyShifter = pickDungeonCard(
    createDungeonCardState(),
    createDungeonCard('Dice Body Shifter', 'Epic', 'Test')
  );
  const legendaryFallback = rollDungeonCardChoices(
    { ...ownedBodyShifter, cardsPicked: 9 },
    { typeIds: ['Test'], activeSkillTypeIds: [] },
    1,
    () => 0.95
  );
  assert.equal(legendaryFallback[0]?.rarity, 'Legendary');
  assert.notEqual(getDungeonCardMaxStacks(legendaryFallback[0]!), 1);
});

test('Dungeon carryover retains the wounded enemy board for mid-wave resumes', () => {
  const player = {
    instanceId: 'player-Fire-1',
    typeId: 'Fire',
    currentHealth: 100,
    maxHealth: 100,
    isDestroyed: false,
    mana: 0,
    activeMana: [] as Array<[string, number]>,
    statuses: {}
  };
  const carryover = normalizeDungeonCarryover({
    turn: 3,
    dice: [player],
    enemyDice: [
      {
        instanceId: 'enemy-Ice-1',
        typeId: 'Ice',
        classLevel: 4,
        currentHealth: 25,
        maxHealth: 80,
        isDestroyed: false,
        zone: 'board',
        gridPosition: { row: 1, col: 3 },
        attack: 42,
        statuses: { poison: { stacks: [{ damage: 4, turns: 2 }] } },
        attackCountBuff: { extra: 1, turns: 2 },
        reviveCount: 1
      },
      {
        instanceId: 'enemy-Wind-1',
        typeId: 'Wind',
        currentHealth: 0,
        maxHealth: 60,
        isDestroyed: true,
        zone: 'board',
        gridPosition: { row: 2, col: 2 }
      }
    ]
  });
  assert.ok(carryover);
  assert.equal(carryover.enemyDice?.length, 2);
  assert.deepEqual(carryover.enemyDice?.[0]?.gridPosition, { row: 1, col: 3 });
  assert.equal(carryover.enemyDice?.[0]?.zone, 'board');
  assert.equal(carryover.enemyDice?.[0]?.classLevel, 4);
  assert.equal(carryover.enemyDice?.[0]?.currentHealth, 25);
  assert.equal(carryover.enemyDice?.[0]?.attack, 42);
  assert.equal(carryover.enemyDice?.[0]?.statuses?.poison?.stacks[0]?.damage, 4);
  assert.equal(carryover.enemyDice?.[0]?.attackCountBuff?.extra, 1);
  assert.equal(carryover.enemyDice?.[1]?.isDestroyed, true);
  assert.equal(carryover.enemyDice?.[1]?.zone, 'eliminated');
  assert.equal(carryover.enemyDice?.[1]?.gridPosition, undefined);
  assert.equal(carryover.enemyDice?.[1]?.currentHealth, 0);

  const invalidPosition = normalizeDungeonCarryover({
    turn: 3,
    dice: [player],
    enemyDice: [{
      instanceId: 'enemy-Fire-1',
      typeId: 'Fire',
      currentHealth: 10,
      maxHealth: 10,
      isDestroyed: false,
      zone: 'board',
      gridPosition: { row: 9, col: 0 }
    }]
  });
  assert.ok(invalidPosition);
  assert.equal(invalidPosition.enemyDice?.[0]?.gridPosition, undefined);
  assert.equal(invalidPosition.enemyDice?.[0]?.zone, 'hand');
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

test('Dice-exclusive dungeon cards enforce type, rarity, and uniqueness rules', () => {
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Triple Strike', 'Epic', 'Meteor')), true);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Triple Strike', 'Legendary', 'Meteor')), false);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Triple Strike', 'Epic', 'Fire')), false);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Hot Tub', 'Rare', 'Meteor')), true);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Holy Gifting', 'Rare', 'Light')), true);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Modified Electric', 'Epic', 'Electric')), true);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Undead Fitting', 'Legendary', 'Zombie')), true);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Soul Fest', 'Epic', 'Soul')), true);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard("Reaper's Grace", 'Rare', 'Death')), true);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Mighty Wind', 'Epic', 'Wind')), true);
  assert.equal(canAddDungeonCard(createDungeonCardState(), createDungeonCard('Arctic Blizzard', 'Legendary', 'Ice')), true);

  const undeadState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Undead Fitting', 'Common', 'Zombie'));
  assert.equal(canAddDungeonCard(undeadState, createDungeonCard('Undead Fitting', 'Rare', 'Zombie')), false);
  assert.equal(dungeonCardsConflict(
    createDungeonCard('Soul Fest', 'Common', 'Soul'),
    createDungeonCard('Soul Fest', 'Epic', 'Soul')
  ), false);
  assert.equal(dungeonCardsConflict(
    createDungeonCard("Reaper's Grace", 'Common', 'Death'),
    createDungeonCard("Reaper's Grace", 'Rare', 'Death')
  ), false);
  assert.equal(getDungeonCardMaxStacks(createDungeonCard('Soul Fest', 'Common', 'Soul')), DUNGEON_CARD_MAX_STACKS);
  assert.equal(getDungeonCardMaxStacks(createDungeonCard("Reaper's Grace", 'Rare', 'Death')), DUNGEON_CARD_MAX_STACKS);
});

test('Dice-exclusive dungeon cards apply their skill overlays and runtime values', () => {
  let meteorState = createDungeonCardState();
  meteorState = pickDungeonCard(meteorState, createDungeonCard('Triple Strike', 'Epic', 'Meteor'));
  meteorState = pickDungeonCard(meteorState, createDungeonCard('Hot Tub', 'Rare', 'Meteor'));
  const meteorEffects = getDungeonCardEffects(meteorState, 'Meteor');
  assert.equal(meteorEffects.ignitionRate, 0.05);
  const meteor: DiceDefinition = {
    typeId: 'Meteor', title: 'Meteor Dice', attack: 20, health: 640, range: 5,
    rarity: 'Epic', targetingMode: 'Nearest', accent: '#ff7a35',
    skills: [{ type: 'Active', title: 'Meteor Strike', description: '', manaNeeded: 7, modifiers: { hasMeteor: true, meteorCount: 1, meteorDamage: 120, meteorPoolType: 'Lava', meteorPoolDuration: 3 } }]
  };
  const meteorDefinition = applyDungeonCardStats(meteor, meteorEffects);
  assert.equal(meteorDefinition.skills[0]?.modifiers?.meteorCount, 3);
  assert.equal(meteorDefinition.skills[0]?.modifiers?.meteorRandomOrientation, true);
  assert.equal(meteorDefinition.skills[0]?.manaNeeded, 7);

  const lightState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Holy Gifting', 'Rare', 'Light'));
  const light: DiceDefinition = {
    typeId: 'Light', title: 'Light Dice', attack: 14, health: 540, range: 3,
    rarity: 'Rare', targetingMode: 'Nearest', accent: '#f9e27d',
    skills: [{ type: 'CombatStart', title: 'Radiant Rally', description: '', modifiers: { allyExtraAttacks: 1 } }]
  };
  assert.equal(applyDungeonCardStats(light, getDungeonCardEffects(lightState, 'Light')).skills[0]?.modifiers?.grantAttacksToAlly, 1);

  const electricState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Modified Electric', 'Epic', 'Electric'));
  const electric: DiceDefinition = {
    typeId: 'Electric', title: 'Electric Dice', attack: 24, health: 750, range: 4,
    rarity: 'Common', targetingMode: 'Nearest', accent: '#ffd76d',
    skills: [{ type: 'Passive', title: 'Chain Spark', description: '', modifiers: { hasChain: true, chainDamage: 18, chainRange: 2, chainTargets: 1 } }]
  };
  const electricDefinition = applyDungeonCardStats(electric, getDungeonCardEffects(electricState, 'Electric'));
  assert.equal(electricDefinition.skills[0]?.modifiers?.chainTargets, -1);
  assert.equal(electricDefinition.skills[0]?.modifiers?.chainRange, 1);
  assert.equal(electricDefinition.skills[0]?.modifiers?.chainDamage, 18);

  const deathState = pickDungeonCard(createDungeonCardState(), createDungeonCard("Reaper's Grace", 'Rare', 'Death'));
  const death: DiceDefinition = {
    typeId: 'Death', title: 'Death Dice', attack: 24, health: 640, range: 4,
    rarity: 'Epic', targetingMode: 'Nearest', accent: '#000000', skills: [],
    transformStats: [{ title: 'Instakill Form', skills: [{ type: 'Active', title: "Reaper's Touch", description: '', manaNeeded: 12, modifiers: { instakill: true } }] }]
  };
  const deathEffects = getDungeonCardEffects(deathState, 'Death');
  const deathDefinition = applyDungeonCardStats(applyTransformStats(death, 0), deathEffects);
  assert.equal(deathDefinition.skills[0]?.manaNeeded, 10);
  assert.equal(applyDungeonCardStats(deathDefinition, deathEffects).skills[0]?.manaNeeded, 10);
  let stackedDeathState = createDungeonCardState();
  stackedDeathState = pickDungeonCard(stackedDeathState, createDungeonCard("Reaper's Grace", 'Common', 'Death'));
  stackedDeathState = pickDungeonCard(stackedDeathState, createDungeonCard("Reaper's Grace", 'Rare', 'Death'));
  assert.equal(applyDungeonCardStats(applyTransformStats(death, 0), getDungeonCardEffects(stackedDeathState, 'Death')).skills[0]?.manaNeeded, 9);

  const windState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Mighty Wind', 'Epic', 'Wind'));
  const wind: DiceDefinition = {
    typeId: 'Wind', title: 'Wind Dice', attack: 22, health: 480, range: 6,
    rarity: 'Common', targetingMode: 'Nearest', accent: '#78e6a8',
    skills: [{ type: 'Active', title: 'Gale Tempo', description: '', manaNeeded: 10, modifiers: { projectileCountIncrease: 1, skillDuration: 2, disableManaGain: true } }]
  };
  const windDefinition = applyDungeonCardStats(wind, getDungeonCardEffects(windState, 'Wind'));
  assert.equal(windDefinition.skills[0]?.modifiers?.projectileCountIncrease, 2);
  assert.equal(windDefinition.skills[0]?.manaNeeded, 10);
  assert.equal(
    getDungeonCardDescription(createDungeonCard('Mighty Wind', 'Epic', 'Wind'), 'Wind Dice'),
    'Gale Tempo now shoots three times as many attacks instead of twice as many.'
  );

  const iceState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Arctic Blizzard', 'Legendary', 'Ice'));
  const ice: DiceDefinition = {
    typeId: 'Ice', title: 'Ice Dice', attack: 16, health: 720, range: 5,
    rarity: 'Common', targetingMode: 'Nearest', accent: '#8fd5ff',
    skills: [{ type: 'Active', title: 'Chill Lock', description: '', manaNeeded: 6, modifiers: { attackDelta: -1, statusDuration: 3, maxStacks: 3, skillDamage: 32, statusEffect: 'slow' } }]
  };
  const iceDefinition = applyDungeonCardStats(ice, getDungeonCardEffects(iceState, 'Ice'));
  assert.equal(iceDefinition.skills[0]?.modifiers?.hitsAllFoes, true);

  const soulState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Soul Fest', 'Epic', 'Soul'));
  assert.equal(getDungeonCardEffects(soulState, 'Soul').soulBonusMultiplier, 1.5);
  const zombieState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Undead Fitting', 'Epic', 'Zombie'));
  assert.equal(getDungeonCardEffects(zombieState, 'Zombie').undeadHealthRate, 0.75);

  const attacker: DiceInstanceState = {
    instanceId: 'player-Ice-1', typeId: 'Ice', ownerId: 'player', zone: 'board',
    maxHealth: 720, currentHealth: 720, isDestroyed: false, hasFinishedAttacking: false,
    attacksRemaining: 1, gridPosition: { row: 0, col: 1 }
  };
  const target: DiceInstanceState = {
    instanceId: 'enemy-Fire-1', typeId: 'Fire', ownerId: 'enemy', zone: 'board',
    maxHealth: 500, currentHealth: 500, isDestroyed: false, hasFinishedAttacking: false,
    attacksRemaining: 1, gridPosition: { row: 0, col: 3 }
  };
  const active = executeActiveSkillEffects(attacker, iceDefinition, 1, target, 6, { key: 'Chill Lock:0', title: 'Chill Lock', manaNeeded: 6, skillIndex: 0 });
  assert.equal(active.hitsAllFoes, true);
  assert.equal(active.statusApplications?.[0]?.allFoes, true);
  const allFoesWithoutTarget = executeActiveSkillEffects(attacker, iceDefinition, 1, undefined, 6, { key: 'Chill Lock:0', title: 'Chill Lock', manaNeeded: 6, skillIndex: 0 });
  assert.equal(allFoesWithoutTarget.hitsAllFoes, true);
  assert.equal(allFoesWithoutTarget.statusApplications?.[0]?.allFoes, true);
  assert.equal(resolveIgnitionDamage(1000, 0.05, false), 50);
  assert.equal(resolveIgnitionDamage(1000, 0.05, true), 12);
});

test('Dungeon Card skill descriptions reflect modified behavior', () => {
  const makeDie = (typeId: string, skill: DiceSkillDefinition): DiceDefinition => ({
    typeId, title: `${typeId} Dice`, attack: 10, health: 100, range: 4, rarity: 'Common', targetingMode: 'Nearest', skills: [skill]
  });

  let meteorState = createDungeonCardState();
  meteorState = pickDungeonCard(meteorState, createDungeonCard('Triple Strike', 'Epic', 'Meteor'));
  meteorState = pickDungeonCard(meteorState, createDungeonCard('Hot Tub', 'Rare', 'Meteor'));
  const meteorEffects = getDungeonCardEffects(meteorState, 'Meteor');
  const meteorSkill: DiceSkillDefinition = {
    type: 'Active', title: 'Meteor Strike', description: 'Base meteor text.', manaNeeded: 7,
    modifiers: { hasMeteor: true, meteorCount: 1, meteorDamage: 120, meteorPoolType: 'Lava', meteorPoolDuration: 3 }
  };
  const meteor = makeDie('Meteor', meteorSkill);
  const meteorDefinition = applyDungeonCardStats(meteor, meteorEffects);
  const meteorText = getClassScaledSkillDescription(meteorDefinition, meteorDefinition.skills[0], 1, undefined, {
    poolDefinitions: { Lava: { typeId: 'Lava', title: 'Lava', damage: 50 } }
  });
  assert.match(meteorText, /Throws 3 striking meteors at random tiles/);
  assert.match(meteorText, /Lava pools also apply Ignition: 5% of maximum HP as damage at the end of each turn for 3 turns/);
  assert.match(meteorText, /75% less effective against bosses/);
  assert.equal(applyDungeonCardStats(meteorDefinition, meteorEffects).skills[0]?.description, meteorDefinition.skills[0]?.description);

  const hotTubState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Hot Tub', 'Rare', 'Meteor'));
  const hotTubDefinition = applyDungeonCardStats(meteor, getDungeonCardEffects(hotTubState, 'Meteor'));
  assert.match(getClassScaledSkillDescription(hotTubDefinition, hotTubDefinition.skills[0]), /Throws a striking meteor.*apply Ignition/);

  const lightState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Holy Gifting', 'Rare', 'Light'));
  const lightSkill: DiceSkillDefinition = {
    type: 'CombatStart', title: 'Radiant Rally', description: 'Adds +{allyExtraAttacks} attack count to adjacent allies.',
    modifiers: { allyExtraAttacks: 1, allyExtraAttacksRadius: 1 }
  };
  const lightDefinition = applyDungeonCardStats(makeDie('Light', lightSkill), getDungeonCardEffects(lightState, 'Light'));
  assert.match(getClassScaledSkillDescription(lightDefinition, lightDefinition.skills[0]), /Also grants a random other ally \+1 attack count/);

  const electricState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Modified Electric', 'Epic', 'Electric'));
  const electricSkill: DiceSkillDefinition = {
    type: 'Passive', title: 'Chain Spark', description: 'Base chain text.',
    modifiers: { hasChain: true, chainDamage: 18, chainRange: 2, chainTargets: 1 }
  };
  const electricDefinition = applyDungeonCardStats(makeDie('Electric', electricSkill), getDungeonCardEffects(electricState, 'Electric'));
  const electricText = getClassScaledSkillDescription(electricDefinition, electricDefinition.skills[0]);
  assert.match(electricText, /any number of nearby foes/);
  assert.match(electricText, /within 1 tile/);
  assert.match(electricText, /18 bonus damage/);

  const zombieState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Undead Fitting', 'Epic', 'Zombie'));
  const zombieSkill: DiceSkillDefinition = {
    type: 'OnKill', title: 'Zombie Pandemic', description: 'Turns a defeated enemy into an allied Zombie Die with {plaguedDieHealth} of its maximum HP.',
    modifiers: { hasPlague: true, plaguedDieType: 'Zombie', plaguedDieHealth: 0.3 }
  };
  const zombieDefinition = applyDungeonCardStats(makeDie('Zombie', zombieSkill), getDungeonCardEffects(zombieState, 'Zombie'));
  assert.match(getClassScaledSkillDescription(zombieDefinition, zombieDefinition.skills[0]), /75% of its maximum HP/);

  const soulState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Soul Fest', 'Epic', 'Soul'));
  const soulSkill: DiceSkillDefinition = {
    type: 'Passive', title: 'Soul Harvest', description: 'Conjures defeated ally souls. {diceDefinitions[Soul].title} gains +{soulBoostPercent} damage and health for each soul conjured.',
    modifiers: { canConjureSouls: true, conjureType: 'ally', noMaxSouls: true, soulBoostPercent: 0.2 }
  };
  const soul = makeDie('Soul', soulSkill);
  const soulDefinition = applyDungeonCardStats(soul, getDungeonCardEffects(soulState, 'Soul'));
  const soulText = getClassScaledSkillDescription(soulDefinition, soulDefinition.skills[0], 1, undefined, { diceDefinitions: { Soul: soul } });
  assert.match(soulText, /gains \+30% damage and health/);
  assert.doesNotMatch(soulText, /more effective/);

  const deathState = pickDungeonCard(createDungeonCardState(), createDungeonCard("Reaper's Grace", 'Rare', 'Death'));
  const deathSkill: DiceSkillDefinition = {
    type: 'Active', title: "Reaper's Touch", description: 'Instantly kills a target.', manaNeeded: 12,
    modifiers: { instakill: true, bossDamageRate: 10 }
  };
  const deathDefinition = applyDungeonCardStats(makeDie('Death', deathSkill), getDungeonCardEffects(deathState, 'Death'));
  assert.match(getClassScaledSkillDescription(deathDefinition, deathDefinition.skills[0]), /costs 2 less mana to charge/);

  const windState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Mighty Wind', 'Epic', 'Wind'));
  const windSkill: DiceSkillDefinition = {
    type: 'Active', title: 'Gale Tempo', description: 'Shoots twice as many attacks for {skillDuration} turns.', manaNeeded: 10,
    modifiers: { projectileCountIncrease: 1, skillDuration: 2, disableManaGain: true }
  };
  const windDefinition = applyDungeonCardStats(makeDie('Wind', windSkill), getDungeonCardEffects(windState, 'Wind'));
  assert.equal(
    getClassScaledSkillDescription(windDefinition, windDefinition.skills[0]),
    'Shoots three times as many attacks for 2 turns without spending an attack, then cannot gain mana again until the effect ends.'
  );

  const iceState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Arctic Blizzard', 'Legendary', 'Ice'));
  const iceSkill: DiceSkillDefinition = {
    type: 'Active', title: 'Chill Lock', description: 'Deals damage to one target.', manaNeeded: 6,
    modifiers: { attackDelta: -1, statusDuration: 3, maxStacks: 3, skillDamage: 32, statusEffect: 'slow' }
  };
  const iceDefinition = applyDungeonCardStats(makeDie('Ice', iceSkill), getDungeonCardEffects(iceState, 'Ice'));
  const iceText = getClassScaledSkillDescription(iceDefinition, iceDefinition.skills[0]);
  assert.match(iceText, /Deals 32 damage to every foe/);
  assert.match(iceText, /1 for 3 turns/);

  const growthState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Mega Growth', 'Legendary', 'Growth'));
  const growthSkill: DiceSkillDefinition = {
    type: 'CombatEnd', title: 'Exponential Growth', description: 'Permanently gains +{growthDelta} attack count for the remainder of the match.',
    modifiers: { hasGrowth: true, growthDelta: 1 }
  };
  const growthDefinition = applyDungeonCardStats(makeDie('Growth', growthSkill), getDungeonCardEffects(growthState, 'Growth'));
  assert.match(getClassScaledSkillDescription(growthDefinition, growthDefinition.skills[0]), /\+2 attack count/);

  const acidState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Acid Rain', 'Epic', 'Drizzle'));
  const acidSkill: DiceSkillDefinition = {
    type: 'Active', title: 'Heavy Rain', description: 'Makes drizzle appear on all enemy dice, causing {skillDamage} damage.', manaNeeded: 3,
    modifiers: { skillDamage: 50, hitsAllFoes: true }
  };
  const acidDefinition = applyDungeonCardStats(makeDie('Drizzle', acidSkill), getDungeonCardEffects(acidState, 'Drizzle'));
  assert.match(getClassScaledSkillDescription(acidDefinition, acidDefinition.skills[0]), /poisoned for 2 turns/);

  const ascendanceState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Ascendance', 'Epic', 'Transcendence'));
  const ascendanceSkill: DiceSkillDefinition = {
    type: 'Passive', title: 'Perpendicular Beam', description: 'If it rolls 6, transforms into The Transcendence.',
    modifiers: { transformPipCount: 6 }
  };
  const ascendanceDefinition = applyDungeonCardStats(makeDie('Transcendence', ascendanceSkill), getDungeonCardEffects(ascendanceState, 'Transcendence'));
  assert.match(getClassScaledSkillDescription(ascendanceDefinition, ascendanceDefinition.skills[0]), /The Transcendence lasts 1 additional turn/);

  const rampageState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Rampage', 'Legendary', 'Berserk'));
  const rampageSkill: DiceSkillDefinition = {
    type: 'Passive', title: 'Blood Frenzy', description: 'Below {berserkThresholdRate} HP, deals 150% more damage.',
    modifiers: { berserkThresholdRate: 0.3, berserkDamageMultiplier: 2.5 }
  };
  const rampageDefinition = applyDungeonCardStats(makeDie('Berserk', rampageSkill), getDungeonCardEffects(rampageState, 'Berserk'));
  assert.match(getClassScaledSkillDescription(rampageDefinition, rampageDefinition.skills[0]), /splash damage equal to 100% of the attack/);

  const batteryState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Infinite Cycling', 'Legendary', 'Battery'));
  const batterySkill: DiceSkillDefinition = {
    type: 'CombatStart', title: 'Quick Charge', description: 'All friendly charging active skills gain +{allyManaGain} mana.',
    modifiers: { allyManaGain: 1 }
  };
  const batteryDefinition = applyDungeonCardStats(makeDie('Battery', batterySkill), getDungeonCardEffects(batteryState, 'Battery'));
  assert.match(getClassScaledSkillDescription(batteryDefinition, batteryDefinition.skills[0]), /additional mana to all allies/);
  let stackedBatteryState = batteryState;
  stackedBatteryState = pickDungeonCard(stackedBatteryState, createDungeonCard('Infinite Cycling', 'Rare', 'Battery'));
  const stackedBatteryDefinition = applyDungeonCardStats(batteryDefinition, getDungeonCardEffects(stackedBatteryState, 'Battery'));
  const stackedBatteryText = getClassScaledSkillDescription(stackedBatteryDefinition, stackedBatteryDefinition.skills[0]);
  assert.match(stackedBatteryText, /\+3 additional mana to all allies/);
  assert.doesNotMatch(stackedBatteryText, /\+2 additional mana to all allies/);

  const galeState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Feel The Gale', 'Rare', 'Wind'));
  const galeSkill: DiceSkillDefinition = {
    type: 'Active', title: 'Gale Tempo', description: 'Shoots twice as many attacks for {skillDuration} turns.', manaNeeded: 10,
    modifiers: { projectileCountIncrease: 1, skillDuration: 2, disableManaGain: true }
  };
  const galeDefinition = applyDungeonCardStats(makeDie('Wind', galeSkill), getDungeonCardEffects(galeState, 'Wind'));
  assert.match(getClassScaledSkillDescription(galeDefinition, galeDefinition.skills[0]), /for 3 turns/);

  const timeUpState = pickDungeonCard(createDungeonCardState(), createDungeonCard("Time's Up", 'Legendary', 'Time'));
  const timeUpSkill: DiceSkillDefinition = {
    type: 'Passive', title: 'Temporal Acceleration', description: 'Ally dice matching this die\'s rolled pip count gain +{pipMatchAllyAttackDelta} attack count until the next turn.',
    modifiers: { pipMatchAllyAttackDelta: 1 }
  };
  const timeUpDefinition = applyDungeonCardStats(makeDie('Time', timeUpSkill), getDungeonCardEffects(timeUpState, 'Time'));
  assert.match(getClassScaledSkillDescription(timeUpDefinition, timeUpDefinition.skills[0]), /gain \+3 attack counts/);

  const timeDownState = pickDungeonCard(createDungeonCardState(), createDungeonCard("Time's Down", 'Legendary', 'Time'));
  const timeDownSkill: DiceSkillDefinition = {
    type: 'Passive', title: 'Temporal Dilation', description: 'Enemy dice matching this die\'s rolled pip count gain {pipMatchFoeAttackDelta} attack count until the next turn.',
    modifiers: { pipMatchFoeAttackDelta: -1 }
  };
  const timeDownDefinition = applyDungeonCardStats(makeDie('Time', timeDownSkill), getDungeonCardEffects(timeDownState, 'Time'));
  assert.match(getClassScaledSkillDescription(timeDownDefinition, timeDownDefinition.skills[0]), /lose 3 attack counts/);
});

test('Dungeon carryover preserves Ignition stacks', () => {
  const carryover = normalizeDungeonCarryover({
    turn: 3,
    dice: [{
      instanceId: 'player-Fire-1', typeId: 'Fire', currentHealth: 100, maxHealth: 100,
      isDestroyed: false, mana: 0, activeMana: [],
      statuses: {
        ignition: {
          stacks: [
            { rate: 0.05, turns: 3, sourceInstanceId: 'player-Meteor-1', sourceOwnerId: 'player', sourceTypeId: 'Meteor' },
            { rate: 0.1, turns: 1 },
            { rate: 'bad', turns: 2 }
          ]
        }
      }
    }]
  });
  assert.equal(carryover?.dice[0]?.statuses.ignition?.stacks.length, 2);
  assert.equal(carryover?.dice[0]?.statuses.ignition?.stacks[0]?.rate, 0.05);
  assert.equal(carryover?.dice[0]?.statuses.ignition?.stacks[1]?.turns, 1);
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
  assert.deepEqual(normalizeDungeonCardState(JSON.parse(JSON.stringify(marked))).scopeMarks, marked.scopeMarks);

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

  let stackedArmor = createDungeonCardState();
  stackedArmor = pickDungeonCard(stackedArmor, createDungeonCard('Dice Armor', 'Common', 'Armor'));
  stackedArmor = pickDungeonCard(stackedArmor, createDungeonCard('Dice Armor', 'Rare', 'Armor'));
  stackedArmor = pickDungeonCard(stackedArmor, createDungeonCard('Dice Armor', 'Legendary', 'Armor'));
  const combinedArmor = getDungeonCardEffects(stackedArmor, 'Armor').armorReduction;
  assert.ok(Math.abs(combinedArmor - (1 - 0.8 * 0.7 * 0.5)) < 1e-9);
  assert.ok(Math.abs(combineDamageReduction([combinedArmor, 0.5]) - 0.86) < 1e-9);

  let state = createDungeonCardState();
  state.pendingDraws = 99;
  state = pickDungeonCard(state, createDungeonCard('Infinite Cycling', 'Legendary', 'Battery'));
  assert.equal(getDungeonCardEffects(state, 'Battery').batteryAllyManaBonus, 2);

  state = pickDungeonCard(state, createDungeonCard('Feel The Gale', 'Legendary', 'Wind'));
  assert.equal(getDungeonCardEffects(state, 'Wind').galeDurationBonus, 2);

  state = pickDungeonCard(state, createDungeonCard('Gunned Down', 'Legendary', 'Sniper'));
  const scope = getDungeonCardEffects(state, 'Sniper');
  const markedIn = scope.grantedSkills.find((skill) => skill.title === 'Marked In');
  assert.equal(markedIn?.title, DUNGEON_MARKED_IN_SKILL.title);
  assert.equal(markedIn?.type, 'Passive');
  assert.equal(markedIn?.modifiers?.hasScope, true);
  assert.equal(markedIn?.modifiers?.scopeChance, 0.25);
  assert.equal(markedIn?.modifiers?.scopeDamageMult, 10);
  assert.equal(markedIn?.modifiers?.scopeDamageIncreasePerStack, 0.2);
  assert.equal(markedIn?.modifiers?.maxScopeStacks, 99);
  assert.equal(scope.grantedSkills.some((skill) => skill.title === 'Scope Stack'), false);
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

test('Scope and acquireTarget metadata resolve from passive skills only', () => {
  const definition = {
    typeId: 'Sniper',
    title: 'Sniper Dice',
    attack: 20,
    health: 500,
    range: 5,
    targetingMode: 'Nearest' as const,
    rarity: 'Common' as const,
    skills: [{
      type: 'Passive' as const,
      title: 'Marked In',
      description: 'Scope test',
      modifiers: {
        hasScope: true,
        acquireTarget: true,
        scopeDamageIncreasePerStack: 0.2,
        maxScopeStacks: 5
      }
    }]
  };
  const meta = getRuntimeSkillMeta(definition);
  assert.equal(meta.hasScope, true);
  assert.equal(meta.acquireTarget, true);
  assert.equal(meta.scopeChance, 1);
  assert.equal(meta.scopeDamageMult, 10);
  assert.equal(meta.scopeDamageIncreasePerStack, 0.2);
  assert.equal(meta.maxScopeStacks, 5);

  const activeMeta = getRuntimeSkillMeta({
    ...definition,
    skills: [{ type: 'Active', title: 'Scope Active', description: 'Scope test', modifiers: { hasScope: true, acquireTarget: true } }]
  });
  assert.equal(activeMeta.hasScope, false);
  assert.equal(activeMeta.acquireTarget, false);

  assert.equal(resolveScopeShotDamage({ basicDamage: 40, scopeDamageMult: 2.5 }), 100);
  assert.equal(resolveScopeShotDamage({ basicDamage: 40 }), 400);
  assert.equal(resolveScopeShotDamage({ basicDamage: 40, scopeDamageMult: 0 }), 40);
  assert.equal(resolveScopeShotDamage({ basicDamage: 40, scopeDamage: 150 }), 150);
  assert.equal(resolveScopeShotDamage({ basicDamage: 40, scopeDamageMult: 2.5, scopeStacks: 2, scopeDamageIncreasePerStack: 0.2 }), 140);
  assert.equal(resolveScopeShotDamage({ basicDamage: 40, scopeDamage: 150, scopeStacks: 2, scopeDamageIncreasePerStack: 0.2 }), 210);
  assert.equal(addScopeStack(4, 5), 5);
  assert.equal(addScopeStack(4, undefined), 5);
  assert.equal(addScopeStack(0, 0), 0);
});

test('Exclusive card overlays follow renamed talents and remove configured penalties', () => {
  const definition = {
    typeId: 'Meteor',
    title: 'Meteor Dice',
    attack: 20,
    health: 500,
    range: 5,
    targetingMode: 'Nearest' as const,
    rarity: 'Common' as const,
    skills: [
      { type: 'Active' as const, title: 'Meteor Strike', manaNeeded: 12, description: '', modifiers: { meteorCount: 1 } },
      { type: 'Passive' as const, title: 'Gale Tempo', manaNeeded: 15, description: '', modifiers: { projectileCountIncrease: 1, skillDuration: 2 } },
      { type: 'Passive' as const, title: 'Chain Spark', description: '', modifiers: { chainDamage: 14, chainTargets: 1, chainRange: 2 } }
    ]
  };
  const meteorState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Triple Strike', 'Epic', 'Meteor'));
  const windState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Mighty Wind', 'Epic', 'Wind'));
  const electricState = pickDungeonCard(createDungeonCardState(), createDungeonCard('Modified Electric', 'Epic', 'Electric'));
  const tripleStrike = applyDungeonCardStats(definition, getDungeonCardEffects(meteorState, 'Meteor')).skills.find((skill) => skill.title === 'Meteor Strike');
  const mightyWind = applyDungeonCardStats(definition, getDungeonCardEffects(windState, 'Wind')).skills.find((skill) => skill.title === 'Gale Tempo');
  const modifiedElectric = applyDungeonCardStats(definition, getDungeonCardEffects(electricState, 'Electric')).skills.find((skill) => skill.title === 'Chain Spark');
  assert.equal(tripleStrike?.manaNeeded, 7);
  assert.equal(tripleStrike?.modifiers?.meteorCount, 3);
  assert.equal(mightyWind?.manaNeeded, 10);
  assert.equal(mightyWind?.modifiers?.projectileCountIncrease, 2);
  assert.equal(modifiedElectric?.modifiers?.chainDamage, 18);
  assert.equal(modifiedElectric?.modifiers?.chainTargets, -1);
  assert.equal(modifiedElectric?.modifiers?.chainRange, 1);
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

  const infiniteCycling = createDungeonCard('Infinite Cycling', 'Rare', 'Battery');
  const infinitePresentation = getDungeonCardPresentation(infiniteCycling, 'Battery', 1);
  assert.equal(infinitePresentation.unique, false);
  assert.equal(infinitePresentation.stackLabel, '1 CARD');

  const gunnedDown = createDungeonCard('Gunned Down', 'Legendary', 'Sniper');
  const gunnedPresentation = getDungeonCardPresentation(gunnedDown, 'Sniper', 1);
  assert.equal(gunnedPresentation.cardCount, 1);
  assert.equal(gunnedPresentation.stackLabel, 'UNIQUE • 1 CARD');
  assert.equal(gunnedPresentation.unique, true);
  assert.match(gunnedPresentation.description, /Adds 3 scope marks/);
  assert.match(gunnedPresentation.description, /25% chance/);
  assert.match(gunnedPresentation.description, /10x of Sniper's basic attack damage/);
  assert.doesNotMatch(gunnedPresentation.description, /Marked In/);
  assert.doesNotMatch(gunnedPresentation.description, /Scope Stack/);

  const cardSwarm = createDungeonCard('Card Swarm', 'Legendary', 'Gamble');
  const swarmPresentation = getDungeonCardPresentation(cardSwarm, 'Gamble', 1);
  assert.match(swarmPresentation.description, /6 orbiting cards/);
  assert.match(swarmPresentation.description, /150%/);
  assert.doesNotMatch(swarmPresentation.description, /9 mana/);

  const brokenBeyond = createDungeonCard('Broken Beyond', 'Epic', 'Broken');
  const brokenPresentation = getDungeonCardPresentation(brokenBeyond, 'Broken', 1);
  assert.match(brokenPresentation.description, /Slugfest/);
  assert.match(brokenPresentation.description, /8 quick successive shots/);
  assert.match(brokenPresentation.description, /60 damage/);
  assert.match(brokenPresentation.description, /Mana needed: 8/);

  const megaGrowth = createDungeonCard('Mega Growth', 'Legendary', 'Growth');
  const megaPresentation = getDungeonCardPresentation(megaGrowth, 'Growth', 1);
  assert.match(megaPresentation.description, /Growth upgrades in attack counts/);
  assert.match(megaPresentation.description, /instead of the usual 1/);

  const acidRain = createDungeonCard('Acid Rain', 'Epic', 'Drizzle');
  const acidPresentation = getDungeonCardPresentation(acidRain, 'Drizzle', 1);
  assert.match(acidPresentation.description, /Heavy Rain also poisons all caught enemy dice/);

  const rampage = createDungeonCard('Rampage', 'Legendary', 'Berserk');
  const rampagePresentation = getDungeonCardPresentation(rampage, 'Berserk', 1);
  assert.match(rampagePresentation.description, /Berserk additionally deals splash damage equal to its basic attack/);

  const projectileCount = createDungeonCard('Dice Projectile Count', 'Rare', 'Fire');
  const projectilePresentation = getDungeonCardPresentation(projectileCount, 'Fire', 1);
  assert.match(projectilePresentation.description, /projectile/);
  assert.match(projectilePresentation.description, /each basic attack from your Fire/);

  const attackCount = createDungeonCard('Dice Attack Count', 'Rare', 'Fire');
  const attackPresentation = getDungeonCardPresentation(attackCount, 'Fire', 1);
  assert.match(attackPresentation.description, /attacks your Fire can make each combat/);

  const bodyShifter = createDungeonCard('Dice Body Shifter', 'Rare', 'Fire');
  const bodyPresentation = getDungeonCardPresentation(bodyShifter, 'Fire', 1);
  assert.match(bodyPresentation.description, /dice body into a D/);

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

test('Combat-end healing scales from max health without critical healing', () => {
  assert.equal(getMaxHealthHealAmount(1000, 0.1), 100);
  assert.equal(getMaxHealthHealAmount(1000, 0.25), 250);
  assert.equal(getMaxHealthHealAmount(500, 0.05), 25);
  assert.equal(getMaxHealthHealAmount(5, 0.05), 1);
  assert.equal(getMaxHealthHealAmount(0, 0.1), 0);
  assert.equal(getMaxHealthHealAmount(1000, 0), 0);
  assert.equal(getMaxHealthHealAmount(Number.NaN, 0.1), 0);
  assert.equal(getMaxHealthHealAmount(1000, Number.NaN), 0);
  assert.equal(resolveCombatEndHealAmount(1000, 900, 0.1), 100);
  assert.equal(resolveCombatEndHealAmount(1000, 980, 0.1), 20);
  assert.equal(resolveCombatEndHealAmount(1000, 1000, 0.1), 0);
  assert.equal(resolveCombatEndHealAmount(Number.NaN, 100, 0.1), 0);
  assert.equal(resolveCombatEndHealAmount(1000, Number.NaN, 0.1), 100);
  assert.equal(resolveCombatEndHealAmount(1000, 900, Number.NaN), 0);
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
  const classThreeCard = applyDungeonCardStats(
    { ...broken, skills: [] },
    getDungeonCardEffects(brokenCardState, 'Broken'),
    3
  );
  const classThreeSlugfest = classThreeCard.skills.find((skill) => skill.title === 'Slugfest');
  assert.equal(classThreeSlugfest?.modifiers?.skillDamage, Math.round(60 * getClassMultiplier(3)));
  assert.equal(
    getClassScaledSkillDescription(classThreeCard, classThreeSlugfest),
    `Fires 8 shots onto random foes, causing ${Math.round(60 * getClassMultiplier(3))} damage each.`
  );

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

test('PvP Dice Card rules stay in parity with PvE', () => {
  assert.deepEqual(SERVER_DICE_CARD_VALUES, DICE_CARD_VALUES);
  assert.deepEqual(SERVER_DICE_CARD_KINDS, DICE_CARD_KINDS);
  assert.deepEqual(SERVER_DICE_CARD_OFFER_TURNS, DICE_CARD_OFFER_TURNS);
  assert.deepEqual(SERVER_DICE_CARD_RARITY_FALLBACKS, DICE_CARD_RARITY_FALLBACKS);
  (['Bronze', 'Silver', 'Gold'] as const).forEach((rarity) => {
    assert.equal(getServerDiceCardMagnitude(rarity), getDiceCardMagnitude(rarity));
  });
  const cards: DiceCard[] = [
    { key: 'Fire Upgrade:Gold', title: 'Fire Upgrade', rarity: 'Gold', kind: 'Type Upgrade', typeId: 'Fire' },
    { key: 'Straight Face:Silver', title: 'Straight Face', rarity: 'Silver', kind: 'Straight Face' }
  ];
  assert.equal(resolveServerDiceCardMaxHealth(100, cards, 'Fire', true), resolveDiceCardMaxHealth(100, cards, 'Fire', true));
  assert.equal(resolveServerDiceCardMaxHealth(100, cards, 'Ice', false), resolveDiceCardMaxHealth(100, cards, 'Ice', false));
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
  assert.equal(formatRicochetAggregationLabel('Your', 'Wind Dice', 'attacks', 1234), 'Your Wind Dice attacks for 1,234 total damage');
  assert.equal(formatRicochetAggregationLabel('Enemy', 'Healing Dice', 'heals', 2500, true), 'Enemy Healing Dice heals for 2,500 total healing (CRITICAL)');
  assert.equal(formatRicochetAggregationLabel('Your', 'Armor Dice', 'attacks', Number.NaN), 'Your Armor Dice attacks for 0 total damage');
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

  const buffedDescription = getClassScaledSkillDescription(
    meteor,
    {
      type: 'Active',
      title: 'Test',
      description: '{diceDefinitions[Soul].title} hits for {attack}. Lava deals {poolDefinitions[meteorPoolType].damage}.',
      modifiers: { meteorPoolType: 'Lava' }
    },
    1.5,
    undefined,
    { diceDefinitions: { Soul: soul }, poolDefinitions: { Lava: lava }, classLevel: 2 }
  );
  assert.equal(buffedDescription, 'Soul Dice hits for 18. Lava deals 82.');
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

test('range coverage measures large attackers from their closest footprint cell', () => {
  const makeDie = (overrides: Partial<DiceInstanceState> & Pick<DiceInstanceState, 'instanceId' | 'typeId' | 'ownerId'>): DiceInstanceState => ({
    zone: 'board',
    maxHealth: 100,
    currentHealth: 100,
    isDestroyed: false,
    hasFinishedAttacking: true,
    attacksRemaining: 0,
    ...overrides
  });
  const large = makeDie({ instanceId: 'player-Boss-1', typeId: 'Boss', ownerId: 'player', gridPosition: { row: 2, col: 3 } });
  const normal = makeDie({ instanceId: 'player-Normal-1', typeId: 'Normal', ownerId: 'player', gridPosition: { row: 2, col: 3 } });
  const footprintFor = (die: DiceInstanceState) => die.instanceId === large.instanceId ? 2 : 1;

  assert.deepEqual(getCoveredEnemyColumns(normal, 1), []);
  assert.deepEqual(getCoveredEnemyColumns(large, 1), []);
  assert.deepEqual(getCoveredEnemyColumns(large, 1, footprintFor), [0]);
  assert.equal(getCoveredEnemyTileCount(large, 1, footprintFor), 5);
  assert.deepEqual(getDisplayedRangeCoverage(large, 1, footprintFor), { columns: [0], tileCount: 5 });
});

test('multi-tile dice keep the range allowed by their range stat', () => {
  assert.equal(getFootprintAdjustedRange(4, 1), 4);
  assert.equal(getFootprintAdjustedRange(4, 2), 4);
  assert.equal(getFootprintAdjustedRange(4, 3), 4);
  assert.equal(getFootprintAdjustedRange(0, 2), 1);
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

function makeStatusDie(instanceId: string, ownerId: 'player' | 'enemy', overrides: Partial<DiceInstanceState> = {}): DiceInstanceState {
  return {
    instanceId,
    typeId: 'Zombie' as DiceInstanceState['typeId'],
    ownerId,
    zone: 'board',
    maxHealth: 100,
    currentHealth: 100,
    isDestroyed: false,
    hasFinishedAttacking: false,
    attacksRemaining: 1,
    ...overrides
  };
}

function makeStatusHooks(dice: DiceInstanceState[], overrides: Partial<StatusEffectHooks> = {}): StatusEffectHooks & {
  ticks: StatusEffectTick[];
  animations: Array<{ animation: string; targetId: string }>;
  applied: Array<{ effect: string; targetId: string }>;
  attackDeltas: Array<{ targetId: string; delta: number }>;
  attackLosses: Array<{ targetId: string; amount: number }>;
} {
  const ticks: StatusEffectTick[] = [];
  const animations: Array<{ animation: string; targetId: string }> = [];
  const applied: Array<{ effect: string; targetId: string }> = [];
  const attackDeltas: Array<{ targetId: string; delta: number }> = [];
  const attackLosses: Array<{ targetId: string; amount: number }> = [];
  const hooks: StatusEffectHooks & {
    ticks: StatusEffectTick[];
    animations: Array<{ animation: string; targetId: string }>;
    applied: Array<{ effect: string; targetId: string }>;
    attackDeltas: Array<{ targetId: string; delta: number }>;
    attackLosses: Array<{ targetId: string; amount: number }>;
  } = {
    ticks,
    animations,
    applied,
    attackDeltas,
    attackLosses,
    getLiveDie: (instanceId) => dice.find((die) => die.instanceId === instanceId && !die.isDestroyed),
    getSourceDie: (instanceId) => dice.find((die) => die.instanceId === instanceId),
    getBoardFoes: (ownerId) => dice.filter((die) => die.ownerId !== ownerId && die.zone === 'board' && !die.isDestroyed),
    getDuration: (rawDuration) => Math.max(1, Math.floor(rawDuration)),
    getDamageMultiplier: (source) => source.instanceId === 'source' ? 2 : 1,
    animate: (animation, _source, target) => animations.push({ animation, targetId: target.instanceId }),
    onApplied: (_source, target, effect) => applied.push({ effect, targetId: target.instanceId }),
    onAttackDelta: (target, delta) => attackDeltas.push({ targetId: target.instanceId, delta }),
    onAttackCountLoss: (target, amount) => attackLosses.push({ targetId: target.instanceId, amount }),
    resolveIgnitionDamage: (target, rate, isBoss) => Math.floor(target.maxHealth * rate * (isBoss ? 0.5 : 1)),
    isBoss: (target) => target.instanceId === 'boss',
    runTick: async (tick) => { ticks.push(tick); },
    ...overrides
  };
  return hooks;
}

test('StatusEffectStore applies every effect shape and expands all-foe applications', () => {
  const source = makeStatusDie('source', 'player', { attacksRemaining: 4 });
  const foeA = makeStatusDie('foe-a', 'enemy');
  const foeB = makeStatusDie('foe-b', 'enemy');
  const store = new StatusEffectStore();
  const hooks = makeStatusHooks([source, foeA, foeB]);

  store.apply([
    { source, target: foeA, effect: 'poison', duration: 2, damage: 5, allFoes: true },
    { source, target: foeA, effect: 'ignition', duration: 2, rate: 0.5 },
    { source, target: foeA, effect: 'slow', duration: 2, delta: -1, maxStacks: 2 },
    { source, target: foeA, effect: 'slow', duration: 2, delta: -1, maxStacks: 2 },
    { source, target: foeA, effect: 'fracture', duration: 2, rate: 0.25 },
    { source, target: foeA, effect: 'stun', duration: 2 },
    { source, target: foeA, effect: 'hibernation', duration: 3 },
    { source, target: foeA, effect: 'taunt', duration: 2 },
    { source, target: foeA, effect: 'disorientation', duration: 1 }
  ], hooks);
  store.setTimeStatuses('foe-a', [
    { effect: 'acceleration', turns: 2, sourceInstanceId: 'source' },
    { effect: 'dilation', turns: 1, sourceInstanceId: 'source' }
  ]);

  assert.deepEqual(store.getPoisonSummary('foe-a'), {
    damage: 10,
    turns: 2,
    stacks: 1,
    stackDetails: [{ damage: 10, turns: 2 }]
  });
  assert.deepEqual(store.getPoisonSummary('foe-b'), {
    damage: 10,
    turns: 2,
    stacks: 1,
    stackDetails: [{ damage: 10, turns: 2 }]
  });
  assert.equal(store.getSlowSummary('foe-a')?.delta, -2);
  assert.equal(store.getSlowSummary('foe-a')?.stacks, 2);
  assert.equal(store.getStatusStackCount('foe-a', 'poison'), 1);
  assert.equal(store.getStatusStackCount('foe-a', 'slow'), 2);
  assert.equal(store.getStatusStackCount('foe-a', 'stun'), 1);
  assert.equal(store.getStatusStackCount('foe-a', 'acceleration'), 1);
  assert.equal(store.getStatusStackCount('foe-a', 'dilation'), 1);
  assert.deepEqual(store.getStatusEffects('foe-a'), [
    'slow', 'poison', 'ignition', 'taunt', 'fracture', 'stun', 'hibernation', 'acceleration', 'dilation', 'disorientation'
  ]);
  assert.ok(hooks.animations.some((entry) => entry.animation === 'poison' && entry.targetId === 'foe-b'));
  assert.ok(hooks.animations.some((entry) => entry.animation === 'fire' && entry.targetId === 'foe-a'));
  assert.deepEqual(hooks.attackDeltas, [
    { targetId: 'foe-a', delta: -1 },
    { targetId: 'foe-a', delta: -1 }
  ]);
  assert.deepEqual(hooks.attackLosses, [{ targetId: 'foe-a', amount: 2 }]);
  assert.equal(hooks.applied.filter((entry) => entry.targetId === 'foe-a').length, 9);
  assert.match(store.getSummaryLines('foe-a').join('\n'), /Slow x2: -1 attack/);
  assert.match(store.getSummaryLines('foe-a').join('\n'), /Poison: 10\/turn/);

  store.apply([{ source, target: foeB, effect: 'slow', duration: 1, delta: 1 }], hooks);
  assert.equal(store.getStatusStackCount('foe-b', 'slow'), 1);
  assert.equal(store.getStatusEffects('foe-b').includes('slow'), false);
});

test('StatusEffectStore decay and turn consumption clear expired state', () => {
  const store = new StatusEffectStore();
  const die = makeStatusDie('die', 'enemy');
  const hooks = makeStatusHooks([die]);
  store.apply([
    { source: die, target: die, effect: 'slow', duration: 1, delta: -1 },
    { source: die, target: die, effect: 'taunt', duration: 2 },
    { source: die, target: die, effect: 'stun', duration: 2 },
    { source: die, target: die, effect: 'hibernation', duration: 1 },
    { source: die, target: die, effect: 'disorientation', duration: 1 }
  ], hooks);
  store.setTimeStatuses('die', [{ effect: 'acceleration', turns: 1, sourceInstanceId: 'die' }]);

  store.decayRoundStatuses();

  assert.equal(store.slowByInstance.has('die'), false);
  assert.equal(store.tauntByInstance.get('die')?.turns, 1);
  assert.equal(store.timeStatusByInstance.has('die'), false);
  assert.equal(store.consumeStunTurn('die'), true);
  assert.equal(store.getStunTurns('die'), 1);
  assert.equal(store.consumeStunTurn('die'), true);
  assert.equal(store.getStunTurns('die'), 0);
  assert.equal(store.consumeHibernationTurn('die'), true);
  assert.equal(store.getHibernationTurns('die'), 0);
  assert.equal(store.consumeDisorientationTurn('die'), true);
  assert.equal(store.disorientationByInstance.has('die'), false);
  assert.equal(store.consumeDisorientationTurn('die'), false);
});

test('StatusEffectStore ticks poison and ignition with resolved sources', async () => {
  const source = makeStatusDie('source', 'player');
  const target = makeStatusDie('boss', 'enemy', { maxHealth: 100 });
  const store = new StatusEffectStore();
  const hooks = makeStatusHooks([source, target]);
  store.apply([
    { source, target, effect: 'poison', duration: 2, damage: 10 },
    { source, target, effect: 'ignition', duration: 1, rate: 0.5 }
  ], hooks);

  await store.tickPoison(hooks);
  await store.tickIgnition(hooks);

  assert.equal(hooks.ticks.length, 2);
  assert.equal(hooks.ticks[0]?.effect, 'poison');
  assert.equal(hooks.ticks[0]?.amount, 20);
  assert.equal(hooks.ticks[0]?.source.instanceId, 'source');
  assert.equal(hooks.ticks[1]?.effect, 'ignition');
  assert.equal(hooks.ticks[1]?.amount, 25);
  assert.equal(hooks.ticks[1]?.bossReduced, true);
  assert.equal(store.getPoisonSummary('boss')?.turns, 1);
  assert.equal(store.getIgnitionSummary('boss'), undefined);

  await store.tickPoison(hooks);
  assert.equal(store.getPoisonSummary('boss'), undefined);
  assert.equal(hooks.ticks.length, 3);

  source.isDestroyed = true;
  store.apply([{ source, target, effect: 'poison', duration: 1, damage: 5 }], hooks);
  await store.tickPoison(hooks);
  assert.equal(hooks.ticks[3]?.source.instanceId, 'source');
  assert.equal(hooks.ticks[3]?.source.isDestroyed, true);
});

test('StatusEffectStore capture and restore copy carryover without sharing stacks', () => {
  const source = makeStatusDie('source', 'player');
  const target = makeStatusDie('target', 'enemy');
  const store = new StatusEffectStore();
  const hooks = makeStatusHooks([source, target]);
  store.apply([
    { source, target, effect: 'poison', duration: 2, damage: 10 },
    { source, target, effect: 'ignition', duration: 2, rate: 0.25 },
    { source, target, effect: 'slow', duration: 2, delta: -1 },
    { source, target, effect: 'fracture', duration: 2, rate: 0.1 },
    { source, target, effect: 'stun', duration: 1 },
    { source, target, effect: 'hibernation', duration: 1 },
    { source, target, effect: 'disorientation', duration: 1 }
  ], hooks);
  store.poisonByInstance.get('target')?.stacks.push({ damage: 99, turns: 0 });

  const captured = store.capture('target');
  assert.equal(captured.poison?.stacks.length, 1);
  assert.equal(captured.fracture?.rate, 0.1);
  assert.equal(captured.stun, 1);
  assert.equal(captured.hibernation, 1);
  assert.equal(captured.disorientation, 1);

  store.clear();
  store.restore('target', captured);
  assert.equal(store.getPoisonSummary('target')?.damage, 20);
  assert.equal(store.getIgnitionSummary('target')?.rate, 0.25);
  assert.equal(store.getSlowSummary('target')?.delta, -1);
  assert.equal(store.fractureByInstance.get('target')?.rate, 0.1);
  assert.equal(store.getStunTurns('target'), 1);
  assert.equal(store.getHibernationTurns('target'), 1);
  assert.equal(store.disorientationByInstance.get('target'), 1);

  captured.poison?.stacks[0] && (captured.poison.stacks[0].damage = 1);
  assert.equal(store.getPoisonSummary('target')?.damage, 20);
});

function makeBossScene(progress: unknown): { scene: Parameters<typeof getBossfightProgress>[0]; registry: Map<string, unknown> } {
  const registry = new Map<string, unknown>();
  registry.set(BOSSFIGHT_PROGRESS_KEY, progress);
  const scene = {
    registry: {
      get: (key: string) => registry.get(key),
      set: (key: string, value: unknown) => registry.set(key, value)
    }
  } as unknown as Parameters<typeof getBossfightProgress>[0];
  return { scene, registry };
}

test('BossStore normalizes progress and persists the selected menu state', () => {
  const normalized = normalizeBossfightProgress({
    unlockedLevels: { Magician: 99, Leon: 0, Basilisk: -4, Silence: Number.NaN },
    rewardClaims: ['Magician:1', 42 as unknown as string, 'Leon:2']
  });
  assert.deepEqual(normalized.unlockedLevels, { Magician: 15, Leon: 1, Basilisk: 1, Silence: 1 });
  assert.deepEqual(normalized.rewardClaims, ['Magician:1', 'Leon:2']);

  const { scene, registry } = makeBossScene({
    unlockedLevels: { Magician: 4, Leon: 4, Basilisk: 2, Silence: 1 },
    rewardClaims: []
  });
  assert.equal(getBossfightProgress(scene).unlockedLevels.Magician, 4);
  assert.equal(registry.get(BOSSFIGHT_PROGRESS_KEY) !== undefined, true);

  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }
  };
  values.set(BOSSFIGHT_MENU_STATE_KEY, JSON.stringify({ boss: 'Leon', level: 99 }));
  const legacyMenu = getBossfightMenuState(scene, storage);
  assert.equal(legacyMenu.boss, 'Leon');
  assert.equal(legacyMenu.level, 4);
  assert.deepEqual(legacyMenu.levels, { Magician: 1, Leon: 4, Basilisk: 1, Silence: 1 });
  saveBossfightMenuState('Basilisk', 7, storage, legacyMenu.levels);
  assert.deepEqual(JSON.parse(values.get(BOSSFIGHT_MENU_STATE_KEY) ?? '{}'), {
    boss: 'Basilisk',
    level: 7,
    levels: { Magician: 1, Leon: 4, Basilisk: 7, Silence: 1 }
  });

  const perBossLevels = { Magician: 5, Leon: 2, Basilisk: 3, Silence: 1 };
  saveBossfightMenuState('Leon', 2, storage, perBossLevels);
  saveBossfightMenuState('Magician', 5, storage, perBossLevels);
  assert.deepEqual(JSON.parse(values.get(BOSSFIGHT_MENU_STATE_KEY) ?? '{}'), {
    boss: 'Magician',
    level: 5,
    levels: { Magician: 5, Leon: 2, Basilisk: 3, Silence: 1 }
  });
});

test('BossStore exposes bounded rewards and complete boss metadata', () => {
  assert.equal(MAX_BOSSFIGHT_LEVEL, 15);
  assert.deepEqual(getBossfightRewards(1), { tokens: 2000, chips: 10 });
  assert.deepEqual(getBossfightRewards(15), { tokens: 16000, chips: 80 });
  assert.deepEqual(getBossfightRewards(99), { tokens: 16000, chips: 80 });
  assert.deepEqual(getBossfightRewards(-5), { tokens: 2000, chips: 10 });
  assert.deepEqual(BOSSFIGHT_BOSSES, ['Magician', 'Leon', 'Basilisk', 'Silence']);
  BOSSFIGHT_BOSSES.forEach((boss) => {
    const metadata = BOSSFIGHT_BOSS_METADATA[boss];
    assert.equal(metadata.typeId, boss);
    assert.equal(metadata.label, boss.toUpperCase());
    assert.match(metadata.color, /^#[0-9a-f]{6}$/i);
  });
});

test('BossStore resolves music keys without importing the scene audio manager', () => {
  const keys = {
    deuciferMusic: 'deucifer',
    magicianMusic: 'magician',
    leonMusic: 'leon',
    basiliskMusic: 'basilisk',
    silenceMusic: 'silence',
    arenaMusic: 'arena'
  };
  assert.equal(getBossMusicKey('Deucifer', keys), 'deucifer');
  assert.equal(getBossMusicKey('Imp', keys), 'deucifer');
  assert.equal(getBossMusicKey('Magician', keys), 'magician');
  assert.equal(getBossMusicKey('Wizard', keys), 'magician');
  assert.equal(getBossMusicKey('Leon', keys), 'leon');
  assert.equal(getBossMusicKey('Basilisk', keys), 'basilisk');
  assert.equal(getBossMusicKey('Silence', keys), 'silence');
  assert.equal(getBossMusicKey('Unknown' as BossMusicBoss, keys), 'arena');
});

test('StatusEffectStore applies taunt effects from any source phase and replaces stale taunts', () => {
  const source = makeStatusDie('passive-source', 'player');
  const target = makeStatusDie('target', 'enemy');
  const store = new StatusEffectStore();
  const applied: string[] = [];

  store.applyTaunt('other-target', 'old-source', 1);
  store.applyTauntEffects([source], () => [{ target, duration: 2 }], {
    onApplied: (appliedSource, appliedTarget, effect, duration) => {
      applied.push(`${appliedSource.instanceId}:${appliedTarget.instanceId}:${effect}:${duration}`);
    }
  });

  assert.deepEqual(store.getTaunt('target'), { sourceId: 'passive-source', turns: 2 });
  assert.equal(store.getTaunt('other-target'), undefined);
  assert.deepEqual(applied, ['passive-source:target:taunt:2']);
});

function makeChallengeScene(
  statuses: Record<string, unknown> = {},
  rewardClaims: unknown = []
): { scene: Parameters<typeof getChallengeStatus>[0]; registry: Map<string, unknown> } {
  const registry = new Map<string, unknown>();
  registry.set(CHALLENGE_STATUS_KEY, statuses);
  registry.set(CHALLENGE_REWARD_CLAIMS_KEY, rewardClaims);
  const scene = {
    registry: {
      get: (key: string) => registry.get(key),
      set: (key: string, value: unknown) => registry.set(key, value)
    }
  } as unknown as Parameters<typeof getChallengeStatus>[0];
  return { scene, registry };
}

test('ChallengeStore keeps daily seeds, rewards, and challenge configs stable', () => {
  assert.equal(getDailyChallengeKey(new Date('2026-11-12T23:59:59.000Z')), '2026-11-12');
  assert.equal(isHardDaily('2026-11-12'), true);
  assert.equal(isHardDaily('2026-11-13'), false);
  assert.equal(getDailySeededModifier('2026-11-12'), getDailySeededModifier('2026-11-12'));
  assert.equal(CHALLENGE_RANDOM_MODIFIERS.includes(getDailySeededModifier('2026-11-12')), true);
  assert.deepEqual(
    [...CHALLENGE_RANDOM_MODIFIERS].sort(),
    ['Classic', 'Combanity', 'DiceCard', 'Duality', 'Necromancy'].sort()
  );
  assert.equal(getDailySeededIndex('2026-11-12', 'loadout', 10), getSeededDailyIndex('2026-11-12', 'loadout', 10));
  assert.equal(getDailySeededRange('2026-11-12', 'range', 3, 8) >= 3, true);
  assert.equal(getDailySeededRange('2026-11-12', 'range', 3, 8) <= 8, true);
  assert.equal(['mirror', 'player-vs-enemy', 'random-vs-random'].includes(getDailyLoadoutMode('2026-11-12')), true);
  assert.equal(typeof getDailyUsesRandomClassUps('2026-11-12'), 'boolean');

  assert.deepEqual(getChallengeReward('daily', false), { tokens: 800, chips: 10 });
  assert.deepEqual(getChallengeReward('daily', true), { tokens: 2400, chips: 30 });
  assert.deepEqual(getChallengeReward('deucifer'), { tokens: 7500, chips: 50 });
  assert.deepEqual(getChallengeReward('dopamine'), { tokens: 2500, chips: 20 });

  const daily = getChallengeStartConfig('daily', true, '2026-11-12');
  assert.equal(daily.difficulty, 'Nightmare');
  assert.equal(daily.turnLimit, 10);
  assert.equal(daily.randomMode, true);
  assert.equal(daily.randomizeLoadoutAndClassUps, getDailyUsesRandomClassUps('2026-11-12'));
  assert.deepEqual(getChallengeStartConfig('deucifer', false), {
    difficulty: 'Nightmare',
    turnLimit: 10,
    randomMode: false,
    randomizeLoadoutAndClassUps: false,
    activeRandomModifier: undefined,
    enemyTypeIds: ['Poison', 'Solitude', 'Judgment', 'Skull', 'Death'],
    enemyClassLevel: 11
  });
  assert.deepEqual(getChallengeEnemyConfig('dopamine'), {
    typeIds: ['Healing', 'Light', 'Battery', 'Meteor', 'Wind'],
    classLevel: 7
  });
  assert.equal(getChallengeRandomModifier('daily', '2026-11-12'), getDailySeededModifier('2026-11-12'));
  assert.equal(getChallengeRandomModifier('dopamine'), 'DiceCard');
  assert.equal(getChallengeRandomModifier('deucifer'), undefined);

  const dailyCard = getChallengeUIConfig('daily', true, '2026-11-12');
  assert.equal(dailyCard.title, 'Daily Challenge ☠ HARD!');
  assert.deepEqual(dailyCard.reward, { tokens: 2400, chips: 30 });
  assert.equal(getChallengeUIConfig('dopamine', false).title, 'Dopamine Challenge');
  assert.equal(getChallengeUIConfig('deucifer', false).summary, 'Nightmare Deucifer\nClassic • 10 Turns');
});

test('ChallengeStore normalizes statuses and claims while preserving failure rules', () => {
  const dailyKey = '2026-11-12';
  const { scene, registry } = makeChallengeScene({
    [getChallengeClaimKey('daily', dailyKey)]: 'failed',
    deucifer: 'completed',
    dopamine: 'started',
    invalid: 'unknown'
  }, ['deucifer']);

  assert.equal(getChallengeStatus(scene, 'daily', dailyKey), 'failed');
  assert.equal(getChallengeStatus(scene, 'deucifer'), 'completed');
  assert.equal(getChallengeStatus(scene, 'dopamine'), 'started');
  assert.equal(getChallengeStatusLabel('not-started'), 'NOT STARTED');
  assert.equal(getChallengeStatusLabel('completed'), 'COMPLETED');
  assert.equal(registry.get(CHALLENGE_STATUS_KEY) && Object.keys(registry.get(CHALLENGE_STATUS_KEY) as object).includes('invalid'), false);
  assert.equal(canChallengeBeMarkedFailed(scene, 'deucifer'), false);
  assert.equal(canChallengeBeMarkedFailed(scene, 'dopamine'), true);
  assert.equal(canChallengeBeMarkedFailed(scene, 'daily', dailyKey), true);
});

test('timed soul transformations refresh at the soul cap', () => {
  const baseDefinition = {
    typeId: 'Death',
    title: 'Death Dice',
    attack: 24,
    health: 640,
    range: 4,
    rarity: 'Epic' as const,
    targetingMode: 'Nearest' as const,
    accent: '#000000',
    skills: [{
      type: 'Passive' as const,
      title: 'Death Incarnate',
      description: 'Transforms after capturing a soul.',
      modifiers: { canConjureSouls: true, conjureType: 'ally' as const, maxSouls: 1, transformSoulCount: 1 }
    }],
    transformStats: [{
      title: 'Death Dice — Instakill Form',
      transformDuration: 1,
      skills: [{
        type: 'Active' as const,
        title: "Reaper's Touch",
        description: 'Instantly kills a target.',
        manaNeeded: 12,
        modifiers: { instakill: true }
      }]
    }],
    transformFlags: ['instakillForm']
  } satisfies DiceDefinition;
  let die: DiceInstanceState = {
    instanceId: 'player-Death-1',
    typeId: 'Death',
    ownerId: 'player',
    zone: 'board',
    maxHealth: 640,
    currentHealth: 640,
    isDestroyed: false,
    hasFinishedAttacking: false,
    attacksRemaining: 0
  };
  let activeDefinition = baseDefinition;
  const host: TransformStateHost = {
    getDefinitionForInstance: () => activeDefinition,
    getBaseDefinitionForInstance: () => baseDefinition,
    getCombatBaseDefinition: () => baseDefinition,
    getClassLevel: () => 1,
    applyDungeonCardDefinitionForOwner: (definition) => definition,
    getDiceCardMaxHealthForDefinition: (definition) => definition.health,
    getTransformDurationBonus: () => 1,
    getDie: () => die,
    updateDie: (_instanceId, update) => {
      die = update(die);
      return die;
    },
    setDefinitionOverride: (_instanceId, definition) => { activeDefinition = definition; },
    resetActiveMana: () => undefined,
    writeCombatLog: () => undefined,
    applyOnTransformedSkillEffects: () => undefined,
    animateTransformEffect: () => undefined,
    getCombatDieName: () => 'Death'
  };
  const transforms = new TransformState(host);

  transforms.transformFromSoulCap(die);
  assert.equal(transforms.getIndex(die.instanceId), 0);

  transforms.tickDurations();
  transforms.transformFromSoulCap(die);
  transforms.tickDurations();
  assert.equal(transforms.getIndex(die.instanceId), 0);

  transforms.tickDurations();
  assert.equal(transforms.getIndex(die.instanceId), undefined);
});

test('timed pip transformations refresh before de-transforming', () => {
  const baseDefinition = {
    typeId: 'Transcendence',
    title: 'Transcendence Dice',
    attack: 40,
    health: 640,
    range: 5,
    rarity: 'Legendary' as const,
    targetingMode: 'Nearest' as const,
    accent: '#7099d6',
    skills: [{
      type: 'Passive' as const,
      title: 'Perpendicular Beam',
      description: 'If it rolls 6, transforms into The Transcendence.',
      modifiers: { transformPipCount: 6 }
    }],
    transformStats: [{
      title: 'The Transcendence',
      range: 9,
      transformDuration: 1,
      skills: []
    }],
    transformFlags: ['transcendentForm']
  } satisfies DiceDefinition;
  let die: DiceInstanceState = {
    instanceId: 'player-Transcendence-1',
    typeId: 'Transcendence',
    ownerId: 'player',
    zone: 'hand',
    maxHealth: 640,
    currentHealth: 640,
    isDestroyed: false,
    hasFinishedAttacking: false,
    attacksRemaining: 0
  };
  let activeDefinition = baseDefinition;
  const host: TransformStateHost = {
    getDefinitionForInstance: () => activeDefinition,
    getBaseDefinitionForInstance: () => baseDefinition,
    getCombatBaseDefinition: () => baseDefinition,
    getClassLevel: () => 1,
    applyDungeonCardDefinitionForOwner: (definition) => definition,
    getDiceCardMaxHealthForDefinition: (definition) => definition.health,
    getTransformDurationBonus: () => 1,
    getDie: () => die,
    updateDie: (_instanceId, update) => {
      die = update(die);
      return die;
    },
    setDefinitionOverride: (_instanceId, definition) => { activeDefinition = definition; },
    resetActiveMana: () => undefined,
    writeCombatLog: () => undefined,
    applyOnTransformedSkillEffects: () => undefined,
    animateTransformEffect: () => undefined,
    getCombatDieName: () => 'Transcendence'
  };
  const transforms = new TransformState(host);

  transforms.tryAdvancePipTriggeredTransform(die, 6);
  assert.equal(transforms.getIndex(die.instanceId), 0);
  assert.equal(die.maxHealth, 640);

  transforms.tickDurations();
  transforms.clearPipTriggers();
  transforms.tryAdvancePipTriggeredTransform(die, 6);
  transforms.tickDurations();
  assert.equal(transforms.getIndex(die.instanceId), 0);
  assert.equal(die.maxHealth, 640);

  transforms.tickDurations();
  assert.equal(transforms.getIndex(die.instanceId), undefined);
});
