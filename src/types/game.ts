export type DiceTypeId = string;
export type DiceSkillType = 'Passive' | 'Active' | 'CombatStart' | 'CombatEnd' | 'OnKill' | 'OnDeath';
export type DiceRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';
export type DiceTargetingMode = 'Nearest' | 'Furthest' | 'Strongest' | 'Weakest' | 'Random';

export interface DiceSkillModifier {
  attackDelta?: number;
  healthDelta?: number;
  attackMultiplier?: number;
  extraAttacks?: number;
  durationTurns?: number;
  splashDamage?: number;
  chainDamage?: number;
  notes?: string[];
}

export interface DiceSkillDefinition {
  type: DiceSkillType;
  title: string;
  description: string;
  manaNeeded?: number;
  modifiers?: DiceSkillModifier;
}

export interface DiceDefinition {
  typeId: DiceTypeId;
  title: string;
  attack: number;
  health: number;
  range: number;
  targetingMode: DiceTargetingMode;
  rarity: DiceRarity;
  skills: DiceSkillDefinition[];
  accent: string;
}

export interface DiceFlags {
  fetchableTypeIds: DiceTypeId[];
}

export type DiceOwnerId = 'player' | 'enemy';
export type DiceZone = 'hand' | 'board' | 'eliminated';

export interface DiceInstanceState {
  instanceId: string;
  typeId: DiceTypeId;
  ownerId: DiceOwnerId;
  zone: DiceZone;
  maxHealth: number;
  currentHealth: number;
  isDestroyed: boolean;
  hasFinishedAttacking: boolean;
  attacksRemaining: number;
  gridPosition?: {
    row: number;
    col: number;
  };
}

export interface MatchBattleState {
  turn: number;
  combatPhase: 'idle' | 'attacking' | 'resolved';
  dice: DiceInstanceState[];
}

export interface AppSettings {
  music: boolean;
  sfx: boolean;
  screenShake: boolean;
  reducedMotion: boolean;
}
