import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ArenaMultiplayerHandlers,
  ArenaMultiplayerJoinOptions,
  ArenaMultiplayerMatchSetup,
  ArenaMultiplayerStatus,
  ArenaMultiplayerTurnResolution
} from '../src/systems/ArenaMultiplayerClient';
import { MultiplayerStore, normalizeLobbyCode, type MultiplayerTransport } from '../src/systems/MultiplayerStore';
import {
  BOT_VICTORY_TOKEN_REWARDS,
  BOT_FIRST_WIN_KEY,
  DEFAULT_VERSUS_BOT_CONFIG,
  SingleplayerStore,
  isVersusBotFirstWinEligible,
  normalizeVersusBotConfig
} from '../src/systems/SingleplayerStore';

class FakeMultiplayerTransport implements MultiplayerTransport {
  configured = true;
  handlers: ArenaMultiplayerHandlers = {};
  joined: ArenaMultiplayerJoinOptions[] = [];
  cancelled = 0;
  left = 0;
  status: ArenaMultiplayerStatus = { state: 'disconnected', message: 'Offline.' };
  private statusHandler?: (status: ArenaMultiplayerStatus) => void;

  getStatus(): ArenaMultiplayerStatus {
    return { ...this.status };
  }

  setHandlers(handlers: ArenaMultiplayerHandlers): void {
    this.handlers = handlers;
  }

  async connect(onStatus?: (status: ArenaMultiplayerStatus) => void): Promise<void> {
    this.statusHandler = onStatus;
    this.status = { state: 'connected', message: 'Connected.' };
    onStatus?.(this.getStatus());
  }

  join(options: ArenaMultiplayerJoinOptions): void {
    this.joined.push(options);
  }

  cancelMatchmaking(): void { this.cancelled += 1; }

  leaveSession(): void { this.left += 1; }

  async submitTurn(): Promise<ArenaMultiplayerTurnResolution> {
    return { accepted: true, status: 'accepted' };
  }

  disconnect(): void {
    this.status = { state: 'disconnected', message: 'Offline.' };
  }

  emit(status: ArenaMultiplayerStatus): void {
    this.status = status;
    this.statusHandler?.(this.getStatus());
  }
}

function makeMultiplayerSetup(): ArenaMultiplayerMatchSetup {
  return {
    matchId: 'match-1',
    selfOwner: 'player',
    opponentName: 'Opponent',
    playerName: 'Player',
    rules: { useLevelling: false, turnLimit: 10, randomMode: false },
    phase: 'placement',
    turn: 1,
    deadlineAt: 50_000,
    selfReady: false,
    state: { turn: 1, combatPhase: 'placement', reviveCounts: {}, dice: [] },
    pips: {},
    classLevels: {},
    talentIndices: {}
  };
}

function makeScene(registry: Map<string, unknown>) {
  return {
    registry: {
      get: (key: string) => registry.get(key),
      set: (key: string, value: unknown) => { registry.set(key, value); }
    }
  } as unknown as Parameters<SingleplayerStore['getClaimedBotFirstWins']>[0];
}

test('MultiplayerStore normalizes lobby codes and tracks lobby throttling', () => {
  assert.equal(normalizeLobbyCode('ab cdef'), 'ABCDEF');
  assert.equal(normalizeLobbyCode('abcd2f'), 'ABCD2F');
  assert.equal(normalizeLobbyCode('ABCD1F'), '');
  assert.equal(normalizeLobbyCode('ABCDEF'), 'ABCDEF');

  const store = new MultiplayerStore(new FakeMultiplayerTransport());
  const now = 1_000_000;
  assert.deepEqual(store.canAttemptLobbyJoin(now), { allowed: true, remainingMs: 0 });
  for (let attempt = 0; attempt < 5; attempt++) store.registerFailedLobbyJoin(now);
  assert.equal(store.canAttemptLobbyJoin(now).allowed, false);
  assert.equal(store.getLobbyJoinThrottleRemainingMs(now), 30_000);
  assert.equal(store.canAttemptLobbyJoin(now + 30_001).allowed, true);
});

test('MultiplayerStore queues lobby options after connecting and tracks lobby status', async () => {
  const transport = new FakeMultiplayerTransport();
  const store = new MultiplayerStore(transport);
  const options: ArenaMultiplayerJoinOptions = {
    mode: 'multiplayer',
    lobbyAction: 'create',
    ruleset: 'classic',
    rules: { useLevelling: false, turnLimit: 7, randomMode: false },
    loadout: [{ typeId: 'Fire', classLevel: 1, talentIndex: null }]
  };
  const statuses: ArenaMultiplayerStatus[] = [];

  const status = await store.queue(options, 'Player', (next) => statuses.push(next));
  assert.equal(status.state, 'connected');
  assert.equal(statuses.at(-1)?.state, 'connected');
  assert.deepEqual(transport.joined, [options]);

  transport.emit({ state: 'lobby', message: 'Waiting.', lobbyCode: 'ABC123' });
  assert.equal(store.status.lobbyCode, 'ABC123');
  assert.equal(store.status.state, 'lobby');
});

test('MultiplayerStore resets lobby throttling when a lobby is found', async () => {
  const transport = new FakeMultiplayerTransport();
  const store = new MultiplayerStore(transport);
  await store.queue({
    mode: 'multiplayer',
    lobbyAction: 'join',
    lobbyCode: 'ABC123',
    ruleset: 'classic',
    rules: { useLevelling: false, turnLimit: 10, randomMode: false },
    loadout: []
  }, 'Player');
  for (let attempt = 0; attempt < 5; attempt++) store.registerFailedLobbyJoin(10);
  assert.equal(store.canAttemptLobbyJoin(10).allowed, false);

  transport.emit({ state: 'lobby', message: 'Waiting.', lobbyCode: 'ABC123' });
  assert.equal(store.canAttemptLobbyJoin(10).allowed, true);
});

test('MultiplayerStore owns active match readiness and deadline state', () => {
  const store = new MultiplayerStore(new FakeMultiplayerTransport());
  const setup = makeMultiplayerSetup();

  store.beginMatch(setup);
  assert.equal(store.isActive, true);
  assert.equal(store.match?.matchId, 'match-1');
  assert.deepEqual(store.rules, setup.rules);
  assert.equal(store.deadlineAt, 50_000);
  assert.equal(store.ready, false);
  assert.equal(store.submitting, false);

  store.setSubmitting(true);
  assert.equal(store.submitting, true);
  store.setReady(true);
  store.setDeadline(75_000);
  assert.equal(store.ready, true);
  assert.equal(store.deadlineAt, 75_000);

  store.updateMatch({ ...setup, deadlineAt: 100_000 });
  assert.equal(store.deadlineAt, 100_000);
  store.resetSession();
  assert.equal(store.isActive, false);
  assert.equal(store.ready, false);
  assert.equal(store.deadlineAt, 0);
});

test('MultiplayerStore reconciles authoritative selfReady when a match is restored', () => {
  const store = new MultiplayerStore(new FakeMultiplayerTransport());
  const setup = makeMultiplayerSetup();

  store.beginMatch({ ...setup, selfReady: true });
  assert.equal(store.ready, true);

  store.updateMatch({ ...setup, selfReady: false });
  assert.equal(store.ready, false);
  store.updateMatch({ ...setup, selfReady: true });
  assert.equal(store.ready, true);
});

test('MultiplayerStore cancels queues and clears a left session', () => {
  const transport = new FakeMultiplayerTransport();
  const store = new MultiplayerStore(transport);

  store.cancelMatchmaking();
  assert.equal(transport.cancelled, 1);

  store.beginMatch(makeMultiplayerSetup());
  store.setReady(true);
  store.leaveSession();
  assert.equal(transport.left, 1);
  assert.equal(store.isActive, false);
  assert.equal(store.ready, false);
});

test('MultiplayerStore clears a stale match when the server reports idle', async () => {
  const transport = new FakeMultiplayerTransport();
  const store = new MultiplayerStore(transport);
  await store.queue({ mode: 'matchmaking', ruleset: 'classic', rules: { useLevelling: false, turnLimit: 10, randomMode: false }, loadout: [] }, 'Player');
  store.beginMatch(makeMultiplayerSetup());

  transport.emit({ state: 'idle', message: 'No active Rivalis session.' });
  assert.equal(store.status.state, 'idle');
  assert.equal(store.isActive, false);
  assert.equal(store.ready, false);
});

test('SingleplayerStore keeps Randomize Loadout/Class UP independent of Random Mode', () => {
  const store = new SingleplayerStore();
  assert.deepEqual(store.config, DEFAULT_VERSUS_BOT_CONFIG);
  assert.equal(store.shouldRandomizeLoadoutAndClassUps(), false);

  store.configure({ randomMode: false, randomizeLoadoutAndClassUps: true });
  assert.equal(store.randomMode, false);
  assert.equal(store.shouldRandomizeLoadoutAndClassUps(), true);
  assert.deepEqual(normalizeVersusBotConfig({ turnCount: 4 }), { ...DEFAULT_VERSUS_BOT_CONFIG, turnCount: -1 });
});

test('SingleplayerStore awards difficulty-based victory tokens and suppresses first wins in random modes', () => {
  const store = new SingleplayerStore();
  assert.deepEqual(BOT_VICTORY_TOKEN_REWARDS, {
    Baby: 250,
    Easy: 500,
    Medium: 750,
    Hard: 1_000,
    Nightmare: 1_500
  });
  assert.equal(store.getVictoryTokenReward(), 750);
  assert.equal(store.getVictoryTokenReward('Baby'), 250);
  assert.equal(store.getVictoryTokenReward('Nightmare'), 1_500);
  assert.equal(store.isFirstWinEligible(), true);

  store.configure({ randomMode: true });
  assert.equal(store.isFirstWinEligible(), false);
  assert.equal(isVersusBotFirstWinEligible(store.config), false);
  assert.equal(store.getFirstWinAward('Medium', false), null);

  store.configure({ randomMode: false, randomizeLoadoutAndClassUps: true });
  assert.equal(store.isFirstWinEligible(), false);
  assert.equal(isVersusBotFirstWinEligible(store.config), false);
  assert.equal(store.getFirstWinAward('Medium', false), null);

  store.configure({ randomMode: false, randomizeLoadoutAndClassUps: false });
  assert.equal(store.isFirstWinEligible(), true);
  assert.deepEqual(store.getFirstWinAward('Medium', false), { tokens: 2_000, chips: 60 });
  assert.equal(store.getFirstWinAward('Medium', true), null);
  assert.deepEqual(store.getFirstWinReward('Medium'), { tokens: 2_000, chips: 60 });
});

test('SingleplayerStore normalizes bot settings and persists first-win claims', () => {
  const store = new SingleplayerStore();
  store.configure({ difficulty: 'Nightmare', useLevelling: false, turnCount: 10 });
  assert.equal(store.difficulty, 'Nightmare');
  assert.deepEqual(store.getClassRange(), [7, 12]);
  assert.deepEqual(store.getFirstWinReward(), { tokens: 10_000, chips: 100 });

  const registry = new Map<string, unknown>();
  const scene = makeScene(registry);
  assert.deepEqual(store.getClaimedBotFirstWins(scene), []);
  assert.equal(store.hasClaimedBotFirstWin(scene, 'Nightmare'), false);

  registry.set(BOT_FIRST_WIN_KEY, ['Baby', 'Nope', 'Baby', 'Nightmare']);
  assert.deepEqual(store.getClaimedBotFirstWins(scene), ['Baby', 'Nightmare']);
  assert.equal(store.hasClaimedBotFirstWin(scene, 'Nightmare'), true);

  registry.delete(BOT_FIRST_WIN_KEY);
  assert.deepEqual(store.markBotFirstWinClaimed(scene, 'Easy'), ['Easy']);
  assert.deepEqual(store.getClaimedBotFirstWins(scene), ['Easy']);
});
