import type Phaser from 'phaser';
import type { AppSettings } from '../types/game';

const STORAGE_KEY = 'battle-dice-autoroller:settings';

const DEFAULT_SETTINGS: AppSettings = {
  music: true,
  sfx: true,
  screenShake: true,
  reducedMotion: false
};

export class SettingsStore {
  static get(scene: Phaser.Scene): AppSettings {
    const current = scene.registry.get('settings') as AppSettings | undefined;

    if (current) {
      return { ...DEFAULT_SETTINGS, ...current };
    }

    const loaded = this.load();
    scene.registry.set('settings', loaded);
    return loaded;
  }

  static set(scene: Phaser.Scene, nextSettings: Partial<AppSettings>): AppSettings {
    const merged = { ...this.get(scene), ...nextSettings };
    scene.registry.set('settings', merged);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  }

  static toggle(scene: Phaser.Scene, key: keyof AppSettings): AppSettings {
    const current = this.get(scene);
    return this.set(scene, { [key]: !current[key] });
  }

  static load(): AppSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return { ...DEFAULT_SETTINGS };
      }

      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
}
