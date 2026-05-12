import type Phaser from 'phaser';
import type { DiceDefinition, DiceTypeId, DiceFlags } from '../types/game';

export const DEFAULT_LOADOUT = ['Fire', 'Ice', 'Poison', 'Electric', 'Wind'] as const;
export const DEFAULT_LOADOUT_IDS = new Set<string>(['Fire', 'Ice', 'Poison', 'Electric', 'Wind']);

export const DICE_FLAGS_CACHE_KEY = 'dice:flags';
const LOADOUT_KEY = 'dice:loadout';
const DICE_PROGRESS_KEY = 'dice:progress';
const DICE_TOKENS_KEY = 'dice:tokens';
const DIAMONDS_KEY = 'shop:diamonds';
const SHOP_STATE_KEY = 'shop:state';

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

export function getSelectedLoadout(scene: Phaser.Scene): DiceTypeId[] {
  const stored = scene.registry.get(LOADOUT_KEY) as DiceTypeId[] | undefined;
  if (stored?.length === 5) return stored;
  const saved = readStored<DiceTypeId[]>(LOADOUT_KEY);
  if (saved?.length === 5) {
    scene.registry.set(LOADOUT_KEY, saved);
    return saved;
  }
  return [...DEFAULT_LOADOUT];
}

export function setSelectedLoadout(scene: Phaser.Scene, loadout: DiceTypeId[]) {
  const next = loadout.slice(0, 5);
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
    scene.registry.set(DICE_PROGRESS_KEY, store);
  }
  const defaultCopies = DEFAULT_LOADOUT_IDS.has(typeId) ? 200 : 0;
  const progress = store[typeId];
  if (!progress) return { classLevel: 1, copies: defaultCopies, unlocked: DEFAULT_LOADOUT_IDS.has(typeId) };
  return {
    classLevel: progress.classLevel,
    copies: progress.copies,
    unlocked: progress.unlocked === true || DEFAULT_LOADOUT_IDS.has(typeId) || progress.copies > 0
  };
}

export function setDiceProgress(scene: Phaser.Scene, typeId: DiceTypeId, next: DiceProgressState) {
  const store = (scene.registry.get(DICE_PROGRESS_KEY) as Record<string, DiceProgressState> | undefined) ?? {};
  const updated = {
    ...store,
    [typeId]: {
      classLevel: Math.max(1, Math.min(15, next.classLevel)),
      copies: Math.max(0, next.copies),
      unlocked: next.unlocked === true || DEFAULT_LOADOUT_IDS.has(typeId) || next.copies > 0
    }
  };
  scene.registry.set(DICE_PROGRESS_KEY, updated);
  writeStored(DICE_PROGRESS_KEY, updated);
}

export function grantDiceCopies(scene: Phaser.Scene, typeId: DiceTypeId, copies: number) {
  if (copies <= 0) return;
  const progress = getDiceProgress(scene, typeId);
  if (DEFAULT_LOADOUT_IDS.has(typeId) || progress.unlocked) {
    setDiceProgress(scene, typeId, { ...progress, copies: progress.copies + copies });
    return;
  }
  const spendForUnlock = 1;
  const remainder = Math.max(0, copies - spendForUnlock);
  setDiceProgress(scene, typeId, { classLevel: progress.classLevel, copies: progress.copies + remainder, unlocked: true });
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
    diceTokenFirstPurchaseIds: state.diceTokenFirstPurchaseIds ?? []
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
  Legendary: 250
};

const COPIES_BY_RARITY: Record<string, number> = {
  Common: 20,
  Uncommon: 15,
  Rare: 10,
  Epic: 3,
  Legendary: 1
};

export function generateOrGetShopOffers(scene: Phaser.Scene): ShopState {
  const existing = getShopState(scene);
  const currentDay = getDayNumber();
  const existingFreebie = existing.offers.find((offer) => offer.isFreebie);
  const freebieCopiesByRarity: Record<string, number> = { Common: 20, Uncommon: 10, Rare: 5 };
  const existingFreebieUsesCurrentRules = Boolean(
    existingFreebie &&
    !existingFreebie.isCoinOffer &&
    existingFreebie.rarity in freebieCopiesByRarity &&
    existingFreebie.copies === freebieCopiesByRarity[existingFreebie.rarity]
  );

  if (existing.generatedDay === currentDay && existingFreebieUsesCurrentRules && existing.offers.some((offer) => offer.isDiceTokenOffer) && existing.offers.some((offer) => offer.isCasinoChipOffer)) {
    return existing;
  }

  const allDefs = getAllDiceDefinitions(scene);
  const eligible = allDefs.filter((d) => {
    const progress = getDiceProgress(scene, d.typeId);
    return progress.classLevel < 15;
  });

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
  offers.push({
    id: 'freebie',
    typeId: freebieDef?.typeId ?? '',
    isCoinOffer: false,
    copies: freebieCopiesByRarity[freebieDef?.rarity ?? freebieRarity] ?? 20,
    coinAmount: 0,
    diamondCost: 0,
    rarity: freebieDef?.rarity ?? freebieRarity,
    isFreebie: true,
    purchased: false
  });

  const slotDefs = shuffled.slice(1, 6);
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
    diceTokenFirstPurchaseIds: existing.diceTokenFirstPurchaseIds
  };

  setShopState(scene, newState);
  return newState;
}
