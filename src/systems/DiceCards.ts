import type { DiceDefinition, DiceInstanceState } from '../types/game';

export type DiceCardRarity = 'Bronze' | 'Silver' | 'Gold';
export type DiceCardKind = 'Type Upgrade' | 'Fountain of Love' | 'Mana Potion' | 'Spotlight' | 'Giant Hunter' | 'Odd Investment' | 'Even Investment' | 'Crowd Attack' | 'Fire Support' | 'Vanguard' | 'Centreline' | 'Straight Face' | 'Royal Obedience';
export const DUNGEON_DICE_CARD_PICK_LIMIT = 20;
export const DICE_CARD_OFFER_TURNS = [2, 4, 6, 8, 10] as const;
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

export interface DiceCardInfo {
  icon: string;
  title: string;
  rarity: string;
  desc: string;
  color?: string;
}

export interface DiceCardRuntimeContribution {
  fountainHealRate: number;
  manaPotionGain: number;
  spotlightRate: number;
  typeUpgradeRate: number;
  giantHunterRate: number;
  oddInvestmentDamage: number;
  oddInvestmentReduction: number;
  evenInvestmentDamage: number;
  evenInvestmentReduction: number;
  crowdAttackDamage: number;
  crowdAttackReduction: number;
  fireSupportAttacks: number;
  vanguardReduction: number;
  centrelineDamage: number;
  straightFaceRate: number;
  royalObedienceRate: number;
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

function formatDiceCardPercent(rate: number): string {
  return `${Number((rate * 100).toFixed(2))}%`;
}

export function isDiceCardTypeUpgradeKey(key: string): boolean {
  return (key.split(':')[0] ?? '').endsWith(' Upgrade');
}

export function getDiceCardInfo(
  key: string,
  resolveTypeTitle?: (typeId: string) => string | undefined
): DiceCardInfo {
  const [name, rawRarity = ''] = key.split(':');
  const rarity = rawRarity || 'Bronze';
  const mag = getDiceCardMagnitude(rarity as DiceCardRarity);
  if (name.endsWith(' Upgrade')) {
    const typeId = name.replace(/ Upgrade$/, '');
    const typeName = (resolveTypeTitle?.(typeId) ?? typeId).replace(/\s+Dice$/i, '');
    const dieFaceByRarity: Record<string, string> = { Bronze: '⚃', Silver: '⚄', Gold: '⚅' };
    const colorByRarity: Record<string, string> = { Bronze: '#cd7f32', Silver: '#c0c0c0', Gold: '#ffd700' };
    return {
      icon: dieFaceByRarity[rarity] ?? '⚅',
      color: colorByRarity[rarity] ?? '#ffd700',
      title: `${typeName} Upgrade`,
      rarity,
      desc: `${typeName} gets +${formatDiceCardPercent(DICE_CARD_VALUES.typeUpgradeRate[mag])} basic+skill damage and max HP.`
    };
  }
  if (name === 'Fountain of Love') {
    return {
      icon: '💖',
      title: name,
      rarity,
      desc: `On Combat End: all friendly dice heal for ${formatDiceCardPercent(DICE_CARD_VALUES.fountainHealRate[mag])} of their max HP.`
    };
  }
  if (name === 'Mana Potion') {
    return { icon: '🧪', title: name, rarity, desc: `On Combat Start: all friendly dice gain +${mag} mana.` };
  }
  if (name === 'Spotlight') {
    const pct = formatDiceCardPercent(DICE_CARD_VALUES.spotlightRate[mag]);
    return { icon: '🔦', title: name, rarity, desc: `Passive: 3-pip dice gain ${pct} damage reduction and ${pct} more damage.` };
  }
  if (name === 'Odd Investment') {
    const dmg = formatDiceCardPercent(DICE_CARD_VALUES.investmentDamage[mag]);
    const red = formatDiceCardPercent(DICE_CARD_VALUES.investmentReduction[mag]);
    return { icon: '🌓', title: name, rarity, desc: `Passive: odd effective-pip dice gain +${dmg} damage and ${red} damage reduction.` };
  }
  if (name === 'Even Investment') {
    const dmg = formatDiceCardPercent(DICE_CARD_VALUES.investmentDamage[mag]);
    const red = formatDiceCardPercent(DICE_CARD_VALUES.investmentReduction[mag]);
    return { icon: '🌗', title: name, rarity, desc: `Passive: even effective-pip dice gain +${dmg} damage and ${red} damage reduction.` };
  }
  if (name === 'Straight Face') {
    const pct = formatDiceCardPercent(DICE_CARD_VALUES.straightFaceRate[mag]);
    return { icon: '😐', title: name, rarity, desc: `Passive: friendly dice below Legendary rarity gain +${pct} max HP and attack.` };
  }
  if (name === 'Royal Obedience') {
    const pct = formatDiceCardPercent(DICE_CARD_VALUES.royalObedienceRate[mag]);
    return { icon: '👑', title: name, rarity, desc: `Passive: friendly Legendary and Mythic dice gain +${pct} attack.` };
  }
  if (name === 'Giant Hunter') {
    const pct = formatDiceCardPercent(DICE_CARD_VALUES.giantHunterRate[mag]);
    return { icon: '🗡️', title: name, rarity, desc: `Passive: direct damage adds ${pct} target max HP.` };
  }
  if (name === 'Crowd Attack') {
    const dmg = formatDiceCardPercent(DICE_CARD_VALUES.crowdDamage[mag]);
    const red = formatDiceCardPercent(DICE_CARD_VALUES.crowdReduction[mag]);
    return { icon: '👥', title: name, rarity, desc: `Passive: dice with 1 or 2 pips gain +${dmg} damage and ${red} damage reduction.` };
  }
  if (name === 'Fire Support') {
    const attacks = DICE_CARD_VALUES.fireSupportAttacks[mag];
    return { icon: '🏹', title: name, rarity, desc: `Passive: dice placed on the backline gain +${attacks} attack count${attacks === 1 ? '' : 's'}.` };
  }
  if (name === 'Vanguard') {
    const pct = formatDiceCardPercent(DICE_CARD_VALUES.vanguardReduction[mag]);
    return { icon: '🛡️', title: name, rarity, desc: `Passive: frontline dice gain ${pct} damage reduction.` };
  }
  if (name === 'Centreline') {
    const pct = formatDiceCardPercent(DICE_CARD_VALUES.centrelineDamage[mag]);
    return { icon: '🎯', title: name, rarity, desc: `Passive: centre-column dice gain +${pct} damage.` };
  }
  return { icon: '🎴', title: name, rarity, desc: '' };
}

export function getDiceCardRuntimeContribution(card: DiceCard): DiceCardRuntimeContribution {
  const mag = getDiceCardMagnitude(card.rarity);
  const contribution: DiceCardRuntimeContribution = {
    fountainHealRate: 0,
    manaPotionGain: 0,
    spotlightRate: 0,
    typeUpgradeRate: 0,
    giantHunterRate: 0,
    oddInvestmentDamage: 0,
    oddInvestmentReduction: 0,
    evenInvestmentDamage: 0,
    evenInvestmentReduction: 0,
    crowdAttackDamage: 0,
    crowdAttackReduction: 0,
    fireSupportAttacks: 0,
    vanguardReduction: 0,
    centrelineDamage: 0,
    straightFaceRate: 0,
    royalObedienceRate: 0
  };
  switch (card.kind) {
    case 'Fountain of Love':
      contribution.fountainHealRate = DICE_CARD_VALUES.fountainHealRate[mag];
      break;
    case 'Mana Potion':
      contribution.manaPotionGain = DICE_CARD_VALUES.manaPotionGain[mag];
      break;
    case 'Spotlight':
      contribution.spotlightRate = DICE_CARD_VALUES.spotlightRate[mag];
      break;
    case 'Type Upgrade':
      contribution.typeUpgradeRate = DICE_CARD_VALUES.typeUpgradeRate[mag];
      break;
    case 'Giant Hunter':
      contribution.giantHunterRate = DICE_CARD_VALUES.giantHunterRate[mag];
      break;
    case 'Odd Investment':
      contribution.oddInvestmentDamage = DICE_CARD_VALUES.investmentDamage[mag];
      contribution.oddInvestmentReduction = DICE_CARD_VALUES.investmentReduction[mag];
      break;
    case 'Even Investment':
      contribution.evenInvestmentDamage = DICE_CARD_VALUES.investmentDamage[mag];
      contribution.evenInvestmentReduction = DICE_CARD_VALUES.investmentReduction[mag];
      break;
    case 'Crowd Attack':
      contribution.crowdAttackDamage = DICE_CARD_VALUES.crowdDamage[mag];
      contribution.crowdAttackReduction = DICE_CARD_VALUES.crowdReduction[mag];
      break;
    case 'Fire Support':
      contribution.fireSupportAttacks = DICE_CARD_VALUES.fireSupportAttacks[mag];
      break;
    case 'Vanguard':
      contribution.vanguardReduction = DICE_CARD_VALUES.vanguardReduction[mag];
      break;
    case 'Centreline':
      contribution.centrelineDamage = DICE_CARD_VALUES.centrelineDamage[mag];
      break;
    case 'Straight Face':
      contribution.straightFaceRate = DICE_CARD_VALUES.straightFaceRate[mag];
      break;
    case 'Royal Obedience':
      contribution.royalObedienceRate = DICE_CARD_VALUES.royalObedienceRate[mag];
      break;
  }
  return contribution;
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
      ? DICE_CARD_VALUES.typeUpgradeRate[magnitude]
      : card.kind === 'Straight Face' && belowLegendary
        ? DICE_CARD_VALUES.straightFaceRate[magnitude]
        : 0;
    if (rate > 0) maxHealth = Math.max(1, Math.floor(maxHealth * (1 + rate)));
  });
  return maxHealth;
}

export function canOfferDiceCards(turn: number, picksUsed: number, endless = false): boolean {
  if (!Number.isFinite(turn) || !Number.isFinite(picksUsed) || picksUsed < 0) return false;
  if (endless) {
    return turn >= 2 && turn % 2 === 0 && picksUsed < DUNGEON_DICE_CARD_PICK_LIMIT;
  }
  if (picksUsed >= DICE_CARD_OFFER_TURNS.length) return false;
  return turn === DICE_CARD_OFFER_TURNS[picksUsed];
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
    const base: DiceCard[] = DICE_CARD_KINDS.map((kind) => ({
      key: `${kind}:${poolRarity}`,
      title: kind,
      rarity: poolRarity,
      kind
    }));
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
