import type { DiceInstanceState, DiceOwnerId } from '../types/game';

export const ARENA_GRID_SIZE = 5;

function getBoardSideForDistance(die: DiceInstanceState): DiceOwnerId {
  return die.ownerId;
}

function getRelativeEnemyColumn(attacker: DiceInstanceState, target: DiceInstanceState): number {
  const targetCol = target.gridPosition?.col ?? 0;
  if (attacker.ownerId === target.ownerId) return targetCol;
  return (ARENA_GRID_SIZE - 1) - targetCol;
}

export function getCombatDistance(attacker: DiceInstanceState, target: DiceInstanceState): number {
  if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;

  const attackerCol = attacker.gridPosition.col;
  const relativeTargetCol = getRelativeEnemyColumn(attacker, target);
  const lateralOffset = Math.abs(attackerCol - relativeTargetCol);
  return lateralOffset + 1;
}

export function getDisplayedRangeCoverage(attacker: DiceInstanceState, range: number): { columns: number[]; tileCount: number } {
  if (!attacker.gridPosition) return { columns: [], tileCount: 0 };
  const columns: number[] = [];
  for (let col = 0; col < ARENA_GRID_SIZE; col++) {
    const proxyTarget: DiceInstanceState = {
      ...attacker,
      ownerId: attacker.ownerId === 'player' ? 'enemy' : 'player',
      gridPosition: { row: 0, col }
    };
    if (getBoardSideCombatDistance(attacker, proxyTarget) <= Math.max(1, range)) columns.push(col);
  }
  return { columns, tileCount: columns.length * ARENA_GRID_SIZE };
}

export function getBoardSideCombatDistance(
  attacker: DiceInstanceState,
  target: DiceInstanceState,
  getBoardSide: (die: DiceInstanceState) => DiceOwnerId = getBoardSideForDistance
): number {
  if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;
  const attackerSide = getBoardSide(attacker);
  const targetSide = getBoardSide(target);

  if (attackerSide === targetSide) {
    return Math.abs(attacker.gridPosition.col - target.gridPosition.col) + 1;
  }

  const attackerToFrontline = attackerSide === 'player'
    ? ARENA_GRID_SIZE - attacker.gridPosition.col
    : attacker.gridPosition.col + 1;
  const targetFromFrontline = targetSide === 'player'
    ? ARENA_GRID_SIZE - target.gridPosition.col
    : target.gridPosition.col + 1;
  return Math.max(0, attackerToFrontline + targetFromFrontline - 1);
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
