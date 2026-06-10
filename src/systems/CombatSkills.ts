import type { DiceDefinition, DiceInstanceState } from '../types/game';
import { getRuntimeSkillMeta, type DiceSkillRuntimeMeta } from './DiceSkills';

export interface SkillContext {
  attacker: DiceInstanceState;
  target: DiceInstanceState;
  damage: number;
  isLethal: boolean;
}

export interface SkillEffectResult {
  bonusAttacks?: number;
  bonusDamage?: number;
  healAmount?: number;
  shieldGain?: number;
  extraEffects?: string[];
  applyGrowth?: boolean;
  applyBrokenGrowth?: boolean;
  splashTargets?: DiceInstanceState[];
  chainTarget?: DiceInstanceState;
  pierceTargets?: DiceInstanceState[];
  leonFuriousClaw?: boolean;
}

export interface CombatEndResult extends SkillEffectResult {
  growthDelta?: number;
}

export interface PassiveEffectResult extends SkillEffectResult {
  splashTargets?: DiceInstanceState[];
  chainTarget?: DiceInstanceState;
  pierceTargets?: DiceInstanceState[];
}

export interface ActiveEffectResult extends SkillEffectResult {
  summonWizard?: boolean;
  meteorStrike?: { damage: number; lavaDamage: number; lavaTurns: number; targetBoardSide: 'player' | 'enemy' };
  deathInstakill?: { damage: number; targetIsBoss: boolean };
  summonImp?: boolean;
  spearStrike?: { damage: number; pierceDamage: number };
  healTarget?: DiceInstanceState;
  shieldGain?: number;
  shieldTurns?: number;
  poisonTarget?: DiceInstanceState;
  poisonDamage?: number;
  poisonTurns?: number;
  directDamage?: { target: DiceInstanceState; damage: number };
  windExtraAttacks?: number;
  extraAttacksTurns?: number;
  armorShredTarget?: DiceInstanceState;
  armorShredRate?: number;
  armorShredTurns?: number;
  attackDeltaTarget?: DiceInstanceState;
  attackDelta?: number;
  attackDeltaTurns?: number;
  iceSlow?: boolean;
  needsMana?: boolean;
}

function createBaseResult(): SkillEffectResult {
  return {};
}

function applyBonusAttacks(result: SkillEffectResult, bonus: number): void {
  result.bonusAttacks = (result.bonusAttacks ?? 0) + bonus;
}

export function executeOnDamagedSkillEffects(
  target: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  attacker: DiceInstanceState,
  damage: number,
  isLethal: boolean
): SkillEffectResult {
  const result = createBaseResult();
  const meta = getRuntimeSkillMeta(definition);

  if ((meta.isLockedUntilClass6 ?? false) && classLevel < 6) {
    return result;
  }

  const bonus = meta.onDeathExtraAttacks ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
    result.extraEffects = [`OnDamaged grants +${bonus} attacks`];
  }

  return result;
}

export function executeOnDeathSkillEffects(
  defeated: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  attacker: DiceInstanceState
): SkillEffectResult {
  const result = createBaseResult();
  const meta = getRuntimeSkillMeta(definition);

  if ((meta.isLockedUntilClass6 ?? false) && classLevel < 6) {
    return result;
  }

  const bonus = meta.onDeathExtraAttacks ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
    result.extraEffects = [`OnDeath grants +${bonus} attacks to ally`];
  }

  return result;
}

export function executeOnKillSkillEffects(
  attacker: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  defeated: DiceInstanceState
): SkillEffectResult {
  const result = createBaseResult();
  const meta = getRuntimeSkillMeta(definition);

  if ((meta.isLockedUntilClass6 ?? false) && classLevel < 6) {
    return result;
  }

  const bonus = meta.onKillExtraAttacks ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
    result.extraEffects = [`OnKill grants +${bonus} attacks`];
  }

  if ((meta.leonRageRate ?? 0) > 0 && classLevel >= 6) {
    const bonusDamage = Math.max(1, Math.floor(definition.attack * (meta.leonRageRate ?? 0)));
    result.bonusDamage = bonusDamage;
    result.extraEffects = result.extraEffects ?? [];
    result.extraEffects.push(`Leon Rage grants +${bonusDamage} damage`);
  }

  return result;
}

export function executeCombatStartSkillEffects(
  die: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number
): SkillEffectResult {
  const result = createBaseResult();
  const meta = getRuntimeSkillMeta(definition);

  if ((meta.isLockedUntilClass6 ?? false) && classLevel < 6) {
    return result;
  }

  const bonus = meta.combatStartExtraAttacks ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
  }

  return result;
}

export function collectCombatStartAuras(dice: DiceInstanceState[], getDefinition: (die: DiceInstanceState) => DiceDefinition | undefined): { sourceId: string; extraAttacks: number }[] {
  return dice
    .map((die) => {
      const definition = getDefinition(die);
      if (!definition) return null;
      const extraAttacks = getRuntimeSkillMeta(definition).combatStartExtraAttacks ?? 0;
      return extraAttacks > 0 ? { sourceId: die.instanceId, extraAttacks } : null;
    })
    .filter((aura): aura is { sourceId: string; extraAttacks: number } => aura !== null);
}

export function computeCombatStartBonus(
  die: DiceInstanceState,
  playerAuras: { sourceId: string; extraAttacks: number }[],
  enemyAuras: { sourceId: string; extraAttacks: number }[]
): number {
  const auras = die.ownerId === 'player' ? playerAuras : enemyAuras;
  return auras.reduce((sum, aura) => sum + (aura.sourceId === die.instanceId ? 0 : aura.extraAttacks), 0);
}

export function executeCombatEndSkillEffects(
  die: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number
): CombatEndResult {
  const result: CombatEndResult = {};
  const meta = getRuntimeSkillMeta(definition);

  if ((meta.isLockedUntilClass6 ?? false) && classLevel < 6) {
    return result;
  }

  const bonus = meta.combatEndExtraAttacks ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
  }

  if (meta.hasGrowthPermanent) {
    result.applyGrowth = true;
  }

  if (meta.hasBrokenGrowthPermanent) {
    result.applyBrokenGrowth = true;
    result.growthDelta = Math.random() < 0.5 ? -1 : 1;
  }

  return result;
}

export function executePassiveSkillEffects(
  attacker: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  target: DiceInstanceState,
  boardSideTargets: DiceInstanceState[]
): PassiveEffectResult {
  const result: PassiveEffectResult = {};
  const meta = getRuntimeSkillMeta(definition);

  if (!target.gridPosition) return result;
  if ((meta.isLockedUntilClass6 ?? false) && classLevel < 6) return result;

  if (meta.splashDamage) {
    const splashTargets = boardSideTargets.filter((die) =>
      die.instanceId !== target.instanceId &&
      die.gridPosition &&
      Math.abs(die.gridPosition.row - target.gridPosition!.row) <= 1 &&
      Math.abs(die.gridPosition.col - target.gridPosition!.col) <= 1
    );
    if (splashTargets.length > 0) {
      result.splashTargets = splashTargets;
    }
  }

  if (meta.chainDamage) {
    const chainTarget = boardSideTargets.find((die) =>
      die.instanceId !== target.instanceId &&
      die.gridPosition &&
      Math.abs(die.gridPosition.row - target.gridPosition!.row) <= 2 &&
      Math.abs(die.gridPosition.col - target.gridPosition!.col) <= 2
    );
    if (chainTarget) {
      result.chainTarget = chainTarget;
    }
  }

  if (meta.pierceBehindRange) {
    const pierceTargets: DiceInstanceState[] = [];
    const attackerBoardSide = attacker.ownerId === 'player' ? 0 : 4;
    const targetBoardSide = target.ownerId === 'player' ? 0 : 4;
    const rowStep = Math.sign(target.gridPosition.row - attacker.gridPosition.row);
    const colStep = attackerBoardSide === 0 ? 1 : -1;
    const targetCol = target.gridPosition.col;
    for (let i = 1; i <= meta.pierceBehindRange; i++) {
      const row = target.gridPosition.row + rowStep * i;
      const col = targetCol + colStep * i;
      const hit = boardSideTargets.find((die) =>
        die.gridPosition &&
        die.gridPosition.row === row &&
        die.gridPosition.col === col
      );
      if (hit) pierceTargets.push(hit);
    }
    if (pierceTargets.length > 0) {
      result.pierceTargets = pierceTargets;
    }
  }

  if (meta.hasLeonFuriousClaw) {
    result.leonFuriousClaw = true;
  }

  return result;
}

export function executeActiveSkillEffects(
  attacker: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  target: DiceInstanceState,
  currentMana: number,
  activeSlot: { key: string; title: string; manaNeeded: number } | undefined,
  isDeathTransformed: boolean
): ActiveEffectResult {
  const result: ActiveEffectResult = {};
  const meta = getRuntimeSkillMeta(definition);

  const manaNeeded = activeSlot?.manaNeeded ?? (meta.activeManaNeeded ?? 0);
  const canCastActive = manaNeeded > 0 && currentMana >= manaNeeded;

  if ((meta.isLockedUntilClass6 ?? false) && classLevel < 6) return result;

  if (meta.canSummonWizard && classLevel >= 6) {
    const wizardMana = activeSlot?.manaNeeded ?? 18;
    if (currentMana >= wizardMana) {
      result.summonWizard = true;
      return result;
    }
    return result;
  }

  if (meta.hasMeteorStrike) {
    const meteorManaNeeded = activeSlot?.manaNeeded ?? (meta.activeManaNeeded ?? 7);
    if (currentMana >= meteorManaNeeded) {
      result.meteorStrike = {
        damage: meta.meteorDamage ?? 60,
        lavaDamage: meta.lavaDamage ?? 25,
        lavaTurns: meta.activeDurationTurns ?? 3
      };
      return result;
    }
    return result;
  }

  if (meta.hasDeathInstakill && isDeathTransformed) {
    const instakillMana = activeSlot?.manaNeeded ?? (meta.deathInstakillMana ?? 12);
    if (currentMana >= instakillMana) {
      result.deathInstakill = {
        damage: 0,
        targetIsBoss: false
      };
      return result;
    }
    return result;
  }

  if (meta.canSummonImp) {
    if (canCastActive) {
      result.summonImp = true;
      return result;
    }
    return result;
  }

  if (!canCastActive) {
    if (manaNeeded > 0) {
      result.needsMana = true;
    }
    return result;
  }

  if (meta.hasSpearActive) {
    result.spearStrike = {
      damage: meta.activeDamage ?? 104,
      pierceDamage: meta.pierceBehindDamage ?? 208
    };
    return result;
  }

  if (meta.activeHeal !== undefined) {
    result.healTarget = target;
    result.healAmount = Math.max(1, Math.ceil(meta.activeHeal));
    return result;
  }

  if ((meta.shield ?? 0) > 0) {
    result.shieldGain = Math.max(1, Math.ceil(meta.shield ?? 0));
    result.shieldTurns = meta.activeDurationTurns;
    return result;
  }

  if (attacker.typeId === 'Ice') {
    result.directDamage = { target, damage: Math.max(1, Math.ceil(meta.activeDamage ?? 16)) };
    result.iceSlow = true;
    return result;
  }

  if (attacker.typeId === 'Poison') {
    result.poisonTarget = target;
    result.poisonDamage = Math.max(1, Math.floor((meta.poisonDamage ?? 0)));
    result.poisonTurns = meta.activeDurationTurns ?? 1;
    return result;
  }

  if (meta.activeDamage !== undefined && !meta.hasSpearActive && !meta.hasMeteorStrike && !(meta.hasDeathInstakill && isDeathTransformed) && attacker.typeId !== 'Ice' && attacker.typeId !== 'Poison') {
    result.directDamage = { target, damage: Math.max(1, Math.ceil(meta.activeDamage ?? 1)) };
  }

  if ((meta.activeExtraAttacks ?? 0) > 0 && meta.activeDurationTurns !== undefined) {
    if (attacker.typeId === 'Wind') {
      result.windExtraAttacks = 1;
      result.extraAttacksTurns = meta.activeDurationTurns;
    } else {
      result.extraAttacksTurns = meta.activeDurationTurns;
      applyBonusAttacks(result, meta.activeExtraAttacks!);
    }
  }

  if ((meta.armorShredRate ?? 0) > 0 && meta.activeDurationTurns !== undefined) {
    result.armorShredTarget = target;
    result.armorShredRate = meta.armorShredRate!;
    result.armorShredTurns = meta.activeDurationTurns;
  }

  if ((meta.activeAttackDelta ?? 0) !== 0 && meta.activeDurationTurns !== undefined) {
    result.attackDeltaTarget = target;
    result.attackDelta = meta.activeAttackDelta!;
    result.attackDeltaTurns = meta.activeDurationTurns;
  }

  return result;
}

export function hasJudgmentHammer(meta: DiceSkillRuntimeMeta): boolean {
  return meta.hasJudgmentHammer ?? false;
}

export function getHammerDamage(meta: DiceSkillRuntimeMeta): number {
  return meta.hammerDamage ?? 150;
}