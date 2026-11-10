export type DiceTypeId = string;
export type DiceSkillType = 'Passive' | 'Active' | 'CombatStart' | 'CombatEnd' | 'OnKill' | 'OnDamaged' | 'OnDeath' | 'OnTransformed';
export type DiceRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';
export type DiceTargetingMode = 'Nearest' | 'Furthest' | 'Strongest' | 'Weakest' | 'Random';
export const DICE_STATUS_EFFECT_POOL = ['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk', 'acceleration', 'dilation', 'disorientation'] as const;
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
  allyExtraAttacksRadius?: number;
  foeExtraAttacks?: number;
  grantAttacksToAlly?: number;
  grantAttacksToAllyRadius?: number;
  grantAttacksToFoe?: number;
  attackCount?: number;
  attackCountIncrease?: number;
  projectileCount?: number;
  projectileCountIncrease?: number;
  unlockAtClass?: number;
  statusDuration?: number;
  skillDuration?: number;
  maxStacks?: number;
  splashDamage?: number;
  splashDamageRate?: number;
  splashDamageRatesByPip?: Record<string, number>;
  hasSplash?: boolean;
  hasHeatwave?: boolean;
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
  skillDamage?: number;
  skillDamageRate?: number;
  skillDamageRatesByPip?: Record<string, number>;
  skillHealing?: number;
  rapidFireCount?: number;
  rapidFireIncrease?: number;
  onlyTargetsAllies?: boolean;
  skillTargeting?: DiceTargetingMode;
  canFireWithNoTargets?: boolean;
  meteorDamage?: number;
  hasMeteor?: boolean;
  meteorPoolType?: string;
  meteorPoolPattern?: Array<[number, number]>;
  meteorPoolDuration?: number;
  beamDamage?: number;
  hasBeam?: boolean;
  pierceBehindRange?: number;
  pierceBehindDamage?: number;
  hasPierce?: boolean;
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
  hasLock?: boolean;
  lockRange?: number;
  lockSideTargeting?: 'allies' | 'foes' | 'both';
  lockDuration?: number;
  lockUnlockApplyStatusEffect?: boolean;
  canLockGridTiles?: boolean;
  onlyLockGridTiles?: boolean;
  gridLockDuration?: number;
  statusToOpposingHand?: boolean;
  numLocks?: number;
  teleportRange?: number;
  teleportSkillFireIndex?: number;
  isInfiltrator?: boolean;
  strikeFirst?: boolean;
  numAttacksBoosted?: number;
  numAttacksDamageMult?: number;
  manaGain?: number;
  allyManaGain?: number;
  manaGainRadius?: number;
  foeManaGain?: number;
  manaSteal?: number;
  manaStealType?: 'ally' | 'enemy' | 'both';
  disableManaGain?: boolean;
  consumeAttack?: boolean;
  hasGrowth?: boolean;
  growthDelta?: number;
  growthChance?: number;
  hasCardOrbit?: boolean;
  cardOrbitCount?: number;
  cardOrbitDamageRate?: number;
  unleashCardOrbit?: boolean;
  growthSuccessSfx?: string | string[];
  growthFailedSfx?: string | string[];
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
  skillSfx?: string | string[];
  hitsAllFoes?: boolean;
  hitsAllAllies?: boolean;
  ricochetCount?: number;
  ricochetRange?: number;
  hasRicochet?: boolean;
  ricochetDropOff?: number;
  healOnAttack?: boolean;
  transformToNextForm?: boolean;
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
  oddPipSiphonRate?: number;
  evenPipSiphonRate?: number;
  evenPipDamageRate?: number;
  oddPipDamageRate?: number;
}


export type DiceSkillClassBenefits = Partial<Record<keyof DiceSkillModifier | 'manaNeeded', number[]>>;

export interface DiceSkillDefinition {
  type: DiceSkillType;
  title: string;
  description: string;
  manaNeeded?: number;
  modifiers?: DiceSkillModifier;
  classBenefits?: DiceSkillClassBenefits;
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
  attackSfx?: string | string[];
  skills?: DiceSkillDefinition[];
}

export type DicePoolTarget = 'foes' | 'allies' | 'both';

export interface DicePoolDefinition {
  typeId: string;
  title: string;
  damage: number;
  pattern?: Array<[number, number]>;
  duration?: number;
  statusEffect?: DiceStatusEffect;
  statusDuration?: number;
  maxStacks?: number;
  affects?: DicePoolTarget;
  accent?: string;
  lingerSfx?: string | string[];
}

export interface DicePoolFlags {
  typeIds: string[];
}

export interface DicePoolInstance {
  typeId: string;
  title: string;
  damage: number;
  turns: number;
  sourceOwnerId: DiceOwnerId;
  sourceTypeId: DiceTypeId;
  sourceInstanceId?: string;
  statusEffect?: DiceStatusEffect;
  statusDuration?: number;
  maxStacks?: number;
  affects: DicePoolTarget;
  accent: number;
  lingerSfx?: string | string[];
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
  attackSfx?: string | string[];
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
