import fs from 'node:fs';
import path from 'node:path';
import type { DiceDefinition, TargetingMode } from './types.js';

interface DiceFlags {
  fetchableTypeIds: string[];
  exclusiveTypeIds?: Array<string | { typeId: string; path?: string }>;
}

const TARGETING_MODES: TargetingMode[] = ['Nearest', 'Furthest', 'Strongest', 'Weakest', 'Random'];
const TYPE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/;
const DATA_DIRECTORY = path.resolve(__dirname, '..', '..', 'gamedata', 'DiceDefinitions');

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as T;
}

function normalizeTypeId(value: unknown): string | null {
  return typeof value === 'string' && TYPE_ID_PATTERN.test(value) ? value : null;
}

function normalizeDefinition(raw: unknown, expectedTypeId: string): DiceDefinition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const definition = raw as Partial<DiceDefinition>;
  if (definition.typeId !== expectedTypeId) return null;
  if (typeof definition.title !== 'string' || definition.title.length === 0) return null;
  if (!Number.isFinite(definition.attack) || !Number.isFinite(definition.health) || !Number.isFinite(definition.range)) return null;
  if (!Number.isFinite(definition.health) || (definition.health ?? 0) <= 0) return null;
  if (!Number.isFinite(definition.range) || (definition.range ?? 0) < 1) return null;
  if (!TARGETING_MODES.includes(definition.targetingMode as TargetingMode)) return null;
  if (!Array.isArray(definition.skills)) return null;
  return {
    ...(definition as DiceDefinition),
    skills: definition.skills.filter((skill) => Boolean(skill) && typeof skill === 'object' && !Array.isArray(skill)),
    targetingMode: definition.targetingMode as TargetingMode
  };
}

function exclusiveEntries(flags: DiceFlags): Array<{ typeId: string; relativePath: string }> {
  return (flags.exclusiveTypeIds ?? []).flatMap((entry) => {
    if (typeof entry === 'string') {
      const typeId = normalizeTypeId(entry);
      return typeId ? [{ typeId, relativePath: `${typeId}.dice` }] : [];
    }
    const typeId = normalizeTypeId(entry?.typeId);
    if (!typeId) return [];
    const relativePath = typeof entry.path === 'string' && /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.dice$/.test(entry.path)
      ? entry.path
      : `${typeId}.dice`;
    return [{ typeId, relativePath }];
  });
}

export class DiceCatalog {
  private readonly definitions = new Map<string, DiceDefinition>();

  constructor(directory = DATA_DIRECTORY) {
    const flags = readJson<DiceFlags>(path.join(directory, 'Flags.json'));
    if (!Array.isArray(flags.fetchableTypeIds)) throw new Error('Dice catalog flags are malformed.');

    const entries = [
      ...flags.fetchableTypeIds.map((typeId) => ({ typeId, relativePath: `${typeId}.dice` })),
      ...exclusiveEntries(flags)
    ];
    for (const entry of entries) {
      const typeId = normalizeTypeId(entry.typeId);
      if (!typeId) continue;
      const filePath = path.resolve(directory, entry.relativePath);
      if (!filePath.startsWith(`${directory}${path.sep}`)) continue;
      if (!fs.existsSync(filePath)) continue;
      const definition = normalizeDefinition(readJson<unknown>(filePath), typeId);
      if (definition) this.definitions.set(typeId, definition);
    }
    if (this.definitions.size === 0) throw new Error('No dice definitions were loaded for authoritative combat.');
  }

  get(typeId: string): DiceDefinition | undefined {
    return this.definitions.get(typeId);
  }

  has(typeId: string): boolean {
    return this.definitions.has(typeId);
  }

  typeIds(): string[] {
    return [...this.definitions.keys()];
  }
}

export const diceCatalog = new DiceCatalog();
