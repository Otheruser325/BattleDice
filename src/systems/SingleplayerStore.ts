import type Phaser from 'phaser';
import { readIntegrityChecked, writeIntegrityChecked } from '../utils/SecureStorage';

export const BOT_DIFFICULTIES = ['Baby', 'Easy', 'Medium', 'Hard', 'Nightmare'] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

export const BOT_DIFFICULTY_CLASSES: Record<BotDifficulty, [number, number]> = {
  Baby: [1, 1],
  Easy: [1, 3],
  Medium: [3, 6],
  Hard: [5, 9],
  Nightmare: [7, 12]
};

export const BOT_FIRST_WIN_REWARDS: Record<BotDifficulty, { tokens: number; chips: number }> = {
  Baby: { tokens: 500, chips: 20 },
  Easy: { tokens: 1_000, chips: 40 },
  Medium: { tokens: 2_000, chips: 60 },
  Hard: { tokens: 5_000, chips: 80 },
  Nightmare: { tokens: 10_000, chips: 100 }
};

export const BOT_VICTORY_TOKEN_REWARDS: Record<BotDifficulty, number> = {
  Baby: 250,
  Easy: 500,
  Medium: 750,
  Hard: 1_000,
  Nightmare: 1_500
};

export const BOT_FIRST_WIN_KEY = 'arena:claimedBotFirstWins';
export const BOT_TURN_COUNTS = [3, 5, 7, 10, -1] as const;
export type BotTurnCount = (typeof BOT_TURN_COUNTS)[number];

export interface VersusBotConfig {
  difficulty: BotDifficulty;
  useLevelling: boolean;
  randomMode: boolean;
  randomizeLoadoutAndClassUps: boolean;
  turnCount: BotTurnCount;
}

export const DEFAULT_VERSUS_BOT_CONFIG: VersusBotConfig = {
  difficulty: 'Medium',
  useLevelling: true,
  randomMode: false,
  randomizeLoadoutAndClassUps: false,
  turnCount: -1
};

export function isBotDifficulty(value: unknown): value is BotDifficulty {
  return typeof value === 'string' && (BOT_DIFFICULTIES as readonly string[]).includes(value);
}

export function normalizeBotTurnCount(value: unknown): BotTurnCount {
  return typeof value === 'number' && (BOT_TURN_COUNTS as readonly number[]).includes(value)
    ? value as BotTurnCount
    : -1;
}

export function normalizeVersusBotConfig(
  value: Partial<VersusBotConfig> | null | undefined
): VersusBotConfig {
  return {
    difficulty: isBotDifficulty(value?.difficulty) ? value.difficulty : DEFAULT_VERSUS_BOT_CONFIG.difficulty,
    useLevelling: typeof value?.useLevelling === 'boolean' ? value.useLevelling : DEFAULT_VERSUS_BOT_CONFIG.useLevelling,
    randomMode: typeof value?.randomMode === 'boolean' ? value.randomMode : DEFAULT_VERSUS_BOT_CONFIG.randomMode,
    randomizeLoadoutAndClassUps: typeof value?.randomizeLoadoutAndClassUps === 'boolean'
      ? value.randomizeLoadoutAndClassUps
      : DEFAULT_VERSUS_BOT_CONFIG.randomizeLoadoutAndClassUps,
    turnCount: normalizeBotTurnCount(value?.turnCount)
  };
}

export function shouldRandomizeVersusBotLoadout(config: Pick<VersusBotConfig, 'randomizeLoadoutAndClassUps'>): boolean {
  return config.randomizeLoadoutAndClassUps === true;
}

export function isVersusBotFirstWinEligible(
  config: Pick<VersusBotConfig, 'randomMode' | 'randomizeLoadoutAndClassUps'>
): boolean {
  return config.randomMode !== true && config.randomizeLoadoutAndClassUps !== true;
}

export class SingleplayerStore {
  private current: VersusBotConfig = { ...DEFAULT_VERSUS_BOT_CONFIG };

  get difficulty(): BotDifficulty {
    return this.current.difficulty;
  }

  set difficulty(value: BotDifficulty) {
    if (isBotDifficulty(value)) this.current = { ...this.current, difficulty: value };
  }

  get useLevelling(): boolean {
    return this.current.useLevelling;
  }

  set useLevelling(value: boolean) {
    this.current = { ...this.current, useLevelling: value === true };
  }

  get randomMode(): boolean {
    return this.current.randomMode;
  }

  set randomMode(value: boolean) {
    this.current = { ...this.current, randomMode: value === true };
  }

  get randomizeLoadoutAndClassUps(): boolean {
    return this.current.randomizeLoadoutAndClassUps;
  }

  set randomizeLoadoutAndClassUps(value: boolean) {
    this.current = { ...this.current, randomizeLoadoutAndClassUps: value === true };
  }

  get turnCount(): BotTurnCount {
    return this.current.turnCount;
  }

  set turnCount(value: number) {
    this.current = { ...this.current, turnCount: normalizeBotTurnCount(value) };
  }

  get config(): VersusBotConfig {
    return { ...this.current };
  }

  configure(value: Partial<VersusBotConfig>): VersusBotConfig {
    this.current = normalizeVersusBotConfig({ ...this.current, ...value });
    return this.config;
  }

  shouldRandomizeLoadoutAndClassUps(): boolean {
    return shouldRandomizeVersusBotLoadout(this.current);
  }

  getClassRange(): [number, number] {
    return [...BOT_DIFFICULTY_CLASSES[this.current.difficulty]] as [number, number];
  }

  getFirstWinReward(difficulty: BotDifficulty = this.current.difficulty): { tokens: number; chips: number } {
    const reward = BOT_FIRST_WIN_REWARDS[difficulty]
      ?? BOT_FIRST_WIN_REWARDS[this.current.difficulty]
      ?? { tokens: 0, chips: 0 };
    return { ...reward };
  }

  getVictoryTokenReward(difficulty: BotDifficulty = this.current.difficulty): number {
    return BOT_VICTORY_TOKEN_REWARDS[difficulty] ?? BOT_VICTORY_TOKEN_REWARDS[this.current.difficulty] ?? 0;
  }

  isFirstWinEligible(): boolean {
    return isVersusBotFirstWinEligible(this.current);
  }

  getFirstWinAward(
    difficulty: BotDifficulty,
    alreadyClaimed: boolean
  ): { tokens: number; chips: number } | null {
    if (alreadyClaimed || !this.isFirstWinEligible()) return null;
    return this.getFirstWinReward(difficulty);
  }

  getClaimedBotFirstWins(scene: Phaser.Scene): BotDifficulty[] {
    const stored = scene.registry.get(BOT_FIRST_WIN_KEY) as unknown;
    if (Array.isArray(stored)) {
      const normalized = this.normalizeClaimedDifficulties(stored);
      scene.registry.set(BOT_FIRST_WIN_KEY, normalized);
      return normalized;
    }
    try {
      const normalized = this.normalizeClaimedDifficulties(readIntegrityChecked<unknown>(BOT_FIRST_WIN_KEY));
      scene.registry.set(BOT_FIRST_WIN_KEY, normalized);
      return normalized;
    } catch {
      return [];
    }
  }

  hasClaimedBotFirstWin(scene: Phaser.Scene, difficulty: BotDifficulty): boolean {
    return this.getClaimedBotFirstWins(scene).includes(difficulty);
  }

  markBotFirstWinClaimed(scene: Phaser.Scene, difficulty: BotDifficulty): BotDifficulty[] {
    const next = [...new Set([...this.getClaimedBotFirstWins(scene), difficulty])];
    scene.registry.set(BOT_FIRST_WIN_KEY, next);
    writeIntegrityChecked(BOT_FIRST_WIN_KEY, next);
    return next;
  }

  private normalizeClaimedDifficulties(value: unknown): BotDifficulty[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter(isBotDifficulty))];
  }
}
