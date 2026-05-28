import type Phaser from 'phaser';
import type { DiceFlags } from '../types/game';
import { DebugManager } from '../utils/DebugManager';
import { withBasePath } from '../utils/BuildEnv';

const DICE_FLAGS_PATHS = [
  withBasePath('gamedata/DiceDefinitions/Flags.json')
];

export const EXCLUSIVE_DEFINITION_PATHS = {
  Deucifer: withBasePath('gamedata/DiceDefinitions/Bosses/Deucifer.dice'),
  Imp: withBasePath('gamedata/DiceDefinitions/Minions/Imp.dice')
} as const;

function getDefinitionPath(typeId: string) {
  return withBasePath(`gamedata/DiceDefinitions/${typeId}.dice`);
}

export class DiceCatalogLoader {
  static preloadFlags(_scene: Phaser.Scene) {}

  static async loadFetchableDefinitions(scene: Phaser.Scene): Promise<DiceFlags> {
    const debug = DebugManager.scope('DiceCatalog');
    let flags: DiceFlags | undefined;
    for (const path of DICE_FLAGS_PATHS) {
      try {
        const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) continue;
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json') && !path.endsWith('.json')) continue;
        const data = await res.json() as DiceFlags;
        if (Array.isArray(data?.fetchableTypeIds)) {
          flags = data;
          break;
        }
      } catch (error) {
        debug.warn('Failed to fetch flags path.', { path, error });
      }
    }

    if (!flags || !Array.isArray(flags.fetchableTypeIds)) {
      throw new Error('Dice Flags.json is missing or malformed.');
    }

    const fetchableTypeIds = [...new Set(flags.fetchableTypeIds)]
      .filter((typeId): typeId is string => typeof typeId === 'string')
      .map((typeId) => typeId.trim())
      .filter((typeId) => /^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(typeId))
      .slice(0, 32);
    scene.cache.json.add('dice:flags', { fetchableTypeIds });
    debug.log('Loading dice definitions from flags.', { fetchableTypeIds });

    if (!fetchableTypeIds.length) return { fetchableTypeIds: [] };

    const loadedTypeIds: string[] = [];
    for (const typeId of fetchableTypeIds) {
      const path = getDefinitionPath(typeId);
      try {
        const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) {
          debug.warn('Dice definition HTTP error.', { typeId, path, status: res.status });
          continue;
        }
        const definition = await res.json();
        scene.cache.json.add(`dice:${typeId}`, definition);
        loadedTypeIds.push(typeId);
      } catch (error) {
        debug.warn('Failed to fetch dice definition.', { typeId, path, error });
      }
    }

    if (!loadedTypeIds.length) {
      throw new Error('No dice definitions were loaded.');
    }

    scene.cache.json.add('dice:flags', { fetchableTypeIds: loadedTypeIds });
    debug.log('Loaded dice definitions.', { requested: fetchableTypeIds.length, loaded: loadedTypeIds.length });

    for (const [typeId, path] of Object.entries(EXCLUSIVE_DEFINITION_PATHS)) {
      try {
        const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) {
          debug.warn('Exclusive dice definition HTTP error.', { typeId, path, status: res.status });
          continue;
        }
        const definition = await res.json();
        scene.cache.json.add(`dice:${typeId}`, definition);
      } catch (error) {
        debug.warn('Failed to fetch exclusive dice definition.', { typeId, path, error });
      }
    }

    return { fetchableTypeIds: loadedTypeIds };
  }
}
