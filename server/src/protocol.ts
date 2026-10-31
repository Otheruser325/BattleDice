import { randomInt } from 'node:crypto';
import type { ClientBattleState, LoadoutEntry, MatchRules, OwnerId } from './combat/types.js';

export const ARENA_ROOM_ID = 'arena';
export const MAX_CLIENT_MESSAGE_BYTES = 32 * 1024;
export const LOBBY_CODE_LENGTH = 6;
export const MATCH_PLACEMENT_MS = 30_000;
export const LOBBY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const TOPICS = {
  matchmakingJoin: 'arena:matchmaking:join',
  matchmakingState: 'arena:matchmaking:state',
  multiplayerCreate: 'arena:multiplayer:create',
  multiplayerJoin: 'arena:multiplayer:join',
  multiplayerState: 'arena:multiplayer:state',
  turnSync: 'arena:turn:sync',
  turnState: 'arena:turn:state'
} as const;

export type ClientTopic =
  | 'arena:matchmaking:join'
  | 'arena:multiplayer:create'
  | 'arena:multiplayer:join'
  | 'arena:turn:sync';

export type ServerTopic =
  | 'arena:matchmaking:state'
  | 'arena:multiplayer:state'
  | 'arena:turn:state';

export type MatchMode = 'matchmaking' | 'multiplayer';
export type LobbyAction = 'create' | 'join';

export interface JoinRequest {
  mode: MatchMode;
  lobbyAction?: LobbyAction;
  lobbyCode?: string;
  ruleset: 'classic';
  rules: MatchRules;
  loadoutTypeIds: string[];
  loadout: LoadoutEntry[];
}

export interface TurnDie {
  ownerId: OwnerId;
  instanceId: string;
  typeId: string;
  gridPosition: { row: number; col: number };
}

export interface TurnSyncRequest {
  turn: number;
  dice: TurnDie[];
}

export interface MatchSetupPayload {
  matchId: string;
  selfOwner: OwnerId;
  opponentName: string;
  playerName: string;
  rules: MatchRules;
  phase: 'placement' | 'combat' | 'complete';
  turn: number;
  deadlineAt: number;
  state: ClientBattleState;
  pips: Record<string, number>;
  record: string[];
  result?: 'victory' | 'defeat' | 'draw';
  classLevels: Record<string, number>;
  talentIndices: Record<string, number | null>;
}

export interface ServerEvent {
  status?: 'queued' | 'lobby' | 'matched' | 'failed' | 'disconnected';
  message?: string;
  lobbyCode?: string;
  roomId?: string;
  opponentName?: string;
  match?: MatchSetupPayload;
}

export interface TurnEvent {
  accepted: boolean;
  status: 'accepted' | 'waiting' | 'resolved' | 'rejected' | 'failed';
  message?: string;
  matchId?: string;
  phase?: 'placement' | 'combat' | 'complete';
  turn?: number;
  deadlineAt?: number;
  autoPlaced?: boolean;
  result?: 'victory' | 'defeat' | 'draw';
  state?: ClientBattleState;
  pips?: Record<string, number>;
  classLevels?: Record<string, number>;
  talentIndices?: Record<string, number | null>;
  events?: string[];
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const TYPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,79}$/;
const LOBBY_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const GRID_LIMIT = 5;
const MAX_TURN = 1_000_000;
const MAX_DICE = 25;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function encodeJson(value: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(value));
}

export function readJsonObject(payload: Uint8Array): ValidationResult<Record<string, unknown>> {
  if (payload.byteLength === 0 || payload.byteLength > MAX_CLIENT_MESSAGE_BYTES) {
    return fail('Message is empty or too large.');
  }
  try {
    const parsed: unknown = JSON.parse(textDecoder.decode(payload));
    if (!isRecord(parsed)) return fail('Message must be a JSON object.');
    return { ok: true, value: parsed };
  } catch {
    return fail('Message is not valid JSON.');
  }
}

export function normalizePlayerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  const length = Array.from(name).length;
  if (length === 0 || length > 24) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

export function normalizeLobbyCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return LOBBY_CODE_PATTERN.test(code) ? code : null;
}

export function normalizeTypeId(value: unknown): string | null {
  if (typeof value !== 'string' || !TYPE_ID_PATTERN.test(value)) return null;
  return value;
}

export function generateLobbyCode(): string {
  let code = '';
  for (let index = 0; index < LOBBY_CODE_LENGTH; index += 1) {
    code += LOBBY_CODE_ALPHABET[randomInt(LOBBY_CODE_ALPHABET.length)];
  }
  return code;
}

function readRules(raw: Record<string, unknown>): ValidationResult<MatchRules> {
  if (raw.ruleset !== 'classic') return fail('Unsupported ruleset.');
  const source = isRecord(raw.rules) ? raw.rules : raw;
  if (typeof source.useLevelling !== 'boolean' || typeof source.randomMode !== 'boolean') {
    return fail('Invalid match rules.');
  }
  if (typeof source.turnLimit !== 'number' || !Number.isInteger(source.turnLimit)) {
    return fail('Invalid turn limit.');
  }
  if (source.turnLimit !== -1 && (source.turnLimit < 1 || source.turnLimit > 100)) {
    return fail('Invalid turn limit.');
  }
  return {
    ok: true,
    value: {
      useLevelling: source.useLevelling,
      turnLimit: source.turnLimit,
      randomMode: source.randomMode
    }
  };
}

function readLoadoutEntry(value: unknown, seen: Set<string>): LoadoutEntry | null {
  if (!isRecord(value)) return null;
  const typeId = normalizeTypeId(value.typeId);
  if (!typeId || seen.has(typeId)) return null;
  const classLevel = typeof value.classLevel === 'number' && Number.isInteger(value.classLevel)
    ? value.classLevel
    : 1;
  if (classLevel < 1 || classLevel > 15) return null;
  const rawTalent = value.talentIndex;
  const talentIndex = rawTalent === null || rawTalent === undefined
    ? null
    : typeof rawTalent === 'number' && Number.isInteger(rawTalent) && rawTalent >= 0 && rawTalent <= 20
    ? rawTalent
    : null;
  if (rawTalent !== null && rawTalent !== undefined && talentIndex === null) return null;
  seen.add(typeId);
  return { typeId, classLevel, talentIndex };
}

function readLoadout(raw: Record<string, unknown>): ValidationResult<LoadoutEntry[]> {
  const source = Array.isArray(raw.loadout)
    ? raw.loadout
    : Array.isArray(raw.loadoutTypeIds)
    ? raw.loadoutTypeIds.map((typeId) => ({ typeId, classLevel: 1, talentIndex: null }))
    : null;
  if (!source || source.length !== 5) return fail('Loadout must contain exactly five dice.');

  const loadout: LoadoutEntry[] = [];
  const seen = new Set<string>();
  for (const entry of source) {
    const parsed = readLoadoutEntry(entry, seen);
    if (!parsed) return fail('Loadout contains an invalid dice entry.');
    loadout.push(parsed);
  }
  return { ok: true, value: loadout };
}

export function parseJoinRequest(
  payload: Uint8Array,
  expectedMode: MatchMode,
  expectedAction?: LobbyAction
): ValidationResult<JoinRequest> {
  const parsed = readJsonObject(payload);
  if (!parsed.ok) return parsed;
  const raw = parsed.value;

  if (raw.mode !== expectedMode) return fail('Invalid multiplayer mode.');
  if (expectedAction && raw.lobbyAction !== expectedAction) return fail('Invalid lobby action.');

  const rules = readRules(raw);
  if (!rules.ok) return rules;
  const loadout = readLoadout(raw);
  if (!loadout.ok) return loadout;

  if (expectedMode === 'multiplayer') {
    if (!expectedAction) return fail('Invalid lobby action.');
    const suppliedCode = raw.lobbyCode === undefined ? null : normalizeLobbyCode(raw.lobbyCode);
    if (expectedAction === 'join' && !suppliedCode) return fail('Lobby code must be six valid characters.');
    return {
      ok: true,
      value: {
        mode: expectedMode,
        lobbyAction: expectedAction,
        ...(suppliedCode ? { lobbyCode: suppliedCode } : {}),
        ruleset: 'classic',
        rules: rules.value,
        loadoutTypeIds: loadout.value.map((entry) => entry.typeId),
        loadout: loadout.value
      }
    };
  }

  return {
    ok: true,
    value: {
      mode: expectedMode,
      ruleset: 'classic',
      rules: rules.value,
      loadoutTypeIds: loadout.value.map((entry) => entry.typeId),
      loadout: loadout.value
    }
  };
}

export function parseTurnSync(payload: Uint8Array): ValidationResult<TurnSyncRequest> {
  const parsed = readJsonObject(payload);
  if (!parsed.ok) return parsed;
  const raw = parsed.value;

  if (typeof raw.turn !== 'number' || !Number.isInteger(raw.turn) || raw.turn < 1 || raw.turn > MAX_TURN) {
    return fail('Invalid turn number.');
  }
  if (!Array.isArray(raw.dice) || raw.dice.length > MAX_DICE) {
    return fail('Invalid dice list.');
  }

  const dice: TurnDie[] = [];
  const positions = new Set<string>();
  for (const entry of raw.dice) {
    if (!isRecord(entry)) return fail('Invalid dice entry.');
    if (entry.ownerId !== 'player') return fail('Submit only your own dice.');
    const instanceId = typeof entry.instanceId === 'string' && INSTANCE_ID_PATTERN.test(entry.instanceId)
      ? entry.instanceId
      : null;
    if (!instanceId) return fail('Invalid dice identity.');
    const typeId = normalizeTypeId(entry.typeId);
    if (!typeId) return fail('Invalid dice type.');
    const grid = isRecord(entry.gridPosition) ? entry.gridPosition : entry;
    const row = grid.row;
    const col = grid.col;
    if (
      typeof row !== 'number'
      || typeof col !== 'number'
      || !Number.isInteger(row)
      || !Number.isInteger(col)
      || row < 0
      || row >= GRID_LIMIT
      || col < 0
      || col >= GRID_LIMIT
    ) {
      return fail('Invalid grid position.');
    }
    const positionKey = `${row}:${col}`;
    if (positions.has(positionKey)) return fail('Duplicate board position.');
    positions.add(positionKey);
    dice.push({ ownerId: 'player', instanceId, typeId, gridPosition: { row, col } });
  }

  return { ok: true, value: { turn: raw.turn, dice } };
}

export function rulesMatch(left: MatchRules, right: MatchRules): boolean {
  return left.useLevelling === right.useLevelling
    && left.turnLimit === right.turnLimit
    && left.randomMode === right.randomMode;
}
