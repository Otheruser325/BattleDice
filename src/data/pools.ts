import type Phaser from 'phaser';
import type { DicePoolDefinition, DicePoolFlags } from '../types/game';

const POOL_FLAGS_CACHE_KEY = 'pool:flags';

export function getPoolFlags(scene: Phaser.Scene): DicePoolFlags {
  const flags = scene.cache.json.get(POOL_FLAGS_CACHE_KEY) as DicePoolFlags | undefined;
  return flags && Array.isArray(flags.typeIds) ? flags : { typeIds: [] };
}

export function getPoolDefinition(scene: Phaser.Scene, typeId: string | undefined): DicePoolDefinition | undefined {
  if (!typeId) return undefined;
  return scene.cache.json.get(`pool:${typeId}`) as DicePoolDefinition | undefined;
}

export function getPoolDefinitions(scene: Phaser.Scene): DicePoolDefinition[] {
  return getPoolFlags(scene).typeIds
    .map((typeId) => getPoolDefinition(scene, typeId))
    .filter((definition): definition is DicePoolDefinition => Boolean(definition));
}
