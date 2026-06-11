import { WSClient } from '@rivalis/browser';
import { BUILD_ENV } from '../utils/BuildEnv';
import { DebugManager } from '../utils/DebugManager';

export type ArenaMultiplayerTopic =
  | 'arena:matchmaking:join'
  | 'arena:matchmaking:state'
  | 'arena:multiplayer:create'
  | 'arena:multiplayer:join'
  | 'arena:multiplayer:state'
  | 'arena:turn:sync'
  | 'arena:turn:state';

type ConnectionState = 'disabled' | 'connecting' | 'connected' | 'queued' | 'lobby' | 'matched' | 'disconnected' | 'failed';
const RIVALIS_TICKET_SOURCES = ['query', 'protocol'] as const;
type RivalisTicketSource = (typeof RIVALIS_TICKET_SOURCES)[number];

function readTrimmedEnv(key: string): string {
  const value = BUILD_ENV[key];
  return typeof value === 'string' ? value.trim() : '';
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

export interface ArenaMultiplayerJoinOptions {
  mode: 'matchmaking' | 'multiplayer';
  lobbyAction?: 'create' | 'join';
  lobbyCode?: string;
  playerName: string;
  ruleset: 'classic';
  useLevelling: boolean;
  turnLimit: number;
  randomMode: boolean;
  loadoutTypeIds: string[];
}

type ArenaMultiplayerServerEvent = {
  status?: 'queued' | 'lobby' | 'matched' | 'failed' | 'disconnected';
  message?: string;
  lobbyCode?: string;
  roomId?: string;
  opponentName?: string;
};

export class ArenaMultiplayerClient {
  private readonly debug = DebugManager.scope('ArenaMultiplayer');
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly endpoint = readTrimmedEnv('VITE_RIVALIS_WS_URL');
  private readonly ticket = readTrimmedEnv('VITE_RIVALIS_TICKET');
  private readonly endpointError = getRivalisEndpointError(this.endpoint);
  private readonly ticketSource: RivalisTicketSource = RIVALIS_TICKET_SOURCES.find((source) => source === BUILD_ENV.VITE_RIVALIS_TICKET_SOURCE) ?? 'query';
  private client: WSClient<ArenaMultiplayerTopic> | null = null;
  private socketOpen = false;
  private pendingJoin: ArenaMultiplayerJoinOptions | null = null;
  private status: ArenaMultiplayerStatus = {
    state: this.configured ? 'disconnected' : 'disabled',
    message: this.configured ? 'Rivalis ready.' : this.getConfigurationMessage()
  };

  get configured(): boolean {
    return Boolean(!this.endpointError && this.ticket);
  }

  getStatus(): ArenaMultiplayerStatus {
    return { ...this.status };
  }

  connect(onStatus?: (status: ArenaMultiplayerStatus) => void) {
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

    this.client = new WSClient<ArenaMultiplayerTopic>(this.endpoint, {
      reconnect: { maxAttempts: this.getReconnectMaxAttempts(), baseDelayMs: 500, maxDelayMs: 5000 },
      ticketSource: this.ticketSource
    });
    this.client.on('client:connect', () => {
      const pendingJoin = this.pendingJoin;
      this.socketOpen = true;
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
      this.client = null;
      this.setStatus('failed', `Rivalis rejected the room: ${info.reason || info.code}`, onStatus);
    });
    this.client.on('client:reconnecting', (payload) => this.setStatus('connecting', `Reconnecting to Rivalis (${this.decoder.decode(payload)})...`, onStatus));
    this.client.on('client:reconnect_failed', () => {
      this.socketOpen = false;
      this.client = null;
      this.setStatus('failed', 'Rivalis reconnect failed.', onStatus);
    });
    this.client.on('arena:matchmaking:state', (payload) => this.handleServerState(payload, onStatus));
    this.client.on('arena:multiplayer:state', (payload) => this.handleServerState(payload, onStatus));
    this.client.on('arena:turn:state', () => this.debug.log('Received Rivalis turn state.'));
    this.setStatus('connecting', 'Connecting to Rivalis...', onStatus);
    try {
      this.client.connect(this.ticket);
    } catch (error) {
      this.socketOpen = false;
      this.client = null;
      const message = error instanceof Error ? error.message : 'Unable to start Rivalis connection.';
      this.setStatus('failed', message, onStatus);
    }
  }

  disconnect() {
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

  syncTurn(payload: unknown) {
    if (!this.socketOpen || !this.client) return;
    this.client.send('arena:turn:sync', this.encodeJson(payload));
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
      ? { state: 'lobby' as const, message: `Rivalis lobby ${options.lobbyCode} created.`, lobbyCode: options.lobbyCode }
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

  private getConfigurationMessage(): string {
    if (this.endpointError) return this.endpointError;
    if (!this.ticket) return 'Rivalis ticket must be configured for multiplayer.';
    return 'Rivalis endpoint and ticket must be configured for multiplayer.';
  }

  private handleServerState(payload: Uint8Array, onStatus?: (status: ArenaMultiplayerStatus) => void) {
    try {
      const event = JSON.parse(this.decoder.decode(payload)) as ArenaMultiplayerServerEvent;
      const lobbyCode = event.lobbyCode ?? this.pendingJoin?.lobbyCode;
      if (event.status === 'queued') this.setStatus('queued', event.message ?? 'Waiting in Rivalis matchmaking queue...', onStatus, { roomId: event.roomId });
      else if (event.status === 'lobby') this.setStatus('lobby', event.message ?? `Waiting in Rivalis lobby ${lobbyCode ?? ''}...`, onStatus, { lobbyCode, roomId: event.roomId });
      else if (event.status === 'matched') this.setStatus('matched', event.message ?? `Matched${event.opponentName ? ` with ${event.opponentName}` : ''}.`, onStatus, { lobbyCode, roomId: event.roomId });
      else if (event.status === 'failed') this.setStatus('failed', event.message ?? 'Rivalis multiplayer request failed.', onStatus, { lobbyCode, roomId: event.roomId });
      else if (event.status === 'disconnected') this.setStatus('disconnected', event.message ?? 'Rivalis multiplayer session disconnected.', onStatus, { lobbyCode, roomId: event.roomId });
      else this.debug.warn('Unknown Rivalis state payload.', event);
    } catch {
      const message = this.decoder.decode(payload);
      if (message) this.setStatus('connected', message, onStatus);
    }
  }

  private setStatus(state: ConnectionState, message: string, onStatus?: (status: ArenaMultiplayerStatus) => void, extra?: Pick<ArenaMultiplayerStatus, 'lobbyCode' | 'roomId'>) {
    const lobbyCode = extra?.lobbyCode ?? this.status.lobbyCode;
    const roomId = extra?.roomId ?? this.status.roomId;
    this.status = { state, message, lobbyCode, roomId };
    this.debug.log(message);
    onStatus?.(this.getStatus());
  }
}
