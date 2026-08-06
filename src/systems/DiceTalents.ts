import type Phaser from 'phaser';
import type { DiceDefinition, DiceTalentDefinition, DiceTalentModifier, DiceTypeId } from '../types/game';

const EQUIPPED_TALENTS_KEY = 'dice:equippedTalents';

function readEquippedTalents(scene: Phaser.Scene): Record<string, string> {
  const stored = scene.registry.get(EQUIPPED_TALENTS_KEY) as Record<string, string> | undefined;
  if (stored && typeof stored === 'object') return { ...stored };
  try {
    const parsed = JSON.parse(localStorage.getItem(EQUIPPED_TALENTS_KEY) ?? '{}') as unknown;
    const talents = parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
    scene.registry.set(EQUIPPED_TALENTS_KEY, talents);
    return { ...talents };
  } catch {
    return {};
  }
}

function writeEquippedTalents(scene: Phaser.Scene, talents: Record<string, string>) {
  scene.registry.set(EQUIPPED_TALENTS_KEY, talents);
  try {
    localStorage.setItem(EQUIPPED_TALENTS_KEY, JSON.stringify(talents));
  } catch {
    // Local persistence is best effort; the registry keeps the current session state.
  }
}

export function getDiceTalent(definition: DiceDefinition, talentId: string | null | undefined): DiceTalentDefinition | undefined {
  if (!talentId || !definition.talents?.length) return undefined;
  return definition.talents.find((talent) => talent.id === talentId);
}

export function getEquippedTalentId(scene: Phaser.Scene, typeId: DiceTypeId): string | null {
  const definition = scene.cache.json.get(`dice:${typeId}`) as DiceDefinition | undefined;
  const talentId = readEquippedTalents(scene)[typeId];
  return getDiceTalent(definition ?? ({ typeId, talents: [] } as DiceDefinition), talentId)?.id ?? null;
}

export function setEquippedTalentId(scene: Phaser.Scene, definition: DiceDefinition, talentId: string | null) {
  const talents = readEquippedTalents(scene);
  if (talentId === null) {
    delete talents[definition.typeId];
  } else if (getDiceTalent(definition, talentId)) {
    // Each dice type has one active talent slot. Assigning replaces the previous one.
    talents[definition.typeId] = talentId;
  } else {
    return;
  }
  writeEquippedTalents(scene, talents);
}

function mergeTalentSkillModifiers(modifiers: DiceTalentModifier): DiceTalentModifier {
  const { attackDelta: _attackDelta, healthDelta: _healthDelta, attackMultiplier: _attackMultiplier,
    healthMultiplier: _healthMultiplier, rangeDelta: _rangeDelta, targetingMode: _targetingMode,
    skillIndex: _skillIndex, skillModifiers, ...skillModifierFields } = modifiers;
  return { ...skillModifierFields, ...(skillModifiers ?? {}) };
}

export function applyDiceTalent(definition: DiceDefinition, talentId: string | null | undefined): DiceDefinition {
  const talent = getDiceTalent(definition, talentId);
  if (!talent?.modifiers) return definition;

  const modifiers = talent.modifiers;
  const attack = Math.max(1, Math.round((definition.attack + (modifiers.attackDelta ?? 0)) * (modifiers.attackMultiplier ?? 1)));
  const health = Math.max(1, Math.round((definition.health + (modifiers.healthDelta ?? 0)) * (modifiers.healthMultiplier ?? 1)));
  const range = Math.max(0, definition.range + (modifiers.rangeDelta ?? 0));
  const skillModifiers = mergeTalentSkillModifiers(modifiers);
  const hasSkillChanges = Object.keys(skillModifiers).length > 0;
  const skills = hasSkillChanges
    ? definition.skills.map((skill, index) => {
      if (modifiers.skillIndex !== undefined && modifiers.skillIndex !== index) return skill;
      return {
        ...skill,
        modifiers: { ...(skill.modifiers ?? {}), ...skillModifiers }
      };
    })
    : definition.skills;

  return {
    ...definition,
    attack,
    health,
    range,
    targetingMode: modifiers.targetingMode ?? definition.targetingMode,
    skills
  };
}