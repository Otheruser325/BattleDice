import type { DiceDefinition, DiceInstanceState, DiceSkillType, DiceStatusEffect, DiceTargetingMode } from '../types/game';
import { CHAIN_NO_TARGET_CAP, getChainTargetLimit, getPipMappedRate, resolvePipScaledDamage, getRuntimeSkillMeta, getRuntimeSkillMetaForTrigger, getValidSkillDefinitions, getStatusEffectDuration, getSkillLockClass, type DiceSkillRuntimeMeta } from './DiceSkills';
import { getBoardSideCombatDistance } from './CombatRange';
import { formatCompact } from '../utils/FormatManager';
import { secureChance, securePick } from '../utils/RandomManager';

export type CombatFlowPhase = DiceSkillType | 'Attack';

export interface CombatFlowContext {
  phase: CombatFlowPhase;
  turn?: number;
  sourceInstanceId?: string;
  sourceTypeId?: string;
  targetInstanceId?: string;
  targetTypeId?: string;
  skillType?: string;
  skillTitle?: string;
}

export interface CombatFlowLogger {
  error: (...details: unknown[]) => void;
  warn: (...details: unknown[]) => void;
}

/**
 * Last-resort boundary for malformed combat skill data. It records the exact
 * trigger and dice involved, then returns a safe fallback so one bad skill
 * cannot reject the combat promise and abort the whole phase.
 */
export class CombatSkillOrchestrator {
  private readonly issues: Array<{ at: string; context: CombatFlowContext; message: string; stack?: string }> = [];

  constructor(private readonly logger: CombatFlowLogger, private readonly maxIssues = 100) {}

  async run<T>(context: CombatFlowContext, operation: () => T | Promise<T>, fallback: T): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.record(context, error);
      return fallback;
    }
  }

  runSync<T>(context: CombatFlowContext, operation: () => T, fallback: T): T {
    try {
      return operation();
    } catch (error) {
      this.record(context, error);
      return fallback;
    }
  }

  clear() {
    this.issues.length = 0;
  }

  getIssues() {
    return [...this.issues];
  }

  private record(context: CombatFlowContext, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    this.issues.push({ at: new Date().toISOString(), context, message, stack });
    if (this.issues.length > Math.max(1, this.maxIssues)) this.issues.shift();
    this.logger.error('Combat skill data failure', { context, message, stack });
  }
}

export interface SkillContext {
  attacker: DiceInstanceState;
  target: DiceInstanceState;
  damage: number;
  isLethal: boolean;
}

export interface CombatStartManaEffect {
  selfGain: number;
  allyGain: number;
  foeGain: number;
  steal: number;
  stealType: 'ally' | 'enemy' | 'both';
}

export interface CombatStartTauntEffect {
  range: number;
  duration: number;
}

export interface InfiltratorSkillEffect {
  teleportRange?: number;
  isInfiltrator: boolean;
}

export interface InfiltratorPlacement {
  tile: { row: number; col: number };
  targetBoardSide: 'player' | 'enemy';
}

export interface StatusEffectApplication {
  source: DiceInstanceState;
  target: DiceInstanceState;
  effect: DiceStatusEffect;
  duration: number;
  damage?: number;
  delta?: number;
  rate?: number;
  maxStacks?: number;
}

export interface SkillEffectResult {
  bonusAttacks?: number;
  summonType?: string;
  summonCount?: number;
  summonPattern?: Array<[number, number]>;
  summonAllowRoll?: boolean;
  bonusDamage?: number;
  healAmount?: number;
  shieldGain?: number;
  extraEffects?: string[];
  applyGrowth?: boolean;
  growthDelta?: number;
  missingHealRate?: number;
  grantAttacksToAlly?: number;
  specialAttackDamage?: number;
  specialAttackTarget?: DiceInstanceState;
  revenge?: { hits: number; damage: number; range: number; mode: DiceTargetingMode };
  splashTargets?: DiceInstanceState[];
  heatwaveDamageAmount?: number;
  chainTarget?: DiceInstanceState;
  pierceTargets?: DiceInstanceState[];
  leonFuriousClaw?: boolean;
  statusApplications?: StatusEffectApplication[];
}

export interface CombatStartResult extends SkillEffectResult {
  combatStartAuras: { sourceId: string; extraAttacks: number }[];
  splashTargets?: DiceInstanceState[];
  splashDamageAmount?: number;
  chainTarget?: DiceInstanceState;
  chainDamageAmount?: number;
}

export interface CombatEndResult extends SkillEffectResult {
  grantAttacksToAlly?: number;
}

export interface OnKillResult extends SkillEffectResult {
  grantAttacksToAlly?: number;
  hammerTarget?: DiceInstanceState;
  hammerDamage?: number;
  hammerRadius?: number;
  canRetriggerSkill?: boolean;
  maxSkillRetriggers?: number;
  leonRageBonus?: number;
}

export interface OnDamagedResult extends SkillEffectResult {
  grantAttacksToAlly?: number;
}

export interface OnDeathResult extends SkillEffectResult {
  grantAttacksToAlly?: number;
}

export interface OnTransformedResult extends SkillEffectResult {
  extraAttacksTurns?: number;
  grantAttacksToAlly?: number;
}

export interface PassiveEffectResult extends SkillEffectResult {
  splashTargets?: DiceInstanceState[];
  splashDamageAmount?: number;
  chainTarget?: DiceInstanceState;
  chainDamageAmount?: number;
  pierceTargets?: DiceInstanceState[];
}

export interface ActiveEffectResult extends SkillEffectResult {
  grantAttacksToAlly?: number;
  summonType?: string;
  summonCount?: number;
  summonPattern?: Array<[number, number]>;
  summonAllowRoll?: boolean;
  activeSplashDamageAmount?: number;
  splashTargets?: DiceInstanceState[];
  splashDamageAmount?: number;
  chainTarget?: DiceInstanceState;
  chainDamageAmount?: number;
  meteorStrike?: { damage: number; lavaDamage?: number; lavaTurns: number; meteorCount: number; meteorRandomOrientation: boolean; lavaPoolPattern?: Array<[number, number]> };
  instakill?: { damage: number; targetIsBoss: boolean; bossDamage: number };
  spearStrike?: { damage: number; pierceDamage: number; pierceRange: number };
  healTarget?: DiceInstanceState;
  shieldGain?: number;
  shieldTurns?: number;
  poisonTarget?: DiceInstanceState;
  poisonDamage?: number;
  poisonTurns?: number;
  directDamage?: { target: DiceInstanceState; damage: number };
  attackCountIncrease?: number;
  extraAttacksTurns?: number;
  armorShredTarget?: DiceInstanceState;
  armorShredRate?: number;
  armorShredTurns?: number;
  attackDeltaTarget?: DiceInstanceState;
  attackDelta?: number;
  attackDeltaTurns?: number;
  attackDeltaMaxStacks?: number;
  statusEffect?: DiceStatusEffect;
  needsMana?: boolean;
  transformToAlternateForm?: boolean;
  hitsAllFoes?: boolean;
  hitsAllAllies?: boolean;
}

function createBaseResult(): SkillEffectResult {
  return {};
}

function applyBonusAttacks(result: SkillEffectResult, bonus: number): void {
  result.bonusAttacks = (result.bonusAttacks ?? 0) + bonus;
}

function applyGrowth(result: SkillEffectResult, meta: DiceSkillRuntimeMeta): void {
  if (meta.missingHealRate !== undefined && Number.isFinite(meta.missingHealRate)) {
    result.missingHealRate = Math.max(0, Math.min(1, meta.missingHealRate));
  }
  if (!meta.hasGrowth) return;
  const delta = Math.max(1, Math.abs(meta.growthDelta ?? 1));
  const chance = Math.max(0, Math.min(1, meta.growthChance ?? 1));
  result.applyGrowth = true;
  result.growthDelta = secureChance(chance) ? delta : -delta;
}

function applySummon(result: SkillEffectResult, meta: DiceSkillRuntimeMeta): void {
  if (!meta.summonType) return;
  result.summonType = meta.summonType;
  result.summonCount = Math.max(1, Math.floor(meta.summonCount ?? 1));
  result.summonPattern = meta.summonPattern;
  result.summonAllowRoll = meta.allowSummonedDieToRoll;
}

export function applySkillDamageModifiers(
  damage: number,
  attacker: DiceInstanceState,
  target: DiceInstanceState,
  meta: DiceSkillRuntimeMeta
): number {
  let adjusted = Math.max(1, damage);
  if (meta.lowHpThresholdRate !== undefined
    && meta.lowHpDamageBonusRate !== undefined
    && target.maxHealth > 0
    && target.currentHealth < target.maxHealth * meta.lowHpThresholdRate) {
    adjusted = Math.floor(adjusted * (1 + meta.lowHpDamageBonusRate));
  }
  if (attacker.gridPosition && target.gridPosition) {
    const distance = getBoardSideCombatDistance(attacker, target);
    if (meta.distanceDamageBonusPerTile !== undefined) adjusted += distance * meta.distanceDamageBonusPerTile;
    if (meta.distanceDamageBonusRatePerTile !== undefined) adjusted = Math.floor(adjusted * (1 + meta.distanceDamageBonusRatePerTile * distance));
  }
  return Math.max(1, Math.floor(adjusted));
}

function selectChainTarget(
  candidates: Array<{ die: DiceInstanceState; distance: number }>,
  mode: DiceTargetingMode
): DiceInstanceState | undefined {
  if (candidates.length === 0) return undefined;
  if (mode === 'Random') return securePick(candidates)?.die;
  const sorted = [...candidates].sort((a, b) => {
    if (mode === 'Strongest') return b.die.currentHealth - a.die.currentHealth || a.distance - b.distance;
    if (mode === 'Weakest') return a.die.currentHealth - b.die.currentHealth || a.distance - b.distance;
    return mode === 'Furthest'
      ? b.distance - a.distance || a.die.instanceId.localeCompare(b.die.instanceId)
      : a.distance - b.distance || a.die.instanceId.localeCompare(b.die.instanceId);
  });
  return sorted[0]?.die;
}

function addStatusApplication(
  result: SkillEffectResult,
  meta: DiceSkillRuntimeMeta,
  definition: DiceDefinition,
  source: DiceInstanceState,
  target: DiceInstanceState | undefined,
  pips: number
): void {
  if (!target || target.isDestroyed) return;
  const effect = meta.activeStatusEffect ?? meta.statusEffects?.find(Boolean);
  if (!effect) return;
  const triggerDuration = meta.activeDurationTurns > 0 ? meta.activeDurationTurns : undefined;
  const duration = Math.max(1, Math.floor(getStatusEffectDuration(meta, effect) ?? triggerDuration ?? meta.statusDuration ?? 1));
  const poisonDamage = effect === 'poison'
    ? resolvePipScaledDamage(meta.poisonDamage, definition.attack, meta.poisonDamageRate, meta.poisonDamageRatesByPip, pips)
    : undefined;
  result.statusApplications = [...(result.statusApplications ?? []), {
    source,
    target,
    effect,
    duration,
    damage: poisonDamage,
    delta: meta.activeAttackDelta !== 0 ? meta.activeAttackDelta : meta.attackDelta,
    rate: meta.armorShredRate,
    maxStacks: meta.activeMaxStacks ?? meta.maxStacks
  }];
}

interface ActiveSkillSlot {
  key: string;
  title: string;
  manaNeeded: number;
  skillIndex?: number;
}

export function executeRevengeSkillEffects(
  die: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  previousHealth: number,
  currentHealth: number
): SkillEffectResult {
  const result: SkillEffectResult = {};
  const maxHealth = Math.max(1, die.maxHealth);

  const revengeSkill = getValidSkillDefinitions(definition).find((skill) => {
    const threshold = skill.modifiers?.revengeThresholdRate;
    const lockClass = getSkillLockClass(skill);
    return typeof threshold === 'number'
      && Number.isFinite(threshold)
      && previousHealth >= maxHealth * threshold
      && currentHealth < maxHealth * threshold
      && (lockClass === undefined || classLevel >= lockClass);
  });
  if (!revengeSkill) return result;

  const scopedDefinition: DiceDefinition = { ...definition, skills: [revengeSkill] };
  const meta = getRuntimeSkillMeta(scopedDefinition, undefined, true);
  const threshold = Math.max(0, Math.min(1, meta.revengeThresholdRate ?? 0));
  if (threshold <= 0) return result;

  if (meta.missingHealRate !== undefined) result.missingHealRate = Math.max(0, Math.min(1, meta.missingHealRate));
  result.revenge = {
    hits: Math.max(1, Math.floor(meta.revengeHits ?? 1)),
    damage: Math.max(1, Math.floor(meta.revengeDamage ?? definition.attack)),
    range: Math.max(1, meta.revengeRange ?? definition.range),
    mode: meta.skillTargeting ?? meta.targetingMode ?? 'Nearest'
  };
  return result;
}

export function getCombatStartManaEffect(
  definition: DiceDefinition,
  classLevel: number
): CombatStartManaEffect | undefined {
  const skill = getValidSkillDefinitions(definition).find((candidate) => {
    if (candidate.type !== 'CombatStart' || !candidate.modifiers) return false;
    const modifiers = candidate.modifiers;
    return modifiers.manaGain !== undefined
      || modifiers.allyManaGain !== undefined
      || modifiers.foeManaGain !== undefined
      || modifiers.manaSteal !== undefined;
  });
  if (!skill || (getSkillLockClass(skill) !== undefined && classLevel < getSkillLockClass(skill)!)) return undefined;
  const meta = getRuntimeSkillMeta({ ...definition, skills: [skill] }, undefined, true);
  return {
    selfGain: Math.max(0, Math.floor(meta.manaGain ?? 0)),
    allyGain: Math.max(0, Math.floor(meta.allyManaGain ?? 0)),
    foeGain: Math.max(0, Math.floor(meta.foeManaGain ?? 0)),
    steal: Math.max(0, Math.floor(meta.manaSteal ?? 0)),
    stealType: meta.manaStealType ?? 'enemy'
  };
}

export function getCombatStartTauntEffect(
  definition: DiceDefinition,
  classLevel: number
): CombatStartTauntEffect | undefined {
  const skill = getValidSkillDefinitions(definition).find((candidate) =>
    candidate.type === 'CombatStart' && (candidate.modifiers?.tauntRange ?? 0) > 0
  );
  if (!skill || (getSkillLockClass(skill) !== undefined && classLevel < getSkillLockClass(skill)!)) return undefined;
  const meta = getRuntimeSkillMetaForTrigger(definition, 'CombatStart');
  const range = meta.tauntRange ?? 0;
  if (range <= 0) return undefined;
  return {
    range,
    duration: Math.max(1, Math.floor(getStatusEffectDuration(meta, 'taunt') ?? meta.statusDuration ?? 1))
  };
}

export function getInfiltratorSkillEffect(
  definition: DiceDefinition,
  classLevel: number
): InfiltratorSkillEffect | undefined {
  const skill = getValidSkillDefinitions(definition).find((candidate) => candidate.modifiers?.isInfiltrator === true);
  if (!skill || (getSkillLockClass(skill) !== undefined && classLevel < getSkillLockClass(skill)!)) return undefined;
  const meta = getRuntimeSkillMeta({ ...definition, skills: [skill] }, undefined, true);
  return { teleportRange: meta.teleportRange, isInfiltrator: true };
}

export function canSkillStrikeFirst(definition: DiceDefinition, classLevel: number): boolean {
  const skill = getValidSkillDefinitions(definition).find((candidate) => candidate.modifiers?.strikeFirst === true);
  return Boolean(skill && (getSkillLockClass(skill) === undefined || classLevel >= getSkillLockClass(skill)!));
}

export function chooseInfiltratorPlacement(
  source: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  foes: DiceInstanceState[],
  occupiedTiles: Set<string>,
  gridSize: number,
  getDistance: (from: DiceInstanceState, to: DiceInstanceState) => number
): InfiltratorPlacement | undefined {
  const infiltrator = getInfiltratorSkillEffect(definition, classLevel);
  if (!infiltrator || !source.gridPosition || foes.length === 0) return undefined;

  const furthest = [...foes]
    .filter((foe) => foe.gridPosition)
    .sort((a, b) => getDistance(source, b) - getDistance(source, a))[0];
  if (!furthest?.gridPosition) return undefined;

  const targetBoardSide: 'player' | 'enemy' = source.ownerId === 'player' ? 'enemy' : 'player';
  const neighbors = [
    { row: furthest.gridPosition.row - 1, col: furthest.gridPosition.col },
    { row: furthest.gridPosition.row + 1, col: furthest.gridPosition.col },
    { row: furthest.gridPosition.row, col: furthest.gridPosition.col - 1 },
    { row: furthest.gridPosition.row, col: furthest.gridPosition.col + 1 }
  ].filter((tile) => tile.row >= 0 && tile.row < gridSize && tile.col >= 0 && tile.col < gridSize && !occupiedTiles.has(`${tile.row},${tile.col}`));

  const teleportRange = infiltrator.teleportRange ?? definition.range;
  let chosen: { row: number; col: number } | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tile of neighbors) {
    const proxy: DiceInstanceState = { ...source, gridPosition: tile };
    const distance = getDistance(source, proxy);
    if (teleportRange >= 0 && distance > teleportRange) continue;
    const isBetter = distance < bestDistance
      || (distance === bestDistance && Math.abs(tile.col - furthest.gridPosition.col) < Math.abs((chosen?.col ?? tile.col) - furthest.gridPosition.col));
    if (isBetter) {
      bestDistance = distance;
      chosen = tile;
    }
  }

  return chosen ? { tile: chosen, targetBoardSide } : undefined;
}

function getUnlockedSkillMeta(
  definition: DiceDefinition,
  classLevel: number,
  trigger: DiceSkillType,
  skillIndex?: number
): DiceSkillRuntimeMeta | undefined {
  const skills = getValidSkillDefinitions(definition);
  const hasTrigger = skillIndex === undefined
    ? skills.some((skill) => skill.type === trigger)
    : skills[skillIndex]?.type === trigger;
  if (!hasTrigger) return undefined;
  const meta = getRuntimeSkillMetaForTrigger(definition, trigger, skillIndex);
  const skill = skillIndex === undefined
    ? skills.find((candidate) => candidate.type === trigger)
    : skills[skillIndex];
  const lockClass = skill ? getSkillLockClass(skill) : meta.unlockAtClass;
  if (lockClass !== undefined && classLevel < lockClass) return undefined;
  return meta;
}

export function executeOnDamagedSkillEffects(
  target: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  attacker: DiceInstanceState,
  damage: number,
  isLethal: boolean
): OnDamagedResult {
  const result: OnDamagedResult = {};
  const meta = getUnlockedSkillMeta(definition, classLevel, 'OnDamaged');
  if (!meta) return result;
  addStatusApplication(result, meta, definition, attacker, target, 1);
  applyGrowth(result, meta);
  applySummon(result, meta);
  if (meta.onHitDamage !== undefined) {
    result.specialAttackDamage = Math.max(1, meta.onHitDamage);
    result.specialAttackTarget = attacker;
  }

  const bonus = meta.allyExtraAttacks ?? meta.grantAttacksToAlly ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
    result.extraEffects = [`OnDamaged grants +${bonus} attacks to ally`];
  }

  if (bonus > 0) result.grantAttacksToAlly = bonus;

  if ((meta.shield ?? 0) > 0) {
    result.shieldGain = Math.max(1, Math.ceil(meta.shield ?? 0));
  }

  return result;
}

export function executeOnDeathSkillEffects(
  defeated: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  attacker: DiceInstanceState
): OnDeathResult {
  const result: OnDeathResult = {};
  const meta = getUnlockedSkillMeta(definition, classLevel, 'OnDeath');
  if (!meta) return result;
  addStatusApplication(result, meta, definition, attacker, defeated, 1);
  applyGrowth(result, meta);
  applySummon(result, meta);
  if (meta.deathDamage !== undefined) {
    result.specialAttackDamage = Math.max(1, meta.deathDamage);
    result.specialAttackTarget = attacker;
  }

  const bonus = meta.allyExtraAttacks ?? meta.grantAttacksToAlly ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
    result.grantAttacksToAlly = bonus;
    result.extraEffects = [`OnDeath grants +${bonus} attacks to ally`];
  }

  if (bonus > 0) result.grantAttacksToAlly = bonus;

  return result;
}

export function executeOnTransformedSkillEffects(
  transformed: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number
): OnTransformedResult {
  const result: OnTransformedResult = {};
  const meta = getUnlockedSkillMeta(definition, classLevel, 'OnTransformed');
  if (!meta) return result;
  addStatusApplication(result, meta, definition, transformed, transformed, 1);
  applyGrowth(result, meta);
  applySummon(result, meta);
  if (meta.transformAttackDamage !== undefined) result.specialAttackDamage = Math.max(1, meta.transformAttackDamage);

  const bonus = meta.allyExtraAttacks ?? meta.grantAttacksToAlly ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
    result.grantAttacksToAlly = bonus;
    result.extraAttacksTurns = meta.onTransformedDurationTurns ?? 1;
    result.extraEffects = [`OnTransformed grants +${bonus} attacks`];
  }

  void transformed;
  return result;
}

export function executeOnKillSkillEffects(
  attacker: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  defeated: DiceInstanceState
): OnKillResult {
  const result: OnKillResult = {};
  const meta = getUnlockedSkillMeta(definition, classLevel, 'OnKill');
  if (!meta) return result;
  applyGrowth(result, meta);
  applySummon(result, meta);
  if (meta.onKillDamage !== undefined) result.specialAttackDamage = Math.max(1, meta.onKillDamage);

  const bonus = meta.allyExtraAttacks ?? meta.grantAttacksToAlly ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
    result.grantAttacksToAlly = bonus;
    result.extraEffects = [`OnKill grants +${bonus} attacks to ally`];
  }

  if (meta.hasHammer === true) {
    result.hammerTarget = defeated;
    result.hammerDamage = meta.hammerDamage ?? definition.attack;
    result.hammerRadius = Math.max(0, Math.floor(meta.hammerRadius ?? 1));
    result.canRetriggerSkill = meta.canRetriggerSkill === true;
    result.maxSkillRetriggers = Math.max(0, Math.floor(meta.maxSkillRetriggers ?? 10));
  }

  if ((meta.leonRageRate ?? 0) > 0) {
    const bonusDamage = Math.max(1, Math.floor(definition.attack * (meta.leonRageRate ?? 0)));
    result.bonusDamage = bonusDamage;
    result.leonRageBonus = Math.ceil((meta.leonRageRate ?? 0) * 100);
    result.extraEffects = result.extraEffects ?? [];
    result.extraEffects.push(`Leon Rage grants +${formatCompact(bonusDamage)} damage`);
  }

  return result;
}

export function executeCombatStartSkillEffects(
  die: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  target?: DiceInstanceState,
  boardSideTargets: DiceInstanceState[] = [],
  pips = 1
): CombatStartResult {
  const result: CombatStartResult = { combatStartAuras: [] };
  const meta = getUnlockedSkillMeta(definition, classLevel, 'CombatStart');
  if (!meta) return result;
  addStatusApplication(result, meta, definition, die, target, pips);
  applyGrowth(result, meta);
  applySummon(result, meta);
  if (meta.combatStartDamage !== undefined) {
    result.specialAttackDamage = Math.max(1, meta.combatStartDamage);
    result.specialAttackTarget = target;
  }

  const bonus = meta.allyExtraAttacks ?? meta.grantAttacksToAlly ?? 0;
  if (bonus > 0) applyBonusAttacks(result, bonus);
  if (!target?.gridPosition) return result;

  const splashRate = getPipMappedRate(meta.splashDamageRatesByPip, pips, meta.splashDamageRate);
  if (meta.splashDamage !== undefined || meta.splashDamageRatesByPip !== undefined || splashRate !== undefined) {
    const targets = boardSideTargets.filter((candidate) => candidate.instanceId !== target.instanceId && candidate.gridPosition
      && Math.abs(candidate.gridPosition.row - target.gridPosition.row) <= 1
      && Math.abs(candidate.gridPosition.col - target.gridPosition.col) <= 1);
    if (targets.length > 0) {
      result.splashTargets = targets;
      result.splashDamageAmount = resolvePipScaledDamage(meta.splashDamage, definition.attack, meta.splashDamageRate, meta.splashDamageRatesByPip, pips);
    }
  }
  const heatwaveRate = getPipMappedRate(meta.heatwaveDamageRatesByPip, pips, meta.heatwaveDamageRate);
  if (meta.heatwaveDamage !== undefined || heatwaveRate !== undefined || meta.heatwaveDamageRatesByPip !== undefined) {
    result.heatwaveDamageAmount = resolvePipScaledDamage(meta.heatwaveDamage, definition.attack, meta.heatwaveDamageRate, meta.heatwaveDamageRatesByPip, pips);
  }

  const chainRate = getPipMappedRate(meta.chainDamageRatesByPip, pips, meta.chainDamageRate);
  if (meta.chainDamage !== undefined || meta.chainDamageRatesByPip !== undefined || chainRate !== undefined) {
    const chainRange = Math.max(1, Math.floor(
      typeof meta.chainRange === 'number' && Number.isFinite(meta.chainRange)
        ? meta.chainRange
        : (typeof definition.range === 'number' && Number.isFinite(definition.range) ? definition.range : 1)
    ));
    const chainCandidates = boardSideTargets
      .filter((candidate) => candidate.instanceId !== target.instanceId && Boolean(candidate.gridPosition))
      .map((candidate) => ({
        die: candidate,
        distance: candidate.gridPosition && target.gridPosition
          ? Math.max(
            Math.abs(target.gridPosition.row - candidate.gridPosition.row),
            Math.abs(target.gridPosition.col - candidate.gridPosition.col)
          )
          : Number.POSITIVE_INFINITY
      }))
      .filter(({ distance }) => distance <= chainRange);
    const chainTarget = selectChainTarget(chainCandidates, meta.skillTargeting ?? meta.targetingMode ?? 'Nearest');
    if (chainTarget) {
      result.chainTarget = chainTarget;
      result.chainDamageAmount = resolvePipScaledDamage(meta.chainDamage, definition.attack, meta.chainDamageRate, meta.chainDamageRatesByPip, pips);
    }
  }
  void die;
  return result;
}

export function collectCombatStartAuras(dice: DiceInstanceState[], getDefinition: (die: DiceInstanceState) => DiceDefinition | undefined): { sourceId: string; extraAttacks: number }[] {
  return dice
    .map((die) => {
      const definition = getDefinition(die);
      if (!definition) return null;
      if (!getValidSkillDefinitions(definition).some((skill) => skill.type === 'CombatStart')) return null;
      const startMeta = getRuntimeSkillMetaForTrigger(definition, 'CombatStart');
      const extraAttacks = startMeta.allyExtraAttacks ?? startMeta.grantAttacksToAlly ?? 0;
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
  const meta = getUnlockedSkillMeta(definition, classLevel, 'CombatEnd');
  if (!meta) return result;
  applyGrowth(result, meta);
  applySummon(result, meta);
  if (meta.combatEndDamage !== undefined) result.specialAttackDamage = Math.max(1, meta.combatEndDamage);

  const bonus = meta.allyExtraAttacks ?? meta.grantAttacksToAlly ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
    result.grantAttacksToAlly = bonus;
  }

  return result;
}

export function executePassiveSkillEffects(
  attacker: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  target: DiceInstanceState | undefined,
  boardSideTargets: DiceInstanceState[],
  pips = 1,
  passiveSkillIndex?: number
): PassiveEffectResult {
  const result: PassiveEffectResult = {};
  const meta = getUnlockedSkillMeta(definition, classLevel, 'Passive', passiveSkillIndex);

  if (!meta) return result;
  applySummon(result, meta);
  if (!target?.gridPosition && !meta.canFireWithNoTargets) return result;
  applyGrowth(result, meta);
  const bonus = meta.allyExtraAttacks ?? meta.grantAttacksToAlly ?? 0;
  if (bonus > 0) {
    applyBonusAttacks(result, bonus);
    result.grantAttacksToAlly = bonus;
  }

  if (!target?.gridPosition) return result;
  addStatusApplication(result, meta, definition, attacker, target, pips);

  const splashRate = getPipMappedRate(meta.splashDamageRatesByPip, pips, meta.splashDamageRate);
  const hasSplashMapping = meta.splashDamageRatesByPip !== undefined;
  if (meta.splashDamage !== undefined || hasSplashMapping || splashRate !== undefined) {
    const splashTargets = boardSideTargets.filter((die) =>
      die.instanceId !== target.instanceId &&
      die.gridPosition &&
      Math.abs(die.gridPosition.row - target.gridPosition!.row) <= 1 &&
      Math.abs(die.gridPosition.col - target.gridPosition!.col) <= 1
    );
    if (splashTargets.length > 0) {
      result.splashTargets = splashTargets;
      result.splashDamageAmount = resolvePipScaledDamage(meta.splashDamage, definition.attack, meta.splashDamageRate, meta.splashDamageRatesByPip, pips);
    }
  }

  const chainRate = getPipMappedRate(meta.chainDamageRatesByPip, pips, meta.chainDamageRate);
  const hasChainMapping = meta.chainDamageRatesByPip !== undefined;
  if (meta.chainDamage !== undefined || hasChainMapping || chainRate !== undefined) {
    const chainRange = Math.max(1, Math.floor(
      typeof meta.chainRange === 'number' && Number.isFinite(meta.chainRange)
        ? meta.chainRange
        : (typeof definition.range === 'number' && Number.isFinite(definition.range) ? definition.range : 1)
    ));
    const chainMode = meta.skillTargeting ?? meta.targetingMode ?? 'Nearest';
    const chainCandidates = boardSideTargets
      .filter((die) => die.instanceId !== target.instanceId && Boolean(die.gridPosition) && Boolean(target.gridPosition))
      .map((die) => ({
        die,
        distance: target.gridPosition && die.gridPosition
          ? Math.max(
            Math.abs(target.gridPosition.row - die.gridPosition.row),
            Math.abs(target.gridPosition.col - die.gridPosition.col)
          )
          : Number.POSITIVE_INFINITY
      }))
      .filter(({ distance }) => distance <= chainRange);
    const chainTarget = selectChainTarget(chainCandidates, chainMode);
    if (chainTarget) {
      result.chainTarget = chainTarget;
      result.chainDamageAmount = resolvePipScaledDamage(meta.chainDamage, definition.attack, meta.chainDamageRate, meta.chainDamageRatesByPip, pips);
    }
  }

  const heatwaveRate = getPipMappedRate(meta.heatwaveDamageRatesByPip, pips, meta.heatwaveDamageRate);
  if (meta.heatwaveDamage !== undefined || meta.heatwaveDamageRatesByPip !== undefined || heatwaveRate !== undefined) {
    result.heatwaveDamageAmount = resolvePipScaledDamage(meta.heatwaveDamage, definition.attack, meta.heatwaveDamageRate, meta.heatwaveDamageRatesByPip, pips);
  }

  if (meta.pierceBehindRange && attacker.gridPosition) {
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

  if ((meta.attackCountIncrease ?? 0) > 0 && meta.skillRangeThreshold !== undefined) {
    result.leonFuriousClaw = true;
  }

  return result;
}

export function executeActiveSkillEffects(
  attacker: DiceInstanceState,
  definition: DiceDefinition,
  classLevel: number,
  target: DiceInstanceState | undefined,
  currentMana: number,
  activeSlot: ActiveSkillSlot | undefined,
  pips = 1
): ActiveEffectResult {
  const result: ActiveEffectResult = {};
  const meta = getUnlockedSkillMeta(definition, classLevel, 'Active', activeSlot?.skillIndex);
  if (!meta) return result;

  const manaNeeded = activeSlot?.manaNeeded ?? (meta.activeManaNeeded ?? 0);
  const canCastActive = manaNeeded > 0 && currentMana >= manaNeeded;
  if (!canCastActive) {
    result.needsMana = manaNeeded > 0;
    return result;
  }

  addStatusApplication(result, meta, definition, attacker, target, pips);
  applyGrowth(result, meta);
  applySummon(result, meta);

  const activeSplashRate = getPipMappedRate(meta.splashDamageRatesByPip, pips, meta.splashDamageRate);
  if (meta.splashDamage !== undefined || meta.splashDamageRatesByPip !== undefined || activeSplashRate !== undefined) {
    result.activeSplashDamageAmount = resolvePipScaledDamage(meta.splashDamage, definition.attack, meta.splashDamageRate, meta.splashDamageRatesByPip, pips);
  }

  const activeHeatwaveRate = getPipMappedRate(meta.heatwaveDamageRatesByPip, pips, meta.heatwaveDamageRate);
  if (meta.heatwaveDamage !== undefined || meta.heatwaveDamageRatesByPip !== undefined || activeHeatwaveRate !== undefined) {
    result.heatwaveDamageAmount = resolvePipScaledDamage(meta.heatwaveDamage, definition.attack, meta.heatwaveDamageRate, meta.heatwaveDamageRatesByPip, pips);
  }

  if (meta.chainDamage !== undefined || meta.chainDamageRatesByPip !== undefined || meta.chainDamageRate !== undefined) {
    const chainTarget = target && !target.isDestroyed ? target : undefined;
    if (chainTarget) {
      result.chainTarget = chainTarget;
      result.chainDamageAmount = resolvePipScaledDamage(meta.chainDamage, definition.attack, meta.chainDamageRate, meta.chainDamageRatesByPip, pips);
    }
  }

  if (meta.summonType) {
    return result;
  }

  if (meta.meteorDamage !== undefined || meta.meteorCount !== undefined) {
    const meteorManaNeeded = activeSlot?.manaNeeded ?? (meta.activeManaNeeded ?? 7);
    if (currentMana >= meteorManaNeeded) {
      result.meteorStrike = {
        damage: meta.meteorDamage ?? 60,
        lavaDamage: meta.lavaDamage,
        lavaTurns: meta.activeDurationTurns ?? 3,
        meteorCount: Math.max(1, Math.floor(meta.meteorCount ?? 1)),
        meteorRandomOrientation: meta.meteorRandomOrientation ?? false,
        lavaPoolPattern: meta.lavaPoolPattern
      };
      return result;
    }
    result.needsMana = true;
    return result;
  }

  if (meta.instakill) {
    const instakillMana = activeSlot?.manaNeeded ?? 12;
    if (currentMana >= instakillMana && target) {
      result.instakill = {
        damage: 0,
        targetIsBoss: false,
        bossDamage: resolvePipScaledDamage(meta.bossDamage, definition.attack, meta.bossDamageRate, meta.bossDamageRatesByPip, pips)
      };
      return result;
    }
    result.needsMana = true;
    return result;
  }

  if (meta.transformToNextForm) {
    if (canCastActive) {
      result.transformToAlternateForm = true;
      return result;
    }
    if (manaNeeded > 0) result.needsMana = true;
    return result;
  }

  if (meta.pierceBehindDamage !== undefined) {
    if (canCastActive && target) {
      result.spearStrike = {
        damage: meta.activeDamage ?? 104,
        pierceDamage: meta.pierceBehindDamage ?? 208,
        pierceRange: meta.pierceBehindRange ?? 1
      };
    } else if (manaNeeded > 0) {
      result.needsMana = true;
    }
    return result;
  }

  if (meta.activeHeal !== undefined) {
    if (canCastActive && target) {
      result.healTarget = target;
      result.healAmount = Math.max(1, Math.ceil(meta.activeHeal));
    } else if (manaNeeded > 0) {
      result.needsMana = true;
    }
    return result;
  }

  if ((meta.shield ?? 0) > 0) {
    if (canCastActive) {
      result.shieldGain = Math.max(1, Math.ceil(meta.shield ?? 0));
      result.shieldTurns = meta.activeDurationTurns;
    } else if (manaNeeded > 0) {
      result.needsMana = true;
    }
    return result;
  }

  if (!canCastActive) {
    if (manaNeeded > 0) {
      result.needsMana = true;
    }
    return result;
  }

  result.statusEffect = meta.activeStatusEffect;

  if ((meta.activeDamage !== undefined || meta.activeDamageRate !== undefined || meta.activeDamageRatesByPip !== undefined)
    && meta.pierceBehindDamage === undefined && meta.meteorDamage === undefined && !meta.instakill
    && (target !== undefined || meta.hitsAllFoes === true || meta.hitsAllAllies === true)) {
    result.directDamage = {
      target: target ?? attacker,
      damage: resolvePipScaledDamage(meta.activeDamage, definition.attack, meta.activeDamageRate, meta.activeDamageRatesByPip, pips)
    };
    result.hitsAllFoes = meta.hitsAllFoes;
    result.hitsAllAllies = meta.hitsAllAllies;
  }

  if ((meta.attackCountIncrease ?? 0) > 0 && meta.activeDurationTurns !== undefined) {
    result.attackCountIncrease = meta.attackCountIncrease;
    result.extraAttacksTurns = meta.activeDurationTurns;
  }

  const allyBonus = meta.activeAllyExtraAttacks ?? meta.grantAttacksToAlly ?? 0;
  if (allyBonus > 0) {
    result.extraAttacksTurns = meta.activeDurationTurns;
    applyBonusAttacks(result, allyBonus);
    result.grantAttacksToAlly = allyBonus;
  }

  if ((meta.armorShredRate ?? 0) > 0 && meta.activeDurationTurns !== undefined && target && (meta.activeStatusEffect === 'fracture' || meta.activeStatusEffect === undefined)) {
    if (target) result.armorShredTarget = target;
    result.armorShredRate = meta.armorShredRate!;
    result.armorShredTurns = meta.activeDurationTurns;
  }

  if (meta.activeStatusEffect === 'poison' && target) {
    if (target) result.poisonTarget = target;
    result.poisonDamage = resolvePipScaledDamage(meta.poisonDamage, definition.attack, meta.poisonDamageRate, meta.poisonDamageRatesByPip, pips);
    result.poisonTurns = meta.activeDurationTurns ?? 1;
  }

  if ((meta.activeAttackDelta ?? 0) !== 0 && meta.activeDurationTurns !== undefined && target) {
    if (target) result.attackDeltaTarget = target;
    result.attackDelta = meta.activeAttackDelta!;
    result.attackDeltaTurns = meta.activeDurationTurns;
    result.attackDeltaMaxStacks = meta.activeMaxStacks;
  }

  return result;
}