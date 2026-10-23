import type { DiceSkillDefinition } from '../types/game';

export function cloneSkill(skill: DiceSkillDefinition): DiceSkillDefinition {
  return {
    ...skill,
    modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers
  };
}

export function withLiftedManaCost(skill: DiceSkillDefinition): DiceSkillDefinition {
  const manaNeeded = skill.modifiers?.manaNeeded;
  if (typeof manaNeeded !== 'number' || !Number.isFinite(manaNeeded)) return skill;
  return { ...skill, manaNeeded: Math.max(1, Math.floor(manaNeeded)) };
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
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
    if (Object.keys(entry).length === 0) return;
    merged[index] = withLiftedManaCost(cloneSkill(entry));
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
    merged[index] = withLiftedManaCost(current
      ? {
        ...current,
        ...entry,
        modifiers: { ...(current.modifiers ?? {}), ...(entry.modifiers ?? {}) }
      }
      : cloneSkill(entry));
  });
  return merged;
}
