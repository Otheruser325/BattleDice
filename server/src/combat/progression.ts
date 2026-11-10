import type { DiceDefinition, DiceSkillDefinition, SkillClassBenefits, SkillModifiers } from './types.js';

const MAX_CLASS_LEVEL = 15;
const DEFAULT_TALENT_CLASS_NEEDED = 9;
const CLASS_UP_STAT_MULTIPLIER = 1.1;
const BOSS_CLASS_STAT_MULTIPLIER = 1.2;
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
] as const;
const DAMAGE_SCALING_KEY_SET = new Set<string>(DAMAGE_SCALING_KEYS);
const ROOT_TALENT_KEYS = new Set([
  'attackDelta',
  'healthDelta',
  'attackMultiplier',
  'healthMultiplier',
  'rangeDelta',
  'targetingMode',
  'skills'
]);

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function scaleFlat(value: unknown, multiplier: number): number | undefined {
  const resolved = numberValue(value);
  return resolved === undefined ? undefined : Math.max(1, Math.round(resolved * multiplier));
}

function scaleRange(value: unknown, multiplier: number): [number, number] | undefined {
  if (!Array.isArray(value) || value.length < 2) return undefined;
  const min = numberValue(value[0]);
  const max = numberValue(value[1]);
  if (min === undefined || max === undefined) return undefined;
  return [Math.max(1, Math.round(min * multiplier)), Math.max(1, Math.round(max * multiplier))];
}

function cloneClassBenefits(classBenefits: SkillClassBenefits | undefined): SkillClassBenefits | undefined {
  if (!classBenefits) return undefined;
  return Object.fromEntries(
    Object.entries(classBenefits).map(([key, series]) => [key, Array.isArray(series) ? [...series] : series])
  );
}

function cloneSkill(skill: DiceSkillDefinition): DiceSkillDefinition {
  return {
    ...skill,
    modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers,
    classBenefits: cloneClassBenefits(skill.classBenefits)
  };
}

function definedFields(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null));
}

function mergeTalentSkills(
  baseSkills: DiceSkillDefinition[],
  overlay: unknown
): DiceSkillDefinition[] {
  const merged = baseSkills.map(cloneSkill);
  if (!Array.isArray(overlay)) return merged;
  overlay.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || index > merged.length) return;
    const row = entry as DiceSkillDefinition;
    if (Object.keys(row).length === 0) return;
    const current = merged[index];
    merged[index] = current
      ? {
          ...current,
          ...definedFields(row as unknown as Record<string, unknown>),
          modifiers: {
            ...(current.modifiers ?? {}),
            ...definedFields(row.modifiers as unknown as Record<string, unknown> | undefined)
          },
          classBenefits: row.classBenefits
            ? cloneClassBenefits(row.classBenefits)
            : cloneClassBenefits(current.classBenefits)
        }
      : cloneSkill(row);
  });
  return merged.filter((skill) => skill.disableSkill !== true);
}

function getTalentClassNeeded(talent: { classNeeded?: number }): number {
  const value = talent.classNeeded;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_CLASS_LEVEL
    ? value
    : DEFAULT_TALENT_CLASS_NEEDED;
}

export function getClassBenefitValue(series: unknown, classLevel: number): number | undefined {
  if (!Array.isArray(series) || series.length === 0) return undefined;
  const boundedClassLevel = Number.isFinite(classLevel)
    ? Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(classLevel)))
    : 1;
  const index = Math.min(series.length - 1, boundedClassLevel - 1);
  return numberValue(series[index]);
}

function applyClassBenefits(skill: DiceSkillDefinition, classLevel: number, modifiers: SkillModifiers): SkillModifiers {
  if (!skill.classBenefits) return modifiers;
  Object.entries(skill.classBenefits).forEach(([key, series]) => {
    if (DAMAGE_SCALING_KEY_SET.has(key) || key === 'manaNeeded') return;
    const benefit = getClassBenefitValue(series, classLevel);
    if (benefit === undefined) return;
    const current = modifiers[key];
    if (typeof current !== 'number' || !Number.isFinite(current)) return;
    modifiers[key] = current + benefit;
  });
  return modifiers;
}

function scaleSkillModifiers(
  source: SkillModifiers,
  skill: DiceSkillDefinition,
  classLevel: number,
  multiplier: number
): SkillModifiers {
  const modifiers: SkillModifiers = { ...source };
  DAMAGE_SCALING_KEYS.forEach((key) => {
    if (key === 'damageRange') return;
    const scaled = scaleFlat(source[key], multiplier);
    if (scaled !== undefined) modifiers[key] = scaled;
  });
  const range = scaleRange(source.damageRange, multiplier);
  if (range) modifiers.damageRange = range;
  return applyClassBenefits(skill, classLevel, modifiers);
}

function getClassAdjustedManaNeeded(skill: DiceSkillDefinition, classLevel: number): number | undefined {
  const base = skill.manaNeeded;
  if (typeof base !== 'number' || !Number.isFinite(base)) return undefined;
  const benefit = getClassBenefitValue(skill.classBenefits?.manaNeeded, classLevel);
  if (benefit === undefined || benefit === 0) return base;
  return Math.max(1, Math.round(base + benefit));
}

export function applyTalent(
  definition: DiceDefinition,
  talentIndex: number | null,
  classLevel: number
): DiceDefinition {
  if (definition.talentsComingSoon === true || talentIndex === null) return definition;
  const talent = definition.talents?.[talentIndex];
  if (!talent || talent.comingSoon === true || classLevel < getTalentClassNeeded(talent)) return definition;
  const modifiers = talent.modifiers && typeof talent.modifiers === 'object' && !Array.isArray(talent.modifiers)
    ? talent.modifiers
    : {};
  const skillOverlay = modifiers.skills;
  const rootModifiers = Object.fromEntries(
    Object.entries(modifiers).filter(([key, value]) => !ROOT_TALENT_KEYS.has(key) && value !== undefined && value !== null)
  ) as SkillModifiers;
  const skills = mergeTalentSkills(definition.skills, skillOverlay).map((skill) => (
    Object.keys(rootModifiers).length > 0
      ? { ...skill, modifiers: { ...(skill.modifiers ?? {}), ...rootModifiers } }
      : skill
  ));
  const attackDelta = numberValue(modifiers.attackDelta) ?? 0;
  const healthDelta = numberValue(modifiers.healthDelta) ?? 0;
  const attackMultiplier = numberValue(modifiers.attackMultiplier) ?? 1;
  const healthMultiplier = numberValue(modifiers.healthMultiplier) ?? 1;
  const rangeDelta = numberValue(modifiers.rangeDelta) ?? 0;
  return {
    ...definition,
    attack: Math.max(1, Math.round((definition.attack + attackDelta) * attackMultiplier)),
    health: Math.max(1, Math.round((definition.health + healthDelta) * healthMultiplier)),
    range: Math.max(0, definition.range + rangeDelta),
    targetingMode: (modifiers.targetingMode as DiceDefinition['targetingMode'] | undefined) ?? definition.targetingMode,
    skills
  };
}

export function getClassMultiplier(definition: Pick<DiceDefinition, 'isBoss'>, classLevel: number): number {
  const level = Math.max(1, Math.min(MAX_CLASS_LEVEL, Number.isFinite(classLevel) ? Math.floor(classLevel) : 1));
  return (definition.isBoss === true ? BOSS_CLASS_STAT_MULTIPLIER : CLASS_UP_STAT_MULTIPLIER) ** (level - 1);
}

export function applyClassProgression(definition: DiceDefinition, classLevel: number): DiceDefinition {
  const level = Math.max(1, Math.min(MAX_CLASS_LEVEL, Number.isFinite(classLevel) ? Math.floor(classLevel) : 1));
  const classUps = level - 1;
  const multiplier = (definition.isBoss === true ? BOSS_CLASS_STAT_MULTIPLIER : CLASS_UP_STAT_MULTIPLIER) ** classUps;

  return {
    ...definition,
    attack: Math.max(1, Math.round(definition.attack * multiplier)),
    health: Math.max(1, Math.round(definition.health * multiplier)),
    skills: definition.skills.map((skill) => {
      const manaNeeded = getClassAdjustedManaNeeded(skill, level);
      return {
        ...skill,
        ...(manaNeeded !== undefined ? { manaNeeded } : {}),
        modifiers: skill.modifiers ? scaleSkillModifiers(skill.modifiers, skill, level, multiplier) : skill.modifiers
      };
    }),
    transformStats: definition.transformStats?.map((stats) => ({
      ...stats,
      attack: stats.attack === undefined ? undefined : Math.max(1, Math.round(stats.attack * multiplier)),
      health: stats.health === undefined ? undefined : Math.max(1, Math.round(stats.health * multiplier)),
      skills: Array.isArray(stats.skills)
        ? stats.skills.map((skill) => (
            skill && skill.modifiers ? {
              ...skill,
              modifiers: scaleSkillModifiers(skill.modifiers, skill, level, multiplier)
            } : skill
          ))
        : stats.skills
    }))
  };
}

export function buildCombatDefinition(
  definition: DiceDefinition,
  classLevel: number,
  talentIndex: number | null,
  useLevelling: boolean
): DiceDefinition {
  const effectiveLevel = useLevelling ? Math.max(1, Math.min(MAX_CLASS_LEVEL, Math.floor(classLevel))) : 1;
  return applyClassProgression(applyTalent(definition, talentIndex, effectiveLevel), effectiveLevel);
}
