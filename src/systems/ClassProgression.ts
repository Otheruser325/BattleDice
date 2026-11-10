import type { DiceDefinition, DicePoolDefinition, DiceSkillClassBenefits, DiceSkillDefinition, DiceSkillModifier, DiceTalentDefinition, DiceTransformStats } from '../types/game';
import { mergeSkillsByIndex } from './SkillOverlay';
import { formatCompact, formatPercent as formatPercentValue } from '../utils/FormatManager';

export function getTransformStats(definition: DiceDefinition, transformIndex = 0): DiceTransformStats | undefined {
  return definition.transformStats?.[transformIndex];
}

export function getTransformRecoveryRate(definition: DiceDefinition, transformIndex = 0): number | undefined {
  const rate = getTransformStats(definition, transformIndex)?.recoveryRate;
  return typeof rate === 'number' && Number.isFinite(rate) ? Math.max(0, Math.min(1, rate)) : undefined;
}

export function resolveStatMultiplier(multiplier: number | undefined): number {
  return typeof multiplier === 'number' && Number.isFinite(multiplier) ? multiplier : 1;
}

export function resolveStatValue(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function scaleStatValue(base: number | undefined, fallback: number, multiplier: number | undefined): number {
  return Math.max(1, Math.round(resolveStatValue(base, fallback) * resolveStatMultiplier(multiplier)));
}

export function applyStatModifiers(base: number | undefined, fallback: number, delta: number | undefined, multiplier: number | undefined): number {
  const resolvedBase = resolveStatValue(base, fallback);
  const resolvedDelta = typeof delta === 'number' && Number.isFinite(delta) ? delta : 0;
  return Math.max(1, Math.round((resolvedBase + resolvedDelta) * resolveStatMultiplier(multiplier)));
}

export const MAX_CLASS_LEVEL = 15;
export const CLASS_UP_STAT_MULTIPLIER = 1.1;
export const BOSS_CLASS_STAT_MULTIPLIER = 1.2;

const DAMAGE_SCALING_KEYS = [
  'splashDamage',
  'heatwaveDamage',
  'chainDamage',
  'poisonDamage',
  'skillDamage',
  'skillHealing',
  'meteorDamage',
  'nuclearDamage',
  'beamDamage',
  'pierceBehindDamage',
  'hammerDamage',
  'bossDamage',
  'revengeDamage',
  'shield',
  'damageRange'
] as const satisfies ReadonlyArray<keyof DiceSkillModifier>;

const DAMAGE_SCALING_KEY_SET = new Set<string>(DAMAGE_SCALING_KEYS);

const PERCENT_MODIFIER_KEYS = new Set<string>([
  'reviveChance',
  'targetMaxHpBonusRate',
  'targetCurrentHpBonusRate',
  'lowHpThresholdRate',
  'lowHpDamageBonusRate',
  'berserkThresholdRate',
  'distanceDamageBonusRatePerTile',
  'bonusDamagePerStatus',
  'soulBoostPercent',
  'armorReduction',
  'avoidAttackChance',
  'missingHealRate',
  'revengeThresholdRate',
  'criticalChanceIncrease',
  'criticalDamageIncrease',
  'damageRatePerKill',
  'growthChance',
  'plaguedDieHealth',
  'reviveHealth',
  'reviveAttack',
  'oddPipSiphonRate',
  'evenPipSiphonRate',
  'evenPipDamageRate',
  'oddPipDamageRate',
  'splashDamageRate',
  'heatwaveDamageRate',
  'chainDamageRate',
  'poisonDamageRate',
  'skillDamageRate'
]);

type ClassBenefitPreview = { label: string; suffix?: string; percent?: boolean };

const DAMAGE_PREVIEW_LABELS: Record<string, string> = {
  splashDamage: 'Splash damage',
  heatwaveDamage: 'Heatwave damage',
  chainDamage: 'Chain damage',
  poisonDamage: 'Poison damage',
  skillDamage: 'Skill damage',
  skillHealing: 'Skill healing',
  meteorDamage: 'Meteor damage',
  nuclearDamage: 'Nuclear damage',
  beamDamage: 'Beam damage',
  pierceBehindDamage: 'Pierce damage',
  hammerDamage: 'Hammer damage',
  bossDamage: 'Boss damage',
  revengeDamage: 'Revenge damage',
  shield: 'Shield gain',
};

const CLASS_BENEFIT_PREVIEWS: Record<string, ClassBenefitPreview> = {
  reviveChance: { label: 'Revive chance', percent: true },
  distanceDamageBonusRatePerTile: { label: 'Distance damage', suffix: ' / tile', percent: true },
  bonusDamagePerStatus: { label: 'Status damage', suffix: ' / stack', percent: true },
  targetMaxHpBonusRate: { label: 'Max HP damage', percent: true },
  targetCurrentHpBonusRate: { label: 'Current HP damage', percent: true },
  lowHpDamageBonusRate: { label: 'Low HP damage', percent: true },
  soulBoostPercent: { label: 'Soul health/damage boost', percent: true },
  armorReduction: { label: 'Fracture armor reduction', percent: true },
  berserkThresholdRate: { label: 'Berserk threshold', percent: true },
  ricochetCount: { label: 'Ricochet count' },
  numAttacksBoosted: { label: 'Attack count' },
  allyManaGain: { label: 'Ally mana gain' },
  manaSteal: { label: 'Mana steal' },
  statusDuration: { label: 'Status duration', suffix: ' turns' },
  skillDuration: { label: 'Skill duration', suffix: ' turns' },
  avoidAttackChance: { label: 'Avoid chance', percent: true },
  missingHealRate: { label: 'Missing HP heal', percent: true },
  revengeThresholdRate: { label: 'Revenge threshold', percent: true },
  revengeHits: { label: 'Revenge hits' },
  oddPipSiphonRate: { label: 'Odd pip siphon', percent: true },
  evenPipSiphonRate: { label: 'Even pip siphon', percent: true },
  evenPipDamageRate: { label: 'Even pip damage', percent: true },
  oddPipDamageRate: { label: 'Odd pip damage', percent: true }
};

const DESCRIPTION_PLACEHOLDER_PATTERN = /\{([^{}]+)\}/g;

export interface SkillDescriptionContext {
  diceDefinitions?: Record<string, DiceDefinition>;
  poolDefinitions?: Record<string, DicePoolDefinition>;
  classLevel?: number;
  isBoss?: boolean;
}

function formatPercent(rate: number): string {
  return formatPercentValue(rate, 2);
}

function formatValue(value: number): string {
  return formatCompact(value);
}

function scaleFlatDamage(value: number | null | undefined, multiplier: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value * multiplier)) : undefined;
}

function scaleDamageRange(range: [number, number] | null | undefined, multiplier: number): [number, number] | undefined {
  if (!Array.isArray(range)) return undefined;
  const [min, max] = range;
  if (typeof min !== 'number' || !Number.isFinite(min) || typeof max !== 'number' || !Number.isFinite(max)) return undefined;
  return [
    Math.max(1, Math.round(min * multiplier)),
    Math.max(1, Math.round(max * multiplier))
  ];
}

function scaleDisplayDamage(value: number | null | undefined, multiplier: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.round(value * Math.max(1, multiplier))) : undefined;
}

function omitNullishModifiers(modifiers: DiceSkillModifier): DiceSkillModifier {
  return Object.fromEntries(
    Object.entries(modifiers).filter(([, value]) => value !== undefined && value !== null)
  ) as DiceSkillModifier;
}

function getModifier(skill: DiceSkillDefinition | undefined): DiceSkillModifier {
  return (skill?.modifiers ?? {}) as DiceSkillModifier;
}

function getCombinedModifiers(definition: DiceDefinition): DiceSkillModifier {
  return definition.skills.reduce((acc, skill) => ({ ...acc, ...(skill.modifiers ?? {}) }), {} as DiceSkillModifier);
}

export function getClassBenefitValue(series: number[] | undefined, classLevel: number): number | undefined {
  if (!Array.isArray(series) || series.length === 0) return undefined;
  const boundedClassLevel = Number.isFinite(classLevel)
    ? Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(classLevel)))
    : 1;
  const index = Math.min(series.length - 1, boundedClassLevel - 1);
  const value = series[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Mana costs are authored on the skill root rather than in modifiers, so a class benefit that
// changes manaNeeded has to be applied to the skill itself during scaling.
function getClassAdjustedManaNeeded(skill: DiceSkillDefinition, classLevel: number): number | undefined {
  const base = skill.manaNeeded;
  if (typeof base !== 'number' || !Number.isFinite(base)) return undefined;
  const benefit = getClassBenefitValue(skill.classBenefits?.manaNeeded, classLevel);
  if (benefit === undefined || benefit === 0) return base;
  return Math.max(1, Math.round(base + benefit));
}

function applyClassBenefits(skill: DiceSkillDefinition, classLevel: number, modifiers: DiceSkillModifier): DiceSkillModifier {
  if (!skill.classBenefits) return modifiers;
  const writable = modifiers as Record<string, unknown>;
  Object.entries(skill.classBenefits).forEach(([key, series]) => {
    if (DAMAGE_SCALING_KEY_SET.has(key) || key === 'manaNeeded') return;
    const benefit = getClassBenefitValue(series, classLevel);
    if (benefit === undefined) return;
    const current = writable[key];
    if (typeof current !== 'number' || !Number.isFinite(current)) return;
    writable[key] = current + benefit;
  });
  return modifiers;
}

function scaleSkillDamageModifiers(source: DiceSkillModifier, multiplier: number): DiceSkillModifier {
  const modifiers: DiceSkillModifier = { ...source };
  DAMAGE_SCALING_KEYS.forEach((key) => {
    if (key === 'damageRange') return;
    const scaled = scaleFlatDamage(source[key] as number | undefined, multiplier);
    if (scaled !== undefined) {
      (modifiers as Record<string, unknown>)[key] = scaled;
    }
  });
  if (source.damageRange) {
    const range = scaleDamageRange(source.damageRange, multiplier);
    if (range) modifiers.damageRange = range;
  }
  return modifiers;
}

function formatModifierValue(key: string, value: unknown, skillDamageMultiplier: number): string {
  if (Array.isArray(value)) {
    if (key === 'damageRange' && value.length >= 2) {
      const min = scaleDisplayDamage(value[0] as number, skillDamageMultiplier);
      const max = scaleDisplayDamage(value[1] as number, skillDamageMultiplier);
      if (min !== undefined && max !== undefined) return `${formatValue(min)}–${formatValue(max)}`;
    }
    return value.map((entry) => (
      typeof entry === 'number' ? formatValue(entry) : String(entry)
    )).join('x');
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  if (DAMAGE_SCALING_KEY_SET.has(key)) {
    return formatValue(scaleDisplayDamage(value, skillDamageMultiplier) ?? value);
  }
  if (PERCENT_MODIFIER_KEYS.has(key)) return formatPercent(value);
  return formatValue(value);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  return (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
}

function getPathValue(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.').filter(Boolean)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
      continue;
    }
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function getDefinitionSkills(definition: DiceDefinition): ReadonlyArray<DiceSkillDefinition | null | undefined> {
  return Array.isArray(definition.skills) ? definition.skills : [];
}

function findModifierValue(
  key: string,
  definition: DiceDefinition,
  modifiers: DiceSkillModifier
): unknown {
  const direct = (modifiers as Record<string, unknown>)[key];
  if (direct !== undefined) return direct;
  for (const skill of getDefinitionSkills(definition)) {
    if (!skill || typeof skill !== 'object') continue;
    const modifierValue = skill.modifiers?.[key];
    if (modifierValue !== undefined) return modifierValue;
    const rootValue = (skill as unknown as Record<string, unknown>)[key];
    if (rootValue !== undefined) return rootValue;
  }
  return undefined;
}

function getIndexedModifierValue(skill: DiceSkillDefinition, path: string): unknown {
  const source = skill as unknown as Record<string, unknown>;
  if (path.startsWith('modifiers.')) {
    return getPathValue(source.modifiers, path.slice('modifiers.'.length));
  }
  const direct = getPathValue(source, path);
  if (direct !== undefined) return direct;
  return getPathValue(source.modifiers, path);
}

function resolveCatalogToken(
  token: string,
  definition: DiceDefinition,
  modifiers: DiceSkillModifier
): string {
  const key = stripQuotes(token);
  const modifierValue = (modifiers as Record<string, unknown>)[key];
  if (typeof modifierValue === 'string' && modifierValue.trim()) return modifierValue;
  const rootValue = (definition as unknown as Record<string, unknown>)[key];
  if (typeof rootValue === 'string' && rootValue.trim()) return rootValue;
  return key;
}

function resolveDescriptionPlaceholder(
  expression: string,
  definition: DiceDefinition,
  modifiers: DiceSkillModifier,
  skillDamageMultiplier: number,
  context?: SkillDescriptionContext
): string | undefined {
  const value = expression.trim();
  if (!value) return undefined;

  const indexedModifier = value.match(/^modifiers\s*\.?\s*\[\s*([^\]]+)\s*\]\s*\.(.+)$/);
  if (indexedModifier && /^\d+$/.test(stripQuotes(indexedModifier[1]))) {
    const source = getDefinitionSkills(definition)[Number(stripQuotes(indexedModifier[1]))];
    if (!source) return undefined;
    const path = indexedModifier[2].trim();
    const modifierValue = getIndexedModifierValue(source, path);
    return modifierValue === undefined || modifierValue === null
      ? undefined
      : typeof modifierValue === 'string'
        ? modifierValue
        : formatModifierValue(path.split('.').pop() ?? path, modifierValue, skillDamageMultiplier);
  }

  const modifierBracket = value.match(/^modifiers\s*\.?\s*\[\s*([^\]]+)\s*\]$/);
  const modifierPath = value.match(/^modifiers\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (modifierBracket || modifierPath) {
    const key = stripQuotes(modifierBracket?.[1] ?? modifierPath?.[1] ?? '');
    const modifierValue = findModifierValue(key, definition, modifiers);
    return modifierValue === undefined || modifierValue === null
      ? undefined
      : formatModifierValue(key, modifierValue, skillDamageMultiplier);
  }

  const catalog = value.match(/^(diceDefinitions|poolDefinitions)\s*\[\s*([^\]]+)\s*\]\s*(?:\.(.+))?$/);
  if (catalog) {
    const scope = catalog[1] as 'diceDefinitions' | 'poolDefinitions';
    const key = resolveCatalogToken(catalog[2], definition, modifiers);
    const path = catalog[3] ?? 'title';
    const source = scope === 'diceDefinitions' ? context?.diceDefinitions?.[key] : context?.poolDefinitions?.[key];
    let catalogValue = getPathValue(source, path);
    if (catalogValue === undefined || catalogValue === null) return undefined;
    if (scope === 'poolDefinitions' && path === 'damage' && typeof catalogValue === 'number') {
      catalogValue = resolvePoolDamage(catalogValue, context?.classLevel ?? 1, context?.isBoss ?? definition.isBoss === true);
    }
    return typeof catalogValue === 'string'
      ? catalogValue
      : formatModifierValue(path.split('.').pop() ?? path, catalogValue, skillDamageMultiplier);
  }

  const rootValue = getPathValue(definition, value);
  if (rootValue !== undefined && rootValue !== null) {
    return typeof rootValue === 'string'
      ? rootValue
      : formatModifierValue(value.split('.').pop() ?? value, rootValue, skillDamageMultiplier);
  }
  const modifierValue = findModifierValue(value, definition, modifiers);
  return modifierValue === undefined || modifierValue === null
    ? undefined
    : formatModifierValue(value, modifierValue, skillDamageMultiplier);
}

function renderSkillDescription(
  description: string,
  definition: DiceDefinition,
  modifiers: DiceSkillModifier,
  skillDamageMultiplier: number,
  context?: SkillDescriptionContext
): string {
  if (!description.includes('{')) return description;
  return description.replace(DESCRIPTION_PLACEHOLDER_PATTERN, (match, expression: string) => (
    resolveDescriptionPlaceholder(expression, definition, modifiers, skillDamageMultiplier, context) ?? match
  ));
}

export function getClassScaledSkillDescription(
  definition: DiceDefinition,
  skill: DiceSkillDefinition | undefined = definition.skills[0],
  skillDamageMultiplier = 1,
  sourceModifiers?: DiceSkillModifier,
  context?: SkillDescriptionContext
): string {
  const description = skill?.description ?? '';
  if (skill?.descriptionLocked === true && !description.includes('{')) return description;
  const modifiers = {
    ...(sourceModifiers ?? {}),
    ...getModifier(skill)
  } as DiceSkillModifier;
  return renderSkillDescription(description, definition, modifiers, skillDamageMultiplier, context);
}

export function getClassScaledTalentDescription(
  definition: DiceDefinition,
  talent: DiceTalentDefinition,
  skillDamageMultiplier = 1,
  context?: SkillDescriptionContext
): string {
  const description = talent.description ?? '';
  if (!description.includes('{')) return description;
  const modifiers = { ...(talent.modifiers ?? {}) } as DiceSkillModifier;
  return renderSkillDescription(description, definition, modifiers, skillDamageMultiplier, context);
}

export function applyTransformStats(definition: DiceDefinition, transformIndex = 0): DiceDefinition {
  const stats = getTransformStats(definition, transformIndex);
  if (!stats) return definition;
  if (stats.title && definition.title === stats.title) return definition;
  const mergedSkills = mergeSkillsByIndex(definition.skills, stats.skills);
  const transformedDefinition: DiceDefinition = {
    ...definition,
    title: stats.title ?? definition.title,
    attack: scaleStatValue(stats.attack, definition.attack, stats.attackMultiplier),
    health: scaleStatValue(stats.health, definition.health, stats.healthMultiplier),
    range: stats.range ?? definition.range,
    footprint: stats.footprint ?? definition.footprint,
    targetingMode: stats.targetingMode ?? definition.targetingMode,
    accent: stats.accent ?? definition.accent,
    rarity: stats.rarity ?? definition.rarity,
    isBoss: stats.isBoss ?? definition.isBoss,
    skills: mergedSkills,
    attackSfx: stats.attackSfx ?? definition.attackSfx,
    transformStats: definition.transformStats,
    transformFlags: definition.transformFlags,
    alternateButton: definition.alternateButton,
    baseButton: definition.baseButton
  };
  return transformedDefinition;
}

export interface ClassProgressionOptions {
  uncapped?: boolean;
}

export function applyClassProgression(definition: DiceDefinition, classLevel: number, options: ClassProgressionOptions = {}): DiceDefinition {
  const classUps = Math.max(1, Number.isFinite(classLevel) ? Math.floor(classLevel) : 1);
  const boundedClassLevel = definition.isBoss === true || options.uncapped === true
    ? classUps
    : Math.min(MAX_CLASS_LEVEL, classUps);
  const multiplier = definition.isBoss === true
    ? BOSS_CLASS_STAT_MULTIPLIER ** (boundedClassLevel - 1)
    : CLASS_UP_STAT_MULTIPLIER ** (boundedClassLevel - 1);
  const scaleSkill = (skill: DiceSkillDefinition): DiceSkillDefinition => {
    if (!skill.modifiers) return skill;
    const modifiers = scaleSkillDamageModifiers(skill.modifiers, multiplier);
    applyClassBenefits(skill, boundedClassLevel, modifiers);
    const manaNeeded = getClassAdjustedManaNeeded(skill, boundedClassLevel);
    return {
      ...skill,
      modifiers: omitNullishModifiers(modifiers),
      ...(manaNeeded !== undefined ? { manaNeeded } : {})
    };
  };

  const skills = definition.skills.map(scaleSkill);

  return {
    ...definition,
    attack: scaleStatValue(definition.attack, 1, multiplier),
    health: scaleStatValue(definition.health, 1, multiplier),
    transformStats: definition.transformStats?.map((stats) => {
      if (!stats || typeof stats !== 'object') return stats;
      return {
        ...stats,
        attack: typeof stats.attack === 'number' && Number.isFinite(stats.attack) ? scaleStatValue(stats.attack, 1, multiplier) : undefined,
        health: typeof stats.health === 'number' && Number.isFinite(stats.health) ? scaleStatValue(stats.health, 1, multiplier) : undefined,
        skills: stats.skills?.map((skill) => (
          skill && typeof skill === 'object' ? scaleSkill(skill) : skill
        ))
      };
    }),
    skills
  };
}

export interface ClassProgressionPreview {
  attackDelta: number;
  healthDelta: number;
  skillDeltas: string[];
}

export function getClassMultiplier(classLevel: number): number {
  return CLASS_UP_STAT_MULTIPLIER ** Math.max(0, Math.min(MAX_CLASS_LEVEL, classLevel) - 1);
}

export function getBossClassMultiplier(classLevel: number): number {
  return BOSS_CLASS_STAT_MULTIPLIER ** Math.max(0, Math.floor(classLevel) - 1);
}

export function resolvePoolDamage(baseDamage: number | undefined, classLevel: number, isBoss: boolean): number {
  const base = resolveStatValue(baseDamage, 0);
  if (base <= 0) return 0;
  const safeClassLevel = Number.isFinite(classLevel) ? Math.max(1, Math.floor(classLevel)) : 1;
  const multiplier = isBoss ? getBossClassMultiplier(safeClassLevel) : getClassMultiplier(safeClassLevel);
  return Math.max(1, Math.round(base * resolveStatMultiplier(multiplier)));
}

export function getClassProgressionPreview(definition: DiceDefinition, classLevel: number): ClassProgressionPreview {
  const current = applyClassProgression(definition, classLevel);
  const next = applyClassProgression(definition, Math.min(MAX_CLASS_LEVEL, classLevel + 1));
  const currentModifiers = getCombinedModifiers(current);
  const nextModifiers = getCombinedModifiers(next);
  const skillDeltas: string[] = [];

  const pushNumericDelta = (label: string, currentValue: number | undefined, nextValue: number | undefined, suffix = '') => {
    if (currentValue === undefined || nextValue === undefined) return;
    const delta = nextValue - currentValue;
    if (delta > 0) {
      const displayDelta = Number.isInteger(delta) ? formatValue(delta) : formatValue(Number(delta.toFixed(1)));
      skillDeltas.push(`${label} +${displayDelta}${suffix}`);
    }
  };

  DAMAGE_SCALING_KEYS.forEach((key) => {
    if (key === 'damageRange') return;
    const label = DAMAGE_PREVIEW_LABELS[key] ?? key;
    pushNumericDelta(label, currentModifiers[key] as number | undefined, nextModifiers[key] as number | undefined);
  });

  if (currentModifiers.damageRange && nextModifiers.damageRange) {
    const minDelta = nextModifiers.damageRange[0] - currentModifiers.damageRange[0];
    const maxDelta = nextModifiers.damageRange[1] - currentModifiers.damageRange[1];
    if (minDelta > 0 || maxDelta > 0) skillDeltas.push(`Random damage +${formatValue(minDelta)}/+${formatValue(maxDelta)}`);
  }

  const seenBenefits = new Set<string>();
  current.skills.forEach((skill, index) => {
    if (!skill.classBenefits) return;
    const nextSkill = next.skills[index];
    Object.entries(skill.classBenefits).forEach(([key]) => {
      if (seenBenefits.has(key) || DAMAGE_SCALING_KEY_SET.has(key)) return;
      seenBenefits.add(key);
      const currentValue = (skill.modifiers as Record<string, unknown> | undefined)?.[key];
      const nextValue = (nextSkill?.modifiers as Record<string, unknown> | undefined)?.[key];
      if (typeof currentValue !== 'number' || typeof nextValue !== 'number') return;
      const delta = nextValue - currentValue;
      if (delta <= 0) return;
      const preview: ClassBenefitPreview = CLASS_BENEFIT_PREVIEWS[key] ?? {
        label: key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase())
      };
      const displayDelta = preview.percent
        ? formatPercent(delta)
        : formatValue(Number(delta.toFixed(2)));
      skillDeltas.push(`${preview.label} +${displayDelta}${preview.suffix ?? ''}`);
    });
  });

  return {
    attackDelta: next.attack - current.attack,
    healthDelta: next.health - current.health,
    skillDeltas
  };
}
