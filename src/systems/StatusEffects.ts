import type { DiceInstanceState, DiceStatusEffect } from '../types/game';
import type { DungeonCarryoverStatuses } from './DungeonEvent';
import { formatCompact, formatPercent } from '../utils/FormatManager';

export interface StatusEffectApplication {
  source: DiceInstanceState;
  target: DiceInstanceState;
  effect: DiceStatusEffect;
  duration: number;
  damage?: number;
  delta?: number;
  rate?: number;
  maxStacks?: number;
  allFoes?: boolean;
}

export interface PoisonStack {
  damage: number;
  turns: number;
  sourceInstanceId?: string;
  sourceOwnerId?: 'player' | 'enemy';
  sourceTypeId?: string;
}

export interface IgnitionStack {
  rate: number;
  turns: number;
  sourceInstanceId?: string;
  sourceOwnerId?: 'player' | 'enemy';
  sourceTypeId?: string;
}

export interface SlowStack {
  delta: number;
  turns: number;
}

export interface TimeStatusStack {
  effect: 'acceleration' | 'dilation';
  turns: number;
  sourceInstanceId: string;
}

export interface SlowStatus {
  delta: number;
  turns: number;
  stacks?: SlowStack[];
}

export interface StatusPoisonSummary {
  damage: number;
  turns: number;
  stacks: number;
  stackDetails: Array<{ damage: number; turns: number }>;
}

export interface StatusIgnitionSummary {
  rate: number;
  turns: number;
  stacks: number;
  stackDetails: Array<{ rate: number; turns: number }>;
}

export interface StatusSlowSummary {
  delta: number;
  turns: number;
  stacks: number;
  stackDetails: SlowStack[];
}

export interface StatusEffectTick {
  effect: 'poison' | 'ignition';
  target: DiceInstanceState;
  source: DiceInstanceState;
  amount: number;
  stackCount: number;
  totalRate: number;
  bossReduced: boolean;
}

export type StatusEffectAnimation = 'ice' | 'fire' | 'poison' | 'fracture' | 'physical';

export interface StatusEffectHooks {
  getLiveDie: (instanceId: string) => DiceInstanceState | undefined;
  getSourceDie?: (instanceId: string) => DiceInstanceState | undefined;
  getBoardFoes: (ownerId: 'player' | 'enemy') => DiceInstanceState[];
  getDuration: (rawDuration: number) => number | undefined;
  getDamageMultiplier: (source: DiceInstanceState) => number;
  animate: (animation: StatusEffectAnimation, source: DiceInstanceState, target: DiceInstanceState) => void;
  onApplied: (source: DiceInstanceState, target: DiceInstanceState, effect: DiceStatusEffect, duration: number) => void;
  onAttackDelta: (target: DiceInstanceState, delta: number) => void;
  onAttackCountLoss: (target: DiceInstanceState, amount: number) => void;
  resolveIgnitionDamage: (target: DiceInstanceState, rate: number, isBoss: boolean) => number;
  isBoss: (target: DiceInstanceState) => boolean;
  runTick: (tick: StatusEffectTick) => Promise<void>;
}

export interface TauntEffectTarget {
  target: DiceInstanceState;
  duration: number;
}

export const STATUS_EFFECT_VISUALS: Record<DiceStatusEffect, {
  color: number;
  icon: string;
  iconColor?: string;
  fontSize?: string;
}> = {
  slow: { color: 0x8fd5ff, icon: '❄' },
  poison: { color: 0x74d66f, icon: '☠' },
  ignition: { color: 0xff6b35, icon: '🔥' },
  berserk: { color: 0xff4d4d, icon: '!' },
  taunt: { color: 0xffb347, icon: 'T' },
  fracture: { color: 0xffbf80, icon: '🜂' },
  stun: { color: 0xfff176, icon: 'S' },
  hibernation: { color: 0xd4f24a, icon: 'ZZZ', iconColor: '#3d7bff', fontSize: '5px' },
  acceleration: { color: 0x8fd5ff, icon: 'A' },
  dilation: { color: 0xb58cff, icon: 'D' },
  disorientation: { color: 0xc0c4cc, icon: '?' }
};

export const STATUS_EFFECT_ORDER: DiceStatusEffect[] = [
  'slow',
  'poison',
  'ignition',
  'berserk',
  'taunt',
  'fracture',
  'stun',
  'hibernation',
  'acceleration',
  'dilation',
  'disorientation'
];

function activePoisonStacks(stacks: PoisonStack[]): PoisonStack[] {
  return stacks.filter((stack) => stack.turns > 0);
}

function activeIgnitionStacks(stacks: IgnitionStack[]): IgnitionStack[] {
  return stacks.filter((stack) => stack.turns > 0);
}

function activeSlowStacks(status: SlowStatus | undefined): SlowStack[] {
  return status?.stacks?.filter((stack) => stack.turns > 0) ?? [];
}

function sourceForTick(
  target: DiceInstanceState,
  stack: { sourceInstanceId?: string; sourceOwnerId?: 'player' | 'enemy'; sourceTypeId?: string },
  getSourceDie: (instanceId: string) => DiceInstanceState | undefined,
  fallbackPrefix: 'poison' | 'ignition'
): DiceInstanceState {
  const source = stack.sourceInstanceId ? getSourceDie(stack.sourceInstanceId) : undefined;
  if (source) return source;
  return {
    ...target,
    instanceId: stack.sourceInstanceId ?? `${fallbackPrefix}:${stack.sourceTypeId ?? target.typeId}`,
    ownerId: stack.sourceOwnerId ?? target.ownerId,
    typeId: stack.sourceTypeId ?? target.typeId
  };
}

export class StatusEffectStore {
  readonly poisonByInstance = new Map<string, { stacks: PoisonStack[] }>();
  readonly ignitionByInstance = new Map<string, { stacks: IgnitionStack[] }>();
  readonly slowByInstance = new Map<string, SlowStatus>();
  readonly timeStatusByInstance = new Map<string, TimeStatusStack[]>();
  readonly fractureByInstance = new Map<string, { rate: number; turns: number }>();
  readonly stunByInstance = new Map<string, number>();
  readonly hibernationByInstance = new Map<string, number>();
  readonly disorientationByInstance = new Map<string, number>();
  readonly tauntByInstance = new Map<string, { sourceId: string; turns: number }>();

  clear() {
    this.poisonByInstance.clear();
    this.ignitionByInstance.clear();
    this.slowByInstance.clear();
    this.timeStatusByInstance.clear();
    this.fractureByInstance.clear();
    this.stunByInstance.clear();
    this.hibernationByInstance.clear();
    this.disorientationByInstance.clear();
    this.tauntByInstance.clear();
  }

  clearInstance(instanceId: string) {
    this.poisonByInstance.delete(instanceId);
    this.ignitionByInstance.delete(instanceId);
    this.slowByInstance.delete(instanceId);
    this.timeStatusByInstance.delete(instanceId);
    this.fractureByInstance.delete(instanceId);
    this.stunByInstance.delete(instanceId);
    this.hibernationByInstance.delete(instanceId);
    this.disorientationByInstance.delete(instanceId);
    this.tauntByInstance.delete(instanceId);
  }

  capture(instanceId: string): DungeonCarryoverStatuses {
    const poison = this.poisonByInstance.get(instanceId);
    const ignition = this.ignitionByInstance.get(instanceId);
    const slow = this.slowByInstance.get(instanceId);
    const time = this.timeStatusByInstance.get(instanceId);
    const fracture = this.fractureByInstance.get(instanceId);
    const stun = this.stunByInstance.get(instanceId);
    const hibernation = this.hibernationByInstance.get(instanceId);
    const disorientation = this.disorientationByInstance.get(instanceId);
    return {
      poison: poison ? {
        stacks: activePoisonStacks(poison.stacks).map((stack) => ({ ...stack }))
      } : undefined,
      ignition: ignition ? {
        stacks: activeIgnitionStacks(ignition.stacks).map((stack) => ({ ...stack }))
      } : undefined,
      slow: slow ? {
        ...slow,
        ...(slow.stacks ? { stacks: activeSlowStacks(slow).map((stack) => ({ ...stack })) } : {})
      } : undefined,
      time: time?.filter((status) => status.turns > 0).map((status) => ({ ...status })),
      fracture: fracture && fracture.turns > 0 ? { ...fracture } : undefined,
      stun: stun && stun > 0 ? stun : undefined,
      hibernation: hibernation && hibernation > 0 ? hibernation : undefined,
      disorientation: disorientation && disorientation > 0 ? disorientation : undefined
    };
  }

  restore(instanceId: string, statuses: DungeonCarryoverStatuses) {
    this.clearInstance(instanceId);
    const poisonStacks = statuses.poison?.stacks
      .filter((stack) => stack.turns > 0)
      .map((stack) => ({ ...stack })) ?? [];
    if (poisonStacks.length > 0) this.poisonByInstance.set(instanceId, { stacks: poisonStacks });

    const ignitionStacks = statuses.ignition?.stacks
      .filter((stack) => stack.turns > 0)
      .map((stack) => ({ ...stack })) ?? [];
    if (ignitionStacks.length > 0) this.ignitionByInstance.set(instanceId, { stacks: ignitionStacks });

    if (statuses.slow) {
      const stacks = statuses.slow.stacks?.filter((stack) => stack.turns > 0).map((stack) => ({ ...stack }));
      if (stacks?.length) {
        this.slowByInstance.set(instanceId, {
          delta: stacks.reduce((sum, stack) => sum + stack.delta, 0),
          turns: Math.max(...stacks.map((stack) => stack.turns)),
          stacks
        });
      } else if (statuses.slow.stacks === undefined && statuses.slow.turns > 0) {
        this.slowByInstance.set(instanceId, { ...statuses.slow });
      }
    }

    const time = statuses.time?.filter((status) => status.turns > 0).map((status) => ({ ...status })) ?? [];
    if (time.length > 0) this.timeStatusByInstance.set(instanceId, time);
    if (statuses.fracture && statuses.fracture.turns > 0) {
      this.fractureByInstance.set(instanceId, { ...statuses.fracture });
    }
    if (statuses.stun && statuses.stun > 0) this.stunByInstance.set(instanceId, statuses.stun);
    if (statuses.hibernation && statuses.hibernation > 0) this.hibernationByInstance.set(instanceId, statuses.hibernation);
    if (statuses.disorientation && statuses.disorientation > 0) {
      this.disorientationByInstance.set(instanceId, statuses.disorientation);
    }
  }

  apply(applications: StatusEffectApplication[] | undefined, hooks: StatusEffectHooks) {
    if (!applications?.length) return;
    const expandedApplications = applications.flatMap((application) => {
      if (!application.allFoes) return [application];
      return hooks.getBoardFoes(application.source.ownerId)
        .map((target) => ({ ...application, target }));
    });
    const lostAttackCountsByInstance = new Map<string, { die: DiceInstanceState; amount: number }>();

    expandedApplications.forEach((application) => {
      const target = hooks.getLiveDie(application.target.instanceId);
      if (!target) return;
      const duration = hooks.getDuration(application.duration);
      if (duration === undefined) return;
      let applied = false;

      if (application.effect === 'poison' && application.damage !== undefined) {
        const damage = Math.max(1, Math.floor(application.damage * hooks.getDamageMultiplier(application.source)));
        const existing = this.poisonByInstance.get(target.instanceId);
        this.poisonByInstance.set(target.instanceId, {
          stacks: [...(existing?.stacks ?? []), {
            damage,
            turns: duration,
            sourceInstanceId: application.source.instanceId,
            sourceOwnerId: application.source.ownerId,
            sourceTypeId: application.source.typeId
          }]
        });
        hooks.animate('poison', application.source, target);
        applied = true;
      } else if (application.effect === 'ignition' && application.rate !== undefined && application.rate > 0) {
        const rate = Math.max(0, Math.min(1, application.rate));
        const existing = this.ignitionByInstance.get(target.instanceId);
        this.ignitionByInstance.set(target.instanceId, {
          stacks: [...(existing?.stacks ?? []), {
            rate,
            turns: duration,
            sourceInstanceId: application.source.instanceId,
            sourceOwnerId: application.source.ownerId,
            sourceTypeId: application.source.typeId
          }]
        });
        hooks.animate('fire', application.source, target);
        applied = true;
      } else if (application.effect === 'slow' && application.delta !== undefined) {
        const current = this.slowByInstance.get(target.instanceId);
        const currentStacks = activeSlowStacks(current);
        const maxStacks = Math.max(1, Math.floor(application.maxStacks ?? 1));
        const nextStacks = [...currentStacks, { delta: application.delta, turns: duration }].slice(-maxStacks);
        const previousDelta = current?.delta ?? 0;
        const nextDelta = nextStacks.reduce((sum, stack) => sum + stack.delta, 0);
        const appliedDelta = nextDelta - previousDelta;
        this.slowByInstance.set(target.instanceId, {
          delta: nextDelta,
          turns: Math.max(...nextStacks.map((stack) => stack.turns)),
          stacks: nextStacks
        });
        hooks.onAttackDelta(target, appliedDelta);
        if (appliedDelta < 0) {
          const lost = lostAttackCountsByInstance.get(target.instanceId) ?? { die: target, amount: 0 };
          lost.amount += Math.abs(appliedDelta);
          lostAttackCountsByInstance.set(target.instanceId, lost);
        }
        hooks.animate('ice', application.source, target);
        applied = true;
      } else if (application.effect === 'fracture' && application.rate !== undefined) {
        this.fractureByInstance.set(target.instanceId, { rate: application.rate, turns: duration });
        hooks.animate('fracture', application.source, target);
        applied = true;
      } else if (application.effect === 'stun') {
        this.stunByInstance.set(target.instanceId, duration);
        hooks.animate('ice', application.source, target);
        applied = true;
      } else if (application.effect === 'hibernation') {
        this.hibernationByInstance.set(target.instanceId, duration);
        hooks.animate('ice', application.source, target);
        applied = true;
      } else if (application.effect === 'taunt') {
        this.tauntByInstance.set(target.instanceId, { sourceId: application.source.instanceId, turns: duration });
        hooks.animate('physical', application.source, target);
        applied = true;
      } else if (application.effect === 'disorientation') {
        this.disorientationByInstance.set(target.instanceId, duration);
        hooks.animate('ice', application.source, target);
        applied = true;
      } else if (application.effect === 'acceleration' || application.effect === 'dilation') {
        const existing = this.timeStatusByInstance.get(target.instanceId) ?? [];
        this.timeStatusByInstance.set(target.instanceId, [
          ...existing,
          { effect: application.effect, turns: duration, sourceInstanceId: application.source.instanceId }
        ]);
        applied = true;
      }

      if (!applied) return;
      hooks.onApplied(application.source, target, application.effect, duration);
    });

    lostAttackCountsByInstance.forEach(({ die, amount }) => hooks.onAttackCountLoss(die, amount));
  }

  decayRoundStatuses() {
    this.tauntByInstance.forEach((value, key) => {
      const turns = value.turns - 1;
      if (turns <= 0) this.tauntByInstance.delete(key);
      else this.tauntByInstance.set(key, { ...value, turns });
    });
    this.timeStatusByInstance.forEach((statuses, key) => {
      const nextStatuses = statuses
        .map((status) => ({ ...status, turns: status.turns - 1 }))
        .filter((status) => status.turns > 0);
      if (nextStatuses.length === 0) this.timeStatusByInstance.delete(key);
      else this.timeStatusByInstance.set(key, nextStatuses);
    });
    this.slowByInstance.forEach((value, key) => {
      if (value.stacks?.length) {
        const nextStacks = value.stacks
          .map((stack) => ({ ...stack, turns: stack.turns - 1 }))
          .filter((stack) => stack.turns > 0);
        if (nextStacks.length === 0) {
          this.slowByInstance.delete(key);
        } else {
          this.slowByInstance.set(key, {
            delta: nextStacks.reduce((sum, stack) => sum + stack.delta, 0),
            turns: Math.max(...nextStacks.map((stack) => stack.turns)),
            stacks: nextStacks
          });
        }
        return;
      }
      const nextTurns = value.turns - 1;
      if (nextTurns <= 0) this.slowByInstance.delete(key);
      else this.slowByInstance.set(key, { ...value, turns: nextTurns });
    });
  }

  async tickPoison(hooks: StatusEffectHooks): Promise<void> {
    for (const [instanceId, effect] of [...this.poisonByInstance.entries()]) {
      const activeStacks = activePoisonStacks(effect.stacks);
      if (activeStacks.length === 0) {
        this.poisonByInstance.delete(instanceId);
        continue;
      }
      const target = hooks.getLiveDie(instanceId);
      if (target) {
        const sourceStack = activeStacks[0]!;
        await hooks.runTick({
          effect: 'poison',
          target,
          source: sourceForTick(target, sourceStack, hooks.getSourceDie ?? hooks.getLiveDie, 'poison'),
          amount: Math.max(1, Math.floor(activeStacks.reduce((sum, stack) => sum + stack.damage, 0))),
          stackCount: activeStacks.length,
          totalRate: 0,
          bossReduced: false
        });
      }
      const nextStacks = activeStacks
        .map((stack) => ({ ...stack, turns: stack.turns - 1 }))
        .filter((stack) => stack.turns > 0);
      if (nextStacks.length > 0) this.poisonByInstance.set(instanceId, { stacks: nextStacks });
      else this.poisonByInstance.delete(instanceId);
    }
  }

  async tickIgnition(hooks: StatusEffectHooks): Promise<void> {
    for (const [instanceId, effect] of [...this.ignitionByInstance.entries()]) {
      const activeStacks = activeIgnitionStacks(effect.stacks);
      if (activeStacks.length === 0) {
        this.ignitionByInstance.delete(instanceId);
        continue;
      }
      const target = hooks.getLiveDie(instanceId);
      if (target) {
        const totalRate = activeStacks.reduce((sum, stack) => sum + stack.rate, 0);
        const isBoss = hooks.isBoss(target);
        const sourceStack = activeStacks[0]!;
        await hooks.runTick({
          effect: 'ignition',
          target,
          source: sourceForTick(target, sourceStack, hooks.getSourceDie ?? hooks.getLiveDie, 'ignition'),
          amount: hooks.resolveIgnitionDamage(target, totalRate, isBoss),
          stackCount: activeStacks.length,
          totalRate,
          bossReduced: isBoss
        });
      }
      const nextStacks = activeStacks
        .map((stack) => ({ ...stack, turns: stack.turns - 1 }))
        .filter((stack) => stack.turns > 0);
      if (nextStacks.length > 0) this.ignitionByInstance.set(instanceId, { stacks: nextStacks });
      else this.ignitionByInstance.delete(instanceId);
    }
  }

  getPoisonSummary(instanceId: string): StatusPoisonSummary | undefined {
    const poison = this.poisonByInstance.get(instanceId);
    if (!poison) return undefined;
    const stacks = activePoisonStacks(poison.stacks);
    if (stacks.length === 0) return undefined;
    return {
      damage: stacks.reduce((sum, stack) => sum + stack.damage, 0),
      turns: Math.max(...stacks.map((stack) => stack.turns)),
      stacks: stacks.length,
      stackDetails: stacks.map((stack) => ({ damage: stack.damage, turns: stack.turns }))
    };
  }

  getIgnitionSummary(instanceId: string): StatusIgnitionSummary | undefined {
    const ignition = this.ignitionByInstance.get(instanceId);
    if (!ignition) return undefined;
    const stacks = activeIgnitionStacks(ignition.stacks);
    if (stacks.length === 0) return undefined;
    return {
      rate: stacks.reduce((sum, stack) => sum + stack.rate, 0),
      turns: Math.max(...stacks.map((stack) => stack.turns)),
      stacks: stacks.length,
      stackDetails: stacks.map((stack) => ({ rate: stack.rate, turns: stack.turns }))
    };
  }

  getSlowSummary(instanceId: string): StatusSlowSummary | undefined {
    const slow = this.slowByInstance.get(instanceId);
    if (!slow) return undefined;
    const stacks = activeSlowStacks(slow);
    if (stacks.length === 0) {
      return {
        delta: slow.delta,
        turns: slow.turns,
        stacks: Math.abs(slow.delta) > 0 ? 1 : 0,
        stackDetails: [{ delta: slow.delta, turns: slow.turns }]
      };
    }
    return {
      delta: stacks.reduce((sum, stack) => sum + stack.delta, 0),
      turns: Math.max(...stacks.map((stack) => stack.turns)),
      stacks: stacks.length,
      stackDetails: stacks
    };
  }

  getStatusStackCount(instanceId: string, effect: DiceStatusEffect, berserkActive = false): number {
    if (effect === 'disorientation') return (this.disorientationByInstance.get(instanceId) ?? 0) > 0 ? 1 : 0;
    if (effect === 'poison') return this.getPoisonSummary(instanceId)?.stacks ?? 0;
    if (effect === 'ignition') return this.getIgnitionSummary(instanceId)?.stacks ?? 0;
    if (effect === 'slow') return this.getSlowSummary(instanceId)?.stacks ?? 0;
    if (effect === 'fracture') return this.fractureByInstance.has(instanceId) ? 1 : 0;
    if (effect === 'taunt') return this.tauntByInstance.has(instanceId) ? 1 : 0;
    if (effect === 'stun') return (this.stunByInstance.get(instanceId) ?? 0) > 0 ? 1 : 0;
    if (effect === 'hibernation') return (this.hibernationByInstance.get(instanceId) ?? 0) > 0 ? 1 : 0;
    if (effect === 'acceleration' || effect === 'dilation') {
      return (this.timeStatusByInstance.get(instanceId) ?? [])
        .filter((status) => status.effect === effect && status.turns > 0)
        .length;
    }
    return berserkActive ? 1 : 0;
  }

  getStatusEffects(instanceId: string, berserkActive = false): DiceStatusEffect[] {
    return STATUS_EFFECT_ORDER.filter((effect) => {
      if (effect === 'slow') return (this.getSlowSummary(instanceId)?.delta ?? 0) < 0;
      return this.getStatusStackCount(instanceId, effect, berserkActive) > 0;
    });
  }

  getSummaryLines(instanceId: string): string[] {
    const statusLines: string[] = [];
    const slow = this.getSlowSummary(instanceId);
    if (slow && slow.delta < 0) {
      const stackText = slow.stacks > 1 ? ` x${slow.stacks}` : '';
      const details = slow.stackDetails
        .map((stack) => `${stack.delta} attack${Math.abs(stack.delta) === 1 ? '' : 's'} (${stack.turns} turns)`)
        .join(', ');
      statusLines.push(slow.stacks > 1 ? `Slow${stackText}: ${details}` : `Slow ${details}`);
    }
    const poison = this.getPoisonSummary(instanceId);
    if (poison) {
      const stackText = poison.stacks > 1 ? ` x${poison.stacks}` : '';
      const details = poison.stackDetails
        .map((stack) => `${formatCompact(stack.damage)}/turn (${stack.turns} turns)`)
        .join(', ');
      statusLines.push(`Poison${stackText}: ${details}`);
    }
    const ignition = this.getIgnitionSummary(instanceId);
    if (ignition) {
      const stackText = ignition.stacks > 1 ? ` x${ignition.stacks}` : '';
      const details = ignition.stackDetails
        .map((stack) => `${formatPercent(stack.rate)} max HP/turn (${stack.turns} turns)`)
        .join(', ');
      statusLines.push(`Ignition${stackText}: ${details}`);
    }
    const timeStatuses = this.timeStatusByInstance.get(instanceId) ?? [];
    (['acceleration', 'dilation'] as const).forEach((effect) => {
      const active = timeStatuses.filter((status) => status.effect === effect && status.turns > 0);
      if (active.length === 0) return;
      const label = effect === 'acceleration' ? 'Acceleration' : 'Dilation';
      const turns = Math.max(...active.map((status) => status.turns));
      statusLines.push(`${label}${active.length > 1 ? ` x${active.length}` : ''} (${turns} turn${turns === 1 ? '' : 's'})`);
    });
    const fracture = this.fractureByInstance.get(instanceId);
    if (fracture) statusLines.push(`Fracture +${formatPercent(fracture.rate)} damage taken (${fracture.turns} turns)`);
    if (this.tauntByInstance.has(instanceId)) statusLines.push('Taunt');
    const disorientationTurns = this.disorientationByInstance.get(instanceId);
    if (disorientationTurns !== undefined) {
      statusLines.push(`Disorientation (${disorientationTurns} turn${disorientationTurns === 1 ? '' : 's'})`);
    }
    const stunTurns = this.stunByInstance.get(instanceId);
    if (stunTurns) statusLines.push(`Stun (${stunTurns} turns)`);
    const hibernationTurns = this.hibernationByInstance.get(instanceId);
    if (hibernationTurns) statusLines.push(`Hibernation (${hibernationTurns} turn${hibernationTurns === 1 ? '' : 's'})`);
    return statusLines;
  }

  getStunTurns(instanceId: string): number {
    return this.stunByInstance.get(instanceId) ?? 0;
  }

  getHibernationTurns(instanceId: string): number {
    return this.hibernationByInstance.get(instanceId) ?? 0;
  }

  consumeStunTurn(instanceId: string): boolean {
    const turns = this.stunByInstance.get(instanceId) ?? 0;
    if (turns <= 0) return false;
    if (turns <= 1) this.stunByInstance.delete(instanceId);
    else this.stunByInstance.set(instanceId, turns - 1);
    return true;
  }

  consumeHibernationTurn(instanceId: string): boolean {
    const turns = this.hibernationByInstance.get(instanceId) ?? 0;
    if (turns <= 0) return false;
    if (turns <= 1) this.hibernationByInstance.delete(instanceId);
    else this.hibernationByInstance.set(instanceId, turns - 1);
    return true;
  }

  wakeHibernation(instanceId: string): boolean {
    return this.hibernationByInstance.delete(instanceId);
  }

  applyTaunt(targetId: string, sourceId: string, turns: number) {
    this.tauntByInstance.set(targetId, { sourceId, turns });
  }

  applyDisorientation(instanceId: string, turns: number) {
    this.disorientationByInstance.set(instanceId, turns);
  }

  consumeDisorientationTurn(instanceId: string): boolean {
    const turns = this.disorientationByInstance.get(instanceId) ?? 0;
    if (turns <= 0) return false;
    if (turns <= 1) this.disorientationByInstance.delete(instanceId);
    else this.disorientationByInstance.set(instanceId, turns - 1);
    return true;
  }

  setTimeStatuses(instanceId: string, statuses: TimeStatusStack[]) {
    if (statuses.length === 0) this.timeStatusByInstance.delete(instanceId);
    else this.timeStatusByInstance.set(instanceId, statuses);
  }

  getSlowDelta(instanceId: string): number {
    return this.slowByInstance.get(instanceId)?.delta ?? 0;
  }

  getDisorientationTurns(instanceId: string): number {
    return this.disorientationByInstance.get(instanceId) ?? 0;
  }

  getTaunt(instanceId: string): { sourceId: string; turns: number } | undefined {
    return this.tauntByInstance.get(instanceId);
  }

  hasFracture(instanceId: string): boolean {
    return this.fractureByInstance.has(instanceId);
  }

  getFracture(instanceId: string): { rate: number; turns: number } | undefined {
    return this.fractureByInstance.get(instanceId);
  }

  applyStun(instanceId: string, turns: number) {
    this.stunByInstance.set(instanceId, turns);
  }

  clearTaunts() {
    this.tauntByInstance.clear();
  }

  applyTauntEffects(
    sources: readonly DiceInstanceState[],
    resolveTargets: (source: DiceInstanceState) => readonly TauntEffectTarget[],
    hooks: Pick<StatusEffectHooks, 'onApplied'>
  ) {
    this.clearTaunts();
    sources.forEach((source) => {
      resolveTargets(source).forEach(({ target, duration }) => {
        if (duration <= 0) return;
        this.applyTaunt(target.instanceId, source.instanceId, duration);
        hooks.onApplied(source, target, 'taunt', duration);
      });
    });
  }

  decayFracture() {
    this.fractureByInstance.forEach((effect, instanceId) => {
      const turns = effect.turns - 1;
      if (turns <= 0) this.fractureByInstance.delete(instanceId);
      else this.fractureByInstance.set(instanceId, { ...effect, turns });
    });
  }
}
