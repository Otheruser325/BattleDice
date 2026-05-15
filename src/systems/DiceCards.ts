import type { DiceDefinition, DiceInstanceState } from '../types/game';

export type DiceCardRarity = 'Bronze' | 'Silver' | 'Gold';
export type DiceCardKind = 'Fountain of Love' | 'Mana Potion' | 'Spotlight' | 'Type Upgrade';

export interface DiceCard {
  key: string;
  title: string;
  rarity: DiceCardRarity;
  kind: DiceCardKind;
  typeId?: string;
}

export interface DiceCardRuntimeState {
  activeKeys: Set<string>;
  picksUsed: number;
}

export function getDiceCardRarityRoll(rng: () => number): DiceCardRarity {
  const n = rng();
  if (n < 0.6) return 'Bronze';
  if (n < 0.9) return 'Silver';
  return 'Gold';
}

export function getDiceCardMagnitude(rarity: DiceCardRarity): number {
  if (rarity === 'Bronze') return 1;
  if (rarity === 'Silver') return 2;
  return 3;
}

export function canOfferDiceCards(turn: number, picksUsed: number): boolean {
  if (picksUsed >= 5) return false;
  if (turn > 10) return false;
  return turn >= 2 && turn % 2 === 0;
}

export function getEligibleUpgradeTypes(ownerId: 'player' | 'enemy', dice: DiceInstanceState[], definitions: Map<string, DiceDefinition>): string[] {
  const active = new Set(
    dice
      .filter((d) => d.ownerId === ownerId && !d.isDestroyed && (d.zone === 'hand' || d.zone === 'board'))
      .map((d) => d.typeId)
  );
  return [...active].filter((typeId) => definitions.has(typeId));
}

export function rollDiceCards(
  count: number,
  rarity: DiceCardRarity,
  ownerId: 'player' | 'enemy',
  dice: DiceInstanceState[],
  definitions: Map<string, DiceDefinition>,
  activeKeys: Set<string>,
  rng: () => number
): DiceCard[] {
  const upgradeTypes = getEligibleUpgradeTypes(ownerId, dice, definitions);
  const base: DiceCard[] = [
    { key: `Fountain of Love:${rarity}`, title: 'Fountain of Love', rarity, kind: 'Fountain of Love' },
    { key: `Mana Potion:${rarity}`, title: 'Mana Potion', rarity, kind: 'Mana Potion' },
    { key: `Spotlight:${rarity}`, title: 'Spotlight', rarity, kind: 'Spotlight' }
  ];
  const upgrades: DiceCard[] = upgradeTypes.map((typeId) => ({ key: `${typeId} Upgrade:${rarity}`, title: `${typeId} Upgrade`, rarity, kind: 'Type Upgrade', typeId }));
  const pool: DiceCard[] = [...base, ...upgrades].filter((card) => !activeKeys.has(card.key));

  const out: DiceCard[] = [];
  const local = [...pool];
  while (out.length < count && local.length > 0) {
    const idx = Math.floor(rng() * local.length);
    out.push(local.splice(idx, 1)[0]);
  }
  return out;
}
