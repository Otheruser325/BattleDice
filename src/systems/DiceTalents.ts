import type Phaser from 'phaser';
import type { DiceDefinition, DiceRarity, DiceSkillModifier, DiceTalentModifier, DiceTypeId } from '../types/game';
import type { ChestType } from './CasinoComboTypes';
import { secureChance, secureRandomInt } from '../utils/RandomManager';
import { mergeSkillsByIndex, withLiftedManaCost } from './SkillOverlay';
import {
  DEFAULT_TALENT_CLASS_NEEDED,
  RARITY_ORDER,
  getAcquirableTalentIndices,
  getTalents,
  getTalentByIndex,
  getTalentClassNeeded,
  getTalentCost,
  getTalentDropRate,
  getUnobtainableTalentReason,
  grantTalent,
  isSafeTalentTypeId,
  isTalentChest
} from '../data/dice';

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
  getUnobtainableTalentReason,
  grantTalent,
  isSafeTalentTypeId,
  isTalentChest,
  isTalentObtainable,
  isTalentOwned,
  setEquippedTalentIndex,
  getEquippedTalentIndex
} from '../data/dice';
export type { DiceTalentState } from '../data/dice';

const ROOT_ONLY_MODIFIER_KEYS = new Set([
  'attackDelta',
  'healthDelta',
  'attackMultiplier',
  'healthMultiplier',
  'rangeDelta',
  'targetingMode',
  'skillModifiers'
]);

function toSkillModifierArray(value: DiceSkillModifier | DiceSkillModifier[] | undefined): DiceSkillModifier[] {
  if (Array.isArray(value)) return value.map((entry) => (entry && typeof entry === 'object' ? entry : {}));
  return value && typeof value === 'object' ? [value] : [];
}

function getRootSkillModifiers(modifiers: DiceTalentModifier): DiceSkillModifier {
  const root: Record<string, unknown> = {};
  Object.entries(modifiers).forEach(([key, value]) => {
    if (!ROOT_ONLY_MODIFIER_KEYS.has(key)) root[key] = value;
  });
  return root as DiceSkillModifier;
}

function applySkillModifierArray(skills: DiceDefinition['skills'], entries: DiceSkillModifier[]) {
  if (entries.every((entry) => Object.keys(entry).length === 0)) return skills;
  return skills.map((skill, index) => {
    const entry = entries[index];
    if (!entry || Object.keys(entry).length === 0) return skill;
    return withLiftedManaCost({ ...skill, modifiers: { ...(skill.modifiers ?? {}), ...entry } });
  });
}

export function applyDiceTalent(definition: DiceDefinition, talentIndex: number | null | undefined): DiceDefinition {
  if (definition.talentsComingSoon) return definition;
  const talent = getTalentByIndex(definition, talentIndex);
  if (!talent) return definition;
  const modifiers = talent.modifiers ?? {};

  const skills = applySkillModifierArray(
    mergeSkillsByIndex(definition.skills, talent.skills),
    toSkillModifierArray(modifiers.skillModifiers)
  );
  const rootSkillModifiers = getRootSkillModifiers(modifiers);
  const finalSkills = Object.keys(rootSkillModifiers).length > 0
    ? skills.map((skill) => ({ ...skill, modifiers: { ...(skill.modifiers ?? {}), ...rootSkillModifiers } }))
    : skills;

  return {
    ...definition,
    attack: Math.max(1, Math.round((definition.attack + (modifiers.attackDelta ?? 0)) * (modifiers.attackMultiplier ?? 1))),
    health: Math.max(1, Math.round((definition.health + (modifiers.healthDelta ?? 0)) * (modifiers.healthMultiplier ?? 1))),
    range: Math.max(0, definition.range + (modifiers.rangeDelta ?? 0)),
    targetingMode: modifiers.targetingMode ?? definition.targetingMode,
    skills: finalSkills
  };
}

export function canObtainTalent(
  scene: Phaser.Scene,
  definition: DiceDefinition,
  talentIndex: number,
  classLevel: number,
  tokensAvailable: number
): { ok: boolean; reason?: 'invalid' | 'coming-soon' | 'locked' | 'class' | 'owned' | 'tokens'; cost: number; classNeeded: number } {
  const talent = getTalentByIndex(definition, talentIndex);
  const cost = getTalentCost(definition.rarity);
  const classNeeded = talent ? getTalentClassNeeded(talent) : DEFAULT_TALENT_CLASS_NEEDED;
  const reason = getUnobtainableTalentReason(scene, definition, talentIndex);
  if (reason !== null && reason !== 'owned') return { ok: false, reason, cost, classNeeded };
  if (reason === 'owned') return { ok: false, reason: 'owned', cost, classNeeded };
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
    if (getAcquirableTalentIndices(scene, definition).length === 0) return;
    const pool = eligibleByRarity.get(definition.rarity) ?? [];
    pool.push(definition);
    eligibleByRarity.set(definition.rarity, pool);
  });
  if (eligibleByRarity.size === 0) return undefined;

  // One roll per rarity keeps the published rate tied to the die's rarity instead of
  // compounding with more talent dice; the rarest success wins, so one chest grants
  // at most one talent.
  const rarity = [...RARITY_ORDER].reverse().find((entry) =>
    eligibleByRarity.has(entry) && secureChance(getTalentDropRate(chestType, entry))
  );
  if (!rarity) return undefined;

  const rarityPool = eligibleByRarity.get(rarity) ?? [];
  const definition = rarityPool[secureRandomInt(rarityPool.length)];
  const talentIndex = getAcquirableTalentIndices(scene, definition)[0];
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
