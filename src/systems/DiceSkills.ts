import type { DiceDefinition, DiceInstanceState } from '../types/game';

export interface DiceSkillRuntimeMeta {
  randomDamage?: { min: number; max: number };
  targetMaxHpBonusRate?: number;
  splashDamage?: number;
  chainDamage?: number;
  reviveChance?: number;
  combatStartExtraAttacks?: number;
  combatEndExtraAttacks?: number;
  hasRandomTargeting?: boolean;
  activeManaNeeded?: number;
  activeExtraAttacks?: number;
  activeAttackDelta?: number;
  activeDurationTurns?: number;
  poisonDamage?: number;
}

export function getRuntimeSkillMeta(definition: DiceDefinition): DiceSkillRuntimeMeta {
  const primary = definition.skills[0];
  const modifiers = primary?.modifiers;
  const range = (modifiers as { damageRange?: [number, number] } | undefined)?.damageRange;
  const reviveChance = (modifiers as { reviveChance?: number } | undefined)?.reviveChance;
  const notes = modifiers?.notes ?? [];
  const explicitRate = (modifiers as { targetMaxHpBonusRate?: number } | undefined)?.targetMaxHpBonusRate;
  const rateNote = notes.find((note) => note.startsWith('runtime:targetMaxHpBonusRate='));
  const parsedRate = rateNote ? Number(rateNote.split('=')[1]) : undefined;
  return {
    randomDamage: range ? { min: range[0], max: range[1] } : undefined,
    targetMaxHpBonusRate: explicitRate ?? (Number.isFinite(parsedRate) ? parsedRate : undefined),
    splashDamage: modifiers?.splashDamage,
    chainDamage: modifiers?.chainDamage,
    reviveChance,
    combatStartExtraAttacks: primary?.type === 'CombatStart' ? (modifiers?.extraAttacks ?? 0) : 0,
    combatEndExtraAttacks: primary?.type === 'CombatEnd' ? (modifiers?.extraAttacks ?? 0) : 0,
    hasRandomTargeting: primary?.title.toLowerCase().includes('random') || primary?.description.toLowerCase().includes('random') || definition.typeId === 'Broken',
    activeManaNeeded: primary?.type === 'Active' ? (primary.manaNeeded ?? 0) : 0,
    activeExtraAttacks: primary?.type === 'Active' ? (modifiers?.extraAttacks ?? 0) : 0,
    activeAttackDelta: primary?.type === 'Active' ? (modifiers?.attackDelta ?? 0) : 0,
    activeDurationTurns: primary?.type === 'Active' ? (modifiers?.durationTurns ?? 0) : 0,
    poisonDamage: (modifiers as { poisonDamage?: number } | undefined)?.poisonDamage
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
  return damage;
}
