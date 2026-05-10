export type ChestType = 'Bronze' | 'Silver' | 'Gold' | 'Diamond' | 'Master';
export type FivesComboType = 'No combo' | 'Pair' | 'Two Pair' | 'Three-of-a-kind' | 'Full House' | 'Small Straight' | 'Large Straight' | 'Four-of-a-kind' | 'Five-of-a-kind';

export interface ComboPayout {
  combo: FivesComboType;
  chestType: ChestType;
  chestCount: number;
  pipSum: number;
}

const sorted = (dice: number[]) => [...dice].sort((a, b) => a - b);

export function evaluateFivesCombo(dice: number[]): ComboPayout {
  const values = sorted(dice).slice(0, 5);
  const pipSum = values.reduce((a, b) => a + b, 0);
  const counts = new Map<number, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const groups = [...counts.values()].sort((a, b) => b - a);
  const unique = [...counts.keys()].sort((a, b) => a - b);
  const hasSmallStraight = [
    [1,2,3,4], [2,3,4,5], [3,4,5,6]
  ].some((seq) => seq.every((n) => unique.includes(n)));
  const isLargeStraight = unique.length === 5 && (unique.join(',') === '1,2,3,4,5' || unique.join(',') === '2,3,4,5,6');

  if (groups[0] === 5) return { combo: 'Five-of-a-kind', chestType: 'Master', chestCount: pipSum, pipSum };
  if (groups[0] === 4) return { combo: 'Four-of-a-kind', chestType: 'Diamond', chestCount: pipSum, pipSum };
  if (groups[0] === 3 && groups[1] === 2) return { combo: 'Full House', chestType: 'Diamond', chestCount: pipSum, pipSum };
  if (isLargeStraight) return { combo: 'Large Straight', chestType: 'Gold', chestCount: pipSum, pipSum };
  if (hasSmallStraight) return { combo: 'Small Straight', chestType: 'Silver', chestCount: pipSum, pipSum };
  if (groups[0] === 3) return { combo: 'Three-of-a-kind', chestType: 'Gold', chestCount: pipSum, pipSum };
  if (groups[0] === 2 && groups[1] === 2) return { combo: 'Two Pair', chestType: 'Silver', chestCount: pipSum, pipSum };
  if (groups[0] === 2) return { combo: 'Pair', chestType: 'Bronze', chestCount: pipSum, pipSum };
  return { combo: 'No combo', chestType: 'Bronze', chestCount: 5, pipSum };
}
