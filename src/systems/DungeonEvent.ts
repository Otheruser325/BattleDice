import type { DiceRarity } from '../types/game';
import { normalizeDiceCardCarryover, type DiceCard } from './DiceCards';
import { normalizeDungeonCardState, type DungeonCardState } from './DungeonCards';

const DUNGEON_BOARD_CELLS = 25;
export const DUNGEON_MAX_WAVES = 50;
export const DUNGEON_DAILY_TICKETS = 5;
export const DUNGEON_BOSSES = ['Deucifer', 'Basilisk', 'Leon', 'Magician', 'Silence'] as const;
export type DungeonBossMinionType = 'Imp' | 'Wizard';
export const DUNGEON_MINI_BOSSES = ['Imp', 'Wizard'] as const satisfies readonly DungeonBossMinionType[];
export const DUNGEON_REWARD_WAVES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const;

export const DUNGEON_FIRST_EVENT_KEY = '2026-11-03';
export type DungeonModifier = 'Classic' | 'Combanity' | 'DiceCard' | 'Duality' | 'Necromancy';
export const DUNGEON_MODIFIERS: readonly DungeonModifier[] = ['Classic', 'Combanity', 'DiceCard', 'Duality', 'Necromancy'];

export type DungeonBossType = (typeof DUNGEON_BOSSES)[number];
export type DungeonBossRole = 'mini' | 'major';
export type DungeonDifficulty = 'normal' | 'death-wave' | 'boss-berserk';
export type DungeonRewardKind = 'tokens' | 'chips' | 'diamonds' | 'copies';

export const DUNGEON_BOSS_BERSERK_SKILL_MULTIPLIER = 1.5;
export const DUNGEON_MAX_CLASS_LEVEL = 15;
export const DUNGEON_CARRYOVER_STAT_CAP = Number.MAX_VALUE;
export const DUNGEON_CARRYOVER_MANA_CAP = 1_000_000;
export const DUNGEON_CARRYOVER_COUNT_CAP = 999;
export const DUNGEON_CARRYOVER_TURNS_CAP = 999;
export const DUNGEON_CARRYOVER_DICE_CAP = 99;
export const DUNGEON_CARRYOVER_STACK_CAP = 99;
const DUNGEON_CARRYOVER_ACTIVE_MANA_CAP = 32;
const DUNGEON_CARRYOVER_TURN_CAP = 1_000_000;
const DUNGEON_CARRYOVER_PICKS_CAP = 9_999;
const DUNGEON_CARRYOVER_TRANSFORM_CAP = 31;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DungeonEventWindow {
  active: boolean;
  eventKey: string;
  startsAt: number | null;
  endsAt: number | null;
  nextStartsAt: number;
  label: string;
}

export interface DungeonEventOverride {
  forceActive?: boolean;
  cycle?: number;
}

export interface DungeonWaveSpec {
  wave: number;
  boss: DungeonBossType | null;
  bossLevel: number | null;
  bossRole: DungeonBossRole | null;
  bossFootprint: number | null;
  bossMinionType: DungeonBossMinionType | null;
  bossMinionLevel: number | null;
  bossMinionFootprint: number | null;
  enemyClasses: number[];
}

export interface DungeonRewardPart {
  kind: DungeonRewardKind;
  amount: number;
  rarity?: DiceRarity;
}

export function normalizeDungeonCopyAmount(amount: number): number {
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

export interface DungeonStageReward {
  wave: number;
  parts: DungeonRewardPart[];
  kind: DungeonRewardKind;
  amount: number;
  tokens: number;
}

export interface DungeonCarryoverStatuses {
  poison?: { stacks: Array<{ damage: number; turns: number; sourceInstanceId?: string; sourceOwnerId?: 'player' | 'enemy'; sourceTypeId?: string }> };
  slow?: { delta: number; turns: number; stacks?: Array<{ delta: number; turns: number }> };
  time?: Array<{ effect: 'acceleration' | 'dilation'; turns: number; sourceInstanceId: string }>;
  fracture?: { rate: number; turns: number };
  stun?: number;
  disorientation?: number;
  shield?: { hp: number; turns: number };
}

export interface DungeonCarryoverDie {
  instanceId: string;
  typeId?: string;
  classLevel?: number;
  talentIndex?: number | null;
  currentHealth: number;
  maxHealth: number;
  isDestroyed: boolean;
  mana: number;
  activeMana: Array<[string, number]>;
  statuses: DungeonCarryoverStatuses;
  attackCountBuff?: { extra: number; turns: number };
  projectileCountBuff?: { count: number; turns: number };
  manaPausedTurns?: number;
  growthDelta?: number;
  basicAttackDamage?: number;
  reviveCount?: number;
  soulCount?: number;
  attack?: number;
  transformIndex?: number;
  summonedByInstanceId?: string;
}

export interface DungeonCarryover {
  turn: number;
  dice: DungeonCarryoverDie[];
  diceCards?: DiceCard[];
  diceCardPicksUsed?: number;
  dungeonCards?: DungeonCardState;
}

export interface DungeonLoadoutEntry {
  typeId: string;
  classLevel: number;
  talentIndex: number | null;
}

export interface DungeonConfigSnapshot {
  randomMode: boolean;
  randomizeLoadout: boolean;
  useLevelling: boolean;
}

export interface DungeonRunSave {
  eventKey: string;
  wave: number;
  carryover: DungeonCarryover | null;
  config: DungeonConfigSnapshot;
  loadout?: DungeonLoadoutEntry[];
  savedAt: number;
}

const CURRENCY_REWARDS: Record<number, [number, number, number]> = {
  5: [2_000, 20, 20],
  10: [5_000, 50, 50],
  15: [8_000, 80, 80],
  20: [12_000, 120, 120],
  25: [16_000, 160, 160],
  30: [24_000, 240, 240],
  35: [30_000, 300, 300],
  40: [38_000, 380, 380],
  45: [45_000, 450, 450],
  50: [60_000, 600, 600]
};

const COPY_REWARDS: Record<number, Partial<Record<DiceRarity, number>>> = {
  5: { Common: 50, Uncommon: 30 },
  10: { Common: 200, Uncommon: 150 },
  15: { Common: 400, Uncommon: 300, Rare: 150, Epic: 30 },
  20: { Common: 600, Uncommon: 450, Rare: 200, Epic: 50, Legendary: 1 },
  25: { Common: 800, Uncommon: 600, Rare: 300, Epic: 75, Legendary: 5 },
  30: { Common: 1_200, Uncommon: 800, Rare: 450, Epic: 125, Legendary: 8 },
  35: { Common: 1_500, Uncommon: 1_000, Rare: 600, Epic: 150, Legendary: 10 },
  40: { Common: 2_000, Uncommon: 1_500, Rare: 750, Epic: 200, Legendary: 15 },
  45: { Common: 2_500, Uncommon: 1_750, Rare: 1_000, Epic: 250, Legendary: 20 },
  50: { Common: 3_000, Uncommon: 2_000, Rare: 1_500, Epic: 350, Legendary: 25 }
};

const STAGE_CLASSES: Record<number, number[]> = {
  1: [1, 1, 1],
  2: [2, 2, 3],
  3: [2, 2, 2, 5],
  4: [3, 3, 5, 5],
  5: [4, 4, 4, 6, 6],
  6: [5, 5, 5, 7, 7],
  7: [6, 6, 7, 7, 9],
  8: [6, 6, 6, 7, 7, 9],
  9: [7, 7, 7, 8, 8, 10]
};

function eventDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function getDungeonEventWindow(now = new Date(), override: DungeonEventOverride = {}): DungeonEventWindow {
  const nowMs = now.getTime();
  const todayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  if (override.forceActive === true) {
    const rawCycle = Number(override.cycle);
    const cycle = Number.isFinite(rawCycle) ? Math.max(0, Math.floor(rawCycle)) : 0;
    return {
      active: true,
      eventKey: cycle === 0 ? DUNGEON_FIRST_EVENT_KEY : `${DUNGEON_FIRST_EVENT_KEY}:dev:${cycle}`,
      startsAt: todayStart,
      endsAt: null,
      nextStartsAt: todayStart + DAY_MS,
      label: 'DEV EVENT'
    };
  }
  const weekday = new Date(todayStart).getUTCDay();
  const activeStart = weekday === 2 || weekday === 6
    ? todayStart
    : weekday === 3 || weekday === 0
    ? todayStart - DAY_MS
    : null;
  const active = activeStart !== null && nowMs < activeStart + 2 * DAY_MS;
  const nextWeekdayStart = (targetWeekday: number): number => {
    const offset = (targetWeekday - weekday + 7) % 7 || 7;
    return todayStart + offset * DAY_MS;
  };
  const activeStartWeekday = activeStart === null ? null : new Date(activeStart).getUTCDay();
  const nextStartsAt = active && activeStart !== null
    ? activeStart + (activeStartWeekday === 2 ? 4 : 3) * DAY_MS
    : Math.min(nextWeekdayStart(2), nextWeekdayStart(6));

  return {
    active,
    eventKey: activeStart === null ? '' : eventDateKey(activeStart),
    startsAt: activeStart,
    endsAt: activeStart === null ? null : activeStart + 2 * DAY_MS,
    nextStartsAt,
    label: activeStart !== null && new Date(activeStart).getUTCDay() === 6 ? 'SAT–SUN' : 'TUE–WED'
  };
}

export function getDungeonNextWaveTurn(carryoverTurn: number): number {
  return (Number.isFinite(carryoverTurn) ? Math.max(1, Math.floor(carryoverTurn)) : 1) + 1;
}

function normalizeDungeonNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  if (typeof value === 'boolean' || typeof value === 'object') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function normalizeDungeonInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number | undefined {
  const number = normalizeDungeonNumber(value);
  return number === undefined ? undefined : Math.min(maximum, Math.max(minimum, Math.floor(number)));
}

export function normalizeDungeonLoadout(value: unknown): DungeonLoadoutEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries: DungeonLoadoutEntry[] = [];
  for (const entry of value) {
    if (!isDungeonRecord(entry) || typeof entry.typeId !== 'string' || entry.typeId.length === 0) continue;
    const classLevel = normalizeDungeonInteger(entry.classLevel, 1, DUNGEON_MAX_CLASS_LEVEL) ?? 1;
    const talentIndex = entry.talentIndex === null
      ? null
      : normalizeDungeonInteger(entry.talentIndex, 0, 31) ?? null;
    entries.push({ typeId: entry.typeId, classLevel, talentIndex });
    if (entries.length >= 5) break;
  }
  return entries.length > 0 ? entries : undefined;
}

export function resolveDungeonWaveLoadout(input: {
  wave: number;
  resuming: boolean;
  currentLoadout: DungeonLoadoutEntry[];
  savedLoadout?: DungeonLoadoutEntry[] | null;
}): DungeonLoadoutEntry[] | null {
  if (input.resuming) return input.savedLoadout ?? null;
  return Math.max(1, Math.floor(input.wave)) <= 1 ? input.currentLoadout : input.savedLoadout ?? null;
}

function normalizeDungeonPositiveInteger(value: unknown, maximum = DUNGEON_CARRYOVER_TURNS_CAP): number | undefined {
  const number = normalizeDungeonNumber(value);
  return number !== undefined && number > 0 ? Math.min(maximum, Math.max(1, Math.floor(number))) : undefined;
}

function normalizeDungeonStat(value: unknown, minimum = 0): number | undefined {
  const number = normalizeDungeonNumber(value);
  return number === undefined ? undefined : Math.min(DUNGEON_CARRYOVER_STAT_CAP, Math.max(minimum, number));
}

function isDungeonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDungeonActiveMana(value: unknown): Array<[string, number]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string' || entry[0].length === 0) return [];
    const amount = normalizeDungeonInteger(entry[1], 0, DUNGEON_CARRYOVER_MANA_CAP);
    return amount === undefined ? [] : [[entry[0], amount] as [string, number]];
  }).slice(0, DUNGEON_CARRYOVER_ACTIVE_MANA_CAP);
}

function normalizeDungeonStatuses(value: unknown): DungeonCarryoverStatuses {
  if (!isDungeonRecord(value)) return {};
  const statuses: DungeonCarryoverStatuses = {};

  const poison = isDungeonRecord(value.poison) ? value.poison : undefined;
  if (Array.isArray(poison?.stacks)) {
    const stacks: NonNullable<DungeonCarryoverStatuses['poison']>['stacks'] = [];
    for (const entry of poison.stacks) {
      if (!isDungeonRecord(entry)) continue;
      const damage = normalizeDungeonStat(entry.damage, 0);
      const turns = normalizeDungeonPositiveInteger(entry.turns, DUNGEON_CARRYOVER_TURNS_CAP);
      if (damage === undefined || damage <= 0 || turns === undefined) continue;
      if (stacks.length >= DUNGEON_CARRYOVER_STACK_CAP) break;
      const sourceOwnerId = entry.sourceOwnerId === 'player' || entry.sourceOwnerId === 'enemy'
        ? entry.sourceOwnerId
        : undefined;
      stacks.push({
        damage,
        turns,
        ...(typeof entry.sourceInstanceId === 'string' && entry.sourceInstanceId.length > 0
          ? { sourceInstanceId: entry.sourceInstanceId }
          : {}),
        ...(sourceOwnerId ? { sourceOwnerId } : {}),
        ...(typeof entry.sourceTypeId === 'string' && entry.sourceTypeId.length > 0
          ? { sourceTypeId: entry.sourceTypeId }
          : {})
      });
    }
    if (stacks.length > 0) statuses.poison = { stacks };
  }

  const slow = isDungeonRecord(value.slow) ? value.slow : undefined;
  const slowDelta = normalizeDungeonNumber(slow?.delta);
  const slowTurns = normalizeDungeonPositiveInteger(slow?.turns);
  if (slowDelta !== undefined && slowTurns !== undefined) {
    const stacks = Array.isArray(slow?.stacks)
      ? slow.stacks.flatMap((entry) => {
        if (!isDungeonRecord(entry)) return [];
        const delta = normalizeDungeonNumber(entry.delta);
        const turns = normalizeDungeonPositiveInteger(entry.turns, DUNGEON_CARRYOVER_TURNS_CAP);
        return delta === undefined || turns === undefined
          ? []
          : [{ delta: Math.max(-DUNGEON_CARRYOVER_STAT_CAP, Math.min(DUNGEON_CARRYOVER_STAT_CAP, Math.trunc(delta))), turns }];
      }).slice(0, DUNGEON_CARRYOVER_STACK_CAP)
      : [];
    statuses.slow = {        delta: Math.max(-DUNGEON_CARRYOVER_STAT_CAP, Math.min(DUNGEON_CARRYOVER_STAT_CAP, Math.trunc(slowDelta))),
        turns: slowTurns,
      ...(stacks.length > 0 ? { stacks } : {})
    };
  }

  if (Array.isArray(value.time)) {
    const time: NonNullable<DungeonCarryoverStatuses['time']> = [];
    for (const entry of value.time) {
      if (!isDungeonRecord(entry)) continue;
      const effect: 'acceleration' | 'dilation' | undefined =
        entry.effect === 'acceleration' || entry.effect === 'dilation' ? entry.effect : undefined;
      const turns = normalizeDungeonPositiveInteger(entry.turns, DUNGEON_CARRYOVER_TURNS_CAP);
      if (!effect || turns === undefined || typeof entry.sourceInstanceId !== 'string' || entry.sourceInstanceId.length === 0) {
        continue;
      }
      if (time.length >= DUNGEON_CARRYOVER_STACK_CAP) break;
      time.push({ effect, turns, sourceInstanceId: entry.sourceInstanceId });
    }
    if (time.length > 0) statuses.time = time;
  }

  const fracture = isDungeonRecord(value.fracture) ? value.fracture : undefined;
  const fractureRate = normalizeDungeonNumber(fracture?.rate);
  const fractureTurns = normalizeDungeonPositiveInteger(fracture?.turns, DUNGEON_CARRYOVER_TURNS_CAP);
  if (fractureRate !== undefined && fractureRate > 0 && fractureTurns !== undefined) {
    statuses.fracture = { rate: Math.min(10, fractureRate), turns: fractureTurns };
  }

  const stun = normalizeDungeonPositiveInteger(value.stun, DUNGEON_CARRYOVER_TURNS_CAP);
  if (stun !== undefined) statuses.stun = stun;
  const disorientation = normalizeDungeonPositiveInteger(value.disorientation, DUNGEON_CARRYOVER_TURNS_CAP);
  if (disorientation !== undefined) statuses.disorientation = disorientation;

  const shield = isDungeonRecord(value.shield) ? value.shield : undefined;
  const shieldHp = normalizeDungeonStat(shield?.hp, 0);
  const shieldTurns = normalizeDungeonPositiveInteger(shield?.turns, DUNGEON_CARRYOVER_TURNS_CAP);
  if (shieldHp !== undefined && shieldHp > 0 && shieldTurns !== undefined) {
    statuses.shield = { hp: shieldHp, turns: shieldTurns };
  }
  return statuses;
}

export function normalizeDungeonCarryover(value: unknown): DungeonCarryover | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<DungeonCarryover>;
  if (!Array.isArray(candidate.dice) || candidate.dice.length === 0) return null;
  const dice = candidate.dice.filter((die): die is DungeonCarryoverDie =>
    Boolean(die) && typeof die.instanceId === 'string' && die.instanceId.length > 0
  ).slice(0, DUNGEON_CARRYOVER_DICE_CAP);
  if (dice.length === 0) return null;
  const diceIds = new Set(dice.map((die) => die.instanceId));
  const rawTurn = Number(candidate.turn);
  const rawPicks = Number(candidate.diceCardPicksUsed);
  return {
    turn: normalizeDungeonInteger(rawTurn, 1, DUNGEON_CARRYOVER_TURN_CAP) ?? 1,
    dice: dice.map((die) => {
      const maxHealth = normalizeDungeonStat(die.maxHealth, 0) ?? 0;
      const rawCurrentHealth = normalizeDungeonStat(die.currentHealth, 0);
      const currentHealth = die.isDestroyed === true
        ? 0
        : rawCurrentHealth === undefined
          ? (maxHealth > 0 ? maxHealth : 1)
          : maxHealth > 0 ? Math.min(maxHealth, rawCurrentHealth) : rawCurrentHealth;
      const growthDelta = Number(die.growthDelta);
      const normalizedDie = { ...die } as DungeonCarryoverDie & { transformIndex?: unknown; transformDuration?: unknown };
      const hadTimedTransform = normalizedDie.transformDuration !== undefined;
      delete normalizedDie.transformDuration;
      delete normalizedDie.summonedByInstanceId;
      const rawTransformIndex = Number(normalizedDie.transformIndex);
      if (hadTimedTransform || !Number.isInteger(rawTransformIndex) || rawTransformIndex < 0 || rawTransformIndex > DUNGEON_CARRYOVER_TRANSFORM_CAP) delete normalizedDie.transformIndex;
      else normalizedDie.transformIndex = rawTransformIndex;
      const rawTalentIndex = normalizedDie.talentIndex;
      delete normalizedDie.talentIndex;
      const talentIndex = rawTalentIndex === null
        ? null
        : normalizeDungeonInteger(rawTalentIndex, 0, 31);
      return {
      ...normalizedDie,
      classLevel: normalizeDungeonInteger(die.classLevel, 1, DUNGEON_MAX_CLASS_LEVEL) ?? 1,
      ...(talentIndex !== undefined ? { talentIndex } : {}),
      currentHealth,
      maxHealth,
      isDestroyed: die.isDestroyed === true || currentHealth <= 0,
      mana: normalizeDungeonInteger(die.mana, 0, DUNGEON_CARRYOVER_MANA_CAP) ?? 0,
      activeMana: normalizeDungeonActiveMana(die.activeMana),
      statuses: normalizeDungeonStatuses(die.statuses),
      growthDelta: Number.isFinite(growthDelta)
        ? Math.max(-DUNGEON_CARRYOVER_STAT_CAP, Math.min(DUNGEON_CARRYOVER_STAT_CAP, Math.floor(growthDelta)))
        : 0,
      basicAttackDamage: normalizeDungeonStat(die.basicAttackDamage, 0) ?? 0,
      ...(die.attackCountBuff
        && Number.isFinite(Number(die.attackCountBuff.extra)) && Number(die.attackCountBuff.extra) > 0
        && Number.isFinite(Number(die.attackCountBuff.turns)) && Number(die.attackCountBuff.turns) > 0
        ? { attackCountBuff: { extra: Math.min(DUNGEON_CARRYOVER_COUNT_CAP, Math.max(1, Math.floor(Number(die.attackCountBuff.extra)))), turns: Math.min(DUNGEON_CARRYOVER_TURNS_CAP, Math.max(1, Math.floor(Number(die.attackCountBuff.turns)))) } }
        : {}),
      ...(die.projectileCountBuff
        && Number.isFinite(Number(die.projectileCountBuff.count)) && Number(die.projectileCountBuff.count) > 1
        && Number.isFinite(Number(die.projectileCountBuff.turns)) && Number(die.projectileCountBuff.turns) > 0
        ? { projectileCountBuff: { count: Math.min(DUNGEON_CARRYOVER_COUNT_CAP, Math.max(2, Math.floor(Number(die.projectileCountBuff.count)))), turns: Math.min(DUNGEON_CARRYOVER_TURNS_CAP, Math.max(1, Math.floor(Number(die.projectileCountBuff.turns)))) } }
        : {}),
      ...(Number.isFinite(Number(die.manaPausedTurns)) && Number(die.manaPausedTurns) > 0
        ? { manaPausedTurns: Math.min(DUNGEON_CARRYOVER_TURNS_CAP, Math.max(1, Math.floor(Number(die.manaPausedTurns)))) }
        : {}),
      ...(Number.isFinite(Number(die.reviveCount)) && Number(die.reviveCount) > 0
        ? { reviveCount: Math.min(DUNGEON_CARRYOVER_COUNT_CAP, Math.max(1, Math.floor(Number(die.reviveCount)))) }
        : {}),
      ...(Number.isFinite(Number(die.soulCount)) && Number(die.soulCount) > 0
        ? { soulCount: Math.min(DUNGEON_CARRYOVER_COUNT_CAP, Math.max(1, Math.floor(Number(die.soulCount)))) }
        : {}),
      ...(normalizeDungeonStat(die.attack, 1) !== undefined
        ? { attack: normalizeDungeonStat(die.attack, 1)! }
        : {}),
      ...(typeof die.summonedByInstanceId === 'string'
        && die.summonedByInstanceId.length > 0
        && die.summonedByInstanceId !== die.instanceId
        && diceIds.has(die.summonedByInstanceId)
        ? { summonedByInstanceId: die.summonedByInstanceId }
        : {})
      };
    }),
    diceCards: normalizeDiceCardCarryover(candidate.diceCards),
    diceCardPicksUsed: normalizeDungeonInteger(rawPicks, 0, DUNGEON_CARRYOVER_PICKS_CAP) ?? 0,
    dungeonCards: normalizeDungeonCardState(candidate.dungeonCards)
  };
}

export function resolveDungeonCarryoverInstanceIds(
  carryover: DungeonCarryover,
  initialDice: Array<{ instanceId: string; typeId: string }>,
  modifier: DungeonModifier
): Set<string> {
  const initialById = new Map(initialDice.map((die) => [die.instanceId, die] as const));
  const allowed = new Set<string>();

  carryover.dice.forEach((saved) => {
    const initial = initialById.get(saved.instanceId);
    if (initial) {
      if (!saved.typeId || saved.typeId === initial.typeId) allowed.add(saved.instanceId);
      return;
    }
    if (modifier === 'Duality' && saved.instanceId.endsWith(':dual')) {
      const parentId = saved.instanceId.slice(0, -5);
      const parent = initialById.get(parentId);
      if (parent && (!saved.typeId || saved.typeId === parent.typeId)) allowed.add(saved.instanceId);
      return;
    }
    if (modifier === 'Necromancy' && saved.instanceId.includes('-necro-')) {
      allowed.add(saved.instanceId);
    }
  });

  let added = true;
  while (added) {
    added = false;
    carryover.dice.forEach((saved) => {
      if (allowed.has(saved.instanceId) || !saved.summonedByInstanceId) return;
      if (!allowed.has(saved.summonedByInstanceId)) return;
      allowed.add(saved.instanceId);
      added = true;
    });
  }

  return allowed;
}

function hashValue(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isLegacyDiceCardMode(modifier: DungeonModifier): boolean {
  return modifier === 'DiceCard';
}

export function canUseDungeonCards(modifier: DungeonModifier): boolean {
  return !isLegacyDiceCardMode(modifier);
}

export function getDungeonModifier(eventKey: string): DungeonModifier {
  if (!eventKey || eventKey <= DUNGEON_FIRST_EVENT_KEY) return 'Classic';
  const index = hashValue(`${eventKey}:dungeon-modifier:v1`) % DUNGEON_MODIFIERS.length;
  return DUNGEON_MODIFIERS[index] ?? 'Classic';
}

function bossForWave(eventKey: string, wave: number): DungeonBossType {
  const index = hashValue(`${eventKey}:dungeon-boss:${wave}`) % DUNGEON_BOSSES.length;
  return DUNGEON_BOSSES[index] ?? 'Magician';
}

function miniBossForWave(eventKey: string, wave: number): DungeonBossMinionType {
  const index = hashValue(`${eventKey}:dungeon-mini-boss:${wave}:v1`) % DUNGEON_MINI_BOSSES.length;
  return DUNGEON_MINI_BOSSES[index] ?? 'Imp';
}

function getDungeonStageMinionBonus(wave: number): number {
  return wave > 10 ? Math.floor((wave - 10) / 3) : 0;
}

function getDungeonMinionCap(bossFootprint: number | null): number {
  const footprint = Math.max(0, Math.floor(Number(bossFootprint) || 0));
  return Math.max(0, DUNGEON_BOARD_CELLS - footprint * footprint);
}

function getDungeonNormalEnemyClasses(wave: number): number[] {
  if (wave <= 9) return [...(STAGE_CLASSES[wave] ?? [])];
  const baseClass = Math.min(15, 8 + Math.floor((wave - 10) / 2));
  return [
    baseClass,
    baseClass,
    baseClass,
    Math.min(15, baseClass + 1),
    Math.min(15, baseClass + 1),
    Math.min(15, baseClass + 2),
    ...Array.from({ length: getDungeonStageMinionBonus(wave) }, () => Math.min(15, baseClass + 2))
  ];
}

export function getDungeonWaveSpec(wave: number, eventKey: string): DungeonWaveSpec {
  const boundedWave = Math.max(1, Math.min(DUNGEON_MAX_WAVES, Math.floor(wave)));
  if (boundedWave % 10 === 0) {
    const tier = boundedWave / 10;
    const bossLevel = Math.floor(boundedWave / 2);
    const minionCount = Math.min(getDungeonMinionCap(3), 2 + tier + getDungeonStageMinionBonus(boundedWave));
    const minionClass = boundedWave >= 30 ? DUNGEON_MAX_CLASS_LEVEL : Math.min(DUNGEON_MAX_CLASS_LEVEL, 8 + tier);
    return {
      wave: boundedWave,
      boss: bossForWave(eventKey, boundedWave),
      bossLevel,
      bossRole: 'major',
      bossFootprint: 3,
      bossMinionType: null,
      bossMinionLevel: null,
      bossMinionFootprint: null,
      enemyClasses: [bossLevel, ...Array.from({ length: minionCount }, () => minionClass)]
    };
  }

  if (boundedWave % 10 === 5) {
    const miniBossType = miniBossForWave(eventKey, boundedWave);
    const bossLevel = boundedWave;
    const normalClasses = getDungeonNormalEnemyClasses(boundedWave);
    const recruitBonus = Math.ceil(boundedWave / 10);
    const recruitClass = normalClasses[normalClasses.length - 1] ?? bossLevel;
    const minionClasses = [
      ...normalClasses.slice(1),
      ...Array.from({ length: recruitBonus }, () => recruitClass)
    ];
    return {
      wave: boundedWave,
      boss: null,
      bossLevel,
      bossRole: 'mini',
      bossFootprint: 2,
      bossMinionType: miniBossType,
      bossMinionLevel: bossLevel,
      bossMinionFootprint: 2,
      enemyClasses: [bossLevel, ...minionClasses.slice(0, getDungeonMinionCap(2))]
    };
  }

  return {
    wave: boundedWave,
    boss: null,
    bossLevel: null,
    bossRole: null,
    bossFootprint: null,
    bossMinionType: null,
    bossMinionLevel: null,
    bossMinionFootprint: null,
    enemyClasses: getDungeonNormalEnemyClasses(boundedWave).slice(0, getDungeonMinionCap(null))
  };
}

export function getDungeonDifficulty(wave: number): DungeonDifficulty {
  const boundedWave = Math.max(1, Math.min(DUNGEON_MAX_WAVES, Math.floor(wave)));
  if (boundedWave > 30) return 'boss-berserk';
  if (boundedWave > 10) return 'death-wave';
  return 'normal';
}

export function getDungeonSpeedMultiplier(wave: number): number {
  const difficulty = getDungeonDifficulty(wave);
  if (difficulty === 'boss-berserk') return 4;
  if (difficulty === 'death-wave') return 2;
  return 1;
}

export function getDungeonMusicEffects(wave: number): { speed: number; pitch: number } {
  const difficulty = getDungeonDifficulty(wave);
  if (difficulty === 'boss-berserk') return { speed: 1.5, pitch: 4 };
  if (difficulty === 'death-wave') return { speed: 1.25, pitch: 2 };
  return { speed: 1, pitch: 0 };
}

export function getDungeonEnemyCriticalChance(wave: number, _elite = false): number {
  const difficulty = getDungeonDifficulty(wave);
  if (difficulty === 'normal') return 0.05;
  if (difficulty === 'boss-berserk') return 0.5;
  return 0.25;
}

export function getDungeonEliteDieSides(wave: number): number {
  const difficulty = getDungeonDifficulty(wave);
  if (difficulty === 'boss-berserk') return 20;
  if (difficulty === 'death-wave') return 12;
  return 6;
}

export function getDungeonEliteSkillMultiplier(wave: number): number {
  return getDungeonDifficulty(wave) === 'boss-berserk' ? DUNGEON_BOSS_BERSERK_SKILL_MULTIPLIER : 1;
}

export function getDungeonStageReward(eventKey: string, wave: number): DungeonStageReward {
  const boundedWave = Math.max(1, Math.min(DUNGEON_MAX_WAVES, Math.floor(wave)));
  const emptyReward: DungeonStageReward = {
    wave: boundedWave,
    parts: [],
    kind: 'tokens',
    amount: 0,
    tokens: 0
  };
  if (boundedWave % 5 !== 0) return emptyReward;

  const currencyAmounts = CURRENCY_REWARDS[boundedWave];
  const copyAmounts = COPY_REWARDS[boundedWave];
  if (!currencyAmounts || !copyAmounts) return emptyReward;

  const currencyOptions: Array<Extract<DungeonRewardKind, 'tokens' | 'chips' | 'diamonds'>> = ['tokens', 'chips', 'diamonds'];
  const currencyIndex = hashValue(`${eventKey}:dungeon-reward-currency:${boundedWave}:v2`) % currencyOptions.length;
  const currencyKind = currencyOptions[currencyIndex] ?? 'tokens';
  const currencyAmount = currencyAmounts[currencyIndex] ?? 0;

  const copyEntries = Object.entries(copyAmounts) as Array<[DiceRarity, number]>;
  if (copyEntries.length === 0) return emptyReward;
  const copyIndex = hashValue(`${eventKey}:dungeon-reward-copy:${boundedWave}:v2`) % copyEntries.length;
  const selectedCopy = copyEntries[copyIndex] ?? copyEntries[0]!;

  const copyParts: DungeonRewardPart[] = [];
  if (boundedWave === 5 && hashValue(`${eventKey}:dungeon-reward-both:5:v3`) % 100 < 50) {
    (['Common', 'Uncommon'] as const).forEach((rarity) => {
      const amount = copyAmounts[rarity];
      if (amount !== undefined) copyParts.push({ kind: 'copies', amount, rarity });
    });
  }
  if (copyParts.length === 0) {
    copyParts.push({ kind: 'copies', amount: selectedCopy[1], rarity: selectedCopy[0] });
  }

  const parts: DungeonRewardPart[] = [
    { kind: currencyKind, amount: currencyAmount },
    ...copyParts
  ];
  if (copyParts.length > 1) {
    const divisor = copyParts.length;
    copyParts.forEach((part) => {
      part.amount = part.amount / divisor;
    });
  }
  parts.forEach((part) => {
    if (part.kind === 'copies') part.amount = normalizeDungeonCopyAmount(part.amount);
  });

  return {
    wave: boundedWave,
    parts,
    kind: parts[0]?.kind ?? 'tokens',
    amount: parts[0]?.amount ?? 0,
    tokens: parts.find((part) => part.kind === 'tokens')?.amount ?? 0
  };
}

export function pickDungeonCopyTypeId(eventKey: string, wave: number, typeIds: string[], variant = 0): string | null {
  const sorted = [...new Set(typeIds.filter((typeId) => typeof typeId === 'string' && typeId.length > 0))].sort();
  if (sorted.length === 0) return null;
  const safeVariant = Math.max(0, Math.floor(Number.isFinite(variant) ? variant : 0));
  const index = hashValue(`${eventKey}:dungeon-copy:${wave}:${safeVariant}:v1`) % sorted.length;
  return sorted[index] ?? null;
}

export function canGrantDungeonCopyAmount(amount: number, remaining: number, owned: boolean): boolean {
  const copyAmount = normalizeDungeonCopyAmount(amount);
  if (!Number.isFinite(remaining) || copyAmount <= 0) return false;
  const required = Math.max(0, copyAmount - (owned ? 0 : 1));
  return remaining + 1e-9 >= required;
}
