import type Phaser from 'phaser';
import type { DiceFlags } from '../types/game';
import { DebugManager } from '../utils/DebugManager';
import { withBasePath } from '../utils/BuildEnv';

const DICE_FLAGS_PATHS = [
  withBasePath('gamedata/DiceDefinitions/Flags.json')
];

function getDefinitionPath(typeId: string) {
  return withBasePath(`gamedata/DiceDefinitions/${typeId}.dice`);
}

function getSubfolderDefinitionPath(entryPath: string | undefined, typeId: string) {
  const path = entryPath?.trim();
  if (!path) return getDefinitionPath(typeId);
  const normalized = path.replace(/^\/+/, '');
  return withBasePath(`gamedata/DiceDefinitions/${normalized}`);
}

function normalizeTypeId(typeId: unknown): string | undefined {
  if (typeof typeId !== 'string') return undefined;
  const trimmed = typeId.trim();
  return /^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(trimmed) ? trimmed : undefined;
}

interface ExclusiveDiceEntry {
  typeId: string;
  path?: string;
}

interface LoadedDiceDefinition {
  typeId: string;
  definition: unknown;
}

async function fetchDiceDefinition(typeId: string, path: string, debug: ReturnType<typeof DebugManager.scope>, label: string): Promise<LoadedDiceDefinition | undefined> {
  try {
    const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) {
      debug.warn(`${label} dice definition HTTP error.`, { typeId, path, status: res.status });
      return undefined;
    }
    const definition = await res.json();
    return { typeId, definition };
  } catch (error) {
    debug.warn(`Failed to fetch ${label.toLowerCase()} dice definition.`, { typeId, path, error });
    return undefined;
  }
}

async function loadDiceDefinitions(entries: { typeId: string; path: string; label: string }[], debug: ReturnType<typeof DebugManager.scope>): Promise<LoadedDiceDefinition[]> {
  const results = await Promise.allSettled(
    entries.map((entry) => fetchDiceDefinition(entry.typeId, entry.path, debug, entry.label))
  );

  return results
    .map((result) => result.status === 'fulfilled' ? result.value : undefined)
    .filter((definition): definition is LoadedDiceDefinition => Boolean(definition));
}

function normalizeExclusiveEntries(flags: DiceFlags): ExclusiveDiceEntry[] {
  return (flags.exclusiveTypeIds ?? [])
    .map((entry): ExclusiveDiceEntry | undefined => {
      if (typeof entry === 'string') {
        const typeId = normalizeTypeId(entry);
        return typeId ? { typeId } : undefined;
      }
      const typeId = normalizeTypeId(entry?.typeId);
      if (!typeId) return undefined;
      return { typeId, path: typeof entry.path === 'string' ? entry.path : undefined };
    })
    .filter((entry): entry is ExclusiveDiceEntry => Boolean(entry));
}

export class DiceCatalogLoader {
  static preloadFlags(_scene: Phaser.Scene) {}

  static async loadFetchableDefinitions(scene: Phaser.Scene): Promise<DiceFlags> {
    const debug = DebugManager.scope('DiceCatalog');
    let flags: DiceFlags | undefined;
    for (const path of DICE_FLAGS_PATHS) {
      try {
        const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) continue;
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.includes('application/json') && !path.endsWith('.json')) continue;
        const data = await res.json() as DiceFlags;
        if (Array.isArray(data?.fetchableTypeIds)) {
          flags = data;
          break;
        }
      } catch (error) {
        debug.warn('Failed to fetch flags path.', { path, error });
      }
    }

    if (!flags || !Array.isArray(flags.fetchableTypeIds)) {
      throw new Error('Dice Flags.json is missing or malformed.');
    }

    const fetchableTypeIds = [...new Set(flags.fetchableTypeIds)]
      .map(normalizeTypeId)
      .filter((typeId): typeId is string => Boolean(typeId));
    const exclusiveEntries = normalizeExclusiveEntries(flags);
    debug.log('Loading dice definitions from flags.', { fetchableTypeIds });

    if (!fetchableTypeIds.length) return { fetchableTypeIds: [] };

    const loadedDefinitions = await loadDiceDefinitions(
      fetchableTypeIds.map((typeId) => ({ typeId, path: getDefinitionPath(typeId), label: 'Fetchable' })),
      debug
    );
    const loadedTypeIds = loadedDefinitions.map(({ typeId, definition }) => {
      scene.cache.json.add(`dice:${typeId}`, definition);
      return typeId;
    });

    if (!loadedTypeIds.length) {
      throw new Error('No dice definitions were loaded.');
    }

    debug.log('Loaded dice definitions.', { requested: fetchableTypeIds.length, loaded: loadedTypeIds.length });

    const loadedExclusiveDefinitions = await loadDiceDefinitions(
      exclusiveEntries.map((entry) => ({ typeId: entry.typeId, path: getSubfolderDefinitionPath(entry.path, entry.typeId), label: 'Exclusive' })),
      debug
    );
    const loadedExclusiveTypeIds = loadedExclusiveDefinitions.map(({ typeId, definition }) => {
      scene.cache.json.add(`dice:${typeId}`, definition);
      return typeId;
    });
    scene.cache.json.add('dice:flags', { fetchableTypeIds: loadedTypeIds, exclusiveTypeIds: loadedExclusiveTypeIds });

    return { fetchableTypeIds: loadedTypeIds, exclusiveTypeIds: loadedExclusiveTypeIds };
  }
}
