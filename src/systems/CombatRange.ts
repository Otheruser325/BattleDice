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

export function getCombatDistance(
  attacker: DiceInstanceState,
  target: DiceInstanceState,
  footprintForDie?: (die: DiceInstanceState) => number
): number {
  if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;

  const attackerFootprint = Math.max(1, Math.floor(footprintForDie?.(attacker) ?? 1));
  const targetFootprint = Math.max(1, Math.floor(footprintForDie?.(target) ?? 1));
  let best = Number.POSITIVE_INFINITY;
  for (let attackerRow = 0; attackerRow < attackerFootprint; attackerRow++) {
    for (let attackerCol = 0; attackerCol < attackerFootprint; attackerCol++) {
      for (let targetRow = 0; targetRow < targetFootprint; targetRow++) {
        for (let targetCol = 0; targetCol < targetFootprint; targetCol++) {
          const source = {
            ...attacker,
            gridPosition: { row: attacker.gridPosition.row + attackerRow, col: attacker.gridPosition.col + attackerCol }
          };
          const destination = {
            ...target,
            gridPosition: { row: target.gridPosition.row + targetRow, col: target.gridPosition.col + targetCol }
          };
          const attackerBoardCol = source.gridPosition.col;
          const relativeTargetCol = getRelativeEnemyColumn(source, destination);
          best = Math.min(best, Math.abs(attackerBoardCol - relativeTargetCol) + 1);
        }
      }
    }
  }
  return best;
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

export function getGridChebyshevDistance(
  first: Pick<DiceInstanceState, 'gridPosition'>,
  second: Pick<DiceInstanceState, 'gridPosition'>,
  firstFootprint = 1,
  secondFootprint = 1
): number {
  if (!first.gridPosition || !second.gridPosition) return Number.POSITIVE_INFINITY;
  let best = Number.POSITIVE_INFINITY;
  for (let firstRow = 0; firstRow < Math.max(1, Math.floor(firstFootprint)); firstRow++) {
    for (let firstCol = 0; firstCol < Math.max(1, Math.floor(firstFootprint)); firstCol++) {
      for (let secondRow = 0; secondRow < Math.max(1, Math.floor(secondFootprint)); secondRow++) {
        for (let secondCol = 0; secondCol < Math.max(1, Math.floor(secondFootprint)); secondCol++) {
          best = Math.min(best, Math.max(
            Math.abs(first.gridPosition.row + firstRow - (second.gridPosition.row + secondRow)),
            Math.abs(first.gridPosition.col + firstCol - (second.gridPosition.col + secondCol))
          ));
        }
      }
    }
  }
  return best;
}

export function isWithinGridRadius(
  first: Pick<DiceInstanceState, 'gridPosition'>,
  second: Pick<DiceInstanceState, 'gridPosition'>,
  radius: number | undefined,
  footprintForDie?: (die: Pick<DiceInstanceState, 'gridPosition'>) => number
): boolean {
  if (radius === undefined) return true;
  const resolvedRadius = Math.max(0, Math.floor(radius));
  return getGridChebyshevDistance(first, second, footprintForDie?.(first) ?? 1, footprintForDie?.(second) ?? 1) <= resolvedRadius;
}
