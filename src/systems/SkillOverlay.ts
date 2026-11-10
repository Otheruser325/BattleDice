import type { DiceSkillDefinition } from '../types/game';

export const SKILL_SOURCE_SKILLS = Symbol('skillSourceSkills');

export function cloneSkill(skill: DiceSkillDefinition): DiceSkillDefinition {
  return {
    ...skill,
    modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers,
    classBenefits: skill.classBenefits
      ? Object.fromEntries(Object.entries(skill.classBenefits).map(([key, series]) => [key, Array.isArray(series) ? [...series] : series])) as DiceSkillDefinition['classBenefits']
      : skill.classBenefits
  };
}

function isSkillEntry(entry: unknown): entry is DiceSkillDefinition {
  return Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry);
}

function definedOverlayFields<T extends object>(value: T | null | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null)
  ) as Partial<T>;
}

export function mergeSkillsByIndex(
  baseSkills: DiceSkillDefinition[] | undefined,
  overlay: Array<DiceSkillDefinition | null | undefined> | undefined
): DiceSkillDefinition[] {
  const base = (Array.isArray(baseSkills) ? baseSkills : []).map(cloneSkill);
  if (!Array.isArray(overlay)) return base;
  const merged = [...base];
  overlay.forEach((entry, index) => {
    if (index > merged.length) return;
    if (!isSkillEntry(entry)) return;
    if (Object.keys(entry).length === 0) return;
    const current = merged[index];
    if (!current || typeof entry.type === 'string') {
      merged[index] = cloneSkill(entry);
      return;
    }
    merged[index] = {
      ...current,
      ...definedOverlayFields(entry),
      modifiers: {
        ...(current.modifiers ?? {}),
        ...definedOverlayFields(entry.modifiers)
      }
    };
  });
  return merged;
}

export function isSkillListComingSoon(comingSoon?: boolean): boolean {
  return comingSoon === true;
}

export function mergeSkillOverlayByIndex(
  baseSkills: DiceSkillDefinition[] | undefined,
  overlay: Array<DiceSkillDefinition | null | undefined> | undefined
): DiceSkillDefinition[] {
  const base = (Array.isArray(baseSkills) ? baseSkills : []).map(cloneSkill);
  if (!Array.isArray(overlay)) return base;
  const merged = [...base];
  overlay.forEach((entry, index) => {
    if (index > merged.length) return;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    if (Object.keys(entry).length === 0) return;
    const current = merged[index];
    merged[index] = current
      ? {
        ...current,
        ...definedOverlayFields(entry),
        modifiers: {
          ...(current.modifiers ?? {}),
          ...definedOverlayFields(entry.modifiers)
        }
      }
      : cloneSkill(entry);
  });
  return merged;
}
