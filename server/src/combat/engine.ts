import type { DiceCatalog } from './catalog.js';
import { buildCombatDefinition } from './progression.js';
import type {
  BattlePosition,
  ClientBattleState,
  CombatDie,
  CombatEvent,
  CombatResolution,
  CombatState,
  DiceDefinition,
  DiceSkillDefinition,
  LoadoutEntry,
  MatchRules,
  OwnerId,
  SkillModifiers,
  StatusEffect
} from './types.js';

const GRID_SIZE = 5;
const MAX_ACTIONS = 600;
const MAX_EVENTS = 400;
const BASE_CRITICAL_CHANCE = 0.05;

type RandomSource = () => number;

function value(source: unknown): unknown {
  return source;
}

function numberMod(modifiers: SkillModifiers | undefined, key: string): number | undefined {
  const raw = value(modifiers?.[key]);
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function stringMod(modifiers: SkillModifiers | undefined, key: string): string | undefined {
  const raw = value(modifiers?.[key]);
  return typeof raw === 'string' ? raw : undefined;
}

function booleanMod(modifiers: SkillModifiers | undefined, key: string): boolean {
  return value(modifiers?.[key]) === true;
}

function clamp(valueToClamp: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, valueToClamp));
}

function footprintFor(definition: DiceDefinition | undefined): number {
  return Math.max(1, Math.min(GRID_SIZE, Math.floor(definition?.footprint ?? 1)));
}

function makeInstanceId(ownerId: OwnerId, index: number): string {
  return `${ownerId === 'player' ? 'a' : 'b'}-${index + 1}`;
}

function allModifiers(definition: DiceDefinition): SkillModifiers[] {
  return definition.skills.flatMap((skill) => skill.modifiers ? [skill.modifiers] : []);
}

function sumModifier(definition: DiceDefinition, key: string): number {
  return allModifiers(definition).reduce((total, modifiers) => total + (numberMod(modifiers, key) ?? 0), 0);
}

function maxModifier(definition: DiceDefinition, key: string): number {
  return allModifiers(definition).reduce((maximum, modifiers) => Math.max(maximum, numberMod(modifiers, key) ?? 0), 0);
}

function firstNumberModifier(definition: DiceDefinition, key: string): number | undefined {
  for (const modifiers of allModifiers(definition)) {
    const found = numberMod(modifiers, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function firstStringModifier(definition: DiceDefinition, key: string): string | undefined {
  for (const modifiers of allModifiers(definition)) {
    const found = stringMod(modifiers, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function hasBooleanModifier(definition: DiceDefinition, key: string): boolean {
  return allModifiers(definition).some((modifiers) => booleanMod(modifiers, key));
}

function statusDuration(modifiers: SkillModifiers, effect: StatusEffect): number {
  return Math.max(1, Math.floor(
    numberMod(modifiers, `${effect}Duration`)
    ?? numberMod(modifiers, 'activeDurationTurns')
    ?? numberMod(modifiers, 'statusDuration')
    ?? 1
  ));
}

function pipRate(modifiers: SkillModifiers | undefined, key: string, pips: number, fallbackKey?: string): number | undefined {
  const raw = modifiers?.[key];
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const mapped = (raw as Record<string, unknown>)[String(pips)];
    if (typeof mapped === 'number' && Number.isFinite(mapped)) return mapped;
  }
  return fallbackKey ? numberMod(modifiers, fallbackKey) : undefined;
}

function pipScaledDamage(definition: DiceDefinition, modifiers: SkillModifiers | undefined, key: string, pips: number, fallback: number): number {
  const fixed = numberMod(modifiers, key);
  const base = fixed ?? fallback;
  const rate = pipRate(modifiers, `${key}RatesByPip`, pips, `${key}Rate`) ?? 1;
  return Math.max(1, Math.ceil(base * rate));
}

function hasSplashEffect(modifiers: SkillModifiers | undefined): boolean {
  const mapped = modifiers?.splashDamageRatesByPip;
  return booleanMod(modifiers, 'hasSplash')
    && (numberMod(modifiers, 'splashDamage') !== undefined
      || numberMod(modifiers, 'splashDamageRate') !== undefined
      || (mapped !== undefined && typeof mapped === 'object' && !Array.isArray(mapped)));
}

function hasChainEffect(modifiers: SkillModifiers | undefined): boolean {
  const mapped = modifiers?.chainDamageRatesByPip;
  return booleanMod(modifiers, 'hasChain')
    && (numberMod(modifiers, 'chainDamage') !== undefined
      || numberMod(modifiers, 'chainDamageRate') !== undefined
      || (mapped !== undefined && typeof mapped === 'object' && !Array.isArray(mapped)));
}

function hasMeteorEffect(modifiers: SkillModifiers | undefined): boolean {
  return booleanMod(modifiers, 'hasMeteor')
    && (numberMod(modifiers, 'meteorDamage') !== undefined || numberMod(modifiers, 'meteorCount') !== undefined);
}

function hasGrowthEffect(modifiers: SkillModifiers | undefined): boolean {
  return booleanMod(modifiers, 'hasGrowth');
}

function growthDeltaFor(modifiers: SkillModifiers | undefined, random: RandomSource): number | undefined {
  if (!hasGrowthEffect(modifiers)) return undefined;
  const delta = Math.max(1, Math.abs(numberMod(modifiers, 'growthDelta') ?? 1));
  const chance = clamp(numberMod(modifiers, 'growthChance') ?? 1, 0, 1);
  return random() < chance ? delta : -delta;
}

function resolveActiveDamage(definition: DiceDefinition, modifiers: SkillModifiers, pips: number, fallback: number): number {
  return pipScaledDamage(definition, modifiers, 'activeDamage', pips, fallback);
}

function statusApplication(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  target: CombatDie,
  modifiers: SkillModifiers | undefined,
  events: CombatEvent[],
  pips: number
): void {
  const effect = stringMod(modifiers, 'statusEffect') as StatusEffect | undefined;
  if (!effect) return;
  const duration = statusDuration(modifiers ?? {}, effect);
  const maxStacks = numberMod(modifiers, 'maxStacks');
  const attackDelta = numberMod(modifiers, 'activeAttackDelta') ?? numberMod(modifiers, 'attackDelta');
  const poison = numberMod(modifiers, 'poisonDamage');
  const poisonRate = numberMod(modifiers, 'poisonDamageRate');
  const armorReduction = numberMod(modifiers, 'armorReduction');
  const statusKey = `status:${effect}`;
  const currentStacks = target.mana[statusKey] ?? 0;
  if (maxStacks !== undefined && currentStacks >= Math.max(0, Math.floor(maxStacks))) return;
  if (effect === 'slow' && attackDelta !== undefined) {
    target.attackDelta += attackDelta;
    target.attackDeltaTurns = Math.max(target.attackDeltaTurns, duration);
    if (target.attacksRemaining > 0) {
      target.attacksRemaining = Math.max(0, target.attacksRemaining + attackDelta);
      target.hasFinishedAttacking = target.attacksRemaining === 0;
    }
  }
  if (effect === 'poison') {
    const base = poison ?? Math.max(1, Math.floor(effectiveDefinition(state, definitions, source).attack * (poisonRate ?? 0)));
    target.mana['poisonAmount'] = Math.max(target.mana['poisonAmount'] ?? 0, base);
  }
  if (effect === 'fracture' && armorReduction !== undefined) {
    target.fractureRate = Math.max(target.fractureRate, armorReduction);
    target.fractureTurns = Math.max(target.fractureTurns, duration);
  }
  if (effect === 'taunt') {
    target.tauntedBySourceId = source.instanceId;
    target.tauntTurns = duration;
  }
  if (effect === 'stun') {
    target.stunTurns = Math.max(target.stunTurns, duration);
  }
  addStatus(target, effect, duration, attackDelta, maxStacks);
  addEvent(events, 'status', `${effectiveDefinition(state, definitions, target).title} gains ${effect} for ${duration} turn${duration === 1 ? '' : 's'}.`, {
    ownerId: target.ownerId,
    sourceId: source.instanceId,
    targetId: target.instanceId
  });
  void pips;
}

function attackGrantAmount(modifiers: SkillModifiers | undefined, key: 'grantAttacksToAlly' | 'grantAttacksToFoe', includeAura = false): number {
  const direct = numberMod(modifiers, key) ?? 0;
  const aura = includeAura
    ? numberMod(modifiers, key === 'grantAttacksToAlly' ? 'allyExtraAttacks' : 'foeExtraAttacks') ?? 0
    : 0;
  return Math.max(0, Math.floor(direct + aura));
}

function skillsOfType(definition: DiceDefinition, type: DiceSkillDefinition['type']): DiceSkillDefinition[] {
  return definition.skills.filter((skill) => skill.type === type);
}

function firstNumberAcrossSkills(definition: DiceDefinition, type: DiceSkillDefinition['type'], key: string): number | undefined {
  for (const skill of skillsOfType(definition, type)) {
    const value = numberMod(skill.modifiers, key);
    if (value !== undefined) return value;
  }
  return undefined;
}

function sumNumberAcrossDefinition(definition: DiceDefinition, key: string): number {
  return definition.skills.reduce((total, skill) => total + (numberMod(skill.modifiers, key) ?? 0), 0);
}

function firstGrantModifiers(
  definition: DiceDefinition,
  type: DiceSkillDefinition['type'],
  key: string,
  classLevel: number
): SkillModifiers | undefined {
  return skillsOfType(definition, type)
    .filter((skill) => skillUnlocked(skill, classLevel))
    .map((skill) => skill.modifiers)
    .find((modifiers) => numberMod(modifiers, key) !== undefined);
}

function grantMode(modifiers: SkillModifiers | undefined): string | undefined {
  return stringMod(modifiers, 'skillTargeting');
}

function footprintColumnDistance(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  first: CombatDie,
  second: CombatDie
): number {
  if (!first.gridPosition || !second.gridPosition) return Number.POSITIVE_INFINITY;
  const firstCells = cellsFor(first, effectiveDefinition(state, definitions, first));
  const secondCells = cellsFor(second, effectiveDefinition(state, definitions, second));
  let best = Number.POSITIVE_INFINITY;
  for (const firstCell of firstCells) {
    for (const secondCell of secondCells) {
      best = Math.min(best, Math.abs(firstCell.col - secondCell.col));
    }
  }
  return best;
}

function selectGrantRecipient(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  allies: boolean,
  mode: string | undefined,
  random: RandomSource
): CombatDie | undefined {
  const owner = allies ? source.ownerId : otherOwner(source.ownerId);
  const candidates = boardDice(state, owner)
    .filter((die) => die.instanceId !== source.instanceId)
    .map((die) => ({
      die,
      distance: allies
        ? footprintColumnDistance(state, definitions, source, die)
        : distanceBetween(source, die, definitions, state)
    }));
  if (candidates.length === 0) return undefined;
  const definition = effectiveDefinition(state, definitions, source);
  const primarySkill = definition.skills.find((skill) => skill.type !== 'CombatStart' && skill.type !== 'CombatEnd');
  const grantKey = allies ? 'grantAttacksToAlly' : 'grantAttacksToFoe';
  const grantSource = definition.skills
    .filter((skill) => skillUnlocked(skill, source.classLevel))
    .map((skill) => skill.modifiers)
    .find((modifiers) => numberMod(modifiers, grantKey) !== undefined);
  const resolvedMode = mode
    ?? stringMod(grantSource, 'skillTargeting')
    ?? stringMod(primarySkill?.modifiers, 'skillTargeting');
  if (!resolvedMode || resolvedMode === 'Random') return pickRandom(candidates, random)?.die;
  const byNear = [...candidates].sort((a, b) => (
    a.distance - b.distance
    || (a.die.gridPosition?.row ?? 0) - (b.die.gridPosition?.row ?? 0)
    || (a.die.gridPosition?.col ?? 0) - (b.die.gridPosition?.col ?? 0)
    || a.die.instanceId.localeCompare(b.die.instanceId)
  ));
  if (resolvedMode === 'Furthest') return [...byNear].reverse()[0]?.die;
  if (resolvedMode === 'Strongest') return [...candidates].sort((a, b) => b.die.currentHealth - a.die.currentHealth || a.distance - b.distance)[0]?.die;
  if (resolvedMode === 'Nearest') return byNear[0]?.die;
  if (resolvedMode === 'Weakest') return [...candidates].sort((a, b) => a.die.currentHealth - b.die.currentHealth || a.distance - b.distance)[0]?.die;
  return pickRandom(candidates, random)?.die;
}

function grantAttacks(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  amount: number,
  allies: boolean,
  events: CombatEvent[],
  random: RandomSource,
  mode?: string
): void {
  const recipient = selectGrantRecipient(state, definitions, source, allies, mode, random);
  if (!recipient) return;
  recipient.attacksRemaining += Math.max(0, Math.floor(amount));
  recipient.hasFinishedAttacking = recipient.attacksRemaining === 0;
  addEvent(events, 'skill', `${effectiveDefinition(state, definitions, source).title} grants ${amount} attack${amount === 1 ? '' : 's'} to ${effectiveDefinition(state, definitions, recipient).title}.`, {
    ownerId: source.ownerId,
    sourceId: source.instanceId,
    targetId: recipient.instanceId
  });
}

function skillOfType(definition: DiceDefinition, type: DiceSkillDefinition['type']): DiceSkillDefinition | undefined {
  return definition.skills.find((skill) => skill.type === type);
}

function activeSkills(definition: DiceDefinition, classLevel: number): DiceSkillDefinition[] {
  return definition.skills.filter((skill) => (
    skill.type === 'Active'
    && (skill.manaNeeded ?? 0) > 0
    && skillUnlocked(skill, classLevel)
  ));
}

function activeManaKey(skill: DiceSkillDefinition, index: number): string {
  return `${skill.title}:${index}`;
}

function hasCombatStart(definition: DiceDefinition): boolean {
  return definition.skills.some((skill) => skill.type === 'CombatStart');
}

function skillUnlocked(skill: DiceSkillDefinition, classLevel: number): boolean {
  const unlock = numberMod(skill.modifiers, 'unlockAtClass');
  return unlock === undefined || classLevel >= unlock;
}

const TRIGGER_PRIMARY_ONLY_KEYS = new Set(['statusEffect']);

function triggerModifiers(
  definition: DiceDefinition,
  type: DiceSkillDefinition['type'],
  classLevel: number
): SkillModifiers | undefined {
  const skills = skillsOfType(definition, type).filter((skill) => skillUnlocked(skill, classLevel));
  if (skills.length === 0) return undefined;
  const merged: SkillModifiers = {};
  for (const skill of skills) {
    for (const [key, entry] of Object.entries(skill.modifiers ?? {})) {
      if (entry === undefined || entry === null || TRIGGER_PRIMARY_ONLY_KEYS.has(key)) continue;
      if (!(key in merged)) {
        merged[key] = entry;
      } else if (key === 'attackCountIncrease') {
        merged[key] = Math.max(numberMod(merged, key) ?? 0, numberMod(skill.modifiers, key) ?? 0);
      } else if (key === 'pipMatchAllyAttackDelta' || key === 'pipMatchFoeAttackDelta') {
        merged[key] = (numberMod(merged, key) ?? 0) + (numberMod(skill.modifiers, key) ?? 0);
      } else if (key.startsWith('has') && typeof entry === 'boolean') {
        merged[key] = booleanMod(merged, key) || booleanMod(skill.modifiers, key);
      } else if (key === 'healOnAttack' || key === 'transformToNextForm') {
        merged[key] = booleanMod(merged, key) || booleanMod(skill.modifiers, key);
      }
    }
  }
  const primaryStatus = skills[0]?.modifiers?.statusEffect;
  if (typeof primaryStatus === 'string') merged.statusEffect = primaryStatus;
  return merged;
}

function addEvent(
  events: CombatEvent[],
  kind: CombatEvent['kind'],
  text: string,
  extra: Partial<CombatEvent> = {}
): void {
  if (events.length >= MAX_EVENTS) return;
  events.push({ kind, text, ...extra });
}

function insertEvent(
  events: CombatEvent[],
  index: number,
  kind: CombatEvent['kind'],
  text: string,
  extra: Partial<CombatEvent> = {}
): void {
  if (events.length >= MAX_EVENTS) return;
  events.splice(Math.min(index, events.length), 0, { kind, text, ...extra });
}

function getDefinition(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  die: CombatDie
): DiceDefinition {
  return definitions.get(die.instanceId) ?? {
    typeId: die.typeId,
    title: die.typeId,
    attack: 1,
    health: die.maxHealth,
    range: 1,
    targetingMode: 'Nearest',
    rarity: 'Common',
    skills: [],
    accent: '#ffffff'
  };
}

function transformDefinition(definition: DiceDefinition, die: CombatDie): DiceDefinition {
  if (die.transformIndex === undefined) return definition;
  const stats = definition.transformStats?.[die.transformIndex];
  if (!stats) return definition;
  const baseSkills: DiceSkillDefinition[] = definition.skills.map((skill) => ({
    ...skill,
    modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers
  }));
  const overlay = stats.skills;
  if (Array.isArray(overlay)) {
    overlay.forEach((row, index) => {
      if (!row || index > baseSkills.length) return;
      if (Object.keys(row).length === 0) return;
      const current = baseSkills[index];
      baseSkills[index] = current
        ? {
            ...current,
            ...row,
            modifiers: { ...(current.modifiers ?? {}), ...(row.modifiers ?? {}) }
          }
        : { ...row, modifiers: row.modifiers ?? {} };
    });
  }
  return {
    ...definition,
    title: stats.title ?? definition.title,
    attack: Math.max(1, Math.round((stats.attack ?? definition.attack) * (stats.attackMultiplier ?? 1))),
    health: Math.max(1, Math.round((stats.health ?? definition.health) * (stats.healthMultiplier ?? 1))),
    range: stats.range ?? definition.range,
    footprint: stats.footprint ?? definition.footprint,
    targetingMode: stats.targetingMode ?? definition.targetingMode,
    accent: stats.accent ?? definition.accent,
    skills: baseSkills.filter((skill) => skill.disableSkill !== true)
  };
}

function effectiveDefinition(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  die: CombatDie
): DiceDefinition {
  const definition = transformDefinition(getDefinition(state, definitions, die), die);
  const soulRate = firstNumberModifier(definition, 'soulBoostPercent');
  const souls = die.mana['souls'] ?? 0;
  if (soulRate === undefined || soulRate <= 0 || souls <= 0) return definition;
  return {
    ...definition,
    attack: Math.max(1, Math.round(definition.attack * (1 + soulRate * souls)))
  };
}

function living(state: CombatState, ownerId: OwnerId): CombatDie[] {
  return state.dice.filter((die) => die.ownerId === ownerId && !die.isDestroyed);
}

function boardDice(state: CombatState, ownerId: OwnerId): CombatDie[] {
  return state.dice.filter((die) => (
    die.ownerId === ownerId
    && die.zone === 'board'
    && !die.isDestroyed
    && Boolean(die.gridPosition)
  ));
}

function otherOwner(ownerId: OwnerId): OwnerId {
  return ownerId === 'player' ? 'enemy' : 'player';
}

function cellsFor(die: CombatDie, definition: DiceDefinition, position = die.gridPosition): BattlePosition[] {
  if (!position) return [];
  const footprint = footprintFor(definition);
  const cells: BattlePosition[] = [];
  for (let rowOffset = 0; rowOffset < footprint; rowOffset += 1) {
    for (let colOffset = 0; colOffset < footprint; colOffset += 1) {
      cells.push({ row: position.row + rowOffset, col: position.col + colOffset });
    }
  }
  return cells;
}

function canPlace(
  die: CombatDie,
  definition: DiceDefinition,
  position: BattlePosition,
  occupied: Set<string>
): boolean {
  const footprint = footprintFor(definition);
  if (position.row < 0 || position.col < 0) return false;
  if (position.row + footprint > GRID_SIZE || position.col + footprint > GRID_SIZE) return false;
  return cellsFor(die, definition, position).every((cell) => !occupied.has(`${cell.row}:${cell.col}`));
}

function occupy(
  die: CombatDie,
  definition: DiceDefinition,
  position: BattlePosition,
  occupied: Set<string>
): void {
  for (const cell of cellsFor(die, definition, position)) occupied.add(`${cell.row}:${cell.col}`);
}

function distanceBetween(attacker: CombatDie, target: CombatDie, definitions: Map<string, DiceDefinition>, state: CombatState): number {
  if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;
  const attackerDef = effectiveDefinition(state, definitions, attacker);
  const targetDef = effectiveDefinition(state, definitions, target);
  const attackerCells = cellsFor(attacker, attackerDef);
  const targetCells = cellsFor(target, targetDef);
  if (attacker.ownerId === target.ownerId
    || attacker.mana['infiltrated'] === 1
    || target.mana['infiltrated'] === 1) {
    let best = Number.POSITIVE_INFINITY;
    for (const first of attackerCells) {
      for (const second of targetCells) {
        best = Math.min(best, Math.max(Math.abs(first.row - second.row), Math.abs(first.col - second.col)));
      }
    }
    return best;
  }
  let best = Number.POSITIVE_INFINITY;
  for (const first of attackerCells) {
    for (const second of targetCells) {
      const attackerToFrontline = attacker.ownerId === 'player'
        ? GRID_SIZE - first.col
        : first.col + 1;
      const targetFromFrontline = target.ownerId === 'player'
        ? GRID_SIZE - second.col
        : second.col + 1;
      best = Math.min(best, Math.max(0, attackerToFrontline + targetFromFrontline - 1));
    }
  }
  return best;
}

function rangeOf(state: CombatState, definitions: Map<string, DiceDefinition>, die: CombatDie): number {
  return Math.max(1, effectiveDefinition(state, definitions, die).range);
}

function pickRandom<T>(items: T[], random: RandomSource): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(random() * items.length)];
}

function plusPatternTiles(origin: BattlePosition): BattlePosition[] {
  return [
    origin,
    { row: origin.row - 1, col: origin.col },
    { row: origin.row + 1, col: origin.col },
    { row: origin.row, col: origin.col - 1 },
    { row: origin.row, col: origin.col + 1 }
  ].filter((tile) => tile.row >= 0 && tile.row < GRID_SIZE && tile.col >= 0 && tile.col < GRID_SIZE);
}

function sortedByMode(
  candidates: Array<{ die: CombatDie; distance: number }>,
  mode: string
): Array<{ die: CombatDie; distance: number }> {
  const byNear = [...candidates].sort((a, b) => a.distance - b.distance || a.die.instanceId.localeCompare(b.die.instanceId));
  if (mode === 'Furthest') return byNear.reverse();
  if (mode === 'Strongest') return [...candidates].sort((a, b) => b.die.currentHealth - a.die.currentHealth || a.distance - b.distance);
  if (mode === 'Weakest') return [...candidates].sort((a, b) => a.die.currentHealth - b.die.currentHealth || a.distance - b.distance);
  return byNear;
}

function selectTarget(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  mode: string,
  allies = false,
  damagedOnly = false,
  random: RandomSource
): CombatDie | undefined {
  const owner = allies ? attacker.ownerId : otherOwner(attacker.ownerId);
  const maxRange = allies ? rangeOf(state, definitions, attacker) : rangeOf(state, definitions, attacker);
  let candidates = boardDice(state, owner)
    .filter((die) => die.instanceId !== attacker.instanceId || allies)
    .filter((die) => !damagedOnly || die.currentHealth < die.maxHealth)
    .map((die) => ({ die, distance: distanceBetween(attacker, die, definitions, state) }))
    .filter(({ distance }) => distance <= maxRange);

  if (attacker.tauntedBySourceId && !allies) {
    const taunter = state.dice.find((die) => die.instanceId === attacker.tauntedBySourceId && !die.isDestroyed);
    const tauntCandidate = taunter
      ? candidates.find(({ die }) => die.instanceId === taunter.instanceId)
      : undefined;
    if (tauntCandidate) return tauntCandidate.die;
  }

  if (candidates.length === 0) return undefined;
  if (mode === 'Random') return pickRandom(candidates, random)?.die;
  candidates = sortedByMode(candidates, mode);
  return candidates[0]?.die;
}

function statusStacks(die: CombatDie, type: StatusEffect): number {
  return die.mana[`status:${type}`] ?? 0;
}

function totalStatusStacks(die: CombatDie): number {
  return (['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk', 'acceleration', 'dilation'] as StatusEffect[])
    .reduce((total, effect) => total + statusStacks(die, effect), 0);
}

function addStatus(die: CombatDie, type: StatusEffect, turns: number, value?: number, maxStacks?: number): void {
  const current = statusStacks(die, type);
  const next = maxStacks === undefined ? current + 1 : Math.min(maxStacks, current + 1);
  die.mana[`status:${type}`] = next;
  die.mana[`status:${type}:turns`] = Math.max(turns, die.mana[`status:${type}:turns`] ?? 0);
  die.mana[`status:${type}:value`] = value ?? 0;
}

function clearStatus(die: CombatDie, type: StatusEffect): void {
  delete die.mana[`status:${type}`];
  delete die.mana[`status:${type}:turns`];
  delete die.mana[`status:${type}:value`];
}

function statusTurns(die: CombatDie, type: StatusEffect): number {
  return die.mana[`status:${type}:turns`] ?? 0;
}

function hasStatus(die: CombatDie, type: StatusEffect): boolean {
  return statusStacks(die, type) > 0;
}

function makeRng(seed: string, turn: number): RandomSource {
  let state = 2166136261;
  const input = `${seed}:${turn}`;
  for (let index = 0; index < input.length; index += 1) {
    state ^= input.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  state ^= turn + 0x9e3779b9;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
}

function createDie(
  entry: LoadoutEntry,
  ownerId: OwnerId,
  index: number,
  catalog: DiceCatalog,
  rules: MatchRules
): { die: CombatDie; definition: DiceDefinition } | null {
  const base = catalog.get(entry.typeId);
  if (!base) return null;
  const classLevel = rules.useLevelling ? Math.max(1, Math.floor(entry.classLevel)) : 1;
  const definition = buildCombatDefinition(base, classLevel, entry.talentIndex, rules.useLevelling);
  const instanceId = makeInstanceId(ownerId, index);
  return {
    definition,
    die: {
      instanceId,
      typeId: base.typeId,
      classLevel,
      ownerId,
      zone: 'hand',
      maxHealth: definition.health,
      currentHealth: definition.health,
      isDestroyed: false,
      hasFinishedAttacking: true,
      attacksRemaining: 0,
      pips: 1,
      mana: {},
      shieldHp: 0,
      shieldTurns: 0,
      attackDelta: 0,
      attackDeltaTurns: 0,
      stunTurns: 0,
      tauntTurns: 0,
      fractureRate: 0,
      fractureTurns: 0,
      growth: 0,
      boostedAttacks: 0
    }
  };
}

export interface CombatSetup {
  state: CombatState;
  definitions: Map<string, DiceDefinition>;
}

export function createCombatSetup(
  playerLoadout: LoadoutEntry[],
  enemyLoadout: LoadoutEntry[],
  catalog: DiceCatalog,
  rules: MatchRules
): CombatSetup {
  const definitions = new Map<string, DiceDefinition>();
  const dice: CombatDie[] = [];
  for (const [ownerId, loadout] of [['player', playerLoadout], ['enemy', enemyLoadout]] as const) {
    loadout.forEach((entry, index) => {
      const created = createDie(entry, ownerId, index, catalog, rules);
      if (!created) return;
      dice.push(created.die);
      definitions.set(created.die.instanceId, created.definition);
    });
  }
  return {
    state: {
      turn: 1,
      combatPhase: 'idle',
      dice,
      reviveCounts: {},
      lockedBy: {},
      lavaPools: []
    },
    definitions
  };
}

export function rollPips(state: CombatState, seed: string, turn: number): Record<string, number> {
  const random = makeRng(seed, turn);
  const pips: Record<string, number> = {};
  for (const die of state.dice) {
    if (die.isDestroyed) continue;
    die.pips = 1 + Math.floor(random() * 6);
    pips[die.instanceId] = die.pips;
  }
  return pips;
}

export function toClientState(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  viewer: OwnerId,
  revealOpponent = true
): ClientBattleState {
  const mirror = viewer === 'enemy';
  const visibleDice = revealOpponent
    ? state.dice
    : state.dice.filter((die) => die.ownerId === viewer);
  return {
    turn: state.turn,
    combatPhase: state.combatPhase,
    dice: visibleDice.map((die) => {
      const ownerId: OwnerId = mirror ? otherOwner(die.ownerId) : die.ownerId;
      let gridPosition = die.gridPosition;
      if (gridPosition && mirror) {
        const definition = getDefinition(state, definitions, die);
        const footprint = footprintFor(definition);
        gridPosition = {
          row: gridPosition.row,
          col: GRID_SIZE - footprint - gridPosition.col
        };
      }
      return {
        instanceId: die.instanceId,
        typeId: die.typeId,
        ownerId,
        zone: die.zone,
        maxHealth: die.maxHealth,
        currentHealth: die.currentHealth,
        isDestroyed: die.isDestroyed,
        hasFinishedAttacking: die.hasFinishedAttacking,
        attacksRemaining: die.attacksRemaining,
        ...(gridPosition ? { gridPosition } : {}),
        ...(die.transformIndex !== undefined ? { transformIndex: die.transformIndex } : {})
      };
    }),
    reviveCounts: revealOpponent
      ? { ...state.reviveCounts }
      : Object.fromEntries(Object.entries(state.reviveCounts).filter(([instanceId]) => visibleDice.some((die) => die.instanceId === instanceId)))
  };
}

export function applyBoard(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  ownerId: OwnerId,
  submissions: Array<{ instanceId: string; typeId: string; row: number; col: number }>
): string | null {
  const ownDice = state.dice.filter((die) => die.ownerId === ownerId && !die.isDestroyed);
  if (submissions.length !== ownDice.length) return 'Board must contain every living die.';
  const byInstance = new Map<string, { instanceId: string; typeId: string; row: number; col: number }>();
  for (const submission of submissions) {
    if (byInstance.has(submission.instanceId)) return 'Board contains duplicate dice.';
    byInstance.set(submission.instanceId, submission);
  }

  const occupied = new Set<string>();
  for (const die of state.dice) {
    if (die.ownerId === ownerId || die.isDestroyed || die.zone !== 'board' || !die.gridPosition) continue;
    const definition = effectiveDefinition(state, definitions, die);
    occupy(die, definition, die.gridPosition, occupied);
  }

  const nextPositions = new Map<string, { row: number; col: number }>();
  for (const die of ownDice) {
    const submission = byInstance.get(die.instanceId);
    if (!submission) return 'Board is missing a die.';
    if (submission.typeId !== die.typeId) return 'Board contains an invalid die.';
    const definition = effectiveDefinition(state, definitions, die);
    const position = { row: submission.row, col: submission.col };
    if (!canPlace(die, definition, position, occupied)) return 'Board contains an invalid position.';
    occupy(die, definition, position, occupied);
    nextPositions.set(die.instanceId, position);
  }

  for (const die of ownDice) {
    const position = nextPositions.get(die.instanceId);
    if (!position) return 'Board is missing a die.';
    die.zone = 'board';
    die.gridPosition = position;
  }
  return null;
}

function autoPlaceOne(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  die: CombatDie,
  occupied: Set<string>,
  random: RandomSource
): boolean {
  const definition = effectiveDefinition(state, definitions, die);
  const footprint = footprintFor(definition);
  const columns = Array.from({ length: GRID_SIZE - footprint + 1 }, (_, index) => index);
  const preferred = die.ownerId === 'player'
    ? columns.filter((col) => col >= Math.max(0, footprint - 1))
    : columns.filter((col) => col <= GRID_SIZE - footprint);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const row = Math.floor(random() * (GRID_SIZE - footprint + 1));
    const col = pickRandom(preferred, random);
    if (col === undefined) break;
    const position = { row, col };
    if (canPlace(die, definition, position, occupied)) {
      occupy(die, definition, position, occupied);
      die.zone = 'board';
      die.gridPosition = position;
      return true;
    }
  }
  for (const position of columns.flatMap((col) => (
    Array.from({ length: GRID_SIZE - footprint + 1 }, (_, row) => ({ row, col }))
  ))) {
    if (canPlace(die, definition, position, occupied)) {
      occupy(die, definition, position, occupied);
      die.zone = 'board';
      die.gridPosition = position;
      return true;
    }
  }
  return false;
}

export function autoPlaceBoard(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  ownerId: OwnerId,
  seed: string,
  turn: number
): number {
  const random = makeRng(seed, turn + (ownerId === 'player' ? 0 : 10_000));
  const occupied = new Set<string>();
  for (const die of state.dice) {
    if (die.ownerId !== ownerId || die.isDestroyed || die.zone !== 'board' || !die.gridPosition) continue;
    occupy(die, effectiveDefinition(state, definitions, die), die.gridPosition, occupied);
  }
  let placed = 0;
  for (const die of state.dice) {
    if (die.ownerId !== ownerId || die.isDestroyed || die.zone !== 'hand') continue;
    if (autoPlaceOne(state, definitions, die, occupied, random)) placed += 1;
  }
  return placed;
}

function damageMultiplier(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie
): number {
  const definition = effectiveDefinition(state, definitions, attacker);
  const distance = distanceBetween(attacker, target, definitions, state);
  let multiplier = 1;
  const lowHpThreshold = firstNumberModifier(definition, 'lowHpThresholdRate');
  const lowHpBonus = firstNumberModifier(definition, 'lowHpDamageBonusRate');
  if (lowHpThreshold !== undefined && lowHpBonus !== undefined && target.maxHealth > 0) {
    if (target.currentHealth < target.maxHealth * lowHpThreshold) multiplier += lowHpBonus;
  }
  const distanceBonus = firstNumberModifier(definition, 'distanceDamageBonusRatePerTile');
  if (distanceBonus !== undefined && Number.isFinite(distance)) multiplier += distanceBonus * distance;
  const distanceFlat = firstNumberModifier(definition, 'distanceDamageBonusPerTile');
  if (distanceFlat !== undefined && Number.isFinite(distance)) multiplier += distanceFlat / Math.max(1, definition.attack);
  const berserkThreshold = maxModifier(definition, 'berserkThresholdRate');
  const berserkMultiplier = maxModifier(definition, 'berserkDamageMultiplier');
  if (berserkMultiplier > 1 && berserkThreshold > 0 && attacker.currentHealth < attacker.maxHealth * berserkThreshold) {
    multiplier *= berserkMultiplier;
  }
  return Math.max(1, multiplier);
}

function targetCurrentHealthBonus(state: CombatState, definitions: Map<string, DiceDefinition>, attacker: CombatDie, target: CombatDie): number {
  const definition = effectiveDefinition(state, definitions, attacker);
  const rate = maxModifier(definition, 'targetCurrentHpBonusRate');
  const maxRate = maxModifier(definition, 'targetMaxHpBonusRate');
  let amount = Math.floor(target.currentHealth * rate) + Math.floor(target.maxHealth * maxRate);
  const adjacentAllies = boardDice(state, attacker.ownerId).some((die) => (
    die.instanceId !== attacker.instanceId
    && distanceBetween(attacker, die, definitions, state) <= 1
  ));
  if (maxRate > 0 && adjacentAllies) amount = 0;
  return Math.max(0, amount);
}

function criticalChance(state: CombatState, definitions: Map<string, DiceDefinition>, attacker: CombatDie): number {
  const definition = effectiveDefinition(state, definitions, attacker);
  return clamp(BASE_CRITICAL_CHANCE + maxModifier(definition, 'criticalChanceIncrease'), 0, 1);
}

function criticalMultiplier(state: CombatState, definitions: Map<string, DiceDefinition>, attacker: CombatDie): number {
  const definition = effectiveDefinition(state, definitions, attacker);
  return 2 + maxModifier(definition, 'criticalDamageIncrease');
}

function statusBonusDamage(state: CombatState, definitions: Map<string, DiceDefinition>, attacker: CombatDie, base: number): number {
  const definition = effectiveDefinition(state, definitions, attacker);
  const rate = maxModifier(definition, 'bonusDamagePerStatus');
  return rate > 0 ? Math.floor(base * rate * totalStatusStacks(attacker)) : 0;
}

function maybeApplyAvoid(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  target: CombatDie,
  events: CombatEvent[],
  random: RandomSource,
  attacker: CombatDie
): boolean {
  const definition = effectiveDefinition(state, definitions, target);
  const chance = clamp(maxModifier(definition, 'avoidAttackChance'), 0, 1);
  if (chance <= 0 || random() >= chance) return false;
  addEvent(events, 'info', `${definition.title} avoids ${effectiveDefinition(state, definitions, attacker).title}.`, {
    ownerId: target.ownerId,
    sourceId: attacker.instanceId,
    targetId: target.instanceId
  });
  return true;
}

function dealDamage(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie | undefined,
  target: CombatDie,
  rawDamage: number,
  events: CombatEvent[],
  random: RandomSource,
  options: { critical?: boolean; allowCritical?: boolean; sourceLabel?: string; chainDepth?: number } = {}
): { dealt: number; absorbed: number; defeated: boolean; critical: boolean } {
  if (target.isDestroyed) return { dealt: 0, absorbed: 0, defeated: false, critical: false };
  const critical = options.allowCritical !== false
    && (options.critical === true || (attacker ? random() < criticalChance(state, definitions, attacker) : false));
  let damage = Math.max(1, Math.floor(rawDamage));
  if (critical && attacker) damage = Math.floor(damage * criticalMultiplier(state, definitions, attacker));
  if (target.fractureRate > 0) damage = Math.floor(damage * (1 + target.fractureRate));
  const absorbed = Math.min(target.shieldHp, damage);
  target.shieldHp = Math.max(0, target.shieldHp - absorbed);
  damage -= absorbed;
  target.currentHealth = Math.max(0, target.currentHealth - damage);
  const onDamagedDamage = damage > 0 ? damage : absorbed;
  addEvent(events, 'damage', `${effectiveDefinition(state, definitions, target).title} takes ${damage} damage${absorbed > 0 ? ` (${absorbed} absorbed)` : ''}${critical ? ' (CRITICAL)' : ''}.`, {
    ownerId: target.ownerId,
    sourceId: attacker?.instanceId,
    targetId: target.instanceId,
    amount: damage,
    critical
  });
  if (attacker && onDamagedDamage > 0) {
    applyOnDamaged(state, definitions, target, attacker, onDamagedDamage, events, random);
  }
  if (target.currentHealth <= 0) {
    handleDefeat(state, definitions, attacker, target, events, random, options.chainDepth ?? 0);
  }
  return { dealt: damage, absorbed, defeated: target.isDestroyed, critical };
}

function nuclearDimensions(value: unknown): { rows: number; cols: number } {
  if (Array.isArray(value) && value.length >= 1) {
    const rows = typeof value[0] === 'number' && Number.isFinite(value[0]) ? Math.max(1, Math.floor(value[0])) : 3;
    const cols = typeof value[1] === 'number' && Number.isFinite(value[1]) ? Math.max(1, Math.floor(value[1])) : rows;
    return { rows, cols };
  }
  if (typeof value === 'string') {
    const match = value.match(/(\d+)\s*[xX×]\s*(\d+)/);
    if (match) return { rows: Math.max(1, Number(match[1])), cols: Math.max(1, Number(match[2])) };
    const single = Number(value);
    if (Number.isFinite(single)) return { rows: Math.max(1, Math.floor(single)), cols: Math.max(1, Math.floor(single)) };
  }
  return { rows: 3, cols: 3 };
}

function triggerNuclear(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  modifiers: SkillModifiers | undefined,
  events: CombatEvent[],
  random: RandomSource,
  position = source.gridPosition
): void {
  if (!booleanMod(modifiers, 'hasNuclear') || source.mana['nuclearUsed'] === 1 || !position) return;
  source.mana['nuclearUsed'] = 1;
  const definition = effectiveDefinition(state, definitions, source);
  const damage = Math.max(1, Math.floor(numberMod(modifiers, 'nuclearDamage') ?? definition.attack));
  const { rows, cols } = nuclearDimensions(modifiers?.nuclearArea);
  const origin = { row: position.row, col: GRID_SIZE - 1 - position.col };
  const top = origin.row - Math.floor(rows / 2);
  const left = origin.col - Math.floor(cols / 2);
  for (const victim of boardDice(state, otherOwner(source.ownerId))) {
    if (!cellsFor(victim, effectiveDefinition(state, definitions, victim)).some((cell) => (
      cell.row >= top && cell.row < top + rows && cell.col >= left && cell.col < left + cols
    ))) continue;
    dealDamage(state, definitions, source, victim, damage, events, random, { allowCritical: false });
  }
  const pool = stringMod(modifiers, 'nuclearPool');
  const poolTurns = Math.max(0, Math.floor(numberMod(modifiers, 'nuclearPoolLifespan') ?? 0));
  if (pool && poolTurns > 0) {
    const poolDamage = Math.max(1, Math.floor(numberMod(modifiers, 'lavaDamage') ?? 50));
    for (let row = top; row < top + rows; row += 1) {
      for (let col = left; col < left + cols; col += 1) {
        if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) continue;
        state.lavaPools.push({ row, col, damage: poolDamage, turns: poolTurns, ownerId: source.ownerId, typeId: source.typeId });
      }
    }
  }
  addEvent(events, 'skill', `${definition.title} detonates a nuclear strike on the opposite board for ${damage} damage.`, {
    ownerId: source.ownerId,
    sourceId: source.instanceId
  });
}

function applyPlague(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  defeated: CombatDie,
  modifiers: SkillModifiers | undefined,
  events: CombatEvent[],
  defeatedPosition?: BattlePosition
): void {
  if (!booleanMod(modifiers, 'hasPlague')) return;
  const configured = stringMod(modifiers, 'plaguedDieType')?.trim();
  const typeId = !configured || configured === '{instanceId}' ? source.typeId : configured;
  const sourceDefinition = effectiveDefinition(state, definitions, source);
  const base = [...definitions.values()].find((definition) => definition.typeId === typeId) ?? sourceDefinition;
  const healthRate = clamp(numberMod(modifiers, 'plaguedDieHealth') ?? 1, 0, 1);
  const attackRate = Math.max(0, numberMod(modifiers, 'plaguedDieAttack') ?? 1);
  const maxHealth = Math.max(1, Math.ceil(defeated.maxHealth * healthRate));
  const definition: DiceDefinition = {
    ...base,
    typeId,
    attack: Math.max(1, Math.round(base.attack * attackRate)),
    health: maxHealth,
    skills: base.skills.map((skill) => ({ ...skill, modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers }))
  };
  const instanceId = `${source.ownerId === 'player' ? 'a' : 'b'}-plague-${state.dice.length + 1}`;
  const spawned: CombatDie = {
    instanceId,
    typeId,
    classLevel: source.classLevel,
    ownerId: source.ownerId,
    zone: 'board',
    maxHealth,
    currentHealth: maxHealth,
    isDestroyed: false,
    hasFinishedAttacking: true,
    attacksRemaining: 0,
    pips: 1,
    mana: {},
    shieldHp: 0,
    shieldTurns: 0,
    attackDelta: 0,
    attackDeltaTurns: 0,
    stunTurns: 0,
    tauntTurns: 0,
    fractureRate: 0,
    fractureTurns: 0,
    growth: 0,
    boostedAttacks: 0
  };
  const occupied = new Set<string>();
  for (const die of state.dice) {
    if (die.zone !== 'board' || die.isDestroyed || !die.gridPosition) continue;
    occupy(die, effectiveDefinition(state, definitions, die), die.gridPosition, occupied);
  }
  const preferred = defeatedPosition
    ? { row: defeatedPosition.row, col: GRID_SIZE - 1 - defeatedPosition.col }
    : { row: 0, col: 0 };
  const positions = [preferred];
  for (let row = 0; row < GRID_SIZE; row += 1) for (let col = 0; col < GRID_SIZE; col += 1) positions.push({ row, col });
  const position = positions.find((candidate) => canPlace(spawned, definition, candidate, occupied));
  if (!position) return;
  spawned.gridPosition = position;
  state.dice.push(spawned);
  definitions.set(instanceId, definition);
  addEvent(events, 'summon', `${effectiveDefinition(state, definitions, source).title} spreads the plague, raising ${definition.title}.`, {
    ownerId: source.ownerId,
    sourceId: source.instanceId,
    targetId: instanceId
  });
}

function handleDefeat(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie | undefined,
  target: CombatDie,
  events: CombatEvent[],
  random: RandomSource,
  depth = 0
): void {
  const definition = effectiveDefinition(state, definitions, target);
  const onDeathModifiers = triggerModifiers(definition, 'OnDeath', target.classLevel);
  const hasRevive = booleanMod(onDeathModifiers, 'hasRevive');
  const reviveChance = numberMod(onDeathModifiers, 'reviveChance');
  const maxRevives = numberMod(onDeathModifiers, 'maxRevives') ?? 0;
  const previousRevives = state.reviveCounts[target.instanceId] ?? 0;
  const otherLiving = living(state, target.ownerId).some((die) => die.instanceId !== target.instanceId);
  const decay = numberMod(onDeathModifiers, 'reviveChanceRate') ?? 1;
  const chance = reviveChance === undefined ? 0 : clamp(reviveChance * (decay ** previousRevives), 0, 1);
  const canRevive = hasRevive
    && chance > 0
    && previousRevives < maxRevives
    && (!booleanMod(onDeathModifiers, 'dontReviveWhenLastOneStanding') || otherLiving);
  if (canRevive && random() < chance) {
    const healthRate = clamp(numberMod(onDeathModifiers, 'reviveHealth') ?? 1, 0, 1);
    const attackRate = clamp(numberMod(onDeathModifiers, 'reviveAttack') ?? 1, 0, 1);
    const revivedDefinition: DiceDefinition = {
      ...definition,
      attack: Math.max(1, Math.round(definition.attack * attackRate)),
      health: Math.max(1, Math.round(target.maxHealth * healthRate))
    };
    state.reviveCounts[target.instanceId] = previousRevives + 1;
    definitions.set(target.instanceId, revivedDefinition);
    target.isDestroyed = false;
    target.zone = 'board';
    target.maxHealth = revivedDefinition.health;
    target.currentHealth = revivedDefinition.health;
    target.attacksRemaining = 0;
    target.hasFinishedAttacking = true;
    addEvent(events, 'revive', `${definition.title} revives with ${target.maxHealth} health!`, {
      ownerId: target.ownerId,
      targetId: target.instanceId
    });
    return;
  }

  const defeatedPosition = target.gridPosition;
  target.currentHealth = 0;
  target.isDestroyed = true;
  target.zone = 'eliminated';
  target.gridPosition = undefined;
  target.attacksRemaining = 0;
  target.hasFinishedAttacking = true;
  addEvent(events, 'defeat', `${definition.title} is defeated!`, {
    ownerId: target.ownerId,
    targetId: target.instanceId
  });
  captureSouls(state, definitions, target, events, random);
  if (onDeathModifiers) triggerNuclear(state, definitions, target, onDeathModifiers, events, random, defeatedPosition);

  if (depth >= 4) return;

  if (onDeathModifiers && attacker) {
    const deathDamage = numberMod(onDeathModifiers, 'deathDamage');
    if (deathDamage !== undefined && !attacker.isDestroyed) {
      dealDamage(state, definitions, target, attacker, deathDamage, events, random, {
        allowCritical: false,
        chainDepth: depth + 1
      });
    }
    statusApplication(state, definitions, attacker, target, onDeathModifiers, events, target.pips);
    const growth = growthDeltaFor(onDeathModifiers, random);
    if (growth !== undefined) {
      target.growth += growth;
      addEvent(events, 'skill', `${definition.title} grows permanently.`, {
        ownerId: target.ownerId,
        sourceId: target.instanceId
      });
    }
    const allyGrant = attackGrantAmount(onDeathModifiers, 'grantAttacksToAlly', true);
    if (allyGrant > 0) grantAttacks(state, definitions, target, allyGrant, true, events, random, grantMode(onDeathModifiers));
    const foeGrant = attackGrantAmount(onDeathModifiers, 'grantAttacksToFoe', true);
    if (foeGrant > 0) grantAttacks(state, definitions, target, foeGrant, false, events, random, grantMode(onDeathModifiers));
  }

  if (!attacker || attacker.isDestroyed) return;
  const attackerDefinition = effectiveDefinition(state, definitions, attacker);
  const modifiers = triggerModifiers(attackerDefinition, 'OnKill', attacker.classLevel);
  if (!modifiers) return;
  statusApplication(state, definitions, target, attacker, modifiers, events, attacker.pips);
  const growth = growthDeltaFor(modifiers, random);
  if (growth !== undefined) {
    attacker.growth += growth;
    addEvent(events, 'skill', `${attackerDefinition.title} grows permanently.`, {
      ownerId: attacker.ownerId,
      sourceId: attacker.instanceId
    });
  }
  const onKillDamage = numberMod(modifiers, 'onKillDamage');
  if (onKillDamage !== undefined) attacker.mana['onKillDamage'] = (attacker.mana['onKillDamage'] ?? 0) + onKillDamage;
  const allyGrant = attackGrantAmount(modifiers, 'grantAttacksToAlly', true);
  if (allyGrant > 0) grantAttacks(state, definitions, attacker, allyGrant, true, events, random, grantMode(modifiers));
  const foeGrant = attackGrantAmount(modifiers, 'grantAttacksToFoe', true);
  if (foeGrant > 0) grantAttacks(state, definitions, attacker, foeGrant, false, events, random, grantMode(modifiers));
  const hammerDamage = numberMod(modifiers, 'hammerDamage');
  if (booleanMod(modifiers, 'hasHammer') && hammerDamage !== undefined) {
    const hammerRadius = numberMod(modifiers, 'hammerRadius') ?? 1;
    const victims = boardDice(state, target.ownerId).filter((die) => (
      die.instanceId !== target.instanceId
      && distanceBetween(target, die, definitions, state) <= hammerRadius
    ));
    for (const victim of victims) {
      addEvent(events, 'skill', `${attackerDefinition.title}'s Judgment Hammer falls.`, {
        ownerId: attacker.ownerId,
        sourceId: attacker.instanceId,
        targetId: victim.instanceId
      });
      dealDamage(state, definitions, attacker, victim, Math.max(1, Math.floor(hammerDamage)), events, random, {
        allowCritical: false,
        chainDepth: depth + 1
      });
    }
  }
  const missingHeal = numberMod(modifiers, 'missingHealRate');
  if (missingHeal !== undefined) {
    const missing = Math.max(0, attacker.maxHealth - attacker.currentHealth);
    const healed = Math.floor(missing * missingHeal);
    if (healed > 0) {
      attacker.currentHealth = Math.min(attacker.maxHealth, attacker.currentHealth + healed);
      addEvent(events, 'heal', `${attackerDefinition.title} heals ${healed} health.`, {
        ownerId: attacker.ownerId,
        sourceId: attacker.instanceId,
        amount: healed
      });
    }
  }
  const bonusDamage = Math.floor(attackerDefinition.attack * (numberMod(modifiers, 'damageRatePerKill') ?? 0));
  if (bonusDamage > 0) attacker.mana['onKillDamage'] = (attacker.mana['onKillDamage'] ?? 0) + bonusDamage;
  applyPlague(state, definitions, attacker, target, modifiers, events, defeatedPosition);
}

function applyOnDamaged(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  target: CombatDie,
  attacker: CombatDie,
  damage: number,
  events: CombatEvent[],
  random: RandomSource
): void {
  const definition = effectiveDefinition(state, definitions, target);
  const modifiers = triggerModifiers(definition, 'OnDamaged', target.classLevel);
  if (!modifiers) return;
  if (target.currentHealth > 0) {
    statusApplication(state, definitions, attacker, target, modifiers, events, target.pips);
  }
  const growth = growthDeltaFor(modifiers, random);
  if (growth !== undefined) {
    target.growth += growth;
    addEvent(events, 'skill', `${definition.title} grows permanently.`, {
      ownerId: target.ownerId,
      sourceId: target.instanceId
    });
  }
  const onHitDamage = numberMod(modifiers, 'onHitDamage');
  if (onHitDamage !== undefined && !attacker.isDestroyed) {
    dealDamage(state, definitions, target, attacker, Math.max(1, Math.floor(onHitDamage)), events, random, { allowCritical: false });
  }
  if (target.currentHealth > 0) {
    const shield = numberMod(modifiers, 'shield');
    if (shield !== undefined) {
      target.shieldHp += shield;
      target.shieldTurns = Math.max(target.shieldTurns, numberMod(modifiers, 'statusDuration') ?? 1);
      addEvent(events, 'shield', `${definition.title} gains ${shield} shield.`, {
        ownerId: target.ownerId,
        targetId: target.instanceId,
        amount: shield
      });
    }
    const allyGrant = attackGrantAmount(modifiers, 'grantAttacksToAlly', true);
    if (allyGrant > 0) grantAttacks(state, definitions, target, allyGrant, true, events, random, grantMode(modifiers));
    const foeGrant = attackGrantAmount(modifiers, 'grantAttacksToFoe', true);
    if (foeGrant > 0) grantAttacks(state, definitions, target, foeGrant, false, events, random, grantMode(modifiers));
  }
  const revengeThreshold = numberMod(modifiers, 'revengeThresholdRate');
  if (vengeanceIsActive(target, damage, revengeThreshold)) {
    const hits = Math.max(1, Math.floor(numberMod(modifiers, 'revengeHits') ?? 1));
    const revengeDamage = numberMod(modifiers, 'revengeDamage') ?? definition.attack;
    for (let index = 0; index < hits && !attacker.isDestroyed; index += 1) {
      dealDamage(state, definitions, target, attacker, Math.max(1, Math.floor(revengeDamage)), events, random, {
        allowCritical: false,
        chainDepth: 1
      });
    }
  }
}

function vengeanceIsActive(target: CombatDie, damage: number, threshold: number | undefined): boolean {
  return threshold !== undefined && damage > 0 && target.currentHealth > 0 && target.currentHealth < target.maxHealth * threshold;
}

function heal(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  target: CombatDie,
  amount: number,
  events: CombatEvent[],
  random: RandomSource
): number {
  if (target.isDestroyed) return 0;
  const critical = random() < BASE_CRITICAL_CHANCE;
  const healed = Math.min(Math.floor(amount * (critical ? 2 : 1)), Math.max(0, target.maxHealth - target.currentHealth));
  if (healed <= 0) return 0;
  target.currentHealth += healed;
  addEvent(events, 'heal', `${effectiveDefinition(state, definitions, source).title} heals ${effectiveDefinition(state, definitions, target).title} for ${healed}${critical ? ' (CRITICAL)' : ''}.`, {
    ownerId: target.ownerId,
    sourceId: source.instanceId,
    targetId: target.instanceId,
    amount: healed,
    critical
  });
  return healed;
}

function normalizeSummonPattern(value: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) return undefined;
  const pattern = value.flatMap((entry): Array<[number, number]> => (
    Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === 'number' && typeof entry[1] === 'number'
      ? [[Math.trunc(entry[0]), Math.trunc(entry[1])]]
      : []
  ));
  return pattern.length > 0 ? pattern : undefined;
}

function captureSouls(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  defeated: CombatDie,
  events: CombatEvent[],
  random: RandomSource
): void {
  for (const conjurer of [...state.dice]) {
    if (conjurer.isDestroyed || conjurer.instanceId === defeated.instanceId) continue;
    const definition = effectiveDefinition(state, definitions, conjurer);
    if (!hasBooleanModifier(definition, 'canConjureSouls')) continue;
    const conjureType = firstStringModifier(definition, 'conjureType') ?? 'ally';
    const matches = conjureType === 'both'
      || (conjureType === 'ally' && conjurer.ownerId === defeated.ownerId)
      || (conjureType === 'enemy' && conjurer.ownerId !== defeated.ownerId);
    if (!matches) continue;
    const currentSouls = conjurer.mana['souls'] ?? 0;
    const maxSouls = firstNumberModifier(definition, 'maxSouls');
    if (!hasBooleanModifier(definition, 'noMaxSouls') && maxSouls !== undefined && currentSouls >= maxSouls) continue;
    const souls = currentSouls + 1;
    conjurer.mana['souls'] = souls;
    const boostRate = firstNumberModifier(definition, 'soulBoostPercent');
    if (boostRate !== undefined && boostRate > 0) {
      const baseHealth = conjurer.mana['soulBaseHealth'] ?? conjurer.maxHealth;
      conjurer.mana['soulBaseHealth'] = baseHealth;
      const healthRatio = conjurer.maxHealth > 0 ? conjurer.currentHealth / conjurer.maxHealth : 1;
      conjurer.maxHealth = Math.max(1, Math.round(baseHealth * (1 + boostRate * souls)));
      conjurer.currentHealth = Math.max(1, Math.min(conjurer.maxHealth, Math.round(conjurer.maxHealth * healthRatio)));
    }
    addEvent(events, 'skill', `${definition.title} captures a soul from ${defeated.typeId} (${souls}).`, {
      ownerId: conjurer.ownerId,
      sourceId: conjurer.instanceId,
      targetId: defeated.instanceId
    });
    const transformSouls = firstNumberModifier(definition, 'transformSoulCount');
    if (transformSouls !== undefined && souls >= transformSouls && conjurer.transformIndex === undefined) {
      transformDie(state, definitions, conjurer, events, random);
    }
  }
}

function pierceBehindTargets(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie,
  range: number
): CombatDie[] {
  if (!attacker.gridPosition || !target.gridPosition || range <= 0) return [];
  const rowStep = Math.sign(target.gridPosition.row - attacker.gridPosition.row);
  const colStep = attacker.ownerId === 'player' ? 1 : -1;
  const targetDefinition = effectiveDefinition(state, definitions, target);
  const targetFootprint = footprintFor(targetDefinition);
  const victims: CombatDie[] = [];
  const hitIds = new Set<string>();
  for (let offset = targetFootprint; offset < targetFootprint + range; offset += 1) {
    const row = target.gridPosition.row + rowStep * offset;
    const col = target.gridPosition.col + colStep * offset;
    for (const candidate of boardDice(state, target.ownerId)) {
      if (candidate.instanceId === target.instanceId || hitIds.has(candidate.instanceId)) continue;
      if (!cellsFor(candidate, effectiveDefinition(state, definitions, candidate)).some((cell) => cell.row === row && cell.col === col)) continue;
      hitIds.add(candidate.instanceId);
      victims.push(candidate);
    }
  }
  return victims;
}

function summon(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  typeId: string,
  count: number,
  catalog: DiceCatalog,
  rules: MatchRules,
  events: CombatEvent[],
  random: RandomSource,
  options: { pattern?: Array<[number, number]>; allowRoll?: boolean } = {}
): void {
  const base = catalog.get(typeId);
  if (!base) return;
  const occupied = new Set<string>();
  for (const die of state.dice) {
    if (die.zone !== 'board' || die.isDestroyed || !die.gridPosition) continue;
    occupy(die, effectiveDefinition(state, definitions, die), die.gridPosition, occupied);
  }
  for (let index = 0; index < count; index += 1) {
    const classLevel = Math.max(1, source.classLevel);
    const definition = buildCombatDefinition(base, classLevel, null, rules.useLevelling);
    const instanceId = `${source.ownerId === 'player' ? 'a' : 'b'}-summon-${state.dice.length + index + 1}`;
    const pips = options.allowRoll ? 1 + Math.floor(random() * 6) : 1;
    const attacksRemaining = options.allowRoll ? Math.max(1, pips) : 0;
    const die: CombatDie = {
      instanceId,
      typeId,
      classLevel,
      ownerId: source.ownerId,
      zone: 'hand',
      maxHealth: definition.health,
      currentHealth: definition.health,
      isDestroyed: false,
      hasFinishedAttacking: attacksRemaining <= 0,
      attacksRemaining,
      pips,
      mana: {},
      shieldHp: 0,
      shieldTurns: 0,
      attackDelta: 0,
      attackDeltaTurns: 0,
      stunTurns: 0,
      tauntTurns: 0,
      fractureRate: 0,
      fractureTurns: 0,
      growth: 0,
      boostedAttacks: 0
    };
    const patternedCandidates = (options.pattern ?? [])
      .filter((entry) => Array.isArray(entry) && entry.length >= 2 && typeof entry[0] === 'number' && typeof entry[1] === 'number')
      .map(([rowOffset, colOffset]) => ({
        row: (source.gridPosition?.row ?? 0) + Math.trunc(rowOffset),
        col: (source.gridPosition?.col ?? 0) + Math.trunc(colOffset)
      }))
      .filter((position) => canPlace(die, definition, position, occupied));
    const freePositions: BattlePosition[] = [];
    for (let row = 0; row < GRID_SIZE; row += 1) {
      for (let col = 0; col < GRID_SIZE; col += 1) {
        if (canPlace(die, definition, { row, col }, occupied)) freePositions.push({ row, col });
      }
    }
    const position = patternedCandidates[0] ?? pickRandom(freePositions, random);
    if (!position) continue;
    occupy(die, definition, position, occupied);
    die.zone = 'board';
    die.gridPosition = position;
    state.dice.push(die);
    definitions.set(instanceId, definition);
    addEvent(events, 'summon', `${definition.title} is summoned.`, {
      ownerId: source.ownerId,
      sourceId: source.instanceId,
      targetId: instanceId
    });
  }
}

function applyPassiveOnHit(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie,
  events: CombatEvent[],
  random: RandomSource,
  depth = 0
): void {
  if (depth > 6) return;
  const definition = effectiveDefinition(state, definitions, attacker);
  const modifiers = triggerModifiers(definition, 'Passive', attacker.classLevel);
  if (!modifiers) return;
  statusApplication(state, definitions, attacker, target, modifiers, events, attacker.pips);
  const growth = growthDeltaFor(modifiers, random);
  if (growth !== undefined) attacker.growth += growth;
  const allyGrant = attackGrantAmount(modifiers, 'grantAttacksToAlly', true);
  if (allyGrant > 0) grantAttacks(state, definitions, attacker, allyGrant, true, events, random, grantMode(modifiers));
  const foeGrant = attackGrantAmount(modifiers, 'grantAttacksToFoe', true);
  if (foeGrant > 0) grantAttacks(state, definitions, attacker, foeGrant, false, events, random, grantMode(modifiers));

  if (hasSplashEffect(modifiers)) {
    const splash = pipScaledDamage(definition, modifiers, 'splashDamage', attacker.pips, definition.attack);
    const victims = boardDice(state, target.ownerId).filter((die) => (
      die.instanceId !== target.instanceId
      && distanceBetween(target, die, definitions, state) <= 1
    ));
    for (const victim of victims) {
      dealDamage(state, definitions, attacker, victim, splash, events, random, { allowCritical: false });
    }
  }
  if (hasChainEffect(modifiers)) {
    const range = Math.max(1, Math.floor(numberMod(modifiers, 'chainRange') ?? 2));
    const chainDamage = pipScaledDamage(definition, modifiers, 'chainDamage', attacker.pips, definition.attack);
    const chainTarget = pickRandom(
      boardDice(state, target.ownerId).filter((die) => (
        die.instanceId !== target.instanceId && distanceBetween(target, die, definitions, state) <= range
      )),
      random
    );
    if (chainTarget) {
      dealDamage(state, definitions, attacker, chainTarget, chainDamage, events, random, { allowCritical: false });
    }
  }
  const hasHeatwave = numberMod(modifiers, 'heatwaveDamage') !== undefined
    || numberMod(modifiers, 'heatwaveDamageRate') !== undefined
    || (modifiers?.heatwaveDamageRatesByPip !== undefined && typeof modifiers.heatwaveDamageRatesByPip === 'object');
  if (hasHeatwave) {
    const heatwave = pipScaledDamage(definition, modifiers, 'heatwaveDamage', attacker.pips, definition.attack);
    const victims = boardDice(state, target.ownerId).filter((die) => (
      die.instanceId !== target.instanceId && distanceBetween(target, die, definitions, state) <= 1
    ));
    for (const victim of victims) {
      dealDamage(state, definitions, attacker, victim, heatwave, events, random, { allowCritical: false });
    }
  }
  const pierceRange = numberMod(modifiers, 'pierceBehindRange');
  if (pierceRange !== undefined && pierceRange > 0) {
    for (const victim of pierceBehindTargets(state, definitions, attacker, target, Math.max(1, Math.floor(pierceRange)))) {
      dealDamage(state, definitions, attacker, victim, Math.max(1, definition.attack), events, random, { allowCritical: false });
    }
  }
  const ricochet = numberMod(modifiers, 'ricochetCount');
  if (ricochet !== undefined && ricochet > 0) {
    const allies = boardDice(state, attacker.ownerId)
      .filter((die) => die.instanceId !== attacker.instanceId && die.currentHealth < die.maxHealth)
      .slice(0, ricochet);
    for (const ally of allies) heal(state, definitions, attacker, ally, definition.attack, events, random);
  }
}

function addMana(
  attacker: CombatDie,
  definition: DiceDefinition,
  amount = 1,
  events?: CombatEvent[],
  state?: CombatState
): void {
  if (hasBooleanModifier(definition, 'disableManaGain')) return;
  activeSkills(definition, attacker.classLevel).forEach((skill, index) => {
    const key = activeManaKey(skill, index);
    const needed = Math.max(1, skill.manaNeeded ?? 1);
    attacker.mana[key] = Math.min(needed, (attacker.mana[key] ?? 0) + amount);
  });
  void events;
  void state;
}

function takeMana(target: CombatDie, definition: DiceDefinition, amount: number): number {
  let remaining = Math.max(0, Math.floor(amount));
  let taken = 0;
  for (const [index, skill] of activeSkills(definition, target.classLevel).entries()) {
    if (remaining <= 0) break;
    const key = activeManaKey(skill, index);
    const available = target.mana[key] ?? 0;
    const stolen = Math.min(available, remaining);
    if (stolen <= 0) continue;
    target.mana[key] = available - stolen;
    remaining -= stolen;
    taken += stolen;
  }
  return taken;
}

function chargeMana(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  events: CombatEvent[]
): void {
  const definition = effectiveDefinition(state, definitions, source);
  const modifiers = triggerModifiers(definition, 'CombatStart', source.classLevel);
  if (!modifiers) return;
  const hasManaEffect = numberMod(modifiers, 'manaGain') !== undefined
    || numberMod(modifiers, 'allyManaGain') !== undefined
    || numberMod(modifiers, 'foeManaGain') !== undefined
    || numberMod(modifiers, 'manaSteal') !== undefined;
  if (!hasManaEffect) return;
  const selfGain = Math.max(0, Math.floor(numberMod(modifiers, 'manaGain') ?? 0));
  const allyGain = Math.max(0, Math.floor(numberMod(modifiers, 'allyManaGain') ?? 0));
  const foeGain = Math.max(0, Math.floor(numberMod(modifiers, 'foeManaGain') ?? 0));
  const steal = Math.max(0, Math.floor(numberMod(modifiers, 'manaSteal') ?? 0));
  const stealType = stringMod(modifiers, 'manaStealType') ?? 'enemy';
  if (selfGain > 0) addMana(source, definition, selfGain);
  if (allyGain > 0) {
    for (const ally of boardDice(state, source.ownerId)) {
      if (ally.instanceId === source.instanceId) continue;
      addMana(ally, effectiveDefinition(state, definitions, ally), allyGain);
    }
  }
  if (foeGain > 0) {
    for (const foe of boardDice(state, otherOwner(source.ownerId))) {
      addMana(foe, effectiveDefinition(state, definitions, foe), foeGain);
    }
  }
  if (steal > 0) {
    const targets = stealType === 'ally'
      ? boardDice(state, source.ownerId)
      : stealType === 'both'
      ? state.dice.filter((die) => die.zone === 'board' && !die.isDestroyed)
      : boardDice(state, otherOwner(source.ownerId));
    let stolen = 0;
    for (const target of targets) {
      if (target.instanceId === source.instanceId) continue;
      stolen += takeMana(target, effectiveDefinition(state, definitions, target), steal);
    }
    if (stolen > 0) addMana(source, definition, stolen);
  }
  const summary = [
    selfGain > 0 ? `+${selfGain} self` : '',
    allyGain > 0 ? `+${allyGain} allies` : '',
    foeGain > 0 ? `+${foeGain} foes` : '',
    steal > 0 ? `-${steal} enemy mana` : ''
  ].filter(Boolean);
  if (summary.length > 0) addEvent(events, 'skill', `${definition.title} manipulates mana (${summary.join(', ')}).`, {
    ownerId: source.ownerId,
    sourceId: source.instanceId
  });
}

function fireActive(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie | undefined,
  events: CombatEvent[],
  random: RandomSource,
  catalog: DiceCatalog,
  rules: MatchRules
): 'fired' | 'free' | 'none' {
  const definition = effectiveDefinition(state, definitions, attacker);
  const slots = activeSkills(definition, attacker.classLevel);
  for (let index = 0; index < slots.length; index += 1) {
    const skill = slots[index];
    if (!skill) continue;
    const key = activeManaKey(skill, index);
    const needed = Math.max(1, skill.manaNeeded ?? 1);
    if ((attacker.mana[key] ?? 0) < needed) continue;
    attacker.mana[key] = Math.max(0, (attacker.mana[key] ?? 0) - needed);
    const modifiers = skill.modifiers ?? {};
    triggerNuclear(state, definitions, attacker, modifiers, events, random);
    addEvent(events, 'skill', `${definition.title} uses ${skill.title}.`, {
      ownerId: attacker.ownerId,
      sourceId: attacker.instanceId,
      targetId: target?.instanceId
    });
    const statusTarget = target ?? attacker;
    statusApplication(state, definitions, attacker, statusTarget, modifiers, events, attacker.pips);

    const pierceDamage = numberMod(modifiers, 'pierceBehindDamage');
    if (pierceDamage !== undefined && target) {
      const mainDamage = numberMod(modifiers, 'activeDamage') !== undefined
        ? resolveActiveDamage(definition, modifiers, attacker.pips, definition.attack)
        : definition.attack;
      dealDamage(state, definitions, attacker, target, mainDamage, events, random);
      if (!target.isDestroyed) {
        const pierceRange = Math.max(1, Math.floor(numberMod(modifiers, 'pierceBehindRange') ?? 1));
        for (const victim of pierceBehindTargets(state, definitions, attacker, target, pierceRange)) {
          dealDamage(state, definitions, attacker, victim, Math.max(1, Math.floor(pierceDamage)), events, random, { allowCritical: false });
        }
      }
    }
    const hasDamage = numberMod(modifiers, 'activeDamage') !== undefined
      || numberMod(modifiers, 'activeDamageRate') !== undefined
      || (modifiers.activeDamageRatesByPip !== undefined && typeof modifiers.activeDamageRatesByPip === 'object');
    if (hasDamage && pierceDamage === undefined) {
      const damage = resolveActiveDamage(definition, modifiers, attacker.pips, definition.attack);
      const victims = booleanMod(modifiers, 'hitsAllFoes')
        ? boardDice(state, otherOwner(attacker.ownerId))
        : booleanMod(modifiers, 'hitsAllAllies')
        ? boardDice(state, attacker.ownerId)
        : target ? [target] : [];
      for (const victim of victims) dealDamage(state, definitions, attacker, victim, damage, events, random);
    }

    const activeHeal = numberMod(modifiers, 'activeHeal');
    if (activeHeal !== undefined) {
      const ally = target && target.ownerId === attacker.ownerId
        ? target
        : selectTarget(state, definitions, attacker, 'Weakest', true, true, random) ?? attacker;
      heal(state, definitions, attacker, ally, Math.max(1, Math.ceil(activeHeal)), events, random);
    }

    const shield = numberMod(modifiers, 'shield');
    if (shield !== undefined) {
      attacker.shieldHp += shield;
      attacker.shieldTurns = Math.max(attacker.shieldTurns, numberMod(modifiers, 'statusDuration') ?? 2);
      addEvent(events, 'shield', `${definition.title} gains ${shield} shield.`, {
        ownerId: attacker.ownerId,
        targetId: attacker.instanceId,
        amount: shield
      });
    }

    const splashAnchor = target ?? attacker;
    if (hasSplashEffect(modifiers)) {
      const splashDamage = pipScaledDamage(definition, modifiers, 'splashDamage', attacker.pips, definition.attack);
      const victims = boardDice(state, otherOwner(attacker.ownerId)).filter((die) => (
        die.instanceId !== target?.instanceId
        && distanceBetween(splashAnchor, die, definitions, state) <= 1
      ));
      for (const victim of victims) dealDamage(state, definitions, attacker, victim, splashDamage, events, random, { allowCritical: false });
    }

    if (hasChainEffect(modifiers) && target) {
      const chainDamage = pipScaledDamage(definition, modifiers, 'chainDamage', attacker.pips, definition.attack);
      const chainRange = Math.max(1, Math.floor(numberMod(modifiers, 'chainRange') ?? 2));
      const chainVictim = pickRandom(
        boardDice(state, otherOwner(attacker.ownerId)).filter((die) => (
          die.instanceId !== target.instanceId
          && distanceBetween(target, die, definitions, state) <= chainRange
        )),
        random
      );
      if (chainVictim) dealDamage(state, definitions, attacker, chainVictim, chainDamage, events, random, { allowCritical: false });
    }

    const hasHeatwave = numberMod(modifiers, 'heatwaveDamage') !== undefined
      || numberMod(modifiers, 'heatwaveDamageRate') !== undefined
      || (modifiers?.heatwaveDamageRatesByPip !== undefined && typeof modifiers.heatwaveDamageRatesByPip === 'object');
    if (hasHeatwave && target) {
      const heatwaveDamage = pipScaledDamage(definition, modifiers, 'heatwaveDamage', attacker.pips, definition.attack);
      const victims = boardDice(state, otherOwner(attacker.ownerId)).filter((die) => (
        die.instanceId !== target.instanceId
        && distanceBetween(target, die, definitions, state) <= 1
      ));
      for (const victim of victims) dealDamage(state, definitions, attacker, victim, heatwaveDamage, events, random, { allowCritical: false });
    }

    if (hasMeteorEffect(modifiers)) {
      const meteorDamage = numberMod(modifiers, 'meteorDamage') ?? 60;
      const meteorCount = Math.max(1, Math.floor(numberMod(modifiers, 'meteorCount') ?? 1));
      const randomOrientation = booleanMod(modifiers, 'meteorRandomOrientation');
      const enemyOwner = otherOwner(attacker.ownerId);
      const enemyDice = boardDice(state, enemyOwner);
      const lavaDamage = numberMod(modifiers, 'lavaDamage');
      const lavaTurns = Math.max(1, Math.floor(
        numberMod(modifiers, 'activeDurationTurns')
        ?? numberMod(modifiers, 'statusDuration')
        ?? 3
      ));
      const rawLavaPattern = modifiers.lavaPoolPattern;
      const lavaOffsets: Array<[number, number]> = Array.isArray(rawLavaPattern)
        ? rawLavaPattern
          .filter((entry): entry is [number, number] => Array.isArray(entry)
            && entry.length >= 2
            && typeof entry[0] === 'number'
            && typeof entry[1] === 'number')
          .map((entry) => [Math.floor(entry[0]), Math.floor(entry[1])])
        : [];
      const lavaPattern = lavaOffsets.length > 0 ? lavaOffsets : [[0, 0]] as Array<[number, number]>;

      for (let meteorIndex = 0; meteorIndex < meteorCount; meteorIndex += 1) {
        let origin: BattlePosition | undefined;
        if (randomOrientation) {
          origin = {
            row: Math.floor(random() * GRID_SIZE),
            col: Math.floor(random() * GRID_SIZE)
          };
        } else {
          const liveEnemyDice = enemyDice.filter((die) => !die.isDestroyed);
          const picked = pickRandom(liveEnemyDice, random);
          if (!picked) break;
          const pickedDefinition = effectiveDefinition(state, definitions, picked);
          origin = pickRandom(cellsFor(picked, pickedDefinition), random);
        }
        if (!origin) continue;

        const impactTiles = plusPatternTiles(origin);
        const hitVictims = new Set<string>();
        for (const victim of enemyDice) {
          if (victim.isDestroyed || victim.zone !== 'board' || !victim.gridPosition) continue;
          const victimCells = cellsFor(victim, effectiveDefinition(state, definitions, victim));
          const struck = victimCells.some((cell) => impactTiles.some((tile) => tile.row === cell.row && tile.col === cell.col));
          if (!struck || hitVictims.has(victim.instanceId)) continue;
          hitVictims.add(victim.instanceId);
          dealDamage(state, definitions, attacker, victim, Math.max(1, Math.floor(meteorDamage)), events, random);
        }

        if (lavaDamage !== undefined) {
          for (const [rowOffset, colOffset] of lavaPattern) {
            const row = origin.row + rowOffset;
            const col = origin.col + colOffset;
            if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) continue;
            state.lavaPools = state.lavaPools.filter((pool) => !(pool.row === row && pool.col === col));
            state.lavaPools.push({
              row,
              col,
              damage: lavaDamage,
              turns: lavaTurns,
              ownerId: attacker.ownerId,
              typeId: attacker.typeId
            });
          }
        }
      }
    }

    const summonType = stringMod(modifiers, 'summonType');
    if (summonType) {
      summon(
        state,
        definitions,
        attacker,
        summonType,
        Math.max(1, Math.floor(numberMod(modifiers, 'summonCount') ?? 1)),
        catalog,
        rules,
        events,
        random,
        { pattern: normalizeSummonPattern(modifiers.summonPattern), allowRoll: booleanMod(modifiers, 'allowSummonedDieToRoll') }
      );
    }
    const attackCount = numberMod(modifiers, 'attackCountIncrease');
    if (attackCount !== undefined && attackCount > 0) {
      attacker.mana['projectileBonus'] = (attacker.mana['projectileBonus'] ?? 0) + attackCount;
      attacker.mana['projectileBonusTurns'] = Math.max(attacker.mana['projectileBonusTurns'] ?? 0, numberMod(modifiers, 'statusDuration') ?? 2);
    }
    if (booleanMod(modifiers, 'transformToNextForm')) {
      transformDie(state, definitions, attacker, events, random, target);
    }
    const activeGrantMode = stringMod(modifiers, 'activeSkillTargeting') ?? grantMode(modifiers);
    const allyGrant = attackGrantAmount(modifiers, 'grantAttacksToAlly', true);
    if (allyGrant > 0) grantAttacks(state, definitions, attacker, allyGrant, true, events, random, activeGrantMode);
    const foeGrant = attackGrantAmount(modifiers, 'grantAttacksToFoe', true);
    if (foeGrant > 0) grantAttacks(state, definitions, attacker, foeGrant, false, events, random, activeGrantMode);
    return numberMod(modifiers, 'consumeAttack') === 0 ? 'free' : 'fired';
  }
  return 'none';
}

function transformDie(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  die: CombatDie,
  events: CombatEvent[],
  random: RandomSource,
  target?: CombatDie
): void {
  const definition = getDefinition(state, definitions, die);
  const nextIndex = (die.transformIndex ?? -1) + 1;
  const stats = definition.transformStats?.[nextIndex];
  if (!stats) return;
  die.transformIndex = nextIndex;
  const transformed = transformDefinition(definition, die);
  die.maxHealth = transformed.health;
  die.currentHealth = Math.max(1, Math.min(
    die.currentHealth + Math.floor(transformed.health * (stats.recoveryRate ?? 0)),
    transformed.health
  ));
  addEvent(events, 'skill', `${definition.title} transforms into ${stats.title ?? 'its next form'}.`, {
    ownerId: die.ownerId,
    targetId: die.instanceId
  });

  const modifiers = triggerModifiers(transformed, 'OnTransformed', die.classLevel);
  if (!modifiers) return;
  triggerNuclear(state, definitions, die, modifiers, events, random);
  const transformedTarget = target && target.ownerId !== die.ownerId
    ? target
    : selectTarget(state, definitions, die, 'Nearest', false, false, random);
  statusApplication(state, definitions, die, die, modifiers, events, die.pips);
  const transformDamage = numberMod(modifiers, 'transformAttackDamage');
  if (transformDamage !== undefined && transformedTarget && !transformedTarget.isDestroyed) {
    dealDamage(state, definitions, die, transformedTarget, transformDamage, events, random, { allowCritical: false });
  }
  const growth = growthDeltaFor(modifiers, random);
  if (growth !== undefined) die.growth += growth;
  const allyGrant = attackGrantAmount(modifiers, 'grantAttacksToAlly', true);
  if (allyGrant > 0) grantAttacks(state, definitions, die, allyGrant, true, events, random, grantMode(modifiers));
  const foeGrant = attackGrantAmount(modifiers, 'grantAttacksToFoe', true);
  if (foeGrant > 0) grantAttacks(state, definitions, die, foeGrant, false, events, random, grantMode(modifiers));
}

function maybeTransformFromPip(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  die: CombatDie,
  events: CombatEvent[],
  random: RandomSource
): void {
  const definition = getDefinition(state, definitions, die);
  if (die.transformIndex !== undefined) return;
  const modifiers = allModifiers(definition);
  const pipTransform = modifiers
    .map((entry) => numberMod(entry, 'transformPipCount'))
    .find((value) => value !== undefined);
  const odd = modifiers.some((entry) => booleanMod(entry, 'transformOnOddPip'));
  const even = modifiers.some((entry) => booleanMod(entry, 'transformOnEvenPip'));
  const shouldTransform = (pipTransform !== undefined && die.pips === pipTransform)
    || (odd && die.pips % 2 === 1)
    || (even && die.pips % 2 === 0);
  if (shouldTransform) transformDie(state, definitions, die, events, random);
}

function applyInfiltratorPlacements(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  events: CombatEvent[]
): void {
  for (const infiltrator of [...state.dice]) {
    if (infiltrator.zone !== 'board' || infiltrator.isDestroyed || !infiltrator.gridPosition) continue;
    const definition = effectiveDefinition(state, definitions, infiltrator);
    const skill = skillsOfType(definition, 'CombatStart')
      .find((candidate) => booleanMod(candidate.modifiers, 'isInfiltrator') && skillUnlocked(candidate, infiltrator.classLevel));
    if (!skill) continue;
    const foes = boardDice(state, otherOwner(infiltrator.ownerId));
    if (foes.length === 0) continue;
    const target = [...foes].sort((a, b) => (
      distanceBetween(infiltrator, b, definitions, state) - distanceBetween(infiltrator, a, definitions, state)
      || a.instanceId.localeCompare(b.instanceId)
    ))[0];
    if (!target?.gridPosition) continue;
    const occupied = new Set<string>();
    for (const die of state.dice) {
      if (die.zone !== 'board' || die.isDestroyed || !die.gridPosition) continue;
      occupy(die, effectiveDefinition(state, definitions, die), die.gridPosition, occupied);
    }
    const teleportRange = numberMod(skill.modifiers, 'teleportRange') ?? definition.range;
    const candidates = [
      { row: target.gridPosition.row - 1, col: target.gridPosition.col },
      { row: target.gridPosition.row + 1, col: target.gridPosition.col },
      { row: target.gridPosition.row, col: target.gridPosition.col - 1 },
      { row: target.gridPosition.row, col: target.gridPosition.col + 1 }
    ].filter((position) => canPlace(infiltrator, definition, position, occupied));
    const chosen = candidates.sort((a, b) => (
      Math.max(Math.abs(a.row - infiltrator.gridPosition!.row), Math.abs(a.col - infiltrator.gridPosition!.col))
      - Math.max(Math.abs(b.row - infiltrator.gridPosition!.row), Math.abs(b.col - infiltrator.gridPosition!.col))
      || a.row - b.row || a.col - b.col
    ))[0];
    if (!chosen) continue;
    const distance = Math.max(Math.abs(chosen.row - infiltrator.gridPosition.row), Math.abs(chosen.col - infiltrator.gridPosition.col));
    if (teleportRange >= 0 && distance > teleportRange) continue;
    infiltrator.gridPosition = chosen;
    infiltrator.mana['infiltrated'] = 1;
    addEvent(events, 'skill', `${definition.title} infiltrates the enemy board.`, {
      ownerId: infiltrator.ownerId,
      sourceId: infiltrator.instanceId
    });
  }
}

function beamPattern(attacker: CombatDie, target: CombatDie): { rowStep: number; colStep: number } | undefined {
  if (!attacker.gridPosition || !target.gridPosition) return undefined;
  const rowDiff = target.gridPosition.row - attacker.gridPosition.row;
  const colDiff = target.gridPosition.col - attacker.gridPosition.col;
  if (rowDiff === 0 && colDiff === 0) return undefined;
  const gcd = (a: number, b: number): number => {
    let left = Math.abs(a);
    let right = Math.abs(b);
    while (right !== 0) {
      const remainder = left % right;
      left = right;
      right = remainder;
    }
    return Math.max(1, left);
  };
  const divisor = gcd(rowDiff, colDiff);
  return {
    rowStep: -Math.trunc(colDiff / divisor),
    colStep: Math.trunc(rowDiff / divisor)
  };
}

function onBeamLine(
  source: BattlePosition,
  target: BattlePosition,
  cell: BattlePosition,
  pattern: { rowStep: number; colStep: number }
): boolean {
  const rowDelta = cell.row - target.row;
  const colDelta = cell.col - target.col;
  const crossProduct = rowDelta * pattern.colStep - colDelta * pattern.rowStep;
  if (crossProduct === 0) return true;
  const lineLength = Math.hypot(pattern.rowStep, pattern.colStep);
  return Math.abs(crossProduct) <= lineLength * 0.5;
}

function executeBeam(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie,
  events: CombatEvent[],
  random: RandomSource
): boolean {
  const definition = effectiveDefinition(state, definitions, attacker);
  const pattern = beamPattern(attacker, target);
  if (!pattern || !target.gridPosition) return false;
  const damage = Math.max(1, Math.floor(firstNumberModifier(definition, 'beamDamage') ?? definition.attack));
  const targetPosition = target.gridPosition;
  const victims = boardDice(state, target.ownerId).filter((die) => (
    die.instanceId === target.instanceId
    || (!die.gridPosition ? false : cellsFor(die, effectiveDefinition(state, definitions, die)).some((cell) => (
      onBeamLine(attacker.gridPosition!, targetPosition, cell, pattern)
    )))
  ));
  const eventIndex = events.length;
  let total = 0;
  for (const victim of victims) {
    const hit = dealDamage(state, definitions, attacker, victim, damage, events, random, { allowCritical: false });
    total += hit.dealt;
  }
  insertEvent(events, eventIndex, 'attack', `${definition.title} fires a beam through ${effectiveDefinition(state, definitions, target).title} for ${total} damage.`, {
    ownerId: attacker.ownerId,
    sourceId: attacker.instanceId,
    targetId: target.instanceId,
    amount: total
  });
  attacker.attacksRemaining = 0;
  attacker.hasFinishedAttacking = true;
  return true;
}

function teleportPassiveSkill(
  definition: DiceDefinition,
  classLevel: number
): { fireSkill: DiceSkillDefinition; triggerSkill: DiceSkillDefinition } | undefined {
  for (const skill of definition.skills) {
    if (skill.type !== 'Passive' || !skillUnlocked(skill, classLevel)) continue;
    const fireIndex = numberMod(skill.modifiers, 'teleportSkillFireIndex');
    if (fireIndex === undefined || !Number.isInteger(fireIndex) || fireIndex < 0) continue;
    const fireSkill = definition.skills[fireIndex];
    if (!fireSkill || !skillUnlocked(fireSkill, classLevel)) continue;
    return { fireSkill, triggerSkill: skill };
  }
  return undefined;
}

function moveBesideTarget(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie
): boolean {
  if (!target.gridPosition || !attacker.gridPosition) return false;
  const definition = effectiveDefinition(state, definitions, attacker);
  const occupied = new Set<string>();
  for (const die of state.dice) {
    if (die.zone !== 'board' || die.isDestroyed || !die.gridPosition) continue;
    occupy(die, effectiveDefinition(state, definitions, die), die.gridPosition, occupied);
  }
  const candidates = [
    { row: target.gridPosition.row - 1, col: target.gridPosition.col },
    { row: target.gridPosition.row + 1, col: target.gridPosition.col },
    { row: target.gridPosition.row, col: target.gridPosition.col - 1 },
    { row: target.gridPosition.row, col: target.gridPosition.col + 1 }
  ].filter((position) => canPlace(attacker, definition, position, occupied));
  const chosen = candidates[0];
  if (!chosen) return false;
  attacker.gridPosition = chosen;
  attacker.mana['infiltrated'] = 1;
  return true;
}

function executeMightyRoar(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  events: CombatEvent[],
  random: RandomSource
): boolean {
  const definition = effectiveDefinition(state, definitions, attacker);
  const trigger = teleportPassiveSkill(definition, attacker.classLevel);
  if (!trigger) return false;
  const target = [...boardDice(state, otherOwner(attacker.ownerId))].sort((a, b) => (
    distanceBetween(attacker, a, definitions, state) - distanceBetween(attacker, b, definitions, state)
    || a.instanceId.localeCompare(b.instanceId)
  ))[0];
  if (!target) return false;
  if (!moveBesideTarget(state, definitions, attacker, target)) return false;
  addEvent(events, 'skill', `${definition.title} roars and teleports beside ${effectiveDefinition(state, definitions, target).title}.`, {
    ownerId: attacker.ownerId,
    sourceId: attacker.instanceId,
    targetId: target.instanceId
  });
  const hits = Math.max(1, 1 + Math.floor(numberMod(trigger.fireSkill.modifiers, 'attackCountIncrease') ?? 0));
  for (let hit = 0; hit < hits && !target.isDestroyed; hit += 1) {
    dealDamage(state, definitions, attacker, target, Math.max(1, definition.attack), events, random);
  }
  if (!target.isDestroyed) {
    statusApplication(state, definitions, attacker, target, trigger.triggerSkill.modifiers, events, attacker.pips);
  }
  attacker.attacksRemaining = Math.max(0, attacker.attacksRemaining - 1);
  attacker.hasFinishedAttacking = attacker.attacksRemaining === 0;
  return true;
}

function basicAttack(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie,
  events: CombatEvent[],
  random: RandomSource
): void {
  const definition = effectiveDefinition(state, definitions, attacker);
  if (hasBooleanModifier(definition, 'healOnAttack')) {
    const eventIndex = events.length;
    const healed = heal(state, definitions, attacker, target, definition.attack, events, random);
    if (healed > 0 && !attacker.isDestroyed) addMana(attacker, definition);
    insertEvent(events, eventIndex, 'attack', `${definition.title} heals ${effectiveDefinition(state, definitions, target).title} for ${healed} health.`, {
      ownerId: attacker.ownerId,
      sourceId: attacker.instanceId,
      targetId: target.instanceId,
      amount: healed
    });
    return;
  }
  if (maybeApplyAvoid(state, definitions, target, events, random, attacker)) return;
  const projectiles = Math.max(1, 1 + (attacker.mana['projectileBonus'] ?? 0));
  const boosted = attacker.boostedAttacks > 0;
  if (boosted) attacker.boostedAttacks -= 1;
  const boostMultiplier = boosted ? Math.max(2, attacker.mana['boostedAttackMultiplier'] ?? 2) : 1;
  let dealt = 0;
  const evenPipDamageRate = attacker.pips % 2 === 0
    ? firstNumberModifier(definition, 'deuciferEvenDamageRate') ?? 0
    : 0;
  const oddPipSiphonRate = attacker.pips % 2 === 1
    ? firstNumberModifier(definition, 'deuciferOddSiphonRate') ?? 0
    : 0;
  const eventIndex = events.length;
  for (let projectile = 0; projectile < projectiles && !target.isDestroyed; projectile += 1) {
    const base = definition.attack
      + targetCurrentHealthBonus(state, definitions, attacker, target)
      + statusBonusDamage(state, definitions, attacker, definition.attack)
      + (attacker.mana['onKillDamage'] ?? 0);
    const scaled = Math.max(1, Math.floor(base * damageMultiplier(state, definitions, attacker, target) * boostMultiplier * (1 + evenPipDamageRate)));
    const hit = dealDamage(state, definitions, attacker, target, scaled, events, random);
    dealt += hit.dealt;
    if (oddPipSiphonRate > 0 && hit.dealt > 0 && !attacker.isDestroyed) {
      heal(state, definitions, attacker, attacker, Math.floor(hit.dealt * oddPipSiphonRate), events, random);
    }
    if (!target.isDestroyed) applyPassiveOnHit(state, definitions, attacker, target, events, random);
    if (target.isDestroyed) break;
  }
  if (dealt > 0 && !attacker.isDestroyed) addMana(attacker, definition);
  insertEvent(events, eventIndex, 'attack', `${definition.title} attacks ${effectiveDefinition(state, definitions, target).title}${projectiles > 1 ? ` ${projectiles} times` : ''} for ${dealt} damage${boosted ? ' with a boosted strike' : ''}.`, {
    ownerId: attacker.ownerId,
    sourceId: attacker.instanceId,
    targetId: target.instanceId,
    amount: dealt
  });
}

function startCombat(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  events: CombatEvent[],
  random: RandomSource,
  catalog: DiceCatalog,
  rules: MatchRules
): void {
  applyInfiltratorPlacements(state, definitions, events);
  const auras = new Map<OwnerId, Array<{ sourceId: string; extraAttacks: number; foeExtraAttacks: number }>>([
    ['player', []],
    ['enemy', []]
  ]);
  const pipAuras = new Map<OwnerId, Array<{ sourceId: string; pips: number; allyDelta: number; foeDelta: number }>>([
    ['player', []],
    ['enemy', []]
  ]);

  for (const die of state.dice) {
    if (die.zone !== 'board' || die.isDestroyed) continue;
    const definition = effectiveDefinition(state, definitions, die);
    const startModifiers = triggerModifiers(definition, 'CombatStart', die.classLevel);
    if (startModifiers) {
      const allyExtra = numberMod(startModifiers, 'allyExtraAttacks') ?? 0;
      const foeExtra = numberMod(startModifiers, 'foeExtraAttacks') ?? 0;
      if (allyExtra > 0 || foeExtra > 0) {
        auras.get(die.ownerId)?.push({ sourceId: die.instanceId, extraAttacks: allyExtra, foeExtraAttacks: foeExtra });
      }
    }
    const allyDelta = sumNumberAcrossDefinition(definition, 'pipMatchAllyAttackDelta');
    const foeDelta = sumNumberAcrossDefinition(definition, 'pipMatchFoeAttackDelta');
    if (allyDelta !== 0 || foeDelta !== 0) {
      pipAuras.get(die.ownerId)?.push({
        sourceId: die.instanceId,
        pips: die.pips,
        allyDelta,
        foeDelta
      });
    }
  }

  for (const die of state.dice) {
    if (die.zone !== 'board' || die.isDestroyed) continue;
    const definition = effectiveDefinition(state, definitions, die);
    die.attacksRemaining = Math.max(1, die.pips + die.attackDelta + die.growth);
    die.hasFinishedAttacking = false;
    for (const aura of auras.get(die.ownerId) ?? []) {
      if (aura.sourceId !== die.instanceId) die.attacksRemaining += aura.extraAttacks;
    }
    for (const aura of auras.get(otherOwner(die.ownerId)) ?? []) {
      if (aura.sourceId !== die.instanceId) die.attacksRemaining += aura.foeExtraAttacks;
    }
    for (const aura of pipAuras.get(die.ownerId) ?? []) {
      if (aura.sourceId !== die.instanceId && aura.pips === die.pips) die.attacksRemaining += aura.allyDelta;
    }
    for (const aura of pipAuras.get(otherOwner(die.ownerId)) ?? []) {
      if (aura.sourceId !== die.instanceId && aura.pips === die.pips) die.attacksRemaining += aura.foeDelta;
    }
    die.attacksRemaining = Math.max(0, die.attacksRemaining);
    die.boostedAttacks = Math.max(0, Math.floor(maxModifier(definition, 'numAttacksBoosted')));
    const boostMultiplier = firstNumberModifier(definition, 'numAttacksDamageMult');
    if (boostMultiplier !== undefined && boostMultiplier > 1) die.mana['boostedAttackMultiplier'] = boostMultiplier;

    maybeTransformFromPip(state, definitions, die, events, random);

    const modifiers = triggerModifiers(definition, 'CombatStart', die.classLevel);
    if (modifiers) {
      const target = selectTarget(state, definitions, die, definition.targetingMode, false, false, random);
      statusApplication(state, definitions, die, target ?? die, modifiers, events, die.pips);
      if (booleanMod(modifiers, 'strikeFirst')) die.mana['strikeFirst'] = 1;
      const tauntRange = numberMod(modifiers, 'tauntRange');
      if (tauntRange !== undefined) {
        for (const foe of boardDice(state, otherOwner(die.ownerId))) {
          if (distanceBetween(die, foe, definitions, state) <= tauntRange) {
            foe.tauntedBySourceId = die.instanceId;
            foe.tauntTurns = Math.max(1, Math.floor(numberMod(modifiers, 'tauntDuration') ?? 1));
          }
        }
      }
      const lockRange = numberMod(modifiers, 'lockRange');
      if (lockRange !== undefined) {
        const candidates = boardDice(state, otherOwner(die.ownerId))
          .filter((foe) => distanceBetween(die, foe, definitions, state) <= lockRange)
          .slice(0, Math.max(1, Math.floor(numberMod(modifiers, 'numLocks') ?? 1)));
        for (const foe of candidates) state.lockedBy[foe.instanceId] = die.instanceId;
      }
      const allyGrantModifiers = firstGrantModifiers(definition, 'CombatStart', 'grantAttacksToAlly', die.classLevel);
      const allyGrant = Math.max(0, Math.floor(numberMod(allyGrantModifiers, 'grantAttacksToAlly') ?? 0));
      if (allyGrant > 0) grantAttacks(state, definitions, die, allyGrant, true, events, random, grantMode(allyGrantModifiers));
      const foeGrantModifiers = firstGrantModifiers(definition, 'CombatStart', 'grantAttacksToFoe', die.classLevel);
      const foeGrant = Math.max(0, Math.floor(numberMod(foeGrantModifiers, 'grantAttacksToFoe') ?? 0));
      if (foeGrant > 0) grantAttacks(state, definitions, die, foeGrant, false, events, random, grantMode(foeGrantModifiers));
      chargeMana(state, definitions, die, events);
      const startTitle = skillsOfType(definition, 'CombatStart')
        .find((skill) => skillUnlocked(skill, die.classLevel))?.title ?? 'combat-start skill';
      addEvent(events, 'skill', `${definition.title} activates ${startTitle}.`, {
        ownerId: die.ownerId,
        sourceId: die.instanceId
      });
    }
  }
  addEvent(events, 'round', `Round ${state.turn} begins.`, {});
}

function chooseAttacker(state: CombatState, definitions: Map<string, DiceDefinition>): CombatDie | undefined {
  const candidates = state.dice
    .filter((die) => (
      die.zone === 'board'
      && !die.isDestroyed
      && !die.hasFinishedAttacking
      && die.attacksRemaining > 0
      && Boolean(die.gridPosition)
    ))
    .filter((die) => {
      const lockSourceId = state.lockedBy[die.instanceId];
      if (!lockSourceId) return true;
      const source = state.dice.find((candidate) => candidate.instanceId === lockSourceId && !candidate.isDestroyed);
      return !source;
    });
  return candidates.sort((left, right) => {
    const ownerOrder: Record<OwnerId, number> = { player: 0, enemy: 1 };
    return (ownerOrder[left.ownerId] - ownerOrder[right.ownerId])
      || (right.gridPosition!.row - left.gridPosition!.row)
      || (right.gridPosition!.col - left.gridPosition!.col)
      || left.instanceId.localeCompare(right.instanceId);
  })[0];
}

function tickEndOfRound(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  events: CombatEvent[],
  random: RandomSource,
  catalog: DiceCatalog,
  rules: MatchRules
): void {
  for (const die of state.dice) {
    if (die.isDestroyed) continue;
    const poisonStacks = statusStacks(die, 'poison');
    if (poisonStacks > 0) {
      const amount = die.mana['poisonAmount'] ?? 0;
      dealDamage(state, definitions, undefined, die, Math.max(1, amount), events, random, { allowCritical: false });
      if (die.isDestroyed) continue;
    }
    if (die.attackDeltaTurns > 0) {
      die.attackDeltaTurns -= 1;
      if (die.attackDeltaTurns <= 0) die.attackDelta = 0;
    }
    if (die.fractureTurns > 0) {
      die.fractureTurns -= 1;
      if (die.fractureTurns <= 0) die.fractureRate = 0;
    }
    if (die.tauntTurns > 0) {
      die.tauntTurns -= 1;
      if (die.tauntTurns <= 0) die.tauntedBySourceId = undefined;
    }
    if (die.stunTurns > 0) die.stunTurns -= 1;
    if (die.shieldTurns > 0) {
      die.shieldTurns -= 1;
      if (die.shieldTurns <= 0) die.shieldHp = 0;
    }
    const projectileBonusTurns = die.mana['projectileBonusTurns'] ?? 0;
    if (projectileBonusTurns > 0) {
      const nextTurns = projectileBonusTurns - 1;
      die.mana['projectileBonusTurns'] = nextTurns;
      if (nextTurns <= 0) die.mana['projectileBonus'] = 0;
    }
    for (const effect of ['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk', 'acceleration', 'dilation'] as StatusEffect[]) {
      if (!hasStatus(die, effect)) continue;
      const turns = statusTurns(die, effect) - 1;
      if (turns <= 0) clearStatus(die, effect);
      else die.mana[`status:${effect}:turns`] = turns;
    }

    const modifiers = triggerModifiers(effectiveDefinition(state, definitions, die), 'CombatEnd', die.classLevel);
    if (modifiers) {
      statusApplication(state, definitions, die, die, modifiers, events, die.pips);
      const combatEndDamage = numberMod(modifiers, 'combatEndDamage');
      if (combatEndDamage !== undefined) {
        const victim = selectTarget(state, definitions, die, 'Nearest', false, false, random);
        if (victim) dealDamage(state, definitions, die, victim, Math.max(1, Math.floor(combatEndDamage)), events, random, { allowCritical: false });
      }
      const growth = growthDeltaFor(modifiers, random);
      if (growth !== undefined) {
        die.growth += growth;
        addEvent(events, 'skill', `${effectiveDefinition(state, definitions, die).title} grows permanently.`, {
          ownerId: die.ownerId,
          sourceId: die.instanceId
        });
      }
      const summonType = stringMod(modifiers, 'summonType');
      if (summonType) {
        summon(
          state,
          definitions,
          die,
          summonType,
          Math.max(1, Math.floor(numberMod(modifiers, 'summonCount') ?? 1)),
          catalog,
          rules,
          events,
          random,
          { pattern: normalizeSummonPattern(modifiers.summonPattern), allowRoll: booleanMod(modifiers, 'allowSummonedDieToRoll') }
        );
      }
      const allyGrant = attackGrantAmount(modifiers, 'grantAttacksToAlly', true);
      if (allyGrant > 0) grantAttacks(state, definitions, die, allyGrant, true, events, random, grantMode(modifiers));
      const foeGrant = attackGrantAmount(modifiers, 'grantAttacksToFoe', true);
      if (foeGrant > 0) grantAttacks(state, definitions, die, foeGrant, false, events, random, grantMode(modifiers));
    }
    die.zone = 'hand';
    die.gridPosition = undefined;
    die.attacksRemaining = 0;
    die.hasFinishedAttacking = true;
    die.mana['projectileBonus'] = 0;
    die.mana['projectileBonusTurns'] = 0;
    delete die.mana['infiltrated'];
  }
  for (const pool of state.lavaPools) {
    for (const die of boardDice(state, otherOwner(pool.ownerId))) {
      if (!die.gridPosition) continue;
      if (Math.abs(die.gridPosition.row - pool.row) <= 1 && Math.abs(die.gridPosition.col - pool.col) <= 1) {
        dealDamage(state, definitions, undefined, die, pool.damage, events, random, { allowCritical: false });
      }
    }
    pool.turns -= 1;
  }
  state.lavaPools = state.lavaPools.filter((pool) => pool.turns > 0);
  state.turn += 1;
  state.combatPhase = 'idle';
}

function turnLimitWinner(state: CombatState, rules: MatchRules): 'player' | 'enemy' | 'draw' | undefined {
  if (rules.turnLimit === -1 || state.turn <= rules.turnLimit) return undefined;
  const playerHealth = living(state, 'player').reduce((total, die) => total + die.currentHealth, 0);
  const enemyHealth = living(state, 'enemy').reduce((total, die) => total + die.currentHealth, 0);
  if (playerHealth === enemyHealth) return 'draw';
  return playerHealth > enemyHealth ? 'player' : 'enemy';
}

export function resolveCombat(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  rules: MatchRules,
  seed: string,
  catalog: DiceCatalog
): CombatResolution {
  const events: CombatEvent[] = [];
  const random = makeRng(seed, state.turn);
  state.combatPhase = 'attacking';
  for (const die of state.dice) {
    if (die.zone === 'board' && !die.isDestroyed) {
      die.attacksRemaining = Math.max(1, die.pips);
      die.hasFinishedAttacking = false;
    }
  }
  startCombat(state, definitions, events, random, catalog, rules);

  let actionCount = 0;
  while (actionCount < MAX_ACTIONS) {
    actionCount += 1;
    const attacker = chooseAttacker(state, definitions);
    if (!attacker) break;
    const definition = effectiveDefinition(state, definitions, attacker);
    if (attacker.stunTurns > 0) {
      attacker.attacksRemaining = 0;
      attacker.hasFinishedAttacking = true;
      addEvent(events, 'status', `${definition.title} is stunned and skips its turn.`, {
        ownerId: attacker.ownerId,
        targetId: attacker.instanceId
      });
      continue;
    }
    const healingAttack = hasBooleanModifier(definition, 'healOnAttack');
    const readyActive = activeSkills(definition, attacker.classLevel).find((skill, index) => (
      (attacker.mana[activeManaKey(skill, index)] ?? 0) >= Math.max(1, skill.manaNeeded ?? 1)
    ));
    const targetMode = readyActive
      ? stringMod(readyActive.modifiers, 'activeSkillTargeting')
        ?? stringMod(readyActive.modifiers, 'skillTargeting')
        ?? definition.targetingMode
      : firstStringModifier(definition, 'skillTargeting') ?? definition.targetingMode;
    const target = selectTarget(
      state,
      definitions,
      attacker,
      targetMode,
      healingAttack,
      healingAttack,
      random
    );
    if (attacker.mana['strikeFirst'] === 1) {
      attacker.mana['strikeFirst'] = 0;
      if (target) basicAttack(state, definitions, attacker, target, events, random);
      attacker.attacksRemaining = Math.max(0, attacker.attacksRemaining - 1);
      attacker.hasFinishedAttacking = attacker.attacksRemaining === 0;
      continue;
    }
    const activeResult = fireActive(state, definitions, attacker, target, events, random, catalog, rules);
    if (activeResult !== 'none') {
      if (activeResult === 'fired') {
        attacker.attacksRemaining = Math.max(0, attacker.attacksRemaining - 1);
      }
      attacker.hasFinishedAttacking = attacker.attacksRemaining === 0;
      if (living(state, 'player').length === 0 || living(state, 'enemy').length === 0) break;
      continue;
    }
    if (!target) {
      if (executeMightyRoar(state, definitions, attacker, events, random)) {
        if (living(state, 'player').length === 0 || living(state, 'enemy').length === 0) break;
        continue;
      }
      attacker.attacksRemaining = 0;
      attacker.hasFinishedAttacking = true;
      continue;
    }
    if (hasBooleanModifier(definition, 'hasBeam') && executeBeam(state, definitions, attacker, target, events, random)) {
      if (living(state, 'player').length === 0 || living(state, 'enemy').length === 0) break;
      continue;
    }
    basicAttack(state, definitions, attacker, target, events, random);
    attacker.attacksRemaining = Math.max(0, attacker.attacksRemaining - 1);
    attacker.hasFinishedAttacking = attacker.attacksRemaining === 0;
    if (living(state, 'player').length === 0 || living(state, 'enemy').length === 0) break;
  }

  const playerAlive = living(state, 'player').length;
  const enemyAlive = living(state, 'enemy').length;
  let result: CombatResolution['result'];
  let winnerOwner: OwnerId | undefined;
  if (playerAlive === 0 && enemyAlive === 0) result = 'draw';
  else if (enemyAlive === 0) {
    result = 'victory';
    winnerOwner = 'player';
  } else if (playerAlive === 0) {
    result = 'defeat';
    winnerOwner = 'enemy';
  } else {
    const limitWinner = turnLimitWinner(state, rules);
    if (limitWinner === 'draw') result = 'draw';
    else if (limitWinner !== undefined) {
      winnerOwner = limitWinner;
      result = limitWinner === 'player' ? 'victory' : 'defeat';
    }
  }

  if (result) {
    state.combatPhase = 'resolved';
    addEvent(events, 'info', result === 'draw' ? 'The match ends in a draw.' : `${winnerOwner === 'player' ? 'Player one' : 'Player two'} wins the match.`, {});
    return {
      state,
      events,
      result,
      ...(winnerOwner ? { winnerId: winnerOwner } : {})
    };
  }

  tickEndOfRound(state, definitions, events, random, catalog, rules);
  return { state, events };
}

export function currentWinner(state: CombatState): OwnerId | 'draw' | undefined {
  const playerAlive = living(state, 'player').length;
  const enemyAlive = living(state, 'enemy').length;
  if (playerAlive === 0 && enemyAlive === 0) return 'draw';
  if (enemyAlive === 0) return 'player';
  if (playerAlive === 0) return 'enemy';
  return undefined;
}

export function healthWinner(state: CombatState): OwnerId | 'draw' {
  const playerHealth = living(state, 'player').reduce((total, die) => total + die.currentHealth, 0);
  const enemyHealth = living(state, 'enemy').reduce((total, die) => total + die.currentHealth, 0);
  if (playerHealth === enemyHealth) return 'draw';
  return playerHealth > enemyHealth ? 'player' : 'enemy';
}

export function getPipMap(
  state: CombatState,
  viewer?: OwnerId,
  revealOpponent = true
): Record<string, number> {
  return Object.fromEntries(state.dice
    .filter((die) => !die.isDestroyed)
    .filter((die) => !viewer || revealOpponent || die.ownerId === viewer)
    .map((die) => [die.instanceId, die.pips]));
}

