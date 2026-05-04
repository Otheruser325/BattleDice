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
  return [...DEFAULT_LOADOUT];
}

export function setSelectedLoadout(scene: Phaser.Scene, loadout: DiceTypeId[]) {
  scene.registry.set(LOADOUT_KEY, loadout.slice(0, 5));
}

export interface DiceProgressState {
  classLevel: number;
  copies: number;
}

export function getDiceTokens(scene: Phaser.Scene): number {
  return (scene.registry.get(DICE_TOKENS_KEY) as number | undefined) ?? 5000;
}

export function setDiceTokens(scene: Phaser.Scene, tokens: number) {
  scene.registry.set(DICE_TOKENS_KEY, Math.max(0, Math.floor(tokens)));
}

export function getDiceProgress(scene: Phaser.Scene, typeId: DiceTypeId): DiceProgressState {
  const store = (scene.registry.get(DICE_PROGRESS_KEY) as Record<string, DiceProgressState> | undefined) ?? {};
  const defaultCopies = DEFAULT_LOADOUT_IDS.has(typeId) ? 200 : 0;
  return store[typeId] ?? { classLevel: 1, copies: defaultCopies };
}

export function setDiceProgress(scene: Phaser.Scene, typeId: DiceTypeId, next: DiceProgressState) {
  const store = (scene.registry.get(DICE_PROGRESS_KEY) as Record<string, DiceProgressState> | undefined) ?? {};
  scene.registry.set(DICE_PROGRESS_KEY, {
    ...store,
    [typeId]: { classLevel: Math.max(1, Math.min(15, next.classLevel)), copies: Math.max(0, next.copies) }
  });
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
  return (scene.registry.get(DIAMONDS_KEY) as number | undefined) ?? 50;
}

export function setDiamonds(scene: Phaser.Scene, amount: number) {
  scene.registry.set(DIAMONDS_KEY, Math.max(0, Math.floor(amount)));
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
  purchased: boolean;
}

export interface ShopState {
  offers: ShopOffer[];
  generatedDay: number;
  freebieClaimedThisSession: boolean;
}

function getDayNumber(): number {
  return Math.floor(Date.now() / (24 * 60 * 60 * 1000));
}

export function getShopState(scene: Phaser.Scene): ShopState {
  return (scene.registry.get(SHOP_STATE_KEY) as ShopState | undefined) ?? { offers: [], generatedDay: -1, freebieClaimedThisSession: false };
}

export function setShopState(scene: Phaser.Scene, state: ShopState) {
  scene.registry.set(SHOP_STATE_KEY, state);
}

const DIAMOND_COST_BY_RARITY: Record<string, number> = {
  Common: 5,
  Uncommon: 10,
  Rare: 20,
  Epic: 40,
  Legendary: 80
};

const COPIES_BY_RARITY: Record<string, number> = {
  Common: 4,
  Uncommon: 3,
  Rare: 2,
  Epic: 1,
  Legendary: 1
};

export function generateOrGetShopOffers(scene: Phaser.Scene): ShopState {
  const existing = getShopState(scene);
  const currentDay = getDayNumber();

  if (existing.generatedDay === currentDay && existing.offers.length === 6) {
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

  const freebieIsCoin = seededRandom() < 0.5;
  offers.push({
    id: 'freebie',
    typeId: freebieIsCoin ? '' : (shuffled[0]?.typeId ?? ''),
    isCoinOffer: freebieIsCoin,
    copies: freebieIsCoin ? 0 : 3,
    coinAmount: freebieIsCoin ? 200 : 0,
    diamondCost: 0,
    rarity: freebieIsCoin ? 'Common' : (shuffled[0]?.rarity ?? 'Common'),
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
    offers.push({
      id: `slot-${i}`,
      typeId: def.typeId,
      isCoinOffer: false,
      copies: COPIES_BY_RARITY[def.rarity] ?? 1,
      coinAmount: 0,
      diamondCost: DIAMOND_COST_BY_RARITY[def.rarity] ?? 10,
      rarity: def.rarity,
      isFreebie: false,
      purchased: false
    });
  });

  const newState: ShopState = {
    offers,
    generatedDay: currentDay,
    freebieClaimedThisSession: false
  };

  setShopState(scene, newState);
  return newState;
}
