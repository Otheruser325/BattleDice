export interface ReviveStatsInput {
  maxHealth: number;
  baseAttack?: number;
  healthRate?: number;
  attackRate?: number;
}

export interface ReviveStats {
  maxHealth: number;
  currentHealth: number;
  attack: number;
}

export function resolveReviveStats(input: ReviveStatsInput): ReviveStats {
  const maxHealth = Math.max(1, Math.round(Number.isFinite(input.maxHealth) ? input.maxHealth : 1));
  const baseAttack = Number.isFinite(input.baseAttack) ? input.baseAttack! : 1;
  const healthRate = Number.isFinite(input.healthRate) ? Math.max(0, Math.min(1, input.healthRate!)) : 1;
  const attackRate = Number.isFinite(input.attackRate) ? Math.max(0, Math.min(1, input.attackRate!)) : 1;
  return {
    maxHealth,
    currentHealth: Math.max(1, Math.round(maxHealth * healthRate)),
    attack: Math.max(1, Math.round(baseAttack * attackRate))
  };
}
