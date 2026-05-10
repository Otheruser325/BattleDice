import type Phaser from 'phaser';
import type { DiceFlags } from '../types/game';
import { DebugManager } from '../utils/DebugManager';

const DICE_FLAGS_PATHS = [
  'gamedata/DiceDefinitions/Flags.json',
  '/gamedata/DiceDefinitions/Flags.json'
];
const DICE_DATA_VERSION = '2026-05-10';

function getDefinitionPath(typeId: string) {
  return `gamedata/DiceDefinitions/${typeId}.dice?v=${DICE_DATA_VERSION}`;
}

export class DiceCatalogLoader {
  static preloadFlags(_scene: Phaser.Scene) {}

  static async loadFetchableDefinitions(scene: Phaser.Scene): Promise<DiceFlags> {
    const debug = DebugManager.scope('DiceCatalog');
    let flags: DiceFlags | undefined;
    for (const path of DICE_FLAGS_PATHS) {
      try {
        const res = await fetch(`${path}?v=${DICE_DATA_VERSION}`, { credentials: 'same-origin', cache: 'no-store' });
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

    await new Promise<void>((resolve, reject) => {
      if (!fetchableTypeIds.length) {
        resolve();
        return;
      }

      const onComplete = () => {
        scene.load.off('loaderror', onError);
        resolve();
      };

      const onError = (_file: unknown, fileObject: { src?: string }) => {
        scene.load.off('complete', onComplete);
        reject(new Error(`Failed to load dice definition from ${fileObject?.src ?? 'unknown source'}.`));
      };

      scene.load.once('complete', onComplete);
      scene.load.once('loaderror', onError);

      fetchableTypeIds.forEach((typeId) => {
        scene.load.json(`dice:${typeId}`, getDefinitionPath(typeId));
      });

      scene.load.start();
    });

    return flags;
  }
}
