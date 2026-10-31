import type { DiceDefinition } from '../types/game';
import { applyClassProgression } from './ClassProgression';

export interface PlagueSpawnInput {
  baseDefinition: DiceDefinition;
  classLevel: number;
  healthRate: number;
  attackRate: number;
  defeatedPips: number;
  defeatedPosition?: { row: number; col: number };
  defeatedBoardSide: 'player' | 'enemy';
  footprint: number;
  gridSize: number;
  isAvailable?: (row: number, col: number) => boolean;
}

export interface PlagueSpawnResult {
  definition: DiceDefinition;
  maxHealth: number;
  currentHealth: number;
  pips: number;
  position: { row: number; col: number };
  boardSide: 'player' | 'enemy';
}

export function resolvePlagueSpawn(input: PlagueSpawnInput): PlagueSpawnResult | undefined {
  const gridSize = Math.max(1, Math.floor(input.gridSize));
  const footprint = Math.max(1, Math.min(gridSize, Math.floor(input.footprint)));
  const classLevel = Number.isFinite(input.classLevel) ? Math.floor(input.classLevel) : 1;
  const healthRate = Number.isFinite(input.healthRate) ? Math.max(0, Math.min(1, input.healthRate)) : 1;
  const attackRate = Number.isFinite(input.attackRate) ? Math.max(0, input.attackRate) : 1;
  const pips = Number.isFinite(input.defeatedPips) ? Math.max(1, Math.floor(input.defeatedPips)) : 1;
  const position = input.defeatedPosition;
  if (!position) return undefined;
  const row = Math.floor(position.row);
  const col = Math.floor(position.col);
  if (row < 0 || col < 0 || row + footprint > gridSize || col + footprint > gridSize) return undefined;
  if (input.isAvailable && !input.isAvailable(row, col)) return undefined;

  const base = applyClassProgression(input.baseDefinition, classLevel);
  const maxHealth = Math.max(1, Math.round(Number.isFinite(base.health) ? base.health : 1));
  const currentHealth = Math.max(1, Math.round(maxHealth * healthRate));

  return {
    definition: {
      ...base,
      attack: Math.max(1, Math.round(base.attack * attackRate)),
      health: maxHealth
    },
    maxHealth,
    currentHealth,
    pips,
    position: { row, col },
    boardSide: input.defeatedBoardSide
  };
}
