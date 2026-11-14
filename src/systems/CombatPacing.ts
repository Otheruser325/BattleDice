export const COMBAT_TIME_LIMIT_MS = 45_000;
export const COMBAT_DOUBLE_SPEED_REMAINING_MS = 30_000;
export const COMBAT_QUADRUPLE_SPEED_REMAINING_MS = 15_000;

export function getCombatTimeSpeedMultiplier(remainingMs: number): number {
  if (!Number.isFinite(remainingMs)) return 1;
  if (remainingMs <= COMBAT_QUADRUPLE_SPEED_REMAINING_MS) return 4;
  if (remainingMs <= COMBAT_DOUBLE_SPEED_REMAINING_MS) return 2;
  return 1;
}

export function scaleAnimationDuration(durationMs: number, speedMultiplier: number): number {
  const duration = Number.isFinite(durationMs) ? Math.max(1, durationMs) : 1;
  const speed = Number.isFinite(speedMultiplier) ? Math.min(16, Math.max(0.25, speedMultiplier)) : 1;
  return Math.max(1, Math.round(duration / speed));
}