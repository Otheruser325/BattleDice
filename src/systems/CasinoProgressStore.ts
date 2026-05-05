import type Phaser from 'phaser';
import type { ChestType } from './CasinoComboTypes';

export interface CasinoProgress {
  chips: number;
  chests: Record<ChestType, number>;
}

const STORAGE_KEY = 'battle-dice-autoroller:casino';
const DEFAULT_PROGRESS: CasinoProgress = { chips: 30, chests: { Bronze: 0, Silver: 0, Gold: 0, Diamond: 0, Master: 0 } };

export class CasinoProgressStore {
  static get(scene: Phaser.Scene): CasinoProgress {
    const current = scene.registry.get('casinoProgress') as CasinoProgress | undefined;
    if (current) return current;
    const loaded = this.load();
    scene.registry.set('casinoProgress', loaded);
    return loaded;
  }

  static set(scene: Phaser.Scene, next: CasinoProgress): CasinoProgress {
    scene.registry.set('casinoProgress', next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  }

  static mutate(scene: Phaser.Scene, fn: (curr: CasinoProgress) => CasinoProgress): CasinoProgress {
    const next = fn(this.get(scene));
    return this.set(scene, next);
  }

  static load(): CasinoProgress {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_PROGRESS };
      return { ...DEFAULT_PROGRESS, ...(JSON.parse(raw) as CasinoProgress) };
    } catch {
      return { ...DEFAULT_PROGRESS };
    }
  }
}
