import type { DiceDefinition, DiceSkillDefinition, DiceSkillModifier } from '../types/game';

export const MAX_CLASS_LEVEL = 15;
export const CLASS_UP_STAT_MULTIPLIER = 1.1;
export const SKULL_REVIVE_CHANCE_PER_CLASS = 0.01;
export const SNIPER_DISTANCE_RATE_PER_CLASS = 0.005;
export const IRON_CURRENT_HP_RATE_PER_CLASS = 0.005;
export const BERSERK_THRESHOLD_RATE_PER_CLASS = 0.01;

export interface ClassProgressionPreview {
  attackDelta: number;
  healthDelta: number;
  skillDeltas: string[];
}

export function getClassMultiplier(classLevel: number): number {
  return CLASS_UP_STAT_MULTIPLIER ** Math.max(0, Math.min(MAX_CLASS_LEVEL, classLevel) - 1);
}

function formatPercent(rate: number): string {
  const pct = rate * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

function scaleFlatDamage(value: number | undefined, multiplier: number): number | undefined {
  return value === undefined ? undefined : Math.max(1, Math.round(value * multiplier));
}

function scaleDamageRange(range: [number, number] | undefined, multiplier: number): [number, number] | undefined {
  return range ? [Math.max(1, Math.round(range[0] * multiplier)), Math.max(1, Math.round(range[1] * multiplier))] : undefined;
}

function getModifier(skill: DiceSkillDefinition | undefined): DiceSkillModifier {
  return (skill?.modifiers ?? {}) as DiceSkillModifier;
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
    modifiers.activeHeal = scaleFlatDamage(source.activeHeal, multiplier);
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

    if (definition.typeId === 'Berserk' && source.berserkThresholdRate !== undefined) {
      modifiers.berserkThresholdRate = Math.min(0.95, source.berserkThresholdRate + BERSERK_THRESHOLD_RATE_PER_CLASS * classUps);
    }

    return { ...skill, modifiers };
  });

  const scaled = {
    ...definition,
    attack: Math.max(1, Math.round(definition.attack * multiplier)),
    health: Math.max(1, Math.round(definition.health * multiplier)),
    skills
  };

  return {
    ...scaled,
    skills: scaled.skills.map((skill) => ({
      ...skill,
      description: getClassScaledSkillDescription(scaled, skill)
    }))
  };
}

export function getClassScaledSkillDescription(definition: DiceDefinition, skill = definition.skills[0]): string {
  const modifiers = getModifier(skill);
  const notes = modifiers.notes ?? [];

  if (modifiers.damageRange) {
    return `Deals random damage from ${modifiers.damageRange[0]} to ${modifiers.damageRange[1]} to a foe.`;
  }
  if (modifiers.splashDamage !== undefined) {
    return `Attacks cause ${modifiers.splashDamage} splash damage to adjacent foes.`;
  }
  if (modifiers.chainDamage !== undefined) {
    return `Attacks chain onto a nearby target in a 2-tile radius for ${modifiers.chainDamage} bonus damage.`;
  }
  if (modifiers.activeHeal !== undefined) {
    return `Heals the weakest ally for ${modifiers.activeHeal} HP.`;
  }
  if (modifiers.activeDamage !== undefined && modifiers.attackDelta !== undefined) {
    return `Deals ${modifiers.activeDamage} damage and immediately reduces the target's current attack count by ${Math.abs(modifiers.attackDelta)} for ${modifiers.durationTurns ?? 1} turns, never below 1.`;
  }
  if (modifiers.poisonDamage !== undefined) {
    return `The targeted foe takes ${modifiers.poisonDamage} poison damage per turn for ${modifiers.durationTurns ?? 2} turns.`;
  }
  if (notes.includes('runtime:meteorStrike') && modifiers.meteorDamage !== undefined && modifiers.lavaDamage !== undefined) {
    return `Throws a striking meteor at a random foe, causing ${modifiers.meteorDamage} damage. Drops a lava pool on the hit tile lasting 3 turns. Foes standing on a lava tile take ${modifiers.lavaDamage} damage at the start of combat.`;
  }
  if (notes.includes('runtime:hasTranscendence') && modifiers.beamDamage !== undefined) {
    return `If it rolls 6, transforms into The Transcendence and beam attacks consume all remaining attacks to strike through the target row/column for ${modifiers.beamDamage} damage.`;
  }
  if (modifiers.berserkThresholdRate !== undefined && modifiers.berserkDamageMultiplier !== undefined) {
    return `Below ${formatPercent(modifiers.berserkThresholdRate)} HP, deals ${formatPercent(modifiers.berserkDamageMultiplier - 1)} more damage.`;
  }
  if (modifiers.targetCurrentHpBonusRate !== undefined) {
    return `Deals bonus damage equal to ${formatPercent(modifiers.targetCurrentHpBonusRate)} of the target's current HP.`;
  }
  if (modifiers.distanceDamageBonusRatePerTile !== undefined) {
    return `Deal +${formatPercent(modifiers.distanceDamageBonusRatePerTile)} damage for each tile of distance to the target.`;
  }
  if (modifiers.reviveChance !== undefined) {
    return `When defeated, it comes back to life with a ${formatPercent(modifiers.reviveChance)} chance.`;
  }

  return skill?.description ?? '';
}

export function getClassProgressionPreview(definition: DiceDefinition, classLevel: number): ClassProgressionPreview {
  const current = applyClassProgression(definition, classLevel);
  const next = applyClassProgression(definition, Math.min(MAX_CLASS_LEVEL, classLevel + 1));
  const currentModifiers = getModifier(current.skills[0]);
  const nextModifiers = getModifier(next.skills[0]);
  const skillDeltas: string[] = [];

  const pushNumericDelta = (label: string, currentValue: number | undefined, nextValue: number | undefined, suffix = '') => {
    if (currentValue === undefined || nextValue === undefined) return;
    const delta = nextValue - currentValue;
    if (delta > 0) skillDeltas.push(`${label} +${Number.isInteger(delta) ? delta : delta.toFixed(1)}${suffix}`);
  };

  pushNumericDelta('Splash damage', currentModifiers.splashDamage, nextModifiers.splashDamage);
  pushNumericDelta('Chain damage', currentModifiers.chainDamage, nextModifiers.chainDamage);
  pushNumericDelta('Active damage', currentModifiers.activeDamage, nextModifiers.activeDamage);
  pushNumericDelta('Healing', currentModifiers.activeHeal, nextModifiers.activeHeal);
  pushNumericDelta('Poison damage', currentModifiers.poisonDamage, nextModifiers.poisonDamage);
  pushNumericDelta('Meteor damage', currentModifiers.meteorDamage, nextModifiers.meteorDamage);
  pushNumericDelta('Lava damage', currentModifiers.lavaDamage, nextModifiers.lavaDamage);
  pushNumericDelta('Beam damage', currentModifiers.beamDamage, nextModifiers.beamDamage);

  if (currentModifiers.damageRange && nextModifiers.damageRange) {
    const minDelta = nextModifiers.damageRange[0] - currentModifiers.damageRange[0];
    const maxDelta = nextModifiers.damageRange[1] - currentModifiers.damageRange[1];
    if (minDelta > 0 || maxDelta > 0) skillDeltas.push(`Random damage +${minDelta}/+${maxDelta}`);
  }
  if (currentModifiers.reviveChance !== undefined && nextModifiers.reviveChance !== undefined) {
    const delta = nextModifiers.reviveChance - currentModifiers.reviveChance;
    if (delta > 0) skillDeltas.push(`Revive chance +${formatPercent(delta)}`);
  }
  if (currentModifiers.distanceDamageBonusRatePerTile !== undefined && nextModifiers.distanceDamageBonusRatePerTile !== undefined) {
    const delta = nextModifiers.distanceDamageBonusRatePerTile - currentModifiers.distanceDamageBonusRatePerTile;
    if (delta > 0) skillDeltas.push(`Distance damage +${formatPercent(delta)} / tile`);
  }
  if (currentModifiers.targetCurrentHpBonusRate !== undefined && nextModifiers.targetCurrentHpBonusRate !== undefined) {
    const delta = nextModifiers.targetCurrentHpBonusRate - currentModifiers.targetCurrentHpBonusRate;
    if (delta > 0) skillDeltas.push(`Current HP damage +${formatPercent(delta)}`);
  }
  if (currentModifiers.berserkThresholdRate !== undefined && nextModifiers.berserkThresholdRate !== undefined) {
    const delta = nextModifiers.berserkThresholdRate - currentModifiers.berserkThresholdRate;
    if (delta > 0) skillDeltas.push(`Berserk threshold +${formatPercent(delta)}`);
  }

  return {
    attackDelta: next.attack - current.attack,
    healthDelta: next.health - current.health,
    skillDeltas
  };
}
