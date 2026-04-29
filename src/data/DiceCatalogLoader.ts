import type Phaser from 'phaser';
import { DICE_FLAGS_CACHE_KEY } from './dice';
import type { DiceFlags } from '../types/game';
import { DebugManager } from '../utils/DebugManager';

const DICE_FLAGS_PATH = '/gamedata/DiceDefinitions/Flags.json';

function getDefinitionPath(typeId: string) {
  return `/gamedata/DiceDefinitions/${typeId}.dice`;
}

export class DiceCatalogLoader {
  static preloadFlags(scene: Phaser.Scene) {
    scene.load.json(DICE_FLAGS_CACHE_KEY, DICE_FLAGS_PATH);
  }

  static async loadFetchableDefinitions(scene: Phaser.Scene): Promise<DiceFlags> {
    const debug = DebugManager.scope('DiceCatalog');
    const flags = scene.cache.json.get(DICE_FLAGS_CACHE_KEY) as DiceFlags | undefined;

    if (!flags || !Array.isArray(flags.fetchableTypeIds)) {
      throw new Error('Dice Flags.json is missing or malformed.');
    }

    const fetchableTypeIds = [...new Set(flags.fetchableTypeIds)]
      .filter((typeId): typeId is string => typeof typeId === 'string')
      .map((typeId) => typeId.trim())
      .filter((typeId) => /^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(typeId))
      .slice(0, 32);
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
