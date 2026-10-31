import { WSClient } from '@rivalis/browser';
import { BUILD_ENV } from '../utils/BuildEnv';
import { DebugManager } from '../utils/DebugManager';
import type { MatchBattleState } from '../types/game';

export type ArenaMultiplayerTopic =
  | 'arena:matchmaking:join'
  | 'arena:matchmaking:state'
  | 'arena:multiplayer:create'
  | 'arena:multiplayer:join'
  | 'arena:multiplayer:state'
  | 'arena:turn:sync'
  | 'arena:turn:state';

type ConnectionState = 'disabled' | 'connecting' | 'connected' | 'queued' | 'lobby' | 'matched' | 'disconnected' | 'failed';
function readTrimmedEnv(key: string): string {
  const value = BUILD_ENV[key];
  return typeof value === 'string' ? value.trim() : '';
}

function readRuntimeTicket(): string {
  const injected = (globalThis as { __RIVALIS_TICKET__?: unknown }).__RIVALIS_TICKET__;
  return typeof injected === 'string' ? injected.trim() : '';
}

function deriveIdentityEndpoint(ticketEndpoint: string): string {
  const match = ticketEndpoint.trim().match(/^(.*\/api\/)rivalis-ticket\/?$/);
  return match ? `${match[1]}multiplayer/identity` : '';
}

function getRivalisEndpointError(endpoint: string): string {
  if (!endpoint) return 'Rivalis endpoint must be configured for multiplayer.';

  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      return 'Rivalis endpoint must start with ws:// or wss://.';
    }
  } catch {
    return 'Rivalis endpoint is not a valid WebSocket URL.';
  }

  return '';
}

export interface ArenaMultiplayerStatus {
  state: ConnectionState;
  message: string;
  lobbyCode?: string;
  roomId?: string;
}

export interface ArenaMultiplayerRules {
  useLevelling: boolean;
  turnLimit: number;
  randomMode: boolean;
}

export interface ArenaMultiplayerLoadoutEntry {
  typeId: string;
  classLevel: number;
  talentIndex: number | null;
}

export interface ArenaMultiplayerJoinOptions {
  mode: 'matchmaking' | 'multiplayer';
  lobbyAction?: 'create' | 'join';
  lobbyCode?: string;
  ruleset: 'classic';
  rules: ArenaMultiplayerRules;
  loadout: ArenaMultiplayerLoadoutEntry[];
}

export interface ArenaMultiplayerMatchSetup {
  matchId: string;
  selfOwner: 'player' | 'enemy';
  opponentName: string;
  playerName: string;
  rules: ArenaMultiplayerRules;
  phase: 'placement' | 'combat' | 'complete';
  turn: number;
  deadlineAt: number;
  state: MatchBattleState;
  pips: Record<string, number>;
  record?: string[];
  result?: 'victory' | 'defeat' | 'draw';
  classLevels: Record<string, number>;
  talentIndices: Record<string, number | null>;
}

export interface ArenaMultiplayerCombatEvent {
  accepted?: boolean;
  status: 'accepted' | 'waiting' | 'resolved' | 'rejected' | 'failed';
  message?: string;
  matchId?: string;
  phase?: 'placement' | 'combat' | 'complete';
  turn?: number;
  deadlineAt?: number;
  autoPlaced?: boolean;
  result?: 'victory' | 'defeat' | 'draw';
  state?: unknown;
  pips?: Record<string, number>;
  classLevels?: Record<string, number>;
  talentIndices?: Record<string, number | null>;
  events?: string[];
}

type ArenaMultiplayerServerEvent = {
  status?: 'queued' | 'lobby' | 'matched' | 'failed' | 'disconnected';
  message?: string;
  lobbyCode?: string;
  roomId?: string;
  opponentName?: string;
  match?: ArenaMultiplayerMatchSetup;
};

export interface ArenaMultiplayerTurnResolution extends ArenaMultiplayerCombatEvent {
  accepted: boolean;
}

export interface ArenaMultiplayerHandlers {
  onMatch?: (match: ArenaMultiplayerMatchSetup) => void;
  onCombat?: (event: ArenaMultiplayerCombatEvent) => void;
}

interface PendingTurnResolution {
  resolve: (resolution: ArenaMultiplayerTurnResolution) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class ArenaMultiplayerClient {
  private readonly debug = DebugManager.scope('ArenaMultiplayer');
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly endpoint = readTrimmedEnv('VITE_RIVALIS_WS_URL');
  private readonly ticketEndpoint = readTrimmedEnv('VITE_RIVALIS_TICKET_ENDPOINT');
  private readonly identityEndpoint = readTrimmedEnv('VITE_RIVALIS_IDENTITY_ENDPOINT')
    || deriveIdentityEndpoint(this.ticketEndpoint);
  private readonly endpointError = getRivalisEndpointError(this.endpoint);
  private runtimeTicket = readRuntimeTicket();
  private client: WSClient<ArenaMultiplayerTopic> | null = null;
  private socketOpen = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private manualDisconnect = false;
  private statusCallback: ((status: ArenaMultiplayerStatus) => void) | undefined;
  private displayName: string | undefined;
  private pendingJoin: ArenaMultiplayerJoinOptions | null = null;
  private pendingTurnResolution: PendingTurnResolution | null = null;
  private handlers: ArenaMultiplayerHandlers = {};
  private status: ArenaMultiplayerStatus = {
    state: this.configured ? 'disconnected' : 'disabled',
    message: this.configured ? 'Rivalis ready.' : this.getConfigurationMessage()
  };

  get configured(): boolean {
    return Boolean(!this.endpointError && (this.runtimeTicket || this.ticketEndpoint));
  }

  getStatus(): ArenaMultiplayerStatus {
    return { ...this.status };
  }

  setHandlers(handlers: ArenaMultiplayerHandlers) {
    this.handlers = handlers;
  }

  async connect(onStatus?: (status: ArenaMultiplayerStatus) => void, displayName?: string): Promise<void> {
    this.statusCallback = onStatus;
    this.displayName = displayName;
    this.manualDisconnect = false;
    this.clearReconnectTimer();
    if (!this.configured) {
      this.setStatus('disabled', this.getConfigurationMessage(), onStatus);
      return;
    }

    if (this.socketOpen) {
      this.setStatus('connected', 'Connected to Rivalis.', onStatus);
      return;
    }

    if (this.client) {
      this.setStatus('connecting', 'Connecting to Rivalis...', onStatus);
      return;
    }

    await this.syncGuestIdentity(displayName);
    const ticket = await this.resolveTicket();
    if (!ticket) {
      this.setStatus('failed', 'Rivalis ticket could not be obtained from the server.', onStatus);
      return;
    }

    this.client = new WSClient<ArenaMultiplayerTopic>(this.endpoint, {
      reconnect: { maxAttempts: this.getReconnectMaxAttempts(), baseDelayMs: 500, maxDelayMs: 5000 },
      ticketSource: 'protocol',
      getTicket: async () => {
        const fresh = await this.resolveTicket(false);
        if (!fresh) throw new Error('A fresh Rivalis ticket could not be obtained.');
        return fresh;
      }
    });
    this.client.on('client:connect', () => {
      const pendingJoin = this.pendingJoin;
      this.socketOpen = true;
      this.reconnectAttempt = 0;
      this.clearReconnectTimer();
      this.setStatus('connected', 'Connected to Rivalis.', onStatus);
      if (pendingJoin) this.sendJoin(pendingJoin);
    });
    this.client.on('client:disconnect', (payload) => {
      this.socketOpen = false;
      const reason = this.decoder.decode(payload);
      this.setStatus('disconnected', reason ? `Rivalis disconnected: ${reason}` : 'Rivalis disconnected.', onStatus);
    });
    this.client.on('client:kicked', (info) => {
      this.socketOpen = false;
      this.manualDisconnect = true;
      this.clearReconnectTimer();
      this.client = null;
      this.setStatus('failed', `Rivalis rejected the room: ${info.reason || info.code}`, onStatus);
    });
    this.client.on('client:reconnecting', (payload) => this.setStatus('connecting', `Reconnecting to Rivalis (${this.decoder.decode(payload)})...`, onStatus));
    this.client.on('client:reconnect_failed', () => {
      this.socketOpen = false;
      this.client = null;
      this.scheduleReconnect(onStatus);
    });
    this.client.on('arena:matchmaking:state', (payload) => this.handleServerState(payload, onStatus));
    this.client.on('arena:multiplayer:state', (payload) => this.handleServerState(payload, onStatus));
    this.client.on('arena:turn:state', (payload) => this.handleTurnResolution(payload));
    this.setStatus('connecting', 'Connecting to Rivalis...', onStatus);
    try {
      this.client.connect(ticket);
    } catch (error) {
      this.socketOpen = false;
      this.client = null;
      const message = error instanceof Error ? error.message : 'Unable to start Rivalis connection.';
      this.setStatus('failed', message, onStatus);
    }
  }

  disconnect() {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.resolvePendingTurn({ accepted: false, status: 'failed', message: 'Multiplayer session disconnected.' });
    this.client?.disconnect();
    this.client = null;
    this.socketOpen = false;
    this.pendingJoin = null;
    this.status = {
      state: this.configured ? 'disconnected' : 'disabled',
      message: this.configured ? 'Rivalis disconnected.' : this.getConfigurationMessage()
    };
  }

  join(options: ArenaMultiplayerJoinOptions) {
    this.pendingJoin = options;
    if (!this.socketOpen) {
      this.debug.warn('Join deferred because Rivalis is not connected yet.', options);
      return;
    }
    this.sendJoin(options);
  }

  async submitTurn(payload: unknown, timeoutMs = 8_000): Promise<ArenaMultiplayerTurnResolution> {
    if (!this.configured) {
      return { accepted: false, status: 'failed', message: 'Multiplayer server is not configured.' };
    }
    if (!this.socketOpen || !this.client) {
      return { accepted: false, status: 'failed', message: 'Multiplayer server is not connected.' };
    }
    if (this.pendingTurnResolution) {
      return { accepted: false, status: 'failed', message: 'A turn is already awaiting server confirmation.' };
    }

    return new Promise<ArenaMultiplayerTurnResolution>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pendingTurnResolution?.timeout === timeout) this.pendingTurnResolution = null;
        resolve({ accepted: false, status: 'failed', message: 'Multiplayer server did not confirm the turn in time.' });
      }, timeoutMs);
      this.pendingTurnResolution = { resolve, timeout };
      this.client!.send('arena:turn:sync', this.encodeJson(payload));
    });
  }

  private sendJoin(options: ArenaMultiplayerJoinOptions) {
    if (!this.client || !this.socketOpen) return;

    const topic: ArenaMultiplayerTopic = options.mode === 'matchmaking'
      ? 'arena:matchmaking:join'
      : options.lobbyAction === 'create'
      ? 'arena:multiplayer:create'
      : 'arena:multiplayer:join';
    this.client.send(topic, this.encodeJson(options));
    const status = options.mode === 'matchmaking'
      ? { state: 'queued' as const, message: 'Entered Rivalis matchmaking queue.' }
      : options.lobbyAction === 'create'
      ? { state: 'lobby' as const, message: 'Creating Rivalis lobby...' }
      : { state: 'connecting' as const, message: `Joining Rivalis lobby ${options.lobbyCode}...`, lobbyCode: options.lobbyCode };
    this.status = status;
    this.debug.log(status.message);
  }

  private encodeJson(value: unknown): Uint8Array {
    return this.encoder.encode(JSON.stringify(value));
  }

  private getReconnectMaxAttempts(): number {
    const configured = Number(BUILD_ENV.VITE_RIVALIS_RECONNECT_MAX ?? 4);
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 4;
  }

  private scheduleReconnect(onStatus?: (status: ArenaMultiplayerStatus) => void): void {
    if (this.manualDisconnect || !this.configured || this.reconnectTimer) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(1_000 * (2 ** Math.min(this.reconnectAttempt - 1, 4)), 15_000);
    this.setStatus('connecting', `Reconnecting to Rivalis (attempt ${this.reconnectAttempt})...`, onStatus);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualDisconnect) return;
      this.client = null;
      void this.connect(onStatus, this.displayName);
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private getConfigurationMessage(): string {
    if (this.endpointError) return this.endpointError;
    if (!this.runtimeTicket && !this.ticketEndpoint) return 'Rivalis ticket must be provided by the server for multiplayer.';
    return 'Rivalis endpoint and ticket must be configured for multiplayer.';
  }

  private async syncGuestIdentity(displayName?: string): Promise<void> {
    const name = displayName?.trim();
    if (!this.identityEndpoint || !name) return;
    try {
      const response = await fetch(this.identityEndpoint, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      });
      if (!response.ok) {
        this.debug.warn(`Rivalis identity request failed with status ${response.status}.`);
      }
    } catch (error) {
      this.debug.warn('Unable to sync the Rivalis guest identity.', error);
    }
  }

  private async resolveTicket(allowRuntime = true): Promise<string> {
    if (allowRuntime && this.runtimeTicket) return this.runtimeTicket;
    if (!this.ticketEndpoint) return '';
    try {
      const response = await fetch(this.ticketEndpoint, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) {
        this.debug.warn(`Rivalis ticket request failed with status ${response.status}.`);
        return '';
      }
      const payload = await response.json() as { ticket?: unknown };
      if (typeof payload.ticket !== 'string') return '';
      return payload.ticket.trim();
    } catch (error) {
      this.debug.warn('Unable to fetch Rivalis ticket from the server.', error);
      return '';
    }
  }

  private handleServerState(payload: Uint8Array, onStatus?: (status: ArenaMultiplayerStatus) => void) {
    try {
      const event = JSON.parse(this.decoder.decode(payload)) as ArenaMultiplayerServerEvent;
      const lobbyCode = event.lobbyCode ?? this.pendingJoin?.lobbyCode;
      if (event.status === 'queued') this.setStatus('queued', event.message ?? 'Waiting in Rivalis matchmaking queue...', onStatus, { roomId: event.roomId });
      else if (event.status === 'lobby') this.setStatus('lobby', event.message ?? `Waiting in Rivalis lobby ${lobbyCode ?? ''}...`, onStatus, { lobbyCode, roomId: event.roomId });
      else if (event.status === 'matched') {
        this.setStatus('matched', event.message ?? `Matched${event.opponentName ? ` with ${event.opponentName}` : ''}.`, onStatus, { lobbyCode, roomId: event.roomId });
        if (event.match) this.handlers.onMatch?.(event.match);
      } else if (event.status === 'failed') this.setStatus('failed', event.message ?? 'Rivalis multiplayer request failed.', onStatus, { lobbyCode, roomId: event.roomId });
      else if (event.status === 'disconnected') this.setStatus('disconnected', event.message ?? 'Rivalis multiplayer session disconnected.', onStatus, { lobbyCode, roomId: event.roomId });
      else this.debug.warn('Unknown Rivalis state payload.', event);
    } catch {
      const message = this.decoder.decode(payload);
      if (message) this.setStatus('connected', message, onStatus);
    }
  }

  private handleTurnResolution(payload: Uint8Array) {
    let event: ArenaMultiplayerCombatEvent | undefined;
    try {
      const parsed = JSON.parse(this.decoder.decode(payload)) as Partial<ArenaMultiplayerCombatEvent>;
      if (parsed && typeof parsed === 'object') {
        event = {
          ...parsed,
          status: parsed.status ?? (parsed.accepted ? 'accepted' : 'rejected'),
          accepted: parsed.accepted === true
        };
      }
    } catch {
      this.debug.warn('Received malformed Rivalis turn resolution.');
    }
    if (!event) {
      this.resolvePendingTurn({ accepted: false, status: 'failed', message: 'Multiplayer server returned an invalid response.' });
      return;
    }
    const resolution: ArenaMultiplayerTurnResolution = { ...event, accepted: event.accepted === true };
    this.resolvePendingTurn(resolution);
    this.handlers.onCombat?.(resolution);
  }

  private resolvePendingTurn(resolution: ArenaMultiplayerTurnResolution) {
    const pending = this.pendingTurnResolution;
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pendingTurnResolution = null;
    pending.resolve(resolution);
  }

  private setStatus(state: ConnectionState, message: string, onStatus?: (status: ArenaMultiplayerStatus) => void, extra?: Pick<ArenaMultiplayerStatus, 'lobbyCode' | 'roomId'>) {
    const lobbyCode = extra?.lobbyCode ?? this.status.lobbyCode;
    const roomId = extra?.roomId ?? this.status.roomId;
    this.status = { state, message, lobbyCode, roomId };
    this.debug.log(message);
    onStatus?.(this.getStatus());
  }
}
