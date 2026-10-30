import type { DiceSkillDefinition } from '../types/game';

export function cloneSkill(skill: DiceSkillDefinition): DiceSkillDefinition {
  return {
    ...skill,
    modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers
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

// A transform row leaves an index untouched by leaving an empty object there, matching the talent
// overlay convention. A row that declares its own type is a full replacement; a row that only names
// properties (typically modifiers) overlays onto the base skill, so a form that changes one flag does
// not have to restate the skill's type, title, and description.
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

// Talent overlays are additive: an entry only changes the properties it names, so a talent can
// retitle or re-describe a skill without dropping the fields the runtime depends on. An entry
// past the end of the base list still appends, and an empty entry leaves its index untouched.
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
