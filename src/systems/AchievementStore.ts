import type Phaser from 'phaser';

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
  | 'darkest_hour'
  | 'challenger'
  | 'problem_solver'
  | 'demonic_torment'
  | 'getting_stronger'
  | 'augmented'
  | 'maximum_power';

export interface AchievementState {
  wins: number;
  playtimeMs: number;
  casinoTablesPlayed: number;
  dailyChallengeWins: number;
  unlocked: Partial<Record<AchievementId, string>>;
}

const DEFAULT_STATE: AchievementState = { wins: 0, playtimeMs: 0, casinoTablesPlayed: 0, dailyChallengeWins: 0, unlocked: {} };

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
        dailyChallengeWins: Math.max(0, Math.floor(Number((parsed as Partial<AchievementState>).dailyChallengeWins ?? 0) || 0)),
        unlocked: parsed.unlocked ?? {}
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }
}
