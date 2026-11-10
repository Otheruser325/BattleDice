import type Phaser from 'phaser';
import { DICE_STATUS_EFFECT_POOL, type DicePoolDefinition, type DicePoolFlags, type DicePoolTarget } from '../types/game';
import { DebugManager } from '../utils/DebugManager';
import { withBasePath } from '../utils/BuildEnv';

const POOL_FLAGS_PATH = withBasePath('gamedata/PoolDefinitions/Flags.json');
const POOL_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/;
const POOL_TARGETS: DicePoolTarget[] = ['foes', 'allies', 'both'];
const STATUS_EFFECTS = new Set<string>(DICE_STATUS_EFFECT_POOL);

function getDefinitionPath(typeId: string) {
  return withBasePath(`gamedata/PoolDefinitions/${typeId}.pool`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizePattern(value: unknown): Array<[number, number]> | undefined {
  if (!Array.isArray(value)) return undefined;
  const pattern = value.flatMap((entry): Array<[number, number]> => (
    Array.isArray(entry)
      && entry.length >= 2
      && typeof entry[0] === 'number'
      && Number.isFinite(entry[0])
      && typeof entry[1] === 'number'
      && Number.isFinite(entry[1])
      ? [[Math.trunc(entry[0]), Math.trunc(entry[1])]]
      : []
  ));
  return pattern.length > 0 ? pattern : undefined;
}

function normalizeSfx(value: unknown): string | string[] | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!Array.isArray(value)) return undefined;
  const keys = value
    .filter((key): key is string => typeof key === 'string')
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.length > 0 ? keys : undefined;
}

function normalizeDefinition(raw: unknown, expectedPoolType: string): DicePoolDefinition | undefined {
  if (!isRecord(raw) || raw.typeId !== expectedPoolType) return undefined;
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0) return undefined;
  const damage = typeof raw.damage === 'number' && Number.isFinite(raw.damage) ? Math.max(0, raw.damage) : undefined;
  if (damage === undefined) return undefined;
  const duration = typeof raw.duration === 'number' && Number.isFinite(raw.duration)
    ? Math.max(1, Math.floor(raw.duration))
    : undefined;
  const statusEffect = typeof raw.statusEffect === 'string' && STATUS_EFFECTS.has(raw.statusEffect)
    ? raw.statusEffect as DicePoolDefinition['statusEffect']
    : undefined;
  const affects = typeof raw.affects === 'string' && POOL_TARGETS.includes(raw.affects as DicePoolTarget)
    ? raw.affects as DicePoolTarget
    : 'foes';
  const lingerSfx = normalizeSfx(raw.lingerSfx);
  return {
    typeId: expectedPoolType,
    title: raw.title,
    damage,
    ...(normalizePattern(raw.pattern) ? { pattern: normalizePattern(raw.pattern) } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(statusEffect ? { statusEffect } : {}),
    ...(typeof raw.statusDuration === 'number' && Number.isFinite(raw.statusDuration)
      ? { statusDuration: Math.max(1, Math.floor(raw.statusDuration)) }
      : {}),
    ...(typeof raw.maxStacks === 'number' && Number.isFinite(raw.maxStacks)
      ? { maxStacks: Math.max(1, Math.floor(raw.maxStacks)) }
      : {}),
    affects,
    ...(lingerSfx ? { lingerSfx } : {}),
    ...(typeof raw.accent === 'string' ? { accent: raw.accent } : {})
  };
}

async function fetchPoolDefinition(
  typeId: string,
  debug: ReturnType<typeof DebugManager.scope>
): Promise<DicePoolDefinition | undefined> {
  const path = getDefinitionPath(typeId);
  try {
    const res = await fetch(path, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) {
      debug.warn('Pool definition HTTP error.', { typeId, path, status: res.status });
      return undefined;
    }
    const definition = normalizeDefinition(await res.json(), typeId);
    if (!definition) debug.warn('Pool definition is malformed.', { typeId, path });
    return definition;
  } catch (error) {
    debug.warn('Failed to fetch pool definition.', { typeId, path, error });
    return undefined;
  }
}

export class PoolCatalogLoader {
  static async loadDefinitions(scene: Phaser.Scene): Promise<DicePoolFlags> {
    const debug = DebugManager.scope('PoolCatalog');
    let flags: DicePoolFlags | undefined;
    try {
      const res = await fetch(POOL_FLAGS_PATH, { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) {
        const data = await res.json() as Partial<DicePoolFlags>;
        if (Array.isArray(data.typeIds)) flags = { typeIds: data.typeIds };
      }
    } catch (error) {
      debug.warn('Failed to fetch pool flags.', { path: POOL_FLAGS_PATH, error });
    }
    if (!flags) throw new Error('Pool Flags.json is missing or malformed.');

    const typeIds = [...new Set(flags.typeIds)]
      .filter((typeId): typeId is string => typeof typeId === 'string' && POOL_TYPE_PATTERN.test(typeId));
    if (typeIds.length === 0) throw new Error('No pool type ids were listed in Pool Flags.json.');

    const definitions = await Promise.all(typeIds.map((typeId) => fetchPoolDefinition(typeId, debug)));
    const loaded = definitions.filter((definition): definition is DicePoolDefinition => Boolean(definition));
    if (loaded.length === 0) throw new Error('No pool definitions were loaded.');

    loaded.forEach((definition) => scene.cache.json.add(`pool:${definition.typeId}`, definition));
    const loadedTypeIds = loaded.map((definition) => definition.typeId);
    scene.cache.json.add('pool:flags', { typeIds: loadedTypeIds });
    debug.log('Loaded pool definitions.', { requested: typeIds.length, loaded: loadedTypeIds.length });
    return { typeIds: loadedTypeIds };
  }
}
