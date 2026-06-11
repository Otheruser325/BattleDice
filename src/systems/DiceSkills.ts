import type { DiceDefinition, DiceInstanceState, DiceSkillType, DiceStatusEffect, DiceTargetingMode } from '../types/game';
import { getBoardSideCombatDistance } from './CombatRange';

const STATUS_EFFECTS: DiceStatusEffect[] = ['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk'];

export interface DiceSkillRuntimeMeta {
  randomDamage?: { min: number; max: number };
  targetMaxHpBonusRate?: number;
  targetCurrentHpBonusRate?: number;
  splashDamage?: number;
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
  stunDuration?: number;
  attackCountIncrease?: number;
  hasSpearActive?: boolean;
  hasSolitudePreCombat?: boolean;
  checkForAdjacentAllies?: boolean;
  checkForAdjacentFoes?: boolean;
  hasJudgmentHammer?: boolean;
  hasTranscendence?: boolean;
  hasMeteorStrike?: boolean;
  hasDeathTransform?: boolean;
  hasDeathInstakill?: boolean;
  deathInstakillMana?: number;
  hasGrowthPermanent?: boolean;
  hasBrokenGrowthPermanent?: boolean;
  transformAccent?: string;
  transformSymbol?: string;
  transformTitle?: string;
  alternateButton?: string;
  baseButton?: string;
  skillSfxKey?: string;
  activeSkillSfxKey?: string;
  passiveSkillSfxKey?: string;
  attackSfxKey?: string;
  transformedAttackSfxKey?: string;
  canConjureSouls?: boolean;
  conjureType?: 'ally' | 'enemy' | 'both';
  maxSouls?: number;
  noMaxSouls?: boolean;
  soulBoostPercent?: number;
  hasSoulHarvestPassive?: boolean;
  transformSkillIndex?: number;
  transformSkillIndices?: number[];
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
  leonRageRate?: number;
  isLockedUntilClass6?: boolean;
  disableManaGain?: boolean;
  consumeAttack?: boolean;
  growthDelta?: number;
  brokenGrowthDelta?: number;
}


export function getRuntimeSkillMeta(definition: DiceDefinition): DiceSkillRuntimeMeta {
  const primary = definition.skills[0];
  const modifiers = primary?.modifiers;
  const skillOfType = (type: DiceSkillType) => definition.skills.find((skill) => skill.type === type);
  const activeSkill = skillOfType('Active');
  const activeModifiers = activeSkill?.modifiers;
  const onKillSkill = skillOfType('OnKill');
  const onKillModifiers = onKillSkill?.modifiers;
  const onDamagedSkill = skillOfType('OnDamaged');
  const onDamagedModifiers = onDamagedSkill?.modifiers;
  const onDeathSkill = skillOfType('OnDeath');
  const onDeathModifiers = onDeathSkill?.modifiers;
  const onTransformedSkill = skillOfType('OnTransformed');
  const onTransformedModifiers = onTransformedSkill?.modifiers;
  const allModifiers = definition.skills.map((skill) => skill.modifiers).filter((modifier): modifier is NonNullable<typeof modifier> => Boolean(modifier));
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
  const transformSkillIndices = (() => {
    const explicit = (modifiers as { transformSkillIndices?: number[] } | undefined)?.transformSkillIndices;
    if (Array.isArray(explicit)) {
      return explicit.filter((index) => Number.isInteger(index) && index >= 0);
    }
    const single = (modifiers as { transformSkillIndex?: number } | undefined)?.transformSkillIndex;
    return Number.isInteger(single) && single >= 0 ? [single] : [];
  })();
  const tauntModifiers = allModifiers.find((modifier) =>
    parseStatusEffect((modifier as { statusEffect?: string }).statusEffect) === 'taunt'
    || (modifier.notes ?? []).includes('runtime:shieldTaunt'));
  const stunModifiers = allModifiers.find((modifier) =>
    parseStatusEffect((modifier as { statusEffect?: string }).statusEffect) === 'stun'
    || (modifier.notes ?? []).includes('runtime:stun'));

  return {
    randomDamage: range ? { min: range[0], max: range[1] } : undefined,
    targetMaxHpBonusRate: explicitRate ?? (Number.isFinite(parsedRate) ? parsedRate : undefined),
    targetCurrentHpBonusRate: explicitCurrentRate ?? (Number.isFinite(parsedCurrentRate) ? parsedCurrentRate : undefined),
    splashDamage: modifiers?.splashDamage,
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
    stunDuration: (stunModifiers as { durationTurns?: number } | undefined)?.durationTurns,
    hasSpearActive: Boolean((activeModifiers as { pierceBehindDamage?: number } | undefined)?.pierceBehindDamage !== undefined || notes.includes('runtime:spearActive') || (activeModifiers?.notes ?? []).includes('runtime:spearActive')),
    hasSolitudePreCombat: Boolean((modifiers as { checkForAdjacentAllies?: boolean } | undefined)?.checkForAdjacentAllies ?? notes.includes('runtime:solitudePreCombat')),
    checkForAdjacentAllies: Boolean((modifiers as { checkForAdjacentAllies?: boolean } | undefined)?.checkForAdjacentAllies ?? notes.includes('runtime:solitudePreCombat')),
    checkForAdjacentFoes: Boolean((modifiers as { checkForAdjacentFoes?: boolean } | undefined)?.checkForAdjacentFoes),
    hasJudgmentHammer: notes.includes('runtime:judgmentHammer'),
    hasTranscendence: notes.includes('runtime:hasTranscendence') || definition.typeId === 'Transcendence',
    hasMeteorStrike: Boolean(allModifiers.some((modifier) => (modifier as { meteorDamage?: number }).meteorDamage !== undefined) || allNotes.includes('runtime:meteorStrike')),
    hasDeathTransform: Boolean((modifiers as { deathTransform?: boolean } | undefined)?.deathTransform ?? notes.includes('runtime:deathTransform')),
    hasDeathInstakill,
    deathInstakillMana: hasDeathInstakill ? (activeSkill?.manaNeeded ?? primary?.manaNeeded ?? 12) : undefined,
    hasGrowthPermanent: modifiers?.growthDelta !== undefined || notes.includes('runtime:growthPermanent'),
    hasBrokenGrowthPermanent: modifiers?.brokenGrowthDelta !== undefined || notes.includes('runtime:brokenGrowthPermanent'),
    growthDelta: modifiers?.growthDelta,
    brokenGrowthDelta: modifiers?.brokenGrowthDelta,
    transformAccent: (modifiers as { transformAccent?: string } | undefined)?.transformAccent ?? getNoteValue('runtime:transformAccent='),
    transformSymbol: (modifiers as { transformSymbol?: string } | undefined)?.transformSymbol ?? getNoteValue('runtime:transformSymbol='),
    transformTitle: (modifiers as { transformTitle?: string } | undefined)?.transformTitle ?? getNoteValue('runtime:transformTitle='),
    alternateButton: (modifiers as { alternateButton?: string } | undefined)?.alternateButton ?? getNoteValue('runtime:alternateButton='),
    baseButton: (modifiers as { baseButton?: string } | undefined)?.baseButton ?? getNoteValue('runtime:baseButton='),
    skillSfxKey: (activeModifiers as { skillSfx?: string } | undefined)?.skillSfx ?? (modifiers as { skillSfx?: string } | undefined)?.skillSfx ?? getActiveNoteValue('runtime:skillSfx=') ?? getAnyNoteValue('runtime:skillSfx=') ?? getNoteValue('runtime:skillSfx='),
    activeSkillSfxKey: (activeModifiers as { skillSfx?: string } | undefined)?.skillSfx ?? getActiveNoteValue('runtime:skillSfx='),
    passiveSkillSfxKey: (modifiers as { skillSfx?: string } | undefined)?.skillSfx ?? getNoteValue('runtime:skillSfx='),
    attackSfxKey: (modifiers as { attackSfx?: string } | undefined)?.attackSfx ?? getNoteValue('runtime:attackSfx='),
    transformedAttackSfxKey: (modifiers as { transformedAttackSfx?: string } | undefined)?.transformedAttackSfx ?? getNoteValue('runtime:attackSfxTransformed='),
    canConjureSouls: Boolean((modifiers as { canConjureSouls?: boolean } | undefined)?.canConjureSouls),
    conjureType: ((modifiers as { conjureType?: 'ally' | 'enemy' | 'both' } | undefined)?.conjureType),
    maxSouls: (modifiers as { maxSouls?: number } | undefined)?.maxSouls,
    noMaxSouls: Boolean((modifiers as { noMaxSouls?: boolean } | undefined)?.noMaxSouls),
    soulBoostPercent: (modifiers as { soulBoostPercent?: number } | undefined)?.soulBoostPercent,
    hasSoulHarvestPassive: Boolean((modifiers as { soulBoostPercent?: number } | undefined)?.soulBoostPercent !== undefined || notes.includes('runtime:soulHarvestPassive')),
    transformSkillIndex: transformSkillIndices[0],
    transformSkillIndices,
    onTransformedExtraAttacks: onTransformedModifiers?.extraAttacks ?? 0,
    onTransformedDurationTurns: onTransformedModifiers?.durationTurns,
    deuciferOddSiphonRate: Number.isFinite(oddSiphonRate) ? oddSiphonRate : undefined,
    deuciferEvenDamageRate: Number.isFinite(evenDamageRate) ? evenDamageRate : undefined,
    canSummonImp: allNotes.includes('runtime:deuciferSummonImp'),
    manaSteal: allNotes.includes('runtime:manaManipulator') ? ((modifiers as { attackDelta?: number } | undefined)?.attackDelta ?? 1) : undefined,
    spellcastManaGain: allNotes.includes('runtime:wizardSpellcast') ? ((modifiers as { manaGain?: number } | undefined)?.manaGain ?? 2) : undefined,
    canSummonWizard: allNotes.includes('runtime:magicianSummonWizard'),
    hasLeonFuriousClaw: allNotes.includes('runtime:leonFuriousClaw'),
    hasLeonMightyRoar: allNotes.includes('runtime:leonMightyRoar'),
    hasLeonRage: allNotes.includes('runtime:leonRage'),
    leonRageRate: allNotes.includes('runtime:leonRage') ? ((modifiers as { targetMaxHpBonusRate?: number } | undefined)?.targetMaxHpBonusRate ?? 0.2) : undefined,
    isLockedUntilClass6: allNotes.includes('runtime:unlockAtClass6'),
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
