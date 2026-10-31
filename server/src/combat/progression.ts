import type { DiceDefinition, DiceSkillDefinition, SkillModifiers } from './types.js';

const MAX_CLASS_LEVEL = 15;
const DEFAULT_TALENT_CLASS_NEEDED = 9;
const CLASS_UP_STAT_MULTIPLIER = 1.1;
const BOSS_CLASS_STAT_MULTIPLIER = 1.2;
const ROOT_TALENT_KEYS = new Set([
  'attackDelta',
  'healthDelta',
  'attackMultiplier',
  'healthMultiplier',
  'rangeDelta',
  'targetingMode',
  'skills'
]);

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function scaleFlat(value: unknown, multiplier: number): number | undefined {
  const resolved = numberValue(value);
  return resolved === undefined ? undefined : Math.max(1, Math.round(resolved * multiplier));
}

function scaleRange(value: unknown, multiplier: number): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const min = numberValue(value[0]);
  const max = numberValue(value[1]);
  if (min === undefined || max === undefined) return undefined;
  return [Math.max(1, Math.round(min * multiplier)), Math.max(1, Math.round(max * multiplier))];
}

function cloneSkill(skill: DiceSkillDefinition): DiceSkillDefinition {
  return {
    ...skill,
    modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers
  };
}

function definedFields(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function mergeTalentSkills(
  baseSkills: DiceSkillDefinition[],
  overlay: unknown
): DiceSkillDefinition[] {
  const merged = baseSkills.map(cloneSkill);
  if (!Array.isArray(overlay)) return merged;
  overlay.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || index > merged.length) return;
    const row = entry as DiceSkillDefinition;
    if (Object.keys(row).length === 0) return;
    const current = merged[index];
    merged[index] = current
      ? {
          ...current,
          ...definedFields(row as unknown as Record<string, unknown>),
          modifiers: {
            ...(current.modifiers ?? {}),
            ...definedFields(row.modifiers as unknown as Record<string, unknown> | undefined)
          }
        }
      : cloneSkill(row);
  });
  return merged.filter((skill) => skill.disableSkill !== true);
}

function getTalentClassNeeded(talent: { classNeeded?: number }): number {
  const value = talent.classNeeded;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_CLASS_LEVEL
    ? value
    : DEFAULT_TALENT_CLASS_NEEDED;
}

export function applyTalent(
  definition: DiceDefinition,
  talentIndex: number | null,
  classLevel: number
): DiceDefinition {
  if (definition.talentsComingSoon === true || talentIndex === null) return definition;
  const talent = definition.talents?.[talentIndex];
  if (!talent || talent.comingSoon === true || classLevel < getTalentClassNeeded(talent)) return definition;
  const modifiers = talent.modifiers && typeof talent.modifiers === 'object' && !Array.isArray(talent.modifiers)
    ? talent.modifiers
    : {};
  const skillOverlay = modifiers.skills;
  const rootModifiers = Object.fromEntries(
    Object.entries(modifiers).filter(([key, value]) => !ROOT_TALENT_KEYS.has(key) && value !== undefined && value !== null)
  ) as SkillModifiers;
  const skills = mergeTalentSkills(definition.skills, skillOverlay).map((skill) => (
    Object.keys(rootModifiers).length > 0
      ? { ...skill, modifiers: { ...(skill.modifiers ?? {}), ...rootModifiers } }
      : skill
  ));
  const attackDelta = numberValue(modifiers.attackDelta) ?? 0;
  const healthDelta = numberValue(modifiers.healthDelta) ?? 0;
  const attackMultiplier = numberValue(modifiers.attackMultiplier) ?? 1;
  const healthMultiplier = numberValue(modifiers.healthMultiplier) ?? 1;
  const rangeDelta = numberValue(modifiers.rangeDelta) ?? 0;
  return {
    ...definition,
    attack: Math.max(1, Math.round((definition.attack + attackDelta) * attackMultiplier)),
    health: Math.max(1, Math.round((definition.health + healthDelta) * healthMultiplier)),
    range: Math.max(0, definition.range + rangeDelta),
    targetingMode: (modifiers.targetingMode as DiceDefinition['targetingMode'] | undefined) ?? definition.targetingMode,
    skills
  };
}

export function applyClassProgression(definition: DiceDefinition, classLevel: number): DiceDefinition {
  const level = Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(classLevel)));
  const classUps = level - 1;
  const multiplier = (definition.isBoss === true ? BOSS_CLASS_STAT_MULTIPLIER : CLASS_UP_STAT_MULTIPLIER) ** classUps;
  const scaleModifiers = (source: SkillModifiers): SkillModifiers => {
    const modifiers: SkillModifiers = { ...source };
    for (const key of [
      'splashDamage',
      'heatwaveDamage',
      'chainDamage',
      'poisonDamage',
      'activeDamage',
      'activeHeal',
      'meteorDamage',
      'lavaDamage',
      'beamDamage',
      'pierceBehindDamage',
      'hammerDamage',
      'bossDamage',
      'revengeDamage',
      'shield',
      'transformAttackDamage'
    ]) {
      const scaled = scaleFlat(source[key], multiplier);
      if (scaled !== undefined) modifiers[key] = scaled;
    }
    const range = scaleRange(source.damageRange, multiplier);
    if (range) modifiers.damageRange = range;

    if (definition.typeId === 'Skull' && numberValue(source.reviveChance) !== undefined) {
      modifiers.reviveChance = Math.min(1, (numberValue(source.reviveChance) ?? 0) + 0.01 * classUps);
    }
    if (definition.typeId === 'Sniper' && numberValue(source.distanceDamageBonusRatePerTile) !== undefined) {
      modifiers.distanceDamageBonusRatePerTile = (numberValue(source.distanceDamageBonusRatePerTile) ?? 0) + 0.005 * classUps;
    }
    if (definition.typeId === 'Discharge' && numberValue(source.bonusDamagePerStatus) !== undefined) {
      modifiers.bonusDamagePerStatus = (numberValue(source.bonusDamagePerStatus) ?? 0) + 0.005 * classUps;
    }
    if (definition.typeId === 'Iron' && numberValue(source.targetCurrentHpBonusRate) !== undefined) {
      modifiers.targetCurrentHpBonusRate = (numberValue(source.targetCurrentHpBonusRate) ?? 0) + 0.004 * classUps;
    }
    if (numberValue(source.lowHpDamageBonusRate) !== undefined) {
      modifiers.lowHpDamageBonusRate = Math.min(0.78, (numberValue(source.lowHpDamageBonusRate) ?? 0) + 0.02 * classUps);
    }
    if (definition.typeId === 'Berserk' && numberValue(source.berserkThresholdRate) !== undefined) {
      modifiers.berserkThresholdRate = Math.min(0.95, (numberValue(source.berserkThresholdRate) ?? 0) + 0.01 * classUps);
    }
    if (source.checkForAdjacentAllies === true && numberValue(source.targetMaxHpBonusRate) !== undefined) {
      modifiers.targetMaxHpBonusRate = (numberValue(source.targetMaxHpBonusRate) ?? 0) + 0.002 * classUps;
    }
    if (definition.typeId === 'Assassin' && numberValue(source.numAttacksBoosted) !== undefined) {
      modifiers.numAttacksBoosted = (numberValue(source.numAttacksBoosted) ?? 0) + Math.floor(classUps / 4);
    }
    if (numberValue(source.armorReduction) !== undefined) {
      modifiers.armorReduction = Math.min(0.95, (numberValue(source.armorReduction) ?? 0) + 0.01 * classUps);
    }
    if (definition.typeId === 'Battery' && numberValue(source.allyManaGain) !== undefined) {
      modifiers.allyManaGain = (numberValue(source.allyManaGain) ?? 0) + Math.floor(classUps / 5);
    }
    if ((definition.typeId === 'Magician' || definition.typeId === 'Wizard') && numberValue(source.allyManaGain) !== undefined) {
      modifiers.allyManaGain = (numberValue(source.allyManaGain) ?? 0) + Math.floor(classUps / 4);
    }
    if (definition.typeId === 'Magician' && numberValue(source.manaSteal) !== undefined) {
      modifiers.manaSteal = (numberValue(source.manaSteal) ?? 0) + Math.floor(classUps / 5);
    }
    if (definition.typeId === 'Magician' && numberValue(source.statusDuration) !== undefined) {
      modifiers.statusDuration = (numberValue(source.statusDuration) ?? 0) + Math.floor(classUps / 4);
    }
    if (numberValue(source.avoidAttackChance) !== undefined) {
      modifiers.avoidAttackChance = Math.min(0.95, (numberValue(source.avoidAttackChance) ?? 0) + 0.03 * classUps);
    }
    if (numberValue(source.missingHealRate) !== undefined) {
      modifiers.missingHealRate = Math.min(1, (numberValue(source.missingHealRate) ?? 0) + 0.015 * classUps);
    }
    if (numberValue(source.revengeThresholdRate) !== undefined) {
      modifiers.revengeThresholdRate = Math.min(0.95, (numberValue(source.revengeThresholdRate) ?? 0) + 0.01 * classUps);
    }
    if (numberValue(source.revengeHits) !== undefined) {
      modifiers.revengeHits = (numberValue(source.revengeHits) ?? 0) + Math.floor(classUps / 6);
    }
    if (definition.typeId === 'Druid' && numberValue(source.ricochetCount) !== undefined && level >= 10) {
      modifiers.ricochetCount = (numberValue(source.ricochetCount) ?? 0) + 1;
    }
    return modifiers;
  };

  return {
    ...definition,
    attack: Math.max(1, Math.round(definition.attack * multiplier)),
    health: Math.max(1, Math.round(definition.health * multiplier)),
    skills: definition.skills.map((skill) => ({
      ...skill,
      modifiers: skill.modifiers ? scaleModifiers(skill.modifiers) : skill.modifiers
    })),
    transformStats: definition.transformStats?.map((stats) => ({
      ...stats,
      attack: stats.attack === undefined ? undefined : Math.max(1, Math.round(stats.attack * multiplier)),
      health: stats.health === undefined ? undefined : Math.max(1, Math.round(stats.health * multiplier)),
      skills: Array.isArray(stats.skills)
        ? stats.skills.map((skill) => (
            skill && skill.modifiers ? { ...skill, modifiers: scaleModifiers(skill.modifiers) } : skill
          ))
        : stats.skills
    }))
  };
}

export function buildCombatDefinition(
  definition: DiceDefinition,
  classLevel: number,
  talentIndex: number | null,
  useLevelling: boolean
): DiceDefinition {
  const effectiveLevel = useLevelling ? Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(classLevel))) : 1;
  return applyClassProgression(applyTalent(definition, talentIndex, effectiveLevel), effectiveLevel);
}
