import type Phaser from 'phaser';
import { getDiceProgress } from '../data/dice';
import type { DiceDefinition } from '../types/game';
import { formatCompact } from '../utils/FormatManager';
import { readIntegrityChecked, writeIntegrityChecked } from '../utils/SecureStorage';
import { getSeededDailyIndex, getSeededDailyRange, getTopProfileDice } from './DailyChallenges';
import type { DungeonModifier } from './DungeonEvent';

export const CHALLENGE_STATUS_KEY = 'arena:challengeStatus';
export const CHALLENGE_REWARD_CLAIMS_KEY = 'arena:challengeRewardClaims';

export const CHALLENGE_IDS = ['daily', 'deucifer', 'dopamine', 'bossfight', 'dungeon'] as const;
export type ChallengeId = (typeof CHALLENGE_IDS)[number];
export type ChallengeKey = ChallengeId | null;
export type ChallengeStatus = 'not-started' | 'started' | 'completed' | 'failed';
export type ChallengeMode = 'daily' | 'deucifer' | 'dopamine';
export type ChallengeDifficulty = 'Medium' | 'Nightmare';
export type DailyLoadoutMode = 'mirror' | 'player-vs-enemy' | 'random-vs-random';

export const CHALLENGE_RANDOM_MODIFIERS: readonly DungeonModifier[] = ['Classic', 'Combanity', 'Duality', 'Necromancy', 'DiceCard'];

export interface ChallengeReward {
  tokens: number;
  chips: number;
}

export interface ChallengeDefinition {
  id: ChallengeMode;
  title: string;
  summary: string;
  reward: ChallengeReward;
  hardReward?: ChallengeReward;
  difficulty: ChallengeDifficulty;
  turnLimit: number;
  randomMode: boolean;
  randomizeLoadoutAndClassUps: boolean;
  activeRandomModifier?: DungeonModifier;
  enemyTypeIds: readonly string[];
  enemyClassLevel: number;
}

export interface ChallengeStartConfig {
  difficulty: ChallengeDifficulty;
  turnLimit: number;
  randomMode: boolean;
  randomizeLoadoutAndClassUps: boolean;
  activeRandomModifier?: DungeonModifier;
  enemyTypeIds: readonly string[];
  enemyClassLevel: number;
}

export interface ChallengeUIConfig {
  id: ChallengeMode;
  title: string;
  summary: string;
  reward: ChallengeReward;
  rewardLabel: string;
}

export interface ChallengeEnemyConfig {
  typeIds: readonly string[];
  classLevel: number;
}

export const CHALLENGE_DEFINITIONS: Record<ChallengeMode, ChallengeDefinition> = {
  daily: {
    id: 'daily',
    title: 'Daily Challenge',
    summary: '',
    reward: { tokens: 800, chips: 10 },
    hardReward: { tokens: 2400, chips: 30 },
    difficulty: 'Medium',
    turnLimit: 10,
    randomMode: true,
    randomizeLoadoutAndClassUps: false,
    enemyTypeIds: [],
    enemyClassLevel: 1
  },
  deucifer: {
    id: 'deucifer',
    title: "Deucifer's Challenge",
    summary: 'Nightmare Deucifer\nClassic • 10 Turns',
    reward: { tokens: 7500, chips: 50 },
    difficulty: 'Nightmare',
    turnLimit: 10,
    randomMode: false,
    randomizeLoadoutAndClassUps: false,
    enemyTypeIds: ['Poison', 'Solitude', 'Judgment', 'Skull', 'Death'],
    enemyClassLevel: 11
  },
  dopamine: {
    id: 'dopamine',
    title: 'Dopamine Challenge',
    summary: 'Medium • Dice Card • 10 Turns',
    reward: { tokens: 2500, chips: 20 },
    difficulty: 'Medium',
    turnLimit: 10,
    randomMode: true,
    randomizeLoadoutAndClassUps: false,
    activeRandomModifier: 'DiceCard',
    enemyTypeIds: ['Healing', 'Light', 'Battery', 'Meteor', 'Wind'],
    enemyClassLevel: 7
  }
};

export function getDailyChallengeKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isHardDaily(dateKey = getDailyChallengeKey()): boolean {
  return Number(dateKey.split('-')[2]) % 4 === 0;
}

export function getDailySeedKey(activeDailyKey = ''): string {
  return activeDailyKey || getDailyChallengeKey();
}

export function getDailySeededModifier(activeDailyKey = ''): DungeonModifier {
  const seed = [...`${getDailySeedKey(activeDailyKey)}:modifier:v2`].reduce(
    (acc, ch) => ((acc * 31) + ch.charCodeAt(0)) >>> 0,
    2166136261
  );
  return CHALLENGE_RANDOM_MODIFIERS[seed % CHALLENGE_RANDOM_MODIFIERS.length] ?? 'Classic';
}

export function getDailyLoadoutMode(activeDailyKey = ''): DailyLoadoutMode {
  const roll = getSeededDailyIndex(getDailySeedKey(activeDailyKey), 'daily-loadout-mode', 100);
  if (roll < 33) return 'mirror';
  if (roll < 67) return 'player-vs-enemy';
  return 'random-vs-random';
}

export function getDailyUsesRandomClassUps(activeDailyKey = ''): boolean {
  return getSeededDailyIndex(getDailySeedKey(activeDailyKey), 'daily-class-mode', 2) === 0;
}

export function getDailySeededIndex(activeDailyKey: string, label: string, length: number): number {
  return getSeededDailyIndex(getDailySeedKey(activeDailyKey), label, length);
}

export function getDailySeededRange(activeDailyKey: string, label: string, min: number, max: number): number {
  return getSeededDailyRange(getDailySeedKey(activeDailyKey), label, min, max);
}

export function getDailyTopProfileDice(scene: Phaser.Scene, pool: DiceDefinition[], count = 5) {
  return getTopProfileDice(pool.map((definition) => {
    const progress = getDiceProgress(scene, definition.typeId);
    return { typeId: definition.typeId, classLevel: progress.classLevel, unlocked: progress.unlocked };
  }), count);
}

export function getChallengeReward(challenge: ChallengeMode, dailyHard = false): ChallengeReward {
  const definition = CHALLENGE_DEFINITIONS[challenge];
  return challenge === 'daily' && dailyHard ? definition.hardReward ?? definition.reward : definition.reward;
}

export function getChallengeEnemyConfig(challenge: ChallengeMode): ChallengeEnemyConfig | undefined {
  if (challenge === 'daily') return undefined;
  const definition = CHALLENGE_DEFINITIONS[challenge];
  return { typeIds: definition.enemyTypeIds, classLevel: definition.enemyClassLevel };
}

export function getChallengeRandomModifier(challenge: ChallengeKey, activeDailyKey = ''): DungeonModifier | undefined {
  if (challenge === 'daily') return getDailySeededModifier(activeDailyKey);
  if (challenge === 'dopamine') return CHALLENGE_DEFINITIONS.dopamine.activeRandomModifier;
  return undefined;
}

export function getChallengeStartConfig(
  challenge: ChallengeMode,
  dailyHard: boolean,
  activeDailyKey = ''
): ChallengeStartConfig {
  if (challenge === 'daily') {
    return {
      difficulty: dailyHard ? 'Nightmare' : 'Medium',
      turnLimit: CHALLENGE_DEFINITIONS.daily.turnLimit,
      randomMode: CHALLENGE_DEFINITIONS.daily.randomMode,
      randomizeLoadoutAndClassUps: getDailyUsesRandomClassUps(activeDailyKey),
      enemyTypeIds: [],
      enemyClassLevel: 1
    };
  }
  const definition = CHALLENGE_DEFINITIONS[challenge];
  return {
    difficulty: definition.difficulty,
    turnLimit: definition.turnLimit,
    randomMode: definition.randomMode,
    randomizeLoadoutAndClassUps: definition.randomizeLoadoutAndClassUps,
    activeRandomModifier: definition.activeRandomModifier,
    enemyTypeIds: definition.enemyTypeIds,
    enemyClassLevel: definition.enemyClassLevel
  };
}

export function getChallengeUIConfig(
  challenge: ChallengeMode,
  dailyHard: boolean,
  activeDailyKey = ''
): ChallengeUIConfig {
  const definition = CHALLENGE_DEFINITIONS[challenge];
  if (challenge !== 'daily') {
    const reward = getChallengeReward(challenge, dailyHard);
    return {
      id: challenge,
      title: definition.title,
      summary: definition.summary,
      reward,
      rewardLabel: `${formatCompact(reward.tokens)} Tokens + ${formatCompact(reward.chips)} Chips`
    };
  }
  const loadoutMode = getDailyLoadoutMode(activeDailyKey);
  const modeLabel = dailyHard
    ? 'Enemy: your top 5 most classed-up dice (+4 classes)'
    : loadoutMode === 'mirror'
    ? 'Mirror vs mirror'
    : loadoutMode === 'random-vs-random'
    ? 'Random vs random'
    : 'Your loadout vs enemy loadout';
  const classModeLabel = getDailyUsesRandomClassUps(activeDailyKey)
    ? 'Random class-ups (seeded)'
    : 'Your class-ups';
  const reward = getChallengeReward('daily', dailyHard);
  return {
    id: 'daily',
    title: `Daily Challenge${dailyHard ? ' ☠ HARD!' : ''}`,
    summary: `${modeLabel}\n${classModeLabel}`,
    reward,
    rewardLabel: `${reward.tokens} Tokens + ${reward.chips} Chips`
  };
}

export function getChallengeClaimKey(challenge: ChallengeId, activeDailyKey = ''): string {
  return challenge === 'daily' ? `daily:${getDailySeedKey(activeDailyKey)}` : challenge;
}

function normalizeChallengeStatusStore(value: unknown): Record<string, ChallengeStatus> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const statuses: Record<string, ChallengeStatus> = {};
  Object.entries(value).forEach(([key, status]) => {
    if (status === 'started' || status === 'completed' || status === 'failed') statuses[key] = status;
  });
  return statuses;
}

export function getChallengeStatusStore(scene: Phaser.Scene): Record<string, ChallengeStatus> {
  const cached = scene.registry.get(CHALLENGE_STATUS_KEY);
  if (cached) {
    const normalized = normalizeChallengeStatusStore(cached);
    scene.registry.set(CHALLENGE_STATUS_KEY, normalized);
    return normalized;
  }
  try {
    const stored = normalizeChallengeStatusStore(readIntegrityChecked<unknown>(CHALLENGE_STATUS_KEY));
    scene.registry.set(CHALLENGE_STATUS_KEY, stored);
    return stored;
  } catch {
    return {};
  }
}

export function getChallengeStatus(
  scene: Phaser.Scene,
  challenge: ChallengeId,
  activeDailyKey = ''
): ChallengeStatus {
  const store = getChallengeStatusStore(scene);
  return store[getChallengeClaimKey(challenge, activeDailyKey)] ?? 'not-started';
}

export function setChallengeStatus(
  scene: Phaser.Scene,
  challenge: ChallengeId,
  status: ChallengeStatus,
  activeDailyKey = ''
): void {
  const store = getChallengeStatusStore(scene);
  store[getChallengeClaimKey(challenge, activeDailyKey)] = status;
  scene.registry.set(CHALLENGE_STATUS_KEY, store);
  writeIntegrityChecked(CHALLENGE_STATUS_KEY, store);
}

export function getChallengeStatusLabel(status: ChallengeStatus): string {
  if (status === 'started') return 'STARTED';
  if (status === 'completed') return 'COMPLETED';
  if (status === 'failed') return 'FAILED';
  return 'NOT STARTED';
}

function normalizeChallengeRewardClaims(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))];
}

export function getChallengeRewardClaims(scene: Phaser.Scene): string[] {
  const cached = scene.registry.get(CHALLENGE_REWARD_CLAIMS_KEY) as unknown;
  if (cached !== undefined) {
    const normalized = normalizeChallengeRewardClaims(cached);
    scene.registry.set(CHALLENGE_REWARD_CLAIMS_KEY, normalized);
    return normalized;
  }
  try {
    const valid = normalizeChallengeRewardClaims(readIntegrityChecked<unknown>(CHALLENGE_REWARD_CLAIMS_KEY));
    scene.registry.set(CHALLENGE_REWARD_CLAIMS_KEY, valid);
    return valid;
  } catch {
    return [];
  }
}

export function hasChallengeRewardClaimed(scene: Phaser.Scene, claimKey: string): boolean {
  return getChallengeRewardClaims(scene).includes(claimKey);
}

export function markChallengeRewardClaimed(scene: Phaser.Scene, claimKey: string): void {
  const next = [...new Set([...getChallengeRewardClaims(scene), claimKey])];
  scene.registry.set(CHALLENGE_REWARD_CLAIMS_KEY, next);
  writeIntegrityChecked(CHALLENGE_REWARD_CLAIMS_KEY, next);
}

export function canChallengeBeMarkedFailed(
  scene: Phaser.Scene,
  challenge: ChallengeId,
  activeDailyKey = ''
): boolean {
  if (challenge === 'bossfight' || challenge === 'dungeon') return false;
  return !hasChallengeRewardClaimed(scene, getChallengeClaimKey(challenge, activeDailyKey));
}
