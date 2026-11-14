import type { DiceDefinition, DiceInstanceState } from '../types/game';
import { applyTransformStats, getTransformRecoveryRate } from './ClassProgression';
import { getAvailableTransformIndices, getInitialTransformIndex, getPipTriggeredTransformIndex, getRuntimeSkillMeta, matchesTransformPipTrigger } from './DiceSkills';

export interface TransformStateHost {
  getDefinitionForInstance(die: DiceInstanceState): DiceDefinition | undefined;
  getBaseDefinitionForInstance(die: DiceInstanceState): DiceDefinition | undefined;
  getCombatBaseDefinition(die: DiceInstanceState): DiceDefinition | undefined;
  getClassLevel(instanceId: string): number;
  applyDungeonCardDefinitionForOwner(definition: DiceDefinition, ownerId: DiceInstanceState['ownerId'], classLevel: number): DiceDefinition;
  getDiceCardMaxHealthForDefinition(definition: DiceDefinition, ownerId: DiceInstanceState['ownerId']): number;
  getTransformDurationBonus(die: DiceInstanceState): number;
  getDie(instanceId: string): DiceInstanceState | undefined;
  updateDie(instanceId: string, update: (die: DiceInstanceState) => DiceInstanceState): DiceInstanceState | undefined;
  setDefinitionOverride(instanceId: string, definition: DiceDefinition): void;
  resetActiveMana(instanceId: string): void;
  writeCombatLog(message: string): void;
  applyOnTransformedSkillEffects(die: DiceInstanceState): void;
  animateTransformEffect(die: DiceInstanceState): void;
  getCombatDieName(die: DiceInstanceState): string;
}

export function getTransformIndexForActiveDefinition(
  baseDefinition: DiceDefinition,
  currentIndex?: number
): number | undefined {
  const available = getAvailableTransformIndices(baseDefinition);
  if (available.length === 0) return undefined;
  if (currentIndex !== undefined && available.includes(currentIndex)) {
    return available.find((index) => index > currentIndex) ?? currentIndex;
  }
  return available[0];
}

export function getTransformIndexForFlag(
  definition: DiceDefinition,
  flag: string,
  capability?: (skill: DiceDefinition['skills'][number]) => boolean
): number | undefined {
  const index = definition.transformFlags?.indexOf(flag) ?? -1;
  const stats = index >= 0 ? definition.transformStats?.[index] : undefined;
  const registered = getRuntimeSkillMeta(definition).transformFlags.includes(flag);
  if (!stats || !registered) return undefined;
  if (capability && !stats.skills?.some(capability)) return undefined;
  return index;
}

export class TransformState {
  private readonly indexByInstance = new Map<string, number>();
  private readonly pipTriggeredThisTurn = new Set<string>();
  private readonly durationByInstance = new Map<string, number>();

  constructor(private readonly host: TransformStateHost) {}

  reset(): void {
    this.indexByInstance.clear();
    this.pipTriggeredThisTurn.clear();
    this.durationByInstance.clear();
  }

  getIndex(instanceId: string): number | undefined {
    return this.indexByInstance.get(instanceId);
  }

  hasIndex(instanceId: string): boolean {
    return this.indexByInstance.has(instanceId);
  }

  isPermanent(instanceId: string): boolean {
    return this.indexByInstance.has(instanceId) && !this.durationByInstance.has(instanceId);
  }

  isTimed(instanceId: string): boolean {
    return this.durationByInstance.has(instanceId);
  }

  setIndex(instanceId: string, transformIndex: number): void {
    this.indexByInstance.set(instanceId, transformIndex);
  }

  clearInstance(instanceId: string): void {
    this.indexByInstance.delete(instanceId);
    this.durationByInstance.delete(instanceId);
  }

  wasPipTriggered(instanceId: string): boolean {
    return this.pipTriggeredThisTurn.has(instanceId);
  }

  clearPipTriggers(): void {
    this.pipTriggeredThisTurn.clear();
  }

  getFlags(die: DiceInstanceState, definition = this.host.getDefinitionForInstance(die)): { isTransformed: boolean } {
    if (!definition) return { isTransformed: false };
    const baseDefinition = this.host.getBaseDefinitionForInstance(die) ?? definition;
    const activeIndex = this.indexByInstance.get(die.instanceId);
    return { isTransformed: activeIndex !== undefined && Boolean(baseDefinition.transformStats?.[activeIndex]) };
  }

  getTransformedVisual(die: DiceInstanceState): { accent: string; symbol?: string } | null {
    const definition = this.host.getDefinitionForInstance(die);
    const baseDefinition = this.host.getBaseDefinitionForInstance(die);
    if (!definition || !baseDefinition) return null;
    const meta = getRuntimeSkillMeta(baseDefinition);
    const transformIndex = this.indexByInstance.get(die.instanceId);
    if (transformIndex === undefined) return null;
    const transformedStats = baseDefinition.transformStats?.[transformIndex];
    const transformFlag = baseDefinition.transformFlags?.[transformIndex];
    if (!transformedStats || !transformFlag || !meta.transformFlags.includes(transformFlag)) return null;
    return {
      accent: transformedStats.accent ?? baseDefinition.accent,
      symbol: transformedStats.symbol
    };
  }

  tickDurations(): void {
    this.durationByInstance.forEach((duration, instanceId) => {
      const nextDuration = duration - 1;
      if (nextDuration <= 0) this.expireTransform(instanceId);
      else this.durationByInstance.set(instanceId, nextDuration);
    });
  }

  applyRootStats(die: DiceInstanceState, transformIndex = 0): DiceInstanceState {
    const baseDefinition = this.host.getCombatBaseDefinition(die) ?? this.host.getDefinitionForInstance(die);
    if (!baseDefinition || getInitialTransformIndex(this.host.getBaseDefinitionForInstance(die) ?? baseDefinition) === undefined) return die;
    if (!baseDefinition.transformStats?.[transformIndex]) return die;
    const transformedDefinition = applyTransformStats(baseDefinition, transformIndex);
    const recoveryRate = getTransformRecoveryRate(this.host.getBaseDefinitionForInstance(die) ?? baseDefinition, transformIndex) ?? 0;
    this.host.setDefinitionOverride(die.instanceId, transformedDefinition);
    const updated = this.host.updateDie(die.instanceId, (candidate) => {
      const maxHealth = this.host.applyDungeonCardDefinitionForOwner(
        transformedDefinition,
        die.ownerId,
        this.host.getClassLevel(die.instanceId)
      ).health;
      const currentHealth = Math.min(
        maxHealth,
        Math.max(0, candidate.currentHealth) + Math.floor(maxHealth * recoveryRate)
      );
      return { ...candidate, maxHealth, currentHealth };
    });
    return updated ?? die;
  }

  transformToAlternateForm(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const definition = this.host.getDefinitionForInstance(attacker);
    const baseDefinition = this.host.getBaseDefinitionForInstance(attacker) ?? definition;
    if (!definition || !baseDefinition || getInitialTransformIndex(baseDefinition) === undefined) return undefined;
    const instanceId = attacker.instanceId;
    const transformIndex = getTransformIndexForActiveDefinition(
      baseDefinition,
      this.indexByInstance.get(instanceId)
    );
    if (transformIndex === undefined) return undefined;
    const transformedBase = applyTransformStats(
      this.host.getCombatBaseDefinition(attacker) ?? baseDefinition,
      transformIndex
    );
    this.indexByInstance.set(instanceId, transformIndex);
    this.setDuration(instanceId, baseDefinition, transformIndex);
    const recoveryRate = getTransformRecoveryRate(baseDefinition, transformIndex) ?? 0;
    const effectiveMaxHealth = this.host.applyDungeonCardDefinitionForOwner(
      transformedBase,
      attacker.ownerId,
      this.host.getClassLevel(attacker.instanceId)
    ).health;
    this.host.setDefinitionOverride(instanceId, transformedBase);
    this.host.updateDie(instanceId, (die) => ({
      ...die,
      maxHealth: effectiveMaxHealth,
      currentHealth: Math.min(
        effectiveMaxHealth,
        Math.max(0, die.currentHealth) + Math.floor(effectiveMaxHealth * recoveryRate)
      )
    }));
    const transformed = this.host.getDie(instanceId) ?? attacker;
    this.host.writeCombatLog(
      `${this.host.getCombatDieName(attacker)} transforms into ${definition.transformStats?.[transformIndex]?.title ?? 'its alternate form'}!`
    );
    this.host.applyOnTransformedSkillEffects(transformed);
    this.host.animateTransformEffect(transformed);
    return transformed;
  }

  transformFromSoulCap(deathDie: DiceInstanceState): DiceInstanceState | undefined {
    const definition = this.host.getDefinitionForInstance(deathDie);
    const baseDefinition = this.host.getBaseDefinitionForInstance(deathDie) ?? definition;
    if (!baseDefinition || getRuntimeSkillMeta(baseDefinition).transformSoulCount === undefined) return undefined;
    const currentIndex = this.indexByInstance.get(deathDie.instanceId);
    if (currentIndex !== undefined) {
      this.setDuration(deathDie.instanceId, baseDefinition, currentIndex);
      return this.host.getDie(deathDie.instanceId);
    }
    const transformIndex = getTransformIndexForFlag(
      baseDefinition,
      'instakillForm',
      (skill) => skill.modifiers?.instakill === true
    );
    if (transformIndex === undefined) return undefined;
    this.indexByInstance.set(deathDie.instanceId, transformIndex);
    this.setDuration(deathDie.instanceId, baseDefinition, transformIndex);
    const transformedDefinition = applyTransformStats(
      this.host.getCombatBaseDefinition(deathDie) ?? baseDefinition,
      transformIndex
    );
    const recoveryRate = getTransformRecoveryRate(baseDefinition, transformIndex) ?? 1;
    this.host.setDefinitionOverride(deathDie.instanceId, transformedDefinition);
    const transformed = this.host.updateDie(deathDie.instanceId, (die) => {
      const maxHealth = this.host.applyDungeonCardDefinitionForOwner(
        transformedDefinition,
        deathDie.ownerId,
        this.host.getClassLevel(deathDie.instanceId)
      ).health;
      const currentHealth = Math.min(
        maxHealth,
        Math.max(0, die.currentHealth) + Math.floor(maxHealth * recoveryRate)
      );
      return { ...die, maxHealth, currentHealth };
    }) ?? deathDie;
    this.host.resetActiveMana(deathDie.instanceId);
    const transformedTitle = baseDefinition.transformStats?.[transformIndex]?.title ?? 'its alternate form';
    this.host.writeCombatLog(`${this.host.getCombatDieName(deathDie)} transforms into ${transformedTitle}!`);
    this.host.applyOnTransformedSkillEffects(deathDie);
    this.host.animateTransformEffect(deathDie);
    return transformed;
  }

  tryAdvancePipTriggeredTransform(die: DiceInstanceState, pips: number): DiceInstanceState | undefined {
    const definition = this.host.getDefinitionForInstance(die);
    const baseDefinition = this.host.getBaseDefinitionForInstance(die) ?? definition;
    if (!definition || !baseDefinition?.transformStats?.length) return undefined;
    const currentIndex = this.indexByInstance.get(die.instanceId) ?? -1;
    const transformIndex = getPipTriggeredTransformIndex(baseDefinition, pips, currentIndex);
    if (transformIndex === undefined || transformIndex === currentIndex) {
      if (currentIndex >= 0 && this.matchesCurrentPipTrigger(baseDefinition, pips, currentIndex)) {
        this.setDuration(die.instanceId, baseDefinition, currentIndex);
        this.pipTriggeredThisTurn.add(die.instanceId);
      }
      return undefined;
    }
    const transformFlag = baseDefinition.transformFlags?.[transformIndex];
    const meta = getRuntimeSkillMeta(baseDefinition);
    if (!transformFlag || !meta.transformFlags.includes(transformFlag)) return undefined;
    this.indexByInstance.set(die.instanceId, transformIndex);
    this.pipTriggeredThisTurn.add(die.instanceId);
    this.setDuration(die.instanceId, baseDefinition, transformIndex);
    const transformed = this.applyRootStats(die, transformIndex);
    this.host.applyOnTransformedSkillEffects(transformed);
    this.host.animateTransformEffect(transformed);
    const triggerLabel = pips % 2 === 1 ? 'odd' : 'even';
    this.host.writeCombatLog(
      `${this.host.getCombatDieName(die)} advances into ${baseDefinition.transformStats?.[transformIndex]?.title ?? 'its alternate form'} on an ${triggerLabel} roll (${pips}♦)!`
    );
    return transformed;
  }

  reconcilePipTriggeredTransform(die: DiceInstanceState, pips: number): void {
    const currentIndex = this.indexByInstance.get(die.instanceId);
    if (currentIndex === undefined || !this.pipTriggeredThisTurn.has(die.instanceId)) return;
    const baseDefinition = this.host.getBaseDefinitionForInstance(die) ?? this.host.getDefinitionForInstance(die);
    if (!baseDefinition?.transformStats?.length) return;
    const stillValid = getPipTriggeredTransformIndex(baseDefinition, pips, currentIndex - 1);
    if (stillValid === currentIndex) return;
    this.expireTransform(die.instanceId);
    this.pipTriggeredThisTurn.delete(die.instanceId);
  }

  private matchesCurrentPipTrigger(definition: DiceDefinition, pips: number, transformIndex: number): boolean {
    if (pips <= 0) return false;
    if (getPipTriggeredTransformIndex(definition, pips, transformIndex - 1) === transformIndex) return true;
    return matchesTransformPipTrigger(definition, pips, transformIndex)
      || matchesTransformPipTrigger(definition, pips);
  }

  private setDuration(instanceId: string, definition: DiceDefinition, transformIndex: number): void {
    const duration = definition.transformStats?.[transformIndex]?.transformDuration;
    if (duration !== undefined && Number.isFinite(duration) && duration >= 0) {
      const die = this.host.getDie(instanceId);
      const bonus = die ? this.host.getTransformDurationBonus(die) : 0;
      const safeBonus = Number.isFinite(bonus) ? Math.max(0, Math.floor(bonus)) : 0;
      this.durationByInstance.set(instanceId, Math.floor(duration) + safeBonus);
    } else {
      this.durationByInstance.delete(instanceId);
    }
  }

  private expireTransform(instanceId: string): void {
    const die = this.host.getDie(instanceId);
    const base = die ? this.host.getCombatBaseDefinition(die) : undefined;
    if (die && base) {
      const effectiveDefinition = this.host.applyDungeonCardDefinitionForOwner(
        base,
        die.ownerId,
        this.host.getClassLevel(instanceId)
      );
      const effectiveMaxHealth = this.host.getDiceCardMaxHealthForDefinition(effectiveDefinition, die.ownerId);
      this.host.setDefinitionOverride(instanceId, base);
      this.host.updateDie(instanceId, (candidate) => ({
        ...candidate,
        maxHealth: effectiveMaxHealth,
        currentHealth: Math.min(effectiveMaxHealth, candidate.currentHealth)
      }));
    }
    this.indexByInstance.delete(instanceId);
    this.durationByInstance.delete(instanceId);
  }
}
