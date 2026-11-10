import { DUNGEON_MAX_WAVES } from './DungeonEvent';

export type DungeonResultStage = 'victory' | 'defeat' | 'draw';

export interface DungeonResultTransition {
  completed: boolean;
  clearedWave: number;
  rewardWave: number | null;
  captureCarryover: boolean;
  persistWave: number | null;
  nextWave: number | null;
  clearRun: boolean;
}

export function getDungeonResultTransition(stage: DungeonResultStage, wave: number): DungeonResultTransition {
  const boundedWave = Math.max(1, Math.min(DUNGEON_MAX_WAVES, Math.floor(wave)));
  if (stage !== 'victory') {
    return {
      completed: false,
      clearedWave: Math.max(0, boundedWave - 1),
      rewardWave: null,
      captureCarryover: false,
      persistWave: null,
      nextWave: null,
      clearRun: true
    };
  }

  const completed = boundedWave >= DUNGEON_MAX_WAVES;
  return {
    completed,
    clearedWave: boundedWave,
    rewardWave: boundedWave,
    captureCarryover: !completed,
    persistWave: completed ? null : boundedWave + 1,
    nextWave: completed ? null : boundedWave + 1,
    clearRun: completed
  };
}
