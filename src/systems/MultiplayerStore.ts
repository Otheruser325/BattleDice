import type {
  ArenaMultiplayerHandlers,
  ArenaMultiplayerJoinOptions,
  ArenaMultiplayerMatchSetup,
  ArenaMultiplayerStatus,
  ArenaMultiplayerTurnResolution
} from './ArenaMultiplayerClient';

export const LOBBY_CODE_LENGTH = 6;
export const LOBBY_JOIN_ATTEMPT_LIMIT = 5;
export const LOBBY_JOIN_LOCKOUT_MS = 30_000;

export interface MultiplayerTransport {
  readonly configured: boolean;
  getStatus(): ArenaMultiplayerStatus;
  setHandlers(handlers: ArenaMultiplayerHandlers): void;
  connect(onStatus?: (status: ArenaMultiplayerStatus) => void, displayName?: string): Promise<void>;
  join(options: ArenaMultiplayerJoinOptions): void;
  cancelMatchmaking(): void;
  leaveSession(): void;
  submitTurn(payload: unknown, timeoutMs?: number): Promise<ArenaMultiplayerTurnResolution>;
  disconnect(): void;
}

export function normalizeLobbyCode(code: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-HJ-NP-Z2-9]{6}$/.test(normalized) ? normalized : '';
}

export class MultiplayerStore {
  private sessionStatus: ArenaMultiplayerStatus;
  private sessionMatch: ArenaMultiplayerMatchSetup | null = null;
  private sessionReady = false;
  private sessionSubmitting = false;
  private sessionDeadlineAt = 0;
  private lobbyJoinAttempts = 0;
  private lobbyJoinBlockedUntilMs = 0;

  constructor(private readonly transport: MultiplayerTransport) {
    this.sessionStatus = transport.getStatus();
  }

  get configured(): boolean {
    return this.transport.configured;
  }

  get status(): ArenaMultiplayerStatus {
    return { ...this.sessionStatus };
  }

  get match(): ArenaMultiplayerMatchSetup | null {
    return this.sessionMatch;
  }

  get isActive(): boolean {
    return this.sessionMatch !== null;
  }

  get rules() {
    return this.sessionMatch?.rules ?? null;
  }

  get ready(): boolean {
    return this.sessionReady;
  }

  get submitting(): boolean {
    return this.sessionSubmitting;
  }

  get deadlineAt(): number {
    return this.sessionDeadlineAt;
  }

  setHandlers(handlers: ArenaMultiplayerHandlers): void {
    this.transport.setHandlers(handlers);
  }

  resetSession(): void {
    this.sessionMatch = null;
    this.sessionReady = false;
    this.sessionSubmitting = false;
    this.sessionDeadlineAt = 0;
    this.lobbyJoinAttempts = 0;
    this.lobbyJoinBlockedUntilMs = 0;
    this.sessionStatus = this.transport.getStatus();
  }

  disconnect(): void {
    this.transport.disconnect();
    this.resetSession();
  }

  cancelMatchmaking(): void {
    this.transport.cancelMatchmaking();
    this.sessionReady = false;
    this.sessionSubmitting = false;
  }

  leaveSession(): void {
    this.transport.leaveSession();
    this.resetSession();
  }

  async queue(
    options: ArenaMultiplayerJoinOptions,
    displayName: string,
    onStatus?: (status: ArenaMultiplayerStatus) => void
  ): Promise<ArenaMultiplayerStatus> {
    this.sessionMatch = null;
    this.sessionReady = false;
    this.sessionSubmitting = false;
    this.sessionDeadlineAt = 0;
    this.sessionStatus = this.transport.getStatus();
    if (!this.transport.configured) return this.status;

    await this.transport.connect((status) => {
      this.applyStatus(status, options);
      onStatus?.(this.status);
    }, displayName);
    const connectionState = this.transport.getStatus().state;
    if (connectionState !== 'failed' && connectionState !== 'disabled') this.transport.join(options);
    this.sessionStatus = this.transport.getStatus();
    return this.status;
  }

  updateLobbyCode(lobbyCode: string): void {
    this.sessionStatus = { ...this.sessionStatus, lobbyCode };
  }

  getLobbyJoinThrottleRemainingMs(now: number = Date.now()): number {
    if (this.lobbyJoinBlockedUntilMs <= 0) return 0;
    return Math.max(0, this.lobbyJoinBlockedUntilMs - now);
  }

  registerFailedLobbyJoin(now: number = Date.now()): void {
    this.lobbyJoinAttempts += 1;
    if (this.lobbyJoinAttempts >= LOBBY_JOIN_ATTEMPT_LIMIT) {
      this.lobbyJoinBlockedUntilMs = now + LOBBY_JOIN_LOCKOUT_MS;
      this.lobbyJoinAttempts = 0;
    }
  }

  canAttemptLobbyJoin(now: number = Date.now()): { allowed: boolean; remainingMs: number } {
    const remainingMs = this.getLobbyJoinThrottleRemainingMs(now);
    return { allowed: remainingMs <= 0, remainingMs };
  }

  beginMatch(setup: ArenaMultiplayerMatchSetup): void {
    this.sessionMatch = setup;
    this.sessionReady = setup.selfReady === true;
    this.sessionSubmitting = false;
    this.sessionDeadlineAt = setup.deadlineAt;
  }

  updateMatch(setup: ArenaMultiplayerMatchSetup): void {
    this.sessionMatch = setup;
    this.sessionReady = setup.selfReady === true;
    this.sessionSubmitting = false;
    this.sessionDeadlineAt = setup.deadlineAt;
  }

  setReady(value: boolean): void {
    this.sessionReady = value;
  }

  setSubmitting(value: boolean): void {
    this.sessionSubmitting = value;
  }

  setDeadline(deadlineAt: number): void {
    this.sessionDeadlineAt = deadlineAt;
  }

  submitTurn(payload: unknown, timeoutMs?: number): Promise<ArenaMultiplayerTurnResolution> {
    return this.transport.submitTurn(payload, timeoutMs);
  }

  private applyStatus(status: ArenaMultiplayerStatus, options: ArenaMultiplayerJoinOptions): void {
    this.sessionStatus = { ...status };
    if (status.state === 'idle') {
      this.sessionMatch = null;
      this.sessionReady = false;
      this.sessionSubmitting = false;
      this.sessionDeadlineAt = 0;
    }
    if (status.state === 'lobby' || status.state === 'matched') {
      this.lobbyJoinAttempts = 0;
      this.lobbyJoinBlockedUntilMs = 0;
    }
    if (status.state === 'failed' && options.lobbyAction === 'join') {
      this.registerFailedLobbyJoin();
    }
  }
}
