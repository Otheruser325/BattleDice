import type { DiceSkillDefinition } from '../types/game';

export function cloneSkill(skill: DiceSkillDefinition): DiceSkillDefinition {
  return {
    ...skill,
    modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers
  };
}

// Overlay entries are positional: entry i replaces skill i, an empty entry leaves
// that skill untouched, and an entry past the end of the base list is appended.
// A replacement is wholesale so a form or talent never inherits modifiers from the
// skill it overwrites; additive changes belong in the skillModifiers layer.
export function mergeSkillsByIndex(
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
    merged[index] = cloneSkill(entry);
  });
  return merged;
}

export function isSkillListComingSoon(
  baseSkills: DiceSkillDefinition[] | undefined,
  overlay: Array<DiceSkillDefinition | null | undefined> | undefined,
  comingSoon?: boolean
): boolean {
  if (comingSoon === true) return true;
  const base = Array.isArray(baseSkills) ? baseSkills : [];
  if (!Array.isArray(overlay)) return false;
  return overlay.some((entry, index) => Boolean(entry) && index >= base.length);
}
