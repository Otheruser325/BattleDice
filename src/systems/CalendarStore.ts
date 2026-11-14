import type Phaser from 'phaser';
import { canReceiveUsefulCopies, getAllDiceDefinitions, getDiceTokens, getDiamonds, grantDiceCopies, setDiceTokens, setDiamonds } from '../data/dice';
import { securePick } from '../utils/RandomManager';
import { AchievementStore } from './AchievementStore';
import { CasinoProgressStore } from './CasinoProgressStore';
import { ProfileStore, type PlayerProfile } from './ProfileStore';

export type LoginRewardState = NonNullable<PlayerProfile['loginReward']>;

export interface LoginRewardDay {
  day: number;
  label: string;
  color: number;
}

export const LOGIN_REWARD_DAYS: LoginRewardDay[] = [
  { day: 1, label: '+50 Diamonds', color: 0x3498db },
  { day: 2, label: '+1,000 Tokens', color: 0x9b59b6 },
  { day: 3, label: '+20 Chips', color: 0xe67e22 },
  { day: 4, label: '+100 Diamonds', color: 0x3498db },
  { day: 5, label: '+2,500 Tokens', color: 0x9b59b6 },
  { day: 6, label: '+50 Chips', color: 0xe67e22 },
  { day: 7, label: 'LEGENDARY DIE!', color: 0xf1c40f }
];

export const LOGIN_REWARD_TOTAL_DAYS = LOGIN_REWARD_DAYS.length;

export interface LoginRewardProgress {
  reward: LoginRewardState;
  claimed: Set<number>;
  unlockedDay: number;
  nextClaimableDay: number | null;
  nextUnlockDay: number;
  alreadyClaimedToday: boolean;
  isComplete: boolean;
  isMalformed: boolean;
}

export type LoginRewardClaimResult =
  | { status: 'claimed'; message: string; progress: LoginRewardProgress }
  | { status: 'already-claimed' | 'locked' | 'unavailable'; messages: string[] };

export function resolveLoginRewardProgress(
  profile: Pick<PlayerProfile, 'loginReward'>,
  now: Date = new Date()
): LoginRewardProgress {
  const today = now.toISOString().slice(0, 10);
  const storedReward = profile.loginReward;
  const hasValidStoredReward = Boolean(storedReward) && typeof storedReward === 'object' && !Array.isArray(storedReward);
  const rawReward: LoginRewardState = storedReward && typeof storedReward === 'object' && !Array.isArray(storedReward)
    ? storedReward
    : { startDate: today, claimedDays: [] };
  const rawClaimedDays = Array.isArray(rawReward.claimedDays) ? rawReward.claimedDays : [];
  const validClaimedDays = [...new Set(rawClaimedDays
    .map((day) => Math.floor(Number(day)))
    .filter((day) => day >= 1 && day <= LOGIN_REWARD_TOTAL_DAYS))]
    .sort((left, right) => left - right);
  const contiguousClaimedDays = validClaimedDays.filter((day, index) => day === index + 1);
  const claimed = new Set(contiguousClaimedDays);
  const isMalformed = Boolean(storedReward) && (
    !hasValidStoredReward
    || !Array.isArray(rawReward.claimedDays)
    || (rawClaimedDays.length > 0 && (
      rawClaimedDays.length !== validClaimedDays.length
      || validClaimedDays.length !== contiguousClaimedDays.length
      || validClaimedDays.some((day, index) => day !== index + 1)
    ))
  );
  const reward: LoginRewardState = isMalformed
    ? {
      ...rawReward,
      startDate: typeof rawReward.startDate === 'string' && rawReward.startDate ? rawReward.startDate : today,
      claimedDays: contiguousClaimedDays,
      lastClaimDate: undefined,
      lastClaimAt: undefined,
      day7LegendaryTypeId: contiguousClaimedDays.includes(7) ? rawReward.day7LegendaryTypeId : undefined,
      day7LegendaryTitle: contiguousClaimedDays.includes(7) ? rawReward.day7LegendaryTitle : undefined
    }
    : rawReward;
  const startMs = new Date(`${reward.startDate}T00:00:00Z`).getTime();
  const todayMs = new Date(`${today}T00:00:00Z`).getTime();
  const elapsedDays = Number.isFinite(startMs) ? Math.max(0, Math.floor((todayMs - startMs) / 86400000)) : 0;
  const unlockedDay = Math.max(1, Math.min(LOGIN_REWARD_TOTAL_DAYS, elapsedDays + 1));
  const nextSequentialDay = claimed.size + 1;
  const alreadyClaimedToday = reward.lastClaimDate === today;
  const nextClaimableDay = !alreadyClaimedToday && nextSequentialDay <= unlockedDay && nextSequentialDay <= LOGIN_REWARD_TOTAL_DAYS
    ? nextSequentialDay
    : null;
  const nextUnlockDay = Math.min(
    LOGIN_REWARD_TOTAL_DAYS,
    Math.max(nextSequentialDay, unlockedDay + 1)
  );
  return {
    reward,
    claimed,
    unlockedDay,
    nextClaimableDay,
    nextUnlockDay,
    alreadyClaimedToday,
    isComplete: claimed.size >= LOGIN_REWARD_TOTAL_DAYS,
    isMalformed
  };
}

export class CalendarStore {
  static getProgress(scene: Phaser.Scene, now: Date = new Date()): LoginRewardProgress {
    const progress = resolveLoginRewardProgress(ProfileStore.get(scene), now);
    if (progress.isMalformed) ProfileStore.set(scene, { loginReward: progress.reward });
    return progress;
  }

  static isComplete(scene: Phaser.Scene): boolean {
    return this.getProgress(scene).isComplete;
  }

  static claim(scene: Phaser.Scene, day: number, now: Date = new Date()): LoginRewardClaimResult {
    const progress = this.getProgress(scene, now);
    const { reward, claimed, nextClaimableDay, unlockedDay, alreadyClaimedToday, nextUnlockDay } = progress;

    if (claimed.has(day)) {
      return { status: 'already-claimed', messages: [`Day ${day} already claimed!`] };
    }
    if (nextClaimableDay === null || day !== nextClaimableDay) {
      const waitingDay = Math.min(LOGIN_REWARD_TOTAL_DAYS, unlockedDay + 1);
      const messages = [alreadyClaimedToday
        ? `Day ${nextUnlockDay} unlocks tomorrow.`
        : day > unlockedDay
          ? `Day ${day} is locked. Come back tomorrow.`
          : `Claim Day ${nextClaimableDay} first.`];
      if (day > unlockedDay && waitingDay <= LOGIN_REWARD_TOTAL_DAYS) {
        messages.push(`Next reward unlocks on Day ${waitingDay}.`);
      }
      return { status: 'locked', messages };
    }

    let message = '';
    let claimedDay7LegendaryTypeId = reward.day7LegendaryTypeId;
    let claimedDay7LegendaryTitle = reward.day7LegendaryTitle;
    if (day === 1) { setDiamonds(scene, getDiamonds(scene) + 50); message = '+50 Diamonds'; }
    if (day === 2) { setDiceTokens(scene, getDiceTokens(scene) + 1000); message = '+1,000 Dice Tokens'; }
    if (day === 3) { message = '+20 Casino Chips'; CasinoProgressStore.mutate(scene, (current) => ({ ...current, chips: current.chips + 20 })); }
    if (day === 4) { setDiamonds(scene, getDiamonds(scene) + 100); message = '+100 Diamonds'; }
    if (day === 5) { setDiceTokens(scene, getDiceTokens(scene) + 2500); message = '+2,500 Dice Tokens'; }
    if (day === 6) { message = '+50 Casino Chips'; CasinoProgressStore.mutate(scene, (current) => ({ ...current, chips: current.chips + 50 })); }
    if (day === 7) {
      const lastClaimMs = reward.lastClaimAt ? new Date(reward.lastClaimAt).getTime() : 0;
      const hoursSinceLastClaim = lastClaimMs > 0 ? (now.getTime() - lastClaimMs) / (1000 * 60 * 60) : 0;
      const canReattemptDay7 = hoursSinceLastClaim >= 24;
      if (canReattemptDay7) claimed.delete(7);

      const legendaries = getAllDiceDefinitions(scene)
        .filter((definition) => definition.rarity === 'Legendary')
        .filter((definition) => canReceiveUsefulCopies(scene, definition.typeId));
      const pick = legendaries.length > 0 ? securePick(legendaries) : undefined;
      if (pick) {
        grantDiceCopies(scene, pick.typeId, 1);
        message = `Legendary Dice: ${pick.title}`;
        claimedDay7LegendaryTypeId = pick.typeId;
        claimedDay7LegendaryTitle = pick.title;
      } else if (canReattemptDay7) {
        setDiceTokens(scene, getDiceTokens(scene) + 5000);
        message = 'Legendary pool full: +5,000 Dice Tokens (retry tomorrow)';
        claimedDay7LegendaryTypeId = undefined;
        claimedDay7LegendaryTitle = 'Legendary pool full (+5,000 Dice Tokens)';
      } else {
        return { status: 'unavailable', messages: ['Day 7 already claimed! Come back tomorrow for the next reward cycle.'] };
      }
      AchievementStore.unlock(scene, 'darkest_hour');
    }

    claimed.add(day);
    const claimedAt = now.toISOString();
    ProfileStore.set(scene, {
      loginReward: {
        ...reward,
        claimedDays: [...claimed].sort((left, right) => left - right),
        lastClaimDate: claimedAt.slice(0, 10),
        lastClaimAt: claimedAt,
        day7LegendaryTypeId: day === 7 ? claimedDay7LegendaryTypeId : reward.day7LegendaryTypeId,
        day7LegendaryTitle: day === 7 ? claimedDay7LegendaryTitle : reward.day7LegendaryTitle
      }
    });
    return {
      status: 'claimed',
      message,
      progress: resolveLoginRewardProgress(ProfileStore.get(scene), now)
    };
  }
}
