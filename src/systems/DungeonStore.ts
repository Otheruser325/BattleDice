import type Phaser from 'phaser';
import { DEV_MENU_AVAILABLE } from '../utils/BuildFlags';
import { readIntegrityChecked, writeIntegrityChecked } from '../utils/SecureStorage';
import { DUNGEON_DAILY_TICKETS, DUNGEON_MAX_WAVES, getDungeonEventWindow, normalizeDungeonCarryover, normalizeDungeonLoadout, type DungeonEventWindow, type DungeonRunSave } from './DungeonEvent';

const STORAGE_KEY = 'arena:dungeonProgress';
const REGISTRY_KEY = 'arena:dungeonProgress';
const RUN_STORAGE_KEY = 'arena:dungeonRun';
const RUN_REGISTRY_KEY = 'arena:dungeonRun';
const DEV_STORAGE_KEY = 'arena:dungeonDev';
const DEV_REGISTRY_KEY = 'arena:dungeonDev';

export interface DungeonDevState {
  forceEventActive: boolean;
  cycle: number;
  dungeonCardsEnabled: boolean;
}

export interface DungeonProgress {
  ticketDate: string;
  ticketsRemaining: number;
  bestWave: number;
}

function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function normalizeProgress(value: Partial<DungeonProgress> | null | undefined, today: string): DungeonProgress {
  const ticketDate = typeof value?.ticketDate === 'string' ? value.ticketDate : today;
  const rawTickets = Number(value?.ticketsRemaining ?? DUNGEON_DAILY_TICKETS);
  const ticketsRemaining = ticketDate === today
    ? Math.max(0, Math.floor(Number.isFinite(rawTickets) ? rawTickets : DUNGEON_DAILY_TICKETS))
    : DUNGEON_DAILY_TICKETS;
  return {
    ticketDate: today,
    ticketsRemaining,
    bestWave: Math.max(0, Math.min(DUNGEON_MAX_WAVES, Math.floor(Number(value?.bestWave ?? 0) || 0)))
  };
}

function writeProgress(scene: Phaser.Scene, progress: DungeonProgress): boolean {
  scene.registry.set(REGISTRY_KEY, progress);
  try {
    return writeIntegrityChecked(STORAGE_KEY, progress);
  } catch {
    return false;
  }
}

function saveProgress(scene: Phaser.Scene, progress: DungeonProgress): DungeonProgress {
  writeProgress(scene, progress);
  return progress;
}

function normalizeDungeonDevState(value: Partial<DungeonDevState> | null | undefined): DungeonDevState {
  const rawCycle = Number(value?.cycle);
  return {
    forceEventActive: value?.forceEventActive === true,
    cycle: Number.isFinite(rawCycle) ? Math.max(0, Math.floor(rawCycle)) : 0,
    dungeonCardsEnabled: value?.dungeonCardsEnabled !== false
  };
}

function saveDungeonDevState(scene: Phaser.Scene, state: DungeonDevState): DungeonDevState {
  scene.registry.set(DEV_REGISTRY_KEY, state);
  writeIntegrityChecked(DEV_STORAGE_KEY, state);
  return state;
}

export function getDungeonDevState(scene: Phaser.Scene): DungeonDevState {
  if (!DEV_MENU_AVAILABLE) return { forceEventActive: false, cycle: 0, dungeonCardsEnabled: true };
  const cached = scene.registry.get(DEV_REGISTRY_KEY) as DungeonDevState | undefined;
  const stored = cached ?? readIntegrityChecked<Partial<DungeonDevState>>(DEV_STORAGE_KEY);
  const normalized = normalizeDungeonDevState(stored);
  if (!cached || cached.forceEventActive !== normalized.forceEventActive || cached.cycle !== normalized.cycle || cached.dungeonCardsEnabled !== normalized.dungeonCardsEnabled) {
    saveDungeonDevState(scene, normalized);
  }
  return normalized;
}

export function setDungeonDevState(scene: Phaser.Scene, patch: Partial<DungeonDevState>): DungeonDevState {
  if (!DEV_MENU_AVAILABLE) return { forceEventActive: false, cycle: 0, dungeonCardsEnabled: true };
  const current = getDungeonDevState(scene);
  return saveDungeonDevState(scene, normalizeDungeonDevState({ ...current, ...patch }));
}

export function getDungeonEventWindowForScene(scene: Phaser.Scene, now = new Date()): DungeonEventWindow {
  const dev = getDungeonDevState(scene);
  return getDungeonEventWindow(now, { forceActive: dev.forceEventActive, cycle: dev.cycle });
}

export function getDungeonProgress(scene: Phaser.Scene): DungeonProgress {
  const today = todayKey();
  const cached = scene.registry.get(REGISTRY_KEY) as DungeonProgress | undefined;
  const stored = cached ?? (() => {
    try {
      return readIntegrityChecked<Partial<DungeonProgress>>(STORAGE_KEY);
    } catch {
      return undefined;
    }
  })();
  const normalized = normalizeProgress(stored, today);
  if (!cached || cached.ticketDate !== normalized.ticketDate || cached.ticketsRemaining !== normalized.ticketsRemaining || cached.bestWave !== normalized.bestWave) {
    saveProgress(scene, normalized);
  }
  return normalized;
}

export function consumeDungeonTicket(scene: Phaser.Scene, now = new Date()): DungeonProgress | null {
  const progress = getDungeonProgress(scene);
  if (progress.ticketDate !== todayKey(now) || progress.ticketsRemaining <= 0) return null;
  const next = { ...progress, ticketsRemaining: progress.ticketsRemaining - 1 };
  if (!writeProgress(scene, next)) {
    scene.registry.set(REGISTRY_KEY, progress);
    return null;
  }
  return next;
}

export function grantDungeonTickets(scene: Phaser.Scene, amount: number): DungeonProgress {
  const progress = getDungeonProgress(scene);
  if (!DEV_MENU_AVAILABLE) return progress;
  const grant = Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  if (grant <= 0) return progress;
  return saveProgress(scene, { ...progress, ticketsRemaining: progress.ticketsRemaining + grant });
}

export function recordDungeonBestWave(scene: Phaser.Scene, wave: number): DungeonProgress {
  const progress = getDungeonProgress(scene);
  const bestWave = Math.max(progress.bestWave, Math.max(0, Math.min(DUNGEON_MAX_WAVES, Math.floor(wave))));
  return bestWave === progress.bestWave ? progress : saveProgress(scene, { ...progress, bestWave });
}

export function normalizeDungeonRun(value: Partial<DungeonRunSave> | null | undefined): DungeonRunSave | null {
  if (!value || typeof value !== 'object') return null;
  const eventKey = typeof value.eventKey === 'string' && value.eventKey.length > 0 ? value.eventKey : '';
  if (!eventKey) return null;
  const carryover = normalizeDungeonCarryover(value.carryover);
  const wave = Math.max(1, Math.min(DUNGEON_MAX_WAVES, Math.floor(Number(value.wave) || 1)));
  if (wave > 1 && !carryover) return null;
  const config = value.config && typeof value.config === 'object' ? value.config : null;
  const loadout = normalizeDungeonLoadout(value.loadout);
  return {
    eventKey,
    wave,
    carryover,
    config: {
      randomMode: config?.randomMode === true,
      randomizeLoadout: config?.randomizeLoadout === true,
      useLevelling: config?.useLevelling === true
    },
    ...(loadout ? { loadout } : {}),
    savedAt: Number.isFinite(value.savedAt) ? Number(value.savedAt) : Date.now()
  };
}

export function getDungeonRun(scene: Phaser.Scene): DungeonRunSave | null {
  const cached = scene.registry.get(RUN_REGISTRY_KEY) as DungeonRunSave | undefined;
  if (cached) return normalizeDungeonRun(cached);
  try {
    const stored = readIntegrityChecked<Partial<DungeonRunSave>>(RUN_STORAGE_KEY);
    const normalized = normalizeDungeonRun(stored);
    if (normalized) scene.registry.set(RUN_REGISTRY_KEY, normalized);
    return normalized;
  } catch {
    return null;
  }
}

export function saveDungeonRun(scene: Phaser.Scene, run: DungeonRunSave): boolean {
  const normalized = normalizeDungeonRun(run);
  if (!normalized) return false;
  scene.registry.set(RUN_REGISTRY_KEY, normalized);
  return writeVerified(RUN_STORAGE_KEY, normalized);
}

export function clearDungeonRun(scene: Phaser.Scene): boolean {
  scene.registry.remove(RUN_REGISTRY_KEY);
  try {
    if (typeof localStorage === 'undefined') return true;
    localStorage.removeItem(RUN_STORAGE_KEY);
    return localStorage.getItem(RUN_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

const CARD_SPEND_STORAGE_KEY = 'arena:dungeonCardSpend';
const CARD_SPEND_REGISTRY_KEY = 'arena:dungeonCardSpend';

export interface DungeonCardSpend {
  eventKey: string;
  wave: number;
  turn: number;
  cost: number;
  shufflesUsed: number;
  walletBefore?: number;
  walletAfter?: number;
  debited?: boolean;
}

function writeVerified<T>(key: string, value: T): boolean {
  try {
    if (!writeIntegrityChecked(key, value)) return false;
    return JSON.stringify(readIntegrityChecked<T>(key)) === JSON.stringify(value);
  } catch {
    return false;
  }
}

function normalizeDungeonCardSpend(value: Partial<DungeonCardSpend> | null | undefined): DungeonCardSpend | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.eventKey !== 'string' || value.eventKey.length === 0) return null;
  const cost = Math.max(0, Math.floor(Number(value.cost) || 0));
  if (cost <= 0) return null;
  const walletBefore = Number.isFinite(Number(value.walletBefore))
    ? Math.max(0, Math.floor(Number(value.walletBefore)))
    : undefined;
  const walletAfter = Number.isFinite(Number(value.walletAfter))
    ? Math.max(0, Math.floor(Number(value.walletAfter)))
    : undefined;
  return {
    eventKey: value.eventKey,
    wave: Math.max(1, Math.min(DUNGEON_MAX_WAVES, Math.floor(Number(value.wave) || 1))),
    turn: Math.max(0, Math.floor(Number(value.turn) || 0)),
    cost,
    shufflesUsed: Math.max(0, Math.floor(Number(value.shufflesUsed) || 0)),
    ...(walletBefore !== undefined ? { walletBefore } : {}),
    ...(walletAfter !== undefined ? { walletAfter } : {}),
    ...(value.debited === true ? { debited: true } : {})
  };
}

export function beginDungeonCardSpend(scene: Phaser.Scene, spend: Partial<DungeonCardSpend>): DungeonCardSpend | null {
  if (getDungeonCardSpend(scene)) return null;
  const normalized = normalizeDungeonCardSpend(spend);
  if (!normalized) return null;
  if (!writeVerified(CARD_SPEND_STORAGE_KEY, normalized)) return null;
  scene.registry.set(CARD_SPEND_REGISTRY_KEY, normalized);
  return normalized;
}

export function markDungeonCardSpendDebited(scene: Phaser.Scene, spend: DungeonCardSpend): DungeonCardSpend | null {
  const current = getDungeonCardSpend(scene);
  if (!current) return null;
  const normalized = normalizeDungeonCardSpend({ ...current, cost: spend.cost, shufflesUsed: spend.shufflesUsed, debited: true });
  if (!normalized || !writeVerified(CARD_SPEND_STORAGE_KEY, normalized)) return null;
  scene.registry.set(CARD_SPEND_REGISTRY_KEY, normalized);
  return normalized;
}

export function getDungeonCardSpend(scene: Phaser.Scene): DungeonCardSpend | null {
  const cached = scene.registry.get(CARD_SPEND_REGISTRY_KEY) as Partial<DungeonCardSpend> | undefined;
  if (cached) return normalizeDungeonCardSpend(cached);
  try {
    return normalizeDungeonCardSpend(readIntegrityChecked<Partial<DungeonCardSpend>>(CARD_SPEND_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearDungeonCardSpend(scene: Phaser.Scene): void {
  scene.registry.remove(CARD_SPEND_REGISTRY_KEY);
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(CARD_SPEND_STORAGE_KEY);
  } catch {}
}

export function discardDungeonRunCache(scene: Phaser.Scene): void {
  scene.registry.remove(RUN_REGISTRY_KEY);
}

export function resolveDungeonCardSpendRefund(input: {
  spend: DungeonCardSpend | null;
  eventKey: string;
  wave: number;
  savedShufflesUsed: number;
}): number {
  const spend = normalizeDungeonCardSpend(input.spend);
  if (!spend) return 0;
  if (spend.eventKey !== input.eventKey) return spend.cost;
  // A later saved wave can still prove the charge; the cumulative shuffle count is the authority.
  const savedShufflesUsed = Number.isFinite(input.savedShufflesUsed)
    ? Math.max(0, Math.floor(input.savedShufflesUsed))
    : 0;
  return savedShufflesUsed < spend.shufflesUsed ? spend.cost : 0;
}

export function resolveDungeonCardWalletRefund(spend: DungeonCardSpend | null, currentDiamonds: number): number {
  const normalized = normalizeDungeonCardSpend(spend);
  if (!normalized) return 0;
  if (normalized.debited === true) return normalized.cost;
  if (normalized.walletBefore === undefined) return normalized.cost;
  const current = Number.isFinite(currentDiamonds) ? Math.max(0, Math.floor(currentDiamonds)) : 0;
  if (normalized.walletAfter !== undefined && current <= normalized.walletAfter) return normalized.cost;
  return Math.min(normalized.cost, Math.max(0, normalized.walletBefore - current));
}

export interface DungeonCardRefundSettlement {
  refunded: number;
  pending: boolean;
  clear: boolean;
}

/**
 * Applies a verified refund and reports whether the escrow may be cleared.
 * Escrow stays on disk when the wallet write fails so a resumed run can retry it.
 */
export function applyDungeonCardSpendRefund(input: {
  spend: DungeonCardSpend | null;
  eventKey: string;
  wave: number;
  savedShufflesUsed: number;
  currentDiamonds: number;
  persistRefund: (nextDiamonds: number) => boolean;
}): DungeonCardRefundSettlement {
  const committed = resolveDungeonCardSpendRefund({
    spend: input.spend,
    eventKey: input.eventKey,
    wave: input.wave,
    savedShufflesUsed: input.savedShufflesUsed
  });
  if (committed <= 0) return { refunded: 0, pending: false, clear: true };
  const refund = resolveDungeonCardWalletRefund(input.spend, input.currentDiamonds);
  if (refund <= 0) return { refunded: 0, pending: false, clear: true };
  if (!input.persistRefund(input.currentDiamonds + refund)) {
    return { refunded: 0, pending: true, clear: false };
  }
  return { refunded: refund, pending: false, clear: true };
}
