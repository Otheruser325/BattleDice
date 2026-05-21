import type Phaser from 'phaser';
import { AlertManager } from '../utils/AlertManager';

const ACHIEVEMENTS_KEY = 'player:achievements:v1';

export type AchievementId =
  | 'winner'
  | 'veteran'
  | 'master'
  | 'sweatin_it'
  | 'cant_keep_up'
  | 'diceaholic'
  | 'vegas_boy'
  | 'gambolic'
  | 'risksino'
  | 'jackpot'
  | 'lotta_damage'
  | 'darkest_hour';

export interface AchievementState {
  wins: number;
  playtimeMs: number;
  casinoTablesPlayed: number;
  unlocked: Partial<Record<AchievementId, string>>;
}

const DEFAULT_STATE: AchievementState = { wins: 0, playtimeMs: 0, casinoTablesPlayed: 0, unlocked: {} };
const ACHIEVEMENT_LABELS: Record<AchievementId, string> = {
  winner: 'Winner',
  veteran: 'Veteran',
  master: 'Master',
  sweatin_it: "Sweatin' It",
  cant_keep_up: "Can't Keep Up",
  diceaholic: 'Diceaholic',
  vegas_boy: 'Vegas Boy',
  gambolic: 'Gambolic',
  risksino: 'Risksino',
  jackpot: 'Jackpot',
  lotta_damage: 'Lotta Damage',
  darkest_hour: 'In Our Darkest Hour...'
};

export class AchievementStore {
  static get(scene: Phaser.Scene): AchievementState {
    const stored = scene.registry.get(ACHIEVEMENTS_KEY) as AchievementState | undefined;
    if (stored) return stored;
    const loaded = this.load();
    scene.registry.set(ACHIEVEMENTS_KEY, loaded);
    return loaded;
  }

  static mutate(scene: Phaser.Scene, mutator: (state: AchievementState) => AchievementState): AchievementState {
    const next = mutator(this.get(scene));
    scene.registry.set(ACHIEVEMENTS_KEY, next);
    localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(next));
    return next;
  }

  static unlock(scene: Phaser.Scene, id: AchievementId): boolean {
    const current = this.get(scene);
    if (current.unlocked[id]) return false;
    this.mutate(scene, (state) => ({
      ...state,
      unlocked: { ...state.unlocked, [id]: new Date().toISOString() }
    }));
    AlertManager.toast(scene, { type: 'success', bottom: true, durationMs: 2400, message: `Achievement Unlocked\n\n${ACHIEVEMENT_LABELS[id]}` });
    return true;
  }

  private static load(): AchievementState {
    try {
      const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
      if (!raw) return { ...DEFAULT_STATE };
      const parsed = JSON.parse(raw) as Partial<AchievementState>;
      return {
        wins: Math.max(0, Math.floor(Number(parsed.wins ?? 0) || 0)),
        playtimeMs: Math.max(0, Math.floor(Number(parsed.playtimeMs ?? 0) || 0)),
        casinoTablesPlayed: Math.max(0, Math.floor(Number(parsed.casinoTablesPlayed ?? 0) || 0)),
        unlocked: parsed.unlocked ?? {}
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }
}
