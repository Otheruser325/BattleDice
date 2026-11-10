export const COMBAT_TIME_LIMIT_MS = 45_000;
export const COMBAT_DOUBLE_SPEED_REMAINING_MS = 30_000;
export const COMBAT_QUADRUPLE_SPEED_REMAINING_MS = 15_000;

export function getCombatTimeSpeedMultiplier(remainingMs: number): number {
  if (!Number.isFinite(remainingMs)) return 1;
  if (remainingMs <= COMBAT_QUADRUPLE_SPEED_REMAINING_MS) return 4;
  if (remainingMs <= COMBAT_DOUBLE_SPEED_REMAINING_MS) return 2;
  return 1;
}