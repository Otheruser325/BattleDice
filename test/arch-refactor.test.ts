import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { initializeSecureStorage } from '../src/utils/SecureStorage';
import type { DiceDefinition, DiceInstanceState } from '../src/types/game';
import { CalendarStore, LOGIN_REWARD_DAYS, LOGIN_REWARD_TOTAL_DAYS, resolveLoginRewardProgress } from '../src/systems/CalendarStore';
import { getBossfightMenuState, saveBossfightMenuState } from '../src/systems/BossStore';
import { getChallengeRewardClaims, hasChallengeRewardClaimed } from '../src/systems/ChallengeStore';
import { applyClassProgression, getBossClassMultiplier, getClassMultiplier, getClassScaledSkillDescription } from '../src/systems/ClassProgression';
import { TransformState, getTransformIndexForActiveDefinition, getTransformIndexForFlag, type TransformStateHost } from '../src/systems/TransformState';

before(async () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); }
    }
  });

  const records = new Map<string, unknown>();
  let signingStoreCreated = false;
  const signingStore = {
    get: (key: string) => {
      const request: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = { result: records.get(key) };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
    put: (value: unknown, key: string) => {
      records.set(key, value);
    }
  };
  const database = {
    objectStoreNames: { contains: () => signingStoreCreated },
    createObjectStore: () => {
      signingStoreCreated = true;
      return signingStore;
    },
    transaction: () => {
      const transaction: { objectStore: () => typeof signingStore; oncomplete?: () => void; onerror?: () => void } = {
        objectStore: () => signingStore
      };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    },
    close: () => {}
  };
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open: () => {
        const request: { result: typeof database; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void } = { result: database };
        queueMicrotask(() => {
          request.onupgradeneeded?.();
          request.onsuccess?.();
        });
        return request;
      }
    }
  });

  await initializeSecureStorage();
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  delete (globalThis as unknown as { indexedDB?: IDBFactory }).indexedDB;
});

function loginDateDaysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
}

test('CalendarStore preserves fresh, sequential, same-day, and completed login state', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const today = now.toISOString().slice(0, 10);

  const fresh = resolveLoginRewardProgress({}, now);
  assert.equal(fresh.reward.startDate, today);
  assert.deepEqual(fresh.reward.claimedDays, []);
  assert.equal(fresh.nextClaimableDay, 1);
  assert.equal(fresh.isMalformed, false);
  assert.equal(fresh.isComplete, false);

  const sequential = resolveLoginRewardProgress({
    loginReward: { startDate: loginDateDaysAgo(now, 2), claimedDays: [1] }
  }, now);
  assert.equal(sequential.unlockedDay, 3);
  assert.equal(sequential.nextClaimableDay, 2);
  assert.equal(sequential.nextUnlockDay, 4);
  assert.equal(sequential.alreadyClaimedToday, false);

  const sameDay = resolveLoginRewardProgress({
    loginReward: {
      startDate: loginDateDaysAgo(now, 1),
      claimedDays: [1],
      lastClaimDate: today
    }
  }, now);
  assert.equal(sameDay.alreadyClaimedToday, true);
  assert.equal(sameDay.nextClaimableDay, null);
  assert.equal(sameDay.nextUnlockDay, 3);

  const complete = resolveLoginRewardProgress({
    loginReward: { startDate: loginDateDaysAgo(now, 6), claimedDays: [1, 2, 3, 4, 5, 6, 7] }
  }, now);
  assert.equal(complete.isComplete, true);
  assert.equal(complete.nextClaimableDay, null);
  assert.equal(complete.nextUnlockDay, LOGIN_REWARD_TOTAL_DAYS);
});

test('CalendarStore repairs malformed claim order without preserving stale Day 7 metadata', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const progress = resolveLoginRewardProgress({
    loginReward: {
      startDate: loginDateDaysAgo(now, 6),
      claimedDays: [5, 6],
      lastClaimDate: '2026-11-12',
      lastClaimAt: '2026-11-12T12:00:00.000Z',
      day7LegendaryTitle: 'Stale'
    }
  }, now);

  assert.equal(progress.isMalformed, true);
  assert.deepEqual(progress.reward.claimedDays, []);
  assert.equal(progress.claimed.size, 0);
  assert.equal(progress.nextClaimableDay, 1);
  assert.equal(progress.reward.lastClaimDate, undefined);
  assert.equal(progress.reward.lastClaimAt, undefined);
  assert.equal(progress.reward.day7LegendaryTitle, undefined);
  assert.equal(LOGIN_REWARD_DAYS.length, LOGIN_REWARD_TOTAL_DAYS);
});

test('CalendarStore rejects same-day, out-of-order, and already-claimed requests without mutating progress', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const today = now.toISOString().slice(0, 10);
  const registry = new Map<string, unknown>();
  const scene = {
    registry: {
      get: (key: string) => registry.get(key),
      set: (key: string, value: unknown) => { registry.set(key, value); }
    }
  } as unknown as Parameters<typeof CalendarStore.claim>[0];

  registry.set('player:profile', {
    username: 'Player',
    trophies: 0,
    nameChangesUsed: 0,
    loginReward: {
      startDate: loginDateDaysAgo(now, 1),
      claimedDays: [1],
      lastClaimDate: today
    }
  });
  assert.equal(CalendarStore.claim(scene, 2, now).status, 'locked');
  assert.equal(CalendarStore.claim(scene, 1, now).status, 'already-claimed');

  registry.set('player:profile', {
    username: 'Player',
    trophies: 0,
    nameChangesUsed: 0,
    loginReward: { startDate: loginDateDaysAgo(now, 6), claimedDays: [] }
  });
  const outOfOrder = CalendarStore.claim(scene, 2, now);
  assert.equal(outOfOrder.status, 'locked');
  assert.deepEqual(outOfOrder.status === 'locked' ? outOfOrder.messages : [], [
    'Claim Day 1 first.'
  ]);
});

function makeTransformDefinition(): DiceDefinition {
  return {
    typeId: 'Time',
    title: 'Time Dice',
    attack: 10,
    health: 100,
    range: 2,
    footprint: 1,
    targetingMode: 'Nearest',
    rarity: 'Rare',
    accent: '#ffffff',
    skills: [{
      type: 'Passive',
      title: 'Temporal Shift',
      description: '',
      modifiers: { transformPipCount: 1, transformOnOddPip: true }
    }],
    transformStats: [{
      title: 'First Form',
      attack: 20,
      health: 120,
      range: 3,
      recoveryRate: 0.5,
      transformDuration: 2,
      accent: '#ff0000',
      symbol: 'I',
      skills: []
    }, {
      title: 'Second Form',
      attack: 30,
      health: 140,
      range: 4,
      recoveryRate: 0,
      accent: '#00ff00',
      symbol: 'II',
      skills: []
    }],
    transformFlags: ['firstForm', 'secondForm']
  };
}

class FakeTransformHost implements TransformStateHost {
  definition: DiceDefinition;
  override?: DiceDefinition;
  die: DiceInstanceState;
  logs: string[] = [];
  transformedHooks: DiceInstanceState[] = [];
  animations: string[] = [];
  resetManaCount = 0;

  constructor(definition: DiceDefinition) {
    this.definition = definition;
    this.die = {
      instanceId: 'player-Time-1',
      typeId: definition.typeId,
      ownerId: 'player',
      zone: 'board',
      maxHealth: definition.health,
      currentHealth: definition.health,
      isDestroyed: false,
      hasFinishedAttacking: false,
      attacksRemaining: 1,
      gridPosition: { row: 0, col: 0 }
    };
  }

  getDefinitionForInstance(): DiceDefinition {
    return this.override ?? this.definition;
  }

  getBaseDefinitionForInstance(): DiceDefinition {
    return this.definition;
  }

  getCombatBaseDefinition(): DiceDefinition {
    return this.definition;
  }

  getClassLevel(): number {
    return 1;
  }

  applyDungeonCardDefinitionForOwner(definition: DiceDefinition): DiceDefinition {
    return definition;
  }

  diceCardMaxHealthBonus = 0;

  getDiceCardMaxHealthForDefinition(definition: DiceDefinition): number {
    return definition.health + this.diceCardMaxHealthBonus;
  }

  durationBonus = 0;

  getTransformDurationBonus(): number {
    return this.durationBonus;
  }

  getDie(): DiceInstanceState {
    return this.die;
  }

  updateDie(_instanceId: string, update: (die: DiceInstanceState) => DiceInstanceState): DiceInstanceState {
    this.die = update(this.die);
    return this.die;
  }

  setDefinitionOverride(_instanceId: string, definition: DiceDefinition): void {
    this.override = definition;
  }

  resetActiveMana(): void {
    this.resetManaCount += 1;
  }

  writeCombatLog(message: string): void {
    this.logs.push(message);
  }

  applyOnTransformedSkillEffects(die: DiceInstanceState): void {
    this.transformedHooks.push(die);
  }

  animateTransformEffect(die: DiceInstanceState): void {
    this.animations.push(die.instanceId);
  }

  getCombatDieName(die: DiceInstanceState): string {
    return die.instanceId;
  }
}

test('TransformState advances pip forms, exposes visuals, and expires timed forms without losing health', () => {
  const definition = makeTransformDefinition();
  const host = new FakeTransformHost(definition);
  const state = new TransformState(host);

  assert.equal(getTransformIndexForActiveDefinition(definition), 0);
  assert.equal(getTransformIndexForActiveDefinition(definition, 0), 1);
  assert.equal(getTransformIndexForActiveDefinition(definition, 1), 1);

  const transformed = state.tryAdvancePipTriggeredTransform(host.die, 1);
  assert.equal(state.getIndex(host.die.instanceId), 0);
  assert.equal(state.wasPipTriggered(host.die.instanceId), true);
  assert.equal(transformed?.maxHealth, 120);
  assert.equal(transformed?.currentHealth, 120);
  assert.equal(state.getFlags(host.die).isTransformed, true);
  assert.deepEqual(state.getTransformedVisual(host.die), { accent: '#ff0000', symbol: 'I' });
  assert.equal(host.transformedHooks.length, 1);
  assert.equal(host.animations.length, 1);
  assert.match(host.logs[0] ?? '', /advances into First Form/);

  state.tickDurations();
  assert.equal(state.getIndex(host.die.instanceId), 0);
  state.tickDurations();
  assert.equal(state.getIndex(host.die.instanceId), undefined);
  assert.equal(host.override, definition);
  assert.equal(host.die.maxHealth, 100);
  assert.equal(host.die.currentHealth, 100);
});

test('TransformState flips alternate forms and rejects a reverted pip roll', () => {
  const definition = makeTransformDefinition();
  const host = new FakeTransformHost(definition);
  const state = new TransformState(host);

  const first = state.transformToAlternateForm(host.die);
  assert.equal(first?.maxHealth, 120);
  assert.equal(state.getIndex(host.die.instanceId), 0);
  assert.equal(state.isPermanent(host.die.instanceId), false);
  assert.equal(host.transformedHooks.length, 1);

  state.reconcilePipTriggeredTransform(host.die, 1);
  assert.equal(state.getIndex(host.die.instanceId), 0);

  const hostForRollback = new FakeTransformHost(definition);
  const rollbackState = new TransformState(hostForRollback);
  rollbackState.tryAdvancePipTriggeredTransform(hostForRollback.die, 1);
  rollbackState.reconcilePipTriggeredTransform(hostForRollback.die, 2);
  assert.equal(rollbackState.getIndex(hostForRollback.die.instanceId), undefined);
  assert.equal(hostForRollback.override, definition);
});

test('TransformState resolves and applies the soul-cap instakill form by flag and capability', () => {
  const definition = makeTransformDefinition();
  const instakillDefinition: DiceDefinition = {
    ...definition,
    skills: [{
      type: 'Passive',
      title: 'Death Form',
      description: '',
      modifiers: { transformSoulCount: 2 }
    }],
    transformStats: [{
      ...definition.transformStats![0]!,
      skills: [{
        type: 'Passive',
        title: 'Instakill Form',
        description: '',
        modifiers: { instakill: true }
      }]
    }],
    transformFlags: ['instakillForm']
  };
  assert.equal(
    getTransformIndexForFlag(instakillDefinition, 'instakillForm', (skill) => skill.modifiers?.instakill === true),
    0
  );
  assert.equal(getTransformIndexForFlag(definition, 'instakillForm'), undefined);

  const host = new FakeTransformHost(instakillDefinition);
  const state = new TransformState(host);
  const transformed = state.transformFromSoulCap(host.die);
  assert.equal(state.getIndex(host.die.instanceId), 0);
  assert.equal(transformed?.maxHealth, 120);
  assert.equal(host.resetManaCount, 1);
  assert.match(host.logs[0] ?? '', /transforms into First Form/);
});

test('TransformState includes dungeon-card extra turns when timing a transform', () => {
  const definition = makeTransformDefinition();
  const host = new FakeTransformHost(definition);
  host.durationBonus = 1;
  const state = new TransformState(host);

  state.transformToAlternateForm(host.die);
  state.tickDurations();
  state.tickDurations();
  assert.equal(state.getIndex(host.die.instanceId), 0);
  state.tickDurations();
  assert.equal(state.getIndex(host.die.instanceId), undefined);
});

test('TransformState preserves current health and card max health when a timed form expires', () => {
  const definition = makeTransformDefinition();
  const host = new FakeTransformHost(definition);
  host.diceCardMaxHealthBonus = 20;
  const state = new TransformState(host);

  state.transformToAlternateForm(host.die);
  host.die = { ...host.die, currentHealth: 37 };
  state.tickDurations();
  state.tickDurations();

  assert.equal(state.getIndex(host.die.instanceId), undefined);
  assert.equal(host.die.maxHealth, 120);
  assert.equal(host.die.currentHealth, 37);
  assert.deepEqual(state.getFlags(host.die), { isTransformed: false });
  assert.equal(state.getTransformedVisual(host.die), null);
});

test('TransformState keeps untimed forms permanent and resets pip-trigger state', () => {
  const definition = makeTransformDefinition();
  const permanentDefinition: DiceDefinition = {
    ...definition,
    transformStats: [{
      ...definition.transformStats![0]!,
      transformDuration: undefined
    }]
  };
  const host = new FakeTransformHost(permanentDefinition);
  const state = new TransformState(host);

  state.transformToAlternateForm(host.die);
  assert.equal(state.isPermanent(host.die.instanceId), true);
  state.tickDurations();
  state.tickDurations();
  assert.equal(state.getIndex(host.die.instanceId), 0);

  state.clearInstance(host.die.instanceId);
  assert.equal(state.getIndex(host.die.instanceId), undefined);
  assert.equal(state.isPermanent(host.die.instanceId), false);
});

test('TransformState ignores even pip rolls for an odd-pip transform', () => {
  const definition = makeTransformDefinition();
  const host = new FakeTransformHost(definition);
  const state = new TransformState(host);

  assert.equal(state.tryAdvancePipTriggeredTransform(host.die, 2), undefined);
  assert.equal(state.getIndex(host.die.instanceId), undefined);
  assert.equal(state.wasPipTriggered(host.die.instanceId), false);

  state.tryAdvancePipTriggeredTransform(host.die, 1);
  state.reset();
  assert.equal(state.getIndex(host.die.instanceId), undefined);
  assert.equal(state.wasPipTriggered(host.die.instanceId), false);
});

test('TransformState applies transform recovery to damaged health', () => {
  const definition = makeTransformDefinition();
  const host = new FakeTransformHost(definition);
  host.die = { ...host.die, currentHealth: 40 };
  const state = new TransformState(host);

  state.tryAdvancePipTriggeredTransform(host.die, 1);
  assert.equal(host.die.maxHealth, 120);
  assert.equal(host.die.currentHealth, 100);
});

test('CalendarStore.getProgress persists a repaired malformed reward state', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const registry = new Map<string, unknown>();
  const scene = {
    registry: {
      get: (key: string) => registry.get(key),
      set: (key: string, value: unknown) => { registry.set(key, value); }
    }
  } as unknown as Parameters<typeof CalendarStore.getProgress>[0];

  registry.set('player:profile', {
    username: 'Player',
    trophies: 0,
    nameChangesUsed: 0,
    loginReward: {
      startDate: loginDateDaysAgo(now, 6),
      claimedDays: [1, 2, 4],
      lastClaimDate: '2026-11-12',
      lastClaimAt: '2026-11-12T12:00:00.000Z',
      day7LegendaryTypeId: 'Old',
      day7LegendaryTitle: 'Old Legendary'
    }
  });

  const progress = CalendarStore.getProgress(scene, now);
  assert.equal(progress.isMalformed, true);
  assert.deepEqual(progress.reward.claimedDays, [1, 2]);
  assert.equal(progress.nextClaimableDay, 3);

  const saved = registry.get('player:profile') as { loginReward?: Record<string, unknown> };
  assert.deepEqual(saved.loginReward?.claimedDays, [1, 2]);
  assert.equal(saved.loginReward?.lastClaimDate, undefined);
  assert.equal(saved.loginReward?.lastClaimAt, undefined);
  assert.equal(saved.loginReward?.day7LegendaryTypeId, undefined);
  assert.equal(saved.loginReward?.day7LegendaryTitle, undefined);
});

function makeCalendarClaimScene(claimedDays: number[], now: Date): { scene: Parameters<typeof CalendarStore.claim>[0]; registry: Map<string, unknown> } {
  const registry = new Map<string, unknown>();
  registry.set('player:profile', {
    username: 'Player',
    trophies: 0,
    nameChangesUsed: 0,
    loginReward: {
      startDate: loginDateDaysAgo(now, 6),
      claimedDays
    }
  });
  const scene = {
    registry: {
      get: (key: string) => registry.get(key),
      set: (key: string, value: unknown) => { registry.set(key, value); }
    }
  } as unknown as Parameters<typeof CalendarStore.claim>[0];
  return { scene, registry };
}

test('CalendarStore grants every regular login reward in sequence', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  for (let day = 1; day <= 6; day++) {
    const { scene, registry } = makeCalendarClaimScene(Array.from({ length: day - 1 }, (_, index) => index + 1), now);
    registry.set('shop:diamonds', 100);
    registry.set('dice:tokens', 5_000);
    registry.set('casinoProgress', { chips: 10, chests: { Bronze: 0, Silver: 0, Gold: 0, Diamond: 0, Master: 0 }, fivesHand: null, fivesGauge: 0 });

    const result = CalendarStore.claim(scene, day, now);
    assert.equal(result.status, 'claimed', `day ${day}`);
    const profile = registry.get('player:profile') as { loginReward?: { claimedDays?: number[] } };
    assert.deepEqual(profile.loginReward?.claimedDays, Array.from({ length: day }, (_, index) => index + 1));
    if (day === 1) assert.equal(registry.get('shop:diamonds'), 150);
    if (day === 2) assert.equal(registry.get('dice:tokens'), 6_000);
    if (day === 3) assert.equal((registry.get('casinoProgress') as { chips?: number }).chips, 30);
    if (day === 4) assert.equal(registry.get('shop:diamonds'), 200);
    if (day === 5) assert.equal(registry.get('dice:tokens'), 7_500);
    if (day === 6) assert.equal((registry.get('casinoProgress') as { chips?: number }).chips, 60);
  }
});

test('CalendarStore grants a useful legendary copy on Day 7', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const { scene, registry } = makeCalendarClaimScene([1, 2, 3, 4, 5, 6], now);
  const claimProfile = registry.get('player:profile') as { loginReward: Record<string, unknown> };
  claimProfile.loginReward.lastClaimDate = loginDateDaysAgo(now, 1);
  claimProfile.loginReward.lastClaimAt = new Date(now.getTime() - 25 * 3600000).toISOString();
  const jsonCache = new Map<string, unknown>([
    ['dice:flags', { fetchableTypeIds: ['Fire', 'Legendary'], exclusiveTypeIds: [] }],
    ['dice:Fire', { typeId: 'Fire', title: 'Fire Dice', rarity: 'Common', skills: [] }],
    ['dice:Legendary', { typeId: 'Legendary', title: 'Legendary Dice', rarity: 'Legendary', skills: [] }]
  ]);
  (scene as unknown as { cache: { json: { get: (key: string) => unknown } } }).cache = {
    json: { get: (key: string) => jsonCache.get(key) }
  };

  const result = CalendarStore.claim(scene, 7, now);
  assert.equal(result.status, 'claimed');
  assert.match(result.status === 'claimed' ? result.message : '', /Legendary Dice/);
  const profile = registry.get('player:profile') as { loginReward?: { day7LegendaryTypeId?: string; day7LegendaryTitle?: string } };
  assert.equal(profile.loginReward?.day7LegendaryTypeId, 'Legendary');
  assert.equal(profile.loginReward?.day7LegendaryTitle, 'Legendary Dice');
  const progress = registry.get('dice:progress') as Record<string, { unlocked?: boolean }>;
  assert.equal(progress.Legendary?.unlocked, true);
});

test('CalendarStore grants the Day 7 token fallback when no legendary copies are useful', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const { scene, registry } = makeCalendarClaimScene([1, 2, 3, 4, 5, 6], now);
  const claimProfile = registry.get('player:profile') as { loginReward: Record<string, unknown> };
  claimProfile.loginReward.lastClaimDate = loginDateDaysAgo(now, 1);
  claimProfile.loginReward.lastClaimAt = new Date(now.getTime() - 25 * 3600000).toISOString();
  registry.set('dice:tokens', 5_000);
  const jsonCache = new Map<string, unknown>([
    ['dice:flags', { fetchableTypeIds: ['Fire'], exclusiveTypeIds: [] }],
    ['dice:Fire', { typeId: 'Fire', title: 'Fire Dice', rarity: 'Common', skills: [] }]
  ]);
  (scene as unknown as { cache: { json: { get: (key: string) => unknown } } }).cache = {
    json: { get: (key: string) => jsonCache.get(key) }
  };

  const result = CalendarStore.claim(scene, 7, now);
  assert.equal(result.status, 'claimed');
  assert.match(result.status === 'claimed' ? result.message : '', /Legendary pool full/);
  assert.equal(registry.get('dice:tokens'), 10_000);
  const profile = registry.get('player:profile') as { loginReward?: { day7LegendaryTitle?: string } };
  assert.match(profile.loginReward?.day7LegendaryTitle ?? '', /Legendary pool full/);
});

test('CalendarStore repairs a non-object login reward instead of spreading malformed data', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const progress = resolveLoginRewardProgress({ loginReward: 'broken' as never }, now);

  assert.equal(progress.isMalformed, true);
  assert.deepEqual(progress.reward.claimedDays, []);
  assert.equal(progress.reward.startDate, '2026-11-13');
  assert.equal(progress.nextClaimableDay, 1);
});

test('BossStore tolerates malformed menu storage and storage write failures', () => {
  const registry = new Map<string, unknown>();
  const scene = {
    registry: {
      get: (key: string) => registry.get(key),
      set: (key: string, value: unknown) => { registry.set(key, value); }
    }
  } as unknown as Parameters<typeof getBossfightMenuState>[0];
  const storage = {
    getItem: () => 'null',
    setItem: () => { throw new Error('quota exceeded'); }
  };

  assert.doesNotThrow(() => saveBossfightMenuState('Magician', 2, storage));
  assert.deepEqual(getBossfightMenuState(scene, storage), {
    boss: 'Magician',
    level: 1,
    levels: { Magician: 1, Leon: 1, Basilisk: 1, Silence: 1 }
  });
});

test('ChallengeStore normalizes cached reward claims before using includes', () => {
  const registry = new Map<string, unknown>();
  const scene = {
    registry: {
      get: (key: string) => registry.get(key),
      set: (key: string, value: unknown) => { registry.set(key, value); }
    }
  } as unknown as Parameters<typeof getChallengeRewardClaims>[0];

  registry.set('arena:challengeRewardClaims', { broken: true });
  assert.deepEqual(getChallengeRewardClaims(scene), []);
  assert.equal(hasChallengeRewardClaimed(scene, 'daily'), false);

  registry.set('arena:challengeRewardClaims', ['daily', 7, 'daily']);
  assert.deepEqual(getChallengeRewardClaims(scene), ['daily']);
  assert.equal(hasChallengeRewardClaimed(scene, 'daily'), true);
});

test('Class progression guards malformed skills and non-finite class levels', () => {
  const definition = makeTransformDefinition();
  const malformed = { ...definition, attack: undefined, health: undefined, skills: undefined } as unknown as DiceDefinition;

  assert.doesNotThrow(() => applyClassProgression(malformed, 5));
  assert.equal(applyClassProgression(malformed, 5).attack, 1);
  assert.equal(applyClassProgression(malformed, 5).health, 1);
  assert.deepEqual(applyClassProgression(malformed, 5).skills, []);
  assert.equal(getClassScaledSkillDescription(malformed), '');
  assert.equal(getClassMultiplier(Number.NaN), 1);
  assert.equal(getClassMultiplier(Infinity), 1);
  assert.equal(getBossClassMultiplier(Number.NaN), 1);
  assert.equal(getBossClassMultiplier(Infinity), 1);
});
