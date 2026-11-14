import type Phaser from 'phaser';
import { readIntegrityChecked, writeIntegrityChecked } from '../utils/SecureStorage';
import type { DungeonBossMinionType, DungeonBossType } from './DungeonEvent';

export const BOSSFIGHT_PROGRESS_KEY = 'arena:bossfightProgress';
export const BOSSFIGHT_MENU_STATE_KEY = 'arena:bossfightMenuState';

export const BOSSFIGHT_BOSSES = ['Magician', 'Leon', 'Basilisk', 'Silence'] as const;
export type BossfightBossType = (typeof BOSSFIGHT_BOSSES)[number];
export const MAX_BOSSFIGHT_LEVEL = 15;

export interface BossfightBossMetadata {
  typeId: BossfightBossType;
  label: string;
  color: string;
}

export const BOSSFIGHT_BOSS_METADATA: Record<BossfightBossType, BossfightBossMetadata> = {
  Magician: { typeId: 'Magician', label: 'MAGICIAN', color: '#b073ff' },
  Leon: { typeId: 'Leon', label: 'LEON', color: '#e63946' },
  Basilisk: { typeId: 'Basilisk', label: 'BASILISK', color: '#6abf69' },
  Silence: { typeId: 'Silence', label: 'SILENCE', color: '#b8bcc4' }
};

export interface BossfightProgress {
  unlockedLevels: Record<BossfightBossType, number>;
  rewardClaims: string[];
}

export interface BossfightMenuState {
  boss: BossfightBossType;
  level: number;
  levels: Record<BossfightBossType, number>;
}

export interface BossfightReward {
  tokens: number;
  chips: number;
}

type BossfightStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type BossMusicBoss = BossfightBossType | DungeonBossType | DungeonBossMinionType;

export interface BossMusicKeys {
  deuciferMusic: string;
  magicianMusic: string;
  leonMusic: string;
  basiliskMusic: string;
  silenceMusic: string;
  arenaMusic: string;
}

export function isBossfightBoss(value: unknown): value is BossfightBossType {
  return typeof value === 'string' && (BOSSFIGHT_BOSSES as readonly string[]).includes(value);
}

export function getBossMusicKey(boss: BossMusicBoss, keys: BossMusicKeys): string {
  if (boss === 'Deucifer' || boss === 'Imp') return keys.deuciferMusic;
  if (boss === 'Magician' || boss === 'Wizard') return keys.magicianMusic;
  if (boss === 'Leon') return keys.leonMusic;
  if (boss === 'Silence') return keys.silenceMusic;
  if (boss === 'Basilisk') return keys.basiliskMusic;
  return keys.arenaMusic;
}

function defaultProgress(): BossfightProgress {
  return {
    unlockedLevels: BOSSFIGHT_BOSSES.reduce((levels, boss) => {
      levels[boss] = 1;
      return levels;
    }, {} as Record<BossfightBossType, number>),
    rewardClaims: []
  };
}

function clampBossfightLevel(level: number): number {
  const floored = Math.floor(Number(level));
  if (Number.isNaN(floored)) return 1;
  return Math.max(1, Math.min(MAX_BOSSFIGHT_LEVEL, floored));
}

export function normalizeBossfightProgress(value: Partial<BossfightProgress> | null | undefined): BossfightProgress {
  const fallback = defaultProgress();
  BOSSFIGHT_BOSSES.forEach((boss) => {
    const raw = value?.unlockedLevels?.[boss];
    fallback.unlockedLevels[boss] = clampBossfightLevel(Number(raw ?? 1) || 1);
  });
  const rewardClaims = Array.isArray(value?.rewardClaims)
    ? value.rewardClaims.filter((entry): entry is string => typeof entry === 'string')
    : [];
  return { unlockedLevels: fallback.unlockedLevels, rewardClaims };
}

export function getBossfightProgress(scene: Phaser.Scene): BossfightProgress {
  const stored = scene.registry.get(BOSSFIGHT_PROGRESS_KEY) as BossfightProgress | undefined;
  if (stored) {
    const normalized = normalizeBossfightProgress(stored);
    scene.registry.set(BOSSFIGHT_PROGRESS_KEY, normalized);
    return normalized;
  }
  try {
    const parsed = readIntegrityChecked<Partial<BossfightProgress>>(BOSSFIGHT_PROGRESS_KEY) ?? {};
    const normalized = normalizeBossfightProgress(parsed);
    scene.registry.set(BOSSFIGHT_PROGRESS_KEY, normalized);
    return normalized;
  } catch {
    return normalizeBossfightProgress(undefined);
  }
}

export function setBossfightProgress(scene: Phaser.Scene, progress: BossfightProgress): BossfightProgress {
  const normalized = normalizeBossfightProgress(progress);
  scene.registry.set(BOSSFIGHT_PROGRESS_KEY, normalized);
  writeIntegrityChecked(BOSSFIGHT_PROGRESS_KEY, normalized);
  return normalized;
}

export function getBossfightHighestUnlockedLevel(scene: Phaser.Scene, boss: BossfightBossType): number {
  return getBossfightProgress(scene).unlockedLevels[boss] ?? 1;
}

export function getBossfightClaimKey(boss: BossfightBossType, level: number): string {
  return `${boss}:${level}`;
}

export function getBossfightRewards(level: number): BossfightReward {
  const boundedLevel = clampBossfightLevel(level);
  return {
    tokens: 2000 + (boundedLevel - 1) * 1000,
    chips: 10 + (boundedLevel - 1) * 5
  };
}

export function getBossfightMenuState(scene: Phaser.Scene, storage?: BossfightStorage): BossfightMenuState {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    if (!target) return { boss: 'Magician', level: 1, levels: normalizeBossfightMenuLevels(scene) };
    const parsed = JSON.parse(target.getItem(BOSSFIGHT_MENU_STATE_KEY) ?? '{}') as unknown;
    const stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Partial<BossfightMenuState>
      : {};
    const boss = isBossfightBoss(stored.boss) ? stored.boss : 'Magician';
    const levels = normalizeBossfightMenuLevels(scene, stored);
    const level = Math.max(1, Math.min(getBossfightHighestUnlockedLevel(scene, boss), levels[boss]));
    return { boss, level, levels };
  } catch {
    return { boss: 'Magician', level: 1, levels: normalizeBossfightMenuLevels(scene) };
  }
}

function normalizeBossfightMenuLevels(
  scene: Phaser.Scene,
  stored?: Partial<BossfightMenuState>
): Record<BossfightBossType, number> {
  const rawLevels = stored?.levels && typeof stored.levels === 'object' && !Array.isArray(stored.levels)
    ? stored.levels
    : undefined;
  const levels = {} as Record<BossfightBossType, number>;
  BOSSFIGHT_BOSSES.forEach((boss) => {
    const unlockedLevel = getBossfightHighestUnlockedLevel(scene, boss);
    const raw = rawLevels?.[boss] ?? (stored?.boss === boss ? stored.level : undefined);
    levels[boss] = Math.max(1, Math.min(unlockedLevel, clampBossfightLevel(Number(raw ?? 1) || 1)));
  });
  return levels;
}

export function saveBossfightMenuState(
  boss: BossfightBossType,
  level: number,
  storage?: BossfightStorage,
  levels?: Record<BossfightBossType, number>
): void {
  try {
    const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    if (!target) return;
    const parsed = JSON.parse(target.getItem(BOSSFIGHT_MENU_STATE_KEY) ?? '{}') as unknown;
    const stored = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Partial<BossfightMenuState>
      : {};
    const nextLevels = {} as Record<BossfightBossType, number>;
    BOSSFIGHT_BOSSES.forEach((candidate) => {
      const raw = levels?.[candidate]
        ?? stored.levels?.[candidate]
        ?? (stored.boss === candidate ? stored.level : undefined);
      nextLevels[candidate] = clampBossfightLevel(Number(raw ?? 1) || 1);
    });
    nextLevels[boss] = clampBossfightLevel(level);
    target.setItem(BOSSFIGHT_MENU_STATE_KEY, JSON.stringify({
      boss,
      level: nextLevels[boss],
      levels: nextLevels
    }));
  } catch {}
}

export function completeBossfightLevel(scene: Phaser.Scene, boss: BossfightBossType, level: number): BossfightProgress {
  const progress = getBossfightProgress(scene);
  const currentUnlocked = progress.unlockedLevels[boss];
  if (level >= currentUnlocked && currentUnlocked < MAX_BOSSFIGHT_LEVEL) {
    progress.unlockedLevels[boss] = Math.min(MAX_BOSSFIGHT_LEVEL, level + 1);
    return setBossfightProgress(scene, progress);
  }
  return progress;
}

export function claimBossfightReward(scene: Phaser.Scene, boss: BossfightBossType, level: number): BossfightReward {
  const progress = getBossfightProgress(scene);
  const claimKey = getBossfightClaimKey(boss, level);
  if (progress.rewardClaims.includes(claimKey)) return { tokens: 0, chips: 0 };
  const reward = getBossfightRewards(level);
  progress.rewardClaims = [...progress.rewardClaims, claimKey];
  setBossfightProgress(scene, progress);
  return reward;
}
