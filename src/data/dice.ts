import type Phaser from 'phaser';
import type { DiceDefinition, DiceTypeId, DiceFlags } from '../types/game';

export const DEFAULT_LOADOUT = ['Fire', 'Ice', 'Poison', 'Lightning', 'Wind'] as const;

export const DICE_FLAGS_CACHE_KEY = 'dice:flags';
const LOADOUT_KEY = 'dice:loadout';

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
