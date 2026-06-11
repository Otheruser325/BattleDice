import type { DiceDefinition, DiceSkillDefinition, DiceSkillModifier } from '../types/game';

export const MAX_CLASS_LEVEL = 15;
export const CLASS_UP_STAT_MULTIPLIER = 1.1;
export const BOSS_CLASS_STAT_MULTIPLIER = 1.2;
export const SKULL_REVIVE_CHANCE_PER_CLASS = 0.01;
export const SNIPER_DISTANCE_RATE_PER_CLASS = 0.005;
export const IRON_CURRENT_HP_RATE_PER_CLASS = 0.004;
export const BERSERK_THRESHOLD_RATE_PER_CLASS = 0.01;
export const SOLITUDE_MAX_HP_RATE_PER_CLASS = 0.002;
export const CRACK_ARMOR_SHRED_RATE_PER_CLASS = 0.01;
export const BATTERY_MANA_GAIN_PER_5_CLASS = 1;
export const SOUL_BOOST_RATIO_PER_CLASS = 0.005;
export const LOW_HP_DAMAGE_RATE_PER_CLASS = 0.02;

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
  return Number.isInteger(value) ? `${value}` : `${Number(value.toFixed(2))}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceLiteralNumber(text: string, sourceValue: number | undefined, displayValue: number | undefined): string {
  if (sourceValue === undefined || displayValue === undefined || !Number.isFinite(sourceValue) || !Number.isFinite(displayValue)) return text;
  const from = formatValue(sourceValue);
  const to = formatValue(displayValue);
  if (from === to) return text;
  return text.replace(new RegExp(`(^|[^\\d.])${escapeRegExp(from)}(?![\\d.])`, 'g'), `$1${to}`);
}

function replaceLiteralPercent(text: string, sourceValue: number | undefined, displayValue: number | undefined): string {
  if (sourceValue === undefined || displayValue === undefined || !Number.isFinite(sourceValue) || !Number.isFinite(displayValue)) return text;
  const from = formatPercent(sourceValue);
  const to = formatPercent(displayValue);
  if (from === to) return text;
  return text.replace(new RegExp(escapeRegExp(from), 'g'), to);
}

function replaceTurnCount(text: string, sourceValue: number | undefined, displayValue: number | undefined): string {
  if (sourceValue === undefined || displayValue === undefined || !Number.isFinite(sourceValue) || !Number.isFinite(displayValue)) return text;
  const from = formatValue(sourceValue);
  const to = formatValue(displayValue);
  if (from === to) return text;
  return text.replace(new RegExp(`(for\\s+)${escapeRegExp(from)}(\\s+turns?)`, 'gi'), `$1${to}$2`);
}

function scaleDisplayDamage(value: number | undefined, multiplier: number): number | undefined {
  return value === undefined ? undefined : Math.max(1, Math.round(value * Math.max(1, multiplier)));
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
    'lavaDamage',
    'beamDamage',
    'pierceBehindDamage',
    'hammerDamage',
    'shield'
  ];

  flatDamageKeys.forEach((key) => {
    const sourceValue = source[key];
    const displayValue = display[key];
    if (typeof sourceValue !== 'number' || typeof displayValue !== 'number') return;
    text = replaceLiteralNumber(text, sourceValue, scaleDisplayDamage(displayValue, skillDamageMultiplier));
  });

  text = replaceLiteralNumber(text, source.damageRange?.[0], scaleDisplayDamage(display.damageRange?.[0], skillDamageMultiplier));
  text = replaceLiteralNumber(text, source.damageRange?.[1], scaleDisplayDamage(display.damageRange?.[1], skillDamageMultiplier));
  text = replaceTurnCount(text, source.durationTurns, display.durationTurns);
  text = replaceLiteralNumber(text, Math.abs(source.attackDelta ?? Number.NaN), Math.abs(display.attackDelta ?? Number.NaN));
  text = replaceLiteralNumber(text, source.numAttacksBoosted, display.numAttacksBoosted);
  text = replaceLiteralNumber(text, source.manaGain, display.manaGain);
  text = replaceLiteralNumber(text, source.pierceBehindRange, display.pierceBehindRange);
  text = replaceLiteralNumber(text, source.allyExtraAttacks, display.allyExtraAttacks);
  text = replaceLiteralNumber(text, source.attackCountIncrease, display.attackCountIncrease);
  text = replaceLiteralNumber(text, source.growthDelta, display.growthDelta);
  text = replaceLiteralNumber(text, source.brokenGrowthDelta, display.brokenGrowthDelta);

  text = replaceLiteralPercent(text, source.reviveChance, display.reviveChance);
  text = replaceLiteralPercent(text, source.targetMaxHpBonusRate, display.targetMaxHpBonusRate);
  text = replaceLiteralPercent(text, source.targetCurrentHpBonusRate, display.targetCurrentHpBonusRate);
  text = replaceLiteralPercent(text, source.lowHpThresholdRate, display.lowHpThresholdRate);
  text = replaceLiteralPercent(text, source.lowHpDamageBonusRate, display.lowHpDamageBonusRate);
  text = replaceLiteralPercent(text, source.distanceDamageBonusRatePerTile, display.distanceDamageBonusRatePerTile);
  text = replaceLiteralPercent(text, source.berserkThresholdRate, display.berserkThresholdRate);
  text = replaceLiteralPercent(text, source.berserkDamageMultiplier !== undefined ? source.berserkDamageMultiplier - 1 : undefined, display.berserkDamageMultiplier !== undefined ? display.berserkDamageMultiplier - 1 : undefined);
  text = replaceLiteralPercent(text, source.soulBoostPercent, display.soulBoostPercent);
  text = replaceLiteralPercent(text, source.armorReduction, display.armorReduction);

  return text;
}

export function applyClassProgression(definition: DiceDefinition, classLevel: number): DiceDefinition {
  const boundedClassLevel = Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(classLevel)));
  const multiplier = isBossDefinition(definition)
    ? getBossClassMultiplier(boundedClassLevel)
    : getClassMultiplier(boundedClassLevel);
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
    modifiers.pierceBehindDamage = scaleFlatDamage(source.pierceBehindDamage, multiplier);
    modifiers.hammerDamage = scaleFlatDamage(source.hammerDamage, multiplier);
    modifiers.shield = scaleFlatDamage(source.shield, multiplier);
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

    if (source.lowHpDamageBonusRate !== undefined) {
      modifiers.lowHpDamageBonusRate = Math.min(0.78, source.lowHpDamageBonusRate + LOW_HP_DAMAGE_RATE_PER_CLASS * classUps);
    }

    if (definition.typeId === 'Berserk' && source.berserkThresholdRate !== undefined) {
      modifiers.berserkThresholdRate = Math.min(0.95, source.berserkThresholdRate + BERSERK_THRESHOLD_RATE_PER_CLASS * classUps);
    }

    if (source.checkForAdjacentAllies && source.targetMaxHpBonusRate !== undefined) {
      modifiers.targetMaxHpBonusRate = source.targetMaxHpBonusRate + SOLITUDE_MAX_HP_RATE_PER_CLASS * classUps;
    }

    if (definition.typeId === 'Assassin' && source.numAttacksBoosted !== undefined) {
      modifiers.numAttacksBoosted = source.numAttacksBoosted + Math.floor(classUps / 4);
    }

    const armorReduction = source.armorReduction ?? parseRuntimeRate(source.notes, 'runtime:armorShredRate=');
    if (armorReduction !== undefined) {
      modifiers.armorReduction = Math.min(0.95, armorReduction + CRACK_ARMOR_SHRED_RATE_PER_CLASS * classUps);
      modifiers.notes = (source.notes ?? []).filter((note) => !note.startsWith('runtime:armorShredRate='));
    }

    if (definition.typeId === 'Battery' && source.manaGain !== undefined) {
      modifiers.manaGain = source.manaGain + Math.floor(classUps / 5) * BATTERY_MANA_GAIN_PER_5_CLASS;
    }

    if (source.soulBoostPercent !== undefined) {
      modifiers.soulBoostPercent = source.soulBoostPercent + SNIPER_DISTANCE_RATE_PER_CLASS * classUps;
    }

    if ((definition.typeId === 'Magician' || definition.typeId === 'Wizard') && source.manaGain !== undefined) {
      modifiers.manaGain = source.manaGain + Math.floor(classUps / 4);
    }

    if (definition.typeId === 'Magician' && source.attackDelta !== undefined) {
      modifiers.attackDelta = source.attackDelta + Math.floor(classUps / 5);
    }

    if (definition.typeId === 'Magician' && source.durationTurns !== undefined) {
      modifiers.durationTurns = source.durationTurns + Math.floor(classUps / 4);
    }

    if (definition.typeId === 'Leon' && source.targetMaxHpBonusRate !== undefined) {
      modifiers.targetMaxHpBonusRate = source.targetMaxHpBonusRate + 0.02 * classUps;
    }

    const scaledSkill = { ...skill, modifiers };
    return {
      ...scaledSkill,
      description: getClassScaledSkillDescription(definition, scaledSkill, 1, source)
    };
  });

  const scaled = {
    ...definition,
    attack: Math.max(1, Math.round(definition.attack * multiplier)),
    health: Math.max(1, Math.round(definition.health * multiplier)),
    skills
  };

  return scaled;
}

export function getClassScaledSkillDescription(definition: DiceDefinition, skill = definition.skills[0], skillDamageMultiplier = 1, sourceModifiers?: DiceSkillModifier): string {
  const modifiers = getModifier(skill);
  const description = skill?.description ?? '';
  const dynamicDescription = getDynamicSkillDescription(description, sourceModifiers ?? modifiers, modifiers, skillDamageMultiplier);
  if (dynamicDescription.trim() && dynamicDescription !== description) return dynamicDescription;
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
    return `Deals random damage from ${min} to ${max} to a foe.`;
  }
  if (modifiers.splashDamage !== undefined) {
    return `Attacks cause ${scaleDisplayDamage(modifiers.splashDamage, skillDamageMultiplier)} splash damage to adjacent foes on the target's board.`;
  }
  if (modifiers.chainDamage !== undefined) {
    return `Attacks chain onto another foe on the target's board within 2 tiles for ${scaleDisplayDamage(modifiers.chainDamage, skillDamageMultiplier)} bonus damage.`;
  }
  if (modifiers.activeHeal !== undefined) {
    return `Heals the weakest ally for ${scaleDisplayDamage(modifiers.activeHeal, skillDamageMultiplier)} HP.`;
  }
  if (modifiers.activeDamage !== undefined && modifiers.attackDelta !== undefined) {
    return `Deals ${scaleDisplayDamage(modifiers.activeDamage, skillDamageMultiplier)} damage and immediately changes the target's current attack count by ${modifiers.attackDelta} for ${modifiers.durationTurns ?? 1} turns.`;
  }
  if (modifiers.activeDamage !== undefined && modifiers.armorReduction !== undefined) {
    const shredRate = modifiers.armorReduction;
    return `Deal ${scaleDisplayDamage(modifiers.activeDamage, skillDamageMultiplier)} damage and apply Fracture (${formatPercent(shredRate)} armor reduction) for ${modifiers.durationTurns ?? 2} turns.`;
  }
  if (modifiers.poisonDamage !== undefined) {
    return `Applies ${scaleDisplayDamage(modifiers.poisonDamage, skillDamageMultiplier)} poison damage per turn for ${modifiers.durationTurns ?? 3} turns (stacks).`;
  }
  if (modifiers.berserkThresholdRate !== undefined && modifiers.berserkDamageMultiplier !== undefined) {
    return `Below ${formatPercent(modifiers.berserkThresholdRate)} HP, deals ${formatPercent(modifiers.berserkDamageMultiplier - 1)} more damage.`;
  }
  if (modifiers.shield !== undefined) {
    return `Gain +${scaleDisplayDamage(modifiers.shield, skillDamageMultiplier)} shield for ${modifiers.durationTurns ?? 2} turns.`;
  }
  if (modifiers.numAttacksBoosted !== undefined && modifiers.numAttacksDamageMult !== undefined) {
    return `The next ${modifiers.numAttacksBoosted} basic attacks deal ${formatPercent(modifiers.numAttacksDamageMult - 1)} more damage.`;
  }
  if (modifiers.distanceDamageBonusRatePerTile !== undefined) {
    return `Deal +${formatPercent(modifiers.distanceDamageBonusRatePerTile)} damage for each tile of distance to the target.`;
  }
  if (modifiers.soulBoostPercent !== undefined) {
    return `Conjures defeated ally souls. Soul Dice gains +${formatPercent(modifiers.soulBoostPercent)} damage and health for each soul conjured.`;
  }
  if (definition.typeId === 'Battery' && modifiers.manaGain !== undefined) {
    return `All friendly charging active skills gain +${modifiers.manaGain} mana.`;
  }
  if (modifiers.reviveChance !== undefined) {
    return `When defeated, it comes back to life with a ${formatPercent(modifiers.reviveChance)} chance.`;
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
  pushNumericDelta('Pierce damage', currentModifiers.pierceBehindDamage, nextModifiers.pierceBehindDamage);
  pushNumericDelta('Hammer damage', currentModifiers.hammerDamage, nextModifiers.hammerDamage);
  pushNumericDelta('Shield gain', currentModifiers.shield, nextModifiers.shield);
  pushNumericDelta('Mana gain', currentModifiers.manaGain, nextModifiers.manaGain);
  pushNumericDelta('Attack count', currentModifiers.numAttacksBoosted, nextModifiers.numAttacksBoosted);

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

  return {
    attackDelta: next.attack - current.attack,
    healthDelta: next.health - current.health,
    skillDeltas
  };
}
