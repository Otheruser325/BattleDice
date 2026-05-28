import type { DiceDefinition, DiceSkillDefinition, DiceSkillModifier } from '../types/game';

export const MAX_CLASS_LEVEL = 15;
export const CLASS_UP_STAT_MULTIPLIER = 1.1;
export const BOSS_CLASS_STAT_MULTIPLIER = 1.2;
export const SKULL_REVIVE_CHANCE_PER_CLASS = 0.01;
export const SNIPER_DISTANCE_RATE_PER_CLASS = 0.005;
export const IRON_CURRENT_HP_RATE_PER_CLASS = 0.005;
export const BERSERK_THRESHOLD_RATE_PER_CLASS = 0.01;
export const SOLITUDE_MAX_HP_RATE_PER_CLASS = 0.0025;
export const CRACK_ARMOR_SHRED_RATE_PER_CLASS = 0.01;
export const BATTERY_MANA_GAIN_PER_5_CLASS = 1;

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

function isBossOrMinionDefinition(definition: DiceDefinition): boolean {
  return ['Deucifer', 'Imp', 'Magician', 'Wizard', 'Leon'].includes(definition.typeId);
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

export function applyClassProgression(definition: DiceDefinition, classLevel: number): DiceDefinition {
  const boundedClassLevel = Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(classLevel)));
  const multiplier = isBossOrMinionDefinition(definition)
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

    if (definition.typeId === 'Berserk' && source.berserkThresholdRate !== undefined) {
      modifiers.berserkThresholdRate = Math.min(0.95, source.berserkThresholdRate + BERSERK_THRESHOLD_RATE_PER_CLASS * classUps);
    }

    if (definition.typeId === 'Solitude' && source.targetMaxHpBonusRate !== undefined) {
      modifiers.targetMaxHpBonusRate = source.targetMaxHpBonusRate + SOLITUDE_MAX_HP_RATE_PER_CLASS * classUps;
    }

    if (definition.typeId === 'Assassin' && source.numAttacksBoosted !== undefined) {
      modifiers.numAttacksBoosted = source.numAttacksBoosted + Math.floor(classUps / 4);
    }

    if (definition.typeId === 'Crack' && source.notes?.some((note) => note.startsWith('runtime:armorShredRate='))) {
      const base = source.notes.find((note) => note.startsWith('runtime:armorShredRate='));
      const parsed = base ? Number(base.split('=')[1]) : 0;
      if (Number.isFinite(parsed)) {
        const nextRate = Math.min(0.95, parsed + CRACK_ARMOR_SHRED_RATE_PER_CLASS * classUps);
        modifiers.notes = (source.notes ?? []).filter((note) => !note.startsWith('runtime:armorShredRate='));
        modifiers.notes.push(`runtime:armorShredRate=${nextRate.toFixed(2)}`);
      }
    }

    if (definition.typeId === 'Battery' && source.manaGain !== undefined) {
      modifiers.manaGain = source.manaGain + Math.floor(classUps / 5) * BATTERY_MANA_GAIN_PER_5_CLASS;
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

export function getClassScaledSkillDescription(definition: DiceDefinition, skill = definition.skills[0], skillDamageMultiplier = 1): string {
  const modifiers = getModifier(skill);
  const notes = modifiers.notes ?? [];
  const scaleSkillDamage = (value: number | undefined) => value === undefined ? undefined : Math.max(1, Math.round(value * Math.max(1, skillDamageMultiplier)));

  if (modifiers.damageRange) {
    const min = scaleSkillDamage(modifiers.damageRange[0]) ?? modifiers.damageRange[0];
    const max = scaleSkillDamage(modifiers.damageRange[1]) ?? modifiers.damageRange[1];
    return `Deals random damage from ${min} to ${max} to a foe.`;
  }
  if (modifiers.splashDamage !== undefined) {
    return `Attacks cause ${scaleSkillDamage(modifiers.splashDamage)} splash damage to adjacent foes.`;
  }
  if (modifiers.chainDamage !== undefined) {
    return `Attacks chain onto a nearby target in a 2-tile radius for ${scaleSkillDamage(modifiers.chainDamage)} bonus damage.`;
  }
  if (modifiers.activeHeal !== undefined) {
    return `Heals the weakest ally for ${scaleSkillDamage(modifiers.activeHeal)} HP.`;
  }
  if (notes.includes('runtime:spearActive') && modifiers.activeDamage !== undefined && modifiers.pierceBehindDamage !== undefined) {
    return `Sends in a charged spear that deals ${scaleSkillDamage(modifiers.activeDamage)} damage to its target, then ${scaleSkillDamage(modifiers.pierceBehindDamage)} damage behind it with extended range.`;
  }
  if (notes.includes('runtime:judgmentHammer') && modifiers.hammerDamage !== undefined) {
    return `Summons a judge hammer on the weakest foe for ${scaleSkillDamage(modifiers.hammerDamage)} damage in a 3x3 radius. Hammer kills can retrigger this effect.`;
  }
  if (notes.includes('runtime:solitudePreCombat') && modifiers.targetMaxHpBonusRate !== undefined) {
    return `When isolated from adjacent allies, basic attacks deal bonus damage equal to ${formatPercent(modifiers.targetMaxHpBonusRate)} of the target's max HP.`;
  }
  if (notes.includes('runtime:pierceBehind=1') && modifiers.pierceBehindRange !== undefined) {
    return `Basic attacks also stab ${modifiers.pierceBehindRange} tile behind the target.`;
  }
  if (modifiers.activeDamage !== undefined && modifiers.attackDelta !== undefined) {
    return `Deals ${scaleSkillDamage(modifiers.activeDamage)} damage and immediately reduces the target's current attack count by ${Math.abs(modifiers.attackDelta)} for ${modifiers.durationTurns ?? 1} turns, down to 0.`;
  }
  if (definition.typeId === 'Crack' && modifiers.activeDamage !== undefined) {
    const shredNote = (modifiers.notes ?? []).find((note) => note.startsWith('runtime:armorShredRate='));
    const shredRate = shredNote ? Number(shredNote.split('=')[1]) : 0.2;
    return `Deal ${scaleSkillDamage(modifiers.activeDamage)} damage and apply Fracture (${formatPercent(shredRate)} armor reduction) for ${modifiers.durationTurns ?? 2} turns.`;
  }
  if (modifiers.poisonDamage !== undefined) {
    return `Deals direct toxic damage, then applies ${scaleSkillDamage(modifiers.poisonDamage)} poison damage per turn for ${modifiers.durationTurns ?? 2} turns (stacks).`;
  }
  if (notes.includes('runtime:meteorStrike') && modifiers.meteorDamage !== undefined && modifiers.lavaDamage !== undefined) {
    return `Throws striking meteors at random foes, causing ${scaleSkillDamage(modifiers.meteorDamage)} damage in + patterns. Drops lava pools on each epicentre lasting ${modifiers.durationTurns ?? 3} turns. Foes standing on lava take ${scaleSkillDamage(modifiers.lavaDamage)} damage at combat start.`;
  }
  if (notes.includes('runtime:hasTranscendence') && modifiers.beamDamage !== undefined) {
    return `If it rolls 6, transforms into The Transcendence with grid-wide range, and beam attacks consume all remaining attacks to strike through the perpendicular line through the target for ${scaleSkillDamage(modifiers.beamDamage)} damage.`;
  }
  if (notes.some((note) => note.startsWith('runtime:deuciferOddSiphon='))) {
    return skill?.description ?? '';
  }
  if (notes.some((note) => note.startsWith('runtime:deuciferEvenDamage='))) {
    return skill?.description ?? '';
  }
  if (notes.includes('runtime:manaManipulator') && modifiers.attackDelta !== undefined) {
    return `Combat Start: steals ${Math.abs(modifiers.attackDelta)} mana from all enemy charging actives.`;
  }
  if (notes.includes('runtime:wizardSpellcast') && modifiers.manaGain !== undefined) {
    return `Combat Start: feeds the Magician +${modifiers.manaGain} mana.`;
  }
  if (notes.includes('runtime:magicianSummonWizard')) {
    return skill?.description ?? '';
  }
  if (notes.includes('runtime:leonFuriousClaw') && modifiers.targetMaxHpBonusRate !== undefined) {
    return `Nearby enemies trigger double claw attacks with a 20% chance to crit for 100% bonus damage. Rage gains +${formatPercent(modifiers.targetMaxHpBonusRate)} basic attack damage per fallen foe.`;
  }
  if (notes.includes('runtime:leonMightyRoar')) {
    return skill?.description ?? '';
  }
  if (notes.includes('runtime:leonRage') && modifiers.targetMaxHpBonusRate !== undefined) {
    return `On Kill: Leon gains +${formatPercent(modifiers.targetMaxHpBonusRate)} basic attack damage for each fallen foe.`;
  }
  if (notes.includes('runtime:deuciferSummonImp')) {
    return skill?.description ?? '';
  }
  if (modifiers.berserkThresholdRate !== undefined && modifiers.berserkDamageMultiplier !== undefined) {
    return `Below ${formatPercent(modifiers.berserkThresholdRate)} HP, deals ${formatPercent(modifiers.berserkDamageMultiplier - 1)} more damage.`;
  }

  if (modifiers.shield !== undefined) {
    return `Gain +${scaleSkillDamage(modifiers.shield)} shield for ${modifiers.durationTurns ?? 1} turn.`;
  }

  if (modifiers.numAttacksBoosted !== undefined && modifiers.numAttacksDamageMult !== undefined) {
    return `The next ${modifiers.numAttacksBoosted} basic attacks deal ${formatPercent(modifiers.numAttacksDamageMult - 1)} more damage.`;
  }

  if (modifiers.targetMaxHpBonusRate !== undefined) {
    return `Deals bonus damage equal to ${formatPercent(modifiers.targetMaxHpBonusRate)} of the target's max HP.`;
  }

  if (modifiers.targetCurrentHpBonusRate !== undefined) {
    return `Deals bonus damage equal to ${formatPercent(modifiers.targetCurrentHpBonusRate)} of the target's current HP.`;
  }
  if (modifiers.distanceDamageBonusRatePerTile !== undefined) {
    return `Deal +${formatPercent(modifiers.distanceDamageBonusRatePerTile)} damage for each tile of distance to the target.`;
  }
  if (definition.typeId === 'Battery' && modifiers.manaGain !== undefined) {
    return `All friendly charging active skills gain +${modifiers.manaGain} mana.`;
  }
  if (modifiers.reviveChance !== undefined) {
    return `When defeated, it comes back to life with a ${formatPercent(modifiers.reviveChance)} chance.`;
  }

  return skill?.description ?? '';
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
  pushNumericDelta('Empowered attack count', currentModifiers.numAttacksBoosted, nextModifiers.numAttacksBoosted);

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

  const runtimeRateNotes: Array<{ key: string; label: string }> = [
    { key: 'runtime:armorShredRate=', label: 'Fracture armor reduction' }
  ];
  runtimeRateNotes.forEach(({ key, label }) => {
    const parseRate = (mods: DiceSkillModifier): number | undefined => {
      const note = (mods.notes ?? []).find((entry) => entry.startsWith(key));
      if (!note) return undefined;
      const parsed = Number(note.split('=')[1]);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const currentRate = parseRate(currentModifiers);
    const nextRate = parseRate(nextModifiers);
    if (currentRate !== undefined && nextRate !== undefined && nextRate > currentRate) {
      skillDeltas.push(`${label} +${formatPercent(nextRate - currentRate)}`);
    }
  });

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
