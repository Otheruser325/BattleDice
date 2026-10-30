import type Phaser from 'phaser';
import type { DiceDefinition, DiceRarity, DiceSkillDefinition, DiceSkillModifier, DiceTalentModifier, DiceTypeId } from '../types/game';
import type { ChestType } from './CasinoComboTypes';
import { secureChance, secureRandomInt } from '../utils/RandomManager';
import { mergeSkillOverlayByIndex, SKILL_SOURCE_SKILLS } from './SkillOverlay';
import { applyStatModifiers, applyOverlaySkillDescriptions } from './ClassProgression';
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
  isTalentComingSoon,
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
  'skills'
]);

function getRootSkillModifiers(modifiers: DiceTalentModifier): DiceSkillModifier {
  const root: Record<string, unknown> = {};
  Object.entries(modifiers).forEach(([key, value]) => {
    if (!ROOT_ONLY_MODIFIER_KEYS.has(key) && value !== undefined && value !== null) root[key] = value;
  });
  return root as DiceSkillModifier;
}

function applySkillDescriptions(
  skills: DiceDefinition['skills'],
  overlay: Array<DiceSkillDefinition | null | undefined> | undefined
): DiceDefinition['skills'] {
  if (!Array.isArray(overlay)) return skills;
  return skills.map((skill, index) => {
    const text = overlay[index]?.description;
    return typeof text === 'string' && text.trim().length > 0 ? { ...skill, descriptionLocked: true } : skill;
  });
}

function getDisabledSkillIndices(
  overlay: Array<DiceSkillDefinition | null | undefined> | undefined,
  skillCount: number
): Set<number> {
  const disabled = new Set<number>();
  if (!Array.isArray(overlay)) return disabled;
  overlay.forEach((entry, index) => {
    if (!entry || index >= skillCount) return;
    if (entry.disableSkill === true) disabled.add(index);
  });
  return disabled;
}

export function applyDiceTalent(definition: DiceDefinition, talentIndex: number | null | undefined, classLevel?: number): DiceDefinition {
  if (definition.talentsComingSoon) return definition;
  const talent = getTalentByIndex(definition, talentIndex);
  if (!talent || talent.comingSoon === true) return definition;
  if (typeof classLevel === 'number' && !Number.isFinite(classLevel)) return definition;
  if (classLevel !== undefined && classLevel < getTalentClassNeeded(talent)) return definition;
  const modifiers = talent.modifiers && typeof talent.modifiers === 'object' && !Array.isArray(talent.modifiers) ? talent.modifiers : {};
  const skillOverlay = modifiers.skills;

  const baseSkills = definition.skills;
  const mergedSkills = mergeSkillOverlayByIndex(baseSkills, skillOverlay);
  const rootSkillModifiers = getRootSkillModifiers(modifiers);
  const withRootModifiers = Object.keys(rootSkillModifiers).length > 0
    ? mergedSkills.map((skill) => ({ ...skill, modifiers: { ...(skill.modifiers ?? {}), ...rootSkillModifiers } }))
    : mergedSkills;
  const describedSkills = applySkillDescriptions(withRootModifiers, skillOverlay);
  const resolvedSkills = applyOverlaySkillDescriptions(
    { ...definition, skills: describedSkills },
    baseSkills,
    describedSkills,
    skillOverlay
  );
  const disabledIndices = getDisabledSkillIndices(skillOverlay, resolvedSkills.length);
  const finalSkills = disabledIndices.size === 0
    ? resolvedSkills
    : resolvedSkills.filter((_, index) => !disabledIndices.has(index));
  const rangeDelta = typeof modifiers.rangeDelta === 'number' && Number.isFinite(modifiers.rangeDelta) ? modifiers.rangeDelta : 0;
  const sourceSkills = describedSkills.map((_, index) =>
    typeof skillOverlay?.[index]?.type === 'string' ? undefined : baseSkills?.[index]
  );
  const finalSourceSkills = disabledIndices.size === 0
    ? sourceSkills
    : sourceSkills.filter((_, index) => !disabledIndices.has(index));

  const result: DiceDefinition = {
    ...definition,
    attack: applyStatModifiers(definition.attack, definition.attack, modifiers.attackDelta, modifiers.attackMultiplier),
    health: applyStatModifiers(definition.health, definition.health, modifiers.healthDelta, modifiers.healthMultiplier),
    range: Math.max(0, definition.range + rangeDelta),
    targetingMode: modifiers.targetingMode ?? definition.targetingMode,
    skills: finalSkills
  };
  Object.defineProperty(result, SKILL_SOURCE_SKILLS, { value: finalSourceSkills });
  return result;
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
