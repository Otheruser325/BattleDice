export type DiceTypeId = string;
export type DiceSkillType = 'Passive' | 'Active' | 'CombatStart' | 'CombatEnd' | 'OnKill' | 'OnDamaged' | 'OnDeath' | 'OnTransformed';
export type DiceRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';
export type DiceTargetingMode = 'Nearest' | 'Furthest' | 'Strongest' | 'Weakest' | 'Random';
export const DICE_STATUS_EFFECT_POOL = ['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk', 'acceleration', 'dilation'] as const;
export type DiceStatusEffect = typeof DICE_STATUS_EFFECT_POOL[number];
export type DiceStatusEffectDurationEffect = DiceStatusEffect;
export type DiceStatusEffectDurationKey = `${DiceStatusEffect}Duration`;
export type DiceStatusEffectDurationProperties = {
  [key in DiceStatusEffectDurationKey]?: number;
};

export interface DiceSkillModifier extends DiceStatusEffectDurationProperties {
  attackDelta?: number;
  healthDelta?: number;
  attackMultiplier?: number;
  allyExtraAttacks?: number;
  foeExtraAttacks?: number;
  grantAttacksToAlly?: number;
  grantAttacksToFoe?: number;
  attackCountIncrease?: number;
  unlockAtClass?: number;
  statusDuration?: number;
  maxStacks?: number;
  splashDamage?: number;
  splashDamageRate?: number;
  splashDamageRatesByPip?: Record<string, number>;
  hasSplash?: boolean;
  heatwaveDamage?: number;
  heatwaveDamageRate?: number;
  heatwaveDamageRatesByPip?: Record<string, number>;
  chainDamage?: number;
  chainDamageRate?: number;
  chainDamageRatesByPip?: Record<string, number>;
  hasChain?: boolean;
  chainRange?: number;
  chainTargets?: number;
  poisonDamage?: number;
  poisonDamageRate?: number;
  poisonDamageRatesByPip?: Record<string, number>;
  activeDamage?: number;
  activeDamageRate?: number;
  activeDamageRatesByPip?: Record<string, number>;
  activeHeal?: number;
  onlyTargetsAllies?: boolean;
  skillTargeting?: DiceTargetingMode;
  canFireWithNoTargets?: boolean;
  meteorDamage?: number;
  hasMeteor?: boolean;
  lavaDamage?: number;
  lavaPoolPattern?: Array<[number, number]>;
  beamDamage?: number;
  hasBeam?: boolean;
  pierceBehindRange?: number;
  pierceBehindDamage?: number;
  hammerDamage?: number;
  hammerRadius?: number;
  canRetriggerSkill?: boolean;
  maxSkillRetriggers?: number;
  hasHammer?: boolean;
  reviveChance?: number;
  reviveChanceRate?: number;
  maxRevives?: number;
  dontReviveWhenLastOneStanding?: boolean;
  hasRevive?: boolean;
  reviveHealth?: number;
  reviveAttack?: number;
  damageRange?: [number, number];
  targetMaxHpBonusRate?: number;
  targetCurrentHpBonusRate?: number;
  lowHpThresholdRate?: number;
  lowHpDamageBonusRate?: number;
  berserkThresholdRate?: number;
  berserkDamageMultiplier?: number;
  pipMatchAllyAttackDelta?: number;
  pipMatchFoeAttackDelta?: number;
  distanceDamageBonusPerTile?: number;
  distanceDamageBonusRatePerTile?: number;
  bonusDamagePerStatus?: number;
  canBeDraggedPostCombat?: boolean;
  canBeRepositioned?: boolean;
  canReversePips?: boolean;
  reverseLimit?: number;
  reverseCooldown?: number;
  notes?: string[];
  canConjureSouls?: boolean;
  conjureType?: 'ally' | 'enemy' | 'both';
  maxSouls?: number;
  noMaxSouls?: boolean;
  soulBoostPercent?: number;
  transformSoulCount?: number;
  transformPipCount?: number;
  transformPipRequirements?: number[];
  transformOnOddPip?: boolean;
  transformOnEvenPip?: boolean;
  instakill?: boolean;
  bossDamage?: number;
  bossDamageRate?: number;
  bossDamageRatesByPip?: Record<string, number>;
  meteorCount?: number;
  meteorRandomOrientation?: boolean;
  summonType?: DiceTypeId;
  summonCount?: number;
  summonPattern?: Array<[number, number]>;
  allowSummonedDieToRoll?: boolean;
  checkForAdjacentAllies?: boolean;
  checkForAdjacentFoes?: boolean;
  shield?: number;
  armorReduction?: number;
  statusEffect?: DiceStatusEffect;
  tauntRange?: number;
  lockRange?: number;
  canLockFoes?: boolean;
  canLockAllies?: boolean;
  numLocks?: number;
  teleportRange?: number;
  teleportSkillFireIndex?: number;
  isInfiltrator?: boolean;
  strikeFirst?: boolean;
  numAttacksBoosted?: number;
  numAttacksDamageMult?: number;
  manaGain?: number;
  allyManaGain?: number;
  foeManaGain?: number;
  manaSteal?: number;
  manaStealType?: 'ally' | 'enemy' | 'both';
  disableManaGain?: boolean;
  consumeAttack?: boolean;
  hasGrowth?: boolean;
  growthDelta?: number;
  growthChance?: number;
  hasPlague?: boolean;
  plaguedDieType?: string;
  plaguedDieHealth?: number;
  plaguedDieAttack?: number;
  hasNuclear?: boolean;
  nuclearDamage?: number;
  nuclearArea?: number[] | string;
  nuclearPool?: string;
  nuclearPoolLifespan?: number;
  skillRangeThreshold?: number;
  skillSfx?: string;
  hitsAllFoes?: boolean;
  hitsAllAllies?: boolean;
  ricochetCount?: number;
  ricochetRange?: number;
  healOnAttack?: boolean;
  transformToNextForm?: boolean;
  transformAttackDamage?: number;
  deathDamage?: number;
  onKillDamage?: number;
  onHitDamage?: number;
  combatStartDamage?: number;
  combatEndDamage?: number;
  criticalChanceIncrease?: number;
  criticalDamageIncrease?: number;
  damageRatePerKill?: number;
  avoidAttackChance?: number;
  missingHealRate?: number;
  hasRevenge?: boolean;
  revengeThresholdRate?: number;
  revengeHits?: number;
  revengeDamage?: number;
  revengeRange?: number;
  attackSfx?: string;
  deuciferOddSiphonRate?: number;
  deuciferEvenDamageRate?: number;
}


export interface DiceSkillDefinition {
  type: DiceSkillType;
  title: string;
  description: string;
  manaNeeded?: number;
  modifiers?: DiceSkillModifier;
  descriptionLocked?: boolean;
  disableSkill?: boolean;
}

export interface DiceTalentModifier extends DiceSkillModifier {
  attackDelta?: number;
  healthDelta?: number;
  attackMultiplier?: number;
  healthMultiplier?: number;
  rangeDelta?: number;
  targetingMode?: DiceTargetingMode;
  skills?: DiceSkillDefinition[];
}

export interface DiceTalentDefinition {
  title: string;
  description: string;
  classNeeded?: number;
  isObtainable?: boolean;
  comingSoon?: boolean;
  modifiers?: DiceTalentModifier;
}

export interface DiceTransformStats {
  title?: string;
  skillsComingSoon?: boolean;
  attack?: number;
  health?: number;
  range?: number;
  footprint?: number;
  targetingMode?: DiceTargetingMode;
  accent?: string;
  rarity?: DiceRarity;
  isBoss?: boolean;
  attackMultiplier?: number;
  healthMultiplier?: number;
  recoveryRate?: number;
  transformDuration?: number;
  symbol?: string;
  skills?: DiceSkillDefinition[];
}

export interface DiceDefinition {
  typeId: DiceTypeId;
  title: string;
  attack: number;
  health: number;
  range: number;
  footprint?: number;
  targetingMode: DiceTargetingMode;
  rarity: DiceRarity;
  skills: DiceSkillDefinition[];
  talents?: DiceTalentDefinition[];
  talentsComingSoon?: boolean;
  accent: string;
  alternateButton?: string[];
  baseButton?: string[];
  transformStats?: DiceTransformStats[];
  transformFlags?: string[];
  isBoss?: boolean;
}


export interface DiceFlags {
  fetchableTypeIds: DiceTypeId[];
  exclusiveTypeIds?: Array<DiceTypeId | { typeId: DiceTypeId; path?: string }>;
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
  transformIndex?: number;
}

export interface MatchBattleState {
  turn: number;
  combatPhase: 'idle' | 'attacking' | 'resolved';
  dice: DiceInstanceState[];
  reviveCounts?: Record<string, number>;
}

export interface AppSettings {
  music: boolean;
  sfx: boolean;
  screenShake: boolean;
  reducedMotion: boolean;
  quickEquipDice: boolean;
  debugLogs: boolean;
}
