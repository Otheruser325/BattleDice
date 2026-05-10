import Phaser from 'phaser';
import type { ChestType } from './CasinoComboTypes';

export interface FivesHandState {
  dice: number[];
  locks: boolean[];
  rollsLeft: number;
  tableActive: boolean;
}

export interface CasinoProgress {
  chips: number;
  chests: Record<ChestType, number>;
  fivesHand: FivesHandState | null;
}

const STORAGE_KEY = 'battle-dice-autoroller:casino';
const DEFAULT_CHESTS: Record<ChestType, number> = { Bronze: 0, Silver: 0, Gold: 0, Diamond: 0, Master: 0 };
const DEFAULT_PROGRESS: CasinoProgress = { chips: 30, chests: DEFAULT_CHESTS, fivesHand: null };

function normalizeFivesHand(value: unknown): FivesHandState | null {
  if (!value || typeof value !== 'object') return null;
  const hand = value as Partial<FivesHandState>;
  if (!Array.isArray(hand.dice) || !Array.isArray(hand.locks)) return null;

  const dice = hand.dice.slice(0, 5).map((pip) => Phaser.Math.Clamp(Math.floor(Number(pip) || 1), 1, 6));
  const locks = hand.locks.slice(0, 5).map(Boolean);
  if (dice.length !== 5 || locks.length !== 5) return null;

  return {
    dice,
    locks,
    rollsLeft: Phaser.Math.Clamp(Math.floor(Number(hand.rollsLeft) || 0), 0, 3),
    tableActive: Boolean(hand.tableActive)
  };
}

function normalizeProgress(value: Partial<CasinoProgress> | null | undefined): CasinoProgress {
  return {
    chips: Math.max(0, Math.floor(Number(value?.chips ?? DEFAULT_PROGRESS.chips) || 0)),
    chests: { ...DEFAULT_CHESTS, ...(value?.chests ?? {}) },
    fivesHand: normalizeFivesHand(value?.fivesHand)
  };
}

export class CasinoProgressStore {
  static get(scene: Phaser.Scene): CasinoProgress {
    const current = scene.registry.get('casinoProgress') as CasinoProgress | undefined;
    if (current) return current;
    const loaded = this.load();
    scene.registry.set('casinoProgress', loaded);
    return loaded;
  }

  static set(scene: Phaser.Scene, next: CasinoProgress): CasinoProgress {
    const normalized = normalizeProgress(next);
    scene.registry.set('casinoProgress', normalized);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  static mutate(scene: Phaser.Scene, fn: (curr: CasinoProgress) => CasinoProgress): CasinoProgress {
    const next = fn(this.get(scene));
    return this.set(scene, next);
  }

  static load(): CasinoProgress {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeProgress(DEFAULT_PROGRESS);
      return normalizeProgress(JSON.parse(raw) as Partial<CasinoProgress>);
    } catch {
      return normalizeProgress(DEFAULT_PROGRESS);
    }
  }
}
