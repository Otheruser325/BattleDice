import type { DiceDefinition, DiceSkillDefinition, DiceTypeId } from '../types/game';

export interface DiceSkillBundle {
  primary: DiceSkillDefinition | null;
  all: DiceSkillDefinition[];
}

export function buildSkillIndex(definitions: DiceDefinition[]): Map<DiceTypeId, DiceSkillBundle> {
  return new Map(
    definitions.map((definition) => [
      definition.typeId,
      {
        primary: definition.skills[0] ?? null,
        all: definition.skills
      }
    ])
  );
}

