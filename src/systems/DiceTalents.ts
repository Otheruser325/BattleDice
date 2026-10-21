import type Phaser from 'phaser';
import type { DiceDefinition, DiceRarity, DiceTalentModifier, DiceTypeId } from '../types/game';
import type { ChestType } from './CasinoComboTypes';
import { secureChance, secureRandomInt } from '../utils/RandomManager';
import { getDiceProgress } from '../data/dice';
import {
  DEFAULT_TALENT_CLASS_NEEDED,
  RARITY_ORDER,
  getAcquirableTalentIndices,
  getTalentByIndex,
  getTalentClassNeeded,
  getTalentCost,
  getTalentDropRate,
  getTalents,
  grantTalent,
  isSafeTalentTypeId,
  isTalentChest,
  isTalentObtainable,
  isTalentOwned
} from './DiceTalentStore';

export {
  DEFAULT_TALENT_CLASS_NEEDED,
  RARITY_ORDER,
  TALENT_SHOP_OFFER_CHANCE,
  getAcquirableTalentIndices,
  getTalents,
  getTalentByIndex,
  getTalentClassNeeded,
  getTalentCost,
  getTalentDropRate,
  getTalentDropRateText,
  getTalentState,
  grantTalent,
  isSafeTalentTypeId,
  isTalentChest,
  isTalentObtainable,
  isTalentOwned
} from './DiceTalentStore';
export type { DiceTalentState } from './DiceTalentStore';

function deepClone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => deepClone(entry)) as unknown as T;
  if (value && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      clone[key] = deepClone(entry);
    });
    return clone as T;
  }
  return value;
}

function mergeTalentSkillModifiers(modifiers: DiceTalentModifier): DiceTalentModifier {
  const { attackDelta: _attackDelta, healthDelta: _healthDelta, attackMultiplier: _attackMultiplier,
    healthMultiplier: _healthMultiplier, rangeDelta: _rangeDelta, targetingMode: _targetingMode,
    skillIndex: _skillIndex, skillModifiers, ...skillModifierFields } = modifiers;
  return { ...skillModifierFields, ...(skillModifiers ?? {}) };
}

export function applyDiceTalent(definition: DiceDefinition, talentIndex: number | null | undefined): DiceDefinition {
  if (definition.talentsComingSoon) return definition;
  const talent = getTalentByIndex(definition, talentIndex);
  if (!talent) return definition;
  const modifiers = talent.modifiers ?? {};

  // A talent may swap the whole skill list: an absent skills field keeps the
  // die's skills, while an explicit list (including an empty one) replaces them,
  // which is how a talent adds or removes skills. Every field is deep-cloned so
  // talent output never aliases the cached definition.
  const baseSkills = Array.isArray(talent.skills)
    ? deepClone(talent.skills)
    : deepClone(Array.isArray(definition.skills) ? definition.skills : []);
  const skillModifiers = mergeTalentSkillModifiers(modifiers);
  const hasSkillChanges = Object.keys(skillModifiers).length > 0;
  const skills = hasSkillChanges
    ? baseSkills.map((skill, index) => {
      if (modifiers.skillIndex !== undefined && modifiers.skillIndex !== index) return skill;
      return {
        ...skill,
        modifiers: { ...(skill.modifiers ?? {}), ...skillModifiers }
      };
    })
    : baseSkills;

  const cloned = deepClone(definition);
  return {
    ...cloned,
    typeId: definition.typeId,
    title: definition.title,
    attack: Math.max(1, Math.round((definition.attack + (modifiers.attackDelta ?? 0)) * (modifiers.attackMultiplier ?? 1))),
    health: Math.max(1, Math.round((definition.health + (modifiers.healthDelta ?? 0)) * (modifiers.healthMultiplier ?? 1))),
    range: Math.max(0, definition.range + (modifiers.rangeDelta ?? 0)),
    targetingMode: modifiers.targetingMode ?? definition.targetingMode,
    skills
  };
}

export function canObtainTalent(
  scene: Phaser.Scene,
  definition: DiceDefinition,
  talentIndex: number,
  classLevel: number,
  tokensAvailable: number
): { ok: boolean; reason?: 'owned' | 'class' | 'tokens' | 'invalid'; cost: number; classNeeded: number } {
  const talent = getTalentByIndex(definition, talentIndex);
  const cost = getTalentCost(definition.rarity);
  const classNeeded = talent ? getTalentClassNeeded(talent) : DEFAULT_TALENT_CLASS_NEEDED;
  if (!talent || definition.talentsComingSoon || !isTalentObtainable(talent) || !isSafeTalentTypeId(definition.typeId)) {
    return { ok: false, reason: 'invalid', cost, classNeeded };
  }
  if (isTalentOwned(scene, definition.typeId, talentIndex)) return { ok: false, reason: 'owned', cost, classNeeded };
  if (classLevel < classNeeded) return { ok: false, reason: 'class', cost, classNeeded };
  if (tokensAvailable < cost) return { ok: false, reason: 'tokens', cost, classNeeded };
  return { ok: true, cost, classNeeded };
}

export interface TalentDropResult {
  typeId: DiceTypeId;
  title: string;
  rarity: DiceRarity;
  talentIndex: number;
  talentTitle: string;
}

export function rollTalentDrop(
  scene: Phaser.Scene,
  chestType: ChestType,
  definitions: DiceDefinition[]
): TalentDropResult | undefined {
  if (!isTalentChest(chestType)) return undefined;
  const candidates = definitions.filter((definition) =>
    getTalents(definition).length > 0 && !definition.talentsComingSoon && isSafeTalentTypeId(definition.typeId)
  );
  if (candidates.length === 0) return undefined;

  const eligibleByRarity = new Map<DiceRarity, DiceDefinition[]>();
  candidates.forEach((definition) => {
    const classLevel = getDiceProgress(scene, definition.typeId).classLevel;
    if (getAcquirableTalentIndices(scene, definition, classLevel).length === 0) return;
    const pool = eligibleByRarity.get(definition.rarity) ?? [];
    pool.push(definition);
    eligibleByRarity.set(definition.rarity, pool);
  });
  if (eligibleByRarity.size === 0) return undefined;

  // One roll per rarity keeps the published rate tied to the die's rarity instead
  // of compounding as more talent dice of the same rarity are added. The rarest
  // successful roll wins so a chest can never grant more than one talent.
  const rarity = [...RARITY_ORDER].reverse().find((entry) =>
    eligibleByRarity.has(entry) && secureChance(getTalentDropRate(chestType, entry))
  );
  if (!rarity) return undefined;

  const rarityPool = eligibleByRarity.get(rarity) ?? [];
  const definition = rarityPool[secureRandomInt(rarityPool.length)];
  const classLevel = getDiceProgress(scene, definition.typeId).classLevel;
  const talentIndex = getAcquirableTalentIndices(scene, definition, classLevel)[0];
  const talent = getTalentByIndex(definition, talentIndex);
  if (!talent) return undefined;
  if (!grantTalent(scene, definition, talentIndex)) return undefined;
  return {
    typeId: definition.typeId,
    title: definition.title,
    rarity: definition.rarity,
    talentIndex,
    talentTitle: talent.title
  };
}
