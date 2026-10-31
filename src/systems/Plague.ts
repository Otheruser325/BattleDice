import type { DiceDefinition } from '../types/game';
import { applyClassProgression } from './ClassProgression';

export interface PlagueSpawnInput {
  baseDefinition: DiceDefinition;
  classLevel: number;
  healthRate: number;
  attackRate: number;
  defeatedMaxHealth: number;
  defeatedPips: number;
  defeatedPosition?: { row: number; col: number };
  footprint: number;
  gridSize: number;
  isAvailable: (row: number, col: number) => boolean;
}

export interface PlagueSpawnResult {
  definition: DiceDefinition;
  maxHealth: number;
  pips: number;
  position: { row: number; col: number };
}

export function resolvePlagueSpawn(input: PlagueSpawnInput): PlagueSpawnResult | undefined {
  const gridSize = Math.max(1, Math.floor(input.gridSize));
  const footprint = Math.max(1, Math.min(gridSize, Math.floor(input.footprint)));
  const classLevel = Number.isFinite(input.classLevel) ? Math.floor(input.classLevel) : 1;
  const healthRate = Number.isFinite(input.healthRate) ? Math.max(0, Math.min(1, input.healthRate)) : 1;
  const attackRate = Number.isFinite(input.attackRate) ? Math.max(0, input.attackRate) : 1;
  const pips = Number.isFinite(input.defeatedPips) ? Math.max(1, Math.floor(input.defeatedPips)) : 1;
  const base = applyClassProgression(input.baseDefinition, classLevel);
  const maxHealth = Math.max(1, Math.ceil(input.defeatedMaxHealth * healthRate));
  const preferred = {
    row: Math.max(0, Math.min(gridSize - footprint, input.defeatedPosition?.row ?? 0)),
    col: Math.max(0, Math.min(gridSize - footprint, input.defeatedPosition?.col ?? 0))
  };
  const candidates = [
    preferred,
    ...Array.from({ length: gridSize * gridSize }, (_, index) => ({
      row: Math.floor(index / gridSize),
      col: index % gridSize
    }))
  ];
  const position = candidates.find((tile) => (
    tile.row >= 0
    && tile.col >= 0
    && tile.row + footprint <= gridSize
    && tile.col + footprint <= gridSize
    && input.isAvailable(tile.row, tile.col)
  ));
  if (!position) return undefined;

  return {
    definition: {
      ...base,
      attack: Math.max(1, Math.round(base.attack * attackRate)),
      health: maxHealth
    },
    maxHealth,
    pips,
    position
  };
}
