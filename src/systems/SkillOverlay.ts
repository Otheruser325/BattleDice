import type { DiceSkillDefinition } from '../types/game';

export function cloneSkill(skill: DiceSkillDefinition): DiceSkillDefinition {
  return {
    ...skill,
    modifiers: skill.modifiers ? { ...skill.modifiers } : skill.modifiers
  };
}

// A skill's mana cost lives on the skill itself, so an overlay that only carries
// modifiers has to lift manaNeeded up or the cost would never change.
export function withLiftedManaCost(skill: DiceSkillDefinition): DiceSkillDefinition {
  const manaNeeded = skill.modifiers?.manaNeeded;
  if (typeof manaNeeded !== 'number' || !Number.isFinite(manaNeeded)) return skill;
  return { ...skill, manaNeeded: Math.max(1, Math.floor(manaNeeded)) };
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
    merged[index] = withLiftedManaCost(cloneSkill(entry));
  });
  return merged;
}

// Only an explicit flag marks a skill list as unfinished. Adding skills past the
// end of the base list is a normal overlay, not a sign of missing data.
export function isSkillListComingSoon(comingSoon?: boolean): boolean {
  return comingSoon === true;
}
