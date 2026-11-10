export type OwnerId = 'player' | 'enemy';
export type DiceZone = 'hand' | 'board' | 'eliminated';
export type TargetingMode = 'Nearest' | 'Furthest' | 'Strongest' | 'Weakest' | 'Random';
export type SkillType =
  | 'Passive'
  | 'Active'
  | 'CombatStart'
  | 'CombatEnd'
  | 'OnKill'
  | 'OnDamaged'
  | 'OnDeath'
  | 'OnTransformed';
export type StatusEffect =
  | 'slow'
  | 'poison'
  | 'fracture'
  | 'taunt'
  | 'stun'
  | 'berserk'
  | 'acceleration'
  | 'dilation'
  | 'disorientation';
export type PoolTarget = 'foes' | 'allies' | 'both';

export type SkillModifiers = Record<string, unknown>;

export type SkillClassBenefits = Record<string, number[]>;

export interface DiceSkillDefinition {
  type: SkillType;
  title: string;
  description: string;
  manaNeeded?: number;
  modifiers?: SkillModifiers;
  classBenefits?: SkillClassBenefits;
  descriptionLocked?: boolean;
  disableSkill?: boolean;
}

export interface DiceTalentDefinition {
  title: string;
  description: string;
  classNeeded?: number;
  isObtainable?: boolean;
  comingSoon?: boolean;
  modifiers?: SkillModifiers;
}

export interface DiceTransformStats {
  title?: string;
  attack?: number;
  health?: number;
  range?: number;
  footprint?: number;
  targetingMode?: TargetingMode;
  accent?: string;
  attackMultiplier?: number;
  healthMultiplier?: number;
  recoveryRate?: number;
  transformDuration?: number;
  symbol?: string;
  skills?: Array<DiceSkillDefinition | null>;
}

export interface PoolDefinition {
  typeId: string;
  title: string;
  damage: number;
  pattern?: Array<[number, number]>;
  duration?: number;
  statusEffect?: StatusEffect;
  statusDuration?: number;
  maxStacks?: number;
  affects?: PoolTarget;
  accent?: string;
}

export interface CombatPool {
  typeId: string;
  title: string;
  row: number;
  col: number;
  damage: number;
  turns: number;
  ownerId: OwnerId;
  sourceTypeId: string;
  sourceInstanceId?: string;
  statusEffect?: StatusEffect;
  statusDuration?: number;
  maxStacks?: number;
  affects: PoolTarget;
  accent?: string;
}

export interface DiceDefinition {
  typeId: string;
  title: string;
  attack: number;
  health: number;
  range: number;
  footprint?: number;
  targetingMode: TargetingMode;
  rarity: string;
  skills: DiceSkillDefinition[];
  talents?: DiceTalentDefinition[];
  talentsComingSoon?: boolean;
  accent: string;
  transformStats?: DiceTransformStats[];
  transformFlags?: string[];
  isBoss?: boolean;
}

export interface LoadoutEntry {
  typeId: string;
  classLevel: number;
  talentIndex: number | null;
}

export interface BattlePosition {
  row: number;
  col: number;
}

export interface StatusStack {
  type: StatusEffect;
  turns: number;
  value?: number;
  sourceId?: string;
  maxStacks?: number;
}

export interface CombatDie {
  instanceId: string;
  typeId: string;
  classLevel: number;
  ownerId: OwnerId;
  zone: DiceZone;
  maxHealth: number;
  currentHealth: number;
  isDestroyed: boolean;
  hasFinishedAttacking: boolean;
  attacksRemaining: number;
  gridPosition?: BattlePosition;
  pips: number;
  mana: Record<string, number>;
  poisonStacks?: Array<{
    damage: number;
    turns: number;
    sourceId?: string;
    sourceOwnerId?: OwnerId;
    sourceTypeId?: string;
  }>;
  slowStacks?: Array<{ delta: number; turns: number }>;
  shieldHp: number;
  shieldTurns: number;
  attackDelta: number;
  attackDeltaTurns: number;
  stunTurns: number;
  tauntedBySourceId?: string;
  tauntTurns: number;
  fractureRate: number;
  fractureTurns: number;
  growth: number;
  boostedAttacks: number;
  transformIndex?: number;
  transformTurns?: number;
}

export interface CombatState {
  turn: number;
  combatPhase: 'idle' | 'attacking' | 'resolved';
  dice: CombatDie[];
  reviveCounts: Record<string, number>;
  lockedBy: Record<string, string>;
  lockTurns: Record<string, number>;
  lockStatus?: Record<string, { effect: StatusEffect; turns: number; attackDelta?: number }>;
  gridLocks: Record<OwnerId, Record<string, number>>;
  pools: CombatPool[];
}

export interface ClientBattleDie {
  instanceId: string;
  typeId: string;
  ownerId: OwnerId;
  boardSide?: OwnerId;
  zone: DiceZone;
  maxHealth: number;
  currentHealth: number;
  isDestroyed: boolean;
  hasFinishedAttacking: boolean;
  attacksRemaining: number;
  gridPosition?: BattlePosition;
  transformIndex?: number;
}

export interface ClientBattleState {
  turn: number;
  combatPhase: 'idle' | 'attacking' | 'resolved';
  dice: ClientBattleDie[];
  reviveCounts?: Record<string, number>;
  pools?: Array<Omit<CombatPool, 'ownerId' | 'sourceTypeId' | 'sourceInstanceId'> & {
    boardSide: OwnerId;
  }>;
}

export type CombatEventKind =
  | 'round'
  | 'attack'
  | 'damage'
  | 'heal'
  | 'shield'
  | 'status'
  | 'defeat'
  | 'revive'
  | 'skill'
  | 'summon'
  | 'info';

export interface CombatEvent {
  kind: CombatEventKind;
  text: string;
  ownerId?: OwnerId;
  sourceId?: string;
  targetId?: string;
  amount?: number;
  critical?: boolean;
}

export interface CombatResolution {
  state: CombatState;
  events: CombatEvent[];
  result?: 'victory' | 'defeat' | 'draw';
  winnerId?: string;
}

export interface MatchRules {
  useLevelling: boolean;
  turnLimit: number;
  randomMode: boolean;
}
