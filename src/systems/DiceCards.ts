import type { DiceDefinition, DiceInstanceState } from '../types/game';

export type DiceCardRarity = 'Bronze' | 'Silver' | 'Gold';
export type DiceCardKind = 'Type Upgrade' | 'Fountain of Love' | 'Mana Potion' | 'Spotlight' | 'Giant Hunter' | 'Odd Investment' | 'Even Investment' | 'Crowd Attack' | 'Fire Support' | 'Vanguard' | 'Centreline' | 'Straight Face' | 'Royal Obedience';
export const DUNGEON_DICE_CARD_PICK_LIMIT = 20;

const DICE_CARD_RARITY_FALLBACKS: Record<DiceCardRarity, readonly DiceCardRarity[]> = {
  Bronze: ['Bronze', 'Silver', 'Gold'],
  Silver: ['Silver', 'Bronze', 'Gold'],
  Gold: ['Gold', 'Silver', 'Bronze']
};

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

export function canOfferDiceCards(turn: number, picksUsed: number, endless = false): boolean {
  if (!Number.isFinite(turn) || !Number.isFinite(picksUsed) || picksUsed < 0) return false;
  if (endless) {
    return turn >= 2 && turn % 2 === 0 && picksUsed < DUNGEON_DICE_CARD_PICK_LIMIT;
  }
  const offerTurns = [2, 4, 6, 8, 10];
  if (picksUsed >= offerTurns.length) return false;
  return turn === offerTurns[picksUsed];
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
  const buildPool = (poolRarity: DiceCardRarity): DiceCard[] => {
    const base: DiceCard[] = [
      { key: `Fountain of Love:${poolRarity}`, title: 'Fountain of Love', rarity: poolRarity, kind: 'Fountain of Love' },
      { key: `Mana Potion:${poolRarity}`, title: 'Mana Potion', rarity: poolRarity, kind: 'Mana Potion' },
      { key: `Spotlight:${poolRarity}`, title: 'Spotlight', rarity: poolRarity, kind: 'Spotlight' },
      { key: `Giant Hunter:${poolRarity}`, title: 'Giant Hunter', rarity: poolRarity, kind: 'Giant Hunter' },
      { key: `Odd Investment:${poolRarity}`, title: 'Odd Investment', rarity: poolRarity, kind: 'Odd Investment' },
      { key: `Even Investment:${poolRarity}`, title: 'Even Investment', rarity: poolRarity, kind: 'Even Investment' },
      { key: `Crowd Attack:${poolRarity}`, title: 'Crowd Attack', rarity: poolRarity, kind: 'Crowd Attack' },
      { key: `Fire Support:${poolRarity}`, title: 'Fire Support', rarity: poolRarity, kind: 'Fire Support' },
      { key: `Vanguard:${poolRarity}`, title: 'Vanguard', rarity: poolRarity, kind: 'Vanguard' },
      { key: `Centreline:${poolRarity}`, title: 'Centreline', rarity: poolRarity, kind: 'Centreline' },
      { key: `Straight Face:${poolRarity}`, title: 'Straight Face', rarity: poolRarity, kind: 'Straight Face' },
      { key: `Royal Obedience:${poolRarity}`, title: 'Royal Obedience', rarity: poolRarity, kind: 'Royal Obedience' }
    ];
    const upgrades: DiceCard[] = upgradeTypes.map((typeId) => {
      const displayName = definitions.get(typeId)?.title?.replace(/\s+Dice$/i, '') ?? typeId;
      return { key: `${typeId} Upgrade:${poolRarity}`, title: `${displayName} Upgrade`, rarity: poolRarity, kind: 'Type Upgrade', typeId };
    });
    return [...base, ...upgrades].filter((card) => !activeKeys.has(card.key));
  };

  const out: DiceCard[] = [];
  for (const poolRarity of DICE_CARD_RARITY_FALLBACKS[rarity] ?? [rarity]) {
    const local = buildPool(poolRarity);
    while (out.length < count && local.length > 0) {
      const idx = Math.floor(rng() * local.length);
      out.push(local.splice(idx, 1)[0]);
    }
    if (out.length >= count) break;
  }
  return out;
}

export function normalizeDiceCardCarryover(cards: unknown): DiceCard[] {
  if (!Array.isArray(cards)) return [];
  const seen = new Set<string>();
  const result: DiceCard[] = [];
  cards.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    const card = raw as Partial<DiceCard>;
    if (typeof card.key !== 'string' || card.key.length === 0 || seen.has(card.key)) return;
    if (typeof card.title !== 'string' || card.title.length === 0) return;
    if (card.rarity !== 'Bronze' && card.rarity !== 'Silver' && card.rarity !== 'Gold') return;
    if (typeof card.kind !== 'string' || card.kind.length === 0) return;
    seen.add(card.key);
    result.push({
      key: card.key,
      title: card.title,
      rarity: card.rarity,
      kind: card.kind as DiceCardKind,
      ...(typeof card.typeId === 'string' ? { typeId: card.typeId } : {})
    });
  });
  return result;
}
