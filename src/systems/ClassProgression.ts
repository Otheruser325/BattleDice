import type { DiceDefinition, DiceSkillModifier } from '../types/game';

export const MAX_CLASS_LEVEL = 15;
export const CLASS_UP_STAT_MULTIPLIER = 1.1;
export const SKULL_REVIVE_CHANCE_PER_CLASS = 0.01;
export const SNIPER_DISTANCE_RATE_PER_CLASS = 0.005;
export const IRON_CURRENT_HP_RATE_PER_CLASS = 0.005;

export function getClassMultiplier(classLevel: number): number {
  return CLASS_UP_STAT_MULTIPLIER ** Math.max(0, Math.min(MAX_CLASS_LEVEL, classLevel) - 1);
}

function scaleFlatDamage(value: number | undefined, multiplier: number): number | undefined {
  return value === undefined ? undefined : Math.max(1, Math.round(value * multiplier));
}

function scaleDamageRange(range: [number, number] | undefined, multiplier: number): [number, number] | undefined {
  return range ? [Math.max(1, Math.round(range[0] * multiplier)), Math.max(1, Math.round(range[1] * multiplier))] : undefined;
}

export function applyClassProgression(definition: DiceDefinition, classLevel: number): DiceDefinition {
  const boundedClassLevel = Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(classLevel)));
  const multiplier = getClassMultiplier(boundedClassLevel);
  const classUps = boundedClassLevel - 1;

  const skills = definition.skills.map((skill) => {
    const source = skill.modifiers as DiceSkillModifier | undefined;
    if (!source) return skill;

    const modifiers: DiceSkillModifier = { ...source };
    modifiers.splashDamage = scaleFlatDamage(source.splashDamage, multiplier);
    modifiers.chainDamage = scaleFlatDamage(source.chainDamage, multiplier);
    modifiers.poisonDamage = scaleFlatDamage(source.poisonDamage, multiplier);
    modifiers.activeDamage = scaleFlatDamage(source.activeDamage, multiplier);
    modifiers.meteorDamage = scaleFlatDamage(source.meteorDamage, multiplier);
    modifiers.lavaDamage = scaleFlatDamage(source.lavaDamage, multiplier);
    modifiers.beamDamage = scaleFlatDamage(source.beamDamage, multiplier);
    modifiers.damageRange = scaleDamageRange(source.damageRange, multiplier);

    if (definition.typeId === 'Skull' && source.reviveChance !== undefined) {
      modifiers.reviveChance = Math.min(0.95, source.reviveChance + SKULL_REVIVE_CHANCE_PER_CLASS * classUps);
    }

    if (definition.typeId === 'Sniper' && source.distanceDamageBonusRatePerTile !== undefined) {
      modifiers.distanceDamageBonusRatePerTile = source.distanceDamageBonusRatePerTile + SNIPER_DISTANCE_RATE_PER_CLASS * classUps;
    }

    if (definition.typeId === 'Iron' && source.targetCurrentHpBonusRate !== undefined) {
      modifiers.targetCurrentHpBonusRate = source.targetCurrentHpBonusRate + IRON_CURRENT_HP_RATE_PER_CLASS * classUps;
    }

    return { ...skill, modifiers };
  });

  return {
    ...definition,
    attack: Math.max(1, Math.round(definition.attack * multiplier)),
    health: Math.max(1, Math.round(definition.health * multiplier)),
    skills
  };
}
