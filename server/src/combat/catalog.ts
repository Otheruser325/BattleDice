import fs from 'node:fs';
import path from 'node:path';
import type { DiceDefinition, PoolDefinition, StatusEffect, TargetingMode } from './types.js';

interface DiceFlags {
  fetchableTypeIds: string[];
  exclusiveTypeIds?: Array<string | { typeId: string; path?: string }>;
}

const TARGETING_MODES: TargetingMode[] = ['Nearest', 'Furthest', 'Strongest', 'Weakest', 'Random'];
const TYPE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/;
const DATA_DIRECTORY = path.resolve(__dirname, '..', '..', 'gamedata', 'DiceDefinitions');
const POOL_DATA_DIRECTORY = path.resolve(__dirname, '..', '..', 'gamedata', 'PoolDefinitions');
const POOL_TARGETS = ['foes', 'allies', 'both'] as const;
const STATUS_EFFECTS: StatusEffect[] = ['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk', 'acceleration', 'dilation', 'disorientation'];

interface PoolFlags {
  typeIds: string[];
}

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

function normalizePoolDefinition(raw: unknown, expectedPoolType: string): PoolDefinition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const definition = raw as Partial<PoolDefinition>;
  if (definition.typeId !== expectedPoolType || typeof definition.title !== 'string') return null;
  if (!Number.isFinite(definition.damage) || (definition.damage ?? 0) < 0) return null;
  const pattern = Array.isArray(definition.pattern)
    ? definition.pattern.filter((entry): entry is [number, number] => (
        Array.isArray(entry)
        && entry.length >= 2
        && Number.isFinite(entry[0])
        && Number.isFinite(entry[1])
      )).map(([row, col]) => [Math.trunc(row), Math.trunc(col)] as [number, number])
    : undefined;
  const statusEffect = STATUS_EFFECTS.includes(definition.statusEffect as StatusEffect)
    ? definition.statusEffect as StatusEffect
    : undefined;
  return {
    typeId: expectedPoolType,
    title: definition.title,
    damage: Math.max(0, definition.damage ?? 0),
    ...(pattern?.length ? { pattern } : {}),
    ...(Number.isFinite(definition.duration) ? { duration: Math.max(1, Math.floor(definition.duration ?? 1)) } : {}),
    ...(statusEffect ? { statusEffect } : {}),
    ...(Number.isFinite(definition.statusDuration) ? { statusDuration: Math.max(1, Math.floor(definition.statusDuration ?? 1)) } : {}),
    ...(Number.isFinite(definition.maxStacks) ? { maxStacks: Math.max(1, Math.floor(definition.maxStacks ?? 1)) } : {}),
    affects: POOL_TARGETS.includes(definition.affects as typeof POOL_TARGETS[number]) ? definition.affects : 'foes',
    ...(typeof definition.accent === 'string' ? { accent: definition.accent } : {})
  };
}

export class DiceCatalog {
  private readonly definitions = new Map<string, DiceDefinition>();
  private readonly pools = new Map<string, PoolDefinition>();

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

    const poolDirectory = path.resolve(directory, '..', 'PoolDefinitions');
    if (!fs.existsSync(poolDirectory)) return;
    const poolFlags = readJson<PoolFlags>(path.join(poolDirectory, 'Flags.json'));
    if (!Array.isArray(poolFlags.typeIds)) throw new Error('Pool catalog flags are malformed.');
    for (const rawPoolType of poolFlags.typeIds) {
      const typeId = normalizeTypeId(rawPoolType);
      if (!typeId) continue;
      const filePath = path.join(poolDirectory, `${typeId}.pool`);
      if (!fs.existsSync(filePath)) continue;
      const definition = normalizePoolDefinition(readJson<unknown>(filePath), typeId);
      if (definition) this.pools.set(typeId, definition);
    }
  }

  get(typeId: string): DiceDefinition | undefined {
    return this.definitions.get(typeId);
  }

  getPool(typeId: string): PoolDefinition | undefined {
    return this.pools.get(typeId);
  }

  has(typeId: string): boolean {
    return this.definitions.has(typeId);
  }

  typeIds(): string[] {
    return [...this.definitions.keys()];
  }
}

export const diceCatalog = new DiceCatalog();

export const poolCatalog = {
  get: (typeId: string): PoolDefinition | undefined => diceCatalog.getPool(typeId)
};
