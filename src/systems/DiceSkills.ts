import type { DiceDefinition, DiceInstanceState } from '../types/game';

export interface DiceSkillRuntimeMeta {
  randomDamage?: { min: number; max: number };
  targetMaxHpBonusRate?: number;
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
  hasTranscendence?: boolean;
  hasMeteorStrike?: boolean;
  hasDeathTransform?: boolean;
  hasDeathInstakill?: boolean;
  deathInstakillMana?: number;
  hasGrowthPermanent?: boolean;
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

  const hasDeathInstakill = notes.includes('runtime:deathInstakill');

  return {
    randomDamage: range ? { min: range[0], max: range[1] } : undefined,
    targetMaxHpBonusRate: explicitRate ?? (Number.isFinite(parsedRate) ? parsedRate : undefined),
    splashDamage: modifiers?.splashDamage,
    chainDamage: modifiers?.chainDamage,
    reviveChance,
    combatStartExtraAttacks: primary?.type === 'CombatStart' ? (modifiers?.extraAttacks ?? 0) : 0,
    combatEndExtraAttacks: primary?.type === 'CombatEnd' && !notes.includes('runtime:growthPermanent') ? (modifiers?.extraAttacks ?? 0) : 0,
    targetingMode: definition.targetingMode,
    activeManaNeeded: primary?.type === 'Active' ? (primary.manaNeeded ?? 0) : 0,
    activeExtraAttacks: primary?.type === 'Active' ? (modifiers?.extraAttacks ?? 0) : 0,
    activeAttackDelta: primary?.type === 'Active' ? (modifiers?.attackDelta ?? 0) : 0,
    activeDurationTurns: primary?.type === 'Active' ? (modifiers?.durationTurns ?? 0) : 0,
    poisonDamage: (modifiers as { poisonDamage?: number } | undefined)?.poisonDamage,
    onKillExtraAttacks: primary?.type === 'OnKill' ? (modifiers?.extraAttacks ?? 0) : 0,
    onDeathExtraAttacks: primary?.type === 'OnDeath' ? (modifiers?.extraAttacks ?? 0) : 0,
    distanceDamageBonusPerTile: (modifiers as { distanceDamageBonusPerTile?: number } | undefined)?.distanceDamageBonusPerTile,
    hasTranscendence: notes.includes('runtime:hasTranscendence') || definition.typeId === 'Transcendence',
    hasMeteorStrike: notes.includes('runtime:meteorStrike'),
    hasDeathTransform: notes.includes('runtime:deathTransform'),
    hasDeathInstakill,
    deathInstakillMana: hasDeathInstakill ? (primary?.manaNeeded ?? 12) : undefined,
    hasGrowthPermanent: notes.includes('runtime:growthPermanent')
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
  if (meta.distanceDamageBonusPerTile && attacker.gridPosition && target.gridPosition) {
    const rowDelta = Math.abs(target.gridPosition.row - attacker.gridPosition.row) + 5;
    const colDelta = Math.abs(target.gridPosition.col - attacker.gridPosition.col);
    const distance = Math.max(rowDelta, colDelta);
    damage += distance * meta.distanceDamageBonusPerTile;
  }
  return damage;
}
