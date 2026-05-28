import { WSClient } from '@rivalis/browser';
import { BUILD_ENV } from '../utils/BuildEnv';
import { DebugManager } from '../utils/DebugManager';

export type ArenaMultiplayerTopic =
  | 'arena:matchmaking:join'
  | 'arena:matchmaking:state'
  | 'arena:multiplayer:join'
  | 'arena:multiplayer:state'
  | 'arena:turn:sync';

type ConnectionState = 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'failed';

export interface ArenaMultiplayerStatus {
  state: ConnectionState;
  message: string;
}

export interface ArenaMultiplayerJoinOptions {
  mode: 'matchmaking' | 'multiplayer';
  playerName: string;
  useLevelling: boolean;
  turnLimit: number;
}

export class ArenaMultiplayerClient {
  private readonly debug = DebugManager.scope('ArenaMultiplayer');
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();
  private readonly endpoint = typeof BUILD_ENV.VITE_RIVALIS_WS_URL === 'string' ? BUILD_ENV.VITE_RIVALIS_WS_URL.trim() : '';
  private client: WSClient<ArenaMultiplayerTopic> | null = null;
  private status: ArenaMultiplayerStatus = {
    state: this.endpoint ? 'disconnected' : 'disabled',
    message: this.endpoint ? 'Rivalis ready.' : 'Rivalis endpoint is not configured.'
  };

  getStatus(): ArenaMultiplayerStatus {
    return { ...this.status };
  }

  connect(onStatus?: (status: ArenaMultiplayerStatus) => void) {
    if (!this.endpoint) {
      this.setStatus('disabled', 'Rivalis endpoint is not configured.', onStatus);
      return;
    }

    if (this.client?.connected) {
      this.setStatus('connected', 'Connected to Rivalis.', onStatus);
      return;
    }

    this.client = new WSClient<ArenaMultiplayerTopic>(this.endpoint, {
      reconnect: { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 5000 }
    });
    this.client.on('client:connect', () => this.setStatus('connected', 'Connected to Rivalis.', onStatus));
    this.client.on('client:disconnect', (payload) => {
      const reason = this.decoder.decode(payload);
      this.setStatus('disconnected', reason ? `Rivalis disconnected: ${reason}` : 'Rivalis disconnected.', onStatus);
    });
    this.client.on('client:kicked', (info) => this.setStatus('failed', `Rivalis rejected the room: ${info.reason || info.code}`, onStatus));
    this.client.on('client:reconnecting', (payload) => this.setStatus('connecting', `Reconnecting to Rivalis (${this.decoder.decode(payload)})...`, onStatus));
    this.client.on('client:reconnect_failed', () => this.setStatus('failed', 'Rivalis reconnect failed.', onStatus));
    this.setStatus('connecting', 'Connecting to Rivalis...', onStatus);
    this.client.connect(typeof BUILD_ENV.VITE_RIVALIS_TICKET === 'string' ? BUILD_ENV.VITE_RIVALIS_TICKET : '');
  }

  disconnect() {
    this.client?.disconnect();
    this.client = null;
    this.status = {
      state: this.endpoint ? 'disconnected' : 'disabled',
      message: this.endpoint ? 'Rivalis disconnected.' : 'Rivalis endpoint is not configured.'
    };
  }

  join(options: ArenaMultiplayerJoinOptions) {
    if (!this.client?.connected) {
      this.debug.warn('Join skipped because Rivalis is not connected.', options);
      return;
    }
    const topic: ArenaMultiplayerTopic = options.mode === 'matchmaking' ? 'arena:matchmaking:join' : 'arena:multiplayer:join';
    this.client.send(topic, this.encodeJson(options));
  }

  syncTurn(payload: unknown) {
    if (!this.client?.connected) return;
    this.client.send('arena:turn:sync', this.encodeJson(payload));
  }

  private encodeJson(value: unknown): Uint8Array {
    return this.encoder.encode(JSON.stringify(value));
  }

  private setStatus(state: ConnectionState, message: string, onStatus?: (status: ArenaMultiplayerStatus) => void) {
    this.status = { state, message };
    this.debug.log(message);
    onStatus?.(this.getStatus());
  }
}
