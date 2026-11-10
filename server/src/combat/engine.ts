import type { DiceCatalog } from './catalog.js';
import { buildCombatDefinition, getClassMultiplier } from './progression.js';
import { diceCatalog } from './catalog.js';
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
const CHAIN_NO_TARGET_CAP = -1;
const combatRuntime = new WeakMap<CombatState, { catalog: DiceCatalog; rules: MatchRules }>();

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
  return booleanMod(modifiers, 'hasSplash');
}

function hasChainEffect(modifiers: SkillModifiers | undefined): boolean {
  return booleanMod(modifiers, 'hasChain');
}

function hasHeatwaveEffect(modifiers: SkillModifiers | undefined): boolean {
  return booleanMod(modifiers, 'hasHeatwave');
}

function hasPierceEffect(modifiers: SkillModifiers | undefined): boolean {
  const range = numberMod(modifiers, 'pierceBehindRange');
  return booleanMod(modifiers, 'hasPierce') && (range === undefined || range > 0);
}

function hasRicochetEffect(modifiers: SkillModifiers | undefined): boolean {
  const count = numberMod(modifiers, 'ricochetCount');
  return booleanMod(modifiers, 'hasRicochet') && (count === undefined || count > 0);
}

function hasMeteorEffect(modifiers: SkillModifiers | undefined): boolean {
  return booleanMod(modifiers, 'hasMeteor')
    && (numberMod(modifiers, 'meteorDamage') !== undefined || numberMod(modifiers, 'meteorCount') !== undefined);
}

function hasGrowthEffect(modifiers: SkillModifiers | undefined): boolean {
  return booleanMod(modifiers, 'hasGrowth');
}
function hasSkillDamage(modifiers: SkillModifiers | undefined): boolean {
  if (!modifiers) return false;
  return numberMod(modifiers, 'skillDamage') !== undefined
    || numberMod(modifiers, 'skillDamageRate') !== undefined
    || (modifiers.skillDamageRatesByPip !== undefined && typeof modifiers.skillDamageRatesByPip === 'object');
}


function growthDeltaFor(modifiers: SkillModifiers | undefined, random: RandomSource): number | undefined {
  if (!hasGrowthEffect(modifiers)) return undefined;
  const delta = Math.max(1, Math.abs(numberMod(modifiers, 'growthDelta') ?? 1));
  const chance = clamp(numberMod(modifiers, 'growthChance') ?? 1, 0, 1);
  return random() < chance ? delta : -delta;
}

function resolveSkillDamage(definition: DiceDefinition, modifiers: SkillModifiers, pips: number, fallback: number): number {
  return pipScaledDamage(definition, modifiers, 'skillDamage', pips, fallback);
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
  if (effect !== 'slow' && effect !== 'poison' && maxStacks !== undefined && currentStacks >= Math.max(0, Math.floor(maxStacks))) return;
  if (effect === 'slow') {
    if (attackDelta === undefined) return;
    const previousDelta = target.attackDelta;
    const maxSlowStacks = Math.max(1, Math.floor(maxStacks ?? 1));
    target.slowStacks = [...activeSlowStacks(target), { delta: attackDelta, turns: duration }].slice(-maxSlowStacks);
    syncSlowStatus(target);
    const appliedDelta = target.attackDelta - previousDelta;
    if (appliedDelta !== 0 && target.attacksRemaining > 0) {
      target.attacksRemaining = Math.max(0, target.attacksRemaining + appliedDelta);
      target.hasFinishedAttacking = target.attacksRemaining === 0;
    }
  }
  if (effect === 'poison') {
    const base = poison ?? Math.max(1, Math.floor(effectiveDefinition(state, definitions, source).attack * (poisonRate ?? 0)));
    target.poisonStacks = [...activePoisonStacks(target), {
      damage: Math.max(1, Math.floor(base)),
      turns: duration,
      sourceId: source.instanceId,
      sourceOwnerId: source.ownerId,
      sourceTypeId: source.typeId
    }];
    syncPoisonStatus(target);
  }
  if (effect === 'fracture' && armorReduction !== undefined) {
    target.fractureRate = armorReduction;
    target.fractureTurns = duration;
  }
  if (effect === 'taunt') {
    target.tauntedBySourceId = source.instanceId;
    target.tauntTurns = duration;
  }
  if (effect === 'stun') {
    target.stunTurns = duration;
  }
  if (effect !== 'slow' && effect !== 'poison') addStatus(target, effect, duration, attackDelta, maxStacks);
  const sourceName = effectiveDefinition(state, definitions, source).title.replace(/\s+Dice$/i, '');
  const targetName = effectiveDefinition(state, definitions, target).title.replace(/\s+Dice$/i, '');
  const statusName = effect.charAt(0).toUpperCase() + effect.slice(1);
  addEvent(events, 'status', `${sourceName} applies ${statusName} to ${targetName} for ${duration} turn${duration === 1 ? '' : 's'}!`, {
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

function footprintManhattanDistance(
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
      best = Math.min(best, Math.abs(firstCell.row - secondCell.row) + Math.abs(firstCell.col - secondCell.col));
    }
  }
  return best;
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

function footprintChebyshevDistance(
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
      best = Math.min(best, Math.max(Math.abs(firstCell.row - secondCell.row), Math.abs(firstCell.col - secondCell.col)));
    }
  }
  return best;
}

function isWithinFootprintRadius(
  firstPosition: BattlePosition,
  firstFootprint: number,
  secondPosition: BattlePosition,
  secondFootprint: number,
  radius: number
): boolean {
  for (let firstRow = 0; firstRow < Math.max(1, firstFootprint); firstRow += 1) {
    for (let firstCol = 0; firstCol < Math.max(1, firstFootprint); firstCol += 1) {
      for (let secondRow = 0; secondRow < Math.max(1, secondFootprint); secondRow += 1) {
        for (let secondCol = 0; secondCol < Math.max(1, secondFootprint); secondCol += 1) {
          const distance = Math.max(
            Math.abs(firstPosition.row + firstRow - (secondPosition.row + secondRow)),
            Math.abs(firstPosition.col + firstCol - (secondPosition.col + secondCol))
          );
          if (distance <= radius) return true;
        }
      }
    }
  }
  return false;
}

function footprintRowDistance(
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
      best = Math.min(best, Math.abs(firstCell.row - secondCell.row));
    }
  }
  return best;
}

function closestFootprintOffsets(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  first: CombatDie,
  second: CombatDie
): { rowOffset: number; colOffset: number; distance: number } {
  if (!first.gridPosition || !second.gridPosition) return { rowOffset: 0, colOffset: 0, distance: Number.POSITIVE_INFINITY };
  let best = { rowOffset: 0, colOffset: 0, distance: Number.POSITIVE_INFINITY };
  for (const firstCell of cellsFor(first, effectiveDefinition(state, definitions, first))) {
    for (const secondCell of cellsFor(second, effectiveDefinition(state, definitions, second))) {
      const rowOffset = secondCell.row - firstCell.row;
      const colOffset = secondCell.col - firstCell.col;
      const distance = Math.max(Math.abs(rowOffset), Math.abs(colOffset));
      const betterTieBreak = distance === best.distance
        && Math.abs(rowOffset) + Math.abs(colOffset) < Math.abs(best.rowOffset) + Math.abs(best.colOffset);
      if (distance < best.distance || betterTieBreak) best = { rowOffset, colOffset, distance };
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
  const definition = effectiveDefinition(state, definitions, source);
  const primarySkill = definition.skills.find((skill) => skill.type !== 'CombatStart' && skill.type !== 'CombatEnd');
  const grantKey = allies ? 'grantAttacksToAlly' : 'grantAttacksToFoe';
  const grantSource = definition.skills
    .filter((skill) => skillUnlocked(skill, source.classLevel))
    .map((skill) => skill.modifiers)
    .find((modifiers) => numberMod(modifiers, grantKey) !== undefined);
  const radiusValue = allies ? numberMod(grantSource, 'grantAttacksToAllyRadius') : undefined;
  const radius = radiusValue === undefined ? undefined : Math.max(0, Math.floor(radiusValue));
  const candidates = boardDice(state, owner)
    .filter((die) => die.instanceId !== source.instanceId)
    .filter((die) => radius === undefined
      || (source.gridPosition !== undefined
        && die.gridPosition !== undefined
        && isWithinFootprintRadius(
          source.gridPosition,
          footprintFor(definition),
          die.gridPosition,
          footprintFor(effectiveDefinition(state, definitions, die)),
          radius
        )))
    .map((die) => ({
      die,
      distance: allies
        ? footprintColumnDistance(state, definitions, source, die)
        : attackDistanceBetween(state, definitions, source, die)
    }));
  if (candidates.length === 0) return undefined;
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

function hasUnlockedBooleanModifier(definition: DiceDefinition, key: string, classLevel: number): boolean {
  return definition.skills.some((skill) => skillUnlocked(skill, classLevel) && booleanMod(skill.modifiers, key));
}

function isRangeThresholdSatisfied(
  modifiers: SkillModifiers | undefined,
  distance: number,
  effectiveRange: number
): boolean {
  const threshold = numberMod(modifiers, 'skillRangeThreshold');
  if (threshold === undefined) return true;
  if (!Number.isFinite(distance)) return false;
  return distance <= Math.max(1, effectiveRange - Math.max(0, threshold));
}

function maxModifierForTarget(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie,
  key: string
): number {
  const definition = effectiveDefinition(state, definitions, attacker);
  const distance = attackDistanceBetween(state, definitions, attacker, target);
  return definition.skills.reduce((maximum, skill) => {
    if (!skillUnlocked(skill, attacker.classLevel)) return maximum;
    const value = numberMod(skill.modifiers, key);
    if (value === undefined) return maximum;
    if (!isRangeThresholdSatisfied(skill.modifiers, distance, definition.range)) return maximum;
    return Math.max(maximum, value);
  }, 0);
}

const TRIGGER_PRIMARY_ONLY_KEYS = new Set(['statusEffect']);

function passiveCount(definition: DiceDefinition, classLevel: number, key: 'attackCount' | 'projectileCount' | 'rapidFireIncrease'): number {
  return Math.max(0, Math.floor(skillsOfType(definition, 'Passive')
    .filter((skill) => skillUnlocked(skill, classLevel) && skill.modifiers?.skillRangeThreshold === undefined)
    .reduce((total, skill) => total + Math.max(0, numberMod(skill.modifiers, key) ?? 0), 0)));
}

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
      if (type === 'Passive' && (key === 'attackCountIncrease' || key === 'projectileCountIncrease' || key === 'skillDuration')) continue;
      if (!(key in merged)) {
        merged[key] = entry;
      } else if (key === 'attackCountIncrease' || key === 'projectileCountIncrease' || key === 'skillDuration') {
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
      baseSkills[index] = current && row.type === undefined
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

function boardSideOf(die: CombatDie): OwnerId {
  return die.mana['infiltrated'] === 1 ? otherOwner(die.ownerId) : die.ownerId;
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

function gridLockedCells(state: CombatState, ownerId: OwnerId): Set<string> {
  return new Set(Object.entries(state.gridLocks?.[ownerId] ?? {})
    .filter(([, turns]) => turns > 0)
    .map(([cell]) => cell));
}

function footprintHitsLockedTile(
  definition: DiceDefinition,
  position: BattlePosition,
  blocked: Set<string>
): boolean {
  const footprint = footprintFor(definition);
  for (let rowOffset = 0; rowOffset < footprint; rowOffset += 1) {
    for (let colOffset = 0; colOffset < footprint; colOffset += 1) {
      if (blocked.has(`${position.row + rowOffset}:${position.col + colOffset}`)) return true;
    }
  }
  return false;
}

function findRandomPlacement(
  die: CombatDie,
  definition: DiceDefinition,
  occupied: Set<string>,
  blocked: Set<string>,
  random: RandomSource
): BattlePosition | undefined {
  const footprint = footprintFor(definition);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const position = {
      row: Math.floor(random() * (GRID_SIZE - footprint + 1)),
      col: Math.floor(random() * (GRID_SIZE - footprint + 1))
    };
    if (!footprintHitsLockedTile(definition, position, blocked) && canPlace(die, definition, position, occupied)) {
      return position;
    }
  }
  for (let row = 0; row <= GRID_SIZE - footprint; row += 1) {
    for (let col = 0; col <= GRID_SIZE - footprint; col += 1) {
      const position = { row, col };
      if (!footprintHitsLockedTile(definition, position, blocked) && canPlace(die, definition, position, occupied)) {
        return position;
      }
    }
  }
  return undefined;
}

function distanceBetween(attacker: CombatDie, target: CombatDie, definitions: Map<string, DiceDefinition>, state: CombatState): number {
  if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;
  const attackerDef = effectiveDefinition(state, definitions, attacker);
  const targetDef = effectiveDefinition(state, definitions, target);
  const attackerCells = cellsFor(attacker, attackerDef);
  const targetCells = cellsFor(target, targetDef);
  const attackerSide = boardSideOf(attacker);
  const targetSide = boardSideOf(target);
  if (attackerSide === targetSide) {
    return Math.max(1, footprintColumnDistance(state, definitions, attacker, target));
  }
  let best = Number.POSITIVE_INFINITY;
  for (const first of attackerCells) {
    for (const second of targetCells) {
      const attackerToFrontline = attackerSide === 'player'
        ? GRID_SIZE - first.col
        : first.col + 1;
      const targetFromFrontline = targetSide === 'player'
        ? GRID_SIZE - second.col
        : second.col + 1;
      best = Math.min(best, Math.max(0, attackerToFrontline + targetFromFrontline - 1));
    }
  }
  return best;
}

function attackDistanceBetween(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie
): number {
  if (attacker.mana['infiltrated'] !== 1) return distanceBetween(attacker, target, definitions, state);
  if (boardSideOf(attacker) !== boardSideOf(target)) return Number.POSITIVE_INFINITY;
  return Math.max(1, footprintChebyshevDistance(state, definitions, attacker, target));
}

function heatwaveDistance(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  target: CombatDie
): number {
  return boardSideOf(source) === boardSideOf(target)
    ? footprintChebyshevDistance(state, definitions, source, target)
    : distanceBetween(source, target, definitions, state);
}

function selectNearestFoeIgnoringRange(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie
): CombatDie | undefined {
  return boardDice(state, otherOwner(source.ownerId))
    .map((die) => ({ die, distance: distanceBetween(source, die, definitions, state) }))
    .sort((a, b) => (
      a.distance - b.distance
      || (a.die.gridPosition?.row ?? 0) - (b.die.gridPosition?.row ?? 0)
      || (a.die.gridPosition?.col ?? 0) - (b.die.gridPosition?.col ?? 0)
      || a.die.instanceId.localeCompare(b.die.instanceId)
    ))[0]?.die;
}

function selectWeakestFoeIgnoringRange(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie
): CombatDie | undefined {
  return boardDice(state, otherOwner(source.ownerId))
    .sort((a, b) => (
      a.currentHealth - b.currentHealth
      || a.maxHealth - b.maxHealth
      || (a.gridPosition?.row ?? 0) - (b.gridPosition?.row ?? 0)
      || (a.gridPosition?.col ?? 0) - (b.gridPosition?.col ?? 0)
      || a.instanceId.localeCompare(b.instanceId)
    ))[0];
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
    .map((die) => ({ die, distance: allies
        ? footprintColumnDistance(state, definitions, attacker, die)
        : attackDistanceBetween(state, definitions, attacker, die) }))
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

function selectHealTarget(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie
): CombatDie | undefined {
  const maxRange = rangeOf(state, definitions, attacker);
  return boardDice(state, attacker.ownerId)
    .filter((die) => die.currentHealth < die.maxHealth)
    .map((die) => ({ die, distance: footprintColumnDistance(state, definitions, attacker, die) }))
    .filter(({ distance }) => distance <= maxRange)
    .sort((left, right) => (
      (left.die.currentHealth / left.die.maxHealth) - (right.die.currentHealth / right.die.maxHealth)
      || left.die.currentHealth - right.die.currentHealth
      || left.die.instanceId.localeCompare(right.die.instanceId)
    ))[0]?.die;
}

function selectTargetInRange(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  mode: string,
  maxRange: number,
  random: RandomSource
): CombatDie | undefined {
  const candidates = boardDice(state, otherOwner(source.ownerId))
    .map((die) => ({ die, distance: attackDistanceBetween(state, definitions, source, die) }))
    .filter(({ distance }) => distance <= Math.max(1, maxRange));
  if (candidates.length === 0) return undefined;
  if (mode === 'Random') return pickRandom(candidates, random)?.die;
  return sortedByMode(candidates, mode)[0]?.die;
}

function chainTargetLimit(modifiers: SkillModifiers | undefined): number {
  const configured = numberMod(modifiers, 'chainTargets');
  if (configured === undefined || !Number.isFinite(configured)) return 1;
  return configured < 0 ? CHAIN_NO_TARGET_CAP : Math.max(0, Math.floor(configured));
}

function selectChainJumpTarget(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  primaryTarget: CombatDie,
  modifiers: SkillModifiers | undefined,
  excluded: Set<string>,
  random: RandomSource
): CombatDie | undefined {
  if (!primaryTarget.gridPosition) return undefined;
  const definition = effectiveDefinition(state, definitions, attacker);
  const chainRange = Math.max(1, Math.floor(
    numberMod(modifiers, 'chainRange')
    ?? (Number.isFinite(definition.range) ? definition.range : 1)
  ));
  const boardSide = boardSideOf(primaryTarget);
  const candidates = boardDice(state, primaryTarget.ownerId)
    .filter((die) => (
      die.instanceId !== primaryTarget.instanceId
      && !excluded.has(die.instanceId)
      && boardSideOf(die) === boardSide
    ))
    .map((die) => ({ die, ...closestFootprintOffsets(state, definitions, primaryTarget, die) }))
    .filter(({ distance }) => distance <= chainRange);
  if (candidates.length === 0) return undefined;
  const rowCandidates = candidates.filter(({ rowOffset }) => rowOffset === 0);
  const fallbackCandidates = candidates.filter(({ rowOffset, colOffset }) => (
    rowOffset !== 0 && (colOffset === 0 || Math.abs(rowOffset) === Math.abs(colOffset))
  ));
  const pool = rowCandidates.length > 0 ? rowCandidates : fallbackCandidates;
  if (pool.length === 0) return undefined;
  const mode = stringMod(modifiers, 'activeSkillTargeting')
    ?? stringMod(modifiers, 'skillTargeting')
    ?? definition.targetingMode
    ?? 'Nearest';
  if (mode === 'Random') return pickRandom(pool, random)?.die;
  return sortedByMode(pool.map(({ die, distance }) => ({ die, distance })), mode)[0]?.die;
}

function chainTargetsFor(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  primaryTarget: CombatDie,
  modifiers: SkillModifiers | undefined,
  random: RandomSource
): CombatDie[] {
  const limit = chainTargetLimit(modifiers);
  if (limit === 0) return [];
  const max = limit === CHAIN_NO_TARGET_CAP ? Number.POSITIVE_INFINITY : limit;
  const excluded = new Set<string>([attacker.instanceId, primaryTarget.instanceId]);
  const targets: CombatDie[] = [];
  let current = primaryTarget;
  while (targets.length < max) {
    const next = selectChainJumpTarget(state, definitions, attacker, current, modifiers, excluded, random);
    if (!next) break;
    targets.push(next);
    excluded.add(next.instanceId);
    current = next;
  }
  return targets;
}

function activeSkillRequiresTarget(modifiers: SkillModifiers): boolean {
  if (booleanMod(modifiers, 'canFireWithNoTargets')) return false;
  if (booleanMod(modifiers, 'activeOnlyTargetsAllies') || booleanMod(modifiers, 'onlyTargetsAllies') || hasPierceEffect(modifiers) || booleanMod(modifiers, 'instakill')) return true;
  if (booleanMod(modifiers, 'hitsAllFoes') || booleanMod(modifiers, 'hitsAllAllies')) return false;
  if (hasSplashEffect(modifiers) || hasChainEffect(modifiers) || hasHeatwaveEffect(modifiers)) return true;
  return numberMod(modifiers, 'skillDamage') !== undefined
    || numberMod(modifiers, 'skillDamageRate') !== undefined
    || (modifiers.skillDamageRatesByPip !== undefined && typeof modifiers.skillDamageRatesByPip === 'object')
    || stringMod(modifiers, 'statusEffect') !== undefined
    || numberMod(modifiers, 'poisonDamage') !== undefined
    || numberMod(modifiers, 'armorReduction') !== undefined
    || numberMod(modifiers, 'activeAttackDelta') !== undefined;
}

function statusStacks(die: CombatDie, type: StatusEffect): number {
  return die.mana[`status:${type}`] ?? 0;
}

function activePoisonStacks(die: CombatDie): NonNullable<CombatDie['poisonStacks']> {
  return (die.poisonStacks ?? []).filter((stack) => stack.turns > 0);
}

function activeSlowStacks(die: CombatDie): NonNullable<CombatDie['slowStacks']> {
  return (die.slowStacks ?? []).filter((stack) => stack.turns > 0);
}

function syncPoisonStatus(die: CombatDie): void {
  const stacks = activePoisonStacks(die);
  die.poisonStacks = stacks;
  if (stacks.length === 0) {
    delete die.mana['poisonAmount'];
    delete die.mana['status:poison'];
    delete die.mana['status:poison:turns'];
    delete die.mana['status:poison:value'];
    return;
  }
  die.mana['poisonAmount'] = stacks.reduce((total, stack) => total + stack.damage, 0);
  die.mana['status:poison'] = stacks.length;
  die.mana['status:poison:turns'] = Math.max(...stacks.map((stack) => stack.turns));
  die.mana['status:poison:value'] = 0;
}

function syncSlowStatus(die: CombatDie): void {
  const stacks = activeSlowStacks(die);
  die.slowStacks = stacks;
  die.attackDelta = stacks.reduce((total, stack) => total + stack.delta, 0);
  die.attackDeltaTurns = stacks.length > 0 ? Math.max(...stacks.map((stack) => stack.turns)) : 0;
  if (stacks.length === 0) {
    delete die.mana['status:slow'];
    delete die.mana['status:slow:turns'];
    delete die.mana['status:slow:value'];
    return;
  }
  die.mana['status:slow'] = stacks.length;
  die.mana['status:slow:turns'] = die.attackDeltaTurns;
  die.mana['status:slow:value'] = die.attackDelta;
}

function totalStatusStacks(die: CombatDie): number {
  return (['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk', 'acceleration', 'dilation', 'disorientation'] as StatusEffect[])
    .reduce((total, effect) => total + statusStacks(die, effect), 0);
}

function addStatus(die: CombatDie, type: StatusEffect, turns: number, value?: number, maxStacks?: number): void {
  const current = statusStacks(die, type);
  const singleStack = type === 'fracture' || type === 'taunt' || type === 'stun' || type === 'berserk' || type === 'disorientation';
  const next = singleStack
    ? 1
    : maxStacks === undefined ? current + 1 : Math.min(maxStacks, current + 1);
  die.mana[`status:${type}`] = next;
  die.mana[`status:${type}:turns`] = Math.max(turns, die.mana[`status:${type}:turns`] ?? 0);
  die.mana[`status:${type}:value`] = value ?? 0;
}

function clearStatus(die: CombatDie, type: StatusEffect): void {
  if (type === 'poison') {
    die.poisonStacks = [];
    delete die.mana['poisonAmount'];
  }
  if (type === 'slow') {
    die.slowStacks = [];
    die.attackDelta = 0;
    die.attackDeltaTurns = 0;
  }
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
      lockTurns: {},
      lockStatus: {},
      gridLocks: { player: {}, enemy: {} },
      pools: []
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
      const boardSide = boardSideOf(die);
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
        boardSide: mirror ? otherOwner(boardSide) : boardSide,
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
      : Object.fromEntries(Object.entries(state.reviveCounts).filter(([instanceId]) => visibleDice.some((die) => die.instanceId === instanceId))),
    pools: state.pools.map((pool) => {
      const boardSide = mirror ? otherOwner(pool.ownerId) : pool.ownerId;
      return {
        typeId: pool.typeId,
        title: pool.title,
        row: pool.row,
        col: mirror ? GRID_SIZE - 1 - pool.col : pool.col,
        damage: pool.damage,
        turns: pool.turns,
        boardSide,
        statusEffect: pool.statusEffect,
        statusDuration: pool.statusDuration,
        maxStacks: pool.maxStacks,
        affects: pool.affects,
        accent: pool.accent
      };
    })
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

  const blocked = gridLockedCells(state, ownerId);
  const random = makeRng(`${state.turn}:${ownerId}:disorientation`, state.turn);
  const nextPositions = new Map<string, { row: number; col: number }>();
  for (const die of ownDice) {
    const submission = byInstance.get(die.instanceId);
    if (!submission) return 'Board is missing a die.';
    if (submission.typeId !== die.typeId) return 'Board contains an invalid die.';
    if (hasStatus(die, 'disorientation')) continue;
    const definition = effectiveDefinition(state, definitions, die);
    const position = { row: submission.row, col: submission.col };
    if (footprintHitsLockedTile(definition, position, blocked)) return 'Board contains a chained tile.';
    if (!canPlace(die, definition, position, occupied)) return 'Board contains an invalid position.';
    occupy(die, definition, position, occupied);
    nextPositions.set(die.instanceId, position);
  }

  for (const die of ownDice) {
    if (!hasStatus(die, 'disorientation')) continue;
    const definition = effectiveDefinition(state, definitions, die);
    const position = findRandomPlacement(die, definition, occupied, blocked, random);
    if (!position) return 'Board contains an invalid position.';
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
  random: RandomSource,
  blocked: Set<string> = new Set()
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
    if (!footprintHitsLockedTile(definition, position, blocked) && canPlace(die, definition, position, occupied)) {
      occupy(die, definition, position, occupied);
      die.zone = 'board';
      die.gridPosition = position;
      return true;
    }
  }
  for (const position of columns.flatMap((col) => (
    Array.from({ length: GRID_SIZE - footprint + 1 }, (_, row) => ({ row, col }))
  ))) {
    if (!footprintHitsLockedTile(definition, position, blocked) && canPlace(die, definition, position, occupied)) {
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
  const blocked = gridLockedCells(state, ownerId);
  let placed = 0;
  for (const die of state.dice) {
    if (die.ownerId !== ownerId || die.isDestroyed || die.zone !== 'hand') continue;
    if (autoPlaceOne(state, definitions, die, occupied, random, blocked)) placed += 1;
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
  const distance = attackDistanceBetween(state, definitions, attacker, target);
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
  if (rate <= 0 && maxRate <= 0) return 0;
  const adjacentAllies = boardDice(state, attacker.ownerId).some((die) => (
    die.instanceId !== attacker.instanceId
    && distanceBetween(attacker, die, definitions, state) <= 1
  ));
  if (maxRate > 0 && adjacentAllies) return 0;
  const bossMitigation = effectiveDefinition(state, definitions, target).isBoss === true ? 0.25 : 1;
  const currentHealth = rate > 0
    ? Math.max(0, Math.floor(target.currentHealth * rate * bossMitigation))
    : 0;
  const maxHealth = maxRate > 0
    ? Math.max(1, Math.floor(target.maxHealth * maxRate * bossMitigation))
    : 0;
  return currentHealth + maxHealth;
}

function applySkillDamageModifiers(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie,
  rawDamage: number,
  modifiers: SkillModifiers | undefined
): number {
  let adjusted = Math.max(1, rawDamage);
  const lowHpThreshold = numberMod(modifiers, 'lowHpThresholdRate');
  const lowHpBonus = numberMod(modifiers, 'lowHpDamageBonusRate');
  if (lowHpThreshold !== undefined && lowHpBonus !== undefined && target.maxHealth > 0
    && target.currentHealth < target.maxHealth * lowHpThreshold) {
    adjusted = Math.floor(adjusted * (1 + lowHpBonus));
  }
  const distance = distanceBetween(attacker, target, definitions, state);
  if (Number.isFinite(distance)) {
    const distanceFlat = numberMod(modifiers, 'distanceDamageBonusPerTile');
    if (distanceFlat !== undefined) adjusted += distance * distanceFlat;
    const distanceRate = numberMod(modifiers, 'distanceDamageBonusRatePerTile');
    if (distanceRate !== undefined) adjusted = Math.floor(adjusted * (1 + distanceRate * distance));
  }
  return Math.max(1, Math.floor(adjusted));
}

function criticalChance(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target?: CombatDie
): number {
  const definition = effectiveDefinition(state, definitions, attacker);
  const bonus = target
    ? maxModifierForTarget(state, definitions, attacker, target, 'criticalChanceIncrease')
    : maxModifier(definition, 'criticalChanceIncrease');
  return clamp(BASE_CRITICAL_CHANCE + bonus, 0, 1);
}

function criticalMultiplier(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target?: CombatDie
): number {
  const definition = effectiveDefinition(state, definitions, attacker);
  const bonus = target
    ? maxModifierForTarget(state, definitions, attacker, target, 'criticalDamageIncrease')
    : maxModifier(definition, 'criticalDamageIncrease');
  return 2 + bonus;
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
  options: { critical?: boolean; allowCritical?: boolean; sourceLabel?: string; chainDepth?: number; suppressEvent?: boolean; ignoreShield?: boolean } = {}
): { dealt: number; absorbed: number; defeated: boolean; critical: boolean } {
  if (target.isDestroyed) return { dealt: 0, absorbed: 0, defeated: false, critical: false };
  const critical = options.allowCritical !== false
    && (options.critical === true || (attacker ? random() < criticalChance(state, definitions, attacker, target) : false));
  let damage = Math.max(1, Math.floor(rawDamage));
  if (critical && attacker) damage = Math.floor(damage * criticalMultiplier(state, definitions, attacker, target));
  if (target.fractureRate > 0) damage = Math.floor(damage * (1 + target.fractureRate));
  const absorbed = options.ignoreShield ? 0 : Math.min(target.shieldHp, damage);
  target.shieldHp = Math.max(0, target.shieldHp - absorbed);
  damage -= absorbed;
  const previousHealth = target.currentHealth;
  target.currentHealth = Math.max(0, target.currentHealth - damage);
  const onDamagedDamage = damage > 0 ? damage : absorbed;
  if (!options.suppressEvent) {
    addEvent(events, 'damage', `${effectiveDefinition(state, definitions, target).title} takes ${damage}${options.sourceLabel ? ` ${options.sourceLabel}` : ''} damage${absorbed > 0 ? ` (${absorbed} absorbed)` : ''}${critical ? ' (CRITICAL)' : ''}.`, {
      ownerId: target.ownerId,
      sourceId: attacker?.instanceId,
      targetId: target.instanceId,
      amount: damage,
      critical
    });
  }
  if (attacker && onDamagedDamage > 0) {
    applyOnDamaged(state, definitions, target, attacker, onDamagedDamage, events, random);
  }
  if (attacker && target.currentHealth > 0) {
    applyRevenge(state, definitions, target, previousHealth, events, random);
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


type SkillDamageHistoryStyle = 'combatStart' | 'combatEnd' | 'onKill' | 'onDeath' | 'onHit' | 'onTransformed';

function formatSkillDamageFeedback(hit: { dealt: number; absorbed: number; critical: boolean }): string {
  return `${hit.dealt}${hit.absorbed > 0 ? ` (shield absorbed ${hit.absorbed} damage!)` : ''}${hit.critical ? ' (CRITICAL)' : ''}`;
}

function ordinalLabel(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1: return `${value}st`;
    case 2: return `${value}nd`;
    case 3: return `${value}rd`;
    default: return `${value}th`;
  }
}

function skillDamageHistoryText(
  style: SkillDamageHistoryStyle,
  sourceName: string,
  targetName: string,
  hit: { dealt: number; absorbed: number; critical: boolean },
  transformOrdinal = 1
): string {
  const feedback = formatSkillDamageFeedback(hit);
  switch (style) {
    case 'combatStart': return `${sourceName} hits ${targetName} first for ${feedback} damage!`;
    case 'combatEnd': return `${sourceName} hits ${targetName} last for ${feedback} damage!`;
    case 'onKill': return `${sourceName} sentences ${targetName} for ${feedback} damage!`;
    case 'onDeath': return `${sourceName} leaves a nasty surprise for ${targetName} after getting taken down, resulting in ${feedback} damage!`;
    case 'onTransformed': return `${sourceName} after its ${ordinalLabel(transformOrdinal)} transformation mauls ${targetName} for ${feedback} damage!`;
    default: return `${sourceName} prickles ${targetName} for ${feedback} damage!`;
  }
}

function applyHeatwaveDamage(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  victims: CombatDie[],
  rawDamage: number,
  events: CombatEvent[],
  random: RandomSource
): void {
  const hits: Array<{ target: CombatDie; dealt: number; critical: boolean }> = [];
  for (const victim of victims) {
    const hit = dealDamage(state, definitions, attacker, victim, rawDamage, events, random, {
      allowCritical: false,
      suppressEvent: true
    });
    if (hit.dealt > 0 || hit.absorbed > 0) hits.push({ target: victim, dealt: hit.dealt, critical: hit.critical });
  }
  if (hits.length === 0) return;
  const attackerName = effectiveDefinition(state, definitions, attacker).title;
  if (hits.length === 1) {
    const entry = hits[0]!;
    addEvent(events, 'damage', `${attackerName} scorches ${effectiveDefinition(state, definitions, entry.target).title} nearby for ${entry.dealt} damage!`, {
      ownerId: entry.target.ownerId,
      sourceId: attacker.instanceId,
      targetId: entry.target.instanceId,
      amount: entry.dealt
    });
    return;
  }
  const victimText = hits.map(({ target, dealt }) => `${effectiveDefinition(state, definitions, target).title} (damage: ${dealt})`);
  const victimList = `${victimText.slice(0, -1).join(', ')}${victimText.length > 2 ? ',' : ''} and ${victimText[victimText.length - 1] ?? ''}`;
  const totalDamage = hits.reduce((sum, hit) => sum + hit.dealt, 0);
  addEvent(events, 'damage', `${attackerName} scorches ${victimList} for ${totalDamage} total damage!`, {
    ownerId: attacker.ownerId,
    sourceId: attacker.instanceId,
    amount: totalDamage
  });
}

function applyGenericSkillEffect(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  target: CombatDie | undefined,
  modifiers: SkillModifiers | undefined,
  events: CombatEvent[],
  random: RandomSource,
  options: { pips?: number; healingTarget?: CombatDie; allowDamage?: boolean; allowHealing?: boolean; historyStyle?: SkillDamageHistoryStyle; transformOrdinal?: number } = {}
): void {
  if (!modifiers) return;
  const definition = effectiveDefinition(state, definitions, source);
  summonFromModifiers(state, definitions, source, modifiers, events, random);
  if (options.allowDamage !== false && hasSkillDamage(modifiers) && target && !target.isDestroyed) {
    const rawDamage = pipScaledDamage(definition, modifiers, 'skillDamage', options.pips ?? source.pips, definition.attack);
    const damage = applySkillDamageModifiers(state, definitions, source, target, rawDamage, modifiers);
    const hit = dealDamage(state, definitions, source, target, damage, events, random, {
      suppressEvent: options.historyStyle !== undefined
    });
    if (options.historyStyle) {
      addEvent(events, 'damage', skillDamageHistoryText(
        options.historyStyle,
        definition.title,
        effectiveDefinition(state, definitions, target).title,
        hit,
        options.transformOrdinal
      ), {
        ownerId: target.ownerId,
        sourceId: source.instanceId,
        targetId: target.instanceId,
        amount: hit.dealt,
        critical: hit.critical
      });
    }
  }
  const healing = numberMod(modifiers, 'skillHealing');
  if (options.allowHealing !== false && healing !== undefined) {
    const healingTarget = options.healingTarget ?? source;
    if (!healingTarget.isDestroyed) heal(state, definitions, source, healingTarget, Math.max(1, Math.ceil(healing)), events, random);
  }
}

function spawnPools(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  poolType: string | undefined,
  origin: BattlePosition,
  pattern?: Array<[number, number]>,
  duration?: number
): void {
  const definition = diceCatalog.getPool(poolType ?? '');
  if (!definition || !poolType) return;
  const sourceDefinition = effectiveDefinition(state, definitions, source);
  const damage = Math.max(0, Math.round(definition.damage * getClassMultiplier(sourceDefinition, source.classLevel)));
  const turns = Math.max(0, Math.floor(duration ?? definition.duration ?? 1));
  if (turns <= 0) return;
  const offsets = pattern?.length ? pattern : definition.pattern?.length ? definition.pattern : [[0, 0]] as Array<[number, number]>;
  for (const [rowOffset, colOffset] of offsets) {
    if (!Number.isFinite(rowOffset) || !Number.isFinite(colOffset)) continue;
    const row = origin.row + Math.trunc(rowOffset);
    const col = origin.col + Math.trunc(colOffset);
    if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) continue;
    state.pools = state.pools.filter((pool) => !(pool.row === row && pool.col === col && pool.ownerId === source.ownerId));
    state.pools.push({
      typeId: definition.typeId,
      title: definition.title,
      row,
      col,
      damage,
      turns,
      ownerId: source.ownerId,
      sourceTypeId: source.typeId,
      sourceInstanceId: source.instanceId,
      statusEffect: definition.statusEffect,
      statusDuration: definition.statusDuration,
      maxStacks: definition.maxStacks,
      affects: definition.affects ?? 'foes',
      accent: definition.accent
    });
  }
}

function poolAffectsDie(pool: CombatState['pools'][number], die: CombatDie): boolean {
  if (pool.affects === 'both') return true;
  if (pool.affects === 'allies') return die.ownerId === pool.ownerId;
  return die.ownerId !== pool.ownerId;
}

function applyPoolsAtCombatStart(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  events: CombatEvent[],
  random: RandomSource
): void {
  for (const die of state.dice) {
    if (die.zone !== 'board' || die.isDestroyed || !die.gridPosition) continue;
    const dieCells = cellsFor(die, effectiveDefinition(state, definitions, die));
    const matchingPools = state.pools.filter((pool) => (
      poolAffectsDie(pool, die)
      && dieCells.some((cell) => cell.row === pool.row && cell.col === pool.col)
    ));
    if (matchingPools.length === 0) continue;

    const groupedPools = new Map<string, typeof matchingPools>();
    for (const pool of matchingPools) {
      const group = groupedPools.get(pool.typeId) ?? [];
      group.push(pool);
      groupedPools.set(pool.typeId, group);
    }

    for (const pools of groupedPools.values()) {
      const pool = pools[0];
      if (!pool) continue;
      const source = pool.sourceInstanceId
        ? state.dice.find((candidate) => candidate.instanceId === pool.sourceInstanceId && !candidate.isDestroyed)
        : undefined;
      let ticks = 0;
      let totalDealt = 0;
      for (const tickPool of pools) {
        if (die.isDestroyed || tickPool.damage <= 0) continue;
        const hit = dealDamage(state, definitions, source, die, tickPool.damage, events, random, {
          allowCritical: false,
          sourceLabel: tickPool.title,
          suppressEvent: pools.length > 1
        });
        ticks += 1;
        totalDealt += hit.dealt;
      }
      if (ticks > 1) {
        addEvent(events, 'damage', `${effectiveDefinition(state, definitions, die).title} takes ${ticks} ticks of ${pool.title} damage!`, {
          ownerId: die.ownerId,
          sourceId: source?.instanceId,
          targetId: die.instanceId,
          amount: totalDealt
        });
      }
      if (!die.isDestroyed && pool.statusEffect) {
        const statusSource = source ?? die;
        statusApplication(state, definitions, statusSource, die, {
          statusEffect: pool.statusEffect,
          statusDuration: pool.statusDuration ?? 1,
          poisonDamage: pool.statusEffect === 'poison' ? Math.max(1, pool.damage) : undefined,
          attackDelta: pool.statusEffect === 'slow' ? -1 : undefined,
          armorReduction: pool.statusEffect === 'fracture' ? 0.1 : undefined,
          maxStacks: pool.maxStacks
        }, events, die.pips);
      }
    }
  }
}

function triggerNuclear(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  modifiers: SkillModifiers | undefined,
  events: CombatEvent[],
  random: RandomSource,
  position = source.gridPosition,
  allowRepeat = false
): void {
  if (!booleanMod(modifiers, 'hasNuclear') || (!allowRepeat && source.mana['nuclearUsed'] === 1) || !position) return;
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
  const poolType = stringMod(modifiers, 'nuclearPool');
  if (poolType) {
    for (let row = top; row < top + rows; row += 1) {
      for (let col = left; col < left + cols; col += 1) {
        if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) continue;
        spawnPools(state, definitions, source, poolType, { row, col }, undefined, numberMod(modifiers, 'nuclearPoolLifespan'));
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
  const matchingDefinition = [...definitions.values()].find((definition) => definition.typeId === typeId);
  const base = sourceDefinition.typeId === typeId ? sourceDefinition : matchingDefinition ?? sourceDefinition;
  const healthRate = clamp(numberMod(modifiers, 'plaguedDieHealth') ?? 1, 0, 1);
  const attackRate = Math.max(0, numberMod(modifiers, 'plaguedDieAttack') ?? 1);
  const maxHealth = Math.max(1, Math.round(base.health));
  const currentHealth = Math.max(1, Math.round(maxHealth * healthRate));
  const definition: DiceDefinition = {
    ...base,
    typeId,
    attack: Math.max(1, Math.round(base.attack * attackRate)),
    health: maxHealth,
    skills: base.skills.map((skill) => ({ ...skill, modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers }))
  };
  const defeatedBoardSide = boardSideOf(defeated);
  const instanceId = `${source.ownerId === 'player' ? 'a' : 'b'}-plague-${state.dice.length + 1}`;
  const spawned: CombatDie = {
    instanceId,
    typeId,
    classLevel: source.classLevel,
    ownerId: source.ownerId,
    zone: 'board',
    maxHealth,
    currentHealth,
    isDestroyed: false,
    hasFinishedAttacking: true,
    attacksRemaining: 0,
    pips: defeated.pips,
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
  if (!defeatedPosition) return;
  const footprint = footprintFor(definition);
  if (defeatedPosition.row < 0 || defeatedPosition.col < 0
    || defeatedPosition.row + footprint > GRID_SIZE
    || defeatedPosition.col + footprint > GRID_SIZE) return;
  spawned.gridPosition = { row: defeatedPosition.row, col: defeatedPosition.col };
  if (defeatedBoardSide !== source.ownerId) spawned.mana['infiltrated'] = 1;
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
  const maxRevives = numberMod(onDeathModifiers, 'maxRevives');
  const previousRevives = state.reviveCounts[target.instanceId] ?? 0;
  const otherLiving = living(state, target.ownerId).some((die) => die.instanceId !== target.instanceId);
  const decay = numberMod(onDeathModifiers, 'reviveChanceRate') ?? 1;
  const chance = reviveChance === undefined ? 0 : clamp(reviveChance * (decay ** previousRevives), 0, 1);
  const canRevive = hasRevive
    && chance > 0
    && (maxRevives === undefined || previousRevives < maxRevives)
    && (!booleanMod(onDeathModifiers, 'dontReviveWhenLastOneStanding') || otherLiving);
  if (canRevive && random() < chance) {
    const healthRate = clamp(numberMod(onDeathModifiers, 'reviveHealth') ?? 1, 0, 1);
    const attackRate = clamp(numberMod(onDeathModifiers, 'reviveAttack') ?? 1, 0, 1);
    const revivedMaxHealth = Math.max(1, Math.round(target.maxHealth));
    const revivedHealth = Math.max(1, Math.round(revivedMaxHealth * healthRate));
    const revivedDefinition: DiceDefinition = {
      ...definition,
      attack: Math.max(1, Math.round(definition.attack * attackRate)),
      health: revivedMaxHealth
    };
    state.reviveCounts[target.instanceId] = previousRevives + 1;
    definitions.set(target.instanceId, revivedDefinition);
    target.isDestroyed = false;
    target.zone = 'board';
    target.maxHealth = revivedMaxHealth;
    target.currentHealth = revivedHealth;
    const reviveDuration = Math.max(0, Math.floor(numberMod(onDeathModifiers, 'skillDuration') ?? 0));
    if (reviveDuration > 0) {
      const attackIncrease = Math.max(0, Math.floor(numberMod(onDeathModifiers, 'attackCountIncrease') ?? 0));
      const projectileIncrease = Math.max(0, Math.floor(numberMod(onDeathModifiers, 'projectileCountIncrease') ?? 0));
      if (attackIncrease > 0) {
        target.mana['extraAttacks'] = (target.mana['extraAttacks'] ?? 0) + attackIncrease;
        target.mana['extraAttackTurns'] = Math.max(target.mana['extraAttackTurns'] ?? 0, reviveDuration);
      }
      if (projectileIncrease > 0) {
        target.mana['projectileBonus'] = (target.mana['projectileBonus'] ?? 0) + projectileIncrease;
        target.mana['projectileBonusTurns'] = Math.max(target.mana['projectileBonusTurns'] ?? 0, reviveDuration);
      }
    }
    triggerNuclear(state, definitions, target, onDeathModifiers, events, random, target.gridPosition, true);
    addEvent(events, 'revive', `${definition.title} revives with ${target.currentHealth} health!`, {
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
  if (onDeathModifiers) triggerNuclear(state, definitions, target, onDeathModifiers, events, random, defeatedPosition, true);

  if (depth >= 4) return;

  if (onDeathModifiers && attacker) {
    applyGenericSkillEffect(state, definitions, target, attacker, onDeathModifiers, events, random, {
      healingTarget: target,
      historyStyle: 'onDeath'
    });
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
  const onKillTarget = selectTarget(state, definitions, attacker, attackerDefinition.targetingMode, false, false, random);
  applyGenericSkillEffect(state, definitions, attacker, onKillTarget ?? target, modifiers, events, random, {
    healingTarget: attacker,
    historyStyle: 'onKill'
  });
  const allyGrant = attackGrantAmount(modifiers, 'grantAttacksToAlly', true);
  if (allyGrant > 0) grantAttacks(state, definitions, attacker, allyGrant, true, events, random, grantMode(modifiers));
  const foeGrant = attackGrantAmount(modifiers, 'grantAttacksToFoe', true);
  if (foeGrant > 0) grantAttacks(state, definitions, attacker, foeGrant, false, events, random, grantMode(modifiers));
  const hammerDamage = numberMod(modifiers, 'hammerDamage') ?? attackerDefinition.attack;
  const maxHammerRetriggers = Math.max(0, Math.floor(numberMod(modifiers, 'maxSkillRetriggers') ?? 10));
  const canTriggerHammer = depth === 0
    || (booleanMod(modifiers, 'canRetriggerSkill') && depth < maxHammerRetriggers);
  const hammerTarget = selectWeakestFoeIgnoringRange(state, definitions, attacker);
  if (booleanMod(modifiers, 'hasHammer') && canTriggerHammer && hammerTarget?.gridPosition) {
    const hammerRadius = Math.max(0, Math.floor(numberMod(modifiers, 'hammerRadius') ?? 1));
    const hammerSide = boardSideOf(hammerTarget);
    const victims = boardDice(state, hammerTarget.ownerId).filter((die) => (
      boardSideOf(die) === hammerSide
      && footprintChebyshevDistance(state, definitions, hammerTarget, die) <= hammerRadius
    ));
    const hammerHits: Array<{ victim: CombatDie; dealt: number }> = [];
    for (const victim of victims) {
      const hit = dealDamage(state, definitions, attacker, victim, Math.max(1, Math.floor(hammerDamage)), events, random, {
        allowCritical: false,
        chainDepth: depth + 1,
        suppressEvent: true
      });
      hammerHits.push({ victim, dealt: hit.dealt });
    }
    const struckNames = hammerHits
      .filter((hit) => hit.victim.instanceId !== hammerTarget.instanceId)
      .map((hit) => effectiveDefinition(state, definitions, hit.victim).title);
    const hammerTotalDamage = hammerHits.reduce((sum, hit) => sum + hit.dealt, 0);
    const struckLabel = struckNames.length > 0
      ? ` striking ${struckNames.join(', ')} for ${hammerTotalDamage} total damage`
      : hammerHits.length > 0
        ? ` for ${hammerTotalDamage} total damage`
        : ' but strikes nothing';
    addEvent(events, 'skill', `⚖️ ${attackerDefinition.title}'s Hammer marks ${effectiveDefinition(state, definitions, hammerTarget).title}${struckLabel}!`, {
      ownerId: attacker.ownerId,
      sourceId: attacker.instanceId,
      targetId: hammerTarget.instanceId,
      amount: hammerTotalDamage
    });
  }
  const missingHeal = numberMod(modifiers, 'missingHealRate');
  if (missingHeal !== undefined) {
    const missing = Math.max(0, attacker.maxHealth - attacker.currentHealth);
    const critical = random() < BASE_CRITICAL_CHANCE;
    const healed = Math.min(missing, Math.floor(Math.ceil(missing * missingHeal) * (critical ? 2 : 1)));
    if (healed > 0) {
      attacker.currentHealth = Math.min(attacker.maxHealth, attacker.currentHealth + healed);
      addEvent(events, 'heal', `${attackerDefinition.title} heals ${healed} health${critical ? ' (CRITICAL)' : ''}.`, {
        ownerId: attacker.ownerId,
        sourceId: attacker.instanceId,
        amount: healed,
        critical
      });
    }
  }
  const bonusDamage = Math.floor(attackerDefinition.attack * (numberMod(modifiers, 'damageRatePerKill') ?? 0));
  if (bonusDamage > 0) attacker.mana['killDamageBonus'] = (attacker.mana['killDamageBonus'] ?? 0) + bonusDamage;
  applyPlague(state, definitions, attacker, target, modifiers, events, defeatedPosition);
}

function applyOnDamaged(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  target: CombatDie,
  attacker: CombatDie,
  _damage: number,
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
  applyGenericSkillEffect(state, definitions, target, attacker, modifiers, events, random, {
    healingTarget: target,
    historyStyle: 'onHit'
  });
  if (target.currentHealth > 0) {
    const shield = numberMod(modifiers, 'shield');
    if (shield !== undefined) {
      const shieldAmount = Math.max(1, Math.ceil(shield));
      target.shieldHp += shieldAmount;
      const shieldDuration = numberMod(modifiers, 'statusDuration');
      if (shieldDuration !== undefined && shieldDuration > 0) {
        target.shieldTurns = Math.max(target.shieldTurns, shieldDuration);
      }
      addEvent(events, 'shield', `${definition.title} gains ${shieldAmount} shield.`, {
        ownerId: target.ownerId,
        targetId: target.instanceId,
        amount: shieldAmount
      });
    }
    const allyGrant = attackGrantAmount(modifiers, 'grantAttacksToAlly', true);
    if (allyGrant > 0) grantAttacks(state, definitions, target, allyGrant, true, events, random, grantMode(modifiers));
    const foeGrant = attackGrantAmount(modifiers, 'grantAttacksToFoe', true);
    if (foeGrant > 0) grantAttacks(state, definitions, target, foeGrant, false, events, random, grantMode(modifiers));
  }
}

function applyRevenge(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  target: CombatDie,
  previousHealth: number,
  events: CombatEvent[],
  random: RandomSource
): void {
  const definition = effectiveDefinition(state, definitions, target);
  const skill = definition.skills.find((candidate) => (
    skillUnlocked(candidate, target.classLevel)
    && booleanMod(candidate.modifiers, 'hasRevenge')
    && numberMod(candidate.modifiers, 'revengeThresholdRate') !== undefined
  ));
  if (!skill) return;
  const threshold = clamp(numberMod(skill.modifiers, 'revengeThresholdRate') ?? 0, 0, 1);
  if (threshold <= 0
    || previousHealth < target.maxHealth * threshold
    || target.currentHealth >= target.maxHealth * threshold) return;
  const hits = Math.max(1, Math.floor(numberMod(skill.modifiers, 'revengeHits') ?? 1));
  const revengeRange = Math.max(1, Math.floor(numberMod(skill.modifiers, 'revengeRange') ?? definition.range));
  const revengeMode = stringMod(skill.modifiers, 'skillTargeting') ?? definition.targetingMode;
  const revengeTarget = selectTargetInRange(state, definitions, target, revengeMode, revengeRange, random);
  if (!revengeTarget) return;
  const revengeDamage = numberMod(skill.modifiers, 'revengeDamage') ?? definition.attack;
  for (let index = 0; index < hits && !revengeTarget.isDestroyed; index += 1) {
    dealDamage(state, definitions, target, revengeTarget, Math.max(1, Math.floor(revengeDamage)), events, random, {
      allowCritical: false,
      chainDepth: 1
    });
  }
  addEvent(events, 'skill', `${definition.title} unleashes Revenge!`, {
    ownerId: target.ownerId,
    sourceId: target.instanceId,
    targetId: revengeTarget.instanceId
  });
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
    if (!hasUnlockedBooleanModifier(definition, 'canConjureSouls', conjurer.classLevel)) continue;
    const conjureType = firstStringModifier(definition, 'conjureType') ?? 'ally';
    const matches = conjureType === 'both'
      || (conjureType === 'ally' && conjurer.ownerId === defeated.ownerId)
      || (conjureType === 'enemy' && conjurer.ownerId !== defeated.ownerId);
    if (!matches) continue;
    const currentSouls = conjurer.mana['souls'] ?? 0;
    const maxSouls = firstNumberModifier(definition, 'maxSouls');
    if (!hasUnlockedBooleanModifier(definition, 'noMaxSouls', conjurer.classLevel) && maxSouls !== undefined && currentSouls >= maxSouls) continue;
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

function summonFromModifiers(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  source: CombatDie,
  modifiers: SkillModifiers | undefined,
  events: CombatEvent[],
  random: RandomSource
): void {
  const summonType = stringMod(modifiers, 'summonType');
  if (!summonType) return;
  const context = combatRuntime.get(state);
  if (!context) return;
  summon(
    state,
    definitions,
    source,
    summonType,
    Math.max(1, Math.floor(numberMod(modifiers, 'summonCount') ?? 1)),
    context.catalog,
    context.rules,
    events,
    random,
    { pattern: normalizeSummonPattern(modifiers?.summonPattern), allowRoll: booleanMod(modifiers, 'allowSummonedDieToRoll') }
  );
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
  summonFromModifiers(state, definitions, attacker, modifiers, events, random);
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
    const chainDamage = pipScaledDamage(definition, modifiers, 'chainDamage', attacker.pips, definition.attack);
    for (const [index, chainTarget] of chainTargetsFor(state, definitions, attacker, target, modifiers, random).entries()) {
      dealDamage(state, definitions, attacker, chainTarget, chainDamage, events, random, { allowCritical: false, chainDepth: index + 1 });
    }
  }
  if (hasHeatwaveEffect(modifiers)) {
    const heatwave = pipScaledDamage(definition, modifiers, 'heatwaveDamage', attacker.pips, definition.attack);
    const victims = boardDice(state, target.ownerId).filter((die) => (
      footprintRowDistance(state, definitions, attacker, die) <= 1
      && heatwaveDistance(state, definitions, attacker, die) <= 1
    ));
    applyHeatwaveDamage(state, definitions, attacker, victims, heatwave, events, random);
  }
  if (hasPierceEffect(modifiers)) {
    const pierceRange = Math.max(1, Math.floor(numberMod(modifiers, 'pierceBehindRange') ?? 1));
    const pierceDamage = Math.max(1, Math.floor(numberMod(modifiers, 'pierceBehindDamage') ?? definition.attack));
    for (const victim of pierceBehindTargets(state, definitions, attacker, target, pierceRange)) {
      dealDamage(state, definitions, attacker, victim, pierceDamage, events, random, { allowCritical: false });
    }
  }
  applyRangeThresholdFuriousClaw(state, definitions, attacker, target, events, random);
}

function applyRangeThresholdFuriousClaw(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  target: CombatDie,
  events: CombatEvent[],
  random: RandomSource
): void {
  if (target.isDestroyed) return;
  const definition = effectiveDefinition(state, definitions, attacker);
  const skill = definition.skills.find((candidate) => (
    candidate.type === 'Passive'
    && skillUnlocked(candidate, attacker.classLevel)
    && (numberMod(candidate.modifiers, 'attackCount') ?? 0) > 0
    && numberMod(candidate.modifiers, 'skillRangeThreshold') !== undefined
  ));
  if (!skill) return;
  const distance = attackDistanceBetween(state, definitions, attacker, target);
  if (!isRangeThresholdSatisfied(skill.modifiers, distance, definition.range)) return;
  const hit = dealDamage(state, definitions, attacker, target, Math.max(1, definition.attack), events, random);
  addEvent(events, 'skill', `${definition.title}'s ${skill.title} strikes ${effectiveDefinition(state, definitions, target).title} for ${hit.dealt} damage.`, {
    ownerId: attacker.ownerId,
    sourceId: attacker.instanceId,
    targetId: target.instanceId,
    amount: hit.dealt
  });
}

function applyRicochet(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  attacker: CombatDie,
  anchor: CombatDie,
  modifiers: SkillModifiers | undefined,
  healing: boolean,
  baseAmount: number,
  events: CombatEvent[],
  random: RandomSource
): void {
  if (!hasRicochetEffect(modifiers)) return;
  const count = Math.max(0, Math.floor(numberMod(modifiers, 'ricochetCount') ?? 1));
  if (count <= 0) return;
  const range = Math.max(1, Math.floor(numberMod(modifiers, 'ricochetRange') ?? 2));
  const rawDropOff = numberMod(modifiers, 'ricochetDropOff');
  const dropOff = rawDropOff === undefined ? 1 : clamp(rawDropOff, 0, 1);
  const owner = healing ? attacker.ownerId : otherOwner(attacker.ownerId);
  const candidates = boardDice(state, owner)
    .filter((die) => die.instanceId !== anchor.instanceId && !die.isDestroyed && (!healing || die.currentHealth < die.maxHealth))
    .map((die) => ({ die, distance: healing
      ? footprintManhattanDistance(state, definitions, anchor, die)
      : boardSideOf(anchor) === boardSideOf(die)
        ? footprintChebyshevDistance(state, definitions, anchor, die)
        : distanceBetween(anchor, die, definitions, state) }))
    .filter(({ distance }) => distance <= range)
    .sort((a, b) => (
      (healing ? (a.die.currentHealth / a.die.maxHealth) - (b.die.currentHealth / b.die.maxHealth) : 0)
      || a.distance - b.distance
      || a.die.instanceId.localeCompare(b.die.instanceId)
    ))
    .slice(0, count);
  let amount = baseAmount;
  for (const { die } of candidates) {
    amount = Math.max(1, Math.floor(amount * dropOff));
    if (healing) {
      heal(state, definitions, attacker, die, amount, events, random);
    } else {
      dealDamage(state, definitions, attacker, die, amount, events, random, { allowCritical: false });
    }
  }
}

function addMana(
  attacker: CombatDie,
  definition: DiceDefinition,
  amount = 1,
  events?: CombatEvent[],
  state?: CombatState
): void {
  if ((attacker.mana['manaPausedTurns'] ?? 0) > 0) return;
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
  const radiusValue = numberMod(modifiers, 'manaGainRadius');
  const radius = radiusValue === undefined ? undefined : Math.max(0, Math.floor(radiusValue));
  const withinManaRadius = (target: CombatDie): boolean => radius === undefined
    || (source.gridPosition !== undefined
      && target.gridPosition !== undefined
      && isWithinFootprintRadius(
        source.gridPosition,
        footprintFor(definition),
        target.gridPosition,
        footprintFor(effectiveDefinition(state, definitions, target)),
        radius
      ));
  if (selfGain > 0) addMana(source, definition, selfGain);
  if (allyGain > 0) {
    for (const ally of boardDice(state, source.ownerId)) {
      if (ally.instanceId === source.instanceId || !withinManaRadius(ally)) continue;
      addMana(ally, effectiveDefinition(state, definitions, ally), allyGain);
    }
  }
  if (foeGain > 0) {
    for (const foe of boardDice(state, otherOwner(source.ownerId))) {
      if (!withinManaRadius(foe)) continue;
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
    const modifiers = skill.modifiers ?? {};
    if (!target && activeSkillRequiresTarget(modifiers)) continue;
    attacker.mana[key] = Math.max(0, (attacker.mana[key] ?? 0) - needed);
    triggerNuclear(state, definitions, attacker, modifiers, events, random);
    addEvent(events, 'skill', `${definition.title} uses ${skill.title}.`, {
      ownerId: attacker.ownerId,
      sourceId: attacker.instanceId,
      targetId: target?.instanceId
    });
    const statusTarget = target ?? attacker;
    statusApplication(state, definitions, attacker, statusTarget, modifiers, events, attacker.pips);

    if (booleanMod(modifiers, 'instakill') && target) {
      const targetDefinition = effectiveDefinition(state, definitions, target);
      const targetIsBoss = targetDefinition.isBoss === true;
      const damage = targetIsBoss
        ? applySkillDamageModifiers(
            state,
            definitions,
            attacker,
            target,
            pipScaledDamage(definition, modifiers, 'bossDamage', attacker.pips, definition.attack),
            modifiers
          )
        : target.currentHealth;
      const hit = dealDamage(state, definitions, attacker, target, damage, events, random, {
        allowCritical: false,
        ignoreShield: !targetIsBoss
      });
      addEvent(events, 'skill', targetIsBoss
        ? `${definition.title} reaps ${targetDefinition.title} for ${hit.dealt} damage.`
        : `${definition.title} instantly defeats ${targetDefinition.title}.`, {
        ownerId: attacker.ownerId,
        sourceId: attacker.instanceId,
        targetId: target.instanceId,
        amount: hit.dealt
      });
      return modifiers.consumeAttack === false || numberMod(modifiers, 'consumeAttack') === 0 ? 'free' : 'fired';
    }

    const rapidFireCount = numberMod(modifiers, 'rapidFireCount');
    if (rapidFireCount !== undefined && rapidFireCount > 0) {
      const hits = Math.max(1, Math.floor(
        rapidFireCount
        + Math.max(0, Math.floor(numberMod(modifiers, 'rapidFireIncrease') ?? 0))
        + passiveCount(definition, attacker.classLevel, 'rapidFireIncrease')
      ));
      const damage = resolveSkillDamage(definition, modifiers, attacker.pips, definition.attack);
      let totalDamage = 0;
      for (let shot = 0; shot < hits; shot += 1) {
        const victim = pickRandom(
          boardDice(state, otherOwner(attacker.ownerId)).filter((die) => !die.isDestroyed),
          random
        );
        if (!victim) break;
        const hit = dealDamage(
          state,
          definitions,
          attacker,
          victim,
          applySkillDamageModifiers(state, definitions, attacker, victim, damage, modifiers),
          events,
          random
        );
        totalDamage += hit.dealt;
      }
      addEvent(events, 'skill', `${definition.title} fires ${hits} shots for ${totalDamage} total damage.`, {
        ownerId: attacker.ownerId,
        sourceId: attacker.instanceId,
        amount: totalDamage
      });
      return modifiers.consumeAttack === false || numberMod(modifiers, 'consumeAttack') === 0 ? 'free' : 'fired';
    }

    const hasPierce = hasPierceEffect(modifiers);
    const pierceDamage = Math.max(1, Math.floor(numberMod(modifiers, 'pierceBehindDamage') ?? definition.attack));
    if (hasPierce && target) {
      const mainDamage = hasSkillDamage(modifiers)
        ? resolveSkillDamage(definition, modifiers, attacker.pips, definition.attack)
        : definition.attack;
      dealDamage(state, definitions, attacker, target, applySkillDamageModifiers(state, definitions, attacker, target, mainDamage, modifiers), events, random);
      if (!target.isDestroyed) {
        const pierceRange = Math.max(1, Math.floor(numberMod(modifiers, 'pierceBehindRange') ?? 1));
        for (const victim of pierceBehindTargets(state, definitions, attacker, target, pierceRange)) {
          dealDamage(
            state,
            definitions,
            attacker,
            victim,
            applySkillDamageModifiers(state, definitions, attacker, victim, pierceDamage, modifiers),
            events,
            random,
            { allowCritical: false }
          );
        }
      }
    }
    if (hasSkillDamage(modifiers) && !hasPierce) {
      const baseDamage = resolveSkillDamage(definition, modifiers, attacker.pips, definition.attack);
      const victims = booleanMod(modifiers, 'hitsAllFoes')
        ? boardDice(state, otherOwner(attacker.ownerId))
        : booleanMod(modifiers, 'hitsAllAllies')
        ? boardDice(state, attacker.ownerId)
        : target ? [target] : [];
      for (const victim of victims) {
        dealDamage(
          state,
          definitions,
          attacker,
          victim,
          applySkillDamageModifiers(state, definitions, attacker, victim, baseDamage, modifiers),
          events,
          random
        );
      }
    }

    const skillHealing = numberMod(modifiers, 'skillHealing');
    if (skillHealing !== undefined) {
      const ally = target && target.ownerId === attacker.ownerId
        ? target
        : selectTarget(state, definitions, attacker, 'Weakest', true, true, random) ?? attacker;
      heal(state, definitions, attacker, ally, Math.max(1, Math.ceil(skillHealing)), events, random);
    }

    const shield = numberMod(modifiers, 'shield');
    if (shield !== undefined) {
      const shieldAmount = Math.max(1, Math.ceil(shield));
      attacker.shieldHp += shieldAmount;
      const shieldDuration = numberMod(modifiers, 'statusDuration');
      if (shieldDuration !== undefined && shieldDuration > 0) {
        attacker.shieldTurns = Math.max(attacker.shieldTurns, shieldDuration);
      }
      addEvent(events, 'shield', `${definition.title} gains ${shieldAmount} shield.`, {
        ownerId: attacker.ownerId,
        targetId: attacker.instanceId,
        amount: shieldAmount
      });
    }

    const splashAnchor = target ?? attacker;
    if (hasSplashEffect(modifiers)) {
      const splashDamage = pipScaledDamage(definition, modifiers, 'splashDamage', attacker.pips, definition.attack);
      const victims = boardDice(state, otherOwner(attacker.ownerId)).filter((die) => (
        die.instanceId !== target?.instanceId
        && footprintChebyshevDistance(state, definitions, splashAnchor, die) <= 1
      ));
      for (const victim of victims) dealDamage(state, definitions, attacker, victim, splashDamage, events, random, { allowCritical: false });
    }

    if (hasChainEffect(modifiers) && target) {
      const chainDamage = pipScaledDamage(definition, modifiers, 'chainDamage', attacker.pips, definition.attack);
      for (const [chainIndex, chainVictim] of chainTargetsFor(state, definitions, attacker, target, modifiers, random).entries()) {
        dealDamage(state, definitions, attacker, chainVictim, chainDamage, events, random, { allowCritical: false, chainDepth: chainIndex + 1 });
      }
    }

    if (hasHeatwaveEffect(modifiers) && target) {
      const heatwaveDamage = pipScaledDamage(definition, modifiers, 'heatwaveDamage', attacker.pips, definition.attack);
      const victims = boardDice(state, otherOwner(attacker.ownerId)).filter((die) => (
        die.instanceId !== target.instanceId
        && footprintChebyshevDistance(state, definitions, target, die) <= 1
      ));
      applyHeatwaveDamage(state, definitions, attacker, victims, heatwaveDamage, events, random);
    }

    if (hasMeteorEffect(modifiers)) {
      const meteorDamage = numberMod(modifiers, 'meteorDamage') ?? 60;
      const meteorCount = Math.max(1, Math.floor(numberMod(modifiers, 'meteorCount') ?? 1));
      const randomOrientation = booleanMod(modifiers, 'meteorRandomOrientation');
      const enemyOwner = otherOwner(attacker.ownerId);
      const enemyDice = boardDice(state, enemyOwner);
      const poolType = stringMod(modifiers, 'meteorPoolType');
      const poolDuration = numberMod(modifiers, 'meteorPoolDuration');
      const rawPoolPattern = modifiers.meteorPoolPattern;
      const poolPattern: Array<[number, number]> = Array.isArray(rawPoolPattern)
        ? rawPoolPattern
          .filter((entry): entry is [number, number] => Array.isArray(entry)
            && entry.length >= 2
            && typeof entry[0] === 'number'
            && typeof entry[1] === 'number')
          .map((entry) => [Math.floor(entry[0]), Math.floor(entry[1])])
        : [];

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
          dealDamage(
            state,
            definitions,
            attacker,
            victim,
            applySkillDamageModifiers(state, definitions, attacker, victim, Math.max(1, Math.floor(meteorDamage)), modifiers),
            events,
            random
          );
        }
        if (poolType) spawnPools(state, definitions, attacker, poolType, origin, poolPattern, poolDuration);
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
    const rawSkillDuration = numberMod(modifiers, 'skillDuration');
    const skillDuration = rawSkillDuration !== undefined && rawSkillDuration > 0
      ? Math.max(1, Math.floor(rawSkillDuration))
      : 0;
    const projectileCount = numberMod(modifiers, 'projectileCountIncrease');
    if (projectileCount !== undefined && projectileCount > 0 && skillDuration > 0) {
      attacker.mana['projectileBonus'] = (attacker.mana['projectileBonus'] ?? 0) + projectileCount;
      attacker.mana['projectileBonusTurns'] = Math.max(attacker.mana['projectileBonusTurns'] ?? 0, skillDuration);
    }
    const attackCount = numberMod(modifiers, 'attackCountIncrease');
    if (attackCount !== undefined && attackCount > 0 && skillDuration > 0) {
      attacker.attacksRemaining += attackCount;
      attacker.hasFinishedAttacking = attacker.attacksRemaining === 0;
      attacker.mana['extraAttacks'] = (attacker.mana['extraAttacks'] ?? 0) + attackCount;
      attacker.mana['extraAttackTurns'] = Math.max(attacker.mana['extraAttackTurns'] ?? 0, skillDuration);
    }
    if (booleanMod(modifiers, 'disableManaGain') && skillDuration > 0) {
      attacker.mana['manaPausedTurns'] = Math.max(attacker.mana['manaPausedTurns'] ?? 0, skillDuration);
    }
    if (booleanMod(modifiers, 'transformToNextForm')) {
      transformDie(state, definitions, attacker, events, random);
    }
    const activeGrantMode = stringMod(modifiers, 'activeSkillTargeting') ?? grantMode(modifiers);
    const allyGrant = attackGrantAmount(modifiers, 'grantAttacksToAlly', true);
    if (allyGrant > 0) grantAttacks(state, definitions, attacker, allyGrant, true, events, random, activeGrantMode);
    const foeGrant = attackGrantAmount(modifiers, 'grantAttacksToFoe', true);
    if (foeGrant > 0) grantAttacks(state, definitions, attacker, foeGrant, false, events, random, activeGrantMode);
    return modifiers.consumeAttack === false || numberMod(modifiers, 'consumeAttack') === 0 ? 'free' : 'fired';
  }
  return 'none';
}

function expireTransform(state: CombatState, definitions: Map<string, DiceDefinition>, die: CombatDie): void {
  delete die.transformTurns;
  if (die.transformIndex === undefined) return;
  die.transformIndex = undefined;
  const base = getDefinition(state, definitions, die);
  die.maxHealth = Math.max(1, base.health);
  die.currentHealth = Math.min(die.currentHealth, die.maxHealth);
}

function transformDie(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  die: CombatDie,
  events: CombatEvent[],
  random: RandomSource
): void {
  const definition = getDefinition(state, definitions, die);
  const nextIndex = (die.transformIndex ?? -1) + 1;
  const stats = definition.transformStats?.[nextIndex];
  if (!stats) return;
  die.transformIndex = nextIndex;
  if (stats.transformDuration !== undefined && Number.isFinite(stats.transformDuration) && stats.transformDuration >= 0) {
    die.transformTurns = Math.floor(stats.transformDuration);
  } else {
    delete die.transformTurns;
  }
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
  const transformedTarget = selectNearestFoeIgnoringRange(state, definitions, die);
  if (transformedTarget && hasSkillDamage(modifiers)) {
    moveBesideTarget(state, definitions, die, transformedTarget);
  }
  statusApplication(state, definitions, die, die, modifiers, events, die.pips);
  applyGenericSkillEffect(state, definitions, die, transformedTarget, modifiers, events, random, {
    healingTarget: die,
    historyStyle: 'onTransformed',
    transformOrdinal: (die.transformIndex ?? 0) + 1
  });
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
    const target = [...foes].sort((a, b) => {
      const columnPriority = infiltrator.ownerId === 'player'
        ? (b.gridPosition?.col ?? 0) - (a.gridPosition?.col ?? 0)
        : (a.gridPosition?.col ?? 0) - (b.gridPosition?.col ?? 0);
      return columnPriority
        || distanceBetween(infiltrator, b, definitions, state) - distanceBetween(infiltrator, a, definitions, state)
        || a.instanceId.localeCompare(b.instanceId);
    })[0];
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
  const footprint = footprintFor(definition);
  const candidates: Array<{ position: BattlePosition; distance: number; rowOffset: number; colOffset: number }> = [];
  for (let row = 0; row <= GRID_SIZE - footprint; row += 1) {
    for (let col = 0; col <= GRID_SIZE - footprint; col += 1) {
      const position = { row, col };
      if (!canPlace(attacker, definition, position, occupied)) continue;
      const rowOffset = Math.abs(row - target.gridPosition.row);
      const colOffset = Math.abs(col - target.gridPosition.col);
      candidates.push({ position, distance: rowOffset + colOffset, rowOffset, colOffset });
    }
  }
  const chosen = candidates.sort((a, b) => (
    a.distance - b.distance
    || a.rowOffset - b.rowOffset
    || a.colOffset - b.colOffset
    || a.position.row - b.position.row
    || a.position.col - b.position.col
  ))[0]?.position;
  if (!chosen) return false;
  attacker.gridPosition = chosen;
  if (boardSideOf(target) === attacker.ownerId) delete attacker.mana['infiltrated'];
  else attacker.mana['infiltrated'] = 1;
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
  const hits = Math.max(1, 1 + Math.floor(numberMod(trigger.fireSkill.modifiers, 'attackCount') ?? 0));
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
  random: RandomSource,
  options: { strikeFirst?: boolean } = {}
): void {
  const definition = effectiveDefinition(state, definitions, attacker);
  const modifiers = triggerModifiers(definition, 'Passive', attacker.classLevel);
  const projectiles = Math.max(1, 1 + (attacker.mana['projectileBonus'] ?? 0) + passiveCount(definition, attacker.classLevel, 'projectileCount') + passiveCount(definition, attacker.classLevel, 'rapidFireIncrease'));
  if (hasUnlockedBooleanModifier(definition, 'healOnAttack', attacker.classLevel)) {
    const eventIndex = events.length;
    let healedTotal = 0;
    let hits = 0;
    for (let projectile = 0; projectile < projectiles; projectile += 1) {
      const healTarget = selectHealTarget(state, definitions, attacker) ?? target;
      const healed = heal(state, definitions, attacker, healTarget, definition.attack, events, random);
      if (healed <= 0) break;
      healedTotal += healed;
      hits += 1;
      applyRicochet(state, definitions, attacker, healTarget, modifiers, true, definition.attack, events, random);
    }
    if (healedTotal > 0 && !attacker.isDestroyed) addMana(attacker, definition);
    insertEvent(events, eventIndex, 'attack', `${definition.title} heals ${effectiveDefinition(state, definitions, target).title}${hits > 1 ? ` ${hits} times` : ''} for ${healedTotal} health.`, {
      ownerId: attacker.ownerId,
      sourceId: attacker.instanceId,
      targetId: target.instanceId,
      amount: healedTotal
    });
    return;
  }
  if (maybeApplyAvoid(state, definitions, target, events, random, attacker)) return;
  const boosted = attacker.boostedAttacks > 0;
  if (boosted) attacker.boostedAttacks -= 1;
  const boostMultiplier = boosted ? Math.max(2, attacker.mana['boostedAttackMultiplier'] ?? 2) : 1;
  let dealt = 0;
  let absorbed = 0;
  const evenPip = attacker.pips % 2 === 0;
  const pipDamageRate = numberMod(modifiers, evenPip ? 'evenPipDamageRate' : 'oddPipDamageRate') ?? 0;
  const pipSiphonRate = numberMod(modifiers, evenPip ? 'evenPipSiphonRate' : 'oddPipSiphonRate') ?? 0;
  const eventIndex = events.length;
  for (let projectile = 0; projectile < projectiles && !target.isDestroyed; projectile += 1) {
    const base = definition.attack
      + targetCurrentHealthBonus(state, definitions, attacker, target)
      + statusBonusDamage(state, definitions, attacker, definition.attack)
      + (attacker.mana['killDamageBonus'] ?? 0);
    const scaled = Math.max(1, Math.floor(base * damageMultiplier(state, definitions, attacker, target) * boostMultiplier * (1 + Math.max(0, pipDamageRate))));
    const hit = dealDamage(state, definitions, attacker, target, scaled, events, random);
    dealt += hit.dealt;
    absorbed += hit.absorbed;
    if (pipSiphonRate > 0 && hit.dealt > 0 && !attacker.isDestroyed) {
      heal(state, definitions, attacker, attacker, Math.floor(hit.dealt * pipSiphonRate), events, random);
    }
    if (!target.isDestroyed) applyPassiveOnHit(state, definitions, attacker, target, events, random);
    if (target.isDestroyed) break;
  }
  if (dealt > 0 && !attacker.isDestroyed) {
    addMana(attacker, definition);
    applyRicochet(state, definitions, attacker, target, modifiers, false, definition.attack, events, random);
  }
  const shieldFeedback = absorbed > 0 ? ` (shield absorbed ${absorbed} damage)` : '';
  insertEvent(events, eventIndex, 'attack', `${definition.title} ${options.strikeFirst ? 'strikes' : 'attacks'} ${effectiveDefinition(state, definitions, target).title}${options.strikeFirst ? ' first' : ''}${projectiles > 1 ? ` ${projectiles} times` : ''} for ${dealt} damage${shieldFeedback}${boosted ? ' with a boosted strike' : ''}.`, {
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
  for (const die of state.dice) {
    if (die.shieldHp <= 0) die.shieldTurns = 0;
    else if (die.shieldTurns <= 0) die.shieldHp = 0;
  }
  const auras = new Map<OwnerId, Array<{
    sourceId: string;
    extraAttacks: number;
    foeExtraAttacks: number;
    radius?: number;
    sourcePosition?: BattlePosition;
    sourceFootprint?: number;
  }>>([
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
        const radiusValue = numberMod(startModifiers, 'allyExtraAttacksRadius');
        auras.get(die.ownerId)?.push({
          sourceId: die.instanceId,
          extraAttacks: allyExtra,
          foeExtraAttacks: foeExtra,
          radius: radiusValue === undefined ? undefined : Math.max(0, Math.floor(radiusValue)),
          sourcePosition: die.gridPosition ? { ...die.gridPosition } : undefined,
          sourceFootprint: footprintFor(definition)
        });
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
      if (aura.sourceId === die.instanceId) continue;
      const inRange = aura.radius === undefined
        || (aura.sourcePosition !== undefined
          && die.gridPosition !== undefined
          && isWithinFootprintRadius(
            aura.sourcePosition,
            aura.sourceFootprint ?? 1,
            die.gridPosition,
            footprintFor(definition),
            aura.radius
          ));
      if (inRange) die.attacksRemaining += aura.extraAttacks;
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
    die.attacksRemaining += die.mana['extraAttacks'] ?? 0;
    die.attacksRemaining += passiveCount(definition, die.classLevel, 'attackCount');
    die.attacksRemaining = Math.max(0, die.attacksRemaining);
    die.boostedAttacks = Math.max(0, Math.floor(maxModifier(definition, 'numAttacksBoosted')));
    const boostMultiplier = firstNumberModifier(definition, 'numAttacksDamageMult');
    if (boostMultiplier !== undefined && boostMultiplier > 1) die.mana['boostedAttackMultiplier'] = boostMultiplier;

    maybeTransformFromPip(state, definitions, die, events, random);

    const modifiers = triggerModifiers(definition, 'CombatStart', die.classLevel);
    if (modifiers) {
      const target = selectTarget(state, definitions, die, definition.targetingMode, false, false, random);
      statusApplication(state, definitions, die, target ?? die, modifiers, events, die.pips);
      applyGenericSkillEffect(state, definitions, die, target, modifiers, events, random, {
        healingTarget: die,
        historyStyle: 'combatStart'
      });
      if (target) {
        if (hasSplashEffect(modifiers)) {
          const splashDamage = pipScaledDamage(definition, modifiers, 'splashDamage', die.pips, definition.attack);
          const victims = boardDice(state, target.ownerId).filter((victim) => (
            victim.instanceId !== target.instanceId
            && footprintChebyshevDistance(state, definitions, target, victim) <= 1
          ));
          for (const victim of victims) dealDamage(state, definitions, die, victim, splashDamage, events, random, { allowCritical: false });
        }
        if (hasChainEffect(modifiers)) {
          const chainDamage = pipScaledDamage(definition, modifiers, 'chainDamage', die.pips, definition.attack);
          for (const [chainIndex, victim] of chainTargetsFor(state, definitions, die, target, modifiers, random).entries()) {
            dealDamage(state, definitions, die, victim, chainDamage, events, random, { allowCritical: false, chainDepth: chainIndex + 1 });
          }
        }
        if (hasHeatwaveEffect(modifiers)) {
          const heatwave = pipScaledDamage(definition, modifiers, 'heatwaveDamage', die.pips, definition.attack);
          const victims = boardDice(state, target.ownerId).filter((victim) => (
            victim.instanceId !== target.instanceId
            && footprintChebyshevDistance(state, definitions, target, victim) <= 1
          ));
          applyHeatwaveDamage(state, definitions, die, victims, heatwave, events, random);
        }
      }
      const strikeFirst = booleanMod(modifiers, 'strikeFirst');
      const infiltrationRequired = booleanMod(modifiers, 'isInfiltrator');
      if (strikeFirst && (!infiltrationRequired || die.mana['infiltrated'] === 1)) die.mana['strikeFirst'] = 1;
      const tauntRange = numberMod(modifiers, 'tauntRange');
      if (tauntRange !== undefined) {
        for (const foe of boardDice(state, otherOwner(die.ownerId))) {
          if (distanceBetween(die, foe, definitions, state) <= tauntRange) {
            foe.tauntedBySourceId = die.instanceId;
            foe.tauntTurns = Math.max(1, Math.floor(numberMod(modifiers, 'tauntDuration') ?? 1));
          }
        }
      }
      if (booleanMod(modifiers, 'hasLock')) {
        const rawLockRange = numberMod(modifiers, 'lockRange');
        const lockRange = rawLockRange === -1
          ? Number.POSITIVE_INFINITY
          : rawLockRange !== undefined && Number.isFinite(rawLockRange) && rawLockRange > 0
          ? rawLockRange
          : Math.max(1, definition.range);
        const lockSideTargeting = stringMod(modifiers, 'lockSideTargeting')
          ?? (booleanMod(modifiers, 'canLockAllies') ? 'both' : 'foes');
        const numLocks = Math.max(1, Math.floor(numberMod(modifiers, 'numLocks') ?? 1));
        const lockDuration = numberMod(modifiers, 'lockDuration');
        const unlockEffect = booleanMod(modifiers, 'lockUnlockApplyStatusEffect')
          ? stringMod(modifiers, 'statusEffect') as StatusEffect | undefined
          : undefined;
        const unlockStatus = unlockEffect
          ? {
              effect: unlockEffect,
              turns: Math.max(1, Math.floor(
                numberMod(modifiers, `${unlockEffect}Duration`)
                ?? numberMod(modifiers, 'statusDuration')
                ?? 1
              )),
              attackDelta: numberMod(modifiers, 'attackDelta')
            }
          : undefined;
        if (!booleanMod(modifiers, 'onlyLockGridTiles')) {
          const candidates = state.dice
            .filter((candidate) => candidate.zone === 'board' && !candidate.isDestroyed && candidate.gridPosition && candidate.instanceId !== die.instanceId)
            .filter((candidate) => (candidate.ownerId === die.ownerId ? lockSideTargeting !== 'foes' : lockSideTargeting !== 'allies'))
            .filter((candidate) => distanceBetween(die, candidate, definitions, state) <= lockRange)
            .slice(0, numLocks);
          for (const candidate of candidates) {
            state.lockedBy[candidate.instanceId] = die.instanceId;
            if (lockDuration !== undefined) state.lockTurns[candidate.instanceId] = Math.max(1, Math.floor(lockDuration));
            if (unlockStatus) {
              state.lockStatus = state.lockStatus ?? {};
              state.lockStatus[candidate.instanceId] = unlockStatus;
            }
          }
        }
        if (booleanMod(modifiers, 'canLockGridTiles')) {
          const targetOwner = lockSideTargeting === 'both'
            ? (random() < 0.5 ? die.ownerId : otherOwner(die.ownerId))
            : lockSideTargeting === 'allies' ? die.ownerId : otherOwner(die.ownerId);
          const duration = Math.max(1, Math.floor(
            numberMod(modifiers, 'gridLockDuration') ?? numberMod(modifiers, 'lockDuration') ?? 1
          ));
          const locks = state.gridLocks[targetOwner];
          const available: BattlePosition[] = [];
          for (let row = 0; row < GRID_SIZE; row += 1) {
            for (let col = 0; col < GRID_SIZE; col += 1) {
              if ((locks[`${row}:${col}`] ?? 0) <= 0) available.push({ row, col });
            }
          }
          for (let index = 0; index < numLocks && available.length > 0; index += 1) {
            const pick = Math.floor(random() * available.length);
            const [tile] = available.splice(pick, 1);
            if (tile) locks[`${tile.row}:${tile.col}`] = duration;
          }
        }
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
      if ((state.lockTurns[die.instanceId] ?? 0) > 0) return false;
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
  const pendingHandStatuses: Array<{ source: CombatDie; modifiers: SkillModifiers }> = [];
  for (const die of state.dice) {
    if (die.isDestroyed) continue;
    const poisonStacks = statusStacks(die, 'poison');
    if (poisonStacks > 0) {
      const stacks = activePoisonStacks(die);
      const amount = stacks.reduce((total, stack) => total + stack.damage, 0);
      const first = stacks[0];
      const liveSource = first?.sourceId
        ? state.dice.find((candidate) => candidate.instanceId === first.sourceId && !candidate.isDestroyed)
        : undefined;
      const sourceProxy: CombatDie = liveSource ?? {
        ...die,
        instanceId: first?.sourceId ?? `poison:${first?.sourceTypeId ?? die.typeId}`,
        ownerId: first?.sourceOwnerId ?? die.ownerId,
        typeId: first?.sourceTypeId ?? die.typeId
      };
      dealDamage(state, definitions, sourceProxy, die, Math.max(1, amount), events, random);
      die.poisonStacks = activePoisonStacks(die)
        .map((stack) => ({ ...stack, turns: stack.turns - 1 }))
        .filter((stack) => stack.turns > 0);
      syncPoisonStatus(die);
      if (die.isDestroyed) continue;
    }
    if (die.slowStacks?.length) {
      die.slowStacks = activeSlowStacks(die)
        .map((stack) => ({ ...stack, turns: stack.turns - 1 }))
        .filter((stack) => stack.turns > 0);
      syncSlowStatus(die);
    } else if (die.attackDeltaTurns > 0) {
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
    const extraAttackTurns = die.mana['extraAttackTurns'] ?? 0;
    if (extraAttackTurns > 0) {
      const nextTurns = extraAttackTurns - 1;
      die.mana['extraAttackTurns'] = nextTurns;
      if (nextTurns <= 0) die.mana['extraAttacks'] = 0;
    }
    const manaPausedTurns = die.mana['manaPausedTurns'] ?? 0;
    if (manaPausedTurns > 0) die.mana['manaPausedTurns'] = manaPausedTurns - 1;
    for (const effect of ['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk', 'acceleration', 'dilation', 'disorientation'] as StatusEffect[]) {
      if (effect === 'slow' || effect === 'poison') continue;
      if (!hasStatus(die, effect)) continue;
      const turns = statusTurns(die, effect) - 1;
      if (turns <= 0) clearStatus(die, effect);
      else die.mana[`status:${effect}:turns`] = turns;
    }

    const modifiers = triggerModifiers(effectiveDefinition(state, definitions, die), 'CombatEnd', die.classLevel);
    if (modifiers) {
      if (booleanMod(modifiers, 'statusToOpposingHand') && stringMod(modifiers, 'statusEffect')) {
        pendingHandStatuses.push({ source: die, modifiers });
      } else {
        statusApplication(state, definitions, die, die, modifiers, events, die.pips);
      }
      const combatEndTarget = selectTarget(state, definitions, die, effectiveDefinition(state, definitions, die).targetingMode, false, false, random);
      applyGenericSkillEffect(state, definitions, die, combatEndTarget, modifiers, events, random, {
        healingTarget: die,
        historyStyle: 'combatEnd'
      });
      const growth = growthDeltaFor(modifiers, random);
      if (growth !== undefined) {
        die.growth += growth;
        addEvent(events, 'skill', `${effectiveDefinition(state, definitions, die).title} grows permanently.`, {
          ownerId: die.ownerId,
          sourceId: die.instanceId
        });
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
    delete die.mana['infiltrated'];
  }
  for (const pending of pendingHandStatuses) {
    const targetOwner = otherOwner(pending.source.ownerId);
    const target = pickRandom(
      state.dice.filter((candidate) => candidate.ownerId === targetOwner && candidate.zone === 'hand' && !candidate.isDestroyed),
      random
    );
    if (target) statusApplication(state, definitions, pending.source, target, pending.modifiers, events, pending.source.pips);
  }
  for (const [instanceId, turns] of Object.entries(state.lockTurns ?? {})) {
    const nextTurns = turns - 1;
    if (nextTurns > 0) {
      state.lockTurns[instanceId] = nextTurns;
      continue;
    }
    delete state.lockTurns[instanceId];
    const sourceId = state.lockedBy[instanceId];
    delete state.lockedBy[instanceId];
    const unlockStatus = state.lockStatus?.[instanceId];
    if (state.lockStatus) delete state.lockStatus[instanceId];
    const target = state.dice.find((candidate) => candidate.instanceId === instanceId && !candidate.isDestroyed);
    if (!target || !unlockStatus) continue;
    const source = sourceId
      ? state.dice.find((candidate) => candidate.instanceId === sourceId && !candidate.isDestroyed)
      : undefined;
    statusApplication(state, definitions, source ?? target, target, {
      statusEffect: unlockStatus.effect,
      [`${unlockStatus.effect}Duration`]: unlockStatus.turns,
      attackDelta: unlockStatus.attackDelta
    }, events, target.pips);
  }
  for (const instanceId of Object.keys(state.lockedBy)) {
    if (!(instanceId in (state.lockTurns ?? {}))) delete state.lockedBy[instanceId];
  }
  for (const owner of ['player', 'enemy'] as OwnerId[]) {
    const locks = state.gridLocks?.[owner];
    if (!locks) continue;
    for (const [cell, turns] of Object.entries(locks)) {
      if (turns <= 1) delete locks[cell];
      else locks[cell] = turns - 1;
    }
  }
  for (const die of state.dice) {
    if (die.transformTurns === undefined) continue;
    die.transformTurns -= 1;
    if (die.transformTurns <= 0) expireTransform(state, definitions, die);
  }
  for (const pool of state.pools) pool.turns -= 1;
  state.pools = state.pools.filter((pool) => pool.turns > 0);
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
  combatRuntime.set(state, { catalog, rules });
  state.combatPhase = 'attacking';
  for (const die of state.dice) {
    if (die.zone === 'board' && !die.isDestroyed) {
      die.attacksRemaining = Math.max(1, die.pips);
      die.hasFinishedAttacking = false;
    }
  }
  startCombat(state, definitions, events, random, catalog, rules);
  applyPoolsAtCombatStart(state, definitions, events, random);

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
    const healingAttack = hasUnlockedBooleanModifier(definition, 'healOnAttack', attacker.classLevel);
    const readyActive = activeSkills(definition, attacker.classLevel).find((skill, index) => (
      (attacker.mana[activeManaKey(skill, index)] ?? 0) >= Math.max(1, skill.manaNeeded ?? 1)
    ));
    const targetMode = readyActive
      ? stringMod(readyActive.modifiers, 'activeSkillTargeting')
        ?? stringMod(readyActive.modifiers, 'skillTargeting')
        ?? definition.targetingMode
      : firstStringModifier(definition, 'skillTargeting') ?? definition.targetingMode;
    const readyActiveAlliesOnly = readyActive
      ? booleanMod(readyActive.modifiers, 'activeOnlyTargetsAllies') || booleanMod(readyActive.modifiers, 'onlyTargetsAllies')
      : false;
    const target = healingAttack
      ? selectHealTarget(state, definitions, attacker)
      : selectTarget(
        state,
        definitions,
        attacker,
        targetMode,
        readyActiveAlliesOnly,
        false,
        random
      );
    if (attacker.mana['strikeFirst'] === 1) {
      attacker.mana['strikeFirst'] = 0;
      if (target) basicAttack(state, definitions, attacker, target, events, random, { strikeFirst: true });
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
    if (hasUnlockedBooleanModifier(definition, 'hasBeam', attacker.classLevel) && executeBeam(state, definitions, attacker, target, events, random)) {
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

