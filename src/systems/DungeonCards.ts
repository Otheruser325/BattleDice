import type { DiceDefinition, DiceSkillDefinition, DiceSkillModifier } from '../types/game';
import { formatPercent } from '../utils/FormatManager';
import { getClassMultiplier } from './ClassProgression';

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
  "Time's Down",
  'Triple Strike',
  'Hot Tub',
  'Holy Gifting',
  'Modified Electric',
  'Undead Fitting',
  'Soul Fest',
  "Reaper's Grace",
  'Mighty Wind',
  'Arctic Blizzard'
] as const;
export type DungeonCardKind = (typeof DUNGEON_CARD_KINDS)[number];

export const DUNGEON_CARD_MAX_STACKS = 3;
export const DUNGEON_CARD_BASE_KILLS = 5;
export const DUNGEON_CARD_DRAFT_SIZE = 3;
export const DUNGEON_CARD_UNIQUE_DRAW_INTERVAL = 10;
export const DUNGEON_SCOPE_MARK_COUNT = 3;
export const DUNGEON_SCOPE_GRID_TILES = 25;
export const DUNGEON_CARD_SWARM_MANA = 9;
export const DUNGEON_CARD_SWARM_DAMAGE_RATE = 1.5;
export const DUNGEON_IGNITION_DURATION = 3;
export const DUNGEON_IGNITION_BOSS_MULTIPLIER = 0.25;

export const DUNGEON_SLUGFEST_SKILL: DiceSkillDefinition = {
  type: 'Active',
  title: 'Slugfest',
  description: 'Fires {rapidFireCount} shots onto random foes, causing {skillDamage} damage each.',
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
  description: 'Places 3 scope marks on your board, as long as a Sniper Dice is in your loadout. A Sniper on a mark has a {scopeChance} chance to fire a {scopeDamageMult}× scope shot at the strongest foe. Scoped kills add +{scopeDamageIncreasePerStack} scope damage.',
  descriptionLocked: true,
  modifiers: {
    hasScope: true,
    scopeChance: 0.25,
    scopeDamageMult: 10,
    scopeDamageIncreasePerStack: 0.2,
    maxScopeStacks: 99
  }
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
  draftOffer?: DungeonCard[];
}

export interface DungeonCardSkillOverlay {
  title: string;
  modifiers?: DiceSkillModifier;
  manaNeededDelta?: number;
  manaNeededCap?: number;
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
  skillOverlays: DungeonCardSkillOverlay[];
  ignitionRate: number;
  undeadHealthRate: number;
  soulBonusMultiplier: number;
  reaperManaDiscount: number;
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
  bottomDeckKeys?: ReadonlySet<string>;
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
  },
  'Triple Strike': {
    title: 'Triple Strike',
    icon: '☄️',
    rarities: ['Epic'],
    values: { Epic: 3 },
    unique: 'kind',
    typeFilter: ['Meteor']
  },
  'Hot Tub': {
    title: 'Hot Tub',
    icon: '♨️',
    rarities: ['Rare'],
    values: { Rare: 0.05 },
    unique: 'kind',
    typeFilter: ['Meteor']
  },
  'Holy Gifting': {
    title: 'Holy Gifting',
    icon: '✨',
    rarities: ['Rare'],
    values: { Rare: 1 },
    unique: 'kind',
    typeFilter: ['Light']
  },
  'Modified Electric': {
    title: 'Modified Electric',
    icon: '⚡',
    rarities: ['Epic'],
    values: { Epic: 1 },
    unique: 'kind',
    typeFilter: ['Electric']
  },
  'Undead Fitting': {
    title: 'Undead Fitting',
    icon: '🧟',
    rarities: ['Common', 'Rare', 'Epic', 'Legendary'],
    values: { Common: 0.5, Rare: 0.6, Epic: 0.75, Legendary: 1 },
    unique: 'kind',
    typeFilter: ['Zombie']
  },
  'Soul Fest': {
    title: 'Soul Fest',
    icon: '🔷',
    rarities: ['Common', 'Epic'],
    values: { Common: 0.25, Epic: 0.5 },
    typeFilter: ['Soul']
  },
  "Reaper's Grace": {
    title: "Reaper's Grace",
    icon: '💀',
    rarities: ['Common', 'Rare'],
    values: { Common: 1, Rare: 2 },
    typeFilter: ['Death']
  },
  'Mighty Wind': {
    title: 'Mighty Wind',
    icon: '🌪️',
    rarities: ['Epic'],
    values: { Epic: 2 },
    unique: 'kind',
    typeFilter: ['Wind']
  },
  'Arctic Blizzard': {
    title: 'Arctic Blizzard',
    icon: '❄️',
    rarities: ['Legendary'],
    values: { Legendary: 1 },
    unique: 'kind',
    typeFilter: ['Ice']
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
  'Dice Armor': (value, typeName) => `Gives ${typeName} ${Math.round(value * 100)}% damage reduction.`,
  'Dice Projectile Count': (value, typeName) => `Adds +${value} projectile${value === 1 ? '' : 's'} to each basic attack from your ${typeName}.`,
  'Dice Attack Count': (value, typeName) => `Increases the attacks your ${typeName} can make each combat by ${value}.`,
  'Dice Body Shifter': (value, typeName) => `Converts your ${typeName}'s dice body into a D${value}, rolling pips from 1 to ${value}.`,
  'Die Revive': (value, typeName) => `Gives ${typeName} ${value === 1 ? 'one immediate revive' : `${value} immediate revives`} when defeated.`,
  'Gunned Down': () => {
    const modifiers = DUNGEON_MARKED_IN_SKILL.modifiers ?? {};
    const chance = formatPercent(modifiers.scopeChance ?? 1);
    const multiplier = modifiers.scopeDamageMult ?? 10;
    const killBonus = formatPercent(modifiers.scopeDamageIncreasePerStack ?? 0);
    return `Adds 3 scope marks on your board. Sniper Dice on this mark has a ${chance} chance of firing a powerful sniper shot that does ${multiplier}x of Sniper's basic attack damage. Foes defeated by this shot gives all friendly Sniper Dice +${killBonus} damage to their scope shot.`;
  },
  'Broken Beyond': (value, typeName) => `Gives ${typeName} the Active skill Slugfest that lets it fire 8 quick successive shots at random foes for 60 damage each. Mana needed: 8.`,
  'Card Swarm': (value, typeName) => `Gains ${value} orbiting cards that encircle ${typeName}, causing 150% of the random damage it deals.`,
  'Mega Growth': (value, typeName) => `${typeName} upgrades in attack counts by ${value} instead of the usual 1!`,
  'Acid Rain': (value, typeName) => `${typeName}'s Heavy Rain also poisons all caught enemy dice in the storm for ${value} turns equal to its basic attack damage.`,
  'Ascendance': (value) => `Transcendence Dice keeps The Transcendence for ${value} additional turn${value === 1 ? '' : 's'} after transforming.`,
  'Rampage': (value, typeName) => `While Blood Frenzy is active; ${typeName} additionally deals splash damage equal to its basic attack!`,
  'Infinite Cycling': (value) => `Battery Dice's Quick Charge grants +${value} additional mana to all allies.`,
  'Feel The Gale': (value) => `Wind Dice's Gale Tempo lasts ${value} additional turn${value === 1 ? '' : 's'}.`,
  "Time's Up": (value) => `Temporal Acceleration grants ${value} attack counts to matching allies instead of 1.`,
  "Time's Down": (value) => `Temporal Dilation removes ${value} attack counts from matching foes instead of 1.`,
  'Triple Strike': () => 'Meteor Strike strikes up to 3 times at random enemy tiles!',
  'Hot Tub': (value) => `Lava pools spawned by Meteor Strike also apply Ignition to foes sitting on them, causing ${Math.round(value * 100)}% of maximum HP damage for ${DUNGEON_IGNITION_DURATION} turns.`,
  'Holy Gifting': (value, typeName) => `${typeName} also buffs a random other ally with +${value} attack count.`,
  'Modified Electric': () => 'Chain Spark has no cap on the number of targets it can chain onto; lookup range reduced to 1 tile.',
  'Undead Fitting': (value) => `Raised Zombies spawn with ${Math.round(value * 100)}% of their current HP.`,
  'Soul Fest': (value, typeName) => `${typeName}'s Soul Harvest soul bonus is ${Math.round(value * 100)}% more effective.`,
  "Reaper's Grace": (value) => `Reaper's Touch takes ${value} less mana to charge up. Only applies in Death's alternate form.`,
  'Mighty Wind': () => 'Gale Tempo now shoots three times as many attacks instead of twice as many.',
  'Arctic Blizzard': () => 'Chill Lock coats all affected foes with arctic breeze, as if they were out of place!'
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
    grantedSkills: [],
    skillOverlays: [],
    ignitionRate: 0,
    undeadHealthRate: 0,
    soulBonusMultiplier: 1,
    reaperManaDiscount: 0
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

export function isDungeonCardUniqueDraw(state: DungeonCardState): boolean {
  const picks = Number.isFinite(state.cardsPicked) ? Math.max(0, Math.floor(state.cardsPicked)) : 0;
  return (picks + 1) % DUNGEON_CARD_UNIQUE_DRAW_INTERVAL === 0;
}

export function getDungeonCardUniqueDrawRarityRoll(rng: () => number): DungeonCardRarity {
  const roll = Math.min(0.999999, Math.max(0, Number(rng()) || 0));
  if (roll < 0.2) return 'Common';
  if (roll < 0.6) return 'Rare';
  if (roll < 0.9) return 'Epic';
  return 'Legendary';
}

export function getDungeonCardNonUniqueDrawRarityRoll(rng: () => number): DungeonCardRarity {
  const roll = Math.min(0.999999, Math.max(0, Number(rng()) || 0));
  if (roll < 0.6) return 'Rare';
  if (roll < 0.9) return 'Epic';
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

export function dungeonCardsConflict(a: DungeonCard, b: DungeonCard): boolean {
  if (a.kind !== b.kind) return false;
  const config = CARD_CONFIGS[a.kind];
  if (config.unique === 'kind') return true;
  if (config.unique === 'type') return a.typeId === b.typeId;
  if (config.unique === 'rarity') return a.rarity === b.rarity && a.typeId === b.typeId;
  return false;
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
  const resolved = state.cards.reduce<DungeonCardEffects>((current, card) => {
    if (card.typeId !== typeId) return current;
    const value = getDungeonCardValue(card.kind, card.rarity);
    if (value <= 0) return current;
    if (card.kind === 'Dice Health') current.healthBonusRate += value;
    else if (card.kind === 'Dice Attack') current.attackBonusRate += value;
    else if (card.kind === 'Dice Range') current.rangeBonus += value;
    else if (card.kind === 'Dice Regen') current.regenRate += value;
    else if (card.kind === 'Dice Mana Charge') current.manaCharge += value;
    else if (card.kind === 'Dice Armor') current.armorReduction = Number((1 - (1 - current.armorReduction) * (1 - Math.max(0, Math.min(0.95, value)))).toFixed(6)); // each equipped armor card is its own multiplicative source
    else if (card.kind === 'Dice Projectile Count') current.projectileCount += value;
    else if (card.kind === 'Dice Attack Count') current.attackCount += value;
    else if (card.kind === 'Dice Body Shifter') current.bodySides = value;
    else if (card.kind === 'Die Revive' && card.typeId !== 'Skull') current.extraRevives += Math.max(0, Math.floor(value));
    else if (card.kind === 'Gunned Down') {
      if (!current.grantedSkills.some((granted) => granted.title === DUNGEON_MARKED_IN_SKILL.title)) {
        current.grantedSkills.push(DUNGEON_MARKED_IN_SKILL);
      }
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
    else if (card.kind === 'Triple Strike') {
      const modifiers = { meteorCount: Math.max(1, Math.floor(value)), meteorRandomOrientation: true };
      current.skillOverlays.push({ title: 'Meteor Strike', modifiers, manaNeededCap: 7 });
      current.skillOverlays.push({ title: 'Triple Strike', modifiers, manaNeededCap: 7 });
    } else if (card.kind === 'Hot Tub') current.ignitionRate = Math.max(current.ignitionRate, Math.max(0, value));
    else if (card.kind === 'Holy Gifting') {
      current.skillOverlays.push({ title: 'Radiant Rally', modifiers: { grantAttacksToAlly: Math.max(0, Math.floor(value)) } });
    } else if (card.kind === 'Modified Electric') {
      current.skillOverlays.push({ title: 'Chain Spark', modifiers: { chainTargets: -1, chainRange: 1, chainDamage: 18 } });
    } else if (card.kind === 'Undead Fitting') current.undeadHealthRate = Math.max(current.undeadHealthRate, Math.max(0, value));
    else if (card.kind === 'Soul Fest') current.soulBonusMultiplier += Math.max(0, value);
    else if (card.kind === "Reaper's Grace") current.reaperManaDiscount += Math.max(0, Math.floor(value));
    else if (card.kind === 'Mighty Wind') {
      const modifiers = { projectileCountIncrease: Math.max(1, Math.floor(value)) };
      current.skillOverlays.push({ title: 'Gale Tempo', modifiers, manaNeededCap: 10 });
      current.skillOverlays.push({ title: 'Mighty Wind', modifiers, manaNeededCap: 10 });
    } else if (card.kind === 'Arctic Blizzard') {
      current.skillOverlays.push({ title: 'Chill Lock', modifiers: { hitsAllFoes: true } });
    }
    return current;
  }, effects);
  if (resolved.reaperManaDiscount > 0) {
    resolved.skillOverlays.push({
      title: "Reaper's Touch",
      manaNeededCap: Math.max(1, 12 - resolved.reaperManaDiscount)
    });
  }
  return resolved;
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

const DUNGEON_METEOR_STRIKE_DESCRIPTION = 'Throws a striking meteor at a random foe on the opposing board, causing {meteorDamage} damage in a plus pattern. Drops lava pools on the hit tile and adjacent tiles in a plus pattern for {meteorPoolDuration} turns. Foes standing in lava take {poolDefinitions[meteorPoolType].damage} damage at the start of combat.';
const DUNGEON_TRIPLE_STRIKE_DESCRIPTION = 'Throws {meteorCount} striking meteors at random tiles on the opposing board, causing {meteorDamage} damage in a plus pattern. Drops lava pools on the hit tile and adjacent tiles in a plus pattern for {meteorPoolDuration} turns. Foes standing in lava take {poolDefinitions[meteorPoolType].damage} damage at the start of combat.';

function replaceCardDescriptionSuffix(description: string, suffixPattern: RegExp, suffix: string): string {
  return `${description.replace(suffixPattern, '').trimEnd()}${suffix}`;
}

function getDungeonCardSkillDescription(skill: DiceSkillDefinition, effects: DungeonCardEffects): string | undefined {
  switch (skill.title) {
    case 'Meteor Strike':
    case 'Triple Strike': {
      const triple = skill.title === 'Triple Strike'
        || effects.skillOverlays.some((overlay) =>
          (overlay.title === 'Meteor Strike' || overlay.title === 'Triple Strike')
          && overlay.modifiers?.meteorCount !== undefined
        );
      const hotTub = effects.ignitionRate > 0;
      if (!triple && !hotTub) return undefined;
      const description = triple ? DUNGEON_TRIPLE_STRIKE_DESCRIPTION : DUNGEON_METEOR_STRIKE_DESCRIPTION;
      return hotTub
        ? `${description} Lava pools also apply Ignition: ${Math.round(effects.ignitionRate * 100)}% of maximum HP as damage at the end of each turn for ${DUNGEON_IGNITION_DURATION} turns (75% less effective against bosses).`
        : description;
    }
    case 'Radiant Rally': {
      const holyGifting = effects.skillOverlays.some((overlay) => overlay.title === 'Radiant Rally' && overlay.modifiers?.grantAttacksToAlly !== undefined);
      if (!holyGifting) return undefined;
      return 'Adds +{allyExtraAttacks} attack count to other friendly dice adjacent to it. Also grants a random other ally +{grantAttacksToAlly} attack count (resets on combat end).';
    }
    case 'Chain Spark': {
      const modified = effects.skillOverlays.some((overlay) => overlay.title === 'Chain Spark' && overlay.modifiers?.chainTargets === -1);
      if (!modified) return undefined;
      return "Attacks chain onto any number of nearby foes on the target's board within 1 tile for {chainDamage} bonus damage.";
    }
    case 'Zombie Pandemic': {
      if (effects.undeadHealthRate <= 0) return undefined;
      return `Turns a defeated enemy into an allied Zombie Die on the tile where it fell with ${Math.round(effects.undeadHealthRate * 100)}% of its maximum HP.`;
    }
    case 'Soul Harvest': {
      if (effects.soulBonusMultiplier <= 1) return undefined;
      const baseSoulBoost = skill.modifiers?.soulBoostPercent;
      if (typeof baseSoulBoost !== 'number' || !Number.isFinite(baseSoulBoost)) return undefined;
      const soulBoost = formatPercent(baseSoulBoost * effects.soulBonusMultiplier);
      return `Conjures defeated ally souls. {diceDefinitions[Soul].title} gains +${soulBoost} damage and health for each soul conjured.`;
    }
    case 'Exponential Growth':
    case 'Corrupted Growth': {
      if (effects.growthDeltaOverride <= 0) return undefined;
      return skill.description.replace('{growthDelta}', String(effects.growthDeltaOverride));
    }
    case 'Heavy Rain': {
      if (effects.acidRainTurns <= 0) return undefined;
      return replaceCardDescriptionSuffix(
        skill.description,
        / Every enemy hit is also poisoned for \d+ turns, taking this die's basic attack damage each turn\.$/,
        ` Every enemy hit is also poisoned for ${effects.acidRainTurns} turns, taking this die's basic attack damage each turn.`
      );
    }
    case 'Perpendicular Beam': {
      if (effects.transformDurationBonus <= 0) return undefined;
      return replaceCardDescriptionSuffix(
        skill.description,
        / The Transcendence lasts \d+ additional turns?\.$/,
        ` The Transcendence lasts ${effects.transformDurationBonus} additional turn${effects.transformDurationBonus === 1 ? '' : 's'}.`
      );
    }
    case 'Blood Frenzy': {
      if (effects.rampageSplashRate <= 0) return undefined;
      return replaceCardDescriptionSuffix(
        skill.description,
        / While active, its basic attacks also deal splash damage equal to \d+% of the attack\.$/,
        ` While active, its basic attacks also deal splash damage equal to ${formatPercent(effects.rampageSplashRate)} of the attack.`
      );
    }
    case 'Quick Charge': {
      if (effects.batteryAllyManaBonus <= 0) return undefined;
      return replaceCardDescriptionSuffix(
        skill.description,
        / Also grants \+\d+ additional mana to all allies\.$/,
        ` Also grants +${effects.batteryAllyManaBonus} additional mana to all allies.`
      );
    }
    case 'Temporal Acceleration': {
      if (effects.temporalAccelerationCount <= 0) return undefined;
      return `Ally dice matching this die's rolled pip count gain +${effects.temporalAccelerationCount} attack count${effects.temporalAccelerationCount === 1 ? '' : 's'} until the next turn.`;
    }
    case 'Temporal Dilation': {
      if (effects.temporalDilationCount <= 0) return undefined;
      return `Enemy dice matching this die's rolled pip count lose ${effects.temporalDilationCount} attack count${effects.temporalDilationCount === 1 ? '' : 's'} until the next turn.`;
    }
    case 'Gale Tempo': {
      const mightyWind = effects.skillOverlays.some((overlay) => overlay.title === 'Gale Tempo' && (overlay.modifiers?.projectileCountIncrease ?? 0) >= 2);
      if (!mightyWind && effects.galeDurationBonus <= 0) return undefined;
      const baseDuration = typeof skill.modifiers?.skillDuration === 'number' && Number.isFinite(skill.modifiers.skillDuration)
        ? Math.max(1, Math.floor(skill.modifiers.skillDuration))
        : 2;
      const attackCount = mightyWind ? 'three times' : 'twice';
      return `Shoots ${attackCount} as many attacks for ${baseDuration + effects.galeDurationBonus} turns without spending an attack, then cannot gain mana again until the effect ends.`;
    }
    case "Reaper's Touch": {
      if (effects.reaperManaDiscount <= 0) return undefined;
      return `Instantly kills a target. Bosses instead take {bossDamageRate}x Death Dice's attack as damage. This skill costs ${effects.reaperManaDiscount} less mana to charge.`;
    }
    case 'Chill Lock': {
      const modified = effects.skillOverlays.some((overlay) => overlay.title === 'Chill Lock' && overlay.modifiers?.hitsAllFoes === true);
      if (!modified) return undefined;
      return 'Deals {skillDamage} damage to every foe and immediately reduces their current attack count by 1 for {statusDuration} turns.';
    }
    default: return undefined;
  }
}

function applyDungeonCardSkillDescriptions(skills: DiceSkillDefinition[], effects: DungeonCardEffects): DiceSkillDefinition[] {
  return skills.map((skill) => {
    const description = getDungeonCardSkillDescription(skill, effects);
    return description === undefined || description === skill.description ? skill : { ...skill, description };
  });
}

function scaleGrantedSkillForClass(skill: DiceSkillDefinition, classLevel: number): DiceSkillDefinition {
  const skillDamage = skill.modifiers?.skillDamage;
  if (typeof skillDamage !== 'number' || !Number.isFinite(skillDamage) || skillDamage <= 0) return skill;
  const scaledDamage = Math.max(1, Math.round(skillDamage * getClassMultiplier(classLevel)));
  if (scaledDamage === skillDamage) return skill;
  return { ...skill, modifiers: { ...skill.modifiers, skillDamage: scaledDamage } };
}

// Card attack is deliberately kept out of the definition: it is one outgoing-damage multiplier resolved at
// damage time, so persisted per-instance definitions (revives, souls, carryover) cannot apply it twice.
export function applyDungeonCardStats(definition: DiceDefinition, effects: DungeonCardEffects, classLevel = 1): DiceDefinition {
  const hasDescriptionEffect = effects.ignitionRate > 0
    || effects.undeadHealthRate > 0
    || effects.soulBonusMultiplier > 1
    || effects.reaperManaDiscount > 0
    || effects.growthDeltaOverride > 0
    || effects.acidRainTurns > 0
    || effects.transformDurationBonus > 0
    || effects.rampageSplashRate > 0
    || effects.batteryAllyManaBonus > 0
    || effects.galeDurationBonus > 0
    || effects.temporalAccelerationCount > 0
    || effects.temporalDilationCount > 0;
  if (effects.healthBonusRate <= 0 && effects.rangeBonus <= 0 && effects.grantedSkills.length === 0 && effects.skillOverlays.length === 0 && !hasDescriptionEffect) return definition;
  let skills = effects.skillOverlays.length > 0
    ? definition.skills.map((skill) => {
      const overlays = effects.skillOverlays.filter((overlay) => overlay.title === skill.title);
      if (overlays.length === 0) return skill;
      return overlays.reduce((current, overlay) => {
        const relativeMana = overlay.manaNeededDelta !== undefined
          ? Math.max(1, Math.floor((current.manaNeeded ?? 1) + overlay.manaNeededDelta))
          : current.manaNeeded;
        const manaNeeded = overlay.manaNeededCap !== undefined
          ? Math.min(relativeMana ?? 1, overlay.manaNeededCap)
          : relativeMana;
        return {
          ...current,
          ...(manaNeeded !== undefined ? { manaNeeded } : {}),
          ...(overlay.modifiers ? { modifiers: { ...(current.modifiers ?? {}), ...overlay.modifiers } } : {})
        };
      }, skill);
    })
    : definition.skills;
  if (effects.grantedSkills.length > 0) {
    const grantedTitles = new Set(effects.grantedSkills.map((skill) => `${skill.type}:${skill.title}`));
    skills = [
      ...skills.filter((skill) => !grantedTitles.has(`${skill.type}:${skill.title}`)),
      ...effects.grantedSkills.map((skill) => scaleGrantedSkillForClass(skill, classLevel))
    ];
  }
  skills = applyDungeonCardSkillDescriptions(skills, effects);
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

export function resolveIgnitionDamage(maxHealth: number, rate: number, isBoss: boolean): number {
  const max = Number.isFinite(maxHealth) ? Math.max(1, maxHealth) : 1;
  const resolvedRate = Number.isFinite(rate) ? Math.max(0, rate) : 0;
  return Math.max(1, Math.floor(max * resolvedRate * (isBoss ? DUNGEON_IGNITION_BOSS_MULTIPLIER : 1)));
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
  const unique = CARD_CONFIGS[card.kind].unique === 'kind' || CARD_CONFIGS[card.kind].unique === 'type';
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
  const bottomDeckKeys = context.bottomDeckKeys;
  if (bottomDeckKeys && bottomDeckKeys.size > 0) {
    const notBottomDecked = available.filter((card) => !bottomDeckKeys.has(card.key));
    if (notBottomDecked.length > 0) available = notBottomDecked;
  }
  const uniqueDraw = isDungeonCardUniqueDraw(state);

  const picked: DungeonCard[] = [];
  const usedKeys = new Set<string>();
  const targetCount = Math.max(0, Math.floor(count));
  while (picked.length < targetCount) {
    let pool = available.filter((card) =>
      !usedKeys.has(getCardStackKey(card))
      && !picked.some((owned) => dungeonCardsConflict(owned, card))
    );
    if (pool.length === 0) break;
    const rarity = uniqueDraw ? getDungeonCardUniqueDrawRarityRoll(rng) : getDungeonCardRarityRoll(rng);
    if (uniqueDraw) {
      const uniqueAtRarity = pool.filter((card) => getDungeonCardMaxStacks(card) === 1 && card.rarity === rarity);
      if (uniqueAtRarity.length > 0) {
        pool = uniqueAtRarity;
      } else {
        const nonUniquePool = pool.filter((card) => getDungeonCardMaxStacks(card) !== 1);
        if (nonUniquePool.length > 0) {
          const nonUniqueRarities: readonly DungeonCardRarity[] = ['Rare', 'Epic', 'Legendary'];
          const rolledRarity = getDungeonCardNonUniqueDrawRarityRoll(rng);
          const fallbackRarity = [rolledRarity, ...nonUniqueRarities.filter((candidate) => candidate !== rolledRarity)]
            .map((candidate) => nonUniquePool.filter((card) => card.rarity === candidate))
            .find((cardsAtRarity) => cardsAtRarity.length > 0);
          pool = fallbackRarity ?? nonUniquePool;
        } else {
          const uniqueFallback = pool.filter((card) => getDungeonCardMaxStacks(card) === 1);
          if (uniqueFallback.length > 0) pool = uniqueFallback;
        }
      }
    } else {
      const rarityPool = pool.filter((card) => card.rarity === rarity);
      if (rarityPool.length > 0) pool = rarityPool;
    }
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

function normalizeDungeonCardOffer(value: unknown, state: DungeonCardState): DungeonCard[] {
  if (!Array.isArray(value)) return [];
  const offer: DungeonCard[] = [];
  const keys = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<DungeonCard>;
    if (typeof candidate.kind !== 'string' || !DUNGEON_CARD_KINDS.includes(candidate.kind as DungeonCardKind)) continue;
    if (typeof candidate.rarity !== 'string' || !DUNGEON_CARD_RARITIES.includes(candidate.rarity as DungeonCardRarity)) continue;
    if (typeof candidate.typeId !== 'string' || candidate.typeId.length === 0) continue;
    const card = createDungeonCard(candidate.kind as DungeonCardKind, candidate.rarity as DungeonCardRarity, candidate.typeId);
    if (keys.has(card.key) || !canAddDungeonCard(state, card) || offer.some((offered) => dungeonCardsConflict(offered, card))) continue;
    keys.add(card.key);
    offer.push(card);
    if (offer.length >= DUNGEON_CARD_DRAFT_SIZE) break;
  }
  return offer;
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
  const draftOffer = normalizeDungeonCardOffer(raw.draftOffer, state);
  if (draftOffer.length > 0) state.draftOffer = draftOffer;
  return state;
}
