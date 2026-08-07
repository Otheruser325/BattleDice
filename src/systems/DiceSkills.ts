import type { DiceDefinition, DiceInstanceState, DiceSkillDefinition, DiceSkillType, DiceStatusEffect, DiceTargetingMode } from '../types/game';
import { getBoardSideCombatDistance } from './CombatRange';

const STATUS_EFFECTS: DiceStatusEffect[] = ['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk'];

export interface DiceSkillRuntimeMeta {
  transformFlags: string[];
  [key: `has${string}`]: boolean | undefined;
  randomDamage?: { min: number; max: number };
  targetMaxHpBonusRate?: number;
  targetCurrentHpBonusRate?: number;
  lowHpThresholdRate?: number;
  lowHpDamageBonusRate?: number;
  splashDamage?: number;
  splashDamageRatesByOddPip?: [number, number, number];
  heatwaveDamageRate?: number;
  chainDamage?: number;
  reviveChance?: number;
  combatStartExtraAttacks?: number;
  combatEndExtraAttacks?: number;
  targetingMode?: 'Nearest' | 'Furthest' | 'Strongest' | 'Weakest' | 'Random';
  activeManaNeeded?: number;
  activeExtraAttacks?: number;
  activeAttackDelta?: number;
  activeDurationTurns?: number;
  activeMaxStacks?: number;
  poisonDamage?: number;
  onKillExtraAttacks?: number;
  onDamagedExtraAttacks?: number;
  onDamagedGrantAttacksToAlly?: boolean;
  onDeathExtraAttacks?: number;
  onDeathGrantAttacksToAlly?: boolean;
  distanceDamageBonusPerTile?: number;
  distanceDamageBonusRatePerTile?: number;
  berserkThresholdRate?: number;
  berserkDamageMultiplier?: number;
  pipMatchAllyAttackDelta?: number;
  pipMatchFoeAttackDelta?: number;
  activeDamage?: number;
  activeHeal?: number;
  activeOnlyTargetsAllies?: boolean;
  activeSkillTargeting?: DiceTargetingMode;
  meteorDamage?: number;
  meteorCount?: number;
  hasRandomOrientation?: boolean;
  lavaDamage?: number;
  lavaPoolPattern?: Array<[number, number]>;
  beamDamage?: number;
  pierceBehindRange?: number;
  activePierceBehindRange?: number;
  pierceBehindDamage?: number;
  hammerDamage?: number;
  shield?: number;
  armorShredRate?: number;
  activeStatusEffect?: DiceStatusEffect;
  statusEffects?: DiceStatusEffect[];
  tauntRange?: number;
  tauntDuration?: number;
  lockRange?: number;
  stunDuration?: number;
  attackCountIncrease?: number;
  hasSpearActive?: boolean;
  hasSolitudePreCombat?: boolean;
  checkForAdjacentAllies?: boolean;
  checkForAdjacentFoes?: boolean;
  hasJudgmentHammer?: boolean;
  hasMeteorStrike?: boolean;
  transformSoulCount?: number;
  transformPipCount?: number;
  transformOnOddPip?: boolean;
  transformOnEvenPip?: boolean;
  hasDeathInstakill?: boolean;
  deathInstakillMana?: number;
  hasGrowthPermanent?: boolean;
  hasBrokenGrowthPermanent?: boolean;
  skillSfxKey?: string;
  activeSkillSfxKey?: string;
  passiveSkillSfxKey?: string;
  attackSfxKey?: string;
  canConjureSouls?: boolean;
  conjureType?: 'ally' | 'enemy' | 'both';
  maxSouls?: number;
  noMaxSouls?: boolean;
  soulBoostPercent?: number;
  hasSoulHarvestPassive?: boolean;
  onTransformedExtraAttacks?: number;
  onTransformedDurationTurns?: number;
  deuciferOddSiphonRate?: number;
  deuciferEvenDamageRate?: number;
  canSummonImp?: boolean;
  manaSteal?: number;
  spellcastManaGain?: number;
  canSummonWizard?: boolean;
  hasLeonFuriousClaw?: boolean;
  hasLeonMightyRoar?: boolean;
  hasLeonRage?: boolean;
  leonRageRate?: number;
  isLockedUntilClass?: number;
  disableManaGain?: boolean;
  consumeAttack?: boolean;
  hitsAllFoes?: boolean;
  hitsAllAllies?: boolean;
  ricochetCount?: number;
  ricochetRange?: number;
  healOnAttack?: boolean;
  transformToNextForm?: boolean;
  transformAttackDamage?: number;
  criticalChanceIncrease?: number;
  criticalDamageIncrease?: number;
  damageRatePerKill?: number;
  avoidAttackChance?: number;
  onKillMissingHealRate?: number;
  revengeThresholdRate?: number;
  revengeHits?: number;
  revengeDamage?: number;
  growthDelta?: number;
  brokenGrowthDelta?: number;
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
    ? definition.skills
    : definition.transformStats?.[transformIndex]?.skills ?? [];
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

function getAvailableTransformIndices(definition: DiceDefinition): number[] {
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

export function getPipTriggeredTransformIndex(definition: DiceDefinition, pips: number, currentIndex = -1): number | undefined {
  const available = getAvailableTransformIndices(definition);
  if (available.length === 0 || pips <= 0) return undefined;

  if (currentIndex < 0) {
    const baseTrigger = getTransformPipTrigger(definition);
    const firstStage = available[0];
    const initialTriggerMatches = baseTrigger
      ? matchesTransformPipTrigger(definition, pips)
      : firstStage !== undefined && matchesTransformPipTrigger(definition, pips, firstStage);
    return initialTriggerMatches ? firstStage : undefined;
  }

  if (!getTransformPipTrigger(definition, currentIndex) || !matchesTransformPipTrigger(definition, pips, currentIndex)) return undefined;
  const next = available.find((index) => index > currentIndex);
  return next ?? available[available.length - 1] ?? currentIndex;
}

export function getSkillLockClass(skill: DiceSkillDefinition): number | undefined {
  const note = skill.modifiers?.notes?.find((value) => {
    const match = value.match(/^runtime:(?:unlockAtClass|isLockedUntilClassX?)(?:=)?(\d+)$/);
    if (!match) return false;
    const level = Number(match[1]);
    return Number.isInteger(level) && level >= 1 && level <= 15;
  });
  if (!note) return undefined;
  const match = note.match(/^runtime:(?:unlockAtClass|isLockedUntilClassX?)(?:=)?(\d+)$/);
  const level = match ? Number(match[1]) : NaN;
  return Number.isInteger(level) && level >= 1 && level <= 15 ? level : undefined;
}


export function getRuntimeSkillMeta(definition: DiceDefinition, activeSkillIndex?: number): DiceSkillRuntimeMeta {
  const primary = definition.skills[0];
  const modifiers = primary?.modifiers;
  const skillOfType = (type: DiceSkillType) => definition.skills.find((skill) => skill.type === type);
  const selectedActiveSkill = activeSkillIndex === undefined || definition.skills[activeSkillIndex]?.type !== 'Active'
    ? undefined
    : definition.skills[activeSkillIndex];
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
    ? definition.skills.filter((skill, index) => skill.type !== 'Active' || index === activeSkillIndex)
    : definition.skills;
  const allModifiers = runtimeSkills.map((skill) => skill.modifiers).filter((modifier): modifier is NonNullable<typeof modifier> => Boolean(modifier));
  const sumModifier = (key: 'pipMatchAllyAttackDelta' | 'pipMatchFoeAttackDelta') => {
    const sum = allModifiers.reduce((total, modifier) => total + ((modifier as Record<typeof key, number | undefined>)[key] ?? 0), 0);
    return sum === 0 ? undefined : sum;
  };
  const range = (modifiers as { damageRange?: [number, number] } | undefined)?.damageRange;
  const reviveChance = (modifiers as { reviveChance?: number } | undefined)?.reviveChance;
  const notes = modifiers?.notes ?? [];
  const explicitRate = (modifiers as { targetMaxHpBonusRate?: number } | undefined)?.targetMaxHpBonusRate;
  const explicitCurrentRate = (modifiers as { targetCurrentHpBonusRate?: number } | undefined)?.targetCurrentHpBonusRate;
  const rateNote = notes.find((note) => note.startsWith('runtime:targetMaxHpBonusRate='));
  const parsedRate = rateNote ? Number(rateNote.split('=')[1]) : undefined;
  const currentRateNote = notes.find((note) => note.startsWith('runtime:targetCurrentHpBonusRate='));
  const parsedCurrentRate = currentRateNote ? Number(currentRateNote.split('=')[1]) : undefined;
  const beamNote = notes.find((note) => note.startsWith('runtime:beamOnSix='));
  const parsedBeamDamage = beamNote ? Number(beamNote.split('=')[1]) : undefined;

  const getNoteValue = (prefix: string) => notes.find((note) => note.startsWith(prefix))?.slice(prefix.length);
  const allNotes = allModifiers.flatMap((modifier) => modifier.notes ?? []);
  const getActiveNoteValue = (prefix: string) => activeModifiers?.notes?.find((note) => note.startsWith(prefix))?.slice(prefix.length);
  const hasDeathInstakill = Boolean(allModifiers.some((modifier) => (modifier as { deathInstakill?: boolean }).deathInstakill) || allNotes.includes('runtime:deathInstakill'));
  const getAnyNoteValue = (prefix: string) => allNotes.find((note) => note.startsWith(prefix))?.slice(prefix.length);
  const oddSiphonRate = Number(getAnyNoteValue('runtime:deuciferOddSiphon='));
  const evenDamageRate = Number(getAnyNoteValue('runtime:deuciferEvenDamage='));
  const parseStatusEffect = (value: unknown): DiceStatusEffect | undefined => {
    if (typeof value !== 'string') return undefined;
    return STATUS_EFFECTS.includes(value as DiceStatusEffect) ? value as DiceStatusEffect : undefined;
  };
  const activeStatusEffectNote = getActiveNoteValue('runtime:statusEffect=') ?? getActiveNoteValue('runtime:status=');
  const activeStatusEffect = parseStatusEffect((activeModifiers as { statusEffect?: string } | undefined)?.statusEffect)
    ?? parseStatusEffect(activeStatusEffectNote);
  const statusNoteEffects = allNotes
    .map((note) => note.startsWith('runtime:statusEffect=') ? note.slice('runtime:statusEffect='.length) : note.startsWith('runtime:status=') ? note.slice('runtime:status='.length) : undefined)
    .map(parseStatusEffect)
    .filter((effect): effect is DiceStatusEffect => Boolean(effect));
  const statusEffects = [...new Set(allModifiers
    .map((modifier) => parseStatusEffect((modifier as { statusEffect?: string }).statusEffect))
    .filter((effect): effect is DiceStatusEffect => Boolean(effect))
    .concat(statusNoteEffects))];
  const tauntModifiers = allModifiers.find((modifier) =>
    parseStatusEffect((modifier as { statusEffect?: string }).statusEffect) === 'taunt'
    || (modifier.notes ?? []).includes('runtime:shieldTaunt'));
  const stunModifiers = allModifiers.find((modifier) =>
    parseStatusEffect((modifier as { statusEffect?: string }).statusEffect) === 'stun'
    || (modifier.notes ?? []).includes('runtime:stun'));
  const lockModifiers = allModifiers.find((modifier) => (modifier as { lockRange?: number }).lockRange !== undefined);
  const splashDamageRatesByOddPip = allModifiers
    .map((modifier) => (modifier as { splashDamageRatesByOddPip?: [number, number, number] }).splashDamageRatesByOddPip)
    .find((rates): rates is [number, number, number] => Array.isArray(rates) && rates.length === 3 && rates.every((rate) => typeof rate === 'number' && Number.isFinite(rate)));
  const heatwaveDamageRate = allModifiers
    .map((modifier) => (modifier as { heatwaveDamageRate?: number }).heatwaveDamageRate)
    .find((rate): rate is number => typeof rate === 'number' && Number.isFinite(rate));
  const isLockedUntilClass = getSkillLockClass(selectedActiveSkill ?? primary);
  const criticalModifiers = allModifiers.find((modifier) =>
    (modifier as { criticalChanceIncrease?: number }).criticalChanceIncrease !== undefined
    || (modifier as { criticalDamageIncrease?: number }).criticalDamageIncrease !== undefined
  ) ?? modifiers;

  const transformFlags = [...(definition.transformFlags ?? [])];
  const generatedTransformBooleans = Object.fromEntries(
    transformFlags.map((flag) => [getTransformFlagName(flag), true])
  ) as Record<string, boolean>;

  return {
    transformFlags,
    ...generatedTransformBooleans,
    randomDamage: range ? { min: range[0], max: range[1] } : undefined,
    targetMaxHpBonusRate: explicitRate ?? (Number.isFinite(parsedRate) ? parsedRate : undefined),
    targetCurrentHpBonusRate: explicitCurrentRate ?? (Number.isFinite(parsedCurrentRate) ? parsedCurrentRate : undefined),
    lowHpThresholdRate: (modifiers as { lowHpThresholdRate?: number } | undefined)?.lowHpThresholdRate,
    lowHpDamageBonusRate: (modifiers as { lowHpDamageBonusRate?: number } | undefined)?.lowHpDamageBonusRate,
    splashDamage: modifiers?.splashDamage,
    splashDamageRatesByOddPip,
    heatwaveDamageRate,
    chainDamage: modifiers?.chainDamage,
    reviveChance,
    combatStartExtraAttacks: primary?.type === 'CombatStart' ? (modifiers?.allyExtraAttacks ?? modifiers?.extraAttacks ?? 0) : 0,
    combatEndExtraAttacks: primary?.type === 'CombatEnd' && modifiers?.growthDelta === undefined && modifiers?.brokenGrowthDelta === undefined && !notes.includes('runtime:growthPermanent') ? (modifiers?.extraAttacks ?? 0) : 0,
    targetingMode: definition.targetingMode,
    activeManaNeeded: activeSkill ? (activeSkill.manaNeeded ?? 0) : 0,
    activeExtraAttacks: activeSkill ? (activeModifiers?.extraAttacks ?? 0) : 0,
    attackCountIncrease: activeSkill ? (activeModifiers?.attackCountIncrease ?? 0) : 0,
    activeAttackDelta: activeSkill ? (activeModifiers?.attackDelta ?? 0) : 0,
    activeDurationTurns: activeSkill ? (activeModifiers?.durationTurns ?? 0) : 0,
    activeMaxStacks: activeSkill ? (activeModifiers?.maxStacks ?? 1) : 1,
    poisonDamage: (activeModifiers as { poisonDamage?: number } | undefined)?.poisonDamage ?? (modifiers as { poisonDamage?: number } | undefined)?.poisonDamage,
    onKillExtraAttacks: onKillModifiers?.extraAttacks ?? 0,
    onDamagedExtraAttacks: onDamagedModifiers?.extraAttacks ?? 0,
    onDamagedGrantAttacksToAlly: Boolean((onDamagedModifiers as { grantAttacksToAlly?: boolean } | undefined)?.grantAttacksToAlly),
    onDeathExtraAttacks: onDeathModifiers?.extraAttacks ?? 0,
    onDeathGrantAttacksToAlly: Boolean((onDeathModifiers as { grantAttacksToAlly?: boolean } | undefined)?.grantAttacksToAlly),
    distanceDamageBonusPerTile: (modifiers as { distanceDamageBonusPerTile?: number } | undefined)?.distanceDamageBonusPerTile,
    distanceDamageBonusRatePerTile: (modifiers as { distanceDamageBonusRatePerTile?: number } | undefined)?.distanceDamageBonusRatePerTile,
    berserkThresholdRate: (modifiers as { berserkThresholdRate?: number } | undefined)?.berserkThresholdRate,
    berserkDamageMultiplier: (modifiers as { berserkDamageMultiplier?: number } | undefined)?.berserkDamageMultiplier,
    pipMatchAllyAttackDelta: sumModifier('pipMatchAllyAttackDelta'),
    pipMatchFoeAttackDelta: sumModifier('pipMatchFoeAttackDelta'),
    activeDamage: (activeModifiers as { activeDamage?: number } | undefined)?.activeDamage ?? (modifiers as { activeDamage?: number } | undefined)?.activeDamage,
    activeHeal: (activeModifiers as { activeHeal?: number } | undefined)?.activeHeal ?? (modifiers as { activeHeal?: number } | undefined)?.activeHeal,
    activeOnlyTargetsAllies: Boolean((activeModifiers as { onlyTargetsAllies?: boolean } | undefined)?.onlyTargetsAllies),
    activeSkillTargeting: (activeModifiers as { skillTargeting?: DiceTargetingMode } | undefined)?.skillTargeting,
    meteorDamage: (activeModifiers as { meteorDamage?: number } | undefined)?.meteorDamage ?? (modifiers as { meteorDamage?: number } | undefined)?.meteorDamage,
    meteorCount: (activeModifiers as { meteorCount?: number } | undefined)?.meteorCount ?? (modifiers as { meteorCount?: number } | undefined)?.meteorCount,
    hasRandomOrientation: Boolean((activeModifiers as { hasRandomOrientation?: boolean } | undefined)?.hasRandomOrientation ?? (modifiers as { hasRandomOrientation?: boolean } | undefined)?.hasRandomOrientation),
    lavaDamage: (activeModifiers as { lavaDamage?: number } | undefined)?.lavaDamage ?? (modifiers as { lavaDamage?: number } | undefined)?.lavaDamage,
    lavaPoolPattern: (activeModifiers as { lavaPoolPattern?: Array<[number, number]> } | undefined)?.lavaPoolPattern ?? (modifiers as { lavaPoolPattern?: Array<[number, number]> } | undefined)?.lavaPoolPattern,
    beamDamage: (modifiers as { beamDamage?: number } | undefined)?.beamDamage ?? (Number.isFinite(parsedBeamDamage) ? parsedBeamDamage : undefined),
    pierceBehindRange: (modifiers as { pierceBehindRange?: number } | undefined)?.pierceBehindRange,
    activePierceBehindRange: (activeModifiers as { pierceBehindRange?: number } | undefined)?.pierceBehindRange,
    pierceBehindDamage: (activeModifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage ?? (modifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage,
    hammerDamage: (modifiers as { hammerDamage?: number } | undefined)?.hammerDamage,
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
    tauntDuration: (tauntModifiers as { tauntDuration?: number; durationTurns?: number } | undefined)?.tauntDuration ?? (tauntModifiers as { durationTurns?: number } | undefined)?.durationTurns,
    lockRange: (lockModifiers as { lockRange?: number } | undefined)?.lockRange,
    stunDuration: (stunModifiers as { durationTurns?: number } | undefined)?.durationTurns,
    hasSpearActive: Boolean((activeModifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage !== undefined || notes.includes('runtime:spearActive') || (activeModifiers?.notes ?? []).includes('runtime:spearActive')),
    hasSolitudePreCombat: Boolean((modifiers as { checkForAdjacentAllies?: boolean } | undefined)?.checkForAdjacentAllies ?? notes.includes('runtime:solitudePreCombat')),
    checkForAdjacentAllies: Boolean((modifiers as { checkForAdjacentAllies?: boolean } | undefined)?.checkForAdjacentAllies ?? notes.includes('runtime:solitudePreCombat')),
    checkForAdjacentFoes: Boolean((modifiers as { checkForAdjacentFoes?: boolean } | undefined)?.checkForAdjacentFoes),
    hasJudgmentHammer: notes.includes('runtime:judgmentHammer'),
    hasMeteorStrike: Boolean(allModifiers.some((modifier) => (modifier as { meteorDamage?: number }).meteorDamage !== undefined) || allNotes.includes('runtime:meteorStrike')),
    transformSoulCount: allModifiers
      .map((modifier) => (modifier as { transformSoulCount?: number }).transformSoulCount)
      .find((value): value is number => typeof value === 'number' && Number.isFinite(value)),
    transformPipCount: allModifiers
      .map((modifier) => (modifier as { transformPipCount?: number }).transformPipCount)
      .find((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6),
    transformOnOddPip: Boolean((modifiers as { transformOnOddPip?: boolean } | undefined)?.transformOnOddPip),
    transformOnEvenPip: Boolean((modifiers as { transformOnEvenPip?: boolean } | undefined)?.transformOnEvenPip),
    hasDeathInstakill,
    deathInstakillMana: hasDeathInstakill ? (activeSkill?.manaNeeded ?? primary?.manaNeeded ?? 12) : undefined,
    hasGrowthPermanent: modifiers?.growthDelta !== undefined || notes.includes('runtime:growthPermanent'),
    hasBrokenGrowthPermanent: modifiers?.brokenGrowthDelta !== undefined || notes.includes('runtime:brokenGrowthPermanent'),
    growthDelta: modifiers?.growthDelta,
    brokenGrowthDelta: modifiers?.brokenGrowthDelta,
    skillSfxKey: (activeModifiers as { skillSfx?: string } | undefined)?.skillSfx ?? (modifiers as { skillSfx?: string } | undefined)?.skillSfx ?? getActiveNoteValue('runtime:skillSfx=') ?? getAnyNoteValue('runtime:skillSfx=') ?? getNoteValue('runtime:skillSfx='),
    activeSkillSfxKey: (activeModifiers as { skillSfx?: string } | undefined)?.skillSfx ?? getActiveNoteValue('runtime:skillSfx='),
    passiveSkillSfxKey: (modifiers as { skillSfx?: string } | undefined)?.skillSfx ?? getNoteValue('runtime:skillSfx='),
    attackSfxKey: (modifiers as { attackSfx?: string } | undefined)?.attackSfx ?? getNoteValue('runtime:attackSfx='),
    canConjureSouls: Boolean((modifiers as { canConjureSouls?: boolean } | undefined)?.canConjureSouls),
    conjureType: ((modifiers as { conjureType?: 'ally' | 'enemy' | 'both' } | undefined)?.conjureType),
    maxSouls: (modifiers as { maxSouls?: number } | undefined)?.maxSouls,
    noMaxSouls: Boolean((modifiers as { noMaxSouls?: boolean } | undefined)?.noMaxSouls),
    soulBoostPercent: (modifiers as { soulBoostPercent?: number } | undefined)?.soulBoostPercent,
    hasSoulHarvestPassive: Boolean((modifiers as { soulBoostPercent?: number } | undefined)?.soulBoostPercent !== undefined || notes.includes('runtime:soulHarvestPassive')),
    onTransformedExtraAttacks: onTransformedModifiers?.extraAttacks ?? 0,
    onTransformedDurationTurns: onTransformedModifiers?.durationTurns,
    deuciferOddSiphonRate: Number.isFinite(oddSiphonRate) ? oddSiphonRate : undefined,
    deuciferEvenDamageRate: Number.isFinite(evenDamageRate) ? evenDamageRate : undefined,
    canSummonImp: allNotes.includes('runtime:deuciferSummonImp'),
    manaSteal: allNotes.includes('runtime:manaManipulator') ? ((modifiers as { attackDelta?: number } | undefined)?.attackDelta ?? 1) : undefined,
    spellcastManaGain: allNotes.includes('runtime:wizardSpellcast') ? ((modifiers as { manaGain?: number } | undefined)?.manaGain ?? 2) : undefined,
    canSummonWizard: allNotes.includes('runtime:magicianSummonWizard'),
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
     criticalChanceIncrease: (criticalModifiers as { criticalChanceIncrease?: number } | undefined)?.criticalChanceIncrease,
     criticalDamageIncrease: (criticalModifiers as { criticalDamageIncrease?: number } | undefined)?.criticalDamageIncrease,
    damageRatePerKill: (modifiers as { damageRatePerKill?: number } | undefined)?.damageRatePerKill,
    avoidAttackChance: (modifiers as { avoidAttackChance?: number } | undefined)?.avoidAttackChance,
    onKillMissingHealRate: (modifiers as { onKillMissingHealRate?: number } | undefined)?.onKillMissingHealRate,
    revengeThresholdRate: (modifiers as { revengeThresholdRate?: number } | undefined)?.revengeThresholdRate,
    revengeHits: (modifiers as { revengeHits?: number } | undefined)?.revengeHits,
    revengeDamage: (modifiers as { revengeDamage?: number } | undefined)?.revengeDamage,
    hasLeonFuriousClaw: allNotes.includes('runtime:leonFuriousClaw'),
    hasLeonMightyRoar: allNotes.includes('runtime:leonMightyRoar'),
    hasLeonRage: allNotes.includes('runtime:leonRage'),
    leonRageRate: allNotes.includes('runtime:leonRage') ? ((modifiers as { damageRatePerKill?: number } | undefined)?.damageRatePerKill ?? 0.2) : undefined,
     isLockedUntilClass,
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
    damage = Math.floor(Math.random() * (max - min + 1)) + min;
  }
  if (meta.targetMaxHpBonusRate && !meta.hasSolitudePreCombat) {
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
