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
  private readonly endpoint = typeof BUILD_ENV.VITE_RIVALIS_WS_URL === 'string' ? BUILD_ENV.VITE_RIVALIS_WS_URL.trim() : '';
  private readonly ticket = typeof BUILD_ENV.VITE_RIVALIS_TICKET === 'string' ? BUILD_ENV.VITE_RIVALIS_TICKET.trim() : '';
  private readonly ticketSource: RivalisTicketSource = RIVALIS_TICKET_SOURCES.find((source) => source === BUILD_ENV.VITE_RIVALIS_TICKET_SOURCE) ?? 'query';
  private client: WSClient<ArenaMultiplayerTopic> | null = null;
  private pendingJoin: ArenaMultiplayerJoinOptions | null = null;
  private status: ArenaMultiplayerStatus = {
    state: this.endpoint && this.ticket ? 'disconnected' : 'disabled',
    message: this.endpoint && this.ticket
      ? 'Rivalis ready.'
      : 'Rivalis endpoint and ticket must be configured for multiplayer.'
  };

  get configured(): boolean {
    return Boolean(this.endpoint && this.ticket);
  }

  getStatus(): ArenaMultiplayerStatus {
    return { ...this.status };
  }

  connect(onStatus?: (status: ArenaMultiplayerStatus) => void) {
    if (!this.configured) {
      this.setStatus('disabled', 'Rivalis endpoint and ticket must be configured for multiplayer.', onStatus);
      return;
    }

    if (this.client?.connected) {
      this.setStatus('connected', 'Connected to Rivalis.', onStatus);
      return;
    }

    this.client = new WSClient<ArenaMultiplayerTopic>(this.endpoint, {
      reconnect: { maxAttempts: this.getReconnectMaxAttempts(), baseDelayMs: 500, maxDelayMs: 5000 },
      ticketSource: this.ticketSource
    });
    this.client.on('client:connect', () => this.setStatus('connected', 'Connected to Rivalis.', onStatus));
    this.client.on('client:disconnect', (payload) => {
      const reason = this.decoder.decode(payload);
      this.setStatus('disconnected', reason ? `Rivalis disconnected: ${reason}` : 'Rivalis disconnected.', onStatus);
    });
    this.client.on('client:kicked', (info) => this.setStatus('failed', `Rivalis rejected the room: ${info.reason || info.code}`, onStatus));
    this.client.on('client:reconnecting', (payload) => this.setStatus('connecting', `Reconnecting to Rivalis (${this.decoder.decode(payload)})...`, onStatus));
    this.client.on('client:reconnect_failed', () => this.setStatus('failed', 'Rivalis reconnect failed.', onStatus));
    this.client.on('arena:matchmaking:state', (payload) => this.handleServerState(payload, onStatus));
    this.client.on('arena:multiplayer:state', (payload) => this.handleServerState(payload, onStatus));
    this.client.on('arena:turn:state', () => this.debug.log('Received Rivalis turn state.'));
    this.setStatus('connecting', 'Connecting to Rivalis...', onStatus);
    this.client.connect(this.ticket);
  }

  disconnect() {
    this.client?.disconnect();
    this.client = null;
    this.pendingJoin = null;
    this.status = {
      state: this.configured ? 'disconnected' : 'disabled',
      message: this.configured ? 'Rivalis disconnected.' : 'Rivalis endpoint and ticket must be configured for multiplayer.'
    };
  }

  join(options: ArenaMultiplayerJoinOptions) {
    this.pendingJoin = options;
    if (!this.client?.connected) {
      this.debug.warn('Join skipped because Rivalis is not connected.', options);
      return;
    }
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

  syncTurn(payload: unknown) {
    if (!this.client?.connected) return;
    this.client.send('arena:turn:sync', this.encodeJson(payload));
  }

  private encodeJson(value: unknown): Uint8Array {
    return this.encoder.encode(JSON.stringify(value));
  }

  private getReconnectMaxAttempts(): number {
    const configured = Number(BUILD_ENV.VITE_RIVALIS_RECONNECT_MAX ?? 4);
    return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 4;
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
