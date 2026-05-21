import type Phaser from 'phaser';
import { getDiamonds, setDiamonds } from '../data/dice';

const PROFILE_KEY = 'player:profile';

export interface PlayerProfile {
  username: string;
  trophies: number;
  nameChangesUsed: number;
  createdAt?: string;
  loginReward?: {
    startDate: string;
    claimedDays: number[];
    lastClaimDate?: string;
    lastClaimAt?: string;
  };
}

const DEFAULT_PROFILE: PlayerProfile = {
  username: '',
  trophies: 0,
  nameChangesUsed: 0
};

export class ProfileStore {
  static get(scene: Phaser.Scene): PlayerProfile {
    const stored = scene.registry.get(PROFILE_KEY) as PlayerProfile | undefined;
    if (stored) return stored;
    const loaded = this.load();
    scene.registry.set(PROFILE_KEY, loaded);
    return loaded;
  }

  static set(scene: Phaser.Scene, next: Partial<PlayerProfile>): PlayerProfile {
    const current = this.get(scene);
    const merged = { ...current, ...next };
    if (!merged.createdAt) merged.createdAt = new Date().toISOString();
    scene.registry.set(PROFILE_KEY, merged);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(merged));
    return merged;
  }

  static canAffordNameChange(scene: Phaser.Scene): boolean {
    const profile = this.get(scene);
    if (profile.nameChangesUsed === 0) return true;
    return getDiamonds(scene) >= 50;
  }

  static applyNameChange(scene: Phaser.Scene, username: string): { ok: boolean; cost: number } {
    const trimmed = username.trim().slice(0, 18);
    if (!trimmed) return { ok: false, cost: 0 };
    const profile = this.get(scene);
    const cost = profile.nameChangesUsed === 0 ? 0 : 50;
    if (cost > 0 && getDiamonds(scene) < cost) return { ok: false, cost };
    if (cost > 0) setDiamonds(scene, getDiamonds(scene) - cost);
    this.set(scene, { username: trimmed, nameChangesUsed: profile.nameChangesUsed + 1 });
    return { ok: true, cost };
  }

  private static load(): PlayerProfile {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (!raw) return { ...DEFAULT_PROFILE };
      const parsed = JSON.parse(raw) as Partial<PlayerProfile>;
      return {
        username: typeof parsed.username === 'string' ? parsed.username : '',
        trophies: Math.max(0, Math.floor(Number(parsed.trophies ?? 0) || 0)),
        nameChangesUsed: Math.max(0, Math.floor(Number(parsed.nameChangesUsed ?? 0) || 0)),
        createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : undefined,
        loginReward: parsed.loginReward
      };
    } catch {
      return { ...DEFAULT_PROFILE };
    }
  }
}
