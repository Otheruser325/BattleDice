import { DICE_STATUS_EFFECT_POOL, type DiceDefinition, type DiceInstanceState, type DiceSkillDefinition, type DiceSkillModifier, type DiceSkillType, type DiceStatusEffect, type DiceStatusEffectDurationEffect, type DiceStatusEffectDurationKey, type DiceStatusEffectDurationProperties, type DiceTargetingMode } from '../types/game';
import { getBoardSideCombatDistance } from './CombatRange';
import { secureRandomBetween } from '../utils/RandomManager';

const STATUS_EFFECTS: DiceStatusEffect[] = [...DICE_STATUS_EFFECT_POOL];
const STATUS_DURATION_TYPES: DiceStatusEffectDurationEffect[] = [...DICE_STATUS_EFFECT_POOL];

type SfxMetadata = string | readonly string[];

function resolveSfxMetadata(value: unknown): SfxMetadata | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const keys = value.filter((key): key is string => typeof key === 'string' && key.trim().length > 0);
  return keys.length > 0 ? keys : undefined;
}

export interface DiceSkillRuntimeMeta extends DiceStatusEffectDurationProperties {
  transformFlags: string[];
  [key: `has${string}`]: boolean | undefined;
  randomDamage?: { min: number; max: number };
  targetMaxHpBonusRate?: number;
  targetCurrentHpBonusRate?: number;
  lowHpThresholdRate?: number;
  lowHpDamageBonusRate?: number;
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
  reviveChance?: number;
  reviveChanceRate?: number;
  maxRevives?: number;
  dontReviveWhenLastOneStanding?: boolean;
  hasRevive?: boolean;
  reviveHealth?: number;
  reviveAttack?: number;
  allyExtraAttacks?: number;
  allyExtraAttacksRadius?: number;
  foeExtraAttacks?: number;
  grantAttacksToAlly?: number;
  grantAttacksToAllyRadius?: number;
  grantAttacksToFoe?: number;
  grantAttacksTargeting?: DiceTargetingMode;
  grantAttacksToFoeTargeting?: DiceTargetingMode;
  targetingMode?: 'Nearest' | 'Furthest' | 'Strongest' | 'Weakest' | 'Random';
  statusEffect?: DiceStatusEffect;
  statusDuration?: number;
  maxStacks?: number;
  manaNeeded?: number;
  onTransformedExtraAttacks?: number;
  attackDelta?: number;
  activeAttackDelta?: number;
  activeDurationTurns?: number;
  activeMaxStacks?: number;
  poisonDamage?: number;
  poisonDamageRate?: number;
  poisonDamageRatesByPip?: Record<string, number>;
  skillDamageRate?: number;
  skillDamageRatesByPip?: Record<string, number>;
  distanceDamageBonusPerTile?: number;
  distanceDamageBonusRatePerTile?: number;
  bonusDamagePerStatus?: number;
  canBeDraggedPostCombat?: boolean;
  canBeRepositioned?: boolean;
  canReversePips?: boolean;
  reverseLimit?: number;
  reverseCooldown?: number;
  berserkThresholdRate?: number;
  berserkDamageMultiplier?: number;
  pipMatchAllyAttackDelta?: number;
  pipMatchFoeAttackDelta?: number;
  skillDamage?: number;
  rapidFireCount?: number;
  rapidFireIncrease?: number;
  skillHealing?: number;
  activeOnlyTargetsAllies?: boolean;
  activeSkillTargeting?: DiceTargetingMode;
  skillTargeting?: DiceTargetingMode;
  canFireWithNoTargets?: boolean;
  meteorDamage?: number;
  meteorCount?: number;
  hasMeteor?: boolean;
  meteorRandomOrientation?: boolean;
  summonType?: string;
  summonCount?: number;
  summonPattern?: Array<[number, number]>;
  allowSummonedDieToRoll?: boolean;
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
  shield?: number;
  armorShredRate?: number;
  activeStatusEffect?: DiceStatusEffect;
  statusEffects?: DiceStatusEffect[];
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
  attackCount?: number;
  attackCountIncrease?: number;
  projectileCount?: number;
  projectileCountIncrease?: number;
  skillDuration?: number;
  unlockAtClass?: number;
  numAttacksBoosted?: number;
  numAttacksDamageMult?: number;
  checkForAdjacentAllies?: boolean;
  checkForAdjacentFoes?: boolean;
  transformSoulCount?: number;
  transformPipCount?: number;
  transformPipRequirements?: number[];
  transformOnOddPip?: boolean;
  transformOnEvenPip?: boolean;
  hasGrowth?: boolean;
  growthDelta?: number;
  growthChance?: number;
  hasCardOrbit?: boolean;
  cardOrbitCount?: number;
  cardOrbitDamageRate?: number;
  unleashCardOrbit?: boolean;
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
  instakill?: boolean;
  bossDamage?: number;
  bossDamageRate?: number;
  bossDamageRatesByPip?: Record<string, number>;
  skillSfxKey?: SfxMetadata;
  activeSkillSfxKey?: SfxMetadata;
  passiveSkillSfxKey?: SfxMetadata;
  growthSuccessSfxKey?: SfxMetadata;
  growthFailedSfxKey?: SfxMetadata;
  canConjureSouls?: boolean;
  conjureType?: 'ally' | 'enemy' | 'both';
  maxSouls?: number;
  noMaxSouls?: boolean;
  soulBoostPercent?: number;
  onTransformedDurationTurns?: number;
  oddPipSiphonRate?: number;
  evenPipSiphonRate?: number;
  evenPipDamageRate?: number;
  oddPipDamageRate?: number;
  manaGain?: number;
  allyManaGain?: number;
  manaGainRadius?: number;
  foeManaGain?: number;
  manaSteal?: number;
  manaStealType?: 'ally' | 'enemy' | 'both';
  leonRageRate?: number;
  disableManaGain?: boolean;
  consumeAttack?: boolean;
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
}

const VALID_SKILL_TYPES: readonly DiceSkillType[] = [
  'Passive',
  'Active',
  'CombatStart',
  'CombatEnd',
  'OnKill',
  'OnDamaged',
  'OnDeath',
  'OnTransformed'
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

type GrantAttackKey = 'grantAttacksToAlly' | 'grantAttacksToFoe';

function resolveGrantAttackValue(
  modifiers: DiceSkillModifier[],
  key: GrantAttackKey
): number | undefined {
  const value = modifiers
    .map((modifier) => (modifier as Record<string, unknown>)[key])
    .find((candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate));
  return value === undefined ? undefined : Math.max(0, value);
}

function resolveRadiusValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
}

function resolveGrantAttackRadius(
  modifiers: DiceSkillModifier[],
  key: GrantAttackKey
): number | undefined {
  const source = modifiers.find((modifier) => {
    const value = (modifier as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value);
  });
  return resolveRadiusValue((source as Record<string, unknown> | undefined)?.[`${key}Radius`]);
}

function resolveGrantAttackTargeting(
  modifiers: DiceSkillModifier[],
  key: GrantAttackKey
): DiceTargetingMode | undefined {
  const source = modifiers.find((modifier) => {
    const value = (modifier as Record<string, unknown>)[key];
    return typeof value === 'number' && Number.isFinite(value);
  });
  return (source as { skillTargeting?: DiceTargetingMode } | undefined)?.skillTargeting;
}

function getValidSkillModifier(value: unknown): DiceSkillModifier | undefined {
  if (!isRecord(value)) return undefined;
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note): note is string => typeof note === 'string')
    : [];
  return { ...value, notes } as DiceSkillModifier;
}

export function getValidSkillDefinitions(definition: DiceDefinition | undefined): DiceSkillDefinition[] {
  const skills = definition && Array.isArray(definition.skills) ? definition.skills : [];
  return skills.flatMap((skill): DiceSkillDefinition[] => {
    if (!isRecord(skill) || !VALID_SKILL_TYPES.includes(skill.type as DiceSkillType)) return [];
    return [{
      ...skill,
      type: skill.type as DiceSkillType,
      title: typeof skill.title === 'string' ? skill.title : 'Unnamed skill',
      description: typeof skill.description === 'string' ? skill.description : '',
      modifiers: getValidSkillModifier(skill.modifiers)
    } as DiceSkillDefinition];
  });
}

function getValidDefinition(definition: DiceDefinition | undefined): DiceDefinition {
  return {
    ...(definition ?? {}),
    skills: getValidSkillDefinitions(definition)
  } as DiceDefinition;
}

export function hasTransformFlag(meta: DiceSkillRuntimeMeta, flag: string): boolean {
  return meta.transformFlags.includes(flag);
}

export function getTransformFlagName(flag: string): `has${string}` {
  return `has${flag.slice(0, 1).toUpperCase()}${flag.slice(1)}` as `has${string}`;
}

export function getTransformIndex(meta: DiceSkillRuntimeMeta, flag: string): number {
  return meta.transformFlags.indexOf(flag);
}

export type TransformPipTrigger = 'odd' | 'even' | 'both';

function getTransformTriggerModifiers(definition: DiceDefinition, transformIndex?: number) {
  const skills = transformIndex === undefined
    ? getValidSkillDefinitions(definition)
    : getValidSkillDefinitions({ ...definition, skills: definition.transformStats?.[transformIndex]?.skills ?? [] });
  return skills.map((skill) => skill.modifiers).filter((modifiers): modifiers is NonNullable<typeof modifiers> => Boolean(modifiers));
}

export function getTransformPipTrigger(definition: DiceDefinition, transformIndex?: number): TransformPipTrigger | undefined {
  const modifiers = getTransformTriggerModifiers(definition, transformIndex);
  const odd = modifiers.some((modifier) => modifier.transformOnOddPip === true);
  const even = modifiers.some((modifier) => modifier.transformOnEvenPip === true);
  if (odd && even) return 'both';
  if (odd) return 'odd';
  if (even) return 'even';
  return undefined;
}

export function matchesTransformPipTrigger(definition: DiceDefinition, pips: number, transformIndex?: number): boolean {
  const trigger = getTransformPipTrigger(definition, transformIndex);
  if (!trigger || pips <= 0) return false;
  return trigger === 'odd' ? pips % 2 === 1 : trigger === 'even' ? pips % 2 === 0 : pips > 0;
}

export function getAvailableTransformIndices(definition: DiceDefinition): number[] {
  const stages = definition.transformStats;
  const flags = definition.transformFlags;
  if (!stages?.[0] || !flags?.[0] || Object.keys(stages[0]).length === 0) return [];

  const available: number[] = [];
  for (let index = 0; index < stages.length; index++) {
    const stats = stages[index];
    if (!stats || !flags[index] || Object.keys(stats).length === 0) break;
    available.push(index);
  }
  return available;
}

export function getInitialTransformIndex(definition: DiceDefinition): number | undefined {
  const available = getAvailableTransformIndices(definition);
  return available[0];
}

function getPipRequirements(definition: DiceDefinition): Array<number | undefined> | undefined {
  const values = getTransformTriggerModifiers(definition)
    .map((modifier) => (modifier as { transformPipRequirements?: unknown }).transformPipRequirements)
    .find((candidate): candidate is unknown[] => Array.isArray(candidate));
  if (!values) return undefined;
  return values.map((value) => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6 ? value : undefined);
}

function getPipRequirement(definition: DiceDefinition, transformIndex: number): number | undefined {
  const requirements = getPipRequirements(definition);
  if (requirements) return requirements[transformIndex];
  return getTransformTriggerModifiers(definition)
    .map((modifier) => (modifier as { transformPipCount?: number }).transformPipCount)
    .find((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6);
}

export function getPipTriggeredTransformIndex(definition: DiceDefinition, pips: number, currentIndex = -1): number | undefined {
  const available = getAvailableTransformIndices(definition);
  if (available.length === 0 || pips < 1 || pips > 6) return undefined;
  const nextIndex = currentIndex < 0 ? available[0] : available.find((index) => index > currentIndex);
  if (nextIndex === undefined) return undefined;
  const requirements = getPipRequirements(definition);
  const explicitRequirement = getPipRequirement(definition, nextIndex);
  if (requirements) return explicitRequirement !== undefined && pips === explicitRequirement ? nextIndex : undefined;
  if (explicitRequirement !== undefined) return pips === explicitRequirement ? nextIndex : undefined;
  const triggerIndex = currentIndex < 0 ? undefined : currentIndex;
  const trigger = getTransformPipTrigger(definition, triggerIndex) ?? getTransformPipTrigger(definition);
  if (!trigger || (trigger === 'odd' && pips % 2 !== 1) || (trigger === 'even' && pips % 2 !== 0)) return undefined;
  return nextIndex;
}

function getStatusDurationKey(effect: DiceStatusEffectDurationEffect): DiceStatusEffectDurationKey {
  return `${effect}Duration` as DiceStatusEffectDurationKey;
}

export function getStatusEffectDurationFromModifiers(
  modifiers: DiceSkillModifier | undefined,
  effect: DiceStatusEffectDurationEffect
): number | undefined {
  if (!modifiers) return undefined;
  const value = (modifiers as Record<string, unknown>)[getStatusDurationKey(effect)];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function getStatusEffectDuration(
  meta: DiceSkillRuntimeMeta,
  effect: DiceStatusEffectDurationEffect
): number | undefined {
  const value = meta[getStatusDurationKey(effect)];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function getPipMappedRate(
  rates: Record<string, number> | undefined,
  pips: number,
  fallbackRate?: number
): number | undefined {
  const mappedRate = Number.isInteger(pips) && pips >= 1 && pips <= 6 ? rates?.[String(pips)] : undefined;
  return typeof mappedRate === 'number' && Number.isFinite(mappedRate)
    ? mappedRate
    : typeof fallbackRate === 'number' && Number.isFinite(fallbackRate) ? fallbackRate : undefined;
}

export function resolvePipScaledDamage(
  fixedDamage: number | undefined,
  basicAttackDamage: number,
  rate: number | undefined,
  ratesByPip: Record<string, number> | undefined,
  pips: number
): number {
  const baseDamage = typeof fixedDamage === 'number' && Number.isFinite(fixedDamage) ? fixedDamage : basicAttackDamage;
  const effectiveRate = getPipMappedRate(ratesByPip, pips, rate) ?? 1;
  return Math.max(1, Math.ceil(baseDamage * effectiveRate));
}

export function getSkillLockClass(skill: DiceSkillDefinition | undefined | null): number | undefined {
  const value = getValidSkillModifier(skill?.modifiers)?.unlockAtClass;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 15
    ? value
    : undefined;
}


export const CHAIN_NO_TARGET_CAP = -1;
export const DEFAULT_CHAIN_TARGETS = 1;

export function getChainTargetLimit(meta: Pick<DiceSkillRuntimeMeta, 'chainTargets'>): number {
  const raw = meta.chainTargets;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_CHAIN_TARGETS;
  const floored = Math.floor(raw);
  if (floored === CHAIN_NO_TARGET_CAP) return CHAIN_NO_TARGET_CAP;
  return Math.max(0, floored);
}

const TRIGGER_EXCLUSIVE_KEYS: Partial<Record<DiceSkillType, string[]>> = {
  OnKill: ['hasHammer', 'hammerDamage', 'hammerRadius', 'canRetriggerSkill', 'maxSkillRetriggers', 'leonRageRate'],
  OnTransformed: ['onTransformedExtraAttacks', 'onTransformedDurationTurns']
};

function isolateTriggerMeta(meta: DiceSkillRuntimeMeta, trigger: DiceSkillType): DiceSkillRuntimeMeta {
  const allowed = new Set(TRIGGER_EXCLUSIVE_KEYS[trigger] ?? []);
  for (const keys of Object.values(TRIGGER_EXCLUSIVE_KEYS)) {
    for (const key of keys) {
      if (!allowed.has(key)) delete (meta as unknown as Record<string, unknown>)[key];
    }
  }
  return meta;
}

export function getRuntimeSkillMetaForTrigger(definition: DiceDefinition | undefined, trigger: DiceSkillType, skillIndex?: number): DiceSkillRuntimeMeta {
  const validDefinition = getValidDefinition(definition);
  if (skillIndex !== undefined) {
    const selected = validDefinition.skills[skillIndex];
    if (!selected || selected.type !== trigger) return isolateTriggerMeta(getRuntimeSkillMeta({ ...validDefinition, skills: [] }), trigger);
    return isolateTriggerMeta(getRuntimeSkillMeta({ ...validDefinition, skills: [selected] }, trigger === 'Active' ? 0 : undefined), trigger);
  }
  const triggerSkills = validDefinition.skills.filter((skill) => skill.type === trigger);
  if (triggerSkills.length === 0) return isolateTriggerMeta(getRuntimeSkillMeta({ ...validDefinition, skills: [] }), trigger);
  return isolateTriggerMeta(getRuntimeSkillMeta({ ...validDefinition, skills: triggerSkills }, undefined, true), trigger);
}

export function getNuclearAreaDimensions(value: number[] | string | undefined): { rows: number; cols: number } {
  if (Array.isArray(value)) {
    const rows = Number.isFinite(value[0]) ? Math.max(1, Math.floor(value[0])) : 3;
    const cols = Number.isFinite(value[1]) ? Math.max(1, Math.floor(value[1])) : rows;
    return { rows, cols };
  }
  if (typeof value === 'string') {
    const match = value.match(/(\d+)\s*[xX×]\s*(\d+)/);
    if (match) return { rows: Math.max(1, Number(match[1])), cols: Math.max(1, Number(match[2])) };
    const single = Number(value);
    if (Number.isFinite(single)) return { rows: Math.max(1, Math.floor(single)), cols: Math.max(1, Math.floor(single)) };
  }
  return { rows: 3, cols: 3 };
}

// A skill that declares a skillRangeThreshold gates every modifier it carries behind that proximity.
// The gate is evaluated per triggering skill so a whole-die meta lookup cannot leak an in-range bonus
// (Leon's critical chance) outside the range the skill's own text promises.
const RANGE_THRESHOLD_KEYS: Array<keyof DiceSkillRuntimeMeta> = [
  'attackCount',
  'projectileCount',
  'rapidFireCount',
  'rapidFireIncrease',
  'attackCountIncrease',
  'projectileCountIncrease',
  'criticalChanceIncrease',
  'criticalDamageIncrease',
  'allyExtraAttacks',
  'allyExtraAttacksRadius',
  'foeExtraAttacks',
  'grantAttacksToAlly',
  'grantAttacksToAllyRadius',
  'grantAttacksToFoe',
  'manaGainRadius'
];

export function getRangeThresholdForMeta(meta: DiceSkillRuntimeMeta): number | undefined {
  const threshold = meta.skillRangeThreshold;
  return typeof threshold === 'number' && Number.isFinite(threshold) ? Math.max(0, threshold) : undefined;
}

export function isRangeThresholdSatisfied(meta: DiceSkillRuntimeMeta, distance: number, effectiveRange: number): boolean {
  const threshold = getRangeThresholdForMeta(meta);
  if (threshold === undefined) return true;
  if (!Number.isFinite(distance)) return false;
  return distance <= Math.max(1, effectiveRange - threshold);
}

export function gateMetaByRangeThreshold(meta: DiceSkillRuntimeMeta, inRange: boolean): DiceSkillRuntimeMeta {
  if (inRange || getRangeThresholdForMeta(meta) === undefined) return meta;
  const gated: DiceSkillRuntimeMeta = { ...meta };
  RANGE_THRESHOLD_KEYS.forEach((key) => {
    delete (gated as unknown as Record<string, unknown>)[key];
  });
  return gated;
}

export function resolveSkillExtraAttacks(meta: DiceSkillRuntimeMeta): { allyBonus: number; foeBonus: number; grantsToAlly: number; grantsToFoe: number } {
  const allyBonus = Math.max(0, meta.allyExtraAttacks ?? 0);
  const foeBonus = Math.max(0, meta.foeExtraAttacks ?? 0);
  const grantsToAlly = Math.max(0, meta.grantAttacksToAlly ?? 0);
  const grantsToFoe = Math.max(0, meta.grantAttacksToFoe ?? 0);
  return { allyBonus, foeBonus, grantsToAlly, grantsToFoe };
}

export function getRuntimeSkillMeta(definition: DiceDefinition | undefined, activeSkillIndex?: number, includePhaseHooks = false): DiceSkillRuntimeMeta {
  const validDefinition = getValidDefinition(definition);
  const skills = includePhaseHooks
    ? validDefinition.skills
    : validDefinition.skills.filter((skill) => skill.type !== 'CombatStart' && skill.type !== 'CombatEnd');
  const primary = skills[0];
  const modifiers = primary?.modifiers;
  const skillOfType = (type: DiceSkillType) => skills.find((skill) => skill.type === type);
  const selectedActiveSkill = activeSkillIndex === undefined || skills[activeSkillIndex]?.type !== 'Active'
    ? undefined
    : skills[activeSkillIndex];
  const activeSkill = selectedActiveSkill ?? skillOfType('Active');
  const activeModifiers = activeSkill?.modifiers;
  const onKillSkill = skillOfType('OnKill');
  const onKillModifiers = onKillSkill?.modifiers;
  const onDamagedSkill = skillOfType('OnDamaged');
  const onDamagedModifiers = onDamagedSkill?.modifiers;
  const onDeathSkill = skillOfType('OnDeath');
  const onDeathModifiers = onDeathSkill?.modifiers;
  const onTransformedSkill = skillOfType('OnTransformed');
  const onTransformedModifiers = onTransformedSkill?.modifiers;
  const runtimeSkills = selectedActiveSkill
    ? skills.filter((skill, index) => skill.type !== 'Active' || index === activeSkillIndex)
    : skills;
  const allModifiers = runtimeSkills.map((skill) => skill.modifiers).filter((modifier): modifier is NonNullable<typeof modifier> => Boolean(modifier));
  const passiveModifiers = runtimeSkills
    .filter((skill) => skill.type === 'Passive')
    .map((skill) => skill.modifiers)
    .filter((modifier): modifier is NonNullable<typeof modifier> => Boolean(modifier));
  const passiveCountSum = (key: 'attackCount' | 'projectileCount') => passiveModifiers.reduce((total, modifier) => {
    const value = (modifier as { [K in typeof key]?: number })[key];
    return total + (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const timedModifiers = runtimeSkills
    .filter((skill) => skill.type !== 'Passive')
    .map((skill) => skill.modifiers)
    .filter((modifier): modifier is NonNullable<typeof modifier> => Boolean(modifier));
  const attackCountIncreases = timedModifiers
    .map((modifier) => (modifier as { attackCountIncrease?: number }).attackCountIncrease)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const maxAttackCountIncrease = attackCountIncreases.length > 0 ? Math.max(...attackCountIncreases) : 0;
  const projectileCountIncreases = timedModifiers
    .map((modifier) => (modifier as { projectileCountIncrease?: number }).projectileCountIncrease)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const maxProjectileCountIncrease = projectileCountIncreases.length > 0 ? Math.max(...projectileCountIncreases) : 0;
  const passiveAttackCount = Math.max(0, Math.floor(passiveCountSum('attackCount')));
  const passiveProjectileCount = Math.max(0, Math.floor(passiveCountSum('projectileCount')));
  const cardOrbitModifier = passiveModifiers.find((modifier) => modifier.hasCardOrbit === true);
  const rawCardOrbitCount = cardOrbitModifier?.cardOrbitCount;
  const cardOrbitCount = typeof rawCardOrbitCount === 'number' && Number.isFinite(rawCardOrbitCount)
    ? Math.max(0, Math.floor(rawCardOrbitCount))
    : 0;
  const rawCardOrbitDamageRate = cardOrbitModifier?.cardOrbitDamageRate;
  const cardOrbitDamageRate = typeof rawCardOrbitDamageRate === 'number' && Number.isFinite(rawCardOrbitDamageRate)
    ? Math.max(0, rawCardOrbitDamageRate)
    : 0;
  const unleashCardOrbit = activeModifiers?.unleashCardOrbit === true;
  const sumModifier = (key: 'pipMatchAllyAttackDelta' | 'pipMatchFoeAttackDelta') => {
    const sum = allModifiers.reduce((total, modifier) => total + ((modifier as Record<typeof key, number | undefined>)[key] ?? 0), 0);
    return sum === 0 ? undefined : sum;
  };
  const rawRange = (modifiers as { damageRange?: unknown } | undefined)?.damageRange;
  const range = Array.isArray(rawRange)
    && rawRange.length >= 2
    && typeof rawRange[0] === 'number'
    && Number.isFinite(rawRange[0])
    && typeof rawRange[1] === 'number'
    && Number.isFinite(rawRange[1])
    ? [rawRange[0], rawRange[1]] as [number, number]
    : undefined;
  const rawReviveChance = (modifiers as { reviveChance?: number } | undefined)?.reviveChance;
  const reviveChance = typeof rawReviveChance === 'number' && Number.isFinite(rawReviveChance)
    ? Math.max(0, Math.min(1, rawReviveChance))
    : undefined;
  const rawReviveChanceRate = (modifiers as { reviveChanceRate?: number } | undefined)?.reviveChanceRate;
  const reviveChanceRate = typeof rawReviveChanceRate === 'number' && Number.isFinite(rawReviveChanceRate)
    ? Math.max(0, rawReviveChanceRate)
    : undefined;
  const rawMaxRevives = (modifiers as { maxRevives?: number } | undefined)?.maxRevives;
  const maxRevives = typeof rawMaxRevives === 'number' && Number.isFinite(rawMaxRevives)
    ? Math.max(0, Math.floor(rawMaxRevives))
    : undefined;
  const dontReviveWhenLastOneStanding = (modifiers as { dontReviveWhenLastOneStanding?: boolean } | undefined)?.dontReviveWhenLastOneStanding === true;
  const rawReviveHealth = (modifiers as { reviveHealth?: number } | undefined)?.reviveHealth;
  const reviveHealth = typeof rawReviveHealth === 'number' && Number.isFinite(rawReviveHealth)
    ? Math.max(0, Math.min(1, rawReviveHealth))
    : undefined;
  const rawReviveAttack = (modifiers as { reviveAttack?: number } | undefined)?.reviveAttack;
  const reviveAttack = typeof rawReviveAttack === 'number' && Number.isFinite(rawReviveAttack)
    ? Math.max(0, Math.min(1, rawReviveAttack))
    : undefined;
  const notes = modifiers?.notes ?? [];
  const explicitRate = (modifiers as { targetMaxHpBonusRate?: number } | undefined)?.targetMaxHpBonusRate;
  const explicitCurrentRate = (modifiers as { targetCurrentHpBonusRate?: number } | undefined)?.targetCurrentHpBonusRate;
  const rateNote = notes.find((note) => note.startsWith('runtime:targetMaxHpBonusRate='));
  const parsedRate = rateNote ? Number(rateNote.split('=')[1]) : undefined;
  const currentRateNote = notes.find((note) => note.startsWith('runtime:targetCurrentHpBonusRate='));
  const parsedCurrentRate = currentRateNote ? Number(currentRateNote.split('=')[1]) : undefined;
  const beamNote = allModifiers.flatMap((modifier) => modifier.notes ?? []).find((note) => note.startsWith('runtime:beamOnSix='));
  const parsedBeamDamage = beamNote ? Number(beamNote.split('=')[1]) : undefined;

  const getNoteValue = (prefix: string) => notes.find((note) => note.startsWith(prefix))?.slice(prefix.length);
  const allNotes = allModifiers.flatMap((modifier) => modifier.notes ?? []);
  const getActiveNoteValue = (prefix: string) => activeModifiers?.notes?.find((note) => note.startsWith(prefix))?.slice(prefix.length);
  const getAnyNoteValue = (prefix: string) => allNotes.find((note) => note.startsWith(prefix))?.slice(prefix.length);
  const passiveNotes = passiveModifiers.flatMap((modifier) => modifier.notes ?? []);
  const getPassiveNoteValue = (prefix: string) => passiveNotes.find((note) => note.startsWith(prefix))?.slice(prefix.length);
  const passiveRate = (key: 'oddPipSiphonRate' | 'evenPipSiphonRate' | 'evenPipDamageRate' | 'oddPipDamageRate') =>
    passiveModifiers
      .map((modifier) => modifier[key])
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const oddSiphonRate = passiveRate('oddPipSiphonRate') ?? Number(getPassiveNoteValue('runtime:oddPipSiphon='));
  const evenSiphonRate = passiveRate('evenPipSiphonRate') ?? Number(getPassiveNoteValue('runtime:evenPipSiphon='));
  const evenDamageRate = passiveRate('evenPipDamageRate') ?? Number(getPassiveNoteValue('runtime:evenPipDamage='));
  const oddDamageRate = passiveRate('oddPipDamageRate') ?? Number(getPassiveNoteValue('runtime:oddPipDamage='));
  const parseStatusEffect = (value: unknown): DiceStatusEffect | undefined => {
    if (typeof value !== 'string') return undefined;
    return STATUS_EFFECTS.includes(value as DiceStatusEffect) ? value as DiceStatusEffect : undefined;
  };
  const activeStatusEffectNote = getActiveNoteValue('runtime:statusEffect=') ?? getActiveNoteValue('runtime:status=');
  const activeStatusEffect = parseStatusEffect((activeModifiers as { statusEffect?: string } | undefined)?.statusEffect)
    ?? parseStatusEffect(activeStatusEffectNote);
  const statusNoteEffects = notes
    .map((note) => note.startsWith('runtime:statusEffect=') ? note.slice('runtime:statusEffect='.length) : note.startsWith('runtime:status=') ? note.slice('runtime:status='.length) : undefined)
    .map(parseStatusEffect)
    .filter((effect): effect is DiceStatusEffect => Boolean(effect));
  const primaryStatusEffect = parseStatusEffect((modifiers as { statusEffect?: string } | undefined)?.statusEffect);
  const statusEffects = [...new Set((primaryStatusEffect ? [primaryStatusEffect] : []).concat(statusNoteEffects))];
  const selectedStatusModifiers = activeSkill ? activeModifiers : modifiers;
  const damageModifiers = selectedActiveSkill ? activeModifiers : modifiers;
  const getSelectedDuration = (effect: DiceStatusEffectDurationEffect): number | undefined =>
    getStatusEffectDurationFromModifiers(selectedStatusModifiers, effect);
  const statusDurationProperties = Object.fromEntries(
    STATUS_DURATION_TYPES.map((effect) => [
      getStatusDurationKey(effect),
      allModifiers
        .map((modifier) => getStatusEffectDurationFromModifiers(modifier, effect))
        .find((value): value is number => value !== undefined)
    ])
  ) as Record<DiceStatusEffectDurationKey, number | undefined>;
  const tauntModifiers = allModifiers.find((modifier) =>
    parseStatusEffect((modifier as { statusEffect?: string }).statusEffect) === 'taunt'
    || (modifier.notes ?? []).includes('runtime:shieldTaunt'));
  const lockModifierCandidates = (selectedActiveSkill
    ? [activeModifiers]
    : [modifiers, ...allModifiers])
    .filter((modifier): modifier is DiceSkillModifier => Boolean(modifier));
  const lockModifiers = lockModifierCandidates.find((modifier) => modifier.hasLock === true);
  const hasLock = lockModifiers?.hasLock === true;
  const rawLockRange = lockModifiers?.lockRange;
  const lockRange = typeof rawLockRange === 'number' && Number.isFinite(rawLockRange) && (rawLockRange === -1 || rawLockRange > 0)
    ? rawLockRange
    : undefined;
  const rawLockSideTargeting = lockModifiers?.lockSideTargeting;
  const legacyCanLockAllies = (lockModifiers as { canLockAllies?: boolean } | undefined)?.canLockAllies === true;
  const lockSideTargeting: 'allies' | 'foes' | 'both' =
    rawLockSideTargeting === 'allies' || rawLockSideTargeting === 'foes' || rawLockSideTargeting === 'both'
      ? rawLockSideTargeting
      : legacyCanLockAllies ? 'both' : 'foes';
  const lockDuration = (() => {
    const value = lockModifiers?.lockDuration;
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : undefined;
  })();
  const canLockGridTiles = hasLock && lockModifiers?.canLockGridTiles === true;
  const onlyLockGridTiles = canLockGridTiles && lockModifiers?.onlyLockGridTiles === true;
  const lockUnlockApplyStatusEffect = lockModifiers?.lockUnlockApplyStatusEffect === true;
  const gridLockDuration = (() => {
    const value = lockModifiers?.gridLockDuration;
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : undefined;
  })();
  const getPipRateObject = (key: 'splashDamageRatesByPip' | 'heatwaveDamageRatesByPip' | 'chainDamageRatesByPip' | 'skillDamageRatesByPip' | 'poisonDamageRatesByPip' | 'bossDamageRatesByPip'): Record<string, number> | undefined => {
    const candidate = allModifiers
      .map((modifier) => (modifier as Record<string, unknown>)[key])
      .find((value): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value));
    if (!candidate) return undefined;
    const valid = Object.entries(candidate).filter(([pip, rate]) => {
      const pipNumber = Number(pip);
      return Number.isInteger(pipNumber) && pipNumber >= 1 && pipNumber <= 6 && typeof rate === 'number' && Number.isFinite(rate);
    });
    return Object.fromEntries(valid) as Record<string, number>;
  };
  const splashDamageRatesByPip = getPipRateObject('splashDamageRatesByPip');
  const heatwaveDamageRatesByPip = getPipRateObject('heatwaveDamageRatesByPip');
  const chainDamageRatesByPip = getPipRateObject('chainDamageRatesByPip');
  const skillDamageRatesByPip = getPipRateObject('skillDamageRatesByPip');
  const poisonDamageRatesByPip = getPipRateObject('poisonDamageRatesByPip');
  const bossDamageRatesByPip = getPipRateObject('bossDamageRatesByPip');
  const heatwaveDamageRate = allModifiers
    .map((modifier) => (modifier as { heatwaveDamageRate?: number }).heatwaveDamageRate)
    .find((rate): rate is number => typeof rate === 'number' && Number.isFinite(rate));
  const heatwaveDamage = allModifiers
    .map((modifier) => (modifier as { heatwaveDamage?: number }).heatwaveDamage)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const splashDamageRate = allModifiers
    .map((modifier) => (modifier as { splashDamageRate?: number }).splashDamageRate)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const chainDamageRate = allModifiers
    .map((modifier) => (modifier as { chainDamageRate?: number }).chainDamageRate)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const hasSplash = allModifiers.some((modifier) => (modifier as { hasSplash?: boolean }).hasSplash === true);
  const hasHeatwave = allModifiers.some((modifier) => (modifier as { hasHeatwave?: boolean }).hasHeatwave === true);
  const hasPierce = allModifiers.some((modifier) => (modifier as { hasPierce?: boolean }).hasPierce === true);
  const hasRicochet = allModifiers.some((modifier) => (modifier as { hasRicochet?: boolean }).hasRicochet === true);
  const ricochetDropOff = (() => {
    const value = allModifiers
      .map((modifier) => (modifier as { ricochetDropOff?: number }).ricochetDropOff)
      .find((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry));
    return value === undefined ? undefined : Math.min(1, Math.max(0, value));
  })();
  const hasChain = allModifiers.some((modifier) => (modifier as { hasChain?: boolean }).hasChain === true);
  const hasMeteor = Boolean((activeModifiers as { hasMeteor?: boolean } | undefined)?.hasMeteor ?? (modifiers as { hasMeteor?: boolean } | undefined)?.hasMeteor);
  const unlockAtClass = getSkillLockClass(selectedActiveSkill ?? primary);
  const criticalModifiers = allModifiers.find((modifier) =>
    (modifier as { criticalChanceIncrease?: number }).criticalChanceIncrease !== undefined
    || (modifier as { criticalDamageIncrease?: number }).criticalDamageIncrease !== undefined
  ) ?? modifiers;
  const summonModifier = allModifiers.find((modifier) =>
    (modifier as { summonType?: string }).summonType !== undefined
    || (modifier as { allowSummonedDieToRoll?: boolean }).allowSummonedDieToRoll !== undefined
  ) ?? modifiers;
  const growthSfxModifier = allModifiers.find((modifier) =>
    modifier.growthSuccessSfx !== undefined || modifier.growthFailedSfx !== undefined
  );
  const avoidModifier = allModifiers.find((modifier) =>
    (modifier as { avoidAttackChance?: number }).avoidAttackChance !== undefined
  ) ?? modifiers;
  const missingHealModifier = allModifiers.find((modifier) =>
    (modifier as { missingHealRate?: number }).missingHealRate !== undefined
  ) ?? modifiers;

  const transformFlags = Array.isArray(validDefinition.transformFlags)
    ? validDefinition.transformFlags.filter((flag): flag is string => typeof flag === 'string')
    : [];
  const generatedTransformBooleans = Object.fromEntries(
    transformFlags.map((flag) => [getTransformFlagName(flag), true])
  ) as Record<string, boolean>;

  return {
    transformFlags,
    ...generatedTransformBooleans,
    randomDamage: range ? { min: range[0], max: range[1] } : undefined,
    targetMaxHpBonusRate: explicitRate ?? (Number.isFinite(parsedRate) ? parsedRate : undefined),
    targetCurrentHpBonusRate: explicitCurrentRate ?? (Number.isFinite(parsedCurrentRate) ? parsedCurrentRate : undefined),
    lowHpThresholdRate: (damageModifiers as { lowHpThresholdRate?: number } | undefined)?.lowHpThresholdRate,
    lowHpDamageBonusRate: (damageModifiers as { lowHpDamageBonusRate?: number } | undefined)?.lowHpDamageBonusRate,
    splashDamage: allModifiers
      .map((modifier) => (modifier as { splashDamage?: number }).splashDamage)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    hasSplash,
    hasHeatwave,
    splashDamageRate,
    splashDamageRatesByPip,
    heatwaveDamage,
    heatwaveDamageRate,
    heatwaveDamageRatesByPip,
    chainDamage: allModifiers
      .map((modifier) => (modifier as { chainDamage?: number }).chainDamage)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    hasChain,
    chainDamageRate,
    chainDamageRatesByPip,
    reviveChance,
    reviveChanceRate,
    maxRevives,
    dontReviveWhenLastOneStanding,
    hasRevive: Boolean((modifiers as { hasRevive?: boolean } | undefined)?.hasRevive),
    reviveHealth,
    reviveAttack,
    allyExtraAttacks: modifiers?.allyExtraAttacks ?? 0,
    allyExtraAttacksRadius: resolveRadiusValue((modifiers as { allyExtraAttacksRadius?: unknown } | undefined)?.allyExtraAttacksRadius),
    foeExtraAttacks: modifiers?.foeExtraAttacks ?? 0,
    grantAttacksToAlly: resolveGrantAttackValue(allModifiers, 'grantAttacksToAlly'),
    grantAttacksToAllyRadius: resolveGrantAttackRadius(allModifiers, 'grantAttacksToAlly'),
    grantAttacksToFoe: resolveGrantAttackValue(allModifiers, 'grantAttacksToFoe'),
    grantAttacksTargeting: resolveGrantAttackTargeting(allModifiers, 'grantAttacksToAlly'),
    grantAttacksToFoeTargeting: resolveGrantAttackTargeting(allModifiers, 'grantAttacksToFoe'),
    targetingMode: validDefinition.targetingMode,
    statusEffect: parseStatusEffect((modifiers as { statusEffect?: string } | undefined)?.statusEffect),
    statusToOpposingHand: (modifiers as { statusToOpposingHand?: boolean } | undefined)?.statusToOpposingHand === true,
    statusDuration: (selectedStatusModifiers as { statusDuration?: number } | undefined)?.statusDuration,
    ...statusDurationProperties,
    maxStacks: (modifiers as { maxStacks?: number } | undefined)?.maxStacks,
    manaNeeded: activeSkill ? (activeSkill.manaNeeded ?? 0) : 0,
    attackCount: passiveAttackCount,
    attackCountIncrease: maxAttackCountIncrease,
    projectileCount: passiveProjectileCount,
    projectileCountIncrease: maxProjectileCountIncrease,
    hasCardOrbit: cardOrbitModifier !== undefined,
    cardOrbitCount,
    cardOrbitDamageRate,
    unleashCardOrbit,
    rapidFireCount: (() => {
      const value = activeModifiers?.rapidFireCount
        ?? allModifiers.map((modifier) => modifier.rapidFireCount).find((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry) && entry > 0);
      return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : undefined;
    })(),
    rapidFireIncrease: (() => {
      const total = allModifiers.reduce((sum, modifier) => {
        const value = modifier.rapidFireIncrease;
        return sum + (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
      }, 0);
      return total > 0 ? total : undefined;
    })(),
    skillDuration: (() => {
      const value = [activeModifiers, ...timedModifiers]
        .map((modifier) => (modifier as { skillDuration?: number } | undefined)?.skillDuration)
        .find((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry) && entry > 0);
      return value === undefined ? 0 : Math.max(0, Math.floor(value));
    })(),
    unlockAtClass,
    numAttacksBoosted: (modifiers as { numAttacksBoosted?: number } | undefined)?.numAttacksBoosted,
    numAttacksDamageMult: (modifiers as { numAttacksDamageMult?: number } | undefined)?.numAttacksDamageMult,
    attackDelta: modifiers?.attackDelta,
    activeAttackDelta: activeSkill ? (activeModifiers?.attackDelta ?? 0) : 0,
    activeDurationTurns: activeSkill ? (activeModifiers?.statusDuration
      ?? (activeStatusEffect ? getSelectedDuration(activeStatusEffect) : undefined)
      ?? 0) : 0,
    activeMaxStacks: activeSkill ? (activeModifiers?.maxStacks ?? 1) : 1,
    poisonDamage: (activeModifiers as { poisonDamage?: number } | undefined)?.poisonDamage ?? (modifiers as { poisonDamage?: number } | undefined)?.poisonDamage,
    poisonDamageRate: (activeModifiers as { poisonDamageRate?: number } | undefined)?.poisonDamageRate ?? (modifiers as { poisonDamageRate?: number } | undefined)?.poisonDamageRate,
    poisonDamageRatesByPip: (activeModifiers as { poisonDamageRatesByPip?: Record<string, number> } | undefined)?.poisonDamageRatesByPip ?? poisonDamageRatesByPip,
    skillDamageRate: (activeModifiers as { skillDamageRate?: number } | undefined)?.skillDamageRate
      ?? allModifiers.map((modifier) => modifier.skillDamageRate).find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    skillDamageRatesByPip: (activeModifiers as { skillDamageRatesByPip?: Record<string, number> } | undefined)?.skillDamageRatesByPip ?? skillDamageRatesByPip,
    distanceDamageBonusPerTile: (damageModifiers as { distanceDamageBonusPerTile?: number } | undefined)?.distanceDamageBonusPerTile,
    distanceDamageBonusRatePerTile: (damageModifiers as { distanceDamageBonusRatePerTile?: number } | undefined)?.distanceDamageBonusRatePerTile,
    bonusDamagePerStatus: (modifiers as { bonusDamagePerStatus?: number } | undefined)?.bonusDamagePerStatus,
    canBeDraggedPostCombat: Boolean((modifiers as { canBeDraggedPostCombat?: boolean } | undefined)?.canBeDraggedPostCombat === true),
    canBeRepositioned: Boolean((modifiers as { canBeRepositioned?: boolean } | undefined)?.canBeRepositioned === true),
    canReversePips: Boolean((modifiers as { canReversePips?: boolean } | undefined)?.canReversePips === true),
    reverseLimit: (() => {
      const value = (modifiers as { reverseLimit?: unknown } | undefined)?.reverseLimit;
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
    })(),
    reverseCooldown: (() => {
      const value = (modifiers as { reverseCooldown?: unknown } | undefined)?.reverseCooldown;
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : undefined;
    })(),
    berserkThresholdRate: (modifiers as { berserkThresholdRate?: number } | undefined)?.berserkThresholdRate,
    berserkDamageMultiplier: (modifiers as { berserkDamageMultiplier?: number } | undefined)?.berserkDamageMultiplier,
    pipMatchAllyAttackDelta: sumModifier('pipMatchAllyAttackDelta'),
    pipMatchFoeAttackDelta: sumModifier('pipMatchFoeAttackDelta'),
    skillDamage: (activeModifiers as { skillDamage?: number } | undefined)?.skillDamage
      ?? allModifiers.map((modifier) => modifier.skillDamage).find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    skillHealing: (activeModifiers as { skillHealing?: number } | undefined)?.skillHealing
      ?? allModifiers.map((modifier) => modifier.skillHealing).find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    activeOnlyTargetsAllies: Boolean((activeModifiers as { onlyTargetsAllies?: boolean } | undefined)?.onlyTargetsAllies),
    activeSkillTargeting: (activeModifiers as { skillTargeting?: DiceTargetingMode } | undefined)?.skillTargeting,
    skillTargeting: (modifiers as { skillTargeting?: DiceTargetingMode } | undefined)?.skillTargeting,
    canFireWithNoTargets: Boolean(
      (activeModifiers as { canFireWithNoTargets?: boolean } | undefined)?.canFireWithNoTargets === true
      || (modifiers as { canFireWithNoTargets?: boolean } | undefined)?.canFireWithNoTargets === true
    ),
    chainRange: (activeModifiers as { chainRange?: number } | undefined)?.chainRange ?? (modifiers as { chainRange?: number } | undefined)?.chainRange,
    chainTargets: (activeModifiers as { chainTargets?: number } | undefined)?.chainTargets ?? (modifiers as { chainTargets?: number } | undefined)?.chainTargets,
    hasMeteor,
    meteorDamage: (activeModifiers as { meteorDamage?: number } | undefined)?.meteorDamage ?? (modifiers as { meteorDamage?: number } | undefined)?.meteorDamage,
    meteorCount: (activeModifiers as { meteorCount?: number } | undefined)?.meteorCount ?? (modifiers as { meteorCount?: number } | undefined)?.meteorCount,
    meteorRandomOrientation: Boolean((activeModifiers as { meteorRandomOrientation?: boolean } | undefined)?.meteorRandomOrientation ?? (modifiers as { meteorRandomOrientation?: boolean } | undefined)?.meteorRandomOrientation),
    meteorPoolType: (activeModifiers as { meteorPoolType?: string } | undefined)?.meteorPoolType
      ?? allModifiers.map((modifier) => modifier.meteorPoolType).find((value): value is string => typeof value === 'string'),
    meteorPoolPattern: (activeModifiers as { meteorPoolPattern?: Array<[number, number]> } | undefined)?.meteorPoolPattern
      ?? allModifiers.map((modifier) => modifier.meteorPoolPattern).find((value): value is Array<[number, number]> => Array.isArray(value)),
    meteorPoolDuration: (() => {
      const value = (activeModifiers as { meteorPoolDuration?: number } | undefined)?.meteorPoolDuration
        ?? allModifiers.map((modifier) => modifier.meteorPoolDuration).find((candidate): candidate is number => typeof candidate === 'number' && Number.isFinite(candidate));
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : undefined;
    })(),
    beamDamage: (modifiers as { beamDamage?: number } | undefined)?.beamDamage ?? (Number.isFinite(parsedBeamDamage) ? parsedBeamDamage : undefined),
    hasBeam: Boolean((modifiers as { hasBeam?: boolean } | undefined)?.hasBeam === true),
    pierceBehindRange: (modifiers as { pierceBehindRange?: number } | undefined)?.pierceBehindRange,
    pierceBehindDamage: (activeModifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage ?? (modifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage,
    hasPierce,
    hammerDamage: (modifiers as { hammerDamage?: number } | undefined)?.hammerDamage,
    hammerRadius: (modifiers as { hammerRadius?: number } | undefined)?.hammerRadius,
    canRetriggerSkill: Boolean((modifiers as { canRetriggerSkill?: boolean } | undefined)?.canRetriggerSkill),
    maxSkillRetriggers: (modifiers as { maxSkillRetriggers?: number } | undefined)?.maxSkillRetriggers,
    hasHammer: Boolean((modifiers as { hasHammer?: boolean } | undefined)?.hasHammer),
    shield: (activeModifiers as { shield?: number } | undefined)?.shield ?? (modifiers as { shield?: number } | undefined)?.shield,
    armorShredRate: (() => {
      const explicitArmorReduction = (activeModifiers as { armorReduction?: number } | undefined)?.armorReduction ?? (modifiers as { armorReduction?: number } | undefined)?.armorReduction;
      if (explicitArmorReduction !== undefined) return explicitArmorReduction;
      const activeNotes = activeModifiers?.notes ?? [];
      const shredNote = [...activeNotes, ...notes].find((note) => note.startsWith('runtime:armorShredRate='));
      const parsed = shredNote ? Number(shredNote.split('=')[1]) : undefined;
      return Number.isFinite(parsed) ? parsed : undefined;
    })(),
    activeStatusEffect,
    statusEffects,
    tauntRange: (tauntModifiers as { tauntRange?: number } | undefined)?.tauntRange,
    hasLock,
    lockRange,
    teleportRange: (modifiers as { teleportRange?: number } | undefined)?.teleportRange,
    teleportSkillFireIndex: (() => {
      const value = (modifiers as { teleportSkillFireIndex?: unknown } | undefined)?.teleportSkillFireIndex;
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
    })(),
    isInfiltrator: Boolean((modifiers as { isInfiltrator?: boolean } | undefined)?.isInfiltrator === true),
    strikeFirst: Boolean((modifiers as { strikeFirst?: boolean } | undefined)?.strikeFirst === true),
    lockSideTargeting,
    lockDuration,
    lockUnlockApplyStatusEffect,
    canLockGridTiles,
    onlyLockGridTiles,
    gridLockDuration,
    numLocks: (() => {
      const value = (lockModifiers as { numLocks?: unknown } | undefined)?.numLocks;
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : undefined;
    })(),
    checkForAdjacentAllies: Boolean((modifiers as { checkForAdjacentAllies?: boolean } | undefined)?.checkForAdjacentAllies),
    checkForAdjacentFoes: Boolean((modifiers as { checkForAdjacentFoes?: boolean } | undefined)?.checkForAdjacentFoes),
    transformSoulCount: allModifiers
      .map((modifier) => (modifier as { transformSoulCount?: number }).transformSoulCount)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    transformPipCount: allModifiers
      .map((modifier) => (modifier as { transformPipCount?: number }).transformPipCount)
      .find((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6),
    transformPipRequirements: allModifiers
      .map((modifier) => (modifier as { transformPipRequirements?: unknown }).transformPipRequirements)
      .find((value): value is number[] => Array.isArray(value)),
    transformOnOddPip: Boolean((modifiers as { transformOnOddPip?: boolean } | undefined)?.transformOnOddPip),
    transformOnEvenPip: Boolean((modifiers as { transformOnEvenPip?: boolean } | undefined)?.transformOnEvenPip),
    hasGrowth: Boolean((modifiers as { hasGrowth?: boolean } | undefined)?.hasGrowth),
    growthDelta: modifiers?.growthDelta,
    growthChance: modifiers?.growthChance,
    hasPlague: Boolean((modifiers as { hasPlague?: boolean } | undefined)?.hasPlague),
    plaguedDieType: (modifiers as { plaguedDieType?: string } | undefined)?.plaguedDieType,
    plaguedDieHealth: (modifiers as { plaguedDieHealth?: number } | undefined)?.plaguedDieHealth,
    plaguedDieAttack: (modifiers as { plaguedDieAttack?: number } | undefined)?.plaguedDieAttack,
    hasNuclear: Boolean((modifiers as { hasNuclear?: boolean } | undefined)?.hasNuclear),
    nuclearDamage: (modifiers as { nuclearDamage?: number } | undefined)?.nuclearDamage,
    nuclearArea: (modifiers as { nuclearArea?: number[] | string } | undefined)?.nuclearArea,
    nuclearPool: (modifiers as { nuclearPool?: string } | undefined)?.nuclearPool,
    nuclearPoolLifespan: (modifiers as { nuclearPoolLifespan?: number } | undefined)?.nuclearPoolLifespan,
    skillRangeThreshold: (modifiers as { skillRangeThreshold?: number } | undefined)?.skillRangeThreshold,
    instakill: Boolean((activeModifiers as { instakill?: boolean } | undefined)?.instakill ?? (modifiers as { instakill?: boolean } | undefined)?.instakill),
    bossDamage: (activeModifiers as { bossDamage?: number } | undefined)?.bossDamage ?? (modifiers as { bossDamage?: number } | undefined)?.bossDamage,
    bossDamageRate: (activeModifiers as { bossDamageRate?: number } | undefined)?.bossDamageRate ?? (modifiers as { bossDamageRate?: number } | undefined)?.bossDamageRate,
    bossDamageRatesByPip: (activeModifiers as { bossDamageRatesByPip?: Record<string, number> } | undefined)?.bossDamageRatesByPip ?? bossDamageRatesByPip,
    skillSfxKey: resolveSfxMetadata((activeModifiers as { skillSfx?: unknown } | undefined)?.skillSfx)
      ?? resolveSfxMetadata((modifiers as { skillSfx?: unknown } | undefined)?.skillSfx)
      ?? getActiveNoteValue('runtime:skillSfx=')
      ?? getAnyNoteValue('runtime:skillSfx=')
      ?? getNoteValue('runtime:skillSfx='),
    activeSkillSfxKey: resolveSfxMetadata((activeModifiers as { skillSfx?: unknown } | undefined)?.skillSfx) ?? getActiveNoteValue('runtime:skillSfx='),
    passiveSkillSfxKey: resolveSfxMetadata((modifiers as { skillSfx?: unknown } | undefined)?.skillSfx) ?? getNoteValue('runtime:skillSfx='),
    growthSuccessSfxKey: resolveSfxMetadata(growthSfxModifier?.growthSuccessSfx),
    growthFailedSfxKey: resolveSfxMetadata(growthSfxModifier?.growthFailedSfx),
    canConjureSouls: Boolean((modifiers as { canConjureSouls?: boolean } | undefined)?.canConjureSouls),
    conjureType: ((modifiers as { conjureType?: 'ally' | 'enemy' | 'both' } | undefined)?.conjureType),
    maxSouls: (modifiers as { maxSouls?: number } | undefined)?.maxSouls,
    noMaxSouls: Boolean((modifiers as { noMaxSouls?: boolean } | undefined)?.noMaxSouls),
    soulBoostPercent: (modifiers as { soulBoostPercent?: number } | undefined)?.soulBoostPercent,
    onTransformedExtraAttacks: onTransformedModifiers?.allyExtraAttacks ?? 0,
    onTransformedDurationTurns: onTransformedModifiers?.statusDuration,
    oddPipSiphonRate: Number.isFinite(oddSiphonRate) ? oddSiphonRate : undefined,
    evenPipSiphonRate: Number.isFinite(evenSiphonRate) ? evenSiphonRate : undefined,
    evenPipDamageRate: Number.isFinite(evenDamageRate) ? evenDamageRate : undefined,
    oddPipDamageRate: Number.isFinite(oddDamageRate) ? oddDamageRate : undefined,
    summonType: (summonModifier as { summonType?: string } | undefined)?.summonType,
    summonCount: (summonModifier as { summonCount?: number } | undefined)?.summonCount,
    summonPattern: (summonModifier as { summonPattern?: Array<[number, number]> } | undefined)?.summonPattern,
    allowSummonedDieToRoll: Boolean((summonModifier as { allowSummonedDieToRoll?: boolean } | undefined)?.allowSummonedDieToRoll),
    manaGain: (activeModifiers as { manaGain?: number } | undefined)?.manaGain ?? (modifiers as { manaGain?: number } | undefined)?.manaGain,
    allyManaGain: (activeModifiers as { allyManaGain?: number } | undefined)?.allyManaGain ?? (modifiers as { allyManaGain?: number } | undefined)?.allyManaGain,
    manaGainRadius: resolveRadiusValue((activeModifiers as { manaGainRadius?: unknown } | undefined)?.manaGainRadius ?? (modifiers as { manaGainRadius?: unknown } | undefined)?.manaGainRadius),
    foeManaGain: (activeModifiers as { foeManaGain?: number } | undefined)?.foeManaGain ?? (modifiers as { foeManaGain?: number } | undefined)?.foeManaGain,
    manaSteal: (activeModifiers as { manaSteal?: number } | undefined)?.manaSteal ?? (modifiers as { manaSteal?: number } | undefined)?.manaSteal,
    manaStealType: (activeModifiers as { manaStealType?: 'ally' | 'enemy' | 'both' } | undefined)?.manaStealType ?? (modifiers as { manaStealType?: 'ally' | 'enemy' | 'both' } | undefined)?.manaStealType,
    hitsAllFoes: Boolean((activeModifiers as { hitsAllFoes?: boolean } | undefined)?.hitsAllFoes),
    hitsAllAllies: Boolean((activeModifiers as { hitsAllAllies?: boolean } | undefined)?.hitsAllAllies),
    ricochetCount: allModifiers
      .map((modifier) => (modifier as { ricochetCount?: number }).ricochetCount)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    ricochetRange: allModifiers
      .map((modifier) => (modifier as { ricochetRange?: number }).ricochetRange)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    hasRicochet,
    ricochetDropOff,
    healOnAttack: Boolean(allModifiers.some((modifier) => (modifier as { healOnAttack?: boolean }).healOnAttack === true)),
    transformToNextForm: Boolean(allModifiers.some((modifier) => (modifier as { transformToNextForm?: boolean }).transformToNextForm === true)),
     criticalChanceIncrease: (criticalModifiers as { criticalChanceIncrease?: number } | undefined)?.criticalChanceIncrease,
     criticalDamageIncrease: (criticalModifiers as { criticalDamageIncrease?: number } | undefined)?.criticalDamageIncrease,
    damageRatePerKill: (modifiers as { damageRatePerKill?: number } | undefined)?.damageRatePerKill,
    avoidAttackChance: (avoidModifier as { avoidAttackChance?: number } | undefined)?.avoidAttackChance,
    missingHealRate: (missingHealModifier as { missingHealRate?: number } | undefined)?.missingHealRate,
    hasRevenge: Boolean((modifiers as { hasRevenge?: boolean } | undefined)?.hasRevenge),
    revengeThresholdRate: (modifiers as { revengeThresholdRate?: number } | undefined)?.revengeThresholdRate,
    revengeHits: (modifiers as { revengeHits?: number } | undefined)?.revengeHits,
    revengeDamage: (modifiers as { revengeDamage?: number } | undefined)?.revengeDamage,
    revengeRange: (modifiers as { revengeRange?: number } | undefined)?.revengeRange,
    leonRageRate: (modifiers as { damageRatePerKill?: number } | undefined)?.damageRatePerKill,
    disableManaGain: Boolean((activeModifiers as { disableManaGain?: boolean } | undefined)?.disableManaGain),
    consumeAttack: (activeModifiers as { consumeAttack?: boolean } | undefined)?.consumeAttack ?? true
  };
}

export function resolveDamage(
  attacker: DiceInstanceState,
  target: DiceInstanceState,
  definitions: Map<string, DiceDefinition>,
  attackerDefinitionOverride?: DiceDefinition
): number {
  const definition = attackerDefinitionOverride ?? definitions.get(attacker.typeId);
  if (!definition) return 10;
  let damage = definition.attack;
  const meta = getRuntimeSkillMeta(definition);
  if (meta.randomDamage) {
    const { min, max } = meta.randomDamage;
    damage = secureRandomBetween(min, max);
  }
  if (meta.targetMaxHpBonusRate && !meta.checkForAdjacentAllies) {
    damage += Math.floor(target.maxHealth * meta.targetMaxHpBonusRate);
  }
  if (meta.targetCurrentHpBonusRate) {
    damage += Math.floor(target.currentHealth * meta.targetCurrentHpBonusRate);
  }
  if (meta.berserkThresholdRate !== undefined && meta.berserkDamageMultiplier !== undefined && attacker.maxHealth > 0 && attacker.currentHealth / attacker.maxHealth < meta.berserkThresholdRate) {
    damage = Math.max(1, Math.round(damage * meta.berserkDamageMultiplier));
  }
  if ((meta.distanceDamageBonusPerTile || meta.distanceDamageBonusRatePerTile) && attacker.gridPosition && target.gridPosition) {
    const distance = getBoardSideCombatDistance(attacker, target);
    if (meta.distanceDamageBonusPerTile) {
      damage += distance * meta.distanceDamageBonusPerTile;
    }
    if (meta.distanceDamageBonusRatePerTile) {
      damage += Math.floor(damage * meta.distanceDamageBonusRatePerTile * distance);
    }
  }
  return damage;
}
