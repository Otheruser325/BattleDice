import type { DiceInstanceState } from '../types/game';

export const ARENA_GRID_SIZE = 5;

export function getCombatDistance(attacker: DiceInstanceState, target: DiceInstanceState): number {
  if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;

  if (attacker.ownerId === 'player') {
    return (ARENA_GRID_SIZE - attacker.gridPosition.col) + target.gridPosition.col;
  }

  return attacker.gridPosition.col + (ARENA_GRID_SIZE - target.gridPosition.col);
}

export function getCoveredEnemyColumns(attacker: DiceInstanceState, range: number): number[] {
  if (!attacker.gridPosition) return [];

  const columns: number[] = [];
  for (let col = 0; col < ARENA_GRID_SIZE; col++) {
    const proxyTarget: DiceInstanceState = {
      ...attacker,
      ownerId: attacker.ownerId === 'player' ? 'enemy' : 'player',
      gridPosition: { row: 0, col }
    };
    if (getCombatDistance(attacker, proxyTarget) <= Math.max(1, range)) {
      columns.push(col);
    }
  }
  return columns;
}

export function getCoveredEnemyRows(attacker: DiceInstanceState, range: number): number[] {
  if (getCoveredEnemyColumns(attacker, range).length === 0) return [];
  return Array.from({ length: ARENA_GRID_SIZE }, (_, row) => row);
}

export function getCoveredEnemyTileCount(attacker: DiceInstanceState, range: number): number {
  return getCoveredEnemyColumns(attacker, range).length * ARENA_GRID_SIZE;
}
