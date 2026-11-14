import type { CombatDie, CombatState, DiceDefinition, OwnerId } from './types.js';

export type DiceCardRarity = 'Bronze' | 'Silver' | 'Gold';
export type DiceCardKind =
  | 'Type Upgrade'
  | 'Fountain of Love'
  | 'Mana Potion'
  | 'Spotlight'
  | 'Giant Hunter'
  | 'Odd Investment'
  | 'Even Investment'
  | 'Crowd Attack'
  | 'Fire Support'
  | 'Vanguard'
  | 'Centreline'
  | 'Straight Face'
  | 'Royal Obedience';

export interface DiceCard {
  key: string;
  title: string;
  rarity: DiceCardRarity;
  kind: DiceCardKind;
  typeId?: string;
}

export const DICE_CARD_OFFER_TURNS = [2, 4, 6, 8, 10] as const;

export const DICE_CARD_RARITY_FALLBACKS: Record<DiceCardRarity, readonly DiceCardRarity[]> = {
  Bronze: ['Bronze', 'Silver', 'Gold'],
  Silver: ['Silver', 'Bronze', 'Gold'],
  Gold: ['Gold', 'Silver', 'Bronze']
};

export const DICE_CARD_VALUES = {
  typeUpgradeRate: [0, 0.5, 0.75, 1],
  fountainHealRate: [0, 0.1, 0.15, 0.2],
  manaPotionGain: [0, 1, 2, 3],
  spotlightRate: [0, 0.2, 0.3, 0.4],
  giantHunterRate: [0, 0.01, 0.02, 0.03],
  investmentDamage: [0, 0.2, 0.3, 0.4],
  investmentReduction: [0, 0.1, 0.15, 0.2],
  crowdDamage: [0, 0.2, 0.3, 0.4],
  crowdReduction: [0, 0.1, 0.15, 0.2],
  fireSupportAttacks: [0, 1, 2, 3],
  vanguardReduction: [0, 0.2, 0.3, 0.4],
  centrelineDamage: [0, 0.2, 0.4, 0.6],
  straightFaceRate: [0, 0.2, 0.3, 0.4],
  royalObedienceRate: [0, 0.3, 0.45, 0.6]
} as const;

export const DICE_CARD_KINDS: readonly DiceCardKind[] = [
  'Fountain of Love',
  'Mana Potion',
  'Spotlight',
  'Giant Hunter',
  'Odd Investment',
  'Even Investment',
  'Crowd Attack',
  'Fire Support',
  'Vanguard',
  'Centreline',
  'Straight Face',
  'Royal Obedience'
];

const LEGENDARY_RANK = 4;
const RARITY_RANK: Record<string, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Epic: 3,
  Legendary: LEGENDARY_RANK,
  Mythic: 5
};

function cardValue(values: readonly number[], magnitude: number): number {
  return values[magnitude] ?? 0;
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
  if (!Number.isFinite(turn) || !Number.isFinite(picksUsed) || picksUsed < 0) return false;
  if (picksUsed >= DICE_CARD_OFFER_TURNS.length) return false;
  return turn === DICE_CARD_OFFER_TURNS[picksUsed];
}

export function getDiceCardsForOwner(state: CombatState, ownerId: OwnerId): DiceCard[] {
  return state.diceCards?.[ownerId] ?? [];
}

export function getDiceCardActiveKeys(state: CombatState): Set<string> {
  const keys = new Set<string>();
  state.diceCards?.player.forEach((card) => keys.add(card.key));
  state.diceCards?.enemy.forEach((card) => keys.add(card.key));
  return keys;
}

export function getEligibleUpgradeTypes(
  ownerId: OwnerId,
  dice: CombatDie[],
  getDefinition: (typeId: string) => DiceDefinition | undefined
): string[] {
  const active = new Set(
    dice
      .filter((die) => die.ownerId === ownerId && !die.isDestroyed && (die.zone === 'hand' || die.zone === 'board'))
      .map((die) => die.typeId)
  );
  return [...active].filter((typeId) => Boolean(getDefinition(typeId)));
}

export function rollDiceCards(
  count: number,
  rarity: DiceCardRarity,
  ownerId: OwnerId,
  dice: CombatDie[],
  getDefinition: (typeId: string) => DiceDefinition | undefined,
  activeKeys: Set<string>,
  rng: () => number
): DiceCard[] {
  const upgradeTypes = getEligibleUpgradeTypes(ownerId, dice, getDefinition);
  const buildPool = (poolRarity: DiceCardRarity): DiceCard[] => {
    const base: DiceCard[] = DICE_CARD_KINDS.map((kind) => ({
      key: `${kind}:${poolRarity}`,
      title: kind,
      rarity: poolRarity,
      kind
    }));
    const upgrades: DiceCard[] = upgradeTypes.map((typeId) => {
      const displayName = getDefinition(typeId)?.title.replace(/\s+Dice$/i, '') ?? typeId;
      return {
        key: `${typeId} Upgrade:${poolRarity}`,
        title: `${displayName} Upgrade`,
        rarity: poolRarity,
        kind: 'Type Upgrade',
        typeId
      };
    });
    return [...base, ...upgrades].filter((card) => !activeKeys.has(card.key));
  };

  const out: DiceCard[] = [];
  for (const poolRarity of DICE_CARD_RARITY_FALLBACKS[rarity] ?? [rarity]) {
    const local = buildPool(poolRarity);
    while (out.length < count && local.length > 0) {
      const index = Math.floor(rng() * local.length);
      const [card] = local.splice(index, 1);
      if (card) out.push(card);
    }
    if (out.length >= count) break;
  }
  return out;
}

export function isBelowLegendaryRarity(rarity: string): boolean {
  return (RARITY_RANK[rarity] ?? 0) < LEGENDARY_RANK;
}

export function resolveDiceCardMaxHealth(
  baseHealth: number,
  cards: readonly DiceCard[],
  typeId: string,
  belowLegendary: boolean
): number {
  let maxHealth = Math.max(1, Math.floor(Number.isFinite(baseHealth) ? baseHealth : 1));
  cards.forEach((card) => {
    const magnitude = getDiceCardMagnitude(card.rarity);
    const rate = card.kind === 'Type Upgrade' && card.typeId === typeId
      ? cardValue(DICE_CARD_VALUES.typeUpgradeRate, magnitude)
      : card.kind === 'Straight Face' && belowLegendary
        ? cardValue(DICE_CARD_VALUES.straightFaceRate, magnitude)
        : 0;
    if (rate > 0) maxHealth = Math.max(1, Math.floor(maxHealth * (1 + rate)));
  });
  return maxHealth;
}

export function applyDiceCardToState(
  state: CombatState,
  definitions: Map<string, DiceDefinition>,
  ownerId: OwnerId,
  card: DiceCard
): void {
  state.diceCards ??= { player: [], enemy: [] };
  state.diceCards[ownerId].push(card);
  const magnitude = getDiceCardMagnitude(card.rarity);
  if (card.kind === 'Type Upgrade' && card.typeId) {
    const rate = cardValue(DICE_CARD_VALUES.typeUpgradeRate, magnitude);
    state.dice.forEach((die) => {
      if (die.ownerId !== ownerId || die.typeId !== card.typeId) return;
      const boostedMax = Math.max(1, Math.floor(die.maxHealth * (1 + rate)));
      const maxDelta = Math.max(0, boostedMax - die.maxHealth);
      die.maxHealth = boostedMax;
      die.currentHealth = Math.min(boostedMax, Math.max(1, die.currentHealth + maxDelta));
    });
  }
  if (card.kind === 'Straight Face') {
    const rate = cardValue(DICE_CARD_VALUES.straightFaceRate, magnitude);
    state.dice.forEach((die) => {
      if (die.ownerId !== ownerId) return;
      const definition = definitions.get(die.instanceId);
      if (definition && !isBelowLegendaryRarity(definition.rarity)) return;
      const boostedMax = Math.max(1, Math.floor(die.maxHealth * (1 + rate)));
      const maxDelta = Math.max(0, boostedMax - die.maxHealth);
      die.maxHealth = boostedMax;
      die.currentHealth = Math.min(boostedMax, Math.max(1, die.currentHealth + maxDelta));
    });
  }
}

export function getDiceCardTypeUpgradeRate(state: CombatState, die: CombatDie): number {
  return getDiceCardsForOwner(state, die.ownerId)
    .filter((card) => card.kind === 'Type Upgrade' && card.typeId === die.typeId)
    .reduce((total, card) => total + cardValue(DICE_CARD_VALUES.typeUpgradeRate, getDiceCardMagnitude(card.rarity)), 0);
}

export function getDiceCardFountainRate(state: CombatState, ownerId: OwnerId): number {
  return getDiceCardsForOwner(state, ownerId)
    .filter((card) => card.kind === 'Fountain of Love')
    .reduce((total, card) => total + cardValue(DICE_CARD_VALUES.fountainHealRate, getDiceCardMagnitude(card.rarity)), 0);
}

export function getDiceCardManaPotionGain(state: CombatState, ownerId: OwnerId): number {
  return getDiceCardsForOwner(state, ownerId)
    .filter((card) => card.kind === 'Mana Potion')
    .reduce((total, card) => total + cardValue(DICE_CARD_VALUES.manaPotionGain, getDiceCardMagnitude(card.rarity)), 0);
}

export function getDiceCardGiantHunterRate(state: CombatState, ownerId: OwnerId): number {
  return getDiceCardsForOwner(state, ownerId)
    .filter((card) => card.kind === 'Giant Hunter')
    .reduce((total, card) => total + cardValue(DICE_CARD_VALUES.giantHunterRate, getDiceCardMagnitude(card.rarity)), 0);
}

export function getDiceCardGiantHunterBonus(
  state: CombatState,
  ownerId: OwnerId,
  targetMaxHealth: number,
  bossEffectiveness = 0.25
): number {
  const rate = getDiceCardGiantHunterRate(state, ownerId);
  if (rate <= 0) return 0;
  const bonus = Math.max(0, Math.floor(targetMaxHealth * rate));
  return bossEffectiveness < 1 ? Math.floor(bonus * bossEffectiveness) : bonus;
}

export function getDiceCardFireSupportBonus(state: CombatState, die: CombatDie): number {
  if (!die.gridPosition) return 0;
  const isBackline = die.ownerId === 'player'
    ? die.gridPosition.col === 0
    : die.gridPosition.col === 4;
  if (!isBackline) return 0;
  return getDiceCardsForOwner(state, die.ownerId)
    .filter((card) => card.kind === 'Fire Support')
    .reduce((total, card) => total + cardValue(DICE_CARD_VALUES.fireSupportAttacks, getDiceCardMagnitude(card.rarity)), 0);
}

function getInvestment(
  state: CombatState,
  ownerId: OwnerId,
  kind: 'Odd Investment' | 'Even Investment',
  key: 'investmentDamage' | 'investmentReduction'
): number {
  return getDiceCardsForOwner(state, ownerId)
    .filter((card) => card.kind === kind)
    .reduce((total, card) => total + cardValue(DICE_CARD_VALUES[key], getDiceCardMagnitude(card.rarity)), 0);
}

function getCrowd(
  state: CombatState,
  ownerId: OwnerId,
  key: 'crowdDamage' | 'crowdReduction'
): number {
  return getDiceCardsForOwner(state, ownerId)
    .filter((card) => card.kind === 'Crowd Attack')
    .reduce((total, card) => total + cardValue(DICE_CARD_VALUES[key], getDiceCardMagnitude(card.rarity)), 0);
}

function getSpotlightRate(state: CombatState, die: CombatDie): number {
  if (die.pips !== 3) return 0;
  return getDiceCardsForOwner(state, die.ownerId)
    .filter((card) => card.kind === 'Spotlight')
    .reduce((total, card) => total + cardValue(DICE_CARD_VALUES.spotlightRate, getDiceCardMagnitude(card.rarity)), 0);
}

function getCentrelineRate(state: CombatState, die: CombatDie): number {
  if (die.gridPosition?.col !== 2) return 0;
  return getDiceCardsForOwner(state, die.ownerId)
    .filter((card) => card.kind === 'Centreline')
    .reduce((total, card) => total + cardValue(DICE_CARD_VALUES.centrelineDamage, getDiceCardMagnitude(card.rarity)), 0);
}

function getRarityRate(state: CombatState, die: CombatDie, definition: DiceDefinition | undefined): number {
  const rank = RARITY_RANK[definition?.rarity ?? ''] ?? 0;
  return getDiceCardsForOwner(state, die.ownerId)
    .filter((card) => (
      rank < LEGENDARY_RANK
        ? card.kind === 'Straight Face'
        : card.kind === 'Royal Obedience'
    ))
    .reduce((total, card) => total + (
      rank < LEGENDARY_RANK
        ? cardValue(DICE_CARD_VALUES.straightFaceRate, getDiceCardMagnitude(card.rarity))
        : cardValue(DICE_CARD_VALUES.royalObedienceRate, getDiceCardMagnitude(card.rarity))
    ), 0);
}

export function getDiceCardOffenseMultiplier(
  state: CombatState,
  die: CombatDie,
  definition: DiceDefinition | undefined
): number {
  const typeBoost = 1 + Math.max(0, getDiceCardTypeUpgradeRate(state, die));
  const investment = die.pips % 2 === 0
    ? getInvestment(state, die.ownerId, 'Even Investment', 'investmentDamage')
    : getInvestment(state, die.ownerId, 'Odd Investment', 'investmentDamage');
  const crowd = die.pips === 1 || die.pips === 2 ? getCrowd(state, die.ownerId, 'crowdDamage') : 0;
  const additive = getSpotlightRate(state, die)
    + investment
    + crowd
    + getCentrelineRate(state, die)
    + getRarityRate(state, die, definition);
  return typeBoost * (1 + additive);
}

export function getDiceCardReduction(state: CombatState, die: CombatDie): number {
  const spotlight = getSpotlightRate(state, die);
  const vanguard = die.gridPosition && (die.ownerId === 'player' ? die.gridPosition.col === 4 : die.gridPosition.col === 0)
    ? getDiceCardsForOwner(state, die.ownerId)
      .filter((card) => card.kind === 'Vanguard')
      .reduce((total, card) => total + cardValue(DICE_CARD_VALUES.vanguardReduction, getDiceCardMagnitude(card.rarity)), 0)
    : 0;
  const investment = die.pips % 2 === 0
    ? getInvestment(state, die.ownerId, 'Even Investment', 'investmentReduction')
    : getInvestment(state, die.ownerId, 'Odd Investment', 'investmentReduction');
  const crowd = die.pips === 1 || die.pips === 2 ? getCrowd(state, die.ownerId, 'crowdReduction') : 0;
  const remaining = [spotlight, vanguard, investment, crowd]
    .reduce((value, rate) => value * (1 - Math.max(0, rate)), 1);
  return Math.max(0, Math.min(0.95, 1 - remaining));
}
