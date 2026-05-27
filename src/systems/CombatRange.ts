import type { DiceInstanceState } from '../types/game';

export const ARENA_GRID_SIZE = 5;

function getRelativeEnemyColumn(attacker: DiceInstanceState, target: DiceInstanceState): number {
  const targetCol = target.gridPosition?.col ?? 0;
  if (attacker.ownerId === target.ownerId) return targetCol;
  // Enemy board is mirrored relative to each side's perspective.
  return (ARENA_GRID_SIZE - 1) - targetCol;
}

export function getCombatDistance(attacker: DiceInstanceState, target: DiceInstanceState): number {
  if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;

  const attackerCol = attacker.gridPosition.col;
  const relativeTargetCol = getRelativeEnemyColumn(attacker, target);
  const lateralOffset = Math.abs(attackerCol - relativeTargetCol);
  // Range 1 should always cover a die's own mirrored column, then fan out left/right.
  return lateralOffset + 1;
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
