import type { DiceInstanceState } from '../types/game';

export const ARENA_GRID_SIZE = 5;

export function getCombatDistance(attacker: DiceInstanceState, target: DiceInstanceState): number {
  if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;
  return Math.max(0, attacker.gridPosition.row + target.gridPosition.row);
}

export function getCoveredEnemyRows(attacker: DiceInstanceState, range: number): number[] {
  if (!attacker.gridPosition) return [];
  const maxTargetRow = Math.min(ARENA_GRID_SIZE - 1, Math.max(-1, range - attacker.gridPosition.row));
  return Array.from({ length: maxTargetRow + 1 }, (_, row) => row);
}

export function getCoveredEnemyTileCount(attacker: DiceInstanceState, range: number): number {
  return getCoveredEnemyRows(attacker, range).length * ARENA_GRID_SIZE;
}
