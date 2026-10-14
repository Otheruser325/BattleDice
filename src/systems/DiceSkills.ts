import { DICE_STATUS_EFFECT_POOL, type DiceDefinition, type DiceInstanceState, type DiceSkillDefinition, type DiceSkillModifier, type DiceSkillType, type DiceStatusEffect, type DiceStatusEffectDurationEffect, type DiceStatusEffectDurationKey, type DiceStatusEffectDurationProperties, type DiceTargetingMode } from '../types/game';
import { getBoardSideCombatDistance } from './CombatRange';
import { secureRandomBetween } from '../utils/RandomManager';

const STATUS_EFFECTS: DiceStatusEffect[] = [...DICE_STATUS_EFFECT_POOL];
const STATUS_DURATION_TYPES: DiceStatusEffectDurationEffect[] = [...DICE_STATUS_EFFECT_POOL];

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
  heatwaveDamage?: number;
  heatwaveDamageRate?: number;
  heatwaveDamageRatesByPip?: Record<string, number>;
  chainDamage?: number;
  chainDamageRate?: number;
  chainDamageRatesByPip?: Record<string, number>;
  chainRange?: number;
  reviveChance?: number;
  reviveChanceRate?: number;
  maxRevives?: number;
  dontReviveWhenLastOneStanding?: boolean;
  allyExtraAttacks?: number;
  grantAttacksToAlly?: number;
  targetingMode?: 'Nearest' | 'Furthest' | 'Strongest' | 'Weakest' | 'Random';
  statusEffect?: DiceStatusEffect;
  statusDuration?: number;
  maxStacks?: number;
  activeManaNeeded?: number;
  activeAllyExtraAttacks?: number;
  onTransformedExtraAttacks?: number;
  attackDelta?: number;
  activeAttackDelta?: number;
  activeDurationTurns?: number;
  activeMaxStacks?: number;
  poisonDamage?: number;
  poisonDamageRate?: number;
  poisonDamageRatesByPip?: Record<string, number>;
  activeDamageRate?: number;
  activeDamageRatesByPip?: Record<string, number>;
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
  activeDamage?: number;
  activeHeal?: number;
  activeOnlyTargetsAllies?: boolean;
  activeSkillTargeting?: DiceTargetingMode;
  skillTargeting?: DiceTargetingMode;
  canFireWithNoTargets?: boolean;
  meteorDamage?: number;
  meteorCount?: number;
  meteorRandomOrientation?: boolean;
  summonType?: string;
  summonCount?: number;
  summonPattern?: Array<[number, number]>;
  allowSummonedDieToRoll?: boolean;
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
  shield?: number;
  armorShredRate?: number;
  activeStatusEffect?: DiceStatusEffect;
  statusEffects?: DiceStatusEffect[];
  tauntRange?: number;
  lockRange?: number;
  canLockFoes?: boolean;
  canLockAllies?: boolean;
  numLocks?: number;
  teleportRange?: number;
  teleportSkillFireIndex?: number;
  isInfiltrator?: boolean;
  strikeFirst?: boolean;
  attackCountIncrease?: number;
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
  skillRangeThreshold?: number;
  instakill?: boolean;
  bossDamage?: number;
  bossDamageRate?: number;
  bossDamageRatesByPip?: Record<string, number>;
  skillSfxKey?: string;
  activeSkillSfxKey?: string;
  passiveSkillSfxKey?: string;
  attackSfxKey?: string;
  canConjureSouls?: boolean;
  conjureType?: 'ally' | 'enemy' | 'both';
  maxSouls?: number;
  noMaxSouls?: boolean;
  soulBoostPercent?: number;
  onTransformedDurationTurns?: number;
  deuciferOddSiphonRate?: number;
  deuciferEvenDamageRate?: number;
  manaGain?: number;
  allyManaGain?: number;
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


export function getRuntimeSkillMetaForTrigger(definition: DiceDefinition | undefined, trigger: DiceSkillType, skillIndex?: number): DiceSkillRuntimeMeta {
  const validDefinition = getValidDefinition(definition);
  if (skillIndex !== undefined) {
    const selected = validDefinition.skills[skillIndex];
    if (!selected || selected.type !== trigger) return getRuntimeSkillMeta({ ...validDefinition, skills: [] });
    return getRuntimeSkillMeta({ ...validDefinition, skills: [selected] }, trigger === 'Active' ? 0 : undefined);
  }
  const triggerSkills = validDefinition.skills.filter((skill) => skill.type === trigger);
  // A missing trigger must produce neutral metadata. Falling back to the first
  // skill made CombatStart-only modifiers (notably Lock) leak into basic,
  // active, and other trigger paths.
  if (triggerSkills.length === 0) return getRuntimeSkillMeta({ ...validDefinition, skills: [] });
  return getRuntimeSkillMeta({ ...validDefinition, skills: triggerSkills }, undefined, true);
}

export function getRuntimeSkillMeta(definition: DiceDefinition | undefined, activeSkillIndex?: number, includePhaseHooks = false): DiceSkillRuntimeMeta {
  const validDefinition = getValidDefinition(definition);
  // CombatStart and CombatEnd are phase hooks, not ordinary combat-skill
  // metadata. Keeping them out of the default scope prevents opening/end
  // effects from changing attacks, actives, targeting, or passive checks.
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
  const directOddSiphonRate = allModifiers
    .map((modifier) => (modifier as { deuciferOddSiphonRate?: number }).deuciferOddSiphonRate)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const directEvenDamageRate = allModifiers
    .map((modifier) => (modifier as { deuciferEvenDamageRate?: number }).deuciferEvenDamageRate)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const oddSiphonRate = directOddSiphonRate ?? Number(getAnyNoteValue('runtime:deuciferOddSiphon='));
  const evenDamageRate = directEvenDamageRate ?? Number(getAnyNoteValue('runtime:deuciferEvenDamage='));
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
  const lockModifiers = lockModifierCandidates.find((modifier) =>
    (modifier as { lockRange?: number; canLockFoes?: boolean; canLockAllies?: boolean }).lockRange !== undefined
    || (modifier as { canLockFoes?: boolean; canLockAllies?: boolean }).canLockFoes === true
    || (modifier as { canLockFoes?: boolean; canLockAllies?: boolean }).canLockAllies === true
  );
  const getPipRateObject = (key: 'splashDamageRatesByPip' | 'heatwaveDamageRatesByPip' | 'chainDamageRatesByPip' | 'activeDamageRatesByPip' | 'poisonDamageRatesByPip' | 'bossDamageRatesByPip'): Record<string, number> | undefined => {
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
  const activeDamageRatesByPip = getPipRateObject('activeDamageRatesByPip');
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
  const unlockAtClass = getSkillLockClass(selectedActiveSkill ?? primary);
  const criticalModifiers = allModifiers.find((modifier) =>
    (modifier as { criticalChanceIncrease?: number }).criticalChanceIncrease !== undefined
    || (modifier as { criticalDamageIncrease?: number }).criticalDamageIncrease !== undefined
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
    splashDamageRate,
    splashDamageRatesByPip,
    heatwaveDamage,
    heatwaveDamageRate,
    heatwaveDamageRatesByPip,
    chainDamage: allModifiers
      .map((modifier) => (modifier as { chainDamage?: number }).chainDamage)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    chainDamageRate,
    chainDamageRatesByPip,
    reviveChance,
    reviveChanceRate,
    maxRevives,
    dontReviveWhenLastOneStanding,
    allyExtraAttacks: modifiers?.allyExtraAttacks ?? 0,
    grantAttacksToAlly: (() => {
      const value = (modifiers as { grantAttacksToAlly?: unknown } | undefined)?.grantAttacksToAlly;
      return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : undefined;
    })(),
    targetingMode: validDefinition.targetingMode,
    statusEffect: parseStatusEffect((modifiers as { statusEffect?: string } | undefined)?.statusEffect),
    statusDuration: (selectedStatusModifiers as { statusDuration?: number } | undefined)?.statusDuration,
    ...statusDurationProperties,
    maxStacks: (modifiers as { maxStacks?: number } | undefined)?.maxStacks,
    activeManaNeeded: activeSkill ? (activeSkill.manaNeeded ?? 0) : 0,
    activeAllyExtraAttacks: activeSkill ? (activeModifiers?.allyExtraAttacks ?? 0) : 0,
    attackCountIncrease: activeSkill
      ? (activeModifiers?.attackCountIncrease ?? 0)
      : (modifiers?.attackCountIncrease ?? 0),
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
    activeDamageRate: (activeModifiers as { activeDamageRate?: number } | undefined)?.activeDamageRate ?? (modifiers as { activeDamageRate?: number } | undefined)?.activeDamageRate,
    activeDamageRatesByPip: (activeModifiers as { activeDamageRatesByPip?: Record<string, number> } | undefined)?.activeDamageRatesByPip ?? activeDamageRatesByPip,
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
    activeDamage: (activeModifiers as { activeDamage?: number } | undefined)?.activeDamage ?? (modifiers as { activeDamage?: number } | undefined)?.activeDamage,
    activeHeal: (activeModifiers as { activeHeal?: number } | undefined)?.activeHeal ?? (modifiers as { activeHeal?: number } | undefined)?.activeHeal,
    activeOnlyTargetsAllies: Boolean((activeModifiers as { onlyTargetsAllies?: boolean } | undefined)?.onlyTargetsAllies),
    activeSkillTargeting: (activeModifiers as { skillTargeting?: DiceTargetingMode } | undefined)?.skillTargeting,
    skillTargeting: (modifiers as { skillTargeting?: DiceTargetingMode } | undefined)?.skillTargeting,
    canFireWithNoTargets: Boolean(
      (activeModifiers as { canFireWithNoTargets?: boolean } | undefined)?.canFireWithNoTargets === true
      || (modifiers as { canFireWithNoTargets?: boolean } | undefined)?.canFireWithNoTargets === true
    ),
    chainRange: (activeModifiers as { chainRange?: number } | undefined)?.chainRange ?? (modifiers as { chainRange?: number } | undefined)?.chainRange,
    meteorDamage: (activeModifiers as { meteorDamage?: number } | undefined)?.meteorDamage ?? (modifiers as { meteorDamage?: number } | undefined)?.meteorDamage,
    meteorCount: (activeModifiers as { meteorCount?: number } | undefined)?.meteorCount ?? (modifiers as { meteorCount?: number } | undefined)?.meteorCount,
    meteorRandomOrientation: Boolean((activeModifiers as { meteorRandomOrientation?: boolean } | undefined)?.meteorRandomOrientation ?? (modifiers as { meteorRandomOrientation?: boolean } | undefined)?.meteorRandomOrientation),
    lavaDamage: (activeModifiers as { lavaDamage?: number } | undefined)?.lavaDamage ?? (modifiers as { lavaDamage?: number } | undefined)?.lavaDamage,
    lavaPoolPattern: (activeModifiers as { lavaPoolPattern?: Array<[number, number]> } | undefined)?.lavaPoolPattern ?? (modifiers as { lavaPoolPattern?: Array<[number, number]> } | undefined)?.lavaPoolPattern,
    beamDamage: (modifiers as { beamDamage?: number } | undefined)?.beamDamage ?? (Number.isFinite(parsedBeamDamage) ? parsedBeamDamage : undefined),
    hasBeam: Boolean((modifiers as { hasBeam?: boolean } | undefined)?.hasBeam === true),
    pierceBehindRange: (modifiers as { pierceBehindRange?: number } | undefined)?.pierceBehindRange,
    pierceBehindDamage: (activeModifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage ?? (modifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage,
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
    lockRange: (lockModifiers as { lockRange?: number } | undefined)?.lockRange,
    teleportRange: (modifiers as { teleportRange?: number } | undefined)?.teleportRange,
    teleportSkillFireIndex: (() => {
      const value = (modifiers as { teleportSkillFireIndex?: unknown } | undefined)?.teleportSkillFireIndex;
      return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
    })(),
    isInfiltrator: Boolean((modifiers as { isInfiltrator?: boolean } | undefined)?.isInfiltrator === true),
    strikeFirst: Boolean((modifiers as { strikeFirst?: boolean } | undefined)?.strikeFirst === true),
    canLockFoes: Boolean((lockModifiers as { canLockFoes?: boolean } | undefined)?.canLockFoes === true),
    canLockAllies: Boolean((lockModifiers as { canLockAllies?: boolean } | undefined)?.canLockAllies === true),
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
    skillRangeThreshold: (modifiers as { skillRangeThreshold?: number } | undefined)?.skillRangeThreshold,
    instakill: Boolean((activeModifiers as { instakill?: boolean } | undefined)?.instakill ?? (modifiers as { instakill?: boolean } | undefined)?.instakill),
    bossDamage: (activeModifiers as { bossDamage?: number } | undefined)?.bossDamage ?? (modifiers as { bossDamage?: number } | undefined)?.bossDamage,
    bossDamageRate: (activeModifiers as { bossDamageRate?: number } | undefined)?.bossDamageRate ?? (modifiers as { bossDamageRate?: number } | undefined)?.bossDamageRate,
    bossDamageRatesByPip: (activeModifiers as { bossDamageRatesByPip?: Record<string, number> } | undefined)?.bossDamageRatesByPip ?? bossDamageRatesByPip,
    skillSfxKey: (activeModifiers as { skillSfx?: string } | undefined)?.skillSfx ?? (modifiers as { skillSfx?: string } | undefined)?.skillSfx ?? getActiveNoteValue('runtime:skillSfx=') ?? getAnyNoteValue('runtime:skillSfx=') ?? getNoteValue('runtime:skillSfx='),
    activeSkillSfxKey: (activeModifiers as { skillSfx?: string } | undefined)?.skillSfx ?? getActiveNoteValue('runtime:skillSfx='),
    passiveSkillSfxKey: (modifiers as { skillSfx?: string } | undefined)?.skillSfx ?? getNoteValue('runtime:skillSfx='),
    attackSfxKey: (modifiers as { attackSfx?: string } | undefined)?.attackSfx ?? getNoteValue('runtime:attackSfx='),
    canConjureSouls: Boolean((modifiers as { canConjureSouls?: boolean } | undefined)?.canConjureSouls),
    conjureType: ((modifiers as { conjureType?: 'ally' | 'enemy' | 'both' } | undefined)?.conjureType),
    maxSouls: (modifiers as { maxSouls?: number } | undefined)?.maxSouls,
    noMaxSouls: Boolean((modifiers as { noMaxSouls?: boolean } | undefined)?.noMaxSouls),
    soulBoostPercent: (modifiers as { soulBoostPercent?: number } | undefined)?.soulBoostPercent,
    onTransformedExtraAttacks: onTransformedModifiers?.allyExtraAttacks ?? 0,
    onTransformedDurationTurns: onTransformedModifiers?.statusDuration,
    deuciferOddSiphonRate: Number.isFinite(oddSiphonRate) ? oddSiphonRate : undefined,
    deuciferEvenDamageRate: Number.isFinite(evenDamageRate) ? evenDamageRate : undefined,
    summonType: (activeModifiers as { summonType?: string } | undefined)?.summonType ?? (modifiers as { summonType?: string } | undefined)?.summonType,
    summonCount: (activeModifiers as { summonCount?: number } | undefined)?.summonCount ?? (modifiers as { summonCount?: number } | undefined)?.summonCount,
    summonPattern: (activeModifiers as { summonPattern?: Array<[number, number]> } | undefined)?.summonPattern ?? (modifiers as { summonPattern?: Array<[number, number]> } | undefined)?.summonPattern,
    allowSummonedDieToRoll: Boolean((activeModifiers as { allowSummonedDieToRoll?: boolean } | undefined)?.allowSummonedDieToRoll ?? (modifiers as { allowSummonedDieToRoll?: boolean } | undefined)?.allowSummonedDieToRoll),
    manaGain: (activeModifiers as { manaGain?: number } | undefined)?.manaGain ?? (modifiers as { manaGain?: number } | undefined)?.manaGain,
    allyManaGain: (activeModifiers as { allyManaGain?: number } | undefined)?.allyManaGain ?? (modifiers as { allyManaGain?: number } | undefined)?.allyManaGain,
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
    healOnAttack: Boolean(allModifiers.some((modifier) => (modifier as { healOnAttack?: boolean }).healOnAttack === true)),
    transformToNextForm: Boolean(allModifiers.some((modifier) => (modifier as { transformToNextForm?: boolean }).transformToNextForm === true)),
    transformAttackDamage: (modifiers as { transformAttackDamage?: number } | undefined)?.transformAttackDamage,
    deathDamage: (modifiers as { deathDamage?: number } | undefined)?.deathDamage,
    onKillDamage: (modifiers as { onKillDamage?: number } | undefined)?.onKillDamage,
    onHitDamage: (modifiers as { onHitDamage?: number } | undefined)?.onHitDamage,
    combatStartDamage: (modifiers as { combatStartDamage?: number } | undefined)?.combatStartDamage,
    combatEndDamage: (modifiers as { combatEndDamage?: number } | undefined)?.combatEndDamage,
     criticalChanceIncrease: (criticalModifiers as { criticalChanceIncrease?: number } | undefined)?.criticalChanceIncrease,
     criticalDamageIncrease: (criticalModifiers as { criticalDamageIncrease?: number } | undefined)?.criticalDamageIncrease,
    damageRatePerKill: (modifiers as { damageRatePerKill?: number } | undefined)?.damageRatePerKill,
    avoidAttackChance: (modifiers as { avoidAttackChance?: number } | undefined)?.avoidAttackChance,
    missingHealRate: (modifiers as { missingHealRate?: number } | undefined)?.missingHealRate,
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
