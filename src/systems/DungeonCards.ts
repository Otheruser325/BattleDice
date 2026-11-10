import type { DiceDefinition, DiceSkillDefinition } from '../types/game';

export const DUNGEON_CARD_RARITIES = ['Common', 'Rare', 'Epic', 'Legendary'] as const;
export type DungeonCardRarity = (typeof DUNGEON_CARD_RARITIES)[number];

export const DUNGEON_CARD_KINDS = [
  'Dice Health',
  'Dice Attack',
  'Dice Range',
  'Dice Regen',
  'Dice Mana Charge',
  'Dice Armor',
  'Dice Projectile Count',
  'Dice Attack Count',
  'Dice Body Shifter',
  'Die Revive',
  'Gunned Down',
  'Broken Beyond',
  'Card Swarm',
  'Mega Growth',
  'Acid Rain',
  'Ascendance',
  'Rampage',
  'Infinite Cycling',
  'Feel The Gale',
  "Time's Up",
  "Time's Down"
] as const;
export type DungeonCardKind = (typeof DUNGEON_CARD_KINDS)[number];

export const DUNGEON_CARD_MAX_STACKS = 3;
export const DUNGEON_CARD_BASE_KILLS = 5;
export const DUNGEON_CARD_DRAFT_SIZE = 3;
export const DUNGEON_SCOPE_MARK_COUNT = 3;
export const DUNGEON_SCOPE_GRID_TILES = 25;
export const DUNGEON_SCOPE_SHOT_CHANCE = 0.25;
export const DUNGEON_SCOPE_SHOT_MULTIPLIER = 10;
export const DUNGEON_SCOPE_KILL_DAMAGE_BONUS = 0.2;
export const DUNGEON_CARD_SWARM_MANA = 9;
export const DUNGEON_CARD_SWARM_DAMAGE_RATE = 1.5;

export const DUNGEON_SLUGFEST_SKILL: DiceSkillDefinition = {
  type: 'Active',
  title: 'Slugfest',
  description: 'Fires 8 shots onto random foes, causing 60 damage each.',
  manaNeeded: 8,
  modifiers: {
    skillDamage: 60,
    rapidFireCount: 8,
    skillTargeting: 'Random',
	skillSfx: 'dice_broken_skill'
  }
};

export const DUNGEON_MARKED_IN_SKILL: DiceSkillDefinition = {
  type: 'Passive',
  title: 'Marked In',
  description: 'Places 3 scope marks on your board even if this die is defeated or absent, as long as a Sniper is in your loadout. A Sniper on a mark has a 25% chance to fire a 10× scope shot at the strongest enemy.',
  descriptionLocked: true
};

export const DUNGEON_SCOPE_STACK_SKILL: DiceSkillDefinition = {
  type: 'OnKill',
  title: 'Scope Stack',
  description: 'Scope-shot kills add +20% ATK to the scope damage of all friendly Snipers for the rest of the match.',
  descriptionLocked: true
};

export function getDungeonCardSwarmSkills(count: number): DiceSkillDefinition[] {
  const orbitCount = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  const damagePercent = Math.round(DUNGEON_CARD_SWARM_DAMAGE_RATE * 100);
  return [
    {
      type: 'Passive',
      title: 'Poker Face',
      description: `Keeps ${orbitCount} cards orbiting this die. They strike for ${damagePercent}% of its random damage when Card Swarm is unleashed.`,
      descriptionLocked: true,
      modifiers: {
        hasCardOrbit: true,
        cardOrbitCount: orbitCount,
        cardOrbitDamageRate: DUNGEON_CARD_SWARM_DAMAGE_RATE
      }
    },
    {
      type: 'Active',
      title: 'Card Swarm',
      description: `Unleashes the orbiting cards, each causing ${damagePercent}% of this die's random damage.`,
      descriptionLocked: true,
      manaNeeded: DUNGEON_CARD_SWARM_MANA,
      modifiers: {
        unleashCardOrbit: true
      }
    }
  ];
}

export interface DungeonCard {
  key: string;
  title: string;
  rarity: DungeonCardRarity;
  kind: DungeonCardKind;
  typeId: string;
}

export interface DungeonCardState {
  cards: DungeonCard[];
  killsTowardNext: number;
  cardsPicked: number;
  pendingDraws: number;
  shufflesUsed: number;
  lastShuffleTurn: number;
  scopeMarks: number[];
  scopeStacks: number;
}

export interface DungeonCardEffects {
  healthBonusRate: number;
  attackBonusRate: number;
  rangeBonus: number;
  regenRate: number;
  manaCharge: number;
  armorReduction: number;
  projectileCount: number;
  attackCount: number;
  bodySides: number;
  extraRevives: number;
  scopeShotChance: number;
  scopeDamageMultiplier: number;
  scopeKillDamageBonus: number;
  scopeDamageBonus: number;
  cardOrbitCount: number;
  cardOrbitDamageRate: number;
  growthDeltaOverride: number;
  acidRainTurns: number;
  transformDurationBonus: number;
  rampageSplashRate: number;
  batteryAllyManaBonus: number;
  galeDurationBonus: number;
  temporalAccelerationCount: number;
  temporalDilationCount: number;
  grantedSkills: DiceSkillDefinition[];
}

export interface DungeonCardPresentation {
  title: string;
  icon: string;
  rarity: DungeonCardRarity;
  color: string;
  description: string;
  cardCount: number;
  stackLabel: string;
  unique: boolean;
  tooltip: string;
}

export interface DungeonCardRollContext {
  typeIds: string[];
  activeSkillTypeIds: string[];
}

type DungeonCardUniqueScope = 'type' | 'kind' | 'rarity';

interface DungeonCardConfig {
  title: DungeonCardKind;
  icon: string;
  rarities: readonly DungeonCardRarity[];
  values: Partial<Record<DungeonCardRarity, number>>;
  unique?: DungeonCardUniqueScope;
  draftUnique?: 'kind';
  typeFilter?: readonly string[];
  excludeTypeIds?: readonly string[];
}

const CARD_CONFIGS: Record<DungeonCardKind, DungeonCardConfig> = {
  'Dice Health': {
    title: 'Dice Health',
    icon: '❤️',
    rarities: ['Common', 'Rare', 'Epic', 'Legendary'],
    values: { Common: 0.5, Rare: 0.75, Epic: 1, Legendary: 1.5 }
  },
  'Dice Attack': {
    title: 'Dice Attack',
    icon: '⚔️',
    rarities: ['Common', 'Rare', 'Epic', 'Legendary'],
    values: { Common: 0.25, Rare: 0.5, Epic: 0.75, Legendary: 1 }
  },
  'Dice Range': {
    title: 'Dice Range',
    icon: '🎯',
    rarities: ['Epic', 'Legendary'],
    values: { Epic: 1, Legendary: 2 }
  },
  'Dice Regen': {
    title: 'Dice Regen',
    icon: '🌱',
    rarities: ['Common', 'Rare', 'Epic', 'Legendary'],
    values: { Common: 0.05, Rare: 0.1, Epic: 0.15, Legendary: 0.25 }
  },
  'Dice Mana Charge': {
    title: 'Dice Mana Charge',
    icon: '🔋',
    rarities: ['Rare', 'Epic', 'Legendary'],
    values: { Rare: 1, Epic: 2, Legendary: 3 }
  },
  'Dice Armor': {
    title: 'Dice Armor',
    icon: '🛡️',
    rarities: ['Common', 'Rare', 'Epic', 'Legendary'],
    values: { Common: 0.2, Rare: 0.3, Epic: 0.4, Legendary: 0.5 }
  },
  'Dice Projectile Count': {
    title: 'Dice Projectile Count',
    icon: '🏹',
    rarities: ['Epic', 'Legendary'],
    values: { Epic: 1, Legendary: 2 }
  },
  'Dice Attack Count': {
    title: 'Dice Attack Count',
    icon: '⚡',
    rarities: ['Common', 'Rare', 'Epic', 'Legendary'],
    values: { Common: 1, Rare: 2, Epic: 3, Legendary: 4 }
  },
  'Dice Body Shifter': {
    title: 'Dice Body Shifter',
    icon: '🎲',
    rarities: ['Rare', 'Epic', 'Legendary'],
    values: { Rare: 9, Epic: 12, Legendary: 20 },
    unique: 'type'
  },
  'Die Revive': {
    title: 'Die Revive',
    icon: '✨',
    rarities: ['Epic', 'Legendary'],
    values: { Epic: 1, Legendary: 2 },
    excludeTypeIds: ['Skull']
  },
  'Gunned Down': {
    title: 'Gunned Down',
    icon: '🔭',
    rarities: ['Legendary'],
    values: { Legendary: DUNGEON_SCOPE_MARK_COUNT },
    unique: 'kind',
    typeFilter: ['Sniper']
  },
  'Broken Beyond': {
    title: 'Broken Beyond',
    icon: '💥',
    rarities: ['Epic'],
    values: { Epic: 1 },
    unique: 'kind',
    typeFilter: ['Broken']
  },
  'Card Swarm': {
    title: 'Card Swarm',
    icon: '🃏',
    rarities: ['Common', 'Rare', 'Legendary'],
    values: { Common: 3, Rare: 4, Legendary: 6 },
    unique: 'kind',
    draftUnique: 'kind',
    typeFilter: ['Gamble']
  },
  'Mega Growth': {
    title: 'Mega Growth',
    icon: '📈',
    rarities: ['Legendary'],
    values: { Legendary: 2 },
    unique: 'kind',
    typeFilter: ['Growth', 'BrokenGrowth']
  },
  'Acid Rain': {
    title: 'Acid Rain',
    icon: '🌧️',
    rarities: ['Epic'],
    values: { Epic: 2 },
    unique: 'kind',
    typeFilter: ['Drizzle']
  },
  'Ascendance': {
    title: 'Ascendance',
    icon: '✨',
    rarities: ['Epic'],
    values: { Epic: 1 },
    unique: 'kind',
    typeFilter: ['Transcendence']
  },
  'Rampage': {
    title: 'Rampage',
    icon: '💢',
    rarities: ['Legendary'],
    values: { Legendary: 1 },
    unique: 'kind',
    typeFilter: ['Berserk']
  },
  'Infinite Cycling': {
    title: 'Infinite Cycling',
    icon: '🔋',
    rarities: ['Rare', 'Legendary'],
    values: { Rare: 1, Legendary: 2 },
    unique: 'rarity',
    typeFilter: ['Battery']
  },
  'Feel The Gale': {
    title: 'Feel The Gale',
    icon: '🌪️',
    rarities: ['Rare', 'Legendary'],
    values: { Rare: 1, Legendary: 2 },
    unique: 'kind',
    typeFilter: ['Wind']
  },
  "Time's Up": {
    title: "Time's Up",
    icon: '⏫',
    rarities: ['Epic', 'Legendary'],
    values: { Epic: 2, Legendary: 3 },
    unique: 'kind',
    typeFilter: ['Time']
  },
  "Time's Down": {
    title: "Time's Down",
    icon: '⏬',
    rarities: ['Epic', 'Legendary'],
    values: { Epic: 2, Legendary: 3 },
    unique: 'kind',
    typeFilter: ['Time']
  }
};

const DUNGEON_CARD_RARITY_COLORS: Record<DungeonCardRarity, string> = {
  Common: '#d6d9de',
  Rare: '#7ddcff',
  Epic: '#d98cff',
  Legendary: '#ffd84d'
};

const DUNGEON_CARD_UI: Record<DungeonCardKind, (value: number, typeName: string) => string> = {
  'Dice Health': (value, typeName) => `Gives ${typeName} +${Math.round(value * 100)}% bonus max HP.`,
  'Dice Attack': (value, typeName) => `Gives ${typeName} +${Math.round(value * 100)}% bonus damage.`,
  'Dice Range': (value, typeName) => `Gives ${typeName} +${value} bonus basic attack range.`,
  'Dice Regen': (value, typeName) => `Your ${typeName} rejuvenates ${Math.round(value * 100)}% of its max HP at the end of combat.`,
  'Dice Mana Charge': (value, typeName) => `Your ${typeName} gains +${value} mana charge at the start of combat.`,
  'Dice Armor': (value, typeName) => `Gives ${typeName} ${Math.round(value * 100)}% damage reduction. This stacks multiplicatively with other reduction sources.`,
  'Dice Projectile Count': (value, typeName) => `Increases the number of basic attacks your ${typeName} can shoot by +${value}.`,
  'Dice Attack Count': (value, typeName) => `Increases the maximum ammo of your ${typeName} by ${value}.`,
  'Dice Body Shifter': (value, typeName) => `Converts your ${typeName} into a D${value}.`,
  'Die Revive': (value, typeName) => `Gives ${typeName} ${value === 1 ? 'one immediate revive' : `${value} immediate revives`} when defeated.`,
  'Gunned Down': () => 'Grants Marked In (Passive) and Scope Stack (On Kill). Marked In places 3 scope marks on your board even while the Sniper is defeated or absent; a Sniper on a mark has a 25% chance to fire a 10× scope shot at the strongest enemy. Scope Stack adds +20% ATK to all friendly Snipers\' scope damage whenever one of those shots secures a kill.',
  'Broken Beyond': () => 'Gives Broken Dice the Active skill Slugfest: fires 8 shots at random foes for 60 damage each. Mana needed: 8.',
  'Card Swarm': (value) => `Gives Gamble Dice Card Swarm (Active, ${DUNGEON_CARD_SWARM_MANA} mana) and Poker Face (Passive). Poker Face gives ${value} orbiting cards; Card Swarm unleashes them for ${Math.round(DUNGEON_CARD_SWARM_DAMAGE_RATE * 100)}% of the die's random damage each.`,
  'Mega Growth': (value) => `Growth and Broken Growth Dice upgrade attack counts by ${value} instead of 1 on a successful growth roll.`,
  'Acid Rain': (value) => `Drizzle Dice's Heavy Rain also poisons every enemy it hits for ${value} turns, dealing its basic attack damage each turn.`,
  'Ascendance': (value) => `Transcendence Dice keeps The Transcendence for ${value} additional turn${value === 1 ? '' : 's'} after transforming.`,
  'Rampage': (value) => `While Blood Frenzy is active, Berserk Dice's basic attacks also deal splash damage equal to ${Math.round(value * 100)}% of the attack.`,
  'Infinite Cycling': (value) => `Battery Dice's Quick Charge grants +${value} additional mana to all allies.`,
  'Feel The Gale': (value) => `Wind Dice's Gale Tempo lasts ${value} additional turn${value === 1 ? '' : 's'}.`,
  "Time's Up": (value) => `Temporal Acceleration grants ${value} attack counts to matching allies instead of 1.`,
  "Time's Down": (value) => `Temporal Dilation removes ${value} attack counts from matching foes instead of 1.`
};

function createZeroEffects(): DungeonCardEffects {
  return {
    healthBonusRate: 0,
    attackBonusRate: 0,
    rangeBonus: 0,
    regenRate: 0,
    manaCharge: 0,
    armorReduction: 0,
    projectileCount: 0,
    attackCount: 0,
    bodySides: 0,
    extraRevives: 0,
    scopeShotChance: 0,
    scopeDamageMultiplier: 0,
    scopeKillDamageBonus: 0,
    scopeDamageBonus: 0,
    cardOrbitCount: 0,
    cardOrbitDamageRate: 0,
    growthDeltaOverride: 0,
    acidRainTurns: 0,
    transformDurationBonus: 0,
    rampageSplashRate: 0,
    batteryAllyManaBonus: 0,
    galeDurationBonus: 0,
    temporalAccelerationCount: 0,
    temporalDilationCount: 0,
    grantedSkills: []
  };
}

export function createDungeonCardState(): DungeonCardState {
  return {
    cards: [],
    killsTowardNext: 0,
    cardsPicked: 0,
    pendingDraws: 0,
    shufflesUsed: 0,
    lastShuffleTurn: 0,
    scopeMarks: [],
    scopeStacks: 0
  };
}

export function getDungeonCardRarityRoll(rng: () => number): DungeonCardRarity {
  const roll = Math.min(0.999999, Math.max(0, Number(rng()) || 0));
  if (roll < 0.55) return 'Common';
  if (roll < 0.85) return 'Rare';
  if (roll < 0.975) return 'Epic';
  return 'Legendary';
}

export function getDungeonCardKillsRequired(state: DungeonCardState): number {
  return DUNGEON_CARD_BASE_KILLS + Math.floor(Math.max(0, state.cardsPicked) / DUNGEON_CARD_BASE_KILLS);
}

export function getDungeonCardShuffleCost(state: DungeonCardState): number {
  const shufflesUsed = Math.max(0, Math.floor(state.shufflesUsed));
  if (shufflesUsed === 0) return 0;
  return 10 + (shufflesUsed - 1) * 5;
}

export function canShuffleDungeonCards(state: DungeonCardState, turn: number): boolean {
  return Math.max(0, Math.floor(state.lastShuffleTurn)) !== Math.max(0, Math.floor(Number(turn) || 0));
}

export function getDungeonCardKey(kind: DungeonCardKind, rarity: DungeonCardRarity, typeId: string): string {
  return `${kind}:${rarity}:${typeId}`;
}

export function createDungeonCard(kind: DungeonCardKind, rarity: DungeonCardRarity, typeId: string): DungeonCard {
  return {
    key: getDungeonCardKey(kind, rarity, typeId),
    title: CARD_CONFIGS[kind].title,
    rarity,
    kind,
    typeId
  };
}

export function getDungeonCardIcon(kind: DungeonCardKind): string {
  return CARD_CONFIGS[kind].icon;
}

export function getDungeonCardRarityColor(rarity: DungeonCardRarity): string {
  return DUNGEON_CARD_RARITY_COLORS[rarity];
}

export function getDungeonCardRarities(kind: DungeonCardKind): readonly DungeonCardRarity[] {
  return CARD_CONFIGS[kind].rarities;
}

export function getDungeonCardValue(kind: DungeonCardKind, rarity: DungeonCardRarity): number {
  return CARD_CONFIGS[kind].values[rarity] ?? 0;
}

export function getDungeonCardMaxStacks(card: DungeonCard): number {
  return CARD_CONFIGS[card.kind].unique ? 1 : DUNGEON_CARD_MAX_STACKS;
}

function getCardStackKey(card: DungeonCard): string {
  return `${card.kind}:${card.rarity}:${card.typeId}`;
}

export function getDungeonCardStackCount(state: DungeonCardState, card: DungeonCard): number {
  const stackKey = getCardStackKey(card);
  return state.cards.filter((owned) => getCardStackKey(owned) === stackKey).length;
}

export function canAddDungeonCard(state: DungeonCardState, card: DungeonCard): boolean {
  if (!card.typeId || !DUNGEON_CARD_KINDS.includes(card.kind)) return false;
  const config = CARD_CONFIGS[card.kind];
  if (!config.rarities.includes(card.rarity)) return false;
  if (config.typeFilter && !config.typeFilter.includes(card.typeId)) return false;
  if (config.excludeTypeIds?.includes(card.typeId)) return false;
  if (getDungeonCardStackCount(state, card) >= getDungeonCardMaxStacks(card)) return false;
  if (config.unique === 'type') {
    return !state.cards.some((owned) => owned.kind === card.kind && owned.typeId === card.typeId);
  }
  if (config.unique === 'kind') {
    return !state.cards.some((owned) => owned.kind === card.kind);
  }
  if (config.unique === 'rarity') {
    return !state.cards.some((owned) => owned.kind === card.kind && owned.rarity === card.rarity && owned.typeId === card.typeId);
  }
  return true;
}

export function registerDungeonCardKills(state: DungeonCardState, kills: number): DungeonCardState {
  const count = Number.isFinite(kills) ? Math.max(0, Math.floor(kills)) : 0;
  if (count === 0) return state;
  let killsTowardNext = Math.max(0, Math.floor(state.killsTowardNext)) + count;
  let pendingDraws = Math.max(0, Math.floor(state.pendingDraws));
  const required = getDungeonCardKillsRequired(state);
  while (killsTowardNext >= required) {
    killsTowardNext -= required;
    pendingDraws += 1;
  }
  return {
    ...state,
    killsTowardNext,
    pendingDraws
  };
}

export function pickDungeonCard(state: DungeonCardState, card: DungeonCard): DungeonCardState {
  if (!canAddDungeonCard(state, card)) return state;
  return {
    ...state,
    cards: [...state.cards, card],
    cardsPicked: Math.max(0, Math.floor(state.cardsPicked)) + 1,
    pendingDraws: Math.max(0, Math.floor(state.pendingDraws) - 1)
  };
}

export function getDungeonCardEffects(state: DungeonCardState, typeId: string): DungeonCardEffects {
  const effects = createZeroEffects();
  if (!typeId) return effects;
  return state.cards.reduce<DungeonCardEffects>((current, card) => {
    if (card.typeId !== typeId) return current;
    const value = getDungeonCardValue(card.kind, card.rarity);
    if (value <= 0) return current;
    if (card.kind === 'Dice Health') current.healthBonusRate += value;
    else if (card.kind === 'Dice Attack') current.attackBonusRate += value;
    else if (card.kind === 'Dice Range') current.rangeBonus += value;
    else if (card.kind === 'Dice Regen') current.regenRate += value;
    else if (card.kind === 'Dice Mana Charge') current.manaCharge += value;
    else if (card.kind === 'Dice Armor') current.armorReduction += value;
    else if (card.kind === 'Dice Projectile Count') current.projectileCount += value;
    else if (card.kind === 'Dice Attack Count') current.attackCount += value;
    else if (card.kind === 'Dice Body Shifter') current.bodySides = value;
    else if (card.kind === 'Die Revive' && card.typeId !== 'Skull') current.extraRevives += Math.max(0, Math.floor(value));
    else if (card.kind === 'Gunned Down') {
      current.scopeShotChance = DUNGEON_SCOPE_SHOT_CHANCE;
      current.scopeDamageMultiplier = DUNGEON_SCOPE_SHOT_MULTIPLIER * (1 + state.scopeStacks * DUNGEON_SCOPE_KILL_DAMAGE_BONUS);
      current.scopeKillDamageBonus = DUNGEON_SCOPE_KILL_DAMAGE_BONUS;
      current.scopeDamageBonus = state.scopeStacks * DUNGEON_SCOPE_KILL_DAMAGE_BONUS;
      [DUNGEON_MARKED_IN_SKILL, DUNGEON_SCOPE_STACK_SKILL].forEach((skill) => {
        if (!current.grantedSkills.some((granted) => granted.title === skill.title)) current.grantedSkills.push(skill);
      });
    } else if (card.kind === 'Broken Beyond') {
      if (!current.grantedSkills.some((skill) => skill.title === DUNGEON_SLUGFEST_SKILL.title)) {
        current.grantedSkills.push(DUNGEON_SLUGFEST_SKILL);
      }
    } else if (card.kind === 'Card Swarm') {
      current.cardOrbitCount = Math.max(current.cardOrbitCount, Math.max(0, Math.floor(value)));
      current.cardOrbitDamageRate = DUNGEON_CARD_SWARM_DAMAGE_RATE;
      getDungeonCardSwarmSkills(value).forEach((skill) => {
        if (!current.grantedSkills.some((granted) => granted.title === skill.title)) current.grantedSkills.push(skill);
      });
    } else if (card.kind === 'Mega Growth') {
      current.growthDeltaOverride = Math.max(current.growthDeltaOverride, Math.max(0, Math.floor(value)));
    } else if (card.kind === 'Acid Rain') {
      current.acidRainTurns = Math.max(current.acidRainTurns, Math.max(0, Math.floor(value)));
    } else if (card.kind === 'Ascendance') {
      current.transformDurationBonus = Math.max(current.transformDurationBonus, Math.max(0, Math.floor(value)));
    } else if (card.kind === 'Rampage') {
      current.rampageSplashRate = Math.max(current.rampageSplashRate, Math.max(0, value));
    } else if (card.kind === 'Infinite Cycling') current.batteryAllyManaBonus += Math.max(0, Math.floor(value));
    else if (card.kind === 'Feel The Gale') current.galeDurationBonus += Math.max(0, Math.floor(value));
    else if (card.kind === "Time's Up") current.temporalAccelerationCount = Math.max(current.temporalAccelerationCount, Math.max(0, Math.floor(value)));
    else if (card.kind === "Time's Down") current.temporalDilationCount = Math.max(current.temporalDilationCount, Math.max(0, Math.floor(value)));
    return current;
  }, effects);
}

export function getDungeonScopeMarkCount(state: DungeonCardState): number {
  const card = state.cards.find((owned) => owned.kind === 'Gunned Down');
  return card ? Math.max(0, Math.floor(getDungeonCardValue(card.kind, card.rarity))) : 0;
}

export function drawDungeonScopeMarks(count: number, rng: () => number = Math.random): number[] {
  const target = Math.min(DUNGEON_SCOPE_GRID_TILES, Math.max(0, Math.floor(count)));
  const pool = Array.from({ length: DUNGEON_SCOPE_GRID_TILES }, (_, index) => index);
  for (let index = pool.length - 1; index > 0; index--) {
    const roll = Math.max(0, Math.min(0.999999, Number(rng()) || 0));
    const swapIndex = Math.floor(roll * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex]!, pool[index]!];
  }
  return pool.slice(0, target);
}

export function ensureDungeonScopeMarks(state: DungeonCardState, rng: () => number = Math.random): DungeonCardState {
  const target = getDungeonScopeMarkCount(state);
  if (target === 0) return state.scopeMarks.length > 0 ? { ...state, scopeMarks: [] } : state;
  if (state.scopeMarks.length === target) return state;
  return { ...state, scopeMarks: drawDungeonScopeMarks(target, rng) };
}

// Card attack is deliberately kept out of the definition: it is one outgoing-damage multiplier resolved at
// damage time, so persisted per-instance definitions (revives, souls, carryover) cannot apply it twice.
export function applyDungeonCardStats(definition: DiceDefinition, effects: DungeonCardEffects): DiceDefinition {
  if (effects.healthBonusRate <= 0 && effects.rangeBonus <= 0 && effects.grantedSkills.length === 0) return definition;
  const grantedTitles = new Set(effects.grantedSkills.map((skill) => `${skill.type}:${skill.title}`));
  const skills = effects.grantedSkills.length > 0
    ? [
      ...definition.skills.filter((skill) => !grantedTitles.has(`${skill.type}:${skill.title}`)),
      ...effects.grantedSkills
    ]
    : definition.skills;
  return {
    ...definition,
    health: Math.max(1, Math.round(definition.health * (1 + effects.healthBonusRate))),
    range: Math.max(0, definition.range + effects.rangeBonus),
    skills
  };
}

export function removeDungeonCardHealth(definition: DiceDefinition, effects: DungeonCardEffects): DiceDefinition {
  const rate = Math.max(0, effects.healthBonusRate);
  if (rate <= 0) return definition;
  return { ...definition, health: Math.max(1, Math.floor(definition.health / (1 + rate))) };
}

export function resolveDungeonCardHealthAdjustment(input: {
  maxHealth: number;
  currentHealth: number;
  isDestroyed: boolean;
  uncardedHealth: number;
  previousRate: number;
  nextRate: number;
}): { maxHealth: number; currentHealth: number } {
  const previousRate = Math.max(0, Number.isFinite(input.previousRate) ? input.previousRate : 0);
  const nextRate = Math.max(previousRate, Number.isFinite(input.nextRate) ? input.nextRate : previousRate);
  const storedMaxHealth = Number.isFinite(input.maxHealth) ? Math.max(1, input.maxHealth) : 1;
  const currentMaxHealth = Math.max(
    1,
    storedMaxHealth,
    Math.max(1, Math.round((Number.isFinite(input.uncardedHealth) ? input.uncardedHealth : 1) * (1 + previousRate)))
  );
  const storedCurrentHealth = Number.isFinite(input.currentHealth) ? Math.max(0, input.currentHealth) : currentMaxHealth;
  const normalizedCurrentHealth = input.isDestroyed
    ? 0
    : Math.min(currentMaxHealth, storedCurrentHealth + Math.max(0, currentMaxHealth - storedMaxHealth));
  const baseMaxHealth = previousRate > 0 ? currentMaxHealth / (1 + previousRate) : currentMaxHealth;
  const nextMaxHealth = Math.max(currentMaxHealth, Math.max(1, Math.round(baseMaxHealth * (1 + nextRate))));
  const gainedMaxHealth = Math.max(0, nextMaxHealth - currentMaxHealth);
  return {
    maxHealth: nextMaxHealth,
    currentHealth: input.isDestroyed ? 0 : Math.min(nextMaxHealth, normalizedCurrentHealth + gainedMaxHealth)
  };
}

export function getDungeonCardDamageMultiplier(effects: DungeonCardEffects | undefined): number {
  return 1 + Math.max(0, effects?.attackBonusRate ?? 0);
}

// Carryover saves store card-scaled health but uncarded attack. Older saves can have both values at an
// already-scaled or collapsed level, so restore normalizes against the current form's base definition.
export function resolveDungeonCarryoverHealth(input: {
  savedMaxHealth: number;
  savedCurrentHealth: number;
  isDestroyed: boolean;
  expectedUncardedHealth: number;
  healthBonusRate: number;
}): { maxHealth: number; currentHealth: number } {
  const rate = Math.max(0, Number.isFinite(input.healthBonusRate) ? input.healthBonusRate : 0);
  const expectedBase = Math.max(1, Number.isFinite(input.expectedUncardedHealth) ? input.expectedUncardedHealth : 1);
  const expectedMax = Math.max(1, Math.round(expectedBase * (1 + rate)));
  const hasSavedMax = Number.isFinite(input.savedMaxHealth) && input.savedMaxHealth > 0;
  const savedMax = hasSavedMax ? Math.max(1, input.savedMaxHealth) : expectedMax;
  const maxHealth = Math.max(savedMax, expectedMax);
  if (input.isDestroyed) return { maxHealth, currentHealth: 0 };
  if (!hasSavedMax) return { maxHealth, currentHealth: maxHealth };
  const savedCurrent = Number.isFinite(input.savedCurrentHealth) ? Math.max(0, input.savedCurrentHealth) : savedMax;
  const ratio = Math.min(1, savedCurrent / savedMax);
  return {
    maxHealth,
    currentHealth: savedMax < expectedMax
      ? Math.max(0, Math.round(maxHealth * ratio))
      : Math.min(maxHealth, savedCurrent)
  };
}

export function resolveDungeonCarryoverAttack(input: {
  savedAttack: number | undefined;
  expectedUncardedAttack: number;
  attackBonusRate: number;
}): number | undefined {
  if (typeof input.savedAttack !== 'number' || !Number.isFinite(input.savedAttack) || input.savedAttack <= 0) return undefined;
  const savedAttack = Math.max(1, Math.floor(input.savedAttack));
  const rate = Math.max(0, Number.isFinite(input.attackBonusRate) ? input.attackBonusRate : 0);
  const expected = Math.max(1, Number.isFinite(input.expectedUncardedAttack) ? Math.round(input.expectedUncardedAttack) : 1);
  if (rate <= 0 || expected <= 0) return savedAttack;
  const expectedCarded = Math.max(1, Math.round(expected * (1 + rate)));
  const tolerance = Math.max(2, Math.round(expected * 0.02));
  if (savedAttack > expected + tolerance && Math.abs(savedAttack - expectedCarded) <= tolerance) {
    return Math.max(1, Math.round(savedAttack / (1 + rate)));
  }
  return savedAttack;
}

export function getDungeonCardDescription(card: DungeonCard, typeName: string): string {
  return DUNGEON_CARD_UI[card.kind](getDungeonCardValue(card.kind, card.rarity), typeName);
}

export function getDungeonCardPresentation(card: DungeonCard, typeName: string, count = 0): DungeonCardPresentation {
  const maxStacks = getDungeonCardMaxStacks(card);
  const unique = maxStacks === 1;
  const owned = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const description = getDungeonCardDescription(card, typeName);
  const cardCountLabel = `${owned} CARD${owned === 1 ? '' : 'S'}`;
  return {
    title: card.title,
    icon: getDungeonCardIcon(card.kind),
    rarity: card.rarity,
    color: getDungeonCardRarityColor(card.rarity),
    description,
    cardCount: owned,
    stackLabel: unique ? `UNIQUE • ${cardCountLabel}` : cardCountLabel,
    unique,
    tooltip: `${card.title} (${card.rarity})${unique ? ' • UNIQUE' : ''} • ${cardCountLabel}\n${typeName}\n${description}`
  };
}

export function rollDungeonCardChoices(
  state: DungeonCardState,
  context: DungeonCardRollContext,
  count = DUNGEON_CARD_DRAFT_SIZE,
  rng: () => number = Math.random
): DungeonCard[] {
  const typeIds = [...new Set(context.typeIds.filter((typeId) => typeof typeId === 'string' && typeId.length > 0))];
  const activeSkillTypeIds = new Set(context.activeSkillTypeIds);
  if (typeIds.length === 0) return [];
  const allCards = DUNGEON_CARD_KINDS.flatMap((kind) =>
    CARD_CONFIGS[kind].rarities.flatMap((rarity) =>
      typeIds
        .filter((typeId) => kind !== 'Dice Mana Charge' || activeSkillTypeIds.has(typeId))
        .map((typeId) => createDungeonCard(kind, rarity, typeId))
    )
  );
  let available = allCards.filter((card) => canAddDungeonCard(state, card));
  if (available.length === 0) return [];

  const picked: DungeonCard[] = [];
  const usedKeys = new Set<string>();
  const targetCount = Math.max(0, Math.floor(count));
  while (picked.length < targetCount) {
    let pool = available.filter((card) => !usedKeys.has(getCardStackKey(card)));
    if (pool.length === 0) break;
    const rarity = getDungeonCardRarityRoll(rng);
    const rarityPool = pool.filter((card) => card.rarity === rarity);
    if (rarityPool.length > 0) pool = rarityPool;
    const index = Math.min(pool.length - 1, Math.floor(Math.max(0, Math.min(0.999999, Number(rng()) || 0)) * pool.length));
    const card = pool[index]!;
    usedKeys.add(getCardStackKey(card));
    picked.push(card);
    if (CARD_CONFIGS[card.kind].draftUnique === 'kind') {
      available = available.filter((candidate) => candidate.kind !== card.kind);
    }
  }
  return picked;
}

function normalizeScopeMarks(value: unknown, enabled: boolean): number[] {
  if (!enabled || !Array.isArray(value)) return [];
  const marks = value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry < DUNGEON_SCOPE_GRID_TILES);
  return [...new Set(marks)].slice(0, DUNGEON_SCOPE_MARK_COUNT);
}

export function normalizeDungeonCardState(value: unknown): DungeonCardState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createDungeonCardState();
  const raw = value as Partial<DungeonCardState>;
  let state = createDungeonCardState();
  if (Array.isArray(raw.cards)) {
    for (const entry of raw.cards) {
      if (!entry || typeof entry !== 'object') continue;
      const candidate = entry as Partial<DungeonCard>;
      if (typeof candidate.kind !== 'string' || !DUNGEON_CARD_KINDS.includes(candidate.kind as DungeonCardKind)) continue;
      if (typeof candidate.rarity !== 'string' || !DUNGEON_CARD_RARITIES.includes(candidate.rarity as DungeonCardRarity)) continue;
      if (typeof candidate.typeId !== 'string' || candidate.typeId.length === 0) continue;
      const card = createDungeonCard(candidate.kind as DungeonCardKind, candidate.rarity as DungeonCardRarity, candidate.typeId);
      if (!canAddDungeonCard(state, card)) continue;
      state = { ...state, cards: [...state.cards, card] };
    }
  }
  const picked = Number(raw.cardsPicked);
  state.cardsPicked = Number.isFinite(picked) ? Math.max(state.cards.length, Math.floor(picked)) : state.cards.length;
  const required = getDungeonCardKillsRequired(state);
  const kills = Number(raw.killsTowardNext);
  state.killsTowardNext = Number.isFinite(kills) ? Math.max(0, Math.min(required - 1, Math.floor(kills))) : 0;
  const pending = Number(raw.pendingDraws);
  state.pendingDraws = Number.isFinite(pending) ? Math.max(0, Math.min(99, Math.floor(pending))) : 0;
  const shuffles = Number(raw.shufflesUsed);
  state.shufflesUsed = Number.isFinite(shuffles) ? Math.max(0, Math.floor(shuffles)) : 0;
  const shuffleTurn = Number(raw.lastShuffleTurn);
  state.lastShuffleTurn = Number.isFinite(shuffleTurn) ? Math.max(0, Math.floor(shuffleTurn)) : 0;
  const hasGunnedDown = state.cards.some((card) => card.kind === 'Gunned Down');
  state.scopeMarks = normalizeScopeMarks(raw.scopeMarks, hasGunnedDown);
  const stacks = Number(raw.scopeStacks);
  state.scopeStacks = hasGunnedDown && Number.isFinite(stacks) ? Math.max(0, Math.min(99, Math.floor(stacks))) : 0;
  return state;
}
