import type Phaser from 'phaser';
import type { DiceDefinition, DiceTypeId, DiceFlags } from '../types/game';

export const DEFAULT_LOADOUT = ['Fire', 'Ice', 'Poison', 'Lightning', 'Wind'] as const;

export const DICE_FLAGS_CACHE_KEY = 'dice:flags';

export type DefaultLoadoutTypeId = (typeof DEFAULT_LOADOUT)[number];

export function getDiceFlags(scene: Phaser.Scene): DiceFlags {
  const flags = scene.cache.json.get(DICE_FLAGS_CACHE_KEY) as DiceFlags | undefined;

  if (!flags) {
    throw new Error('Dice flags were not loaded into cache.');
  }

  return flags;
}

export function getDiceDefinitions(scene: Phaser.Scene): DiceDefinition[] {
  return DEFAULT_LOADOUT.map((typeId) => {
    const definition = scene.cache.json.get(`dice:${typeId}`) as DiceDefinition | undefined;

    if (!definition) {
      throw new Error(`Missing dice definition for ${typeId}.`);
    }

    return definition;
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
