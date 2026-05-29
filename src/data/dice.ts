import type Phaser from 'phaser';
import type { DiceDefinition, DiceTypeId, DiceFlags } from '../types/game';
import { AchievementStore } from '../systems/AchievementStore';

export const DEFAULT_LOADOUT = ['Fire', 'Ice', 'Poison', 'Electric', 'Wind'] as const;
export const DEFAULT_LOADOUT_IDS = new Set<string>(['Fire', 'Ice', 'Poison', 'Electric', 'Wind']);

export const DICE_FLAGS_CACHE_KEY = 'dice:flags';
const LOADOUT_KEY = 'dice:loadout';
const DICE_PROGRESS_KEY = 'dice:progress';
const DICE_TOKENS_KEY = 'dice:tokens';
const DIAMONDS_KEY = 'shop:diamonds';
const SHOP_STATE_KEY = 'shop:state';


const MAX_CLASS_LEVEL = 15;
const CLASS_COPY_COSTS_BY_RARITY: Record<number, Record<string, number>> = {
  2: { Common: 10, Uncommon: 8, Rare: 5, Epic: 2, Legendary: 1, Mythic: 1 },
  3: { Common: 20, Uncommon: 15, Rare: 10, Epic: 4, Legendary: 1, Mythic: 1 },
  4: { Common: 40, Uncommon: 30, Rare: 15, Epic: 6, Legendary: 2, Mythic: 1 },
  5: { Common: 80, Uncommon: 50, Rare: 25, Epic: 8, Legendary: 2, Mythic: 1 },
  6: { Common: 120, Uncommon: 80, Rare: 40, Epic: 10, Legendary: 3, Mythic: 1 },
  7: { Common: 200, Uncommon: 150, Rare: 75, Epic: 15, Legendary: 3, Mythic: 2 },
  8: { Common: 400, Uncommon: 250, Rare: 120, Epic: 20, Legendary: 4, Mythic: 2 },
  9: { Common: 700, Uncommon: 425, Rare: 200, Epic: 30, Legendary: 5, Mythic: 2 },
  10: { Common: 1000, Uncommon: 750, Rare: 500, Epic: 60, Legendary: 6, Mythic: 3 },
  11: { Common: 1500, Uncommon: 1000, Rare: 750, Epic: 100, Legendary: 8, Mythic: 3 },
  12: { Common: 2500, Uncommon: 1750, Rare: 1000, Epic: 200, Legendary: 10, Mythic: 3 },
  13: { Common: 5000, Uncommon: 3000, Rare: 2000, Epic: 400, Legendary: 12, Mythic: 4 },
  14: { Common: 7500, Uncommon: 5000, Rare: 3250, Epic: 650, Legendary: 15, Mythic: 4 },
  15: { Common: 10000, Uncommon: 7500, Rare: 5000, Epic: 1000, Legendary: 20, Mythic: 5 }
};


const MAX_STORED_COPIES_BY_RARITY: Record<string, number> = {
  Common: 29070,
  Uncommon: 20008,
  Rare: 12990,
  Epic: 2505,
  Legendary: 92,
  Mythic: 31
};

function getMaxStoredCopiesForType(scene: Phaser.Scene, typeId: DiceTypeId): number {
  const definition = scene.cache.json.get(`dice:${typeId}`) as { rarity?: string } | undefined;
  if (!definition?.rarity) return Number.POSITIVE_INFINITY;
  return MAX_STORED_COPIES_BY_RARITY[definition.rarity] ?? Number.POSITIVE_INFINITY;
}


function getMaxUsefulCopiesForType(scene: Phaser.Scene, typeId: DiceTypeId, classLevel: number): number {
  const definition = scene.cache.json.get(`dice:${typeId}`) as { rarity?: string } | undefined;
  const rarity = definition?.rarity;
  if (!rarity) return Number.POSITIVE_INFINITY;
  if (classLevel >= MAX_CLASS_LEVEL) return 0;
  let remaining = 0;
  for (let lvl = classLevel + 1; lvl <= MAX_CLASS_LEVEL; lvl++) {
    remaining += CLASS_COPY_COSTS_BY_RARITY[lvl]?.[rarity] ?? (lvl <= 1 ? 0 : lvl * 10);
  }
  return remaining;
}

function readStored<T>(key: string): T | undefined {
  try {
    if (typeof localStorage === 'undefined') return undefined;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

function writeStored<T>(key: string, value: T) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Registry state still keeps the session playable when localStorage is unavailable.
  }
}

export type DefaultLoadoutTypeId = (typeof DEFAULT_LOADOUT)[number];

export function getDiceFlags(scene: Phaser.Scene): DiceFlags {
  const flags = scene.cache.json.get(DICE_FLAGS_CACHE_KEY) as DiceFlags | undefined;

  if (!flags) {
    throw new Error('Dice flags were not loaded into cache.');
  }

  return flags;
}

export function getDiceDefinitions(scene: Phaser.Scene): DiceDefinition[] {
  return getSelectedLoadout(scene).map((typeId) => {
    const definition = scene.cache.json.get(`dice:${typeId}`) as DiceDefinition | undefined;

    if (!definition) {
      throw new Error(`Missing dice definition for ${typeId}.`);
    }

    return definition;
  });
}

export function getAllDiceDefinitions(scene: Phaser.Scene): DiceDefinition[] {
  return getDiceFlags(scene).fetchableTypeIds
    .map((typeId) => scene.cache.json.get(`dice:${typeId}`) as DiceDefinition | undefined)
    .filter((definition): definition is DiceDefinition => Boolean(definition));
}

export function getExclusiveDiceDefinitions(scene: Phaser.Scene): DiceDefinition[] {
  return (getDiceFlags(scene).exclusiveTypeIds ?? [])
    .map((typeId) => scene.cache.json.get(`dice:${typeId}`) as DiceDefinition | undefined)
    .filter((definition): definition is DiceDefinition => Boolean(definition));
}

export function getSelectedLoadout(scene: Phaser.Scene): DiceTypeId[] {
  const stored = scene.registry.get(LOADOUT_KEY) as DiceTypeId[] | undefined;
  if (stored?.length === 5) {
    const loadout = stored.filter((typeId) => isTypeIdFetchable(scene, typeId));
    if (loadout.length === 5) return loadout;
  }
  const saved = readStored<DiceTypeId[]>(LOADOUT_KEY);
  if (saved?.length === 5) {
    const loadout = saved.filter((typeId) => isTypeIdFetchable(scene, typeId));
    if (loadout.length === 5) {
      scene.registry.set(LOADOUT_KEY, loadout);
      return loadout;
    }
  }
  return [...DEFAULT_LOADOUT];
}

export function setSelectedLoadout(scene: Phaser.Scene, loadout: DiceTypeId[]) {
  const next = loadout.filter((typeId) => isTypeIdFetchable(scene, typeId)).slice(0, 5);
  scene.registry.set(LOADOUT_KEY, next);
  writeStored(LOADOUT_KEY, next);
}

export interface DiceProgressState {
  classLevel: number;
  copies: number;
  unlocked?: boolean;
}

export function getDiceTokens(scene: Phaser.Scene): number {
  const stored = scene.registry.get(DICE_TOKENS_KEY) as number | undefined;
  if (stored !== undefined) return stored;
  const saved = readStored<number>(DICE_TOKENS_KEY);
  const tokens = typeof saved === 'number' ? saved : 5000;
  scene.registry.set(DICE_TOKENS_KEY, tokens);
  return tokens;
}

export function setDiceTokens(scene: Phaser.Scene, tokens: number) {
  const next = Math.max(0, Math.floor(tokens));
  scene.registry.set(DICE_TOKENS_KEY, next);
  writeStored(DICE_TOKENS_KEY, next);
}

export function getDiceProgress(scene: Phaser.Scene, typeId: DiceTypeId): DiceProgressState {
  let store = scene.registry.get(DICE_PROGRESS_KEY) as Record<string, DiceProgressState> | undefined;
  if (!store) {
    store = readStored<Record<string, DiceProgressState>>(DICE_PROGRESS_KEY) ?? {};
    store = sanitizeDiceProgressStore(scene, store);
    scene.registry.set(DICE_PROGRESS_KEY, store);
  }
  const defaultCopies = 0;
  if (!isTypeIdFetchable(scene, typeId)) return { classLevel: 1, copies: defaultCopies, unlocked: false };
  const progress = store[typeId];
  if (!progress) return { classLevel: 1, copies: defaultCopies, unlocked: DEFAULT_LOADOUT_IDS.has(typeId) };
  return {
    classLevel: progress.classLevel,
    copies: progress.copies,
    unlocked: progress.unlocked === true || DEFAULT_LOADOUT_IDS.has(typeId) || progress.copies > 0
  };
}

function sanitizeDiceProgressStore(scene: Phaser.Scene, store: Record<string, DiceProgressState>): Record<string, DiceProgressState> {
  let changed = false;
  const sanitized = { ...store };
  Object.entries(store).forEach(([key, value]) => {
    const typeId = key as DiceTypeId;
    if (!isTypeIdFetchable(scene, typeId)) {
      delete sanitized[key];
      changed = true;
      return;
    }
    const classLevel = Math.max(1, Math.min(MAX_CLASS_LEVEL, value.classLevel || 1));
    const maxCopies = Math.min(getMaxStoredCopiesForType(scene, typeId), getMaxUsefulCopiesForType(scene, typeId, classLevel));
    const copies = Math.max(0, Math.min(value.copies || 0, maxCopies));
    const unlocked = value.unlocked === true || DEFAULT_LOADOUT_IDS.has(typeId) || copies > 0;
    if (classLevel !== value.classLevel || copies !== value.copies || unlocked !== value.unlocked) {
      changed = true;
      sanitized[key] = { classLevel, copies, unlocked };
    }
  });
  if (changed) writeStored(DICE_PROGRESS_KEY, sanitized);
  return sanitized;
}

export function setDiceProgress(scene: Phaser.Scene, typeId: DiceTypeId, next: DiceProgressState) {
  if (!isTypeIdFetchable(scene, typeId)) return;
  const store = (scene.registry.get(DICE_PROGRESS_KEY) as Record<string, DiceProgressState> | undefined) ?? {};
  const existing = store[typeId];
  const updated = {
    ...store,
    [typeId]: {
      classLevel: Math.max(1, Math.min(15, next.classLevel)),
      copies: Math.max(0, Math.min(next.copies, Math.min(getMaxStoredCopiesForType(scene, typeId), getMaxUsefulCopiesForType(scene, typeId, Math.max(1, Math.min(MAX_CLASS_LEVEL, next.classLevel)))))),
      unlocked: next.unlocked === true || existing?.unlocked === true || DEFAULT_LOADOUT_IDS.has(typeId) || next.copies > 0
    }
  };
  scene.registry.set(DICE_PROGRESS_KEY, updated);
  writeStored(DICE_PROGRESS_KEY, updated);
}


export function canReceiveUsefulCopies(scene: Phaser.Scene, typeId: DiceTypeId): boolean {
  if (!isTypeIdFetchable(scene, typeId)) return false;
  const progress = getDiceProgress(scene, typeId);
  if (progress.classLevel >= MAX_CLASS_LEVEL) return false;
  return progress.copies < getMaxUsefulCopiesForType(scene, typeId, progress.classLevel);
}

export function getRemainingUsefulCopies(scene: Phaser.Scene, typeId: DiceTypeId): number {
  const progress = getDiceProgress(scene, typeId);
  if (progress.classLevel >= MAX_CLASS_LEVEL) return 0;
  return Math.max(0, getMaxUsefulCopiesForType(scene, typeId, progress.classLevel) - progress.copies);
}

export function grantDiceCopies(scene: Phaser.Scene, typeId: DiceTypeId, copies: number) {
  if (copies <= 0) return;
  if (!isTypeIdFetchable(scene, typeId)) return;
  const definition = scene.cache.json.get(`dice:${typeId}`) as DiceDefinition | undefined;
  const progress = getDiceProgress(scene, typeId);
  if (DEFAULT_LOADOUT_IDS.has(typeId) || progress.unlocked) {
    const maxUseful = getMaxUsefulCopiesForType(scene, typeId, progress.classLevel);
    setDiceProgress(scene, typeId, { ...progress, copies: Math.min(progress.copies + copies, Math.min(getMaxStoredCopiesForType(scene, typeId), maxUseful)) });
    return;
  }
  const spendForUnlock = 1;
  const remainder = Math.max(0, copies - spendForUnlock);
  const maxUseful = getMaxUsefulCopiesForType(scene, typeId, progress.classLevel);
  setDiceProgress(scene, typeId, { classLevel: progress.classLevel, copies: Math.min(progress.copies + remainder, Math.min(getMaxStoredCopiesForType(scene, typeId), maxUseful)), unlocked: true });
  if (definition?.rarity === 'Legendary') AchievementStore.unlock(scene, 'darkest_hour');
}

export function getRangeLabel(range: number): string {
  if (range <= 0) return 'None';
  if (range <= 2) return 'Small';
  if (range <= 4) return 'Medium';
  if (range <= 6) return 'Long';
  return 'Very Long';
}

export function isTypeIdFetchable(scene: Phaser.Scene, typeId: DiceTypeId): boolean {
  return getDiceFlags(scene).fetchableTypeIds.includes(typeId);
}

export function getPrimarySkill(definition: DiceDefinition) {
  return definition.skills[0] ?? null;
}

export function getDiamonds(scene: Phaser.Scene): number {
  const stored = scene.registry.get(DIAMONDS_KEY) as number | undefined;
  if (stored !== undefined) return stored;
  const saved = readStored<number>(DIAMONDS_KEY);
  const diamonds = typeof saved === 'number' ? saved : 100;
  scene.registry.set(DIAMONDS_KEY, diamonds);
  return diamonds;
}

export function setDiamonds(scene: Phaser.Scene, amount: number) {
  const next = Math.max(0, Math.floor(amount));
  scene.registry.set(DIAMONDS_KEY, next);
  writeStored(DIAMONDS_KEY, next);
}

export interface ShopOffer {
  id: string;
  typeId: string;
  isCoinOffer: boolean;
  copies: number;
  coinAmount: number;
  diamondCost: number;
  rarity: string;
  isFreebie: boolean;
  isDiceTokenOffer?: boolean;
  isCasinoChipOffer?: boolean;
  purchased: boolean;
}

export const DICE_TOKEN_DIAMOND_OFFERS = [
  { id: 'dice-tokens-1k', coinAmount: 1_000, diamondCost: 50 },
  { id: 'dice-tokens-10k', coinAmount: 10_000, diamondCost: 450 },
  { id: 'dice-tokens-100k', coinAmount: 100_000, diamondCost: 4_000 }
] as const;

export const CASINO_CHIP_DIAMOND_OFFERS = [
  { id: 'casino-chips-10', coinAmount: 10, diamondCost: 50 },
  { id: 'casino-chips-100', coinAmount: 100, diamondCost: 450 },
  { id: 'casino-chips-1000', coinAmount: 1_000, diamondCost: 4_000 }
] as const;

export interface ShopState {
  offers: ShopOffer[];
  generatedDay: number;
  freebieClaimedThisSession: boolean;
  diceTokenFirstPurchaseIds: string[];
  casinoChipFirstPurchaseIds: string[];
}

function getDayNumber(): number {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
}

export function getShopState(scene: Phaser.Scene): ShopState {
  let state = scene.registry.get(SHOP_STATE_KEY) as Partial<ShopState> | undefined;
  if (!state) {
    state = readStored<Partial<ShopState>>(SHOP_STATE_KEY) ?? {};
    scene.registry.set(SHOP_STATE_KEY, state);
  }
  return {
    offers: state.offers ?? [],
    generatedDay: state.generatedDay ?? -1,
    freebieClaimedThisSession: state.freebieClaimedThisSession ?? false,
    diceTokenFirstPurchaseIds: state.diceTokenFirstPurchaseIds ?? [],
    casinoChipFirstPurchaseIds: state.casinoChipFirstPurchaseIds ?? []
  };
}

export function setShopState(scene: Phaser.Scene, state: ShopState) {
  scene.registry.set(SHOP_STATE_KEY, state);
  writeStored(SHOP_STATE_KEY, state);
}

const DIAMOND_COST_BY_RARITY: Record<string, number> = {
  Common: 10,
  Uncommon: 20,
  Rare: 50,
  Epic: 150,
  Legendary: 250,
  Mythic: 500
};

const COPIES_BY_RARITY: Record<string, number> = {
  Common: 20,
  Uncommon: 15,
  Rare: 10,
  Epic: 3,
  Legendary: 1,
  Mythic: 1
};

export function generateOrGetShopOffers(scene: Phaser.Scene): ShopState {
  const existing = getShopState(scene);
  const currentDay = getDayNumber();
  const allDefs = getAllDiceDefinitions(scene);
  const eligible = allDefs.filter((d) => canReceiveUsefulCopies(scene, d.typeId));
  const freebieCopiesByRarity: Record<string, number> = { Common: 20, Uncommon: 10, Rare: 5 };
  const sanitizedExistingOffers = existing.offers.filter((offer) => {
    if (offer.isDiceTokenOffer || offer.isCasinoChipOffer) return true;
    if (!offer.typeId || !isTypeIdFetchable(scene, offer.typeId)) return false;
    return offer.purchased || canReceiveUsefulCopies(scene, offer.typeId);
  });
  const sanitizedExisting: ShopState = sanitizedExistingOffers.length === existing.offers.length
    ? existing
    : { ...existing, offers: sanitizedExistingOffers };
  if (sanitizedExisting !== existing) setShopState(scene, sanitizedExisting);

  const existingFreebie = sanitizedExisting.offers.find((offer) => offer.isFreebie);
  const existingFreebieUsesCurrentRules = eligible.length === 0
    ? !existingFreebie
    : Boolean(
      existingFreebie &&
      !existingFreebie.isCoinOffer &&
      existingFreebie.rarity in freebieCopiesByRarity &&
      existingFreebie.copies === freebieCopiesByRarity[existingFreebie.rarity]
    );

  if (sanitizedExisting.generatedDay === currentDay && existingFreebieUsesCurrentRules && sanitizedExisting.offers.some((offer) => offer.isDiceTokenOffer) && sanitizedExisting.offers.some((offer) => offer.isCasinoChipOffer)) {
    return sanitizedExisting;
  }

  const seed = currentDay;
  const seededRandom = (() => {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) & 0xffffffff;
      return ((s >>> 0) / 0xffffffff);
    };
  })();

  const shuffled = [...eligible].sort(() => seededRandom() - 0.5);

  const offers: ShopOffer[] = [];

  const freebieRoll = seededRandom();
  const freebieRarity = freebieRoll < 0.45 ? 'Common' : (freebieRoll < 0.75 ? 'Uncommon' : 'Rare');
  const freebieDef = shuffled.find((def) => def.rarity === freebieRarity) ?? shuffled.find((def) => ['Common', 'Uncommon', 'Rare'].includes(def.rarity));
  if (freebieDef) {
    offers.push({
      id: 'freebie',
      typeId: freebieDef.typeId,
      isCoinOffer: false,
      copies: freebieCopiesByRarity[freebieDef.rarity] ?? 20,
      coinAmount: 0,
      diamondCost: 0,
      rarity: freebieDef.rarity,
      isFreebie: true,
      purchased: false
    });
  }

  const slotDefs = shuffled.filter((def) => def.typeId !== freebieDef?.typeId).slice(0, 5);
  while (slotDefs.length < 5) {
    const fallback = shuffled[Math.floor(seededRandom() * shuffled.length)];
    if (fallback) slotDefs.push(fallback);
    else break;
  }

  slotDefs.slice(0, 5).forEach((def, i) => {
    const copyMultiplier = 1 + Math.floor(seededRandom() * 10);
    const baseCopies = COPIES_BY_RARITY[def.rarity] ?? 1;
    const baseDiamondCost = DIAMOND_COST_BY_RARITY[def.rarity] ?? 10;
    offers.push({
      id: `slot-${i}`,
      typeId: def.typeId,
      isCoinOffer: false,
      copies: baseCopies * copyMultiplier,
      coinAmount: 0,
      diamondCost: baseDiamondCost * copyMultiplier,
      rarity: def.rarity,
      isFreebie: false,
      purchased: false
    });
  });

  DICE_TOKEN_DIAMOND_OFFERS.forEach((tokenOffer) => {
    offers.push({
      id: tokenOffer.id,
      typeId: '',
      isCoinOffer: true,
      copies: 0,
      coinAmount: tokenOffer.coinAmount,
      diamondCost: tokenOffer.diamondCost,
      rarity: 'Diamond',
      isFreebie: false,
      isDiceTokenOffer: true,
      purchased: false
    });
  });

  CASINO_CHIP_DIAMOND_OFFERS.forEach((chipOffer) => {
    offers.push({
      id: chipOffer.id,
      typeId: '',
      isCoinOffer: true,
      copies: 0,
      coinAmount: chipOffer.coinAmount,
      diamondCost: chipOffer.diamondCost,
      rarity: 'Casino',
      isFreebie: false,
      isCasinoChipOffer: true,
      purchased: false
    });
  });

  const newState: ShopState = {
    offers,
    generatedDay: currentDay,
    freebieClaimedThisSession: false,
    diceTokenFirstPurchaseIds: existing.diceTokenFirstPurchaseIds,
    casinoChipFirstPurchaseIds: existing.casinoChipFirstPurchaseIds
  };

  setShopState(scene, newState);
  return newState;
}
