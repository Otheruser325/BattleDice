import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { Room, type Actor } from '@rivalis/core';
import type { ArenaActorData } from './auth.js';
import {
  applyBoard,
  autoPlaceBoard,
  createCombatSetup,
  currentWinner,
  getCombatFootprint,
  getPipMap,
  healthWinner,
  resolveCombat,
  rollPips,
  toClientState,
  type CombatSetup
} from './combat/engine.js';
import { diceCatalog } from './combat/catalog.js';
import {
  applyDiceCardToState,
  canOfferDiceCards,
  getDiceCardActiveKeys,
  getDiceCardRarityRoll,
  rollDiceCards,
  type DiceCard
} from './combat/dice-cards.js';
import type { CombatEvent, LoadoutEntry, MatchRules, OwnerId } from './combat/types.js';
import {
  ARENA_ROOM_ID,
  MATCH_PLACEMENT_MS,
  TOPICS,
  encodeJson,
  generateLobbyCode,
  normalizePlayerName,
  normalizeTypeId,
  parseJoinRequest,
  parseTurnSync,
  rulesMatch,
  type MatchSetupPayload,
  type ServerEvent,
  type ServerTopic,
  type TurnEvent
} from './protocol.js';
import { FixedWindowLimiter } from './rate-limit.js';
import {
  createRandomPvpLoadout,
  isPvPTypeIdAllowed,
  normalizePvpLoadout,
  normalizePvpRules,
  pickPvpRandomModifier
} from './pvp-rules.js';

type ArenaActor = Actor<ArenaActorData>;

interface Session {
  playerId: string;
  actorId: string;
  clientAddress: string;
  name: string;
  loadout: LoadoutEntry[];
  rules: MatchRules | null;
  lobbyCode: string | null;
  matchId: string | null;
  disconnectTimer: NodeJS.Timeout | null;
}

interface MatchPlayer {
  playerId: string;
  actorId: string;
  name: string;
  loadout: LoadoutEntry[];
  rules: MatchRules;
}

interface Lobby {
  code: string;
  hostId: string;
  guestId: string | null;
  createdAt: number;
}

interface Match {
  id: string;
  lobbyCode: string | null;
  players: [MatchPlayer, MatchPlayer];
  rules: MatchRules;
  phase: 'placement' | 'combat' | 'complete';
  deadlineAt: number;
  placementStartedAt: number;
  ready: Set<string>;
  setup: CombatSetup;
  seed: string;
  events: CombatEvent[];
  record: string[];
  diceCards: Record<OwnerId, DiceCard[]>;
  diceCardPicksUsed: number;
  diceCardOffer: Record<OwnerId, DiceCard[]> | null;
  diceCardPicks: Partial<Record<OwnerId, string>>;
  result?: 'victory' | 'defeat' | 'draw';
  resultDelivered: Set<string>;
  winnerPlayerId?: string;
  createdAt: number;
  updatedAt: number;
}

interface QueueEntry {
  profile: MatchPlayer;
  queuedAt: number;
}

export interface ArenaRoomOptions {
  maxActors: number;
  maxActorsPerAddress: number;
  maxQueue: number;
  maxLobbies: number;
  maxMatches: number;
  queueTtlMs: number;
  lobbyTtlMs: number;
  matchTtlMs: number;
  reconnectGraceMs: number;
  actionLimit: number;
  actionWindowMs: number;
  lobbyJoinLimit: number;
  lobbyJoinWindowMs: number;
}

const MAX_MATCH_RECORD_LINES = 200;

const DEFAULT_OPTIONS: ArenaRoomOptions = {
  maxActors: 512,
  maxActorsPerAddress: 4,
  maxQueue: 200,
  maxLobbies: 100,
  maxMatches: 100,
  queueTtlMs: 300_000,
  lobbyTtlMs: 900_000,
  matchTtlMs: 1_800_000,
  reconnectGraceMs: 45_000,
  actionLimit: 12,
  actionWindowMs: 60_000,
  lobbyJoinLimit: 8,
  lobbyJoinWindowMs: 60_000
};

export class ArenaRoom extends Room<ArenaActorData> {
  private options: ArenaRoomOptions = DEFAULT_OPTIONS;
  private actionLimiter = new FixedWindowLimiter(
    DEFAULT_OPTIONS.actionLimit,
    DEFAULT_OPTIONS.actionWindowMs
  );
  private lobbyJoinLimiter = new FixedWindowLimiter(
    DEFAULT_OPTIONS.lobbyJoinLimit,
    DEFAULT_OPTIONS.lobbyJoinWindowMs
  );
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly connectedActors = new Map<string, ArenaActor>();
  private readonly actorPlayers = new Map<string, string>();
  private readonly actorsByAddress = new Map<string, number>();
  private readonly sessions = new Map<string, Session>();
  private readonly queue: QueueEntry[] = [];
  private readonly lobbies = new Map<string, Lobby>();
  private readonly matches = new Map<string, Match>();

  configure(options: ArenaRoomOptions): void {
    this.options = options;
    this.maxActors = options.maxActors;
    this.options.maxActorsPerAddress = options.maxActorsPerAddress ?? DEFAULT_OPTIONS.maxActorsPerAddress;
    this.actionLimiter = new FixedWindowLimiter(options.actionLimit, options.actionWindowMs);
    this.lobbyJoinLimiter = new FixedWindowLimiter(options.lobbyJoinLimit, options.lobbyJoinWindowMs);
  }

  protected override onCreate(): void {
    this.bind(TOPICS.matchmakingJoin, this.onMatchmakingJoin, this);
    this.bind(TOPICS.matchmakingCancel, this.onMatchmakingCancel, this);
    this.bind(TOPICS.multiplayerCreate, this.onCreateLobby, this);
    this.bind(TOPICS.multiplayerJoin, this.onJoinLobby, this);
    this.bind(TOPICS.multiplayerLeave, this.onMultiplayerLeave, this);
    this.bind(TOPICS.turnSync, this.onTurnSync, this);
    this.cleanupTimer = setInterval(() => this.cleanup(), 1_000);
    this.cleanupTimer.unref();
  }

  protected override onJoin(actor: ArenaActor): void {
    const playerId = actor.data?.playerId;
    if (!playerId) {
      this.kick(actor, 'invalid_session');
      return;
    }

    const existing = this.sessions.get(playerId);
    const address = actor.data?.clientAddress ?? 'unknown';
    const liveActor = existing && existing.actorId !== actor.id && this.connectedActors.has(existing.actorId);
    if (liveActor && (existing.clientAddress ?? 'unknown') !== address) {
      this.kick(actor, 'session_address_mismatch');
      return;
    }
    if (!existing && (this.actorsByAddress.get(address) ?? 0) >= this.options.maxActorsPerAddress) {
      this.kick(actor, 'address_limit');
      return;
    }
    this.connectedActors.set(actor.id, actor);
    this.actorPlayers.set(actor.id, playerId);
    if (existing?.actorId !== actor.id) {
      this.actorsByAddress.set(address, (this.actorsByAddress.get(address) ?? 0) + 1);
    }

    if (existing) {
      if (existing.disconnectTimer) clearTimeout(existing.disconnectTimer);
      existing.disconnectTimer = null;
      existing.clientAddress = address;
      const previousActorId = existing.actorId;
      if (previousActorId === actor.id) return;
      existing.actorId = actor.id;
      if (actor.data?.playerName) existing.name = actor.data.playerName;
      const match = existing.matchId ? this.matches.get(existing.matchId) : null;
      if (match) {
        const player = match.players.find((candidate) => candidate.playerId === playerId);
        if (player) {
          player.actorId = actor.id;
          if (actor.data?.playerName) player.name = actor.data.playerName;
        }
      }
      const previousActor = this.connectedActors.get(previousActorId);
      if (previousActor) this.kick(previousActor, 'session_replaced');
      for (const entry of this.queue) {
        if (entry.profile.playerId !== playerId) continue;
        entry.profile.actorId = actor.id;
        if (actor.data?.playerName) entry.profile.name = actor.data.playerName;
      }
      this.sendResume(actor, existing);
      return;
    }

    this.sessions.set(playerId, {
      playerId,
      actorId: actor.id,
      clientAddress: actor.data?.clientAddress ?? 'unknown',
      name: actor.data?.playerName ?? '',
      loadout: [],
      rules: null,
      lobbyCode: null,
      matchId: null,
      disconnectTimer: null
    });
  }

  protected override onLeave(actor: ArenaActor): void {
    this.connectedActors.delete(actor.id);
    const playerId = this.actorPlayers.get(actor.id);
    this.actorPlayers.delete(actor.id);
    const address = actor.data?.clientAddress ?? 'unknown';
    const addressCount = this.actorsByAddress.get(address) ?? 0;
    if (addressCount <= 1) this.actorsByAddress.delete(address);
    else this.actorsByAddress.set(address, addressCount - 1);
    if (!playerId) return;

    const session = this.sessions.get(playerId);
    if (!session || session.actorId !== actor.id) return;
    this.removeFromQueue(playerId);
    if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
    session.disconnectTimer = setTimeout(
      () => this.expireDisconnectedSession(playerId, actor.id),
      this.options.reconnectGraceMs
    );
    session.disconnectTimer.unref();

    if (session.matchId) {
      const match = this.matches.get(session.matchId);
      if (match && match.phase === 'placement') {
        match.updatedAt = Date.now();
        const reconnectDeadline = Date.now() + this.options.reconnectGraceMs + 5_000;
        const maxDeadline = match.placementStartedAt + MATCH_PLACEMENT_MS + this.options.reconnectGraceMs + 5_000;
        match.deadlineAt = Math.min(Math.max(match.deadlineAt, reconnectDeadline), maxDeadline);
      }
    }
  }

  private expireDisconnectedSession(playerId: string, actorId: string): void {
    const session = this.sessions.get(playerId);
    if (!session || session.actorId !== actorId || !session.disconnectTimer) return;
    session.disconnectTimer = null;

    if (session.matchId) {
      const match = this.matches.get(session.matchId);
      if (match && match.phase === 'complete' && !match.resultDelivered.has(playerId)) {
        session.lobbyCode = null;
        this.removeFromQueue(playerId);
        return;
      }
      if (match) {
        this.endMatch(
          match,
          match.phase === 'complete' ? 'Match closed.' : 'Opponent disconnected.',
          match.phase === 'complete' ? undefined : playerId
        );
      }
    }

    if (session.lobbyCode) {
      const lobby = this.lobbies.get(session.lobbyCode);
      if (lobby) {
        const otherPlayerId = lobby.hostId === playerId ? lobby.guestId : lobby.hostId;
        this.lobbies.delete(lobby.code);
        if (otherPlayerId) {
          const other = this.sessions.get(otherPlayerId);
          if (other) other.lobbyCode = null;
          this.sendStateToPlayer(otherPlayerId, TOPICS.multiplayerState, {
            status: 'disconnected',
            message: 'The lobby closed because the other player disconnected.'
          });
        }
      }
    }

    this.removeFromQueue(playerId);
    this.sessions.delete(playerId);
  }

  protected override onDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    for (const session of this.sessions.values()) {
      if (session.disconnectTimer) clearTimeout(session.disconnectTimer);
    }
    this.connectedActors.clear();
    this.actorPlayers.clear();
    this.actorsByAddress.clear();
    this.sessions.clear();
    this.queue.length = 0;
    this.lobbies.clear();
    this.matches.clear();
  }

  private onMatchmakingJoin(actor: ArenaActor, payload: Uint8Array): void {
    const session = this.sessionFor(actor);
    if (!session || !this.allowAction(session, TOPICS.matchmakingState)) return;
    const parsed = parseJoinRequest(payload, 'matchmaking');
    if (!parsed.ok) {
      this.sendFailure(actor, TOPICS.matchmakingState, parsed.error);
      return;
    }
    if (session.lobbyCode !== null || session.matchId !== null) {
      this.sendResume(actor, session);
      return;
    }
    if (!this.loadoutIsValid(parsed.value.loadout)) {
      this.sendFailure(actor, TOPICS.matchmakingState, 'Loadout contains an unknown die.');
      return;
    }

    this.removeFromQueue(session.playerId);
    if (this.queue.length >= this.options.maxQueue) {
      this.sendFailure(actor, TOPICS.matchmakingState, 'Matchmaking is currently full.');
      return;
    }

    this.applyJoin(session, parsed.value);
    const profile = this.profileFor(session);
    if (!profile) {
      this.sendFailure(actor, TOPICS.matchmakingState, 'Invalid player profile.');
      return;
    }

    const opponentIndex = this.queue.findIndex((entry) => (
      entry.profile.playerId !== profile.playerId
      && rulesMatch(entry.profile.rules, profile.rules)
    ));
    if (opponentIndex !== -1) {
      const opponent = this.queue.splice(opponentIndex, 1)[0];
      if (opponent && this.startMatch(opponent.profile, profile, null, profile.rules)) return;
      if (opponent) this.queue.unshift(opponent);
    }

    this.queue.push({ profile, queuedAt: Date.now() });
    this.sendState(actor, TOPICS.matchmakingState, {
      status: 'queued',
      message: 'Waiting in Rivalis matchmaking queue...'
    });
  }

  private onCreateLobby(actor: ArenaActor, payload: Uint8Array): void {
    const session = this.sessionFor(actor);
    if (!session || !this.allowAction(session, TOPICS.multiplayerState)) return;
    const parsed = parseJoinRequest(payload, 'multiplayer', 'create');
    if (!parsed.ok) {
      this.sendFailure(actor, TOPICS.multiplayerState, parsed.error);
      return;
    }
    if (session.lobbyCode !== null || session.matchId !== null) {
      this.sendResume(actor, session);
      return;
    }
    if (this.lobbies.size >= this.options.maxLobbies) {
      this.sendFailure(actor, TOPICS.multiplayerState, 'Lobby capacity is currently full.');
      return;
    }
    if (!this.loadoutIsValid(parsed.value.loadout)) {
      this.sendFailure(actor, TOPICS.multiplayerState, 'Loadout contains an unknown die.');
      return;
    }

    let code = '';
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = generateLobbyCode();
      if (!this.lobbies.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      this.sendFailure(actor, TOPICS.multiplayerState, 'Unable to allocate a lobby code.');
      return;
    }

    this.removeFromQueue(session.playerId);
    this.applyJoin(session, parsed.value);
    session.lobbyCode = code;
    this.lobbies.set(code, {
      code,
      hostId: session.playerId,
      guestId: null,
      createdAt: Date.now()
    });
    this.sendState(actor, TOPICS.multiplayerState, {
      status: 'lobby',
      lobbyCode: code,
      roomId: ARENA_ROOM_ID,
      message: `Rivalis lobby ${code} created.`
    });
  }

  private onMatchmakingCancel(actor: ArenaActor): void {
    const session = this.sessionFor(actor);
    if (!session) return;
    this.removeFromQueue(session.playerId);
    this.sendState(actor, TOPICS.matchmakingState, {
      status: 'idle',
      message: 'Left the Rivalis matchmaking queue.'
    });
  }

  private onMultiplayerLeave(actor: ArenaActor): void {
    const session = this.sessionFor(actor);
    if (!session) return;

    const match = session.matchId ? this.matches.get(session.matchId) : null;
    if (match && match.phase !== 'complete') {
      const remaining = match.players.find((player) => player.playerId !== session.playerId);
      match.phase = 'complete';
      match.events = [];
      match.result = remaining && match.players[0]?.playerId !== session.playerId ? 'victory' : 'defeat';
      match.winnerPlayerId = remaining?.playerId;
      this.appendRecord(match, [`${session.name || 'Opponent'} forfeited.`]);
      match.resultDelivered.add(session.playerId);
      this.deliverMatchResult(match, 'Your opponent forfeited; the match has ended.', {
        skipPlayerId: session.playerId
      });
    }

    if (session.lobbyCode) {
      const lobby = this.lobbies.get(session.lobbyCode);
      if (lobby) {
        const otherPlayerId = lobby.hostId === session.playerId ? lobby.guestId : lobby.hostId;
        this.lobbies.delete(lobby.code);
        if (otherPlayerId) {
          const other = this.sessions.get(otherPlayerId);
          if (other) other.lobbyCode = null;
          this.sendStateToPlayer(otherPlayerId, TOPICS.multiplayerState, {
            status: 'idle',
            message: 'The lobby closed because the other player left.'
          });
        }
      }
    }

    this.removeFromQueue(session.playerId);
    session.lobbyCode = null;
    session.matchId = null;
    this.sendState(actor, TOPICS.multiplayerState, {
      status: 'idle',
      message: 'Left the multiplayer session.'
    });
  }

  private onJoinLobby(actor: ArenaActor, payload: Uint8Array): void {
    const session = this.sessionFor(actor);
    if (!session || !this.allowAction(session, TOPICS.multiplayerState)) return;
    if (!this.lobbyJoinLimiter.take(session.clientAddress)) {
      this.sendFailure(actor, TOPICS.multiplayerState, 'Lobby is unavailable.');
      return;
    }
    const parsed = parseJoinRequest(payload, 'multiplayer', 'join');
    if (!parsed.ok) {
      this.sendFailure(actor, TOPICS.multiplayerState, parsed.ok ? 'Invalid lobby.' : parsed.error);
      return;
    }
    if (session.lobbyCode !== null || session.matchId !== null) {
      this.sendResume(actor, session);
      return;
    }
    if (!this.loadoutIsValid(parsed.value.loadout)) {
      this.sendFailure(actor, TOPICS.multiplayerState, 'Loadout contains an unknown die.');
      return;
    }

    const code = parsed.value.lobbyCode;
    const lobby = code ? this.lobbies.get(code) : null;
    if (!lobby || lobby.hostId === session.playerId || lobby.guestId) {
      this.sendFailure(actor, TOPICS.multiplayerState, 'Lobby is unavailable.');
      return;
    }
    if (this.matches.size >= this.options.maxMatches) {
      this.sendFailure(actor, TOPICS.multiplayerState, 'Match capacity is currently full.');
      return;
    }

    this.removeFromQueue(session.playerId);
    this.applyJoin(session, parsed.value);
    const guest = this.profileFor(session);
    const host = this.sessions.get(lobby.hostId);
    const hostProfile = host ? this.profileFor(host) : null;
    if (!host || !this.connectedActors.has(host.actorId)) {
      this.sendFailure(actor, TOPICS.multiplayerState, 'Lobby host is reconnecting.');
      return;
    }
    if (!guest || !hostProfile) {
      this.lobbies.delete(lobby.code);
      this.sendFailure(actor, TOPICS.multiplayerState, 'Lobby is unavailable.');
      return;
    }

    lobby.guestId = session.playerId;
    if (!this.startMatch(hostProfile, guest, lobby.code, hostProfile.rules)) {
      lobby.guestId = null;
    }
  }

  private onTurnSync(actor: ArenaActor, payload: Uint8Array): void {
    const session = this.sessionFor(actor);
    if (!session) return;
    if (!this.actionLimiter.take(`${session.playerId}:turn`)) {
      this.sendTurn(actor, {
        accepted: false,
        status: 'rejected',
        message: 'Too many turn submissions.'
      });
      return;
    }
    const match = session.matchId ? this.matches.get(session.matchId) : null;
    if (!match) {
      this.sendTurn(actor, {
        accepted: false,
        status: 'rejected',
        message: 'No active match.'
      });
      return;
    }
    const parsed = parseTurnSync(payload);
    if (!parsed.ok) {
      this.sendTurn(actor, {
        accepted: false,
        status: 'rejected',
        message: parsed.error
      });
      return;
    }
    if (match.phase !== 'placement') {
      this.sendTurn(actor, {
        accepted: false,
        status: 'rejected',
        requestId: parsed.value.requestId,
        turn: parsed.value.turn,
        message: 'The match is not accepting placements.'
      });
      return;
    }
    if (Date.now() >= match.deadlineAt) {
      this.resolveMatch(match, true, parsed.value.requestId ? { [session.playerId]: parsed.value.requestId } : {});
      return;
    }
    if (match.ready.has(session.playerId)) {
      this.sendTurn(actor, this.buildTurnEvent(match, session.playerId, {
        accepted: true,
        status: 'waiting',
        requestId: parsed.value.requestId,
        message: 'Waiting for the other player.',
        deadlineAt: match.deadlineAt
      }));
      return;
    }
    if (parsed.value.turn !== match.setup.state.turn) {
      this.sendTurn(actor, {
        accepted: false,
        status: 'rejected',
        requestId: parsed.value.requestId,
        message: 'Turn is out of sequence.'
      });
      return;
    }

    const playerIndex = match.players.findIndex((candidate) => candidate.playerId === session.playerId);
    if (playerIndex === -1) {
      this.sendTurn(actor, {
        accepted: false,
        status: 'rejected',
        requestId: parsed.value.requestId,
        message: 'Player is not part of this match.'
      });
      return;
    }
    const owner: OwnerId = playerIndex === 0 ? 'player' : 'enemy';
    const diceCardKey = parsed.value.diceCardKey;
    if (diceCardKey !== undefined) {
      const offer = match.diceCardOffer?.[owner] ?? [];
      if (!match.diceCardOffer) {
        this.sendTurn(actor, {
          accepted: false,
          status: 'rejected',
          requestId: parsed.value.requestId,
          message: 'No Dice Card draft is active.'
        });
        return;
      }
      if (!offer.some((card) => card.key === diceCardKey)) {
        this.sendTurn(actor, {
          accepted: false,
          status: 'rejected',
          requestId: parsed.value.requestId,
          message: 'That Dice Card is not in this draft.'
        });
        return;
      }
    }
    const submissions = parsed.value.dice.map((die) => {
      const canonicalDie = match.setup.state.dice.find((candidate) => candidate.instanceId === die.instanceId);
      const canonicalCol = owner === 'enemy' && canonicalDie
        ? 5 - getCombatFootprint(match.setup.state, match.setup.definitions, canonicalDie) - die.gridPosition.col
        : die.gridPosition.col;
      return {
        instanceId: die.instanceId,
        typeId: die.typeId,
        row: die.gridPosition.row,
        col: canonicalCol
      };
    });
    const error = applyBoard(match.setup.state, match.setup.definitions, owner, submissions);
    if (error) {
      this.sendTurn(actor, {
        accepted: false,
        status: 'rejected',
        requestId: parsed.value.requestId,
        message: error
      });
      return;
    }

    if (diceCardKey !== undefined) match.diceCardPicks[owner] = diceCardKey;
    else if (match.diceCardOffer) delete match.diceCardPicks[owner];
    match.ready.add(session.playerId);
    match.updatedAt = Date.now();
    if (match.ready.size === match.players.length) {
      this.resolveMatch(match, false, parsed.value.requestId ? { [session.playerId]: parsed.value.requestId } : {});
      return;
    }

    this.sendTurn(actor, this.buildTurnEvent(match, session.playerId, {
      accepted: true,
      status: 'waiting',
      requestId: parsed.value.requestId,
      message: 'Board locked. Waiting for the other player.',
      deadlineAt: match.deadlineAt
    }));
    const opponent = match.players.find((player) => player.playerId !== session.playerId);
    if (opponent) {
      this.sendTurnToPlayer(opponent.playerId, this.buildTurnEvent(match, opponent.playerId, {
        accepted: true,
        status: 'waiting',
        message: `${session.name} is ready.`,
        deadlineAt: match.deadlineAt
      }));
    }
  }

  private startMatch(
    first: MatchPlayer,
    second: MatchPlayer,
    lobbyCode: string | null,
    rules: MatchRules
  ): boolean {
    const firstSession = this.sessions.get(first.playerId);
    const secondSession = this.sessions.get(second.playerId);
    if (
      !firstSession
      || !secondSession
      || firstSession.actorId !== first.actorId
      || secondSession.actorId !== second.actorId
      || this.matches.size >= this.options.maxMatches
    ) {
      const message = 'Unable to start the match.';
      const topic = lobbyCode ? TOPICS.multiplayerState : TOPICS.matchmakingState;
      this.sendStateToPlayer(first.playerId, topic, { status: 'failed', message });
      this.sendStateToPlayer(second.playerId, topic, { status: 'failed', message });
      return false;
    }

    const normalizedRules = normalizePvpRules(rules);
    const randomModifier = normalizedRules.randomMode ? pickPvpRandomModifier() : undefined;
    const matchRules: MatchRules = randomModifier
      ? { ...normalizedRules, randomModifier }
      : normalizedRules;
    const seed = randomBytes(24).toString('base64url');
    const firstLoadout = matchRules.randomizeLoadout
      ? createRandomPvpLoadout(matchRules.useLevelling)
      : first.loadout;
    const secondLoadout = matchRules.randomizeLoadout
      ? createRandomPvpLoadout(matchRules.useLevelling)
      : second.loadout;
    const firstMatchPlayer: MatchPlayer = { ...first, loadout: firstLoadout, rules: matchRules };
    const secondMatchPlayer: MatchPlayer = { ...second, loadout: secondLoadout, rules: matchRules };

    const setup = createCombatSetup(firstLoadout, secondLoadout, diceCatalog, matchRules);
    if (setup.state.dice.length < 10) {
      const message = 'The selected loadout could not be loaded.';
      const topic = lobbyCode ? TOPICS.multiplayerState : TOPICS.matchmakingState;
      this.sendStateToPlayer(first.playerId, topic, { status: 'failed', message });
      this.sendStateToPlayer(second.playerId, topic, { status: 'failed', message });
      return false;
    }

    if (lobbyCode) this.lobbies.delete(lobbyCode);
    const now = Date.now();
    rollPips(setup.state, seed, 1);
    const match: Match = {
      id: `m_${randomUUID()}`,
      lobbyCode,
      players: [firstMatchPlayer, secondMatchPlayer],
      rules: matchRules,
      phase: 'placement',
      deadlineAt: now + MATCH_PLACEMENT_MS,
      placementStartedAt: now,
      ready: new Set(),
      setup,
      seed,
      events: [],
      record: [],
      diceCards: setup.state.diceCards ?? { player: [], enemy: [] },
      diceCardPicksUsed: 0,
      diceCardOffer: null,
      diceCardPicks: {},
      resultDelivered: new Set(),
      createdAt: now,
      updatedAt: now
    };
    this.matches.set(match.id, match);
    firstSession.matchId = match.id;
    firstSession.lobbyCode = lobbyCode;
    secondSession.matchId = match.id;
    secondSession.lobbyCode = lobbyCode;

    this.sendMatched(match, firstMatchPlayer, secondMatchPlayer);
    this.sendMatched(match, secondMatchPlayer, firstMatchPlayer);
    return true;
  }

  private sendMatched(match: Match, player: MatchPlayer, opponent: MatchPlayer, message = `Matched with ${opponent.name}.`): void {
    const event: ServerEvent = {
      status: 'matched',
      message,
      roomId: match.id,
      opponentName: opponent.name,
      match: this.buildMatchSetup(match, player.playerId)
    };
    if (match.lobbyCode) event.lobbyCode = match.lobbyCode;
    this.sendStateToPlayer(player.playerId, TOPICS.multiplayerState, event);
  }

  private buildDiceCardPayload(
    match: Match,
    selfOwner: OwnerId
  ): Pick<MatchSetupPayload, 'diceCards' | 'diceCardPicksUsed' | 'diceCardOffer'> {
    const cards = match.diceCards;
    const normalized = selfOwner === 'player'
      ? { player: [...cards.player], enemy: [...cards.enemy] }
      : { player: [...cards.enemy], enemy: [...cards.player] };
    const offer = match.diceCardOffer?.[selfOwner];
    return {
      diceCards: normalized,
      diceCardPicksUsed: match.diceCardPicksUsed,
      ...(offer && offer.length > 0 ? { diceCardOffer: offer.map((card) => ({ ...card })) } : {})
    };
  }

  private buildMatchSetup(match: Match, playerId: string): MatchSetupPayload {
    const selfIndex = match.players.findIndex((player) => player.playerId === playerId);
    const selfOwner: OwnerId = selfIndex === 0 ? 'player' : 'enemy';
    const player = match.players[selfIndex];
    const opponent = match.players[selfIndex === 0 ? 1 : 0];
    const revealOpponent = match.phase !== 'placement';
    const { classLevels, talentIndices } = this.buildClassMaps(match, playerId, revealOpponent);
    const canonicalResult = match.result;
    const result = canonicalResult === 'draw'
      ? 'draw'
      : canonicalResult === undefined
      ? undefined
      : selfOwner === 'player'
      ? canonicalResult
      : canonicalResult === 'victory'
      ? 'defeat'
      : 'victory';
    return {
      matchId: match.id,
      selfOwner,
      opponentName: opponent?.name ?? 'Opponent',
      playerName: player?.name ?? 'Player',
      rules: match.rules,
      phase: match.phase,
      turn: match.setup.state.turn,
      deadlineAt: match.deadlineAt,
      selfReady: match.ready.has(playerId),
      state: toClientState(match.setup.state, match.setup.definitions, selfOwner, revealOpponent),
      pips: getPipMap(match.setup.state, selfOwner, revealOpponent),
      record: [...match.record],
      ...(result ? { result } : {}),
      classLevels,
      talentIndices,
      ...this.buildDiceCardPayload(match, selfOwner)
    };
  }

  private buildTurnEvent(
    match: Match,
    playerId: string,
    base: Omit<TurnEvent, 'matchId' | 'phase' | 'turn' | 'state' | 'pips' | 'result' | 'selfReady'>
  ): TurnEvent {
    const selfIndex = match.players.findIndex((player) => player.playerId === playerId);
    const selfOwner: OwnerId = selfIndex === 0 ? 'player' : 'enemy';
    const canonicalResult = match.result;
    const result = canonicalResult === 'draw'
      ? 'draw'
      : canonicalResult === undefined
      ? undefined
      : selfOwner === 'player'
      ? canonicalResult
      : canonicalResult === 'victory'
      ? 'defeat'
      : 'victory';
    const revealOpponent = match.phase !== 'placement';
    const classMaps = revealOpponent ? this.buildClassMaps(match, playerId, true) : null;
    return {
      ...base,
      matchId: match.id,
      phase: match.phase,
      turn: match.setup.state.turn,
      deadlineAt: match.deadlineAt,
      selfReady: match.ready.has(playerId),
      state: toClientState(match.setup.state, match.setup.definitions, selfOwner, revealOpponent),
      pips: getPipMap(match.setup.state, selfOwner, revealOpponent),
      ...(classMaps ?? {}),
      ...(base.status === 'resolved' && match.events.length > 0
        ? { events: match.events.map((event) => event.text) }
        : {}),
      ...(result ? { result } : {}),
      ...this.buildDiceCardPayload(match, selfOwner)
    };
  }

  private maybeOfferDiceCards(match: Match): void {
    if (!match.rules.randomMode || match.rules.randomModifier !== 'DiceCard') return;
    if (!canOfferDiceCards(match.setup.state.turn, match.diceCardPicksUsed)) return;
    const rng = () => randomInt(0, 1_000_000) / 1_000_000;
    const rarity = getDiceCardRarityRoll(rng);
    const activeKeys = getDiceCardActiveKeys(match.setup.state);
    const getDefinition = (typeId: string) => diceCatalog.get(typeId);
    const offers = {
      player: rollDiceCards(3, rarity, 'player', match.setup.state.dice, getDefinition, activeKeys, rng),
      enemy: rollDiceCards(3, rarity, 'enemy', match.setup.state.dice, getDefinition, activeKeys, rng)
    };
    if (offers.player.length === 0 && offers.enemy.length === 0) return;
    match.diceCardOffer = offers;
    match.diceCardPicks = {};
    this.appendRecord(match, [`Turn ${match.setup.state.turn} Dice Card draft: choose one card.`]);
  }

  private applyDiceCardPicks(match: Match): void {
    if (!match.diceCardOffer) return;
    const picks: string[] = [];
    (['player', 'enemy'] as OwnerId[]).forEach((owner) => {
      const offer = match.diceCardOffer?.[owner] ?? [];
      if (offer.length === 0) return;
      const selectedKey = match.diceCardPicks[owner];
      const card = offer.find((candidate) => candidate.key === selectedKey)
        ?? offer[randomInt(0, offer.length)];
      if (!card) return;
      applyDiceCardToState(match.setup.state, match.setup.definitions, owner, card);
      const playerIndex = owner === 'player' ? 0 : 1;
      picks.push(`${match.players[playerIndex]?.name ?? `Player ${playerIndex + 1}`} picked ${card.title} (${card.rarity}).`);
    });
    if (picks.length > 0) this.appendRecord(match, picks);
    match.diceCardPicksUsed += 1;
    match.diceCardOffer = null;
    match.diceCardPicks = {};
  }

  private resolveMatch(match: Match, autoPlaced: boolean, requestIds: Record<string, string> = {}): void {
    if (!this.matches.has(match.id)) return;
    match.updatedAt = Date.now();
    if (match.phase !== 'placement') return;
    if (autoPlaced) {
      for (const player of match.players) {
        const owner: OwnerId = player.playerId === match.players[0].playerId ? 'player' : 'enemy';
        autoPlaceBoard(match.setup.state, match.setup.definitions, owner, match.seed, match.setup.state.turn);
      }
    } else {
      for (const [index, player] of match.players.entries()) {
        const owner: OwnerId = index === 0 ? 'player' : 'enemy';
        const hasBoard = match.setup.state.dice.some((die) => (
          die.ownerId === owner && die.zone === 'board' && !die.isDestroyed
        ));
        if (!hasBoard) {
          autoPlaceBoard(match.setup.state, match.setup.definitions, owner, match.seed, match.setup.state.turn);
        }
      }
    }

    this.applyDiceCardPicks(match);
    const resolvedTurn = match.setup.state.turn;
    match.phase = 'combat';
    const resolution = resolveCombat(
      match.setup.state,
      match.setup.definitions,
      match.rules,
      match.seed,
      diceCatalog
    );
    match.events = resolution.events;
    this.appendRecord(match, [
      `Turn ${resolvedTurn}`,
      ...resolution.events.map((event) => event.text)
    ]);
    const limitReached = match.rules.turnLimit !== -1 && match.setup.state.turn > match.rules.turnLimit;
    const winner = currentWinner(match.setup.state);
    const finished = Boolean(resolution.result) || limitReached || winner !== undefined;

    if (finished) {
      const finalWinner = winner ?? resolution.winnerId ?? (limitReached ? healthWinner(match.setup.state) : undefined);
      const resolvedResult = finalWinner === 'draw' || finalWinner === undefined
        ? 'draw'
        : finalWinner === 'player'
        ? 'victory'
        : 'defeat';
      match.phase = 'complete';
      match.result = resolvedResult;
      if (finalWinner && finalWinner !== 'draw') {
        const winnerIndex = finalWinner === 'player' ? 0 : 1;
        match.winnerPlayerId = match.players[winnerIndex]?.playerId;
      }
      this.appendRecord(match, [match.result === 'draw'
        ? 'Result: draw.'
        : `Result: Player ${finalWinner === 'player' ? 'one' : 'two'} wins.`]);
      this.deliverMatchResult(match, match.result === 'draw' ? 'The match ended in a draw.' : 'The match is complete.', { autoPlaced, requestIds });
      return;
    }

    match.phase = 'placement';
    match.ready.clear();
    match.placementStartedAt = Date.now();
    match.deadlineAt = match.placementStartedAt + MATCH_PLACEMENT_MS;
    rollPips(match.setup.state, match.seed, match.setup.state.turn);
    this.maybeOfferDiceCards(match);
    for (const player of match.players) {
      this.sendTurnToPlayer(player.playerId, this.buildTurnEvent(match, player.playerId, {
        accepted: true,
        status: 'resolved',
        requestId: requestIds[player.playerId],
        message: autoPlaced ? 'Placement timed out; remaining dice were auto-placed.' : 'Combat resolved.',
        autoPlaced
      }));
    }
  }

  private endMatch(
    match: Match,
    message: string,
    disconnectedPlayerId?: string,
    remainingResult?: 'draw'
  ): void {
    if (!this.matches.delete(match.id)) return;
    if (disconnectedPlayerId) {
      const remaining = match.players.find((player) => player.playerId !== disconnectedPlayerId);
      if (remaining) {
        match.phase = 'complete';
        match.result = match.players[0]?.playerId === disconnectedPlayerId ? 'defeat' : 'victory';
        match.winnerPlayerId = remaining.playerId;
        this.appendRecord(match, [`${match.players.find((player) => player.playerId === disconnectedPlayerId)?.name ?? 'Opponent'} disconnected.`]);
        match.events = [];
        this.sendTurnToPlayer(remaining.playerId, this.buildTurnEvent(match, remaining.playerId, {
          accepted: true,
          status: 'resolved',
          message: 'Your opponent disconnected; the match has ended.'
        }));
      }
    } else if (remainingResult) {
      match.phase = 'complete';
      match.result = remainingResult;
      for (const player of match.players) {
        this.sendTurnToPlayer(player.playerId, this.buildTurnEvent(match, player.playerId, {
          accepted: true,
          status: 'resolved',
          message
        }));
      }
    }
    for (const player of match.players) {
      const session = this.sessions.get(player.playerId);
      if (!session) continue;
      session.matchId = null;
      session.lobbyCode = null;
      this.sendStateToPlayer(player.playerId, TOPICS.multiplayerState, {
        status: 'disconnected',
        message
      });
    }
  }

  private deliverMatchResult(
    match: Match,
    message: string,
    options: { autoPlaced?: boolean; skipPlayerId?: string; requestIds?: Record<string, string> } = {}
  ): void {
    let undelivered = false;
    match.updatedAt = Date.now();
    for (const player of match.players) {
      if (player.playerId === options.skipPlayerId || match.resultDelivered.has(player.playerId)) continue;
      const session = this.sessions.get(player.playerId);
      const actor = session ? this.connectedActors.get(session.actorId) : undefined;
      if (!actor) {
        undelivered = true;
        if (session) session.lobbyCode = null;
        continue;
      }
      this.sendTurn(actor, this.buildTurnEvent(match, player.playerId, {
        accepted: true,
        status: 'resolved',
        requestId: options.requestIds?.[player.playerId],
        message,
        autoPlaced: options.autoPlaced
      }));
      match.resultDelivered.add(player.playerId);
      if (session) {
        session.matchId = null;
        session.lobbyCode = null;
        this.sendState(actor, TOPICS.multiplayerState, { status: 'disconnected', message });
      }
    }
    if (!undelivered) this.matches.delete(match.id);
  }

  private resumeCompletedMatch(actor: ArenaActor, session: Session, match: Match): void {
    const player = match.players.find((candidate) => candidate.playerId === session.playerId);
    const opponent = match.players.find((candidate) => candidate.playerId !== session.playerId);
    if (!player || !opponent) return;
    this.sendMatched(match, player, opponent, 'Match result restored.');
    match.resultDelivered.add(player.playerId);
    session.matchId = null;
    session.lobbyCode = null;
    this.sendState(actor, TOPICS.multiplayerState, {
      status: 'disconnected',
      message: 'The match is complete.'
    });
    if (match.resultDelivered.size >= match.players.length) this.matches.delete(match.id);
  }

  private buildClassMaps(
    match: Match,
    playerId: string,
    revealOpponent: boolean
  ): { classLevels: Record<string, number>; talentIndices: Record<string, number | null> } {
    const classLevels: Record<string, number> = {};
    const talentIndices: Record<string, number | null> = {};
    match.players.forEach((candidate, index) => {
      if (!revealOpponent && candidate.playerId !== playerId) return;
      const prefix = index === 0 ? 'a' : 'b';
      candidate.loadout.forEach((entry, slot) => {
        const instanceId = `${prefix}-${slot + 1}`;
        classLevels[instanceId] = entry.classLevel;
        talentIndices[instanceId] = entry.talentIndex;
      });
      const owner: OwnerId = index === 0 ? 'player' : 'enemy';
      match.setup.state.dice.forEach((die) => {
        if (die.ownerId !== owner || classLevels[die.instanceId] !== undefined) return;
        classLevels[die.instanceId] = die.classLevel;
        talentIndices[die.instanceId] = null;
      });
    });
    return { classLevels, talentIndices };
  }

  private appendRecord(match: Match, lines: string[]): void {
    match.record.push(...lines);
    if (match.record.length > MAX_MATCH_RECORD_LINES) {
      match.record.splice(0, match.record.length - MAX_MATCH_RECORD_LINES);
    }
  }

  private sendResume(actor: ArenaActor, session: Session): void {
    if (session.matchId) {
      const match = this.matches.get(session.matchId);
      if (match) {
        if (match.phase === 'complete' && match.result) {
          this.resumeCompletedMatch(actor, session, match);
          return;
        }
        const player = match.players.find((candidate) => candidate.playerId === session.playerId);
        const opponent = match.players.find((candidate) => candidate.playerId !== session.playerId);
        if (player && opponent) this.sendMatched(match, player, opponent);
        return;
      }
      session.matchId = null;
    }
    if (session.lobbyCode && this.lobbies.has(session.lobbyCode)) {
      this.sendState(actor, TOPICS.multiplayerState, {
        status: 'lobby',
        lobbyCode: session.lobbyCode,
        roomId: ARENA_ROOM_ID,
        message: `Rivalis lobby ${session.lobbyCode} is ready.`
      });
      return;
    }
    session.lobbyCode = null;
    if (this.queue.some((entry) => entry.profile.playerId === session.playerId)) {
      this.sendState(actor, TOPICS.matchmakingState, {
        status: 'queued',
        message: 'Rejoined the Rivalis matchmaking queue.'
      });
      return;
    }
    this.sendState(actor, TOPICS.multiplayerState, {
      status: 'idle',
      message: 'No active Rivalis session.'
    });
  }

  private sessionFor(actor: ArenaActor): Session | null {
    const playerId = this.actorPlayers.get(actor.id);
    if (!playerId) return null;
    const session = this.sessions.get(playerId);
    return session?.actorId === actor.id ? session : null;
  }

  private loadoutIsValid(loadout: LoadoutEntry[]): boolean {
    return loadout.length === 5 && loadout.every((entry) => {
      const definition = diceCatalog.get(normalizeTypeId(entry.typeId) ?? '');
      if (!definition || !isPvPTypeIdAllowed(definition.typeId)) return false;
      if (entry.talentIndex === null) return true;
      const talent = definition.talents?.[entry.talentIndex];
      const requiredClass = typeof talent?.classNeeded === 'number' ? talent.classNeeded : 9;
      return Boolean(talent && !talent.comingSoon && requiredClass <= entry.classLevel);
    });
  }

  private applyJoin(session: Session, request: {
    loadout: LoadoutEntry[];
    rules: MatchRules;
  }): void {
    session.loadout = normalizePvpLoadout(request.loadout);
    session.rules = normalizePvpRules(request.rules);
  }

  private profileFor(session: Session): MatchPlayer | null {
    if (!session.rules || !normalizePlayerName(session.name) || session.loadout.length !== 5) return null;
    return {
      playerId: session.playerId,
      actorId: session.actorId,
      name: session.name,
      loadout: session.loadout.map((entry) => ({ ...entry })),
      rules: { ...session.rules }
    };
  }

  private allowAction(session: Session, topic: ServerTopic): boolean {
    if (this.actionLimiter.take(`${session.playerId}:lobby`)) return true;
    const actor = this.connectedActors.get(session.actorId);
    if (actor) this.sendFailure(actor, topic, 'Too many multiplayer requests.');
    return false;
  }

  private removeFromQueue(playerId: string): void {
    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      if (this.queue[index]?.profile.playerId === playerId) this.queue.splice(index, 1);
    }
  }

  private cleanup(): void {
    const now = Date.now();

    for (const match of [...this.matches.values()]) {
      if (match.phase === 'placement' && now >= match.deadlineAt) {
        this.resolveMatch(match, true);
        continue;
      }
      if (now - match.updatedAt > this.options.matchTtlMs) {
        this.endMatch(match, 'Match expired.', undefined, match.phase === 'complete' ? undefined : 'draw');
      }
    }

    for (let index = this.queue.length - 1; index >= 0; index -= 1) {
      const entry = this.queue[index];
      if (!entry || now - entry.queuedAt <= this.options.queueTtlMs) continue;
      this.queue.splice(index, 1);
      this.sendStateToPlayer(entry.profile.playerId, TOPICS.matchmakingState, {
        status: 'disconnected',
        message: 'Matchmaking queue timed out.'
      });
    }

    for (const [code, lobby] of [...this.lobbies]) {
      if (now - lobby.createdAt <= this.options.lobbyTtlMs) continue;
      this.lobbies.delete(code);
      const session = this.sessions.get(lobby.hostId);
      if (session) session.lobbyCode = null;
      this.sendStateToPlayer(lobby.hostId, TOPICS.multiplayerState, {
        status: 'disconnected',
        message: 'Lobby expired.'
      });
    }
  }

  private sendState(actor: ArenaActor, topic: ServerTopic, event: ServerEvent): void {
    actor.send(topic, encodeJson(event));
  }

  private sendStateToPlayer(playerId: string, topic: ServerTopic, event: ServerEvent): void {
    const session = this.sessions.get(playerId);
    if (!session) return;
    const actor = this.connectedActors.get(session.actorId);
    if (actor) this.sendState(actor, topic, event);
  }

  private sendFailure(actor: ArenaActor, topic: ServerTopic, message: string): void {
    actor.send(topic, encodeJson({ status: 'failed', message }));
  }

  private sendTurn(actor: ArenaActor, event: TurnEvent): void {
    actor.send(TOPICS.turnState, encodeJson(event));
  }

  private sendTurnToPlayer(playerId: string, event: TurnEvent): void {
    const session = this.sessions.get(playerId);
    if (!session) return;
    const actor = this.connectedActors.get(session.actorId);
    if (actor) this.sendTurn(actor, event);
  }
}

