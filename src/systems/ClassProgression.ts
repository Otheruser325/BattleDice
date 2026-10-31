import type { DiceDefinition, DiceSkillDefinition, DiceSkillModifier, DiceTransformStats } from '../types/game';
import { mergeSkillsByIndex, SKILL_SOURCE_SKILLS } from './SkillOverlay';
import { formatCompact, formatPercent as formatPercentValue } from '../utils/FormatManager';

export function getTransformStats(definition: DiceDefinition, transformIndex = 0): DiceTransformStats | undefined {
  return definition.transformStats?.[transformIndex];
}

export function getTransformRecoveryRate(definition: DiceDefinition, transformIndex = 0): number | undefined {
  const rate = getTransformStats(definition, transformIndex)?.recoveryRate;
  return typeof rate === 'number' && Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : undefined;
}

export function resolveStatMultiplier(multiplier: number | undefined): number {
  return typeof multiplier === 'number' && Number.isFinite(multiplier) ? multiplier : 1;
}

export function resolveStatValue(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function scaleStatValue(base: number | undefined, fallback: number, multiplier: number | undefined): number {
  return Math.max(1, Math.round(resolveStatValue(base, fallback) * resolveStatMultiplier(multiplier)));
}

export function applyStatModifiers(base: number | undefined, fallback: number, delta: number | undefined, multiplier: number | undefined): number {
  const resolvedBase = resolveStatValue(base, fallback);
  const resolvedDelta = typeof delta === 'number' && Number.isFinite(delta) ? delta : 0;
  return Math.max(1, Math.round((resolvedBase + resolvedDelta) * resolveStatMultiplier(multiplier)));
}

export function applyOverlaySkillDescriptions(
  definition: DiceDefinition,
  baseSkills: DiceSkillDefinition[] | undefined,
  skills: DiceSkillDefinition[],
  overlay: Array<DiceSkillDefinition | null | undefined> | undefined
): DiceSkillDefinition[] {
  return skills.map((skill, index) => {
    if (skill.descriptionLocked) return skill;
    const overlaySkill = overlay?.[index];
    const sourceModifiers = typeof overlaySkill?.type === 'string' ? undefined : baseSkills?.[index]?.modifiers;
    if (!sourceModifiers && !skill.modifiers) return skill;
    const description = getClassScaledSkillDescription(definition, skill, 1, sourceModifiers);
    return description === skill.description ? skill : { ...skill, description };
  });
}

export function applyTransformStats(definition: DiceDefinition, transformIndex = 0): DiceDefinition {
  const stats = getTransformStats(definition, transformIndex);
  if (!stats) return definition;
  if (stats.title && definition.title === stats.title) return definition;
  const mergedSkills = mergeSkillsByIndex(definition.skills, stats.skills);
  const transformedDefinition: DiceDefinition = {
    ...definition,
    title: stats.title ?? definition.title,
    attack: scaleStatValue(stats.attack, definition.attack, stats.attackMultiplier),
    health: scaleStatValue(stats.health, definition.health, stats.healthMultiplier),
    range: stats.range ?? definition.range,
    footprint: stats.footprint ?? definition.footprint,
    targetingMode: stats.targetingMode ?? definition.targetingMode,
    accent: stats.accent ?? definition.accent,
    rarity: stats.rarity ?? definition.rarity,
    isBoss: stats.isBoss ?? definition.isBoss,
    skills: mergedSkills,
    transformStats: definition.transformStats,
    transformFlags: definition.transformFlags,
    alternateButton: definition.alternateButton,
    baseButton: definition.baseButton
  };
  const skills = applyOverlaySkillDescriptions(transformedDefinition, definition.skills, mergedSkills, stats.skills);
  return { ...transformedDefinition, skills };
}

type DefinitionWithSkillSources = DiceDefinition & {
  [SKILL_SOURCE_SKILLS]?: Array<DiceSkillDefinition | undefined>;
};

export const MAX_CLASS_LEVEL = 15;
export const CLASS_UP_STAT_MULTIPLIER = 1.1;
export const BOSS_CLASS_STAT_MULTIPLIER = 1.2;
export const SKULL_REVIVE_CHANCE_PER_CLASS = 0.01;
export const SNIPER_DISTANCE_RATE_PER_CLASS = 0.005;
export const IRON_CURRENT_HP_RATE_PER_CLASS = 0.004;
export const BERSERK_THRESHOLD_RATE_PER_CLASS = 0.01;
export const SOLITUDE_MAX_HP_RATE_PER_CLASS = 0.002;
export const CRACK_ARMOR_SHRED_RATE_PER_CLASS = 0.01;
export const AVOID_ATTACK_CHANCE_PER_CLASS = 0.03;
export const BATTERY_MANA_GAIN_PER_5_CLASS = 1;
export const SOUL_BOOST_RATIO_PER_CLASS = 0.005;
export const LOW_HP_DAMAGE_RATE_PER_CLASS = 0.02;
export const DISCHARGE_STATUS_BONUS_PER_CLASS = 0.005;

export interface ClassProgressionPreview {
  attackDelta: number;
  healthDelta: number;
  skillDeltas: string[];
}

export function getClassMultiplier(classLevel: number): number {
  return CLASS_UP_STAT_MULTIPLIER ** Math.max(0, Math.min(MAX_CLASS_LEVEL, classLevel) - 1);
}

export function getBossClassMultiplier(classLevel: number): number {
  return BOSS_CLASS_STAT_MULTIPLIER ** Math.max(0, Math.min(MAX_CLASS_LEVEL, classLevel) - 1);
}

function isBossDefinition(definition: DiceDefinition): boolean {
  return definition.isBoss === true;
}

function formatPercent(rate: number): string {
  return formatPercentValue(rate, 2);
}

function scaleFlatDamage(value: number | null | undefined, multiplier: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value * multiplier)) : undefined;
}

function scaleDamageRange(range: [number, number] | null | undefined, multiplier: number): [number, number] | undefined {
  if (!Array.isArray(range)) return undefined;
  const [min, max] = range;
  if (typeof min !== 'number' || !Number.isFinite(min) || typeof max !== 'number' || !Number.isFinite(max)) return undefined;
  return [
    Math.max(1, Math.round(min * multiplier)),
    Math.max(1, Math.round(max * multiplier))
  ];
}

function omitNullishModifiers(modifiers: DiceSkillModifier): DiceSkillModifier {
  return Object.fromEntries(
    Object.entries(modifiers).filter(([, value]) => value !== undefined && value !== null)
  ) as DiceSkillModifier;
}

function getModifier(skill: DiceSkillDefinition | undefined): DiceSkillModifier {
  return (skill?.modifiers ?? {}) as DiceSkillModifier;
}

function getCombinedModifiers(definition: DiceDefinition): DiceSkillModifier {
  return definition.skills.reduce((acc, skill) => ({ ...acc, ...(skill.modifiers ?? {}) }), {} as DiceSkillModifier);
}

function parseRuntimeRate(notes: string[] | undefined, key: string): number | undefined {
  const note = (notes ?? []).find((entry) => entry.startsWith(key));
  if (!note) return undefined;
  const parsed = Number(note.split('=')[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatValue(value: number): string {
  return formatCompact(value);
}

function getNumberVariants(value: number): string[] {
  return [...new Set([value.toString(), formatValue(value)])].sort((a, b) => b.length - a.length);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceLiteralNumber(text: string, sourceValue: number | undefined, displayValue: number | undefined): string {
  if (sourceValue === undefined || displayValue === undefined || !Number.isFinite(sourceValue) || !Number.isFinite(displayValue)) return text;
  const to = formatValue(displayValue);
  const fromVariants = getNumberVariants(sourceValue);
  if (fromVariants.includes(to)) return text;
  const fromPattern = fromVariants.map(escapeRegExp).join('|');
  return text.replace(new RegExp(`(^|[^\\d.,])(?:${fromPattern})(?![\\d.,])`, 'g'), `$1${to}`);
}

function replaceLiteralPercent(text: string, sourceValue: number | undefined, displayValue: number | undefined): string {
  if (sourceValue === undefined || displayValue === undefined || !Number.isFinite(sourceValue) || !Number.isFinite(displayValue)) return text;
  const from = formatPercent(sourceValue);
  const to = formatPercent(displayValue);
  if (from === to) return text;
  return text.replace(new RegExp(escapeRegExp(from), 'g'), to);
}

function formatDruidRicochetDescriptor(description: string, ricochetCount: number | undefined): string {
  if (ricochetCount === undefined || ricochetCount <= 1) return description;
  return description.replace(/\d+\s+nearby\s+ally\b/g, `${formatValue(ricochetCount)} nearby allies`);
}

function replaceTurnCount(text: string, sourceValue: number | undefined, displayValue: number | undefined): string {
  if (sourceValue === undefined || displayValue === undefined || !Number.isFinite(sourceValue) || !Number.isFinite(displayValue)) return text;
  const to = formatValue(displayValue);
  const fromPattern = getNumberVariants(sourceValue).map(escapeRegExp).join('|');
  if (fromPattern === escapeRegExp(to)) return text;
  return text.replace(new RegExp(`(for\\s+)(?:${fromPattern})(\\s+turns?)`, 'gi'), `$1${to}$2`);
}

const PLURAL_UNIT_FORMS: Record<string, string> = {
  tiles: 'tile',
  spaces: 'space',
  squares: 'square',
  hexes: 'hex'
};

function normalizeSingularUnits(text: string): string {
  return text.replace(/\b1 (tiles|spaces|squares|hexes)\b/g, (_, unit: string) => `1 ${PLURAL_UNIT_FORMS[unit]}`);
}

function scaleDisplayDamage(value: number | null | undefined, multiplier: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value * Math.max(1, multiplier))) : undefined;
}

function getDynamicSkillDescription(description: string, source: DiceSkillModifier, display: DiceSkillModifier, skillDamageMultiplier = 1): string {
  let text = description;
  const flatDamageKeys: Array<keyof DiceSkillModifier> = [
    'splashDamage',
    'chainDamage',
    'poisonDamage',
    'activeDamage',
    'activeHeal',
    'meteorDamage',
    'nuclearDamage',
    'lavaDamage',
    'beamDamage',
    'pierceBehindDamage',
    'hammerDamage',
    'bossDamage',
    'revengeDamage',
    'shield',
    'transformAttackDamage'
  ];

  flatDamageKeys.forEach((key) => {
    const sourceValue = source[key];
    const displayValue = display[key];
    if (typeof sourceValue !== 'number' || typeof displayValue !== 'number') return;
    text = replaceLiteralNumber(text, sourceValue, scaleDisplayDamage(displayValue, skillDamageMultiplier));
  });

  text = replaceLiteralNumber(text, source.damageRange?.[0], scaleDisplayDamage(display.damageRange?.[0], skillDamageMultiplier));
  text = replaceLiteralNumber(text, source.damageRange?.[1], scaleDisplayDamage(display.damageRange?.[1], skillDamageMultiplier));
  text = replaceTurnCount(text, source.statusDuration, display.statusDuration);
  text = replaceLiteralNumber(text, Math.abs(source.attackDelta ?? Number.NaN), Math.abs(display.attackDelta ?? Number.NaN));
  text = replaceLiteralNumber(text, source.numAttacksBoosted, display.numAttacksBoosted);
  text = replaceLiteralNumber(text, source.manaGain, display.manaGain);
  text = replaceLiteralNumber(text, source.allyManaGain, display.allyManaGain);
  text = replaceLiteralNumber(text, source.foeManaGain, display.foeManaGain);
  text = replaceLiteralNumber(text, source.manaSteal, display.manaSteal);
  text = replaceLiteralNumber(text, source.pierceBehindRange, display.pierceBehindRange);
  text = replaceLiteralNumber(text, source.chainRange, display.chainRange);
  text = replaceLiteralNumber(text, source.allyExtraAttacks, display.allyExtraAttacks);
  text = replaceLiteralNumber(text, source.allyExtraAttacks, display.allyExtraAttacks);
  text = replaceLiteralNumber(text, source.attackCountIncrease, display.attackCountIncrease);
  text = replaceLiteralNumber(text, source.growthDelta, display.growthDelta);
  text = replaceLiteralNumber(text, source.growthDelta, display.growthDelta);
  text = replaceLiteralPercent(text, source.growthChance, display.growthChance);
  text = replaceLiteralNumber(text, source.meteorCount, display.meteorCount);
  text = replaceLiteralNumber(text, source.revengeHits, display.revengeHits);
  text = replaceLiteralNumber(text, source.revengeRange, display.revengeRange);

  text = replaceLiteralPercent(text, source.reviveChance, display.reviveChance);
  text = replaceLiteralPercent(text, source.targetMaxHpBonusRate, display.targetMaxHpBonusRate);
  text = replaceLiteralPercent(text, source.targetCurrentHpBonusRate, display.targetCurrentHpBonusRate);
  text = replaceLiteralPercent(text, source.lowHpThresholdRate, display.lowHpThresholdRate);
  text = replaceLiteralPercent(text, source.lowHpDamageBonusRate, display.lowHpDamageBonusRate);
  text = replaceLiteralPercent(text, source.distanceDamageBonusRatePerTile, display.distanceDamageBonusRatePerTile);
  text = replaceLiteralPercent(text, source.bonusDamagePerStatus, display.bonusDamagePerStatus);
  text = replaceLiteralPercent(text, source.berserkThresholdRate, display.berserkThresholdRate);
  text = replaceLiteralPercent(text, source.berserkDamageMultiplier !== undefined ? source.berserkDamageMultiplier - 1 : undefined, display.berserkDamageMultiplier !== undefined ? display.berserkDamageMultiplier - 1 : undefined);
  text = replaceLiteralPercent(text, source.soulBoostPercent, display.soulBoostPercent);
  text = replaceLiteralPercent(text, source.armorReduction, display.armorReduction);
  text = replaceLiteralPercent(text, source.criticalChanceIncrease, display.criticalChanceIncrease);
  text = replaceLiteralPercent(text, source.criticalDamageIncrease, display.criticalDamageIncrease);
  text = replaceLiteralPercent(text, source.damageRatePerKill, display.damageRatePerKill);
  text = replaceLiteralPercent(text, source.missingHealRate, display.missingHealRate);
  text = replaceLiteralPercent(text, source.revengeThresholdRate, display.revengeThresholdRate);
  text = replaceLiteralPercent(text, source.avoidAttackChance, display.avoidAttackChance);

  return text;
}

export function applyClassProgression(definition: DiceDefinition, classLevel: number): DiceDefinition {
  const boundedClassLevel = Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(classLevel)));
  const multiplier = isBossDefinition(definition)
    ? getBossClassMultiplier(boundedClassLevel)
    : getClassMultiplier(boundedClassLevel);
  const classUps = boundedClassLevel - 1;
  const skillSourceSkills = (definition as DefinitionWithSkillSources)[SKILL_SOURCE_SKILLS];

  const scaledDefinitionForDescription: DiceDefinition = {
    ...definition,
    attack: scaleStatValue(definition.attack, 1, multiplier),
    health: scaleStatValue(definition.health, 1, multiplier)
  };
  const skills = definition.skills.map((skill, index) => {
    const displayModifiers = skill.modifiers ? omitNullishModifiers(skill.modifiers) : undefined;
    const sourceSkill = skillSourceSkills?.[index];
    const sourceModifiers = sourceSkill?.modifiers ?? displayModifiers;
    const source = sourceModifiers ? omitNullishModifiers(sourceModifiers) : undefined;
    if (!displayModifiers) return skill;

    const modifiers: DiceSkillModifier = { ...displayModifiers };
    modifiers.splashDamage = scaleFlatDamage(displayModifiers.splashDamage, multiplier);
    modifiers.heatwaveDamage = scaleFlatDamage(displayModifiers.heatwaveDamage, multiplier);
    modifiers.chainDamage = scaleFlatDamage(displayModifiers.chainDamage, multiplier);
    modifiers.poisonDamage = scaleFlatDamage(displayModifiers.poisonDamage, multiplier);
    modifiers.activeDamage = scaleFlatDamage(displayModifiers.activeDamage, multiplier);
    modifiers.activeHeal = scaleFlatDamage(displayModifiers.activeHeal, multiplier);
    modifiers.meteorDamage = scaleFlatDamage(displayModifiers.meteorDamage, multiplier);
    modifiers.nuclearDamage = scaleFlatDamage(displayModifiers.nuclearDamage, multiplier);
    modifiers.lavaDamage = scaleFlatDamage(displayModifiers.lavaDamage, multiplier);
    modifiers.beamDamage = scaleFlatDamage(displayModifiers.beamDamage, multiplier);
    modifiers.pierceBehindDamage = scaleFlatDamage(displayModifiers.pierceBehindDamage, multiplier);
    modifiers.hammerDamage = scaleFlatDamage(displayModifiers.hammerDamage, multiplier);
    modifiers.bossDamage = scaleFlatDamage(displayModifiers.bossDamage, multiplier);
    modifiers.shield = scaleFlatDamage(displayModifiers.shield, multiplier);
    modifiers.transformAttackDamage = scaleFlatDamage(displayModifiers.transformAttackDamage, multiplier);
    modifiers.damageRange = scaleDamageRange(displayModifiers.damageRange, multiplier);

    if (definition.typeId === 'Skull' && displayModifiers.reviveChance !== undefined) {
      modifiers.reviveChance = Math.min(1, displayModifiers.reviveChance + SKULL_REVIVE_CHANCE_PER_CLASS * classUps);
    }

    if (definition.typeId === 'Sniper' && displayModifiers.distanceDamageBonusRatePerTile !== undefined) {
      modifiers.distanceDamageBonusRatePerTile = displayModifiers.distanceDamageBonusRatePerTile + SNIPER_DISTANCE_RATE_PER_CLASS * classUps;
    }

    if (definition.typeId === 'Discharge' && displayModifiers.bonusDamagePerStatus !== undefined) {
      modifiers.bonusDamagePerStatus = displayModifiers.bonusDamagePerStatus + DISCHARGE_STATUS_BONUS_PER_CLASS * classUps;
    }

    if (definition.typeId === 'Iron' && displayModifiers.targetCurrentHpBonusRate !== undefined) {
      modifiers.targetCurrentHpBonusRate = displayModifiers.targetCurrentHpBonusRate + IRON_CURRENT_HP_RATE_PER_CLASS * classUps;
    }

    if (displayModifiers.lowHpDamageBonusRate !== undefined) {
      modifiers.lowHpDamageBonusRate = Math.min(0.78, displayModifiers.lowHpDamageBonusRate + LOW_HP_DAMAGE_RATE_PER_CLASS * classUps);
    }

    if (definition.typeId === 'Berserk' && displayModifiers.berserkThresholdRate !== undefined) {
      modifiers.berserkThresholdRate = Math.min(0.95, displayModifiers.berserkThresholdRate + BERSERK_THRESHOLD_RATE_PER_CLASS * classUps);
    }

    if (displayModifiers.checkForAdjacentAllies && displayModifiers.targetMaxHpBonusRate !== undefined) {
      modifiers.targetMaxHpBonusRate = displayModifiers.targetMaxHpBonusRate + SOLITUDE_MAX_HP_RATE_PER_CLASS * classUps;
    }

    if (definition.typeId === 'Assassin' && displayModifiers.numAttacksBoosted !== undefined) {
      modifiers.numAttacksBoosted = displayModifiers.numAttacksBoosted + Math.floor(classUps / 4);
    }

    const armorReduction = displayModifiers.armorReduction ?? parseRuntimeRate(displayModifiers.notes, 'runtime:armorShredRate=');
    if (armorReduction !== undefined) {
      modifiers.armorReduction = Math.min(0.95, armorReduction + CRACK_ARMOR_SHRED_RATE_PER_CLASS * classUps);
      modifiers.notes = (displayModifiers.notes ?? []).filter((note) => !note.startsWith('runtime:armorShredRate='));
    }

    if (definition.typeId === 'Battery' && displayModifiers.allyManaGain !== undefined) {
      modifiers.allyManaGain = displayModifiers.allyManaGain + Math.floor(classUps / 5) * BATTERY_MANA_GAIN_PER_5_CLASS;
    }

    if (displayModifiers.soulBoostPercent !== undefined) {
      modifiers.soulBoostPercent = displayModifiers.soulBoostPercent + SNIPER_DISTANCE_RATE_PER_CLASS * classUps;
    }

    if ((definition.typeId === 'Magician' || definition.typeId === 'Wizard') && displayModifiers.allyManaGain !== undefined) {
      modifiers.allyManaGain = displayModifiers.allyManaGain + Math.floor(classUps / 4);
    }

    if (definition.typeId === 'Magician' && displayModifiers.manaSteal !== undefined) {
      modifiers.manaSteal = displayModifiers.manaSteal + Math.floor(classUps / 5);
    }

    if (definition.typeId === 'Magician' && displayModifiers.statusDuration !== undefined) {
      modifiers.statusDuration = displayModifiers.statusDuration + Math.floor(classUps / 4);
    }

    if (displayModifiers.avoidAttackChance !== undefined) {
      modifiers.avoidAttackChance = Math.min(0.95, displayModifiers.avoidAttackChance + AVOID_ATTACK_CHANCE_PER_CLASS * classUps);
    }
    if (displayModifiers.missingHealRate !== undefined) {
      modifiers.missingHealRate = Math.min(1, displayModifiers.missingHealRate + 0.015 * classUps);
    }
    if (displayModifiers.revengeThresholdRate !== undefined) {
      modifiers.revengeThresholdRate = Math.min(0.95, displayModifiers.revengeThresholdRate + 0.01 * classUps);
    }
    if (displayModifiers.revengeHits !== undefined) {
      modifiers.revengeHits = displayModifiers.revengeHits + Math.floor(classUps / 6);
    }
    modifiers.revengeDamage = scaleFlatDamage(displayModifiers.revengeDamage, multiplier);

    if (displayModifiers.ricochetCount !== undefined && definition.typeId === 'Druid' && boundedClassLevel >= 10) {
      modifiers.ricochetCount = displayModifiers.ricochetCount + 1;
    }

    const scaledSkill = { ...skill, modifiers: omitNullishModifiers(modifiers) };
    const descriptionSource = skill.descriptionLocked
      ? scaledSkill
      : { ...scaledSkill, description: sourceSkill?.description ?? skill.description };
    return {
      ...scaledSkill,
      description: getClassScaledSkillDescription(scaledDefinitionForDescription, descriptionSource, 1, source)
    };
  });

  const scaled = {
    ...definition,
    attack: scaleStatValue(definition.attack, 1, multiplier),
    health: scaleStatValue(definition.health, 1, multiplier),
    transformStats: definition.transformStats?.map((stats) => {
      if (!stats || typeof stats !== 'object') return stats;
      return {
        ...stats,
        attack: typeof stats.attack === 'number' && Number.isFinite(stats.attack) ? scaleStatValue(stats.attack, 1, multiplier) : undefined,
        health: typeof stats.health === 'number' && Number.isFinite(stats.health) ? scaleStatValue(stats.health, 1, multiplier) : undefined,
        skills: stats.skills?.map((skill) => {
          if (!skill || typeof skill !== 'object') return skill;
          const source = skill.modifiers ? omitNullishModifiers(skill.modifiers) : undefined;
          if (!source) return skill;
          const modifiers: DiceSkillModifier = { ...source };
          modifiers.splashDamage = scaleFlatDamage(source.splashDamage, multiplier);
          modifiers.heatwaveDamage = scaleFlatDamage(source.heatwaveDamage, multiplier);
          modifiers.chainDamage = scaleFlatDamage(source.chainDamage, multiplier);
          modifiers.poisonDamage = scaleFlatDamage(source.poisonDamage, multiplier);
          modifiers.activeDamage = scaleFlatDamage(source.activeDamage, multiplier);
          modifiers.activeHeal = scaleFlatDamage(source.activeHeal, multiplier);
          modifiers.meteorDamage = scaleFlatDamage(source.meteorDamage, multiplier);
          modifiers.nuclearDamage = scaleFlatDamage(source.nuclearDamage, multiplier);
          modifiers.lavaDamage = scaleFlatDamage(source.lavaDamage, multiplier);
          modifiers.beamDamage = scaleFlatDamage(source.beamDamage, multiplier);
          modifiers.pierceBehindDamage = scaleFlatDamage(source.pierceBehindDamage, multiplier);
          modifiers.hammerDamage = scaleFlatDamage(source.hammerDamage, multiplier);
          modifiers.bossDamage = scaleFlatDamage(source.bossDamage, multiplier);
          modifiers.revengeDamage = scaleFlatDamage(source.revengeDamage, multiplier);
          modifiers.shield = scaleFlatDamage(source.shield, multiplier);
          modifiers.transformAttackDamage = scaleFlatDamage(source.transformAttackDamage, multiplier);
          modifiers.damageRange = scaleDamageRange(source.damageRange, multiplier);
          const scaledSkill = { ...skill, modifiers: omitNullishModifiers(modifiers) };
          if (typeof skill.description !== 'string' || !skill.description.trim()) return scaledSkill;
          const descriptionDefinition: DiceDefinition = {
            ...definition,
            attack: scaleStatValue(definition.attack, 1, multiplier),
            health: scaleStatValue(definition.health, 1, multiplier)
          };
          return { ...scaledSkill, description: getClassScaledSkillDescription(descriptionDefinition, scaledSkill, 1, source) };
        })
      };
    }),
    skills
  };

  return scaled;
}

export function getClassScaledSkillDescription(definition: DiceDefinition, skill = definition.skills[0], skillDamageMultiplier = 1, sourceModifiers?: DiceSkillModifier): string {
  const modifiers = getModifier(skill);
  const description = skill?.description ?? '';
  const source = sourceModifiers ?? modifiers;
  let dynamicDescription = getDynamicSkillDescription(description, source, modifiers, skillDamageMultiplier);
  if (skill?.descriptionLocked === true && description.trim()) return dynamicDescription.trim() ? dynamicDescription : description;
  if (source.beamDamage === undefined && modifiers.beamDamage === undefined && (modifiers.hasBeam === true || /beam attacks?/i.test(description))) {
    const displayAttack = definition.attack;
    if (Number.isFinite(displayAttack)) {
      dynamicDescription = replaceLiteralNumber(dynamicDescription, 600, scaleDisplayDamage(displayAttack, skillDamageMultiplier));
    }
  }
  if (modifiers.ricochetCount !== undefined) {
    dynamicDescription = formatDruidRicochetDescriptor(dynamicDescription, modifiers.ricochetCount);
  }
  dynamicDescription = normalizeSingularUnits(dynamicDescription);
  if (dynamicDescription.trim() && dynamicDescription !== description) return dynamicDescription;
  if (definition.typeId === 'Solitude' && modifiers.targetMaxHpBonusRate !== undefined) {
    return `When no ally is adjacent to this dice, deals bonus damage equal to ${formatPercent(modifiers.targetMaxHpBonusRate)} of the target's max HP.`;
  }
  if (modifiers.targetMaxHpBonusRate !== undefined) {
    return `Deals bonus damage equal to ${formatPercent(modifiers.targetMaxHpBonusRate)} of the target's max HP.`;
  }
  if (modifiers.targetCurrentHpBonusRate !== undefined) {
    return `Deals bonus damage equal to ${formatPercent(modifiers.targetCurrentHpBonusRate)} of the target's current HP.`;
  }
  if (modifiers.lowHpThresholdRate !== undefined && modifiers.lowHpDamageBonusRate !== undefined) {
    return `Targeted foes below ${formatPercent(modifiers.lowHpThresholdRate)} of their max HP receive ${formatPercent(modifiers.lowHpDamageBonusRate)} more damage.`;
  }
  if (dynamicDescription.trim()) return dynamicDescription;

  if (modifiers.damageRange) {
    const min = scaleDisplayDamage(modifiers.damageRange[0], skillDamageMultiplier) ?? modifiers.damageRange[0];
    const max = scaleDisplayDamage(modifiers.damageRange[1], skillDamageMultiplier) ?? modifiers.damageRange[1];
    return `Deals random damage from ${formatValue(min)} to ${formatValue(max)} to a foe.`;
  }
  if (modifiers.splashDamage !== undefined) {
    return `Attacks cause ${formatValue(scaleDisplayDamage(modifiers.splashDamage, skillDamageMultiplier) ?? 0)} splash damage to adjacent foes on the target's board.`;
  }
  if (modifiers.chainDamage !== undefined) {
    const chainRange = modifiers.chainRange ?? 2;
    return `Attacks chain onto another foe on the target's board within ${formatValue(chainRange)} tiles for ${formatValue(scaleDisplayDamage(modifiers.chainDamage, skillDamageMultiplier) ?? 0)} bonus damage.`;
  }
  if (modifiers.activeHeal !== undefined) {
    return `Heals the weakest ally for ${formatValue(scaleDisplayDamage(modifiers.activeHeal, skillDamageMultiplier) ?? 0)} HP.`;
  }
  if (modifiers.activeDamage !== undefined && modifiers.attackDelta !== undefined) {
    return `Deals ${formatValue(scaleDisplayDamage(modifiers.activeDamage, skillDamageMultiplier) ?? 0)} damage and immediately changes the target's current attack count by ${formatValue(modifiers.attackDelta)} for ${formatValue(modifiers.statusDuration ?? 1)} turns.`;
  }
  if (modifiers.activeDamage !== undefined && modifiers.armorReduction !== undefined) {
    const shredRate = modifiers.armorReduction;
    return `Deal ${formatValue(scaleDisplayDamage(modifiers.activeDamage, skillDamageMultiplier) ?? 0)} damage and apply Fracture (${formatPercent(shredRate)} armor reduction) for ${formatValue(modifiers.statusDuration ?? 2)} turns.`;
  }
  if (modifiers.poisonDamage !== undefined) {
    return `Applies ${formatValue(scaleDisplayDamage(modifiers.poisonDamage, skillDamageMultiplier) ?? 0)} poison damage per turn for ${formatValue(modifiers.statusDuration ?? 3)} turns (stacks).`;
  }
  if (modifiers.berserkThresholdRate !== undefined && modifiers.berserkDamageMultiplier !== undefined) {
    return `Below ${formatPercent(modifiers.berserkThresholdRate)} HP, deals ${formatPercent(modifiers.berserkDamageMultiplier - 1)} more damage.`;
  }
  if (modifiers.shield !== undefined) {
    return `Gain +${formatValue(scaleDisplayDamage(modifiers.shield, skillDamageMultiplier) ?? 0)} shield for ${formatValue(modifiers.statusDuration ?? 2)} turns.`;
  }
  if (modifiers.numAttacksBoosted !== undefined && modifiers.numAttacksDamageMult !== undefined) {
    return `The next ${formatValue(modifiers.numAttacksBoosted)} basic attacks deal ${formatPercent(modifiers.numAttacksDamageMult - 1)} more damage.`;
  }
  if (modifiers.distanceDamageBonusRatePerTile !== undefined) {
    return `Deal +${formatPercent(modifiers.distanceDamageBonusRatePerTile)} damage for each tile of distance to the target.`;
  }
  if (modifiers.bonusDamagePerStatus !== undefined) {
    return `Gains +${formatPercent(modifiers.bonusDamagePerStatus)} damage for each active status stack on itself.`;
  }
  if (modifiers.soulBoostPercent !== undefined) {
    return `Conjures defeated ally souls. Soul Dice gains +${formatPercent(modifiers.soulBoostPercent)} damage and health for each soul conjured.`;
  }
  if (definition.typeId === 'Battery' && modifiers.allyManaGain !== undefined) {
    return `All friendly charging active skills gain +${formatValue(modifiers.allyManaGain)} mana.`;
  }
  if (modifiers.reviveChance !== undefined) {
    const chanceText = `starts at a ${formatPercent(modifiers.reviveChance)} chance`;
    const decayText = modifiers.reviveChanceRate !== undefined && modifiers.reviveChanceRate !== 1
      ? `, then changes by ×${formatValue(modifiers.reviveChanceRate)} after each successful revival`
      : '';
    const limitText = modifiers.maxRevives !== undefined ? `, up to ${formatValue(modifiers.maxRevives)} revivals` : '';
    const lastStandingText = modifiers.dontReviveWhenLastOneStanding ? ', but not when it is the last ally standing' : '';
    return `When defeated, it ${chanceText}${decayText}${limitText}${lastStandingText}.`;
  }

  return description;
}

export function getClassProgressionPreview(definition: DiceDefinition, classLevel: number): ClassProgressionPreview {
  const current = applyClassProgression(definition, classLevel);
  const next = applyClassProgression(definition, Math.min(MAX_CLASS_LEVEL, classLevel + 1));
  const currentModifiers = getCombinedModifiers(current);
  const nextModifiers = getCombinedModifiers(next);
  const skillDeltas: string[] = [];

  const pushNumericDelta = (label: string, currentValue: number | undefined, nextValue: number | undefined, suffix = '') => {
    if (currentValue === undefined || nextValue === undefined) return;
    const delta = nextValue - currentValue;
    if (delta > 0) {
      const displayDelta = Number.isInteger(delta) ? formatValue(delta) : formatValue(Number(delta.toFixed(1)));
      skillDeltas.push(`${label} +${displayDelta}${suffix}`);
    }
  };

  pushNumericDelta('Splash damage', currentModifiers.splashDamage, nextModifiers.splashDamage);
  pushNumericDelta('Chain damage', currentModifiers.chainDamage, nextModifiers.chainDamage);
  pushNumericDelta('Active damage', currentModifiers.activeDamage, nextModifiers.activeDamage);
  pushNumericDelta('Healing', currentModifiers.activeHeal, nextModifiers.activeHeal);
  pushNumericDelta('Poison damage', currentModifiers.poisonDamage, nextModifiers.poisonDamage);
  pushNumericDelta('Meteor damage', currentModifiers.meteorDamage, nextModifiers.meteorDamage);
  pushNumericDelta('Lava damage', currentModifiers.lavaDamage, nextModifiers.lavaDamage);
  pushNumericDelta('Beam damage', currentModifiers.beamDamage, nextModifiers.beamDamage);
  pushNumericDelta('Pierce damage', currentModifiers.pierceBehindDamage, nextModifiers.pierceBehindDamage);
  pushNumericDelta('Hammer damage', currentModifiers.hammerDamage, nextModifiers.hammerDamage);
  pushNumericDelta('Shield gain', currentModifiers.shield, nextModifiers.shield);
  pushNumericDelta('Transform attack damage', currentModifiers.transformAttackDamage, nextModifiers.transformAttackDamage);
  pushNumericDelta('Mana gain', currentModifiers.manaGain, nextModifiers.manaGain);
  pushNumericDelta('Ally mana gain', currentModifiers.allyManaGain, nextModifiers.allyManaGain);
  pushNumericDelta('Foe mana gain', currentModifiers.foeManaGain, nextModifiers.foeManaGain);
  pushNumericDelta('Mana steal', currentModifiers.manaSteal, nextModifiers.manaSteal);
  pushNumericDelta('Attack count', currentModifiers.numAttacksBoosted, nextModifiers.numAttacksBoosted);

  if (currentModifiers.damageRange && nextModifiers.damageRange) {
    const minDelta = nextModifiers.damageRange[0] - currentModifiers.damageRange[0];
    const maxDelta = nextModifiers.damageRange[1] - currentModifiers.damageRange[1];
    if (minDelta > 0 || maxDelta > 0) skillDeltas.push(`Random damage +${formatValue(minDelta)}/+${formatValue(maxDelta)}`);
  }
  if (currentModifiers.reviveChance !== undefined && nextModifiers.reviveChance !== undefined) {
    const delta = nextModifiers.reviveChance - currentModifiers.reviveChance;
    if (delta > 0) skillDeltas.push(`Revive chance +${formatPercent(delta)}`);
  }
  if (currentModifiers.distanceDamageBonusRatePerTile !== undefined && nextModifiers.distanceDamageBonusRatePerTile !== undefined) {
    const delta = nextModifiers.distanceDamageBonusRatePerTile - currentModifiers.distanceDamageBonusRatePerTile;
    if (delta > 0) skillDeltas.push(`Distance damage +${formatPercent(delta)} / tile`);
  }
  if (currentModifiers.bonusDamagePerStatus !== undefined && nextModifiers.bonusDamagePerStatus !== undefined) {
    const delta = nextModifiers.bonusDamagePerStatus - currentModifiers.bonusDamagePerStatus;
    if (delta > 0) skillDeltas.push(`Status damage +${formatPercent(delta)} / stack`);
  }
  if (currentModifiers.targetMaxHpBonusRate !== undefined && nextModifiers.targetMaxHpBonusRate !== undefined) {
    const delta = nextModifiers.targetMaxHpBonusRate - currentModifiers.targetMaxHpBonusRate;
    if (delta > 0) skillDeltas.push(`Max HP damage +${formatPercent(delta)}`);
  }
  if (currentModifiers.targetCurrentHpBonusRate !== undefined && nextModifiers.targetCurrentHpBonusRate !== undefined) {
    const delta = nextModifiers.targetCurrentHpBonusRate - currentModifiers.targetCurrentHpBonusRate;
    if (delta > 0) skillDeltas.push(`Current HP damage +${formatPercent(delta)}`);
  }
  if (currentModifiers.lowHpDamageBonusRate !== undefined && nextModifiers.lowHpDamageBonusRate !== undefined) {
    const delta = nextModifiers.lowHpDamageBonusRate - currentModifiers.lowHpDamageBonusRate;
    if (delta > 0) skillDeltas.push(`Low HP damage +${formatPercent(delta)}`);
  }
  if (currentModifiers.soulBoostPercent !== undefined && nextModifiers.soulBoostPercent !== undefined) {
    const delta = nextModifiers.soulBoostPercent - currentModifiers.soulBoostPercent;
    if (delta > 0) skillDeltas.push(`Soul health/damage boost +${formatPercent(delta)}`);
  }

  if (currentModifiers.armorReduction !== undefined && nextModifiers.armorReduction !== undefined && nextModifiers.armorReduction > currentModifiers.armorReduction) {
    skillDeltas.push(`Fracture armor reduction +${formatPercent(nextModifiers.armorReduction - currentModifiers.armorReduction)}`);
  }

  if (currentModifiers.berserkThresholdRate !== undefined && nextModifiers.berserkThresholdRate !== undefined) {
    const delta = nextModifiers.berserkThresholdRate - currentModifiers.berserkThresholdRate;
    if (delta > 0) skillDeltas.push(`Berserk threshold +${formatPercent(delta)}`);
  }
  
  if (currentModifiers.ricochetCount !== undefined && nextModifiers.ricochetCount !== undefined) {
    const ricochetDelta = nextModifiers.ricochetCount - currentModifiers.ricochetCount;
    if (ricochetDelta > 0) skillDeltas.push(`Ricochet count +${formatValue(ricochetDelta)}`);
  }

  return {
    attackDelta: next.attack - current.attack,
    healthDelta: next.health - current.health,
    skillDeltas
  };
}
