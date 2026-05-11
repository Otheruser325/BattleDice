import type { DiceDefinition, DiceInstanceState } from '../types/game';
import { getCombatDistance } from './CombatRange';

export interface DiceSkillRuntimeMeta {
  randomDamage?: { min: number; max: number };
  targetMaxHpBonusRate?: number;
  targetCurrentHpBonusRate?: number;
  splashDamage?: number;
  chainDamage?: number;
  reviveChance?: number;
  combatStartExtraAttacks?: number;
  combatEndExtraAttacks?: number;
  targetingMode?: 'Nearest' | 'Furthest' | 'Strongest' | 'Weakest' | 'Random';
  activeManaNeeded?: number;
  activeExtraAttacks?: number;
  activeAttackDelta?: number;
  activeDurationTurns?: number;
  poisonDamage?: number;
  onKillExtraAttacks?: number;
  onDeathExtraAttacks?: number;
  distanceDamageBonusPerTile?: number;
  distanceDamageBonusRatePerTile?: number;
  berserkThresholdRate?: number;
  berserkDamageMultiplier?: number;
  pipMatchAllyAttackDelta?: number;
  pipMatchFoeAttackDelta?: number;
  activeDamage?: number;
  activeHeal?: number;
  meteorDamage?: number;
  lavaDamage?: number;
  beamDamage?: number;
  pierceBehindRange?: number;
  pierceBehindDamage?: number;
  hammerDamage?: number;
  hasSpearActive?: boolean;
  hasSolitudePreCombat?: boolean;
  hasJudgmentHammer?: boolean;
  hasTranscendence?: boolean;
  hasMeteorStrike?: boolean;
  hasDeathTransform?: boolean;
  hasDeathInstakill?: boolean;
  deathInstakillMana?: number;
  hasGrowthPermanent?: boolean;
  transformAccent?: string;
  transformSymbol?: string;
  transformTitle?: string;
  alternateButton?: string;
  baseButton?: string;
}

export function getRuntimeSkillMeta(definition: DiceDefinition): DiceSkillRuntimeMeta {
  const primary = definition.skills[0];
  const modifiers = primary?.modifiers;
  const activeSkill = definition.skills.find((skill) => skill.type === 'Active');
  const activeModifiers = activeSkill?.modifiers;
  const allModifiers = definition.skills.map((skill) => skill.modifiers).filter((modifier): modifier is NonNullable<typeof modifier> => Boolean(modifier));
  const sumModifier = (key: 'pipMatchAllyAttackDelta' | 'pipMatchFoeAttackDelta') => {
    const sum = allModifiers.reduce((total, modifier) => total + ((modifier as Record<typeof key, number | undefined>)[key] ?? 0), 0);
    return sum === 0 ? undefined : sum;
  };
  const range = (modifiers as { damageRange?: [number, number] } | undefined)?.damageRange;
  const reviveChance = (modifiers as { reviveChance?: number } | undefined)?.reviveChance;
  const notes = modifiers?.notes ?? [];
  const explicitRate = (modifiers as { targetMaxHpBonusRate?: number } | undefined)?.targetMaxHpBonusRate;
  const explicitCurrentRate = (modifiers as { targetCurrentHpBonusRate?: number } | undefined)?.targetCurrentHpBonusRate;
  const rateNote = notes.find((note) => note.startsWith('runtime:targetMaxHpBonusRate='));
  const parsedRate = rateNote ? Number(rateNote.split('=')[1]) : undefined;
  const currentRateNote = notes.find((note) => note.startsWith('runtime:targetCurrentHpBonusRate='));
  const parsedCurrentRate = currentRateNote ? Number(currentRateNote.split('=')[1]) : undefined;
  const beamNote = notes.find((note) => note.startsWith('runtime:beamOnSix='));
  const parsedBeamDamage = beamNote ? Number(beamNote.split('=')[1]) : undefined;

  const getNoteValue = (prefix: string) => notes.find((note) => note.startsWith(prefix))?.slice(prefix.length);
  const hasDeathInstakill = notes.includes('runtime:deathInstakill');

  return {
    randomDamage: range ? { min: range[0], max: range[1] } : undefined,
    targetMaxHpBonusRate: explicitRate ?? (Number.isFinite(parsedRate) ? parsedRate : undefined),
    targetCurrentHpBonusRate: explicitCurrentRate ?? (Number.isFinite(parsedCurrentRate) ? parsedCurrentRate : undefined),
    splashDamage: modifiers?.splashDamage,
    chainDamage: modifiers?.chainDamage,
    reviveChance,
    combatStartExtraAttacks: primary?.type === 'CombatStart' ? (modifiers?.extraAttacks ?? 0) : 0,
    combatEndExtraAttacks: primary?.type === 'CombatEnd' && !notes.includes('runtime:growthPermanent') ? (modifiers?.extraAttacks ?? 0) : 0,
    targetingMode: definition.targetingMode,
    activeManaNeeded: activeSkill ? (activeSkill.manaNeeded ?? 0) : 0,
    activeExtraAttacks: activeSkill ? (activeModifiers?.extraAttacks ?? 0) : 0,
    activeAttackDelta: activeSkill ? (activeModifiers?.attackDelta ?? 0) : 0,
    activeDurationTurns: activeSkill ? (activeModifiers?.durationTurns ?? 0) : 0,
    poisonDamage: (modifiers as { poisonDamage?: number } | undefined)?.poisonDamage,
    onKillExtraAttacks: primary?.type === 'OnKill' ? (modifiers?.extraAttacks ?? 0) : 0,
    onDeathExtraAttacks: primary?.type === 'OnDeath' ? (modifiers?.extraAttacks ?? 0) : 0,
    distanceDamageBonusPerTile: (modifiers as { distanceDamageBonusPerTile?: number } | undefined)?.distanceDamageBonusPerTile,
    distanceDamageBonusRatePerTile: (modifiers as { distanceDamageBonusRatePerTile?: number } | undefined)?.distanceDamageBonusRatePerTile,
    berserkThresholdRate: (modifiers as { berserkThresholdRate?: number } | undefined)?.berserkThresholdRate,
    berserkDamageMultiplier: (modifiers as { berserkDamageMultiplier?: number } | undefined)?.berserkDamageMultiplier,
    pipMatchAllyAttackDelta: sumModifier('pipMatchAllyAttackDelta'),
    pipMatchFoeAttackDelta: sumModifier('pipMatchFoeAttackDelta'),
    activeDamage: (activeModifiers as { activeDamage?: number } | undefined)?.activeDamage ?? (modifiers as { activeDamage?: number } | undefined)?.activeDamage,
    activeHeal: (activeModifiers as { activeHeal?: number } | undefined)?.activeHeal ?? (modifiers as { activeHeal?: number } | undefined)?.activeHeal,
    meteorDamage: (modifiers as { meteorDamage?: number } | undefined)?.meteorDamage,
    lavaDamage: (modifiers as { lavaDamage?: number } | undefined)?.lavaDamage,
    beamDamage: (modifiers as { beamDamage?: number } | undefined)?.beamDamage ?? (Number.isFinite(parsedBeamDamage) ? parsedBeamDamage : undefined),
    pierceBehindRange: (modifiers as { pierceBehindRange?: number } | undefined)?.pierceBehindRange ?? (activeModifiers as { pierceBehindRange?: number } | undefined)?.pierceBehindRange,
    pierceBehindDamage: (activeModifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage ?? (modifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage,
    hammerDamage: (modifiers as { hammerDamage?: number } | undefined)?.hammerDamage,
    hasSpearActive: notes.includes('runtime:spearActive') || (activeModifiers?.notes ?? []).includes('runtime:spearActive'),
    hasSolitudePreCombat: notes.includes('runtime:solitudePreCombat'),
    hasJudgmentHammer: notes.includes('runtime:judgmentHammer'),
    hasTranscendence: notes.includes('runtime:hasTranscendence') || definition.typeId === 'Transcendence',
    hasMeteorStrike: notes.includes('runtime:meteorStrike'),
    hasDeathTransform: notes.includes('runtime:deathTransform'),
    hasDeathInstakill,
    deathInstakillMana: hasDeathInstakill ? (primary?.manaNeeded ?? 12) : undefined,
    hasGrowthPermanent: notes.includes('runtime:growthPermanent'),
    transformAccent: getNoteValue('runtime:transformAccent='),
    transformSymbol: getNoteValue('runtime:transformSymbol='),
    transformTitle: getNoteValue('runtime:transformTitle='),
    alternateButton: getNoteValue('runtime:alternateButton='),
    baseButton: getNoteValue('runtime:baseButton=')
  };
}

export function resolveDamage(
  attacker: DiceInstanceState,
  target: DiceInstanceState,
  definitions: Map<string, DiceDefinition>
): number {
  const definition = definitions.get(attacker.typeId);
  if (!definition) return 10;
  let damage = definition.attack;
  const meta = getRuntimeSkillMeta(definition);
  if (meta.randomDamage) {
    const { min, max } = meta.randomDamage;
    damage = Math.floor(Math.random() * (max - min + 1)) + min;
  }
  if (meta.targetMaxHpBonusRate) {
    damage += Math.floor(target.maxHealth * meta.targetMaxHpBonusRate);
  }
  if (meta.targetCurrentHpBonusRate) {
    damage += Math.floor(target.currentHealth * meta.targetCurrentHpBonusRate);
  }
  if (meta.berserkThresholdRate !== undefined && meta.berserkDamageMultiplier !== undefined && attacker.maxHealth > 0 && attacker.currentHealth / attacker.maxHealth < meta.berserkThresholdRate) {
    damage = Math.max(1, Math.round(damage * meta.berserkDamageMultiplier));
  }
  if ((meta.distanceDamageBonusPerTile || meta.distanceDamageBonusRatePerTile) && attacker.gridPosition && target.gridPosition) {
    const distance = getCombatDistance(attacker, target);
    if (meta.distanceDamageBonusPerTile) {
      damage += distance * meta.distanceDamageBonusPerTile;
    }
    if (meta.distanceDamageBonusRatePerTile) {
      damage += Math.floor(damage * meta.distanceDamageBonusRatePerTile * distance);
    }
  }
  return damage;
}
