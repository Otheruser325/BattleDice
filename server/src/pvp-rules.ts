import { randomInt } from 'node:crypto';
import { diceCatalog } from './combat/catalog.js';
import type { LoadoutEntry, MatchRules, RandomModeModifier } from './combat/types.js';

/**
 * PvP guest identities cannot prove their local PvE progression. The server
 * therefore uses a fixed baseline loadout instead of trusting client class or
 * talent values; a trusted progression source would be required to enable them.
 */
export const PVP_CLASS_LEVEL = 1;
export const PVP_RANDOM_MODIFIERS: readonly RandomModeModifier[] = [
  'Classic',
  'Combanity',
  'Duality',
  'Necromancy',
  'DiceCard'
];

export function isPvPTypeIdAllowed(typeId: string): boolean {
  const definition = diceCatalog.get(typeId);
  return Boolean(definition && !definition.isBoss && !diceCatalog.isExclusive(typeId));
}

export function normalizePvpLoadout(loadout: LoadoutEntry[]): LoadoutEntry[] {
  return loadout.map((entry) => ({
    typeId: entry.typeId,
    classLevel: PVP_CLASS_LEVEL,
    talentIndex: null
  }));
}

export function normalizePvpRules(rules: MatchRules): MatchRules {
  const randomizeLoadout = rules.randomizeLoadout === true;
  return {
    useLevelling: randomizeLoadout,
    turnLimit: rules.turnLimit,
    randomMode: rules.randomMode,
    randomizeLoadout
  };
}

export function pickPvpRandomModifier(): RandomModeModifier {
  return PVP_RANDOM_MODIFIERS[randomInt(PVP_RANDOM_MODIFIERS.length)] ?? 'Classic';
}

export function createRandomPvpLoadout(useLevelling: boolean): LoadoutEntry[] {
  const pool = diceCatalog.typeIds().filter(isPvPTypeIdAllowed);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const current = pool[index];
    pool[index] = pool[swapIndex] as string;
    pool[swapIndex] = current as string;
  }
  return pool.slice(0, 5).map((typeId) => ({
    typeId,
    classLevel: useLevelling ? randomInt(1, 16) : PVP_CLASS_LEVEL,
    talentIndex: null
  }));
}
