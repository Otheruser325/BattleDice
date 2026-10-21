import type Phaser from 'phaser';
import type { DiceDefinition, DiceRarity, DiceTalentDefinition, DiceTypeId } from '../types/game';
import type { ChestType } from './CasinoComboTypes';
import { readIntegrityChecked, writeIntegrityChecked } from '../utils/SecureStorage';
import { formatPercent } from '../utils/FormatManager';

const TALENT_STATE_KEY = 'dice:talentState';
const TALENT_BASE_COST = 10_000;

export const DEFAULT_TALENT_CLASS_NEEDED = 9;
export const RARITY_ORDER: DiceRarity[] = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic'];

const TALENT_COST_MULTIPLIER: Record<DiceRarity, number> = {
  Common: 1,
  Uncommon: 1.5,
  Rare: 2,
  Epic: 5,
  Legendary: 10,
  Mythic: 20
};

const TALENT_DIAMOND_DROP_RATE: Record<DiceRarity, number> = {
  Common: 0.1,
  Uncommon: 0.075,
  Rare: 0.05,
  Epic: 0.025,
  Legendary: 0.0125,
  Mythic: 0.005
};

const TALENT_MASTER_DROP_RATE: Record<DiceRarity, number> = {
  Common: 0.5,
  Uncommon: 0.3,
  Rare: 0.25,
  Epic: 0.125,
  Legendary: 0.0625,
  Mythic: 0.025
};

export const TALENT_SHOP_OFFER_CHANCE = 0.05;

// Talents are addressed by array index so dice data can add, reorder, or retitle
// entries without invalidating saved progress.
export interface DiceTalentState {
  owned: Record<DiceTypeId, number[]>;
  equipped: Record<DiceTypeId, number>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isSafeKey(key: string): boolean {
  return key.length > 0 && !UNSAFE_KEYS.has(key);
}

// A typeId that names a prototype member (for example "__proto__") would resolve
// to an inherited object on plain-record lookups instead of returning undefined.
export function isSafeTalentTypeId(typeId: string | undefined): typeId is DiceTypeId {
  return typeof typeId === 'string' && isSafeKey(typeId);
}

function normalizeTalentIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeTalentState(value: unknown): DiceTalentState {
  if (!isPlainRecord(value)) return { owned: {}, equipped: {} };
  const owned: Record<DiceTypeId, number[]> = {};
  const rawOwned = value.owned;
  if (isPlainRecord(rawOwned)) {
    Object.entries(rawOwned).forEach(([typeId, indices]) => {
      if (typeof typeId !== 'string' || !isSafeKey(typeId) || !Array.isArray(indices)) return;
      const unique = [...new Set(indices.map(normalizeTalentIndex).filter((index): index is number => index !== null))]
        .sort((a, b) => a - b);
      if (unique.length > 0) owned[typeId] = unique;
    });
  }
  const equipped: Record<DiceTypeId, number> = {};
  const rawEquipped = value.equipped;
  if (isPlainRecord(rawEquipped)) {
    Object.entries(rawEquipped).forEach(([typeId, raw]) => {
      if (typeof typeId !== 'string' || !isSafeKey(typeId)) return;
      // Only one talent may ever be equipped per die. A legacy or tampered value
      // that lists several indices collapses to the first index that is owned.
      const candidates = Array.isArray(raw) ? raw : [raw];
      const selected = candidates
        .map(normalizeTalentIndex)
        .find((index): index is number => index !== null && owned[typeId]?.includes(index) === true);
      if (selected !== undefined) equipped[typeId] = selected;
    });
  }
  return { owned, equipped };
}

export function getTalentState(scene: Phaser.Scene): DiceTalentState {
  const stored = scene.registry.get(TALENT_STATE_KEY) as DiceTalentState | undefined;
  if (stored) return stored;
  const loaded = normalizeTalentState(readIntegrityChecked<unknown>(TALENT_STATE_KEY));
  scene.registry.set(TALENT_STATE_KEY, loaded);
  return loaded;
}

function writeTalentState(scene: Phaser.Scene, state: DiceTalentState) {
  const normalized = normalizeTalentState(state);
  scene.registry.set(TALENT_STATE_KEY, normalized);
  writeIntegrityChecked(TALENT_STATE_KEY, normalized);
}

// Dice data ships as JSON, so treat a malformed talents value as "no talents"
// rather than letting a stray string or object reach array-only methods.
export function getTalents(definition: DiceDefinition | undefined): DiceTalentDefinition[] {
  return Array.isArray(definition?.talents) ? definition.talents : [];
}

export function getTalentByIndex(definition: DiceDefinition, talentIndex: number | null | undefined): DiceTalentDefinition | undefined {
  if (talentIndex === null || talentIndex === undefined || !Number.isInteger(talentIndex) || talentIndex < 0) return undefined;
  const talent = getTalents(definition)[talentIndex];
  return talent && typeof talent === 'object' && !Array.isArray(talent) ? talent : undefined;
}

export function getTalentClassNeeded(talent: DiceTalentDefinition): number {
  const value = talent.classNeeded;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 15
    ? value
    : DEFAULT_TALENT_CLASS_NEEDED;
}

// Absent means obtainable; an explicit false keeps an entry in the dice data as
// a reference-only talent that no shop, chest, or token transaction can grant.
export function isTalentObtainable(talent: DiceTalentDefinition): boolean {
  return talent.isObtainable !== false;
}

export function getTalentCost(rarity: DiceRarity | string): number {
  const multiplier = TALENT_COST_MULTIPLIER[rarity as DiceRarity] ?? 1;
  return Math.round(TALENT_BASE_COST * multiplier);
}

export function getTalentDropRate(chestType: ChestType, rarity: DiceRarity | string): number {
  if (chestType === 'Diamond') return TALENT_DIAMOND_DROP_RATE[rarity as DiceRarity] ?? 0;
  if (chestType === 'Master') return TALENT_MASTER_DROP_RATE[rarity as DiceRarity] ?? 0;
  return 0;
}

export function isTalentChest(chestType: ChestType): boolean {
  return chestType === 'Diamond' || chestType === 'Master';
}

export function getTalentDropRateText(chestType: ChestType): string {
  if (!isTalentChest(chestType)) return '';
  return RARITY_ORDER
    .map((rarity) => `${rarity}: ${formatPercent(getTalentDropRate(chestType, rarity), 2)}`)
    .join('  •  ');
}

export function isTalentOwned(scene: Phaser.Scene, typeId: DiceTypeId, talentIndex: number): boolean {
  if (!isSafeTalentTypeId(typeId)) return false;
  const state = getTalentState(scene);
  if (!Object.prototype.hasOwnProperty.call(state.owned, typeId)) return false;
  return state.owned[typeId]?.includes(talentIndex) === true;
}

export function getAcquirableTalentIndices(scene: Phaser.Scene, definition: DiceDefinition, classLevel: number): number[] {
  if (definition.talentsComingSoon || !isSafeTalentTypeId(definition.typeId)) return [];
  return getTalents(definition)
    .map((talent, index) => ({ talent, index }))
    .filter(({ talent, index }) =>
      Boolean(talent) && typeof talent === 'object'
      && isTalentObtainable(talent)
      && classLevel >= getTalentClassNeeded(talent)
      && !isTalentOwned(scene, definition.typeId, index)
    )
    .map(({ index }) => index);
}

export function grantTalent(scene: Phaser.Scene, definition: DiceDefinition, talentIndex: number): boolean {
  const talent = getTalentByIndex(definition, talentIndex);
  if (!talent || definition.talentsComingSoon || !isTalentObtainable(talent)) return false;
  if (!isSafeTalentTypeId(definition.typeId)) return false;
  const state = getTalentState(scene);
  if (state.owned[definition.typeId]?.includes(talentIndex)) return false;
  writeTalentState(scene, {
    ...state,
    owned: {
      ...state.owned,
      [definition.typeId]: [...(state.owned[definition.typeId] ?? []), talentIndex].sort((a, b) => a - b)
    }
  });
  return true;
}

export function getEquippedTalentIndex(scene: Phaser.Scene, definition: DiceDefinition): number | null {
  if (!isSafeTalentTypeId(definition.typeId)) return null;
  const talentIndex = getTalentState(scene).equipped[definition.typeId];
  if (talentIndex === undefined) return null;
  if (definition.talentsComingSoon || !getTalentByIndex(definition, talentIndex)) return null;
  return isTalentOwned(scene, definition.typeId, talentIndex) ? talentIndex : null;
}

export function setEquippedTalentIndex(scene: Phaser.Scene, definition: DiceDefinition, talentIndex: number | null) {
  if (!isSafeTalentTypeId(definition.typeId)) return;
  const state = getTalentState(scene);
  if (talentIndex === null) {
    const equipped = { ...state.equipped };
    delete equipped[definition.typeId];
    writeTalentState(scene, { ...state, equipped });
    return;
  }
  // isObtainable only gates acquisition; any talent the player already owns stays
  // equippable so flipping the flag never strands an existing unlock.
  const talent = getTalentByIndex(definition, talentIndex);
  if (!talent || definition.talentsComingSoon) return;
  if (!isTalentOwned(scene, definition.typeId, talentIndex)) return;
  // Each dice type has exactly one active talent slot. Assigning replaces the
  // previous entry so a die can never run two talents at once.
  writeTalentState(scene, { ...state, equipped: { ...state.equipped, [definition.typeId]: talentIndex } });
}
